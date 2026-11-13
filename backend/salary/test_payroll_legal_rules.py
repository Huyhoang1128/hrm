"""Quy tắc lương sửa 2026-11-13:
- Thử việc lựa chọn 2 "Tháng đầu 85%, tháng sau 100%": 1 tháng đầu kể từ ngày bắt đầu, chia theo từng ngày công.
- Trực tối: bảng chốt công lưu SỐ BUỔI -> tiền = số buổi × đơn giá (chính sách chấm công), không cộng số buổi như tiền.
- Trần đóng BH theo luật khi tính lương thật: BHXH+BHYT ≤ 20 × lương cơ sở, BHTN ≤ 20 × lương tối thiểu vùng."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.attendance_engine import PolicyLoader
from hrm.attendance_models import AttendancePolicyConfig, AttendancePolicyVersion
from hrm.models import WorkFinalization
from salary.payslip import PAYSLIP_KEY

YEAR, MONTH = 2026, 9  # công chuẩn: 30 ngày − 4 chủ nhật − 1 = 25
ROWS_URL = '/api-hrm/salary/department/'


def _daily(credits_by_day):
    return [{'date': dt.date(YEAR, MONTH, d).isoformat(), 'work_credit': c, 'day_type': ''}
            for d, c in credits_by_day.items()]


class PayrollLegalRulesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('plr-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='PLR', name='Phòng PLR')

        # Thử việc từ 20/08: tháng đầu tới 19/09, hết thử việc 19/10. Tháng 9: 10 công ngày 1–19 (tháng đầu)
        # + 8 công ngày 21–30 (sau tháng đầu).
        cls.prob = cls._emp('PLR01', start=dt.date(2026, 8, 20), probation_end=dt.date(2026, 10, 19),
                            probation_rate='OPTION_2', contract='PROBATION_2M')
        days = {d: 1 for d in range(1, 20) if dt.date(YEAR, MONTH, d).weekday() < 5}  # 1–19/9: 14 ngày làm việc
        days.update({d: 1 for d in range(21, 31) if dt.date(YEAR, MONTH, d).weekday() < 5})  # 21–30/9: 8 ngày
        cls.first_month_days = sum(1 for d in days if d <= 19)
        cls.later_days = sum(1 for d in days if d > 19)
        cls._wf(cls.prob, cong_thu_viec=len(days), raw_state={'cong_includes_holiday': True, 'daily_summary': _daily(days)})

        # Bản chốt không có công từng ngày: tạm tính theo tháng dương lịch.
        cls.prob_start_month = cls._emp('PLR02', start=dt.date(2026, 9, 10), probation_end=dt.date(2026, 11, 9),
                                        probation_rate='OPTION_2', contract='PROBATION_2M')
        cls._wf(cls.prob_start_month, cong_thu_viec=15, raw_state={'cong_includes_holiday': True})
        cls.prob_later_month = cls._emp('PLR03', start=dt.date(2026, 7, 10), probation_end=dt.date(2026, 9, 9),
                                        probation_rate='OPTION_2', contract='PROBATION_2M')
        cls._wf(cls.prob_later_month, cong_thu_viec=6, cong_chinh_thuc=15, raw_state={'cong_includes_holiday': True})

        # Trực tối 3 buổi; BH trên trần (BHXH+BHYT: 20 × 2.340.000 = 46.800.000)
        cls.night = cls._emp('PLR04', start=dt.date(2024, 1, 1), insurance=60_000_000)
        cls._wf(cls.night, cong_chinh_thuc=25, truc_toi=3, raw_state={'cong_includes_holiday': True})
        # Vùng IV (taxPolicy.region) năm 2026: BHTN ≤ 20 × 3.700.000 = 74.000.000
        cls.region4 = cls._emp('PLR05', start=dt.date(2024, 1, 1), insurance=80_000_000,
                               adjustments={'payroll_config': {'taxPolicy': {'region': 'IV'}}})
        cls._wf(cls.region4, cong_chinh_thuc=25, raw_state={'cong_includes_holiday': True})

    @classmethod
    def _emp(cls, code, start, probation_end=None, probation_rate=None, contract='INDEFINITE', insurance=0,
             adjustments=None):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type=contract, basic_salary=Decimal(25_000_000), start_date=start,
            probation_end_date=probation_end, probation_rate=probation_rate,
            social_insurance_contribution_level=insurance, is_active=True, employment_status='ACTIVE',
            salary_adjustments=adjustments or {})

    @classmethod
    def _wf(cls, emp, raw_state, **values):
        values.setdefault('cong_thuc_te', values.get('cong_thu_viec', 0) + values.get('cong_chinh_thuc', 0))
        values.setdefault('tong_cong', values['cong_thuc_te'])
        WorkFinalization.objects.create(
            employee=emp, year=YEAR, month=MONTH, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
            raw_state=raw_state, **{k: Decimal(v) for k, v in values.items()})

    def setUp(self):
        PolicyLoader.clear_cache()
        self.client.force_authenticate(self.admin)

    def tearDown(self):
        PolicyLoader.clear_cache()

    def _rows(self):
        res = self.client.get(ROWS_URL, {'year': YEAR, 'month': MONTH})
        self.assertEqual(res.status_code, 200, res.data)
        return {r['ma_nv']: r for r in res.data['results']}

    # ── Thử việc 85% tháng đầu / 100% sau ────────────────────────────────────
    def test_option2_splits_first_month_by_daily_credit(self):
        row = self._rows()['PLR01']
        day_salary = Decimal(25_000_000) / Decimal(25)
        expected = day_salary * (self.first_month_days * Decimal('0.85') + self.later_days * Decimal('1'))
        self.assertEqual(row['cong_thu_viec_thang_dau'], self.first_month_days)
        self.assertEqual((row['probation_rate_percent'], row['probation_rate_percent_after_first_month']), (85, 100))
        self.assertAlmostEqual(row['luong_ngay_cong_thu_viec'], float(expected), places=2)
        self.assertEqual(row['ty_le_thu_viec_text'],
                         f'85% tháng đầu ({self.first_month_days} công), 100% ({self.later_days} công)')

    def test_option2_without_daily_falls_back_to_calendar_month(self):
        rows = self._rows()
        day_salary = 25_000_000 / 25
        # Kỳ chứa ngày bắt đầu: toàn bộ công thử việc 85%
        self.assertEqual(rows['PLR02']['cong_thu_viec_thang_dau'], 15)
        self.assertAlmostEqual(rows['PLR02']['luong_ngay_cong_thu_viec'], day_salary * 15 * 0.85, places=2)
        # Các kỳ sau tháng đầu: 100%
        self.assertEqual(rows['PLR03']['cong_thu_viec_thang_dau'], 0)
        self.assertAlmostEqual(rows['PLR03']['luong_ngay_cong_thu_viec'], day_salary * 6, places=2)

    # ── Trực tối ─────────────────────────────────────────────────────────────
    def test_night_duty_default_rate_zero_not_counted_as_money(self):
        row = self._rows()['PLR04']
        self.assertEqual((row['truc_toi'], row['don_gia_truc_toi'], row['tien_truc_toi']), (3, 0, 0))
        self.assertEqual(row[PAYSLIP_KEY]['truc_ca'], 0)

    def test_night_duty_amount_is_sessions_times_rate(self):
        version = AttendancePolicyVersion.objects.create(
            version_code='PLR-V1', name='PLR', effective_from=dt.date(2026, 1, 1), is_active=True)
        AttendancePolicyConfig.objects.create(version=version, night_duty_allowance_per_session=150_000)
        PolicyLoader.clear_cache()
        row = self._rows()['PLR04']
        self.assertEqual((row['don_gia_truc_toi'], row['tien_truc_toi']), (150_000, 450_000))
        self.assertEqual(row[PAYSLIP_KEY]['truc_ca'], 450_000)
        self.assertEqual(row['cach_tinh_truc_toi'], '3 buổi × 150.000')
        without = self._gross_without_night_duty(row)
        self.assertAlmostEqual(row['tong_thu_nhap_chiu_thue'] - without, 450_000, places=2)

    @staticmethod
    def _gross_without_night_duty(row):
        return (row['luong_ngay_cong'] + max(row['phu_cap'] - row['phu_cap_an_trua'], 0) + row['luong_doanh_so']
                + row['thu_nhap_khac'] + row['luong_tang_ca'])

    # ── Trần đóng BH ─────────────────────────────────────────────────────────
    def test_insurance_capped_by_base_salary_and_region(self):
        rows = self._rows()
        capped = rows['PLR04']  # vùng I mặc định: BHTN trần 106.200.000 -> 60tr giữ nguyên
        self.assertEqual((capped['muc_luong_dong_bh'], capped['muc_dong_bhxh_bhyt'], capped['muc_dong_bhtn'],
                          capped['vung_luong_toi_thieu']), (60_000_000, 46_800_000, 60_000_000, 'I'))
        self.assertAlmostEqual(capped['bh_deduction'], 46_800_000 * 0.095 + 60_000_000 * 0.01, places=2)
        self.assertEqual(capped['bao_hiem_bat_buoc'], capped['bh_deduction'])
        self.assertEqual(capped['ghi_chu_tran_bh'], 'Áp trần: BHXH, BHYT tính trên 46.800.000; BHTN trên 60.000.000 (vùng I)')
        p = capped[PAYSLIP_KEY]
        self.assertEqual((p['bhxh'], p['bhyt'], p['bhtn']), (3_744_000, 702_000, 600_000))
        region4 = rows['PLR05']
        self.assertEqual((region4['muc_dong_bhxh_bhyt'], region4['muc_dong_bhtn'], region4['vung_luong_toi_thieu']),
                         (46_800_000, 74_000_000, 'IV'))
        self.assertEqual(region4[PAYSLIP_KEY]['bhtn'], 740_000)
