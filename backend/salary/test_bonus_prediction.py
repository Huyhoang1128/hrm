import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import CompanyUnit, Department, Employee
from salary.bonus_calculator import BonusCalculator, BonusScheme

FISCAL_YEAR = 2026


class BonusPredictionTests(APITestCase):
    url = '/api/v1/salary/records/bonus-prediction/'

    def setUp(self):
        self.unit = CompanyUnit.objects.create(code='ABC', name='Công ty ABC')
        self.dept = Department.objects.create(code='KD', name='Kinh doanh')
        self.senior = self._emp('NV99001', dt.date(2024, 1, 1), 20_000_000)     # > 1 năm
        self.junior = self._emp('NV99002', dt.date(2026, 7, 1), 12_000_000)     # 5 tháng tới 31/12
        self._emp('NV99003', dt.date(2025, 1, 1), 10_000_000, status='INACTIVE')  # đã nghỉ → bỏ

    def _emp(self, code, start, salary, status='ACTIVE'):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=code,
            start_date=start, basic_salary=Decimal(salary), employment_status=status, is_active=True,
            department=self.dept, company_unit=self.unit)

    def test_fixed_scheme_uses_configurable_under_one_year_amount(self):
        result = BonusCalculator().predict_company_bonus(
            scheme=BonusScheme.SCHEME_FIXED_3M_BASIC, bonus_months=1, fiscal_year=FISCAL_YEAR,
            under_one_year_amount=Decimal('2000000'))
        by_code = {e['employee_code']: e['bonus_amount'] for e in result['employees']}
        self.assertEqual(by_code, {'NV99001': 20_000_000.0, 'NV99002': 2_000_000.0})
        self.assertEqual(result['total_bonus'], 22_000_000.0)

    def test_prorated_scheme(self):
        result = BonusCalculator().predict_company_bonus(
            scheme=BonusScheme.SCHEME_PRORATED, bonus_months=1, fiscal_year=FISCAL_YEAR)
        junior = next(e for e in result['employees'] if e['employee_code'] == 'NV99002')
        self.assertEqual(junior['months_worked'], 5)
        self.assertEqual(junior['bonus_amount'], 5_000_000.0)  # 12tr / 12 × 5

    def test_endpoint_filters_legal_entity_and_requires_admin(self):
        admin = User.objects.create_superuser('bp-admin', 'a@example.com', 'x')
        self.client.force_authenticate(admin)
        res = self.client.post(self.url, {'scheme': 'fixed_3m_basic', 'fiscal_year': FISCAL_YEAR,
                                          'legal_entity': 'abc'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['total_employee_count'], 2)
        self.assertEqual(res.data['under_one_year_amount'], 3_000_000.0)
        res = self.client.post(self.url, {'scheme': 'custom', 'fiscal_year': FISCAL_YEAR}, format='json')
        self.assertEqual(res.status_code, 400)

        self.client.force_authenticate(self.junior.user)
        res = self.client.post(self.url, {'scheme': 'fixed_3m_basic'}, format='json')
        self.assertEqual(res.status_code, 403)
