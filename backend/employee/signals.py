"""
Tự ghi lịch sử điều chuyển (EmployeeAssignmentHistory) TRƯỚC khi HR đổi phòng ban /
vị trí / Team bác sĩ / hình thức làm việc / ca cá nhân của nhân viên — để công các
tháng trước vẫn tính theo dữ liệu cũ (employee/assignment.py).
"""
import logging

from .assignment import TRACKED_FIELDS, current_personal_shift_ids, record_assignment_snapshot

logger = logging.getLogger(__name__)


def _norm(value):
    return value or None  # '' và None cùng nghĩa "chưa nhập"


def capture_assignment_before_save(sender, instance, raw=False, update_fields=None, **kwargs):
    if raw or not instance.pk:
        return
    fields = TRACKED_FIELDS
    if update_fields is not None:
        fields = tuple(
            f for f in TRACKED_FIELDS if f in update_fields or f.removesuffix('_id') in update_fields
        )
        if not fields:
            return
    try:
        old = type(instance).objects.filter(pk=instance.pk).values(*TRACKED_FIELDS).first()
        if not old or all(_norm(old[f]) == _norm(getattr(instance, f)) for f in fields):
            return
        record_assignment_snapshot(
            instance.pk, old, current_personal_shift_ids(instance.pk),
            # Điều chỉnh nhân sự (hrm/employee_change_service.py) truyền ngày hiệu lực
            changed_from=getattr(instance, '_assignment_changed_from', None),
            note=getattr(instance, '_assignment_note', ''),
        )
    except Exception:
        # Ghi lịch sử là phụ — không được chặn việc lưu hồ sơ nhân viên.
        logger.exception("[AssignmentHistory] Không ghi được lịch sử điều chuyển NV id=%s", instance.pk)


def capture_personal_shift_change(sender, instance, action, reverse, pk_set, **kwargs):
    """ShiftConfig.apply_to_employees sắp đổi (thêm/bớt nhân viên khỏi ca cá nhân)."""
    if action not in ('pre_add', 'pre_remove', 'pre_clear'):
        return
    try:
        from .models import Employee

        if reverse:  # employee.shift_configs.add/remove/clear(...)
            changes = {instance.pk: None if action == 'pre_clear' else set(pk_set or ())}
        elif action == 'pre_clear':
            changes = {pk: {instance.pk} for pk in instance.apply_to_employees.values_list('pk', flat=True)}
        else:
            changes = {pk: {instance.pk} for pk in (pk_set or ())}

        for employee_id, shift_ids in changes.items():
            current = current_personal_shift_ids(employee_id)
            if action == 'pre_add':
                if not shift_ids or shift_ids <= set(current):
                    continue
            elif shift_ids is None:
                if not current:
                    continue
            elif not shift_ids & set(current):
                continue
            old = Employee.objects.filter(pk=employee_id).values(*TRACKED_FIELDS).first()
            if old:
                record_assignment_snapshot(employee_id, old, current)
    except Exception:
        logger.exception("[AssignmentHistory] Không ghi được lịch sử đổi ca cá nhân (ShiftConfig id=%s)",
                         getattr(instance, 'pk', None))


def connect():
    from django.db.models.signals import m2m_changed, pre_save
    from hrm.models import ShiftConfig
    from .models import Employee

    pre_save.connect(capture_assignment_before_save, sender=Employee,
                     dispatch_uid='employee_assignment_history_pre_save')
    m2m_changed.connect(capture_personal_shift_change, sender=ShiftConfig.apply_to_employees.through,
                        dispatch_uid='employee_assignment_history_personal_shift')
