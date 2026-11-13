"""Hạn chót tính ở backend, trả kèm dữ liệu cho web dùng (web không tự tính lại luật):

- /api-hrm/duyet-don/: `manager_hours_fix_deadline` của đơn tăng ca Tại Viện/VP
  (deadline_utils.manager_attendance_fix_deadline — đúng hàm update() dùng để chặn QLTT sửa giờ).
- /api-hrm/shift-registrations/registration-deadline/: hạn đăng ký ca của 1 tuần
  (shift_registration_deadline — đúng hàm create() dùng để chặn), kể cả tuần chưa có đăng ký.
"""
from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.deadline_utils import manager_attendance_fix_deadline
from hrm.duyet_don_views import serialize_duyet_don_event
from hrm.event_models import EmployeeEvent
from hrm.shift_registration_models import shift_registration_deadline


class ManagerHoursFixDeadlineTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username='_fixdl_emp', password='x')
        self.employee = Employee.objects.create(user=user, employee_id='FIXDL-1', full_name='NV Test')

    def _event(self, event_type, data):
        return EmployeeEvent.objects.create(
            employee=self.employee, event_date=date(2026, 11, 14), event_type=event_type,
            data={'status': 'PENDING', 'request_code': 'T', 'reason': 'x', **data},
        )

    def test_onsite_overtime_has_backend_deadline(self):
        ev = self._event(EmployeeEvent.EventType.OVERTIME, {'registration_type': 'OVERTIME', 'ot_type': 'ONSITE'})
        row = serialize_duyet_don_event(ev)
        # 14/11/2026 là Thứ 7 -> hạn rơi vào Chủ nhật 15/11 -> hết ngày (luật backend).
        self.assertEqual(row['manager_hours_fix_deadline'], manager_attendance_fix_deadline(ev.event_date).isoformat())

    def test_other_requests_have_no_deadline(self):
        online = self._event(EmployeeEvent.EventType.OVERTIME, {'registration_type': 'OVERTIME', 'ot_type': 'ONLINE'})
        extra = self._event(EmployeeEvent.EventType.EXTRA_HOURS, {'registration_type': 'EXTRA_HOURS'})
        self.assertNotIn('manager_hours_fix_deadline', serialize_duyet_don_event(online))
        self.assertNotIn('manager_hours_fix_deadline', serialize_duyet_don_event(extra))


class ShiftRegistrationDeadlineApiTests(TestCase):
    URL = '/api-hrm/shift-registrations/registration-deadline/'

    def setUp(self):
        user = User.objects.create_user(username='_regdl_emp', password='x')
        Employee.objects.create(user=user, employee_id='REGDL-1', full_name='NV Test')
        self.client = APIClient()
        self.client.force_authenticate(user)

    def test_returns_backend_deadline_for_week(self):
        res = self.client.get(self.URL, {'week_start_date': '2026-11-16'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['registration_deadline'], shift_registration_deadline(date(2026, 11, 16)).isoformat())

    def test_rejects_invalid_week(self):
        self.assertEqual(self.client.get(self.URL, {'week_start_date': '2026-11-17'}).status_code, 400)
        self.assertEqual(self.client.get(self.URL, {'week_start_date': 'x'}).status_code, 400)
        self.assertEqual(self.client.get(self.URL).status_code, 400)
