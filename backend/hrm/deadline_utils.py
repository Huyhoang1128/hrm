"""
hrm/deadline_utils.py
══════════════════════
Tiện ích tính "ngày làm việc" + hạn tạo/duyệt đơn, theo quy định chấm công
và thời hạn tạo đơn trên HRM, HIỆU LỰC TỪ 09/09/2026.

CHỦ Ý về mốc hiệu lực: `EFFECTIVE_DATE` được HARD-CODE làm hằng số Python,
KHÔNG dùng `CompanyConfig.effective_from` — nhiều chỗ hiện có trong code base
lookup `CompanyConfig`/`LeavePolicyConfig` KHÔNG filter `effective_from__lte
=hôm nay` (vd `registration_views.py:775,855`, `taodon_views.py:447,888,
1716,1763`) — nếu tạo sẵn 1 config hiệu lực tương lai và bật `is_active=True`
sớm, các chỗ đó sẽ áp dụng NGAY LẬP TỨC thay vì đúng ngày dự định. Hard-code
ở đây tránh hẳn rủi ro đó: mọi nơi gọi khoá hạn đều tự `is_locked_effective()`
trước khi enforce — trước 09/09/2026 các đơn vẫn tạo/duyệt bình thường như
cũ, không hồi tố.
"""
import datetime as _dt

from django.utils import timezone

EFFECTIVE_DATE = _dt.date(2026, 9, 9)


def is_locked_effective(check_date=None) -> bool:
    """True nếu quy định khoá hạn đã có hiệu lực (>= 09/09/2026)."""
    return (check_date or timezone.localdate()) >= EFFECTIVE_DATE


# Ngày cuối cùng HCNS cho phép "bổ sung nốt" các đơn Online/Nghỉ phép/Nghỉ
# không lương/Livestream/Công tác/Nghỉ không phép phát sinh TRƯỚC ngày hiệu
# lực mà nhân sự chưa kịp tạo trên HRM (yêu cầu qua chat 10/09/2026, mở
# rộng thêm Nghỉ không phép + gia hạn tới 19/09/2026 theo yêu cầu HCNS
# 2026-09-16 cho các đơn phát sinh ngày 1-10/9) — KHÔNG áp dụng cho Tăng ca
# (đã có quy định giờ riêng, không cần khoan này). Từ sau ngày này, các đơn
# quá khứ lại bị khoá hạn bình thường như thiết kế ban đầu.
BACKLOG_GRACE_PERIOD_END = _dt.date(2026, 9, 19)


def in_backlog_grace_period(event_date: _dt.date, today=None) -> bool:
    """True nếu event_date đã ở QUÁ KHỨ (so với hôm nay) VÀ hôm nay vẫn còn
    trong thời gian ân hạn cho phép bổ sung đơn cũ (<= BACKLOG_GRACE_PERIOD_END).
    Áp dụng cho Online/Nghỉ phép/Nghỉ không phép (thêm 2026-09-16) — xem lời
    gọi ở registration_views.py/registration_serializers.py/taodon_views.py."""
    today = today or timezone.localdate()
    return event_date < today and today <= BACKLOG_GRACE_PERIOD_END


# ─────────────────────────────────────────────────────────────────────────────
# Ngày làm việc (loại trừ Chủ nhật và ngày lễ HolidayConfig — Thứ 7 LUÔN là
# ngày làm việc, xem help_text Department.saturday_afternoon_always_workday)
# ─────────────────────────────────────────────────────────────────────────────

def is_working_day(check_date: _dt.date, employee=None) -> bool:
    """Chủ nhật -> luôn False. Thứ 7 -> LUÔN True (HCNS xác nhận 2026-09-27:
    Thứ 7 luôn là ngày làm việc, chỉ khác nhau ở việc làm CẢ NGÀY hay NỬA
    NGÀY — tuần chẵn trong tháng mặc định chỉ làm sáng, trừ khi
    `Employee/Department.saturday_afternoon_always_workday=True` thì làm cả
    ngày mọi tuần). Cờ đó CHỈ ảnh hưởng số CÔNG tính được của buổi chiều thứ
    7 tuần chẵn (xem main_api.py) — không quyết định thứ 7 có phải "ngày làm
    việc" hay không cho mục đích tính hạn (next_working_day/
    subtract_working_days). Trước đây hàm này coi Thứ 7 là False khi thiếu
    cờ này, khiến hạn tạo/duyệt đơn của nhân viên không bật cờ bị đẩy sai
    sang tận Thứ 2 thay vì đúng ra vẫn là Thứ 7 (đơn nghỉ không phép,
    2026-09-26 — QLTT tự test tài khoản phát hiện). Ngày lễ
    (HolidayConfig áp dụng cho nhân viên này, `is_working_day=False`) ->
    False, kể cả ngày lễ lặp lại hàng năm (`is_recurring`, chỉ so tháng/ngày,
    bỏ qua năm)."""
    if check_date.weekday() == 6:  # Chủ nhật
        return False
    if employee is not None:
        from .models import HolidayConfig
        holidays = HolidayConfig.objects.filter(is_active=True)
        for h in holidays:
            same_day = h.holiday_date == check_date
            same_recurring_day = (
                h.is_recurring
                and h.holiday_date.month == check_date.month
                and h.holiday_date.day == check_date.day
            )
            if (same_day or same_recurring_day) and not h.is_working_day:
                if h.should_apply_to_employee(employee):
                    return False
    return True


def subtract_working_days(from_date: _dt.date, n: int, employee=None) -> _dt.date:
    """Lùi đúng n NGÀY LÀM VIỆC trước from_date (không tính from_date).
    Trả về đúng ngày làm việc thứ n đó (không phải khoảng ngày)."""
    d = from_date
    counted = 0
    while counted < n:
        d = d - _dt.timedelta(days=1)
        if is_working_day(d, employee):
            counted += 1
    return d


def next_working_day(from_date: _dt.date, employee=None) -> _dt.date:
    """Ngày làm việc gần nhất SAU from_date (không tính from_date)."""
    d = from_date + _dt.timedelta(days=1)
    while not is_working_day(d, employee):
        d += _dt.timedelta(days=1)
    return d


def _end_of_day(d: _dt.date):
    naive = _dt.datetime.combine(d, _dt.time.max)
    return timezone.make_aware(naive) if timezone.is_naive(naive) else naive


def _combine_aware(d: _dt.date, t: _dt.time):
    naive = _dt.datetime.combine(d, t)
    return timezone.make_aware(naive) if timezone.is_naive(naive) else naive


# ─────────────────────────────────────────────────────────────────────────────
# Đơn Tăng ca / Livestream / Online — phải tạo VÀ được duyệt trước ít nhất
# 2 giờ so với thời điểm bắt đầu thực hiện (Thông báo mục II.2/3/4).
# ─────────────────────────────────────────────────────────────────────────────

def hours_before_deadline(start_dt, hours: int = 2):
    """Hạn tạo/duyệt = start_dt trừ đi N giờ. start_dt phải là aware datetime."""
    return start_dt - _dt.timedelta(hours=hours)


def get_shift_start_time(employee, target_date: _dt.date, half: str = 'FULL'):
    """Giờ bắt đầu ca làm việc của nhân viên vào target_date — dùng để suy ra
    "thời điểm bắt đầu thực hiện" cho Đơn Online (vốn chỉ lưu NGÀY, không lưu
    giờ). Ưu tiên ca ĐÃ ĐĂNG KÝ theo ngày (tính năng "Đăng ký ca làm",
    `get_registered_shift_configs_for_date`) trước, sau đó cascade ca cố định
    (`load_shift_configs_for_employee`) — tái dùng đúng 2 nguồn ca đã có
    trong hệ thống, không tạo thêm cơ chế mới.

    half='MORNING'|'AFTERNOON'|'FULL' — chọn đúng nửa ngày (khớp
    `_SHIFT_TYPE_TO_RULE_TYPE` ở shift_config_utils.py: buổi sáng gồm
    MORNING/FLEXIBLE/OTHER, buổi chiều gồm AFTERNOON/EVENING/NIGHT).
    'FULL' -> lấy ca sớm nhất trong ngày (giờ bắt đầu làm việc thực tế).

    Trả về `datetime.time` hoặc None nếu không xác định được ca (nhân viên
    không có ca nào cấu hình cho ngày đó) — caller tự quyết định fallback.
    """
    from .shift_config_utils import get_registered_shift_configs_for_date, load_shift_configs_for_employee

    configs = None
    try:
        configs = get_registered_shift_configs_for_date(employee, target_date)
    except Exception:
        configs = None
    if not configs:
        configs = load_shift_configs_for_employee(employee.employee_id, target_date)
    if not configs:
        return None

    morning_types = {'MORNING', 'FLEXIBLE', 'OTHER'}
    afternoon_types = {'AFTERNOON', 'EVENING', 'NIGHT'}
    if half == 'MORNING':
        matches = [sc.start_time for sc in configs if sc.shift_type in morning_types]
        if matches:
            return min(matches)
    elif half == 'AFTERNOON':
        matches = [sc.start_time for sc in configs if sc.shift_type in afternoon_types]
        if matches:
            return min(matches)
    return min((sc.start_time for sc in configs), default=None)


def get_shift_end_time(employee, target_date: _dt.date, half: str = 'FULL'):
    """Giờ KẾT THÚC ca làm việc của nhân viên vào target_date — mirror của
    get_shift_start_time() ở trên, dùng để tính hạn báo nghỉ "đối chiếu theo
    ca giờ làm của người đó" (yêu cầu HCNS 2026-09-18) thay vì mốc nửa đêm
    cố định. 'FULL' -> lấy ca kết thúc TRỄ nhất trong ngày (giờ tan làm thực
    tế, vd làm cả sáng lẫn chiều thì lấy giờ tan ca chiều). Trả về None nếu
    không xác định được ca — caller tự fallback (thường là cho phép cả ngày)."""
    from .shift_config_utils import get_registered_shift_configs_for_date, load_shift_configs_for_employee

    configs = None
    try:
        configs = get_registered_shift_configs_for_date(employee, target_date)
    except Exception:
        configs = None
    if not configs:
        configs = load_shift_configs_for_employee(employee.employee_id, target_date)
    if not configs:
        return None

    morning_types = {'MORNING', 'FLEXIBLE', 'OTHER'}
    afternoon_types = {'AFTERNOON', 'EVENING', 'NIGHT'}
    if half == 'MORNING':
        matches = [sc.end_time for sc in configs if sc.shift_type in morning_types]
        if matches:
            return max(matches)
    elif half == 'AFTERNOON':
        matches = [sc.end_time for sc in configs if sc.shift_type in afternoon_types]
        if matches:
            return max(matches)
    return max((sc.end_time for sc in configs), default=None)


# ─────────────────────────────────────────────────────────────────────────────
# Đơn nghỉ phép/nghỉ không lương — hạn theo bậc thang số ngày nghỉ (Thông báo
# mục II.1). Nửa ngày KHÔNG dùng hàm này (caller tự tính giờ bắt đầu buổi rồi
# trừ 4 tiếng qua hours_before_deadline, vì hàm này không biết giờ ca).
# ─────────────────────────────────────────────────────────────────────────────

_LEAVE_DEADLINE_FIXED_CUTOFF = _dt.time(17, 30)


def _leave_deadline_cutoff(d: _dt.date, employee):
    """Mốc giờ CUỐI CÙNG trong ngày d còn được phép tạo/duyệt đơn nghỉ phép/
    nghỉ không lương — CỐ ĐỊNH 17h30 các ngày Thứ 2 - Thứ 7, riêng Chủ nhật
    cho phép ANYTIME (hạn = hết ngày 23:59:59) — theo thống nhất với Sếp
    2026-09-22 ("chốt chặn đến 17h30 các ngày từ T2-T7 ... riêng ngày chủ
    nhật đến 23h59"). Thay cho bản trước đó (2026-09-18: đối chiếu theo giờ
    tan ca riêng từng người) — giữ nguyên tham số `employee` cho tương thích
    chữ ký hàm dù không còn dùng tới, để không phải sửa lại các nơi gọi."""
    if d.weekday() == 6:  # Chủ nhật
        return _end_of_day(d)
    return _combine_aware(d, _LEAVE_DEADLINE_FIXED_CUTOFF)


def leave_deadline(start_date: _dt.date, total_days: float, employee=None):
    """Trả về datetime (aware) là mốc CUỐI CÙNG còn được phép tạo/duyệt đơn
    nghỉ phép / nghỉ không phép bắt đầu từ start_date, total_days ngày — tạo/
    duyệt SAU mốc này là quá hạn.

    ĐẾM THEO NGÀY LỊCH (chốt 2026-10-04): Chủ nhật cũng tính là 1 ngày. Ví dụ
    nghỉ 2-3 ngày bắt đầu thứ 2 phải báo trước 2 ngày -> chậm nhất thứ 7.
      - <= 1 ngày:  trước ít nhất 1 ngày.
      - 2-3 ngày:   trước ít nhất 2 ngày.
      - 4-7 ngày:   trước ít nhất 7 ngày.
      - >= 8 ngày:  trước ít nhất 10 ngày.
    Giờ chốt trong ngày đó theo _leave_deadline_cutoff: 17h30 thứ 2 - thứ 7,
    Chủ nhật tới 23h59 -> vd nghỉ cả ngày thứ 2 thì tạo/duyệt được tới 23h59
    Chủ nhật hôm trước.

    Lịch sử: 18/09 đổi sang ngày lịch; 28/09 (#103995a, #5e64f7d) đổi lại
    thành ngày làm việc (bỏ qua Chủ nhật/ngày lễ) khiến nhân viên muốn nghỉ thứ
    2 phải báo từ 17h30 thứ 7 — sai ý HCNS, nay về lại ngày lịch.
    `employee` giữ trong chữ ký cho tương thích nơi gọi, không còn dùng để đếm.
    """
    if total_days <= 1:
        n = 1
    elif total_days <= 3:
        n = 2
    elif total_days <= 7:
        n = 7
    else:
        n = 10
    d = start_date - _dt.timedelta(days=n)
    return _leave_deadline_cutoff(d, employee)


# ─────────────────────────────────────────────────────────────────────────────
# Đơn nghỉ không phép — về bản chất là KHAI BÁO SAU khi nhân sự đã tự ý nghỉ
# (không xin phép trước) nên không có "hạn tạo trước" theo nghĩa thông
# thường. HCNS chốt lại: phải HOÀN TẤT tạo đơn VÀ duyệt chậm nhất 3 GIỜ kể từ
# giờ vào ca của ngày làm việc kế tiếp sau ngày nghỉ cuối cùng trong đơn (đi
# làm trở lại) — thay cho mốc cũ "10h00 sáng cố định" (không theo giờ ca thực
# tế của từng người). Cùng công thức được tái dùng cho hạn tạo đơn Nghỉ phép
# tháng khi tạo SAU khi ngày nghỉ đã qua (xem taodon_views.py, nhánh LEAVE).
# ─────────────────────────────────────────────────────────────────────────────

def unauthorized_absence_deadline(last_absence_date: _dt.date, employee=None):
    """3 giờ sau giờ vào ca (ca sớm nhất trong ngày) của ngày làm việc kế
    tiếp sau last_absence_date. Nếu không xác định được ca làm ngày đó (nhân
    viên không có ca cấu hình, hoặc employee=None) thì fallback về 10h00
    sáng như mốc cũ, để không bao giờ trả None.

    ⚠️ TỪ 2026-09-28 HÀM NÀY KHÔNG CÒN LÀ HẠN CỦA ĐƠN NGHỈ KHÔNG PHÉP.
    HCNS bỏ mốc "khai báo sau khi đã nghỉ" — đơn nghỉ không phép nay theo
    ĐÚNG luật nghỉ phép (xem leave_style_deadline). Công thức này chỉ còn
    dùng làm ÂN HẠN HỒI TỐ cho đơn Nghỉ phép tháng tạo sau khi ngày nghỉ đã
    qua (taodon_views.py, nhánh LEAVE) — giữ tên cũ để không phải sửa nhánh
    đó và các test đang bám vào nó."""
    d = next_working_day(last_absence_date, employee)
    shift_start = get_shift_start_time(employee, d, half='FULL') if employee else None
    if shift_start:
        return _combine_aware(d, shift_start) + _dt.timedelta(hours=3)
    return _combine_aware(d, _dt.time(10, 0))


# Đơn Nghỉ không phép chuyển sang áp ĐÚNG luật nghỉ phép từ 28/09/2026 (HCNS
# chốt). Đơn TẠO TRƯỚC mốc này vẫn được duyệt theo luật cũ — nhân sự đã tạo
# hợp lệ theo quy định đang có hiệu lực lúc đó, không thể vì đổi luật mà khoá
# luôn đường duyệt của họ (thực tế 28/09: đơn nghỉ 30/9–3/10 tạo từ 07/09 bị
# chặn với lý do "quá hạn 22/09" — quản lý không duyệt được ngày nào).
UNAUTHORIZED_ABSENCE_LEAVE_RULE_EFFECTIVE_DATE = _dt.date(2026, 9, 29)


def unauthorized_absence_uses_leave_rule(created_at) -> bool:
    """True nếu đơn Nghỉ không phép này phải xét theo luật nghỉ phép (đơn tạo
    TỪ ngày hiệu lực trở đi). `created_at` là datetime aware hoặc None."""
    if created_at is None:
        return True
    try:
        d = timezone.localtime(created_at).date()
    except (ValueError, TypeError, AttributeError):
        return True
    return d >= UNAUTHORIZED_ABSENCE_LEAVE_RULE_EFFECTIVE_DATE


def leave_style_deadline(start_date: _dt.date, last_date: _dt.date, employee=None,
                         *, expected_status=None, half_day_period=None, reason=""):
    """Hạn tạo/duyệt theo ĐÚNG LUẬT NGHỈ PHÉP — dùng chung cho cả đơn Nghỉ
    phép tháng lẫn đơn Nghỉ không phép (HCNS chốt 2026-09-28: "bỏ luật đó đi,
    giờ chỉ được đăng ký và duyệt từ hôm trước thôi, theo đúng luật nghỉ phép").

    Gom 3 nhánh mà taodon_views.py vốn viết rời cho Nghỉ phép tháng, để 2 loại
    đơn không lệch nhau khi công thức đổi:
      - Nhiều ngày  -> leave_deadline() theo bậc thang số ngày.
      - Nửa ngày    -> trước 4 giờ so với giờ vào ca của buổi nghỉ.
      - Cả 1 ngày   -> leave_deadline(..., 1) = trước 17h30 hôm trước
                       (Chủ nhật tới 23h59).
    Không tra được giờ ca cho nhánh nửa ngày thì lùi về mốc 1 ngày thay vì
    trả None — để không bao giờ "hết hạn" thành vô hạn.
    """
    if last_date and last_date != start_date:
        return leave_deadline(start_date, (last_date - start_date).days + 1, employee)

    if str(expected_status or "").upper() == "HALF_DAY":
        period = str(half_day_period or "").strip().upper()
        if period not in ("MORNING", "AFTERNOON"):
            # Fallback cho request cũ (FE chưa gửi half_day_period)
            period = "AFTERNOON" if "chiều" in str(reason or "").lower() else "MORNING"
        shift_start = get_shift_start_time(employee, start_date, half=period) if employee else None
        if shift_start:
            return hours_before_deadline(_combine_aware(start_date, shift_start), 4)

    return leave_deadline(start_date, 1, employee)


# ─────────────────────────────────────────────────────────────────────────────
# Đơn công tác (BUSINESS_TRIP) — hạn theo bậc thang số ngày (Thông báo mục
# II.5). Nửa ngày KHÔNG dùng hàm này (giống hệt Nghỉ phép tháng nửa ngày —
# caller tự tính giờ bắt đầu buổi rồi trừ 2 tiếng qua hours_before_deadline).
#   - 1 ngày:   trước ít nhất 1 NGÀY LÀM VIỆC.
#   - >= 2 ngày: trước ít nhất 3 NGÀY LÀM VIỆC.
# Hiện tại FE mới chỉ hỗ trợ tạo đơn công tác 1 ngày (không có chọn khoảng
# ngày như Nghỉ phép tháng/Nghỉ không phép) — tham số total_days > 1 để sẵn
# đó, chưa có caller nào truyền quá 1.
# ─────────────────────────────────────────────────────────────────────────────

def business_trip_deadline(start_date: _dt.date, total_days: float, employee=None):
    """Hạn tạo đơn Công tác: 1 ngày -> trước 1 ngày, nhiều ngày -> trước 3
    ngày, tính tới hết ngày đó (23h59).

    Đếm theo NGÀY LỊCH — Chủ nhật cũng tính là 1 ngày (chốt 2026-10-04, cùng
    cách đếm với leave_deadline()). Trước đây đếm ngày làm việc nên công tác
    thứ 2 phải tạo từ thứ 7. `employee` giữ trong chữ ký cho tương thích.
    """
    d = start_date - _dt.timedelta(days=1 if total_days <= 1 else 3)
    return _end_of_day(d)


# ─────────────────────────────────────────────────────────────────────────────
# Đơn tăng ca — nhóm được GIA HẠN: tạo VÀ duyệt tới 10h00 sáng ngày làm việc
# kế tiếp, thay cho mốc mặc định "trước 2 giờ so với giờ bắt đầu tăng ca".
#
# HCNS chốt 2026-09-24: chỉ còn Điều dưỡng, Điều dưỡng Trưởng, TLHA (Trợ Lý
# Hình Ảnh) và Leader TLHA. Mọi vị trí khác đều theo mốc "trước 2 giờ" cho CẢ
# hạn tạo lẫn hạn duyệt.
#
# ĐỐI TƯỢNG ÁP DỤNG LÀ DỮ LIỆU, KHÔNG PHẢI CODE — đây là thay đổi quan trọng
# so với các bản trước (vốn hard-code danh sách chức danh tiếng Việt trong
# file này và phải sửa code + deploy mỗi lần HCNS đổi ý, đã đổi 4 lần trong
# 2 tuần):
#   • Cả 1 vị trí  -> bật `Position.overtime_grace_deadline_enabled`
#                     (Django admin > Vị trí).
#   • Đúng 1 người -> bật `Employee.overtime_extended_deadline_enabled`
#                     (Django admin > Nhân viên), dùng cho ngoại lệ lẻ mà cả
#                     vị trí không được hưởng. HIỆN CHƯA BẬT CHO AI — để sẵn
#                     vì kiểu yêu cầu "riêng bạn X" phát sinh liên tục.
# Khớp 1 trong 2 là được gia hạn. HCNS tự đổi được, không cần deploy.
#
# So khớp theo cờ dữ liệu cũng tránh luôn lỗi so chuỗi chức danh: dữ liệu thật
# có những giá trị nhìn giống hệt nhau nhưng khác byte (unicode NFD), từng làm
# nhân viên rơi khỏi mọi danh sách mà không ai nhìn ra tại sao.
#
# HCNS chốt lại 2026-09-26 (thông báo thay thế mục 4): BỎ HẲN ngoại lệ gia hạn
# này — "Nhân sự phải tạo đơn tăng ca và được ... phê duyệt trước ít nhất 02
# giờ", áp dụng cho MỌI vị trí, không còn nhóm nào được lùi tới 10h sáng hôm
# sau nữa. Chặn bằng OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM (dưới), so theo
# NGÀY TĂNG CA (attendance_date) chứ không phải ngày hôm nay lúc tạo/duyệt —
# để đơn CỦA NGÀY HÔM TRƯỚC mà nhóm này còn đang hoàn thiện tới đúng hạn cũ
# (10h00 sáng hôm sau) vẫn tạo/duyệt được, không bị cắt ngang giữa chừng khi
# hạn cũ chưa hết. Không tắt cờ Position/Employee trong Django admin cho việc
# này — tắt cờ áp dụng tức thì cho CẢ đơn của ngày hôm qua, xoá mất hạn 10h
# sáng nay mà nhân sự đang cần dùng nốt. Giữ nguyên field + hàm bên dưới
# (không xoá) để không phá vỡ hạn của các đơn trước ngày chặn.
# ─────────────────────────────────────────────────────────────────────────────

OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM = _dt.date(2026, 9, 26)


def is_overtime_extended_deadline_eligible(employee) -> bool:
    """True nếu nhân viên được áp dụng hạn tăng ca mở rộng (10h sáng ngày làm
    việc kế tiếp) thay cho mốc "trước 2 giờ" mặc định — xét theo cờ của VỊ TRÍ
    hoặc cờ riêng của chính NHÂN VIÊN đó (xem khối chú thích ở trên)."""
    if not employee:
        return False
    if getattr(employee, 'overtime_extended_deadline_enabled', False):
        return True
    position = getattr(employee, 'position', None)
    return bool(position and getattr(position, 'overtime_grace_deadline_enabled', False))


def overtime_extended_deadline(attendance_date: _dt.date, employee):
    """Hạn tạo/duyệt đơn tăng ca của nhóm được gia hạn: 10h00 sáng NGÀY LÀM
    VIỆC kế tiếp sau attendance_date — mốc CỐ ĐỊNH riêng cho tăng ca (đã chốt
    24/09/2026, không đổi theo giờ ca), viết riêng thay vì gọi
    unauthorized_absence_deadline() để 2 tính năng không vô tình lệch theo
    nhau nếu 1 trong 2 công thức đổi (unauthorized_absence_deadline nay đã
    đổi sang công thức 3 giờ sau giờ vào ca, không còn 10h00 cố định)."""
    d = next_working_day(attendance_date, employee)
    return _combine_aware(d, _dt.time(10, 0))


def overtime_deadline_for(attendance_date: _dt.date, start_time, employee):
    """Hạn tạo/duyệt đơn tăng ca ĐÚNG cho nhân viên này — 1 nguồn sự thật dùng
    chung cho cả lúc TẠO đơn (registration_serializers) lẫn lúc DUYỆT đơn
    (registration_views), để 2 nơi không bao giờ lệch nhau nữa.

    Trả về (deadline, is_extended). deadline=None nghĩa là chưa xác định được
    (nhóm thường mà đơn không có giờ bắt đầu) — caller tự quyết cách xử lý.
    """
    if (
        attendance_date < OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM
        and is_overtime_extended_deadline_eligible(employee)
    ):
        return overtime_extended_deadline(attendance_date, employee), True
    if not start_time:
        return None, False
    return hours_before_deadline(_combine_aware(attendance_date, start_time), 2), False


# ─────────────────────────────────────────────────────────────────────────────
# Hạn để QUẢN LÝ TRỰC TIẾP vào sửa lại giờ tăng ca của nhân viên (yêu cầu HCNS
# 2026-09-22/23): "hạn là 10h sáng hôm sau, chủ nhật thì cho đến trước 24h".
#
# Dùng cho 2 chỗ:
#   1. Đơn tăng ca onsite thực tế NHIỀU hơn đăng ký (status đối soát 'excess',
#      phát hiện khi upload chấm công cuối tháng) — xem overtime_reconciliation.py.
#   2. Đơn tăng ca onsite còn ở trạng thái CHỜ DUYỆT, QLTT tự sửa giờ trong
#      trang Phê duyệt (vì ngày hôm sau chưa có data máy chấm công để đối soát)
#      — xem RegistrationRequestViewSet.update().
#
# KHÁC HẲN `unauthorized_absence_deadline`/`overtime_extended_deadline` ở
# trên (hạn TẠO/DUYỆT đơn, tính theo NGÀY LÀM VIỆC kế tiếp nên nhảy qua Chủ
# nhật): ở đây là NGÀY LỊCH kế tiếp, và Chủ nhật KHÔNG bị bỏ qua mà còn được
# nới tới hết ngày — đúng tinh thần "ngày chủ nhật cấp QL vẫn cập nhật duyệt
# được" (thống nhất với Sếp 2026-09-22). Cùng pattern nới-hết-ngày-Chủ-nhật
# với `_leave_deadline_cutoff` ở trên.
# ─────────────────────────────────────────────────────────────────────────────

def manager_attendance_fix_deadline(event_date: _dt.date):
    """10h00 sáng NGÀY LỊCH kế tiếp sau event_date; riêng khi ngày đó rơi vào
    Chủ nhật thì nới tới hết ngày (23:59:59)."""
    d = event_date + _dt.timedelta(days=1)
    if d.weekday() == 6:  # Chủ nhật
        return _end_of_day(d)
    return _combine_aware(d, _dt.time(10, 0))
