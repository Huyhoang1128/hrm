"""
hrm/duyet_don_views.py
══════════════════════
API GET /api-hrm/duyet-don/

Trả về tất cả các "đơn" (yêu cầu/requests) từ EmployeeEvent mà người dùng
hiện tại có quyền xem, bao gồm các loại event:

  - leave_request        : Nghỉ phép năm (tạo khi LeaveRequest được duyệt)
  - overtime             : Tăng ca
  - extra_hours          : Làm thêm giờ
  - live                 : Livestream
  - explanation          : Giải trình chấm công / Nghỉ phép tháng (LEAVE)
  - online_work          : Làm việc online
  - night_shift          : Ca đêm
  - off_duty             : Ra trực
  - unauthorized_absence : Nghỉ không phép
  - shift_change         : Đổi ca

Phân quyền (_apply_permission_filter):
  - Admin          : xem tất cả
  - HR (Nhân sự)   : xem đơn của mình + cấp dưới + đã xử lý xong + chờ HR duyệt
  - Manager/Staff  : xem đơn của mình + cấp dưới trực tiếp
"""

import logging

from django.db import models
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee

from .constant import ExplanationType
from .event_models import EmployeeEvent
from .models import _has_approve_permission, _is_hr
from .pagination import StandardResultsSetPagination
from .taodon_views import _batch_get_violation_info

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Event types that represent actual "đơn" (requests / applications).
# Excludes explanation_approval, request_approval (approval-record events)
# and attendance (check-in/check-out records).
#
# LƯU Ý: danh sách này từng thiếu UNAUTHORIZED_ABSENCE và SHIFT_CHANGE (2
# loại registration_type hợp lệ trong REGISTRATION_TYPE_TO_EVENT_TYPE ở
# registration_serializers.py) — khiến toàn bộ đơn "Nghỉ không phép"/"Đổi
# ca" đang PENDING hoàn toàn không xuất hiện ở mục Phê duyệt cho BẤT KỲ
# quản lý nào (API /api-hrm/duyet-don/ này lọc event_type__in danh sách này
# ngay từ đầu, trước cả bước phân quyền), dù đơn đã tạo đúng, đúng người
# quản lý trực tiếp. Khi thêm loại đơn mới, nhớ cập nhật cả danh sách này.
DUYET_DON_EVENT_TYPES = [
    EmployeeEvent.EventType.LEAVE_REQUEST,
    EmployeeEvent.EventType.OVERTIME,
    EmployeeEvent.EventType.EXTRA_HOURS,
    EmployeeEvent.EventType.LIVESTREAM,
    EmployeeEvent.EventType.EXPLANATION,
    EmployeeEvent.EventType.ONLINE_WORK,
    EmployeeEvent.EventType.NIGHT_SHIFT,
    EmployeeEvent.EventType.OFF_DUTY,
    EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE,
    EmployeeEvent.EventType.SHIFT_CHANGE,
]


# ─────────────────────────────────────────────────────────────────────────────
# PERMISSION FILTER
# ─────────────────────────────────────────────────────────────────────────────

def _apply_permission_filter(qs, request, target_employee_id=None):
    """
    Lọc queryset EmployeeEvent theo phân quyền người dùng hiện tại.

    - Admin     : thấy tất cả.
    - HR        : thấy đơn của mình + cấp dưới (trực tiếp & phòng ban)
                  + toàn bộ đơn đã xử lý xong (APPROVED/REJECTED)
                  + đơn đang chờ HR duyệt (PENDING & direct_manager_approved=True).
    - Còn lại   : thấy đơn của mình + cấp dưới trực tiếp.
    """
    user = request.user
    # 1. Admin: xem tất cả
    if user.is_superuser:
        return qs
    
    try:
        current_employee = Employee.objects.get(user=user)
    except Employee.DoesNotExist:
        logger.info("Employee not exist")
        return qs.none()


    is_hr = _is_hr(current_employee) or _has_approve_permission(current_employee)

    target_employee = None
    if target_employee_id not in (None, ""):
        try:
            target_employee = Employee.objects.select_related("department", "manager").get(
                pk=target_employee_id
            )
        except (Employee.DoesNotExist, ValueError, TypeError):
            return qs.none()

    def _target_visibility_q():
        if target_employee is None:
            return None

        base_employee_q = models.Q(employee_id=target_employee.id)

        if target_employee.id == current_employee.id:
            return base_employee_q

        is_direct_manager = target_employee.manager_id == current_employee.id
        is_department_manager = (
            getattr(target_employee.department, "manager_id", None) == current_employee.id
        )

        if is_hr:
            if is_direct_manager or is_department_manager:
                return base_employee_q

            return base_employee_q & (
                models.Q(data__status__in=["APPROVED", "REJECTED"])
                | models.Q(
                    data__status="PENDING",
                    data__direct_manager_approved=True,
                )
            )

        if is_direct_manager:
            return base_employee_q

        return None

    target_visibility_q = _target_visibility_q()
    if target_employee is not None:
        if target_visibility_q is None:
            return qs.none()
        return qs.filter(target_visibility_q).distinct()

    # 2. HR (Nhân sự): xem rộng hơn
    if is_hr:
        sub_ids = Employee.objects.filter(
            models.Q(manager=current_employee)
            | models.Q(department__manager=current_employee)
        ).values_list("id", flat=True)
        return qs.filter(
            models.Q(employee_id=current_employee.id)  # đơn của mình
            | models.Q(employee_id__in=sub_ids)  # đơn của cấp dưới
            | models.Q(data__status__in=["APPROVED", "REJECTED"])  # đã xử lý xong
            | models.Q(  # chờ HR duyệt
                data__status="PENDING",
                data__direct_manager_approved=True,
            )
        ).distinct()

    # 3. Manager/Staff: chỉ xem đơn của mình + cấp dưới trực tiếp
    direct_sub_ids = Employee.objects.filter(
        manager=current_employee
    ).values_list("id", flat=True)
    return qs.filter(
        models.Q(employee_id=current_employee.id)
        | models.Q(employee_id__in=direct_sub_ids)
    ).distinct()


# ─────────────────────────────────────────────────────────────────────────────
# SERIALIZER
# ─────────────────────────────────────────────────────────────────────────────

def serialize_duyet_don_event(event: EmployeeEvent, violation_info: dict = None, monthly_stats_cache: dict = None) -> dict:
    """Convert an EmployeeEvent to the duyet-don response format."""
    d = event.data or {}
    emp = event.employee
    event_type = event.event_type

    # leave_request events are created after approval, so status lives in the
    # LeaveRequest model, not in data. We default to 'APPROVED' for them.
    status_val = d.get("status") or (
        "APPROVED" if event_type == EmployeeEvent.EventType.LEAVE_REQUEST else "PENDING"
    )

    result = {
        "id": event.id,
        "event_type": event_type,
        "event_type_display": dict(EmployeeEvent.EventType.choices).get(event_type, event_type),
        "request_code": d.get("request_code", ""),
        "employee_id": emp.id,
        "employee_name": emp.full_name,
        "employee_code": emp.employee_id,
        "department_name": emp.department.name if emp.department else None,
        "position_name": emp.position.title if emp.position else None,
        "attendance_date": str(event.event_date),
        "start_date": d.get("start_date") or str(event.event_date),
        "end_date": d.get("end_date") or str(event.event_date),
        "reason": event.explanation or d.get("reason", event.notes or ""),
        "status": status_val,
        "direct_manager_approved": d.get("direct_manager_approved", False),
        "hr_approved": d.get("hr_approved", False),
        "approved_by_name": d.get("approved_by_name"),
        "approved_at": d.get("approved_at"),
        "direct_manager_approved_at": d.get("direct_manager_approved_at"),
        "hr_approved_at": d.get("hr_approved_at"),
        "direct_manager_approved_by_name": d.get("direct_manager_approved_by_name"),
        "hr_approved_by_name": d.get("hr_approved_by_name"),
        "rejected_by_name": d.get("rejected_by_name"),
        "rejected_at": d.get("rejected_at"),
        "rejection_level": d.get("rejection_level"),
        "hr_rejected_by_name": d.get("hr_rejected_by_name"),
        "hr_rejected_at": d.get("hr_rejected_at"),
        "direct_manager_rejected_by_name": d.get("direct_manager_rejected_by_name"),
        "direct_manager_rejected_at": d.get("direct_manager_rejected_at"),
        "employee_manager_id": emp.manager.id if emp.manager else None,
        "employee_manager_name": emp.manager.full_name if emp.manager else None,
        # Trưởng phòng ban (Department.manager, reverse: Employee.managed_departments)
        # — KHÁC với employee_manager_id (quản lý trực tiếp cá nhân, Employee.manager).
        # 1 người có thể là QLTT của cả phòng ban dù không đứng tên manager riêng
        # cho từng nhân viên trong đó — filter "Tôi là QLTT" ở FE cần cả 2 field
        # này mới không bị sót phòng ban (xem Approvals.tsx).
        "employee_department_manager_id": emp.department.manager_id if emp.department else None,
        "employee_department_manager_name": (
            emp.department.manager.full_name if emp.department and emp.department.manager else None
        ),
        "created_at": event.created_at.isoformat(),
        "updated_at": event.updated_at.isoformat(),
    }

    if event_type == EmployeeEvent.EventType.EXPLANATION:
        explanation_type_val = d.get("explanation_type", "")
        result["explanation_type"] = explanation_type_val
        result["explanation_type_display"] = ExplanationType.DISPLAY.get(explanation_type_val, explanation_type_val)
        result["original_status"] = d.get("original_status", "")
        result["expected_status"] = d.get("expected_status", "")
        result["actual_check_in"] = d.get("actual_check_in")
        result["actual_check_out"] = d.get("actual_check_out")
        result["forgot_punch_type"] = d.get("forgot_punch_type")
        result["forgot_checkin_time"] = d.get("forgot_checkin_time")
        result["forgot_checkout_time"] = d.get("forgot_checkout_time")

        vi = violation_info or {}
        result["penalty_amount"] = vi.get("penalty_amount", 0)
        result["late_minutes"] = vi.get("late_minutes", 0)
        result["early_leave_minutes"] = vi.get("early_leave_minutes", 0)
        result["violation_notes"] = vi.get("violation_notes", [])
        result["violation_count"] = vi.get("violation_count", 0)

        # Quota stats cho Leave và Explanation (từ CompanyConfig) — ưu tiên
        # đọc từ monthly_stats_cache (đã batch tính sẵn cho cả trang, xem
        # batch_get_employee_monthly_stats() ở DuyetDonAPIView.get()) để
        # tránh N+1 khi danh sách có hàng trăm đơn; fallback tính lẻ nếu
        # không truyền cache (giữ nguyên hành vi cũ cho caller khác).
        stats = None
        if monthly_stats_cache is not None:
            stats = monthly_stats_cache.get((emp.id, event.event_date.year, event.event_date.month))
        if stats is None:
            from .stats_utils import get_employee_monthly_stats
            stats = get_employee_monthly_stats(emp, event.event_date)
        result["quota_used"] = stats.get("quota_used", 0)
        result["quota_remaining"] = stats.get("quota_remaining", 0)
        result["max_explanation_quota"] = stats.get("max_explanation_quota", 3)
        # Hạn mức theo từng loại: số của đúng giỏ loại đơn này (hrm/explanation_quota.py)
        from .explanation_quota import BUCKET_OF
        _bucket = BUCKET_OF.get(str(result.get("explanation_type") or "").upper())
        _bucket_stats = (stats.get("explanation_quota_by_type") or {}).get(_bucket) if _bucket else None
        result["quota_bucket"] = None if stats.get("explanation_quota_shared", True) else _bucket
        if _bucket_stats and not stats.get("explanation_quota_shared", True):
            result["quota_used"] = _bucket_stats["used"]
            result["quota_remaining"] = _bucket_stats["remaining"]
            result["max_explanation_quota"] = _bucket_stats["max"]
        result["leave_used"] = stats.get("leave_used", 0)
        result["max_leave_quota"] = stats.get("max_leave_quota", 1)

    REGISTRATION_TYPES = (
        EmployeeEvent.EventType.OVERTIME,
        EmployeeEvent.EventType.EXTRA_HOURS,
        EmployeeEvent.EventType.LIVESTREAM,
        EmployeeEvent.EventType.NIGHT_SHIFT,
        EmployeeEvent.EventType.OFF_DUTY,
    )
    if event_type in REGISTRATION_TYPES:
        if event_type == EmployeeEvent.EventType.LIVESTREAM:
            result["hours"] = d.get("session_duration") or d.get("hours")
        else:
            result["hours"] = d.get("hours")
        result["sessions"] = d.get("sessions")
        # Giờ bắt đầu / kết thúc lấy từ event.check_in / check_out
        result["start_time"] = str(event.check_in) if event.check_in else None
        result["end_time"]   = str(event.check_out) if event.check_out else None

    result["event_data"] = d

    # Online Work: thêm expected_status và quota stats từ CompanyConfig
    if event_type == EmployeeEvent.EventType.ONLINE_WORK:
        result["expected_status"] = d.get("expected_status", "")
        stats = None
        if monthly_stats_cache is not None:
            stats = monthly_stats_cache.get((emp.id, event.event_date.year, event.event_date.month))
        if stats is None:
            from .stats_utils import get_employee_monthly_stats
            stats = get_employee_monthly_stats(emp, event.event_date)
        result["online_work_used"] = stats.get("online_work_used", 0)
        result["max_online_quota"] = stats.get("max_online_quota", 3)
        # Số ngày ĐƠN NÀY thực sự tính vào hạn mức (0 nếu là chiều T7 tuần 2/4
        # hoặc Chủ nhật của phòng ban được miễn) — FE dùng khi xếp đơn duyệt
        # hàng loạt, thay vì tự tính 0.5/1.0 theo expected_status.
        from .stats_utils import online_quota_amount
        result["online_quota_amount"] = online_quota_amount(emp, event.event_date, d)

    return result


# ─────────────────────────────────────────────────────────────────────────────
# VIEW
# ─────────────────────────────────────────────────────────────────────────────

class DuyetDonAPIView(APIView):
    """
    GET /api-hrm/duyet-don/

    Trả về tất cả đơn mà người dùng hiện tại có quyền xem (có phân trang).

    Query params (tất cả đều tuỳ chọn):
      - status        : lọc theo trạng thái (PENDING, APPROVED, REJECTED, DRAFT…)
      - event_type    : lọc theo loại event (leave_request, overtime, explanation…)
      - employee_id   : lọc theo nhân viên cụ thể
      - department_id : lọc theo phòng ban
      - start_date    : ngày bắt đầu (YYYY-MM-DD)
      - end_date      : ngày kết thúc (YYYY-MM-DD)
      - month         : tháng (kết hợp với year)
      - year          : năm  (kết hợp với month)
      - ordering      : sắp xếp (created_at, -created_at, event_date, -event_date)
    """

    permission_classes = [IsAuthenticated]

    def _base_qs(self):
        return (
            EmployeeEvent.objects.filter(event_type__in=DUYET_DON_EVENT_TYPES)
            .select_related(
                "employee",
                "employee__manager",
                "employee__department",
                "employee__department__manager",
                "employee__position",
            )
        )

    def _apply_filters(self, qs, request):
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(data__status=status_filter)

        event_type = request.query_params.get("event_type")
        if event_type:
            qs = qs.filter(event_type=event_type)

        employee_id = request.query_params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        department_id = request.query_params.get("department_id")
        if department_id:
            qs = qs.filter(employee__department_id=department_id)

        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        if start_date and end_date:
            qs = qs.filter(event_date__gte=start_date, event_date__lte=end_date)
        elif start_date:
            qs = qs.filter(event_date__gte=start_date)
        elif end_date:
            qs = qs.filter(event_date__lte=end_date)

        month = request.query_params.get("month")
        year = request.query_params.get("year")
        if month and year:
            qs = qs.filter(event_date__year=year, event_date__month=month)

        ordering = request.query_params.get("ordering", "-created_at")
        field = ordering.lstrip("-")
        valid_ordering_fields = {"created_at", "updated_at", "event_date"}
        if field in valid_ordering_fields:
            qs = qs.order_by(ordering)
        else:
            qs = qs.order_by("-created_at")

        return qs

    def get(self, request):
        employee_id = request.query_params.get("employee_id")

        base_qs = self._base_qs()
        if employee_id:
            base_qs = base_qs.filter(employee_id=employee_id)

        qs = _apply_permission_filter(base_qs, request, target_employee_id=employee_id)
        logger.info(base_qs)
        qs = self._apply_filters(qs, request)
        

        from .stats_utils import batch_get_employee_monthly_stats

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            explanation_events = [e for e in page if e.event_type == EmployeeEvent.EventType.EXPLANATION]
            batch_results = _batch_get_violation_info(explanation_events) if explanation_events else {}
            # Tính quota/stats 1 LẦN cho mỗi cặp (nhân viên, tháng) DUY NHẤT
            # trong cả trang thay vì tính lại cho TỪNG đơn — trước đây đây là
            # nguyên nhân chính khiến trang Phê duyệt cực chậm/treo khi có
            # nhiều đơn (mỗi đơn ~5-7 query DB không cache).
            stats_targets = [
                (e.employee, e.event_date) for e in page
                if e.event_type in (EmployeeEvent.EventType.EXPLANATION, EmployeeEvent.EventType.ONLINE_WORK)
            ]
            monthly_stats_cache = batch_get_employee_monthly_stats(stats_targets)
            return paginator.get_paginated_response(
                [serialize_duyet_don_event(e, batch_results.get(e.id), monthly_stats_cache) for e in page]
            )
        explanation_events = [e for e in qs if e.event_type == EmployeeEvent.EventType.EXPLANATION]
        batch_results = _batch_get_violation_info(explanation_events) if explanation_events else {}
        stats_targets = [
            (e.employee, e.event_date) for e in qs
            if e.event_type in (EmployeeEvent.EventType.EXPLANATION, EmployeeEvent.EventType.ONLINE_WORK)
        ]
        monthly_stats_cache = batch_get_employee_monthly_stats(stats_targets)
        return Response([serialize_duyet_don_event(e, batch_results.get(e.id), monthly_stats_cache) for e in qs])
