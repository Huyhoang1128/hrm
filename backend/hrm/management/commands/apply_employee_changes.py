"""Áp dụng các điều chỉnh nhân sự đã đến ngày (hrm/employee_change_service.py).
Chạy định kỳ trong vòng lặp worker (docker-compose)."""
from django.core.management.base import BaseCommand

from hrm.employee_change_service import apply_due_changes


class Command(BaseCommand):
    help = "Áp dụng các điều chỉnh nhân sự đã đến ngày áp dụng."

    def handle(self, *args, **options):
        applied = apply_due_changes()
        self.stdout.write(f"Đã áp dụng {applied} điều chỉnh nhân sự.")
