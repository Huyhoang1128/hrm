from unittest import mock

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.main_api import EmployeeState


@mock.patch.object(EmployeeState, 'replay_month', return_value={'calendar': []})
class DeptViolationReportTests(APITestCase):
    url = '/api-hrm/dept-attendance-violation-report/'

    def setUp(self):
        self.dept_a = Department.objects.create(code='VR-A', name='Phòng A')
        self.dept_b = Department.objects.create(code='VR-B', name='Phòng B')
        self.manager = self._emp('NV96001', self.dept_a)
        self.report_b = self._emp('NV96002', self.dept_b, manager=self.manager)
        self.peer_a = self._emp('NV96003', self.dept_a)
        self.hr = self._emp('NV96004', self.dept_b, is_hr=True)

    def _emp(self, code, dept, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=code,
            department=dept, is_active=True, **kw)

    def _codes(self, user, **params):
        self.client.force_authenticate(user)
        res = self.client.get(self.url, {'year': 2026, 'month': 9, **params})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data, {row['ma_nhan_vien'] for row in res.data['data']}

    def test_hr_gets_all_departments_without_department_id(self, _replay):
        data, codes = self._codes(self.hr.user)
        self.assertEqual(codes, {'NV96001', 'NV96002', 'NV96003', 'NV96004'})
        self.assertEqual((data['department_id'], data['department_name']), (None, 'Tất cả phòng ban'))
        _, codes = self._codes(self.hr.user, department_id='all')
        self.assertEqual(len(codes), 4)
        data, codes = self._codes(self.hr.user, department_id=self.dept_a.id)
        self.assertEqual((codes, data['department_name']), ({'NV96001', 'NV96003'}, 'Phòng A'))

    def test_manager_sees_only_self_and_direct_reports(self, _replay):
        _, codes = self._codes(self.manager.user)
        self.assertEqual(codes, {'NV96001', 'NV96002'})
        _, codes = self._codes(self.manager.user, department_id=self.dept_a.id)
        self.assertEqual(codes, {'NV96001'})

    def test_regular_employee_is_forbidden(self, _replay):
        self.client.force_authenticate(self.peer_a.user)
        res = self.client.get(self.url, {'year': 2026, 'month': 9, 'department_id': self.dept_a.id})
        self.assertEqual(res.status_code, 403)
