"""
hrm/test_unauthorized_absence_display_fixes.py
════════════════════════════════════════════════
Rà soát toàn diện theo yêu cầu: "Nghỉ không phép" (UNAUTHORIZED_ABSENCE) được
thêm vào hệ thống sau các loại đơn khác, nên nhiều chỗ liệt kê/nhận diện loại
đơn quên cập nhật. Test này khoá lại 2 lỗi backend tìm được qua audit toàn
diện (phần frontend đã có test/fix riêng ở repo hrm):

1. _day_status_from_events_data(): trước đây chỉ nhận UNAUTHORIZED_ABSENCE khi
   status=='APPROVED' — ngày có đơn đang PENDING rơi xuống "EMPTY"/"Chưa có dữ
   liệu" ở lịch chấm công đang xem trực tiếp. Fix thêm tham số
   include_pending_unauthorized_absence (mặc định False để KHÔNG đổi hành vi
   bảng chốt công đã khoá — 1 ngày chưa được quyết định không nên tính thẳng
   thành "KP" (0 công) trong bảng lương).

2. _serialize_employee_summary() ở dept_approval_views.py và
   attendance_finalization_approval_views.py (trang "Phê duyệt chốt công")
   thiếu hẳn field nghi_khong_phep_thang — người duyệt không thấy được số
   ngày nghỉ không phép của nhân viên khi quyết định duyệt, dù field
   nghi_phep_thang (nghỉ phép) — field song song, thêm cùng lúc ở model — đã
   có sẵn.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Employee

from .attendance_views import AttendanceCalendarView
from .event_models import EmployeeEvent


class DayStatusUnauthorizedAbsencePendingTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username='ua_display_emp', password='x')
        self.employee = Employee.objects.create(
            user=user, employee_id='UA-DISPLAY-001', full_name='NV Test', gender='F',
        )
        self.the_date = datetime.date(2026, 9, 8)

    def _make_event(self, status):
        return EmployeeEvent.objects.create(
            employee=self.employee, event_date=self.the_date,
            event_type=EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE,
            data={'status': status, 'request_code': 'KP-TEST'},
        )

    def test_pending_recognized_when_include_pending_true(self):
        """Lịch xem trực tiếp (AttendanceCalendarView) phải nhận PENDING."""
        ev = self._make_event('PENDING')
        day_status, badge = AttendanceCalendarView._day_status_from_events_data(
            {}, {}, [ev], {}, self.the_date, include_pending_unauthorized_absence=True,
        )
        self.assertEqual(day_status, 'UNAUTHORIZED_ABSENCE')
        self.assertEqual(badge, 'Nghỉ không phép')

    def test_pending_still_ignored_by_default_for_finalization_table(self):
        """
        Mặc định (dùng cho bảng chốt công đã khoá) PHẢI vẫn chỉ nhận APPROVED —
        không được để đơn PENDING (chưa quyết định) bị tính thẳng thành "KP"
        (0 công) trong bảng lương/chốt công.
        """
        ev = self._make_event('PENDING')
        day_status, _badge = AttendanceCalendarView._day_status_from_events_data(
            {}, {}, [ev], {}, self.the_date,
        )
        self.assertNotEqual(day_status, 'UNAUTHORIZED_ABSENCE')

    def test_approved_recognized_in_both_modes(self):
        ev = self._make_event('APPROVED')
        for include_pending in (True, False):
            day_status, badge = AttendanceCalendarView._day_status_from_events_data(
                {}, {}, [ev], {}, self.the_date,
                include_pending_unauthorized_absence=include_pending,
            )
            self.assertEqual(day_status, 'UNAUTHORIZED_ABSENCE')
            self.assertEqual(badge, 'Nghỉ không phép')


class ApprovalSummaryIncludesUnauthorizedAbsenceFieldTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username='ua_summary_emp', password='x')
        self.employee = Employee.objects.create(
            user=user, employee_id='UA-SUMMARY-001', full_name='NV Test', gender='M',
        )

    def test_dept_approval_summary_has_nghi_khong_phep_thang(self):
        from .dept_approval_views import _serialize_employee_summary
        summary = _serialize_employee_summary(self.employee, 2026, 9)
        self.assertIn('nghi_khong_phep_thang', summary)
        self.assertEqual(summary['nghi_khong_phep_thang'], 0)

    def test_attendance_finalization_approval_summary_has_nghi_khong_phep_thang(self):
        from .attendance_finalization_approval_views import _serialize_employee_summary
        summary = _serialize_employee_summary(self.employee, 2026, 9)
        self.assertIn('nghi_khong_phep_thang', summary)
        self.assertEqual(summary['nghi_khong_phep_thang'], 0)
