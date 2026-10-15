"""
hrm/feedback_models.py
═══════════════════════
"Tiếp nhận - xử lý - Phản hồi IT/HC" (tên cũ "Hòm thư góp ý") — số hoá form
Google "LẮNG NGHE CHIA SẺ" của công ty: nhân sự gửi khó khăn/đề xuất/
chia sẻ ngay trong app HRM (nút ở góc trên phải), HCNS/Admin xem ở trang quản lý
và cập nhật trạng thái Chờ tiếp nhận → Đang xử lý → Đã xử lý. Người gửi tự theo
dõi trạng thái + phản hồi (response_note) của ý kiến mình đã gửi; hr_note là
ghi chú nội bộ, người gửi không xem được.

Phân luồng theo vấn đề (IT_TOPICS): góp ý IT/app chỉ hiện cho tài khoản HCNS/Admin
thuộc phòng IT (+ tài khoản admin hệ thống không gắn nhân viên); các vấn đề còn
lại chỉ hiện cho tài khoản HCNS/Admin thuộc phòng ban khác — xem
feedback_views._visible_topics().

Gửi ẩn danh → VẪN lưu nhân viên (để kiểm soát nếu có người cố tình phá/spam),
nhưng API KHÔNG BAO GIỜ trả danh tính ra giao diện (kể cả qua tìm kiếm theo tên);
chỉ tra được qua Django Admin.
"""
from django.db import models

from employee.models import Employee


class Feedback(models.Model):
    TOPIC_CHOICES = [
        ("HRM_APP", "Lỗi / góp ý về app HRM"),
        ("IT_SUPPORT", "Máy tính, thiết bị, mạng (IT)"),
        ("WORK", "Công việc & quy trình"),
        ("POLICY", "Chế độ, chính sách, lương thưởng"),
        ("ENVIRONMENT", "Môi trường làm việc & đồng nghiệp"),
        ("MANAGEMENT", "Quản lý & lãnh đạo"),
        ("CAREER", "Định hướng phát triển bản thân"),
        ("OTHER", "Khác"),
    ]
    # Vấn đề do bộ phận IT xử lý; mọi vấn đề khác do HCNS xử lý.
    IT_TOPICS = ("HRM_APP", "IT_SUPPORT")
    STATUS_CHOICES = [
        ("NEW", "Chờ tiếp nhận"),
        ("IN_PROGRESS", "Đang xử lý"),
        ("RESOLVED", "Đã xử lý"),
    ]

    # Các câu hỏi tự luận — giữ nguyên nội dung form "LẮNG NGHE CHIA SẺ".
    ANSWER_FIELDS = [
        ("difficulties", "Bạn có gặp khó khăn, bức xúc trong công việc cần được hỗ trợ và giải quyết không?"),
        ("support_needed", "Bạn cần hỗ trợ gì để hoàn thành tốt công việc trong thời gian tiếp theo?"),
        ("career_sharing", "Bạn có muốn chia sẻ gì với BLĐ về định hướng công việc, mong muốn phát triển của bản thân không?"),
        ("work_proposal", "Đề xuất trong công việc cá nhân của bạn?"),
        ("other_sharing", "Ngoài công việc ra, bạn có thể chia sẻ với chúng tôi bất cứ điều gì bạn muốn."),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="feedbacks", verbose_name="Người gửi (vẫn lưu khi ẩn danh, chỉ ẩn trên giao diện)",
    )
    is_anonymous = models.BooleanField(default=False, verbose_name="Gửi ẩn danh")
    topic = models.CharField(max_length=20, choices=TOPIC_CHOICES, verbose_name="Vấn đề góp ý")

    difficulties = models.TextField(blank=True, verbose_name="Khó khăn, bức xúc trong công việc")
    support_needed = models.TextField(blank=True, verbose_name="Cần hỗ trợ gì")
    career_sharing = models.TextField(blank=True, verbose_name="Chia sẻ với BLĐ về định hướng")
    work_proposal = models.TextField(blank=True, verbose_name="Đề xuất trong công việc")
    other_sharing = models.TextField(blank=True, verbose_name="Chia sẻ khác")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="NEW", verbose_name="Trạng thái")
    hr_note = models.TextField(blank=True, verbose_name="Ghi chú xử lý (nội bộ HCNS)")
    response_note = models.TextField(blank=True, verbose_name="Phản hồi cho người gửi (người gửi xem được)")
    handled_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người cập nhật xử lý",
    )
    handled_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True, verbose_name="Tiếp nhận lúc")
    resolved_at = models.DateTimeField(null=True, blank=True, verbose_name="Đánh dấu xử lý xong lúc")
    # Người gửi đã bấm "Đã hiểu" trên thông báo "góp ý đã được xử lý xong".
    # Reset về null mỗi lần góp ý chuyển sang RESOLVED để thông báo lại.
    resolved_seen_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Người gửi đã xem thông báo xử lý xong lúc",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Ý kiến IT/HC"
        verbose_name_plural = "Tiếp nhận - xử lý - Phản hồi IT/HC"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="hrm_feedbac_status_6e1f0a_idx"),
            models.Index(fields=["topic", "-created_at"], name="hrm_feedbac_topic_9b2c4d_idx"),
        ]

    def change_status(self, new_status):
        """Đổi trạng thái + các mốc người gửi theo dõi: tiếp nhận lúc
        (received_at, giữ nguyên mốc đầu tiên), xử lý xong lúc; mỗi lần chuyển
        sang RESOLVED, người gửi được báo lại (resolved_seen_at = null)."""
        if new_status == self.status:
            return
        from django.utils import timezone
        now = timezone.now()
        if new_status == "NEW":
            self.received_at = None
        elif self.received_at is None:
            self.received_at = now
        self.resolved_at = now if new_status == "RESOLVED" else None
        self.resolved_seen_at = None
        self.status = new_status

    def __str__(self):
        who = "Ẩn danh" if self.is_anonymous or not self.employee else self.employee.employee_id
        return f"#{self.id} {who} - {self.get_topic_display()}"


class FeedbackAttachment(models.Model):
    """Ảnh đính kèm góp ý (vd ảnh chụp màn hình lỗi app để IT xử lý nhanh)."""
    feedback = models.ForeignKey(Feedback, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="feedback/", max_length=500, verbose_name="Ảnh")
    file_name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Ảnh đính kèm góp ý"
        verbose_name_plural = "Ảnh đính kèm góp ý"
        ordering = ["uploaded_at", "id"]

    def __str__(self):
        return self.file_name
