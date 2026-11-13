"""Phụ cấp cố định không bị cộng 2 lần.

Trang Cấu hình lương lưu Employee.allowance = đi lại + điện thoại + nhà ở + độc hại (+ ăn trưa cố định),
đồng thời lưu từng khoản trong payroll_config. Dòng lương trước đây cộng cả 2 -> phụ cấp gấp đôi."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import WorkFinalization

YEAR, MONTH = 2026, 9
ROWS_URL = '/api-hrm/salary/department/'


def _config(transport=0, phone=0, housing=0, hazardous=0, lunch_mode='fixed', lunch=0):
    return {'payroll_config': {
        'allowances': {'transport': transport, 'phone': phone, 'housing': housing, 'hazardous': hazardous,
                       'lunch': lunch if lunch_mode == 'fixed' else 0},
        'lunchAllowancePolicy': {'mode': lunch_mode, 'fixed_amount': lunch, 'monthly_cap': 500000},
    }}


class SalaryAllowanceDoubleCountTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('dc-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='DC', name='Phòng DC')
        # Đúng như trang Cấu hình lương lưu: allowance = 300k + 200k + ăn trưa cố định 400k
        cls._emp('DC001', allowance=900_000, adjustments=_config(transport=300_000, phone=200_000, lunch=400_000))
        # Chưa cấu hình lương: phụ cấp trên hồ sơ cộng nguyên như trước
        cls._emp('DC002', allowance=1_000_000, adjustments={})
        # Có cấu hình 500k + ăn trưa 400k, hồ sơ 1.200k -> 300k nhập tay ngoài cấu hình vẫn được cộng
        cls._emp('DC003', allowance=1_200_000, adjustments=_config(transport=300_000, phone=200_000, lunch=400_000))
        # Ăn trưa theo ngày công: trang cấu hình KHÔNG gộp ăn trưa vào allowance
        cls._emp('DC004', allowance=500_000,
                 adjustments=_config(transport=300_000, phone=200_000, lunch_mode='actual_working_day'))

    @classmethod
    def _emp(cls, code, allowance, adjustments):
        emp = Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type='INDEFINITE', basic_salary=Decimal(10_000_000),
            allowance=Decimal(allowance), start_date=dt.date(2025, 1, 1), is_active=True,
            employment_status='ACTIVE', salary_adjustments=adjustments)
        WorkFinalization.objects.create(
            employee=emp, year=YEAR, month=MONTH, employee_code=code, ho_va_ten=emp.full_name,
            raw_state={'cong_includes_holiday': True}, cong_thuc_te=Decimal(25), tong_cong=Decimal(25),
            cong_chinh_thuc=Decimal(25))
        return emp

    def setUp(self):
        self.client.force_authenticate(self.admin)

    def _rows(self):
        res = self.client.get(ROWS_URL, {'year': YEAR, 'month': MONTH})
        self.assertEqual(res.status_code, 200, res.data)
        return {r['ma_nv']: r for r in res.data['results']}

    def test_configured_allowances_counted_once(self):
        rows = self._rows()
        self.assertEqual(rows['DC001']['phu_cap'], 900_000)
        self.assertEqual(rows['DC001']['phu_cap_an_trua'], 400_000)

    def test_without_config_profile_allowance_kept(self):
        self.assertEqual(self._rows()['DC002']['phu_cap'], 1_000_000)

    def test_manual_allowance_beyond_config_still_counted(self):
        self.assertEqual(self._rows()['DC003']['phu_cap'], 1_200_000)

    def test_per_day_lunch_not_subtracted_from_profile(self):
        row = self._rows()['DC004']
        # 500k cấu hình (đã có trong allowance) + ăn trưa theo ngày công (tính riêng, tối đa 500k)
        self.assertEqual(row['phu_cap'], 500_000 + row['phu_cap_an_trua'])
        self.assertGreater(row['phu_cap_an_trua'], 0)
