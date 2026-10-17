"""Chốt lương tháng (salary/payroll_finalization.py): bảng lương đọc bản đã chốt, dữ liệu
lương của tháng bị khoá (423), phát hiện dữ liệu đổi sau khi chốt, chặn gửi phiếu lương."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import WorkFinalization
from salary.payroll_finalization import FINALIZED_ROW_FLAG
from salary.salary_data_models import (
    EmployeeMonthlySalaryInput, MonthlyPayrollSnapshot, OtherAllowance, SalesCommission,
)

YEAR, MONTH = 2026, 9
ROWS_URL = '/api-hrm/salary/department/'
FINALIZE_URL = '/api-hrm/salary/finalize/'
UNFINALIZE_URL = '/api-hrm/salary/unfinalize/'
STATE_URL = '/api-hrm/salary/finalize-state/'
COMMISSIONS_URL = '/api/v1/salary/commissions/'
SEND_URL = '/api/v1/salary/records/send-payslip-email/'


class PayrollFinalizationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('pf-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='PF', name='Phòng PF')
        cls.emp = cls._emp('NV00401', 20_000_000)
        cls.other = cls._emp('NV00402', 10_000_000)
        for emp in (cls.emp, cls.other):
            WorkFinalization.objects.create(
                employee=emp, year=YEAR, month=MONTH, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
                raw_state={'cong_includes_holiday': True}, cong_thuc_te=Decimal(25), tong_cong=Decimal(25),
                cong_chinh_thuc=Decimal(25))
        EmployeeMonthlySalaryInput.objects.create(employee=cls.emp, year=YEAR, month=MONTH, thuong=Decimal(500_000))

    @classmethod
    def _emp(cls, code, salary):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type='INDEFINITE', basic_salary=Decimal(salary),
            start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE',
            salary_adjustments={'payroll_config': {'deductions': {'unionFee': 50000}}})

    def setUp(self):
        self.client.force_authenticate(self.admin)

    def _rows(self, **params):
        res = self.client.get(ROWS_URL, {'year': YEAR, 'month': MONTH, **params})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data, {r['ma_nv']: r for r in res.data['results']}

    def _finalize(self):
        res = self.client.post(FINALIZE_URL, {'year': YEAR, 'month': MONTH}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_finalized_month_serves_snapshot_until_refinalized(self):
        data, rows = self._rows()
        self.assertFalse(data['is_finalized'])
        self.assertEqual(self._finalize()['created'], 2)
        self.assertEqual(MonthlyPayrollSnapshot.objects.filter(year=YEAR, month=MONTH).count(), 2)

        Employee.objects.filter(pk=self.emp.pk).update(basic_salary=Decimal(30_000_000))
        data, rows = self._rows()
        self.assertTrue(data['is_finalized'] and data['from_snapshot'])
        self.assertEqual(rows['NV00401']['luong_co_ban'], 20_000_000)
        self.assertTrue(rows['NV00401'][FINALIZED_ROW_FLAG])
        # Dữ liệu lương tháng nhập tay và cấu hình lương lúc chốt đi kèm dòng
        self.assertEqual(rows['NV00401']['thuong_input'], 500_000)
        self.assertEqual(rows['NV00401']['employee_snapshot']['salary_adjustments']['payroll_config']
                         ['deductions']['unionFee'], 50000)
        # Bản tính lại để đối chiếu
        data, live = self._rows(refresh=1)
        self.assertTrue(data['is_finalized'])
        self.assertFalse(data['from_snapshot'])
        self.assertEqual(live['NV00401']['luong_co_ban'], 30_000_000)

        state = self.client.get(STATE_URL, {'year': YEAR, 'month': MONTH}).data
        self.assertTrue(state['is_stale'])
        self.assertEqual(state['changed_count'], 1)
        self.assertEqual(state['changed'][0]['employee_code'], 'NV00401')
        self.assertIn('luong_co_ban', state['changed'][0]['fields'])

        result = self._finalize()
        self.assertEqual((result['created'], result['updated']), (0, 2))
        self.assertFalse(self.client.get(STATE_URL, {'year': YEAR, 'month': MONTH}).data['is_stale'])
        self.assertEqual(self._rows()[1]['NV00401']['luong_co_ban'], 30_000_000)

    def test_refinalize_drops_employees_no_longer_in_month(self):
        self._finalize()
        Employee.objects.filter(pk=self.other.pk).update(end_date=dt.date(2026, 8, 31))
        state = self.client.get(STATE_URL, {'year': YEAR, 'month': MONTH}).data
        self.assertEqual([c['reason'] for c in state['changed']], ['Không còn trong bảng lương tháng'])
        self.assertEqual(self._finalize()['removed'], 1)
        self.assertEqual(list(self._rows()[1]), ['NV00401'])

    def test_salary_data_of_finalized_month_is_locked(self):
        allowance = OtherAllowance.objects.create(employee=self.other, year=YEAR, month=MONTH, amount=Decimal(100))
        self._finalize()

        res = self.client.post(COMMISSIONS_URL, {'employee': self.emp.id, 'year': YEAR, 'month': MONTH,
                                                 'amount': '1000000'}, format='json')
        self.assertEqual(res.status_code, 423)
        self.assertEqual(res.data['code'], 'payroll_finalized')
        res = self.client.post(f'{COMMISSIONS_URL}bulk-import/', {
            'year': YEAR, 'month': MONTH, 'records': [{'employee_code': 'NV00401', 'commission_amount': 1000000}]},
            format='json')
        self.assertEqual(res.status_code, 423)
        self.assertEqual(self.client.patch(f'/api/v1/salary/other-allowances/{allowance.id}/', {'amount': '5'},
                                           format='json').status_code, 423)
        self.assertEqual(self.client.delete(f'/api/v1/salary/other-allowances/{allowance.id}/').status_code, 423)
        self.assertEqual(self.client.patch(f'/api/v1/salary/monthly-inputs/{EmployeeMonthlySalaryInput.objects.get().id}/',
                                           {'thuong': '1'}, format='json').status_code, 423)
        # Tháng khác vẫn ghi được
        self.assertEqual(self.client.post(COMMISSIONS_URL, {'employee': self.emp.id, 'year': YEAR, 'month': 10,
                                                            'amount': '1000000'}, format='json').status_code, 201)
        self.assertFalse(SalesCommission.objects.filter(year=YEAR, month=MONTH).exists())

        res = self.client.post(UNFINALIZE_URL, {'year': YEAR, 'month': MONTH}, format='json')
        self.assertEqual(res.data['removed'], 2)
        self.assertEqual(self.client.post(COMMISSIONS_URL, {'employee': self.emp.id, 'year': YEAR, 'month': MONTH,
                                                            'amount': '1000000'}, format='json').status_code, 201)
        self.assertFalse(self._rows()[0]['is_finalized'])

    def test_payslip_requires_finalized_and_unchanged_month(self):
        payload = {'email': 'nv@example.com', 'subject': 'Phiếu lương', 'body': 'Nội dung',
                   'employee_id': self.emp.id, 'year': YEAR, 'month': MONTH}
        res = self.client.post(SEND_URL, payload, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'SALARY_NOT_FINALIZED')

        self._finalize()
        self.assertEqual(self.client.post(SEND_URL, payload, format='json').status_code, 200)

        # Đổi lương người khác không chặn phiếu lương của người này
        Employee.objects.filter(pk=self.other.pk).update(basic_salary=Decimal(11_000_000))
        self.assertEqual(self.client.post(SEND_URL, payload, format='json').status_code, 200)
        Employee.objects.filter(pk=self.emp.pk).update(basic_salary=Decimal(21_000_000))
        res = self.client.post(SEND_URL, payload, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'SALARY_SNAPSHOT_STALE')

    def test_admin_only(self):
        staff = User.objects.create_user('pf-staff', password='x')
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.post(FINALIZE_URL, {'year': YEAR, 'month': MONTH}, format='json').status_code, 403)
        self.assertEqual(self.client.get(STATE_URL, {'year': YEAR, 'month': MONTH}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(FINALIZE_URL, {'year': YEAR, 'month': 13}, format='json').status_code, 400)
        self.assertEqual(self.client.post(UNFINALIZE_URL, {'year': YEAR, 'month': MONTH}, format='json').status_code, 400)
