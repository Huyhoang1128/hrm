"""
recruitment/models.py – Nhu cầu tuyển dụng & Job (JD + kênh đăng tuyển).
"""
from django.db import models
from django.contrib.auth.models import User


# ---------------------------------------------------------------------------
# Choices
# ---------------------------------------------------------------------------

RECRUITMENT_STATUS = [
    ('DRAFT', 'Nháp'),
    ('PENDING_APPROVAL', 'Chờ HR duyệt'),
    ('APPROVED', 'Đã duyệt / Chốt order'),
    ('IN_PROGRESS', 'Đang triển khai tuyển dụng'),
    ('FILLED', 'Đã tuyển đủ'),
    ('EXPIRED', 'Đã hết hạn'),
    ('CANCELLED', 'Đã hủy'),
]

NEED_APPROVAL_STATUS = [
    ('PENDING', 'Chờ duyệt'),
    ('APPROVED', 'Đã duyệt'),
    ('REJECTED', 'Từ chối'),
]

JOB_STATUS = [
    ('DRAFT', 'Nháp'),
    ('PUBLISHED', 'Đang đăng'),
    ('CLOSED', 'Đóng'),
]

EMPLOYMENT_TYPE = [
    ('FULL_TIME', 'Toàn thời gian'),
    ('PART_TIME', 'Bán thời gian'),
    ('CONTRACT', 'Hợp đồng'),
    ('INTERN', 'Thực tập'),
    ('COLLABORATOR', 'Cộng tác viên'),
]

CHANNEL_TYPE = [
    ('WEBSITE', 'Website công ty'),
    ('LINKEDIN', 'LinkedIn'),
    ('TOPCV', 'TopCV'),
    ('FACEBOOK', 'Facebook'),
    ('ITVIEC', 'ITViec'),
    ('VIETNAMWORKS', 'VietnamWorks'),
    ('CAREERBUILDER', 'CareerBuilder'),
    ('REFERRAL', 'Giới thiệu nội bộ'),
    ('OTHER', 'Khác'),
]


# ---------------------------------------------------------------------------
# RecruitmentNeed – Nhu cầu tuyển dụng
# ---------------------------------------------------------------------------

class RecruitmentNeed(models.Model):
    """Nhu cầu tuyển dụng từ phòng ban: vị trí, số lượng, mức lương dự kiến."""

    position_name = models.CharField(max_length=255, verbose_name="Vị trí tuyển dụng")
    position = models.ForeignKey(
        'employee.Position', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='recruitment_needs', verbose_name="Chức vụ"
    )
    department = models.ForeignKey(
        'employee.Department', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='recruitment_needs', verbose_name="Phòng ban"
    )
    headcount = models.PositiveSmallIntegerField(default=1, verbose_name="Số lượng cần tuyển")
    employment_type = models.CharField(
        max_length=20, choices=EMPLOYMENT_TYPE, default='FULL_TIME',
        verbose_name="Hình thức làm việc"
    )
    expected_salary_min = models.DecimalField(
        max_digits=15, decimal_places=0, null=True, blank=True,
        verbose_name="Lương dự kiến tối thiểu"
    )
    expected_salary_max = models.DecimalField(
        max_digits=15, decimal_places=0, null=True, blank=True,
        verbose_name="Lương dự kiến tối đa"
    )
    reason = models.TextField(blank=True, verbose_name="Lý do tuyển dụng")
    target_onboard_date = models.DateField(null=True, blank=True, verbose_name="Ngày dự kiến onboard")
    status = models.CharField(
        max_length=20, choices=RECRUITMENT_STATUS, default='DRAFT',
        verbose_name="Trạng thái"
    )
    requested_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='requested_recruitment_needs', verbose_name="Người yêu cầu"
    )
    interviewer = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='interviewer_recruitment_needs', verbose_name="Người phỏng vấn"
    )
    cv_approver = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='cv_approver_recruitment_needs', verbose_name="Người duyệt CV"
    )

    # ── Approval (HR duyệt / chốt order) ──────────────────────────────────
    approval_status = models.CharField(
        max_length=20, choices=NEED_APPROVAL_STATUS, default='PENDING',
        verbose_name="Trạng thái duyệt"
    )
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='approved_recruitment_needs', verbose_name="HR đã duyệt"
    )
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt")
    approval_note = models.TextField(blank=True, verbose_name="Ghi chú duyệt")
    rejected_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm từ chối")

    # ── Triển khai tuyển dụng nội bộ ──────────────────────────────────────
    is_published_internally = models.BooleanField(
        default=False,
        verbose_name="Công khai tuyển dụng nội bộ",
        help_text="HR bật để nhân sự thấy và giới thiệu ứng viên"
    )
    published_internally_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Thời điểm công khai nội bộ"
    )
    published_internally_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='published_internally_needs', verbose_name="Người công khai nội bộ"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Nhu cầu tuyển dụng"
        verbose_name_plural = "Nhu cầu tuyển dụng"
        ordering = ['-created_at']

    def __str__(self):
        dept = self.department.name if self.department else "N/A"
        return f"{self.position_name} – {dept} ({self.headcount} người)"


# ---------------------------------------------------------------------------
# Job – Tin tuyển dụng (JD)
# ---------------------------------------------------------------------------

class Job(models.Model):
    """Tin tuyển dụng: JD, kỹ năng yêu cầu, quyền lợi."""

    recruitment_need = models.ForeignKey(
        RecruitmentNeed, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='jobs', verbose_name="Nhu cầu tuyển dụng"
    )
    position = models.ForeignKey(
        'employee.Position', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='jobs', verbose_name="Vị trí tuyển dụng"
    )
    title = models.CharField(max_length=255, verbose_name="Tiêu đề tin")
    description = models.TextField(verbose_name="Mô tả công việc (JD)")
    requirements = models.TextField(blank=True, verbose_name="Yêu cầu kỹ năng")
    benefits = models.TextField(blank=True, verbose_name="Quyền lợi")
    status = models.CharField(
        max_length=20, choices=JOB_STATUS, default='PUBLISHED',
        verbose_name="Trạng thái"
    )
    published_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày đăng")
    closed_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày đóng")
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_jobs', verbose_name="Người tạo"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Tin tuyển dụng"
        verbose_name_plural = "Tin tuyển dụng"
        ordering = ['-created_at']

    def __str__(self):
        return self.title


# ---------------------------------------------------------------------------
# JobChannel – Kênh đăng tuyển
# ---------------------------------------------------------------------------

class JobChannel(models.Model):
    """Kênh đăng tuyển của một tin (Website, LinkedIn, TopCV…)."""

    job = models.ForeignKey(
        Job, on_delete=models.CASCADE,
        related_name='channels', verbose_name="Tin tuyển dụng"
    )
    channel_type = models.CharField(
        max_length=30, choices=CHANNEL_TYPE,
        verbose_name="Kênh đăng tuyển"
    )
    url = models.URLField(blank=True, verbose_name="URL đăng tuyển")
    posted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày đăng trên kênh")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Kênh đăng tuyển"
        verbose_name_plural = "Kênh đăng tuyển"
        ordering = ['channel_type']
        unique_together = [('job', 'channel_type')]

    def __str__(self):
        return f"{self.job.title} – {self.get_channel_type_display()}"
