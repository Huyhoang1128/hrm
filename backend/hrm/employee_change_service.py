"""
Điều chỉnh nhân sự có ngày hiệu lực (hrm.EmployeeChangeRecord).

- create_change(): kiểm tra rồi lưu điều chỉnh; ngày áp dụng hôm nay / quá khứ thì áp dụng
  ngay, ngày tương lai thì chờ (apply_due_changes chạy định kỳ + khi mở danh sách).
  Lương / phụ cấp: ghi luôn EmployeeSalaryHistory từ ngày áp dụng để bảng lương tháng đó
  đúng kể cả khi việc áp dụng vào hồ sơ chạy muộn.
- apply_change(): cập nhật hồ sơ. Phòng ban / chức vụ: lịch sử điều chuyển ghi đúng
  changed_from = ngày áp dụng (không phải ngày chạy).
- cancel_change(): huỷ điều chỉnh đang chờ; lương thì xoá mốc lương đã mở và mở lại mốc cũ.
- direct_edit_conflict(): chặn sửa thẳng trên hồ sơ trường đang có điều chỉnh chờ áp dụng.
"""
import datetime as dt
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .employee_change_models import EmployeeChangeRecord

UNSET = object()
_ONE_DAY = dt.timedelta(days=1)


class EmployeeChangeError(Exception):
    """Điều chỉnh không hợp lệ — thông báo hiển thị thẳng cho người dùng."""


def _fmt(day) -> str:
    return day.strftime('%d/%m/%Y')


def _user_name(user) -> str:
    from users.utils import get_user_display_name
    return get_user_display_name(user) if user else ''


def _finalized_month_from(day):
    """'MM/YYYY' của tháng đã chốt lương sớm nhất kể từ tháng của `day`, hoặc None."""
    from salary.salary_data_models import MonthlyPayrollSnapshot
    first = (MonthlyPayrollSnapshot.objects
             .filter(Q(year__gt=day.year) | Q(year=day.year, month__gte=day.month))
             .order_by('year', 'month').values_list('year', 'month').first())
    return f'{first[1]:02d}/{first[0]}' if first else None


def pending_change(employee, change_type):
    return EmployeeChangeRecord.objects.filter(
        employee=employee, change_type=change_type, status=EmployeeChangeRecord.Status.SCHEDULED,
    ).order_by('effective_date').first()


def current_values(employee) -> dict:
    return {
        'employee': employee.id,
        'employee_code': employee.employee_id,
        'employee_name': employee.full_name,
        'department_id': employee.department_id,
        'department_name': employee.department.name if employee.department_id else '',
        'position_id': employee.position_id,
        'position_name': employee.position.title if employee.position_id else '',
        'basic_salary': employee.basic_salary,
        'allowance': employee.allowance,
    }


def _money(value):
    return None if value is None else Decimal(str(value))


def _open_salary_history(employee, record):
    """Ghi mốc lương mới từ ngày áp dụng (đóng mốc đang mở ở ngày trước đó)."""
    from salary.salary_data_models import EmployeeSalaryHistory

    start = record.effective_date
    created_by = getattr(record.created_by, 'employee', None) if record.created_by_id else None
    histories = EmployeeSalaryHistory.objects.filter(employee=employee)
    if not histories.exists():
        # Chưa có lịch sử: ghi mức lương hiện tại cho giai đoạn trước ngày áp dụng.
        if employee.start_date and employee.start_date < start:
            EmployeeSalaryHistory.objects.create(
                employee=employee, basic_salary=employee.basic_salary or Decimal('0'),
                allowance=employee.allowance or Decimal('0'), effective_from=employee.start_date,
                effective_to=start - _ONE_DAY, created_by=created_by,
                notes='Mức lương trước điều chỉnh nhân sự.',
            )
    else:
        histories.filter(effective_from__lt=start).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=start)
        ).update(effective_to=start - _ONE_DAY)
    return EmployeeSalaryHistory.objects.create(
        employee=employee,
        basic_salary=record.new_basic_salary if record.new_basic_salary is not None else (employee.basic_salary or Decimal('0')),
        allowance=record.new_allowance if record.new_allowance is not None else (employee.allowance or Decimal('0')),
        effective_from=start,
        created_by=created_by,
        notes=f'Điều chỉnh nhân sự từ {_fmt(start)}' + (f': {record.note}' if record.note else '.'),
    )


@transaction.atomic
def create_change(employee, change_type, effective_date, *, user=None, note='',
                  department_id=UNSET, position_id=UNSET, basic_salary=None, allowance=None):
    from employee.models import Department, EmployeeAssignmentHistory, Position
    from salary.salary_data_models import EmployeeSalaryHistory

    if change_type not in EmployeeChangeRecord.ChangeType.values:
        raise EmployeeChangeError('Loại điều chỉnh không hợp lệ.')
    if not effective_date:
        raise EmployeeChangeError('Vui lòng chọn ngày áp dụng.')
    pending = pending_change(employee, change_type)
    if pending:
        raise EmployeeChangeError(
            f'Nhân viên đang có một điều chỉnh {pending.get_change_type_display().lower()} chờ áp dụng từ '
            f'{_fmt(pending.effective_date)}. Huỷ điều chỉnh đó trước khi tạo điều chỉnh mới.')
    finalized = _finalized_month_from(effective_date)
    if finalized:
        raise EmployeeChangeError(
            f'Tháng {finalized} đã chốt lương — bỏ chốt trước khi điều chỉnh có hiệu lực từ {_fmt(effective_date)}.')

    record = EmployeeChangeRecord(
        employee=employee, change_type=change_type, effective_date=effective_date, note=(note or '').strip(),
        created_by=user if getattr(user, 'is_authenticated', False) else None, created_by_name=_user_name(user),
    )
    if change_type == EmployeeChangeRecord.ChangeType.ORG:
        latest = (EmployeeAssignmentHistory.objects.filter(employee=employee)
                  .order_by('-changed_from').values_list('changed_from', flat=True).first())
        if latest and effective_date <= latest:
            raise EmployeeChangeError(f'Ngày áp dụng phải sau lần điều chuyển gần nhất ({_fmt(latest)}).')
        if department_id is not UNSET and (department_id or None) != employee.department_id:
            department = Department.objects.filter(pk=department_id).first() if department_id else None
            if department_id and department is None:
                raise EmployeeChangeError('Phòng ban không tồn tại.')
            record.changes_department = True
            record.old_department = employee.department
            record.old_department_name = employee.department.name if employee.department_id else ''
            record.new_department = department
            record.new_department_name = department.name if department else ''
        if position_id is not UNSET and (position_id or None) != employee.position_id:
            position = Position.objects.filter(pk=position_id).first() if position_id else None
            if position_id and position is None:
                raise EmployeeChangeError('Chức vụ không tồn tại.')
            record.changes_position = True
            record.old_position = employee.position
            record.old_position_name = employee.position.title if employee.position_id else ''
            record.new_position = position
            record.new_position_name = position.title if position else ''
        if not (record.changes_department or record.changes_position):
            raise EmployeeChangeError('Phòng ban / chức vụ mới trùng với hiện tại.')
        record.save()
    else:
        basic_salary, allowance = _money(basic_salary), _money(allowance)
        if any(v is not None and v < 0 for v in (basic_salary, allowance)):
            raise EmployeeChangeError('Số tiền không được âm.')
        if basic_salary is not None and basic_salary != (employee.basic_salary or Decimal('0')):
            record.old_basic_salary, record.new_basic_salary = employee.basic_salary, basic_salary
        if allowance is not None and allowance != (employee.allowance or Decimal('0')):
            record.old_allowance, record.new_allowance = employee.allowance, allowance
        if record.new_basic_salary is None and record.new_allowance is None:
            raise EmployeeChangeError('Lương / phụ cấp mới trùng với hiện tại.')
        latest = (EmployeeSalaryHistory.objects.filter(employee=employee)
                  .order_by('-effective_from').values_list('effective_from', flat=True).first())
        if latest and effective_date <= latest:
            raise EmployeeChangeError(f'Ngày áp dụng phải sau mốc lương gần nhất ({_fmt(latest)}).')
        record.save()
        record.salary_history = _open_salary_history(employee, record)
        record.save(update_fields=['salary_history'])

    if effective_date <= timezone.localdate():
        return apply_change(record.pk)
    return record


@transaction.atomic
def apply_change(record_id):
    record = EmployeeChangeRecord.objects.select_for_update().select_related('employee').get(pk=record_id)
    if record.status != EmployeeChangeRecord.Status.SCHEDULED:
        return record
    employee = record.employee
    fields = []
    if record.change_type == EmployeeChangeRecord.ChangeType.ORG:
        if record.changes_department:
            if record.new_department_id is None and record.new_department_name:
                raise EmployeeChangeError(f'Phòng ban "{record.new_department_name}" đã bị xoá.')
            employee.department_id = record.new_department_id
            fields.append('department')
        if record.changes_position:
            if record.new_position_id is None and record.new_position_name:
                raise EmployeeChangeError(f'Chức vụ "{record.new_position_name}" đã bị xoá.')
            employee.position_id = record.new_position_id
            fields.append('position')
        # Lịch sử điều chuyển (employee/signals.py) ghi đúng ngày áp dụng, kể cả khi chạy muộn.
        employee._assignment_changed_from = record.effective_date
        employee._assignment_note = (record.note or f'Điều chỉnh nhân sự từ {_fmt(record.effective_date)}')[:255]
    else:
        if record.new_basic_salary is not None:
            employee.basic_salary = record.new_basic_salary
            fields.append('basic_salary')
        if record.new_allowance is not None:
            employee.allowance = record.new_allowance
            fields.append('allowance')
    employee._changed_by = record.created_by
    employee.save(update_fields=fields + ['updated_at'])

    record.status = EmployeeChangeRecord.Status.APPLIED
    record.applied_at = timezone.now()
    record.apply_error = ''
    record.save(update_fields=['status', 'applied_at', 'apply_error'])
    return record


def apply_due_changes(today=None) -> int:
    """Áp dụng các điều chỉnh đã đến ngày; lỗi của 1 điều chỉnh ghi vào apply_error, không
    chặn các điều chỉnh khác. Trả số điều chỉnh đã áp dụng."""
    today = today or timezone.localdate()
    applied = 0
    due = EmployeeChangeRecord.objects.filter(
        status=EmployeeChangeRecord.Status.SCHEDULED, effective_date__lte=today,
    ).order_by('effective_date', 'id').values_list('id', flat=True)
    for record_id in list(due):
        try:
            apply_change(record_id)
            applied += 1
        except Exception as exc:  # noqa: BLE001 — ghi lại để HCNS xử lý
            EmployeeChangeRecord.objects.filter(pk=record_id).update(apply_error=str(exc))
    return applied


@transaction.atomic
def cancel_change(record_id, user=None):
    from salary.salary_data_models import EmployeeSalaryHistory

    record = EmployeeChangeRecord.objects.select_for_update().select_related('salary_history').get(pk=record_id)
    if record.status != EmployeeChangeRecord.Status.SCHEDULED:
        raise EmployeeChangeError('Chỉ huỷ được điều chỉnh đang chờ áp dụng.')
    history = record.salary_history
    if history is not None:
        if EmployeeSalaryHistory.objects.filter(employee_id=record.employee_id,
                                                effective_from__gt=history.effective_from).exists():
            raise EmployeeChangeError('Đã có mốc lương mới hơn mốc của điều chỉnh này — không huỷ được.')
        finalized = _finalized_month_from(history.effective_from)
        if finalized:
            raise EmployeeChangeError(f'Tháng {finalized} đã chốt lương — bỏ chốt trước khi huỷ điều chỉnh này.')
        start = history.effective_from
        history.delete()
        record.salary_history = None
        EmployeeSalaryHistory.objects.filter(employee_id=record.employee_id,
                                             effective_to=start - _ONE_DAY).update(effective_to=None)
    record.status = EmployeeChangeRecord.Status.CANCELLED
    record.cancelled_by = user if getattr(user, 'is_authenticated', False) else None
    record.cancelled_by_name = _user_name(user)
    record.cancelled_at = timezone.now()
    record.save(update_fields=['status', 'salary_history', 'cancelled_by', 'cancelled_by_name', 'cancelled_at'])
    return record


def direct_edit_conflict(employee, data: dict):
    """Thông báo lỗi nếu `data` (sửa hồ sơ trực tiếp) đổi trường đang có điều chỉnh chờ áp
    dụng — tránh hồ sơ bị ghi đè vào ngày áp dụng; ngược lại None."""
    org_changed = (
        ('department_id' in data and (data['department_id'] or None) != employee.department_id)
        or ('position_id' in data and (data['position_id'] or None) != employee.position_id)
    )
    salary_changed = (
        ('basic_salary' in data and _money(data['basic_salary']) != _money(employee.basic_salary))
        or ('allowance' in data and _money(data['allowance']) != _money(employee.allowance))
    )
    for changed, change_type in ((org_changed, EmployeeChangeRecord.ChangeType.ORG),
                                 (salary_changed, EmployeeChangeRecord.ChangeType.SALARY)):
        pending = pending_change(employee, change_type) if changed else None
        if pending:
            return (f'Đang có điều chỉnh {pending.get_change_type_display().lower()} chờ áp dụng từ '
                    f'{_fmt(pending.effective_date)} — sửa hoặc huỷ ở trang Điều chỉnh nhân sự.')
    return None
