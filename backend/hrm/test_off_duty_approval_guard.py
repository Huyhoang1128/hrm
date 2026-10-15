"""
hrm/test_off_duty_approval_guard.py
════════════════════════════════════════
Đơn "Ra trực" (OFF_DUTY) khi duyệt được tính THẲNG 1 công (xem
_evaluate_overtime_rule ở main_api.py) và KHÔNG bị giới hạn số lượng/tháng
như đơn giải trình (tối đa 3 đơn/tháng) — lỗ hổng: NV có thể tạo nhiều đơn
Ra trực thay vì chấm công thật để lấy công dễ dàng, không tốn lượt giải
trình nào.

Rule mới (RegistrationRequestViewSet.approve()/bulk_approve(),
_off_duty_approval_block_reason() ở registration_views.py): chỉ duyệt được
đơn Ra trực nếu:
  1. Ngày đó ĐÃ có chấm công thật (check_in hoặc check_out), HOẶC
  2. Ngày đó có 1 đơn "Quên chấm công" (INCOMPLETE_ATTENDANCE) ĐÃ ĐƯỢC DUYỆT
     cho đúng ngày đó (tức là vẫn phải tốn 1 lượt giải trình/tháng).
Nếu không thoả điều kiện nào -> chặn duyệt (400).
"""
from datetime import date, time

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee

from .event_models import EmployeeEvent


def _approve_url(event_id):
    return f"/api-hrm/registration-requests/{event_id}/approve/"


class OffDutyApprovalGuardTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="offduty_admin", is_staff=True)
        self.admin_employee = Employee.objects.create(
            user=self.admin_user, employee_id="OFFDUTY_ADMIN", full_name="Admin duyệt",
        )
        self.emp_user = User.objects.create_user(username="offduty_emp")
        self.employee = Employee.objects.create(
            user=self.emp_user, employee_id="OFFDUTY_NV", full_name="NV Ra trực",
        )
        self.client.force_authenticate(self.admin_user)
        self.the_date = date(2026, 8, 20)

    def _create_off_duty(self):
        return EmployeeEvent.objects.create(
            employee=self.employee,
            event_date=self.the_date,
            event_type=EmployeeEvent.EventType.OFF_DUTY,
            check_in=time(8, 30),
            check_out=time(17, 30),
            data={"registration_type": "OFF_DUTY", "status": "PENDING", "reason": ""},
        )

    def _create_attendance(self, check_in=None, check_out=None):
        EmployeeEvent.objects.create(
            employee=self.employee,
            event_date=self.the_date,
            event_type=EmployeeEvent.EventType.ATTENDANCE,
            check_in=check_in,
            check_out=check_out,
        )

    def _create_incomplete_attendance_explanation(self, approved: bool):
        EmployeeEvent.objects.create(
            employee=self.employee,
            event_date=self.the_date,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data={
                "explanation_type": "INCOMPLETE_ATTENDANCE",
                "status": "APPROVED" if approved else "PENDING",
            },
        )

    def test_blocked_when_no_attendance_and_no_explanation(self):
        """Lỗ hổng bị chặn: không chấm công, không đơn quên chấm công nào."""
        off_duty = self._create_off_duty()

        resp = self.client.post(_approve_url(off_duty.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        off_duty.refresh_from_db()
        self.assertEqual(off_duty.data.get("status"), "PENDING")

    def test_allowed_when_has_check_in(self):
        self._create_attendance(check_in=time(8, 30))
        off_duty = self._create_off_duty()

        resp = self.client.post(_approve_url(off_duty.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_allowed_when_has_check_out_only(self):
        self._create_attendance(check_out=time(17, 30))
        off_duty = self._create_off_duty()

        resp = self.client.post(_approve_url(off_duty.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_allowed_when_approved_incomplete_attendance_explanation_exists(self):
        self._create_incomplete_attendance_explanation(approved=True)
        off_duty = self._create_off_duty()

        resp = self.client.post(_approve_url(off_duty.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_blocked_when_incomplete_attendance_explanation_still_pending(self):
        """Đơn quên chấm công tồn tại nhưng CHƯA được duyệt -> vẫn chặn (chưa
        thực sự tốn lượt giải trình nào)."""
        self._create_incomplete_attendance_explanation(approved=False)
        off_duty = self._create_off_duty()

        resp = self.client.post(_approve_url(off_duty.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_approve_blocks_off_duty_without_attendance_or_explanation(self):
        off_duty = self._create_off_duty()

        resp = self.client.post(
            "/api-hrm/registration-requests/bulk_approve/",
            {"ids": [off_duty.id]},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data.get("success_count"), 0)
        self.assertEqual(resp.data.get("error_count"), 1)
        off_duty.refresh_from_db()
        self.assertEqual(off_duty.data.get("status"), "PENDING")
