"""
hrm/test_auto_shift_detect_margin.py
══════════════════════════════════════
Bug thực tế (2026-09-16): một NV có ca cá
nhân riêng "CA_SANG_8h30" (8:30-12:00), nhưng phòng ban của anh cũng có 1 ca
khác gần giống hệt "CA_CSKH_8H_MORNING" (8:00-12:00, chỉ lệch 30 phút).

Ngày 12/9 (thứ 7 tuần 2 — chỉ làm nửa ngày sáng theo chính sách), anh checkin
08:14/checkout 12:01. Với thuật toán CŨ (detect_best_matching_shift() không
biết ca nào đang là mặc định), độ lệch so với ca phòng ban (8:00-12:00) là
14+1=15', so với ca cá nhân (8:30-12:00) là 16+1=17' — ca phòng ban LỆCH ÍT
HƠN vỏn vẹn 2 phút nên "thắng", khiến hệ thống ÂM THẦM đổi ca tính công của
anh từ 8:30 sang 8:00, biến giờ checkin 08:14 (sớm hơn ca thật 16') thành
"đi muộn 14 phút" so với ca không phải của anh.

Ngày 5/9 (thứ 7 tuần 1, làm cả ngày, checkout 17:35) KHÔNG bị lỗi này vì
checkout lệch quá xa (>60') mọi ca nửa ngày nên auto-detect không match được
gì, tự rơi về ca mặc định 8:30 — cùng 1 nhân viên, cùng giờ checkin 08:14,
nhưng 2 ngày cho 2 kết quả trái ngược chỉ vì checkout khác nhau.

Fix: detect_best_matching_shift() nhận thêm current_rules_by_type — 1 ứng
viên chỉ được chọn thay ca mặc định CÙNG LOẠI (sáng/chiều) của nó nếu lệch
THẤP HƠN ca mặc định ít nhất min_improvement_minutes (mặc định 20) phút.
Không truyền tham số này (như code cũ/test cũ) -> hành vi giữ nguyên y hệt
trước đây.
"""
import datetime
from unittest.mock import patch

from django.test import SimpleTestCase

from hrm.event import Event
from hrm.main_api import EmployeeState
from hrm.shift_config_utils import detect_best_matching_shift


class _FakeShift:
    def __init__(self, name, start, end, shift_type='MORNING', working_hours=8.0):
        self.name = name
        self.start_time = start
        self.end_time = end
        self.shift_type = shift_type
        self.working_hours = working_hours


def _t(hh, mm):
    return datetime.time(hh, mm)


def _state(employee_code):
    """EmployeeState cho test SimpleTestCase (không DB).

    Đánh dấu sẵn _employee_obj_loaded để _resolve_effective_rules_for_event()
    bỏ qua bước tra ca đã ĐĂNG KÝ ("Đăng ký ca làm") — các test ở file này chỉ
    xét nhánh tự động nhận diện ca, và nhân viên ở đây đều ngoài phạm vi đăng
    ký ca. Không đánh dấu thì bước đó sẽ query Employee và ném
    DatabaseOperationForbidden (bị bắt và log traceback gây nhiễu output).
    """
    state = EmployeeState(employee_code)
    state._employee_obj = None
    state._employee_obj_loaded = True
    return state


class DetectBestMatchingShiftMarginFixTests(SimpleTestCase):
    """Tái hiện đúng số liệu thật của NV80040."""

    def setUp(self):
        self.personal_shift = _FakeShift("CA_SANG_8h30", _t(8, 30), _t(12, 0))
        self.department_shift = _FakeShift("CA_CSKH_8H_MORNING", _t(8, 0), _t(12, 0))
        self.candidates = [self.department_shift, self.personal_shift]
        self.current_rules_by_type = {
            'SHIFT_RULE_MORNING': ('08:30:00', '12:00:00'),
        }

    def test_bug_reproduced_without_margin_department_shift_wins_by_2_minutes(self):
        """Xác nhận đúng cơ chế gây lỗi: KHÔNG truyền current -> ca phòng ban
        (lệch 15') thắng ca cá nhân (lệch 17') dù chỉ hơn 2 phút."""
        result = detect_best_matching_shift(self.candidates, "08:14", "12:01")
        self.assertIs(result, self.department_shift)

    def test_fixed_with_margin_personal_shift_is_kept_day_12_scenario(self):
        """Sau fix: có current (ca cá nhân 8h30 đang dùng) -> ca phòng ban chỉ
        lệch ít hơn 2 phút (< 20' margin) -> KHÔNG đổi, trả về None (giữ ca cá
        nhân, không ai bị tính "đi muộn" oan)."""
        result = detect_best_matching_shift(
            self.candidates, "08:14", "12:01",
            current_rules_by_type=self.current_rules_by_type,
        )
        self.assertIsNone(result)

    def test_day_5_scenario_full_day_checkout_never_matches_half_day_shifts(self):
        """Ngày 5/9 (checkout 17:35, cả ngày): không ca nửa ngày nào lọt dung
        sai 60' cho checkout -> None ngay từ tolerance filter, không liên
        quan gì tới margin -> hành vi giữ nguyên đúng như trước (ca mặc định
        8h30 được EmployeeState dùng vì không có gì để ghi đè)."""
        result = detect_best_matching_shift(
            self.candidates, "08:14", "17:35",
            current_rules_by_type=self.current_rules_by_type,
        )
        self.assertIsNone(result)

    def test_meaningful_difference_still_overrides_despite_margin(self):
        """Ca thực sự khác biệt lớn (vd 13h-21h so với mặc định 13h-17h30,
        lệch hàng trăm phút) vẫn phải được phát hiện — margin không được
        chặn nhầm trường hợp NV thực sự làm ca khác hẳn."""
        default_shift = _FakeShift("Ca chiều hành chính", _t(13, 0), _t(17, 30), shift_type='AFTERNOON')
        extended_shift = _FakeShift("Ca kinh doanh", _t(13, 0), _t(21, 0), shift_type='AFTERNOON')
        current = {'SHIFT_RULE_AFTERNOON': ('13:00:00', '17:30:00')}

        result = detect_best_matching_shift(
            [default_shift, extended_shift], "13:00", "21:00",
            current_rules_by_type=current,
        )
        self.assertIs(result, extended_shift)

    def test_candidate_exactly_matching_current_is_rejected_not_just_non_improving(self):
        """Ứng viên trùng khớp CHÍNH ca hiện tại (lệch = current, cải thiện=0)
        vẫn phải bị loại — không có gì để 'ghi đè' cả vì nó chính là ca hiện
        tại."""
        same_as_current = _FakeShift("Bản sao ca hiện tại", _t(8, 30), _t(12, 0))
        result = detect_best_matching_shift(
            [same_as_current], "08:14", "12:01",
            current_rules_by_type={'SHIFT_RULE_MORNING': ('08:30:00', '12:00:00')},
        )
        self.assertIsNone(result)

    def test_no_current_for_this_rule_type_keeps_old_behavior(self):
        """rule_type của ứng viên KHÔNG có trong current_rules_by_type (vd
        nhân viên chưa từng có ca AFTERNOON mặc định nào) -> không áp margin,
        xét như code cũ (không current để so sánh)."""
        afternoon_shift = _FakeShift("Ca chiều mới", _t(13, 0), _t(17, 0), shift_type='AFTERNOON')
        result = detect_best_matching_shift(
            [afternoon_shift], "13:05", "17:02",
            current_rules_by_type={'SHIFT_RULE_MORNING': ('08:30:00', '12:00:00')},  # chỉ có sáng
        )
        self.assertIs(result, afternoon_shift)

    def test_without_current_rules_by_type_param_behaves_exactly_like_before(self):
        """Không truyền current_rules_by_type (như mọi lời gọi/test cũ trước
        khi có fix) -> hành vi y hệt trước đây, không bị margin ảnh hưởng."""
        result = detect_best_matching_shift(self.candidates, "08:14", "12:01")
        self.assertIs(result, self.department_shift)


def _morning_rule(start="08:30:00", end="12:00:00"):
    return {
        "rule_name": "CA_SANG_8h30",
        "rule_type": "SHIFT_RULE_MORNING",
        "conditions": {"start_time": start, "end_time": end, "workday": 0.5},
        "priority": 50,
    }


class ResolveEffectiveRulesForEventIntegrationTests(SimpleTestCase):
    """Test hrm.main_api.EmployeeState._resolve_effective_rules_for_event()
    — đúng phần nối dây current_rules_by_type vào detect_best_matching_shift()
    — mock hẳn _get_all_candidate_shifts_for_employee (DB) để chạy không cần
    Postgres, tái hiện chính xác kịch bản NV80040 ngày 12/9."""

    def _candidates(self):
        return [
            _FakeShift("CA_CSKH_8H_MORNING", _t(8, 0), _t(12, 0)),
            _FakeShift("CA_SANG_8h30", _t(8, 30), _t(12, 0)),
        ]

    def test_day_12_scenario_keeps_personal_shift_after_fix(self):
        """Trước fix: rule bị ghi đè sang 8h00 (ca phòng ban). Sau fix: giữ
        nguyên self.rules (ca cá nhân 8h30), không ghi đè gì."""
        state = _state("NV80040")
        state.rules = [_morning_rule()]
        event = Event("attendance", {
            "date": "2026-09-12", "check_in": "08:14", "check_out": "12:01",
        })

        with patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=self._candidates()):
            effective = state._resolve_effective_rules_for_event(event)

        self.assertIs(effective, state.rules)
        self.assertEqual(effective[0]["conditions"]["start_time"], "08:30:00")

    def test_day_5_scenario_unaffected_full_day_checkout(self):
        """Checkout cả ngày (17:35) không khớp ca nửa ngày nào -> không ghi
        đè gì, y hệt trước fix."""
        state = _state("NV80040")
        state.rules = [_morning_rule()]
        event = Event("attendance", {
            "date": "2026-09-05", "check_in": "08:14", "check_out": "17:35",
        })

        with patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=self._candidates()):
            effective = state._resolve_effective_rules_for_event(event)

        self.assertIs(effective, state.rules)

    def test_genuinely_different_shift_still_overrides_end_to_end(self):
        """Regression: ca thực sự khác biệt lớn (13h-21h) vẫn phải được ghi
        đè đúng — fix margin không được chặn nhầm use case gốc của tính năng."""
        state = _state("EXT-NV")
        state.rules = [{
            "rule_name": "Ca chiều hành chính",
            "rule_type": "SHIFT_RULE_AFTERNOON",
            "conditions": {"start_time": "13:00:00", "end_time": "17:30:00", "workday": 0.5},
            "priority": 50,
        }]
        event = Event("attendance", {
            "date": "2026-09-12", "check_in": "13:00", "check_out": "21:00",
        })
        candidates = [
            _FakeShift("Ca chiều hành chính", _t(13, 0), _t(17, 30), shift_type='AFTERNOON'),
            _FakeShift("Ca kinh doanh", _t(13, 0), _t(21, 0), shift_type='AFTERNOON'),
        ]

        with patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=candidates):
            effective = state._resolve_effective_rules_for_event(event)

        self.assertIsNot(effective, state.rules)
        overridden = next(r for r in effective if r["rule_type"] == "SHIFT_RULE_AFTERNOON")
        self.assertEqual(overridden["conditions"]["end_time"], "21:00:00")

    def test_single_detection_only_candidate_still_overrides_hm02842_scenario(self):
        """Bug thực tế (2026-09-17, NV80027, phòng Kinh Doanh 1): phòng ban chỉ
        được gán DUY NHẤT 1 ca (KD-FULL, detection_only=True) -> get_all_
        candidate_shifts_for_employee() trả về đúng 1 phần tử. Guard cũ
        ("len(candidates) < 2 -> bỏ qua") khiến ngày làm đúng ca kinh doanh
        (checkin ~13h/checkout 21h) vẫn bị tính theo ca mặc định công ty
        ngắn hơn (13h-17h, 0.5 công) thay vì ca kinh doanh (8h, 1.0 công).
        Sau fix: chỉ cần candidates không rỗng là đủ để so khớp."""
        state = _state("NV80027")
        state.rules = [{
            "rule_name": "Ca chiều mặc định công ty",
            "rule_type": "SHIFT_RULE_AFTERNOON",
            "conditions": {"start_time": "13:00:00", "end_time": "17:00:00", "workday": 0.5},
            "priority": 50,
        }]
        event = Event("attendance", {
            "date": "2026-09-05", "check_in": "12:58", "check_out": "21:00",
        })
        candidates = [_FakeShift("Ca kinh doanh", _t(13, 0), _t(21, 0), shift_type='AFTERNOON', working_hours=8.0)]

        with patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=candidates):
            effective = state._resolve_effective_rules_for_event(event)

        self.assertIsNot(effective, state.rules)
        overridden = next(r for r in effective if r["rule_type"] == "SHIFT_RULE_AFTERNOON")
        self.assertEqual(overridden["conditions"]["end_time"], "21:00:00")
        self.assertEqual(overridden["conditions"]["workday"], 1.0)

    def test_single_candidate_identical_to_current_is_noop(self):
        """Trường hợp phổ biến nhất (phòng ban chỉ có đúng 1 ca, và đó chính
        là ca mặc định đang dùng): dù không còn guard "< 2", vẫn phải là
        no-op vì detect ra chính ca hiện tại -> không có gì để ghi đè."""
        state = _state("NV-BINH-THUONG")
        state.rules = [_morning_rule()]
        event = Event("attendance", {
            "date": "2026-09-05", "check_in": "08:31", "check_out": "12:00",
        })
        candidates = [_FakeShift("CA_SANG_8h30", _t(8, 30), _t(12, 0))]

        with patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=candidates):
            effective = state._resolve_effective_rules_for_event(event)

        self.assertIs(effective, state.rules)

    def test_single_candidate_not_matching_tolerance_is_noop(self):
        """1 candidate duy nhất nhưng giờ chấm công thực tế không khớp trong
        dung sai -> detect_best_matching_shift trả None -> giữ nguyên rules,
        không lỗi gì dù không còn guard số lượng candidates."""
        state = _state("NV-KHAC")
        state.rules = [_morning_rule()]
        event = Event("attendance", {
            "date": "2026-09-05", "check_in": "08:14", "check_out": "17:35",
        })
        candidates = [_FakeShift("Ca kinh doanh", _t(13, 0), _t(21, 0), shift_type='AFTERNOON', working_hours=8.0)]

        with patch("hrm.main_api._get_all_candidate_shifts_for_employee", return_value=candidates):
            effective = state._resolve_effective_rules_for_event(event)

        self.assertIs(effective, state.rules)
