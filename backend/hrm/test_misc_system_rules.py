"""Quy định mảng "Khác" (hrm/system_rules/misc.py) và các chỗ backend tự kiểm tra đúng quy định đó."""
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.system_rules import build_rules

RULES_URL = '/api-hrm/system-rules/'


class PasswordRulesTests(TestCase):
    def test_public_section_matches_validators(self):
        from hrm.utils import RESET_PASSWORD_LENGTH
        data = APIClient().get(RULES_URL, {'sections': 'password'}).json()
        self.assertEqual(data['password']['min_length'], 8)
        self.assertEqual(len(data['password']['help_texts']), 4)
        self.assertEqual(data['password']['reset_generated_length'], RESET_PASSWORD_LENGTH)

    @override_settings(AUTH_PASSWORD_VALIDATORS=[{
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 11},
    }])
    def test_min_length_follows_config(self):
        rules = build_rules(None, {'password'})['password']
        self.assertEqual(rules['min_length'], 11)
        self.assertEqual(len(rules['help_texts']), 1)

    @override_settings(AUTH_PASSWORD_VALIDATORS=[])
    def test_no_min_length_validator(self):
        self.assertIsNone(build_rules(None, {'password'})['password']['min_length'])


class HrmPasswordPathsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='pw-admin', password='Admin-Pass-2026')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.staff_user = User.objects.create_user(username='pw-staff', password='Old-Pass-2026', email='a@b.vn')
        self.staff = Employee.objects.create(
            user=self.staff_user, employee_id='PW-001', full_name='Nhân viên Mật khẩu', personal_email='a@b.vn',
        )

    def test_hr_reset_generates_configured_length(self):
        from hrm.utils import RESET_PASSWORD_LENGTH
        with mock.patch('hrm.serializers.send_account_info_email', return_value=True) as sent:
            response = self.client.post(f'/api-hrm/employees/{self.staff.id}/reset-password/')
        self.assertEqual(response.status_code, 200, response.data)
        new_password = sent.call_args.kwargs['new_password']
        self.assertEqual(len(new_password), RESET_PASSWORD_LENGTH)
        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.check_password(new_password))

    def test_forgot_password_generates_configured_length(self):
        from hrm.utils import RESET_PASSWORD_LENGTH
        with mock.patch('hrm.serializers.send_account_info_email', return_value=True) as sent:
            response = APIClient().post('/api-hrm/forgot-password/', {'employee_id': 'PW-001'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(sent.call_args.kwargs['new_password']), RESET_PASSWORD_LENGTH)

    def test_employee_create_validates_password(self):
        payload = {'employee_id': 'PW-NEW', 'full_name': 'Người mới', 'username': 'pw-new'}
        weak = self.client.post('/api-hrm/employees/', {**payload, 'password': '12345678'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.assertIn('password', weak.data)
        self.assertFalse(User.objects.filter(username='pw-new').exists())
        ok = self.client.post('/api-hrm/employees/', {**payload, 'password': 'Hoa-Mai-2026-xyz'}, format='json')
        self.assertEqual(ok.status_code, 201, ok.data)
