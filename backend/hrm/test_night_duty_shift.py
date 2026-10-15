"""
Trực tối tự động theo ca (yêu cầu 2026-10-03): ngày hệ thống nhận diện nhân
viên làm ca có cờ ShiftConfig.counts_as_night_duty (vd "Ca kinh doanh"
13:00-21:00) thì được cộng 1 buổi trực tối, không cần đơn. Ngày đã có đơn
Trực tối được duyệt thì chỉ tính theo đơn (không cộng trùng). Áp dụng từ
01/09/2026.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Department, Employee

from .event import Event
from .main_api import EmployeeState
from .models import ShiftConfig


def _t(hh, mm):
    return datetime.time(hh, mm)


RULES = [
    {
        "rule_name": "Ca chiều hành chính",
        "rule_type": "SHIFT_RULE_AFTERNOON",
        "conditions": {"start_time": "13:00:00", "end_time": "17:30:00", "workday": 0.5},
        "priority": 50,
    },
    {"rule_name": "Trực tối", "rule_type": "OVERTIME_RULE", "conditions": {}, "priority": 50},
]


def _attendance(check_in, check_out, day="2026-09-08"):
    return Event("attendance", {"date": day, "check_in": check_in, "check_out": check_out})


def _night_shift(day="2026-09-08", sessions=1):
    return Event("night_shift", {
        "status": "APPROVED", "registration_type": "NIGHT_SHIFT", "date": day, "sessions": sessions,
    })


class NightDutyShiftTests(TestCase):
    def setUp(self):
        dept = Department.objects.create(name="Kinh doanh ND", code="KD-ND")
        start = datetime.date(2026, 8, 1)
        default_shift = ShiftConfig.objects.create(
            name="Ca chiều hành chính", code="ND-HC-AFT", start_time=_t(13, 0), end_time=_t(17, 30),
            shift_type="AFTERNOON", effective_from=start,
        )
        default_shift.apply_to_departments.add(dept)
        self.sales_shift = ShiftConfig.objects.create(
            name="Ca kinh doanh", code="ND-KD", start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type="AFTERNOON", effective_from=start, counts_as_night_duty=True,
        )
        self.sales_shift.apply_to_departments.add(dept)
        user = User.objects.create_user(username="night_duty_emp", password="x")
        self.employee = Employee.objects.create(
            user=user, employee_id="ND-001", full_name="NV ca kinh doanh", gender="F", department=dept,
        )

    def _state(self):
        state = EmployeeState(self.employee.employee_id)
        state.rules = list(RULES)
        return state

    def test_working_flagged_shift_counts_one_night_duty(self):
        state = self._state()
        state.apply_rules(_attendance("13:00", "21:00"))
        self.assertEqual(state.truc_toi, 1)
        self.assertEqual(state.tong_ngay_cong, 1.0)

    def test_normal_afternoon_shift_does_not_count(self):
        state = self._state()
        state.apply_rules(_attendance("13:00", "17:30"))
        self.assertEqual(state.truc_toi, 0)

    def test_shift_without_flag_does_not_count(self):
        self.sales_shift.counts_as_night_duty = False
        self.sales_shift.save()
        state = self._state()
        state.apply_rules(_attendance("13:00", "21:00"))
        self.assertEqual(state.truc_toi, 0)

    def test_approved_night_shift_after_attendance_not_double_counted(self):
        state = self._state()
        state.apply_rules(_attendance("13:00", "21:00"))
        state.apply_rules(_night_shift())
        self.assertEqual(state.truc_toi, 1)

    def test_approved_night_shift_before_attendance_not_double_counted(self):
        state = self._state()
        state.apply_rules(_night_shift(sessions=2))
        state.apply_rules(_attendance("13:00", "21:00"))
        self.assertEqual(state.truc_toi, 2)

    def test_before_effective_date_does_not_count(self):
        state = self._state()
        state.apply_rules(_attendance("13:00", "21:00", day="2026-08-28"))
        self.assertEqual(state.truc_toi, 0)
