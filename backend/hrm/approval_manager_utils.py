from django.db.models import Q


def get_approval_manager_id(employee):
    """Return the employee responsible for approving this employee's data."""
    return employee.manager_level_2_id or employee.manager_id


def get_approval_manager_filter(manager):
    """Match employees assigned to manager under the level-2-first rule."""
    return Q(manager_level_2=manager) | Q(manager_level_2__isnull=True, manager=manager)


def is_approval_manager(manager, employee):
    if not manager or not employee:
        return False
    return get_approval_manager_id(employee) == manager.pk
