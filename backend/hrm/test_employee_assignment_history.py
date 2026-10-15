"""
Điều chuyển phòng ban / vị trí / ca / hình thức làm việc không làm đổi công các tháng
trước (yêu cầu 2026-10-15, case NV02848: T9 part-time, T10 lên full-time, mở lại công
T9 thấy 2 công lễ thay vì 1) — employee.EmployeeAssignmentHistory +
employee/assignment.py + employee/signals.py.
"""
import datetime as dt
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase

from employee.assignment import AssignmentResolver
from employee.models import Department, Employee, EmployeeAssignmentHistory, Position
from hrm.employee_work_utils import get_holiday_credit_for_employee
from hrm.finalization_views import _holiday_unit_for, _split_holiday_credit
from hrm.main_api import EmployeeState
from hrm.models import ShiftConfig
from hrm.shift_config_utils import get_all_candidate_shifts_for_employee, load_shift_configs_for_employee

CHANGED = dt.date(2026, 10, 1)
SEP = dt.date(2026, 9, 15)
OCT = dt.date(2026, 10, 15)


def _today(day):
    return mock.patch("django.utils.timezone.localdate", return_value=day)


class AssignmentHistoryTests(TestCase):
    def setUp(self):
        self.dept_a = Department.objects.create(name="Phòng A", code="ASSIGN-A")
        self.dept_b = Department.objects.create(name="Phòng B", code="ASSIGN-B")
        self.pos = Position.objects.create(title="Nhân viên", code="ASSIGN-NV")
        user = User.objects.create_user(username="assign1", password="x")
        self.emp = Employee.objects.create(
            user=user, employee_id="NV09001", full_name="NV điều chuyển",
            department=self.dept_a, position=self.pos, work_form="PART_TIME",
        )
        self.shift_a = ShiftConfig.objects.create(
            name="Ca A", code="ASSIGN-CA-A", start_time=dt.time(7, 30), end_time=dt.time(11, 30),
            shift_type="MORNING", effective_from=dt.date(2026, 1, 1),
        )
        self.shift_a.apply_to_departments.add(self.dept_a)
        self.shift_b = ShiftConfig.objects.create(
            name="Ca B", code="ASSIGN-CA-B", start_time=dt.time(8, 0), end_time=dt.time(12, 0),
            shift_type="MORNING", effective_from=dt.date(2026, 1, 1),
        )
        self.shift_b.apply_to_departments.add(self.dept_b)

    def _move_to_b_full_time(self):
        with _today(CHANGED):
            self.emp.department = self.dept_b
            self.emp.work_form = "FULL_TIME"
            self.emp.save()

    # ---- ghi lịch sử ---------------------------------------------------------
    def test_change_records_old_values(self):
        self._move_to_b_full_time()
        row = EmployeeAssignmentHistory.objects.get(employee=self.emp)
        self.assertEqual(row.changed_from, CHANGED)
        self.assertEqual(row.department_id, self.dept_a.pk)
        self.assertEqual(row.position_id, self.pos.pk)
        self.assertEqual(row.work_form, "PART_TIME")
        self.assertEqual(row.personal_shift_ids, [])

    def test_same_day_changes_keep_first_snapshot(self):
        self._move_to_b_full_time()
        with _today(CHANGED):
            self.emp.department = self.dept_a
            self.emp.save()
        self.assertEqual(EmployeeAssignmentHistory.objects.filter(employee=self.emp).count(), 1)

    def test_unrelated_save_records_nothing(self):
        self.emp.full_name = "Tên mới"
        self.emp.save()
        self.emp.save(update_fields=["full_name"])
        self.assertFalse(EmployeeAssignmentHistory.objects.exists())

    def test_personal_shift_change_records_old_personal_shifts(self):
        with _today(dt.date(2026, 9, 1)):
            self.shift_b.apply_to_employees.add(self.emp)
        with _today(CHANGED):
            self.emp.shift_configs.remove(self.shift_b)
        rows = list(EmployeeAssignmentHistory.objects.filter(employee=self.emp).order_by("changed_from"))
        self.assertEqual([r.personal_shift_ids for r in rows], [[], [self.shift_b.pk]])

    # ---- tra theo ngày ---------------------------------------------------------
    def test_resolver_by_date(self):
        self._move_to_b_full_time()
        resolver = AssignmentResolver()
        self.assertEqual(resolver.department_on(self.emp, SEP), self.dept_a)
        self.assertEqual(resolver.department_on(self.emp, OCT), self.dept_b)
        self.assertEqual(resolver.employee_on(self.emp, SEP).work_form, "PART_TIME")
        self.assertIs(resolver.employee_on(self.emp, OCT), self.emp)
        # Bản sao không làm hỏng object gốc.
        self.assertEqual(self.emp.department, self.dept_b)

    def test_chain_of_changes(self):
        self._move_to_b_full_time()
        dept_c = Department.objects.create(name="Phòng C", code="ASSIGN-C")
        with _today(dt.date(2026, 11, 1)):
            self.emp.department = dept_c
            self.emp.save()
        resolver = AssignmentResolver()
        self.assertEqual(resolver.department_on(self.emp, SEP), self.dept_a)
        self.assertEqual(resolver.department_on(self.emp, OCT), self.dept_b)
        self.assertEqual(resolver.department_on(self.emp, dt.date(2026, 11, 5)), dept_c)

    def test_holiday_credit_follows_work_form_on_holiday(self):
        """NV02848: lễ 01-02/09 lúc còn part-time -> 0.5/ngày dù nay đã full-time."""
        self._move_to_b_full_time()
        self.assertEqual(get_holiday_credit_for_employee(self.emp, dt.date(2026, 9, 2)), 0.5)
        self.assertEqual(get_holiday_credit_for_employee(self.emp, OCT), 1.0)
        self.assertEqual(get_holiday_credit_for_employee(self.emp), 1.0)  # không có ngày = hiện tại
        summary = [{"date": "2026-09-01", "day_type": "L"}, {"date": "2026-09-02", "day_type": "L"}]
        self.assertEqual(_split_holiday_credit(summary, None, _holiday_unit_for(self.emp)), (0.0, 1.0))
        # Bản chốt mới lưu sẵn công lễ từng ngày -> dùng luôn số đã lưu.
        stored = [{"date": "2026-09-01", "day_type": "L", "holiday_credit": 0.5}]
        self.assertEqual(_split_holiday_credit(stored, None, 1.0), (0.0, 0.5))

    def test_fixed_shift_follows_department_on_date(self):
        self._move_to_b_full_time()
        cache = {}
        self.assertEqual(load_shift_configs_for_employee("NV09001", SEP, cache), [self.shift_a])
        self.assertEqual(load_shift_configs_for_employee("NV09001", OCT, cache), [self.shift_b])
        self.assertEqual(load_shift_configs_for_employee("NV09001", SEP), [self.shift_a])
        self.assertEqual(get_all_candidate_shifts_for_employee("NV09001", SEP, {}), [self.shift_a])

    def test_personal_shift_follows_date(self):
        with _today(CHANGED):
            self.shift_b.apply_to_employees.add(self.emp)  # từ 01/10 có ca cá nhân B
        self.assertEqual(load_shift_configs_for_employee("NV09001", SEP, {}), [self.shift_a])
        self.assertEqual(load_shift_configs_for_employee("NV09001", OCT, {}), [self.shift_b])

    def test_deleting_history_row_uses_current_data(self):
        """Sửa nhầm dữ liệu (không phải điều chuyển): xoá dòng lịch sử."""
        self._move_to_b_full_time()
        EmployeeAssignmentHistory.objects.all().delete()
        self.assertEqual(AssignmentResolver().department_on(self.emp, SEP), self.dept_b)

    def test_replay_month_uses_department_of_that_month(self):
        self._move_to_b_full_time()
        seen = []

        def fake_rules(employee_code, employee_info):
            seen.append(dict(employee_info or {}))
            return []

        with mock.patch("hrm.main_api.get_rules_for_employee", side_effect=fake_rules):
            EmployeeState.replay_month("NV09001", 2026, 9)
            EmployeeState.replay_month("NV09001", 2026, 10)
        self.assertEqual(seen[0]["department_id"], str(self.dept_a.pk))
        self.assertEqual(seen[1]["department_id"], str(self.dept_b.pk))


class AssignmentHistoryAdminTests(TestCase):
    def test_employee_admin_shows_history_inline_prefilled(self):
        dept = Department.objects.create(name="Phòng admin", code="ASSIGN-ADM")
        user = User.objects.create_user(username="assign-adm-emp", password="x")
        emp = Employee.objects.create(user=user, employee_id="NV09002", full_name="NV admin",
                                      department=dept, work_form="FULL_TIME")
        self.client.force_login(User.objects.create_superuser(username="assign-adm", password="x"))
        resp = self.client.get(f"/admin/employee/employee/{emp.pk}/change/")
        self.assertEqual(resp.status_code, 200)
        html = resp.content.decode()
        self.assertIn('name="assignment_history-TOTAL_FORMS"', html)
        # Dòng thêm tay điền sẵn dữ liệu hiện tại.
        self.assertRegex(html, r'(?s)name="assignment_history-__prefix__-work_form"[^>]*>(?:(?!</select>).)*'
                               r'<option value="FULL_TIME" selected>')
