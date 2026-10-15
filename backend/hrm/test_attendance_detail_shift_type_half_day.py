"""
hrm/test_attendance_detail_shift_type_half_day.py
══════════════════════════════════════════════════
Bug thực tế: khi tạo 1 EmployeeEvent nghỉ phép nửa ngày cho nhân viên, "bảng chốt công"
(WorkFinalization) hiển thị đúng "0.5 P" (nửa ngày), nhưng modal "Chi tiết ngày" trong
trang "Chấm công của tôi" (AttendanceManagement.tsx) lại hiển thị "Ca: Cả ngày" — mâu
thuẫn ngay với cột "Trạng thái" cùng dòng, vốn đọc đúng là "Nửa ngày".

Nguyên nhân: AttendanceViewSet._derive_shift_type() (hrm/views.py) chỉ suy ra ca làm từ
rule chấm công thực tế (SHIFT_RULE_MORNING/AFTERNOON, gắn cho event_type="attendance").
Ngày nghỉ phép thuần (không có check-in) không kích hoạt rule nào trong số đó nên hàm rơi
vào nhánh mặc định `return 'FULL_DAY'`, bỏ qua hoàn toàn is_half_day/half_day_period/
expected_status trên event nghỉ phép/giải trình.

Fix: khi không có rule chấm công thực tế nào áp dụng, soi thêm dữ liệu nửa ngày trên các
EmployeeEvent khác trong ngày (leave_request, explanation, explanation_approval,
online_work...) trước khi mặc định "Cả ngày".
"""
from django.test import SimpleTestCase

from hrm.views import AttendanceViewSet


class _FakeEvent:
    """Đối tượng giả lập tối thiểu thay cho EmployeeEvent — chỉ cần .data."""
    def __init__(self, data):
        self.data = data


def _attendance_entry(rule_types):
    return {
        "rules_applied": [{"rule_type": rt} for rt in rule_types],
    }


class DeriveShiftTypeHalfDayTests(SimpleTestCase):
    def test_pure_half_day_leave_request_morning_period_is_not_full_day(self):
        """Đơn nghỉ phép nửa ngày (buổi sáng), không có chấm công thực tế nào trong
        ngày -> Ca làm phải ra 'MORNING' (nhân viên đi làm buổi chiều), KHÔNG phải
        'FULL_DAY'."""
        day_entries = []  # không có rule chấm công nào áp dụng (không check-in)
        day_all_events = [_FakeEvent({"is_half_day": True, "half_day_period": "MORNING"})]
        shift_type = AttendanceViewSet._derive_shift_type(day_entries, day_all_events)
        self.assertEqual(shift_type, "MORNING")

    def test_pure_half_day_leave_request_afternoon_period_is_not_full_day(self):
        day_entries = []
        day_all_events = [_FakeEvent({"is_half_day": True, "half_day_period": "AFTERNOON"})]
        shift_type = AttendanceViewSet._derive_shift_type(day_entries, day_all_events)
        self.assertEqual(shift_type, "AFTERNOON")

    def test_explanation_approval_expected_status_half_day_without_period_is_not_full_day(self):
        """Event dạng explanation_approval (LEAVE) chỉ có expected_status=HALF_DAY, không
        có half_day_period cụ thể -> vẫn không được mặc định 'FULL_DAY'."""
        day_entries = []
        day_all_events = [_FakeEvent({"explanation_type": "LEAVE", "expected_status": "HALF_DAY"})]
        shift_type = AttendanceViewSet._derive_shift_type(day_entries, day_all_events)
        self.assertNotEqual(shift_type, "FULL_DAY")

    def test_genuine_full_day_leave_is_still_full_day(self):
        """Regression guard: nghỉ phép CẢ NGÀY thật sự (không có is_half_day/expected_status
        HALF_DAY nào) vẫn phải ra đúng 'FULL_DAY' như cũ."""
        day_entries = []
        day_all_events = [_FakeEvent({"leave_type": "ANNUAL", "is_half_day": False})]
        shift_type = AttendanceViewSet._derive_shift_type(day_entries, day_all_events)
        self.assertEqual(shift_type, "FULL_DAY")

    def test_no_events_at_all_is_still_full_day(self):
        """Regression guard: không có entry, không có event nào -> giữ nguyên hành vi cũ
        (mặc định 'FULL_DAY')."""
        shift_type = AttendanceViewSet._derive_shift_type([], [])
        self.assertEqual(shift_type, "FULL_DAY")

    def test_real_attendance_shift_rule_takes_priority_over_leave_event(self):
        """Nếu ngày đó CÓ chấm công thực tế (rule sáng), logic cũ dựa trên rules_applied
        vẫn phải được ưu tiên trước, không bị ghi đè bởi nhánh mới."""
        day_entries = [_attendance_entry(["SHIFT_RULE_MORNING"])]
        day_all_events = [_FakeEvent({"is_half_day": True, "half_day_period": "AFTERNOON"})]
        shift_type = AttendanceViewSet._derive_shift_type(day_entries, day_all_events)
        self.assertEqual(shift_type, "MORNING")

    def test_full_day_attendance_rules_unaffected(self):
        """Regression guard: có đủ rule sáng + chiều (đi làm cả ngày thật) vẫn ra
        'FULL_DAY' như cũ, dù không truyền day_all_events."""
        day_entries = [_attendance_entry(["SHIFT_RULE_MORNING", "SHIFT_RULE_AFTERNOON"])]
        shift_type = AttendanceViewSet._derive_shift_type(day_entries)
        self.assertEqual(shift_type, "FULL_DAY")
