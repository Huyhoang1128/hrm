"""Tính sẵn quyền thao tác (duyệt / từ chối / sửa / sửa giờ / huỷ) trên MỘT đơn
cho MỘT người xem cụ thể.

Lý do tồn tại (yêu cầu HCNS 2026-09-23: "cho QLTT có quyền duyệt, từ chối, sửa
giờ trong [Chấm công > Nhân viên và Chốt công] too"): luật duyệt của hệ thống
khá rối (2 bước QLTT -> HCNS, ngoại lệ cho chủ đơn là HR / là quản lý cấp cao
không có QLTT, hạn duyệt 2 giờ, hạn sửa giờ 10h sáng hôm sau...) và trước đây
được CHÉP LẠI bằng tay ở frontend (Approvals.tsx::canApproveExplanation). Thêm
màn thứ 3 tự chép lại lần nữa là chắc chắn lệch. Nay backend tính 1 lần và trả
cờ xuống, FE chỉ việc ẩn/hiện nút.

Đây CHỈ là gợi ý cho UI — mọi endpoint duyệt/sửa/huỷ vẫn tự kiểm tra quyền của
nó như cũ, không endpoint nào tin vào các cờ này.
"""
from django.utils import timezone

from .models import (
    _is_hr,
    _has_approve_permission,
    is_senior_manager,
)

# Trạng thái coi là "còn đang chờ xử lý"
_OPEN_STATUSES = ("PENDING", "DRAFT")
_FINAL_STATUSES = ("APPROVED", "REJECTED", "CANCELLED")


def _viewer_roles(user, viewer):
    """Gom các vai trò của NGƯỜI XEM (không phụ thuộc vào đơn nào)."""
    is_admin = bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))
    is_hr_user = _is_hr(viewer)
    has_perm = _has_approve_permission(viewer) if viewer else False
    is_management = False
    if viewer:
        is_management = bool(
            (viewer.position.is_management if viewer.position else False)
            or viewer.managed_departments.exists()
            or viewer.subordinates.exists()
        )
    return {
        "is_admin": is_admin,
        "is_hr_user": is_hr_user,
        "has_perm": has_perm,
        "can_as_hr": is_hr_user or has_perm,
        "is_management": is_management,
        # Giống hệt RegistrationRequestViewSet._can_edit_or_delete()
        "is_privileged": is_admin or is_hr_user or has_perm or is_management,
    }


def _approve_deadline_error(event, bypass):
    """Hạn DUYỆT — mỗi họ đơn 1 công thức riêng, dùng đúng hàm của endpoint
    tương ứng để không lệch. Import trong hàm vì registration_views import
    ngược lại module này qua attendance_views."""
    event_type = event.event_type
    try:
        if event_type == "online_work":
            from .registration_views import _check_online_work_approve_deadline
            return _check_online_work_approve_deadline(event, bypass=bypass)
        if event_type == "explanation":
            # Đơn giải trình (gồm Nghỉ phép tháng, Công tác) có công thức hạn
            # RIÊNG, đọc snapshot data['advance_deadline']. Trước đây nhánh này
            # bị thiếu nên mọi đơn giải trình rơi vào _check_approve_deadline()
            # — hàm đó chỉ xử lý OVERTIME/UNAUTHORIZED_ABSENCE/LIVE theo
            # data['registration_type'], gặp đơn giải trình là trả None luôn.
            # Hệ quả: can_edit/can_cancel của đơn nghỉ phép không bao giờ xét
            # hạn, FE hiện nút rồi endpoint mới chặn.
            from .taodon_views import _check_explanation_approve_deadline
            return _check_explanation_approve_deadline(event, bypass=bypass)
        from .registration_views import _check_approve_deadline
        return _check_approve_deadline(event, bypass=bypass)
    except Exception:
        # Thiếu dữ liệu phụ (ca làm, cấu hình...) thì không chặn nút — endpoint
        # thật vẫn kiểm tra lại khi bấm.
        return None


def compute_request_permissions(event, user, viewer, roles=None):
    """Trả dict cờ quyền cho 1 EmployeeEvent dạng ĐƠN (không phải chấm công).

    `viewer` là Employee của người đang xem (có thể None nếu tài khoản chưa gắn
    hồ sơ nhân viên). Truyền sẵn `roles` (từ _viewer_roles) khi lặp qua nhiều
    đơn để khỏi query lại managed_departments/subordinates cho từng đơn.
    """
    d = event.data or {}
    status_val = (d.get("status") or "").upper()
    emp = event.employee
    r = roles if roles is not None else _viewer_roles(user, viewer)

    is_owner = bool(viewer and event.employee_id == viewer.id)
    is_direct_mgr = bool(viewer and emp.manager_id and emp.manager_id == viewer.id)
    is_open = status_val in _OPEN_STATUSES or not status_val

    # ── Duyệt ────────────────────────────────────────────────────────────
    # Mirror RegistrationRequestViewSet.approve() / OnlineWorkRequestViewSet.
    # approve() / AttendanceExplanationViewSet.approve(): admin duyệt cả 2
    # bước; QLTT duyệt bước 1 (nếu chưa duyệt); HCNS duyệt bước 2 và chỉ sau
    # khi QLTT đã duyệt — trừ khi chủ đơn là quản lý cấp cao không có QLTT.
    can_approve = False
    approve_blocked_reason = None
    if is_open and viewer and not is_owner:
        if r["is_admin"]:
            can_approve = True
        elif is_direct_mgr:
            can_approve = not d.get("direct_manager_approved")
        elif r["can_as_hr"]:
            can_approve = bool(d.get("direct_manager_approved")) or (
                is_senior_manager(emp) and not emp.manager_id
            )
        if can_approve:
            err = _approve_deadline_error(event, bypass=(r["is_admin"] or r["can_as_hr"]))
            if err:
                can_approve = False
                approve_blocked_reason = err

    # ── Từ chối ──────────────────────────────────────────────────────────
    # reject() KHÔNG xét bước duyệt lẫn hạn — chỉ cần có vai trò duyệt.
    can_reject = bool(
        is_open and viewer and not is_owner
        and (is_direct_mgr or r["can_as_hr"] or r["is_admin"])
    )

    # ── Sửa nội dung (lý do/ngày) ────────────────────────────────────────
    # Mirror update(): người có quyền sửa bất kỳ lúc nào; chủ đơn chỉ khi đơn
    # còn chờ, CHƯA ai duyệt bước nào, và chưa quá hạn.
    if r["is_privileged"]:
        can_edit = status_val != "CANCELLED"
    elif is_owner:
        can_edit = bool(
            is_open
            and not d.get("direct_manager_approved")
            and not d.get("hr_approved")
            and _approve_deadline_error(event, bypass=False) is None
        )
    else:
        can_edit = False

    # ── Sửa GIỜ đơn tăng ca Tại Viện/VP ──────────────────────────────────
    # Mirror rào ở update(): QLTT "thuần" bị chặn sau 10h sáng hôm sau
    # (Chủ nhật tới hết ngày); Admin/HCNS không bị chặn.
    can_edit_hours = False
    hours_fix_deadline = None
    if (d.get("registration_type") == "OVERTIME" and d.get("ot_type") == "ONSITE"
            and status_val != "CANCELLED"):
        if r["is_admin"] or r["can_as_hr"]:
            can_edit_hours = True
        elif r["is_management"]:
            from .deadline_utils import manager_attendance_fix_deadline
            hours_fix_deadline = manager_attendance_fix_deadline(event.event_date)
            can_edit_hours = timezone.now() <= hours_fix_deadline

    # ── Huỷ ──────────────────────────────────────────────────────────────
    # Mirror _cancel_single_event(): người có quyền huỷ ở bất kỳ trạng thái
    # nào; chủ đơn chỉ khi còn PENDING, QLTT chưa duyệt, và chưa quá hạn.
    #
    # RIÊNG đơn nghỉ phép / nghỉ không phép (cơ chế phạt 500k, HCNS 10/2026):
    # quản lý không còn quyền huỷ, và quá hạn duyệt thì KHÔNG AI huỷ được —
    # phải khớp y hệt _cancel_single_event() (registration_views) và
    # AttendanceExplanationViewSet.cancel() (taodon_views), nếu lệch thì FE
    # hiện nút rồi bấm vào báo lỗi.
    from .models import LEAVE_LIKE_REQUEST_TYPES, _is_hr_or_admin_strict
    _is_leave_like = (
        d.get("registration_type") in LEAVE_LIKE_REQUEST_TYPES
        or d.get("explanation_type") == "LEAVE"
    )
    cancel_privileged = (
        _is_hr_or_admin_strict(viewer) if _is_leave_like else r["is_privileged"]
    )

    if cancel_privileged:
        # HCNS/Admin huỷ được mọi trạng thái, kể cả đã duyệt và đã quá hạn —
        # là cửa duy nhất còn lại (HCNS 2026-10-10: "bảo HCNS xử lí cho").
        # Endpoint thật sẽ bắt buộc nhập lý do.
        can_cancel = status_val != "CANCELLED"
    elif is_owner:
        # Chủ đơn: CHỈ khi quản lý chưa duyệt và còn trong hạn. Với đơn nghỉ,
        # mở khoá không còn giúp gì ở đây nữa — "Đơn đã duyệt sẽ ko được
        # sửa/xóa" (HCNS 2026-10-10).
        can_cancel = bool(
            status_val == "PENDING"
            and not d.get("direct_manager_approved")
            and _approve_deadline_error(event, bypass=False) is None
        )
    else:
        can_cancel = False

    return {
        "can_approve": can_approve,
        "approve_blocked_reason": approve_blocked_reason,
        "can_reject": can_reject,
        "can_edit": can_edit,
        "can_edit_hours": can_edit_hours,
        "hours_fix_deadline": hours_fix_deadline.isoformat() if hours_fix_deadline else None,
        "can_cancel": can_cancel,
        # Trên `dev` không còn xoá cứng (destroy() đã bỏ 2026-09-17), "xoá" và
        # "huỷ" là cùng một thao tác soft-cancel. Trả thêm `can_delete` vì FE
        # (AttendanceCalendar.tsx) đang dò cờ này — trước giờ BE không trả nên
        # nó luôn rơi về đoán theo user.role ở client.
        "can_delete": can_cancel,
        "is_owner": is_owner,
        "is_direct_manager": is_direct_mgr,
    }
