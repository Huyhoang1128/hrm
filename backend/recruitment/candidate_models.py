"""
recruitment/candidate_models.py – Ứng viên (Candidate).
"""
from django.db import models
from django.contrib.auth.models import User


# ---------------------------------------------------------------------------
# Choices
# ---------------------------------------------------------------------------

CANDIDATE_SOURCE = [
    ('HR_PERSONAL', 'HR cá nhân'),
    ('ADS_FACEBOOK', 'Ads facebook'),
    ('COLLABORATOR', 'CTV tuyển dụng'),
    ('REFERRAL', 'Giới thiệu nội bộ'),
]

CANDIDATE_STATUS = [
    ('PENDING_CV_REVIEW', 'Đang chờ duyệt CV'),
    ('CV_APPROVED', 'Đã duyệt CV'),
    ('INTERVIEW_SCHEDULED', 'Hẹn phỏng vấn'),
    ('INTERVIEWING', 'Đang phỏng vấn'),
    ('INTERVIEW_PASSED', 'Đạt phỏng vấn'),
    ('INTERVIEW_FAILED', 'Không đạt phỏng vấn'),
    ('CONSIDERING', 'Cân nhắc ứng viên'),
    ('CV_SAVED', 'Lưu CV (lần tới cần thì gọi)'),
]

GENDER = [
    ('M', 'Nam'),
    ('F', 'Nữ'),
    ('O', 'Khác'),
]


# ---------------------------------------------------------------------------
# Candidate – Ứng viên
# ---------------------------------------------------------------------------

class Candidate(models.Model):
    """
    Hồ sơ ứng viên: thông tin cơ bản, chuyên môn, lịch sử apply.
    Một ứng viên có thể apply nhiều vị trí.
    """

    # Thông tin cơ bản
    full_name = models.CharField(max_length=255, verbose_name="Họ và tên")
    email = models.EmailField(unique=True, verbose_name="Email")
    phone = models.CharField(max_length=20, blank=True, verbose_name="Số điện thoại")
    gender = models.CharField(
        max_length=1, choices=GENDER, blank=True, verbose_name="Giới tính"
    )
    date_of_birth = models.DateField(null=True, blank=True, verbose_name="Ngày sinh")
    address = models.TextField(blank=True, verbose_name="Địa chỉ")

    # CV / hồ sơ
    cv_file = models.FileField(
        upload_to='recruitment/cv/', max_length=500, null=True, blank=True, verbose_name="File CV"
    )
    cv_url = models.URLField(blank=True, verbose_name="Link CV")
    avatar = models.ImageField(
        upload_to='recruitment/avatars/', null=True, blank=True, verbose_name="Ảnh"
    )

    # Thông tin chuyên môn
    skills = models.TextField(blank=True, verbose_name="Kỹ năng")
    experience_years = models.PositiveSmallIntegerField(
        default=0, verbose_name="Số năm kinh nghiệm"
    )
    experience_summary = models.TextField(blank=True, verbose_name="Tóm tắt kinh nghiệm")
    overall_evaluation = models.TextField(
        blank=True,
        verbose_name="Đánh giá tổng quan ứng viên",
        help_text="Tóm tắt đánh giá tổng quan do AI sinh từ CV, HR có thể chỉnh sửa."
    )
    education = models.TextField(blank=True, verbose_name="Học vấn")
    current_company = models.CharField(
        max_length=255, blank=True, verbose_name="Công ty hiện tại"
    )
    current_position = models.CharField(
        max_length=255, blank=True, verbose_name="Chức vụ hiện tại"
    )
    expected_salary = models.DecimalField(
        max_digits=15, decimal_places=0, null=True, blank=True,
        verbose_name="Mức lương mong muốn"
    )

    # Metadata
    source = models.CharField(
        max_length=30, choices=CANDIDATE_SOURCE, default='HR_PERSONAL',
        verbose_name="Nguồn ứng viên"
    )
    status = models.CharField(
        max_length=30, choices=CANDIDATE_STATUS, default='PENDING_CV_REVIEW',
        verbose_name="Trạng thái ứng viên"
    )
    tags = models.CharField(
        max_length=500, blank=True,
        verbose_name="Tags",
        help_text="Các tag phân cách bởi dấu phẩy"
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú từ HR")
    is_blacklisted = models.BooleanField(default=False, verbose_name="Blacklist")
    blacklist_reason = models.TextField(blank=True, verbose_name="Lý do blacklist")

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_candidates', verbose_name="Người tạo"
    )

    # ── Referral nội bộ ───────────────────────────────────────────────────
    # Nhân sự giới thiệu (Employee FK – lazy import để tránh circular)
    referred_by_employee_id = models.IntegerField(
        null=True, blank=True,
        verbose_name="ID nhân viên giới thiệu",
        help_text="employee.Employee.id của người giới thiệu"
    )
    referral_need = models.ForeignKey(
        'recruitment.RecruitmentNeed',
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='referral_candidates',
        verbose_name="Nhu cầu tuyển dụng được giới thiệu vào"
    )
    referral_note = models.TextField(blank=True, verbose_name="Ghi chú của người giới thiệu")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ứng viên"
        verbose_name_plural = "Ứng viên"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.full_name} ({self.email})"
