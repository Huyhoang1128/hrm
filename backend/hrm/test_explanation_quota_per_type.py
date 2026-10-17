"""Hạn mức giải trình theo từng loại + rổ gộp (hrm/explanation_quota.py). Mặc định COMBINED
không đổi hành vi — xem test_explanation_quota_approval.py."""
from datetime import date

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.event import Event
from hrm.event_models import EmployeeEvent
from hrm.explanation_quota import explanation_quota_status
from hrm.main_api import EmployeeState
from hrm.models import CompanyConfig, ManagerExplanationQuotaConfig

MONTH = date(2026, 8, 1)


def _approve_url(event_id):
    return f"/api-hrm/attendance-explanations/{event_id}/approve/"


class PerTypeExplanationQuotaTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="pt_admin", is_staff=True)
        Employee.objects.create(user=self.admin_user, employee_id="NV00431", full_name="Admin duyệt")
        self.employee = Employee.objects.create(user=User.objects.create_user(username="pt_emp"),
                                                employee_id="NV00432", full_name="NV theo loại")
        CompanyConfig.objects.filter(is_active=True).update(is_active=False)
        self.cfg = CompanyConfig.objects.create(
            name='Cấu hình test', code='PT-TEST', is_active=True, effective_from=date(2026, 1, 1),
            max_explanation_count_per_month=3, explanation_quota_mode='PER_TYPE',
            max_late_explanation_per_month=1, max_early_leave_explanation_per_month=1,
            max_incomplete_attendance_explanation_per_month=2, manager_combined_explanation_quota=5)
        self.client.force_authenticate(self.admin_user)

    def _explanation(self, explanation_type, day, approved=False):
        return EmployeeEvent.objects.create(
            employee=self.employee, event_date=MONTH.replace(day=day), event_type=EmployeeEvent.EventType.EXPLANATION,
            data={'explanation_type': explanation_type, 'status': 'APPROVED' if approved else 'PENDING'})

    def test_combined_mode_mirrors_single_quota(self):
        self.cfg.explanation_quota_mode = 'COMBINED'
        self.cfg.save()
        self._explanation('LATE', 1, approved=True)
        status = explanation_quota_status(self.employee, MONTH)
        self.assertTrue(status['shared'])
        self.assertEqual(status['combined'], {'used': 1, 'max': 3, 'remaining': 2})
        self.assertEqual(status['by_type']['EARLY_LEAVE'], status['combined'])

    def test_per_type_buckets_are_independent(self):
        self._explanation('LATE', 1, approved=True)
        self._explanation('MACHINE_ERROR', 2, approved=True)   # không tính hạn mức
        status = explanation_quota_status(self.employee, MONTH)
        self.assertFalse(status['shared'])
        self.assertEqual(status['by_type']['LATE'], {'used': 1, 'max': 1, 'remaining': 0})
        self.assertEqual(status['combined'], {'used': 1, 'max': 4, 'remaining': 3})

        second_late = self._explanation('LATE_EARLY', 3)   # cùng giỏ Đi muộn
        res = self.client.post(_approve_url(second_late.id), {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['quota_type'], 'LATE')
        early = self._explanation('EARLY_LEAVE', 4)
        self.assertEqual(self.client.post(_approve_url(early.id), {}, format='json').status_code, 200)

    def test_smart_bulk_uses_each_bucket(self):
        items = [self._explanation('LATE', 5), self._explanation('LATE', 6), self._explanation('EARLY_LEAVE', 7)]
        res = self.client.post('/api-hrm/attendance-explanations/smart_bulk_approve/',
                               {'ids': [e.id for e in items]}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        statuses = sorted(EmployeeEvent.objects.get(pk=e.pk).data['status'] for e in items)
        self.assertEqual(statuses, ['APPROVED', 'APPROVED', 'REJECTED'])
        self.assertEqual(EmployeeEvent.objects.filter(data__explanation_type='EARLY_LEAVE',
                                                      data__status='APPROVED').count(), 1)

    def test_manager_combined_basket(self):
        ManagerExplanationQuotaConfig.get_solo().eligible_employees.add(self.employee)
        for day, kind in enumerate(['LATE', 'LATE', 'EARLY_LEAVE', 'INCOMPLETE_ATTENDANCE', 'LATE'], start=1):
            self._explanation(kind, day, approved=True)
        status = explanation_quota_status(self.employee, MONTH)
        self.assertTrue(status['is_manager_combined_quota'] and status['shared'])
        self.assertEqual(status['combined'], {'used': 5, 'max': 5, 'remaining': 0})
        sixth = self._explanation('EARLY_LEAVE', 9)
        self.assertEqual(self.client.post(_approve_url(sixth.id), {}, format='json').status_code, 400)

        res = self.client.get('/api-hrm/manager-explanation-quota-config/')
        self.assertEqual(res.data['eligible_employees'], [self.employee.id])
        res = self.client.put('/api-hrm/manager-explanation-quota-config/', {'eligible_employees': []}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(explanation_quota_status(self.employee, MONTH)['is_manager_combined_quota'])

    def test_engine_over_quota_uses_bucket(self):
        def approval():
            return Event("explanation_approval", {
                "action": "APPROVE", "approval_level": "HR", "explanation_type": "INCOMPLETE_ATTENDANCE",
                "date": "2026-08-10", "expected_status": "PRESENT", "forgot_punch_type": "checkout",
                "forgot_checkin_time": "", "forgot_checkout_time": "17:30:00",
                "actual_check_in": "08:00:00", "actual_check_out": "",
            })

        def state(combined_used, incomplete_used):
            s = EmployeeState("NV00432")
            s._quota_rules_cache = {'mode': 'PER_TYPE', 'is_manager_combined_quota': False, 'combined_max': None,
                                    'limits': {'LATE': 1, 'EARLY_LEAVE': 1, 'INCOMPLETE_ATTENDANCE': 2}}
            s.explanation_quota_used = combined_used
            s.explanation_quota_used_incomplete = incomplete_used
            s.calendar_result = [{"date": "2026-08-10", "event_type": "attendance", "check_in": "08:00",
                                  "check_out": None, "rules_applied": [], "effects": {"quen_cham_cong": 1},
                                  "delta": {"quen_cham_cong": 1}}]
            return s

        # Đã dùng 3 lượt chung (đi muộn / về sớm) nhưng giỏ Quên chấm công còn → đủ công
        eff = state(3, 1)._evaluate_explanation_approval_rule(approval(), {})
        self.assertEqual(eff.get("nua_ngay_cong"), 1.0)
        self.assertEqual(eff.get("explanation_quota_used_incomplete"), 1)
        # Giỏ Quên chấm công đã hết → trừ 0.5
        self.assertEqual(state(2, 2)._evaluate_explanation_approval_rule(approval(), {}).get("nua_ngay_cong"), 0.5)
