"""
hrm/test_online_work_request_finalization_lock.py
════════════════════════════════════════════════════
Bug thực tế: khối "Kiểm tra khóa chốt công" đầu OnlineWorkRequestViewSet.create()
(hrm/registration_views.py) đọc request.data.get('attendance_date') — nhưng
OnlineWorkEventCreateSerializer / frontend chỉ bao giờ gửi field 'work_date' cho đơn
Online. 'attendance_date' luôn None với request thật → `if attendance_date:` luôn
False → self.assert_not_locked() KHÔNG BAO GIỜ thực sự được gọi. Hệ quả: nút "Khóa/Mở
khóa theo NV" trên trang Chốt Công hoàn toàn không có tác dụng với đơn làm việc Online,
dù code nhìn giống hệt pattern đã hoạt động đúng ở RegistrationRequestViewSet/
AttendanceExplanationViewSet (đọc đúng field ngày của chính chúng).

Fix: đổi sang đọc 'work_date' — khớp với field mà chính khối check hạn tạo đơn Online
ngay bên dưới (dùng deadline_utils) đã dùng đúng từ trước.

Test này không cần DB thật (SimpleTestCase, mock hết mọi DB access) — chỉ xác nhận
assert_not_locked() được gọi với year/month/day suy đúng từ 'work_date', và request bị
chặn (short-circuit trả lock_resp) khi period bị khóa.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from rest_framework.response import Response
from rest_framework import status

from hrm.registration_views import OnlineWorkRequestViewSet


def _fake_request(data, is_staff=False, is_superuser=False):
    request = MagicMock()
    request.data = data
    request.user = MagicMock(is_staff=is_staff, is_superuser=is_superuser)
    return request


class OnlineWorkRequestFinalizationLockTests(SimpleTestCase):
    def _make_view(self):
        view = OnlineWorkRequestViewSet()
        return view

    @patch("hrm.registration_views.OnlineWorkRequestViewSet.assert_not_locked")
    def test_create_reads_work_date_not_attendance_date_for_lock_check(self, mock_assert_not_locked):
        """Trước fix: request.data chỉ có 'work_date' (không có 'attendance_date') ->
        assert_not_locked KHÔNG BAO GIỜ được gọi. Sau fix: phải được gọi đúng với
        year=2026, month=9, day=20 suy từ work_date."""
        # Giả lập period đang khóa -> assert_not_locked trả về 1 Response 423 (giống
        # thực tế check_finalization_lock trả về khi bị khóa) để create() short-circuit
        # ngay, tránh phải mock tiếp Employee/serializer/DB phía sau.
        locked_response = Response({"error": "FINALIZATION_LOCKED"}, status=423)
        mock_assert_not_locked.return_value = locked_response

        view = self._make_view()
        request = _fake_request({
            "work_date": "2026-09-20",
            "employee_id": None,
            "reason": "WFH",
        })

        result = view.create(request)

        mock_assert_not_locked.assert_called_once()
        _, kwargs = mock_assert_not_locked.call_args
        args = mock_assert_not_locked.call_args.args
        # assert_not_locked(d.year, d.month, request, day=d.day, allow_admin=True, employee=...)
        self.assertEqual(args[0], 2026)
        self.assertEqual(args[1], 9)
        self.assertEqual(kwargs.get("day"), 20)
        self.assertIs(result, locked_response)

    @patch("hrm.registration_views.OnlineWorkRequestViewSet._get_approver", return_value=None)
    @patch("hrm.registration_views.OnlineWorkRequestViewSet.assert_not_locked")
    def test_create_without_work_date_skips_lock_check_gracefully(self, mock_assert_not_locked, mock_get_approver):
        """Không có work_date (payload thiếu/hỏng) -> không crash, không gọi
        assert_not_locked (giữ hành vi cũ: bỏ qua kiểm tra nếu thiếu ngày, serializer
        phía sau sẽ tự validate required field)."""
        view = self._make_view()
        request = _fake_request({"reason": "WFH"})

        with patch(
            "hrm.registration_views.OnlineWorkEventCreateSerializer"
        ) as mock_serializer_cls:
            mock_serializer = MagicMock()
            mock_serializer.is_valid.return_value = True
            mock_serializer.save.return_value = MagicMock()
            mock_serializer_cls.return_value = mock_serializer

            with patch(
                "hrm.registration_views.serialize_registration_event",
                return_value={"id": 1},
            ):
                view.create(request)

        mock_assert_not_locked.assert_not_called()
