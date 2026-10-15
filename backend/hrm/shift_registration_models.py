"""
hrm/shift_registration_models.py
═════════════════════════════════
Models cho tính năng "Đăng ký ca làm" tuỳ biến — chạy SONG SONG với ca làm cố
định hiện có (ShiftConfig / RuleDefinition), CHỈ áp dụng cho nhân viên thoả
ĐỦ điều kiện cấu hình trong ShiftRegistrationScopeConfig: phòng ban VÀ vị
trí (LUÔN bắt buộc) VÀ bác sĩ phụ trách (Employee.doctor_team) — điều kiện
bác sĩ phụ trách CHỈ bắt buộc khi config có điền `doctor_teams`; để trống
nghĩa là config đó không áp dụng cho nhóm bác sĩ nào cả, chỉ cần khớp phòng
ban + vị trí (dùng cho các phòng ban không liên quan bác sĩ, VD: IT, AI...).

QUAN TRỌNG — mô hình "1 ca = 1 cặp Ca sáng + Ca chiều": trong hệ thống, ca
làm được cấu hình thành các ShiftConfig RIÊNG cho buổi sáng và buổi chiều
(không phải 1 khối thời gian liên tục cho cả ngày). "Ca 1"/"Ca 2" ở tính
năng này vì vậy KHÔNG phải 1 ShiftConfig đơn lẻ, mà là 1 CẶP (ca sáng, ca
chiều) — ví dụ Ca 1 = (7h30-12h00, 13h00-16h30), Ca 2 = (khung giờ khác).
Nhân viên vẫn chỉ chọn 1 trong 2 "ca" (Ca 1/Ca 2/Nghỉ) cho mỗi ngày như
thiết kế ban đầu — chọn xong thì áp dụng CẢ 2 buổi sáng+chiều của ca đó.

Thiết kế theo yêu cầu:
  1. Phạm vi áp dụng (phòng ban + vị trí + bác sĩ phụ trách, ĐỦ CẢ 3 - AND)
     + 2 ca (mỗi ca = 1 cặp sáng/chiều): có thể tạo NHIỀU config song song
     (mỗi nhóm phòng ban/vị trí/bác sĩ phụ trách có thể cần cặp Ca 1/Ca 2
     giờ khác nhau) — sửa được ở Django admin. Dùng
     ShiftRegistrationScopeConfig.for_employee(employee) để lấy ĐÚNG config
     áp dụng cho 1 nhân viên cụ thể, KHÔNG dùng trực tiếp .filter(is_active=
     True).first() nữa (chỉ đúng khi còn giả định singleton).
  2. Nhân viên đăng ký ca theo tuần, chỉ chọn giữa 2 ca đã cấu hình (hoặc
     nghỉ) — KHÔNG qua duyệt, lưu là có hiệu lực ngay (miễn còn hạn).
  3. Hạn đăng ký cho tuần sau: hết Thứ 7 (23:59:59).
  4. "Đơn đổi ca" (đổi Ca 1 <-> Ca 2 cho 1 ngày cụ thể — LUÔN đổi cả 2 buổi
     sáng/chiều cùng lúc vì chúng đi theo cặp) không nằm ở đây — nó tái sử
     dụng luồng "Đơn đăng ký" hiện có (EmployeeEvent, xem
     registration_serializers.py / registration_views.py), duyệt 2 bước
     QLTT -> HR như các đơn đăng ký khác. Khi duyệt xong, đơn đó ghi đè
     ShiftRegistrationDay của ngày tương ứng sang cặp ca mới (xem
     apply_shift_change_effect trong registration_views.py).
  5. Ưu tiên: engine tính công (xem
     shift_config_utils.get_registered_shift_configs_for_date, dùng trong
     main_api.py) chỉ đọc ShiftRegistrationDay cho nhân viên đang THỰC SỰ
     thuộc phạm vi cấu hình hiện tại — nhân viên ngoài phạm vi (ca làm cố
     định) không bị đụng tới dù bảng này có dữ liệu cũ do đổi cấu hình.
"""
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from employee.models import Employee, Department, Position

CA_CHOICES = [(1, 'Ca 1'), (2, 'Ca 2')]


class ShiftRegistrationScopeConfig(models.Model):
    """Cấu hình phạm vi áp dụng (phòng ban + vị trí + bác sĩ phụ trách) + 2 ca
    (mỗi ca = 1 cặp Ca sáng + Ca chiều). Có thể có NHIỀU bản ghi song song —
    dùng for_employee(employee) để lấy đúng config của 1 nhân viên.

    Phạm vi áp dụng: nhân viên phải thoả CẢ phòng ban NẰM TRONG danh sách cấu
    hình VÀ vị trí NẰM TRONG danh sách cấu hình (2 điều kiện này LUÔN bắt
    buộc, để trống thì không ai đạt được). Điều kiện thứ 3 — Employee.
    doctor_team (Team Bác sĩ phụ trách) khớp 1 trong các giá trị ở
    `doctor_teams` — CHỈ bắt buộc thêm khi trường `doctor_teams` của config
    có điền giá trị; để trống `doctor_teams` nghĩa là config này không lọc
    theo bác sĩ phụ trách (dùng cho các phòng ban không liên quan bác sĩ,
    VD: IT, AI...), chỉ cần khớp phòng ban + vị trí là đủ."""

    departments = models.ManyToManyField(
        Department, blank=True, related_name='shift_registration_scopes',
        verbose_name="Phòng ban áp dụng",
    )
    positions = models.ManyToManyField(
        Position, blank=True, related_name='shift_registration_scopes',
        verbose_name="Vị trí áp dụng",
    )
    # Employee.doctor_team là field text tự do (không phải FK) nên lưu danh
    # sách giá trị hợp lệ dạng chuỗi, cách nhau bằng dấu phẩy — so khớp
    # không phân biệt hoa/thường, bỏ khoảng trắng thừa (xem doctor_team_list()
    # / employee_in_scope()).
    doctor_teams = models.CharField(
        max_length=500, blank=True,
        verbose_name="Bác sĩ phụ trách áp dụng (Team Bác sĩ)",
        help_text=(
            "ĐỂ TRỐNG nếu phòng ban/vị trí này không liên quan bác sĩ (VD: IT, "
            "AI...) — khi đó chỉ cần khớp phòng ban + vị trí là đủ. Nếu điền, "
            "danh sách giá trị Employee.doctor_team (Team Bác sĩ) được áp dụng, "
            "cách nhau bằng dấu phẩy — VD: Huy, Thảo — nhân viên phải có "
            "doctor_team khớp (không phân biệt hoa/thường) 1 trong các giá trị "
            "này, NGOÀI việc thoả cả điều kiện phòng ban và vị trí, thì mới "
            "thuộc phạm vi áp dụng."
        ),
    )

    shift_1_morning = models.ForeignKey(
        'hrm.ShiftConfig', on_delete=models.PROTECT, null=True, blank=True,
        related_name='+', verbose_name="Ca 1 - Ca sáng",
    )
    shift_1_afternoon = models.ForeignKey(
        'hrm.ShiftConfig', on_delete=models.PROTECT, null=True, blank=True,
        related_name='+', verbose_name="Ca 1 - Ca chiều",
    )
    shift_2_morning = models.ForeignKey(
        'hrm.ShiftConfig', on_delete=models.PROTECT, null=True, blank=True,
        related_name='+', verbose_name="Ca 2 - Ca sáng",
    )
    shift_2_afternoon = models.ForeignKey(
        'hrm.ShiftConfig', on_delete=models.PROTECT, null=True, blank=True,
        related_name='+', verbose_name="Ca 2 - Ca chiều",
    )

    is_active = models.BooleanField(default=True, verbose_name="Đang áp dụng")

    # default=False để KHÔNG đổi hành vi của mọi config đang chạy (vd AI/IT,
    # id=2): đăng ký theo TUẦN, có hiệu lực ngay, không cần duyệt. Chỉ bật
    # True cho config nào cần mô hình khác hẳn — "mặc định Ca 1 cho mọi ngày
    # không đăng ký gì, chỉ đăng ký NGOẠI LỆ Ca 2 cho 1 ngày cụ thể, và đăng
    # ký đó phải được quản lý trực tiếp duyệt TRƯỚC 0h ngày áp dụng mới có
    # hiệu lực" (case đầu tiên: 8 Điều dưỡng BS Ma BS A). Xem
    # get_registered_shift_configs_for_date() (shift_config_utils.py) và
    # ShiftRegistrationViewSet.register_ca2/approve_day/reject_day
    # (shift_registration_views.py) — 2 nơi duy nhất đọc field này.
    requires_manager_approval = models.BooleanField(
        default=False,
        verbose_name="Ca 2 cần quản lý trực tiếp duyệt trước 0h ngày áp dụng",
        help_text=(
            "Bật cờ này => nhân viên KHÔNG đăng ký theo tuần nữa. Ca 1 là mặc "
            "định cho mọi ngày; muốn làm Ca 2 phải đăng ký cho 1 ngày cụ thể "
            "(chỉ được đăng ký cho ngày TƯƠNG LAI) và quản lý trực tiếp phải "
            "duyệt TRƯỚC 0h ngày đó — quá hạn coi như không có hiệu lực, ngày "
            "đó tự động tính theo Ca 1. Để trống (mặc định) giữ nguyên hành vi "
            "cũ: đăng ký theo tuần, có hiệu lực ngay, không cần duyệt."
        ),
    )

    # Tên gọi hiển thị cho 2 ô ca — ĐỘC LẬP với cơ chế (ô shift_1 luôn là ca
    # mặc định, ô shift_2 luôn là ca phải đăng ký). Cần vì mỗi team gọi khác
    # nhau: Điều dưỡng BS BS A mặc định "Ca 1", đăng ký "Ca 2"; còn Sale
    # BS B (thông báo 02/10/2026) thì NGƯỢC LẠI — mặc định "Ca 2",
    # đăng ký "Ca 1". FE đọc 2 trường này để hiện đúng nhãn nút cho từng team.
    default_ca_label = models.CharField(
        max_length=30, default="Ca 1",
        verbose_name="Tên gọi ca MẶC ĐỊNH (ô Ca 1 bên dưới)",
        help_text="Nhãn hiển thị cho ca tự động áp khi nhân viên không đăng ký gì. Mặc định: \"Ca 1\".",
    )
    registrable_ca_label = models.CharField(
        max_length=30, default="Ca 2",
        verbose_name="Tên gọi ca PHẢI ĐĂNG KÝ (ô Ca 2 bên dưới)",
        help_text="Nhãn hiển thị trên nút đăng ký và trong đơn chờ duyệt. Mặc định: \"Ca 2\".",
    )
    # Tắt => ngừng hẳn ca phải đăng ký (ô Ca 2 bên dưới): mọi ngày chỉ còn ca
    # mặc định. API chặn đăng ký mới (register-ca2, đăng ký tuần, đơn đổi ca
    # sang ô Ca 2) và trả registration_enabled=false để FE ẩn nút. Đăng ký CŨ
    # đã duyệt vẫn giữ nguyên hiệu lực (engine đọc ShiftRegistrationDay theo
    # từng ngày) — muốn bỏ các ngày tương lai thì huỷ riêng từng đơn. Case đầu
    # tiên: Sale BS B ngừng "Ca 1" 07:00-16:00 từ 14/10/2026.
    registration_enabled = models.BooleanField(
        default=True,
        verbose_name="Cho phép đăng ký ca (ô Ca 2 bên dưới)",
        help_text=(
            "Bỏ tick => nhân viên không đăng ký được ca này nữa (ẩn nút đăng ký), "
            "mọi ngày chỉ áp ca mặc định. Các đăng ký đã duyệt trước đó không bị đổi."
        ),
    )

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', verbose_name="Người cập nhật",
    )

    class Meta:
        verbose_name = "Cấu hình đăng ký ca làm"
        verbose_name_plural = "Cấu hình đăng ký ca làm"

    def __str__(self):
        depts = ", ".join(self.departments.values_list('name', flat=True)[:3])
        return f"Cấu hình đăng ký ca làm #{self.id}" + (f" ({depts})" if depts else "")

    @classmethod
    def for_employee(cls, employee):
        """Trả về ĐÚNG 1 config áp dụng cho nhân viên này (config mà
        employee_in_scope(employee) = True), hoặc None nếu nhân viên không
        thuộc phạm vi của bất kỳ config nào.

        Từ khi hỗ trợ NHIỀU config song song (mỗi nhóm phòng ban/vị trí/bác
        sĩ phụ trách có thể có cặp Ca 1/Ca 2 giờ khác nhau), một nhân viên
        chỉ nên khớp ĐÚNG 1 config — nếu vô tình khớp nhiều hơn 1 (HR cấu
        hình chồng lấn phạm vi), lấy config có id nhỏ nhất (tạo trước) và
        ghi log cảnh báo để HR biết mà sửa lại cấu hình chồng lấn.
        """
        if not employee:
            return None
        matched = [
            c for c in cls.objects.filter(is_active=True).order_by('id')
            if c.employee_in_scope(employee)
        ]
        if len(matched) > 1:
            import logging
            logging.getLogger(__name__).warning(
                "[ShiftRegistrationScopeConfig] Nhân viên %s khớp %d config cùng lúc "
                "(id=%s) — phạm vi đang bị chồng lấn, dùng config id=%s (nhỏ nhất). "
                "HR cần sửa lại phạm vi để không chồng lấn.",
                getattr(employee, 'employee_id', employee.id),
                len(matched), [c.id for c in matched], matched[0].id,
            )
        return matched[0] if matched else None

    def doctor_team_list(self) -> list:
        """Danh sách giá trị doctor_teams đã tách theo dấu phẩy, bỏ khoảng
        trắng thừa, bỏ giá trị rỗng — dùng để so khớp không phân biệt hoa/thường."""
        return [t.strip() for t in (self.doctor_teams or "").split(",") if t.strip()]

    def employee_in_scope(self, employee) -> bool:
        """Nhân viên thuộc phạm vi áp dụng nếu thoả: phòng ban nằm trong cấu
        hình VÀ vị trí nằm trong cấu hình (2 điều kiện LUÔN bắt buộc — bỏ
        trống bất kỳ điều kiện nào trong 2 điều kiện này cũng khiến hàm này
        luôn trả về False). Nếu config có điền `doctor_teams`, BẮT BUỘC thêm
        Employee.doctor_team khớp 1 trong các giá trị đó (không phân biệt
        hoa/thường); nếu `doctor_teams` để trống, bỏ qua điều kiện này (config
        không lọc theo bác sĩ phụ trách — dùng cho phòng ban không liên quan
        bác sĩ). Trả về False nếu cấu hình đang tắt (is_active=False)."""
        if not employee or not self.is_active:
            return False

        dept_ok = bool(
            employee.department_id
            and self.departments.filter(pk=employee.department_id).exists()
        )
        if not dept_ok:
            return False

        pos_ok = bool(
            employee.position_id
            and self.positions.filter(pk=employee.position_id).exists()
        )
        if not pos_ok:
            return False

        doctor_teams = self.doctor_team_list()
        if doctor_teams:
            employee_doctor_team = (getattr(employee, 'doctor_team', '') or '').strip().lower()
            doctor_ok = bool(employee_doctor_team) and employee_doctor_team in (
                v.lower() for v in doctor_teams
            )
            if not doctor_ok:
                return False

        return True

    def ca_pair(self, ca_choice):
        """Trả về (ca_sáng, ca_chiều) ShiftConfig của Ca 1 hoặc Ca 2. ca_choice
        không hợp lệ (khác 1/2) -> (None, None)."""
        if ca_choice == 1:
            return self.shift_1_morning, self.shift_1_afternoon
        if ca_choice == 2:
            return self.shift_2_morning, self.shift_2_afternoon
        return None, None

    @staticmethod
    def other_ca(ca_choice):
        """Ca còn lại trong cặp 2 ca — dùng cho đơn Đổi ca (chỉ có đúng 2 lựa
        chọn nên "đổi ca" luôn nghĩa là chuyển sang ca kia)."""
        if ca_choice == 1:
            return 2
        if ca_choice == 2:
            return 1
        return None

    def valid_ca_choices(self) -> set:
        return {1, 2}


def shift_registration_deadline(week_start_date):
    """
    Hạn đăng ký ca làm cho 1 tuần (week_start_date = Thứ 2 của tuần đó):
    hết Thứ 7 (23:59:59) của tuần liền trước — tức tuần sau phải đăng ký
    xong trước Chủ nhật.
    """
    saturday_before = week_start_date - timedelta(days=2)
    naive_end_of_day = timezone.datetime.combine(saturday_before, timezone.datetime.max.time())
    if timezone.is_naive(naive_end_of_day):
        return timezone.make_aware(naive_end_of_day)
    return naive_end_of_day


class ShiftRegistration(models.Model):
    """Đăng ký ca làm theo tuần của 1 nhân viên — KHÔNG qua duyệt, có hiệu lực
    ngay khi lưu (miễn còn trong hạn)."""

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='shift_registrations',
        verbose_name="Nhân viên",
    )
    week_start_date = models.DateField(verbose_name="Ngày bắt đầu tuần (Thứ 2)")
    week_end_date = models.DateField(verbose_name="Ngày kết thúc tuần (Chủ nhật)")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Đăng ký ca làm"
        verbose_name_plural = "Đăng ký ca làm"
        unique_together = ['employee', 'week_start_date']
        indexes = [
            models.Index(fields=['employee', 'week_start_date']),
        ]

    def __str__(self):
        return f"{self.employee.employee_id} - tuần {self.week_start_date}"

    def clean(self):
        if self.week_start_date and self.week_start_date.weekday() != 0:
            raise ValidationError("Ngày bắt đầu tuần phải là Thứ 2")

    def save(self, *args, **kwargs):
        if self.week_start_date and not self.week_end_date:
            self.week_end_date = self.week_start_date + timedelta(days=6)
        super().save(*args, **kwargs)

    @property
    def registration_deadline(self):
        return shift_registration_deadline(self.week_start_date)

    @property
    def is_past_deadline(self) -> bool:
        return timezone.now() > self.registration_deadline


def day_registration_deadline(target_date):
    """Hạn duyệt/hiệu lực cho 1 ĐĂNG KÝ THEO NGÀY (mô hình
    requires_manager_approval=True, khác hẳn hạn theo TUẦN ở
    shift_registration_deadline() bên trên): 0h00 của chính ngày áp dụng —
    nghĩa là phải đăng ký VÀ được duyệt xong trước khi ngày đó bắt đầu."""
    naive_midnight = timezone.datetime.combine(target_date, timezone.datetime.min.time())
    if timezone.is_naive(naive_midnight):
        return timezone.make_aware(naive_midnight)
    return naive_midnight


class ShiftRegistrationDay(models.Model):
    """1 ngày cụ thể trong tuần đăng ký.

    ca_choice=null nghĩa là đăng ký nghỉ (cả ngày). ca_choice=1/2 nghĩa là
    chọn Ca 1/Ca 2 — morning_shift/afternoon_shift là ShiftConfig của cặp ca
    đó tại THỜI ĐIỂM đăng ký (snapshot — nếu sau này HR đổi giờ của Ca 1/Ca 2
    trong cấu hình, các đăng ký cũ vẫn giữ nguyên giờ đã chọn, không bị đổi
    ngược theo).

    `status` CHỈ có ý nghĩa với config có `requires_manager_approval=True`
    (mặc định 'APPROVED' để KHÔNG đổi hành vi của mọi bản ghi cũ + mọi scope
    kiểu "đăng ký tuần, không cần duyệt" — với các scope đó mọi bản ghi luôn
    giữ nguyên 'APPROVED' như trước khi có field này).
    """

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Chờ duyệt'
        APPROVED = 'APPROVED', 'Đã duyệt'
        REJECTED = 'REJECTED', 'Từ chối'
        # QLTT/HCNS huỷ đơn đã duyệt (hoặc đang chờ) vì nhân viên không làm ca
        # đó nữa -> ngày đó quay về ca mặc định, giống không có đơn (2026-10-06).
        CANCELLED = 'CANCELLED', 'Đã huỷ'

    registration = models.ForeignKey(
        ShiftRegistration, on_delete=models.CASCADE, related_name='days',
        verbose_name="Đăng ký ca làm",
    )
    date = models.DateField(verbose_name="Ngày")
    ca_choice = models.PositiveSmallIntegerField(
        choices=CA_CHOICES, null=True, blank=True,
        verbose_name="Ca đã chọn (để trống = nghỉ)",
    )
    morning_shift = models.ForeignKey(
        'hrm.ShiftConfig', on_delete=models.PROTECT, null=True, blank=True,
        related_name='+', verbose_name="Ca sáng đã áp dụng",
    )
    afternoon_shift = models.ForeignKey(
        'hrm.ShiftConfig', on_delete=models.PROTECT, null=True, blank=True,
        related_name='+', verbose_name="Ca chiều đã áp dụng",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.APPROVED,
        verbose_name="Trạng thái duyệt (chỉ áp dụng khi scope yêu cầu duyệt)",
    )
    reviewed_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', verbose_name="Người duyệt/từ chối",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt/từ chối")
    review_note = models.CharField(max_length=500, blank=True, verbose_name="Ghi chú duyệt/từ chối")
    # Thời điểm NHÂN VIÊN gửi đăng ký Ca 2. Trước 2026-09-25 bảng này không lưu
    # mốc tạo, nên trang Phê duyệt phải lấy tạm reviewed_at (giờ DUYỆT) làm
    # "Ngày tạo đơn" -> mọi đơn Ca 2 trông như được duyệt ngay lúc gửi.
    # null cho các bản ghi CŨ (không suy ngược được), FE hiện "—" thay vì bịa.
    created_at = models.DateTimeField(
        auto_now_add=True, null=True, blank=True, verbose_name="Thời điểm gửi đăng ký",
    )

    class Meta:
        verbose_name = "Ngày đăng ký ca làm"
        verbose_name_plural = "Ngày đăng ký ca làm"
        unique_together = ['registration', 'date']

    def __str__(self):
        label = f"Ca {self.ca_choice}" if self.ca_choice else "Nghỉ"
        return f"{self.registration.employee.employee_id} - {self.date} - {label}"

    def apply_ca(self, config: ShiftRegistrationScopeConfig, ca_choice):
        """Set ca_choice + snapshot morning_shift/afternoon_shift từ config
        (không tự save() — caller tự save)."""
        self.ca_choice = ca_choice
        self.morning_shift, self.afternoon_shift = config.ca_pair(ca_choice)

    @property
    def registration_deadline(self):
        return day_registration_deadline(self.date)

    @property
    def is_past_deadline(self) -> bool:
        return timezone.now() >= self.registration_deadline
