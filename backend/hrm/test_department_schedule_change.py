"""
Đổi lịch làm việc phòng ban TỪ MỘT NGÀY (HCNS 2026-10-15: team Giám sát chất lượng
chuyển sang lịch Kinh doanh — làm chiều thứ 7 mọi tuần — từ 15/10/2026) —
employee.DepartmentScheduleChange + employee/schedule.py.
"""
import datetime as dt

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Department, DepartmentScheduleChange, Employee
from employee.schedule import ScheduleResolver, saturday_afternoon_by_date
from hrm.main_api import EmployeeState, Event
from hrm.stats_utils import online_quota_amount
from hrm.violation_report_views import LeaveViolationReportView

SAT_WEEK2 = dt.date(2026, 10, 10)   # trước ngày đổi lịch
SAT_WEEK4 = dt.date(2026, 10, 24)   # sau ngày đổi lịch
SUN_BEFORE = dt.date(2026, 10, 11)
SUN_AFTER = dt.date(2026, 10, 18)


class DepartmentScheduleChangeTests(TestCase):
    def setUp(self):
        # Lịch gốc = lịch Back Office cũ: nghỉ Chủ nhật, chiều T7 tuần 2/4 nghỉ.
        self.dept = Department.objects.create(name="Giám sát chất lượng", code="GSCL-T")
        DepartmentScheduleChange.objects.create(
            department=self.dept, effective_from=dt.date(2026, 10, 15),
            works_on_sunday=True, saturday_afternoon_always_workday=True,
            note="Chuyển sang lịch Kinh doanh",
        )
        user = User.objects.create_user(username="gscl1", password="x")
        self.emp = Employee.objects.create(user=user, employee_id="NV09001", full_name="NV GSCL", department=self.dept)

    def test_flag_follows_date(self):
        schedule = ScheduleResolver()
        self.assertFalse(schedule.flag(self.dept, "saturday_afternoon_always_workday", SAT_WEEK2))
        self.assertTrue(schedule.flag(self.dept, "saturday_afternoon_always_workday", SAT_WEEK4))
        self.assertFalse(schedule.flag(self.dept, "works_on_sunday", SUN_BEFORE))
        self.assertTrue(schedule.flag(self.dept, "works_on_sunday", SUN_AFTER))
        # Phòng ban không có dòng đổi lịch -> cờ gốc.
        other = Department.objects.create(name="Kinh doanh", code="KD-T", saturday_afternoon_always_workday=True)
        self.assertTrue(schedule.flag(other, "saturday_afternoon_always_workday", SAT_WEEK2))

    def test_employee_override_still_wins(self):
        self.emp.saturday_afternoon_always_workday = False
        self.assertFalse(ScheduleResolver().saturday_afternoon_workday(self.emp, SAT_WEEK4))
        self.emp.saturday_afternoon_always_workday = None
        self.assertTrue(ScheduleResolver().saturday_afternoon_workday(self.emp, SAT_WEEK4))

    def test_engine_saturday_afternoon_by_date(self):
        by_date = saturday_afternoon_by_date(self.dept, 2026, 10)
        self.assertEqual(by_date[SAT_WEEK2], False)
        self.assertEqual(by_date[SAT_WEEK4], True)

        state = EmployeeState("NV09001")
        state._saturday_afternoon_by_date = by_date
        rule = {"rule_name": "Ca chiều", "rule_type": "SHIFT_RULE_AFTERNOON",
                "conditions": {"start_time": "13:30", "end_time": "17:30", "workday": 0.5}}

        def att(day):
            return Event(event_type="attendance",
                         data={"date": day.isoformat(), "check_in": "13:30", "check_out": "17:30"})

        # 10/10 (tuần 2, trước khi đổi lịch): chiều nghỉ -> không tự cộng công.
        self.assertEqual(state._evaluate_afternoon_shift_rule(att(SAT_WEEK2), rule), {})
        # 24/10 (tuần 4, sau khi đổi lịch): chiều là giờ làm -> tính 0.5 công.
        effects = state._evaluate_afternoon_shift_rule(att(SAT_WEEK4), rule)
        self.assertEqual(effects.get("nua_ngay_cong"), 0.5)

    def test_violation_report_afternoon_rest_by_date(self):
        self.assertTrue(LeaveViolationReportView._afternoon_is_rest(self.emp, SAT_WEEK2))
        self.assertFalse(LeaveViolationReportView._afternoon_is_rest(self.emp, SAT_WEEK4))

    def test_online_quota_weekend_unlimited_by_date(self):
        self.dept.online_weekend_unlimited = True
        self.dept.save()
        DepartmentScheduleChange.objects.filter(department=self.dept).update(online_weekend_unlimited=False)
        emp = Employee.objects.select_related("department").get(pk=self.emp.pk)
        self.assertEqual(online_quota_amount(emp, SUN_BEFORE, {}), 0.0)
        self.assertEqual(online_quota_amount(emp, SUN_AFTER, {}), 1.0)


class DepartmentAdminInlineTests(TestCase):
    def test_department_admin_page_shows_schedule_change_inline(self):
        """Admin Phòng ban đăng ký bằng EnhancedDepartmentAdmin — inlines của nó phải
        giữ bảng đổi lịch (từng bị `inlines = [EmployeeInline]` đè mất)."""
        from django.contrib import admin as dj_admin
        from employee.admin import DepartmentScheduleChangeInline

        model_admin = dj_admin.site._registry[Department]
        self.assertIn(DepartmentScheduleChangeInline, model_admin.inlines)

        superuser = User.objects.create_superuser(username="adm-sched", password="x")
        self.client.force_login(superuser)
        dept = Department.objects.create(name="GSCL admin", code="GSCL-ADM")
        resp = self.client.get(f"/admin/employee/department/{dept.pk}/change/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "schedule_changes-TOTAL_FORMS")
