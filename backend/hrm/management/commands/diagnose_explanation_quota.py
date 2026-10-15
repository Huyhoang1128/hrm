import json

from django.core.management.base import BaseCommand

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.main_api import EmployeeState


class Command(BaseCommand):
    """
    Read-only: liệt kê toàn bộ đơn giải trình (EXPLANATION) trong tháng của 1
    nhân viên, đánh dấu đơn nào bị tính vào hạn mức giải trình (theo đúng logic
    _evaluate_explanation_approval_rule), và in raw data của các đơn
    INCOMPLETE_ATTENDANCE để debug vì sao chỉ được 0.5 công thay vì 1.0.

    Usage: python manage.py diagnose_explanation_quota <employee_id> <year> <month>
    """
    help = "Debug hạn mức giải trình + công của đơn quên chấm công cho 1 NV/tháng (read-only)"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str)
        parser.add_argument('year', type=int)
        parser.add_argument('month', type=int)

    def handle(self, *args, **options):
        employee_id = options['employee_id']
        year, month = options['year'], options['month']

        try:
            employee = Employee.objects.get(employee_id=employee_id)
        except Employee.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Không tìm thấy nhân viên {employee_id}"))
            return

        _EXEMPT_TYPES = {"BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME"}
        _VALID_TYPES = {
            "LATE", "EARLY_LEAVE", "FORGOT", "INCOMPLETE_ATTENDANCE",
            "BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME", "INSUFFICIENT_HOURS",
        }

        # 1. Toàn bộ đơn EXPLANATION trong tháng, kèm status + type
        self.stdout.write(f"=== EmployeeEvent(EXPLANATION) của {employee_id} tháng {month}/{year} ===")
        expl_qs = EmployeeEvent.objects.filter(
            employee=employee,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            event_date__year=year,
            event_date__month=month,
        ).order_by('event_date', 'id')

        for ev in expl_qs:
            d = ev.data or {}
            etype = d.get('explanation_type', '')
            etype_up = str(etype).upper()
            counts = etype_up in _VALID_TYPES and etype_up not in _EXEMPT_TYPES
            self.stdout.write(
                f"- id={ev.id} date={ev.event_date} type={etype!r} status={d.get('status')} "
                f"reason={d.get('reason')!r} counts_toward_quota={counts}"
            )
            if etype_up == "INCOMPLETE_ATTENDANCE":
                self.stdout.write(
                    "    forgot_punch_type=%r forgot_checkin_time=%r forgot_checkout_time=%r "
                    "actual_check_in=%r actual_check_out=%r" % (
                        d.get('forgot_punch_type'), d.get('forgot_checkin_time'),
                        d.get('forgot_checkout_time'), d.get('actual_check_in'), d.get('actual_check_out'),
                    )
                )

        # 2. Toàn bộ EXPLANATION_APPROVAL events (lịch sử duyệt) trong tháng
        self.stdout.write(f"\n=== EmployeeEvent(EXPLANATION_APPROVAL) trong tháng {month}/{year} ===")
        appr_qs = EmployeeEvent.objects.filter(
            employee=employee,
            event_type=EmployeeEvent.EventType.EXPLANATION_APPROVAL,
            event_date__year=year,
            event_date__month=month,
        ).order_by('event_date', 'id')
        for ev in appr_qs:
            d = ev.data or {}
            self.stdout.write(
                f"- id={ev.id} date={ev.event_date} action={d.get('action')} "
                f"approval_level={d.get('approval_level')} explanation_type={d.get('explanation_type')} "
                f"approved_for_event_id={d.get('approved_for_event_id')}"
            )

        # 3. Replay tháng -> in delta.explanation_quota_used theo từng ngày + target_credit
        #    thực tế cho ngày 16/17 (qua effects.nua_ngay_cong khi có event quên chấm công)
        self.stdout.write(f"\n=== Replay tháng — explanation_quota_used theo ngày ===")
        employee_info = {"department_id": employee.department_id, "group_ids": []}
        result = EmployeeState.replay_month(
            employee_code=employee_id, year=year, month=month, employee_info=employee_info,
        )
        calendar = result.get("calendar", [])
        running_total = 0
        for entry in calendar:
            delta = entry.get("delta", {}) or {}
            q = delta.get("explanation_quota_used", 0)
            nc = delta.get("nua_ngay_cong", 0)
            if q or entry.get("event_type") == "explanation_approval" or nc:
                running_total += q
                self.stdout.write(
                    f"- date={entry.get('date')} event_type={entry.get('event_type')} "
                    f"delta.explanation_quota_used={q} (running_total={running_total}) "
                    f"delta.nua_ngay_cong={nc} effects={entry.get('effects')}"
                )

        self.stdout.write(f"\nTổng cuối cùng state.explanation_quota_used = {result.get('state', {}).get('explanation_quota_used')}")
