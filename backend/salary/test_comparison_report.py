import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import WorkFinalization
from salary.comparison_report import parse_period

URL = '/api/v1/salary/records/comparison-report/'


class SalaryComparisonReportTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('cmp-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='CMP', name='Phòng So Sánh')
        cls.stay = cls._emp('NV00201', dt.date(2025, 1, 1), 20_000_000, insurance=10_000_000)
        cls.new = cls._emp('NV00202', dt.date(2026, 9, 1), 12_000_000)          # vào làm tháng 9
        cls.left = cls._emp('NV00203', dt.date(2025, 1, 1), 9_000_000, end=dt.date(2026, 8, 31))  # nghỉ cuối tháng 8
        cls._wf(cls.stay, 8, 20)
        cls._wf(cls.stay, 9, 25)
        cls._wf(cls.new, 9, 25)
        cls._wf(cls.left, 8, 25)

    @classmethod
    def _emp(cls, code, start, salary, insurance=0, end=None):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type='INDEFINITE', basic_salary=Decimal(salary), start_date=start,
            end_date=end, social_insurance_contribution_level=insurance, is_active=True, employment_status='ACTIVE')

    @classmethod
    def _wf(cls, emp, month, days):
        WorkFinalization.objects.create(
            employee=emp, year=2026, month=month, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
            cong_thuc_te=Decimal(days), tong_cong=Decimal(days), cong_chinh_thuc=Decimal(days),
            raw_state={'cong_includes_holiday': True})

    def _report(self, **params):
        self.client.force_authenticate(self.admin)
        res = self.client.get(URL, {'month_a': '2026-08', 'month_b': '2026-09', **params})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_rows_diff_and_presence(self):
        data = self._report()
        rows = {r['employee_code']: r for r in data['rows']}
        self.assertEqual(sorted(rows), ['NV00201', 'NV00202', 'NV00203'])
        self.assertEqual((data['month_a']['label'], data['month_b']['label']), ('08/2026', '09/2026'))

        stay = rows['NV00201']
        self.assertTrue(stay['in_month_a'] and stay['in_month_b'])
        for key in ('tong_thu_nhap', 'luong_thuc_linh', 'con_phai_thanh_toan'):
            self.assertAlmostEqual(stay['diff'][key], stay['month_b'][key] - stay['month_a'][key], places=2)
        self.assertGreater(stay['diff']['tong_thu_nhap'], 0)  # 20 → 25 công
        self.assertAlmostEqual(stay['diff_percent']['luong_thuc_linh'],
                               stay['diff']['luong_thuc_linh'] / stay['month_a']['luong_thuc_linh'] * 100, places=4)

        self.assertEqual((rows['NV00202']['in_month_a'], rows['NV00202']['month_a']), (False, None))
        self.assertIsNone(rows['NV00202']['diff_percent']['luong_thuc_linh'])
        self.assertEqual((rows['NV00203']['in_month_b'], rows['NV00203']['month_b']), (False, None))

        totals = data['totals']
        self.assertEqual(totals['employee_count'], 3)
        self.assertAlmostEqual(totals['diff']['luong_thuc_linh'],
                               sum(r['diff']['luong_thuc_linh'] for r in data['rows']), places=2)

    def test_gross_income_matches_salary_row_income_parts(self):
        from hrm.finalization_views import get_salary_rows
        row = next(r for r in get_salary_rows(2026, 9)['results'] if r['ma_nv'] == 'NV00201')
        report_row = next(r for r in self._report()['rows'] if r['employee_code'] == 'NV00201')
        income = row['luong_ngay_cong'] + row['phu_cap'] + row['luong_doanh_so'] + row['thu_nhap_khac']
        self.assertAlmostEqual(report_row['month_b']['tong_thu_nhap'], income, places=2)
        self.assertGreater(row['bh_deduction'], 0)  # có BH nên tổng thu nhập ≠ thực lĩnh

    def test_filters_validation_and_permission(self):
        self.assertEqual([r['employee_code'] for r in self._report(employee='NV00202')['rows']], ['NV00202'])
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(URL, {'month_a': '2026-13', 'month_b': '2026-09'}).status_code, 400)
        self.assertEqual(self.client.get(URL, {'month_a': '2026-08', 'month_b': '2026-09',
                                               'department': 'abc'}).status_code, 400)
        self.client.force_authenticate(self.stay.user)
        self.assertEqual(self.client.get(URL, {'month_a': '2026-08', 'month_b': '2026-09'}).status_code, 403)

    def test_parse_period(self):
        self.assertEqual(parse_period('2026-09'), (2026, 9))
        self.assertEqual(parse_period('09/2026'), (2026, 9))
        self.assertIsNone(parse_period('2026'))
        self.assertIsNone(parse_period('1999-01'))
