import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee, Position
from hrm.models import CompanyConfig, OnlineWorkQuotaOverride
from hrm.stats_utils import get_employee_monthly_stats, get_max_online_work_quota

URL = '/api-hrm/online-work-quota-overrides/'


class OnlineWorkQuotaOverrideTests(APITestCase):
    def setUp(self):
        CompanyConfig.objects.filter(is_active=True).update(is_active=False)
        CompanyConfig.objects.create(
            name='Cấu hình test', code='OQ-TEST', is_active=True, effective_from=dt.date(2026, 1, 1),
            max_online_work_count_per_month=Decimal('3.0'))
        self.dept = Department.objects.create(code='OQ', name='Phòng OQ')
        self.position = Position.objects.create(code='OQ-NV', title='Nhân viên OQ', level=1)
        self.emp = self._emp('NV00451')
        self.hr = self._emp('NV00452', is_hr=True)

    def _emp(self, code, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, position=self.position, start_date=dt.date(2025, 1, 1), is_active=True,
            employment_status='ACTIVE', **kw)

    def _quota(self):
        return get_max_online_work_quota(Employee.objects.get(pk=self.emp.pk))

    def test_priority_employee_then_position_then_department_then_config(self):
        self.assertEqual(self._quota(), 3.0)
        OnlineWorkQuotaOverride.objects.create(department=self.dept, max_online_days=Decimal('2'))
        self.assertEqual(self._quota(), 2.0)
        OnlineWorkQuotaOverride.objects.create(position=self.position, max_online_days=Decimal('1'))
        self.assertEqual(self._quota(), 1.0)
        OnlineWorkQuotaOverride.objects.create(employee=self.emp, max_online_days=Decimal('0.5'))
        self.assertEqual(self._quota(), 0.5)
        stats = get_employee_monthly_stats(Employee.objects.get(pk=self.emp.pk), dt.date(2026, 9, 15))
        self.assertEqual(stats['max_online_quota'], 0.5)

    def test_api_requires_exactly_one_scope_and_admin_or_hr(self):
        self.client.force_authenticate(self.emp.user)
        self.assertEqual(self.client.get(URL).status_code, 403)

        self.client.force_authenticate(self.hr.user)
        res = self.client.post(URL, {'employee': self.emp.id, 'department': self.dept.id, 'max_online_days': 1}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post(URL, {'max_online_days': 1}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post(URL, {'employee': self.emp.id, 'max_online_days': '1.5'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['employee_detail']['employee_id'], 'NV00451')
        res = self.client.patch(f"{URL}{res.data['id']}/", {'max_online_days': 2}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self._quota(), 2.0)
        self.assertEqual(self.client.post(URL, {'employee': self.emp.id, 'max_online_days': 40}, format='json').status_code, 400)
