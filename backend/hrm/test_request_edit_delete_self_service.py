"""
hrm/test_request_edit_delete_self_service.py
══════════════════════════════════════════════
Cho phép nhân sự tự sửa/huỷ (soft-delete) đơn CHỜ DUYỆT của
chính mình, áp dụng cho MỌI loại đơn (tăng ca/livestream/nghỉ không phép qua
RegistrationRequestViewSet, làm online qua OnlineWorkRequestViewSet, giải
trình/nghỉ phép tháng qua AttendanceExplanationViewSet — MonthlyLeaveViewSet
kế thừa nguyên, không override update/destroy/cancel).

Yêu cầu HCNS 2026-09-17, 3 việc:
  1. Edit/delete phải phụ thuộc đúng logic hạn tạo/duyệt đơn đã có sẵn (tái
     dùng nguyên _check_approve_deadline/_check_online_work_approve_deadline/
     _check_explanation_approve_deadline — vốn đã dùng cho approve(), cùng
     công thức hạn với lúc tạo đơn, tự bỏ qua nếu HCNS đã "mở khoá").
  2. Chỉ đơn PENDING mới sửa/huỷ được; đã duyệt (direct_manager_approved/
     hr_approved) thì không được nữa (trừ Admin/HR/Quản lý, hoặc chủ đơn có
     "mở khoá đặc biệt" đúng loại/ngày này).
  3. Soft-delete (không xoá cứng) + log ai sửa/ai huỷ — record_request_edit()/
     soft_cancel_request() (hrm/models.py).

Trước fix: AttendanceExplanationViewSet.update() không hề kiểm tra chủ sở
hữu (bug bảo mật — ai đăng nhập cũng sửa được đơn của người khác); Registration/
OnlineWork không có update() nào cả (PATCH → 405); cancel() có sẵn ở cả 3
viewset (tự phục vụ, có tích hợp "mở khoá đặc biệt") nhưng KHÔNG kiểm tra hạn
tạo/duyệt và KHÔNG lưu log ai huỷ; destroy() (xoá cứng) tồn tại song song,
chỉ Admin/HR/quản lý dùng được.

Yêu cầu bổ sung 2026-09-17: bỏ hẳn destroy() ở cả 3 viewset — cancel() (soft-
delete) là CƠ CHẾ DUY NHẤT để bỏ 1 đơn. Để không mất khả năng "xử lý duyệt
nhầm" mà destroy() từng đảm nhiệm, Admin/HR/quản lý giờ được cancel() ở BẤT
KỲ trạng thái nào (kể cả APPROVED) thay vì chỉ PENDING như chủ đơn.

Không có DB thật (SimpleTestCase) — mock get_object_or_404 để tiêm event/
employee giả, theo đúng pattern của test_department_section_soft_delete.py.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm.models import record_request_edit, soft_cancel_request
from hrm import registration_views
from hrm import taodon_views


# ─────────────────────────────────────────────────────────────────────────────
# Pure helpers (hrm/models.py) — dùng chung cho cả 3 viewset
# ─────────────────────────────────────────────────────────────────────────────

class RequestEditAuditHelpersTests(SimpleTestCase):
    def test_record_request_edit_appends_history_with_old_and_new(self):
        d = {"reason": "Bận việc gia đình", "status": "PENDING"}
        actor = MagicMock(id=42, full_name="Nguyễn Văn A")

        old_values = {"reason": d["reason"]}
        d["reason"] = "Bận việc gia đình (bổ sung: xin nghỉ thêm buổi chiều)"
        result = record_request_edit(d, actor, ["reason"], old_values)

        self.assertEqual(len(result["edit_history"]), 1)
        entry = result["edit_history"][0]
        self.assertEqual(entry["edited_by_id"], 42)
        self.assertEqual(entry["edited_by_name"], "Nguyễn Văn A")
        self.assertEqual(entry["changes"]["reason"]["old"], "Bận việc gia đình")
        self.assertEqual(entry["changes"]["reason"]["new"], d["reason"])
        self.assertEqual(result["last_edited_by_id"], 42)

    def test_soft_cancel_request_marks_cancelled_not_hard_deleted(self):
        d = {"status": "PENDING"}
        actor = MagicMock(id=7, full_name="Trần Thị B")

        result = soft_cancel_request(d, actor, reason="Đặt nhầm ngày")

        self.assertEqual(result["status"], "CANCELLED")
        self.assertTrue(result["is_deleted"])
        self.assertEqual(result["deleted_by_id"], 7)
        self.assertEqual(result["deleted_by_name"], "Trần Thị B")
        self.assertEqual(result["cancel_reason"], "Đặt nhầm ngày")
        self.assertIsNotNone(result["deleted_at"])


def _fake_event(employee, data, check_in=None, event_date=None):
    ev = MagicMock()
    ev.employee = employee
    ev.employee_id = employee.id
    ev.data = data
    ev.check_in = check_in
    ev.event_date = event_date
    return ev


def _owner_request(user, employee, data=None):
    request = MagicMock()
    request.user = user
    request.data = data or {}
    request.query_params = {}
    return request


_OWNER_USER = MagicMock(is_staff=False, is_superuser=False)


# ─────────────────────────────────────────────────────────────────────────────
# RegistrationRequestViewSet (tăng ca / livestream / nghỉ không phép / trực đêm)
# ─────────────────────────────────────────────────────────────────────────────

class RegistrationRequestUpdateTests(SimpleTestCase):
    def _owner(self):
        return MagicMock(id=1, full_name="Chủ đơn", position=None,
                          managed_departments=MagicMock(exists=lambda: False),
                          subordinates=MagicMock(exists=lambda: False))

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_can_update_own_pending_unapproved_request(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "reason": "Cũ"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["reason"], "Mới")
        self.assertEqual(len(event.data["edit_history"]), 1)

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_cannot_update_after_manager_approved(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "direct_manager_approved": True})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 400)

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_cannot_update_when_deadline_passed(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value="Đã quá hạn."):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 400)
        self.assertNotIn("edit_history", event.data)

    @patch.object(registration_views, "get_object_or_404")
    def test_privileged_can_update_even_when_approved_and_deadline_passed(self, mock_get_object):
        owner = self._owner()
        manager = MagicMock(id=2, full_name="Quản lý", position=None,
                             managed_departments=MagicMock(exists=lambda: True),
                             subordinates=MagicMock(exists=lambda: True))
        event = _fake_event(owner, {"status": "PENDING", "direct_manager_approved": True, "reason": "Cũ"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(MagicMock(is_staff=False, is_superuser=False), manager, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=manager), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value="Đã quá hạn."), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.update(request, pk=1)

        # is_management=True (managed_departments/subordinates) -> is_privileged
        # -> không bị chặn bởi đã duyệt lẫn hạn (deadline func không được gọi).
        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["reason"], "Mới")

    @patch.object(registration_views, "get_object_or_404")
    def test_stranger_cannot_update(self, mock_get_object):
        owner = self._owner()
        stranger = MagicMock(id=99, full_name="Người lạ", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        event = _fake_event(owner, {"status": "PENDING"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(MagicMock(is_staff=False, is_superuser=False), stranger, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=stranger), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 403)


class RegistrationRequestDestroyCancelTests(SimpleTestCase):
    """destroy() đã bị bỏ hẳn (yêu cầu HCNS 2026-09-17: "chỉ giữ lại phần
    cancel") — cancel() giờ là CƠ CHẾ DUY NHẤT để bỏ 1 đơn, và Admin/HR/quản
    lý được huỷ ở BẤT KỲ trạng thái nào (kể cả APPROVED) để thay thế đúng vai
    trò "xử lý duyệt nhầm" mà destroy() từng đảm nhiệm."""

    def _owner(self):
        return MagicMock(id=1, full_name="Chủ đơn", position=None,
                          managed_departments=MagicMock(exists=lambda: False),
                          subordinates=MagicMock(exists=lambda: False))

    def test_destroy_no_longer_exists(self):
        self.assertFalse(hasattr(registration_views.RegistrationRequestViewSet, "destroy"))

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_cannot_cancel_already_approved_request(self, mock_get_object):
        """Chủ đơn vẫn KHÔNG được tự huỷ đơn đã APPROVED (khác Admin/HR)."""
        owner = self._owner()
        event = _fake_event(owner, {"status": "APPROVED", "registration_type": "OVERTIME"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner)

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(event.data["status"], "APPROVED")

    @patch.object(registration_views, "get_object_or_404")
    def test_privileged_can_cancel_already_approved_request(self, mock_get_object):
        """Admin/HR/quản lý huỷ được cả đơn đã APPROVED — thay thế đúng vai
        trò destroy() cũ (xử lý duyệt nhầm) nhưng qua soft-delete có log."""
        owner = self._owner()
        event = _fake_event(owner, {"status": "APPROVED", "registration_type": "OVERTIME"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        approver = MagicMock(id=5, full_name="Admin", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        admin_user = MagicMock(is_staff=True, is_superuser=False)
        request = _owner_request(admin_user, approver)

        with patch.object(view, "_get_approver", return_value=approver), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")
        self.assertTrue(event.data["is_deleted"])
        self.assertEqual(event.data["deleted_by_id"], approver.id)

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_cancel_blocked_when_deadline_passed(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "registration_type": "OVERTIME"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner)

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value="Đã quá hạn."):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(event.data["status"], "PENDING")  # không bị đổi

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_cancel_succeeds_soft_deletes_with_log(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "registration_type": "OVERTIME"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Đặt nhầm ngày"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")
        self.assertTrue(event.data["is_deleted"])
        self.assertEqual(event.data["deleted_by_id"], owner.id)
        self.assertEqual(event.data["cancel_reason"], "Đặt nhầm ngày")

    @patch.object(registration_views, "get_object_or_404")
    def test_privileged_cancel_bypasses_deadline_check(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "registration_type": "OVERTIME"})
        mock_get_object.return_value = event

        view = registration_views.RegistrationRequestViewSet()
        approver = MagicMock(id=5, full_name="Admin", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        admin_user = MagicMock(is_staff=True, is_superuser=False)
        request = _owner_request(admin_user, approver)

        with patch.object(view, "_get_approver", return_value=approver), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch(
                 "hrm.registration_views._check_approve_deadline",
                 side_effect=AssertionError("không được gọi cho actor có quyền"),
             ), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")


# ─────────────────────────────────────────────────────────────────────────────
# OnlineWorkRequestViewSet — cùng cấu trúc, dùng
# _check_online_work_approve_deadline thay vì _check_approve_deadline.
# ─────────────────────────────────────────────────────────────────────────────

class OnlineWorkRequestUpdateCancelTests(SimpleTestCase):
    def _owner(self):
        return MagicMock(id=1, full_name="Chủ đơn", position=None,
                          managed_departments=MagicMock(exists=lambda: False),
                          subordinates=MagicMock(exists=lambda: False))

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_can_update_own_pending_request(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "reason": "Cũ"})
        mock_get_object.return_value = event

        view = registration_views.OnlineWorkRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_online_work_approve_deadline", return_value=None), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["reason"], "Mới")

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_update_blocked_when_deadline_passed(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING"})
        mock_get_object.return_value = event

        view = registration_views.OnlineWorkRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Mới"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_online_work_approve_deadline", return_value="Đã quá hạn."):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 400)

    def test_destroy_no_longer_exists(self):
        self.assertFalse(hasattr(registration_views.OnlineWorkRequestViewSet, "destroy"))

    @patch.object(registration_views, "get_object_or_404")
    def test_owner_cancel_soft_deletes_with_log(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING"})
        mock_get_object.return_value = event

        view = registration_views.OnlineWorkRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Đổi ý"})

        with patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views._check_online_work_approve_deadline", return_value=None), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")
        self.assertTrue(event.data["is_deleted"])
        self.assertEqual(event.data["deleted_by_id"], owner.id)

    @patch.object(registration_views, "get_object_or_404")
    def test_privileged_can_cancel_already_approved_request(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "APPROVED"})
        mock_get_object.return_value = event

        view = registration_views.OnlineWorkRequestViewSet()
        approver = MagicMock(id=5, full_name="Admin", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        admin_user = MagicMock(is_staff=True, is_superuser=False)
        request = _owner_request(admin_user, approver)

        with patch.object(view, "_get_approver", return_value=approver), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views.serialize_registration_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")


# ─────────────────────────────────────────────────────────────────────────────
# AttendanceExplanationViewSet (giải trình / nghỉ phép tháng qua MonthlyLeaveViewSet)
# ─────────────────────────────────────────────────────────────────────────────

class ExplanationUpdateOwnershipRegressionTests(SimpleTestCase):
    """Bug bảo mật trước fix: update() không hề kiểm tra chủ sở hữu — bất kỳ
    ai đăng nhập cũng PATCH được đơn của người khác. Test này xác nhận đã vá."""

    def _owner(self):
        return MagicMock(id=1, full_name="Chủ đơn", position=None,
                          managed_departments=MagicMock(exists=lambda: False),
                          subordinates=MagicMock(exists=lambda: False))

    @patch.object(taodon_views, "get_object_or_404")
    def test_stranger_cannot_update_someone_elses_explanation(self, mock_get_object):
        owner = self._owner()
        stranger = MagicMock(id=99, full_name="Người lạ", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        event = _fake_event(owner, {"status": "PENDING", "reason": "Cũ"})
        mock_get_object.return_value = event

        view = taodon_views.AttendanceExplanationViewSet()
        request = _owner_request(MagicMock(is_staff=False, is_superuser=False), stranger, {"reason": "Bị hack"})

        with patch.object(view, "_get_current_employee", return_value=stranger), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(event.data["reason"], "Cũ")  # không bị sửa

    @patch.object(taodon_views, "get_object_or_404")
    def test_owner_can_update_own_pending_explanation(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "reason": "Cũ"})
        mock_get_object.return_value = event

        view = taodon_views.AttendanceExplanationViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Bổ sung lý do"})

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.taodon_views._check_explanation_approve_deadline", return_value=None), \
             patch("hrm.taodon_views.serialize_explanation_event", return_value={}):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["reason"], "Bổ sung lý do")
        self.assertEqual(len(event.data["edit_history"]), 1)

    @patch.object(taodon_views, "get_object_or_404")
    def test_owner_cannot_update_when_deadline_passed(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "explanation_type": "LEAVE"})
        mock_get_object.return_value = event

        view = taodon_views.AttendanceExplanationViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Mới"})

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.taodon_views._check_explanation_approve_deadline", return_value="Đã quá hạn."):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 400)


class ExplanationDestroyCancelTests(SimpleTestCase):
    def _owner(self):
        return MagicMock(id=1, full_name="Chủ đơn", position=None,
                          managed_departments=MagicMock(exists=lambda: False),
                          subordinates=MagicMock(exists=lambda: False))

    def test_destroy_no_longer_exists(self):
        self.assertFalse(hasattr(taodon_views.AttendanceExplanationViewSet, "destroy"))

    @patch.object(taodon_views, "get_object_or_404")
    def test_privileged_can_cancel_already_approved_request(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "APPROVED"})
        mock_get_object.return_value = event

        view = taodon_views.AttendanceExplanationViewSet()
        approver = MagicMock(id=5, full_name="Admin", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        admin_user = MagicMock(is_staff=True, is_superuser=False)
        request = _owner_request(admin_user, approver)

        with patch.object(view, "_get_current_employee", return_value=approver), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.taodon_views.serialize_explanation_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")

    @patch.object(taodon_views, "get_object_or_404")
    def test_owner_cancel_blocked_when_deadline_passed(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "explanation_type": "BUSINESS_TRIP"})
        mock_get_object.return_value = event

        view = taodon_views.AttendanceExplanationViewSet()
        request = _owner_request(_OWNER_USER, owner)

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.taodon_views._check_explanation_approve_deadline", return_value="Đã quá hạn."):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(event.data["status"], "PENDING")

    @patch.object(taodon_views, "get_object_or_404")
    def test_owner_cancel_succeeds_soft_deletes_with_log(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "explanation_type": "LATE"})
        mock_get_object.return_value = event

        view = taodon_views.AttendanceExplanationViewSet()
        request = _owner_request(_OWNER_USER, owner, {"reason": "Nhớ nhầm ngày"})

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.taodon_views._check_explanation_approve_deadline", return_value=None), \
             patch("hrm.taodon_views.serialize_explanation_event", return_value={}):
            response = view.cancel(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.data["status"], "CANCELLED")
        self.assertTrue(event.data["is_deleted"])
        self.assertEqual(event.data["deleted_by_id"], owner.id)
        self.assertEqual(event.data["cancel_reason"], "Nhớ nhầm ngày")


# ─────────────────────────────────────────────────────────────────────────────
# cancel_group() / update_group() — đơn Nghỉ không phép nhiều ngày liên tiếp
# (nhiều EmployeeEvent cùng data['request_code'], mỗi ngày 1 bản ghi — xem
# RegistrationRequestCreateSerializer.create()). Yêu cầu HCNS 2026-09-18:
# Sửa/Huỷ đơn nhiều ngày phải áp dụng cho CẢ NHÓM, không phải từng ngày lẻ.
# ─────────────────────────────────────────────────────────────────────────────

import datetime as _dt


def _owner_for_group():
    return MagicMock(id=1, full_name="Chủ đơn", position=None,
                      managed_departments=MagicMock(exists=lambda: False),
                      subordinates=MagicMock(exists=lambda: False))


def _fake_group_events(owner, n=3, status="PENDING", start=_dt.date(2026, 9, 18)):
    events = []
    for i in range(n):
        ev = _fake_event(owner, {
            "status": status, "request_code": "KP-202609-ABCDEF12",
            "registration_type": "UNAUTHORIZED_ABSENCE",
        }, event_date=start + _dt.timedelta(days=i))
        events.append(ev)
    return events


class RegistrationRequestGroupCancelUpdateTests(SimpleTestCase):
    def _mock_qs(self, events):
        mock_qs = MagicMock()
        mock_qs.filter.return_value.order_by.return_value = events
        return mock_qs

    def test_cancel_group_requires_request_code(self):
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, _owner_for_group(), {})
        response = view.cancel_group(request)
        self.assertEqual(response.status_code, 400)

    def test_cancel_group_not_found(self):
        owner = _owner_for_group()
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"request_code": "KP-NONE"})
        with patch.object(view, "_base_qs", return_value=self._mock_qs([])):
            response = view.cancel_group(request)
        self.assertEqual(response.status_code, 404)

    def test_cancel_group_stranger_forbidden(self):
        owner = _owner_for_group()
        stranger = MagicMock(id=99, full_name="Người lạ", position=None,
                              managed_departments=MagicMock(exists=lambda: False),
                              subordinates=MagicMock(exists=lambda: False))
        events = _fake_group_events(owner)
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(MagicMock(is_staff=False, is_superuser=False), stranger,
                                  {"request_code": "KP-202609-ABCDEF12"})
        with patch.object(view, "_base_qs", return_value=self._mock_qs(events)), \
             patch.object(view, "_get_approver", return_value=stranger), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False):
            response = view.cancel_group(request)
        self.assertEqual(response.status_code, 403)

    def test_cancel_group_owner_cancels_all_days_within_deadline(self):
        owner = _owner_for_group()
        events = _fake_group_events(owner, n=3)
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"request_code": "KP-202609-ABCDEF12"})
        with patch.object(view, "_base_qs", return_value=self._mock_qs(events)), \
             patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None):
            response = view.cancel_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["cancelled_dates"]), 3)
        self.assertEqual(response.data["skipped"], [])
        for ev in events:
            self.assertEqual(ev.data["status"], "CANCELLED")
            self.assertEqual(ev.data["deleted_by_id"], owner.id)

    def test_cancel_group_skips_day_past_deadline_but_cancels_rest(self):
        owner = _owner_for_group()
        events = _fake_group_events(owner, n=3)
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner, {"request_code": "KP-202609-ABCDEF12"})

        # Ngày đầu tiên (events[0]) đã quá hạn — chỉ chặn riêng ngày đó.
        def deadline_side_effect(event, bypass=False):
            return "Đã quá hạn." if event is events[0] else None

        with patch.object(view, "_base_qs", return_value=self._mock_qs(events)), \
             patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", side_effect=deadline_side_effect):
            response = view.cancel_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["cancelled_dates"]), 2)
        self.assertEqual(len(response.data["skipped"]), 1)
        self.assertNotEqual(events[0].data.get("status"), "CANCELLED")
        self.assertEqual(events[1].data["status"], "CANCELLED")
        self.assertEqual(events[2].data["status"], "CANCELLED")

    def test_update_group_applies_reason_to_all_pending_days(self):
        owner = _owner_for_group()
        events = _fake_group_events(owner, n=2)
        for ev in events:
            ev.data["reason"] = "Lý do cũ"
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner,
                                  {"request_code": "KP-202609-ABCDEF12", "reason": "Lý do mới"})
        with patch.object(view, "_base_qs", return_value=self._mock_qs(events)), \
             patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None):
            response = view.update_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["updated_dates"]), 2)
        for ev in events:
            self.assertEqual(ev.data["reason"], "Lý do mới")
            self.assertEqual(len(ev.data["edit_history"]), 1)

    def test_update_group_skips_already_approved_day(self):
        owner = _owner_for_group()
        events = _fake_group_events(owner, n=2)
        events[0].data["direct_manager_approved"] = True
        view = registration_views.RegistrationRequestViewSet()
        request = _owner_request(_OWNER_USER, owner,
                                  {"request_code": "KP-202609-ABCDEF12", "reason": "Lý do mới"})
        with patch.object(view, "_base_qs", return_value=self._mock_qs(events)), \
             patch.object(view, "_get_approver", return_value=owner), \
             patch("hrm.registration_views._is_hr", return_value=False), \
             patch("hrm.registration_views._has_approve_permission", return_value=False), \
             patch("hrm.registration_views._check_approve_deadline", return_value=None):
            response = view.update_group(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["updated_dates"]), 1)
        self.assertEqual(len(response.data["skipped"]), 1)
        self.assertNotEqual(events[0].data.get("reason"), "Lý do mới")
        self.assertEqual(events[1].data["reason"], "Lý do mới")


# ─────────────────────────────────────────────────────────────────────────────
# Sửa ngày (attendance_date) đơn Nghỉ phép tháng — yêu cầu HCNS 2026-09-18
# ─────────────────────────────────────────────────────────────────────────────

class LeaveRequestDateEditTests(SimpleTestCase):
    def _owner(self):
        return MagicMock(id=1, full_name="Chủ đơn", position=None,
                          managed_departments=MagicMock(exists=lambda: False),
                          subordinates=MagicMock(exists=lambda: False))

    def _no_conflict_qs(self):
        mock_qs = MagicMock()
        mock_qs.filter.return_value.exclude.return_value.exclude.return_value.exists.return_value = False
        return mock_qs

    def _conflict_qs(self):
        mock_qs = MagicMock()
        mock_qs.filter.return_value.exclude.return_value.exclude.return_value.exists.return_value = True
        return mock_qs

    @patch.object(taodon_views, "get_object_or_404")
    def test_owner_can_move_leave_to_new_date_without_conflict(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "explanation_type": "LEAVE", "reason": "Nghỉ"},
                             event_date=_dt.date(2026, 9, 20))
        mock_get_object.return_value = event

        view = taodon_views.MonthlyLeaveViewSet()
        request = _owner_request(_OWNER_USER, owner, {"attendance_date": "2026-09-22"})

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch.object(view, "_base_qs", return_value=self._no_conflict_qs()), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.taodon_views._check_explanation_approve_deadline", return_value=None), \
             patch("hrm.taodon_views.serialize_explanation_event", return_value={}):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.event_date, _dt.date(2026, 9, 22))
        self.assertEqual(len(event.data["edit_history"]), 1)
        self.assertIn("attendance_date", event.data["edit_history"][0]["changes"])

    @patch.object(taodon_views, "get_object_or_404")
    def test_owner_cannot_move_leave_to_date_with_existing_request(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "explanation_type": "LEAVE"},
                             event_date=_dt.date(2026, 9, 20))
        mock_get_object.return_value = event

        view = taodon_views.MonthlyLeaveViewSet()
        request = _owner_request(_OWNER_USER, owner, {"attendance_date": "2026-09-23"})

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch.object(view, "_base_qs", return_value=self._conflict_qs()), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(event.event_date, _dt.date(2026, 9, 20))

    @patch.object(taodon_views, "get_object_or_404")
    def test_deadline_check_runs_against_new_date_not_old(self, mock_get_object):
        owner = self._owner()
        event = _fake_event(owner, {"status": "PENDING", "explanation_type": "LEAVE"},
                             event_date=_dt.date(2026, 9, 20))
        mock_get_object.return_value = event

        view = taodon_views.MonthlyLeaveViewSet()
        request = _owner_request(_OWNER_USER, owner, {"attendance_date": "2026-09-25"})

        seen_event_dates = []

        def deadline_side_effect(ev, bypass=False):
            seen_event_dates.append(ev.event_date)
            return None

        with patch.object(view, "_get_current_employee", return_value=owner), \
             patch.object(view, "_base_qs", return_value=self._no_conflict_qs()), \
             patch("hrm.taodon_views._is_hr", return_value=False), \
             patch("hrm.taodon_views._has_approve_permission", return_value=False), \
             patch("hrm.taodon_views._check_explanation_approve_deadline", side_effect=deadline_side_effect), \
             patch("hrm.taodon_views.serialize_explanation_event", return_value={}):
            response = view.update(request, pk=1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen_event_dates, [_dt.date(2026, 9, 25)])
