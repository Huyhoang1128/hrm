"""Luồng quên mật khẩu bằng OTP cố định "8888" đã tắt: không còn cấp access token cho người lạ."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient


class OtpPasswordResetDisabledTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='0912345678', password='Old-Pass-123')
        self.client = APIClient()

    def test_forgot_password_disabled(self):
        res = self.client.post('/api/users/forgot-password/', {'phone_number': '0912345678'}, format='json')
        self.assertEqual(res.status_code, 410)

    def test_old_fixed_otp_no_longer_returns_token(self):
        res = self.client.post('/api/users/verify-otp/', {'phone_number': '0912345678', 'otp_code': '8888'},
                               format='json')
        self.assertEqual(res.status_code, 410)
        self.assertNotIn('reset_token', res.json())
