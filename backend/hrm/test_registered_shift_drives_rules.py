"""
hrm/test_registered_shift_drives_rules.py
═══════════════════════════════════════════
Bug thực tế (phát hiện 2026-09-19): ca đã ĐĂNG KÝ ("Đăng ký ca làm") được
resolve ĐÚNG nhưng KHÔNG hề ảnh hưởng tới công/phạt.

Số liệu thực tế — một NV thuộc phạm vi
ShiftRegistrationScopeConfig "Điều dưỡng BS Ma BS A":
  • Ngày 2026-09-09 đã đăng ký + được duyệt Ca 2
    (sáng 09:30-13:30, chiều 14:30-18:30).
  • Chấm công thực tế 09:13 → 18:32, tức là đi SỚM so với Ca 2.
  • Nhưng hệ thống báo "Đi muộn 103 phút" + phạt 200.000đ, vì 103' đúng bằng
    09:13 − 07:30 — giờ của ca CASCADE theo phòng ban, không phải ca đã đăng ký.

Nguyên nhân: replay_month() chỉ ghi kết quả ca đăng ký vào
`event_data['shift_start_time']` / `['shift_end_time']` (main_api.py), mà
KHÔNG nơi nào trong codebase đọc lại 2 key đó. Trong khi đó _evaluate_*_shift_rule()
lấy giờ ca từ `rule['conditions']['start_time']` — tức là luôn từ rule cascade.
Nên toàn bộ nhánh "ưu tiên tuyệt đối ca đăng ký" là no-op với việc tính công.

Fix: EmployeeState._rules_from_registered_shifts() sinh rule thẳng từ cặp ca
đã đăng ký và thay TOÀN BỘ rule SHIFT_RULE_MORNING/AFTERNOON cho riêng ngày
đó, được gọi ngay đầu _resolve_effective_rules_for_event() — trước cả bước tự
động nhận diện ca.
"""
import datetime
from unittest.mock import patch

from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState


def _t(hh, mm):
    return datetime.time(hh, mm)


class _FakeShift:
    """Đủ field cho shift_configs_to_rules()."""

    def __init__(self, name, start, end, shift_type, working_hours=3.0):
        self.name = name
        self.start_time = start
        self.end_time = end
        self.shift_type = shift_type
        self.working_hours = working_hours


# Cặp ca thật của config "Điều dưỡng BS Ma BS A"
CA1_MORNING = _FakeShift("Ca 1 sáng", _t(7, 30), _t(11, 30), 'MORNING')
CA1_AFTERNOON = _FakeShift("Ca 1 chiều", _t(12, 30), _t(16, 30), 'AFTERNOON')
CA2_MORNING = _FakeShift("Ca 2 sáng", _t(9, 30), _t(13, 30), 'MORNING')
CA2_AFTERNOON = _FakeShift("Ca 2 chiều", _t(14, 30), _t(18, 30), 'AFTERNOON')

# Rule cascade theo phòng ban — đúng giờ đang gây ra "muộn 103 phút"
CASCADE_RULES = [
    {
        'rule_name': 'ShiftConfig: sale điều dưỡng bs b bs a 7h30',
        'rule_type': 'SHIFT_RULE_MORNING',
        'conditions': {'start_time': '07:30:00', 'end_time': '12:00:00', 'workday': 0.5},
        'priority': 50,
    },
    {
        'rule_name': 'ShiftConfig: sale và điều dưỡng bs b bs a checkout 16h30',
        'rule_type': 'SHIFT_RULE_AFTERNOON',
        'conditions': {'start_time': '13:00:00', 'end_time': '16:30:00', 'workday': 0.5},
        'priority': 50,
    },
    # Rule KHÔNG phải ca làm — phải được giữ nguyên khi thay ca.
    {
        'rule_name': 'Nghỉ phép có lương',
        'rule_type': 'LEAVE_RULE_PAID',
        'conditions': {},
        'priority': 10,
    },
]

EVENT_DATE = "2026-09-09"


def _attendance_event(check_in="09:13", check_out="18:32"):
    return Event("attendance", {
        "date": EVENT_DATE,
        "check_in": check_in,
        "check_out": check_out,
        "status": "PRESENT",
    })


def _make_state():
    state = EmployeeState("NV80026")
    state.rules = list(CASCADE_RULES)
    # Nhân viên tồn tại — không chạm DB.
    state._employee_obj = object()
    state._employee_obj_loaded = True
    return state


def _patch_registered(return_value):
    """Patch nguồn ca đăng ký mà _rules_from_registered_shifts() dùng."""
    return patch(
        "hrm.main_api._get_registered_shift_configs_for_date",
        return_value=return_value,
    )


def _shift_rules_by_type(rules):
    return {
        r['rule_type']: (
            r['conditions'].get('start_time'),
            r['conditions'].get('end_time'),
        )
        for r in rules
        if r['rule_type'] in ('SHIFT_RULE_MORNING', 'SHIFT_RULE_AFTERNOON')
    }


class RegisteredShiftDrivesRulesTests(SimpleTestCase):
    """_resolve_effective_rules_for_event() phải ưu tiên ca đã đăng ký."""

    def test_registered_ca2_replaces_cascade_shift_rules(self):
        """Đúng kịch bản NV80026 ngày 9/9: đăng ký Ca 2 -> rule ca sáng/chiều
        phải là 09:30-13:30 và 14:30-18:30, không còn 07:30/13:00 của cascade."""
        state = _make_state()
        with _patch_registered([CA2_MORNING, CA2_AFTERNOON]):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        self.assertEqual(
            _shift_rules_by_type(rules),
            {
                'SHIFT_RULE_MORNING': ('09:30:00', '13:30:00'),
                'SHIFT_RULE_AFTERNOON': ('14:30:00', '18:30:00'),
            },
        )

    def test_non_shift_rules_are_preserved(self):
        """Chỉ thay rule ca sáng/chiều — rule loại khác (nghỉ phép…) giữ nguyên."""
        state = _make_state()
        with _patch_registered([CA2_MORNING, CA2_AFTERNOON]):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        self.assertIn(
            'LEAVE_RULE_PAID',
            {r['rule_type'] for r in rules},
        )

    def test_registered_ca1_also_replaces_cascade(self):
        """Ca 1 đăng ký (11:30/12:30) khác cascade (12:00/13:00) vài chục phút —
        vẫn phải dùng ca đăng ký, không để lệch âm thầm."""
        state = _make_state()
        with _patch_registered([CA1_MORNING, CA1_AFTERNOON]):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        self.assertEqual(
            _shift_rules_by_type(rules),
            {
                'SHIFT_RULE_MORNING': ('07:30:00', '11:30:00'),
                'SHIFT_RULE_AFTERNOON': ('12:30:00', '16:30:00'),
            },
        )

    def test_applies_even_when_check_out_missing(self):
        """Ca đăng ký không phụ thuộc giờ chấm công: ngày quên chấm công ra
        (thiếu check_out) vẫn phải tính đi muộn theo ca đã đăng ký. Guard
        check_in/check_out cũ nằm TRƯỚC nên từng làm hỏng đúng trường hợp này."""
        state = _make_state()
        with _patch_registered([CA2_MORNING, CA2_AFTERNOON]):
            rules = state._resolve_effective_rules_for_event(
                _attendance_event(check_out=None)
            )

        self.assertEqual(
            _shift_rules_by_type(rules)['SHIFT_RULE_MORNING'],
            ('09:30:00', '13:30:00'),
        )

    def test_duplicate_rule_type_is_deduped(self):
        """Cấu hình đặt nhầm 2 ca cùng loại -> giữ ca đầu, không cộng công 2 lần."""
        state = _make_state()
        broken_pair = [
            CA2_MORNING,
            _FakeShift("Ca 2 sáng (trùng loại)", _t(10, 0), _t(14, 0), 'MORNING'),
        ]
        with _patch_registered(broken_pair):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        morning_rules = [r for r in rules if r['rule_type'] == 'SHIFT_RULE_MORNING']
        self.assertEqual(len(morning_rules), 1)
        self.assertEqual(morning_rules[0]['conditions']['start_time'], '09:30:00')


class OutOfScopeBehaviourUnchangedTests(SimpleTestCase):
    """Nhân viên ngoài phạm vi phải giữ NGUYÊN hành vi cũ tuyệt đối."""

    def test_none_falls_back_to_cascade(self):
        """None = ngoài phạm vi / chưa đăng ký -> giữ rule cascade."""
        state = _make_state()
        with _patch_registered(None), \
             patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=[]):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        self.assertEqual(_shift_rules_by_type(rules), _shift_rules_by_type(CASCADE_RULES))

    def test_registered_day_off_falls_back_to_cascade(self):
        """[] = đăng ký NGHỈ. Cố ý giữ hành vi cũ (cascade) thay vì bỏ hết ca —
        xem docstring _rules_from_registered_shifts()."""
        state = _make_state()
        with _patch_registered([]), \
             patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=[]):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        self.assertEqual(_shift_rules_by_type(rules), _shift_rules_by_type(CASCADE_RULES))

    def test_db_error_falls_back_to_cascade(self):
        """Lỗi DB ở bảng của tính năng phụ tuyệt đối không được làm sập chấm công."""
        state = _make_state()
        with patch(
            "hrm.main_api._get_registered_shift_configs_for_date",
            side_effect=RuntimeError("relation does not exist"),
        ), patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=[]):
            rules = state._resolve_effective_rules_for_event(_attendance_event())

        self.assertEqual(_shift_rules_by_type(rules), _shift_rules_by_type(CASCADE_RULES))

    def test_non_attendance_event_untouched(self):
        state = _make_state()
        with _patch_registered([CA2_MORNING, CA2_AFTERNOON]):
            rules = state._resolve_effective_rules_for_event(
                Event("overtime", {"date": EVENT_DATE, "status": "APPROVED"})
            )

        self.assertIs(rules, state.rules)


class LatePenaltyEndToEndTests(SimpleTestCase):
    """Kết quả cuối cùng: 200.000đ phạt oan phải biến mất."""

    def _run(self, registered):
        state = _make_state()
        with _patch_registered(registered), \
             patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=[]):
            state.apply_rules(_attendance_event())
        return state

    def test_bug_reproduced_with_cascade_only(self):
        """Không có ca đăng ký -> vẫn tính theo cascade 07:30: muộn 103' + phạt."""
        state = self._run(None)
        self.assertGreater(state.tong_phat, 0)
        self.assertGreater(state.di_muon_ve_som, 0)

    def test_fixed_registered_ca2_no_late_no_penalty(self):
        """Đăng ký Ca 2 (09:30) + checkin 09:13 -> đi SỚM: không muộn, không phạt."""
        state = self._run([CA2_MORNING, CA2_AFTERNOON])
        self.assertEqual(state.tong_phat, 0)
        self.assertEqual(state.di_muon_ve_som, 0)
