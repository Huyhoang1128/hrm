"""
Finalization Lock API — Đóng / Mở chốt công theo tháng.

Endpoints:
  GET  /api-hrm/finalization-lock/status/   ?year=&month=   → trạng thái lock
  POST /api-hrm/finalization-lock/toggle/                    → đóng / mở
  GET  /api-hrm/finalization-lock/list/                      → danh sách tất cả tháng
  GET  /api-hrm/finalization-lock/check/    ?year=&month=   → check cho NV/Manager
  GET  /api-hrm/finalization-lock/<pk>/logs/                 → lịch sử thao tác
  GET  /api-hrm/finalization-lock/employee-overrides/        → ds ngoại lệ theo NV
       ?year=&month=&period=
  POST /api-hrm/finalization-lock/employee-overrides/        → khóa/mở riêng cho 1-n NV
  DELETE /api-hrm/finalization-lock/employee-overrides/<pk>/ → gỡ ngoại lệ (theo lock chung)
"""

import logging
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone

from .models import FinalizationLock, FinalizationLockLog, FinalizationLockEmployeeOverride

logger = logging.getLogger(__name__)


# ────────────────────────────────────
# Helpers
# ────────────────────────────────────

def _is_hr_or_admin(request):
    """True nếu user là HR hoặc admin/superuser."""
    user = request.user
    if user.is_staff or user.is_superuser:
        return True
    try:
        employee = user.employee
        if employee.is_hr:
            return True
        from .models import _has_approve_permission
        return _has_approve_permission(employee)
    except Exception:
        return False


def _get_user_role(request):
    """Trả về role string: ADMIN, HR, hoặc USER."""
    user = request.user
    if user.is_superuser or user.is_staff:
        return 'ADMIN'
    try:
        employee = user.employee
        if employee.is_hr:
            return 'HR'
        from .models import _has_approve_permission
        if _has_approve_permission(employee):
            return 'HR'
    except Exception:
        pass
    return 'USER'


def _validate_year_month(request):
    """Parse & validate year/month từ query params hoặc body."""
    year = request.query_params.get('year') or request.data.get('year')
    month = request.query_params.get('month') or request.data.get('month')
    if not year or not month:
        return None, None, Response(
            {"error": "Thiếu tham số year và month."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        year, month = int(year), int(month)
    except (ValueError, TypeError):
        return None, None, Response(
            {"error": "year và month phải là số nguyên."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if month < 1 or month > 12:
        return None, None, Response(
            {"error": "month phải từ 1 đến 12."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if year < 2000 or year > 2100:
        return None, None, Response(
            {"error": "year phải từ 2000 đến 2100."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return year, month, None


def _to_iso(val):
    """An toàn convert datetime hoặc string → ISO string."""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    return val.isoformat()


def _get_user_display(user):
    """Trả về (display, full_name, employee_code).
    display = 'mã NV - Họ Tên' hoặc username nếu không có employee.
    """
    if not user:
        return None, None, None
    full_name = None
    employee_code = None
    try:
        emp = user.employee
        full_name = emp.full_name
        employee_code = emp.employee_id
    except Exception:
        pass
    if not full_name:
        full_name = user.get_full_name() or user.username
    if not employee_code:
        employee_code = user.username
    display = f"{employee_code} - {full_name}"
    return display, full_name, employee_code


def _serialize_lock(lock):
    """Chuyển FinalizationLock → dict."""
    locked_by_display, locked_by_name, locked_by_code = _get_user_display(lock.locked_by)
    unlocked_by_display, unlocked_by_name, unlocked_by_code = _get_user_display(lock.unlocked_by)

    return {
        "id": lock.id,
        "year": lock.year,
        "month": lock.month,
        "period": lock.period,
        "period_display": lock.get_period_display(),
        "is_locked": lock.is_locked,
        "lock_start_at": _to_iso(lock.lock_start_at),
        "locked_by": locked_by_display,
        "locked_by_name": locked_by_name,
        "locked_by_code": locked_by_code,
        "locked_by_id": lock.locked_by_id,
        "locked_at": _to_iso(lock.locked_at),
        "unlocked_by": unlocked_by_display,
        "unlocked_by_name": unlocked_by_name,
        "unlocked_by_code": unlocked_by_code,
        "unlocked_by_id": lock.unlocked_by_id,
        "unlocked_at": _to_iso(lock.unlocked_at),
        "note": lock.note,
        "created_at": _to_iso(lock.created_at),
        "updated_at": _to_iso(lock.updated_at),
    }


def _get_or_create_lock(year, month, period):
    """Lấy hoặc tạo lock row cho (year, month, period)."""
    lock, _ = FinalizationLock.objects.get_or_create(
        year=year, month=month, period=period,
    )
    return lock


def _validate_period(request, default=None):
    """Parse period từ query params hoặc body. Trả về (period, error_response)."""
    period = request.query_params.get('period') or request.data.get('period') or default
    if period is None:
        return None, None
    if period not in ('FIRST_HALF', 'SECOND_HALF'):
        return None, Response(
            {"error": "period phải là FIRST_HALF hoặc SECOND_HALF."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return period, None


# ────────────────────────────────────
# GET  .../status/   ?year=&month=
# ────────────────────────────────────

class FinalizationLockStatusView(APIView):
    """Lấy trạng thái lock của một tháng theo 2 nửa. ADMIN / HR."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền xem trạng thái khóa chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(request)
        if err:
            return err

        period, err = _validate_period(request)
        if err:
            return err

        if period:
            lock = _get_or_create_lock(year, month, period)
            lock.check_schedule()
            return Response(_serialize_lock(lock))

        # Default: trả cả 2 nửa
        first = _get_or_create_lock(year, month, 'FIRST_HALF')
        second = _get_or_create_lock(year, month, 'SECOND_HALF')
        first.check_schedule()
        second.check_schedule()
        return Response({
            "year": year,
            "month": month,
            "first_half": _serialize_lock(first),
            "second_half": _serialize_lock(second),
        })


# ────────────────────────────────────
# POST .../toggle/
# ────────────────────────────────────

class FinalizationLockToggleView(APIView):
    """Đóng / Mở chốt công cho một tháng. ADMIN / HR."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền đóng/mở chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(request)
        if err:
            return err

        period, err = _validate_period(request)
        if err:
            return err
        if not period:
            return Response(
                {"error": "Thiếu tham số period (FIRST_HALF hoặc SECOND_HALF)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_locked = request.data.get('is_locked')
        if is_locked is None:
            return Response(
                {"error": "Thiếu tham số is_locked (true/false)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        is_locked = bool(is_locked)

        note = request.data.get('note', '')
        lock_start_at = request.data.get('lock_start_at')  # ISO string or None

        now = timezone.now()
        user = request.user
        role = _get_user_role(request)

        lock, created = FinalizationLock.objects.get_or_create(
            year=year, month=month, period=period,
            defaults={'note': note},
        )

        if not created:
            lock.note = note

        # Cập nhật lịch tự động nếu có gửi
        if 'lock_start_at' in request.data:
            lock.lock_start_at = lock_start_at  # None để xóa

        # Nếu có lock_start_at trong tương lai → chỉ lưu lịch, chưa khóa ngay
        from django.utils.dateparse import parse_datetime
        schedule_only = False
        if is_locked and lock.lock_start_at:
            start_dt = lock.lock_start_at if isinstance(lock.lock_start_at, timezone.datetime) else parse_datetime(str(lock.lock_start_at))
            if start_dt and start_dt > now:
                # Lịch trong tương lai → lưu lịch, giữ nguyên mở
                lock.is_locked = False
                schedule_only = True
            else:
                # Lịch đã qua hoặc đúng lúc → khóa ngay
                lock.is_locked = True
                lock.locked_by = user
                lock.locked_at = now
        elif is_locked:
            # Không có lịch → khóa ngay
            lock.is_locked = True
            lock.locked_by = user
            lock.locked_at = now
        else:
            # Mở khóa
            lock.is_locked = False
            lock.unlocked_by = user
            lock.unlocked_at = now
            # Xóa lock_start_at cũ đã qua để check_schedule() không tự khóa lại
            if lock.lock_start_at:
                start_dt = lock.lock_start_at if isinstance(lock.lock_start_at, timezone.datetime) else parse_datetime(str(lock.lock_start_at))
                if start_dt and start_dt <= now:
                    lock.lock_start_at = None

        lock.save()

        # Ghi audit log
        if schedule_only:
            action_log = 'LOCKED'
            action_text = f"Đã đặt lịch khóa ({lock.lock_start_at})"
        elif is_locked:
            action_log = 'LOCKED'
            action_text = "Đã khóa"
        else:
            action_log = 'UNLOCKED'
            action_text = "Đã mở"

        FinalizationLockLog.objects.create(
            lock=lock,
            action=action_log,
            performed_by=user,
            performed_by_role=role,
            note=note if not schedule_only else (note or f"Đặt lịch khóa lúc {lock.lock_start_at}"),
        )

        logger.info(
            f"[FinalizationLock] {action_text} tháng {month}/{year} {lock.get_period_display()} "
            f"bởi {user.username} ({role})"
        )

        return Response({
            "message": f"{action_text} chốt công tháng {month}/{year} — {lock.get_period_display()}.",
            "performed_by": user.get_full_name() or user.username,
            "performed_by_role": role,
            **_serialize_lock(lock),
        })


# ────────────────────────────────────
# GET  .../list/
# ────────────────────────────────────

class FinalizationLockListView(APIView):
    """Danh sách trạng thái lock tất cả tháng. ADMIN / HR."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền xem danh sách khóa chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        year = request.query_params.get('year')
        qs = FinalizationLock.objects.all()
        if year:
            try:
                qs = qs.filter(year=int(year))
            except (ValueError, TypeError):
                pass

        # Auto-lock nếu quá deadline
        for lock in qs:
            lock.check_schedule()

        return Response([_serialize_lock(lock) for lock in qs])


# ────────────────────────────────────
# GET  .../check/   ?year=&month=
# ────────────────────────────────────

class FinalizationLockCheckView(APIView):
    """
    Endpoint cho tất cả user (NV, Manager, HR, Admin) check lock.
    Có thể truyền:
      - period: FIRST_HALF/SECOND_HALF → check 1 nửa cụ thể
      - day (1-31)                     → tự derive period
      - không truyền                    → check cả 2 nửa, locked nếu BẤT KỲ nửa nào khóa
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month, err = _validate_year_month(request)
        if err:
            return err

        period, err = _validate_period(request)
        if err:
            return err

        day = request.query_params.get('day')
        if day is not None:
            try:
                day = int(day)
                if not period:
                    period = FinalizationLock.period_for_day(day)
            except (ValueError, TypeError):
                day = None

        if period:
            lock = _get_or_create_lock(year, month, period)
            lock.check_schedule()
            message = None
            if lock.is_locked:
                locked_by_name = ""
                if lock.locked_by:
                    locked_by_name = lock.locked_by.get_full_name() or lock.locked_by.username
                message = (
                    f"Tháng {month}/{year} — {lock.get_period_display()} đã đóng chốt công. "
                    f"Không thể tạo đơn hoặc phê duyệt cho khoảng ngày này."
                )
                if locked_by_name:
                    message += f" (Khóa bởi: {locked_by_name})"
            return Response({
                "year": year,
                "month": month,
                "period": lock.period,
                "is_locked": lock.is_locked,
                "message": message,
                "lock_start_at": _to_iso(lock.lock_start_at),
                "locked_at": _to_iso(lock.locked_at),
            })

        # Không có period/day → trả cả 2 nửa
        first = _get_or_create_lock(year, month, 'FIRST_HALF')
        second = _get_or_create_lock(year, month, 'SECOND_HALF')
        first.check_schedule()
        second.check_schedule()
        any_locked = first.is_locked or second.is_locked
        return Response({
            "year": year,
            "month": month,
            "is_locked": any_locked,
            "first_half_locked": first.is_locked,
            "second_half_locked": second.is_locked,
            "message": (
                f"Tháng {month}/{year}: nửa đầu {'khóa' if first.is_locked else 'mở'}, "
                f"nửa sau {'khóa' if second.is_locked else 'mở'}."
            ) if any_locked else None,
        })


# ────────────────────────────────────
# GET  .../<pk>/logs/
# ────────────────────────────────────

class FinalizationLockLogView(APIView):
    """Lịch sử thao tác đóng/mở của một lock. ADMIN / HR."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền xem lịch sử."},
                status=status.HTTP_403_FORBIDDEN,
            )

        logs = FinalizationLockLog.objects.filter(lock_id=pk).select_related('performed_by')
        return Response([
            {
                "id": log.id,
                "action": log.action,
                "action_display": log.get_action_display(),
                "performed_by": (
                    log.performed_by.get_full_name() or log.performed_by.username
                ) if log.performed_by else None,
                "performed_by_role": log.performed_by_role,
                "note": log.note,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ])


# ────────────────────────────────────
# GET/POST  .../employee-overrides/
# ────────────────────────────────────

def _serialize_override(ov):
    created_by_display, _, _ = _get_user_display(ov.created_by)
    return {
        "id": ov.id,
        "year": ov.year,
        "month": ov.month,
        "period": ov.period,
        "period_display": ov.get_period_display(),
        "employee_id": ov.employee_id,
        "employee_code": ov.employee.employee_id,
        "employee_name": ov.employee.full_name,
        "is_unlocked": ov.is_unlocked,
        "note": ov.note,
        "created_by": created_by_display,
        "created_at": _to_iso(ov.created_at),
        "updated_at": _to_iso(ov.updated_at),
    }


class FinalizationLockEmployeeOverrideView(APIView):
    """
    Khóa/Mở khóa RIÊNG cho 1 hoặc nhiều nhân viên trong 1 (year, month, period),
    độc lập với khóa chung toàn công ty. ADMIN / HR.

    GET  ?year=&month=&period=                         → danh sách override hiện có
    POST {year, month, period, employee_ids: [...],
          is_unlocked: true/false, note}                → set override cho từng NV
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền xem danh sách ngoại lệ khóa chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(request)
        if err:
            return err

        period, err = _validate_period(request)
        if err:
            return err

        qs = FinalizationLockEmployeeOverride.objects.filter(
            year=year, month=month,
        ).select_related('employee', 'created_by')
        if period:
            qs = qs.filter(period=period)

        return Response([_serialize_override(ov) for ov in qs])

    def post(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền khóa/mở khóa riêng cho nhân viên."},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(request)
        if err:
            return err

        period, err = _validate_period(request)
        if err:
            return err
        if not period:
            return Response(
                {"error": "Thiếu tham số period (FIRST_HALF hoặc SECOND_HALF)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_ids = request.data.get('employee_ids') or []
        if not isinstance(employee_ids, list) or not employee_ids:
            return Response(
                {"error": "Thiếu tham số employee_ids (danh sách id nhân viên)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_unlocked = request.data.get('is_unlocked')
        if is_unlocked is None:
            return Response(
                {"error": "Thiếu tham số is_unlocked (true/false)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        is_unlocked = bool(is_unlocked)
        note = request.data.get('note', '')

        from employee.models import Employee
        employees = list(Employee.objects.filter(id__in=employee_ids))
        found_ids = {e.id for e in employees}
        missing_ids = [eid for eid in employee_ids if eid not in found_ids]

        results = []
        for employee in employees:
            override, _created = FinalizationLockEmployeeOverride.objects.update_or_create(
                year=year, month=month, period=period, employee=employee,
                defaults={
                    'is_unlocked': is_unlocked,
                    'note': note,
                    'created_by': request.user,
                },
            )
            results.append(_serialize_override(override))

        action_text = "Mở khóa riêng" if is_unlocked else "Khóa riêng"
        logger.info(
            f"[FinalizationLockEmployeeOverride] {action_text} {len(results)} NV "
            f"— tháng {month}/{year} {period} — bởi {request.user.username}"
        )

        return Response({
            "message": f"{action_text} cho {len(results)} nhân viên — tháng {month}/{year}.",
            "overrides": results,
            "missing_employee_ids": missing_ids,
        })


# ────────────────────────────────────
# DELETE  .../employee-overrides/<pk>/
# ────────────────────────────────────

class FinalizationLockEmployeeOverrideDetailView(APIView):
    """Gỡ 1 ngoại lệ khóa riêng theo NV — quay lại theo khóa chung. ADMIN / HR."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền gỡ ngoại lệ khóa chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        override = FinalizationLockEmployeeOverride.objects.filter(pk=pk).first()
        if not override:
            return Response({"error": "Không tìm thấy ngoại lệ."}, status=status.HTTP_404_NOT_FOUND)

        employee_code = override.employee.employee_id
        override.delete()
        logger.info(
            f"[FinalizationLockEmployeeOverride] Gỡ override NV={employee_code} "
            f"(id={pk}) bởi {request.user.username}"
        )
        return Response({"message": f"Đã gỡ ngoại lệ khóa riêng cho {employee_code}."})
