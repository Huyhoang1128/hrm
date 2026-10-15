"""Số ngày nghỉ không phép: đơn nửa ngày (HALF_DAY) phải tính 0.5, không phải 1
(case thực tế NV03065 tháng 9/2026: 19/9 cả ngày + 24/9 nửa ngày = 1.5, hiển thị sai thành 2)."""
from types import SimpleNamespace

from django.test import SimpleTestCase

from .attendance_views import AttendanceCalendarView
from .event_models import EmployeeEvent


def _ev(event_type, data):
    return SimpleNamespace(event_type=event_type, data=data)


class UnauthorizedAbsenceAmountTests(SimpleTestCase):
    UA = EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE

    def test_full_day(self):
        events = [_ev(self.UA, {"status": "APPROVED", "expected_status": "ABSENT"})]
        self.assertEqual(AttendanceCalendarView._unauthorized_absence_amount(events), 1.0)

    def test_half_day(self):
        events = [_ev(self.UA, {"status": "APPROVED", "expected_status": "HALF_DAY", "half_day_period": "AFTERNOON"})]
        self.assertEqual(AttendanceCalendarView._unauthorized_absence_amount(events), 0.5)

    def test_ignores_other_event_types(self):
        events = [
            _ev(EmployeeEvent.EventType.ATTENDANCE, {"expected_status": "HALF_DAY"}),
            _ev(self.UA, {"status": "APPROVED"}),
        ]
        self.assertEqual(AttendanceCalendarView._unauthorized_absence_amount(events), 1.0)

    def test_month_total_full_plus_half(self):
        days = [
            [_ev(self.UA, {"expected_status": "ABSENT"})],
            [_ev(self.UA, {"expected_status": "HALF_DAY"})],
        ]
        total = sum(AttendanceCalendarView._unauthorized_absence_amount(d) for d in days)
        self.assertEqual(total, 1.5)


class UnauthorizedAbsenceDaysCounterTests(SimpleTestCase):
    """Bộ đếm tháng không được bỏ sót đơn KP đã duyệt chỉ vì ngày đó hiển thị
    trạng thái khác (case NV03077 19/9/2026: sáng đi muộn có giải trình, chiều
    nghỉ không phép → đếm 1 thay vì 1.5)."""
    UA = EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE
    days = staticmethod(AttendanceCalendarView._unauthorized_absence_days)

    def _half(self, status="APPROVED"):
        return _ev(self.UA, {"status": status, "expected_status": "HALF_DAY", "half_day_period": "AFTERNOON"})

    def _full(self, status="APPROVED"):
        return _ev(self.UA, {"status": status, "expected_status": "ABSENT"})

    def test_half_day_counted_when_other_half_has_violation(self):
        for day_status in ("LATE", "EARLY_LEAVE", "LATE_EARLY", "FORGOT_CC", "ABSENT"):
            self.assertEqual(self.days(day_status, [self._half()]), 0.5, day_status)
        self.assertEqual(self.days("FORGOT_CC", [self._full()]), 1.0)

    def test_leave_or_online_day_counts_only_half_day_request(self):
        self.assertEqual(self.days("LEAVE", [self._half()]), 0.5)
        self.assertEqual(self.days("ONLINE_WORK", [self._half()]), 0.5)
        self.assertEqual(self.days("LEAVE", [self._full()]), 0.0)

    def test_not_counted_without_valid_request(self):
        self.assertEqual(self.days("LATE", []), 0.0)
        self.assertEqual(self.days("LATE", [self._half("REJECTED")]), 0.0)
        self.assertEqual(self.days("HOLIDAY", [self._full()]), 0.0)

    def test_pending_only_counted_when_requested(self):
        self.assertEqual(self.days("UNAUTHORIZED_ABSENCE", [self._half("PENDING")]), 0.0)
        self.assertEqual(self.days("UNAUTHORIZED_ABSENCE", [self._half("PENDING")], include_pending=True), 0.5)

    def test_rejected_request_does_not_hide_approved_one(self):
        # Case NV02949 10/9/2026: đơn REJECTED đứng trước đơn APPROVED tạo lại.
        events = [self._full("REJECTED"), self._half()]
        status, badge = AttendanceCalendarView._day_status_from_events_data({}, {}, events, {}, None)
        self.assertEqual(status, "UNAUTHORIZED_ABSENCE")
        self.assertEqual(badge, "Nghỉ không phép (chiều)")
        self.assertEqual(self.days(status, events), 0.5)
