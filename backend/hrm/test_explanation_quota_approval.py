"""
hrm/test_explanation_quota_approval.py
════════════════════════════════════════
Tests cho việc chặn/không chặn duyệt đơn giải trình khi đã hết hạn mức
tháng (AttendanceExplanationViewSet.approve(), _get_quota_used() ở
stats_utils.py):

  - LATE/EARLY_LEAVE/LATE_EARLY: PHẢI bị chặn (400, quota_exceeded=True)
    khi duyệt sẽ vượt hạn mức — các loại này chỉ xoá phạt tiền (nhị phân,
    không có "giảm nhẹ"), nên hết hạn mức thì phải chặn hẳn.
  - INCOMPLETE_ATTENDANCE (Quên chấm công): KHÔNG BAO GIỜ bị chặn duyệt dù
    đã hết hạn mức — đây là rule đã có sẵn ở smart_bulk_approve() (is_forget
    luôn approve) và engine tính công (is_over_quota giảm còn 0.5 công thay
    vì 1.0, xem main_api.py) — chặn duyệt ở đây sẽ khiến NV mất TRẮNG cả
    công (0 thay vì 0.5), tệ hơn cả trước khi có hạn mức.
"""
from datetime import date

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee

from .event_models import EmployeeEvent


def _approve_url(event_id):
    return f"/api-hrm/attendance-explanations/{event_id}/approve/"


class ExplanationQuotaApprovalTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="quota_admin", is_staff=True)
        # is_admin (is_staff) đi qua nhánh duyệt ngay lập tức trong approve(), nhưng
        # _get_current_employee() vẫn bắt buộc approver phải có Employee profile.
        self.admin_employee = Employee.objects.create(
            user=self.admin_user, employee_id="QUOTA_ADMIN", full_name="Admin duyệt",
        )
        self.emp_user = User.objects.create_user(username="quota_emp")
        self.employee = Employee.objects.create(
            user=self.emp_user, employee_id="QUOTA_NV", full_name="NV hạn mức giải trình",
        )
        self.client.force_authenticate(self.admin_user)

    def _create_explanation(self, explanation_type, event_date, approved=False):
        data = {'explanation_type': explanation_type, 'status': 'APPROVED' if approved else 'PENDING'}
        return EmployeeEvent.objects.create(
            employee=self.employee,
            event_date=event_date,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data=data,
        )

    def _use_up_quota_with_late(self, month_date, count=3):
        """Tạo sẵn N đơn LATE đã APPROVED trong tháng — mô phỏng đã dùng hết hạn mức."""
        for day in range(1, count + 1):
            self._create_explanation('LATE', month_date.replace(day=day), approved=True)

    def test_4th_late_explanation_is_blocked(self):
        month = date(2026, 8, 1)
        self._use_up_quota_with_late(month, count=3)
        fourth = self._create_explanation('LATE', date(2026, 8, 20))

        resp = self.client.post(_approve_url(fourth.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(resp.data.get('quota_exceeded'))
        fourth.refresh_from_db()
        self.assertEqual(fourth.data.get('status'), 'PENDING')

    def test_4th_early_leave_explanation_is_blocked(self):
        month = date(2026, 8, 1)
        self._use_up_quota_with_late(month, count=3)
        fourth = self._create_explanation('EARLY_LEAVE', date(2026, 8, 20))

        resp = self.client.post(_approve_url(fourth.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(resp.data.get('quota_exceeded'))

    def test_4th_incomplete_attendance_is_still_approved(self):
        """Bug đã sửa: trước đây bị chặn giống LATE/EARLY_LEAVE — khiến NV mất
        trắng công. Đúng rule: vẫn phải duyệt được (engine tự giảm còn 0.5 công)."""
        month = date(2026, 8, 1)
        self._use_up_quota_with_late(month, count=3)
        fourth = self._create_explanation('INCOMPLETE_ATTENDANCE', date(2026, 8, 20))

        resp = self.client.post(_approve_url(fourth.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        fourth.refresh_from_db()
        self.assertEqual(fourth.data.get('status'), 'APPROVED')

    def test_3rd_late_explanation_within_quota_is_approved(self):
        month = date(2026, 8, 1)
        self._use_up_quota_with_late(month, count=2)  # đã dùng 2/3
        third = self._create_explanation('LATE', date(2026, 8, 20))

        resp = self.client.post(_approve_url(third.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        third.refresh_from_db()
        self.assertEqual(third.data.get('status'), 'APPROVED')

    def test_business_trip_exempt_type_never_blocked(self):
        """BUSINESS_TRIP/FIRST_DAY/WORK_FROM_HOME miễn hạn mức hoàn toàn —
        không nằm trong _QUOTA_SUBJECT_TYPES nên không bao giờ bị chặn."""
        month = date(2026, 8, 1)
        self._use_up_quota_with_late(month, count=3)
        trip = self._create_explanation('BUSINESS_TRIP', date(2026, 8, 20))

        resp = self.client.post(_approve_url(trip.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
