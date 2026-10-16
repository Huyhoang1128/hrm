import datetime as dt

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.important_alerts import build_important_alerts

TODAY = dt.date(2026, 10, 15)


class ImportantAlertsTests(APITestCase):
    _n = 0

    def _emp(self, **kw):
        ImportantAlertsTests._n += 1
        n = ImportantAlertsTests._n
        return Employee.objects.create(
            user=User.objects.create_user(f'ia-{n}', password='x'), employee_id=f'NV98{n:03d}',
            full_name=kw.pop('full_name', f'NV {n}'), is_active=True, employment_status=kw.pop('status', 'ACTIVE'),
            **kw)

    def test_contract_alerts(self):
        expiring = self._emp(contract_type='ONE_YEAR', contract_end_date=TODAY + dt.timedelta(days=10))
        expired = self._emp(contract_type='ONE_YEAR', contract_end_date=TODAY - dt.timedelta(days=3))
        self._emp(contract_type='ONE_YEAR', contract_end_date=TODAY + dt.timedelta(days=40))   # còn xa
        self._emp(contract_type='INDEFINITE', contract_end_date=TODAY + dt.timedelta(days=5))  # không hết hạn
        self._emp(contract_type='ONE_YEAR', contract_end_date=TODAY + dt.timedelta(days=5),
                  status='INACTIVE')                                                             # đã nghỉ
        data = build_important_alerts(TODAY)
        by_code = {r['employee_code']: r['status'] for r in data['contracts']}
        self.assertEqual(by_code, {expired.employee_id: 'EXPIRED', expiring.employee_id: 'EXPIRING'})
        self.assertEqual(data['counts']['contracts_expiring'], 1)
        self.assertEqual(data['counts']['contracts_expired'], 1)

    def test_insurance_alerts(self):
        # Đến hạn = ngày vào làm + 2 tháng
        upcoming = self._emp(contract_type='PROBATION', start_date=dt.date(2026, 8, 20))   # hạn 20/10
        overdue = self._emp(contract_type='PROBATION', start_date=dt.date(2026, 8, 1))     # hạn 01/10
        self._emp(contract_type='PROBATION', start_date=dt.date(2026, 8, 20),
                  social_insurance_participation_status='PARTICIPATING')                   # đã tham gia
        self._emp(contract_type='PROBATION', start_date=dt.date(2026, 8, 20),
                  social_insurance_start_date=dt.date(2026, 10, 1))                         # đã có ngày tham gia
        self._emp(contract_type='COLLABORATOR', start_date=dt.date(2026, 8, 20))           # không thuộc diện
        self._emp(contract_type='PROBATION', start_date=dt.date(2026, 6, 1))               # quá hạn > 30 ngày
        data = build_important_alerts(TODAY)
        by_code = {r['employee_code']: (r['status'], r['due_date']) for r in data['insurance']}
        self.assertEqual(by_code, {
            overdue.employee_id: ('OVERDUE', '2026-10-01'),
            upcoming.employee_id: ('UPCOMING', '2026-10-20'),
        })

    def test_endpoint_admin_hr_only(self):
        hr = self._emp(is_hr=True)
        staff = self._emp()
        self.client.force_authenticate(staff.user)
        self.assertEqual(self.client.get('/api-hrm/important-alerts/').status_code, 403)
        self.client.force_authenticate(hr.user)
        res = self.client.get('/api-hrm/important-alerts/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('counts', res.data)
