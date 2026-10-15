"""
hrm/test_duyet_don_missing_event_types.py
══════════════════════════════════════════
Bug: QLTT không thấy đơn "Nghỉ không phép" của nhân viên ở mục Phê duyệt dù
đơn đã tạo đúng và employee.manager trỏ đúng QLTT (đã xác minh bằng lệnh
diagnose_unauthorized_absence_status trên dữ liệu thật).

Nguyên nhân: DuyetDonAPIView._base_qs() (hrm/duyet_don_views.py) lọc
event_type__in=DUYET_DON_EVENT_TYPES ngay từ đầu — danh sách này thiếu
UNAUTHORIZED_ABSENCE và SHIFT_CHANGE (2 registration_type hợp lệ khác,
xem REGISTRATION_TYPE_TO_EVENT_TYPE ở registration_serializers.py) — nên
CẢ 2 loại đơn này hoàn toàn không xuất hiện ở /api-hrm/duyet-don/ cho bất
kỳ ai, kể cả admin xem tất cả, không liên quan gì tới phân quyền theo
manager.
"""
from datetime import date

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee

from .event_models import EmployeeEvent

DUYET_DON_URL = "/api-hrm/duyet-don/"


class DuyetDonIncludesUnauthorizedAbsenceAndShiftChangeTests(APITestCase):
    def setUp(self):
        self.mgr_user = User.objects.create_user(username="duyetdon_mgr")
        self.manager = Employee.objects.create(
            user=self.mgr_user, employee_id="DUYETDON_MGR", full_name="QLTT Test",
        )
        self.emp_user = User.objects.create_user(username="duyetdon_emp")
        self.employee = Employee.objects.create(
            user=self.emp_user, employee_id="DUYETDON_NV", full_name="NV Test",
            manager=self.manager,
        )
        self.the_date = date(2026, 9, 7)

    def _create_event(self, event_type, registration_type):
        return EmployeeEvent.objects.create(
            employee=self.employee,
            event_date=self.the_date,
            event_type=event_type,
            data={
                "registration_type": registration_type,
                "status": "PENDING",
                "request_code": f"TEST-{registration_type}",
                "reason": "test",
            },
        )

    def test_manager_sees_pending_unauthorized_absence_of_direct_report(self):
        event = self._create_event(EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE, "UNAUTHORIZED_ABSENCE")

        self.client.force_authenticate(self.mgr_user)
        response = self.client.get(DUYET_DON_URL, {"status": "PENDING"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in response.data.get("results", response.data)]
        self.assertIn(
            event.id, ids,
            "Đơn UNAUTHORIZED_ABSENCE PENDING của cấp dưới trực tiếp phải hiện ở "
            "mục phê duyệt của QLTT, nhưng KHÔNG có trong response."
        )

    def test_manager_sees_pending_shift_change_of_direct_report(self):
        event = self._create_event(EmployeeEvent.EventType.SHIFT_CHANGE, "SHIFT_CHANGE")

        self.client.force_authenticate(self.mgr_user)
        response = self.client.get(DUYET_DON_URL, {"status": "PENDING"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in response.data.get("results", response.data)]
        self.assertIn(
            event.id, ids,
            "Đơn SHIFT_CHANGE PENDING của cấp dưới trực tiếp phải hiện ở mục "
            "phê duyệt của QLTT, nhưng KHÔNG có trong response."
        )

    def test_admin_sees_pending_unauthorized_absence_too(self):
        """Không phải lỗi phân quyền theo manager — admin xem-tất-cả cũng phải thấy."""
        event = self._create_event(EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE, "UNAUTHORIZED_ABSENCE")

        admin_user = User.objects.create_user(username="duyetdon_admin", is_superuser=True)
        self.client.force_authenticate(admin_user)
        response = self.client.get(DUYET_DON_URL, {"status": "PENDING"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in response.data.get("results", response.data)]
        self.assertIn(event.id, ids)
