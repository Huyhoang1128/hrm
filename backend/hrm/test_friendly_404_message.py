"""
hrm/test_friendly_404_message.py
══════════════════════════════════
QLTT báo khi bấm PHÊ DUYỆT/TỪ CHỐI 1 đơn (đôi khi cả các loại đơn khác)
đang thấy hộp thoại lỗi "No EmployeeEvent matches the given query." — đây
là message kỹ thuật gốc của Django khi get_object_or_404() không tìm thấy
bản ghi (thường do danh sách trên UI đã cũ — người khác đã xử lý/xoá đơn đó
trong lúc quản lý đang xem trang). DRF mặc định forward NGUYÊN VĂN message
này ra response (xem rest_framework.views.exception_handler: Http404 ->
NotFound(*exc.args)) — sửa bằng 1 EXCEPTION_HANDLER chung ở
config/exception_handlers.py, áp dụng cho MỌI endpoint, không riêng gì
registration-requests.
"""
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee


class Friendly404MessageTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="f404_admin", is_staff=True, is_superuser=True)
        Employee.objects.create(user=self.admin_user, employee_id="F404_ADMIN", full_name="Admin")
        self.client.force_authenticate(self.admin_user)

    def test_approve_nonexistent_registration_request_returns_friendly_message(self):
        response = self.client.post("/api-hrm/registration-requests/999999999/approve/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        detail = response.data.get("detail", "")
        self.assertNotIn(
            "No EmployeeEvent matches the given query", detail,
            "Vẫn lộ message kỹ thuật gốc của Django ra ngoài cho người dùng."
        )
        self.assertIn("tải lại trang", detail)

    def test_reject_nonexistent_registration_request_returns_friendly_message(self):
        response = self.client.post("/api-hrm/registration-requests/999999999/reject/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        detail = response.data.get("detail", "")
        self.assertNotIn("No EmployeeEvent matches the given query", detail)
