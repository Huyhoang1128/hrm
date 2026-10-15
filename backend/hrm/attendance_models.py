"""
hrm/attendance_models.py
════════════════════════
Models cho hệ thống Attendance Engine:

1. AttendancePolicyVersion  – Phiên bản chính sách (versioning)
2. PenaltyTierConfig        – Bảng phạt cho từng version
3. AttendancePolicyConfig   – Các tham số chính sách khác (phụ cấp, quota…)
4. RegistrationRequest      – Đơn đăng ký (OT / LIVE / NIGHT_SHIFT / EXTRA_HOURS / ONLINE_WORK)
5. OnlineWorkRequest        – Đơn làm việc online
6. AttendanceEventLog       – DB-backed event store (lưu mọi event đã xử lý)
7. LivestreamSessionConfig  – Cấu hình phiên live (prime-time, quota team…)
8. DeviceAPICallLog         – Lịch sử gọi API từ thiết bị chấm công

Cần chạy sau khi thêm file:
  python manage.py makemigrations hrm
  python manage.py migrate
"""

import uuid
from django.db import models
from django.utils import timezone
from employee.models import Employee, Department, Position


# ─────────────────────────────────────────────────────────────────────────────
# 1. ATTENDANCE POLICY VERSION
# ─────────────────────────────────────────────────────────────────────────────

class AttendancePolicyVersion(models.Model):
    """
    Phiên bản chính sách chấm công.
    Mỗi version có một bảng phạt (PenaltyTierConfig) và tham số (AttendancePolicyConfig).
    Chỉ một version được đặt is_active=True tại một thời điểm.
    """
    version_code = models.CharField(
        max_length=32, unique=True,
        verbose_name="Mã phiên bản",
        help_text="Ví dụ: v2024_08, v2025_01"
    )
    name         = models.CharField(max_length=255, verbose_name="Tên phiên bản")
    description  = models.TextField(blank=True, verbose_name="Mô tả")
    effective_from = models.DateField(verbose_name="Hiệu lực từ")
    effective_to   = models.DateField(null=True, blank=True, verbose_name="Hiệu lực đến")
    is_active    = models.BooleanField(default=False, verbose_name="Đang áp dụng")
    created_by   = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="policy_versions_created",
        verbose_name="Người tạo"
    )
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Phiên bản chính sách chấm công"
        verbose_name_plural = "Phiên bản chính sách chấm công"
        ordering = ["-effective_from"]

    def __str__(self):
        return f"{self.version_code} – {self.name} ({'active' if self.is_active else 'inactive'})"

    def save(self, *args, **kwargs):
        # Đảm bảo chỉ một version active tại một thời điểm
        if self.is_active:
            AttendancePolicyVersion.objects.exclude(pk=self.pk).update(is_active=False)
        super().save(*args, **kwargs)

    @classmethod
    def get_active(cls):
        return cls.objects.filter(is_active=True).first()

    @classmethod
    def get_for_date(cls, date):
        """Lấy version phù hợp với ngày cụ thể"""
        qs = cls.objects.filter(effective_from__lte=date)
        qs = qs.filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=date)
        )
        return qs.order_by("-effective_from").first()


# ─────────────────────────────────────────────────────────────────────────────
# 2. PENALTY TIER CONFIG (Bảng phạt theo version)
# ─────────────────────────────────────────────────────────────────────────────

class PenaltyTierConfig(models.Model):
    """
    Một dòng trong bảng phạt.  Ứng với mỗi khoảng thời gian muộn/sớm (phút),
    xác định mức phạt tiền cho nhân viên thường và quản lý.
    Khi violation_minutes > max_minutes của tier cuối → trừ 0.5 công, không phạt tiền.
    """
    version         = models.ForeignKey(
        AttendancePolicyVersion, on_delete=models.CASCADE,
        related_name="penalty_tiers", verbose_name="Phiên bản"
    )
    order           = models.PositiveSmallIntegerField(default=0, verbose_name="Thứ tự")
    # Phút tối đa của tier này (ví dụ: 10, 30, 60, 120; tier cuối = None → áp dụng khi > tier trước)
    max_minutes     = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name="Phút tối đa",
        help_text="Để trống = tier 'vô hạn' (> phút tối đa của tier trước)"
    )
    # Phạt tiền VNĐ
    fine_amount_regular = models.PositiveIntegerField(default=0, verbose_name="Tiền phạt (NV thường)")
    fine_amount_manager = models.PositiveIntegerField(default=0, verbose_name="Tiền phạt (Quản lý)")
    # Khi không có tiền phạt → trừ công
    deduct_work_credit  = models.DecimalField(
        max_digits=4, decimal_places=2, default=0,
        verbose_name="Trừ công thực tế",
        help_text="0.5 = trừ nửa công; 1.0 = trừ cả ngày"
    )
    description     = models.CharField(max_length=255, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Mức phạt"
        verbose_name_plural = "Mức phạt"
        ordering = ["version", "order"]
        unique_together = [("version", "order")]

    def __str__(self):
        limit = f"≤{self.max_minutes}p" if self.max_minutes else ">prev tier"
        return f"[{self.version.version_code}] {limit}: {self.fine_amount_regular:,}đ/{self.fine_amount_manager:,}đ(Mgr)"

    @property
    def has_work_deduction_only(self):
        return self.fine_amount_regular == 0 and float(self.deduct_work_credit) > 0


# ─────────────────────────────────────────────────────────────────────────────
# 3. ATTENDANCE POLICY CONFIG (tham số chính sách theo version)
# ─────────────────────────────────────────────────────────────────────────────

class AttendancePolicyConfig(models.Model):
    """
    Các tham số chính sách gắn với một version:
    - Số lần giải trình tối đa / tháng
    - Phụ cấp gửi xe
    - % tối đa phiên live 21h-23h
    - % tối đa OT live / tổng OT
    - Ngưỡng số vi phạm áp dụng nhân x2
    - Mức phụ cấp livestream prime-time
    """
    version = models.OneToOneField(
        AttendancePolicyVersion, on_delete=models.CASCADE,
        related_name="policy_config", verbose_name="Phiên bản"
    )

    # Giải trình
    max_explanation_quota       = models.PositiveSmallIntegerField(
        default=3, verbose_name="Số lần giải trình tối đa/tháng"
    )

    # Hệ số nhân phạt
    penalty_multiplier_threshold = models.PositiveSmallIntegerField(
        default=7, verbose_name="Từ lần vi phạm thứ N → nhân x2"
    )
    penalty_multiplier_value     = models.DecimalField(
        max_digits=4, decimal_places=2, default=2.0,
        verbose_name="Hệ số nhân phạt"
    )

    # Phụ cấp gửi xe
    parking_allowance_per_day    = models.PositiveIntegerField(
        default=5000, verbose_name="Phụ cấp gửi xe (VNĐ/ngày)"
    )

    # Phụ cấp livestream
    live_prime_time_allowance    = models.PositiveIntegerField(
        default=100_000, verbose_name="Phụ cấp phiên live 21h-23h (VNĐ/phiên)"
    )
    live_prime_start_hour        = models.PositiveSmallIntegerField(
        default=21, verbose_name="Giờ bắt đầu khung prime-time"
    )
    live_prime_end_hour          = models.PositiveSmallIntegerField(
        default=23, verbose_name="Giờ kết thúc khung prime-time"
    )
    max_live_prime_time_pct      = models.DecimalField(
        max_digits=5, decimal_places=4, default=0.2000,
        verbose_name="% tối đa phiên live 21h-23h / tổng phiên team/tháng"
    )
    max_ot_live_pct              = models.DecimalField(
        max_digits=5, decimal_places=4, default=0.2000,
        verbose_name="% tối đa OT live / tổng OT cá nhân/tháng"
    )

    # Trừ công quên chấm công
    incomplete_no_expl_deduction = models.DecimalField(
        max_digits=4, decimal_places=2, default=1.0,
        verbose_name="Trừ công khi không giải trình quên chấm công"
    )
    incomplete_approved_deduction = models.DecimalField(
        max_digits=4, decimal_places=2, default=0.0,
        verbose_name="Trừ công khi giải trình quên chấm công được duyệt"
    )
    incomplete_over_quota_deduction = models.DecimalField(
        max_digits=4, decimal_places=2, default=0.5,
        verbose_name="Trừ công thêm khi vượt hạn mức giải trình (áp dụng cho Quên chấm công)"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Cấu hình chính sách chấm công"
        verbose_name_plural = "Cấu hình chính sách chấm công"

    def __str__(self):
        return f"Policy config for {self.version.version_code}"

    def as_dict(self):
        return {
            "max_explanation_quota":          self.max_explanation_quota,
            "penalty_multiplier_threshold":   self.penalty_multiplier_threshold,
            "penalty_multiplier_value":       float(self.penalty_multiplier_value),
            "parking_allowance_per_day":      self.parking_allowance_per_day,
            "live_prime_time_allowance":      self.live_prime_time_allowance,
            "live_prime_start_hour":          self.live_prime_start_hour,
            "live_prime_end_hour":            self.live_prime_end_hour,
            "max_live_prime_time_pct":        float(self.max_live_prime_time_pct),
            "max_ot_live_pct":                float(self.max_ot_live_pct),
            "incomplete_no_expl_deduction":   float(self.incomplete_no_expl_deduction),
            "incomplete_approved_deduction":  float(self.incomplete_approved_deduction),
            "incomplete_over_quota_deduction": float(self.incomplete_over_quota_deduction),
        }


# ─────────────────────────────────────────────────────────────────────────────
# 4. REGISTRATION REQUEST
# ─────────────────────────────────────────────────────────────────────────────

REQUEST_TYPE_CHOICES = [
    ("OVERTIME",    "Tăng ca"),
    ("EXTRA_HOURS", "Làm thêm giờ"),
    ("NIGHT_SHIFT", "Trực tối"),
    ("LIVE",        "Livestream"),
    ("BUSINESS_TRIP", "Đi công tác"),
    ("ONLINE_WORK", "Làm việc online"),
    ("OFF_DUTY", "Ra trực"),
]

LIVE_ROLE_CHOICES = [
    ("HOST",             "Host (dẫn chương trình)"),
    ("MANAGER",          "Quản lý CTV"),
    ("TIKTOK_OPERATOR",  "Khai thác TikTok"),
    ("SUPPORTER",        "Hỗ trợ kỹ thuật"),
    ("OTHER",            "Khác"),
]

REQUEST_STATUS_CHOICES = [
    ("DRAFT",    "Nháp"),
    ("PENDING",  "Chờ duyệt"),
    ("APPROVED", "Đã duyệt"),
    ("REJECTED", "Từ chối"),
    ("CANCELLED","Đã hủy"),
]


class RegistrationRequest(models.Model):
    """
    Đơn đăng ký cho các loại công đặc biệt:
    OVERTIME, EXTRA_HOURS, NIGHT_SHIFT, LIVE, BUSINESS_TRIP, ONLINE_WORK.
    """
    request_code      = models.CharField(
        max_length=64, unique=True, blank=True, verbose_name="Mã đơn"
    )
    employee          = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name="registration_requests", verbose_name="Nhân viên"
    )
    department        = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="registration_requests", verbose_name="Phòng ban"
    )
    request_type      = models.CharField(
        max_length=32, choices=REQUEST_TYPE_CHOICES, verbose_name="Loại đơn"
    )
    registration_date = models.DateField(verbose_name="Ngày diễn ra")
    start_time        = models.TimeField(verbose_name="Giờ bắt đầu")
    end_time          = models.TimeField(verbose_name="Giờ kết thúc")
    total_hours       = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        verbose_name="Tổng số giờ"
    )

    # LIVE-specific fields
    live_role         = models.CharField(
        max_length=32, choices=LIVE_ROLE_CHOICES,
        blank=True, verbose_name="Vai trò trong phiên live"
    )
    is_prime_time     = models.BooleanField(
        default=False,
        verbose_name="Phiên live 21h-23h",
        help_text="Hệ thống tự tính dựa trên start_time"
    )

    # Content
    reason            = models.TextField(blank=True, verbose_name="Lý do")
    notes             = models.TextField(blank=True, verbose_name="Ghi chú")

    # Approval workflow
    status            = models.CharField(
        max_length=16, choices=REQUEST_STATUS_CHOICES,
        default="PENDING", verbose_name="Trạng thái"
    )
    approved_by       = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="approved_registrations",
        verbose_name="Người duyệt"
    )
    approved_at       = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt")
    approval_note     = models.TextField(blank=True, verbose_name="Ghi chú duyệt")

    # Two-step approval tracking
    direct_manager_approved    = models.BooleanField(default=False, verbose_name="Quản lý trực tiếp đã duyệt")
    hr_approved                = models.BooleanField(default=False, verbose_name="HR đã duyệt")
    direct_manager_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm quản lý duyệt")
    hr_approved_at             = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm HR duyệt")
    direct_manager_approved_by = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="direct_manager_approved_reg_requests",
        verbose_name="Quản lý trực tiếp duyệt"
    )
    hr_approved_by = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="hr_approved_reg_requests",
        verbose_name="HR duyệt"
    )

    # Policy version snapshot
    policy_version    = models.ForeignKey(
        AttendancePolicyVersion, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="registration_requests",
        verbose_name="Phiên bản chính sách áp dụng"
    )

    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)
    created_by        = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="created_registrations",
        verbose_name="Người tạo"
    )

    class Meta:
        verbose_name = "Đơn đăng ký công đặc biệt"
        verbose_name_plural = "Đơn đăng ký công đặc biệt"
        ordering = ["-registration_date", "-created_at"]
        indexes = [
            models.Index(fields=["employee", "registration_date"]),
            models.Index(fields=["department", "registration_date"]),
            models.Index(fields=["request_type", "status"]),
        ]

    def __str__(self):
        return f"{self.request_code} – {self.employee.full_name} [{self.request_type}] {self.registration_date}"

    def save(self, *args, **kwargs):
        if not self.request_code:
            prefix = {
                "OVERTIME": "OT", "EXTRA_HOURS": "EX", "NIGHT_SHIFT": "NS",
                "LIVE": "LV", "BUSINESS_TRIP": "BT", "ONLINE_WORK": "OW",
                "OFF_DUTY": "RT",
            }.get(self.request_type, "RG")
            ts = timezone.now().strftime("%Y%m%d%H%M%S")
            self.request_code = f"{prefix}-{ts}-{str(uuid.uuid4())[:6].upper()}"

        # Auto-detect prime time for LIVE requests
        if self.request_type == "LIVE" and self.start_time:
            import datetime as dt
            self.is_prime_time = dt.time(21, 0) <= self.start_time < dt.time(23, 0)

        # Auto-calculate total_hours if not set
        if self.start_time and self.end_time and not self.total_hours:
            import datetime as dt
            start_dt = dt.datetime.combine(dt.date.today(), self.start_time)
            end_dt   = dt.datetime.combine(dt.date.today(), self.end_time)
            if end_dt < start_dt:
                end_dt += dt.timedelta(days=1)
            self.total_hours = round((end_dt - start_dt).seconds / 3600, 2)

        super().save(*args, **kwargs)

    def approve(self, approved_by_employee):
        self.status = "APPROVED"
        self.approved_by = approved_by_employee
        self.approved_at = timezone.now()
        self.save()

    def reject(self, rejected_by_employee, note=""):
        self.status = "REJECTED"
        self.approved_by = rejected_by_employee
        self.approved_at = timezone.now()
        self.approval_note = note
        self.save()


# ─────────────────────────────────────────────────────────────────────────────
# 5. ONLINE WORK REQUEST
# ─────────────────────────────────────────────────────────────────────────────

class OnlineWorkRequest(models.Model):
    """
    Đơn xin làm việc online / work-from-home.
    Ngày được duyệt sẽ được tính là công thực tế (không tính phụ cấp gửi xe).
    """
    request_code  = models.CharField(max_length=64, unique=True, blank=True)
    employee      = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name="online_work_requests", verbose_name="Nhân viên"
    )
    work_date     = models.DateField(verbose_name="Ngày làm online")
    reason        = models.TextField(blank=True, verbose_name="Lý do")
    evidence      = models.FileField(
        upload_to="online_work_evidence/", null=True, blank=True,
        verbose_name="Minh chứng"
    )
    status        = models.CharField(
        max_length=16, choices=REQUEST_STATUS_CHOICES,
        default="PENDING", verbose_name="Trạng thái"
    )
    approved_by   = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="approved_online_requests",
        verbose_name="Người duyệt"
    )
    approved_at   = models.DateTimeField(null=True, blank=True)
    approval_note = models.TextField(blank=True)

    # Two-step approval tracking
    direct_manager_approved    = models.BooleanField(default=False, verbose_name="Quản lý trực tiếp đã duyệt")
    hr_approved                = models.BooleanField(default=False, verbose_name="HR đã duyệt")
    direct_manager_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm quản lý duyệt")
    hr_approved_at             = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm HR duyệt")
    direct_manager_approved_by = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="direct_manager_approved_online_requests",
        verbose_name="Quản lý trực tiếp duyệt"
    )
    hr_approved_by = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="hr_approved_online_requests",
        verbose_name="HR duyệt"
    )

    policy_version = models.ForeignKey(
        AttendancePolicyVersion, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="online_work_requests",
        verbose_name="Phiên bản chính sách"
    )

    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Đơn làm việc online"
        verbose_name_plural = "Đơn làm việc online"
        ordering = ["-work_date"]
        unique_together = [("employee", "work_date")]
        indexes = [models.Index(fields=["employee", "work_date", "status"])]

    def __str__(self):
        return f"{self.request_code} – {self.employee.full_name} [{self.work_date}]"

    def save(self, *args, **kwargs):
        if not self.request_code:
            ts = timezone.now().strftime("%Y%m%d%H%M%S")
            self.request_code = f"OW-{ts}-{str(uuid.uuid4())[:6].upper()}"
        super().save(*args, **kwargs)

    def approve(self, approved_by_employee):
        self.status = "APPROVED"
        self.approved_by = approved_by_employee
        self.approved_at = timezone.now()
        self.save()

    def reject(self, rejected_by_employee, note=""):
        self.status = "REJECTED"
        self.approved_by = rejected_by_employee
        self.approved_at = timezone.now()
        self.approval_note = note
        self.save()


# ─────────────────────────────────────────────────────────────────────────────
# 6. ATTENDANCE EVENT LOG (DB-backed Event Store)
# ─────────────────────────────────────────────────────────────────────────────

ATTENDANCE_EVENT_TYPE_CHOICES = [
    ("CHECKIN",                  "Chấm công vào"),
    ("CHECKOUT",                 "Chấm công ra"),
    ("LATE_ARRIVAL",             "Đi muộn"),
    ("EARLY_LEAVE",              "Về sớm"),
    ("ABSENT",                   "Vắng mặt"),
    ("INCOMPLETE_ATTENDANCE",    "Quên chấm công"),
    ("HOLIDAY_WORK",             "Ngày lễ"),
    ("ONLINE_WORK",              "Làm online"),
    ("BUSINESS_TRIP",            "Đi công tác"),
    ("FIRST_DAY",                "Ngày đầu đi làm"),
    ("LEAVE_DAY",                "Nghỉ phép"),
    ("PENALTY_APPLIED",          "Áp dụng phạt"),
    ("PENALTY_EXEMPTED",         "Miễn phạt"),
    ("WORK_CREDIT_CALCULATED",   "Tính công"),
    ("ALLOWANCE_CALCULATED",     "Tính phụ cấp"),
    ("REGISTRATION_OT",          "Đăng ký OT"),
    ("REGISTRATION_EXTRA_HOURS", "Đăng ký làm thêm"),
    ("REGISTRATION_NIGHT_SHIFT", "Đăng ký trực tối"),
    ("REGISTRATION_LIVE",        "Đăng ký livestream"),
    ("MONTHLY_FINALIZED",        "Chốt công tháng"),
]


class AttendanceEventLog(models.Model):
    """
    Lưu trữ mọi sự kiện trong vòng đời của hệ thống chấm công.
    Đây là event store DB-backed cho phép:
    - Audit trail đầy đủ
    - Replay lại với engine mới
    - Query theo employee / date / event_type
    """
    event_id      = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    event_type    = models.CharField(
        max_length=64, choices=ATTENDANCE_EVENT_TYPE_CHOICES,
        verbose_name="Loại sự kiện"
    )
    employee      = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name="attendance_events", verbose_name="Nhân viên"
    )
    event_date    = models.DateField(verbose_name="Ngày sự kiện")
    event_timestamp = models.DateTimeField(default=timezone.now, verbose_name="Thời điểm xảy ra")

    # Context snapshot: toàn bộ context dict khi rule chạy
    context_snapshot = models.JSONField(
        default=dict, blank=True,
        verbose_name="Context snapshot",
        help_text="Snapshot đầy đủ context lúc xử lý (dùng cho replay)"
    )
    # Rule result: kết quả sau khi áp dụng rules
    rule_result   = models.JSONField(
        default=dict, blank=True,
        verbose_name="Kết quả rule",
    )
    # Policy version used
    policy_version = models.ForeignKey(
        AttendancePolicyVersion, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="event_logs",
        verbose_name="Phiên bản chính sách"
    )
    rule_version_code = models.CharField(
        max_length=32, blank=True, default="",
        verbose_name="Mã version rule",
        help_text="Tương ứng với AttendancePolicyVersion.version_code"
    )

    # Source references
    attendance_id     = models.IntegerField(null=True, blank=True, verbose_name="ID Attendance")
    registration_id   = models.IntegerField(null=True, blank=True, verbose_name="ID RegistrationRequest")
    explanation_id    = models.IntegerField(null=True, blank=True, verbose_name="ID AttendanceExplanation")

    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Log sự kiện chấm công"
        verbose_name_plural = "Log sự kiện chấm công"
        ordering = ["-event_date", "-event_timestamp"]
        indexes = [
            models.Index(fields=["employee", "event_date"]),
            models.Index(fields=["event_type", "event_date"]),
            models.Index(fields=["employee", "event_type"]),
            models.Index(fields=["rule_version_code"]),
        ]

    def __str__(self):
        return (f"[{self.rule_version_code}] {self.event_type} – "
                f"{self.employee.full_name} {self.event_date}")

    @classmethod
    def log(cls, event_type: str, employee, event_date,
            context: dict = None, result: dict = None,
            policy_version=None,
            attendance_id=None, registration_id=None, explanation_id=None):
        """Convenience class method để ghi log từ engine"""
        return cls.objects.create(
            event_type        = event_type,
            employee          = employee,
            event_date        = event_date,
            context_snapshot  = context or {},
            rule_result       = result or {},
            policy_version    = policy_version,
            rule_version_code = policy_version.version_code if policy_version else "",
            attendance_id     = attendance_id,
            registration_id   = registration_id,
            explanation_id    = explanation_id,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 7. LIVESTREAM SESSION CONFIG (Cấu hình phiên live theo phòng ban / team)
# ─────────────────────────────────────────────────────────────────────────────

class LivestreamSessionConfig(models.Model):
    """
    Cấu hình cho phiên live của một phòng ban / team trong một tháng.
    Trưởng phòng cần khai báo trước ngày 02 hàng tháng nếu vượt quota.
    """
    department      = models.ForeignKey(
        Department, on_delete=models.CASCADE,
        related_name="livestream_configs", verbose_name="Phòng ban"
    )
    year            = models.PositiveSmallIntegerField(verbose_name="Năm")
    month           = models.PositiveSmallIntegerField(verbose_name="Tháng")

    # Tổng phiên live dự kiến cả team trong tháng (để tính 20%)
    total_planned_sessions = models.PositiveSmallIntegerField(
        default=0, verbose_name="Tổng phiên live dự kiến"
    )
    # Số phiên 21h-23h tối đa (nếu muốn override quy tắc 20%)
    max_prime_time_override = models.PositiveSmallIntegerField(
        null=True, blank=True,
        verbose_name="Override số phiên 21h-23h tối đa",
        help_text="Để trống = áp dụng quy tắc 20% tự động"
    )
    # OT vượt 20% đã được duyệt
    ot_override_approved    = models.BooleanField(
        default=False, verbose_name="OT vượt 20% đã được Trưởng phòng duyệt"
    )
    ot_override_approved_by = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="approved_ot_overrides",
        verbose_name="Trưởng phòng duyệt OT override"
    )
    ot_override_approved_at = models.DateTimeField(null=True, blank=True)
    ot_override_note        = models.TextField(blank=True)

    policy_version  = models.ForeignKey(
        AttendancePolicyVersion, null=True, blank=True,
        on_delete=models.SET_NULL, verbose_name="Phiên bản chính sách"
    )

    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Cấu hình phiên livestream"
        verbose_name_plural = "Cấu hình phiên livestream"
        unique_together = [("department", "year", "month")]
        ordering = ["-year", "-month"]

    def __str__(self):
        return f"{self.department.name} – {self.month:02d}/{self.year}"

    def get_max_prime_time_sessions(self, policy_config=None):
        """
        Trả về số phiên 21h-23h tối đa cho tháng này.
        Override thắng auto-rule.
        """
        if self.max_prime_time_override is not None:
            return self.max_prime_time_override
        pct = 0.20
        if policy_config:
            pct = float(policy_config.max_live_prime_time_pct)
        return max(1, int(self.total_planned_sessions * pct))


# ─────────────────────────────────────────────────────────────────────────────
# 8. LIVESTREAM ALLOWANCE CONFIG (Cấu hình phụ cấp livestream)
# ─────────────────────────────────────────────────────────────────────────────

class LivestreamAllowanceConfig(models.Model):
    """
    Cấu hình phụ cấp livestream - số tiền trả cho mỗi phiên livestream.
    Áp dụng cho từng phòng ban hoặc toàn công ty.
    """
    name = models.CharField(max_length=255, verbose_name="Tên cấu hình")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã cấu hình")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Số tiền per session
    amount_per_session = models.PositiveIntegerField(
        default=100_000, verbose_name="Số tiền phụ cấp livestream (VNĐ/phiên)"
    )
    
    # Áp dụng cho
    apply_to_all = models.BooleanField(default=True, verbose_name="Áp dụng cho tất cả")
    apply_to_departments = models.ManyToManyField(
        'employee.Department', blank=True,
        related_name='livestream_allowance_configs',
        verbose_name="Áp dụng cho phòng ban"
    )
    
    # Hiệu lực
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL, 
        null=True, blank=True, related_name='created_livestream_allowance_configs',
        verbose_name="Người tạo"
    )
    
    class Meta:
        verbose_name = "Cấu hình phụ cấp livestream"
        verbose_name_plural = "Cấu hình phụ cấp livestream"
        ordering = ['-effective_from']
        indexes = [
            models.Index(fields=['is_active', 'effective_from']),
        ]
    
    def __str__(self):
        return f"{self.code} - {self.name} ({self.amount_per_session} VNĐ)"
    
    @property
    def is_current(self):
        """Kiểm tra xem cấu hình có đang hiệu lực không"""
        from django.utils import timezone
        today = timezone.now().date()
        if self.is_active and self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False


# ─────────────────────────────────────────────────────────────────────────────
# 9. ATTENDANCE RANKING (Bảng xếp hạng chấm công)
# ─────────────────────────────────────────────────────────────────────────────

class AttendanceRanking(models.Model):
    """
    Bảng xếp hạng chấm công hàng tháng.
    Lưu thống kê số ngày đi sớm / đúng giờ của từng nhân viên trong một tháng,
    phục vụ khen thưởng và thi đua nội bộ.

    Dữ liệu được tính toán từ EmployeeEvent (attendance) kết hợp ShiftConfig.
    """

    employee    = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name="attendance_rankings",
        verbose_name="Nhân viên",
    )
    year        = models.PositiveSmallIntegerField(verbose_name="Năm")
    month       = models.PositiveSmallIntegerField(verbose_name="Tháng")

    # ── Các chỉ số chính ──────────────────────────────────────────────────────
    # Số ngày đi sớm hơn giờ vào ca (check_in < shift.start_time)
    early_days          = models.PositiveSmallIntegerField(default=0, verbose_name="Số ngày đi sớm")
    # Tổng số phút đến sớm tích lũy trong tháng
    total_early_minutes = models.IntegerField(default=0, verbose_name="Tổng phút đến sớm")
    # Số ngày đúng giờ (check_in <= shift.start_time, không muộn)
    on_time_days        = models.PositiveSmallIntegerField(default=0, verbose_name="Số ngày đúng giờ")
    # Số ngày có chấm công hợp lệ trong tháng
    total_working_days  = models.PositiveSmallIntegerField(default=0, verbose_name="Tổng ngày công")

    # ── Xếp hạng đã tính sẵn ─────────────────────────────────────────────────
    rank_early          = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name="Hạng đi sớm")
    rank_on_time        = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name="Hạng đúng giờ")

    # ── Thông tin hệ thống ────────────────────────────────────────────────────
    computed_at = models.DateTimeField(auto_now=True, verbose_name="Lần tính cuối")
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Bảng xếp hạng chấm công"
        verbose_name_plural = "Bảng xếp hạng chấm công"
        unique_together = [("employee", "year", "month")]
        ordering = ["-year", "-month", "rank_early"]
        indexes = [
            models.Index(fields=["year", "month"]),
            models.Index(fields=["year", "month", "rank_early"]),
            models.Index(fields=["year", "month", "rank_on_time"]),
        ]

    def __str__(self):
        return (
            f"{self.employee.full_name} – {self.month:02d}/{self.year} "
            f"| Sớm: {self.early_days}d ({self.total_early_minutes}p) "
            f"| Đúng giờ: {self.on_time_days}d"
        )

    @property
    def avg_early_minutes(self) -> float:
        """Số phút đến sớm trung bình mỗi ngày (trong số ngày đi sớm)."""
        if self.early_days == 0:
            return 0.0
        return round(self.total_early_minutes / self.early_days, 1)

    @property
    def early_ratio(self) -> float:
        """Tỉ lệ đi làm sớm (%) = Số ngày đi sớm / Số ngày làm việc thực tế * 100."""
        if self.total_working_days == 0:
            return 0.0
        return round(self.early_days / self.total_working_days * 100, 2)


# ─────────────────────────────────────────────────────────────────────────────
# 8. DEVICE API CALL LOG
# ─────────────────────────────────────────────────────────────────────────────

class DeviceAPICallLog(models.Model):
    """
    Lịch sử gọi API từ thiết bị chấm công (ZKTeco, v.v.).
    Ghi lại mọi request đến DeviceAttendancePushView để audit, debug và thống kê.
    """

    # Thông tin định danh caller
    device_name  = models.CharField(
        max_length=100, blank=True, default="",
        verbose_name="Tên thiết bị",
        help_text="Lấy từ trường device_name trong records (nếu có)"
    )
    caller_ip    = models.GenericIPAddressField(
        null=True, blank=True,
        verbose_name="IP gọi API"
    )
    user_agent   = models.TextField(
        blank=True, default="",
        verbose_name="User-Agent"
    )

    # Thông tin request
    api_endpoint = models.CharField(
        max_length=255,
        verbose_name="API endpoint được gọi"
    )
    http_method  = models.CharField(
        max_length=10, default="POST",
        verbose_name="HTTP method"
    )
    secret_used  = models.CharField(
        max_length=16, blank=True, default="",
        verbose_name="4 ký tự cuối của secret",
        help_text="Lưu 4 ký tự cuối để kiểm tra token nào được dùng mà không lộ bí mật"
    )
    auth_success = models.BooleanField(
        default=True,
        verbose_name="Xác thực thành công"
    )

    # Thống kê records
    total_records = models.PositiveIntegerField(
        default=0,
        verbose_name="Tổng số records nhận được"
    )
    processed     = models.PositiveIntegerField(
        default=0,
        verbose_name="Records đã xử lý thành công"
    )
    skipped       = models.PositiveIntegerField(
        default=0,
        verbose_name="Records bị bỏ qua (trùng lặp)"
    )
    error_count   = models.PositiveIntegerField(
        default=0,
        verbose_name="Records bị lỗi"
    )

    # HTTP response
    response_status = models.PositiveSmallIntegerField(
        default=200,
        verbose_name="HTTP status trả về"
    )

    # Thời gian
    called_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Thời điểm gọi API"
    )
    duration_ms = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name="Thời gian xử lý (ms)"
    )

    # Payload raw (tuỳ chọn, có thể bỏ qua nếu lo ngại kích thước DB)
    request_payload = models.JSONField(
        null=True, blank=True,
        verbose_name="Payload gốc của request"
    )
    errors_detail = models.JSONField(
        null=True, blank=True,
        verbose_name="Chi tiết lỗi các records"
    )

    class Meta:
        verbose_name = "Lịch sử gọi Device API"
        verbose_name_plural = "Lịch sử gọi Device API"
        ordering = ["-called_at"]
        indexes = [
            models.Index(fields=["called_at"]),
            models.Index(fields=["device_name"]),
            models.Index(fields=["caller_ip"]),
            models.Index(fields=["auth_success"]),
        ]

    def __str__(self):
        return (
            f"[{self.called_at:%Y-%m-%d %H:%M:%S}] {self.api_endpoint} "
            f"– {self.device_name or self.caller_ip} "
            f"– records={self.total_records} processed={self.processed}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# BRANCH LOCATION — Vị trí GPS của các cơ sở/chi nhánh
# ─────────────────────────────────────────────────────────────────────────────

class BranchLocation(models.Model):
    """Vị trí GPS của các cơ sở/chi nhánh — dùng để xác thực checkin theo bán kính"""
    name = models.CharField(max_length=200, verbose_name="Tên cơ sở")
    company_unit = models.OneToOneField(
        'employee.CompanyUnit',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='branch_location',
        verbose_name="Đơn vị/Chi nhánh"
    )
    address = models.CharField(max_length=500, blank=True, verbose_name="Địa chỉ")
    latitude = models.DecimalField(max_digits=10, decimal_places=7, verbose_name="Vĩ độ")
    longitude = models.DecimalField(max_digits=10, decimal_places=7, verbose_name="Kinh độ")
    radius_meters = models.IntegerField(
        default=100,
        verbose_name="Bán kính cho phép (mét)",
        help_text="Nhân viên phải đứng trong bán kính này mới được checkin"
    )
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Vị trí cơ sở"
        verbose_name_plural = "Vị trí các cơ sở"
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.latitude}, {self.longitude}) r={self.radius_meters}m"
