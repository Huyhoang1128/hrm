from django.apps import AppConfig


class HrmConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'hrm'

    def ready(self):
        import logging
        from django.db.models.signals import post_delete
        from hrm.models import LeaveRequest

        _logger = logging.getLogger(__name__)

        def _delete_leave_employee_events(sender, instance, **kwargs):
            """Xoá EmployeeEvent(leave_request) khi LeaveRequest bị xoá."""
            from hrm.event_models import EmployeeEvent
            deleted_count, _ = EmployeeEvent.objects.filter(
                employee=instance.employee,
                event_type=EmployeeEvent.EventType.LEAVE_REQUEST,
                data__leave_request_id=instance.id,
            ).delete()
            if deleted_count:
                _logger.info(
                    "[LeaveRequest] Xoá %s EmployeeEvent sau khi xoá leave_id=%s",
                    deleted_count, instance.id,
                )

        post_delete.connect(_delete_leave_employee_events, sender=LeaveRequest)

        # W4: Auto-invalidate branch cache khi BranchLocation thay đổi
        from django.db.models.signals import post_save
        from hrm.attendance_models import BranchLocation
        from hrm.location_utils import invalidate_branch_cache

        def _invalidate_branch_cache(sender, **kwargs):
            invalidate_branch_cache()

        post_save.connect(_invalidate_branch_cache, sender=BranchLocation)
        post_delete.connect(_invalidate_branch_cache, sender=BranchLocation)
