"""Phiếu lương — MỘT công thức "Lương thực lĩnh" / "Còn phải thanh toán" (salary/payslip.py) cho
mọi nơi: bảng lương (GET /api-hrm/salary/department/), chốt lương (bản chốt + đọc lại), tổng lương
(total-summary), báo cáo biến động, email phiếu lương. Kèm section quy định "payroll" và công chuẩn."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import WorkFinalization
from salary.payroll_rules import (
    EMPLOYEE_BHTN_RATE, EMPLOYEE_BHXH_RATE, EMPLOYEE_BHYT_RATE, FLAT_TAX_RATE, MAX_LUNCH_ALLOWANCE_CAP,
    OT_HOURS_PER_DAY, default_family_deductions, default_tax_brackets, resolve_tax_policy,
)
from salary.payslip import PAYSLIP_KEY, apply_payslip_totals
from salary.salary_data_models import (
    EmployeeMonthlySalaryInput, MonthlyPayrollSnapshot, OvertimeRateConfig, SalaryAdvance, TaxBracket,
    TaxBracketConfig,
)

YEAR, MONTH = 2026, 9
ROWS_URL = '/api-hrm/salary/department/'


class ApplyPayslipTotalsTests(SimpleTestCase):
    @staticmethod
    def _row(**values):
        row = {
            'luong_ngay_cong': 10_000_000.4, 'luong_doanh_so': 1_000_000, 'luong_tang_ca': 500_000, 'truc_toi': 0,
            'thu_nhap_khac': 200_000, 'phu_cap': 900_000, 'phu_cap_gui_xe': 100_000, 'phu_cap_an_trua': 300_000,
            'phu_cap_trach_nhiem': 200_000, 'phu_cap_livestream': 0, 'phu_cap_khac': 50_000,
            'muc_luong_dong_bh': 5_000_000, 'bh_deduction': 525_000, 'cong_doan': 50_000, 'tong_phat': 100_000,
            'tong_phat_bienban': 0, 'phat_thieu_cong': 0, 'tam_ung': 1_000_000, 'thue_tncn': 12_345.6,
        }
        row.update(values)
        return row

    def test_formula_and_lines_add_up(self):
        row = apply_payslip_totals(self._row())
        p = row[PAYSLIP_KEY]
        # III: lương ngày công (làm tròn) + doanh số + OT + thu nhập khác
        self.assertEqual(p['tong_luong_iii'], 11_700_000)
        # IV: phần còn lại của tổng phụ cấp vào "phụ cấp khác" (900k − 100k − 300k − 200k = 300k > 50k)
        self.assertEqual((p['phu_cap_khac'], p['tong_phu_cap_iv']), (300_000, 900_000))
        self.assertEqual(p['tong_thu_nhap_vi'], 12_600_000)
        # BH theo mức đóng × tỷ lệ backend
        self.assertEqual((p['bhxh'], p['bhyt'], p['bhtn']), (400_000, 75_000, 50_000))
        self.assertEqual(p['tong_giam_tru_vii'], 525_000 + 50_000 + 100_000)
        # IX = VI − VII + VIII; tạm ứng KHÔNG trừ trong thực lĩnh
        self.assertEqual(row['luong_thuc_linh'], 11_925_000)
        # XII = IX − tạm ứng − thuế (thuế làm tròn tới đồng)
        self.assertEqual(row['con_phai_thanh_toan'], 11_925_000 - 1_000_000 - 12_346)
        self.assertEqual((p['luong_thuc_linh'], p['con_phai_thanh_toan']),
                         (row['luong_thuc_linh'], row['con_phai_thanh_toan']))
        # Các dòng cộng đúng bằng tổng
        self.assertEqual(sum(p[k] for k in ('luong_ngay_cong', 'luong_doanh_so', 'luong_ot', 'ban_san_pham', 'phu_mo',
                                            'truc_ca', 'thu_nhap_khac')), p['tong_luong_iii'])
        # Tính lại trên chính dòng đó ra đúng số cũ
        self.assertEqual(apply_payslip_totals(dict(row))[PAYSLIP_KEY], p)

    def test_monthly_inputs_override_engine_values_even_zero(self):
        row = apply_payslip_totals(self._row(
            luong_doanh_so_input=2_000_000, luong_ot_input=0, ban_san_pham_input=300_000, phu_mo_input=150_000,
            truc_ca_input=250_000, thuong_input=400_000, thuong=400_000))
        p = row[PAYSLIP_KEY]
        self.assertEqual((p['luong_doanh_so'], p['luong_ot'], p['ban_san_pham'], p['phu_mo'], p['truc_ca'],
                          p['thuong']), (2_000_000, 0, 300_000, 150_000, 250_000, 400_000))
        self.assertEqual(p['tong_luong_iii'], 10_000_000 + 2_000_000 + 0 + 300_000 + 150_000 + 250_000 + 200_000)
        self.assertEqual(p['tong_thu_nhap_vi'], p['tong_luong_iii'] + 900_000 + 400_000)

    def test_insurance_split_without_base_and_probation_zero(self):
        p = apply_payslip_totals(self._row(muc_luong_dong_bh=0, bh_deduction=1_050_000))[PAYSLIP_KEY]
        self.assertEqual((p['bhxh'], p['bhyt'], p['bhtn'], p['tong_bh']), (800_000, 150_000, 100_000, 1_050_000))
        p = apply_payslip_totals(self._row(muc_luong_dong_bh=0, bh_deduction=0))[PAYSLIP_KEY]
        self.assertEqual(p['tong_bh'], 0)

    def test_legacy_snapshot_row_derives_responsibility_from_saved_config(self):
        row = self._row(phu_cap_trach_nhiem=None, tong_cong=20, cong_chuan=25, employee_snapshot={
            'salary_adjustments': {'payroll_config': {'responsibilityAllowancePolicy': {
                'mode': 'actual_working_day', 'monthly_max': 250_000}}}})
        row.pop('phu_cap_trach_nhiem')
        p = apply_payslip_totals(row)[PAYSLIP_KEY]
        self.assertEqual((p['phu_cap_trach_nhiem'], p['phu_cap_khac'], p['tong_phu_cap_iv']), (200_000, 300_000, 900_000))


class PayslipPathsAgreeTests(APITestCase):
    """Bảng lương, chốt lương, tổng lương, báo cáo biến động, email: cùng 1 số."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('ps-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='PS', name='Phòng PS')
        cls.official = cls._emp('NV00501', 'INDEFINITE', 25_000_000, dt.date(2025, 1, 1), insurance=10_000_000)
        cls.mixed = cls._emp('NV00502', 'ONE_YEAR', 10_000_000, dt.date(2026, 8, 25))
        cls._wf(cls.official, cong_thuc_te=25, tong_cong=25, cong_chinh_thuc=25, tang_ca=10)
        cls._wf(cls.mixed, cong_thuc_te=25, tong_cong=25, cong_thu_viec=15, cong_chinh_thuc=10)
        ot = OvertimeRateConfig.objects.create(apply_to_all=True, calc_method='FIXED', rate_per_hour=Decimal(50_000),
                                               effective_from=dt.date(2026, 1, 1))
        assert ot.pk
        EmployeeMonthlySalaryInput.objects.create(employee=cls.official, year=YEAR, month=MONTH,
                                                  ban_san_pham=Decimal(300_000), thuong=Decimal(200_000))
        SalaryAdvance.objects.create(employee=cls.official, year=YEAR, month=MONTH, amount=Decimal(1_000_000))

    @classmethod
    def _emp(cls, code, contract, salary, start, insurance=0):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type=contract, basic_salary=Decimal(salary), start_date=start,
            social_insurance_contribution_level=insurance, is_active=True, employment_status='ACTIVE',
            salary_adjustments={'payroll_config': {'deductions': {'unionFee': 50000}}} if insurance else {})

    @classmethod
    def _wf(cls, emp, **values):
        WorkFinalization.objects.create(
            employee=emp, year=YEAR, month=MONTH, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
            raw_state={'cong_includes_holiday': True}, **{k: Decimal(v) for k, v in values.items()})

    def setUp(self):
        self.client.force_authenticate(self.admin)

    def _rows(self, **params):
        res = self.client.get(ROWS_URL, {'year': YEAR, 'month': MONTH, **params})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data, {r['ma_nv']: r for r in res.data['results']}

    def _totals(self):
        res = self.client.get('/api/v1/salary/records/total-summary/', {'year': YEAR, 'month': MONTH})
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_department_rows_use_payslip_formula(self):
        _, rows = self._rows()
        official, mixed = rows['NV00501'], rows['NV00502']
        p = official[PAYSLIP_KEY]
        # Lương OT (10h × 50.000), bán sản phẩm + thưởng nhập tay đều vào thu nhập
        self.assertEqual((p['luong_ngay_cong'], p['luong_ot'], p['ban_san_pham'], p['thuong']),
                         (25_000_000, 500_000, 300_000, 200_000))
        self.assertEqual((official['ban_san_pham_input'], official['thuong_input']), (300_000, 200_000))
        # Thuế không đổi: 5% × (25tr + 0,5tr OT − 1,05tr BH − 15,5tr giảm trừ)
        self.assertEqual(official['thue_tncn'], 447_500)
        self.assertEqual(official['luong_thuc_linh'], 26_000_000 - 1_100_000)  # VI − (BH + công đoàn)
        self.assertEqual(official['con_phai_thanh_toan'], 24_900_000 - 1_000_000 - 447_500)
        # Thuế từng bậc do backend tính, cộng đúng bằng thuế
        self.assertIsNone(official['thue_suat_co_dinh'])
        self.assertAlmostEqual(sum(b['thue'] for b in official['bac_thue_tncn']), official['thue_tncn'], places=2)
        # Có cả công TV + CT, CT < 14 ngày, không đóng BH → thuế cố định
        self.assertEqual((mixed['tax_method'], mixed['thue_suat_co_dinh'], mixed['bac_thue_tncn']),
                         ('FLAT_10_MIXED_LT14', float(FLAT_TAX_RATE), []))
        self.assertEqual((mixed['luong_thuc_linh'], mixed['thue_tncn'], mixed['con_phai_thanh_toan']),
                         (9_100_000, 910_000, 8_190_000))

    def test_total_summary_comparison_and_email_match_rows(self):
        from salary.comparison_report import build_comparison
        from salary.views import _build_default_payslip_body

        _, rows = self._rows()
        totals = self._totals()
        self.assertEqual(totals['total_luong_thuc_linh'], sum(r['luong_thuc_linh'] for r in rows.values()))
        self.assertEqual(totals['total_con_phai_thanh_toan'], sum(r['con_phai_thanh_toan'] for r in rows.values()))

        report = {r['employee_code']: r for r in build_comparison((2026, 8), (YEAR, MONTH))['rows']}
        official = rows['NV00501']
        self.assertEqual(report['NV00501']['month_b'], {
            'tong_thu_nhap': official[PAYSLIP_KEY]['tong_thu_nhap_vi'],
            'luong_thuc_linh': official['luong_thuc_linh'],
            'con_phai_thanh_toan': official['con_phai_thanh_toan'],
        })

        body = _build_default_payslip_body(official, YEAR, MONTH)
        self.assertIn('LƯƠNG THỰC LĨNH    : 24.900.000 đ', body)
        self.assertIn('CÒN PHẢI TT        : 23.452.500 đ', body)
        self.assertIn('BHXH               : -800.000 đ', body)
        self.assertIn('Lương OT           : 500.000 đ', body)

    def test_snapshot_stores_and_serves_the_same_numbers(self):
        _, live = self._rows()
        res = self.client.post('/api-hrm/salary/finalize/', {'year': YEAR, 'month': MONTH}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        snap = MonthlyPayrollSnapshot.objects.get(employee=self.official, year=YEAR, month=MONTH)
        self.assertEqual((float(snap.luong_thuc_linh), float(snap.con_phai_thanh_toan)),
                         (live['NV00501']['luong_thuc_linh'], live['NV00501']['con_phai_thanh_toan']))
        data, served = self._rows()
        self.assertTrue(data['from_snapshot'])
        for code in live:
            self.assertEqual(served[code][PAYSLIP_KEY], live[code][PAYSLIP_KEY], code)
        self.assertEqual(self._totals()['total_con_phai_thanh_toan'],
                         sum(r['con_phai_thanh_toan'] for r in live.values()))

    def test_legacy_snapshot_rows_are_recomputed_on_read_and_not_stale(self):
        """Bản chốt từ trước khi thống nhất công thức (thực lĩnh cũ, chưa có phiếu lương / chi tiết
        thuế / phụ cấp trách nhiệm): đọc lại ra đúng số phiếu lương, không bị coi là đã đổi."""
        _, live = self._rows()
        self.client.post('/api-hrm/salary/finalize/', {'year': YEAR, 'month': MONTH}, format='json')
        for snap in MonthlyPayrollSnapshot.objects.filter(year=YEAR, month=MONTH):
            row = dict(snap.row)
            for key in (PAYSLIP_KEY, 'phu_cap_trach_nhiem', 'bac_thue_tncn', 'thue_suat_co_dinh', 'cach_tinh_phu_cap'):
                row.pop(key, None)
            row['luong_thuc_linh'] = row['con_phai_thanh_toan'] = 123  # số theo công thức cũ
            snap.row = row
            snap.save(update_fields=['row'])
        _, served = self._rows()
        official = served['NV00501']
        self.assertEqual((official['luong_thuc_linh'], official['con_phai_thanh_toan']),
                         (live['NV00501']['luong_thuc_linh'], live['NV00501']['con_phai_thanh_toan']))
        self.assertEqual(official['bac_thue_tncn'], live['NV00501']['bac_thue_tncn'])
        self.assertEqual(served['NV00502']['thue_suat_co_dinh'], float(FLAT_TAX_RATE))
        state = self.client.get('/api-hrm/salary/finalize-state/', {'year': YEAR, 'month': MONTH}).data
        self.assertFalse(state['is_stale'], state['changed'])


class PayrollRulesSectionTests(TestCase):
    def _rules(self):
        from hrm.system_rules.payroll import payroll_rules
        return payroll_rules(None)

    def test_values_come_from_backend_constants_and_tax_policy(self):
        rules = self._rules()
        self.assertEqual(rules['insurance_rates']['bhxh'], float(EMPLOYEE_BHXH_RATE))
        self.assertEqual(rules['insurance_rates']['bhyt'], float(EMPLOYEE_BHYT_RATE))
        self.assertEqual(rules['insurance_rates']['bhtn'], float(EMPLOYEE_BHTN_RATE))
        self.assertEqual(rules['flat_tax_rate'], float(FLAT_TAX_RATE))
        self.assertEqual(rules['lunch_allowance_max_cap'], float(MAX_LUNCH_ALLOWANCE_CAP))
        self.assertEqual(rules['ot_hours_per_day'], float(OT_HOURS_PER_DAY))
        year = timezone.localdate().year
        personal, dependent = default_family_deductions(year)
        self.assertEqual((rules['tax']['source'], rules['tax']['personal_deduction'],
                          rules['tax']['dependent_deduction']), ('default', float(personal), float(dependent)))
        self.assertEqual(len(rules['tax']['brackets']), len(default_tax_brackets(year)))
        self.assertIsNone(rules['tax']['brackets'][-1]['max'])
        from hrm.attendance_engine import PolicyLoader
        self.assertEqual(rules['parking_allowance_per_day'],
                         float(PolicyLoader.load(timezone.localdate())['policy']['parking_allowance_per_day']))

    def test_tax_config_in_db_is_what_payroll_and_rules_use(self):
        cfg = TaxBracketConfig.objects.create(name='Biểu test', effective_from=dt.date(2020, 1, 1), is_active=True,
                                              personal_deduction=Decimal(12_000_000),
                                              dependent_deduction=Decimal(5_000_000))
        TaxBracket.objects.create(config=cfg, order=1, min_income=0, max_income=Decimal(20_000_000), rate=Decimal('0.1'))
        TaxBracket.objects.create(config=cfg, order=2, min_income=Decimal(20_000_000), max_income=None,
                                  rate=Decimal('0.3'))
        rules = self._rules()['tax']
        self.assertEqual((rules['source'], rules['personal_deduction'], rules['dependent_deduction']),
                         ('config', 12_000_000, 5_000_000))
        self.assertEqual(rules['brackets'], [{'min': 0, 'max': 20_000_000, 'rate': 0.1},
                                             {'min': 20_000_000, 'max': None, 'rate': 0.3}])
        policy = resolve_tax_policy(dt.date(YEAR, MONTH, 30))
        self.assertEqual((policy.source, policy.personal_deduction), ('config', Decimal(12_000_000)))

    def test_standard_days_endpoint_matches_payroll(self):
        from hrm.finalization_views import _get_salary_standard_work_days
        admin = User.objects.create_superuser('sd-admin', 's@example.com', 'x')
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(admin)
        res = client.get('/api/v1/salary/records/standard-days/', {'year': YEAR, 'month': MONTH})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['standard_work_days'], float(_get_salary_standard_work_days(YEAR, MONTH)))
        self.assertEqual(client.get('/api/v1/salary/records/standard-days/', {'year': YEAR, 'month': 13}).status_code,
                         400)
