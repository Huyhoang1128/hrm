"""Đơn quên chấm công + máy chỉ có 1 lượt chấm nằm sai ô (case NV80025, 7/9/2026:
chấm 17:04 lưu ở check_in, check_out rỗng; NV khai quên check-in lúc 08:00 ->
trước đây thiếu giờ ra nên chỉ được 0.5 công thay vì 1.0)."""
from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState


def _state(check_in, check_out):
    s = EmployeeState("TEST_NV")
    s.calendar_result = [{
        "date": "2026-09-07", "event_type": "attendance",
        "check_in": check_in, "check_out": check_out,
        "rules_applied": [], "effects": {"quen_cham_cong": 1}, "delta": {"quen_cham_cong": 1},
    }]
    return s


def _approval(punch_type, ci="", co=""):
    return Event("explanation_approval", {
        "action": "APPROVE", "approval_level": "HR", "explanation_type": "INCOMPLETE_ATTENDANCE",
        "date": "2026-09-07", "expected_status": "PRESENT", "forgot_punch_type": punch_type,
        "forgot_checkin_time": ci, "forgot_checkout_time": co,
        "actual_check_in": "", "actual_check_out": "",
    })


class LonePunchTests(SimpleTestCase):
    def test_forgot_checkin_lone_punch_stored_as_check_in_is_the_checkout(self):
        eff = _state("17:04", None)._evaluate_explanation_approval_rule(_approval("checkin", ci="08:00:00"), {})
        self.assertEqual(eff.get("nua_ngay_cong"), 1.0)

    def test_forgot_checkout_lone_punch_stored_as_check_out_is_the_checkin(self):
        eff = _state(None, "08:02")._evaluate_explanation_approval_rule(_approval("checkout", co="17:30:00"), {})
        self.assertEqual(eff.get("nua_ngay_cong"), 1.0)

    def test_forgot_checkin_lone_punch_earlier_than_declared_checkin_is_not_used(self):
        # Lượt chấm 07:50 sớm hơn giờ vào NV khai 08:00 -> không thể là giờ ra.
        eff = _state("07:50", None)._evaluate_explanation_approval_rule(_approval("checkin", ci="08:00:00"), {})
        self.assertEqual(eff.get("nua_ngay_cong"), 0.5)

    def test_normal_case_unchanged(self):
        eff = _state("17:30", "17:30")._evaluate_explanation_approval_rule(_approval("checkin", ci="08:00:00"), {})
        self.assertEqual(eff.get("nua_ngay_cong"), 1.0)
