"""
hrm/edit_attendance_views.py
════════════════════════════
API cho phép sửa dữ liệu chấm công (check_in / check_out) trên EmployeeEvent.

Chỉ superuser hoặc nhân viên có quyền `can_edit_attendance` mới được gọi API này.

Endpoint:
  POST /api/v1/hrm/attendance/edit-attendance/
  Body:
    {
      "employee_id": <int>,
      "date":        "YYYY-MM-DD",
      "check_in":    "HH:MM" hoặc "HH:MM:SS" hoặc null  (tùy chọn),
      "check_out":   "HH:MM" hoặc "HH:MM:SS" hoặc null  (tùy chọn)
    }
"""

import datetime
import logging

from django.db import transaction
from django.utils import timezone

from rest_framework import status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from employee.models import Employee
from .event_models import EmployeeEvent, EmployeeEventAuditLog
from .models import EmployeePermission

logger = logging.getLogger(__name__)


def _ok(data, status_code=status.HTTP_200_OK):
    return Response({"success": True, "data": data}, status=status_code)


def _err(msg, status_code=status.HTTP_400_BAD_REQUEST, details=None):
    body = {"success": False, "error": msg}
    if details:
        body["details"] = details
    return Response(body, status=status_code)


def _has_edit_attendance_permission(user):
    """
    Trả về True nếu user là superuser/staff hoặc có quyền can_edit_attendance.
    """
    if user.is_staff or user.is_superuser:
        return True
    try:
        employee = Employee.objects.get(user=user)
        perm = EmployeePermission.objects.get(employee=employee)
        return perm.can_edit_attendance
    except (Employee.DoesNotExist, EmployeePermission.DoesNotExist):
        return False


def _parse_time(value):
    """
    Chuyển chuỗi HH:MM hoặc HH:MM:SS thành datetime.time.
    Trả về None nếu giá trị là None.
    Raise ValueError nếu định dạng không hợp lệ.
    """
    if value is None:
        return None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.datetime.strptime(str(value), fmt).time()
        except ValueError:
            continue
    raise ValueError(f"Định dạng giờ không hợp lệ: '{value}'. Cần HH:MM hoặc HH:MM:SS.")


def _time_to_str(value):
    return value.isoformat() if value else None


def _event_audit_values(event):
    return {
        "employee_id": event.employee_id,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "event_type": event.event_type,
        "check_in": _time_to_str(event.check_in),
        "check_out": _time_to_str(event.check_out),
        "data": event.data,
        "notes": event.notes,
    }


def _get_current_employee(user):
    try:
        return Employee.objects.get(user=user)
    except Employee.DoesNotExist:
        return None


def _get_actor_role(user, employee):
    if user.is_superuser or user.is_staff:
        return "admin"
    if employee and getattr(employee, "is_hr", False):
        return "hr"
    return "user"


def _log_event_audit(event, action, old_values, new_values, changed_fields, request, actor_employee):
    EmployeeEventAuditLog.objects.create(
        event=event,
        employee=event.employee,
        action=action,
        old_values=old_values,
        new_values=new_values,
        changed_fields=changed_fields,
        performed_by_user=request.user,
        performed_by_employee=actor_employee,
        performed_by_role=_get_actor_role(request.user, actor_employee),
        request_payload=dict(request.data),
    )


class EditAttendanceView(APIView):
    """
    Sửa dữ liệu chấm công (check_in / check_out) trên EmployeeEvent.

    Yêu cầu quyền: superuser hoặc can_edit_attendance.

    POST /api/v1/hrm/attendance/edit-attendance/
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        # ── 1. Kiểm tra quyền ─────────────────────────────────────────────────
        if not _has_edit_attendance_permission(request.user):
            return _err(
                "Bạn không có quyền sửa dữ liệu chấm công.",
                status.HTTP_403_FORBIDDEN,
            )

        # ── 2. Validate input ─────────────────────────────────────────────────
        data = request.data
        employee_id = data.get("employee_id")
        date_str = data.get("date")
        has_check_in = "check_in" in data
        has_check_out = "check_out" in data
        check_in_raw = data.get("check_in")
        check_out_raw = data.get("check_out")

        if not employee_id:
            return _err("Trường 'employee_id' là bắt buộc.")
        if not date_str:
            return _err("Trường 'date' là bắt buộc (định dạng YYYY-MM-DD).")
        if not has_check_in and not has_check_out:
            return _err("Phải cung cấp ít nhất một trong hai trường 'check_in' hoặc 'check_out'.")

        # Parse date
        try:
            event_date = datetime.date.fromisoformat(str(date_str))
        except ValueError:
            return _err(f"Định dạng ngày không hợp lệ: '{date_str}'. Cần YYYY-MM-DD.")

        # Parse time values
        try:
            check_in = _parse_time(check_in_raw)
            check_out = _parse_time(check_out_raw)
        except ValueError as exc:
            return _err(str(exc))

        # ── 3. Lấy Employee ───────────────────────────────────────────────────
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return _err(f"Không tìm thấy nhân viên với id={employee_id}.", status.HTTP_404_NOT_FOUND)

        # ── 4. Lấy hoặc tạo EmployeeEvent ATTENDANCE cho ngày đó ─────────────
        with transaction.atomic():
            actor_employee = _get_current_employee(request.user)
            event = (
                EmployeeEvent.objects
                .select_for_update()
                .filter(
                    employee=employee,
                    event_date=event_date,
                    event_type=EmployeeEvent.EventType.ATTENDANCE,
                )
                .first()
            )

            created = False
            if event is None:
                event = EmployeeEvent.objects.create(
                    employee=employee,
                    event_date=event_date,
                    event_type=EmployeeEvent.EventType.ATTENDANCE,
                    check_in=check_in,
                    check_out=check_out,
                    data={
                        "source": "manual_edit",
                        "last_edited_by": request.user.id,
                        "last_edited_at": timezone.now().isoformat(),
                    },
                )
                _log_event_audit(
                    event=event,
                    action=EmployeeEventAuditLog.Action.CREATE,
                    old_values=None,
                    new_values=_event_audit_values(event),
                    changed_fields=["check_in", "check_out", "data"],
                    request=request,
                    actor_employee=actor_employee,
                )
                created = True
            else:
                old_values = _event_audit_values(event)

                # Cập nhật chỉ những trường được gửi lên; null dùng để xoá dữ liệu.
                if has_check_in:
                    event.check_in = check_in
                if has_check_out:
                    event.check_out = check_out

                event_data = dict(event.data or {})
                event_data["source"] = "manual_edit"
                event_data["last_edited_by"] = request.user.id
                event_data["last_edited_at"] = timezone.now().isoformat()
                event.data = event_data
                new_values = _event_audit_values(event)
                changed_fields = [
                    field
                    for field in ("check_in", "check_out", "data", "notes")
                    if old_values.get(field) != new_values.get(field)
                ]
                if changed_fields:
                    _log_event_audit(
                        event=event,
                        action=EmployeeEventAuditLog.Action.UPDATE,
                        old_values=old_values,
                        new_values=new_values,
                        changed_fields=changed_fields,
                        request=request,
                        actor_employee=actor_employee,
                    )
                event.save()

        return _ok(
            {
                "id": event.id,
                "employee_id": employee.id,
                "employee_code": getattr(employee, "employee_id", None),
                "employee_name": employee.full_name,
                "date": event.event_date.isoformat(),
                "check_in": str(event.check_in) if event.check_in else None,
                "check_out": str(event.check_out) if event.check_out else None,
                "created": created,
            },
            status_code=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
