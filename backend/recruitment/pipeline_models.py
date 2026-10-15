"""
recruitment/pipeline_models.py – Pipeline tuyển dụng, phỏng vấn, đánh giá, offer.
"""
from django.db import models
from django.contrib.auth.models import User

from .candidate_models import Candidate
from .models import Job


# ---------------------------------------------------------------------------
# Choices
# ---------------------------------------------------------------------------

PIPELINE_STAGE = [
    ('APPLIED', 'Đã ứng tuyển'),
    ('SCREENING', 'Sàng lọc CV'),
    ('INTERVIEW', 'Phỏng vấn'),
    ('TEST', 'Kiểm tra/Test'),
    ('OFFER', 'Offer'),
    ('HIRED', 'Đã tuyển'),
    ('REJECTED', 'Bị từ chối'),
    ('WITHDRAWN', 'Ứng viên rút hồ sơ'),
]

APPLICATION_STATUS = [
    ('ACTIVE', 'Đang tiến hành'),
    ('HIRED', 'Đã tuyển'),
    ('REJECTED', 'Bị từ chối'),
    ('WITHDRAWN', 'Ứng viên rút hồ sơ'),
]

INTERVIEW_STATUS = [
    ('SCHEDULED', 'Đã lên lịch'),
    ('DONE', 'Đã phỏng vấn'),
    ('CANCELLED', 'Đã hủy'),
    ('NO_SHOW', 'Không đến'),
]

INTERVIEW_TYPE = [
    ('PHONE', 'Điện thoại'),
    ('VIDEO', 'Video call'),
    ('IN_PERSON', 'Trực tiếp'),
    ('TECHNICAL', 'Kỹ thuật'),
    ('HR', 'HR'),
    ('FINAL', 'Vòng cuối'),
]

OFFER_STATUS = [
    ('PENDING', 'Chờ phản hồi'),
    ('ACCEPTED', 'Đã chấp nhận'),
    ('REJECTED', 'Đã từ chối'),
    ('EXPIRED', 'Hết hạn'),
]

REJECTION_REASON = [
    ('SKILLS_MISMATCH', 'Không phù hợp kỹ năng'),
    ('SALARY_MISMATCH', 'Không phù hợp mức lương'),
    ('CULTURE_FIT', 'Không phù hợp văn hóa'),
    ('OVERQUALIFIED', 'Quá trình độ'),
    ('UNDERQUALIFIED', 'Thiếu kinh nghiệm'),
    ('CANDIDATE_WITHDREW', 'Ứng viên tự rút'),
    ('POSITION_CANCELLED', 'Vị trí không còn tuyển'),
    ('OTHER', 'Lý do khác'),
]

CV_PROCESS_STATUS = [
    ('NEW', 'Mới nhận'),
    ('PROCESSING', 'Đang xử lý'),
    ('ACCEPTED', 'Chấp nhận CV'),
    ('REJECTED', 'Từ chối CV'),
    ('ON_HOLD', 'Tạm giữ'),
]


# ---------------------------------------------------------------------------
# Application – Ứng viên ứng tuyển vào một vị trí
# ---------------------------------------------------------------------------

class Application(models.Model):
    """Đơn ứng tuyển: ứng viên × job, tracking qua pipeline stages."""

    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE,
        related_name='applications', verbose_name="Ứng viên"
    )
    job = models.ForeignKey(
        Job, on_delete=models.CASCADE,
        related_name='applications', verbose_name="Tin tuyển dụng"
    )
    current_stage = models.CharField(
        max_length=20, choices=PIPELINE_STAGE, default='APPLIED',
        verbose_name="Giai đoạn hiện tại"
    )
    status = models.CharField(
        max_length=20, choices=APPLICATION_STATUS, default='ACTIVE',
        verbose_name="Trạng thái"
    )
    assignee = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assigned_applications', verbose_name="Người phụ trách"
    )
    source = models.CharField(
        max_length=30, blank=True, verbose_name="Nguồn ứng tuyển"
    )
    rejection_reason = models.CharField(
        max_length=30, choices=REJECTION_REASON, blank=True,
        verbose_name="Lý do từ chối"
    )
    rejection_note = models.TextField(blank=True, verbose_name="Ghi chú từ chối")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    # ── Trạng thái xử lý CV (HR đánh dấu) ───────────────────────────────
    cv_process_status = models.CharField(
        max_length=20, choices=CV_PROCESS_STATUS, default='NEW',
        verbose_name="Trạng thái xử lý CV"
    )
    cv_processed_by_id = models.IntegerField(
        null=True, blank=True,
        verbose_name="HR đánh dấu xử lý (User.id)"
    )
    cv_processed_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Thời điểm đánh dấu xử lý CV"
    )

    applied_at = models.DateTimeField(auto_now_add=True, verbose_name="Ngày ứng tuyển")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Đơn ứng tuyển"
        verbose_name_plural = "Đơn ứng tuyển"
        ordering = ['-applied_at']
        unique_together = [('candidate', 'job')]

    def __str__(self):
        return f"{self.candidate.full_name} → {self.job.title}"

    def get_effective_interviewer(self):
        """Người phỏng vấn hiển thị cho đơn này: ưu tiên interviewer set riêng cho
        buổi phỏng vấn gần nhất (chưa huỷ) của đơn, nếu chưa set thì fallback về
        Bộ phận phỏng vấn mặc định của Nhu cầu tuyển dụng."""
        interview = self.interviews.exclude(status='CANCELLED').order_by('-scheduled_at').first()
        if interview:
            interviewer = interview.interviewers.first()
            if interviewer:
                return interviewer
        if self.job and self.job.recruitment_need:
            return self.job.recruitment_need.interviewer
        return None


# ---------------------------------------------------------------------------
# ApplicationStageHistory – Lịch sử giai đoạn
# ---------------------------------------------------------------------------

class ApplicationStageHistory(models.Model):
    """Ghi lại mỗi lần ứng viên chuyển sang stage mới."""

    application = models.ForeignKey(
        Application, on_delete=models.CASCADE,
        related_name='stage_history', verbose_name="Đơn ứng tuyển"
    )
    stage = models.CharField(max_length=20, choices=PIPELINE_STAGE, verbose_name="Giai đoạn")
    entered_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời gian vào")
    exited_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời gian rời")
    changed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='stage_changes', verbose_name="Người thay đổi"
    )
    note = models.TextField(blank=True, verbose_name="Ghi chú")

    class Meta:
        verbose_name = "Lịch sử giai đoạn"
        verbose_name_plural = "Lịch sử giai đoạn"
        ordering = ['-entered_at']

    def __str__(self):
        return f"{self.application} @ {self.stage}"


# ---------------------------------------------------------------------------
# Interview – Lịch phỏng vấn
# ---------------------------------------------------------------------------

class Interview(models.Model):
    """Lịch phỏng vấn cho một đơn ứng tuyển."""

    application = models.ForeignKey(
        Application, on_delete=models.CASCADE,
        related_name='interviews', verbose_name="Đơn ứng tuyển"
    )
    interview_type = models.CharField(
        max_length=20, choices=INTERVIEW_TYPE, default='HR',
        verbose_name="Loại phỏng vấn"
    )
    scheduled_at = models.DateTimeField(verbose_name="Thời gian phỏng vấn")
    duration_minutes = models.PositiveSmallIntegerField(
        default=60, verbose_name="Thời lượng (phút)"
    )
    location = models.CharField(
        max_length=255, blank=True, verbose_name="Địa điểm / link meet"
    )
    interviewers = models.ManyToManyField(
        User, blank=True,
        related_name='interviews', verbose_name="Người phỏng vấn"
    )
    status = models.CharField(
        max_length=20, choices=INTERVIEW_STATUS, default='SCHEDULED',
        verbose_name="Trạng thái"
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    # ── Xác nhận lịch bởi người phỏng vấn ───────────────────────────────
    interviewer_confirmed = models.BooleanField(
        default=False, verbose_name="Người phỏng vấn đã xác nhận"
    )
    interviewer_confirmed_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Thời điểm xác nhận"
    )
    # Sau khi xác nhận → hệ thống auto-book phòng họp (hrm.MeetingRoomBooking)
    room_booking_id = models.IntegerField(
        null=True, blank=True,
        verbose_name="ID lịch phòng họp (hrm.MeetingRoomBooking)"
    )

    # ── Email hẹn phỏng vấn ──────────────────────────────────────────────
    interview_email_sent = models.BooleanField(
        default=False, verbose_name="Đã gửi email hẹn PV"
    )
    interview_email_sent_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Thời điểm gửi email hẹn PV"
    )

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_interviews', verbose_name="Người tạo"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Lịch phỏng vấn"
        verbose_name_plural = "Lịch phỏng vấn"
        ordering = ['-scheduled_at']

    def __str__(self):
        return f"[{self.get_interview_type_display()}] {self.application} @ {self.scheduled_at:%d/%m/%Y %H:%M}"


# ---------------------------------------------------------------------------
# InterviewEvaluation – Đánh giá sau phỏng vấn
# ---------------------------------------------------------------------------

class InterviewEvaluation(models.Model):
    """Đánh giá ứng viên sau mỗi vòng phỏng vấn (chuẩn hoá để tránh bias)."""

    SCORE_CHOICES = [(i, str(i)) for i in range(1, 6)]  # 1-5

    interview = models.ForeignKey(
        Interview, on_delete=models.CASCADE,
        related_name='evaluations', verbose_name="Phỏng vấn"
    )
    evaluator = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='interview_evaluations', verbose_name="Người đánh giá"
    )
    technical_score = models.PositiveSmallIntegerField(
        choices=SCORE_CHOICES, null=True, blank=True, verbose_name="Điểm kỹ thuật (1-5)"
    )
    cultural_fit_score = models.PositiveSmallIntegerField(
        choices=SCORE_CHOICES, null=True, blank=True, verbose_name="Điểm phù hợp văn hóa (1-5)"
    )
    communication_score = models.PositiveSmallIntegerField(
        choices=SCORE_CHOICES, null=True, blank=True, verbose_name="Điểm giao tiếp (1-5)"
    )
    overall_score = models.PositiveSmallIntegerField(
        choices=SCORE_CHOICES, null=True, blank=True, verbose_name="Điểm tổng thể (1-5)"
    )
    strengths = models.TextField(blank=True, verbose_name="Điểm mạnh")
    weaknesses = models.TextField(blank=True, verbose_name="Điểm yếu")
    recommendation = models.TextField(blank=True, verbose_name="Đề xuất")
    is_recommended = models.BooleanField(
        null=True, blank=True, verbose_name="Đề xuất tuyển"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Đánh giá phỏng vấn"
        verbose_name_plural = "Đánh giá phỏng vấn"
        unique_together = [('interview', 'evaluator')]

    def __str__(self):
        return f"Đánh giá bởi {self.evaluator} – {self.interview}"


# ---------------------------------------------------------------------------
# Offer – Thư đề nghị việc làm
# ---------------------------------------------------------------------------

class Offer(models.Model):
    """Offer letter: mức lương đề xuất, trạng thái, ngày onboard."""

    application = models.OneToOneField(
        Application, on_delete=models.CASCADE,
        related_name='offer', verbose_name="Đơn ứng tuyển"
    )
    proposed_salary = models.DecimalField(
        max_digits=15, decimal_places=0,
        verbose_name="Lương đề xuất"
    )
    allowances = models.DecimalField(
        max_digits=15, decimal_places=0, default=0,
        verbose_name="Phụ cấp"
    )
    position_title = models.CharField(
        max_length=255, blank=True, verbose_name="Chức danh đề xuất"
    )
    probation_months = models.PositiveSmallIntegerField(
        default=2, verbose_name="Thời gian thử việc (tháng)"
    )
    expected_onboard_date = models.DateField(
        null=True, blank=True, verbose_name="Ngày onboard dự kiến"
    )
    actual_onboard_date = models.DateField(
        null=True, blank=True, verbose_name="Ngày onboard thực tế"
    )
    status = models.CharField(
        max_length=20, choices=OFFER_STATUS, default='PENDING',
        verbose_name="Trạng thái"
    )
    rejection_note = models.TextField(blank=True, verbose_name="Lý do từ chối (offer)")
    offer_letter_file = models.FileField(
        upload_to='recruitment/offers/', null=True, blank=True,
        verbose_name="File offer letter"
    )
    sent_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày gửi offer")
    responded_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày phản hồi")

    # ── Lịch nhận việc và email nhận việc ────────────────────────────────
    confirmed_onboard_date = models.DateField(
        null=True, blank=True, verbose_name="Ngày nhận việc đã xác nhận"
    )
    onboard_email_sent = models.BooleanField(
        default=False, verbose_name="Đã gửi email nhận việc"
    )
    onboard_email_sent_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Thời điểm gửi email nhận việc"
    )
    onboard_email_sent_by_id = models.IntegerField(
        null=True, blank=True,
        verbose_name="Người gửi email nhận việc (User.id)"
    )
    # Sau khi accepted + confirmed_onboard_date → tự động tạo OnboardingProcess
    onboarding_process_id = models.IntegerField(
        null=True, blank=True,
        verbose_name="ID quy trình onboarding (hrm.OnboardingProcess)"
    )

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_offers', verbose_name="Người tạo"
    )
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Offer letter"
        verbose_name_plural = "Offer letters"
        ordering = ['-created_at']

    def __str__(self):
        return f"Offer: {self.application.candidate.full_name} – {self.get_status_display()}"
