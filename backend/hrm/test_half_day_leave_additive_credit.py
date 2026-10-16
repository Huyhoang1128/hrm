"""
hrm/test_half_day_leave_additive_credit.py
════════════════════════════════════════════
Bug thực tế (NV NV80029, 31/8): chấm công buổi sáng (08:31-12:02, muộn 1 phút
nhưng vẫn được 0.5 công vì < 120 phút — xem _evaluate_afternoon_shift_rule/
_evaluate_morning_shift_rule) + đơn "Nghỉ phép nửa ngày" (LEAVE, HALF_DAY)
được duyệt cho buổi còn lại -> cả ngày chỉ ra 0.5 công thay vì đúng ra 1.0.

Nguyên nhân: nhánh "Regular LEAVE" của _evaluate_explanation_approval_rule()
có điều kiện "day_violations == 0" (copy từ fix của BUSINESS_TRIP) mới cộng
bù thêm target_credit — hễ ngày đó có BẤT KỲ vi phạm đi muộn/về sớm nào
(bất kể ở buổi nào) là bị chặn không cộng thêm, dù buổi có vi phạm và buổi
xin nghỉ phép là 2 buổi HOÀN TOÀN KHÁC NHAU trong ngày.

Khác với BUSINESS_TRIP (NV có thể dùng đơn công tác để giải trình CHO chính
buổi bị đi muộn/về sớm đó), "Nghỉ phép" gần như luôn là buổi NV KHÔNG đi làm
— nên điều kiện "không có vi phạm nào trong ngày" là sai/quá rộng cho LEAVE.

Fix: bỏ điều kiện day_violations cho LEAVE nửa ngày — luôn cộng bù tới tối
đa 1.0 công/ngày (existing_credit chỉ tính công DƯƠNG đã ghi nhận thật, đã
đủ để chặn cộng dư).
"""
from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState


def _make_state(calendar_result, remaining_annual_leave=12.0):
    state = EmployeeState("TEST_NV")
    state.calendar_result = calendar_result
    state.remaining_annual_leave = remaining_annual_leave
    return state


def _attendance_entry(event_date, effects):
    return {
        "date": event_date,
        "event_type": "attendance",
        "rules_applied": [{"rule_type": "SHIFT_RULE_MORNING"}],
        "effects": effects,
        "delta": dict(effects),
    }


def _leave_half_day_approval_event(event_date, leave_type="ANNUAL"):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "LEAVE",
        "expected_status": "HALF_DAY",
        "leave_type": leave_type,
        "date": event_date,
    })


def _leave_full_day_approval_event(event_date, leave_type="ANNUAL"):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "LEAVE",
        "date": event_date,
        "leave_type": leave_type,
    })


class HalfDayLeaveAdditiveCreditTests(SimpleTestCase):
    def test_morning_attendance_with_late_violation_plus_afternoon_leave_reaches_full_day(self):
        """Kịch bản bug thực tế (NV80029, 31/8): sáng đi muộn 1 phút nhưng vẫn
        được 0.5 công + nghỉ phép nửa ngày (chiều) được duyệt -> PHẢI ra 1.0
        công, không phải 0.5."""
        state = _make_state([
            _attendance_entry("2026-08-31", {"nua_ngay_cong": 0.5, "di_muon_ve_som": 1, "tong_phat": 100_000}),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _leave_half_day_approval_event("2026-08-31"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)
        self.assertEqual(effects.get("nghi_phep"), 0.5)
        self.assertEqual(effects.get("remaining_annual_leave"), -0.5)

    def test_clean_morning_attendance_plus_afternoon_leave_still_reaches_full_day(self):
        """Regression guard: baseline không vi phạm gì vẫn phải cộng bù đúng
        như trước (đã hoạt động đúng ngay cả với code cũ)."""
        state = _make_state([
            _attendance_entry("2026-08-31", {"nua_ngay_cong": 0.5}),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _leave_half_day_approval_event("2026-08-31"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_no_existing_attendance_grants_only_half_target(self):
        """Ngày hoàn toàn chưa có công nào (nghỉ phép nửa ngày, buổi còn lại
        cũng không đi làm) -> chỉ cộng đúng 0.5, không tự nâng lên 1.0."""
        state = _make_state([])
        effects = state._evaluate_explanation_approval_rule(
            _leave_half_day_approval_event("2026-08-31"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_full_day_attendance_already_present_does_not_overflow_past_one(self):
        """An toàn trần 1.0: nếu ngày đó đã có đủ 1.0 công thật (hiếm/dữ liệu
        lệch) mà vẫn có đơn nghỉ phép nửa ngày được duyệt -> không được vượt
        quá 1.0 công."""
        state = _make_state([
            _attendance_entry("2026-08-31", {"nua_ngay_cong": 1.0}),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _leave_half_day_approval_event("2026-08-31"), {}
        )
        self.assertNotIn("nua_ngay_cong", effects)

    def test_full_day_leave_unaffected_by_fix(self):
        """Nghỉ phép CẢ NGÀY (không phải nửa ngày) không đi qua nhánh cộng bù
        additive — vẫn dùng công thức top-up như cũ (không đổi)."""
        state = _make_state([])
        effects = state._evaluate_explanation_approval_rule(
            _leave_full_day_approval_event("2026-08-31"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 1.0)
        self.assertEqual(effects.get("nghi_phep"), 1.0)
        self.assertEqual(effects.get("remaining_annual_leave"), -1.0)

    def test_severely_late_absent_morning_plus_afternoon_leave_still_reaches_half(self):
        """Sáng đi muộn >= 120 phút -> vang_mat (KHÔNG có công dương), chiều
        nghỉ phép nửa ngày được duyệt -> vẫn phải ra đúng 0.5 (target_credit),
        không bị vang_mat kéo âm hay chặn cộng."""
        state = _make_state([
            _attendance_entry("2026-08-31", {"vang_mat": 0.5, "di_muon_ve_som": 0}),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _leave_half_day_approval_event("2026-08-31"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)
