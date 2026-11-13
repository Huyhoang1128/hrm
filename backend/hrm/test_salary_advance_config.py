"""
GET /api-hrm/salary-advance/config/ — API cấu hình tạm ứng lương DUY NHẤT (web / app đọc từ đây, không tự
ghi số). Đổi hằng số SALARY_ADVANCE_* ở backend thì API, câu báo lỗi và khung duyệt đổi theo.
"""
from datetime import datetime
from unittest.mock import patch

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import Employee

from .serializers import GenericRequestSerializer as S
from .views import GenericRequestViewSet

CONFIG_URL = '/api-hrm/salary-advance/config/'


def _local(y, m, d, hh=10, mm=0):
    return timezone.make_aware(datetime(y, m, d, hh, mm))


class SalaryAdvanceConfigApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='nv_cfg', password='x')
        Employee.objects.create(user=self.user, employee_id='CFG001', full_name='NV Cfg',
                                basic_salary=4_000_000, contract_type='SIX_MONTH', employment_status='ACTIVE')
        self.client.force_authenticate(self.user)

    def test_returns_rules_from_backend_constants(self):
        with patch.object(timezone, 'now', return_value=_local(2026, 11, 2)):
            data = self.client.get(CONFIG_URL).json()
        self.assertEqual((data['max_amount'], data['max_ratio'], data['max_ratio_percent']), (5_000_000, 0.8, 80))
        self.assertEqual([c['id'] for c in data['official_contracts']],
                         ['SIX_MONTH', 'ONE_YEAR', 'TWO_YEAR', 'THREE_YEAR', 'INDEFINITE'])
        self.assertEqual(data['window'], {'enabled': True, 'first_day': 1, 'last_day': 3, 'cutoff': '15:30',
                                          'text': 'từ ngày 1 đến 15h30 ngày 3', 'open': True})
        self.assertEqual(data['approval_window']['text'], 'trong 3 ngày đầu tháng')
        self.assertEqual(data['approval_window_days'], [1, 2, 3])
        self.assertEqual(data['me']['cap'], 3_200_000)  # 80% × 4 triệu < 5 triệu
        self.assertTrue(data['me']['eligible'], data['me']['reasons'])
        # Câu điều kiện sinh từ nhãn hợp đồng — có cả HĐ 6 tháng / 36 tháng (trước ghi thiếu).
        self.assertIn('hợp đồng lao động 6 tháng', data['conditions'][0])
        self.assertIn('hợp đồng lao động 36 tháng', data['conditions'][0])

    def test_changing_constants_changes_api_and_messages(self):
        with patch.object(S, 'SALARY_ADVANCE_MAX_RATIO', 0.5), \
                patch.object(S, 'SALARY_ADVANCE_CREATE_LAST_DAY', 5), \
                patch.object(S, 'SALARY_ADVANCE_APPROVAL_LAST_DAY', 5), \
                patch.object(timezone, 'now', return_value=_local(2026, 11, 4)):
            data = self.client.get(CONFIG_URL).json()
            self.assertEqual(data['max_ratio_percent'], 50)
            self.assertEqual(data['window']['text'], 'từ ngày 1 đến 15h30 ngày 5')
            self.assertTrue(data['window']['open'])
            self.assertEqual(data['approval_window_days'], [1, 2, 3, 4, 5])
            self.assertEqual(data['me']['cap'], 2_000_000)
            res = self.client.post('/api-hrm/generic-requests/', {
                'request_type': 'SALARY_ADVANCE', 'title': 'Tạm ứng', 'reason': 'Cần tiền',
                'extra_data': {'amount': 2_500_000},
            }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('50% lương cơ bản', str(res.data))

    def test_approval_window_uses_local_time(self):
        self.assertFalse(S.is_salary_advance_approval_window_open(_local(2026, 11, 4, 1)))
        self.assertTrue(S.is_salary_advance_approval_window_open(_local(2026, 11, 1, 1)))

    def test_approve_outside_window_message_follows_constant(self):
        class _Req:
            request_type = 'SALARY_ADVANCE'

        with patch.object(S, 'SALARY_ADVANCE_APPROVAL_LAST_DAY', 2), \
                patch.object(timezone, 'now', return_value=_local(2026, 11, 3)):
            res = GenericRequestViewSet()._check_salary_advance_window(_Req())
        self.assertEqual(res.status_code, 400)
        self.assertIn('trong 2 ngày đầu tháng', res.data['error'])
