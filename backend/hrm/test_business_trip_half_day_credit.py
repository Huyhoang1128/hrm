"""
hrm/test_business_trip_half_day_credit.py
══════════════════════════════════════════
Test cho bug: đơn "Công tác nửa ngày" (BUSINESS_TRIP, expected_status=HALF_DAY)
dùng để giải trình cho vi phạm ĐI MUỘN (nhân viên vẫn có mặt, chỉ muộn <120
phút nên buổi đó đã tự được 0.5 công + bị phạt tiền) lại bị cộng thêm 0.5 công
"bù" nữa, ra tổng 1.0 công — trong khi thực tế nhân viên chỉ làm đúng 1 buổi
(vd: check-in 09:43, check-out 12:02, không quay lại buổi chiều).

Nguyên nhân: _evaluate_explanation_approval_rule() coi TOÀN BỘ existing_credit
của ngày là công của "buổi còn lại" (không liên quan đến đơn), rồi cộng thêm
target_credit (0.5) của đơn lên trên — đúng với ví dụ được thiết kế (đã đi làm
ca chiều 0.5 + đơn công tác sáng 0.5 = 1.0), nhưng SAI khi existing_credit
thực ra chính là công của CÙNG buổi mà đơn đang giải trình (buổi đó có vi phạm
đi muộn/về sớm nhưng vẫn đủ 0.5 công vì < 120 phút).

Fix: nếu ngày đó có vi phạm đi muộn/về sớm (day_violations > 0) — dấu hiệu
cho biết đã có 1 buổi "muộn/sớm nhưng vẫn có công" — thì KHÔNG cộng thêm nữa,
chỉ giữ nguyên công thực tế (đơn chỉ có tác dụng miễn phạt). Chỉ cộng thêm khi
ngày đó KHÔNG có vi phạm nào (existing_credit chắc chắn đến từ buổi khác).

Dùng SimpleTestCase (không cần DB) — các giá trị calendar_result được set tay
trực tiếp trong test, giống hrm/test_night_shift_late_credit.py.
"""
from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState


def _make_state(calendar_result, explanation_quota_used=0):
    state = EmployeeState("TEST_NV")
    state.calendar_result = calendar_result
    state.explanation_quota_used = explanation_quota_used
    return state


def _attendance_entry(event_date, effects, delta=None):
    """Entry mô phỏng calendar_result của MỘT ngày (chỉ có 1 event ATTENDANCE/ngày)."""
    return {
        "date": event_date,
        "event_type": "attendance",
        "rules_applied": [{"rule_type": "SHIFT_RULE_MORNING"}],
        "effects": effects,
        "delta": delta if delta is not None else dict(effects),
    }


def _business_trip_approval_event(event_date, expected_status="HALF_DAY"):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "BUSINESS_TRIP",
        "expected_status": expected_status,
        "date": event_date,
        # Không set approved_for_event_id để tránh chạm DB (SimpleTestCase không có DB).
    })


def _first_day_half_day_approval_event(event_date):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "FIRST_DAY",
        "expected_status": "HALF_DAY",
        "date": event_date,
    })


class BusinessTripHalfDayLateCreditTests(SimpleTestCase):
    def test_late_but_present_morning_does_not_get_extra_half_day_credit(self):
        """Kịch bản bug thực tế: check-in 09:43 (muộn 73p, <120p) -> buổi sáng đã
        tự có 0.5 công + bị phạt tiền + 1 lỗi đi muộn (di_muon_ve_som). Duyệt đơn
        "Công tác nửa ngày" để xin miễn phạt cho buổi đó -> KHÔNG được cộng thêm
        0.5 công nữa, tổng vẫn là 0.5 (không phải 1.0)."""
        state = _make_state([
            _attendance_entry(
                "2026-08-08",
                effects={"nua_ngay_cong": 0.5, "di_muon_ve_som": 1, "tong_phat": 200_000},
            ),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _business_trip_approval_event("2026-08-08"), {}
        )
        self.assertNotIn("nua_ngay_cong", effects)
        # Đơn vẫn phải có tác dụng miễn phạt tiền đi muộn.
        self.assertEqual(effects.get("tong_phat"), -200_000)
        # Và xoá lỗi đi muộn đã tích luỹ.
        self.assertEqual(effects.get("di_muon_ve_som"), -1)

    def test_genuine_absent_half_still_gets_additive_credit(self):
        """Regression guard — đúng kịch bản được thiết kế: đã đi làm ca chiều
        bình thường (0.5, KHÔNG vi phạm) + đơn công tác nửa ngày (giải trình cho
        buổi sáng vắng mặt thật) -> vẫn phải cộng thêm 0.5, tổng 1.0 như cũ."""
        state = _make_state([
            _attendance_entry("2026-08-08", effects={"nua_ngay_cong": 0.5}),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _business_trip_approval_event("2026-08-08"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_no_existing_credit_grants_full_target(self):
        """Ngày hoàn toàn chưa có công nào (chưa có event nào khác) -> đơn công
        tác nửa ngày vẫn cộng đúng 0.5 công của nó."""
        state = _make_state([])
        effects = state._evaluate_explanation_approval_rule(
            _business_trip_approval_event("2026-08-08"), {}
        )
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_first_day_half_day_same_late_but_present_session_not_double_credited(self):
        """Cùng bug pattern nhưng với loại đơn FIRST_DAY (ngày đầu đi làm nửa
        ngày) — 2 loại này dùng chung 1 khối code cộng công (is_additive_half_
        day_type), nên fix cũng phải áp dụng đúng cho FIRST_DAY.

        Lưu ý: LEAVE (nghỉ phép tháng) lại đi qua một nhánh code HOÀN TOÀN
        RIÊNG (không thuộc VALID_EXPLANATION_TYPES ở đầu hàm) nên KHÔNG được
        fix này áp dụng — xem ghi chú trong báo cáo gửi người dùng."""
        state = _make_state([
            _attendance_entry(
                "2026-08-08",
                effects={"nua_ngay_cong": 0.5, "di_muon_ve_som": 1, "tong_phat": 100_000},
            ),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _first_day_half_day_approval_event("2026-08-08"), {}
        )
        self.assertNotIn("nua_ngay_cong", effects)
