"""
hrm/deadline_exception_models.py
═══════════════════════════════════
"Mở khoá đặc biệt" — cho phép HCNS/Admin cấp phép NGOẠI LỆ để 1 nhân viên
tạo/duyệt 1 loại đơn cho 1 ngày cụ thể dù đã quá hạn khoá thông thường (xem
hrm/deadline_utils.py), theo đúng điều khoản "phát sinh đột xuất" của quy
định thời hạn tạo/duyệt đơn (vd ca mổ gấp/yêu cầu đột xuất từ Bác sĩ):
nhân sự VẪN TỰ tạo đơn, TBP/TP VẪN TỰ duyệt bình thường — HCNS chỉ "mở khoá"
(gỡ chặn), không tạo/duyệt hộ.

Khác với cơ chế bypass đã có (Admin/HR tự tạo/duyệt hộ thì tự động qua khoá)
— cơ chế đó chỉ hữu ích khi CHÍNH HCNS/Admin là người bấm tạo/duyệt, nhưng
trong đa số trường hợp thực tế (ca mổ gấp), người tạo đơn vẫn là NHÂN VIÊN
hoặc người duyệt vẫn là TBP/TP (không phải HCNS) — nên cần thêm cơ chế cấp
phép riêng cho ĐÚNG người đó, đúng ngày đó, đúng loại đơn đó.
"""
from django.db import models

from employee.models import Employee


# Mở khoá 1 trong 4 loại chính (OVERTIME/ONLINE_WORK/LEAVE/UNAUTHORIZED_ABSENCE)
# vừa cho phép TẠO/DUYỆT đơn loại đó dù quá hạn, VỪA cho phép chính chủ đơn
# tự HUỶ/SỬA đơn loại đó của đúng ngày đó dù đã được quản lý trực tiếp duyệt
# — 1 lần mở khoá dùng được cho cả 2 việc (theo yêu cầu HCNS 2026-09-12).
# CANCEL_EDIT_REQUEST_TYPE là lựa chọn DỰ PHÒNG cho các trường hợp KHÔNG nằm
# trong 4 loại trên (vd giải trình đi muộn/về sớm/quên chấm công...) — những
# loại này không có "hạn tạo/duyệt" riêng để mở, nên cần 1 loại mở khoá
# chung chỉ để cấp quyền huỷ/sửa.
CANCEL_EDIT_REQUEST_TYPE = "CANCEL_EDIT"


class DeadlineExceptionGrant(models.Model):
    REQUEST_TYPE_CHOICES = [
        ("OVERTIME", "Tăng ca"),
        ("ONLINE_WORK", "Làm việc online"),
        ("LEAVE", "Nghỉ phép tháng"),
        ("UNAUTHORIZED_ABSENCE", "Nghỉ không phép"),
        ("LIVE", "Livestream"),
        ("BUSINESS_TRIP", "Công tác"),
        ("CA2", "Đăng ký Ca 2"),
        (CANCEL_EDIT_REQUEST_TYPE, "Huỷ/Sửa đơn đã duyệt"),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="deadline_exception_grants",
        verbose_name="Nhân viên được mở khoá",
    )
    event_date = models.DateField(verbose_name="Ngày áp dụng")
    request_type = models.CharField(
        max_length=30, choices=REQUEST_TYPE_CHOICES, verbose_name="Loại đơn",
    )
    note = models.CharField(max_length=500, blank=True, verbose_name="Lý do/ghi chú")
    granted_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người mở khoá",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Thu hồi = đánh dấu, KHÔNG xoá: đơn đã tạo/duyệt nhờ lượt mở khoá này
    # vẫn phải truy ra được lúc HCNS rà soát hạn (xem
    # find_applied_grants_for_events) — xoá đi thì đơn đó trông y như lọt hạn
    # do lỗi hệ thống.
    revoked_at = models.DateTimeField(null=True, blank=True, verbose_name="Thu hồi lúc")
    # HCNS vẫn mở khoá dù NGÀY ĐÓ ĐÃ CÓ ĐƠN loại này. Mặc định việc đó bị chặn
    # (xem find_blocking_request): mở khoá khi đã có đơn chờ duyệt / đã duyệt
    # thường là để "cứu" quản lý quên duyệt — duyệt lại sau khi mở khoá thì lỗi
    # duyệt quá hạn của quản lý biến mất. HCNS yêu cầu 2026-10-10 chặn
    # đường đó, nhưng vẫn cho HCNS tự tick xác nhận vì có trường hợp thật
    # (trưởng phòng ốm không duyệt được). Tick thì BẮT BUỘC nhập lý do, lưu ở
    # `note`, và cờ này để còn lọc ra rà soát sau.
    overrode_existing_request = models.BooleanField(
        default=False,
        verbose_name="Mở khoá dù đã có đơn",
        help_text="HCNS đã tick xác nhận mở khoá dù ngày đó đã có đơn cùng loại.",
    )
    revoked_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người thu hồi",
    )

    class Meta:
        verbose_name = "Mở khoá đặc biệt (hạn tạo/duyệt đơn)"
        verbose_name_plural = "Mở khoá đặc biệt (hạn tạo/duyệt đơn)"
        constraints = [
            # Chỉ 1 lượt CÒN HIỆU LỰC cho mỗi NV/ngày/loại; lượt đã thu hồi giữ làm lịch sử.
            models.UniqueConstraint(
                fields=["employee", "event_date", "request_type"],
                condition=models.Q(revoked_at__isnull=True),
                name="uniq_active_deadline_exception_grant",
            ),
        ]
        indexes = [
            models.Index(fields=["employee", "event_date", "request_type"]),
        ]

    def __str__(self):
        return f"{self.employee.employee_id} - {self.event_date} - {self.get_request_type_display()}"


# Cách tra "ngày này đã có đơn loại đó chưa", theo từng loại mở khoá.
# Giá trị: (event_type, điều kiện lọc thêm trên data). None = KHÔNG chặn.
#
# CANCEL_EDIT cố ý để None: loại này sinh ra ĐỂ huỷ/sửa đơn đã có, chặn nó khi
# đã có đơn thì hỏng hẳn chức năng.
# CA2 cũng để None: đăng ký ca nằm ở model khác (ShiftRegistrationDay), không
# tra bằng EmployeeEvent được.
_BLOCKING_EVENT_LOOKUP = {
    "LEAVE": [("explanation", {"data__explanation_type": "LEAVE"})],
    # Công tác đi được cả 2 đường: giải trình, hoặc đăng ký lưu dưới dạng
    # overtime với registration_type=BUSINESS_TRIP (xem registration_serializers).
    "BUSINESS_TRIP": [
        ("explanation", {"data__explanation_type": "BUSINESS_TRIP"}),
        ("overtime", {"data__registration_type": "BUSINESS_TRIP"}),
    ],
    "UNAUTHORIZED_ABSENCE": [("unauthorized_absence", {})],
    "ONLINE_WORK": [("online_work", {})],
    "OVERTIME": [("overtime", {"data__registration_type": "OVERTIME"})],
    "LIVE": [("live", {})],
    "CA2": None,
    CANCEL_EDIT_REQUEST_TYPE: None,
}

# Đơn ở 2 trạng thái này mới chặn. REJECTED/CANCELLED thì không — nhân sự còn
# phải tạo lại, chặn mở khoá lúc đó là chặn nhầm.
_BLOCKING_STATUSES = ("PENDING", "APPROVED")


def find_blocking_request(employee, event_date, request_type: str):
    """Ngày/loại này ĐÃ CÓ đơn chờ duyệt hoặc đã duyệt chưa.

    Trả về dict mô tả đơn đó (để báo cho HCNS biết đang vướng cái gì), hoặc None
    nếu không có gì chặn.

    Vì sao cần: mở khoá khi đã có đơn gần như luôn là để "cứu" quản lý quên
    duyệt — mở xong duyệt lại thì lỗi "duyệt đơn quá hạn" 500k của quản lý biến
    mất. HCNS yêu cầu chặn đường đó 2026-10-10.
    """
    lookups = _BLOCKING_EVENT_LOOKUP.get(request_type)
    if not lookups or not employee or not event_date:
        return None

    from .event_models import EmployeeEvent

    for event_type, extra in lookups:
        for ev in (EmployeeEvent.objects
                   .filter(employee=employee, event_date=event_date,
                           event_type=event_type, **extra)
                   .order_by("-created_at")):
            d = ev.data or {}
            st = (d.get("status") or "").upper()
            if st not in _BLOCKING_STATUSES:
                continue
            return {
                "event_id": ev.id,
                "request_code": d.get("request_code") or "",
                "status": st,
                "status_label": "Đã duyệt" if st == "APPROVED" else "Chờ duyệt",
                "direct_manager_approved": bool(d.get("direct_manager_approved")),
                "created_at": ev.created_at.isoformat() if ev.created_at else None,
                "reason": d.get("reason") or "",
            }
    return None


def has_deadline_exception(employee, event_date, request_type: str) -> bool:
    """True nếu đã được HCNS/Admin mở khoá cho đúng nhân viên/ngày/loại đơn
    này. Dùng ở deadline_utils.py và các điểm khoá hạn (registration_views.py/
    taodon_views.py) — luôn ưu tiên kiểm tra TRƯỚC khi báo lỗi quá hạn."""
    if not employee:
        return False
    return DeadlineExceptionGrant.objects.filter(
        employee=employee, event_date=event_date, request_type=request_type,
        revoked_at__isnull=True,
    ).exists()


def grant_types_for_event(event) -> list:
    """Các loại mở khoá có thể đã gỡ hạn cho đơn `event` — khớp đúng loại mà
    các điểm khoá hạn truyền vào has_deadline_exception() (registration_
    serializers/registration_views/taodon_views), cộng CANCEL_EDIT dùng chung."""
    from .event_models import EmployeeEvent

    d = event.data or {}
    types = []
    reg_type = (d.get("registration_type") or "").upper()
    if event.event_type == EmployeeEvent.EventType.ONLINE_WORK:
        types.append("ONLINE_WORK")
    elif event.event_type == EmployeeEvent.EventType.EXPLANATION:
        explanation_type = (d.get("explanation_type") or "").upper()
        if explanation_type in ("LEAVE", "BUSINESS_TRIP"):
            types.append(explanation_type)
    elif reg_type in dict(DeadlineExceptionGrant.REQUEST_TYPE_CHOICES):
        types.append(reg_type)
    types.append(CANCEL_EDIT_REQUEST_TYPE)
    return types


def find_applied_grants_for_events(events) -> dict:
    """{event_id: [grant, ...]} — các lượt mở khoá đã CÓ HIỆU LỰC trong lúc
    đơn còn được xử lý: tạo trước thời điểm xử lý cuối cùng của đơn (còn chờ
    duyệt thì tính tới hiện tại) và chưa bị thu hồi trước khi đơn được tạo.
    Dùng để HCNS phân biệt đơn quá hạn do "mở đột xuất" với đơn lọt hạn do lỗi."""
    from django.utils import timezone

    events = [e for e in events if e.employee_id and e.event_date]
    if not events:
        return {}
    grants = DeadlineExceptionGrant.objects.filter(
        employee_id__in={e.employee_id for e in events},
        event_date__in={e.event_date for e in events},
    ).select_related("granted_by", "revoked_by").order_by("created_at")
    by_key = {}
    for g in grants:
        by_key.setdefault((g.employee_id, g.event_date, g.request_type), []).append(g)

    now = timezone.now()
    result = {}
    for e in events:
        status = (e.data or {}).get("status")
        last_action = now if status == "PENDING" else (e.updated_at or now)
        applied = []
        for request_type in grant_types_for_event(e):
            for g in by_key.get((e.employee_id, e.event_date, request_type), []):
                if g.created_at > last_action:
                    continue
                if g.revoked_at and e.created_at and g.revoked_at < e.created_at:
                    continue
                applied.append(g)
        if applied:
            result[e.id] = applied
    return result


def can_owner_self_cancel(event, request_type=None) -> bool:
    """True nếu CHÍNH CHỦ ĐƠN (event.employee) hiện có thể tự huỷ đơn này —
    dùng để FE quyết định hiện nút "Huỷ đơn" mà KHÔNG cần gọi thử API trước
    (tránh hiện nút rồi báo lỗi 400 cho phần lớn trường hợp đã duyệt).

    Đơn còn PENDING + CHƯA qua bước quản lý trực tiếp duyệt: luôn tự huỷ được.
    Đã qua bước đó: tự huỷ được nếu HCNS đã mở khoá loại tương ứng đúng
    NV/ngày này — HOẶC loại tương ứng với chính đơn này (`request_type`:
    "OVERTIME"/"ONLINE_WORK"/"LEAVE"/"UNAUTHORIZED_ABSENCE" — mở khoá loại
    nào thì được huỷ/sửa loại đó luôn, không cần mở thêm lần nữa), HOẶC loại
    dự phòng CANCEL_EDIT_REQUEST_TYPE ("Huỷ/Sửa đơn đã duyệt" — dùng khi đơn
    không thuộc 4 loại trên, vd giải trình đi muộn/về sớm/quên chấm công...).

    LƯU Ý: đây là bản tính TRƯỚC cho hiển thị, phải phản ánh ĐÚNG logic
    can_bypass/is_owner ở RegistrationRequestViewSet.cancel() /
    OnlineWorkRequestViewSet.cancel() / AttendanceExplanationViewSet.cancel()
    — sửa 1 nơi phải rà lại cả các nơi kia."""
    if not event:
        return False
    d = event.data or {}
    if d.get("status") != "PENDING":
        return False

    from .models import (
        LEAVE_LIKE_REQUEST_TYPES,
        _has_approve_permission,
        _is_hr,
        _is_hr_or_admin_strict,
    )

    # ── Đơn nghỉ phép / nghỉ không phép: siết theo cơ chế phạt 500k ────────
    # Quá hạn duyệt thì CHỦ ĐƠN hết tự huỷ được (hàm này chỉ tính cờ cho chủ
    # đơn). HCNS/Admin không đi qua đây và vẫn huỷ được — HCNS 2026-10-10:
    # "bảo HCNS xử lí cho". Phải khớp với _cancel_single_event() và
    # AttendanceExplanationViewSet.cancel(), lệch thì FE hiện nút rồi báo lỗi.
    _is_leave_like = (
        d.get("registration_type") in LEAVE_LIKE_REQUEST_TYPES
        or d.get("explanation_type") == "LEAVE"
    )
    if _is_leave_like:
        try:
            if event.event_type == "explanation":
                from .taodon_views import _check_explanation_approve_deadline as _chk
            else:
                from .registration_views import _check_approve_deadline as _chk
            if _chk(event, bypass=False):
                return False
        except Exception:  # noqa: BLE001
            # Thiếu dữ liệu phụ (ca làm, cấu hình...) thì không chặn nút —
            # endpoint thật vẫn kiểm tra lại khi bấm.
            pass

    if not d.get("direct_manager_approved"):
        return True

    owner = event.employee
    if not owner:
        return False

    # Đơn NGHỈ đã qua bước quản lý duyệt: chủ đơn hết tự huỷ, kể cả khi có mở
    # khoá. HCNS chốt 2026-10-10: "muốn cancel hay edit gì thì bảo HCNS xử
    # lí cho. Đơn đã duyệt sẽ ko được sửa/xóa". Chỉ HCNS/Admin còn làm được, và
    # họ không đi qua hàm này (đây là cờ cho CHỦ ĐƠN).
    if _is_leave_like:
        return _is_hr_or_admin_strict(owner)

    is_admin = bool(owner.user_id and (owner.user.is_staff or owner.user.is_superuser))
    is_hr_user = _is_hr(owner)
    has_perm = _has_approve_permission(owner)
    is_management = (
        (owner.position.is_management if owner.position else False) or
        owner.managed_departments.exists() or
        owner.subordinates.exists()
    )
    # Tới đây chắc chắn KHÔNG phải đơn nghỉ (đã return ở trên), nên giữ nguyên
    # hành vi cũ cho các loại đơn khác.
    if is_admin or is_hr_user or has_perm or is_management:
        return True

    if has_deadline_exception(owner, event.event_date, CANCEL_EDIT_REQUEST_TYPE):
        return True
    if request_type:
        return has_deadline_exception(owner, event.event_date, request_type)
    return False
