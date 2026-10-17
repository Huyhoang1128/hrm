"""Phạt thiếu công (salary.MissingWorkdayPenalty): NV trong danh sách không đi đủ
công chuẩn thì bảng lương trừ mốc lương / công chuẩn × số công thiếu."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.finalization_views import get_salary_rows
from hrm.models import WorkFinalization
from salary.comparison_report import row_metrics
from salary.missing_workday_penalty import active_penalty_bases, compute_missing_workday_penalty
from salary.salary_data_models import MissingWorkdayPenalty

URL = '/api/v1/salary/missing-workday-penalties/'
YEAR, MONTH = 2026, 9   # công chuẩn bảng lương = 30 − 4 Chủ nhật − 1 = 25


class MissingWorkdayPenaltyTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('mw-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='MW', name='Phòng MW')
        cls.manager = cls._emp('NV00471', 0)            # quản lý không có lương cứng
        cls.full = cls._emp('NV00472', 0)               # đi đủ công
        cls.hr = cls._emp('NV00473', 8_000_000, is_hr=True)
        for emp, cong in [(cls.manager, 23), (cls.full, 25)]:
            WorkFinalization.objects.create(
                employee=emp, year=YEAR, month=MONTH, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
                raw_state={'cong_includes_holiday': True}, cong_thuc_te=Decimal(cong), tong_cong=Decimal(cong),
                cong_chinh_thuc=Decimal(cong))

    @classmethod
    def _emp(cls, code, salary, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type='INDEFINITE', basic_salary=Decimal(salary),
            start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE', **kw)

    def _row(self, emp):
        rows = get_salary_rows(YEAR, MONTH)['results']
        return next(r for r in rows if r['ma_nv'] == emp.employee_id)

    def test_formula(self):
        self.assertEqual(compute_missing_workday_penalty(Decimal('10000000'), 26, 24),
                         (Decimal('2'), Decimal('769231')))
        self.assertEqual(compute_missing_workday_penalty(Decimal('10000000'), 25, 25.5), (Decimal('0'), Decimal('0')))
        self.assertEqual(compute_missing_workday_penalty(Decimal('10000000'), 0, 3), (Decimal('0'), Decimal('0')))

    def test_payroll_deducts_only_listed_employees(self):
        before = self._row(self.manager)
        self.assertEqual(before['phat_thieu_cong'], 0)

        MissingWorkdayPenalty.objects.create(employee=self.manager, from_month=dt.date(2026, 9, 15))
        MissingWorkdayPenalty.objects.create(employee=self.full, from_month=dt.date(2026, 1, 1))
        after = self._row(self.manager)
        self.assertEqual(after['cong_thieu'], 2)
        self.assertEqual(after['phat_thieu_cong'], 800000)   # 10.000.000 / 25 × 2
        self.assertAlmostEqual(after['luong_thuc_linh'], before['luong_thuc_linh'] - 800000, places=2)
        # Báo cáo so sánh vẫn cộng lại đúng tổng thu nhập
        self.assertEqual(row_metrics(after)['tong_thu_nhap'], row_metrics(before)['tong_thu_nhap'])
        # Đi đủ công → không phạt
        self.assertEqual(self._row(self.full)['phat_thieu_cong'], 0)

    def test_month_range(self):
        MissingWorkdayPenalty.objects.create(employee=self.manager, from_month=dt.date(2026, 6, 1),
                                             to_month=dt.date(2026, 8, 20), base_amount=5_000_000)
        row = MissingWorkdayPenalty.objects.get()
        self.assertEqual((row.from_month, row.to_month), (dt.date(2026, 6, 1), dt.date(2026, 8, 1)))
        ids = [self.manager.id]
        self.assertEqual(active_penalty_bases(ids, 2026, 8), {self.manager.id: Decimal('5000000')})
        self.assertEqual(active_penalty_bases(ids, 2026, 9), {})
        self.assertEqual(active_penalty_bases(ids, 2026, 5), {})

    def test_api_admin_only_and_validation(self):
        self.client.force_authenticate(self.hr.user)
        self.assertEqual(self.client.get(URL).status_code, 403)

        self.client.force_authenticate(self.admin)
        res = self.client.post(URL, {'employee': self.manager.id, 'from_month': '2026-09-01'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Decimal(res.data['base_amount']), Decimal('10000000'))
        self.assertFalse(res.data['has_basic_salary'])
        # Trùng khoảng tháng
        self.assertEqual(self.client.post(URL, {'employee': self.manager.id, 'from_month': '2027-01-01'},
                                          format='json').status_code, 400)
        # Đến tháng < Từ tháng
        self.assertEqual(self.client.patch(f"{URL}{res.data['id']}/", {'to_month': '2026-08-01'},
                                           format='json').status_code, 400)
        # Mốc lương phải > 0
        self.assertEqual(self.client.post(URL, {'employee': self.full.id, 'from_month': '2026-09-01',
                                                'base_amount': 0}, format='json').status_code, 400)
        self.assertEqual(len(self.client.get(URL).data), 1)
