import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import WorkFinalization

URL = '/api-hrm/salary/department/'


class SalaryEmploymentFilterTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('ef-admin', 'a@example.com', 'x')
        dept = Department.objects.create(code='EF', name='Phòng EF')
        cls.working = cls._emp('NV00301', dept, None)
        cls.left = cls._emp('NV00302', dept, dt.date(2026, 9, 15))   # nghỉ giữa tháng, vẫn còn lương
        for emp, days in ((cls.working, 25), (cls.left, 11)):
            WorkFinalization.objects.create(
                employee=emp, year=2026, month=9, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
                cong_thuc_te=Decimal(days), tong_cong=Decimal(days), cong_chinh_thuc=Decimal(days),
                raw_state={'cong_includes_holiday': True})

    @classmethod
    def _emp(cls, code, dept, end):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=dept, contract_type='INDEFINITE', basic_salary=Decimal(10_000_000),
            start_date=dt.date(2025, 1, 1), end_date=end, is_active=True, employment_status='ACTIVE')

    def _get(self, **params):
        self.client.force_authenticate(self.admin)
        res = self.client.get(URL, {'year': 2026, 'month': 9, **params})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_default_returns_everyone_with_counts(self):
        data = self._get()
        self.assertEqual([r['ma_nv'] for r in data['results']], ['NV00301', 'NV00302'])
        self.assertEqual((data['employment_filter'], data['working_count'], data['left_count']), ('all', 1, 1))
        left_row = data['results'][1]
        self.assertEqual(data['left_payable_count'], 1)
        self.assertAlmostEqual(data['left_payable_amount'], left_row['con_phai_thanh_toan'], places=2)
        self.assertGreater(left_row['con_phai_thanh_toan'], 0)

    def test_filters(self):
        working = self._get(employment_filter='working')
        self.assertEqual(([r['ma_nv'] for r in working['results']], working['total']), (['NV00301'], 1))
        self.assertEqual(working['left_payable_count'], 1)  # vẫn báo để giao diện cảnh báo
        left = self._get(employment_filter='left')
        self.assertEqual([r['ma_nv'] for r in left['results']], ['NV00302'])
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(URL, {'year': 2026, 'month': 9, 'employment_filter': 'x'}).status_code, 400)
