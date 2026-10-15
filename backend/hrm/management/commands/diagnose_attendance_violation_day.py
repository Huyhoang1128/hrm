import json

from django.core.management.base import BaseCommand

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.main_api import EmployeeState


class Command(BaseCommand):
    """
    Read-only: replay 1 tháng cho 1 nhân viên và in ra raw calendar entries của
    1 ngày cụ thể (effects/delta) — dùng để debug vì sao báo cáo vi phạm chấm
    công tính sai/thiếu so với thực tế cho ngày đó.

    Usage: python manage.py diagnose_attendance_violation_day <employee_id> <year> <month> <day>
    """
    help = "Debug calendar entries của 1 nhân viên/ngày cụ thể (read-only)"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str)
        parser.add_argument('year', type=int)
        parser.add_argument('month', type=int)
        parser.add_argument('day', type=int)

    def handle(self, *args, **options):
        employee_id = options['employee_id']
        year, month, day = options['year'], options['month'], options['day']
        target_date = f"{year:04d}-{month:02d}-{day:02d}"

        try:
            employee = Employee.objects.get(employee_id=employee_id)
        except Employee.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Không tìm thấy nhân viên {employee_id}"))
            return

        # Raw EmployeeEvent(ATTENDANCE) cho ngày này — trước khi replay engine xử lý.
        self.stdout.write(f"=== Raw EmployeeEvent cho {employee_id} ngày {target_date} ===")
        events = EmployeeEvent.objects.filter(employee=employee, event_date=target_date).order_by('event_type', 'id')
        for ev in events:
            self.stdout.write(
                f"- id={ev.id} type={ev.event_type} check_in={ev.check_in} check_out={ev.check_out} "
                f"data={json.dumps(ev.data, ensure_ascii=False, default=str)}"
            )
        if not events:
            self.stdout.write("(không có EmployeeEvent nào cho ngày này)")

        # Replay cả tháng, lọc calendar entries của đúng ngày này.
        self.stdout.write(f"\n=== Calendar entries (sau replay_month) cho {target_date} ===")
        employee_info = {"department_id": employee.department_id, "group_ids": []}
        result = EmployeeState.replay_month(
            employee_code=employee_id, year=year, month=month, employee_info=employee_info,
        )
        calendar = result.get("calendar", [])
        day_entries = [e for e in calendar if e.get("date") == target_date]
        if not day_entries:
            self.stdout.write("(không có calendar entry nào cho ngày này)")
        for e in day_entries:
            self.stdout.write(
                f"- event_type={e.get('event_type')} effects={e.get('effects')} delta={e.get('delta')}"
            )
