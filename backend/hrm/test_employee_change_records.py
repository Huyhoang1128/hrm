"""Điều chỉnh nhân sự có ngày hiệu lực (hrm/employee_change_service.py)."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.assignment import AssignmentResolver
from employee.models import Department, Employee, EmployeeAssignmentHistory, Position
from hrm.employee_change_models import EmployeeChangeRecord
from hrm.employee_change_service import apply_due_changes
from salary.salary_data_models import EmployeeSalaryHistory, MonthlyPayrollSnapshot

URL = '/api-hrm/employee-changes/'


class EmployeeChangeRecordTests(APITestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.hr = User.objects.create_superuser('ec-admin', 'a@example.com', 'x')
        self.dept_a = Department.objects.create(code='EC-A', name='Phòng A')
        self.dept_b = Department.objects.create(code='EC-B', name='Phòng B')
        self.pos = Position.objects.create(code='EC-P', title='Chuyên viên', level=1)
        self.emp = Employee.objects.create(
            user=User.objects.create_user('nv00421', password='x'), employee_id='NV00421', full_name='NV NV00421',
            department=self.dept_a, position=self.pos, basic_salary=Decimal(10_000_000), allowance=Decimal(1_000_000),
            start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE')
        self.client.force_authenticate(self.hr)

    def _create(self, **data):
        return self.client.post(URL, {'employee': self.emp.id, **data}, format='json')

    def test_future_org_change_waits_then_applies_on_its_date(self):
        effective = self.today + dt.timedelta(days=10)
        res = self._create(change_type='ORG', effective_date=effective.isoformat(), department_id=self.dept_b.id,
                           note='Chuyển phòng theo quyết định 01')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['status'], 'SCHEDULED')
        self.assertEqual((res.data['old_department_name'], res.data['new_department_name']), ('Phòng A', 'Phòng B'))
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.department_id, self.dept_a.id)

        # Một điều chỉnh cùng loại đang chờ → không tạo thêm; sửa thẳng trên hồ sơ cũng bị chặn
        self.assertEqual(self._create(change_type='ORG', effective_date=effective.isoformat(),
                                      position_id=None).status_code, 400)
        res = self.client.patch(f'/api-hrm/employees/{self.emp.id}/', {'department_id': self.dept_b.id}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.client.patch(f'/api-hrm/employees/{self.emp.id}/', {'phone_number': '0900000010'},
                                           format='json').status_code, 200)
        current = self.client.get(f'{URL}current/', {'employee': self.emp.id}).data
        self.assertEqual(len(current['pending']), 1)

        self.assertEqual(apply_due_changes(today=effective - dt.timedelta(days=1)), 0)
        # Chạy muộn 3 ngày vẫn ghi lịch sử điều chuyển đúng ngày áp dụng
        self.assertEqual(apply_due_changes(today=effective + dt.timedelta(days=3)), 1)
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.department_id, self.dept_b.id)
        history = EmployeeAssignmentHistory.objects.get(employee=self.emp)
        self.assertEqual((history.changed_from, history.department_id), (effective, self.dept_a.id))
        self.assertEqual(history.note, 'Chuyển phòng theo quyết định 01')
        resolver = AssignmentResolver()
        self.assertEqual(resolver.employee_on(self.emp, effective - dt.timedelta(days=1)).department_id, self.dept_a.id)
        self.assertEqual(resolver.employee_on(self.emp, effective).department_id, self.dept_b.id)
        self.assertEqual(EmployeeChangeRecord.objects.get().status, 'APPLIED')

    def test_today_change_applies_immediately_and_validations(self):
        res = self._create(change_type='ORG', effective_date=self.today.isoformat(), department_id=self.dept_b.id)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['status'], 'APPLIED')
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.department_id, self.dept_b.id)
        # Trùng hiện tại
        self.assertEqual(self._create(change_type='ORG', effective_date=(self.today + dt.timedelta(days=5)).isoformat(),
                                      department_id=self.dept_b.id).status_code, 400)
        # Lùi ngày về trước lần điều chuyển gần nhất
        res = self._create(change_type='ORG', effective_date=(self.today - dt.timedelta(days=3)).isoformat(),
                           department_id=self.dept_a.id)
        self.assertEqual(res.status_code, 400)
        self.assertIn('lần điều chuyển gần nhất', res.data['detail'])

    def test_salary_change_writes_history_and_cancel_restores_it(self):
        old = EmployeeSalaryHistory.objects.create(employee=self.emp, basic_salary=Decimal(10_000_000),
                                                   allowance=Decimal(1_000_000), effective_from=dt.date(2025, 1, 1))
        effective = (self.today.replace(day=1) + dt.timedelta(days=40)).replace(day=1)
        res = self._create(change_type='SALARY', effective_date=effective.isoformat(), basic_salary=12_000_000,
                           allowance=1_000_000)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Decimal(res.data['new_basic_salary']), Decimal(12_000_000))
        self.assertIsNone(res.data['new_allowance'])   # phụ cấp không đổi
        old.refresh_from_db()
        self.assertEqual(old.effective_to, effective - dt.timedelta(days=1))
        self.assertEqual(EmployeeSalaryHistory.get_for_date(self.emp, effective).basic_salary, Decimal(12_000_000))
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.basic_salary, Decimal(10_000_000))   # hồ sơ đổi vào ngày áp dụng

        record_id = res.data['id']
        res = self.client.post(f'{URL}{record_id}/cancel/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'CANCELLED')
        old.refresh_from_db()
        self.assertIsNone(old.effective_to)
        self.assertEqual(EmployeeSalaryHistory.objects.filter(employee=self.emp).count(), 1)
        self.assertEqual(self.client.post(f'{URL}{record_id}/cancel/').status_code, 400)

    def test_finalized_payroll_month_rejected(self):
        effective = self.today + dt.timedelta(days=40)
        MonthlyPayrollSnapshot.objects.create(employee=self.emp, year=effective.year, month=effective.month,
                                              employee_code='NV00421', ho_va_ten='NV NV00421')
        res = self._create(change_type='SALARY', effective_date=effective.isoformat(), basic_salary=12_000_000)
        self.assertEqual(res.status_code, 400)
        self.assertIn('đã chốt lương', res.data['detail'])
        self.assertFalse(EmployeeChangeRecord.objects.exists())

    def test_hr_or_admin_only(self):
        self.client.force_authenticate(self.emp.user)
        self.assertEqual(self.client.get(URL).status_code, 403)
