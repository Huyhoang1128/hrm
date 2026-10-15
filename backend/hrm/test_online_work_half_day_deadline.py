"""
hrm/test_online_work_half_day_deadline.py
══════════════════════════════════════════
Bug thực tế (2026-09-26, báo bởi Kế toán qua chat): tạo đơn "Làm việc online
chiều" vào buổi CHIỀU cùng ngày bị chặn "Đã quá hạn tạo đơn Online (phải tạo
trước 06:30 26/09/2026...)" — mốc 06:30 suy từ ca SÁNG (08:30 - 2h), dù nhân
sự chọn rõ ràng buổi CHIỀU.

Nguyên nhân: cả 2 nơi khoá hạn đơn Online (OnlineWorkRequestViewSet.create()
và _check_online_work_approve_deadline(), hrm/registration_views.py) LUÔN gọi
`get_shift_start_time(..., half='FULL')` — tức luôn lấy ca SỚM NHẤT trong
ngày — bất kể nhân sự chọn "Làm online sáng"/"chiều"/"cả ngày". Với nhân viên
có ca sáng + ca chiều liền trong ngày (vd hành chính 08h30-17h30 là 1 ca dài,
hoặc 2 ca sáng/chiều tách rời), hạn luôn bị tính theo giờ vào ca SÁNG, nên
đơn buổi CHIỀU gửi giữa trưa/đầu giờ chiều bị chặn nhầm dù thực tế vẫn còn đủ
2 giờ trước giờ bắt đầu ca CHIỀU.

LEAVE/BUSINESS_TRIP (taodon_views.py) đã xử lý đúng từ trước bằng field
`half_day_period` tường minh (fallback qua chữ "chiều" trong `reason` cho đơn
cũ) — ONLINE_WORK là chỗ duy nhất còn sót lại dùng 'FULL' cứng. Fix: thêm
_resolve_online_work_half() dùng đúng pattern đó, áp cho cả 2 nơi.

Test này không cần DB thật (SimpleTestCase, mock hết DB/thời gian access).
"""
from datetime import date, time, timedelta
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.registration_views import OnlineWorkRequestViewSet, _resolve_online_work_half


class ResolveOnlineWorkHalfTests(SimpleTestCase):
    def test_không_phải_nửa_ngày_thì_luôn_FULL(self):
        """Đơn cả ngày/checkpage (expected_status != HALF_DAY) giữ nguyên
        hành vi cũ — lấy ca sớm nhất trong ngày, không đổi."""
        self.assertEqual(
            _resolve_online_work_half({"expected_status": "ABSENT", "reason": "Làm online chiều"}),
            "FULL",
        )
        self.assertEqual(_resolve_online_work_half({}), "FULL")
        self.assertEqual(_resolve_online_work_half(None), "FULL")

    def test_ưu_tiên_half_day_period_tường_minh(self):
        self.assertEqual(
            _resolve_online_work_half({"expected_status": "HALF_DAY", "half_day_period": "AFTERNOON",
                                        "reason": "Làm online sáng: ghi chú không khớp"}),
            "AFTERNOON",
        )
        self.assertEqual(
            _resolve_online_work_half({"expected_status": "HALF_DAY", "half_day_period": "MORNING"}),
            "MORNING",
        )

    def test_fallback_qua_chữ_trong_reason_khi_thiếu_half_day_period(self):
        """Đơn cũ / FE chưa gửi half_day_period — suy đoán qua chữ 'sáng'/
        'chiều' trong reason, đúng bug thực tế đã gặp."""
        self.assertEqual(
            _resolve_online_work_half({"expected_status": "HALF_DAY", "reason": "Làm online chiều: xuất hoá đơn"}),
            "AFTERNOON",
        )
        self.assertEqual(
            _resolve_online_work_half({"expected_status": "HALF_DAY", "reason": "Làm online sáng: họp"}),
            "MORNING",
        )

    def test_fallback_không_nhận_ra_chữ_nào_thì_về_FULL(self):
        """Không có half_day_period lẫn chữ nhận diện được -> giữ hành vi an
        toàn cũ (FULL), không đoán bừa."""
        self.assertEqual(
            _resolve_online_work_half({"expected_status": "HALF_DAY", "reason": "bận việc gia đình"}),
            "FULL",
        )


def _fake_request(data, is_staff=False, is_superuser=False):
    request = MagicMock()
    request.data = data
    request.user = MagicMock(is_staff=is_staff, is_superuser=is_superuser)
    return request


class CreateOnlineWorkUsesCorrectHalfTests(SimpleTestCase):
    """OnlineWorkRequestViewSet.create() phải truyền đúng `half` (suy từ
    request.data) cho get_shift_start_time(), không còn hard-code 'FULL'."""

    def _run_create(self, data):
        fake_employee = MagicMock()
        fake_employee.id = 42

        with patch("hrm.registration_views.OnlineWorkRequestViewSet.assert_not_locked", return_value=None), \
             patch("hrm.registration_views.Employee") as mock_employee_cls, \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views.OnlineWorkRequestViewSet._get_approver", return_value=None), \
             patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.deadline_utils.get_shift_start_time", return_value=time(8, 30)) as mock_shift_start, \
             patch("hrm.deadline_utils.hours_before_deadline",
                   return_value=timezone.now() + timedelta(hours=999)), \
             patch("hrm.registration_views.OnlineWorkEventCreateSerializer") as mock_serializer_cls:
            mock_employee_cls.objects.filter.return_value.first.return_value = fake_employee
            mock_serializer = MagicMock()
            mock_serializer.is_valid.return_value = True
            mock_serializer.save.return_value = MagicMock()
            mock_serializer_cls.return_value = mock_serializer

            with patch("hrm.registration_views.serialize_registration_event", return_value={"id": 1}):
                OnlineWorkRequestViewSet().create(_fake_request(data))

        return mock_shift_start

    def test_đơn_buổi_chiều_gọi_get_shift_start_time_với_half_AFTERNOON(self):
        mock_shift_start = self._run_create({
            "employee_id": 42,
            "work_date": "2026-09-26",
            "reason": "Làm online chiều: xuất hoá đơn",
            "expected_status": "HALF_DAY",
            "half_day_period": "AFTERNOON",
        })
        mock_shift_start.assert_called_once()
        self.assertEqual(mock_shift_start.call_args.kwargs.get("half"), "AFTERNOON")

    def test_đơn_buổi_sáng_gọi_get_shift_start_time_với_half_MORNING(self):
        mock_shift_start = self._run_create({
            "employee_id": 42,
            "work_date": "2026-09-26",
            "reason": "Làm online sáng: họp khách hàng",
            "expected_status": "HALF_DAY",
            "half_day_period": "MORNING",
        })
        mock_shift_start.assert_called_once()
        self.assertEqual(mock_shift_start.call_args.kwargs.get("half"), "MORNING")

    def test_đơn_cả_ngày_vẫn_dùng_FULL(self):
        mock_shift_start = self._run_create({
            "employee_id": 42,
            "work_date": "2026-09-26",
            "reason": "Làm online cả ngày",
            "expected_status": "ABSENT",
        })
        mock_shift_start.assert_called_once()
        self.assertEqual(mock_shift_start.call_args.kwargs.get("half"), "FULL")


class ApproveDeadlineUsesCorrectHalfTests(SimpleTestCase):
    """_check_online_work_approve_deadline() phải suy half từ event.data,
    không còn hard-code 'FULL'."""

    def _event(self, data):
        return MagicMock(employee=MagicMock(), event_date=date(2026, 9, 26), data=data)

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False)
    @patch("hrm.deadline_utils.is_locked_effective", return_value=True)
    @patch("hrm.deadline_utils.hours_before_deadline", return_value=timezone.now() + timedelta(hours=999))
    @patch("hrm.deadline_utils.get_shift_start_time", return_value=time(8, 30))
    def test_duyệt_đơn_buổi_chiều_dùng_half_AFTERNOON(self, mock_shift_start, *_mocks):
        from hrm.registration_views import _check_online_work_approve_deadline
        event = self._event({
            "reason": "Làm online chiều: xuất hoá đơn",
            "expected_status": "HALF_DAY",
            "half_day_period": "AFTERNOON",
        })
        _check_online_work_approve_deadline(event, bypass=False)
        mock_shift_start.assert_called_once()
        self.assertEqual(mock_shift_start.call_args.kwargs.get("half"), "AFTERNOON")
