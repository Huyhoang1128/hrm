"""
hrm/registration_views.py
══════════════════════════
ViewSets cho registration-requests (EmployeeEvent-backed) và OnlineWorkRequest.

/api-hrm/registration-requests/
    POST   – Tạo đơn → lưu trực tiếp vào EmployeeEvent (LIVESTREAM / OVERTIME).
    GET    – Danh sách, hỗ trợ ?status=PENDING&ordering=-created_at
    GET <pk>/ – Chi tiết
    POST <pk>/approve/ – Duyệt 2 bước (quản lý → HR)
    POST <pk>/reject/  – Từ chối

/api-hrm/online-work-requests/
    CRUD + approve / reject (dùng OnlineWorkRequest model, 2-bước duyệt).
"""

import logging

from django.db import models
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from employee.models import Employee

from .attendance_models import OnlineWorkRequest
from .constant import ExplanationType
from .event_models import EmployeeEvent
from .models import CompanyConfig, EmployeePermission, _is_hr, _has_approve_permission, is_senior_manager
from .models import (record_request_edit, soft_cancel_request, log_request_cancel,
                     reset_approval_for_privileged_edit)
from .pagination import StandardResultsSetPagination
from .registration_serializers import (
    OnlineWorkRequestListSerializer,
    OnlineWorkRequestSerializer,
    OnlineWorkEventCreateSerializer,
    REGISTRATION_EVENT_TYPES,
    RegistrationRequestCreateSerializer,
    serialize_registration_event,
)

logger = logging.getLogger(__name__)


def _off_duty_approval_block_reason(event) -> str | None:
    """
    Chặn lỗ hổng: đơn "Ra trực" (OFF_DUTY) mặc định được tính THẲNG 1 công khi
    duyệt (xem _evaluate_overtime_rule ở main_api.py), và KHÔNG bị giới hạn số
    lượng/tháng như đơn giải trình (tối đa 3 đơn/tháng) — nhân viên có thể lợi
    dụng tạo nhiều đơn Ra trực thay vì chấm công thật để lấy công dễ dàng,
    không tốn lượt giải trình.

    Rule mới: chỉ được duyệt đơn Ra trực nếu 1 trong 2 điều kiện đúng:
      1. Ngày đó ĐÃ có chấm công thật (có check_in HOẶC check_out), HOẶC
      2. Ngày đó KHÔNG có chấm công nào, nhưng đã có 1 đơn "Quên chấm công"
         (INCOMPLETE_ATTENDANCE) được duyệt cho đúng ngày đó — tức là vẫn phải
         đi qua cơ chế giải trình bình thường (tốn 1 lượt giải trình/tháng),
         không còn cách nào lấy công "miễn phí" qua đường Ra trực nữa.

    Trả về None nếu được phép duyệt, hoặc chuỗi lý do chặn nếu không.
    """
    if event.event_type != EmployeeEvent.EventType.OFF_DUTY:
        return None

    has_attendance = EmployeeEvent.objects.filter(
        employee=event.employee,
        event_date=event.event_date,
        event_type=EmployeeEvent.EventType.ATTENDANCE,
    ).filter(
        models.Q(check_in__isnull=False) | models.Q(check_out__isnull=False)
    ).exists()
    if has_attendance:
        return None

    has_approved_incomplete_attendance = EmployeeEvent.objects.filter(
        employee=event.employee,
        event_date=event.event_date,
        event_type=EmployeeEvent.EventType.EXPLANATION,
        data__explanation_type=ExplanationType.INCOMPLETE_ATTENDANCE,
        data__status='APPROVED',
    ).exists()
    if has_approved_incomplete_attendance:
        return None

    return (
        "Ngày này chưa có dữ liệu chấm công (vào/ra) và chưa có đơn \"Quên chấm "
        "công\" nào được duyệt. Nhân viên cần tạo đơn Quên chấm công cho ngày "
        "này và được duyệt trước khi có thể duyệt đơn Ra trực."
    )


def _dt_time_from_str(value):
    """Đổi "HH:MM" / "HH:MM:SS" -> datetime.time. Giá trị gán vào
    event.check_in/check_out có thể còn là chuỗi (chưa qua save/refresh) nên
    cần chuẩn hoá trước khi đưa vào compute_overtime_hours()."""
    import datetime as _dt
    if isinstance(value, _dt.time):
        return value
    try:
        return _dt.time.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def _check_approve_deadline(event, bypass: bool) -> str | None:
    """Chặn DUYỆT đơn Tăng ca (OVERTIME)/Nghỉ không phép (UNAUTHORIZED_ABSENCE)
    quá hạn — theo quy định thời hạn tạo/duyệt đơn (hiệu lực từ 09/09/2026, xem
    hrm/deadline_utils.py). Hạn tạo đơn đã được chặn ở
    RegistrationRequestCreateSerializer.validate(); chặn thêm ở đây để bịt
    đường "tạo trước hạn nhưng cố ý để dồn tới sau hạn mới duyệt" (vd quản lý
    trực tiếp trì hoãn duyệt). `bypass=True` (Admin/HR) luôn được bỏ qua —
    đây chính là cơ chế "HCNS mở cho trường hợp đặc biệt".

    Trả về None nếu được phép duyệt, hoặc chuỗi lý do chặn nếu không.
    """
    from .deadline_utils import (
        is_locked_effective, hours_before_deadline, leave_style_deadline, _combine_aware,
        unauthorized_absence_deadline, unauthorized_absence_uses_leave_rule,
        overtime_deadline_for,
        manager_attendance_fix_deadline,
    )
    from .deadline_exception_models import has_deadline_exception

    if bypass or not is_locked_effective():
        return None

    reg_type = (event.data or {}).get("registration_type")
    if reg_type == "OVERTIME":
        from .deadline_exception_models import CANCEL_EDIT_REQUEST_TYPE
        if (
            has_deadline_exception(event.employee, event.event_date, "OVERTIME")
            or has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
        ):
            return None
        # HẠN DUYỆT đơn tăng ca — DÙNG CHUNG đúng mốc với hạn TẠO đơn
        # (deadline_utils.overtime_deadline_for), để 2 bước không lệch nhau:
        #
        #   • Nhóm được gia hạn (cờ ở Vị trí hoặc ở riêng nhân viên — HCNS chốt
        #     2026-09-24: Điều dưỡng, Điều dưỡng Trưởng, TLHA, Leader TLHA + 1
        #     nhân sự Content Tiktok): tạo VÀ duyệt tới 10h sáng ngày làm việc
        #     kế tiếp.
        #   • Mọi vị trí khác: tạo VÀ duyệt xong trước 2 GIỜ so với giờ bắt đầu.
        #
        # Bản 2026-09-23 từng siết hạn DUYỆT về 2 giờ cho MỌI vị trí trong khi
        # hạn TẠO vẫn theo bậc cũ — hệ quả là nhóm được gia hạn tạo đơn được
        # nhưng QLTT không duyệt nổi (đã quá 2 giờ), dồn hết sang HCNS duyệt
        # tay. Gộp về 1 nguồn sự thật ở đây chính là để bịt cái lệch đó.
        #
        # KHÁC với hạn SỬA giờ (manager_attendance_fix_deadline, 10h sáng ngày
        # LỊCH kế tiếp) — có chủ ý: đơn phải được duyệt TRƯỚC khi làm, còn sau
        # khi làm xong mà giờ thực tế lệch thì QLTT sửa lại rồi HCNS duyệt lại
        # (HCNS vào hàm này với bypass=True nên không bị mốc trên chặn).
        deadline, is_extended = overtime_deadline_for(
            event.event_date, event.check_in, event.employee,
        )
        if deadline is None:
            return None  # đơn cũ không có giờ bắt đầu — không chặn hồi tố
        if timezone.now() > deadline:
            han = deadline.strftime('%H:%M %d/%m/%Y')
            return (
                f"Đã quá hạn duyệt đơn tăng ca (phải duyệt chậm nhất {han}). "
                f"Chỉ HCNS/Admin mới có thể duyệt ngoại lệ trường hợp này."
                if is_extended else
                f"Đã quá hạn duyệt đơn tăng ca (phải duyệt trước {han}, tức ít nhất 2 giờ "
                f"trước giờ bắt đầu). Nếu là trường hợp phát sinh đột xuất, liên hệ HCNS "
                f"để được mở khoá đặc biệt (hoặc để HCNS/Admin duyệt trực tiếp)."
            )
    elif reg_type == "UNAUTHORIZED_ABSENCE":
        from .deadline_exception_models import CANCEL_EDIT_REQUEST_TYPE
        from .deadline_utils import in_backlog_grace_period
        # HCNS cho phép bổ sung nốt đơn Nghỉ không phép phát sinh trước ngày
        # hiệu lực mà nhân sự chưa kịp tạo/duyệt (chỉ trong thời gian ân hạn
        # — xem BACKLOG_GRACE_PERIOD_END). Trước đây chỉ áp dụng cho Online/
        # Nghỉ phép, bổ sung thêm loại này theo yêu cầu HCNS 2026-09-16.
        if in_backlog_grace_period(event.event_date):
            return None
        if (
            has_deadline_exception(event.employee, event.event_date, "UNAUTHORIZED_ABSENCE")
            or has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
        ):
            return None
        d_ua = event.data or {}
        from datetime import date as _date

        def _as_date(v, fallback):
            if isinstance(v, str):
                try:
                    return _date.fromisoformat(v)
                except ValueError:
                    return fallback
            return v or fallback

        # Đơn nhiều ngày lưu cả start_date/end_date vào từng bản ghi ngày (xem
        # RegistrationRequestCreateSerializer.create) — phải lấy NGÀY ĐẦU của
        # cả nhóm, không phải event_date của riêng ngày đang xét, vì bậc thang
        # hạn nghỉ phép tính từ ngày nghỉ đầu tiên.
        start_date = _as_date(d_ua.get("start_date"), event.event_date)
        last_date = _as_date(d_ua.get("end_date"), event.event_date)
        # HCNS chốt 2026-09-28 — xem chú thích ở registration_serializers.py.
        # CHỈ áp cho đơn TẠO TỪ ngày hiệu lực trở đi: đơn tạo trước đó đã hợp
        # lệ theo luật đang có hiệu lực lúc ấy, đổi luật mà xét ngược lại thì
        # quản lý không còn đường duyệt (xem
        # UNAUTHORIZED_ABSENCE_LEAVE_RULE_EFFECTIVE_DATE).
        if unauthorized_absence_uses_leave_rule(event.created_at):
            deadline = leave_style_deadline(
                start_date, last_date, event.employee,
                expected_status=d_ua.get("expected_status"),
                half_day_period=d_ua.get("half_day_period"),
                reason=d_ua.get("reason", ""),
            )
        else:
            deadline = unauthorized_absence_deadline(last_date, event.employee)
        if timezone.now() > deadline:
            return (f"Đã quá hạn duyệt đơn nghỉ không phép (phải duyệt trước "
                    f"{deadline.strftime('%H:%M %d/%m/%Y')}). "
                    f"Chỉ HCNS/Admin mới có thể duyệt ngoại lệ trường hợp này.")
    elif reg_type == "LIVE":
        from .deadline_exception_models import CANCEL_EDIT_REQUEST_TYPE
        if (
            has_deadline_exception(event.employee, event.event_date, "LIVE")
            or has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
        ):
            return None
        start_time = event.check_in
        if not start_time:
            return None  # đơn cũ tạo trước khi có field này — không chặn hồi tố
        start_dt = _combine_aware(event.event_date, start_time)
        deadline = hours_before_deadline(start_dt, 2)
        if timezone.now() > deadline:
            return (f"Đã quá hạn duyệt đơn livestream (phải duyệt trước "
                    f"{deadline.strftime('%H:%M %d/%m/%Y')}, tức ít nhất 2 giờ trước giờ bắt đầu). "
                    f"Nếu là trường hợp phát sinh đột xuất, liên hệ HCNS để được mở khoá đặc biệt "
                    f"(hoặc để HCNS/Admin duyệt trực tiếp).")
    return None


def _resolve_online_work_half(data) -> str:
    """Suy ra buổi (MORNING/AFTERNOON/FULL) của đơn Làm việc online để tính
    đúng hạn tạo/duyệt theo ca tương ứng — trước đây LUÔN dùng 'FULL' (ca sớm
    nhất trong ngày) bất kể nhân sự chọn sáng/chiều/cả ngày, khiến đơn Online
    buổi CHIỀU bị tính hạn theo giờ vào ca SÁNG (vd nhân viên hành chính
    08h30-17h30: hạn luôn rơi về 06h30, chặn cả đơn buổi chiều gửi giữa trưa
    dù còn thừa thời gian theo đúng luật — lỗi thực tế Kế toán gặp phải
    2026-09-26). Ưu tiên field `half_day_period` tường minh (đúng pattern đã
    dùng cho LEAVE/BUSINESS_TRIP — xem taodon_views.py); nếu không có (đơn cũ,
    hoặc FE chưa gửi) thì suy đoán qua chữ 'sáng'/'chiều' trong `reason`. Đơn
    cả ngày/checkpage (expected_status != 'HALF_DAY') giữ nguyên 'FULL' —
    hành vi cũ đúng cho trường hợp này, không đổi."""
    data = data or {}
    if data.get("expected_status") != "HALF_DAY":
        return "FULL"
    explicit = str(data.get("half_day_period") or "").strip().upper()
    if explicit in ("MORNING", "AFTERNOON"):
        return explicit
    reason_text = str(data.get("reason") or "").lower()
    if "chiều" in reason_text:
        return "AFTERNOON"
    if "sáng" in reason_text:
        return "MORNING"
    return "FULL"


def _check_online_work_approve_deadline(event, bypass: bool) -> str | None:
    """Chặn DUYỆT đơn Làm việc online quá hạn (Thông báo mục II.4: trước ít
    nhất 2 giờ so với giờ bắt đầu) — tách thành hàm riêng để dùng chung cho cả
    approve() và bulk_approve() (trước đây bulk_approve hoàn toàn không kiểm
    tra). `bypass=True` (Admin/HR) luôn được bỏ qua.

    Trả về None nếu được phép duyệt, hoặc chuỗi lý do chặn nếu không.
    """
    from .deadline_utils import (
        is_locked_effective, hours_before_deadline, get_shift_start_time,
        _combine_aware, in_backlog_grace_period,
    )
    from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE

    if bypass or not is_locked_effective() or in_backlog_grace_period(event.event_date):
        return None
    if (
        has_deadline_exception(event.employee, event.event_date, "ONLINE_WORK")
        or has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
    ):
        return None

    shift_start = get_shift_start_time(
        event.employee, event.event_date, half=_resolve_online_work_half(event.data),
    )
    if not shift_start:
        return None
    online_deadline = hours_before_deadline(_combine_aware(event.event_date, shift_start), 2)
    if timezone.now() > online_deadline:
        return (f"Đã quá hạn duyệt đơn Online (phải duyệt trước "
                f"{online_deadline.strftime('%H:%M %d/%m/%Y')}). "
                f"Chỉ HCNS/Admin mới có thể duyệt ngoại lệ trường hợp này.")
    return None


def apply_shift_change_effect(event):
    """
    Khi đơn "Đổi ca" (registration_type=SHIFT_CHANGE) được duyệt xong
    (data.status == APPROVED), ghi đè ShiftRegistrationDay của đúng ngày đó
    sang cặp ca đích (to_ca — LUÔN đổi cả ca sáng + ca chiều vì đi theo cặp)
    — để công của nhân viên tính theo ca đã đổi.

    Idempotent: gọi lại nhiều lần (approve lại, replay...) vẫn an toàn vì chỉ
    set lại đúng giá trị ca đích, không cộng dồn gì thêm.
    """
    d = event.data or {}
    if d.get("registration_type") != "SHIFT_CHANGE" or d.get("status") != "APPROVED":
        return
    to_ca = d.get("to_ca")
    if not to_ca:
        return

    from .shift_registration_models import ShiftRegistration, ShiftRegistrationDay, ShiftRegistrationScopeConfig

    config = ShiftRegistrationScopeConfig.for_employee(event.employee)
    if not config:
        logger.warning(
            "[apply_shift_change_effect] Không tìm thấy cấu hình đăng ký ca làm áp dụng cho %s — bỏ qua.",
            event.employee.employee_id,
        )
        return

    registration = ShiftRegistration.objects.filter(
        employee=event.employee,
        week_start_date__lte=event.event_date,
        week_end_date__gte=event.event_date,
    ).first()
    if not registration:
        logger.warning(
            "[apply_shift_change_effect] Không tìm thấy ShiftRegistration cho %s ngày %s — "
            "bỏ qua (có thể NV đã bị đổi cấu hình phạm vi sau khi tạo đơn).",
            event.employee.employee_id, event.event_date,
        )
        return

    day_obj, _ = ShiftRegistrationDay.objects.get_or_create(registration=registration, date=event.event_date)
    day_obj.apply_ca(config, to_ca)
    day_obj.save()


def _create_approval_event(target_event, approver, level, action_type, note, now_str):
    """
    Tạo một EmployeeEvent loại REQUEST_APPROVAL để lưu lịch sử phê duyệt.
    """
    EmployeeEvent.objects.create(
        employee=target_event.employee,
        event_date=target_event.event_date,
        event_type=EmployeeEvent.EventType.REQUEST_APPROVAL,
        reference_event=target_event,
        created_by=approver,
        notes=note,
        data={
            "action": action_type,
            "level": level,
            "approver_name": approver.full_name,
            "approver_id": approver.id,
            "timestamp": now_str,
            "note": note,
            "registration_type": (target_event.data or {}).get("registration_type", ""),
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# VIEWSETS
# ─────────────────────────────────────────────────────────────────────────────


def _get_visible_q(employee, is_event=True):
    """
    Trả về đối tượng Q giới hạn dữ liệu mà nhân viên này được xem.
    is_event=True: dùng cho EmployeeEvent (lọc qua data__status)
    is_event=False: dùng cho OnlineWorkRequest (lọc qua status trực tiếp)
    """
    is_hr = _is_hr(employee)
    
    # Lấy danh sách nhân viên cấp dưới TRỰC TIẾP
    sub_ids = list(Employee.objects.filter(manager=employee).values_list('id', flat=True))
    
    if is_hr:
        # HR thấy: chính mình + cấp dưới + đã quản lý duyệt + đã xử lý xong
        if is_event:
            return (
                models.Q(employee_id=employee.id) |
                models.Q(employee_id__in=sub_ids) |
                models.Q(data__status__in=['APPROVED', 'REJECTED']) |
                models.Q(data__status='PENDING', data__direct_manager_approved=True)
            )
        else:
            return (
                models.Q(employee_id=employee.id) |
                models.Q(employee_id__in=sub_ids) |
                models.Q(status__in=['APPROVED', 'REJECTED']) |
                models.Q(status='PENDING', direct_manager_approved=True)
            )


    
    # Manager/Staff: self + subordinates
    return models.Q(employee_id=employee.id) | models.Q(employee_id__in=sub_ids)


# ─────────────────────────────────────────────────────────────────────────────
# REGISTRATION REQUEST VIEWSET  (backed by EmployeeEvent)
# ─────────────────────────────────────────────────────────────────────────────

from .finalization_lock_mixin import FinalizationLockMixin


class RegistrationRequestViewSet(FinalizationLockMixin, viewsets.ViewSet):
    """
    ViewSet cho registration requests lưu trực tiếp vào EmployeeEvent.

    Tạo đơn LIVE  → event_type = LIVESTREAM
    Tạo đơn OT/EXTRA_HOURS/NIGHT_SHIFT → event_type = OVERTIME
    Dữ liệu status và approval tracking được lưu trong EmployeeEvent.data (JSONField).
    """

    permission_classes = [IsAuthenticated]

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _base_qs(self):
        return (
            EmployeeEvent.objects
            .filter(event_type__in=REGISTRATION_EVENT_TYPES)
            .select_related(
                "employee",
                "employee__manager",
                "employee__department",
                "employee__department__manager",
            )
        )

    def _restrict_by_role(self, qs, request):
        """
        Giới hạn queryset theo vai trò.
        """
        if request.user.is_staff or request.user.is_superuser:
            return qs
            
        employee = self._get_approver(request)
        if not employee:
            return qs.none()
            
        return qs.filter(_get_visible_q(employee)).distinct()

    def _apply_filters(self, qs, request):
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(data__status=status_filter)

        employee_id = request.query_params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        event_type = request.query_params.get("event_type")
        if event_type:
            qs = qs.filter(event_type=event_type)

        # Date filtering (support start_date/end_date and month/year)
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        if start_date and end_date:
            qs = qs.filter(event_date__gte=start_date, event_date__lte=end_date)
        elif start_date:
            qs = qs.filter(event_date__gte=start_date)
        elif end_date:
            qs = qs.filter(event_date__lte=end_date)

        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            qs = qs.filter(event_date__year=year, event_date__month=month)

        # Ordering
        ordering = request.query_params.get("ordering", "-created_at")
        field = ordering.lstrip("-")
        valid_ordering_fields = {"created_at", "updated_at", "event_date"}
        if field in valid_ordering_fields:
            qs = qs.order_by(ordering)
        else:
            qs = qs.order_by("-created_at")

        return qs

    def _get_approver(self, request):
        try:
            return Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return None

    # ── Standard actions ──────────────────────────────────────────────────────

    def list(self, request):
        qs = self._restrict_by_role(self._base_qs(), request)
        qs = self._apply_filters(qs, request)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            return paginator.get_paginated_response(
                [serialize_registration_event(e) for e in page]
            )
        return Response([serialize_registration_event(e) for e in qs])

    def create(self, request):
        # --- Kiểm tra khóa chốt công ---
        # Đơn nghỉ không phép nhiều ngày (end_date != attendance_date): kiểm tra khóa
        # cho TỪNG ngày trong khoảng, tránh lọt trường hợp khoảng ngày vắt qua ranh
        # giới 1 tháng đã bị chốt công một phần.
        attendance_date = request.data.get('attendance_date')
        end_date = request.data.get('end_date')
        if attendance_date:
            from datetime import date as _date, timedelta as _timedelta
            try:
                d_start = _date.fromisoformat(str(attendance_date))
                d_end = _date.fromisoformat(str(end_date)) if end_date else d_start
                target_employee = None
                emp_id = request.data.get('employee_id')
                if emp_id:
                    target_employee = Employee.objects.filter(id=emp_id).first()

                cur = d_start
                # Check theo từng ngày (không chỉ theo tháng) vì khóa chốt công có thể
                # chỉ áp dụng cho 1 nửa tháng (period) — chặn số vòng lặp để tránh
                # khoảng ngày quá lớn (serializer sẽ validate đầy đủ hơn ở bước sau).
                cur_count = 0
                while cur <= d_end and cur_count <= 31:
                    lock_resp = self.assert_not_locked(
                        cur.year, cur.month, request, day=cur.day, allow_admin=True,
                        employee=target_employee,
                    )
                    if lock_resp:
                        return lock_resp
                    cur += _timedelta(days=1)
                    cur_count += 1
            except (ValueError, TypeError):
                pass

        serializer = RegistrationRequestCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        result = serializer.save(created_by=self._get_approver(request))

        # Đơn nghỉ không phép nhiều ngày trả về {"created": [...], "skipped_dates": [...]}
        # thay vì 1 EmployeeEvent duy nhất — chỉ xảy ra khi frontend chủ động gửi end_date.
        if isinstance(result, dict) and "created" in result:
            return Response(
                {
                    "results": [serialize_registration_event(e) for e in result["created"]],
                    "skipped_dates": result.get("skipped_dates", []),
                },
                status=status.HTTP_201_CREATED,
            )

        return Response(
            serialize_registration_event(result),
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        event = get_object_or_404(self._base_qs(), pk=pk)
        return Response(serialize_registration_event(event))

    def _can_edit_or_delete(self, event, approver, request):
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        is_management = (
            (approver.position.is_management if approver.position else False) or
            approver.managed_departments.exists() or
            approver.subordinates.exists()
        )
        is_owner = event.employee_id == approver.id
        is_privileged = is_admin or is_hr_user or has_perm or is_management
        return is_owner, is_privileged

    def update(self, request, pk=None):
        """Chủ đơn sửa lý do/số giờ khi đơn còn PENDING/DRAFT, chưa ai duyệt,
        và chưa quá hạn tạo/duyệt đơn loại này (yêu cầu HCNS 2026-09-17: edit
        cũng phải theo đúng hạn tạo đơn — tái dùng nguyên _check_approve_
        deadline(), vốn dùng công thức hạn giống hệt lúc tạo đơn, tự bỏ qua
        nếu HCNS đã "mở khoá" cho đúng NV/ngày/loại này). Admin/HR/Quản lý sửa
        được bất kỳ lúc nào, không bị chặn bởi trạng thái duyệt hay hạn — sửa
        lại 2026-09-21 (yêu cầu HCNS "cho QLTT có quyền sửa các đơn..."): trước
        đây check status bên dưới áp dụng cho CẢ is_privileged, chặn nhầm cả
        Admin/HR/Quản lý dù docstring này đã ghi rõ họ được sửa bất kỳ lúc nào."""
        event = get_object_or_404(self._base_qs(), pk=pk)
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_owner, is_privileged = self._can_edit_or_delete(event, approver, request)
        if not (is_owner or is_privileged):
            return Response({"error": "Bạn không có quyền sửa đơn này"}, status=status.HTTP_403_FORBIDDEN)

        d = dict(event.data or {})
        if not is_privileged and d.get("status") not in ("DRAFT", "PENDING"):
            return Response(
                {"error": "Chỉ có thể cập nhật đơn ở trạng thái DRAFT hoặc PENDING"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_owner and not is_privileged:
            if d.get("direct_manager_approved") or d.get("hr_approved"):
                return Response(
                    {"error": "Không thể sửa đơn đã có người phê duyệt"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            deadline_error = _check_approve_deadline(event, bypass=False)
            if deadline_error:
                return Response({"error": deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        # QLTT sửa GIỜ của đơn tăng ca Tại Viện/VP: chỉ được trong hạn 10h sáng
        # ngày hôm sau (Chủ nhật tới hết ngày) — yêu cầu HCNS 2026-09-23, vì
        # ngày hôm sau chưa có data máy chấm công để đối soát nên QLTT phải tự
        # review và sửa giờ cho nhân viên ngay trong tab "Chờ duyệt", không chờ
        # tới đợt đối soát cuối tháng. HCNS/Admin/người có quyền duyệt chấm
        # công KHÔNG bị chặn (toàn quyền như cũ), và chỉ chặn khi thực sự sửa
        # giờ/số giờ — sửa mỗi lý do thì không liên quan.
        editing_times = any(f in request.data for f in ("hours", "start_time", "end_time"))
        is_plain_manager = is_privileged and not (
            request.user.is_staff or request.user.is_superuser
            or _is_hr(approver) or _has_approve_permission(approver)
        )
        if editing_times and is_plain_manager and d.get("registration_type") == "OVERTIME" \
                and d.get("ot_type") == "ONSITE":
            from .deadline_utils import manager_attendance_fix_deadline
            fix_deadline = manager_attendance_fix_deadline(event.event_date)
            if timezone.now() > fix_deadline:
                return Response(
                    {"error": f"Đã quá hạn sửa giờ đơn tăng ca này "
                              f"(hạn: {fix_deadline.strftime('%H:%M %d/%m/%Y')}) — liên hệ HCNS."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        updatable = ["reason", "hours", "sessions"]
        old_values = {f: d.get(f) for f in updatable}
        changed_fields = [f for f in updatable if f in request.data and request.data[f] != d.get(f)]

        # LƯU Ý (sửa 2026-09-23): start_time/end_time TRƯỚC ĐÂY không nằm trong
        # `updatable` nên không bao giờ lọt vào `changed_fields`. Hệ quả: sửa
        # MỖI giờ vào/ra (đúng những gì nút "Sửa giờ" ở trang Phê duyệt gửi lên)
        # thì (1) không ghi audit log, và (2) không kích hoạt
        # reset_approval_for_privileged_edit -> QLTT sửa đơn ĐÃ DUYỆT mà HCNS
        # không phải duyệt lại. Nay theo dõi cả 2 field này.
        # So sánh theo datetime.time ĐÃ CHUẨN HOÁ chứ không so chuỗi thô: FE gửi
        # "18:00" trong khi event.check_in.isoformat() ra "18:00:00" -> so chuỗi
        # thì lần nào cũng "khác nhau", audit log ghi thừa 1 dòng "Giờ bắt đầu
        # 18:00 -> 18:00" dù người dùng chỉ sửa giờ kết thúc (HCNS báo
        # 2026-09-23). Giữ old_values dạng chuỗi HH:MM:SS để FE hiển thị như cũ.
        old_start = event.check_in.isoformat() if event.check_in else None
        old_end = event.check_out.isoformat() if event.check_out else None
        if "start_time" in request.data and _dt_time_from_str(request.data["start_time"]) != _dt_time_from_str(old_start):
            changed_fields.append("start_time")
            old_values["start_time"] = old_start
        if "end_time" in request.data and _dt_time_from_str(request.data["end_time"]) != _dt_time_from_str(old_end):
            changed_fields.append("end_time")
            old_values["end_time"] = old_end

        for field in updatable:
            if field in request.data:
                d[field] = request.data[field]
        if "reason" in request.data:
            event.notes = request.data["reason"]
        if "hours" in request.data and request.data["hours"] is not None:
            event.overtime_hours = request.data["hours"]
        if "start_time" in request.data:
            event.check_in = request.data["start_time"] or None
            # Ghi cả vào data để audit log (record_request_edit lấy giá trị MỚI
            # bằng d.get(field)) không bị rỗng. API vẫn đọc giờ từ
            # event.check_in/check_out (serialize_registration_event) nên thêm
            # key ở đây không đổi dữ liệu trả ra.
            d["start_time"] = request.data["start_time"] or None
        if "end_time" in request.data:
            event.check_out = request.data["end_time"] or None
            d["end_time"] = request.data["end_time"] or None

        # Đổi giờ mà KHÔNG gửi kèm `hours` -> tính lại số giờ cho khớp, nếu
        # không thì giờ vào/ra mới nhưng số giờ (dùng để tính lương) vẫn là số
        # cũ. Dùng đúng công thức lúc tạo đơn (compute_overtime_hours).
        # Áp dụng cho MỌI loại đơn tính theo giờ (HOURS_BASED_TYPES =
        # OVERTIME + EXTRA_HOURS), không riêng OVERTIME — trước 2026-09-23 chỉ
        # có OVERTIME nên sửa giờ đơn "Làm thêm giờ" sẽ để lại số giờ cũ. Các
        # loại tính theo BUỔI (Live/Trực tối/Ra trực) không có số giờ để tính lại.
        from .registration_serializers import HOURS_BASED_TYPES
        if (("start_time" in request.data or "end_time" in request.data)
                and request.data.get("hours") in (None, "")
                and (d.get("registration_type") or "").upper() in HOURS_BASED_TYPES):
            from .overtime_reconciliation import compute_overtime_hours
            new_in = _dt_time_from_str(event.check_in)
            new_out = _dt_time_from_str(event.check_out)
            if new_in and new_out:
                recomputed = compute_overtime_hours(new_in, new_out)
                if float(d.get("hours") or 0) != recomputed:
                    old_values.setdefault("hours", d.get("hours"))
                    if "hours" not in changed_fields:
                        changed_fields.append("hours")
                d["hours"] = recomputed
                event.overtime_hours = recomputed

        # Sàn 30 phút cho đơn TĂNG CA, kiểm tra lại sau khi đã chốt số giờ mới
        # — cùng luật với lúc tạo đơn (registration_serializers.py). Nếu chỉ
        # chặn ở lúc tạo thì vẫn lách được bằng cách tạo đơn 30 phút rồi sửa
        # xuống 20 phút. Áp dụng cho cả Online lẫn Offline (HCNS chốt
        # 2026-09-23, Thông báo HCNS "Dưới 30 phút không tính OT").
        if (d.get("registration_type") or "").upper() == "OVERTIME":
            from .overtime_reconciliation import OT_MIN_DURATION_MINUTES
            new_hours = d.get("hours")
            if new_hours is not None and float(new_hours) * 60 < OT_MIN_DURATION_MINUTES:
                return Response(
                    {"error": f"Tăng ca tối thiểu {OT_MIN_DURATION_MINUTES} phút mới được tính — "
                              f"giờ vừa nhập chỉ còn {round(float(new_hours) * 60)} phút. "
                              f"Nếu thực tế làm dưới {OT_MIN_DURATION_MINUTES} phút thì huỷ đơn "
                              f"thay vì sửa giờ."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if changed_fields:
            # QLTT sửa đơn ĐÃ DUYỆT -> quay lại chờ HCNS duyệt lại (yêu cầu
            # HCNS 2026-09-21) — Admin/HR/has_perm tự sửa thì không cần.
            is_admin_flag = request.user.is_staff or request.user.is_superuser
            is_hr_flag = _is_hr(approver)
            has_perm_flag = _has_approve_permission(approver)
            is_management_flag = bool(
                (approver.position.is_management if approver.position else False) or
                approver.managed_departments.exists() or
                approver.subordinates.exists()
            )
            was_reset = reset_approval_for_privileged_edit(
                d, approver, is_admin=is_admin_flag, is_hr_user=is_hr_flag,
                has_perm=has_perm_flag, is_management=is_management_flag,
            )
            d = record_request_edit(d, approver, changed_fields, old_values)
            if was_reset:
                d["edit_history"][-1]["reset_to_pending"] = True
        event.data = d
        event.save()
        return Response(serialize_registration_event(event))

    def partial_update(self, request, pk=None):
        return self.update(request, pk=pk)

    def _cancel_single_event(self, event, approver, is_owner, is_privileged, reason):
        """
        Thực hiện huỷ 1 EmployeeEvent (soft-delete qua soft_cancel_request()).
        Trả về None nếu huỷ thành công, hoặc error message (str) nếu bị chặn
        — dùng chung cho cancel() (1 đơn) và cancel_group() (nhóm nhiều ngày
        cùng request_code).

        - Chủ đơn: chỉ huỷ được khi đơn còn PENDING, CHƯA được quản lý trực
          tiếp duyệt bước nào (data['direct_manager_approved'] chưa True),
          VÀ chưa quá hạn tạo/duyệt đơn loại này (xem _check_approve_deadline()
          — tự bỏ qua nếu HCNS đã mở khoá) — quá 1 trong 2 điều kiện thì
          không tự huỷ được nữa, phải liên hệ HCNS.
        - Admin/HR/quản lý: huỷ được ở BẤT KỲ trạng thái nào (kể cả đã
          APPROVED — thay cho việc xoá cứng trước đây để xử lý duyệt nhầm),
          không bị chặn bởi hạn tạo/duyệt.
        - RIÊNG đơn Nghỉ phép tháng / Nghỉ không phép (LEAVE_LIKE_REQUEST_TYPES),
          từ cơ chế phạt 500k của HCNS (10/2026), hai gạch đầu dòng trên KHÔNG
          áp dụng cho quản lý nữa:
            * quản lý (không phải HCNS/Admin, không phải chủ đơn) KHÔNG còn
              huỷ được — tránh việc huỷ đơn để chuyển lỗi duyệt muộn của mình
              sang thành lỗi "nghỉ không tạo đơn" của nhân viên;
            * chủ đơn chỉ huỷ được khi quản lý CHƯA duyệt và CÒN trong hạn;
              "Mở khoá đặc biệt" KHÔNG còn giúp chủ đơn huỷ đơn đã duyệt nữa
              (HCNS 2026-10-10: "Đơn đã duyệt sẽ ko được sửa/xóa");
            * HCNS/Admin là cửa duy nhất còn lại — huỷ được mọi trạng thái, kể
              cả đã quá hạn, nhưng BẮT BUỘC nhập lý do và mọi lần huỷ đều vào
              EmployeeEventAuditLog ("muốn cancel hay edit gì thì bảo HCNS xử
              lí cho").
        - HCNS đã mở khoá cho đúng NV/ngày này ở trang Quản lý đơn — HOẶC
          đúng loại đơn này (OVERTIME/ONLINE_WORK/LEAVE/UNAUTHORIZED_ABSENCE:
          mở khoá loại nào thì được huỷ/sửa loại đó luôn, không cần mở thêm
          lần nữa) HOẶC loại dự phòng "Huỷ/Sửa đơn đã duyệt"
          (CANCEL_EDIT_REQUEST_TYPE, dùng khi đơn không thuộc 4 loại trên):
          CHỦ ĐƠN (chỉ chủ đơn, không mở rộng cho người khác) CŨNG được
          bypass y hệt Admin/HR/quản lý — cho cả bước "đã duyệt" lẫn hạn tạo/
          duyệt (_check_approve_deadline tự kiểm tra lại grant này). Lưu ý:
          has_owner_grant KHÔNG được gộp vào is_privileged dùng để xét quyền
          sở hữu (is_owner) ở trên — nếu không, 1 grant cấp cho nhân viên A
          sẽ vô tình cho phép BẤT KỲ ai khác cũng huỷ được đơn của A, không
          riêng gì chính A.
        """
        from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
        from .models import LEAVE_LIKE_REQUEST_TYPES, _is_hr_or_admin_strict
        d_for_grant = event.data or {}
        has_owner_grant = is_owner and (
            has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
            or has_deadline_exception(
                event.employee, event.event_date, d_for_grant.get("registration_type")
            )
        )

        # ── Đơn nghỉ phép / nghỉ không phép: quyền huỷ bị siết (HCNS 10/2026) ──
        # Quản lý KHÔNG còn được coi là "privileged" với 2 loại đơn này. Lý do:
        # dưới cơ chế phạt 500k, quản lý duyệt muộn chỉ cần huỷ đơn là biến lỗi
        # "Duyệt đơn quá hạn" của mình thành "Nghỉ không tạo đơn" của nhân viên
        # (báo cáo đối soát coi ngày có đơn CANCELLED là ngày không có đơn —
        # xem violation_report_views._from_absent_days). HCNS chốt
        # 2026-10-09: "thu hồi quyền xoá đơn của quản lý".
        is_leave_like = d_for_grant.get("registration_type") in LEAVE_LIKE_REQUEST_TYPES
        if is_leave_like:
            is_privileged = _is_hr_or_admin_strict(approver)
            if not is_owner and not is_privileged:
                return ("Quản lý không còn quyền huỷ đơn nghỉ phép / nghỉ không phép. "
                        "Liên hệ HCNS nếu cần huỷ đơn này.")
            # Mở khoá KHÔNG còn giúp chủ đơn tự huỷ đơn đã duyệt nữa — HCNS
            # chốt 2026-10-10: "muốn cancel hay edit gì thì bảo HCNS xử lí cho.
            # Đơn đã duyệt sẽ ko được sửa/xóa". Trước đây mở khoá loại nào thì
            # chủ đơn được huỷ/sửa loại đó, chính là đường đang bị dùng nhiều
            # nhất và cũng là đường làm dòng vi phạm biến mất khỏi báo cáo.
            has_owner_grant = False
            # HCNS/Admin là cửa duy nhất còn lại, nên PHẢI nêu lý do — mọi lần
            # huỷ đều vào EmployeeEventAuditLog kèm người huỷ và lý do.
            if is_privileged and not str(reason or "").strip():
                return "HCNS phải nhập lý do khi huỷ đơn nghỉ phép / nghỉ không phép."

        effective_bypass = is_privileged or has_owner_grant

        d = dict(event.data or {})
        # Admin/HR/quản lý: huỷ được ở bất kỳ trạng thái nào (thay cho xoá
        # cứng trước đây) — chỉ chủ đơn mới bị giới hạn "còn PENDING".
        if not is_privileged and d.get("status") != "PENDING":
            return "Chỉ có thể huỷ đơn đang ở trạng thái chờ duyệt."
        if d.get("direct_manager_approved") and not effective_bypass:
            return ("Đơn đã được quản lý trực tiếp duyệt, không thể tự huỷ nữa. "
                     "Liên hệ HCNS nếu cần huỷ.")
        # Quá hạn duyệt thì KHÔNG AI huỷ được nữa, kể cả HCNS — HCNS chốt
        # 2026-10-09: "ko được phép xóa đơn nếu đã quá hạn duyệt". Sau mốc đó vi
        # phạm đã chốt, huỷ đơn là xoá bằng chứng của bảng đối soát phạt.
        # Cửa thoát hợp lệ: HCNS cấp "Mở khoá đặc biệt" cho đúng NV/ngày —
        # _check_approve_deadline() tự trả None khi có grant, nên không cần
        # kiểm tra grant lần nữa ở đây, và mọi lần mở khoá đều có người chịu
        # trách nhiệm trong DeadlineExceptionGrant.granted_by.
        if is_leave_like and not is_privileged:
            # Quá hạn duyệt thì chủ đơn hết tự huỷ được. HCNS KHÔNG bị chặn ở
            # đây nữa (HCNS 2026-10-10: "bảo HCNS xử lí cho") — nếu chặn cả
            # HCNS thì không còn ai sửa được đơn duyệt nhầm.
            over = _check_approve_deadline(event, bypass=False)
            if over:
                return ("Đã quá hạn duyệt nên bạn không tự huỷ được đơn này. "
                        f"Liên hệ HCNS để được xử lý. ({over})")
        elif is_owner and not is_privileged:
            deadline_error = _check_approve_deadline(event, bypass=False)
            if deadline_error:
                return deadline_error

        old_snapshot = dict(d)
        d = soft_cancel_request(d, approver, reason=reason)
        event.data = d
        event.save(update_fields=["data", "updated_at"])
        log_request_cancel(event, approver, old_snapshot, reason=reason)
        return None

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Huỷ 1 đơn — xem docstring đầy đủ ở _cancel_single_event(). Đây là
        CƠ CHẾ DUY NHẤT để bỏ 1 đơn (không còn xoá cứng — yêu cầu HCNS
        2026-09-17: "bỏ hẳn phần xoá destroy() đi, chỉ giữ lại phần cancel").
        Với đơn Nghỉ không phép nhiều ngày (nhiều EmployeeEvent cùng
        request_code), dùng cancel_group() để huỷ cả nhóm 1 lần thay vì gọi
        action này lặp lại cho từng ngày."""
        event = get_object_or_404(self._base_qs(), pk=pk)

        approver = self._get_approver(request)
        if not approver:
            return Response(
                {"error": "Employee profile not found"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_owner, is_privileged = self._can_edit_or_delete(event, approver, request)

        if not is_owner and not is_privileged:
            return Response(
                {"error": "Bạn không có quyền huỷ đơn này"},
                status=status.HTTP_403_FORBIDDEN,
            )

        reason = request.data.get("reason") or request.query_params.get("reason")
        error = self._cancel_single_event(event, approver, is_owner, is_privileged, reason)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serialize_registration_event(event))

    @action(detail=False, methods=["post"])
    def cancel_group(self, request):
        """
        Huỷ CẢ NHÓM đơn Nghỉ không phép nhiều ngày liên tiếp (nhiều
        EmployeeEvent cùng data['request_code'] — xem
        RegistrationRequestCreateSerializer.create()). Mỗi ngày trong nhóm
        là 1 bản ghi riêng (để tái dùng nguyên vẹn logic tính công/duyệt
        theo-ngày hiện có) nên không thể huỷ cả đơn chỉ bằng 1 lần gọi
        cancel(pk) — action này huỷ TẤT CẢ các ngày còn đủ điều kiện
        (PENDING/chưa qua hạn) trong 1 lần, bỏ qua (skip) các ngày không đủ
        điều kiện và trả về rõ ràng ngày nào bị skip + lý do, thay vì huỷ
        nửa vời không báo (yêu cầu HCNS 2026-09-17: Sửa/Huỷ đơn nhiều ngày
        phải áp dụng cho cả nhóm).
        """
        request_code = request.data.get("request_code")
        if not request_code:
            return Response({"error": "Thiếu request_code"}, status=status.HTTP_400_BAD_REQUEST)

        events = list(
            self._base_qs().filter(data__request_code=request_code).order_by("event_date")
        )
        if not events:
            return Response({"error": "Không tìm thấy đơn"}, status=status.HTTP_404_NOT_FOUND)

        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        # Mọi bản ghi trong nhóm cùng 1 employee (chỉ khác event_date) nên
        # is_owner/is_privileged tính 1 lần trên bản ghi đầu tiên là đủ.
        is_owner, is_privileged = self._can_edit_or_delete(events[0], approver, request)
        if not is_owner and not is_privileged:
            return Response({"error": "Bạn không có quyền huỷ đơn này"}, status=status.HTTP_403_FORBIDDEN)

        reason = request.data.get("reason")
        cancelled_dates, skipped = [], []
        for event in events:
            error = self._cancel_single_event(event, approver, is_owner, is_privileged, reason)
            if error:
                skipped.append({"event_date": event.event_date.isoformat(), "reason": error})
            else:
                cancelled_dates.append(event.event_date.isoformat())

        if not cancelled_dates:
            return Response(
                {"error": "Không huỷ được ngày nào.", "skipped": skipped},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"cancelled_dates": cancelled_dates, "skipped": skipped})

    @action(detail=False, methods=["post"])
    def update_group(self, request):
        """
        Sửa lý do cho CẢ NHÓM đơn Nghỉ không phép nhiều ngày (cùng
        data['request_code']) — chỉ áp dụng field 'reason' (ngày/loại đơn
        của cả nhóm không đổi qua action này, muốn đổi ngày phải huỷ + tạo
        lại). Cùng điều kiện PENDING + hạn tạo/duyệt như update() từng đơn
        lẻ, áp dụng riêng cho từng ngày — ngày nào không đủ điều kiện thì bị
        skip (trả về rõ lý do) thay vì chặn sửa cả nhóm.
        """
        request_code = request.data.get("request_code")
        if not request_code:
            return Response({"error": "Thiếu request_code"}, status=status.HTTP_400_BAD_REQUEST)
        if "reason" not in request.data:
            return Response({"error": "Thiếu reason"}, status=status.HTTP_400_BAD_REQUEST)

        events = list(
            self._base_qs().filter(data__request_code=request_code).order_by("event_date")
        )
        if not events:
            return Response({"error": "Không tìm thấy đơn"}, status=status.HTTP_404_NOT_FOUND)

        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_owner, is_privileged = self._can_edit_or_delete(events[0], approver, request)
        if not (is_owner or is_privileged):
            return Response({"error": "Bạn không có quyền sửa đơn này"}, status=status.HTTP_403_FORBIDDEN)

        new_reason = request.data["reason"]
        updated_dates, skipped = [], []
        for event in events:
            d = dict(event.data or {})
            if d.get("status") not in ("DRAFT", "PENDING"):
                skipped.append({"event_date": event.event_date.isoformat(),
                                 "reason": "Đơn không còn ở trạng thái chờ duyệt"})
                continue
            if is_owner and not is_privileged:
                if d.get("direct_manager_approved") or d.get("hr_approved"):
                    skipped.append({"event_date": event.event_date.isoformat(),
                                     "reason": "Đơn đã có người phê duyệt"})
                    continue
                deadline_error = _check_approve_deadline(event, bypass=False)
                if deadline_error:
                    skipped.append({"event_date": event.event_date.isoformat(), "reason": deadline_error})
                    continue

            old_reason = d.get("reason")
            if new_reason != old_reason:
                d["reason"] = new_reason
                event.notes = new_reason
                d = record_request_edit(d, approver, ["reason"], {"reason": old_reason})
                event.data = d
                event.save(update_fields=["data", "notes", "updated_at"])
            updated_dates.append(event.event_date.isoformat())

        if not updated_dates:
            return Response(
                {"error": "Không sửa được ngày nào.", "skipped": skipped},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"updated_dates": updated_dates, "skipped": skipped})

    # ── Approve ───────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """
        Duyệt đơn đăng ký – 2 bước: quản lý trực tiếp → HR.
        Admin duyệt cả 2 bước ngay lập tức.
        """
        event = get_object_or_404(self._base_qs(), pk=pk)


        approval_note = request.data.get("approval_note", request.data.get("note", ""))

        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin      = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = event.employee.manager == approver
        is_hr_user    = _is_hr(approver)
        has_perm      = _has_approve_permission(approver)
        can_as_hr     = is_hr_user or has_perm
        
        # Senior Manager logic: HR can approve directly if creator is Senior Manager
        is_creator_senior_mgr = is_senior_manager(event.employee)

        if not (is_direct_mgr or can_as_hr or is_admin):
            return Response({"error": "Bạn không có quyền phê duyệt đơn này"}, status=status.HTTP_403_FORBIDDEN)

        off_duty_block_reason = _off_duty_approval_block_reason(event)
        if off_duty_block_reason:
            return Response({"error": off_duty_block_reason}, status=status.HTTP_400_BAD_REQUEST)

        # Khoá hạn duyệt theo quy định thời hạn tạo/duyệt đơn (xem deadline_utils.py
        # + validate() ở registration_serializers.py cho hạn tạo đơn tương
        # ứng) — Admin/HR luôn bỏ qua (cơ chế "HCNS mở cho trường hợp đặc
        # biệt"); quản lý trực tiếp (không phải Admin/HR) bị chặn nếu đã quá
        # hạn duyệt.
        approve_deadline_error = _check_approve_deadline(event, bypass=(is_admin or can_as_hr))
        if approve_deadline_error:
            return Response({"error": approve_deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        d = dict(event.data or {})
        now_str = timezone.now().isoformat()

        if is_admin:
            # Chỉ cập nhật step 1 nếu nó chưa được duyệt
            if not d.get("direct_manager_approved"):
                d.update({
                    "direct_manager_approved": True, 
                    "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                })
            # Step 2: HR/Admin duyệt
            d.update({
                "hr_approved": True, 
                "hr_approved_at": now_str, 
                "hr_approved_by_name": approver.full_name,
                "status": "APPROVED", 
                "approved_by_name": approver.full_name, 
                "approved_at": now_str,
            })

        elif is_creator_senior_mgr and can_as_hr and not event.employee.manager:
            d.update({
                "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                "direct_manager_approved_by_name": approver.full_name,
                "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
            })
        elif is_direct_mgr:
            d.update({
                "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                "direct_manager_approved_by_name": approver.full_name,
            })
            if _is_hr(event.employee):
                d.update({
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                    "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                })
        elif can_as_hr:
            if not d.get("direct_manager_approved") and not (is_creator_senior_mgr and not event.employee.manager):
                return Response({"error": "HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt"}, status=status.HTTP_403_FORBIDDEN)
            d.update({
                "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
            })

        if d.get("direct_manager_approved") and d.get("hr_approved") and d.get("status") != "APPROVED":
            d["status"] = "APPROVED"
            d["approved_by_name"] = approver.full_name
            d["approved_at"] = now_str

        if approval_note:
            d["approval_note"] = approval_note

        event.data = d
        event.save(update_fields=["data", "updated_at"])
        apply_shift_change_effect(event)
        return Response(serialize_registration_event(event))

    @action(detail=False, methods=["post"])
    def approve_group(self, request):
        """
        Duyệt CẢ NHÓM đơn Nghỉ không phép nhiều ngày liên tiếp (nhiều
        EmployeeEvent cùng data['request_code']) trong 1 lần — cùng lý do với
        cancel_group()/update_group(): mỗi ngày trong nhóm là 1 bản ghi
        riêng, nên approve() từng đơn (pk) CHỈ duyệt đúng 1 ngày được bấm,
        các ngày còn lại trong nhóm vẫn treo "chờ QLTT duyệt" dù QLTT đã bấm
        duyệt (báo thực tế 2026-09-24: NV00643 xin nghỉ 30/9-3/10, QLTT
        duyệt xong tưởng cả đơn đã xong nhưng 3 ngày sau vẫn PENDING).
        Logic từng bước duyệt y hệt approve() ở trên, chỉ khác là lặp qua
        TẤT CẢ các ngày cùng request_code — ngày nào không đủ điều kiện
        (không phải PENDING, quá hạn duyệt...) thì bị skip (trả về rõ lý
        do) thay vì duyệt nửa vời không báo.
        """
        request_code = request.data.get("request_code")
        if not request_code:
            return Response({"error": "Thiếu request_code"}, status=status.HTTP_400_BAD_REQUEST)

        events = list(
            self._base_qs().filter(data__request_code=request_code).order_by("event_date")
        )
        if not events:
            return Response({"error": "Không tìm thấy đơn"}, status=status.HTTP_404_NOT_FOUND)

        # Mọi bản ghi trong nhóm cùng 1 employee (chỉ khác event_date) nên
        # quyền hạn tính 1 lần trên bản ghi đầu tiên là đủ — giống cancel_group().
        first_event = events[0]
        if first_event.event_date:
            lock_resp = self.assert_not_locked(first_event.event_date.year, first_event.event_date.month, request, allow_admin=True, allow_hr=True)
            if lock_resp:
                return lock_resp

        approval_note = request.data.get("approval_note", request.data.get("note", ""))
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin      = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = first_event.employee.manager == approver
        is_hr_user    = _is_hr(approver)
        has_perm      = _has_approve_permission(approver)
        can_as_hr     = is_hr_user or has_perm
        is_creator_senior_mgr = is_senior_manager(first_event.employee)

        if not (is_direct_mgr or can_as_hr or is_admin):
            return Response({"error": "Bạn không có quyền phê duyệt đơn này"}, status=status.HTTP_403_FORBIDDEN)

        now_str = timezone.now().isoformat()
        approved_dates, skipped = [], []

        for event in events:
            off_duty_block_reason = _off_duty_approval_block_reason(event)
            if off_duty_block_reason:
                skipped.append({"event_date": event.event_date.isoformat(), "reason": off_duty_block_reason})
                continue

            approve_deadline_error = _check_approve_deadline(event, bypass=(is_admin or can_as_hr))
            if approve_deadline_error:
                skipped.append({"event_date": event.event_date.isoformat(), "reason": approve_deadline_error})
                continue

            d = dict(event.data or {})
            if d.get("status") != "PENDING":
                skipped.append({"event_date": event.event_date.isoformat(), "reason": f"Đơn đang ở trạng thái {d.get('status')}"})
                continue

            if is_admin:
                if not d.get("direct_manager_approved"):
                    d.update({
                        "direct_manager_approved": True,
                        "direct_manager_approved_at": now_str,
                        "direct_manager_approved_by_name": approver.full_name,
                    })
                d.update({
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                    "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                })
            elif is_creator_senior_mgr and can_as_hr and not first_event.employee.manager:
                d.update({
                    "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                    "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                })
            elif is_direct_mgr:
                d.update({
                    "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                })
                if _is_hr(first_event.employee):
                    d.update({
                        "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                        "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                    })
            elif can_as_hr:
                if not d.get("direct_manager_approved") and not (is_creator_senior_mgr and not first_event.employee.manager):
                    skipped.append({"event_date": event.event_date.isoformat(), "reason": "HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt"})
                    continue
                d.update({
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                })

            if d.get("direct_manager_approved") and d.get("hr_approved") and d.get("status") != "APPROVED":
                d["status"] = "APPROVED"
                d["approved_by_name"] = approver.full_name
                d["approved_at"] = now_str

            if approval_note:
                d["approval_note"] = approval_note

            event.data = d
            event.save(update_fields=["data", "updated_at"])
            apply_shift_change_effect(event)
            approved_dates.append(event.event_date.isoformat())

        if not approved_dates:
            # Gộp LÝ DO vào chính thông điệp lỗi: FE chỉ hiển thị `error`,
            # `skipped` bị bỏ qua nên người duyệt chỉ thấy "Không duyệt được
            # ngày nào." mà không biết vì sao (HCNS báo 2026-09-28 — quản lý
            # bấm duyệt, hiện popup cụt lủn rồi bế tắc).
            reasons = []
            for s_item in skipped:
                r = s_item.get("reason") or ""
                if r and r not in reasons:
                    reasons.append(r)
            detail = (" " + " ".join(reasons)) if reasons else ""
            return Response(
                {"error": f"Không duyệt được ngày nào.{detail}", "skipped": skipped},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"approved_dates": approved_dates, "skipped": skipped})

    @action(detail=False, methods=["post"])
    def bulk_approve(self, request):
        """Duyệt hàng loạt đơn đăng ký."""
        ids = request.data.get("ids", [])
        approval_note = request.data.get("approval_note", "Đã duyệt hàng loạt")

        if not ids:
            return Response({"error": "Danh sách ID không được để trống"}, status=status.HTTP_400_BAD_REQUEST)


        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin      = request.user.is_staff or request.user.is_superuser
        is_hr_user    = _is_hr(approver)
        has_perm      = _has_approve_permission(approver)
        can_as_hr     = is_hr_user or has_perm

        events = self._base_qs().filter(id__in=ids)
        results = []
        errors = []
        now_str = timezone.now().isoformat()
        
        for event in events:
            is_direct_mgr = event.employee.manager == approver
            is_creator_senior_mgr = is_senior_manager(event.employee)
            
            if not (is_direct_mgr or can_as_hr or is_admin):
                errors.append({"id": event.id, "error": "Bạn không có quyền phê duyệt đơn này"})
                continue
                
            d = dict(event.data or {})
            if d.get("status") != "PENDING":
                errors.append({"id": event.id, "error": f"Đơn đang ở trạng thái {d.get('status')}"})
                continue

            off_duty_block_reason = _off_duty_approval_block_reason(event)
            if off_duty_block_reason:
                errors.append({"id": event.id, "error": off_duty_block_reason})
                continue

            # Khoá hạn duyệt (Tăng ca/Nghỉ không phép/Livestream) — trước đây
            # "Duyệt hàng loạt" hoàn toàn không kiểm tra, khác hẳn nút duyệt
            # từng đơn (approve() ở trên có gọi _check_approve_deadline), nên
            # quản lý có thể lách hạn bằng cách tick chọn nhiều đơn rồi duyệt
            # hàng loạt thay vì duyệt từng đơn một.
            approve_deadline_error = _check_approve_deadline(event, bypass=(is_admin or can_as_hr))
            if approve_deadline_error:
                errors.append({"id": event.id, "error": approve_deadline_error})
                continue

            approved_any = False

            if is_admin:
                d.update({
                    "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                    "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                })
                approved_any = True
            elif is_creator_senior_mgr and can_as_hr and not event.employee.manager:
                d.update({
                    "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                    "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                })
                approved_any = True
            elif is_direct_mgr:
                d.update({
                    "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                })
                approved_any = True
                if _is_hr(event.employee):
                    d.update({
                        "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                        "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                    })
            elif can_as_hr:
                if not d.get("direct_manager_approved") and not (is_creator_senior_mgr and not event.employee.manager):
                    errors.append({"id": event.id, "error": "HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt"})
                    continue
                d.update({
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                })
                approved_any = True

            if approved_any:
                if d.get("direct_manager_approved") and d.get("hr_approved") and d.get("status") != "APPROVED":
                    d["status"] = "APPROVED"
                    d["approved_by_name"] = approver.full_name
                    d["approved_at"] = now_str
                
                if approval_note:
                    d["approval_note"] = approval_note
                    
                event.data = d
                event.save(update_fields=["data", "updated_at"])
                apply_shift_change_effect(event)

                # Audit trail
                lvl = "ADMIN" if is_admin else ("HR" if can_as_hr and (is_creator_senior_mgr or not is_direct_mgr) else "DIRECT_MANAGER")
                if is_direct_mgr and _is_hr(event.employee): lvl = "HR"
                _create_approval_event(event, approver, lvl, "APPROVE", (approval_note or "Duyệt hàng loạt"), now_str)

                results.append(event.id)
            
        return Response({
            "success_count": len(results), "error_count": len(errors),
            "results": results, "errors": errors
        })

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """Từ chối đơn đăng ký."""
        event = get_object_or_404(self._base_qs(), pk=pk)


        approval_note = request.data.get("approval_note", request.data.get("note", ""))

        approver = self._get_approver(request)
        if not approver:
            return Response(
                {"error": "Employee profile not found"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_admin      = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = event.employee.manager == approver
        is_hr_user    = _is_hr(approver)
        has_perm      = _has_approve_permission(approver)

        if not (is_direct_mgr or is_hr_user or has_perm or is_admin):
            return Response(
                {"error": "Bạn không có quyền từ chối đơn này"},
                status=status.HTTP_403_FORBIDDEN,
            )

        d = dict(event.data or {})
        now_str = timezone.now().isoformat()
        d.update({
            "status":          "REJECTED",
            "approved_by_name": approver.full_name,
            "approved_at":      now_str,
        })
        if approval_note:
            d["approval_note"] = approval_note

        event.data = d
        event.save(update_fields=["data", "updated_at"])

        lvl = "ADMIN" if is_admin else ("HR" if is_hr_user or has_perm else "DIRECT_MANAGER")
        _create_approval_event(event, approver, lvl, "REJECT", approval_note, now_str)

        return Response(serialize_registration_event(event))

    @action(detail=False, methods=["post"])
    def reject_group(self, request):
        """Từ chối CẢ NHÓM đơn Nghỉ không phép nhiều ngày (cùng
        data['request_code']) — xem approve_group() ở trên cho lý do cần
        action riêng cho nhóm nhiều ngày thay vì reject() từng đơn."""
        request_code = request.data.get("request_code")
        if not request_code:
            return Response({"error": "Thiếu request_code"}, status=status.HTTP_400_BAD_REQUEST)

        events = list(
            self._base_qs().filter(data__request_code=request_code).order_by("event_date")
        )
        if not events:
            return Response({"error": "Không tìm thấy đơn"}, status=status.HTTP_404_NOT_FOUND)

        first_event = events[0]
        approval_note = request.data.get("approval_note", request.data.get("note", ""))
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin      = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = first_event.employee.manager == approver
        is_hr_user    = _is_hr(approver)
        has_perm      = _has_approve_permission(approver)

        if not (is_direct_mgr or is_hr_user or has_perm or is_admin):
            return Response({"error": "Bạn không có quyền từ chối đơn này"}, status=status.HTTP_403_FORBIDDEN)

        now_str = timezone.now().isoformat()
        rejected_dates, skipped = [], []
        lvl = "ADMIN" if is_admin else ("HR" if is_hr_user or has_perm else "DIRECT_MANAGER")

        for event in events:
            d = dict(event.data or {})
            if d.get("status") != "PENDING":
                skipped.append({"event_date": event.event_date.isoformat(), "reason": f"Đơn đang ở trạng thái {d.get('status')}"})
                continue

            d.update({
                "status":          "REJECTED",
                "approved_by_name": approver.full_name,
                "approved_at":      now_str,
            })
            if approval_note:
                d["approval_note"] = approval_note

            event.data = d
            event.save(update_fields=["data", "updated_at"])
            _create_approval_event(event, approver, lvl, "REJECT", approval_note, now_str)
            rejected_dates.append(event.event_date.isoformat())

        if not rejected_dates:
            return Response(
                {"error": "Không từ chối được ngày nào.", "skipped": skipped},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"rejected_dates": rejected_dates, "skipped": skipped})

    @action(detail=False, methods=["get"], url_path="overtime-reconciliation")
    def overtime_reconciliation(self, request):
        """
        Đối chiếu tăng ca — nằm dưới Đơn từ & Phê duyệt > Phê duyệt > "Đối
        chiếu tăng ca", theo yêu cầu HCNS 2026-09-18. Mặc định HR/Admin xem
        toàn công ty; từ 2026-09-22 QUẢN LÝ TRỰC TIẾP (is_management) cũng
        xem được, nhưng CHỈ đúng phạm vi cấp dưới trực tiếp của mình (để tự
        phát hiện + sửa đơn 'excess' của nhân viên mình trong hạn, xem
        reconciliation_action()) — không xem được của phòng ban/quản lý khác.

        GET params:
            month, year   – mặc định tháng hiện tại (tính theo timezone.localdate()).
            tab           – 'pending' (chưa duyệt, mặc định) hoặc 'done' (đã duyệt/tự khớp).
            page, page_size – phân trang chuẩn (StandardResultsSetPagination).

        Trả về {"summary": {tab: count}, "tab": <tab đang xem>, kèm phân trang
        results} — mỗi dòng kết quả là 1 đơn tăng ca ONSITE kèm state đối
        soát hiện tại. Đơn giản hoá 2026-09-18 theo yêu cầu HCNS ("focus vào
        việc duyệt và chưa duyệt hơn"): chỉ query ONSITE (Online không cần
        đối soát nên bỏ khỏi màn này), chỉ 2 tab pending/done.
        """
        from .overtime_reconciliation import TAB_ORDER, TAB_PENDING, classify_tab, ensure_reconciled

        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        # Chỉ HCNS/Admin (HCNS chốt 2026-09-23: "giờ chỉ hcns mới có thể đối
        # chiếu thôi"). Trước đó quản lý trực tiếp cũng xem được đúng phạm vi
        # cấp dưới của mình — nay bỏ: đối chiếu với máy chấm công là việc cuối
        # tháng của HCNS, còn QLTT sửa giờ hằng ngày qua trang Phê duyệt.
        if not (is_admin or is_hr_user):
            return Response(
                {"error": "Chỉ HCNS mới xem được đối chiếu tăng ca"},
                status=status.HTTP_403_FORBIDDEN,
            )

        today = timezone.localdate()
        try:
            year = int(request.query_params.get("year") or today.year)
            month = int(request.query_params.get("month") or today.month)
        except (TypeError, ValueError):
            return Response({"error": "month/year không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)

        tab = request.query_params.get("tab") or TAB_PENDING
        if tab not in TAB_ORDER:
            return Response({"error": f"tab không hợp lệ, phải là 1 trong {TAB_ORDER}"}, status=status.HTTP_400_BAD_REQUEST)

        # Chỉ hiển thị chi tiết đối soát từ 9/2026 trở đi:
        # - Trước 8/2026: chưa có khái niệm Online/Tại Viện-VP để so sánh
        #   (theo đúng yêu cầu HCNS: "Trước tháng 8 thì đẩy hết về tại viện/vp").
        # - Riêng 8/2026: HCNS đã tự đối soát và xử lý thủ công xong hết (qua
        #   báo cáo Excel) TRƯỚC KHI tính năng này tồn tại — theo yêu cầu
        #   2026-09-18 "data tháng 8 cũng đã duyệt hết rồi, ẩn đi giống tháng 7"
        #   — không cần màn này nhắc lại nữa.
        if (year, month) < (2026, 9):
            paginator = StandardResultsSetPagination()
            page = paginator.paginate_queryset([], request)
            response = paginator.get_paginated_response([])
            response.data["summary"] = {t: 0 for t in TAB_ORDER}
            response.data["tab"] = tab
            response.data["month"] = month
            response.data["year"] = year
            response.data["policy_note"] = (
                "Tháng này không hiển thị đối soát chi tiết — trước 8/2026 chưa áp dụng phân loại "
                "Online/Tại Viện-VP; riêng 8/2026 HCNS đã đối soát và xử lý thủ công xong."
            )
            return response

        def _base_qs():
            # Hàm trả về queryset MỚI mỗi lần gọi (không dùng lại 1 biến
            # QuerySet đã evaluate) — QuerySet của Django cache kết quả sau
            # lần đầu list(), nếu dùng lại cùng 1 biến thì lần đọc sau
            # ensure_reconciled() sẽ trả data['reconciliation'] CŨ (stale)
            # dù DB đã được ghi giá trị mới.
            qs = (
                EmployeeEvent.objects
                .filter(
                    event_type=EmployeeEvent.EventType.OVERTIME,
                    event_date__year=year,
                    event_date__month=month,
                    # CANCELLED: đơn bị hệ thống tự huỷ vì tăng ca thực tế dưới
                    # 30 phút (status đối soát 'cancelled_too_short') — vẫn phải
                    # hiện ở màn này để HCNS biết và khôi phục được nếu huỷ nhầm.
                    data__status__in=["APPROVED", "REJECTED", "CANCELLED"],
                    data__ot_type="ONSITE",
                )
                .exclude(data__registration_type="BUSINESS_TRIP")
                .select_related("employee", "employee__department")
                .order_by("-event_date", "employee__full_name")
            )
            return qs

        # Tự vá các đơn ONSITE trong tháng chưa từng được đối soát lần nào
        # (vd tháng hiện tại chưa upload chấm công lần nào, hoặc dữ liệu cũ
        # trước khi tính năng này tồn tại) — không cần chạy script riêng.
        # reconcile_onsite_overtime tự truy vấn lại theo (employee, date) nên
        # phải re-fetch bằng queryset MỚI sau đó mới lấy được data mới nhất.
        ensure_reconciled(list(_base_qs()))
        rows = list(_base_qs())

        summary = {t: 0 for t in TAB_ORDER}
        tab_rows = []
        for ot in rows:
            bucket = classify_tab(ot.data)
            summary[bucket] += 1
            if bucket == tab:
                tab_rows.append(ot)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(tab_rows, request)
        results = [
            {
                "event_id": ot.id,
                "employee_id": ot.employee_id,
                "employee_code": ot.employee.employee_id,
                "employee_name": ot.employee.full_name,
                "department_name": getattr(ot.employee.department, "name", None),
                "date": ot.event_date.isoformat(),
                "request_code": (ot.data or {}).get("request_code", ""),
                "reason": (ot.data or {}).get("reason", ""),
                "registered_check_in": ot.check_in.isoformat() if ot.check_in else None,
                "registered_check_out": ot.check_out.isoformat() if ot.check_out else None,
                "overtime_hours": float(ot.overtime_hours) if ot.overtime_hours is not None else None,
                "ot_type": (ot.data or {}).get("ot_type", ""),
                "reconciliation": (ot.data or {}).get("reconciliation"),
                "status": (ot.data or {}).get("status", "APPROVED"),
                # Chỉ có ý nghĩa khi status=REJECTED (tab 'rejected') — reject()
                # lưu tên người từ chối vào field dùng chung approved_by_name.
                "rejected_by_name": (ot.data or {}).get("approved_by_name") if (ot.data or {}).get("status") == "REJECTED" else None,
                "rejected_at": (ot.data or {}).get("approved_at") if (ot.data or {}).get("status") == "REJECTED" else None,
                "rejection_note": (ot.data or {}).get("approval_note", "") if (ot.data or {}).get("status") == "REJECTED" else "",
            }
            for ot in page
        ]
        response = paginator.get_paginated_response(results)
        response.data["summary"] = summary
        response.data["tab"] = tab
        response.data["month"] = month
        response.data["year"] = year
        return response

    @action(detail=True, methods=["post"], url_path="reconciliation-action")
    def reconciliation_action(self, request, pk=None):
        """
        Xử lý 1 đơn tăng ca ở màn Đối chiếu tăng ca — mặc định chỉ HR/Admin,
        RIÊNG status 'excess' (thực tế nhiều giờ hơn đăng ký) còn cho phép
        QUẢN LÝ TRỰC TIẾP của nhân viên đó tự sửa (action=manual_fix), trong
        hạn 10h sáng ngày lịch kế tiếp — theo yêu cầu Sếp 2026-09-22. Để "Từ
        chối" dùng lại thẳng action reject() có sẵn ở trên (đổi status đơn ->
        REJECTED) — không lặp lại ở đây.

        POST body: {"action": "accept" | "auto_fix" | "manual_fix",
                     "note": str (tuỳ chọn),
                     "check_in": "HH:MM" (chỉ dùng cho manual_fix, tuỳ chọn — mặc định giữ nguyên giờ đã đăng ký),
                     "check_out": "HH:MM" (BẮT BUỘC cho manual_fix)}

        - accept:     xác nhận đã xem, KHÔNG sửa giờ/số giờ tăng ca — chỉ đánh
                       dấu đã xử lý để không còn hiện ở tab cần xử lý nữa dù
                       tháng sau đối soát lại (xem _carry_over_hr_decision).
                       Chỉ HR/Admin mới gọi được (QLTT không có action này).
        - auto_fix:   chỉ cho phép với đơn có status đối soát
                       'missing_checkin_note' (có giờ ra thực tế rõ ràng để
                       tự áp dụng) — set check_out = giờ ra thực tế đã phát
                       hiện, GIỮ NGUYÊN giờ vào đã đăng ký, tính lại số giờ
                       tăng ca. ('shortfall' cũ giờ TỰ ĐỘNG áp dụng ngay lúc
                       đối soát, xem overtime_reconciliation.py, không còn
                       cần Sửa auto ở đây nữa.) Chỉ HR/Admin.
        - manual_fix: nhập giờ ra (bắt buộc) và có thể sửa cả giờ vào —
                       HR/Admin dùng được cho MỌI trạng thái đối soát (kể cả
                       'cancelled_too_short' — hệ thống tự huỷ đơn vì OT thực
                       tế dưới 30 phút; HCNS sửa tay ở đây là cách khôi phục
                       lại nếu huỷ nhầm); QLTT TRỰC TIẾP của nhân viên CHỈ
                       được dùng cho status 'excess', trong hạn
                       manager_fix_deadline của note — khi đó đơn tự chuyển về
                       PENDING (chờ HCNS duyệt lại mới ghi nhận chính thức,
                       giữ nguyên direct_manager_approved vì chính họ vừa sửa).
        """
        from .overtime_reconciliation import compute_overtime_hours
        import datetime as _dt

        event = get_object_or_404(
            EmployeeEvent.objects.select_related("employee"),
            pk=pk, event_type=EmployeeEvent.EventType.OVERTIME,
        )
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        is_privileged_hr = is_admin or is_hr_user

        d = dict(event.data or {})
        note = dict(d.get("reconciliation") or {})
        recon_status = note.get("status")

        # Chỉ HCNS/Admin (HCNS chốt 2026-09-23: "giờ chỉ hcns mới có thể đối
        # chiếu thôi"). Trước đó QLTT trực tiếp được sửa tay đơn 'excess' ngay
        # trên màn đối chiếu trong hạn 10h sáng hôm sau — nay bỏ hẳn; việc sửa
        # giờ hằng ngày của QLTT đã có nút "Sửa giờ" ở trang Phê duyệt (xem
        # update() + manager_attendance_fix_deadline).
        if not is_privileged_hr:
            return Response(
                {"error": "Chỉ HCNS mới xử lý được đối chiếu tăng ca."},
                status=status.HTTP_403_FORBIDDEN,
            )

        hr_action = request.data.get("action")
        if hr_action not in ("accept", "auto_fix", "manual_fix"):
            return Response(
                {"error": "action phải là 1 trong: accept, auto_fix, manual_fix"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        hr_note = (request.data.get("note") or "").strip()
        now_str = timezone.now().isoformat()
        old_check_in, old_check_out, old_hours = event.check_in, event.check_out, event.overtime_hours

        if hr_action == "accept":
            pass  # không đổi check_in/check_out/overtime_hours

        elif hr_action == "auto_fix":
            if recon_status != "missing_checkin_note":
                return Response(
                    {"error": "Chỉ Sửa auto được với đơn ở trạng thái 'Ghi nhầm check-in' "
                              "(có giờ ra thực tế rõ ràng để tự áp dụng). Dùng Sửa tay cho các trường hợp khác."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # 'missing_checkin_note' lưu giờ ra thực tế (do đối soát suy luận
            # từ lượt quẹt duy nhất) ở field actual_checkin (tên cũ, xem
            # overtime_reconciliation.py) — 'shortfall' lưu đúng tên ở
            # actual_checkout. Ưu tiên actual_checkout nếu có.
            actual_checkout_str = note.get("actual_checkout") or note.get("actual_checkin")
            if not actual_checkout_str:
                return Response(
                    {"error": "Không có giờ ra thực tế đã ghi nhận để tự áp dụng — dùng Sửa tay."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                new_check_out = _dt.time.fromisoformat(actual_checkout_str)
            except ValueError:
                return Response({"error": "Dữ liệu giờ ra thực tế không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
            if not event.check_in:
                return Response({"error": "Đơn không có giờ vào đã đăng ký để tính lại số giờ."}, status=status.HTTP_400_BAD_REQUEST)
            event.check_out = new_check_out
            event.overtime_hours = compute_overtime_hours(event.check_in, new_check_out)

        else:  # manual_fix
            check_out_str = request.data.get("check_out")
            if not check_out_str:
                return Response({"error": "Sửa tay cần nhập giờ ra (check_out)."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                new_check_out = _dt.time.fromisoformat(check_out_str)
            except ValueError:
                return Response({"error": "Giờ ra không hợp lệ, dùng định dạng HH:MM."}, status=status.HTTP_400_BAD_REQUEST)
            check_in_str = request.data.get("check_in")
            if check_in_str:
                try:
                    new_check_in = _dt.time.fromisoformat(check_in_str)
                except ValueError:
                    return Response({"error": "Giờ vào không hợp lệ, dùng định dạng HH:MM."}, status=status.HTTP_400_BAD_REQUEST)
            else:
                new_check_in = event.check_in
            if not new_check_in:
                return Response({"error": "Đơn chưa có giờ vào — vui lòng nhập cả giờ vào."}, status=status.HTTP_400_BAD_REQUEST)
            event.check_in = new_check_in
            event.check_out = new_check_out
            event.overtime_hours = compute_overtime_hours(new_check_in, new_check_out)

        # Ghi audit trail giống hệt update() ở trên (record_request_edit) nếu
        # có thay đổi giờ/số giờ thật sự.
        changed_fields = []
        old_values = {}
        if event.check_in != old_check_in:
            changed_fields.append("start_time"); old_values["start_time"] = old_check_in.isoformat() if old_check_in else None
        if event.check_out != old_check_out:
            changed_fields.append("end_time"); old_values["end_time"] = old_check_out.isoformat() if old_check_out else None
        if event.overtime_hours != old_hours:
            changed_fields.append("hours"); old_values["hours"] = float(old_hours) if old_hours is not None else None
        if changed_fields:
            d = record_request_edit(d, approver, changed_fields, old_values)

        note.update({
            "hr_decision": hr_action.upper(),
            "hr_decided_by_name": approver.full_name,
            "hr_decided_at": now_str,
            **({"hr_note": hr_note} if hr_note else {}),
        })
        d["reconciliation"] = note

        if hr_action == "manual_fix" and recon_status == "cancelled_too_short" and d.get("is_deleted"):
            # HCNS sửa tay 1 đơn đã bị hệ thống TỰ HUỶ vì tăng ca thực tế dưới
            # 30 phút -> coi như khôi phục lại đơn với giờ HCNS vừa nhập (xem
            # soft_cancel_request ở overtime_reconciliation._reconcile_one).
            d["status"] = "APPROVED"
            d["is_deleted"] = False
            d.pop("deleted_at", None)
            d.pop("deleted_by_id", None)
            d.pop("deleted_by_name", None)
            d["restored_note"] = {
                "at": now_str,
                "reason": f"HCNS ({approver.full_name}) sửa tay và khôi phục lại đơn tăng ca "
                          f"đã bị tự huỷ do thời lượng thực tế dưới mức tối thiểu.",
            }

        event.data = d
        event.save()

        return Response(serialize_registration_event(event))


# ─────────────────────────────────────────────────────────────────────────────
# ONLINE WORK REQUEST VIEWSET  (backed by OnlineWorkRequest model)
# ─────────────────────────────────────────────────────────────────────────────

class OnlineWorkRequestViewSet(FinalizationLockMixin, viewsets.ViewSet):
    """
    ViewSet quản lý đơn làm việc online (WFH), nay lưu trực tiếp vào EmployeeEvent.
    """
    permission_classes = [IsAuthenticated]

    def _base_qs(self):
        return (
            EmployeeEvent.objects
            .filter(event_type=EmployeeEvent.EventType.ONLINE_WORK)
            .select_related(
                "employee",
                "employee__manager",
                "employee__department",
                "employee__department__manager",
            )
        )

    def _get_approver(self, request):
        try:
            return Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return None

    def _restrict_by_role(self, qs, request):
        if request.user.is_staff or request.user.is_superuser:
            return qs
        employee = self._get_approver(request)
        if not employee:
            return qs.none()
        return qs.filter(_get_visible_q(employee, is_event=True)).distinct()

    def list(self, request):
        qs = self._restrict_by_role(self._base_qs(), request)
        
        # Filters
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(data__status=status_filter)
        
        employee_id = request.query_params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            qs = qs.filter(event_date__year=year, event_date__month=month)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            return paginator.get_paginated_response([serialize_registration_event(e) for e in page])
        return Response([serialize_registration_event(e) for e in qs])

    def create(self, request):
        # --- Kiểm tra khóa chốt công ---
        # Đơn Online chỉ lưu NGÀY dưới field 'work_date' (không có 'attendance_date' —
        # trước đây đọc nhầm field này nên khối check này chưa từng thực sự chạy).
        work_date_for_lock = request.data.get('work_date')
        if work_date_for_lock:
            from datetime import date as _date
            try:
                d = _date.fromisoformat(str(work_date_for_lock))
                target_employee = None
                emp_id = request.data.get('employee_id')
                if emp_id:
                    target_employee = Employee.objects.filter(id=emp_id).first()
                lock_resp = self.assert_not_locked(
                    d.year, d.month, request, day=d.day, allow_admin=True,
                    employee=target_employee,
                )
                if lock_resp:
                    return lock_resp
            except (ValueError, TypeError):
                pass

        # Khoá hạn tạo đơn Online: trước ít nhất 2 giờ so với giờ bắt đầu
        # thực hiện (quy định thời hạn tạo/duyệt đơn, hiệu lực từ 09/09/2026) —
        # Admin/HR tự tạo hộ được bỏ qua ("HCNS mở cho trường hợp đặc biệt").
        # Đơn Online chỉ lưu NGÀY (work_date), không lưu giờ bắt đầu -> suy ra
        # từ ca làm việc của nhân viên ngày đó (xem deadline_utils.get_shift_
        # start_time), đúng buổi sáng/chiều/cả ngày qua _resolve_online_work_half()
        # ở trên (trước đây LUÔN dùng 'FULL' bất kể nhân sự chọn buổi nào —
        # khiến đơn Online buổi CHIỀU của nhân viên có ca sáng-chiều liền
        # (vd hành chính 08h30-17h30) bị tính hạn theo giờ vào ca sáng, chặn
        # nhầm cả đơn gửi giữa trưa).
        emp_id_online = request.data.get('employee_id')
        target_employee_online = Employee.objects.filter(id=emp_id_online).first() if emp_id_online else None
        is_admin_or_hr_creator = bool(
            request.user.is_staff or request.user.is_superuser or _is_hr(self._get_approver(request))
        )
        if target_employee_online and not is_admin_or_hr_creator:
            from datetime import date as _date_online
            from .deadline_utils import is_locked_effective, hours_before_deadline, get_shift_start_time, _combine_aware, in_backlog_grace_period
            if is_locked_effective():
                try:
                    work_date_online = _date_online.fromisoformat(str(request.data.get('work_date')))
                except (ValueError, TypeError):
                    work_date_online = None
                # HCNS cho phép bổ sung nốt đơn Online phát sinh trước ngày
                # hiệu lực mà nhân sự chưa kịp tạo (chỉ trong thời gian ân
                # hạn — xem BACKLOG_GRACE_PERIOD_END).
                if work_date_online and in_backlog_grace_period(work_date_online):
                    work_date_online = None
                # "Mở khoá đặc biệt" — HCNS đã cấp phép cho đúng NV/ngày này ở
                # trang Quản lý đơn (DeadlineExceptionGrant) -> bỏ qua hẳn hạn.
                # TRƯỚC ĐÂY thiếu hẳn kiểm tra này: chỉ bỏ qua khi CHÍNH HCNS/
                # Admin là người bấm tạo hộ (is_admin_or_hr_creator), nên nhân
                # sự tự tạo đơn Online sau khi đã được mở khoá vẫn bị chặn.
                from .deadline_exception_models import has_deadline_exception
                if work_date_online and has_deadline_exception(target_employee_online, work_date_online, "ONLINE_WORK"):
                    work_date_online = None
                if work_date_online:
                    shift_start = get_shift_start_time(
                        target_employee_online, work_date_online,
                        half=_resolve_online_work_half(request.data),
                    )
                    if shift_start:
                        deadline = hours_before_deadline(_combine_aware(work_date_online, shift_start), 2)
                        if timezone.now() > deadline:
                            return Response({
                                "error": f"Đã quá hạn tạo đơn Online (phải tạo trước "
                                         f"{deadline.strftime('%H:%M %d/%m/%Y')}, tức ít nhất 2 giờ trước "
                                         f"giờ bắt đầu ca làm việc)."
                            }, status=status.HTTP_400_BAD_REQUEST)

        serializer = OnlineWorkEventCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        return Response(serialize_registration_event(event), status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        event = get_object_or_404(self._base_qs(), pk=pk)
        return Response(serialize_registration_event(event))

    def _can_edit_or_delete(self, event, approver, request):
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        is_management = (
            (approver.position.is_management if approver.position else False) or
            approver.managed_departments.exists() or
            approver.subordinates.exists()
        )
        is_owner = event.employee_id == approver.id
        is_privileged = is_admin or is_hr_user or has_perm or is_management
        return is_owner, is_privileged

    def update(self, request, pk=None):
        """Chủ đơn sửa lý do khi đơn còn PENDING/DRAFT, chưa ai duyệt, và
        chưa quá hạn tạo/duyệt đơn Online (yêu cầu HCNS 2026-09-17: edit cũng
        phải theo đúng hạn tạo đơn — tái dùng nguyên _check_online_work_
        approve_deadline(), tự bỏ qua nếu HCNS đã "mở khoá"). Admin/HR/Quản
        lý sửa được bất kỳ lúc nào."""
        event = get_object_or_404(self._base_qs(), pk=pk)
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_owner, is_privileged = self._can_edit_or_delete(event, approver, request)
        if not (is_owner or is_privileged):
            return Response({"error": "Bạn không có quyền sửa đơn này"}, status=status.HTTP_403_FORBIDDEN)

        d = dict(event.data or {})
        # is_privileged (Admin/HR/Quản lý) được sửa bất kỳ trạng thái nào —
        # sửa lại 2026-09-21, trước đây check này chặn nhầm cả họ dù docstring
        # đã ghi rõ ý định ngược lại (xem RegistrationRequestViewSet.update()).
        if not is_privileged and d.get("status") not in ("DRAFT", "PENDING"):
            return Response(
                {"error": "Chỉ có thể cập nhật đơn ở trạng thái DRAFT hoặc PENDING"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_owner and not is_privileged:
            if d.get("direct_manager_approved") or d.get("hr_approved"):
                return Response(
                    {"error": "Không thể sửa đơn đã có người phê duyệt"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            deadline_error = _check_online_work_approve_deadline(event, bypass=False)
            if deadline_error:
                return Response({"error": deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        updatable = ["reason", "expected_status"]
        old_values = {f: d.get(f) for f in updatable}
        changed_fields = [f for f in updatable if f in request.data and request.data[f] != d.get(f)]
        for field in updatable:
            if field in request.data:
                d[field] = request.data[field]
        if "reason" in request.data:
            event.notes = request.data["reason"]
        if changed_fields:
            is_admin_flag = request.user.is_staff or request.user.is_superuser
            is_hr_flag = _is_hr(approver)
            has_perm_flag = _has_approve_permission(approver)
            is_management_flag = bool(
                (approver.position.is_management if approver.position else False) or
                approver.managed_departments.exists() or
                approver.subordinates.exists()
            )
            was_reset = reset_approval_for_privileged_edit(
                d, approver, is_admin=is_admin_flag, is_hr_user=is_hr_flag,
                has_perm=has_perm_flag, is_management=is_management_flag,
            )
            d = record_request_edit(d, approver, changed_fields, old_values)
            if was_reset:
                d["edit_history"][-1]["reset_to_pending"] = True
        event.data = d
        event.save()
        return Response(serialize_registration_event(event))

    def partial_update(self, request, pk=None):
        return self.update(request, pk=pk)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Huỷ đơn — soft-delete có log qua soft_cancel_request()). Đây là CƠ
        CHẾ DUY NHẤT để bỏ 1 đơn (không còn xoá cứng — xem docstring đầy đủ ở
        RegistrationRequestViewSet.cancel(), cùng logic, tái dùng nguyên)."""
        event = get_object_or_404(self._base_qs(), pk=pk)

        approver = self._get_approver(request)
        if not approver:
            return Response(
                {"error": "Employee profile not found"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_owner, is_privileged = self._can_edit_or_delete(event, approver, request)

        if not is_owner and not is_privileged:
            return Response(
                {"error": "Bạn không có quyền huỷ đơn này"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Chỉ chủ đơn mới được hưởng grant này (không mở rộng cho người
        # khác) — xem docstring RegistrationRequestViewSet.cancel(). Chấp
        # nhận CẢ loại dự phòng (CANCEL_EDIT) LẪN đúng loại ONLINE_WORK.
        from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
        has_owner_grant = is_owner and (
            has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
            or has_deadline_exception(event.employee, event.event_date, "ONLINE_WORK")
        )
        effective_bypass = is_privileged or has_owner_grant

        d = dict(event.data or {})
        # Admin/HR/quản lý: huỷ được ở bất kỳ trạng thái nào (thay cho xoá
        # cứng trước đây) — chỉ chủ đơn mới bị giới hạn "còn PENDING".
        if not is_privileged and d.get("status") != "PENDING":
            return Response(
                {"error": "Chỉ có thể huỷ đơn đang ở trạng thái chờ duyệt."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if d.get("direct_manager_approved") and not effective_bypass:
            return Response(
                {"error": "Đơn đã được quản lý trực tiếp duyệt, không thể tự huỷ nữa. "
                           "Liên hệ HCNS nếu cần huỷ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_owner and not is_privileged:
            deadline_error = _check_online_work_approve_deadline(event, bypass=False)
            if deadline_error:
                return Response({"error": deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        reason = request.data.get("reason") or request.query_params.get("reason")
        old_snapshot = dict(d)
        d = soft_cancel_request(d, approver, reason=reason)
        event.data = d
        event.save(update_fields=["data", "updated_at"])
        log_request_cancel(event, approver, old_snapshot, reason=reason)
        return Response(serialize_registration_event(event))

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        event = get_object_or_404(self._base_qs(), pk=pk)


        approval_note = request.data.get("approval_note", request.data.get("note", ""))
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin      = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = event.employee.manager == approver
        is_hr_user    = _is_hr(approver)
        has_perm      = _has_approve_permission(approver)
        can_as_hr     = is_hr_user or has_perm
        is_creator_senior_mgr = is_senior_manager(event.employee)

        if not (is_direct_mgr or can_as_hr or is_admin):
            return Response({"error": "Bạn không có quyền phê duyệt đơn này"}, status=status.HTTP_403_FORBIDDEN)

        # Khoá hạn duyệt đơn Online (xem chú thích ở create() phía trên) —
        # Admin/HR luôn được bỏ qua.
        online_deadline_error = _check_online_work_approve_deadline(event, bypass=(is_admin or can_as_hr))
        if online_deadline_error:
            return Response({"error": online_deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        d = dict(event.data or {})
        now_str = timezone.now().isoformat()

        # Check quota cho mọi người có quyền duyệt, kể cả Quản lý trực tiếp bước 1
        if is_direct_mgr or can_as_hr or is_admin:
            from .stats_utils import _get_online_work_used, online_quota_amount
            _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
            max_online = float(_cfg.max_online_work_count_per_month) if _cfg else 3.0
            online_used = _get_online_work_used(event.employee, event.event_date)
            online_amount = online_quota_amount(event.employee, event.event_date, d)

            if online_amount > 0 and online_used + online_amount > max_online + 0.01:
                return Response({
                    "error": f'Nhân viên đã dùng {online_used} ngày làm việc online tháng này. Hạn mức tối đa là {max_online} ngày/tháng.',
                    "quota_exceeded": True,
                    "online_work_used": online_used,
                    "max_online": max_online,
                    "remaining": max(0.0, max_online - online_used),
                }, status=status.HTTP_400_BAD_REQUEST)

        if is_admin or (is_creator_senior_mgr and can_as_hr and not event.employee.manager):
            # Chỉ cập nhật step 1 nếu chưa duyệt
            if not d.get("direct_manager_approved"):
                d.update({
                    "direct_manager_approved": True, 
                    "direct_manager_approved_at": now_str,
                    "direct_manager_approved_by_name": approver.full_name,
                })
            # Step 2: HR/Admin duyệt
            d.update({
                "hr_approved": True, 
                "hr_approved_at": now_str, 
                "hr_approved_by_name": approver.full_name,
                "status": "APPROVED", 
                "approved_by_name": approver.full_name, 
                "approved_at": now_str,
            })

        elif is_direct_mgr:
            d.update({
                "direct_manager_approved": True, "direct_manager_approved_at": now_str,
                "direct_manager_approved_by_name": approver.full_name,
            })
            if _is_hr(event.employee):
                d.update({
                    "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
                    "status": "APPROVED", "approved_by_name": approver.full_name, "approved_at": now_str,
                })
        elif can_as_hr:
            if not d.get("direct_manager_approved") and not (is_creator_senior_mgr and not event.employee.manager):
                return Response({"error": "HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt"}, status=status.HTTP_403_FORBIDDEN)
            d.update({
                "hr_approved": True, "hr_approved_at": now_str, "hr_approved_by_name": approver.full_name,
            })

        if d.get("direct_manager_approved") and d.get("hr_approved") and d.get("status") != "APPROVED":
            d["status"] = "APPROVED"
            d["approved_by_name"] = approver.full_name
            d["approved_at"] = now_str

        if approval_note:
            d["approval_note"] = approval_note

        event.data = d
        event.save(update_fields=["data", "updated_at"])
        return Response(serialize_registration_event(event))

    @action(detail=False, methods=["post"])
    def bulk_approve(self, request):
        ids = request.data.get("ids", [])
        approval_note = request.data.get("approval_note", "Đã duyệt hàng loạt")
        quota_exceeded_note = "Từ chối tự động: Vượt quá hạn mức làm việc online tối đa của tháng này."


        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)
            
        is_admin      = request.user.is_staff or request.user.is_superuser
        can_as_hr     = _is_hr(approver) or _has_approve_permission(approver)
        
        events = self._base_qs().filter(id__in=ids).order_by('event_date', 'created_at', 'id')
        results, errors = [], []
        now_str = timezone.now().isoformat()

        from .stats_utils import _get_online_work_used
        _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
        MAX_ONLINE_WORK_PER_MONTH = float(_cfg.max_online_work_count_per_month) if _cfg else 3.0
        quota_exceeded_note = f"Từ chối tự động: Vượt quá hạn mức làm việc online tối đa ({MAX_ONLINE_WORK_PER_MONTH} ngày/tháng)."
        online_quota_cache = {}  # (employee_id, year, month) -> remaining quota
        
        for event in events:
            is_direct_mgr = event.employee.manager == approver
            is_creator_senior_mgr = is_senior_manager(event.employee)
            
            if not (is_direct_mgr or can_as_hr or is_admin):
                errors.append({"id": event.id, "error": "Bạn không có quyền phê duyệt đơn này"})
                continue
                
            d = dict(event.data or {})
            if d.get("status") != "PENDING":
                errors.append({"id": event.id, "error": f"Đơn đang ở trạng thái {d.get('status')}"})
                continue

            # Khoá hạn duyệt — trước đây "Duyệt hàng loạt" hoàn toàn không
            # kiểm tra, khác nút duyệt từng đơn.
            online_deadline_error = _check_online_work_approve_deadline(event, bypass=(is_admin or can_as_hr))
            if online_deadline_error:
                errors.append({"id": event.id, "error": online_deadline_error})
                continue

            # Kiểm tra quota làm việc online (tối đa MAX_ONLINE_WORK_PER_MONTH ngày/tháng)
            key = (event.employee_id, event.event_date.year, event.event_date.month)
            if key not in online_quota_cache:
                used = _get_online_work_used(event.employee, event.event_date)
                online_quota_cache[key] = max(0.0, MAX_ONLINE_WORK_PER_MONTH - used)
            from .stats_utils import online_quota_amount
            this_amount = online_quota_amount(event.employee, event.event_date, d)
            if this_amount > 0 and online_quota_cache[key] < this_amount:
                d.update({
                    "status": "REJECTED",
                    "approval_note": quota_exceeded_note,
                    "hr_rejected": True,
                    "hr_rejected_by_name": approver.full_name,
                    "hr_rejected_at": now_str,
                    "rejected_by_name": approver.full_name,
                    "rejected_at": now_str,
                    "rejection_level": "HR",
                })
                event.data = d
                event.save(update_fields=["data", "updated_at"])
                _create_approval_event(event, approver, "HR", "REJECT", quota_exceeded_note, now_str)
                errors.append({"id": event.id, "error": quota_exceeded_note})
                continue
                
            approved_any = False
            if is_admin or (is_creator_senior_mgr and can_as_hr and not event.employee.manager):
                # Admin hoặc cấp cao: Duyệt thay cả 2 bước
                if not d.get("direct_manager_approved"):
                    d.update({
                        "direct_manager_approved": True, 
                        "direct_manager_approved_at": now_str,
                        "direct_manager_approved_by_name": approver.full_name
                    })
                d.update({
                    "hr_approved": True, 
                    "hr_approved_at": now_str,
                    "hr_approved_by_name": approver.full_name,
                })
                approved_any = True
            elif is_direct_mgr:
                d.update({ 
                    "direct_manager_approved": True, 
                    "direct_manager_approved_at": now_str, 
                    "direct_manager_approved_by_name": approver.full_name 
                })
                approved_any = True
                if _is_hr(event.employee):
                    d.update({ 
                        "hr_approved": True, 
                        "hr_approved_at": now_str, 
                        "hr_approved_by_name": approver.full_name,
                    })
            elif can_as_hr:
                if not d.get("direct_manager_approved"):
                    d.update({
                        "direct_manager_approved": True, 
                        "direct_manager_approved_at": now_str, 
                        "direct_manager_approved_by_name": approver.full_name 
                    })
                d.update({ 
                    "hr_approved": True, 
                    "hr_approved_at": now_str, 
                    "hr_approved_by_name": approver.full_name 
                })
                approved_any = True

            if approved_any:
                if d.get("direct_manager_approved") and d.get("hr_approved") and d.get("status") != "APPROVED":
                    d["status"], d["approved_by_name"], d["approved_at"] = "APPROVED", approver.full_name, now_str
                # Trừ quota cache ngay khi có bất kỳ bước duyệt nào (kể cả chưa APPROVED hoàn toàn)
                # để tránh duyệt vượt quota trong cùng 1 batch khi Manager duyệt bước 1
                online_quota_cache[key] -= this_amount
                if approval_note: d["approval_note"] = approval_note
                event.data = d
                event.save(update_fields=["data", "updated_at"])

                # Determine level for audit
                lvl = "ADMIN" if is_admin else ("HR" if can_as_hr and (is_creator_senior_mgr or not is_direct_mgr) else "DIRECT_MANAGER")
                if is_direct_mgr and _is_hr(event.employee): lvl = "HR"
                _create_approval_event(event, approver, lvl, "APPROVE", approval_note, now_str)

                results.append(event.id)
            
        return Response({"success_count": len(results), "error_count": len(errors), "results": results, "errors": errors})

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        event = get_object_or_404(self._base_qs(), pk=pk)


        approval_note = request.data.get("approval_note", request.data.get("note", ""))
        approver = self._get_approver(request)
        if not approver:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        d = dict(event.data or {})
        d.update({
            "status": "REJECTED",
            "approved_by_name": approver.full_name,
            "approved_at": timezone.now().isoformat(),
            "rejected_by_name": approver.full_name,
            "rejected_at": timezone.now().isoformat(),
        })
        
        is_admin = request.user.is_staff or request.user.is_superuser
        
        if _is_hr(approver) or _has_approve_permission(approver) or is_admin:
            lvl = "HR"
            d["hr_rejected_by_name"] = approver.full_name
        else:
            lvl = "DIRECT_MANAGER"
            
        d["rejection_level"] = lvl
        event.data = d
        event.save(update_fields=["data", "updated_at"])

        _create_approval_event(event, approver, lvl, "REJECT", (approval_note or "Từ chối"), timezone.now().isoformat())

        return Response(serialize_registration_event(event))
