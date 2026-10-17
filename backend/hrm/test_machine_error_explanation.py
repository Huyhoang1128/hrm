"""Đơn giải trình "Lỗi máy chấm công" (MACHINE_ERROR): NV có chấm nhưng máy không
ghi nhận giờ. Duyệt xong tính công như Quên chấm công, nhưng không tính lượt giải
trình, không bị trừ công khi đã hết hạn mức, không xoá phạt đi muộn / về sớm."""
from datetime import date

from django.contrib.auth.models import User
from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.event import Event
from hrm.event_models import EmployeeEvent
from hrm.main_api import EmployeeState
from hrm.stats_utils import _get_quota_used
from hrm.taodon_views import _generate_explanation_code

DAY = "2026-09-07"


def _state(quota_used=0, late_penalty=0):
    s = EmployeeState("NV00481")
    s.explanation_quota_used = quota_used
    effects = {"quen_cham_cong": 1}
    if late_penalty:
        effects.update({"tong_phat": late_penalty, "late_penalty": late_penalty, "late_minutes": 15})
    s.calendar_result = [{
        "date": DAY, "event_type": "attendance", "check_in": "08:15", "check_out": None,
        "rules_applied": [], "effects": effects, "delta": dict(effects),
    }]
    return s


def _approval(explanation_type):
    return Event("explanation_approval", {
        "action": "APPROVE", "approval_level": "HR", "explanation_type": explanation_type,
        "date": DAY, "expected_status": "PRESENT", "forgot_punch_type": "checkout",
        "forgot_checkin_time": "", "forgot_checkout_time": "17:30:00",
        "actual_check_in": "08:15:00", "actual_check_out": "",
    })


class MachineErrorEngineTests(SimpleTestCase):
    def test_credit_like_forgot_punch(self):
        eff = _state()._evaluate_explanation_approval_rule(_approval("MACHINE_ERROR"), {})
        self.assertEqual(eff.get("nua_ngay_cong"), 1.0)
        self.assertEqual(eff.get("quen_cham_cong"), -1)

    def test_not_counted_and_no_over_quota_deduction(self):
        forgot = _state(quota_used=3)._evaluate_explanation_approval_rule(_approval("INCOMPLETE_ATTENDANCE"), {})
        self.assertEqual(forgot.get("explanation_quota_used"), 1)
        self.assertEqual(forgot.get("nua_ngay_cong"), 0.5)       # hết hạn mức → trừ 0.5

        machine = _state(quota_used=3)._evaluate_explanation_approval_rule(_approval("MACHINE_ERROR"), {})
        self.assertNotIn("explanation_quota_used", machine)
        self.assertEqual(machine.get("nua_ngay_cong"), 1.0)

    def test_late_penalty_same_day_is_kept(self):
        eff = _state(late_penalty=50000)._evaluate_explanation_approval_rule(_approval("MACHINE_ERROR"), {})
        self.assertNotIn("tong_phat", eff)


class MachineErrorApiTests(APITestCase):
    URL = '/api-hrm/attendance-explanations/'

    def setUp(self):
        self.admin_user = User.objects.create_user(username="mcc_admin", is_staff=True)
        Employee.objects.create(user=self.admin_user, employee_id="NV00482", full_name="Admin duyệt")
        self.employee = Employee.objects.create(
            user=User.objects.create_user(username="mcc_emp"), employee_id="NV00483", full_name="NV lỗi máy")
        self.client.force_authenticate(self.admin_user)

    def _payload(self, **kw):
        today = timezone.localdate()
        data = {
            'employee_id': self.employee.id, 'attendance_date': today.isoformat(),
            'original_status': 'INCOMPLETE_ATTENDANCE', 'expected_status': 'PRESENT',
            'explanation_type': 'MACHINE_ERROR', 'reason': 'Đã quẹt thẻ lúc 17:30 nhưng máy không ghi nhận',
            'forgot_punch_type': 'checkout', 'forgot_checkout_time': '17:30:00',
        }
        data.update(kw)
        return data

    def test_create_requires_reason_and_declared_time(self):
        self.assertEqual(self.client.post(self.URL, self._payload(reason=''), format='json').status_code, 400)
        self.assertEqual(self.client.post(self.URL, self._payload(forgot_punch_type=''), format='json').status_code, 400)
        res = self.client.post(self.URL, self._payload(forgot_checkout_time=None), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('forgot_checkout_time', res.data)

        res = self.client.post(self.URL, self._payload(), format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        event = EmployeeEvent.objects.get(employee=self.employee, data__explanation_type='MACHINE_ERROR')
        self.assertTrue(event.data.get('request_code', '').startswith('MCC-'), event.data)

    def test_code_prefix(self):
        self.assertTrue(_generate_explanation_code(date(2026, 9, 7), 'MACHINE_ERROR').startswith('MCC-202609-'))
        self.assertTrue(_generate_explanation_code(date(2026, 9, 7), 'INCOMPLETE_ATTENDANCE').startswith('ATT-EXPL-'))

    def test_not_counted_in_quota_and_not_blocked_when_quota_used_up(self):
        for day in (1, 2, 3):
            EmployeeEvent.objects.create(employee=self.employee, event_date=date(2026, 8, day),
                                         event_type=EmployeeEvent.EventType.EXPLANATION,
                                         data={'explanation_type': 'LATE', 'status': 'APPROVED'})
        machine = EmployeeEvent.objects.create(employee=self.employee, event_date=date(2026, 8, 20),
                                               event_type=EmployeeEvent.EventType.EXPLANATION,
                                               data={'explanation_type': 'MACHINE_ERROR', 'status': 'PENDING'})
        res = self.client.post(f'{self.URL}{machine.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(_get_quota_used(self.employee, date(2026, 8, 1)), 3)
