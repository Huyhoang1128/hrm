"""
hrm/test_salary_advance_creation_lock.py
═════════════════════════════════════════
Tests cho công tắc khoá/mở khoá "tạo đơn tạm ứng lương ngoài ngày 1-3"
(SalaryAdvanceCreationLock, GenericRequestViewSet.creation_lock,
_validate_salary_advance ở serializers.py):
  - Mặc định (chưa ai đụng vào): chỉ tạo được đơn ngày 1-3, y hệt rule cũ.
  - Admin mở khoá: tạo được đơn ngoài ngày 1-3, CHỈ trong tháng lúc mở.
  - Sang tháng mới: tự động coi như đã khoá lại (is_effectively_locked()),
    không cần Admin nhớ khoá tay.
"""
from datetime import date, datetime
from unittest.mock import patch

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee

from .models import SalaryAdvanceCreationLock

GENERIC_REQUESTS_URL = "/api-hrm/generic-requests/"
CREATION_LOCK_URL = "/api-hrm/generic-requests/creation-lock/"


def _aware(y, m, d, hh=10):
    dt = datetime(y, m, d, hh, 0, 0)
    if timezone.is_naive(dt):
        return timezone.make_aware(dt)
    return dt


class SalaryAdvanceCreationLockModelTests(APITestCase):
    def test_default_lock_is_locked_true(self):
        lock = SalaryAdvanceCreationLock.get_solo()
        self.assertTrue(lock.is_locked)
        self.assertTrue(lock.is_effectively_locked())

    def test_effectively_locked_true_while_is_locked_true(self):
        lock = SalaryAdvanceCreationLock.get_solo()
        lock.is_locked = True
        lock.save()
        self.assertTrue(lock.is_effectively_locked())

    def test_unlocked_same_month_is_effectively_unlocked(self):
        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 10)):
            lock = SalaryAdvanceCreationLock.get_solo()
            lock.is_locked = False
            lock.save()  # updated_at (auto_now) = 2026-08-10

        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 25)):
            lock.refresh_from_db()
            self.assertFalse(lock.is_effectively_locked())

    def test_unlocked_previous_month_auto_relocks(self):
        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 10)):
            lock = SalaryAdvanceCreationLock.get_solo()
            lock.is_locked = False
            lock.save()  # updated_at = 2026-08-10 -> mở khoá cho tháng 8

        # Sang tháng 9 — KHÔNG ai đụng vào lock — phải tự coi như đã khoá lại.
        with patch.object(timezone, 'now', return_value=_aware(2026, 9, 5)):
            lock.refresh_from_db()
            self.assertTrue(lock.is_effectively_locked())


class CreationLockEndpointTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="lock_admin", is_staff=True)
        self.staff_user = User.objects.create_user(username="lock_staff")

    def test_get_visible_to_any_authenticated_user(self):
        self.client.force_authenticate(self.staff_user)
        resp = self.client.get(CREATION_LOCK_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["is_locked"])  # default

    def test_non_admin_cannot_toggle(self):
        self.client.force_authenticate(self.staff_user)
        resp = self.client.post(CREATION_LOCK_URL, {"is_locked": False}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_unlock_and_get_reflects_it(self):
        self.client.force_authenticate(self.admin_user)
        resp = self.client.post(CREATION_LOCK_URL, {"is_locked": False}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["is_locked"])
        self.assertEqual(resp.data["updated_by_name"], self.admin_user.username)

        resp2 = self.client.get(CREATION_LOCK_URL)
        self.assertFalse(resp2.data["is_locked"])

    def test_missing_is_locked_field_returns_400(self):
        self.client.force_authenticate(self.admin_user)
        resp = self.client.post(CREATION_LOCK_URL, {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class SalaryAdvanceCreationWindowTests(APITestCase):
    """Tích hợp đầy đủ qua API tạo đơn (POST /api-hrm/generic-requests/)."""

    def setUp(self):
        self.admin_user = User.objects.create_user(username="sa_admin", is_staff=True)
        self.emp_user = User.objects.create_user(username="sa_emp")
        self.employee = Employee.objects.create(
            user=self.emp_user, employee_id="SA_LOCK_NV", full_name="NV tạm ứng",
            employment_status="ACTIVE", contract_type="INDEFINITE", basic_salary=10_000_000,
        )

    def _create_payload(self):
        return {
            "request_type": "SALARY_ADVANCE",
            "title": "Tạm ứng lương 1.000.000đ",
            "reason": "Đơn tạm ứng lương theo quy định công ty.",
            "extra_data": {"amount": 1_000_000},
        }

    def test_blocked_outside_window_by_default(self):
        self.client.force_authenticate(self.emp_user)
        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 10)):
            resp = self.client.post(GENERIC_REQUESTS_URL, self._create_payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_allowed_inside_window_by_default(self):
        self.client.force_authenticate(self.emp_user)
        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 2)):
            resp = self.client.post(GENERIC_REQUESTS_URL, self._create_payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_allowed_outside_window_when_unlocked_same_month(self):
        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 10)):
            lock = SalaryAdvanceCreationLock.get_solo()
            lock.is_locked = False
            lock.save()

            self.client.force_authenticate(self.emp_user)
            resp = self.client.post(GENERIC_REQUESTS_URL, self._create_payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_unlock_does_not_carry_over_to_next_month(self):
        # Admin mở khoá trong tháng 8...
        with patch.object(timezone, 'now', return_value=_aware(2026, 8, 10)):
            lock = SalaryAdvanceCreationLock.get_solo()
            lock.is_locked = False
            lock.save()

        # ...nhưng KHÔNG ai đụng vào lock nữa — sang tháng 9 ngày 10 (ngoài
        # 1-3) vẫn PHẢI bị chặn vì override đã tự hết hiệu lực.
        self.client.force_authenticate(self.emp_user)
        with patch.object(timezone, 'now', return_value=_aware(2026, 9, 10)):
            resp = self.client.post(GENERIC_REQUESTS_URL, self._create_payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


def _aware_hm(y, m, d, hh, mm):
    return timezone.make_aware(datetime(y, m, d, hh, mm, 0))


class SalaryAdvanceCreationCutoffTests(APITestCase):
    """Khung tạo đơn mới (2026-10-03): 00:00 ngày 1 đến 15:30 ngày 3, giờ VN."""

    def _open(self, *args):
        from .serializers import GenericRequestSerializer
        return GenericRequestSerializer.is_salary_advance_creation_window_open(_aware_hm(*args))

    def test_day_3_until_1530_is_open(self):
        self.assertTrue(self._open(2026, 10, 3, 9, 0))
        self.assertTrue(self._open(2026, 10, 3, 15, 30))

    def test_day_3_after_1530_is_closed(self):
        self.assertFalse(self._open(2026, 10, 3, 15, 31))
        self.assertFalse(self._open(2026, 10, 3, 23, 59))

    def test_uses_local_time_not_utc(self):
        # 03:00 ngày 1 giờ VN = 20:00 ngày cuối tháng trước theo UTC -> vẫn phải mở.
        self.assertTrue(self._open(2026, 10, 1, 3, 0))
        # 03:00 ngày 4 giờ VN = 20:00 ngày 3 theo UTC -> phải khoá.
        self.assertFalse(self._open(2026, 10, 4, 3, 0))

    def test_api_blocks_after_cutoff_and_reports_window(self):
        user = User.objects.create_user(username="sa_cutoff")
        Employee.objects.create(
            user=user, employee_id="SA_CUTOFF_NV", full_name="NV",
            employment_status="ACTIVE", contract_type="INDEFINITE", basic_salary=10_000_000,
        )
        self.client.force_authenticate(user)
        payload = {"request_type": "SALARY_ADVANCE", "title": "Tạm ứng", "reason": "x", "extra_data": {"amount": 1_000_000}}
        with patch.object(timezone, 'now', return_value=_aware_hm(2026, 10, 3, 15, 45)):
            self.assertFalse(self.client.get(CREATION_LOCK_URL).data['window_open'])
            resp = self.client.post(GENERIC_REQUESTS_URL, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('15h30', str(resp.data))
        with patch.object(timezone, 'now', return_value=_aware_hm(2026, 10, 3, 15, 0)):
            self.assertTrue(self.client.get(CREATION_LOCK_URL).data['window_open'])
            resp = self.client.post(GENERIC_REQUESTS_URL, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
