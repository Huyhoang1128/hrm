"""
hrm/test_registration_approve_group.py
═══════════════════════════════════════
Bug thực tế (2026-09-24, vị trí Sale viện / NV80007): đơn Nghỉ không phép
NHIỀU NGÀY lưu thành nhiều EmployeeEvent riêng (1 bản ghi/ngày, cùng
data['request_code'] — xem RegistrationRequestCreateSerializer.create()).
approve()/reject()/bulk_approve() trước đây chỉ xử lý ĐÚNG 1 event theo
pk/id được truyền — QLTT bấm "Phê duyệt" cho 1 ngày (hoặc dòng đại diện),
các ngày còn lại trong CÙNG đơn vẫn treo PENDING dù QLTT tin là đã duyệt
xong cả đơn (case thực tế: NV80007 xin nghỉ 4 ngày liên tiếp, QLTT duyệt
ngày đầu rồi tưởng cả đơn đã xong, nhưng 3/4 ngày vẫn "chờ QLTT duyệt").

Fix: approve_group()/reject_group() — action MỚI nhận request_code, lặp
qua TẤT CẢ EmployeeEvent cùng request_code và áp dụng đúng logic duyệt/
từ chối như approve()/reject() cho từng ngày, bỏ qua (skip, có lý do) các
ngày không đủ điều kiện thay vì duyệt nửa vời không báo — cùng pattern với
cancel_group()/update_group() đã có sẵn cho loại đơn này.

Không có DB thật (SimpleTestCase) — mock _base_qs() để tiêm danh sách event
giả, theo đúng pattern test_ta_request_edit_delete_self_service.py (dùng
get_object_or_404 cho đơn lẻ; ở đây dùng queryset nên mock _base_qs thay).
"""
from datetime import date
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm import registration_views


def _fake_event(employee, data, event_date):
    ev = MagicMock()
    ev.employee = employee
    ev.employee_id = employee.id
    ev.data = data
    ev.event_date = event_date
    return ev


def _request(user, data=None):
    req = MagicMock()
    req.user = user
    req.data = data or {}
    return req


def _setup_view(events):
    view = registration_views.RegistrationRequestViewSet()
    mock_qs = MagicMock()
    mock_qs.filter.return_value.order_by.return_value = events
    view._base_qs = MagicMock(return_value=mock_qs)
    return view


_COMMON_PATCHES = dict(
    is_hr=False,
    has_approve_permission=False,
    is_senior_manager=False,
    off_duty_block_reason=None,
    approve_deadline_error=None,
)


class ApproveGroupTests(SimpleTestCase):
    def _owner(self, manager=None):
        return MagicMock(id=1, full_name="Chủ đơn", manager=manager, position=None)

    def _manager(self):
        return MagicMock(id=2, full_name="Quản lý", manager=None, position=None)

    def test_direct_manager_approves_all_pending_days_in_group(self):
        manager = self._manager()
        owner = self._owner(manager=manager)
        events = [
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-1"}, date(2026, 9, 30)),
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-1"}, date(2026, 10, 1)),
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-1"}, date(2026, 10, 2)),
        ]
        view = _setup_view(events)
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "KP-1"})

        with patch.object(view, "_get_approver", return_value=manager), \
             patch.object(view, "assert_not_locked", return_value=None), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views.is_senior_manager", return_value=False), \
             patch("hrm.registration_views._off_duty_approval_block_reason", return_value=None), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None), \
             patch("hrm.registration_views.apply_shift_change_effect", return_value=None):
            response = view.approve_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["approved_dates"]), 3)
        self.assertEqual(response.data["approved_dates"], ["2026-09-30", "2026-10-01", "2026-10-02"])
        for ev in events:
            self.assertTrue(ev.data["direct_manager_approved"])
            self.assertEqual(ev.data["direct_manager_approved_by_name"], "Quản lý")
            # Chỉ mới xong bước 1 (QLTT) — chưa phải Admin/HR nên status vẫn
            # PENDING, đang chờ Nhân sự duyệt bước 2 (đúng ý báo cáo thực tế).
            self.assertEqual(ev.data["status"], "PENDING")

    def test_admin_approves_all_days_fully_both_steps(self):
        owner = self._owner()
        events = [
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-2"}, date(2026, 9, 30)),
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-2"}, date(2026, 10, 1)),
        ]
        view = _setup_view(events)
        admin = MagicMock(id=9, full_name="Admin", manager=None, position=None)
        request = _request(MagicMock(is_staff=True, is_superuser=False), {"request_code": "KP-2"})

        with patch.object(view, "_get_approver", return_value=admin), \
             patch.object(view, "assert_not_locked", return_value=None), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views.is_senior_manager", return_value=False), \
             patch("hrm.registration_views._off_duty_approval_block_reason", return_value=None), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None), \
             patch("hrm.registration_views.apply_shift_change_effect", return_value=None):
            response = view.approve_group(request)

        self.assertEqual(response.status_code, 200)
        for ev in events:
            self.assertEqual(ev.data["status"], "APPROVED")
            self.assertTrue(ev.data["direct_manager_approved"])
            self.assertTrue(ev.data["hr_approved"])

    def test_skips_days_already_resolved_or_over_deadline(self):
        manager = self._manager()
        owner = self._owner(manager=manager)
        pending_ev = _fake_event(owner, {"status": "PENDING", "request_code": "KP-3"}, date(2026, 9, 30))
        already_approved_ev = _fake_event(owner, {"status": "APPROVED", "request_code": "KP-3"}, date(2026, 10, 1))
        over_deadline_ev = _fake_event(owner, {"status": "PENDING", "request_code": "KP-3"}, date(2026, 10, 2))
        events = [pending_ev, already_approved_ev, over_deadline_ev]
        view = _setup_view(events)
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "KP-3"})

        def _deadline(event, bypass):
            return "Đã quá hạn duyệt." if event is over_deadline_ev else None

        with patch.object(view, "_get_approver", return_value=manager), \
             patch.object(view, "assert_not_locked", return_value=None), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views.is_senior_manager", return_value=False), \
             patch("hrm.registration_views._off_duty_approval_block_reason", return_value=None), \
             patch("hrm.registration_views._check_approve_deadline", side_effect=_deadline), \
             patch("hrm.registration_views.apply_shift_change_effect", return_value=None):
            response = view.approve_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["approved_dates"], ["2026-09-30"])
        self.assertEqual(len(response.data["skipped"]), 2)
        self.assertTrue(pending_ev.data["direct_manager_approved"])
        self.assertNotIn("direct_manager_approved", already_approved_ev.data)
        self.assertNotIn("direct_manager_approved", over_deadline_ev.data)

    def test_stranger_forbidden(self):
        owner = self._owner()
        stranger = MagicMock(id=99, full_name="Người lạ", manager=None, position=None)
        events = [_fake_event(owner, {"status": "PENDING", "request_code": "KP-4"}, date(2026, 9, 30))]
        view = _setup_view(events)
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "KP-4"})

        with patch.object(view, "_get_approver", return_value=stranger), \
             patch.object(view, "assert_not_locked", return_value=None), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views.is_senior_manager", return_value=False):
            response = view.approve_group(request)

        self.assertEqual(response.status_code, 403)

    def test_missing_request_code_returns_400(self):
        view = _setup_view([])
        request = _request(MagicMock(is_staff=False, is_superuser=False), {})
        response = view.approve_group(request)
        self.assertEqual(response.status_code, 400)

    def test_no_matching_events_returns_404(self):
        view = _setup_view([])
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "NOPE"})
        response = view.approve_group(request)
        self.assertEqual(response.status_code, 404)


class RejectGroupTests(SimpleTestCase):
    def _owner(self, manager=None):
        return MagicMock(id=1, full_name="Chủ đơn", manager=manager, position=None)

    def _manager(self):
        return MagicMock(id=2, full_name="Quản lý", manager=None, position=None)

    def test_direct_manager_rejects_all_pending_days(self):
        manager = self._manager()
        owner = self._owner(manager=manager)
        events = [
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-5"}, date(2026, 9, 30)),
            _fake_event(owner, {"status": "PENDING", "request_code": "KP-5"}, date(2026, 10, 1)),
        ]
        view = _setup_view(events)
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "KP-5"})

        with patch.object(view, "_get_approver", return_value=manager), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._create_approval_event", return_value=None):
            response = view.reject_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["rejected_dates"]), 2)
        for ev in events:
            self.assertEqual(ev.data["status"], "REJECTED")

    def test_skips_non_pending_day(self):
        manager = self._manager()
        owner = self._owner(manager=manager)
        pending_ev = _fake_event(owner, {"status": "PENDING", "request_code": "KP-6"}, date(2026, 9, 30))
        cancelled_ev = _fake_event(owner, {"status": "CANCELLED", "request_code": "KP-6"}, date(2026, 10, 1))
        events = [pending_ev, cancelled_ev]
        view = _setup_view(events)
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "KP-6"})

        with patch.object(view, "_get_approver", return_value=manager), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._create_approval_event", return_value=None):
            response = view.reject_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["rejected_dates"], ["2026-09-30"])
        self.assertEqual(len(response.data["skipped"]), 1)
        self.assertEqual(cancelled_ev.data["status"], "CANCELLED")

    def test_stranger_forbidden(self):
        owner = self._owner()
        stranger = MagicMock(id=99, full_name="Người lạ", manager=None, position=None)
        events = [_fake_event(owner, {"status": "PENDING", "request_code": "KP-7"}, date(2026, 9, 30))]
        view = _setup_view(events)
        request = _request(MagicMock(is_staff=False, is_superuser=False), {"request_code": "KP-7"})

        with patch.object(view, "_get_approver", return_value=stranger), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False):
            response = view.reject_group(request)

        self.assertEqual(response.status_code, 403)
