"""Chế độ con nhỏ (hrm/child_care_regime.py): ngày đang hưởng được đi muộn / về sớm
thêm N phút mỗi chiều, phần vượt tính như bình thường."""
import datetime as dt

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.child_care_regime import child_care_minutes_by_date
from hrm.main_api import EmployeeState, Event
from hrm.models import ChildCareRegime

URL = '/api-hrm/child-care-regimes/'
DAY = '2026-09-15'
MORNING = {"rule_name": "Ca sáng", "rule_type": "SHIFT_RULE_MORNING",
           "conditions": {"start_time": "08:00", "end_time": "12:00", "workday": 0.5}}
AFTERNOON = {"rule_name": "Ca chiều", "rule_type": "SHIFT_RULE_AFTERNOON",
             "conditions": {"start_time": "13:30", "end_time": "17:30", "workday": 0.5}}


def att(check_in, check_out, day=DAY):
    return Event(event_type="attendance", data={"date": day, "check_in": check_in, "check_out": check_out})


class ChildCareEngineTests(APITestCase):
    def setUp(self):
        self.state = EmployeeState("NV00461")
        self.state._child_care_minutes = {DAY: 60}

    def test_within_allowance_is_not_a_violation(self):
        effects = self.state._evaluate_morning_shift_rule(att("08:50", "11:10"), MORNING)
        self.assertNotIn("late_minutes", effects)
        self.assertNotIn("early_leave_minutes", effects)
        self.assertNotIn("di_muon_ve_som", effects)
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

        effects = self.state._evaluate_afternoon_shift_rule(att("14:30", "16:30"), AFTERNOON)
        self.assertNotIn("late_minutes", effects)
        self.assertNotIn("early_leave_minutes", effects)
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_excess_over_allowance_counts_as_usual(self):
        effects = self.state._evaluate_morning_shift_rule(att("09:10", "10:45"), MORNING)
        self.assertEqual(effects.get("late_minutes"), 10)
        self.assertEqual(effects.get("early_leave_minutes"), 15)
        self.assertEqual(effects.get("di_muon_ve_som"), 2)

        effects = self.state._evaluate_afternoon_shift_rule(att("14:35", "17:30"), AFTERNOON)
        self.assertEqual(effects.get("late_minutes"), 5)

    def test_other_days_unchanged(self):
        effects = self.state._evaluate_morning_shift_rule(att("08:50", "12:00", day='2026-09-16'), MORNING)
        self.assertEqual(effects.get("late_minutes"), 50)

    def test_allowance_never_exceeds_shift(self):
        self.state._child_care_minutes = {DAY: 240}
        # Ca 4 giờ, N = 240: đi muộn / về sớm đều không vượt ra ngoài ca
        self.assertEqual(self.state._child_care_bounds(att("08:00", "12:00"), dt.time(8), dt.time(12)),
                         (dt.time(12), dt.time(8)))
        # Ca qua đêm → giữ nguyên
        self.assertEqual(self.state._child_care_bounds(att("22:00", "06:00"), dt.time(22), dt.time(6)),
                         (dt.time(22), dt.time(6)))


class ChildCareRegimeApiTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='CC', name='Phòng CC')
        self.emp = self._emp('NV00462')
        self.hr = self._emp('NV00463', is_hr=True)

    def _emp(self, code, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE', **kw)

    def test_minutes_by_date_clips_to_range(self):
        ChildCareRegime.objects.create(employee=self.emp, start_date=dt.date(2026, 8, 20),
                                       end_date=dt.date(2026, 9, 2), allowance_minutes=45)
        ChildCareRegime.objects.create(employee=self.emp, start_date=dt.date(2026, 9, 28))
        got = child_care_minutes_by_date(self.emp.id, dt.date(2026, 9, 1), dt.date(2026, 9, 30))
        self.assertEqual(got, {'2026-09-01': 45, '2026-09-02': 45, '2026-09-28': 60,
                               '2026-09-29': 60, '2026-09-30': 60})
        self.assertEqual(child_care_minutes_by_date(None, dt.date(2026, 9, 1), dt.date(2026, 9, 30)), {})

    def test_api_admin_or_hr_only_and_validation(self):
        self.client.force_authenticate(self.emp.user)
        self.assertEqual(self.client.get(URL).status_code, 403)

        self.client.force_authenticate(self.hr.user)
        res = self.client.post(URL, {'employee': self.emp.id, 'start_date': '2026-09-01', 'allowance_minutes': 30},
                               format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['employee_code'], 'NV00462')
        self.assertIsNone(res.data['end_date'])

        # Trùng khoảng ngày (bản ghi trước chưa có ngày kết thúc)
        res2 = self.client.post(URL, {'employee': self.emp.id, 'start_date': '2026-12-01'}, format='json')
        self.assertEqual(res2.status_code, 400)
        # Đến ngày < Từ ngày
        res3 = self.client.patch(f"{URL}{res.data['id']}/", {'end_date': '2026-08-01'}, format='json')
        self.assertEqual(res3.status_code, 400)
        # Kết thúc chế độ rồi thêm khoảng mới không trùng
        self.assertEqual(self.client.patch(f"{URL}{res.data['id']}/", {'end_date': '2026-11-30'},
                                           format='json').status_code, 200)
        self.assertEqual(self.client.post(URL, {'employee': self.emp.id, 'start_date': '2026-12-01'},
                                          format='json').status_code, 201)
        # N ngoài khoảng 1–240
        self.assertEqual(self.client.post(URL, {'employee': self.hr.id, 'start_date': '2026-09-01',
                                                'allowance_minutes': 0}, format='json').status_code, 400)
        res = self.client.get(URL, {'employee': self.emp.id})
        self.assertEqual(len(res.data), 2)
