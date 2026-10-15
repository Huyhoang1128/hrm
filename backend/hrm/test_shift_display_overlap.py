"""
hrm/test_shift_display_overlap.py
══════════════════════════════════════════
Test cho bug hiển thị: khi 2 ca liền kề nhau KHÔNG có khoảng nghỉ (vd: Sáng
kết thúc đúng 12:00, Chiều bắt đầu đúng 12:00), 1 phiên chấm công duy nhất
(check_in 09:43, check_out 12:02) bị AttendanceCalendarView.
_build_shifts_from_config_and_events() hiển thị TRÙNG LẶP trên cả 2 ca —
ca Chiều bị gán nhầm "check_in": "09:43" (giờ vào của ca Sáng) chỉ vì
_times_overlap() coi cả khoảng [09:43, 12:02] là "overlap" với ca Chiều
(do checkout 12:02 trễ hơn giờ bắt đầu ca Chiều 12:00 vài phút).

Fix: chỉ hiển thị check_in/check_out nếu mốc giờ đó THỰC SỰ nằm trong
khung giờ của chính ca đang xét, thay vì hiển thị nguyên cặp (check_in,
check_out) trên bất kỳ ca nào có "overlap" với toàn bộ khoảng thời gian.

Đây là @staticmethod thuần (không đụng DB) nên dùng SimpleTestCase với
object giả lập tối thiểu cho ShiftConfig và EmployeeEvent.
"""
import datetime as dt
from types import SimpleNamespace

from django.test import SimpleTestCase

from hrm.attendance_views import AttendanceCalendarView


def _shift_config(shift_type, name, start, end):
    return SimpleNamespace(
        shift_type=shift_type, name=name, code=shift_type,
        start_time=start, end_time=end,
    )


def _attendance_event(check_in, check_out, data=None):
    return SimpleNamespace(check_in=check_in, check_out=check_out, data=data or {})


class ShiftDisplayNoGapOverlapTests(SimpleTestCase):
    def test_short_morning_session_not_duplicated_onto_afternoon_row(self):
        """Kịch bản bug thực tế: ca Sáng 08:30-12:00, ca Chiều 12:00-17:30 (không
        có khoảng nghỉ trưa trong config hiển thị). NV check-in 09:43, check-out
        12:02 (chỉ làm 1 phiên buổi sáng). Ca Chiều KHÔNG được hiển thị check_in
        09:43 (đó là giờ vào của ca Sáng, không phải của ca Chiều)."""
        configs = [
            _shift_config("MORNING", "Sáng", dt.time(8, 30), dt.time(12, 0)),
            _shift_config("AFTERNOON", "Chiều", dt.time(12, 0), dt.time(17, 30)),
        ]
        events = [_attendance_event(dt.time(9, 43), dt.time(12, 2))]

        shifts = AttendanceCalendarView._build_shifts_from_config_and_events(configs, events)
        by_type = {s["shift_type"]: s for s in shifts}

        self.assertEqual(by_type["MORNING"]["check_in"], "09:43")
        self.assertIsNone(by_type["MORNING"]["check_out"])

        self.assertIsNone(by_type["AFTERNOON"]["check_in"])
        self.assertEqual(by_type["AFTERNOON"]["check_out"], "12:02")

    def test_full_day_session_shows_correctly_on_both_shifts(self):
        """Regression guard: đi làm đủ cả ngày (check-in sáng, check-out chiều)
        vẫn phải hiển thị đúng — Sáng có check_in, Chiều có check_out, không ca
        nào bị thiếu hay lẫn giờ của ca kia."""
        configs = [
            _shift_config("MORNING", "Sáng", dt.time(8, 30), dt.time(12, 0)),
            _shift_config("AFTERNOON", "Chiều", dt.time(13, 0), dt.time(17, 30)),
        ]
        events = [_attendance_event(dt.time(8, 29), dt.time(17, 37))]

        shifts = AttendanceCalendarView._build_shifts_from_config_and_events(configs, events)
        by_type = {s["shift_type"]: s for s in shifts}

        self.assertEqual(by_type["MORNING"]["check_in"], "08:29")
        self.assertIsNone(by_type["MORNING"]["check_out"])
        self.assertIsNone(by_type["AFTERNOON"]["check_in"])
        self.assertEqual(by_type["AFTERNOON"]["check_out"], "17:37")
