"""API ca làm theo phòng ban / gán ca: trước đây lọc theo ShiftConfig.apply_to_all (field đã bỏ) nên
luôn lỗi 500. "Ca chung công ty" nay là ca mặc định (is_default) — đúng như engine chọn ca."""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Department, Employee
from hrm.models import ShiftConfig


class ShiftScopeViewsTests(TestCase):
    def setUp(self):
        admin = User.objects.create_superuser('_shiftscope_admin', 'a@example.com', 'x')
        self.client = APIClient()
        self.client.force_authenticate(admin)
        self.dept = Department.objects.create(code='SSV', name='Phòng SSV')
        self.other_dept = Department.objects.create(code='SSV2', name='Phòng SSV2')
        self.employee = Employee.objects.create(
            user=User.objects.create_user('_shiftscope_emp', password='x'), employee_id='SSV-1',
            full_name='NV SSV', gender='F', is_active=True, department=self.dept,
        )
        since = datetime.date(2024, 1, 1)
        self.dept_shift = ShiftConfig.objects.create(
            name='Ca phòng', code='SSV-DEPT', start_time=datetime.time(8, 0), end_time=datetime.time(17, 0),
            effective_from=since,
        )
        self.dept_shift.apply_to_departments.add(self.dept)
        self.default_shift = ShiftConfig.objects.create(
            name='Ca mặc định', code='SSV-DEFAULT', start_time=datetime.time(8, 30), end_time=datetime.time(17, 30),
            effective_from=since, is_default=True,
        )
        self.other_shift = ShiftConfig.objects.create(
            name='Ca phòng khác', code='SSV-OTHER', start_time=datetime.time(9, 0), end_time=datetime.time(18, 0),
            effective_from=since,
        )
        self.other_shift.apply_to_departments.add(self.other_dept)

    def test_shifts_for_department(self):
        res = self.client.get(f'/api/v1/hrm/attendance/shifts/department/{self.dept.id}/')
        self.assertEqual(res.status_code, 200, res.content)
        codes = {s['code'] for s in res.json()['data']['shifts']}
        self.assertEqual(codes, {'SSV-DEPT', 'SSV-DEFAULT'})

    def test_shift_assignment_list_by_employee_and_department(self):
        res = self.client.get('/api/v1/hrm/attendance/shift-assignment/', {'employee_id': self.employee.id})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual({s['code'] for s in res.json()['data']}, {'SSV-DEPT', 'SSV-DEFAULT'})
        res = self.client.get('/api/v1/hrm/attendance/shift-assignment/', {'department_id': self.other_dept.id})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual({s['code'] for s in res.json()['data']}, {'SSV-OTHER', 'SSV-DEFAULT'})
