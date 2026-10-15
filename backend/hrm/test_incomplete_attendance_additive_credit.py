"""
hrm/test_incomplete_attendance_additive_credit.py
══════════════════════════════════════════════════
Bug thực tế (NV NV02819, 03/9/2026): nghỉ phép nửa ngày buổi sáng (đã duyệt,
+0.5 công) + giải trình "Quên chấm công" (INCOMPLETE_ATTENDANCE) buổi chiều
(quên check-in 13h, check-out 17h30 -> 4.5h làm việc, dưới ngưỡng 5.5h nên
target_credit=0.5) — cả 2 đơn đều đã được duyệt, nhưng cả ngày vẫn chỉ ra
0.5 công thay vì đúng ra 1.0.

Nguyên nhân: is_additive_half_day_type (cơ chế cộng bù công của buổi CÒN LẠI
trong ngày, xem comment tại chỗ tính work credit trong
_evaluate_explanation_approval_rule) chỉ áp dụng cho LEAVE/BUSINESS_TRIP/
FIRST_DAY/WORK_FROM_HOME khi expected_status="HALF_DAY" — INCOMPLETE_ATTENDANCE
không nằm trong danh sách, VÀ field expected_status của nó mang giá trị khác
("PRESENT", không phải "HALF_DAY") nên không tự khớp điều kiện is_half_day_expected.
Kết quả: needed = max(0, target_credit - existing_credit) = max(0, 0.5-0.5) = 0
— giải trình chiều không cộng thêm gì, dù target_credit 0.5 của nó là công
của MỘT buổi khác hẳn buổi đã có existing_credit (buổi sáng, từ đơn nghỉ phép).

Fix: thêm INCOMPLETE_ATTENDANCE vào is_additive_half_day_type, và coi nó luôn
là "loại công 1 buổi" (is_partial_credit_type) bất kể expected_status.
"""
from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState


def _make_state(calendar_result):
    state = EmployeeState("TEST_NV")
    state.calendar_result = calendar_result
    return state


def _entry(event_date, effects):
    return {
        "date": event_date,
        "event_type": "attendance",
        "rules_applied": [{"rule_type": "SHIFT_RULE_MORNING"}],
        "effects": effects,
        "delta": dict(effects),
    }


def _attendance_entry(event_date, check_in=None, check_out=None, effects=None):
    """Giống _entry() nhưng có thêm check_in/check_out ở top-level — đúng
    hình dạng thật mà apply_rules() lưu vào calendar_result (xem
    main_api.py dòng ~613), dùng để test fallback tra chấm công thật."""
    effects = effects or {}
    return {
        "date": event_date,
        "event_type": "attendance",
        "check_in": check_in,
        "check_out": check_out,
        "rules_applied": [{"rule_type": "SHIFT_RULE_MORNING"}],
        "effects": effects,
        "delta": dict(effects),
    }


def _incomplete_attendance_approval_event(event_date, forgot_checkin_time=None, forgot_checkout_time=None,
                                           actual_check_in=None, actual_check_out=None,
                                           forgot_punch_type="checkin", expected_status="PRESENT"):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "INCOMPLETE_ATTENDANCE",
        "date": event_date,
        "expected_status": expected_status,
        "forgot_punch_type": forgot_punch_type,
        "forgot_checkin_time": forgot_checkin_time,
        "forgot_checkout_time": forgot_checkout_time,
        "actual_check_in": actual_check_in,
        "actual_check_out": actual_check_out,
    })


class IncompleteAttendanceStacksWithOtherHalfDayCreditTests(SimpleTestCase):
    def test_afternoon_forgot_checkin_adds_on_top_of_morning_leave(self):
        # Buổi sáng đã có 0.5 công từ đơn nghỉ phép nửa ngày (đã duyệt).
        state = _make_state([
            _entry("2026-09-03", {"nua_ngay_cong": 0.5}),
        ])
        event = _incomplete_attendance_approval_event(
            "2026-09-03",
            forgot_checkin_time="13:00:00",
            actual_check_out="17:30:00",
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        self.assertEqual(
            effects.get("nua_ngay_cong"), 0.5,
            "Giải trình quên chấm công chiều (4.5h -> 0.5 công) phải cộng bù "
            "với buổi sáng (đã 0.5 công từ nghỉ phép) để ra tổng 1.0 công/ngày",
        )

    def test_full_day_timeline_still_caps_at_one_when_half_day_already_credited(self):
        # Nếu timeline tính ra đủ 1.0 công (>=5.5h) nhưng buổi sáng đã có 0.5
        # công riêng -> chỉ cộng thêm 0.5 để chạm trần 1.0, không cộng thừa.
        state = _make_state([
            _entry("2026-09-03", {"nua_ngay_cong": 0.5}),
        ])
        event = _incomplete_attendance_approval_event(
            "2026-09-03",
            forgot_checkin_time="08:00:00",
            actual_check_out="17:30:00",
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_no_existing_credit_behaves_as_before(self):
        # Không có công nào khác trong ngày -> kết quả giữ nguyên như trước
        # khi sửa (không có regression cho trường hợp phổ biến nhất: quên
        # chấm công 1 buổi duy nhất trong ngày, không có đơn nào khác).
        state = _make_state([])
        event = _incomplete_attendance_approval_event(
            "2026-09-03",
            forgot_checkin_time="13:00:00",
            actual_check_out="17:30:00",
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_two_incomplete_attendance_half_credits_combine_to_full_day(self):
        # Quên chấm công CẢ sáng lẫn chiều, khai báo bằng 2 đơn riêng, mỗi đơn
        # tính ra 0.5 công (timeline mỗi buổi < 5.5h) -> phải cộng dồn thành 1.0.
        state = _make_state([])
        morning_event = _incomplete_attendance_approval_event(
            "2026-09-03", forgot_checkin_time="08:30:00", actual_check_out="11:30:00",
        )
        effects1 = state._evaluate_explanation_approval_rule(morning_event, {})
        self.assertEqual(effects1.get("nua_ngay_cong"), 0.5)
        state.calendar_result.append(_entry("2026-09-03", effects1))

        afternoon_event = _incomplete_attendance_approval_event(
            "2026-09-03", forgot_checkin_time="13:00:00", actual_check_out="17:30:00",
        )
        effects2 = state._evaluate_explanation_approval_rule(afternoon_event, {})
        self.assertEqual(effects2.get("nua_ngay_cong"), 0.5)


class IncompleteAttendanceFallsBackToRealAttendanceTests(SimpleTestCase):
    """Bug thực tế (NV NV03078, 17/9/2026): quên check-in buổi sáng (khai
    08:30), nộp đơn giải trình lúc 11h22 — TRƯỚC KHI chấm công ra buổi
    chiều/tối phát sinh (17:49, ghi nhận lúc ~17h50 cùng ngày). Snapshot
    actual_check_out lúc tạo đơn vì vậy là null. Đơn được duyệt xong ở cấp
    HR vào NGÀY HÔM SAU (khi chấm công thật 17:49 đã tồn tại từ lâu), nhưng
    code vẫn chỉ đọc snapshot null -> thiếu timeline -> mặc định 0.5 công,
    dù thực tế nhân viên làm từ 08:30-17:49 (~9.3h, dư ngưỡng 5.5h cho 1.0
    công).

    Fix: fallback tra lại calendar_result của đúng event_date để lấy chấm
    công thật khi snapshot rỗng — CHỈ lấy đúng phía nhân viên khai đã quên
    (forgot_punch_type), không lấy nhầm phía kia (1 lượt chấm công duy
    nhất trong ngày bị ghi đè lên CẢ check_in lẫn check_out khi import)."""

    def test_missing_checkout_snapshot_falls_back_to_real_attendance(self):
        # Chấm công thật của đúng ngày đã có trong calendar_result (được xử lý
        # trước, vì explanation_approval luôn sort theo NGÀY DUYỆT thực tế —
        # ở đây là hôm sau — nên chắc chắn đứng sau attendance của event_date).
        state = _make_state([
            _attendance_entry("2026-09-17", check_in="17:49:00", check_out="17:49:00"),
        ])
        event = _incomplete_attendance_approval_event(
            "2026-09-17",
            forgot_punch_type="checkin",
            forgot_checkin_time="08:30:00",
            actual_check_in=None,
            actual_check_out=None,  # snapshot rỗng lúc tạo đơn
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        self.assertEqual(
            effects.get("nua_ngay_cong"), 1.0,
            "08:30 -> 17:49 (~9.3h) phải ra Đủ công (1.0), không phải 0.5 mặc định",
        )

    def test_does_not_borrow_wrong_side_from_merged_single_punch(self):
        # Quên CHECK-OUT (không phải checkin) — fallback chỉ được lấy check_in
        # thật, KHÔNG được lấy check_out thật gán nhầm cho actual_check_in.
        state = _make_state([
            _attendance_entry("2026-09-17", check_in="08:31:00", check_out="08:31:00"),
        ])
        event = _incomplete_attendance_approval_event(
            "2026-09-17",
            forgot_punch_type="checkout",
            forgot_checkout_time="17:30:00",
            actual_check_in=None,
            actual_check_out=None,
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        self.assertEqual(effects.get("nua_ngay_cong"), 1.0)

    def test_fallback_not_used_when_snapshot_already_has_data(self):
        # Có sẵn actual_check_out trong đơn -> KHÔNG cần fallback, dùng luôn
        # (không có regression khi snapshot đã đầy đủ như trước giờ).
        state = _make_state([
            _attendance_entry("2026-09-17", check_in="17:49:00", check_out="17:49:00"),
        ])
        event = _incomplete_attendance_approval_event(
            "2026-09-17",
            forgot_punch_type="checkin",
            forgot_checkin_time="08:30:00",
            actual_check_out="12:00:00",  # snapshot khác hẳn chấm công thật
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        # 08:30 -> 12:00 = 3.5h < 5.5h -> vẫn phải ra 0.5 (dùng đúng snapshot,
        # không bị fallback ghi đè).
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_no_real_attendance_that_day_still_defaults_to_half(self):
        # Không có chấm công thật nào trong ngày -> giữ hành vi cũ (0.5 mặc định).
        state = _make_state([])
        event = _incomplete_attendance_approval_event(
            "2026-09-17",
            forgot_punch_type="checkin",
            forgot_checkin_time="08:30:00",
            actual_check_out=None,
        )
        effects = state._evaluate_explanation_approval_rule(event, {})
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)
