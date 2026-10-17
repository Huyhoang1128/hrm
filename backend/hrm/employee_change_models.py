"""
Điều chỉnh nhân sự có ngày hiệu lực (hrm/employee_change_service.py): đổi phòng ban /
chức vụ hoặc lương / phụ cấp từ một ngày, ngày tương lai thì chờ đến ngày đó mới áp
dụng vào hồ sơ, huỷ được khi còn chờ, mọi lần điều chỉnh đều có nhật ký.

Không thay các lịch sử sẵn có: áp dụng phòng ban / chức vụ ghi
employee.EmployeeAssignmentHistory (changed_from = ngày hiệu lực), lương / phụ cấp ghi
salary.EmployeeSalaryHistory (effective_from = ngày hiệu lực) ngay lúc tạo.
"""
from django.contrib.auth.models import User
from django.db import models

from employee.models import Department, Employee, Position


class EmployeeChangeRecord(models.Model):
    class ChangeType(models.TextChoices):
        ORG = 'ORG', 'Phòng ban / chức vụ'
        SALARY = 'SALARY', 'Lương / phụ cấp'

    class Status(models.TextChoices):
        SCHEDULED = 'SCHEDULED', 'Chờ áp dụng'
        APPLIED = 'APPLIED', 'Đã áp dụng'
        CANCELLED = 'CANCELLED', 'Đã huỷ'

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='change_records',
                                 verbose_name="Nhân viên")
    change_type = models.CharField(max_length=10, choices=ChangeType.choices, verbose_name="Loại điều chỉnh")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SCHEDULED,
                              verbose_name="Trạng thái")
    effective_date = models.DateField(verbose_name="Ngày áp dụng")
    note = models.TextField(blank=True, default='', verbose_name="Ghi chú")

    # Phòng ban / chức vụ — changes_*: "không đổi" khác "đổi thành trống"
    changes_department = models.BooleanField(default=False)
    old_department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    new_department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    changes_position = models.BooleanField(default=False)
    old_position = models.ForeignKey(Position, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    new_position = models.ForeignKey(Position, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    # Tên lúc tạo — nhật ký vẫn đọc được khi phòng ban / chức vụ đổi tên hoặc bị xoá
    old_department_name = models.CharField(max_length=255, blank=True, default='')
    new_department_name = models.CharField(max_length=255, blank=True, default='')
    old_position_name = models.CharField(max_length=255, blank=True, default='')
    new_position_name = models.CharField(max_length=255, blank=True, default='')

    # Lương / phụ cấp — new_* rỗng = khoản đó không đổi
    old_basic_salary = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    new_basic_salary = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    old_allowance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    new_allowance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    salary_history = models.ForeignKey('salary.EmployeeSalaryHistory', null=True, blank=True,
                                       on_delete=models.SET_NULL, related_name='+',
                                       verbose_name="Dòng lịch sử lương đã ghi")

    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_by_name = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    cancelled_by_name = models.CharField(max_length=255, blank=True, default='')
    cancelled_at = models.DateTimeField(null=True, blank=True)
    apply_error = models.TextField(blank=True, default='', verbose_name="Lỗi khi áp dụng")

    class Meta:
        verbose_name = "Điều chỉnh nhân sự"
        verbose_name_plural = "Điều chỉnh nhân sự"
        ordering = ['-effective_date', '-created_at']
        indexes = [
            models.Index(fields=['status', 'effective_date']),
            models.Index(fields=['employee', 'change_type', 'effective_date']),
        ]

    def __str__(self):
        return f"{self.employee} · {self.get_change_type_display()} · {self.effective_date} · {self.get_status_display()}"
