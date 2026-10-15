"""
hrm/test_night_shift_late_credit.py
═════════════════════════════════════
Test cho bug: NV đi muộn >= 120 phút (ca chiều) + có đơn "Trực tối"
(NIGHT_SHIFT) được duyệt -> bị tính 0 công, thay vì đúng ra phải là 0.5
công (từ đơn Trực tối) — xem EmployeeState._has_afternoon_shift_attendance
và _evaluate_overtime_rule (nhánh NIGHT_SHIFT) ở hrm/main_api.py.

Nguyên nhân: khi đi muộn >= 120 phút, _evaluate_afternoon_shift_rule() set
effects.vang_mat (KHÔNG set effects.nua_ngay_cong) dù NV VẪN check_in
(chỉ là quá muộn). _has_afternoon_shift_attendance() trước đây chỉ coi
nua_ngay_cong > 0 là "có chấm công ca chiều", nên trả về False y hệt
trường hợp hoàn toàn không chấm công -> đơn Trực tối được duyệt không
cộng công gì (nhánh "không có chấm công ca chiều" trong
_evaluate_overtime_rule).

Dùng SimpleTestCase (không cần DB) — EmployeeState.__init__ không chạm DB
và calendar_result được set tay trực tiếp trong test.
"""
from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState


def _make_state(calendar_result):
    state = EmployeeState("TEST_NV")
    state.calendar_result = calendar_result
    return state


def _afternoon_entry(event_date, effects):
    return {
        "date": event_date,
        "event_type": "attendance",
        "rules_applied": [{"rule_type": "SHIFT_RULE_AFTERNOON"}],
        "effects": effects,
    }


def _night_shift_event(event_date, sessions=1):
    return Event("night_shift", {
        "status": "APPROVED",
        "registration_type": "NIGHT_SHIFT",
        "date": event_date,
        "sessions": sessions,
    })


class HasAfternoonShiftAttendanceTests(SimpleTestCase):
    def test_true_for_normal_credit(self):
        state = _make_state([
            _afternoon_entry("2026-08-29", {"nua_ngay_cong": 0.5}),
        ])
        self.assertTrue(state._has_afternoon_shift_attendance("2026-08-29"))

    def test_true_for_severely_late_vang_mat(self):
        """Bug đã sửa: đi muộn >= 120 phút -> vang_mat (không nua_ngay_cong),
        nhưng vẫn PHẢI coi là "có chấm công ca chiều"."""
        state = _make_state([
            _afternoon_entry("2026-08-29", {"quen_cham_cong": 1, "vang_mat": 0.5}),
        ])
        self.assertTrue(state._has_afternoon_shift_attendance("2026-08-29"))

    def test_false_for_genuine_absence(self):
        """Hoàn toàn không chấm công (không check_in) -> vẫn PHẢI là False,
        không được lẫn với trường hợp đi muộn >= 120 phút ở trên."""
        state = _make_state([
            _afternoon_entry("2026-08-29", {"quen_cham_cong": 1}),
        ])
        self.assertFalse(state._has_afternoon_shift_attendance("2026-08-29"))

    def test_false_when_no_matching_date(self):
        state = _make_state([
            _afternoon_entry("2026-08-28", {"nua_ngay_cong": 0.5}),
        ])
        self.assertFalse(state._has_afternoon_shift_attendance("2026-08-29"))


class NightShiftApprovalCreditTests(SimpleTestCase):
    def test_grants_half_credit_when_severely_late(self):
        """Kịch bản bug thực tế: đi muộn >= 120 phút (vang_mat) + đơn Trực
        tối duyệt -> PHẢI ra 0.5 công (không phải 0)."""
        state = _make_state([
            _afternoon_entry("2026-08-29", {"quen_cham_cong": 1, "vang_mat": 0.5}),
        ])
        effects = state._evaluate_overtime_rule(_night_shift_event("2026-08-29"), {})
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)
        self.assertEqual(effects.get("truc_toi"), 1)

    def test_grants_half_credit_on_top_of_normal_afternoon(self):
        """Baseline không đổi: ca chiều bình thường (0.5) + Trực tối (0.5) = 1.0 công."""
        state = _make_state([
            _afternoon_entry("2026-08-29", {"nua_ngay_cong": 0.5}),
        ])
        effects = state._evaluate_overtime_rule(_night_shift_event("2026-08-29"), {})
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_no_bonus_when_already_full_day(self):
        """Regression guard: đã đủ 1.0 công rồi thì Trực tối KHÔNG cộng thêm
        (tránh bug 1.5 công) — chỉ đếm truc_toi."""
        state = _make_state([
            _afternoon_entry("2026-08-29", {"nua_ngay_cong": 1.0}),
        ])
        effects = state._evaluate_overtime_rule(_night_shift_event("2026-08-29"), {})
        self.assertNotIn("nua_ngay_cong", effects)
        self.assertEqual(effects.get("truc_toi"), 1)

    def test_no_bonus_for_genuine_absence(self):
        """Hoàn toàn không chấm công cả ngày -> Trực tối không tự nhiên cấp công."""
        state = _make_state([
            _afternoon_entry("2026-08-29", {"quen_cham_cong": 1}),
        ])
        effects = state._evaluate_overtime_rule(_night_shift_event("2026-08-29"), {})
        self.assertNotIn("nua_ngay_cong", effects)
        self.assertEqual(effects.get("truc_toi"), 1)
