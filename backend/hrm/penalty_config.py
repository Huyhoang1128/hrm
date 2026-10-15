"""Mức phạt cho vi phạm quanh đơn Nghỉ phép tháng / Nghỉ không phép.

HCNS chốt 2026-10-09 (HCNS): 500.000 đ/lần cho nhân viên quên tạo đơn hoặc
tạo đơn quá hạn, và 500.000 đ/lần cho quản lý quên duyệt hoặc duyệt quá hạn.

Số tiền ở đây CHỈ dùng để CẢNH BÁO trên trang đối soát — KHÔNG tự ghi vào lương
("cảnh báo trong trang phạt đó", HCNS 2026-10-09). Hệ thống đã có sẵn
`salary.DisciplinaryPenalty` ("Phạt biên bản", nhiều dòng/người/tháng, có luồng
duyệt riêng) nếu sau này muốn nối sang bảng lương — đừng tạo bảng mới.
"""
import datetime as _dt

# NGÀY HIỆU LỰC: Thứ Tư 14/10/2026 (HCNS chốt 2026-10-12, đổi từ 13/10).
# Phạm vi là "từ ngày ra thông báo trở đi", nên vi phạm TRƯỚC mốc này vẫn hiện
# trong bảng để đối soát nhưng mức phạt = 0.
#
# So sánh theo NGÀY NGHỈ (`event_date`), mà hạn đăng ký lại rơi vào HÔM TRƯỚC
# ngày nghỉ — nên mốc phải lùi sau ngày ban hành ít nhất 1 ngày. Lấy mốc 12/10
# (ngày ban hành) thì người nghỉ đúng 12/10 bị phạt vì không đăng ký trước
# 17h30 ngày 11/10, tức bị phạt theo luật chưa có hiệu lực lúc họ phải hành
# động. Với 14/10, ngày nghỉ đầu tiên bị phạt có hạn đăng ký là 13/10 — đã nằm
# trọn trong hiệu lực, lại dư thêm 1 ngày để HCNS kịp phổ biến.
#
# Để None thì KHÔNG dòng nào ra tiền (trang hiện "chưa cấu hình ngày hiệu lực").
# ─────────────────────────────────────────────────────────────────────────────
# Kiểu: datetime.date, hoặc None khi chưa cấu hình.
PENALTY_EFFECTIVE_DATE = _dt.date(2026, 10, 14)

PENALTY_AMOUNT_PER_VIOLATION = 500_000


def _as_date(value):
    """Nhận date hoặc chuỗi ISO (rows trong báo cáo lưu dạng chuỗi)."""
    if value is None or isinstance(value, _dt.date):
        return value
    try:
        return _dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def is_penalty_configured() -> bool:
    return PENALTY_EFFECTIVE_DATE is not None


def penalty_applies(event_date) -> bool:
    """Ngày vi phạm này đã thuộc diện tính tiền chưa."""
    if PENALTY_EFFECTIVE_DATE is None:
        return False
    d = _as_date(event_date)
    return bool(d and d >= PENALTY_EFFECTIVE_DATE)


def penalty_amount_for(event_date) -> int:
    """Số tiền phạt của 1 dòng vi phạm — 0 nếu ngoài diện áp dụng.

    Chỉ còn dùng cho các nơi chỉ cần biết mốc ngày. Logic phạt đầy đủ (loại lỗi
    nào ra tiền, gộp đơn, gộp ngày liền nhau) nằm ở decide_penalty().
    """
    return PENALTY_AMOUNT_PER_VIOLATION if penalty_applies(event_date) else 0


# ─────────────────────────────────────────────────────────────────────────────
# LOẠI LỖI NÀO RA TIỀN
#
# HCNS chốt 2026-10-10: "Nếu tạo đơn quá hạn thì nó chỉ cảnh báo thôi đừng
# phạt tiền vội. Phải khi confirm là nhân viên đó ko tạo đơn mà vẫn nghỉ thì mới
# phạt. Vì nhiều khi có nhân viên cần nghỉ đột xuất và cty mở cho đến 3h làm
# việc." — công ty CHỦ ĐỘNG cho khai báo muộn trong 3 giờ đầu, nên phạt người
# tạo đơn muộn là tự mâu thuẫn với luật của chính mình.
# ─────────────────────────────────────────────────────────────────────────────
PENALTY_CODES = frozenset({"NO_REQUEST", "NOT_APPROVED", "APPROVED_LATE"})
# HALF_DAY_ONLY (nghỉ cả ngày nhưng chỉ xin đơn nửa ngày) tạm để CẢNH BÁO.
# Lỗi là thật — nửa ngày còn lại không có đơn nào — nhưng chưa từng được
# thông báo cho nhân sự nên phạt ngay là phạt hồi tố một luật chưa ai biết.
# Chuyển sang PENALTY_CODES là đổi 1 dòng, khi HCNS đã ra thông báo.
WARN_ONLY_CODES = frozenset({"LATE_CREATED", "HALF_DAY_ONLY"})

# Loại tính theo ĐƠN (1 lần/đơn), không theo từng ngày. Đơn nghỉ nhiều ngày lưu
# mỗi ngày 1 EmployeeEvent cùng request_code, nên nếu tính theo ngày thì một lần
# bấm duyệt muộn sẽ nhân tiền theo số ngày. Dữ liệu thật có đơn nghỉ không phép
# dài tới 15 ngày -> 7.500.000 đ cho đúng một lần bấm. HCNS chốt "1 lần cho
# cả đơn".
REQUEST_SCOPED_CODES = frozenset({"NOT_APPROVED", "APPROVED_LATE", "LATE_CREATED"})

# LOẠI ĐƠN chỉ cảnh báo, chưa ra tiền — xét theo `row['request_type']`, độc lập
# với mã lỗi. HCNS 2026-10-14: "bỏ cái phạt liên quan đến tăng ca đi đã,
# chưa cần thiết" (sau khi thấy tăng ca có 2 mốc hạn dễ nhầm và 141/335 đơn
# onsite tháng 9 chưa từng được đối soát giờ thực tế).
#
# Dòng tăng ca vẫn HIỆN đầy đủ ở tab Cảnh báo để HCNS theo dõi, và HCNS vẫn áp
# phạt tay từng dòng được. Muốn bật phạt tự động trở lại: xoá "OVERTIME" khỏi
# tập này, không cần đụng gì khác.
WARN_ONLY_REQUEST_TYPES = frozenset({"OVERTIME"})

# Lý do một dòng KHÔNG ra tiền. Trả lý do thay vì chỉ trả số 0 để giao diện nói
# được vì sao — trước đây frontend tự đoán, nhánh cuối luôn ghi "trước ngày hiệu
# lực" nên sau khi đổi chính sách sẽ hiện lý do SAI trên màn tiền.
REASON_CHARGED = "CHARGED"
REASON_NOT_CONFIGURED = "NOT_CONFIGURED"
REASON_BEFORE_EFFECTIVE = "BEFORE_EFFECTIVE_DATE"
REASON_WARN_ONLY = "WARN_ONLY"
REASON_HAD_ATTEMPT = "HAD_BLOCKED_ATTEMPT"
REASON_SAME_REQUEST = "MERGED_INTO_SAME_REQUEST"
REASON_CONSECUTIVE = "MERGED_CONSECUTIVE_DAYS"
REASON_NO_RESPONSIBLE = "NO_RESPONSIBLE"
# HCNS đã "Mở khoá đặc biệt" cho đúng NV/ngày/loại đơn này. Trước 2026-10-12
# dòng này bị XOÁ HẲN khỏi báo cáo (granted_skipped) — HCNS yêu cầu giữ
# lại để vẫn thấy được TP duyệt muộn / NV tạo đơn muộn, nên nay chỉ hạ về
# cảnh báo 0 đ thay vì ẩn. HCNS vẫn bấm "Áp phạt" được nếu thấy việc mở
# khoá là để cứu người quên duyệt.
REASON_HAD_GRANT = "HAD_GRANT"
# Loại đơn chưa áp phạt tự động (xem WARN_ONLY_REQUEST_TYPES).
REASON_TYPE_NOT_CHARGED = "TYPE_NOT_CHARGED"
# HCNS tự quyết, đè lên kết quả tự động (ViolationPenaltyOverride)
REASON_APPLIED_BY_HR = "APPLIED_BY_HR"
REASON_WAIVED_BY_HR = "WAIVED_BY_HR"

REASON_LABEL = {
    REASON_CHARGED: "Bị phạt",
    REASON_NOT_CONFIGURED: "Chưa cấu hình ngày hiệu lực",
    REASON_BEFORE_EFFECTIVE: "Trước ngày hiệu lực",
    REASON_WARN_ONLY: "Chỉ cảnh báo, không phạt tiền",
    REASON_HAD_ATTEMPT: "Đã bấm tạo đơn nhưng bị chặn — chỉ cảnh báo",
    REASON_SAME_REQUEST: "Cùng một đơn, đã tính ở ngày đầu",
    REASON_CONSECUTIVE: "Nghỉ liền ngày trước, đã tính ở ngày đầu đợt",
    REASON_NO_RESPONSIBLE: "Chưa xác định được người chịu trách nhiệm",
    REASON_HAD_GRANT: "Đã được HCNS mở khoá đặc biệt — chỉ cảnh báo",
    REASON_TYPE_NOT_CHARGED: "Loại đơn này chưa áp phạt — chỉ cảnh báo",
    REASON_APPLIED_BY_HR: "HCNS áp phạt",
    REASON_WAIVED_BY_HR: "HCNS gỡ phạt",
}


def resolve_effective_date(override=None):
    """Mốc hiệu lực đang dùng. `override` là chế độ XEM THỬ của HCNS — mốc thật
    trong file này không đổi, nên không sợ quên đổi lại rồi xuất Excel ra tiền
    truy thu."""
    d = _as_date(override)
    return d or PENALTY_EFFECTIVE_DATE


def decide_penalty(row, *, effective_date, is_duplicate_of_request=False,
                   is_consecutive_followup=False):
    """Quyết định 1 dòng vi phạm có ra tiền không, và nếu không thì VÌ SAO.

    Thứ tự xét quan trọng: lý do nào mô tả đúng bản chất hơn thì xét trước, để
    giao diện không nói "trước ngày hiệu lực" cho một dòng vốn không bao giờ bị
    phạt dù ở ngày nào.
    """
    code = row.get("violation_code")

    if not row.get("responsible_id"):
        return 0, REASON_NO_RESPONSIBLE
    if code in WARN_ONLY_CODES:
        return 0, REASON_WARN_ONLY
    # Có bản ghi đã vào bấm tạo đơn nhưng bị hệ thống chặn -> coi như đã cố gắng.
    if row.get("had_blocked_attempt"):
        return 0, REASON_HAD_ATTEMPT
    # Có "Mở khoá đặc biệt" -> hệ thống đã CHO PHÉP tạo/duyệt muộn, nên không
    # tự ra tiền. Dòng vẫn hiện để HCNS đối soát (xem REASON_HAD_GRANT).
    if row.get("has_grant"):
        return 0, REASON_HAD_GRANT
    # Loại đơn chưa đưa vào diện phạt (hiện: tăng ca).
    if row.get("request_type") in WARN_ONLY_REQUEST_TYPES:
        return 0, REASON_TYPE_NOT_CHARGED
    if is_duplicate_of_request:
        return 0, REASON_SAME_REQUEST
    if is_consecutive_followup:
        return 0, REASON_CONSECUTIVE
    if code not in PENALTY_CODES:
        return 0, REASON_WARN_ONLY
    if effective_date is None:
        return 0, REASON_NOT_CONFIGURED
    d = _as_date(row.get("event_date"))
    if not d or d < effective_date:
        return 0, REASON_BEFORE_EFFECTIVE
    return PENALTY_AMOUNT_PER_VIOLATION, REASON_CHARGED
