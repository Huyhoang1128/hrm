"""
hrm/test_online_work_deadline_exception_bypass.py
══════════════════════════════════════════════════
Bug thực tế (2026-09-15, HCNS báo): HCNS "mở khoá đặc biệt"
(DeadlineExceptionGrant, request_type=ONLINE_WORK) cho đúng nhân viên/ngày ở
trang Quản lý đơn, nhưng nhân viên đó tự tạo đơn Làm việc online cho đúng
ngày/loại đã mở khoá thì VẪN bị chặn "Đã quá hạn tạo đơn Online".

Nguyên nhân: khối khoá hạn trong OnlineWorkRequestViewSet.create()
(hrm/registration_views.py) chỉ bỏ qua hạn khi CHÍNH HCNS/Admin là người bấm
tạo hộ (`is_admin_or_hr_creator`) — không hề gọi
`deadline_exception_models.has_deadline_exception()` để kiểm tra bảng
DeadlineExceptionGrant, khác với mọi khối khoá hạn tạo đơn khác (OVERTIME ở
RegistrationRequestCreateSerializer.validate(), UNAUTHORIZED_ABSENCE cùng
chỗ, LEAVE ở taodon_views.py, CA2 ở shift_registration_views.py) đều đã kiểm
tra đúng "mở khoá đặc biệt" trước khi báo lỗi quá hạn.

Test này không cần DB thật (SimpleTestCase, mock hết DB access) — chỉ xác
nhận has_deadline_exception() được gọi đúng employee/ngày/loại "ONLINE_WORK",
và khi nó trả True thì request KHÔNG bị chặn dù đã quá hạn.
"""
from datetime import date, time, timedelta
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.registration_views import OnlineWorkRequestViewSet


def _fake_request(data, is_staff=False, is_superuser=False):
    request = MagicMock()
    request.data = data
    request.user = MagicMock(is_staff=is_staff, is_superuser=is_superuser)
    return request


class OnlineWorkDeadlineExceptionBypassTests(SimpleTestCase):
    def _make_view(self):
        return OnlineWorkRequestViewSet()

    def _patched_create(self, request, *, has_exception, past_deadline=True):
        """Chạy view.create() với mọi phụ thuộc DB/thời gian đã mock, chỉ để
        lại logic khoá hạn thật để kiểm tra."""
        fake_employee = MagicMock()
        fake_employee.id = 42

        deadline_value = (
            timezone.now() - timedelta(hours=1)
            if past_deadline
            else timezone.now() + timedelta(hours=999)
        )

        with patch("hrm.registration_views.OnlineWorkRequestViewSet.assert_not_locked", return_value=None), \
             patch("hrm.registration_views.Employee") as mock_employee_cls, \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views.OnlineWorkRequestViewSet._get_approver", return_value=None), \
             patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_utils.get_shift_start_time", return_value=time(8, 30)), \
             patch("hrm.deadline_utils.hours_before_deadline", return_value=deadline_value), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=has_exception) as mock_has_exc, \
             patch("hrm.registration_views.OnlineWorkEventCreateSerializer") as mock_serializer_cls:
            mock_employee_cls.objects.filter.return_value.first.return_value = fake_employee
            mock_serializer = MagicMock()
            mock_serializer.is_valid.return_value = True
            mock_serializer.save.return_value = MagicMock()
            mock_serializer_cls.return_value = mock_serializer

            with patch("hrm.registration_views.serialize_registration_event", return_value={"id": 1}):
                view = self._make_view()
                result = view.create(request)

        return result, mock_has_exc

    def test_blocked_without_deadline_exception_grant(self):
        """Hành vi gốc: quá hạn, KHÔNG có mở khoá -> vẫn bị chặn 400."""
        request = _fake_request({
            "employee_id": 42,
            "work_date": "2026-09-15",
            "reason": "ốm",
        })
        result, mock_has_exc = self._patched_create(request, has_exception=False)

        self.assertEqual(result.status_code, 400)
        self.assertIn("Đã quá hạn tạo đơn Online", result.data.get("error", ""))

    def test_bypassed_when_deadline_exception_granted(self):
        """Bug đã sửa: HCNS mở khoá ONLINE_WORK đúng NV/ngày -> KHÔNG bị chặn
        dù đã quá hạn, và nhân viên (không phải HCNS/Admin) là người tự tạo."""
        request = _fake_request({
            "employee_id": 42,
            "work_date": "2026-09-15",
            "reason": "ốm",
        })
        result, mock_has_exc = self._patched_create(request, has_exception=True)

        # Không còn bị chặn ở khối khoá hạn (đi tiếp tới serializer.save() giả
        # -> trả về response 201 do serialize_registration_event mock).
        self.assertNotEqual(getattr(result, "status_code", None), 400)

        # Phải gọi đúng has_deadline_exception(employee, work_date, "ONLINE_WORK")
        mock_has_exc.assert_called_once()
        args = mock_has_exc.call_args.args
        self.assertEqual(args[1], date(2026, 9, 15))
        self.assertEqual(args[2], "ONLINE_WORK")

    def test_grant_check_skipped_when_admin_or_hr_creates(self):
        """HCNS/Admin tự tạo hộ: đã có nhánh bypass riêng
        (is_admin_or_hr_creator) từ trước — has_deadline_exception không cần
        gọi trong trường hợp này (khối khoá hạn bị bỏ qua hoàn toàn)."""
        request = _fake_request(
            {"employee_id": 42, "work_date": "2026-09-15", "reason": "ốm"},
            is_staff=True,
        )
        result, mock_has_exc = self._patched_create(request, has_exception=False)

        mock_has_exc.assert_not_called()
        self.assertNotEqual(getattr(result, "status_code", None), 400)
