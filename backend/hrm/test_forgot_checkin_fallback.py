"""
Ngày chỉ có GIỜ RA (quên chấm lúc đến) phải bị tính quên chấm công, y như
ngày chỉ có giờ vào.

_match_rule_for_event() chỉ khớp "chỉ có giờ ra" khi giờ ra nằm TRONG ca, mà
người quên chấm lúc đến thường về SAU giờ tan ca (vd 17:36 với ca tan 17:30) —
không rule nào khớp nên ngày đó lọt khỏi bộ đếm quên chấm công. Từ khi upload
phân loại đúng lần chấm lúc về thành giờ ra, trường hợp này thành phổ biến
(chạy thử tháng 9/2026: 12 nhân viên sẽ bị giảm số lần quên chấm công sai).
"""
from unittest.mock import patch

from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState

RULES = [
    {"rule_name": "ShiftConfig: Ca sáng", "rule_type": "SHIFT_RULE_MORNING",
     "conditions": {"start_time": "08:00:00", "end_time": "12:00:00", "workday": 0.5}, "priority": 50},
    {"rule_name": "ShiftConfig: Ca chiều", "rule_type": "SHIFT_RULE_AFTERNOON",
     "conditions": {"start_time": "13:00:00", "end_time": "17:30:00", "workday": 0.5}, "priority": 50},
]


def _quen(check_in=None, check_out=None):
    s = EmployeeState("TEST_NV")
    s.rules = list(RULES)
    data = {"date": "2026-09-17"}
    if check_in:
        data["check_in"] = check_in
    if check_out:
        data["check_out"] = check_out
    with patch.object(EmployeeState, "_resolve_effective_rules_for_event", return_value=list(RULES)):
        s.apply_rules(Event("attendance", data))
    return s.quen_cham_cong


class ForgotCheckinFallbackTests(SimpleTestCase):
    def test_chỉ_có_giờ_ra_sau_giờ_tan_ca_vẫn_là_quên_chấm_công(self):
        self.assertEqual(_quen(check_out="17:36"), 1)

    def test_chỉ_có_giờ_ra_trong_ca_vẫn_đếm_đúng_1_lần(self):
        """Giờ ra trong ca thì rule ca chiều đã đếm — fallback không được đếm thêm."""
        self.assertEqual(_quen(check_out="16:30"), 1)

    def test_chỉ_có_giờ_vào_không_đổi(self):
        self.assertEqual(_quen(check_in="17:36"), 1)
        self.assertEqual(_quen(check_in="07:55"), 1)

    def test_đủ_giờ_vào_ra_không_phải_quên_chấm_công(self):
        self.assertEqual(_quen(check_in="07:55", check_out="17:36"), 0)
