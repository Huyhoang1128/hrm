"""
Kế hoạch ca theo tuần (hrm/shift_plan_views.py): nhân viên chọn ca cho từng ngày trong tuần
(chọn tự do trong các ca đang dùng), gửi duyệt 2 bước (quản lý trực tiếp → HCNS), HCNS có
thể khoá việc tạo / sửa / gửi kế hoạch và nhập / xuất bằng Excel.

Tách riêng với "Đăng ký ca" (shift_registration_models.py — chọn Ca 1 / Ca 2 theo phạm vi
cấu hình). Ngày có kế hoạch ĐÃ DUYỆT thì engine chấm công dùng ca trong kế hoạch
(shift_config_utils.get_registered_shift_configs_for_date); không có kế hoạch đã duyệt thì
mọi thứ giữ nguyên như trước.
"""
from django.contrib.auth.models import User
from django.db import models

from employee.models import Employee


class WeeklyShiftPlan(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Nháp'
        PENDING = 'PENDING', 'Chờ duyệt'
        APPROVED = 'APPROVED', 'Đã duyệt'
        REJECTED = 'REJECTED', 'Từ chối'

    class Source(models.TextChoices):
        MANUAL = 'MANUAL', 'Nhân viên tự lập'
        HR = 'HR', 'HCNS lập hộ'
        UPLOAD = 'UPLOAD', 'Nhập từ Excel'

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='weekly_shift_plans',
                                 verbose_name="Nhân viên")
    week_start_date = models.DateField(verbose_name="Tuần từ (thứ Hai)")
    week_end_date = models.DateField(verbose_name="Đến (Chủ nhật)")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, verbose_name="Trạng thái")
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL, verbose_name="Nguồn")

    submitted_at = models.DateTimeField(null=True, blank=True)
    direct_manager_approved = models.BooleanField(default=False, verbose_name="Quản lý trực tiếp đã duyệt")
    direct_manager_approved_at = models.DateTimeField(null=True, blank=True)
    direct_manager_approved_by = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.SET_NULL,
                                                   related_name='weekly_shift_plans_manager_approved')
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='approved_weekly_shift_plans')
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='rejected_weekly_shift_plans')
    reject_reason = models.TextField(blank=True, default='', verbose_name="Lý do từ chối")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Kế hoạch ca tuần"
        verbose_name_plural = "Kế hoạch ca tuần"
        unique_together = ['employee', 'week_start_date']
        ordering = ['-week_start_date', 'employee__employee_id']
        indexes = [models.Index(fields=['status', 'week_start_date'])]

    def __str__(self):
        return f"{self.employee} · tuần {self.week_start_date:%d/%m/%Y} · {self.get_status_display()}"


class WeeklyShiftPlanDay(models.Model):
    """1 ngày trong kế hoạch: `shift` (ca chính) + `shift_2` (tuỳ chọn — vd ca chiều khi 1
    ngày làm 2 ca sáng / chiều). Cả hai trống = nghỉ."""
    plan = models.ForeignKey(WeeklyShiftPlan, on_delete=models.CASCADE, related_name='days')
    date = models.DateField(verbose_name="Ngày")
    shift = models.ForeignKey('hrm.ShiftConfig', null=True, blank=True, on_delete=models.PROTECT,
                              related_name='weekly_plan_days', verbose_name="Ca")
    shift_2 = models.ForeignKey('hrm.ShiftConfig', null=True, blank=True, on_delete=models.PROTECT,
                                related_name='weekly_plan_days_second', verbose_name="Ca thứ 2")

    class Meta:
        verbose_name = "Ngày trong kế hoạch ca"
        verbose_name_plural = "Ngày trong kế hoạch ca"
        unique_together = ['plan', 'date']
        ordering = ['date']
        indexes = [models.Index(fields=['date'])]

    def __str__(self):
        names = [s.code for s in (self.shift, self.shift_2) if s] or ['Nghỉ']
        return f"{self.date:%d/%m/%Y}: {' + '.join(names)}"


class WeeklyShiftPlanLock(models.Model):
    """Khoá tạo / sửa / gửi kế hoạch ca (bản ghi đơn). Khi khoá, không ai tạo / sửa / gửi được —
    kể cả HCNS / Admin; duyệt, từ chối và nhập Excel vẫn làm được."""
    is_locked = models.BooleanField(default=False, verbose_name="Đang khoá")
    note = models.CharField(max_length=255, blank=True, default='', verbose_name="Ghi chú")
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Khoá kế hoạch ca"
        verbose_name_plural = "Khoá kế hoạch ca"

    def __str__(self):
        return "Khoá kế hoạch ca: " + ("đang khoá" if self.is_locked else "mở")

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
