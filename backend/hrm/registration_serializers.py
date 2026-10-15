"""
hrm/registration_serializers.py
════════════════════════════════
Serializers cho registration-requests (EmployeeEvent-backed) và OnlineWorkRequest.

/api-hrm/registration-requests/ → lưu trực tiếp vào EmployeeEvent.
/api-hrm/online-work-requests/  → dùng OnlineWorkRequest model.
"""

from django.utils import timezone
from django.db.models import Q
from rest_framework import serializers
from employee.models import Employee
from .attendance_models import OnlineWorkRequest
from .event_models import EmployeeEvent
from .models import _is_hr, is_senior_manager


# ─────────────────────────────────────────────────────────────────────────────
# MAPPING: registration_type → EmployeeEvent.EventType
# ─────────────────────────────────────────────────────────────────────────────

REGISTRATION_TYPE_TO_EVENT_TYPE = {
    # Loại tính theo buổi / ca (count as units)
    "LIVE":          EmployeeEvent.EventType.LIVESTREAM,    # Livestream (tính theo ca)
    "NIGHT_SHIFT":   EmployeeEvent.EventType.NIGHT_SHIFT,   # Ca đêm (tính theo buổi)
    # Loại tính theo giờ (hours)
    "OVERTIME":      EmployeeEvent.EventType.OVERTIME,      # Tăng ca (sau giờ làm chính)
    "EXTRA_HOURS":   EmployeeEvent.EventType.EXTRA_HOURS,   # Làm thêm giờ (bù giờ, trong giờ)
    "OFF_DUTY":      EmployeeEvent.EventType.OFF_DUTY,      # Ra trực
    # Đơn nghỉ không phép – KHÔNG tính theo giờ/buổi, không cộng công (xem
    # EVENT_RULE_CATEGORY_MAP: không map rule nào cho type này -> rule engine
    # bỏ qua hoàn toàn, chỉ dùng để đánh dấu ngày nghỉ không phép trên lịch
    # chấm công/bảng chốt công sau khi được duyệt).
    "UNAUTHORIZED_ABSENCE": EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE,
    # Đơn đi công tác – lưu dưới dạng OVERTIME event, phân biệt qua
    # data["registration_type"] = "BUSINESS_TRIP".  Attendance engine sẽ
    # đọc request_type để miễn phạt đi muộn / về sớm / quên chấm công.
    "BUSINESS_TRIP": EmployeeEvent.EventType.OVERTIME,      # Đi công tác
    # Đơn đổi ca – đổi giữa Ca 1 / Ca 2 (mỗi ca là 1 cặp Ca sáng + Ca chiều,
    # tính năng "Đăng ký ca làm") cho 1 ngày cụ thể — LUÔN đổi cả 2 buổi vì
    # chúng đi theo cặp. Khi duyệt xong (status=APPROVED), ShiftRegistrationDay
    # của ngày đó được ghi đè sang cặp ca đích — xem apply_shift_change_effect()
    # ở registration_views.py.
    "SHIFT_CHANGE":  EmployeeEvent.EventType.SHIFT_CHANGE,  # Đổi ca
}

# Loại đơn tính theo số giờ
HOURS_BASED_TYPES = {"OVERTIME", "EXTRA_HOURS"}

# Thời lượng tăng ca tối thiểu (phút) — định nghĩa gốc ở
# overtime_reconciliation.py, import lại ở đây để lúc TẠO đơn và lúc ĐỐI SOÁT
# dùng chung đúng 1 con số.
from .overtime_reconciliation import OT_MIN_DURATION_MINUTES  # noqa: E402

# Loại đơn tính theo buổi / ca (1 đơn = 1 đơn vị)
SESSION_BASED_TYPES = {"LIVE", "NIGHT_SHIFT", "OFF_DUTY"}

# All event types that can appear in /registration-requests/ listing
REGISTRATION_EVENT_TYPES = list(dict.fromkeys(REGISTRATION_TYPE_TO_EVENT_TYPE.values()))


def _to_event_type(registration_type: str) -> str:
    return REGISTRATION_TYPE_TO_EVENT_TYPE.get(
        (registration_type or "").upper(),
        EmployeeEvent.EventType.OVERTIME,
    )


def serialize_registration_event(event: EmployeeEvent) -> dict:
    """Convert an EmployeeEvent into the registration-request response format."""
    d = event.data or {}
    emp = event.employee
    # Tính số giờ: ưu tiên lấy từ overtime_hours field, sau đó từ data
    reg_type = d.get("registration_type", "").upper()
    hours = None
    if reg_type in HOURS_BASED_TYPES:
        hours = (
            float(event.overtime_hours)
            if event.overtime_hours is not None
            else float(d.get("hours", 0) or 0)
        )

    from_ca_label = to_ca_label = None
    if reg_type == "SHIFT_CHANGE":
        from .shift_registration_models import ShiftRegistrationScopeConfig

        def _ca_label(ca_choice, config):
            if not ca_choice or not config:
                return None
            morning, afternoon = config.ca_pair(ca_choice)
            parts = []
            if morning:
                parts.append(f"Sáng {str(morning.start_time)[:5]}-{str(morning.end_time)[:5]}")
            if afternoon:
                parts.append(f"Chiều {str(afternoon.start_time)[:5]}-{str(afternoon.end_time)[:5]}")
            suffix = f" ({', '.join(parts)})" if parts else ""
            return f"Ca {ca_choice}{suffix}"

        _config = ShiftRegistrationScopeConfig.for_employee(emp)
        from_ca_label = _ca_label(d.get("from_ca"), _config)
        to_ca_label = _ca_label(d.get("to_ca"), _config)

    from .deadline_exception_models import can_owner_self_cancel
    # OnlineWorkRequest events không có data["registration_type"] (xem
    # OnlineWorkRequestViewSet, cũng tái dùng đúng hàm serialize này) — nhận
    # diện qua event_type thay vì registration_type trong trường hợp đó.
    _grant_request_type = (
        "ONLINE_WORK" if event.event_type == EmployeeEvent.EventType.ONLINE_WORK
        else d.get("registration_type", "")
    )

    return {
        "id":                              event.id,
        "request_code":                    d.get("request_code", ""),
        "employee_id":                     emp.id,
        "employee_name":                   emp.full_name,
        "employee_code":                   emp.employee_id,
        "employee_is_hr":                  _is_hr(emp),
        "employee_is_senior_manager":      is_senior_manager(emp),
        "employee_position":               emp.position.title if emp.position else None,
        "position_name":                   emp.position.title if emp.position else None,
        "department_name":                 emp.department.name if emp.department else None,
        "attendance_date":                 str(event.event_date),
        "registration_type":               d.get("registration_type", ""),
        "event_type":                      event.event_type,
        "start_time":                      str(event.check_in) if event.check_in else None,
        "end_time":                        str(event.check_out) if event.check_out else None,
        # Số giờ – chỉ có đối với đơn tính giờ
        "hours":                           hours,
        "total_hours":                     hours,
        "reason":                          d.get("reason", event.notes or ""),
        # Chỉ có ý nghĩa với OVERTIME (2026-09-18) — "" nghĩa là chưa phân
        # loại (đơn cũ trước khi có field này, hoặc tạo qua luồng khác chưa
        # cập nhật). Xem RegistrationRequestCreateSerializer.ot_type.
        "ot_type":                         d.get("ot_type", ""),
        # Chỉ có ý nghĩa với OVERTIME ot_type=ONSITE đã qua đối soát (xem
        # hrm/overtime_reconciliation.py + màn Đối chiếu tăng ca) — None nếu
        # chưa từng đối soát/không áp dụng.
        "reconciliation":                  d.get("reconciliation"),
        # Lịch sử chỉnh sửa đơn (ai sửa, lúc nào, đổi field nào từ giá trị gì
        # sang giá trị gì) — xem record_request_edit() ở hrm/models.py. Bổ sung
        # vào API 2026-09-23 theo yêu cầu HCNS: "phần sửa giờ cũng phải thể
        # hiện trong audit trail ... và tất cả các màn khác có chi tiết đơn".
        # Trước đây dữ liệu vẫn được ghi đầy đủ nhưng KHÔNG trả ra nên không
        # màn nào hiển thị được.
        "edit_history":                    d.get("edit_history") or [],
        "last_edited_at":                  d.get("last_edited_at"),
        "last_edited_by_name":             d.get("last_edited_by_name"),
        "reapproval_reason":               d.get("reapproval_reason"),
        "status":                          d.get("status", "PENDING"),
        "can_self_cancel":                 can_owner_self_cancel(event, _grant_request_type),
        "direct_manager_approved":         d.get("direct_manager_approved", False),
        "hr_approved":                     d.get("hr_approved", False),
        "direct_manager_approved_at":      d.get("direct_manager_approved_at"),
        "hr_approved_at":                  d.get("hr_approved_at"),
        "direct_manager_approved_by_name": d.get("direct_manager_approved_by_name"),
        "hr_approved_by_name":             d.get("hr_approved_by_name"),
        "rejected_by_name":                d.get("rejected_by_name", ""),
        "rejected_at":                     d.get("rejected_at"),
        "rejection_level":                 d.get("rejection_level", ""),
        "approval_note":                   d.get("approval_note", ""),
        "approved_by_name":                d.get("approved_by_name"),
        "approved_at":                     d.get("approved_at"),
        "employee_manager_id":             emp.manager.id if emp.manager else None,

        "employee_manager_name":           emp.manager.full_name if emp.manager else None,
        "employee_department_manager_id":  (
            emp.department.manager.id
            if emp.department and emp.department.manager
            else None
        ),
        "employee_department_manager_name":  (
            emp.department.manager.full_name
            if emp.department and emp.department.manager
            else None
        ),
        "expected_status":  d.get("expected_status", ""),
        "half_day_period":  d.get("half_day_period", ""),
        "from_ca":          d.get("from_ca"),
        "to_ca":            d.get("to_ca"),
        "from_ca_label":    from_ca_label,
        "to_ca_label":      to_ca_label,
        "start_date":  d.get("start_date") or str(event.event_date),
        "end_date":    d.get("end_date")   or str(event.event_date),
        "created_at":  event.created_at.isoformat(),
        "updated_at":  event.updated_at.isoformat(),
        "created_by":  event.created_by.full_name if event.created_by else None,
        "created_by_name": event.created_by.full_name if event.created_by else None,
        "is_hr_created": _is_hr(event.created_by) if event.created_by else False,
        "rejected_by_name": d.get("approved_by_name") if d.get("status") == "REJECTED" else None,
        "hr_rejected_by_name": d.get("hr_rejected_by_name"),
        "rejection_level": d.get("rejection_level"),
        **_get_registration_stats(emp, event.event_date)
    }

def _get_registration_stats(employee, date):
    from .stats_utils import get_employee_monthly_stats
    return get_employee_monthly_stats(employee, date)


class RegistrationRequestCreateSerializer(serializers.Serializer):
    """
    Input serializer for POST /api-hrm/registration-requests/.
    Validates the frontend payload and creates an EmployeeEvent.

    Fields:
        hours  – số giờ làm thêm (đây là field bắt buộc với OVERTIME / EXTRA_HOURS).
        start_time / end_time – giờ bắt đầu / kết thúc (optional, dùng để tính hours tự động).
    """
    employee_id       = serializers.IntegerField()
    attendance_date   = serializers.DateField()
    registration_type = serializers.CharField()
    # Chỉ dùng cho UNAUTHORIZED_ABSENCE: cho phép chọn 1 khoảng ngày liên tiếp
    # (attendance_date = ngày bắt đầu) thay vì phải tạo từng đơn 1 ngày một.
    end_date          = serializers.DateField(required=False, allow_null=True, default=None)
    start_time        = serializers.TimeField(required=False, allow_null=True, default=None)
    end_time          = serializers.TimeField(required=False, allow_null=True, default=None)
    # Số giờ – bắt buộc với OVERTIME / EXTRA_HOURS; bỏ qua với LIVE / ONLINE_WORK
    hours             = serializers.DecimalField(
        max_digits=5, decimal_places=2,
        required=False, allow_null=True, default=None,
    )
    reason            = serializers.CharField(required=False, allow_blank=True, default="")
    status            = serializers.CharField(required=False, default="PENDING")
    # Chỉ dùng cho registration_type = SHIFT_CHANGE: ca (1 hoặc 2) muốn đổi sang.
    to_ca             = serializers.IntegerField(required=False, allow_null=True, default=None)
    # Chỉ dùng cho UNAUTHORIZED_ABSENCE: 'ABSENT' (cả ngày, mặc định) hoặc
    # 'HALF_DAY' (nghỉ không phép nửa ngày) — xử lý tương tự Nghỉ phép tháng
    # (ExplanationEventCreateSerializer.expected_status).
    expected_status   = serializers.CharField(required=False, allow_blank=True, default="")
    # Chỉ dùng khi expected_status='HALF_DAY': buổi nghỉ cụ thể — 'MORNING'
    # (nghỉ ca sáng) hoặc 'AFTERNOON' (nghỉ ca chiều). Trước đây chỉ có 1
    # checkbox "Nghỉ nửa ngày" chung chung, không phân biệt được sáng/chiều.
    # Dùng đúng field name/value đã có sẵn trong hệ thống (models.py — field
    # LeaveRequest.half_day_period + contract EmployeeEvent.data ở đầu
    # models.py) thay vì bịa field mới, để hàm đọc sẵn có
    # (hrm/views.py — nhận diện "Ca làm" nửa ngày) tự động nhận ra luôn,
    # không cần sửa gì thêm ở đó.
    half_day_period   = serializers.ChoiceField(
        choices=["MORNING", "AFTERNOON"], required=False, allow_blank=True, default="",
    )
    # Chỉ dùng cho OVERTIME (2026-09-18, yêu cầu HCNS đối soát tăng ca): nhân
    # viên/quản lý tự chọn lúc tạo đơn — "ONSITE" (làm tại viện/VP, cần đối
    # soát với giờ chấm công thực tế cuối tháng) hoặc "ONLINE" (làm từ xa/tại
    # nhà, không cần khớp giờ chấm công vì vốn không có mặt tại viện/VP lúc
    # đó). Không bắt buộc để không phá các luồng tạo đơn cũ (vd Admin/HR tạo
    # hộ qua script/API khác chưa cập nhật) — bỏ trống thì để "" (chưa phân
    # loại), khác None/không set để phân biệt rõ với dữ liệu cũ trước khi có
    # field này (xem migration backfill riêng cho dữ liệu lịch sử).
    ot_type           = serializers.ChoiceField(
        choices=["ONSITE", "ONLINE"], required=False, allow_blank=True, default="",
    )

    def validate_employee_id(self, value):
        if not Employee.objects.filter(id=value).exists():
            raise serializers.ValidationError(f"Employee with ID {value} does not exist")
        return value

    # Số giờ tăng ca tối đa mỗi ngày (không tính giờ nghỉ trưa)
    MAX_OVERTIME_HOURS_PER_DAY = 8.0
    # Số ngày liên tiếp tối đa cho 1 đơn nghỉ không phép (tránh nhập nhầm khoảng quá dài)
    MAX_UNAUTHORIZED_ABSENCE_RANGE_DAYS = 31

    def validate(self, data):
        reg_type = (data.get("registration_type") or "").upper()

        end_date = data.get("end_date")
        if end_date is not None:
            attendance_date = data.get("attendance_date")
            if reg_type != "UNAUTHORIZED_ABSENCE":
                raise serializers.ValidationError(
                    {"end_date": "Chọn khoảng ngày chỉ áp dụng cho Đơn nghỉ không phép"}
                )
            if attendance_date and end_date < attendance_date:
                raise serializers.ValidationError(
                    {"end_date": "Ngày kết thúc phải từ ngày bắt đầu trở đi"}
                )
            if attendance_date and (end_date - attendance_date).days >= self.MAX_UNAUTHORIZED_ABSENCE_RANGE_DAYS:
                raise serializers.ValidationError(
                    {"end_date": f"Khoảng ngày nghỉ không phép tối đa {self.MAX_UNAUTHORIZED_ABSENCE_RANGE_DAYS} ngày"}
                )

        # ── Khoá hạn tạo đơn theo quy định thời hạn tạo/duyệt đơn, hiệu lực từ
        # 09/09/2026 (xem hrm/deadline_utils.py) — Admin/HR luôn được bỏ qua
        # (cơ chế "HCNS mở cho trường hợp đặc biệt": HCNS/Admin tự tạo/duyệt
        # hộ là coi như đã xét duyệt ngoại lệ, không cần thêm nút/màn hình
        # riêng). NV thường bị chặn thẳng nếu tạo đơn sau hạn.
        from .deadline_utils import (
            is_locked_effective, hours_before_deadline, leave_style_deadline, _combine_aware,
            overtime_deadline_for,
        )
        request = self.context.get("request")
        is_admin_or_hr_creator = bool(
            request and (
                request.user.is_staff or request.user.is_superuser or _is_hr(
                    Employee.objects.filter(user=request.user).first()
                )
            )
        )
        if is_locked_effective() and not is_admin_or_hr_creator:
            if reg_type == "OVERTIME":
                from .deadline_exception_models import has_deadline_exception
                attendance_date = data.get("attendance_date")
                employee_for_check = Employee.objects.filter(id=data.get("employee_id")).first()
                # "Mở khoá đặc biệt" — HCNS đã cấp phép cho đúng NV/ngày này
                # (vd quên tạo đơn, lỗi kỹ thuật...) -> bỏ qua hẳn hạn, kể cả
                # khi đơn không có start_time.
                if not has_deadline_exception(employee_for_check, attendance_date, "OVERTIME"):
                    # 1 nguồn sự thật dùng chung với bước DUYỆT đơn
                    # (registration_views._check_approve_deadline) — xem
                    # deadline_utils.overtime_deadline_for(): nhóm được gia hạn
                    # thì hạn là 10h sáng ngày làm việc kế tiếp, còn lại là
                    # trước 2 giờ so với giờ bắt đầu tăng ca.
                    deadline, is_extended = overtime_deadline_for(
                        attendance_date, data.get("start_time"), employee_for_check,
                    )
                    if deadline is None:
                        raise serializers.ValidationError(
                            {"start_time": "Cần chọn giờ bắt đầu tăng ca để kiểm tra hạn tạo đơn "
                                            "(phải tạo đơn trước ít nhất 2 giờ so với giờ bắt đầu)."}
                        )
                    if timezone.now() > deadline:
                        han = deadline.strftime('%H:%M %d/%m/%Y')
                        msg = (
                            f"Đã quá hạn tạo đơn tăng ca (phải tạo và được duyệt chậm nhất {han})."
                            if is_extended else
                            f"Đã quá hạn tạo đơn tăng ca (phải tạo trước {han}, tức ít nhất 2 giờ "
                            f"trước giờ bắt đầu tăng ca). Liên hệ HCNS để được mở khoá đặc biệt "
                            f"nếu có lý do chính đáng."
                        )
                        from .violation_models import log_blocked_attempt, actor_employee
                        log_blocked_attempt(
                            employee=employee_for_check, event_date=attendance_date,
                            request_type="OVERTIME", deadline=deadline,
                            error_message=msg, attempted_by=actor_employee(request),
                            start_time=str(data.get("start_time") or ""),
                        )
                        raise serializers.ValidationError({"attendance_date": msg})
            elif reg_type == "UNAUTHORIZED_ABSENCE":
                # HCNS chốt 2026-09-28: "Nghỉ không phép" chính là nhánh "Nghỉ
                # không lương" trong văn bản "Quy định thời gian tạo đơn trên
                # HRM" (hệ thống không có loại đơn nghỉ-không-lương riêng — xem
                # comment getLeavePayCategory() ở FE Approvals.tsx) nên phải áp
                # ĐÚNG bậc thang báo trước như Nghỉ phép tháng
                # (leave_style_deadline — 4h nửa ngày / 1-2-7-10 ngày làm việc
                # theo số ngày nghỉ), KHÔNG còn ngoại lệ "đột xuất tạo trong 3h
                # sau khi đi làm trở lại" nữa. Trường hợp đột xuất thực sự phải
                # báo HCNS để HCNS mở "Mở khoá đặc biệt" (has_deadline_exception)
                # thủ công — không còn tự động cho qua trong ứng dụng.
                attendance_date = data.get("attendance_date")
                last_date = end_date or attendance_date
                employee = Employee.objects.filter(id=data.get("employee_id")).first()
                # Snapshot mốc hạn vào đơn NGAY CẢ KHI không bị chặn — để báo
                # cáo đối soát vi phạm cuối tháng đọc lại đúng mốc áp dụng lúc
                # tạo đơn. Nếu tính lại khi chạy báo cáo thì mỗi lần đổi luật
                # là số liệu các tháng cũ đổi theo (như lần đổi 28/09/2026).
                # Đơn Nghỉ phép tháng đã làm vậy từ trước (data['advance_deadline']).
                if attendance_date:
                    data["_advance_deadline"] = leave_style_deadline(
                        attendance_date, last_date, employee,
                        expected_status=data.get("expected_status"),
                        half_day_period=data.get("half_day_period"),
                        reason=data.get("reason", ""),
                    ).isoformat()
                from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
                from .deadline_utils import in_backlog_grace_period
                # "Mở khoá đặc biệt" HCNS cấp cho đúng NV/ngày này (loại
                # UNAUTHORIZED_ABSENCE) — hoặc loại "Huỷ/Sửa đơn đã duyệt"
                # (CANCEL_EDIT_REQUEST_TYPE), vd dùng khi HCNS cho phép nhân
                # sự chuyển đổi đơn Nghỉ phép tháng đã duyệt thành Nghỉ không
                # phép (hoặc ngược lại) sau khi ngày đó đã qua hạn tạo đơn
                # bình thường — luồng "Đổi loại đơn" cần cả huỷ đơn cũ (dùng
                # grant CANCEL_EDIT) LẪN tạo đơn mới quá hạn (ở đây).
                # HCNS cho phép bổ sung nốt đơn Nghỉ không phép phát sinh
                # trước ngày hiệu lực mà nhân sự chưa kịp tạo (chỉ trong thời
                # gian ân hạn — xem BACKLOG_GRACE_PERIOD_END). Trước đây chỉ
                # áp dụng cho Online/Nghỉ phép, bổ sung loại này 2026-09-16.
                if not (
                    in_backlog_grace_period(attendance_date)
                    or has_deadline_exception(employee, attendance_date, "UNAUTHORIZED_ABSENCE")
                    or has_deadline_exception(employee, attendance_date, CANCEL_EDIT_REQUEST_TYPE)
                ):
                    # HCNS chốt 2026-09-28: bỏ mốc "3 giờ sau giờ vào ca ngày
                    # làm việc kế tiếp" (vốn cho phép khai báo SAU khi đã nghỉ)
                    # — nay áp ĐÚNG luật nghỉ phép: phải tạo và duyệt xong từ
                    # hôm trước, bậc thang theo số ngày nghỉ.
                    deadline = leave_style_deadline(
                        attendance_date, last_date, employee,
                        expected_status=data.get("expected_status"),
                        half_day_period=data.get("half_day_period"),
                        reason=data.get("reason", ""),
                    )
                    if timezone.now() > deadline:
                        msg = (f"Đã quá hạn tạo đơn nghỉ không phép (phải tạo và được duyệt "
                               f"chậm nhất {deadline.strftime('%H:%M %d/%m/%Y')}).")
                        # Giữ dấu vết lần bấm bị chặn — xem violation_models.py:
                        # chặn xong là trong HRM không còn gì để thống kê lỗi
                        # "tạo đơn muộn", lẫn luôn với người không tạo đơn gì.
                        from .violation_models import log_blocked_attempt, actor_employee
                        log_blocked_attempt(
                            employee=employee, event_date=attendance_date,
                            request_type="UNAUTHORIZED_ABSENCE", deadline=deadline,
                            error_message=msg, attempted_by=actor_employee(request),
                            end_date=str(last_date) if last_date else None,
                            expected_status=data.get("expected_status") or "",
                        )
                        raise serializers.ValidationError({"attendance_date": msg})
            elif reg_type == "LIVE":
                # Đơn Livestream (Thông báo mục II.3): phải tạo VÀ được duyệt
                # trước ít nhất 2 giờ so với giờ bắt đầu livestream.
                attendance_date = data.get("attendance_date")
                employee_for_check = Employee.objects.filter(id=data.get("employee_id")).first()
                from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
                if not (
                    has_deadline_exception(employee_for_check, attendance_date, "LIVE")
                    or has_deadline_exception(employee_for_check, attendance_date, CANCEL_EDIT_REQUEST_TYPE)
                ):
                    start_time = data.get("start_time")
                    if not start_time:
                        raise serializers.ValidationError(
                            {"start_time": "Cần chọn giờ bắt đầu livestream để kiểm tra hạn tạo đơn "
                                            "(phải tạo đơn trước ít nhất 2 giờ so với giờ bắt đầu)."}
                        )
                    start_dt = _combine_aware(attendance_date, start_time)
                    deadline = hours_before_deadline(start_dt, 2)
                    if timezone.now() > deadline:
                        raise serializers.ValidationError(
                            {"attendance_date": f"Đã quá hạn tạo đơn livestream (phải tạo trước "
                                                 f"{deadline.strftime('%H:%M %d/%m/%Y')}, tức ít nhất 2 giờ "
                                                 f"trước giờ bắt đầu livestream). Liên hệ HCNS để được mở khoá "
                                                 f"đặc biệt nếu có lý do chính đáng."}
                        )

        expected_status = (data.get("expected_status") or "").upper()
        half_day_period = (data.get("half_day_period") or "").upper()
        if expected_status == "HALF_DAY":
            if reg_type != "UNAUTHORIZED_ABSENCE":
                raise serializers.ValidationError(
                    {"expected_status": "Nghỉ nửa ngày chỉ áp dụng cho Đơn nghỉ không phép"}
                )
            if end_date is not None and end_date != data.get("attendance_date"):
                raise serializers.ValidationError(
                    {"expected_status": "Không thể chọn nghỉ nửa ngày cùng lúc với khoảng nhiều ngày"}
                )
            if not half_day_period:
                raise serializers.ValidationError(
                    {"half_day_period": "Chọn nghỉ ca sáng hay ca chiều"}
                )
        elif half_day_period:
            raise serializers.ValidationError(
                {"half_day_period": "Chỉ chọn buổi nghỉ khi đơn là nghỉ nửa ngày"}
            )

        if reg_type == "SHIFT_CHANGE":
            from datetime import date as _date
            from .shift_registration_models import ShiftRegistrationScopeConfig, ShiftRegistrationDay

            to_ca = data.get("to_ca")
            attendance_date = data.get("attendance_date")
            if not to_ca:
                raise serializers.ValidationError({"to_ca": "Ca muốn đổi sang là bắt buộc"})
            if not attendance_date or attendance_date <= _date.today():
                raise serializers.ValidationError({
                    "attendance_date": "Chỉ được tạo đơn đổi ca TRƯỚC ngày đổi ca "
                                        "(ngày đổi ca phải ở tương lai)"
                })

            employee = Employee.objects.filter(id=data.get("employee_id")).first()
            config = ShiftRegistrationScopeConfig.for_employee(employee) if employee else None
            if not employee or not config:
                raise serializers.ValidationError(
                    "Nhân viên không thuộc phạm vi áp dụng đăng ký ca làm nên không thể tạo đơn đổi ca"
                )

            to_ca = int(to_ca)
            if to_ca not in config.valid_ca_choices():
                raise serializers.ValidationError({"to_ca": "Ca đích không hợp lệ"})
            if to_ca == 2 and not config.registration_enabled:
                raise serializers.ValidationError({
                    "to_ca": f"Nhóm này đã ngừng áp dụng {config.registrable_ca_label or 'Ca 2'}"
                })

            day = ShiftRegistrationDay.objects.filter(
                registration__employee=employee, date=attendance_date,
            ).first()
            if not day or not day.ca_choice:
                raise serializers.ValidationError(
                    "Ngày này chưa đăng ký ca làm (hoặc đã đăng ký nghỉ) nên không thể tạo đơn đổi ca"
                )
            if day.ca_choice == to_ca:
                raise serializers.ValidationError({"to_ca": "Ca đích phải khác ca hiện đang đăng ký"})

            data["to_ca"] = to_ca
            data["from_ca"] = day.ca_choice

        elif reg_type in HOURS_BASED_TYPES:
            hours = data.get("hours")
            start = data.get("start_time")
            end   = data.get("end_time")
            # Tính tự động nếu có start/end
            if hours is None and start and end:
                from datetime import datetime, date
                dt_start = datetime.combine(date.today(), start)
                dt_end   = datetime.combine(date.today(), end)
                delta = (dt_end - dt_start).total_seconds() / 3600
                if delta <= 0:
                    raise serializers.ValidationError({"end_time": "Thời gian kết thúc phải sau bắt đầu"})
                data["hours"] = round(min(delta, self.MAX_OVERTIME_HOURS_PER_DAY), 2)
            elif hours is None:
                raise serializers.ValidationError({"hours": f"Số giờ là bắt buộc cho loại {reg_type}"})
            else:
                # Nhập tay: cũng giới hạn không quá MAX_OVERTIME_HOURS_PER_DAY
                data["hours"] = round(min(float(hours), self.MAX_OVERTIME_HOURS_PER_DAY), 2)

            # Sàn 30 phút cho đơn TĂNG CA — Thông báo HCNS 2026-09-23: "OT tối
            # thiểu 30 phút mới được tính. Dưới 30 phút không tính OT." Áp dụng
            # cho CẢ Online lẫn Offline (HCNS chốt 2026-09-23).
            #
            # Trước đây chỉ có engine đối soát chặn, mà engine chỉ xét đơn
            # ONSITE và xét theo giờ CHẤM CÔNG THỰC TẾ — nên đơn Online dưới 30
            # phút luôn lọt, còn đơn Offline dưới 30 phút vẫn được tạo rồi mới
            # bị huỷ sau khi có dữ liệu máy chấm công (cuối tháng).
            if reg_type == "OVERTIME" and data["hours"] * 60 < OT_MIN_DURATION_MINUTES:
                raise serializers.ValidationError(
                    {"hours": f"Tăng ca tối thiểu {OT_MIN_DURATION_MINUTES} phút "
                              f"({OT_MIN_DURATION_MINUTES / 60:.1f} giờ) mới được tính — "
                              f"đơn này chỉ có {round(data['hours'] * 60)} phút."}
                )


        elif reg_type in SESSION_BASED_TYPES:
            # NIGHT_SHIFT, LIVE tính theo buổi/ca, mặc định là 1.0 nếu không truyền
            if data.get("hours") is None:
                data["hours"] = 1.0

        # Validate reason: required for all except OFF_DUTY
        reason = data.get("reason", "").strip()
        if reg_type != "OFF_DUTY" and not reason:
             raise serializers.ValidationError({"reason": "Ghi chú là bắt buộc cho loại đơn này"})

        return data

        return data

    def create(self, validated_data):
        employee        = Employee.objects.get(id=validated_data["employee_id"])
        reg_type        = (validated_data["registration_type"]).upper()
        event_type      = _to_event_type(reg_type)
        attendance_date = validated_data["attendance_date"]
        end_date        = validated_data.get("end_date")
        val_val         = validated_data.get("hours")

        # Generate request_code
        import uuid
        prefix_map = {
            "OVERTIME":      "OT",
            "EXTRA_HOURS":   "EX",
            "NIGHT_SHIFT":   "NS",
            "LIVE":          "LV",
            "OFF_DUTY":      "RT",
            "BUSINESS_TRIP": "BT",
            "UNAUTHORIZED_ABSENCE": "KP",
            "SHIFT_CHANGE":  "SC",
        }
        type_prefix = prefix_map.get(reg_type, reg_type[:3])
        year_month   = attendance_date.strftime('%Y%m')
        request_code = f"{type_prefix}-{year_month}-{str(uuid.uuid4())[:8].upper()}"

        # Đơn nghỉ không phép nhiều ngày liên tiếp: 1 request_code dùng chung, mỗi
        # ngày trong khoảng là 1 EmployeeEvent riêng (để tái sử dụng nguyên vẹn logic
        # tính ngày/duyệt đơn hiện có, vốn hoạt động theo từng ngày một) — bỏ qua
        # những ngày đã có sẵn đơn nghỉ không phép (PENDING/APPROVED) để tránh tạo
        # trùng nếu người dùng chọn khoảng đè lên đơn cũ. REJECTED/CANCELLED không
        # tính là "đang chiếm ngày" (nhân viên được tạo lại) — thiếu CANCELLED ở
        # đây từng khiến huỷ đơn cũ rồi tạo lại vẫn bị chặn nhầm "đã có đơn nghỉ
        # không phép" (case thực tế 2026-09-24: huỷ đơn 26-28/9 để tạo lại 26 và
        # 28 riêng do 27 là Chủ nhật, nhưng bị chặn vì đơn cũ mới CANCELLED).
        if reg_type == "UNAUTHORIZED_ABSENCE" and end_date and end_date != attendance_date:
            import datetime as _dt

            existing_dates = set(
                EmployeeEvent.objects.filter(
                    employee=employee,
                    event_type=EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE,
                    event_date__gte=attendance_date,
                    event_date__lte=end_date,
                ).exclude(
                    Q(data__status="REJECTED") | Q(data__status="CANCELLED")
                ).values_list("event_date", flat=True)
            )

            created_events = []
            skipped_dates = []
            cur = attendance_date
            while cur <= end_date:
                if cur in existing_dates:
                    skipped_dates.append(cur.isoformat())
                else:
                    created_events.append(EmployeeEvent.objects.create(
                        employee   = employee,
                        event_date = cur,
                        event_type = event_type,
                        notes      = validated_data.get("reason", ""),
                        created_by = validated_data.get("created_by"),
                        data={
                            "request_code":      request_code,
                            "registration_type": reg_type,
                            "reason":            validated_data.get("reason", ""),
                            "status":            validated_data.get("status", "PENDING"),
                            "submitted_at":      timezone.now().isoformat(),
                            "start_date":        attendance_date.isoformat(),
                            "end_date":          end_date.isoformat(),
                            # Nghỉ nửa ngày không thể kết hợp với khoảng nhiều ngày
                            # (đã chặn ở validate()) -> luôn là cả ngày ở nhánh này.
                            "expected_status":   "ABSENT",
                            "half_day_period":   "",
                            # Mốc hạn áp dụng lúc tạo — xem chú thích ở validate()
                            "advance_deadline":  validated_data.get("_advance_deadline"),
                        },
                    ))
                cur += _dt.timedelta(days=1)

            if not created_events:
                raise serializers.ValidationError(
                    {"end_date": "Tất cả các ngày trong khoảng đã có đơn nghỉ không phép"}
                )
            return {"created": created_events, "skipped_dates": skipped_dates}

        event = EmployeeEvent.objects.create(
            employee       = employee,
            event_date     = attendance_date,
            event_type     = event_type,
            check_in       = validated_data.get("start_time"),
            check_out      = validated_data.get("end_time"),
            overtime_hours = val_val if reg_type in HOURS_BASED_TYPES else None,
            notes          = validated_data.get("reason", ""),
            created_by     = validated_data.get("created_by"),
            data={
                "request_code":      request_code,
                "registration_type": reg_type,
                "hours":             float(val_val) if reg_type in HOURS_BASED_TYPES else None,
                "sessions":          float(val_val) if reg_type in SESSION_BASED_TYPES else None,
                "reason":            validated_data.get("reason", ""),
                "status":            validated_data.get("status", "PENDING"),
                "submitted_at":      timezone.now().isoformat(),
                **({
                    "from_ca": validated_data.get("from_ca"),
                    "to_ca":   validated_data.get("to_ca"),
                } if reg_type == "SHIFT_CHANGE" else {}),
                **({
                    "expected_status": (validated_data.get("expected_status") or "").upper() or "ABSENT",
                    "half_day_period": (validated_data.get("half_day_period") or "").upper(),
                    "advance_deadline": validated_data.get("_advance_deadline"),
                } if reg_type == "UNAUTHORIZED_ABSENCE" else {}),
                **({
                    "ot_type": (validated_data.get("ot_type") or "").upper(),
                } if reg_type == "OVERTIME" else {}),
            },
        )
        return event


# ─────────────────────────────────────────────────────────────────────────────
# ONLINE WORK REQUEST
# ─────────────────────────────────────────────────────────────────────────────

class OnlineWorkRequestSerializer(serializers.ModelSerializer):
    """Serializer đầy đủ cho OnlineWorkRequest."""

    employee_name                   = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code                   = serializers.CharField(source="employee.employee_id", read_only=True)
    approved_by_name                = serializers.CharField(source="approved_by.full_name", read_only=True)
    direct_manager_approved_by_name = serializers.CharField(
        source="direct_manager_approved_by.full_name", read_only=True
    )
    hr_approved_by_name = serializers.CharField(source="hr_approved_by.full_name", read_only=True)
    rejected_by_name = serializers.SerializerMethodField()
    rejection_level = serializers.CharField(read_only=True)
    hr_rejected_by_name = serializers.CharField(source="hr_rejected_by.full_name", read_only=True)
    direct_manager_rejected_by_name = serializers.CharField(
        source="direct_manager_rejected_by.full_name", read_only=True
    )
    employee_position = serializers.CharField(source='employee.position.title', read_only=True, allow_null=True)
    position_name = serializers.CharField(source='employee.position.title', read_only=True, allow_null=True)
    employee_is_hr      = serializers.SerializerMethodField()
    employee_manager_id             = serializers.SerializerMethodField()
    employee_department_manager_id  = serializers.SerializerMethodField()

    employee_id    = serializers.IntegerField(write_only=True, required=True)
    approved_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    employee    = serializers.PrimaryKeyRelatedField(read_only=True)
    employee_manager_name           = serializers.SerializerMethodField()
    employee_department_manager_name = serializers.SerializerMethodField()
    approved_by = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)
    direct_manager_approved_by = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)
    hr_approved_by             = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)

    class Meta:
        model  = OnlineWorkRequest
        fields = [
            "id", "request_code",
            "employee", "employee_id", "employee_name", "employee_code",
            "work_date", "reason", "evidence",
            "status", "approval_note",
            "approved_by", "approved_by_id", "approved_by_name",
            "approved_at",
            "direct_manager_approved", "hr_approved",
            "direct_manager_approved_at", "hr_approved_at",
            "direct_manager_approved_by", "direct_manager_approved_by_name",
            "hr_approved_by", "hr_approved_by_name",
            "rejected_by_name", "hr_rejected_by_name", "direct_manager_rejected_by_name", "rejection_level",
            "employee_is_hr",
            "employee_position", "position_name",
            "employee_manager_id", "employee_manager_name",
            "employee_department_manager_id", "employee_department_manager_name",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "request_code", "created_at", "updated_at",
            "approved_at", "direct_manager_approved_at", "hr_approved_at",
        ]

    def get_employee_manager_id(self, obj):
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.id
        return None

    def get_employee_manager_name(self, obj):
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.full_name
        return None

    def get_rejected_by_name(self, obj):
        if obj.status == 'REJECTED' and obj.approved_by:
            return obj.approved_by.full_name
        return None

    def get_employee_department_manager_id(self, obj):
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.id
        return None

    def get_employee_department_manager_name(self, obj):
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.full_name
        return None

    def get_employee_is_hr(self, obj):
        return _is_hr(obj.employee) if obj.employee else False

    def create(self, validated_data):
        employee_id    = validated_data.pop("employee_id")
        approved_by_id = validated_data.pop("approved_by_id", None)

        try:
            validated_data["employee"] = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")

        if approved_by_id:
            try:
                validated_data["approved_by"] = Employee.objects.get(id=approved_by_id)
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {approved_by_id} does not exist")

        return OnlineWorkRequest.objects.create(**validated_data)

    def update(self, instance, validated_data):
        employee_id    = validated_data.pop("employee_id", None)
        approved_by_id = validated_data.pop("approved_by_id", None)

        if employee_id is not None:
            try:
                instance.employee = Employee.objects.get(id=employee_id)
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")

        if approved_by_id is not None:
            try:
                instance.approved_by = Employee.objects.get(id=approved_by_id)
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {approved_by_id} does not exist")

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance

class OnlineWorkEventCreateSerializer(serializers.Serializer):
    """Input serializer for POST /api-hrm/online-work-requests/ (EmployeeEvent-backed)."""
    employee_id    = serializers.IntegerField()
    work_date      = serializers.DateField()
    reason         = serializers.CharField(required=True, allow_blank=False)
    status         = serializers.CharField(required=False, default="PENDING")
    expected_status = serializers.CharField(required=False, allow_null=True)
    half_day_period = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    evidence       = serializers.FileField(required=False, allow_null=True)

    def validate_employee_id(self, value):
        if not Employee.objects.filter(id=value).exists():
            raise serializers.ValidationError(f"Employee with ID {value} does not exist")
        return value

    def create(self, validated_data):
        employee = Employee.objects.get(id=validated_data["employee_id"])
        work_date = validated_data["work_date"]
        
        from django.utils import timezone  # noqa – giữ để tương thích nếu file-level bị xóa
        import uuid
        year_month = work_date.strftime('%Y%m')
        request_code = f"WFH-{year_month}-{str(uuid.uuid4())[:8].upper()}"

        event = EmployeeEvent.objects.create(
            employee   = employee,
            event_date = work_date,
            event_type = EmployeeEvent.EventType.ONLINE_WORK,
            notes      = validated_data.get("reason", ""),
            data={
                "request_code":            request_code,
                "registration_type":       "ONLINE_WORK",
                "reason":                  validated_data.get("reason", ""),
                "status":                  validated_data.get("status", "PENDING"),
                "expected_status":         validated_data.get("expected_status"),
                "half_day_period":         validated_data.get("half_day_period"),
                "submitted_at":            timezone.now().isoformat(),
                "direct_manager_approved": False,
                "hr_approved":             False,
                "work_date":               str(work_date),
            },
        )
        return event

class OnlineWorkRequestListSerializer(serializers.ModelSerializer):
    """Serializer rút gọn cho OnlineWorkRequest list view."""

    employee_name   = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code   = serializers.CharField(source="employee.employee_id", read_only=True)
    employee_id     = serializers.IntegerField(source="employee.id", read_only=True)
    approved_by_name                = serializers.SerializerMethodField()
    direct_manager_approved_by_name = serializers.SerializerMethodField()
    hr_approved_by_name             = serializers.SerializerMethodField()
    employee_manager_id             = serializers.SerializerMethodField()
    employee_manager_name           = serializers.SerializerMethodField()
    employee_department_manager_id  = serializers.SerializerMethodField()
    employee_department_manager_name = serializers.SerializerMethodField()
    employee_is_hr                  = serializers.SerializerMethodField()
    employee_is_senior_manager      = serializers.SerializerMethodField()
    employee_position               = serializers.CharField(source="employee.position.title", read_only=True, allow_null=True)
    position_name                   = serializers.CharField(source="employee.position.title", read_only=True, allow_null=True)

    class Meta:
        model  = OnlineWorkRequest
        fields = [
            "id", "request_code",
            "employee_id", "employee_name", "employee_code",
            "work_date", "reason", "status",
            "approved_by_name", "approved_at",
            "direct_manager_approved", "hr_approved",
            "direct_manager_approved_at", "hr_approved_at",
            "direct_manager_approved_by_name", "hr_approved_by_name",
            "employee_manager_id", "employee_manager_name",
            "employee_department_manager_id", "employee_department_manager_name",
            "employee_is_hr",
            "employee_is_senior_manager",
            "employee_position",
            "position_name",
            "created_at",
        ]

    def get_approved_by_name(self, obj):
        return obj.approved_by.full_name if obj.approved_by else None

    def get_direct_manager_approved_by_name(self, obj):
        return obj.direct_manager_approved_by.full_name if obj.direct_manager_approved_by else None

    def get_hr_approved_by_name(self, obj):
        return obj.hr_approved_by.full_name if obj.hr_approved_by else None

    def get_employee_manager_id(self, obj):
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.id
        return None

    def get_employee_manager_name(self, obj):
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.full_name
        return None

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        from .stats_utils import get_employee_monthly_stats
        stats = get_employee_monthly_stats(instance.employee, instance.work_date)
        ret.update(stats)
        return ret

    def get_employee_department_manager_id(self, obj):
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.id
        return None

    def get_employee_department_manager_name(self, obj):
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.full_name
        return None

    def get_employee_is_hr(self, obj):
        return _is_hr(obj.employee) if obj.employee else False

    def get_employee_is_senior_manager(self, obj):
        return is_senior_manager(obj.employee) if obj.employee else False
