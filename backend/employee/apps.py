from django.apps import AppConfig


class EmployeeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'employee'

    def ready(self):
        # Lịch sử điều chuyển: ghi dữ liệu cũ trước khi HR đổi phòng ban/vị trí/ca/
        # hình thức làm việc (employee/assignment.py).
        from . import signals
        signals.connect()
