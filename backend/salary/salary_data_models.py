"""
salary/salary_data_models.py
Models hỗ trợ tính lương:
  - EmployeeSalaryHistory  : lịch sử lương cơ bản / phụ cấp theo kỳ hiệu lực
  - EmployeeKPIRecord      : dữ liệu KPI / hoa hồng theo tháng
  - TaxBracketConfig       : cấu hình bảng thuế TNCN lũy tiến
  - TaxBracket             : một bậc thuế trong bảng
"""
from decimal import Decimal

from django.db import models, transaction


# ---------------------------------------------------------------------------
# EmployeeSalaryHistory – Lịch sử lương theo kỳ
# ---------------------------------------------------------------------------

class EmployeeSalaryHistory(models.Model):
    """
    Lưu lịch sử mức lương cơ bản và phụ cấp theo từng kỳ hiệu lực.
    Engine phải lấy mức lương hiệu lực tại tháng tính, không dùng mức lương
    hiện tại trên Employee để đảm bảo tính lương tháng cũ vẫn chính xác.
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='salary_history', verbose_name="Nhân viên",
    )
    basic_salary = models.DecimalField(
        max_digits=14, decimal_places=2, verbose_name="Lương cơ bản",
    )
    allowance = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Phụ cấp",
    )
    effective_from = models.DateField(verbose_name="Hiệu lực từ ngày")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Hiệu lực đến ngày")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='salary_history_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Lịch sử lương"
        verbose_name_plural = "Lịch sử lương"
        ordering = ['-effective_from']
        indexes = [
            models.Index(fields=['employee', 'effective_from', 'effective_to']),
        ]

    def __str__(self):
        return (
            f"{self.employee.full_name} – {self.basic_salary:,.0f} "
            f"(từ {self.effective_from})"
        )

    @classmethod
    def get_for_date(cls, employee, target_date):
        """
        Lấy mức lương hiệu lực tại target_date.
        Trả về None nếu không tìm thấy (engine sẽ fallback về employee.basic_salary).
        """
        return (
            cls.objects.filter(
                employee=employee,
                effective_from__lte=target_date,
            )
            .filter(
                models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=target_date)
            )
            .order_by('-effective_from')
            .first()
        )


# ---------------------------------------------------------------------------
# EmployeeKPIRecord – Dữ liệu KPI / hoa hồng theo tháng
# ---------------------------------------------------------------------------

class EmployeeKPIRecord(models.Model):
    """
    Lưu chỉ số KPI và hoa hồng của nhân viên theo từng tháng.
    Được nạp vào context trước khi tính lương để các component
    KPI_BONUS / COMMISSION dùng biến kpi_score, revenue, kpi_bonus_amount, commission_amount.
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='kpi_records', verbose_name="Nhân viên",
    )
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")

    kpi_score = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal('0'),
        verbose_name="Điểm KPI (0–100)",
    )
    revenue = models.DecimalField(
        max_digits=16, decimal_places=2, default=Decimal('0'),
        verbose_name="Doanh số",
    )
    kpi_bonus_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Thưởng KPI",
    )
    commission_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Hoa hồng doanh số",
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='kpi_records_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Dữ liệu KPI tháng"
        verbose_name_plural = "Dữ liệu KPI tháng"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
        ]

    def __str__(self):
        return f"KPI {self.employee.full_name} – {self.month}/{self.year} (score={self.kpi_score})"


# ---------------------------------------------------------------------------
# SalesCommission – Hoa hồng doanh số theo tháng (1 bản ghi / NV / tháng)
# ---------------------------------------------------------------------------

class SalesCommission(models.Model):
    """
    Lưu lương hoa hồng doanh số của nhân viên theo từng tháng.
    Mỗi nhân viên chỉ có 1 bản ghi / tháng (unique_together).
    Engine đọc amount và nạp vào context['commission_amount'].
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='sales_commissions', verbose_name="Nhân viên",
    )
    year  = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Lương hoa hồng",
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='commissions_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Hoa hồng doanh số"
        verbose_name_plural = "Hoa hồng doanh số"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
        ]

    def __str__(self):
        return f"HH {self.employee.full_name} – {self.month}/{self.year}: {self.amount:,.0f}đ"


# ---------------------------------------------------------------------------
# EmployeeMonthlySalaryInput – Dữ liệu lương tháng theo file import
# ---------------------------------------------------------------------------

class EmployeeMonthlySalaryInput(models.Model):
    """
    Lưu dữ liệu lương bổ sung của nhân viên theo từng tháng/năm.
    Các trường cho phép null để hỗ trợ trường hợp không có dữ liệu từ file upload.
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='monthly_salary_inputs', verbose_name="Nhân viên",
    )
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")

    luong_doanh_so = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Lương doanh số",
    )
    luong_ot = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Lương OT",
    )
    ban_san_pham = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Bán sản phẩm",
    )
    phu_mo = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Phụ mổ",
    )
    truc_ca = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Trực ca",
    )
    thuong = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Thưởng",
    )

    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='monthly_salary_inputs_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Dữ liệu lương tháng"
        verbose_name_plural = "Dữ liệu lương tháng"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
        ]

    def __str__(self):
        return f"DL {self.employee.full_name} – {self.month}/{self.year}"


# ---------------------------------------------------------------------------
# DisciplinaryPenalty – Phạt biên bản (phạt ngoài) theo tháng
# ---------------------------------------------------------------------------

PENALTY_STATUS_CHOICES = [
    ('PENDING_MANAGER', 'Chờ quản lý duyệt'),
    ('APPROVED', 'Đã duyệt'),
    ('REJECTED', 'Từ chối'),
]

class DisciplinaryPenalty(models.Model):
    """
    Lưu từng khoản phạt biên bản của nhân viên theo tháng.
    Một nhân viên có thể có nhiều bản ghi phạt trong cùng tháng.
    Engine sẽ tổng hợp (SUM) toàn bộ amount trong tháng và đưa vào context
    dưới biến 'disciplinary_penalty'.
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='disciplinary_penalties', verbose_name="Nhân viên",
    )
    year  = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Số tiền phạt",
    )
    status = models.CharField(
        max_length=20,
        choices=PENALTY_STATUS_CHOICES,
        default='PENDING_MANAGER',
        verbose_name="Trạng thái",
    )
    reason = models.TextField(blank=True, verbose_name="Lý do vi phạm")
    notes  = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='penalties_created',
        verbose_name="Người tạo",
    )
    direct_manager_approved_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='direct_manager_penalties_approved',
        verbose_name="Quản lý trực tiếp duyệt",
    )
    direct_manager_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm quản lý duyệt")
    approved_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='approved_disciplinary_penalties',
        verbose_name="Người duyệt cuối",
    )
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt cuối")
    rejected_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='rejected_disciplinary_penalties',
        verbose_name="Người từ chối",
    )
    rejected_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm từ chối")
    approval_note = models.TextField(blank=True, verbose_name="Ghi chú duyệt/từ chối")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Phạt biên bản"
        verbose_name_plural = "Phạt biên bản"
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"Phạt {self.employee.full_name} – {self.month}/{self.year}: {self.amount:,.0f}đ"


# ---------------------------------------------------------------------------
# SalaryAdvance – Tạm ứng lương theo tháng
# ---------------------------------------------------------------------------

class SalaryAdvance(models.Model):
    """
    Lưu khoản tạm ứng lương của nhân viên theo từng tháng.
    Mỗi nhân viên chỉ có 1 bản ghi / tháng (unique_together).
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='salary_advances', verbose_name="Nhân viên",
    )
    year  = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Số tiền tạm ứng",
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='advances_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Tạm ứng lương"
        verbose_name_plural = "Tạm ứng lương"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
        ]

    def __str__(self):
        return f"TU {self.employee.full_name} – {self.month}/{self.year}: {self.amount:,.0f}đ"


# ---------------------------------------------------------------------------
# OtherAllowance – Phụ cấp khác theo tháng
# ---------------------------------------------------------------------------

class OtherAllowance(models.Model):
    """
    Lưu khoản phụ cấp khác (ngoài hệ thống) của nhân viên theo từng tháng.
    Mỗi nhân viên chỉ có 1 bản ghi / tháng (unique_together).
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='other_allowances', verbose_name="Nhân viên",
    )
    year  = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Số tiền phụ cấp",
    )
    description = models.TextField(blank=True, verbose_name="Mô tả phụ cấp")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='other_allowances_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Phụ cấp khác"
        verbose_name_plural = "Phụ cấp khác"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
        ]

    def __str__(self):
        return f"PC {self.employee.full_name} – {self.month}/{self.year}: {self.amount:,.0f}đ"


# ---------------------------------------------------------------------------
# ParkingAllowanceOverride – PC gửi xe nhập tay (ghi đè tính theo policy)
# ---------------------------------------------------------------------------

class ParkingAllowanceOverride(models.Model):
    """
    Số tiền phụ cấp gửi xe được HR import thủ công (đã tính sẵn) cho 1 nhân
    viên / 1 kỳ lương. Khi tồn tại bản ghi cho (employee, year, month), giá
    trị này LUÔN được ưu tiên dùng thay cho kết quả tính theo
    parkingAllowancePolicy (xem _calculate_parking_allowance trong
    hrm/finalization_views.py) — kể cả khi HR chốt lại công cho kỳ đó, vì
    giá trị được đọc trực tiếp từ bảng này mỗi lần tính lương chứ không lưu
    một lần vào WorkFinalization.phu_cap_gui_xe.
    Mỗi nhân viên chỉ có 1 bản ghi / tháng (unique_together).
    """
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='parking_allowance_overrides', verbose_name="Nhân viên",
    )
    year  = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Số tiền phụ cấp gửi xe",
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='parking_allowance_overrides_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Phụ cấp gửi xe (ghi đè thủ công)"
        verbose_name_plural = "Phụ cấp gửi xe (ghi đè thủ công)"
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
        ]

    def __str__(self):
        return f"PC gửi xe {self.employee.full_name} – {self.month}/{self.year}: {self.amount:,.0f}đ"


# ---------------------------------------------------------------------------
# OvertimeRateConfig – Đơn giá tăng ca (M2M: dept/pos/emp, có hiệu lực)
# ---------------------------------------------------------------------------

OT_CALC_METHOD = [
    ('FIXED',      'Đơn giá cố định (nhập tay)'),
    ('FROM_BASIC', 'Tính từ LC: LC ÷ công chuẩn ÷ 7.5h'),
]

class OvertimeRateConfig(models.Model):
    """
    Cấu hình đơn giá tăng ca linh hoạt theo 4 cấp:
      cá nhân > vị trí > bộ phận (trực tiếp) > phòng ban (parent) > tất cả.
    Dùng M2M để 1 record áp dụng nhiều dept/pos/emp cùng lúc.
    """
    departments  = models.ManyToManyField(
        'employee.Department', blank=True, related_name='ot_rate_configs',
        verbose_name="Phòng ban / Bộ phận",
    )
    positions    = models.ManyToManyField(
        'employee.Position', blank=True, related_name='ot_rate_configs',
        verbose_name="Vị trí",
    )
    employees    = models.ManyToManyField(
        'employee.Employee', blank=True, related_name='ot_rate_configs',
        verbose_name="Cá nhân",
    )
    apply_to_all = models.BooleanField(default=False, verbose_name="Áp dụng tất cả (mặc định)")

    calc_method       = models.CharField(
        max_length=20, choices=OT_CALC_METHOD, default='FIXED',
        verbose_name="Cách tính đơn giá OT",
    )
    rate_per_hour     = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0'),
        verbose_name="Đơn giá OT cố định (đồng/giờ) — dùng khi calc_method=FIXED",
    )
    multiplier        = models.DecimalField(
        max_digits=6, decimal_places=3, default=Decimal('1'),
        verbose_name="Hệ số nhân luôn áp dụng (mặc định 1 = không nhân thêm)",
    )
    use_kpi           = models.BooleanField(default=False, verbose_name="Có hệ số KPI")
    kpi_multiplier    = models.DecimalField(
        max_digits=6, decimal_places=3, null=True, blank=True,
        verbose_name="Hệ số nhân khi đạt KPI (VD: 1.5 = x1.5 đơn giá)",
    )
    kpi_rate_per_hour = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        verbose_name="Đơn giá OT cố định khi đạt KPI (đồng/giờ, ưu tiên thấp hơn kpi_multiplier)",
    )
    kpi_threshold     = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('100'),
        verbose_name="Ngưỡng KPI (0–100)",
    )

    effective_from = models.DateField(verbose_name="Hiệu lực từ ngày")
    effective_to   = models.DateField(null=True, blank=True, verbose_name="Hiệu lực đến ngày (null = vô hạn)")

    is_active  = models.BooleanField(default=True, verbose_name="Đang áp dụng")
    notes      = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='ot_rates_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Đơn giá tăng ca"
        verbose_name_plural = "Đơn giá tăng ca"
        ordering = ['-effective_from']

    def __str__(self):
        return f"OT {self.rate_per_hour:,.0f}đ/h ({self.effective_from}→{self.effective_to or '∞'})"

    @staticmethod
    def get_for_employee(
        employee, calc_date, kpi_score: float = 0.0,
        basic_salary: float = 0.0, standard_work_days: float = 26.0,
    ) -> float:
        """
        Trả về đơn giá OT/giờ áp dụng cho nhân viên tại calc_date.
        Priority: cá nhân > vị trí > bộ phận > phòng ban (parent) > tất cả.
        calc_method=FROM_BASIC: rate = basic_salary / standard_work_days / 7.5
        """
        from django.db.models import Q as _Q
        qs = OvertimeRateConfig.objects.filter(
            is_active=True,
            effective_from__lte=calc_date,
        ).filter(_Q(effective_to__isnull=True) | _Q(effective_to__gte=calc_date))

        def _rate(cfg) -> float:
            if cfg.calc_method == 'FROM_BASIC':
                days = standard_work_days or 26.0
                base = round(basic_salary / days / 7.5, 2)
            else:
                base = float(cfg.rate_per_hour)
            base = round(base * float(cfg.multiplier or 1), 2)
            if cfg.use_kpi and kpi_score >= float(cfg.kpi_threshold):
                if cfg.kpi_multiplier:
                    return round(base * float(cfg.kpi_multiplier), 2)
                if cfg.kpi_rate_per_hour:
                    return float(cfg.kpi_rate_per_hour)
            return base

        cfg = qs.filter(employees=employee).order_by('-effective_from').first()
        if cfg:
            return _rate(cfg)

        if employee.position_id:
            cfg = qs.filter(positions=employee.position_id).order_by('-effective_from').first()
            if cfg:
                return _rate(cfg)

        if employee.department_id:
            cfg = qs.filter(departments=employee.department_id).order_by('-effective_from').first()
            if cfg:
                return _rate(cfg)

        parent = getattr(getattr(employee, 'department', None), 'parent_department', None)
        if parent:
            cfg = qs.filter(departments=parent).order_by('-effective_from').first()
            if cfg:
                return _rate(cfg)

        cfg = qs.filter(apply_to_all=True).order_by('-effective_from').first()
        return _rate(cfg) if cfg else 0.0


# ---------------------------------------------------------------------------
# TaxBracketConfig + TaxBracket – Bảng thuế TNCN lũy tiến
# ---------------------------------------------------------------------------

class TaxBracketConfig(models.Model):
    """
    Cấu hình bảng thuế TNCN lũy tiến. Một bản ghi is_active=True tại một thời điểm.
    Component với calc_method='PROGRESSIVE_TAX' dùng bảng thuế này và biến
    'taxable_income' trong context (phải được set bởi component FORMULA trước đó).
    """
    name = models.CharField(max_length=255, verbose_name="Tên bảng thuế")
    effective_from = models.DateField(verbose_name="Hiệu lực từ ngày")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Hiệu lực đến ngày")
    is_active = models.BooleanField(default=False, verbose_name="Đang áp dụng")

    # Mức giảm trừ gia cảnh (VN: bản thân 11 triệu, người phụ thuộc 4.4 triệu)
    personal_deduction = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('11000000'),
        verbose_name="Giảm trừ bản thân (đồng/tháng)",
    )
    dependent_deduction = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('4400000'),
        verbose_name="Giảm trừ mỗi người phụ thuộc (đồng/tháng)",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Cấu hình bảng thuế TNCN"
        verbose_name_plural = "Cấu hình bảng thuế TNCN"
        ordering = ['-effective_from']

    def __str__(self):
        return f"{self.name} ({'active' if self.is_active else 'inactive'})"

    def save(self, *args, **kwargs):
        if self.is_active:
            with transaction.atomic():
                TaxBracketConfig.objects.exclude(pk=self.pk).update(is_active=False)
                super().save(*args, **kwargs)
            return
        super().save(*args, **kwargs)

    @classmethod
    def get_active(cls):
        return cls.objects.filter(is_active=True).first()

    @classmethod
    def get_for_date(cls, target_date):
        """Lấy bảng thuế hiệu lực tại target_date."""
        return (
            cls.objects.filter(effective_from__lte=target_date)
            .filter(
                models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=target_date)
            )
            .order_by('-effective_from')
            .first()
        )


class TaxBracket(models.Model):
    """Một bậc thuế trong TaxBracketConfig (sắp xếp theo order tăng dần)."""
    config = models.ForeignKey(
        TaxBracketConfig, on_delete=models.CASCADE,
        related_name='brackets', verbose_name="Bảng thuế",
    )
    order = models.IntegerField(default=0, verbose_name="Thứ tự bậc")
    min_income = models.DecimalField(
        max_digits=16, decimal_places=2, default=Decimal('0'),
        verbose_name="Thu nhập từ (đồng)",
    )
    max_income = models.DecimalField(
        max_digits=16, decimal_places=2, null=True, blank=True,
        verbose_name="Thu nhập đến (đồng, trống = không giới hạn)",
    )
    rate = models.DecimalField(
        max_digits=6, decimal_places=4,
        verbose_name="Thuế suất (0–1, ví dụ 0.05 = 5%)",
    )

    class Meta:
        verbose_name = "Bậc thuế TNCN"
        verbose_name_plural = "Bậc thuế TNCN"
        ordering = ['order']

    def __str__(self):
        upper = f"{float(self.max_income):,.0f}" if self.max_income else "∞"
        return f"[{float(self.min_income):,.0f} – {upper}] × {float(self.rate)*100:.0f}%"
