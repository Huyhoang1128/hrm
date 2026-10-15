"""
hrm/ranking_views.py
════════════════════
API thống kê bảng xếp hạng chấm công (đi sớm / đúng giờ).

Endpoints:
  POST /attendance/ranking/compute/?year=&month=          – Tính & lưu xếp hạng tháng
  GET  /attendance/ranking/?year=&month=[&top=N]          – Xem bảng xếp hạng đã lưu
  GET  /attendance/ranking/<employee_id>/?year=&month=    – Xem xếp hạng của một nhân viên
"""

import datetime
import logging
from collections import defaultdict

from django.db import transaction
from django.db.models import Q, Count

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from employee.models import Employee, Department
from .event_models import EmployeeEvent
from .models import ShiftConfig, CompanyConfig, _is_hr
from .attendance_models import AttendanceRanking
from .utils import get_cloudfly_presigned_url
from .constant import ExplanationType

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _ok(data, status_code=status.HTTP_200_OK):
    return Response({"success": True, "data": data}, status=status_code)


def _err(message, status_code=status.HTTP_400_BAD_REQUEST):
    return Response({"success": False, "error": message}, status=status_code)


def _get_employee(request):
    try:
        return Employee.objects.get(user=request.user)
    except Employee.DoesNotExist:
        return None


def _can_view_all(request):
    """Superuser hoặc HR có thể xem toàn bộ bảng xếp hạng."""
    if request.user.is_superuser:
        return True
    emp = _get_employee(request)
    return emp is not None and _is_hr(emp)


def _get_shift_start_minutes(employee: Employee, event_date: datetime.date) -> int | None:
    """
    Trả về giờ bắt đầu ca làm việc của nhân viên vào ngày cụ thể (tính bằng phút từ 00:00).
    Ưu tiên: ca gán riêng cho nhân viên → ca của phòng ban → ca mặc định toàn công ty.
    Trả về None nếu không tìm thấy ca.
    """
    base_qs = ShiftConfig.objects.filter(
        is_active=True,
        effective_from__lte=event_date,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=event_date)
    )

    # 1. Ca gán riêng cho nhân viên
    shift = base_qs.filter(apply_to_employees=employee).first()
    if shift:
        return shift.start_time.hour * 60 + shift.start_time.minute

    # 2. Ca theo phòng ban
    if employee.department_id:
        shift = base_qs.filter(apply_to_departments=employee.department_id).first()
        if shift:
            return shift.start_time.hour * 60 + shift.start_time.minute

    # 3. Ca mặc định
    shift = base_qs.filter(is_default=True).first()
    if shift:
        return shift.start_time.hour * 60 + shift.start_time.minute

    return None


def _get_max_explanations_per_month() -> int:
    today = datetime.date.today()
    company_config = CompanyConfig.objects.filter(
        is_active=True,
        effective_from__lte=today,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=today)
    ).order_by("-effective_from").first()
    return company_config.max_explanation_count_per_month if company_config else 3


def _get_remaining_explanations_map(
    year: int,
    month: int,
    employee_ids: list[int] | None = None,
) -> tuple[int, dict[int, int]]:
    quota_types = [
        ExplanationType.LATE,
        ExplanationType.EARLY_LEAVE,
        ExplanationType.LATE_EARLY,
        ExplanationType.INCOMPLETE_ATTENDANCE,
    ]
    max_per_month = _get_max_explanations_per_month()

    explanation_qs = EmployeeEvent.objects.filter(
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date__year=year,
        event_date__month=month,
        data__status="APPROVED",
        data__explanation_type__in=quota_types,
    )
    if employee_ids is not None:
        explanation_qs = explanation_qs.filter(employee_id__in=employee_ids)

    used_counts = {
        row["employee_id"]: row["used_count"]
        for row in explanation_qs.values("employee_id").annotate(used_count=Count("id"))
    }

    remaining_map: dict[int, int] = {}
    if employee_ids is not None:
        for employee_id in employee_ids:
            remaining_map[employee_id] = max(0, max_per_month - used_counts.get(employee_id, 0))
    else:
        for employee_id, used_count in used_counts.items():
            remaining_map[employee_id] = max(0, max_per_month - used_count)

    return max_per_month, remaining_map


def _compute_ranking_for_month(year: int, month: int) -> list[dict]:
    """
    Tính bảng xếp hạng cho toàn bộ nhân viên trong tháng `year`/`month`.
    Trả về danh sách dict chứa thống kê từng nhân viên, đã được sắp xếp.
    Lưu kết quả vào bảng AttendanceRanking (upsert).
    """
    # Ngưỡng tối đa số phút đến sớm hợp lệ (4 giờ).
    # Nếu diff lớn hơn mức này thì nhiều khả năng là dữ liệu bất thường,
    # không tính vào xếp hạng.
    MAX_EARLY_MINUTES = 240

    # Số ngày đi sớm tối thiểu (phải LỚN HƠN mức này) để đủ điều kiện xuất
    # hiện trên bảng xếp hạng đi sớm — tránh trường hợp chỉ đi sớm vài ngày
    # trong tháng nhưng tỉ lệ 100% lại được xếp hạng cao bất hợp lý.
    EARLY_RANKING_MIN_DAYS = 14

    # Loại giải trình mà khi đã được duyệt thì ngày đó luôn được tính là
    # "đi làm đúng giờ" (không phải đi sớm, không phải bất thường), bất kể
    # dữ liệu check-in thực tế (hoặc không có check-in) ra sao.
    ONTIME_OVERRIDE_EXPLANATION_TYPES = [
        ExplanationType.LATE,
        ExplanationType.INCOMPLETE_ATTENDANCE,
    ]

    # Lấy tất cả attendance events trong tháng có check_in
    events = EmployeeEvent.objects.filter(
        event_type=EmployeeEvent.EventType.ATTENDANCE,
        event_date__year=year,
        event_date__month=month,
        check_in__isnull=False,
    ).select_related("employee", "employee__department").order_by("employee_id", "event_date", "check_in")

    # Gom theo nhân viên, deduplicate theo ngày (chỉ lấy check_in sớm nhất mỗi ngày)
    # daily_events: {emp_id → {event_date → event_with_earliest_check_in}}
    daily_events: dict[int, dict] = {}

    for event in events:
        emp_id = event.employee_id
        if emp_id not in daily_events:
            daily_events[emp_id] = {}
        # Do queryset đã order_by check_in tăng dần, event đầu tiên trong ngày là sớm nhất
        if event.event_date not in daily_events[emp_id]:
            daily_events[emp_id][event.event_date] = event

    # Những ngày có đơn giải trình Đi muộn / Quên chấm công (kể cả quên checkout)
    # đã được duyệt → luôn tính là ngày đi làm đúng giờ, không tính là đi sớm.
    explanation_rows = EmployeeEvent.objects.filter(
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date__year=year,
        event_date__month=month,
        data__status="APPROVED",
        data__explanation_type__in=ONTIME_OVERRIDE_EXPLANATION_TYPES,
    ).values("employee_id", "event_date")

    explained_dates: dict[int, set] = defaultdict(set)
    for row in explanation_rows:
        explained_dates[row["employee_id"]].add(row["event_date"])

    # Những ngày nghỉ phép NỬA BUỔI đã được duyệt (giải trình LEAVE với
    # expected_status=HALF_DAY) → loại HOÀN TOÀN khỏi tính toán (không tính
    # vào mẫu số, không tính sớm/đúng giờ), đồng nhất với cách nghỉ phép
    # TRỌN NGÀY đang được xử lý (những ngày đó vốn không có event check-in
    # nào nên tự động không ảnh hưởng tới tỉ lệ). Nếu không loại, nhân viên
    # nghỉ nửa buổi (vẫn có check-in cho nửa ngày còn lại) sẽ bị thiệt hơn
    # nhân viên nghỉ trọn ngày dù cùng là nghỉ phép hợp lệ.
    half_day_leave_rows = EmployeeEvent.objects.filter(
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date__year=year,
        event_date__month=month,
        data__status="APPROVED",
        data__explanation_type=ExplanationType.LEAVE,
        data__expected_status="HALF_DAY",
    ).values("employee_id", "event_date")

    excluded_dates: dict[int, set] = defaultdict(set)
    for row in half_day_leave_rows:
        excluded_dates[row["employee_id"]].add(row["event_date"])

    # Gom theo nhân viên
    stats: dict[int, dict] = {}  # employee_id → aggregated stats

    def _ensure_stats(emp_id: int, emp) -> dict:
        if emp_id not in stats:
            stats[emp_id] = {
                "employee": emp,
                "early_days": 0,
                "total_early_minutes": 0,
                "on_time_days": 0,
                "total_working_days": 0,
            }
        return stats[emp_id]

    for emp_id, day_map in daily_events.items():
        emp_explained_dates = explained_dates.get(emp_id, set())
        emp_excluded_dates = excluded_dates.get(emp_id, set())
        for event_date, event in day_map.items():
            if event_date in emp_excluded_dates:
                # Nghỉ phép nửa buổi đã duyệt → loại hoàn toàn, không tính vào
                # mẫu số cũng như sớm/đúng giờ.
                continue

            emp = event.employee
            employee_stats = _ensure_stats(emp_id, emp)
            employee_stats["total_working_days"] += 1

            if event_date in emp_explained_dates:
                # Có đơn giải trình Đi muộn/Quên chấm công đã duyệt → luôn tính đúng giờ.
                employee_stats["on_time_days"] += 1
                continue

            shift_start = _get_shift_start_minutes(emp, event_date)
            if shift_start is None:
                # Không có ca → chỉ đếm ngày công, không xếp hạng đến sớm/đúng giờ
                continue

            check_in_minutes = event.check_in.hour * 60 + event.check_in.minute
            diff = shift_start - check_in_minutes  # dương = đến sớm, âm = đến muộn

            if diff > MAX_EARLY_MINUTES:
                # Dữ liệu bất thường (check_in quá sớm so với giờ ca), bỏ qua
                continue

            if diff > 0:
                employee_stats["early_days"] += 1
                employee_stats["total_early_minutes"] += diff
                employee_stats["on_time_days"] += 1  # đến sớm cũng tính là đúng giờ
            elif diff == 0:
                employee_stats["on_time_days"] += 1

    # Những ngày có đơn giải trình đã duyệt nhưng không hề có event check-in
    # nào trong tháng (chưa được đếm ở trên) → vẫn được tính là 1 ngày công
    # thực tế, đúng giờ.
    if explained_dates:
        explained_employee_ids = list(explained_dates.keys())
        explained_employees = {
            e.id: e
            for e in Employee.objects.filter(id__in=explained_employee_ids).select_related("department")
        }
        for emp_id, dates in explained_dates.items():
            emp = explained_employees.get(emp_id)
            if emp is None:
                continue
            already_counted = daily_events.get(emp_id, {}).keys()
            missing_dates = dates - set(already_counted)
            if not missing_dates:
                continue
            employee_stats = _ensure_stats(emp_id, emp)
            employee_stats["total_working_days"] += len(missing_dates)
            employee_stats["on_time_days"] += len(missing_dates)

    if not stats:
        return []

    # Sắp xếp hạng đi sớm theo thứ tự ưu tiên:
    #   1. Tỉ lệ đi làm sớm (%) = Số ngày đi sớm / Số ngày làm việc thực tế (nhiều hơn xếp trên)
    #   2. Số lượt giải trình còn lại (nhiều hơn xếp trên)
    #   3. Số phút đi sớm trung bình trong tháng = tổng phút sớm / số ngày đi sớm (nhiều hơn xếp trên)
    # employee.id là tie-break cuối cùng để thứ hạng ổn định giữa các lần tính.
    employee_ids = list(stats.keys())
    _, remaining_explanations_map = _get_remaining_explanations_map(
        year,
        month,
        employee_ids,
    )
    for emp_id, employee_stats in stats.items():
        employee_stats["remaining_explanations"] = remaining_explanations_map.get(emp_id, 0)
        employee_stats["early_ratio"] = (
            employee_stats["early_days"] / employee_stats["total_working_days"] * 100
            if employee_stats["total_working_days"] > 0
            else 0.0
        )

    def early_ranking_key(employee_stats: dict) -> tuple:
        early_days = employee_stats["early_days"]
        avg_early_minutes = (
            employee_stats["total_early_minutes"] / early_days
            if early_days > 0
            else 0
        )
        return (
            -employee_stats["early_ratio"],
            -employee_stats["remaining_explanations"],
            -avg_early_minutes,
            employee_stats["employee"].id,
        )

    sorted_by_early = sorted(
        stats.values(),
        key=early_ranking_key,
    )
    sorted_by_on_time = sorted(
        stats.values(),
        key=lambda s: (-s["on_time_days"], -s["early_days"]),
    )

    # Gán rank. Bảng "đi sớm" chỉ xếp hạng cho nhân viên có đủ số ngày đi sớm
    # tối thiểu (tránh trường hợp đi sớm 1-5 ngày/tháng nhưng tỉ lệ 100% lại
    # được xếp hạng cao bất hợp lý) — người không đạt sẽ có rank_early = None
    # và không xuất hiện trên bảng xếp hạng đi sớm.
    rank_map_early = {}
    rank_counter = 1
    for s in sorted_by_early:
        if s["early_days"] > EARLY_RANKING_MIN_DAYS:
            rank_map_early[s["employee"].id] = rank_counter
            rank_counter += 1
    rank_map_on_time = {s["employee"].id: i + 1 for i, s in enumerate(sorted_by_on_time)}

    # Upsert vào AttendanceRanking
    ranking_objs = []
    for emp_id, s in stats.items():
        ranking_objs.append(
            AttendanceRanking(
                employee=s["employee"],
                year=year,
                month=month,
                early_days=s["early_days"],
                total_early_minutes=s["total_early_minutes"],
                on_time_days=s["on_time_days"],
                total_working_days=s["total_working_days"],
                rank_early=rank_map_early.get(emp_id),
                rank_on_time=rank_map_on_time.get(emp_id),
            )
        )

    with transaction.atomic():
        # Xóa bản ghi cũ của tháng trước khi insert mới
        AttendanceRanking.objects.filter(year=year, month=month).delete()
        AttendanceRanking.objects.bulk_create(ranking_objs)

    return sorted_by_early


def _serialize_ranking(
    obj: AttendanceRanking,
    remaining_explanations: int | None = None,
    max_explanations_per_month: int | None = None,
) -> dict:
    emp = obj.employee
    return {
        "employee_id": emp.id,
        "employee_code": emp.employee_id,
        "full_name": emp.full_name,
        "avatar": get_cloudfly_presigned_url(emp.avatar) if emp.avatar else None,
        "department": emp.department.name if emp.department else None,
        "year": obj.year,
        "month": obj.month,
        "early_days": obj.early_days,
        "total_early_minutes": obj.total_early_minutes,
        "avg_early_minutes": obj.avg_early_minutes,
        "early_ratio": obj.early_ratio,
        "on_time_days": obj.on_time_days,
        "total_working_days": obj.total_working_days,
        "rank_early": obj.rank_early,
        "rank_on_time": obj.rank_on_time,
        "computed_at": obj.computed_at.isoformat() if obj.computed_at else None,
        "remaining_explanations": remaining_explanations,
        "max_explanations_per_month": max_explanations_per_month,
    }


# ─────────────────────────────────────────────────────────────────────────────
# VIEWS
# ─────────────────────────────────────────────────────────────────────────────

class ComputeRankingView(APIView):
    """
    POST /attendance/ranking/compute/
    Body (optional JSON): {"year": 2026, "month": 4}
    Mặc định: tháng hiện tại.

    Tính toán và lưu bảng xếp hạng cho tháng đã chỉ định.
    Yêu cầu: superuser hoặc HR.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_view_all(request):
            return _err("Bạn không có quyền tính bảng xếp hạng.", status.HTTP_403_FORBIDDEN)

        today = datetime.date.today()
        try:
            year = int(request.data.get("year") or today.year)
            month = int(request.data.get("month") or today.month)
        except (ValueError, TypeError):
            return _err("year và month phải là số nguyên hợp lệ.")

        if not (1 <= month <= 12):
            return _err("month phải từ 1 đến 12.")
        if year < 2000 or year > 2100:
            return _err("year không hợp lệ.")

        try:
            _compute_ranking_for_month(year, month)
        except Exception:
            logger.exception("Lỗi khi tính bảng xếp hạng %s/%s", month, year)
            return _err("Lỗi khi tính bảng xếp hạng, vui lòng thử lại.", status.HTTP_500_INTERNAL_SERVER_ERROR)

        total = AttendanceRanking.objects.filter(year=year, month=month).count()
        return _ok({"year": year, "month": month, "total_employees": total})


class RankingListView(APIView):
    """
    GET /attendance/ranking/?year=2026&month=4[&top=10][&type=early|on_time]
    Trả về bảng xếp hạng đã lưu.  Ai cũng xem được (nhân viên thường chỉ thấy tên mình trong danh sách).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = datetime.date.today()
        try:
            year = int(request.query_params.get("year") or today.year)
            month = int(request.query_params.get("month") or today.month)
        except (ValueError, TypeError):
            return _err("year và month phải là số nguyên.")

        rank_type = request.query_params.get("type", "early").lower()
        if rank_type not in ("early", "on_time"):
            return _err("type phải là 'early' hoặc 'on_time'.")

        try:
            top = int(request.query_params.get("top") or 0)
        except (ValueError, TypeError):
            top = 0

        order_field = "rank_early" if rank_type == "early" else "rank_on_time"
        qs = (
            AttendanceRanking.objects
            .filter(year=year, month=month)
            .exclude(**{f"{order_field}__isnull": True})
            .select_related("employee", "employee__department")
            .order_by(order_field)
        )

        if top > 0:
            qs = qs[:top]

        ranking_list = list(qs)
        employee_ids = [obj.employee_id for obj in ranking_list]
        max_per_month, remaining_map = _get_remaining_explanations_map(year, month, employee_ids)
        result = [
            _serialize_ranking(
                obj,
                remaining_explanations=remaining_map.get(obj.employee_id, max_per_month),
                max_explanations_per_month=max_per_month,
            )
            for obj in ranking_list
        ]
        return _ok({
            "year": year,
            "month": month,
            "type": rank_type,
            "count": len(result),
            "rankings": result,
        })


class RankingEmployeeView(APIView):
    """
    GET /attendance/ranking/<employee_id>/?year=2026&month=4
    Xem xếp hạng của một nhân viên cụ thể.
    Nhân viên chỉ xem được của chính mình; HR/superuser xem được mọi người.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, employee_id: int):
        today = datetime.date.today()
        try:
            year = int(request.query_params.get("year") or today.year)
            month = int(request.query_params.get("month") or today.month)
        except (ValueError, TypeError):
            return _err("year và month phải là số nguyên.")

        # Kiểm tra quyền
        current_emp = _get_employee(request)
        if not _can_view_all(request):
            if current_emp is None or current_emp.id != employee_id:
                return _err("Bạn chỉ có thể xem xếp hạng của chính mình.", status.HTTP_403_FORBIDDEN)

        try:
            obj = AttendanceRanking.objects.select_related(
                "employee", "employee__department"
            ).get(employee_id=employee_id, year=year, month=month)
        except AttendanceRanking.DoesNotExist:
            return _err("Chưa có dữ liệu xếp hạng cho nhân viên và tháng này.", status.HTTP_404_NOT_FOUND)

        max_per_month, remaining_map = _get_remaining_explanations_map(year, month, [employee_id])
        return _ok(_serialize_ranking(
            obj,
            remaining_explanations=remaining_map.get(employee_id, max_per_month),
            max_explanations_per_month=max_per_month,
        ))
