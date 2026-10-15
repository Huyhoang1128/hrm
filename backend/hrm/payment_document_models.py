"""Phiếu đề nghị thanh toán / đề xuất mua hàng / đề nghị tạm ứng (chi phí).

HCNS tự nhập để lưu trữ và rà soát hằng tháng — kế toán không làm trên phần
mềm nên KHÔNG có quy trình duyệt: phiếu giấy đã ký được scan đính kèm, HCNS theo
dõi trạng thái xử lý và đánh dấu "Đã rà soát". Kỳ rà soát tính theo ngày đề nghị.
"""
from django.contrib.auth.models import User
from django.db import IntegrityError, models, transaction

PAYMENT_DOCUMENT_TYPE = [
    ('PAYMENT_REQUEST', 'Đề nghị thanh toán'),
    ('PURCHASE_PROPOSAL', 'Đề xuất mua hàng'),
    ('EXPENSE_ADVANCE', 'Đề nghị tạm ứng'),
]

PAYMENT_DOCUMENT_STATUS = [
    ('PENDING', 'Chờ xử lý'),
    ('COMPLETED', 'Hoàn tất'),
    ('CANCELLED', 'Huỷ'),
]

# Nhãn "Hoàn tất" theo loại phiếu.
COMPLETED_LABELS = {
    'PAYMENT_REQUEST': 'Đã thanh toán',
    'PURCHASE_PROPOSAL': 'Đã mua hàng',
    'EXPENSE_ADVANCE': 'Đã hoàn ứng',
}

PAYMENT_METHOD = [
    ('CASH', 'Tiền mặt'),
    ('TRANSFER', 'Chuyển khoản'),
]

CODE_PREFIX = {
    'PAYMENT_REQUEST': 'DNTT',
    'PURCHASE_PROPOSAL': 'DXMH',
    'EXPENSE_ADVANCE': 'DNTU',
}


class PaymentDocument(models.Model):
    code = models.CharField(max_length=30, unique=True, editable=False, verbose_name='Mã phiếu')
    doc_type = models.CharField(max_length=30, choices=PAYMENT_DOCUMENT_TYPE, verbose_name='Loại phiếu')
    doc_date = models.DateField(verbose_name='Ngày đề nghị')

    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payment_documents', verbose_name='Người đề nghị',
    )
    # Người đề nghị không có trên hệ thống (vd đối tác) hoặc ghi tay thêm.
    requester_name = models.CharField(max_length=255, blank=True, verbose_name='Tên người đề nghị (ghi tay)')
    department = models.ForeignKey(
        'employee.Department', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payment_documents', verbose_name='Bộ phận',
    )

    title = models.CharField(max_length=255, verbose_name='Nội dung')
    description = models.TextField(blank=True, verbose_name='Chi tiết')
    amount = models.DecimalField(max_digits=15, decimal_places=0, default=0, verbose_name='Số tiền')
    payee = models.CharField(max_length=255, blank=True, verbose_name='Người / đơn vị nhận tiền, nhà cung cấp')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD, blank=True, verbose_name='Hình thức thanh toán')
    bank_account = models.CharField(max_length=255, blank=True, verbose_name='Số tài khoản / ngân hàng')
    # Đề xuất mua hàng: [{name, unit, quantity, unit_price}] — amount = tổng thành tiền.
    items = models.JSONField(default=list, blank=True, verbose_name='Danh sách mặt hàng')
    due_date = models.DateField(null=True, blank=True, verbose_name='Hạn thanh toán / ngày cần hàng / hạn hoàn ứng')

    status = models.CharField(max_length=20, choices=PAYMENT_DOCUMENT_STATUS, default='PENDING', verbose_name='Trạng thái')
    completed_date = models.DateField(null=True, blank=True, verbose_name='Ngày thanh toán / mua / hoàn ứng')
    # Đề nghị tạm ứng: số tiền đã hoàn ứng (chứng từ đã nộp).
    settled_amount = models.DecimalField(max_digits=15, decimal_places=0, null=True, blank=True, verbose_name='Đã hoàn ứng')
    note = models.TextField(blank=True, verbose_name='Ghi chú')

    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name='Rà soát lúc')
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='reviewed_payment_documents', verbose_name='Người rà soát',
    )

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_payment_documents', verbose_name='Người tạo',
    )
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='updated_payment_documents', verbose_name='Người sửa cuối',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Xoá mềm — phiếu là chứng từ kiểm soát, không mất dữ liệu.
    is_deleted = models.BooleanField(default=False, verbose_name='Đã xoá')
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='deleted_payment_documents', verbose_name='Người xoá',
    )

    class Meta:
        verbose_name = 'Phiếu thanh toán / mua hàng / tạm ứng'
        verbose_name_plural = 'Phiếu thanh toán / mua hàng / tạm ứng'
        ordering = ['-doc_date', '-id']
        indexes = [
            models.Index(fields=['doc_type', 'doc_date']),
            models.Index(fields=['doc_date']),
        ]

    def __str__(self):
        return f"{self.code} — {self.title}"

    @property
    def status_label(self):
        if self.status == 'COMPLETED':
            return COMPLETED_LABELS.get(self.doc_type, 'Hoàn tất')
        return self.get_status_display()

    def _next_code(self):
        prefix = f"{CODE_PREFIX.get(self.doc_type, 'PTT')}-{self.doc_date:%Y%m}-"
        last = (
            PaymentDocument.objects.filter(code__startswith=prefix)
            .order_by('-code').values_list('code', flat=True).first()
        )
        try:
            seq = int(last.rsplit('-', 1)[-1]) + 1 if last else 1
        except ValueError:
            seq = 1
        return f"{prefix}{seq:04d}"

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)
        # Mã theo loại + tháng đề nghị (vd DNTT-202610-0001); thử lại nếu trùng do tạo đồng thời.
        for attempt in range(5):
            self.code = self._next_code()
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                self.pk = None
                if attempt == 4:
                    raise


class PaymentDocumentAttachment(models.Model):
    document = models.ForeignKey(PaymentDocument, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='hrm/payment_documents/', max_length=500, blank=True)
    file_name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'File đính kèm phiếu'
        verbose_name_plural = 'File đính kèm phiếu'
        ordering = ['uploaded_at', 'id']

    def __str__(self):
        return self.file_name
