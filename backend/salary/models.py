from django.db import models
from django.utils import timezone


# ---------------------------------------------------------------------------
# Choices
# ---------------------------------------------------------------------------

COMPONENT_TYPE = [
    ('BASIC',        'Lương cơ bản'),
    ('ALLOWANCE',    'Phụ cấp cố định'),
    ('KPI_BONUS',    'Thưởng KPI'),
    ('OT_PAY',       'Lương OT'),
    ('DEDUCTION',    'Khấu trừ'),
    ('TAX',          'Thuế TNCN'),
    ('INSURANCE',    'Bảo hiểm XH/YT/TN'),
    ('LATE_PENALTY', 'Phạt đi muộn/về sớm'),
    ('COMMISSION',   'Hoa hồng doanh số'),
    ('OTHER',        'Khác'),
]

CALC_METHOD = [
    ('FIXED',           'Số tiền cố định'),
    ('PCT_BASIC',       '% lương cơ bản'),
    ('PCT_GROSS',       '% tổng lương gross'),
    ('PER_WORK_DAY',    'Theo ngày công thực tế'),
    ('PER_OT_HOUR',     'Theo giờ OT (tổng)'),
    ('PER_OT_WEEKDAY',  'Theo giờ OT ngày thường'),
    ('PER_OT_WEEKEND',  'Theo giờ OT cuối tuần'),
    ('PER_OT_HOLIDAY',  'Theo giờ OT ngày lễ'),
    ('PROGRESSIVE_TAX', 'Thuế TNCN lũy tiến'),
    ('FORMULA',         'Công thức tùy chỉnh (expression)'),
]

SALARY_STATUS = [
    ('DRAFT',     'Nháp'),
    ('PENDING',   'Chờ duyệt'),
    ('APPROVED',  'Đã duyệt'),
    ('PAID',      'Đã thanh toán'),
    ('CANCELLED', 'Đã hủy'),
]

# ---------------------------------------------------------------------------
# SalaryFormula – Công thức tính lương
# ---------------------------------------------------------------------------

class SalaryFormula(models.Model):
    """
    Định nghĩa công thức tính lương linh hoạt.
    Áp dụng theo pattern priority: employee > position > department > all.
    """
    name = models.CharField(max_length=255, verbose_name="Tên công thức")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã công thức")
    description = models.TextField(blank=True, verbose_name="Mô tả")

    # Áp dụng cho ai (kế thừa pattern AttendanceRuleConfig)
    apply_to_all = models.BooleanField(default=False, verbose_name="Áp dụng cho tất cả")
    apply_to_departments = models.ManyToManyField(
        'employee.Department', blank=True, related_name='salary_formulas',
        verbose_name="Áp dụng cho phòng ban")
    apply_to_positions = models.ManyToManyField(
        'employee.Position', blank=True, related_name='salary_formulas',
        verbose_name="Áp dụng cho chức vụ")
    apply_to_employees = models.ManyToManyField(
        'employee.Employee', blank=True, related_name='salary_formulas',
        verbose_name="Áp dụng cho nhân viên")

    # Hiệu lực
    effective_from = models.DateField(verbose_name="Ngày hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Ngày hiệu lực đến")
    is_active = models.BooleanField(default=True, verbose_name="Đang kích hoạt")

    # Priority: higher = override (employee=4 > position=3 > department=2 > all=1)
    priority = models.IntegerField(default=0, verbose_name="Mức ưu tiên")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Công thức lương"
        verbose_name_plural = "Công thức lương"
        ordering = ['-priority', '-effective_from']

    def __str__(self):
        return f"{self.name} ({self.code})"


# ---------------------------------------------------------------------------
# SalaryComponent – Thành phần lương
# ---------------------------------------------------------------------------

class SalaryComponent(models.Model):
    """
    Một khoản trong công thức lương (lương cơ bản, phụ cấp, OT, khấu trừ...).
    Thứ tự tính (order) quan trọng vì component sau có thể dùng kết quả trước.
    """
    formula = models.ForeignKey(
        SalaryFormula, on_delete=models.CASCADE,
        related_name='components', verbose_name="Công thức")
    name = models.CharField(max_length=255, verbose_name="Tên khoản")
    code = models.CharField(max_length=64, verbose_name="Mã khoản")
    component_type = models.CharField(
        max_length=20, choices=COMPONENT_TYPE, verbose_name="Loại khoản")
    calc_method = models.CharField(
        max_length=20, choices=CALC_METHOD, verbose_name="Phương thức tính")

    # Tham số tính toán
    fixed_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Số tiền cố định / đơn giá")
    percentage = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
        verbose_name="Tỷ lệ phần trăm (0–1)")
    # Biến hỗ trợ trong expression:
    # basic_salary, work_days, ot_hours, work_coefficient,
    # late_minutes, gross_salary, và mã của các component đã tính trước.
    expression = models.TextField(
        blank=True, verbose_name="Biểu thức tính toán")

    order = models.IntegerField(default=0, verbose_name="Thứ tự tính")
    is_active = models.BooleanField(default=True, verbose_name="Đang kích hoạt")

    # Override phân loại deduction. None = tự động theo component_type.
    is_deduction = models.BooleanField(
        null=True, blank=True, default=None,
        verbose_name="Là khoản khấu trừ",
        help_text=(
            "Để trống = tự động theo loại khoản. "
            "True = trừ vào gross. False = cộng vào gross."
        ),
    )

    class Meta:
        verbose_name = "Thành phần lương"
        verbose_name_plural = "Thành phần lương"
        ordering = ['order']
        unique_together = ['formula', 'code']

    def __str__(self):
        return f"{self.formula.code} – {self.code}"


# ---------------------------------------------------------------------------
# MonthlySalaryRecord – Bảng lương tháng
# ---------------------------------------------------------------------------

class MonthlySalaryRecord(models.Model):
    """
    Bản ghi lương hàng tháng của từng nhân viên.
    Được tính từ MonthlyWorkCredit + SalaryFormula.
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.PROTECT,
        related_name='salary_records', verbose_name="Nhân viên")
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    salary_code = models.CharField(
        max_length=64, unique=True, verbose_name="Mã bảng lương")

    # FK tới bảng công đã duyệt
    work_credit = models.OneToOneField(
        'hrm.MonthlyWorkCredit', on_delete=models.PROTECT,
        null=True, blank=True, related_name='salary_record',
        verbose_name="Bảng công tháng")

    # Công thức áp dụng (snapshot tại thời điểm tính để audit)
    formula_used = models.ForeignKey(
        SalaryFormula, on_delete=models.PROTECT,
        null=True, blank=True, verbose_name="Công thức lương đã dùng")
    formula_snapshot = models.JSONField(
        default=dict, verbose_name="Snapshot công thức lúc tính")

    # Kết quả tổng hợp
    gross_salary = models.DecimalField(
        max_digits=14, decimal_places=2, default=0, verbose_name="Tổng lương gross")
    total_deduction = models.DecimalField(
        max_digits=14, decimal_places=2, default=0, verbose_name="Tổng khấu trừ")
    net_salary = models.DecimalField(
        max_digits=14, decimal_places=2, default=0, verbose_name="Lương thực nhận")

    # Chi tiết từng thành phần (JSON)
    components_detail = models.JSONField(
        default=dict, verbose_name="Chi tiết các khoản lương")
    # Ví dụ:
    # {
    #   "BASIC":        {"name": "...", "type": "BASIC", "calc_method": "FIXED", "amount": 10000000},
    #   "OT_PAY":       {"amount": 500000, "ot_hours": 10, "rate": 50000},
    #   "LATE_PENALTY": {"amount": -200000, "late_minutes": 90},
    # }

    # Input snapshot (các biến đầu vào tại thời điểm tính)
    input_snapshot = models.JSONField(
        default=dict, verbose_name="Snapshot dữ liệu đầu vào")
    # {work_days, ot_hours, late_minutes, basic_salary, ...}

    # Log các rule đã áp dụng
    applied_rules = models.JSONField(default=list, verbose_name="Quy tắc đã áp dụng")

    status = models.CharField(
        max_length=20, choices=SALARY_STATUS, default='DRAFT',
        verbose_name="Trạng thái")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    # Duyệt
    approved_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='approved_salary_records',
        verbose_name="Người duyệt")
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt")

    # Thanh toán
    paid_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm thanh toán")
    payment_ref = models.CharField(max_length=255, blank=True, verbose_name="Mã thanh toán")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Bảng lương tháng"
        verbose_name_plural = "Bảng lương tháng"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
            models.Index(fields=['status']),
            models.Index(fields=['salary_code']),
        ]

    def __str__(self):
        return f"Lương {self.salary_code} – {self.employee.full_name} – {self.month}/{self.year}"

    def save(self, *args, **kwargs):
        if not self.salary_code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.salary_code = f"SAL-{self.year}{self.month:02d}-{timestamp}"
        super().save(*args, **kwargs)

    def approve(self, approved_by_employee, note=''):
        """Duyệt bảng lương."""
        if self.status not in ('DRAFT', 'PENDING'):
            raise ValueError("Chỉ có thể duyệt bảng lương ở trạng thái Nháp hoặc Chờ duyệt")
        self.status = 'APPROVED'
        self.approved_by = approved_by_employee
        self.approved_at = timezone.now()
        if note:
            self.notes = note
        self.save()

    def mark_paid(self, payment_ref=''):
        """Đánh dấu đã thanh toán."""
        if self.status != 'APPROVED':
            raise ValueError("Chỉ có thể thanh toán bảng lương đã duyệt")
        self.status = 'PAID'
        self.paid_at = timezone.now()
        if payment_ref:
            self.payment_ref = payment_ref
        self.save()

    def cancel(self):
        """Hủy bảng lương."""
        if self.status == 'PAID':
            raise ValueError("Không thể hủy bảng lương đã thanh toán")
        self.status = 'CANCELLED'
        self.save()


# ---------------------------------------------------------------------------
# SalaryComponentOverride – Ghi đè / bổ sung khoản lương cho cá nhân/tháng
# ---------------------------------------------------------------------------

class SalaryComponentOverride(models.Model):
    """
    Cho phép ghi đè hoặc bổ sung một khoản lương cụ thể cho một nhân viên
    trong một tháng mà không cần tạo công thức riêng.
    Ví dụ: thưởng đặc biệt, phạt riêng lẻ, điều chỉnh bất thường.
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='salary_overrides', verbose_name="Nhân viên",
    )
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")

    # Mã component cần ghi đè (phải trùng mã trong SalaryComponent nếu muốn thay thế,
    # hoặc dùng mã mới nếu muốn thêm khoản)
    component_code = models.CharField(max_length=64, verbose_name="Mã khoản")
    component_name = models.CharField(max_length=255, verbose_name="Tên khoản")
    component_type = models.CharField(
        max_length=20, choices=COMPONENT_TYPE, verbose_name="Loại khoản",
    )

    # Số tiền override (dương hoặc âm)
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, verbose_name="Số tiền",
    )

    # True = cộng vào giá trị hiện có, False = thay thế hoàn toàn
    is_addition = models.BooleanField(
        default=False,
        verbose_name="Cộng dồn",
        help_text="True = cộng thêm vào khoản cũ, False = thay thế hoàn toàn khoản cũ.",
    )

    notes = models.TextField(blank=True, verbose_name="Ghi chú lý do")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='salary_overrides_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Điều chỉnh khoản lương"
        verbose_name_plural = "Điều chỉnh khoản lương"
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
        ]

    def __str__(self):
        op = '+' if self.is_addition else '='
        return (
            f"{self.employee.full_name} {self.month}/{self.year} "
            f"[{self.component_code}] {op}{self.amount:,.0f}"
        )