"""Danh sách nhân viên dùng "rổ gộp" hạn mức giải trình (hrm/explanation_quota.py)."""
from django.db import models

from employee.models import Employee


class ManagerExplanationQuotaConfig(models.Model):
    """Nhân viên (thường là trưởng phòng) do HCNS chọn: khi hạn mức giải trình tính THEO
    TỪNG LOẠI (CompanyConfig.explanation_quota_mode = PER_TYPE), những người này dùng
    chung 1 rổ cho mọi loại (CompanyConfig.manager_combined_explanation_quota lượt/tháng)
    thay cho hạn mức từng loại. Chế độ COMBINED thì danh sách không có tác dụng.
    Bản ghi đơn (singleton)."""
    eligible_employees = models.ManyToManyField(
        Employee, blank=True, related_name='manager_explanation_quota_eligible',
        verbose_name="Nhân viên dùng rổ gộp",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Rổ gộp hạn mức giải trình"
        verbose_name_plural = "Rổ gộp hạn mức giải trình"

    def __str__(self):
        return "Rổ gộp hạn mức giải trình"

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @classmethod
    def eligible_ids(cls) -> set:
        return set(cls.objects.filter(pk=1).values_list('eligible_employees', flat=True)) - {None}
