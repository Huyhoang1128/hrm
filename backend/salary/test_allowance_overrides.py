from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.finalization_views import _calculate_lunch_allowance
from salary.salary_data_models import LunchAllowanceOverride, ParkingAllowanceOverride

YEAR, MONTH = 2026, 9
LUNCH_POLICY = {'payroll_config': {'lunchAllowancePolicy': {'mode': 'fixed', 'fixed_amount': 300000}}}


class AllowanceOverrideTests(APITestCase):
    parking_url = '/api/v1/salary/parking-allowance-overrides/'
    lunch_url = '/api/v1/salary/lunch-allowance-overrides/'

    def setUp(self):
        self.a = self._emp('NV97001', salary_adjustments=LUNCH_POLICY)
        self.b = self._emp('NV97002', salary_adjustments=LUNCH_POLICY)
        self.left = self._emp('NV97003', is_active=False)
        self.client.force_authenticate(User.objects.create_superuser('ao-admin', 'a@example.com', 'x'))

    def _emp(self, code, is_active=True, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=code,
            is_active=is_active, **kw)

    def test_fill_remaining_zero_only_creates_missing_rows(self):
        ParkingAllowanceOverride.objects.create(employee=self.a, year=YEAR, month=MONTH, amount=150000)
        res = self.client.post(f'{self.parking_url}fill-remaining-zero/', {'year': YEAR, 'month': MONTH}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual((res.data['created_count'], res.data['skipped_existing_count']), (1, 1))
        rows = dict(ParkingAllowanceOverride.objects.filter(year=YEAR, month=MONTH)
                    .values_list('employee__employee_id', 'amount'))
        self.assertEqual(rows, {'NV97001': Decimal('150000'), 'NV97002': Decimal('0')})

        res = self.client.post(f'{self.parking_url}fill-remaining-zero/', {'year': YEAR, 'month': 13}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_lunch_sync_current_seeds_calculated_amount(self):
        LunchAllowanceOverride.objects.create(employee=self.a, year=YEAR, month=MONTH, amount=100000)
        res = self.client.post(f'{self.lunch_url}sync-current/', {'year': YEAR, 'month': MONTH}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['created_count'], 1)
        rows = dict(LunchAllowanceOverride.objects.filter(year=YEAR, month=MONTH)
                    .values_list('employee__employee_id', 'amount'))
        self.assertEqual(rows, {'NV97001': Decimal('100000'), 'NV97002': Decimal('300000')})

    def test_lunch_override_wins_over_policy_even_when_zero(self):
        self.assertEqual(_calculate_lunch_allowance(self.b, Decimal('20'), YEAR, MONTH), Decimal('300000'))
        LunchAllowanceOverride.objects.create(employee=self.b, year=YEAR, month=MONTH, amount=0)
        self.assertEqual(_calculate_lunch_allowance(self.b, Decimal('20'), YEAR, MONTH), Decimal('0'))

    def test_lunch_bulk_import_and_list(self):
        res = self.client.post(f'{self.lunch_url}bulk-import/', {'year': YEAR, 'month': MONTH, 'records': [
            {'employee_code': 'NV97001', 'amount': 250000},
            {'employee_code': 'NV00000', 'amount': 1},
        ]}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual([r['employee_code'] for r in res.data['success']], ['NV97001'])
        self.assertEqual([r['employee_code'] for r in res.data['errors']], ['NV00000'])
        res = self.client.get(self.lunch_url, {'year': YEAR, 'month': MONTH})
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        self.assertEqual([(r['employee_code'], Decimal(r['amount'])) for r in rows], [('NV97001', Decimal('250000'))])

    def test_lunch_requires_admin_or_hr(self):
        self.client.force_authenticate(self.b.user)
        self.assertEqual(self.client.get(self.lunch_url).status_code, 403)
        self.assertEqual(self.client.post(f'{self.lunch_url}sync-current/', {'year': YEAR, 'month': MONTH},
                                          format='json').status_code, 403)
        hr = self._emp('NV97004', is_hr=True)
        self.client.force_authenticate(hr.user)
        self.assertEqual(self.client.get(self.lunch_url).status_code, 200)
