"""
FinalizationLockMixin — Kiểm tra khóa chốt công trước khi cho phép
tạo đơn / phê duyệt / chốt công.

Trả HTTP 423 Locked khi tháng đã bị khóa.

Bypass rules:
  - Tạo đơn:       Admin bypass
  - Phê duyệt:     Admin + HR bypass
  - Chốt công:     không ai bypass
"""

import logging
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone

from .models import FinalizationLock
from users.utils import get_user_display_name

logger = logging.getLogger(__name__)


def _is_admin(request):
    """User là staff hoặc superuser."""
    return request.user.is_staff or request.user.is_superuser


def _is_hr_or_admin(request):
    """User là HR hoặc Admin."""
    if _is_admin(request):
        return True
    try:
        employee = request.user.employee
        if employee.is_hr:
            return True
        from .models import _has_approve_permission
        return _has_approve_permission(employee)
    except Exception:
        return False


def check_finalization_lock(year, month, day=None, period=None, employee=None):
    """
    Kiểm tra lock cho year/month theo NỬA THÁNG.

    Args:
        year, month: tháng cần check.
        day: ngày cụ thể (1-31). Nếu cung cấp → derive period (1-15 FIRST_HALF, 16+ SECOND_HALF).
        period: 'FIRST_HALF' / 'SECOND_HALF' / None.
            Nếu cả day và period đều None → check BOTH periods:
                locked nếu BẤT KỲ period nào đang khóa.
        employee: Employee instance (tùy chọn) — nếu cung cấp CÙNG với period xác
            định cụ thể (period hoặc day), sẽ ưu tiên áp dụng
            FinalizationLockEmployeeOverride riêng cho nhân viên này, ghi đè lên
            trạng thái khóa chung: mở riêng cho NV dù period đang khóa chung,
            hoặc khóa riêng NV dù period đang mở chung. Bỏ qua khi period không
            xác định được cụ thể (check cả 2 nửa cùng lúc).

    Returns:
        (is_locked: bool, lock_obj_or_None, error_response_or_None)
    """
    try:
        qs = FinalizationLock.objects.filter(year=year, month=month)
    except Exception:
        return False, None, None

    if period is None and day is not None:
        period = FinalizationLock.period_for_day(day)

    if period:
        qs = qs.filter(period=period)

    locks = list(qs)

    locked_lock = None
    for lock in locks:
        lock.check_schedule()
        if lock.is_locked and locked_lock is None:
            locked_lock = lock

    # ── Employee-specific override ────────────────────────────────────────
    override = None
    if employee is not None and period:
        from .models import FinalizationLockEmployeeOverride
        override = FinalizationLockEmployeeOverride.objects.filter(
            year=year, month=month, period=period, employee=employee,
        ).first()

    if override is not None and locked_lock is not None and override.is_unlocked:
        # Period khóa chung nhưng NV này đã được mở riêng — bỏ qua khóa.
        return False, locked_lock, None

    if override is not None and locked_lock is None and not override.is_unlocked:
        # Period đang mở chung nhưng NV này bị khóa riêng.
        period_label = dict(FinalizationLock.PERIOD_CHOICES).get(period, period)
        response = Response(
            {
                "error": "FINALIZATION_LOCKED",
                "message": (
                    f"Tháng {month}/{year} — {period_label}: nhân viên này đang bị khóa riêng "
                    f"tạo đơn giải trình. Vui lòng liên hệ HCNS để biết chi tiết."
                ),
                "year": year,
                "month": month,
                "period": period,
                "period_display": period_label,
                "employee_override": True,
            },
            status=423,
        )
        return True, None, response

    if not locked_lock:
        return False, (locks[0] if locks else None), None

    lock = locked_lock
    locked_by_name = ""
    locked_by_role = ""
    if lock.locked_by:
        locked_by_name = get_user_display_name(lock.locked_by)
        if lock.locked_by.is_superuser or lock.locked_by.is_staff:
            locked_by_role = "ADMIN"
        else:
            try:
                if lock.locked_by.employee.is_hr:
                    locked_by_role = "HR"
            except Exception:
                locked_by_role = "ADMIN"

    period_label = lock.get_period_display()
    response = Response(
        {
            "error": "FINALIZATION_LOCKED",
            "message": (
                f"Tháng {month}/{year} — {period_label} đã đóng chốt công. "
                f"Không thể thực hiện thao tác cho khoảng ngày này. "
                f"Vui lòng liên hệ HCNS để biết chi tiết."
            ),
            "year": year,
            "month": month,
            "period": lock.period,
            "period_display": period_label,
            "locked_at": lock.locked_at.isoformat() if lock.locked_at else None,
            "locked_by": locked_by_name,
            "locked_by_role": locked_by_role,
        },
        status=423,  # HTTP 423 Locked
    )
    return True, lock, response


def require_both_halves_locked(year, month):
    """
    Yêu cầu CẢ HAI nửa tháng phải khóa trước khi cho phép "Chốt tất cả".
    Returns (ok: bool, error_response_or_None).
    """
    locks = FinalizationLock.objects.filter(year=year, month=month)
    first = next((l for l in locks if l.period == 'FIRST_HALF'), None)
    second = next((l for l in locks if l.period == 'SECOND_HALF'), None)
    for lock in locks:
        lock.check_schedule()

    first_ok = first and first.is_locked
    second_ok = second and second.is_locked
    if first_ok and second_ok:
        return True, None

    missing = []
    if not first_ok:
        missing.append("Nửa đầu (1-15)")
    if not second_ok:
        missing.append("Nửa sau (16-cuối)")

    response = Response(
        {
            "error": "FINALIZATION_REQUIRES_BOTH_HALVES_LOCKED",
            "message": (
                f"Cần khóa cả 2 nửa tháng trước khi chốt công tháng {month}/{year}. "
                f"Chưa khóa: {', '.join(missing)}."
            ),
            "year": year,
            "month": month,
            "first_half_locked": bool(first_ok),
            "second_half_locked": bool(second_ok),
        },
        status=423,
    )
    return False, response


class FinalizationLockMixin:
    """
    Mixin cho View/ViewSet.

    assert_not_locked(year, month, request, allow_admin, allow_hr)
      - allow_admin=True  → Admin bypass lock
      - allow_hr=True     → HR bypass lock
    """

    def assert_not_locked(self, year, month, request=None,
                          allow_admin=False, allow_hr=False,
                          day=None, period=None, employee=None):
        """
        Trả về Response 423 nếu period bị khóa và user không được bypass.
        None nếu OK (không bị khóa hoặc user được phép).

        day/period: nếu cung cấp → check 1 nửa cụ thể; nếu None → check cả 2 nửa.
        employee: nếu cung cấp → áp dụng ngoại lệ khóa/mở riêng cho NV này
            (xem check_finalization_lock).
        """
        is_locked, lock, response = check_finalization_lock(
            year, month, day=day, period=period, employee=employee
        )
        if not is_locked:
            return None

        # Kiểm tra bypass
        if request:
            if allow_admin and _is_admin(request):
                logger.info(
                    f"[FinalizationLock] Admin bypass for {month}/{year} "
                    f"— user={request.user.username}"
                )
                return None
            if allow_hr and _is_hr_or_admin(request):
                logger.info(
                    f"[FinalizationLock] HR/Admin bypass for {month}/{year} "
                    f"— user={request.user.username}"
                )
                return None

        logger.warning(
            f"[FinalizationLock] Blocked request for {month}/{year} — locked"
        )
        return response
