import json

from django.core.management.base import BaseCommand

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.models import ShiftConfig


class Command(BaseCommand):
    """
    Read-only: in ra toàn bộ ShiftConfig áp dụng cho 1 nhân viên tại 1 ngày cụ
    thể, cùng raw EmployeeEvent(ATTENDANCE) của ngày đó — dùng để debug vì sao
    form "quên chấm công" ở FE tự gợi ý sai giờ quên checkin (vd: gợi ý giờ bắt
    đầu của MỘT ca khác thay vì ca hành chính thật NV đang làm), do logic
    auto-detect so khớp giờ chấm công thật với khung giờ của TỪNG ShiftConfig
    áp dụng cho NV (AttendanceManagement.tsx handleReasonSelect).

    Usage: python manage.py diagnose_shift_mismatch <employee_id> <year> <month> <day>
    """
    help = "In ShiftConfig áp dụng + raw attendance của 1 NV/ngày (read-only)"

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

        self.stdout.write(f"=== ShiftConfig áp dụng cho {employee_id} tại ngày {target_date} ===")
        shift_configs = ShiftConfig.objects.filter(
            apply_to_employees=employee,
            is_active=True,
            effective_from__lte=target_date,
        )
        found = False
        for sc in shift_configs:
            if sc.effective_to and str(sc.effective_to) < target_date:
                continue
            found = True
            self.stdout.write(
                f"- id={sc.id} name={sc.name!r} code={sc.code!r} shift_type={sc.shift_type} "
                f"start_time={sc.start_time} end_time={sc.end_time} "
                f"effective_from={sc.effective_from} effective_to={sc.effective_to}"
            )
        if not found:
            self.stdout.write("(không có ShiftConfig nào áp dụng)")

        self.stdout.write(f"\n=== Raw EmployeeEvent(ATTENDANCE) ngày {target_date} ===")
        att_events = EmployeeEvent.objects.filter(
            employee=employee,
            event_type=EmployeeEvent.EventType.ATTENDANCE,
            event_date=target_date,
        ).order_by('id')
        for ev in att_events:
            self.stdout.write(
                f"- id={ev.id} check_in={ev.check_in} check_out={ev.check_out} "
                f"checkin_is_valid={ev.checkin_is_valid} data={json.dumps(ev.data, ensure_ascii=False, default=str)}"
            )
        if not att_events:
            self.stdout.write("(không có EmployeeEvent ATTENDANCE nào cho ngày này)")

        self.stdout.write(f"\n=== Raw EmployeeEvent(EXPLANATION) ngày {target_date} ===")
        expl_events = EmployeeEvent.objects.filter(
            employee=employee,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            event_date=target_date,
        ).order_by('id')
        for ev in expl_events:
            self.stdout.write(f"- id={ev.id} data={json.dumps(ev.data, ensure_ascii=False, default=str)}")
        if not expl_events:
            self.stdout.write("(không có đơn giải trình nào cho ngày này)")
