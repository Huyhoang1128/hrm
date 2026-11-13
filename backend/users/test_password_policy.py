"""Đổi / đặt lại mật khẩu ở /api/users/ dùng chung chính sách AUTH_PASSWORD_VALIDATORS (validate_password)."""
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

CHANGE_URL = '/api/users/change-password/'
RESET_URL = '/api/users/reset-password/'
STRONG = 'Hoa-Mai-2026-xyz'


class ChangePasswordPolicyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='pw-user', password='Old-Pass-2026')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _post(self, new, confirm=None, current='Old-Pass-2026'):
        return self.client.post(CHANGE_URL, {
            'current_password': current,
            'new_password': new,
            'confirm_password': new if confirm is None else confirm,
        }, format='json')

    def test_short_password_rejected_by_validators(self):
        # Trước đây chỉ chặn < 6 ký tự: "abc123x" (7 ký tự) lọt qua dù chính sách chung là 8.
        response = self._post('Ab1-xyz')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.data['new_password'])
        self.assertIn('error', response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Old-Pass-2026'))

    def test_numeric_password_rejected(self):
        response = self._post('2026202620262026')
        self.assertEqual(response.status_code, 400)

    def test_same_as_current_rejected(self):
        response = self._post('Old-Pass-2026')
        self.assertEqual(response.status_code, 400)

    def test_strong_password_accepted(self):
        response = self._post(STRONG)
        self.assertEqual(response.status_code, 200, response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG))

    @override_settings(AUTH_PASSWORD_VALIDATORS=[{
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 20},
    }])
    def test_follows_configured_min_length(self):
        self.assertEqual(self._post(STRONG).status_code, 400)
        self.assertEqual(self._post(STRONG + '-dai-hon-nua').status_code, 200)


class ResetPasswordPolicyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='0900000001', password='Old-Pass-2026')
        self.client = APIClient()
        session = self.client.session
        session['reset_token_0900000001'] = 'tok-123'
        session.save()

    def test_weak_password_rejected(self):
        response = self.client.post(RESET_URL, {'reset_token': 'tok-123', 'new_password': 'abc123'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Old-Pass-2026'))

    def test_strong_password_accepted(self):
        response = self.client.post(RESET_URL, {'reset_token': 'tok-123', 'new_password': STRONG}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG))
