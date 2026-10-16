"""
hrm/management/commands/update_attendance.py
══════════════════════════════════════════════
Sửa/tạo chấm công bằng dòng lệnh. Hai chế độ:

  1. MỘT NGÀY  — 1 nhân viên, 1 ngày cụ thể.
  2. CẢ THÁNG  — quét mọi bản ghi chấm công trong tháng, bản nào THIẾU giờ vào
                 hoặc giờ ra thì điền nốt phần còn thiếu (--month).

Ghi DB theo ĐÚNG cấu trúc mà luồng "Upload chấm công" đang dùng (xem
hrm/upload_serializers.py, khối xử lý từng dòng file quanh dòng 402) — tức là
LUÔN ghi cả 2 bảng, đúng thứ tự và đúng các field phái sinh:

  1. hrm_attendance      (model Attendance)   — bản ghi chấm công gốc
  2. hrm_employeeevent   (model EmployeeEvent, event_type=ATTENDANCE)
     → đây mới là nguồn engine tính công đọc khi replay
       (EmployeeState.replay_month). Chỉ sửa Attendance mà quên EmployeeEvent
       thì bảng công/lịch chấm công KHÔNG hề đổi.

Công, phạt đi muộn/về sớm KHÔNG lưu trong DB — chúng được tính lại mỗi lần đọc
(replay). Nên sau khi chạy lệnh này chỉ cần load lại trang là thấy kết quả mới,
không phải chạy thêm gì.

Cách dùng:
    python manage.py update_attendance <mã_NV> <ngày d-m-y> [tuỳ chọn]   # 1 ngày
    python manage.py update_attendance --month <m-Y> [tuỳ chọn]          # cả tháng

Chế độ CẢ THÁNG:
    # Quét tháng 9/2026, điền nốt giờ còn thiếu cho MỌI nhân viên
    python manage.py update_attendance --month 09-2026 --dry-run
    python manage.py update_attendance --month 09-2026

    # Giới hạn trong 1 nhân viên
    python manage.py update_attendance --month 09-2026 --employee NV80026

Chế độ này CHỈ đụng vào bản ghi thiếu giờ vào HOẶC giờ ra, và CHỈ điền đúng
phần đang thiếu — phần đã có giữ nguyên tuyệt đối, kể cả khi nằm ngoài khoảng
giờ hành chính (giờ chấm công thật không bị lệnh này sửa).

Ví dụ:
    # Không truyền giờ -> tự sinh ngẫu nhiên giờ hành chính hợp lệ
    python manage.py update_attendance NV80026 09-09-2026
    # -> vd 08:17 → 17:46

    # Xem trước, không ghi gì
    python manage.py update_attendance NV80026 09-09-2026 --dry-run

    # Chỉ định chính xác
    python manage.py update_attendance NV80026 09-09-2026 \
        --check-in 09:13 --check-out 18:32

    # Chỉ định giờ ra, giờ vào để hệ thống tự sinh
    python manage.py update_attendance NV80026 09-09-2026 --check-out 18:32

    # Xoá hẳn giờ ra (đánh dấu quên chấm công ra)
    python manage.py update_attendance NV80026 09-09-2026 --clear-check-out

    # Bỏ qua ngày cụ thể (ngày lễ, ngày đã chốt công...) — dùng cho cả 2 chế độ
    python manage.py update_attendance --month 09-2026 --skip-dates 02-09-2026,12-09-2026
    python manage.py update_attendance NV80026 02-09-2026 --skip-dates 02-09-2026
    # -> lệnh thứ 2 không ghi gì vì chính ngày đó bị loại trừ

Quy ước giá trị giờ khi KHÔNG truyền --check-in / --check-out:
  • Giờ đang có ĐÃ nằm trong khoảng cho phép -> GIỮ NGUYÊN, không đụng tới.
  • Đang trống, hoặc nằm NGOÀI khoảng        -> sinh ngẫu nhiên trong khoảng.

Khoảng cho phép: giờ vào 08:10–08:29, giờ ra 17:31–18:00.
Truyền --check-in/--check-out thì dùng đúng giá trị đó, bất kể khoảng.
Dùng --clear-check-in / --clear-check-out để đặt NULL.

Nhờ vậy lệnh idempotent: chạy lại nhiều lần trên cùng 1 ngày, giờ đã hợp lệ
sẽ không bị random nhảy lung tung. Nếu không có gì thay đổi, lệnh KHÔNG ghi DB
(tránh tạo UPDATE rỗng làm nhiễu lịch sử sự kiện).
"""
import random
import uuid
from datetime import datetime, time as dt_time, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone as django_timezone

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.models import Attendance

# Giống upload: mỗi ngày 1 bản ghi FULL_DAY (unique_together =
# employee + attendance_date + shift_type).
SHIFT_TYPE = 'FULL_DAY'

# Nhãn nguồn dữ liệu. FE map sẵn giá trị này thành "Chấm công thủ công" trong
# tab Lịch sử sự kiện (IMPORT_SOURCE_MAP ở AttendanceManagement.tsx) — dùng
# 'manual_checkin' thay vì 'attendance_upload' để người xem phân biệt được bản
# ghi nào do người sửa tay, bản nào do máy chấm công đẩy lên.
IMPORT_SOURCE = 'manual_checkin'

_TIME_FORMATS = ('%H:%M:%S', '%H:%M')
_DATE_FORMATS = ('%d-%m-%Y', '%d/%m/%Y')

# Khoảng giờ sinh ngẫu nhiên khi KHÔNG truyền --check-in / --check-out.
# Cận trên/dưới đều TÍNH VÀO (inclusive), chỉ random tới phút, giây = 0 cho
# giống dữ liệu máy chấm công đẩy lên.
RANDOM_CHECK_IN_RANGE = (dt_time(8, 10), dt_time(8, 29))
RANDOM_CHECK_OUT_RANGE = (dt_time(17, 31), dt_time(18, 0))


def _random_time(start, end):
    """Giờ ngẫu nhiên trong [start, end], tính theo phút, giây = 0."""
    start_minutes = start.hour * 60 + start.minute
    end_minutes = end.hour * 60 + end.minute
    picked = random.randint(start_minutes, end_minutes)
    return dt_time(picked // 60, picked % 60)


# Mốc chia buổi để đoán 1 lần quẹt lẻ là giờ VÀO hay giờ RA. Máy chấm công
# nhiều khi chỉ ghi nhận 1 lần quẹt/ngày và luôn đổ vào cột giờ vào, kể cả khi
# thực tế đó là lần quẹt lúc tan làm (vd NV80017 tháng 9/2026: hàng loạt ngày
# có check_in=17:4x, check_out rỗng).
MIDDAY_SPLIT = dt_time(12, 0)

# ── Thứ 7 ──────────────────────────────────────────────────────────────────
# Thứ 7 tuần 2 và 4 trong tháng chỉ làm buổi sáng (tan lúc 12:00); các thứ 7
# còn lại (tuần 1, 3, 5) làm cả ngày như ngày thường. Công thức xác định "thứ 7
# thứ mấy trong tháng" lấy Y HỆT engine tính công — xem
# EmployeeState._evaluate_afternoon_shift_rule trong hrm/main_api.py:
#     saturday_occurrence = (date.day - 1) // 7 + 1
#     nửa ngày nếu saturday_occurrence in (2, 4)
# Dùng chung công thức để giờ chấm công sinh ra không mâu thuẫn với cách engine
# chấm công ngày đó.
SATURDAY_HALF_DAY_OCCURRENCES = (2, 4)

# Thứ 7 nửa ngày tan 12:00 -> quẹt ra ngay sau đó, cùng kiểu với ngày thường
# (ca tan 17:30, quẹt ra 17:31–18:00).
RANDOM_CHECK_OUT_SATURDAY_HALF_RANGE = (dt_time(12, 0), dt_time(12, 30))

# Mốc chia buổi riêng cho thứ 7 nửa ngày: ca kết thúc lúc 12:00 nên lần quẹt lẻ
# lúc 11:xx nhiều khả năng là giờ RA chứ không phải giờ vào.
SATURDAY_HALF_MIDDAY_SPLIT = dt_time(10, 0)


def _saturday_occurrence(value):
    """Thứ 7 thứ mấy trong tháng (1..5). Trả None nếu không phải thứ 7."""
    if value.weekday() != 5:
        return None
    return (value.day - 1) // 7 + 1


def _is_half_day_saturday(value, always_full_saturday=False):
    """Ngày này có phải thứ 7 chỉ làm buổi sáng không.

    `always_full_saturday`: nhân viên/phòng ban được đánh dấu làm chiều thứ 7
    mọi tuần (Employee.saturday_afternoon_always_workday, fallback sang
    Department) -> thứ 7 nào cũng là ngày làm đủ, không áp quy tắc tuần 2/4.
    """
    if always_full_saturday:
        return False
    return _saturday_occurrence(value) in SATURDAY_HALF_DAY_OCCURRENCES


def _always_full_saturday(employee, on_date=None, schedule=None):
    """Cờ làm chiều thứ 7 mọi tuần, ưu tiên cờ riêng của NV rồi mới tới phòng ban.

    Thứ tự ưu tiên lấy đúng theo replay_month (hrm/main_api.py): cờ của nhân
    viên khác None thì dùng luôn, ngược lại mới xét phòng ban — cờ phòng ban tra
    theo ngày `on_date` (employee/schedule.py, lịch có thể đổi giữa tháng).
    """
    from employee.schedule import ScheduleResolver
    return (schedule or ScheduleResolver()).saturday_afternoon_workday(employee, on_date)


def _split_single_punch(check_in, check_out, split=MIDDAY_SPLIT):
    """Xử lý bản ghi chỉ có ĐÚNG 1 lần quẹt, trả về (check_in, check_out, ghi_chú).

    Nếu lần quẹt duy nhất nằm ở buổi chiều (>= MIDDAY_SPLIT) mà lại đang nằm ở
    cột giờ VÀO thì đó thực chất là giờ RA -> chuyển nó sang cột giờ ra và để
    giờ vào trống cho bước sinh ngẫu nhiên điền buổi sáng. Không làm bước này
    thì giờ ra sinh ngẫu nhiên (17:31–18:00) sẽ rơi TRƯỚC giờ vào 17:4x, tạo ra
    bản ghi vô nghĩa kiểu 17:42 → 17:41.
    """
    if check_in is not None and check_out is None and check_in >= split:
        return None, check_in, 'chuyển giờ vào -> giờ ra'
    return check_in, check_out, None


def _in_range(value, bounds):
    """Giờ `value` có nằm trong khoảng cho phép [start, end] không (tính cả 2 cận).

    So tới phút, bỏ qua giây — giờ đang có trong DB thường là HH:MM:00 nhưng
    dữ liệu từ một số nguồn có lẻ giây, không nên vì mấy giây đó mà coi là
    ngoài khoảng rồi ghi đè oan.
    """
    if not value:
        return False
    start, end = bounds
    minutes = value.hour * 60 + value.minute
    return (start.hour * 60 + start.minute) <= minutes <= (end.hour * 60 + end.minute)


def _parse_date(value):
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    raise CommandError(
        f"Ngày '{value}' không hợp lệ. Định dạng cần dùng: d-m-y (vd 09-09-2026)."
    )


def _parse_time(value, flag_name):
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).time()
        except ValueError:
            continue
    raise CommandError(
        f"Giờ '{value}' ở {flag_name} không hợp lệ. Định dạng cần dùng: HH:MM hoặc HH:MM:SS."
    )


def _working_hours(attendance_date, check_in, check_out):
    """Số giờ làm, xử lý ca qua đêm y hệt upload_serializers."""
    if not check_in or not check_out:
        return None
    check_in_dt = datetime.combine(attendance_date, check_in)
    check_out_dt = datetime.combine(attendance_date, check_out)
    if check_out <= check_in:
        check_out_dt = datetime.combine(attendance_date + timedelta(days=1), check_out)
    return (check_out_dt - check_in_dt).total_seconds() / 3600


def _status_from(check_in, check_out):
    """Trạng thái suy từ giá trị ĐÃ hợp nhất, giống upload_serializers."""
    if check_in and check_out:
        return 'PRESENT'
    if check_in or check_out:
        return 'HALF_DAY'
    return 'ABSENT'


def _fmt(t):
    return t.strftime('%H:%M:%S') if t else '—'


def _parse_skip_dates(value):
    """'05-09-2026,12-09-2026' -> set các date cần bỏ qua. Rỗng -> set rỗng."""
    if not value:
        return set()
    result = set()
    for part in value.split(','):
        part = part.strip()
        if part:
            result.add(_parse_date(part))
    return result


def _parse_month(value):
    """'09-2026' hoặc '9/2026' -> (2026, 9)."""
    for fmt in ('%m-%Y', '%m/%Y'):
        try:
            parsed = datetime.strptime(value.strip(), fmt)
            return parsed.year, parsed.month
        except ValueError:
            continue
    raise CommandError(
        f"Tháng '{value}' không hợp lệ. Định dạng cần dùng: m-Y (vd 09-2026)."
    )


class Command(BaseCommand):
    help = "Sửa/tạo chấm công (check_in, check_out) cho 1 NV/ngày, hoặc điền giờ thiếu cả tháng"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str, nargs='?', default=None,
                            help="Mã nhân viên, vd NV80026 (chế độ 1 ngày)")
        parser.add_argument('date', type=str, nargs='?', default=None,
                            help="Ngày chấm công d-m-y, vd 09-09-2026 (chế độ 1 ngày)")
        parser.add_argument('--month', dest='month', type=str, default=None,
                            help="Chế độ CẢ THÁNG: m-Y (vd 09-2026). Quét mọi bản ghi "
                                 "thiếu giờ vào/ra trong tháng và điền nốt phần thiếu.")
        parser.add_argument('--employee', dest='employee_filter', type=str, default=None,
                            help="Chỉ áp dụng cho 1 mã NV (dùng kèm --month).")
        parser.add_argument('--include-absent', action='store_true',
                            help="CHẾ ĐỘ THÁNG: xử lý cả bản ghi thiếu CẢ HAI giờ (thường là "
                                 "ngày nghỉ/vắng thật, status=ABSENT). Mặc định BỎ QUA nhóm này "
                                 "và chỉ vá bản ghi thiếu đúng 1 bên (quên chấm công vào/ra).")
        parser.add_argument('--check-in', dest='check_in', type=str, default=None,
                            help="Giờ vào HH:MM. Không truyền = sinh ngẫu nhiên trong 08:10–08:29.")
        parser.add_argument('--check-out', dest='check_out', type=str, default=None,
                            help="Giờ ra HH:MM. Không truyền = sinh ngẫu nhiên trong 17:31–18:00.")
        parser.add_argument('--clear-check-in', action='store_true',
                            help="Xoá giờ vào (đặt NULL).")
        parser.add_argument('--clear-check-out', action='store_true',
                            help="Xoá giờ ra (đặt NULL).")
        parser.add_argument('--by', dest='by', type=str, default=None,
                            help="Mã NV người thực hiện, ghi vào created_by để truy vết.")
        parser.add_argument('--note', dest='note', type=str, default=None,
                            help="Ghi chú lưu vào Attendance.notes.")
        parser.add_argument('--reconcile', action='store_true',
                            help="Chạy đối soát tăng ca ONSITE sau khi ghi, giống luồng upload.")
        parser.add_argument('--skip-dates', dest='skip_dates', type=str, default=None,
                            help="Bỏ qua các ngày này, cách nhau bằng dấu phẩy, định dạng d-m-y "
                                 "(vd: 05-09-2026,12-09-2026). Dùng được cho cả 2 chế độ.")
        parser.add_argument('--dry-run', action='store_true',
                            help="Chỉ in ra thay đổi dự kiến, KHÔNG ghi DB.")

    def handle(self, *args, **options):
        # ── Chọn chế độ ────────────────────────────────────────────────────
        if options['month']:
            if options['employee_id'] or options['date']:
                raise CommandError(
                    "Chế độ --month không nhận tham số vị trí. Lọc theo nhân viên thì dùng --employee."
                )
            for flag in ('check_in', 'check_out'):
                if options[flag]:
                    raise CommandError(
                        f"--{flag.replace('_', '-')} chỉ dùng cho 1 ngày cụ thể, không dùng với --month."
                    )
            if options['clear_check_in'] or options['clear_check_out']:
                raise CommandError("--clear-* chỉ dùng cho 1 ngày cụ thể, không dùng với --month.")
            return self._handle_month(options)

        if not options['employee_id'] or not options['date']:
            raise CommandError(
                "Cần <mã_NV> <ngày d-m-y>, hoặc dùng --month <m-Y> để quét cả tháng."
            )
        if options['employee_filter']:
            raise CommandError("--employee chỉ dùng kèm --month.")
        return self._handle_single_day(options)

    # ══════════════════════════════════════════════════════════════════════
    # Chế độ 1: một nhân viên, một ngày
    # ══════════════════════════════════════════════════════════════════════
    def _handle_single_day(self, options):
        employee_code = options['employee_id']
        attendance_date = _parse_date(options['date'])
        dry_run = options['dry_run']

        # Ngày bị loại trừ -> dừng ngay, không đụng DB. Để lệnh chạy hàng loạt
        # trong vòng lặp shell vẫn dùng chung được 1 danh sách ngày loại trừ.
        skip_dates = _parse_skip_dates(options['skip_dates'])
        if attendance_date in skip_dates:
            self.stdout.write(self.style.WARNING(
                f"Ngày {attendance_date.strftime('%d/%m/%Y')} nằm trong --skip-dates "
                f"-> bỏ qua, không ghi gì vào DB."
            ))
            return

        if options['check_in'] and options['clear_check_in']:
            raise CommandError("Không thể vừa --check-in vừa --clear-check-in.")
        if options['check_out'] and options['clear_check_out']:
            raise CommandError("Không thể vừa --check-out vừa --clear-check-out.")

        new_check_in = _parse_time(options['check_in'], '--check-in') if options['check_in'] else None
        new_check_out = _parse_time(options['check_out'], '--check-out') if options['check_out'] else None

        try:
            employee = Employee.objects.get(employee_id=employee_code)
        except Employee.DoesNotExist:
            raise CommandError(f"Không tìm thấy nhân viên có mã {employee_code}.")

        created_by = None
        if options['by']:
            try:
                created_by = Employee.objects.get(employee_id=options['by'])
            except Employee.DoesNotExist:
                raise CommandError(f"Không tìm thấy nhân viên --by {options['by']}.")

        # ── Bản ghi đang có ────────────────────────────────────────────────
        # Upload dò theo (employee, attendance_date) nên ở đây giữ nguyên cách
        # đó. unique_together còn có shift_type, nên về lý thuyết 1 ngày có thể
        # có nhiều bản ghi khác shift_type — cảnh báo rõ thay vì âm thầm chọn
        # bừa, vì chọn nhầm sẽ sửa sai bản ghi.
        candidates = list(
            Attendance.objects.filter(employee=employee, attendance_date=attendance_date).order_by('id')
        )
        if len(candidates) > 1:
            self.stdout.write(self.style.WARNING(
                f"⚠ Ngày {attendance_date} có {len(candidates)} bản ghi chấm công: "
                + ", ".join(f"id={a.id}/shift={a.shift_type}" for a in candidates)
            ))
        existing = next((a for a in candidates if a.shift_type == SHIFT_TYPE), None) or (
            candidates[0] if candidates else None
        )

        # ── Quyết định giờ vào/ra ──────────────────────────────────────────
        # Không truyền --check-in/--check-out -> SINH NGẪU NHIÊN trong khoảng
        # giờ hành chính hợp lệ, KHÔNG giữ lại giá trị cũ. Đây là điểm khác
        # luồng upload (file thiếu cột thì giữ giá trị cũ) — ở đây lệnh được
        # dùng để dựng giờ chấm công hợp lý cho ngày chưa có/sai dữ liệu, nên
        # bỏ trống nghĩa là "tự sinh giúp tôi". Muốn giữ nguyên giá trị đang
        # có thì truyền thẳng giờ đó, muốn xoá thì dùng --clear-*.
        # Giá trị đang có mà ĐÃ nằm trong khoảng cho phép thì GIỮ NGUYÊN, không
        # random đè lên — giờ chấm công thật luôn đáng tin hơn giờ bịa ra, và
        # chạy lại lệnh nhiều lần cũng không làm dữ liệu nhảy lung tung
        # (idempotent). Chỉ random khi ô đó đang trống hoặc đang nằm ngoài
        # khoảng.
        old_check_in = existing.check_in if existing else None
        old_check_out = existing.check_out if existing else None

        if options['clear_check_in']:
            check_in, check_in_src = None, 'xoá'
        elif new_check_in:
            check_in, check_in_src = new_check_in, 'tham số'
        elif _in_range(old_check_in, RANDOM_CHECK_IN_RANGE):
            check_in, check_in_src = old_check_in, 'giữ nguyên (đã trong khoảng)'
        else:
            check_in, check_in_src = _random_time(*RANDOM_CHECK_IN_RANGE), 'ngẫu nhiên'

        if options['clear_check_out']:
            check_out, check_out_src = None, 'xoá'
        elif new_check_out:
            check_out, check_out_src = new_check_out, 'tham số'
        elif _in_range(old_check_out, RANDOM_CHECK_OUT_RANGE):
            check_out, check_out_src = old_check_out, 'giữ nguyên (đã trong khoảng)'
        else:
            check_out, check_out_src = _random_time(*RANDOM_CHECK_OUT_RANGE), 'ngẫu nhiên'

        status = _status_from(check_in, check_out)
        working_hours = _working_hours(attendance_date, check_in, check_out)

        # ── In ra thay đổi ─────────────────────────────────────────────────
        self.stdout.write(f"\n=== {employee.employee_id} — {employee.full_name} — ngày {attendance_date} ===")
        if existing:
            self.stdout.write(f"Attendance   : id={existing.id} (cập nhật)")
            self.stdout.write(f"  giờ vào    : {_fmt(existing.check_in)}  ->  {_fmt(check_in)}  [{check_in_src}]")
            self.stdout.write(f"  giờ ra     : {_fmt(existing.check_out)}  ->  {_fmt(check_out)}  [{check_out_src}]")
            self.stdout.write(f"  trạng thái : {existing.status}  ->  {status}")
        else:
            self.stdout.write("Attendance   : chưa có -> TẠO MỚI")
            self.stdout.write(f"  giờ vào    : {_fmt(check_in)}  [{check_in_src}]")
            self.stdout.write(f"  giờ ra     : {_fmt(check_out)}  [{check_out_src}]")
            self.stdout.write(f"  trạng thái : {status}")
        if working_hours is not None:
            self.stdout.write(f"  số giờ làm : {working_hours:.2f}")

        existing_event = EmployeeEvent.objects.filter(
            employee=employee,
            event_date=attendance_date,
            event_type=EmployeeEvent.EventType.ATTENDANCE,
        ).first()
        self.stdout.write(
            f"EmployeeEvent: id={existing_event.id} (cập nhật)" if existing_event
            else "EmployeeEvent: chưa có -> TẠO MỚI"
        )

        # ── Không có gì đổi -> không đụng DB ───────────────────────────────
        # Cả 2 giờ đều giữ nguyên (đã nằm trong khoảng hoặc trùng giá trị
        # truyền vào), trạng thái cũng không đổi, và EmployeeEvent đã khớp ->
        # ghi lại chỉ tạo ra 1 lượt UPDATE rỗng + đổi updated_at, làm nhiễu
        # lịch sử sự kiện mà không thay đổi gì thật.
        nothing_changed = (
            existing is not None
            and existing.check_in == check_in
            and existing.check_out == check_out
            and existing.status == status
            and existing_event is not None
            and existing_event.check_in == check_in
            and existing_event.check_out == check_out
        )
        if nothing_changed:
            self.stdout.write(self.style.SUCCESS(
                "\n✓ Dữ liệu đã đúng sẵn — không cần cập nhật, không ghi gì vào DB.\n"
            ))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING("\n[DRY-RUN] Không ghi gì vào DB.\n"))
            return

        # ── Ghi DB ─────────────────────────────────────────────────────────
        # QUAN TRỌNG — dùng bulk_create/bulk_update chứ KHÔNG dùng .save():
        # Attendance.save() (hrm/models.py) gọi AttendanceRuleEngine và GHI ĐÈ
        # status + working_hours bằng kết quả của nó. Luồng upload dùng bulk_*
        # nên save() không bao giờ chạy, và status lưu xuống đúng là
        # PRESENT/HALF_DAY/ABSENT suy từ giờ vào/ra. Nếu ở đây dùng .save() thì
        # cùng một lượt sửa sẽ cho ra dữ liệu KHÁC upload — đã kiểm chứng: xoá
        # giờ ra làm hrm_attendance.status thành INCOMPLETE_ATTENDANCE và
        # working_hours về 0, trong khi hrm_employeeevent.data.status vẫn
        # HALF_DAY -> hai bảng lệch nhau.
        with transaction.atomic():
            if existing:
                existing.check_in = check_in
                existing.check_out = check_out
                existing.status = status
                existing.working_hours = working_hours or 0
                if created_by:
                    existing.created_by = created_by
                if options['note']:
                    existing.notes = options['note']
                # Bản ghi cũ có thể thiếu mã (upload cũng vá trường hợp này).
                if not existing.attendance_code:
                    existing.attendance_code = self._new_code()

                fields = ['check_in', 'check_out', 'status', 'working_hours', 'attendance_code']
                if created_by:
                    fields.append('created_by')
                if options['note']:
                    fields.append('notes')
                # Cố ý KHÔNG đụng imported_from_file / import_batch (upload có
                # ghi 2 field này) — sửa tay không được xoá dấu vết bản ghi gốc
                # đến từ file máy chấm công nào.
                Attendance.objects.bulk_update([existing], fields)
                attendance = existing
                action = "đã cập nhật"
            else:
                attendance = Attendance(
                    attendance_code=self._new_code(),
                    employee=employee,
                    attendance_date=attendance_date,
                    check_in=check_in,
                    check_out=check_out,
                    status=status,
                    shift_type=SHIFT_TYPE,
                    working_hours=working_hours or 0,
                    notes=options['note'] or '',
                    created_by=created_by,
                )
                Attendance.objects.bulk_create([attendance])
                if not attendance.pk:
                    # Phòng backend DB không trả PK về sau bulk_create.
                    attendance = Attendance.objects.get(
                        employee=employee, attendance_date=attendance_date, shift_type=SHIFT_TYPE,
                    )
                action = "đã tạo mới"

            event_payload = {
                'attendance_id': attendance.id,
                'status': status,
                'import_source': IMPORT_SOURCE,
            }
            if existing_event:
                existing_event.check_in = check_in
                existing_event.check_out = check_out
                if created_by:
                    existing_event.created_by = created_by
                # Giữ lại các key khác đã có trong data (vd cờ do luồng khác
                # ghi) — chỉ ghi đè đúng 3 key của lượt chấm công này.
                data = dict(existing_event.data or {})
                data.update(event_payload)
                existing_event.data = data
                existing_event.save()
            else:
                EmployeeEvent.objects.create(
                    employee=employee,
                    event_date=attendance_date,
                    event_type=EmployeeEvent.EventType.ATTENDANCE,
                    check_in=check_in,
                    check_out=check_out,
                    created_by=created_by,
                    data=event_payload,
                )

        self.stdout.write(self.style.SUCCESS(
            f"\n✓ Chấm công {action}: {employee.employee_id} ngày {attendance_date} "
            f"({_fmt(check_in)} → {_fmt(check_out)}, {status})"
        ))
        self.stdout.write(
            "  Công/phạt được tính lại khi đọc (replay) — chỉ cần load lại trang chấm công.\n"
        )

        # ── Đối soát tăng ca ONSITE (tuỳ chọn) ─────────────────────────────
        # Giống upload: chạy NGOÀI transaction, best-effort, lỗi ở đây không
        # được làm hỏng kết quả sửa chấm công đã commit ở trên.
        if options['reconcile']:
            try:
                from hrm.overtime_reconciliation import reconcile_onsite_overtime
                flagged = reconcile_onsite_overtime([(employee, attendance_date)])
                self.stdout.write(
                    f"  Đối soát tăng ca ONSITE: {len(flagged) if flagged else 0} đơn cần xem lại."
                )
            except Exception as exc:
                self.stdout.write(self.style.WARNING(
                    f"  ⚠ Đối soát tăng ca lỗi (bỏ qua, chấm công vẫn đã lưu): {exc}"
                ))

    # ══════════════════════════════════════════════════════════════════════
    # Chế độ 2: quét cả tháng, điền nốt giờ còn thiếu
    # ══════════════════════════════════════════════════════════════════════
    def _handle_month(self, options):
        year, month = _parse_month(options['month'])
        dry_run = options['dry_run']

        created_by = None
        if options['by']:
            try:
                created_by = Employee.objects.get(employee_id=options['by'])
            except Employee.DoesNotExist:
                raise CommandError(f"Không tìm thấy nhân viên --by {options['by']}.")

        # Chỉ lấy bản ghi THIẾU giờ vào HOẶC giờ ra. Bản ghi đủ cả 2 không đụng
        # tới, kể cả giờ nằm ngoài khoảng hành chính — lệnh này để vá dữ liệu
        # thiếu, không phải để nắn lại giờ chấm công thật.
        qs = Attendance.objects.filter(
            attendance_date__year=year,
            attendance_date__month=month,
        ).filter(
            Q(check_in__isnull=True) | Q(check_out__isnull=True)
        ).select_related(
            # department dùng cho cờ saturday_afternoon_always_workday
            'employee', 'employee__department',
        ).order_by('attendance_date', 'employee_id')

        # Bản ghi thiếu CẢ HAI giờ gần như luôn là ngày nghỉ/vắng thật
        # (status=ABSENT), không phải "quên chấm công". Điền giờ cho nhóm này
        # sẽ biến ABSENT -> PRESENT hàng loạt, tức là bịa ra ngày công cho
        # người không đi làm. Mặc định BỎ QUA, phải nói rõ --include-absent
        # mới đụng tới.
        if not options['include_absent']:
            qs = qs.filter(Q(check_in__isnull=False) | Q(check_out__isnull=False))

        if options['employee_filter']:
            code = options['employee_filter']
            if not Employee.objects.filter(employee_id=code).exists():
                raise CommandError(f"Không tìm thấy nhân viên có mã {code}.")
            qs = qs.filter(employee__employee_id=code)

        # Loại trừ ngày cụ thể (vd ngày nghỉ lễ, ngày đã chốt công, ngày cả
        # công ty nghỉ) — lọc ngay ở DB để không tải về rồi mới bỏ.
        skip_dates = _parse_skip_dates(options['skip_dates'])
        if skip_dates:
            # Chỉ cảnh báo những ngày thực sự nằm ngoài tháng đang quét, vì
            # gõ nhầm tháng là lỗi dễ xảy ra mà lại im lặng không báo gì.
            ngoai_thang = sorted(d for d in skip_dates if (d.year, d.month) != (year, month))
            if ngoai_thang:
                self.stdout.write(self.style.WARNING(
                    "⚠ --skip-dates có ngày không thuộc tháng đang quét (bỏ qua vô nghĩa): "
                    + ', '.join(d.strftime('%d/%m/%Y') for d in ngoai_thang)
                ))
            qs = qs.exclude(attendance_date__in=skip_dates)

        records = list(qs)
        scope = f" (NV {options['employee_filter']})" if options['employee_filter'] else ""
        self.stdout.write(f"\n=== Chấm công thiếu giờ — tháng {month:02d}/{year}{scope} ===")

        if skip_dates:
            trong_thang = sorted(d for d in skip_dates if (d.year, d.month) == (year, month))
            if trong_thang:
                self.stdout.write(
                    "Bỏ qua ngày: "
                    + ', '.join(d.strftime('%d/%m') for d in trong_thang)
                )

        if options['include_absent']:
            n_absent = sum(1 for a in records if a.check_in is None and a.check_out is None)
            if n_absent:
                self.stdout.write(self.style.WARNING(
                    f"⚠ --include-absent: {n_absent} bản ghi thiếu CẢ HAI giờ sẽ được điền, "
                    f"biến ABSENT -> PRESENT (bịa ngày công cho người không đi làm)."
                ))

        if not records:
            self.stdout.write(self.style.SUCCESS("Không có bản ghi nào thiếu giờ vào/ra. Không cần cập nhật.\n"))
            return
        self.stdout.write(f"Tìm thấy {len(records)} bản ghi thiếu giờ.\n")

        # Nạp sẵn EmployeeEvent tương ứng trong 1 query thay vì hỏi từng dòng.
        pairs = [(a.employee_id, a.attendance_date) for a in records]
        event_filter = Q()
        for emp_id, att_date in pairs:
            event_filter |= Q(employee_id=emp_id, event_date=att_date)
        events_map = {
            (e.employee_id, e.event_date): e
            for e in EmployeeEvent.objects.filter(
                event_filter, event_type=EmployeeEvent.EventType.ATTENDANCE
            )
        } if pairs else {}

        attendance_to_update = []
        events_to_update = []
        events_to_create = []
        filled_in = filled_out = 0

        skipped = []
        from employee.schedule import ScheduleResolver
        schedule = ScheduleResolver()  # 1 truy vấn bảng đổi lịch cho cả lượt
        for att in records:
            event = events_map.get((att.employee_id, att.attendance_date))
            notes = []

            # 0) Thứ 7: tuần 2/4 chỉ làm buổi sáng (tan 12:00), tuần 1/3/5 làm
            #    cả ngày như ngày thường. Quyết định này đổi cả mốc chia buổi
            #    lẫn khoảng giờ ra bên dưới.
            half_saturday = _is_half_day_saturday(
                att.attendance_date, _always_full_saturday(att.employee, att.attendance_date, schedule)
            )
            if half_saturday:
                out_range = RANDOM_CHECK_OUT_SATURDAY_HALF_RANGE
                split = SATURDAY_HALF_MIDDAY_SPLIT
                notes.append(f"thứ 7 tuần {_saturday_occurrence(att.attendance_date)} — nửa ngày")
            else:
                out_range = RANDOM_CHECK_OUT_RANGE
                split = MIDDAY_SPLIT
                if att.attendance_date.weekday() == 5:
                    notes.append(f"thứ 7 tuần {_saturday_occurrence(att.attendance_date)} — cả ngày")

            # 1) Lần quẹt lẻ buổi chiều đang nằm nhầm ở cột giờ vào -> đẩy sang
            #    cột giờ ra (yêu cầu: "tạo checkin, copy checkin đã có thành checkout").
            check_in, check_out, swap_note = _split_single_punch(att.check_in, att.check_out, split)
            if swap_note:
                notes.append(swap_note)

            # 2) EmployeeEvent (nguồn engine tính công thật sự đọc) có thể đã có
            #    giờ đúng trong khi Attendance còn thiếu — hai bảng lệch nhau do
            #    các lần sửa tay trước chỉ cập nhật EmployeeEvent. Ưu tiên dùng
            #    lại giờ thật ở đó thay vì bịa ra giờ ngẫu nhiên đè lên.
            #    Chỉ nhận giá trị THỰC SỰ dùng được: EmployeeEvent thường chỉ là
            #    bản sao của Attendance nên hay chứa y nguyên lần quẹt lẻ buổi
            #    chiều ở cột giờ vào — nhận bừa sẽ ra giờ vào = giờ ra.
            if event:
                if (check_in is None and event.check_in is not None
                        and event.check_in < split):
                    check_in = event.check_in
                    notes.append('giờ vào lấy từ EmployeeEvent')
                if (check_out is None and event.check_out is not None
                        and (check_in is None or event.check_out > check_in)):
                    check_out = event.check_out
                    notes.append('giờ ra lấy từ EmployeeEvent')

            # 3) Còn thiếu thì mới sinh ngẫu nhiên.
            if check_in is None:
                check_in = _random_time(*RANDOM_CHECK_IN_RANGE)
                filled_in += 1
                notes.append('giờ vào ngẫu nhiên')
            if check_out is None:
                check_out = _random_time(*out_range)
                filled_out += 1
                notes.append('giờ ra ngẫu nhiên')

            # 4) Chốt chặn: giờ ra phải sau giờ vào. Nếu vẫn không thoả (dữ liệu
            #    gốc quá bất thường) thì BỎ QUA bản ghi, không ghi rác vào DB.
            if check_out <= check_in:
                skipped.append((att, check_in, check_out))
                self.stdout.write(self.style.WARNING(
                    f"  {att.employee.employee_id:10} {att.attendance_date}  BỎ QUA — "
                    f"giờ ra {_fmt(check_out)} không sau giờ vào {_fmt(check_in)}"
                ))
                continue

            status = _status_from(check_in, check_out)
            working_hours = _working_hours(att.attendance_date, check_in, check_out)

            note_str = f"  ({', '.join(notes)})" if notes else ""
            self.stdout.write(
                f"  {att.employee.employee_id:10} {att.attendance_date}  "
                f"{_fmt(att.check_in)} → {_fmt(att.check_out)}   ==>   "
                f"{_fmt(check_in)} → {_fmt(check_out)}  [{att.status} -> {status}]{note_str}"
            )

            if dry_run:
                continue

            att.check_in = check_in
            att.check_out = check_out
            att.status = status
            att.working_hours = working_hours or 0
            if created_by:
                att.created_by = created_by
            if not att.attendance_code:
                att.attendance_code = self._new_code()
            attendance_to_update.append(att)

            payload = {
                'attendance_id': att.id,
                'status': status,
                'import_source': IMPORT_SOURCE,
            }
            if event:
                event.check_in = check_in
                event.check_out = check_out
                if created_by:
                    event.created_by = created_by
                data = dict(event.data or {})
                data.update(payload)
                event.data = data
                events_to_update.append(event)
            else:
                events_to_create.append(EmployeeEvent(
                    employee_id=att.employee_id,
                    event_date=att.attendance_date,
                    event_type=EmployeeEvent.EventType.ATTENDANCE,
                    check_in=check_in,
                    check_out=check_out,
                    created_by=created_by,
                    data=payload,
                ))

        self.stdout.write(
            f"\nSinh giờ vào: {filled_in} bản ghi | Sinh giờ ra: {filled_out} bản ghi"
        )
        if skipped:
            self.stdout.write(self.style.WARNING(
                f"Bỏ qua {len(skipped)} bản ghi do giờ ra không sau giờ vào."
            ))

        if dry_run:
            self.stdout.write(self.style.WARNING("\n[DRY-RUN] Không ghi gì vào DB.\n"))
            return

        # bulk_* để Attendance.save() không chạy (nó gọi rule engine và ghi đè
        # status/working_hours) — xem ghi chú dài ở chế độ 1 ngày.
        with transaction.atomic():
            if attendance_to_update:
                fields = ['check_in', 'check_out', 'status', 'working_hours', 'attendance_code']
                if created_by:
                    fields.append('created_by')
                Attendance.objects.bulk_update(attendance_to_update, fields, batch_size=500)
            if events_to_update:
                EmployeeEvent.objects.bulk_update(
                    events_to_update, ['check_in', 'check_out', 'created_by', 'data'], batch_size=500
                )
            if events_to_create:
                EmployeeEvent.objects.bulk_create(events_to_create, batch_size=500, ignore_conflicts=True)

        self.stdout.write(self.style.SUCCESS(
            f"\n✓ Đã cập nhật {len(attendance_to_update)} bản ghi chấm công "
            f"({len(events_to_update)} event cập nhật, {len(events_to_create)} event tạo mới)."
        ))
        self.stdout.write(
            "  Công/phạt được tính lại khi đọc (replay) — chỉ cần load lại trang chấm công.\n"
        )

        if options['reconcile']:
            try:
                from hrm.overtime_reconciliation import reconcile_onsite_overtime
                emp_by_id = {a.employee_id: a.employee for a in records}
                flagged = reconcile_onsite_overtime([
                    (emp_by_id[a.employee_id], a.attendance_date) for a in attendance_to_update
                ])
                self.stdout.write(
                    f"  Đối soát tăng ca ONSITE: {len(flagged) if flagged else 0} đơn cần xem lại."
                )
            except Exception as exc:
                self.stdout.write(self.style.WARNING(
                    f"  ⚠ Đối soát tăng ca lỗi (bỏ qua, chấm công vẫn đã lưu): {exc}"
                ))

    @staticmethod
    def _new_code():
        """Mã chấm công duy nhất, cùng dạng ATT-<timestamp>-<suffix> như upload."""
        now = django_timezone.now()
        return f"ATT-{now.strftime('%Y%m%d%H%M%S')}-{now.microsecond:06d}-{str(uuid.uuid4())[:8]}"
