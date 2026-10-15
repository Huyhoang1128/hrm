"""
hrm/test_explanation_approve_idempotency.py
════════════════════════════════════════════
Bug: AttendanceExplanationViewSet.approve() (và reject()) không kiểm tra
trạng thái HIỆN TẠI của đơn trước khi xử lý — gọi lại approve() trên 1 đơn
ĐÃ Ở TRẠNG THÁI CUỐI (APPROVED/REJECTED) vẫn chạy lại toàn bộ logic duyệt,
tạo thêm 1 EmployeeEvent EXPLANATION_APPROVAL mới. Nếu 2 lần duyệt đến từ
2 vai trò khác nhau (vd: "Duyệt nhanh hàng loạt" bởi ADMIN rồi duyệt lại
thủ công bởi HR), 2 event này có approval_level KHÁC NHAU ('ADMIN' vs
'HR') nên dedup theo (approved_for_event_id, approval_level) ở
main_api.py replay_month() không bắt được — hiệu ứng duyệt (xoá phạt, +1
lượt hạn mức giải trình) bị tính 2 LẦN cho đúng 1 đơn, khiến "HẠN MỨC
GIẢI TRÌNH" hiển thị số đã dùng cao hơn số đơn thực tế đã duyệt (vd: 6/3
dù chỉ có 4 đơn).

Fix: approve()/reject() giờ từ chối xử lý nếu đơn đã APPROVED/REJECTED.
"""
from datetime import date

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee

from .event_models import EmployeeEvent


def _approve_url(event_id):
    return f"/api-hrm/attendance-explanations/{event_id}/approve/"


def _reject_url(event_id):
    return f"/api-hrm/attendance-explanations/{event_id}/reject/"


class ExplanationApproveIdempotencyTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="idem_admin", is_staff=True)
        self.admin_employee = Employee.objects.create(
            user=self.admin_user, employee_id="IDEM_ADMIN", full_name="Admin duyệt",
        )
        self.emp_user = User.objects.create_user(username="idem_emp")
        self.employee = Employee.objects.create(
            user=self.emp_user, employee_id="IDEM_NV", full_name="NV chống duyệt trùng",
        )
        self.client.force_authenticate(self.admin_user)

    def _create_explanation(self, explanation_type="LATE", event_date=None):
        return EmployeeEvent.objects.create(
            employee=self.employee,
            event_date=event_date or date(2026, 8, 20),
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data={'explanation_type': explanation_type, 'status': 'PENDING'},
        )

    def test_approving_twice_is_rejected_second_time(self):
        exp = self._create_explanation()

        first = self.client.post(_approve_url(exp.id), {}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        second = self.client.post(_approve_url(exp.id), {}, format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_approving_twice_does_not_create_duplicate_approval_event(self):
        """Trọng tâm của bug: dù có bấm duyệt 2 lần, chỉ được có ĐÚNG 1
        EmployeeEvent EXPLANATION_APPROVAL cấp FINAL (HR/ADMIN) tham chiếu
        đến đơn này — tránh double-count hiệu ứng duyệt khi replay_month."""
        exp = self._create_explanation()

        self.client.post(_approve_url(exp.id), {}, format="json")
        self.client.post(_approve_url(exp.id), {}, format="json")  # lần 2, phải bị chặn

        final_approvals = EmployeeEvent.objects.filter(
            event_type=EmployeeEvent.EventType.EXPLANATION_APPROVAL,
            data__approved_for_event_id=exp.id,
            data__action='APPROVE',
            data__approval_level__in=['HR', 'ADMIN'],
        )
        self.assertEqual(final_approvals.count(), 1)

    def test_rejecting_an_already_approved_explanation_is_blocked(self):
        exp = self._create_explanation()
        self.client.post(_approve_url(exp.id), {}, format="json")

        resp = self.client.post(_reject_url(exp.id), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        exp.refresh_from_db()
        self.assertEqual(exp.data.get('status'), 'APPROVED')

    def test_rejecting_twice_is_rejected_second_time(self):
        exp = self._create_explanation()
        first = self.client.post(_reject_url(exp.id), {}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        second = self.client.post(_reject_url(exp.id), {}, format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
