"""
hrm/test_explanation_approval_violation_counter.py
════════════════════════════════════════════════════
_calc_penalty() nhân đôi tiền phạt khi số vi phạm TÍCH LŨY trong tháng
(di_muon_ve_som + quen_cham_cong) đạt ngưỡng (mặc định 7).

Quy tắc (xác nhận 01/10/2026): đơn giải trình ĐI MUỘN/VỀ SỚM được duyệt chỉ
hoàn tiền phạt của lần đó, KHÔNG trừ lỗi khỏi bộ đếm — lỗi đó vẫn tính vào
mốc lỗi thứ 7. Mọi loại giải trình khác (quên chấm công, công tác, ngày đầu
đi làm, làm online...) được duyệt thì trừ lỗi của ngày đó khỏi bộ đếm.
"""
from django.test import SimpleTestCase, TestCase

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


def _late_approval_event(event_date):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "LATE",
        "date": event_date,
    })


def _early_leave_approval_event(event_date):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "EARLY_LEAVE",
        "date": event_date,
    })


def _forgot_approval_event(event_date):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "FORGOT",
        "date": event_date,
    })


def _business_trip_approval_event(event_date):
    return Event("explanation_approval", {
        "action": "APPROVE",
        "approval_level": "HR",
        "explanation_type": "BUSINESS_TRIP",
        "date": event_date,
    })


class ExplanationApprovalViolationCounterTests(SimpleTestCase):
    """Duyệt giải trình đi muộn/về sớm KHÔNG trừ bộ đếm; các loại khác thì trừ."""

    def test_late_approval_does_not_decrement_counter(self):
        state = _make_state([
            _entry("2026-08-03", {"nua_ngay_cong": 0.5, "di_muon_ve_som": 1, "tong_phat": 50_000, "late_penalty": 50_000}),
        ])
        effects = state._evaluate_explanation_approval_rule(_late_approval_event("2026-08-03"), {})
        self.assertNotIn("di_muon_ve_som", effects)
        self.assertNotIn("violation_count_month", effects)
        # Tiền phạt vẫn được hoàn như cũ.
        self.assertEqual(effects.get("late_penalty"), -50_000)

    def test_early_leave_approval_does_not_decrement_counter(self):
        state = _make_state([
            _entry("2026-08-03", {"nua_ngay_cong": 0.5, "di_muon_ve_som": 1, "tong_phat": 50_000, "early_leave_penalty": 50_000}),
        ])
        effects = state._evaluate_explanation_approval_rule(_early_leave_approval_event("2026-08-03"), {})
        self.assertNotIn("di_muon_ve_som", effects)
        self.assertNotIn("violation_count_month", effects)

    def test_late_approval_does_not_decrement_forgot_counter_same_day(self):
        state = _make_state([
            _entry("2026-08-03", {"di_muon_ve_som": 1, "quen_cham_cong": 1, "tong_phat": 50_000, "late_penalty": 50_000}),
        ])
        effects = state._evaluate_explanation_approval_rule(_late_approval_event("2026-08-03"), {})
        self.assertNotIn("quen_cham_cong", effects)

    def test_business_trip_approval_decrements_counter(self):
        state = _make_state([
            _entry("2026-08-03", {"nua_ngay_cong": 0.5, "di_muon_ve_som": 1, "tong_phat": 50_000, "late_penalty": 50_000}),
        ])
        effects = state._evaluate_explanation_approval_rule(_business_trip_approval_event("2026-08-03"), {})
        self.assertEqual(effects.get("di_muon_ve_som"), -1)
        self.assertEqual(effects.get("violation_count_month"), -1)

    def test_forgot_approval_decrements_quen_cham_cong(self):
        state = _make_state([
            _entry("2026-08-03", {"quen_cham_cong": 1}),
        ])
        effects = state._evaluate_explanation_approval_rule(_forgot_approval_event("2026-08-03"), {})
        self.assertEqual(effects.get("quen_cham_cong"), -1)
        self.assertEqual(effects.get("violation_count_month"), -1)

    def test_no_violation_that_day_no_decrement(self):
        state = _make_state([
            _entry("2026-08-03", {"nua_ngay_cong": 0.5}),
        ])
        effects = state._evaluate_explanation_approval_rule(_business_trip_approval_event("2026-08-03"), {})
        self.assertNotIn("di_muon_ve_som", effects)


class PenaltyMultiplierWithApprovedExplanationsTests(TestCase):
    # TestCase (không phải SimpleTestCase): _resolve_effective_rules_for_event()
    # (tính năng tự nhận diện ca) truy vấn DB cho MỌI event attendance — cần DB
    # thật (sqlite in-memory) để không bị lỗi "Database queries ... forbidden".
    """Tích hợp qua state.apply_rules() tuần tự: 6 lần đi muộn ĐÃ ĐƯỢC DUYỆT
    giải trình vẫn tính vào bộ đếm -> lần đi muộn thứ 7 VẪN bị nhân đôi."""

    def _rules(self):
        return [
            {
                "rule_name": "Ca hành chính",
                "rule_type": "SHIFT_RULE_MORNING",
                "conditions": {"start_time": "08:30:00", "end_time": "17:30:00", "workday": 1.0},
                "priority": 50,
            },
            {
                "rule_name": "Duyệt giải trình",
                "rule_type": "EXPLANATION_APPROVAL_RULE",
                "conditions": {},
                "priority": 50,
            },
        ]

    def test_seventh_late_violation_doubled_even_when_prior_six_were_approved(self):
        state = EmployeeState("MULTI-TEST-NV")
        state.rules = self._rules()

        for day in range(1, 7):  # 6 lần đi muộn, mỗi lần được duyệt ngay sau đó
            event_date = f"2026-08-{day:02d}"
            state.apply_rules(Event("attendance", {
                "date": event_date, "check_in": "08:35", "check_out": "17:30",
            }))
            state.apply_rules(_late_approval_event(event_date))

        self.assertEqual(state.di_muon_ve_som, 6, "Duyệt giải trình đi muộn không được trừ bộ đếm")

        state.apply_rules(Event("attendance", {
            "date": "2026-08-07", "check_in": "08:35", "check_out": "17:30",
        }))
        last_entry = state.calendar_result[-1]
        penalty = last_entry["effects"].get("late_penalty") or last_entry["effects"].get("tong_phat")
        self.assertEqual(penalty, 100_000, f"Lỗi thứ 7 PHẢI bị nhân đôi — thực tế: {penalty}")

    def test_seventh_late_violation_doubled_when_prior_six_unapproved(self):
        """Đối chứng: 6 lần trước không giải trình -> lần thứ 7 bị nhân đôi."""
        state = EmployeeState("MULTI-TEST-NV-2")
        state.rules = self._rules()

        for day in range(1, 7):  # 6 lần đi muộn, KHÔNG duyệt giải trình
            state.apply_rules(Event("attendance", {
                "date": f"2026-08-{day:02d}", "check_in": "08:35", "check_out": "17:30",
            }))

        self.assertEqual(state.di_muon_ve_som, 6)

        state.apply_rules(Event("attendance", {
            "date": "2026-08-07", "check_in": "08:35", "check_out": "17:30",
        }))
        last_entry = state.calendar_result[-1]
        penalty = last_entry["effects"].get("late_penalty") or last_entry["effects"].get("tong_phat")
        self.assertEqual(penalty, 100_000, f"Vi phạm thứ 7 (chưa giải trình) PHẢI bị nhân đôi — thực tế: {penalty}")


class LateExplanationGraceAppliesEquallyToEarlyLeaveTests(SimpleTestCase):
    """Bug thực tế (NV NV02910, 11/9/2026): về sớm 66 phút, giải trình được
    duyệt -> phạt về 0đ, dù đã qua mốc hiệu lực 2026-09-10 ("chỉ ân hạn 30
    phút đầu, phần vượt vẫn bị phạt"). Nguyên nhân: nhánh ân hạn 30 phút chỉ
    được viết cho explanation_type == "LATE", EARLY_LEAVE bị bỏ sót nên vẫn
    chạy theo hành vi cũ (miễn phạt toàn bộ). Fix: áp dụng chung cho cả 2
    loại (bảng phạt đi muộn/về sớm dùng chung 1 barem)."""

    def test_early_leave_after_effective_date_only_forgives_30_minutes(self):
        # 66 phút về sớm -> phạt gốc (bảng cứng, không multiplier trong test
        # không DB) = 200_000 (61-120 phút). Sau ân hạn 30 phút: còn 36 phút
        # -> tra bậc 31-60 phút = 120_000. Chỉ hoàn 200_000-120_000=80_000.
        state = _make_state([
            _entry("2026-09-11", {
                "nua_ngay_cong": 1.0, "di_muon_ve_som": 1,
                "tong_phat": 200_000, "early_leave_penalty": 200_000,
                "early_leave_minutes": 66,
            }),
        ])
        effects = state._evaluate_explanation_approval_rule(_early_leave_approval_event("2026-09-11"), {})
        self.assertEqual(effects.get("early_leave_penalty"), -80_000)
        self.assertEqual(effects.get("tong_phat"), -80_000)

    def test_early_leave_before_effective_date_still_forgives_everything(self):
        # Trước mốc 2026-09-10: giữ nguyên hành vi cũ — giải trình duyệt
        # miễn phạt toàn bộ, không phân biệt số phút.
        state = _make_state([
            _entry("2026-09-09", {
                "nua_ngay_cong": 1.0, "di_muon_ve_som": 1,
                "tong_phat": 200_000, "early_leave_penalty": 200_000,
                "early_leave_minutes": 74,
            }),
        ])
        effects = state._evaluate_explanation_approval_rule(_early_leave_approval_event("2026-09-09"), {})
        self.assertEqual(effects.get("early_leave_penalty"), -200_000)

    def test_late_after_effective_date_only_forgives_30_minutes_unaffected_by_refactor(self):
        # Đối chứng: hành vi LATE (đã đúng từ trước) không bị ảnh hưởng bởi
        # việc tổng quát hoá _get_late_minutes_for_date() để dùng chung cho
        # cả LATE lẫn EARLY_LEAVE.
        state = _make_state([
            _entry("2026-09-15", {
                "nua_ngay_cong": 1.0, "di_muon_ve_som": 1,
                "tong_phat": 120_000, "late_penalty": 120_000,
                "late_minutes": 33,
            }),
        ])
        effects = state._evaluate_explanation_approval_rule(_late_approval_event("2026-09-15"), {})
        # Còn lại 33-30=3 phút -> bậc <=10 phút = 50_000 -> hoàn 120_000-50_000=70_000.
        self.assertEqual(effects.get("late_penalty"), -70_000)


def _approval(explanation_type, event_date, **extra):
    return Event("explanation_approval", {
        "action": "APPROVE", "approval_level": "HR",
        "explanation_type": explanation_type, "date": event_date, **extra,
    })


class CounterReleasedAtViolationDateTests(SimpleTestCase):
    """Case NV03082 T9/2026: quên chấm công 3/9 có đơn "làm ngày đầu" duyệt 18/9 ->
    phần trừ lỗi phải có hiệu lực ngay tại 3/9 (event counter_release_only), event
    duyệt gốc ở 18/9 không trừ lần nữa."""

    def test_release_only_event_decrements_counter_and_nothing_else(self):
        state = _make_state([
            _entry("2026-09-03", {"quen_cham_cong": 1, "tong_phat": 0}),
        ])
        effects = state._evaluate_explanation_approval_rule(
            _approval("FIRST_DAY", "2026-09-03", counter_release_only=True), {})
        self.assertEqual(effects, {"quen_cham_cong": -1, "violation_count_month": -1})
        self.assertEqual(state._counter_released_by_date["2026-09-03"], [0, 1])

    def test_main_approval_after_early_release_does_not_decrement_again(self):
        state = _make_state([
            _entry("2026-09-03", {"quen_cham_cong": 1}),
        ])
        release = state._evaluate_explanation_approval_rule(
            _approval("FIRST_DAY", "2026-09-03", counter_release_only=True), {})
        state.calendar_result.append({"date": "2026-09-03", "event_type": "explanation_approval",
                                      "effects": release, "delta": dict(release)})
        effects = state._evaluate_explanation_approval_rule(
            _approval("FIRST_DAY", "2026-09-03", counter_released_early=True), {})
        self.assertNotIn("quen_cham_cong", effects)
        self.assertNotIn("di_muon_ve_som", effects)

    def test_main_approval_after_early_release_still_sees_original_violations(self):
        # Bước cộng công dùng day_violations: phải là số lỗi GỐC (1), không phải net (0).
        state = _make_state([
            _entry("2026-09-03", {"nua_ngay_cong": 0.5, "di_muon_ve_som": 1}),
        ])
        release = state._evaluate_explanation_approval_rule(
            _approval("WORK_FROM_HOME", "2026-09-03", counter_release_only=True), {})
        state.calendar_result.append({"date": "2026-09-03", "event_type": "explanation_approval",
                                      "effects": release, "delta": dict(release)})
        baseline = _make_state([
            _entry("2026-09-03", {"nua_ngay_cong": 0.5, "di_muon_ve_som": 1}),
        ])
        expected = baseline._evaluate_explanation_approval_rule(
            _approval("WORK_FROM_HOME", "2026-09-03", expected_status="HALF_DAY"), {})
        effects = state._evaluate_explanation_approval_rule(
            _approval("WORK_FROM_HOME", "2026-09-03", expected_status="HALF_DAY", counter_released_early=True), {})
        self.assertEqual(effects.get("nua_ngay_cong"), expected.get("nua_ngay_cong"))


class MultiplierCountsOnlyLateEarlyTests(SimpleTestCase):
    """Mốc x2 (lỗi thứ 7) chỉ đếm đi muộn/về sớm, KHÔNG đếm quên chấm công
    (xác nhận 01/10/2026; case NV02497: 5 lần muộn + 1 quên CC -> lần muộn thứ 6
    bị x2 sai)."""

    def _calc(self, di_muon, quen_cc, pending=0):
        from unittest import mock
        import hrm.main_api as m
        fake = mock.Mock()
        fake.load.return_value = {"policy": {"penalty_multiplier_threshold": 7, "penalty_multiplier_value": 2.0}, "penalty_tiers": []}
        fake.lookup_penalty.return_value = (50_000, 0)
        state = EmployeeState("X")
        state.di_muon_ve_som, state.quen_cham_cong = di_muon, quen_cc
        with mock.patch.object(m, "_PolicyLoader", fake):
            return state._calc_penalty(4, pending_violations=pending)

    def test_forgot_not_counted(self):
        self.assertEqual(self._calc(di_muon=5, quen_cc=1), 50_000)
        self.assertEqual(self._calc(di_muon=5, quen_cc=10), 50_000)

    def test_seventh_late_still_doubled(self):
        self.assertEqual(self._calc(di_muon=6, quen_cc=0), 100_000)

    def test_same_day_pending_late_counts(self):
        self.assertEqual(self._calc(di_muon=5, quen_cc=0, pending=1), 100_000)
