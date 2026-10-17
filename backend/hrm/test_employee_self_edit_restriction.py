"""Nhân viên tự sửa hồ sơ chính mình: chỉ được đổi các trường thông tin cá nhân; khi
CompanyConfig.lock_employee_self_edit bật thì không tự sửa được gì. HCNS / Admin không bị giới hạn."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import CompanyConfig

URL = '/api-hrm/employees/'


class EmployeeSelfEditRestrictionTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='SE', name='Phòng SE')
        self.staff = self._emp('NV00491')
        self.hr = self._emp('NV00492', is_hr=True)

    def _emp(self, code, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, basic_salary=Decimal('10000000'), start_date=dt.date(2025, 1, 1),
            is_active=True, employment_status='ACTIVE', **kw)

    def _patch(self, emp, data):
        self.client.force_authenticate(emp.user)
        return self.client.patch(f'{URL}{emp.id}/', data, format='json')

    def _lock(self, locked=True):
        CompanyConfig.objects.filter(is_active=True).exclude(code='SE-TEST').update(is_active=False)
        CompanyConfig.objects.update_or_create(code='SE-TEST', defaults=dict(
            name='Cấu hình test', is_active=True, effective_from=dt.date(2026, 1, 1),
            lock_employee_self_edit=locked))

    def test_staff_can_edit_personal_fields_only(self):
        res = self._patch(self.staff, {'phone_number': '0900000001', 'current_address': 'Hà Nội'})
        self.assertEqual(res.status_code, 200, res.data)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.phone_number, '0900000001')

        res = self._patch(self.staff, {'phone_number': '0900000002', 'basic_salary': '99000000'})
        self.assertEqual(res.status_code, 403)
        self.assertIn('basic_salary', res.data['error'])
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.basic_salary, Decimal('10000000'))
        self.assertEqual(self.staff.phone_number, '0900000001')

    def test_hr_is_not_restricted(self):
        self.assertEqual(self._patch(self.hr, {'basic_salary': '12000000'}).status_code, 200)
        self.hr.refresh_from_db()
        self.assertEqual(self.hr.basic_salary, Decimal('12000000'))

    def test_lock_flag(self):
        self.client.force_authenticate(self.staff.user)
        self.assertFalse(self.client.get(f'{URL}me/').data['self_edit_locked'])

        self._lock()
        self.assertTrue(self.client.get(f'{URL}me/').data['self_edit_locked'])
        self.assertEqual(self._patch(self.staff, {'phone_number': '0900000003'}).status_code, 403)
        # HCNS vẫn tự sửa được
        self.client.force_authenticate(self.hr.user)
        self.assertFalse(self.client.get(f'{URL}me/').data['self_edit_locked'])
        self.assertEqual(self._patch(self.hr, {'phone_number': '0900000004'}).status_code, 200)

        self._lock(False)
        self.assertEqual(self._patch(self.staff, {'phone_number': '0900000005'}).status_code, 200)
