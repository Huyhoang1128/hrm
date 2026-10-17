"""BHXH theo kỳ (employee/social_insurance.py): bảng lương lấy mức đóng của kỳ có hiệu lực
tháng đó, hồ sơ tự cập nhật theo kỳ hiện hành, không sửa trực tiếp mức đóng khi đã có kỳ."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import Department, Employee, SocialInsurancePeriod
from hrm.finalization_views import get_salary_rows

URL = '/api-hrm/social-insurance-periods/'


class SocialInsurancePeriodTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('si-admin', 'a@example.com', 'x')
        cls.dept = Department.objects.create(code='SI', name='Phòng SI')
        cls.emp = cls._emp('NV00411', level=5_000_000)
        cls.legacy = cls._emp('NV00412', level=4_000_000)   # chưa có kỳ nào

    @classmethod
    def _emp(cls, code, level):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=cls.dept, contract_type='INDEFINITE', basic_salary=Decimal(10_000_000),
            start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE',
            social_insurance_contribution_level=level)

    def _levels(self, year, month):
        return {r['ma_nv']: r['muc_luong_dong_bh'] for r in get_salary_rows(year, month)['results']}

    def test_payroll_uses_period_of_the_month(self):
        SocialInsurancePeriod.objects.create(employee=self.emp, from_month=dt.date(2026, 8, 20),
                                             to_month=dt.date(2026, 9, 1), contribution_level=8_000_000)
        SocialInsurancePeriod.objects.create(employee=self.emp, from_month=dt.date(2026, 11, 1),
                                             contribution_level=9_000_000)
        self.assertEqual(self._levels(2026, 9), {'NV00411': 8_000_000, 'NV00412': 4_000_000})
        self.assertEqual(self._levels(2026, 10)['NV00411'], 0)   # không thuộc kỳ nào → không đóng
        self.assertEqual(self._levels(2026, 12)['NV00411'], 9_000_000)
        self.assertEqual(self._levels(2026, 7)['NV00411'], 0)

    def test_api_syncs_profile_and_validates(self):
        self.client.force_authenticate(self.admin)
        this_month = timezone.localdate().replace(day=1)
        res = self.client.post(URL, {'employee': self.emp.id, 'from_month': this_month.isoformat(),
                                     'contribution_level': 7_000_000}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(float(res.data['employee_rate']), 10.5)
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.social_insurance_contribution_level, 7_000_000)

        # Trùng khoảng / đến tháng < từ tháng / mức đóng âm
        self.assertEqual(self.client.post(URL, {'employee': self.emp.id, 'from_month': '2030-01-01',
                                                'contribution_level': 1}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f"{URL}{res.data['id']}/", {'to_month': '2020-01-01'},
                                           format='json').status_code, 400)
        self.assertEqual(self.client.post(URL, {'employee': self.legacy.id, 'from_month': '2026-01-01',
                                                'contribution_level': -5}, format='json').status_code, 400)

        # Kết thúc kỳ ở tháng trước → tháng này không còn đóng
        last_month = (this_month - dt.timedelta(days=1)).replace(day=1)
        period = SocialInsurancePeriod.objects.get(pk=res.data['id'])
        period.from_month = last_month
        period.save()
        res = self.client.patch(f"{URL}{period.id}/", {'to_month': last_month.isoformat()}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.social_insurance_contribution_level, 0)
        self.assertEqual(len(self.client.get(URL, {'employee': self.emp.id}).data), 1)

    def test_direct_profile_edit_blocked_when_periods_exist(self):
        self.client.force_authenticate(self.admin)
        res = self.client.patch(f'/api-hrm/employees/{self.legacy.id}/',
                                {'social_insurance_contribution_level': 4_500_000}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        SocialInsurancePeriod.objects.create(employee=self.emp, from_month=dt.date(2026, 1, 1),
                                             contribution_level=5_000_000)
        res = self.client.patch(f'/api-hrm/employees/{self.emp.id}/',
                                {'social_insurance_contribution_level': 6_000_000}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('social_insurance_contribution_level', res.data)
        # Gửi lại đúng giá trị hiện tại thì không sao (form sửa hồ sơ gửi đủ các trường)
        self.assertEqual(self.client.patch(f'/api-hrm/employees/{self.emp.id}/',
                                           {'social_insurance_contribution_level': 5_000_000,
                                            'phone_number': '0900000009'}, format='json').status_code, 200)

    def test_hr_or_admin_only(self):
        self.client.force_authenticate(self.emp.user)
        self.assertEqual(self.client.get(URL).status_code, 403)
