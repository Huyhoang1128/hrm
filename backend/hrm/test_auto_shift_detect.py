"""
hrm/test_auto_shift_detect.py
══════════════════════════════
Rule mới: nếu nhân viên checkin ~13h và checkout ~21h (dung sai ±60 phút cho
mỗi đầu), hệ thống tự động tính công ngày đó theo ca 13:00-21:00 (nếu công ty
đã cấu hình 1 ShiftConfig như vậy áp dụng cho nhân viên/vị trí/phòng ban đó),
thay vì theo ca mặc định (vd: ca chiều hành chính 13:00-17:30) — tránh việc
nhân viên chỉ được chấm nửa công + phải làm đơn tăng ca riêng cho phần dư.

Kiến trúc hiện tại: mỗi nhân viên chỉ có ĐÚNG 1 rule SHIFT_RULE_AFTERNOON
"đang dùng" (load_shift_configs_for_employee() dedup theo rule_type, ưu tiên
cá nhân > vị trí > phòng ban > mặc định công ty) — nên nếu 1 NV được gán CẢ
ca mặc định lẫn ca mở rộng, ca mở rộng thường bị dedup mất, không bao giờ
được xét tới dù giờ chấm công khớp đúng ca đó.

Fix (shift_config_utils.py + main_api.py):
  - get_all_candidate_shifts_for_employee(): lấy TẤT CẢ ca áp dụng cho NV,
    KHÔNG dedup theo rule_type (khác load_shift_configs_for_employee()).
  - detect_best_matching_shift(): so khớp CHẶT (cả start_time lẫn end_time,
    dung sai mặc định ±60 phút) — khác find_matching_shift() (chỉ cần
    overlap 1 phần, dùng cho mục đích khác).
  - EmployeeState._resolve_effective_rules_for_event(): nếu phát hiện 1 ca
    khác khớp hơn ca mặc định đang dùng cho rule_type đó, thay conditions
    của rule đó CHO RIÊNG NGÀY NÀY (self.rules gốc không đổi) trước khi tính
    công/đi muộn/về sớm.

Phạm vi áp dụng do người cấu hình ShiftConfig.apply_to_employees/
apply_to_positions/apply_to_departments quyết định (không hardcode phòng
ban/vị trí nào) — NV không được gán thêm ca nào khác ngoài ca mặc định thì
hành vi giữ nguyên y hệt trước đây (an toàn/không ảnh hưởng diện rộng).
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Department, Employee, Position

from .event import Event
from .main_api import EmployeeState
from .models import ShiftConfig
from .shift_config_utils import (
    detect_best_matching_shift,
    get_all_candidate_shifts_for_employee,
    load_shift_configs_for_employee,
)


class _FakeShift:
    """Đối tượng giả chỉ có 2 field detect_best_matching_shift() cần đọc,
    tránh phải chạm DB cho phần test thuần logic so khớp giờ."""

    def __init__(self, name, start, end):
        self.name = name
        self.start_time = start
        self.end_time = end


def _t(hh, mm):
    return datetime.time(hh, mm)


class DetectBestMatchingShiftTests(TestCase):
    def setUp(self):
        self.default_shift = _FakeShift("Ca chiều hành chính", _t(13, 0), _t(17, 30))
        self.extended_shift = _FakeShift("Ca kinh doanh", _t(13, 0), _t(21, 0))
        self.candidates = [self.default_shift, self.extended_shift]

    def test_matches_extended_shift_within_tolerance(self):
        result = detect_best_matching_shift(self.candidates, "13:05", "20:50")
        self.assertIs(result, self.extended_shift)

    def test_matches_default_shift_when_checkout_close_to_it(self):
        result = detect_best_matching_shift(self.candidates, "13:00", "17:35")
        self.assertIs(result, self.default_shift)

    def test_exact_boundary_60_minutes_still_matches(self):
        result = detect_best_matching_shift(self.candidates, "12:00", "22:00")
        self.assertIs(result, self.extended_shift)

    def test_outside_tolerance_returns_none(self):
        """Checkout 22:05 lệch 65 phút so với 21:00 -> vượt dung sai ±60 -> None."""
        result = detect_best_matching_shift(self.candidates, "13:00", "22:05")
        self.assertIsNone(result)

    def test_missing_check_in_returns_none(self):
        result = detect_best_matching_shift(self.candidates, None, "21:00")
        self.assertIsNone(result)

    def test_missing_check_out_returns_none(self):
        result = detect_best_matching_shift(self.candidates, "13:00", None)
        self.assertIsNone(result)

    def test_empty_candidates_returns_none(self):
        result = detect_best_matching_shift([], "13:00", "21:00")
        self.assertIsNone(result)

    def test_picks_closest_when_multiple_within_tolerance(self):
        """2 ca gần nhau (cả 2 đều lọt dung sai ±60' so với checkout thực tế)
        -> phải chọn ca có tổng độ lệch nhỏ hơn, không phải ca đầu tiên trong list."""
        shift_a = _FakeShift("Ca A", _t(13, 0), _t(18, 0))
        shift_b = _FakeShift("Ca B", _t(13, 0), _t(18, 45))
        # checkout 18:20 -> lệch A=20', lệch B=25' -> A gần hơn
        result = detect_best_matching_shift([shift_a, shift_b], "13:00", "18:20")
        self.assertIs(result, shift_a)


class GetAllCandidateShiftsForEmployeeTests(TestCase):
    """get_all_candidate_shifts_for_employee() KHÔNG được dedup theo
    rule_type như load_shift_configs_for_employee() — đây là khác biệt cốt
    lõi cho phép tính năng tự nhận diện ca hoạt động."""

    def setUp(self):
        self.department = Department.objects.create(name="Kinh doanh", code="KD-TEST")
        user = User.objects.create_user(username="auto_shift_emp", password="x")
        self.employee = Employee.objects.create(
            user=user, employee_id="AUTOSHIFT-001", full_name="NV Test",
            gender="F", department=self.department,
        )
        today = datetime.date(2026, 9, 1)
        self.default_shift = ShiftConfig.objects.create(
            name="Ca chiều hành chính", code="AUTOSHIFT-HC-AFT",
            start_time=_t(13, 0), end_time=_t(17, 30),
            shift_type="AFTERNOON", effective_from=today,
        )
        self.default_shift.apply_to_departments.add(self.department)
        self.extended_shift = ShiftConfig.objects.create(
            name="Ca kinh doanh", code="AUTOSHIFT-KD-FULL",
            start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type="AFTERNOON", effective_from=today,
        )
        self.extended_shift.apply_to_departments.add(self.department)
        self.ref_date = datetime.date(2026, 9, 8)

    def test_dedup_cascade_only_keeps_one_afternoon_shift(self):
        """Baseline: hàm cũ dedup theo rule_type -> chỉ còn 1 ca AFTERNOON."""
        result = load_shift_configs_for_employee(self.employee.employee_id, self.ref_date)
        afternoon_like = [sc for sc in result if sc.shift_type == "AFTERNOON"]
        self.assertEqual(len(afternoon_like), 1)

    def test_returns_both_shifts_without_dedup(self):
        result = get_all_candidate_shifts_for_employee(self.employee.employee_id, self.ref_date)
        codes = {sc.code for sc in result}
        self.assertEqual(codes, {"AUTOSHIFT-HC-AFT", "AUTOSHIFT-KD-FULL"})

    def test_unknown_employee_returns_empty(self):
        result = get_all_candidate_shifts_for_employee("NO-SUCH-EMP", self.ref_date)
        self.assertEqual(result, [])


def _attendance_rules(start_time="13:00:00", end_time="17:30:00", workday=0.5):
    return [{
        "rule_name": "Ca chiều hành chính",
        "rule_type": "SHIFT_RULE_AFTERNOON",
        "conditions": {"start_time": start_time, "end_time": end_time, "workday": workday},
        "priority": 50,
    }]


def _attendance_event(check_in, check_out, event_date="2026-09-08"):
    return Event("attendance", {
        "date": event_date,
        "check_in": check_in,
        "check_out": check_out,
    })


class ShiftRuleOrderingSafetyTests(TestCase):
    """
    Bug tìm được khi kiểm tra tác động của tính năng tự nhận diện ca: 1 NV có
    ĐỒNG THỜI rule SHIFT_RULE_MORNING (vd: ca hành chính 8h30-17h30, full
    ngày) VÀ SHIFT_RULE_AFTERNOON (vd: ca mở rộng 13h-21h, cũng full ngày) —
    nếu rule chiều được xét TRƯỚC rule sáng (thứ tự này KHÔNG được đảm bảo
    khi rule đến từ RuleDefinition tường minh trong DB, chỉ đảm bảo khi rule
    sinh tự động từ ShiftConfig theo start_time) — rule chiều hiểu nhầm
    checkout 17h30 là "về sớm 210 phút" so với khung 13h-21h của nó, gắn cờ
    vang_mat=1.0 giả trên 1 ngày ĐÃ đủ công thật (tong_ngay_cong vẫn ra 1.0
    từ rule sáng) -> dữ liệu mâu thuẫn (vừa đủ công vừa vắng mặt).

    Fix: apply_rules() luôn sắp SHIFT_RULE_MORNING trước SHIFT_RULE_AFTERNOON
    cho event attendance, bất kể thứ tự gốc trong self.rules.
    """

    def _rules_reversed(self):
        """Cố tình đặt rule CHIỀU trước rule SÁNG trong self.rules để mô
        phỏng trường hợp RuleDefinition không đảm bảo thứ tự."""
        return [
            {
                "rule_name": "Ca mở rộng",
                "rule_type": "SHIFT_RULE_AFTERNOON",
                "conditions": {"start_time": "13:00:00", "end_time": "21:00:00", "workday": 1.0},
                "priority": 50,
            },
            {
                "rule_name": "Ca hành chính",
                "rule_type": "SHIFT_RULE_MORNING",
                "conditions": {"start_time": "08:30:00", "end_time": "17:30:00", "workday": 1.0},
                "priority": 50,
            },
        ]

    def test_afternoon_rule_listed_first_does_not_cause_false_absence(self):
        state = EmployeeState("ORDER-TEST-NV")
        state.rules = self._rules_reversed()
        state.apply_rules(_attendance_event("08:30", "17:30"))

        self.assertEqual(state.tong_ngay_cong, 1.0)
        self.assertEqual(state.vang_mat, 0)
        self.assertEqual(state.di_muon_ve_som, 0)

    def test_morning_rule_listed_first_unaffected_baseline(self):
        """Regression guard: thứ tự đúng sẵn (sáng trước chiều) vẫn ra kết
        quả y hệt — sort không đổi gì khi không cần đổi."""
        state = EmployeeState("ORDER-TEST-NV-2")
        state.rules = list(reversed(self._rules_reversed()))  # sáng trước, chiều sau
        state.apply_rules(_attendance_event("08:30", "17:30"))

        self.assertEqual(state.tong_ngay_cong, 1.0)
        self.assertEqual(state.vang_mat, 0)
        self.assertEqual(state.di_muon_ve_som, 0)

    def test_ordering_fix_does_not_affect_non_attendance_events(self):
        """An toàn phạm vi: sort chỉ áp dụng cho event attendance (xem
        EVENT_RULE_CATEGORY_MAP). Với event loại khác (vd: night_shift), 2
        rule SHIFT_RULE_MORNING/AFTERNOON (dù bị đảo thứ tự) không được phép
        khớp/ảnh hưởng gì (category không cho phép) — chỉ OVERTIME_RULE mới
        được xử lý, y hệt như khi không có sort này."""
        state = EmployeeState("ORDER-TEST-NV-3")
        # calendar_result rỗng -> _has_afternoon_shift_attendance() = False,
        # không kích hoạt nhánh cộng thêm 0.5 công của OVERTIME_RULE, giữ kịch
        # bản đơn giản chỉ để kiểm tra shift rules có bị lọt vào event này không.
        state.rules = self._rules_reversed() + [{
            "rule_name": "Trực tối",
            "rule_type": "OVERTIME_RULE",
            "conditions": {},
            "priority": 50,
        }]
        night_shift_event = Event("night_shift", {
            "status": "APPROVED", "registration_type": "NIGHT_SHIFT",
            "date": "2026-09-08", "sessions": 1,
        })
        state.apply_rules(night_shift_event)
        # Chỉ OVERTIME_RULE được áp dụng (2 rule SHIFT_RULE_* bị category lọc
        # ra ngay từ _match_rule_for_event, bất kể thứ tự) -> truc_toi += 1,
        # không có công nào được cộng từ rule ca sáng/chiều lọt qua nhầm.
        self.assertEqual(state.truc_toi, 1)
        self.assertEqual(state.tong_ngay_cong, 0)
        self.assertEqual(state.nua_ngay_cong, 0)


class AutoShiftDetectApplyRulesTests(TestCase):
    """Test tích hợp: state.apply_rules() phải tính công theo ca mở rộng khi
    checkin/checkout khớp, và KHÔNG ảnh hưởng gì tới NV không có ca mở rộng
    hoặc ngày chấm công khớp đúng ca mặc định như bình thường."""

    def setUp(self):
        self.department = Department.objects.create(name="Kinh doanh 2", code="KD-TEST-2")
        today = datetime.date(2026, 9, 1)
        self.default_shift = ShiftConfig.objects.create(
            name="Ca chiều hành chính", code="APPLY-HC-AFT",
            start_time=_t(13, 0), end_time=_t(17, 30),
            shift_type="AFTERNOON", effective_from=today,
        )
        self.default_shift.apply_to_departments.add(self.department)
        self.extended_shift = ShiftConfig.objects.create(
            name="Ca kinh doanh", code="APPLY-KD-FULL",
            start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type="AFTERNOON", effective_from=today,
        )
        self.extended_shift.apply_to_departments.add(self.department)

        user = User.objects.create_user(username="auto_shift_apply_emp", password="x")
        self.employee_with_extended = Employee.objects.create(
            user=user, employee_id="AUTOSHIFT-APPLY-001", full_name="NV Có ca mở rộng",
            gender="F", department=self.department,
        )

        other_department = Department.objects.create(name="CSKH thường", code="CSKH-TEST")
        self.default_shift.apply_to_departments.add(other_department)
        user2 = User.objects.create_user(username="no_extended_emp", password="x")
        self.employee_without_extended = Employee.objects.create(
            user=user2, employee_id="AUTOSHIFT-NOEXT-001", full_name="NV Không có ca mở rộng",
            gender="F", department=other_department,
        )

    def _run(self, employee_code, check_in, check_out):
        state = EmployeeState(employee_code)
        state.rules = _attendance_rules()
        state.apply_rules(_attendance_event(check_in, check_out))
        return state

    def test_extended_checkin_checkout_gets_full_day_no_penalty(self):
        """Kịch bản chính: NV có ca mở rộng, checkin 13:00/checkout 21:00 ->
        1 công đầy đủ, không đi muộn/về sớm/quên chấm công."""
        state = self._run(self.employee_with_extended.employee_id, "13:00", "21:00")
        self.assertEqual(state.tong_ngay_cong, 1.0)
        self.assertEqual(state.di_muon_ve_som, 0)
        self.assertEqual(state.vang_mat, 0)
        self.assertEqual(state.quen_cham_cong, 0)

    def test_extended_checkin_checkout_within_tolerance_still_matches(self):
        """Checkin/checkout lệch vài phút (trong dung sai ±60') vẫn khớp ca mở
        rộng (13:00-21:00) và được tính đủ 1 công — dù đi muộn/về sớm vài
        phút SO VỚI CHÍNH ca mở rộng đó vẫn bị ghi nhận vi phạm như bình
        thường (override chỉ đổi ca đang áp dụng, không miễn phạt muộn/sớm)."""
        state = self._run(self.employee_with_extended.employee_id, "13:10", "20:45")
        self.assertEqual(state.tong_ngay_cong, 1.0)
        self.assertEqual(state.di_muon_ve_som, 2)  # muộn 10' (vs 13:00) + sớm 15' (vs 21:00)

    def test_normal_checkin_checkout_matching_default_shift_unaffected(self):
        """Regression: checkin/checkout khớp đúng ca mặc định (13:00-17:30)
        -> vẫn tính đúng như cũ (0.5 công), không bị ép sang ca mở rộng."""
        state = self._run(self.employee_with_extended.employee_id, "13:00", "17:30")
        self.assertEqual(state.tong_ngay_cong, 0.5)

    def test_employee_without_extended_shift_not_affected(self):
        """An toàn diện rộng: NV KHÔNG được gán ca mở rộng nào, dù checkin/
        checkout giống hệt kịch bản 13h-21h -> hành vi giữ nguyên như cũ
        (chỉ tính theo ca mặc định 13:00-17:30, không tự nâng lên full-day)."""
        state = self._run(self.employee_without_extended.employee_id, "13:00", "21:00")
        self.assertEqual(state.tong_ngay_cong, 0.5)

    def test_missing_checkout_falls_back_to_default_rule(self):
        """Thiếu checkout -> không đủ dữ liệu để tự nhận diện -> dùng ca mặc
        định như cũ (ghi nhận quên chấm công)."""
        state = self._run(self.employee_with_extended.employee_id, "13:00", None)
        self.assertEqual(state.quen_cham_cong, 1)
