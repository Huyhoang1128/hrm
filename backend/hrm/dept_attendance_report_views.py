"""
API view xuất báo cáo vi phạm chấm công theo phòng ban.

Trả về danh sách nhân viên với tổng hợp số lần vi phạm trong tháng
(đi muộn, về sớm, quên chấm công) - mỗi nhân viên một dòng.
"""
import logging
from datetime import date

from django.db import models
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from employee.models import Department, Employee
from .event_models import EmployeeEvent
from .main_api import EmployeeState
from .attendance_views import AttendanceCalendarView
from .employee_work_utils import is_holiday_creditable, get_holiday_credit_for_employee
from users.utils import get_user_role

logger = logging.getLogger(__name__)

# "FORGOT" là tên legacy của INCOMPLETE_ATTENDANCE trong data cũ — cả 2 đều là
# giải trình "Quên chấm công".
_FORGOT_CHECKIN_EXPLANATION_TYPES = ("INCOMPLETE_ATTENDANCE", "FORGOT")


def _sum_effect(entries: list, field: str) -> float:
    """Sum a specific field from the effects dict across a list of calendar entries."""
    return sum(
        (entry.get("effects", {}).get(field) or 0)
        for entry in entries
    )


def _sum_delta(entries: list, field: str) -> float:
    """Sum a specific field from the delta dict across a list of calendar entries."""
    return sum(
        (entry.get("delta", {}).get(field) or 0)
        for entry in entries
    )


def _get_approved_forgot_checkin_dates(employee: Employee, year: int, month: int) -> set:
    """
    Lấy tập ngày có đơn giải trình "Quên chấm công" ĐÃ DUYỆT trong tháng.

    QUAN TRỌNG: query trực tiếp EmployeeEvent thay vì dựa vào delta.quen_cham_cong
    trong calendar do replay engine (main_api.EmployeeState) tính — vì rule ca
    sáng/ca chiều đọc check_in/check_out chung của CẢ NGÀY từ 1 event attendance
    duy nhất: nếu nhân viên có chấm công ca chiều (có đủ check_in/check_out) nhưng
    hoàn toàn không chấm công ca sáng, rule ca sáng vẫn thấy "có cả hai mốc giờ"
    (thực ra là giờ của ca chiều) nên KHÔNG đánh dấu quen_cham_cong cho ca sáng —
    dẫn tới báo cáo vi phạm bỏ sót đúng những ngày quên chấm công thật sự nhất,
    dù đơn giải trình đã được duyệt xác nhận có xảy ra quên chấm công.
    """
    events = EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date__year=year,
        event_date__month=month,
        data__status='APPROVED',
        data__explanation_type__in=_FORGOT_CHECKIN_EXPLANATION_TYPES,
    ).values_list('event_date', flat=True)
    return {d.isoformat() for d in events}


def _build_employee_violation_summary(employee: Employee, calendar: list, year: int, month: int) -> dict:
    """
    Từ danh sách calendar_result của một nhân viên, tổng hợp vi phạm cả tháng.

    Trả về một dict tổng hợp (một dòng / nhân viên) gồm:
      - Thông tin nhân viên
      - Tổng công cả tháng
      - Tổng tiền phạt cả tháng
      - Số ngày đi muộn / về sớm / quên chấm công
      - Tổng tiền phạt đi muộn / về sớm
    """
    emp_department = employee.department.name if employee.department else ""
    emp_position = employee.position.title if employee.position else ""
    emp_rank = employee.rank or ""
    emp_doctor_team = employee.doctor_team or ""

    tong_cong = 0.0
    tong_phat = 0
    tong_phat_di_muon = 0
    tong_phat_ve_som = 0
    so_lan_di_muon = 0
    so_lan_ve_som = 0
    # Dùng set ngày thay vì đếm dồn trực tiếp — để union với ngày có đơn giải
    # trình "Quên chấm công" đã duyệt (query riêng, xem
    # _get_approved_forgot_checkin_dates) mà không đếm trùng 1 ngày 2 lần.
    quen_cham_cong_dates = set(_get_approved_forgot_checkin_dates(employee, year, month))

    # Gom nhóm calendar entries theo ngày
    by_date: dict[str, list] = {}
    for entry in calendar:
        date_str = entry.get("date")
        if date_str:
            by_date.setdefault(date_str, []).append(entry)

    # Cộng công lễ theo ngày, cùng logic với các API chốt công:
    # Nếu có dữ liệu chấm công ngày lễ => công ngày + 1 công lễ.
    # Nếu không có dữ liệu chấm công ngày lễ => 1 công lễ.
    holiday_dates = {
        d
        for d in AttendanceCalendarView._build_holiday_map(year, month).keys()
        if is_holiday_creditable(employee, d)
    }
    holiday_date_strs = {d.isoformat() for d in holiday_dates}
    from employee.assignment import AssignmentResolver
    assignment = AssignmentResolver()  # part-time/full-time theo ngày lễ

    for date_str in sorted(by_date.keys()):
        entries = by_date[date_str]
        attendance_entries = [e for e in entries if e.get("event_type") == "attendance"]

        late_minutes = sum(
            (e.get("effects", {}).get("late_minutes") or 0)
            for e in attendance_entries
        )
        early_leave_minutes = sum(
            (e.get("effects", {}).get("early_leave_minutes") or 0)
            for e in attendance_entries
        )
        # QUAN TRỌNG: tính trên TOÀN BỘ entries của ngày, không chỉ attendance_entries.
        # Trường hợp quên chấm công 100% (không có checkin/checkout nào cả) chỉ để
        # lại entry event_type "explanation"/"explanation_approval" cho ngày đó —
        # nếu lọc riêng attendance_entries (rỗng) thì sẽ tính ra forgot_checkin=0,
        # bỏ sót đúng những ngày quên chấm công thật sự nhất.
        forgot_checkin = _sum_delta(entries, "quen_cham_cong")

        if late_minutes > 0:
            so_lan_di_muon += 1
        if early_leave_minutes > 0:
            so_lan_ve_som += 1
        if forgot_checkin > 0:
            quen_cham_cong_dates.add(date_str)

        base_credit = _sum_delta(entries, "tong_ngay_cong")
        holiday_credit = (
            get_holiday_credit_for_employee(employee, date.fromisoformat(date_str), assignment)
            if date_str in holiday_date_strs else 0.0
        )
        tong_cong += base_credit + holiday_credit
        tong_phat += max(0, int(_sum_delta(entries, "tong_phat")))
        tong_phat_di_muon += max(0, int(_sum_effect(entries, "late_penalty")))
        tong_phat_ve_som += max(0, int(_sum_effect(entries, "early_leave_penalty")))

    so_lan_quen_cham_cong = len(quen_cham_cong_dates)
    so_lan_vi_pham = so_lan_di_muon + so_lan_ve_som + so_lan_quen_cham_cong

    return {
        "ma_nhan_vien": employee.employee_id,
        "ten_nhan_vien": employee.full_name,
        "phong_ban": emp_department,
        "chuc_danh": emp_rank,
        "vi_tri": emp_position,
        "bac_si": emp_doctor_team,
        "tong_cong": round(float(tong_cong), 2),
        "tong_phat": tong_phat,
        "so_lan_vi_pham": so_lan_vi_pham,
        "so_lan_di_muon": so_lan_di_muon,
        "so_lan_ve_som": so_lan_ve_som,
        "so_lan_quen_cham_cong": so_lan_quen_cham_cong,
        "tong_phat_di_muon": tong_phat_di_muon,
        "tong_phat_ve_som": tong_phat_ve_som,
    }


class DeptAttendanceViolationReportView(APIView):
    """
    GET /api-hrm/dept-attendance-violation-report/

    Query params:
      - department_id (int, tuỳ chọn): ID phòng ban. Bỏ trống (hoặc "all") để
        lấy báo cáo cho TẤT CẢ phòng ban trong 1 lần (mỗi dòng vẫn giữ đúng
        tên phòng ban của nhân viên đó, xem "phong_ban" trong data).
      - year (int, bắt buộc): Năm
      - month (int, bắt buộc): Tháng (1-12)

    Trả về JSON danh sách nhân viên với tổng hợp vi phạm chấm công trong tháng
    (đi muộn, về sớm, quên chấm công) - mỗi nhân viên một dòng.

    Quyền: Admin/HCNS xem mọi nhân viên; trưởng phòng chỉ xem chính mình và
    cấp dưới trực tiếp; người khác bị từ chối.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        department_id = request.query_params.get("department_id")
        year = request.query_params.get("year")
        month = request.query_params.get("month")

        # department_id rỗng hoặc "all" => báo cáo TẤT CẢ phòng ban.
        if department_id in (None, "", "all"):
            department_id = None

        # Validation
        if not year or not month:
            return Response(
                {"error": "year và month là bắt buộc"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            if department_id is not None:
                department_id = int(department_id)
            year = int(year)
            month = int(month)
        except (ValueError, TypeError):
            return Response(
                {"error": "department_id, year, month phải là số nguyên"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (1 <= month <= 12):
            return Response(
                {"error": "month phải nằm trong khoảng 1-12"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Trưởng phòng (không phải Admin/HCNS) chỉ xem chính mình + cấp dưới trực tiếp.
        manager = None
        if get_user_role(request.user) not in ("admin", "hr"):
            manager = Employee.objects.filter(user=request.user).first()
            if manager is None or not Employee.objects.filter(manager=manager).exists():
                return Response(
                    {"error": "Bạn không có quyền xem báo cáo vi phạm."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Lấy phòng ban (bỏ qua khi lấy báo cáo TẤT CẢ phòng ban)
        department_name = "Tất cả phòng ban"
        if department_id is not None:
            try:
                department = Department.objects.get(pk=department_id)
            except Department.DoesNotExist:
                return Response(
                    {"error": "Phòng ban không tồn tại"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            department_name = department.name

        # Lấy nhân viên đang hoạt động trong phòng ban tại tháng báo cáo.
        # Dùng end_date thay vì is_active (field is_active do HR set tay,
        # không tự động đồng bộ theo ngày nghỉ việc thực tế) — NV nghỉ trước
        # tháng báo cáo sẽ bị loại, NV nghỉ trong tháng vẫn hiển thị vì có
        # công/vi phạm cần tính trong tháng đó.
        first_day_of_month = date(year, month, 2)
        employees = Employee.objects.filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gte=first_day_of_month)
        )
        if department_id is not None:
            employees = employees.filter(department_id=department_id)
        if manager is not None:
            employees = employees.filter(models.Q(manager=manager) | models.Q(pk=manager.pk))
        employees = employees.select_related("department", "position").order_by(
            "department_id", "employee_id"
        )

        all_rows = []
        errors = []

        for employee in employees:
            # Không truyền department_id: replay_month tự lấy phòng ban THEO THÁNG
            # (lịch sử điều chuyển, employee/assignment.py).
            employee_info = {
                "group_ids": [],
            }
            try:
                result = EmployeeState.replay_month(
                    employee_code=employee.employee_id,
                    year=year,
                    month=month,
                    employee_info=employee_info,
                )
            except (KeyboardInterrupt, SystemExit):
                raise
            except Exception as exc:
                logger.error(
                    "dept_attendance_report: replay_month thất bại cho employee pk=%s (%s/%s): %s",
                    employee.pk, month, year, exc,
                )
                errors.append({
                    "employee_id": employee.employee_id,
                    "error": str(exc),
                })
                continue

            calendar = result.get("calendar", [])
            summary = _build_employee_violation_summary(employee, calendar, year, month)
            all_rows.append(summary)

        total_violations = sum(row["so_lan_vi_pham"] for row in all_rows)

        response_data = {
            "department_id": department_id,
            "department_name": department_name,
            "year": year,
            "month": month,
            "total_employees": employees.count(),
            "total_violations": total_violations,
            "data": all_rows,
        }
        if errors:
            response_data["errors"] = errors

        return Response(response_data)
