"""Bảng lương tháng (GET /api-hrm/salary/department/ và get_salary_rows):
khoá lại kết quả tính cho vài hồ sơ tiêu biểu — chính thức, thử việc, vừa thử
việc vừa chính thức, chưa chốt công — để refactor không làm đổi số."""
import datetime as dt
import json
import os
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee, EmployeeDependent
from hrm.models import WorkFinalization
from salary.salary_data_models import (
    DisciplinaryPenalty, LunchAllowanceOverride, OtherAllowance, ParkingAllowanceOverride,
    SalaryAdvance, SalesCommission,
)

YEAR, MONTH = 2026, 9
URL = '/api-hrm/salary/department/'


class SalaryRowsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('sr-admin', 'a@example.com', 'x')
        cls.dept_a = Department.objects.create(code='SR-A', name='Phòng A')
        cls.dept_b = Department.objects.create(code='SR-B', name='Phòng B')
        start = dt.date(2025, 1, 1)
        cls.official = cls._emp(
            'NV00101', cls.dept_a, 'INDEFINITE', 20_000_000, start, insurance=10_000_000, legal='Pháp nhân 1',
            adjustments={'payroll_config': {'allowances': {'lunch': 300000}, 'taxPolicy': {'dependentCount': 1},
                                            'deductions': {'unionFee': 50000}}})
        cls.probation = cls._emp('NV00102', cls.dept_a, 'PROBATION', 10_000_000, dt.date(2026, 8, 20))
        cls.mixed = cls._emp('NV00103', cls.dept_b, 'ONE_YEAR', 15_000_000, dt.date(2026, 8, 10),
                             insurance=8_000_000, legal='Pháp nhân 2', other_income=500_000)
        cls.no_record = cls._emp('NV00104', cls.dept_b, 'INDEFINITE', 5_000_000, start)
        cls._emp('NV00105', cls.dept_b, 'INDEFINITE', 9_000_000, start, end=dt.date(2026, 7, 31))  # đã nghỉ

        cls._wf(cls.official, cong_thuc_te=24, tong_cong=26, cong_chinh_thuc=26, tang_ca=4, truc_toi=2,
                tong_phat=50000, live=3)
        cls._wf(cls.probation, cong_thuc_te=8, tong_cong=8, cong_thu_viec=8)
        cls._wf(cls.mixed, cong_thuc_te=25, tong_cong=26, cong_thu_viec=10, cong_chinh_thuc=16, lam_them_gio=2)

        for model, emp, amount in [(SalesCommission, cls.official, 1_000_000), (OtherAllowance, cls.probation, 300_000),
                                   (SalaryAdvance, cls.mixed, 500_000)]:
            model.objects.create(employee=emp, year=YEAR, month=MONTH, amount=Decimal(amount))
        DisciplinaryPenalty.objects.create(employee=cls.official, year=YEAR, month=MONTH, amount=Decimal(200_000),
                                           status='APPROVED')
        ParkingAllowanceOverride.objects.create(employee=cls.official, year=YEAR, month=MONTH, amount=100_000)
        LunchAllowanceOverride.objects.create(employee=cls.mixed, year=YEAR, month=MONTH, amount=0)
        EmployeeDependent.objects.create(employee=cls.mixed, full_name='Con 1', relationship='CHILD')

    @classmethod
    def _emp(cls, code, dept, contract, salary, start, insurance=0, legal=None, adjustments=None,
             other_income=0, end=None):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=dept, contract_type=contract, basic_salary=Decimal(salary), start_date=start, end_date=end,
            social_insurance_contribution_level=insurance, subsidiary_legal_entity=legal,
            salary_adjustments=adjustments or {}, other_fixed_monthly_income=Decimal(other_income),
            is_active=True, employment_status='ACTIVE')

    @classmethod
    def _wf(cls, emp, **values):
        WorkFinalization.objects.create(
            employee=emp, year=YEAR, month=MONTH, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
            raw_state={'cong_includes_holiday': True}, **{k: Decimal(v) if k != 'live' else v for k, v in values.items()})

    def _get(self, **params):
        self.client.force_authenticate(self.admin)
        res = self.client.get(URL, {'year': YEAR, 'month': MONTH, **params})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_golden_dump(self):
        """SALARY_GOLDEN_OUT=<file> thì ghi toàn bộ kết quả ra file để so trước/sau refactor."""
        out = os.environ.get('SALARY_GOLDEN_OUT')
        if not out:
            self.skipTest('chỉ dùng khi so sánh trước/sau refactor')
        self.client.force_authenticate(self.admin)
        data = {
            'all': self._get(),
            'dept_a': self._get(department_id=self.dept_a.id),
            'legal_2': self._get(legal_entity='Pháp nhân 2'),
            'code': self._get(employee_code='NV0010'),
            'empty': self._get(department_id=self.dept_b.id, employee_code='không-có'),
            'total_summary': self.client.get('/api/v1/salary/records/total-summary/',
                                             {'year': YEAR, 'month': MONTH}).data,
        }
        with open(out, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True, default=str)

    def test_rows_lock_current_results(self):
        rows = {r['ma_nv']: r for r in self._get()['results']}
        self.assertEqual(list(rows), ['NV00101', 'NV00102', 'NV00103', 'NV00104'])  # NV00105 đã nghỉ trước tháng
        self.assertEqual(len(rows['NV00101']), 52)
        self.assertEqual((rows['NV00101']['cong_thieu'], rows['NV00101']['phat_thieu_cong']), (0, 0))
        expected = {
            # 10,5% BH (1.050.000) + công đoàn theo cấu hình (50.000)
            'NV00101': ('PROGRESSIVE', 20_850_000, 20_850_000),
            'NV00102': ('FLAT_10_PROBATION', 3_020_000, 2_718_000),
            'NV00103': ('PROGRESSIVE', 13_860_000, 13_860_000),
            'NV00104': ('PROGRESSIVE', 0, 0),
        }
        for code, values in expected.items():
            row = rows[code]
            self.assertEqual((row['tax_method'], row['luong_thuc_linh'], row['con_phai_thanh_toan']), values, code)
        official, mixed = rows['NV00101'], rows['NV00103']
        self.assertEqual(
            (official['phu_cap'], official['phu_cap_an_trua'], official['phu_cap_gui_xe'], official['luong_doanh_so'],
             official['tong_phat'], official['tong_phat_bienban'], official['bh_deduction'], official['so_nguoi_phu_thuoc']),
            (400_000, 300_000, 100_000, 1_000_000, 50_000, 200_000, 1_050_000, 1))
        self.assertEqual(official['cong_doan'], 50_000)
        self.assertEqual((mixed['phu_cap_an_trua'], mixed['tam_ung'], mixed['thu_nhap_khac'], mixed['bh_deduction'],
                          mixed['so_nguoi_phu_thuoc']), (0, 500_000, 500_000, 840_000, 1))

    def test_filters_and_envelope(self):
        data = self._get(department_id=self.dept_a.id)
        self.assertEqual(([r['ma_nv'] for r in data['results']], data['department_name'], data['total']),
                         (['NV00101', 'NV00102'], 'Phòng A', 2))
        self.assertEqual([r['ma_nv'] for r in self._get(legal_entity=' Pháp nhân 2 ')['results']], ['NV00103'])
        empty = self._get(department_id=self.dept_b.id, employee_code='không-có')
        self.assertEqual((empty['total'], empty['department_name'], empty['department_id']), (0, None, self.dept_b.id))

    def test_get_salary_rows_matches_api_and_api_is_admin_only(self):
        from hrm.finalization_views import get_salary_rows
        rows = get_salary_rows(YEAR, MONTH, department_id=str(self.dept_a.id))
        api = self._get(department_id=self.dept_a.id)  # API có thể trả thêm khoá (vd số đếm theo bộ lọc)
        self.assertEqual(rows, {key: api[key] for key in rows})
        self.client.force_authenticate(self.official.user)
        self.assertEqual(self.client.get(URL, {'year': YEAR, 'month': MONTH}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(URL, {'year': 'x', 'month': MONTH}).status_code, 400)

    def test_total_summary_uses_same_rows(self):
        self.client.force_authenticate(self.admin)
        data = self.client.get('/api/v1/salary/records/total-summary/', {'year': YEAR, 'month': MONTH}).data
        self.assertEqual((data['employee_count'], data['total_luong_thuc_linh'], data['total_con_phai_thanh_toan'],
                          data['total_thue_tncn']), (4, 37_730_000, 37_428_000, 302_000))
