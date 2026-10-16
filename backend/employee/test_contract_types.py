import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import (
    NON_OFFICIAL_CONTRACT_TYPES, OFFICIAL_LABOR_CONTRACT_TYPES, PROBATION_CONTRACT_TYPES, Department, Employee,
    probation_months_for,
)
from hrm.finalization_views import _format_hinh_thuc_lam_viec, get_salary_rows
from hrm.models import OnboardingProcess, WorkFinalization
from hrm.views import EmployeeContractViewSet


class NewContractTypesTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='CT', name='Phòng CT')

    def _emp(self, code, contract_type, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, contract_type=contract_type, start_date=dt.date(2026, 9, 1), is_active=True,
            employment_status='ACTIVE', **kw)

    def test_groups_and_probation_months(self):
        self.assertEqual(PROBATION_CONTRACT_TYPES, {'PROBATION', 'PROBATION_1M', 'PROBATION_2M'})
        self.assertTrue({'SIX_MONTH', 'THREE_YEAR'} <= OFFICIAL_LABOR_CONTRACT_TYPES)
        self.assertTrue(PROBATION_CONTRACT_TYPES < NON_OFFICIAL_CONTRACT_TYPES)
        self.assertEqual((probation_months_for('PROBATION_1M', 3), probation_months_for('PROBATION', 3)), (1, 3))
        group = EmployeeContractViewSet.CONTRACT_TYPE_TO_GROUP
        self.assertEqual((group['PROBATION_2M'], group['SIX_MONTH'], group['TWO_YEAR'], group['THREE_YEAR']),
                         ('PROBATION', 'LABOR', 'LABOR', 'LABOR'))
        self.assertEqual((_format_hinh_thuc_lam_viec('PROBATION_1M'), _format_hinh_thuc_lam_viec('SIX_MONTH')), ('TV', 'CT'))

    def test_onboarding_probation_end_uses_months_of_the_code(self):
        onb = OnboardingProcess.objects.create(
            onboarding_code='ONB-CT-1', candidate_name='Ứng viên', candidate_email='uv@example.com',
            start_date=dt.date(2026, 9, 1), contract_type='PROBATION_1M', probation_period_months=2)
        self.assertEqual(onb.expected_end_date, dt.date(2026, 9, 30))

    def test_new_probation_codes_are_treated_as_probation_everywhere(self):
        emp = self._emp('NV95201', 'PROBATION_2M', basic_salary=Decimal(10_000_000))
        self._emp('NV95202', 'SIX_MONTH', basic_salary=Decimal(10_000_000))
        WorkFinalization.objects.create(
            employee=emp, year=2026, month=9, employee_code=emp.employee_id, ho_va_ten=emp.full_name,
            cong_thuc_te=Decimal(20), tong_cong=Decimal(20), cong_thu_viec=Decimal(20),
            raw_state={'cong_includes_holiday': True})
        rows = {r['ma_nv']: r for r in get_salary_rows(2026, 9)['results']}
        self.assertEqual((rows['NV95201']['contract_status'], rows['NV95201']['tax_method']),
                         ('THU_VIEC', 'FLAT_10_PROBATION'))
        self.assertEqual(rows['NV95202']['contract_status'], 'CHINH_THUC')

        self.client.force_authenticate(User.objects.create_superuser('ct-admin', 'a@example.com', 'x'))
        res = self.client.get('/api-hrm/employees/', {'employment_status': 'PROBATION'})
        listed = [r['employee_id'] for r in (res.data['results'] if isinstance(res.data, dict) else res.data)]
        self.assertIn('NV95201', listed)
        self.assertNotIn('NV95202', listed)
