from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Department, Employee

from .approval_manager_utils import (
    get_approval_manager_filter,
    get_approval_manager_id,
    is_approval_manager,
)
from .attendance_finalization_approval_views import (
    _get_active_or_resigned_in_period_q as get_attendance_employees_in_period_q,
    _get_manageable_department_ids as get_attendance_manageable_department_ids,
)
from .dept_approval_views import (
    _get_active_or_resigned_in_period_q as get_work_employees_in_period_q,
    _get_manageable_department_ids as get_work_manageable_department_ids,
)


class ApprovalManagerRoutingTests(TestCase):
    def setUp(self):
        self.direct_manager = self._create_employee("direct", "Quản lý trực tiếp")
        self.level_2_manager = self._create_employee("level2", "Quản lý cấp 2")
        self.fallback_department = Department.objects.create(
            name="Phòng fallback",
            code="APPROVAL_FALLBACK",
        )
        self.level_2_department = Department.objects.create(
            name="Phòng có quản lý cấp 2",
            code="APPROVAL_LEVEL_2",
        )
        self.fallback_employee = self._create_employee(
            "fallback_employee",
            "Nhân sự fallback",
            department=self.fallback_department,
            manager=self.direct_manager,
        )
        self.level_2_employee = self._create_employee(
            "level_2_employee",
            "Nhân sự có quản lý cấp 2",
            department=self.level_2_department,
            manager=self.direct_manager,
            manager_level_2=self.level_2_manager,
        )

    @staticmethod
    def _create_employee(username, full_name, **kwargs):
        user = User.objects.create_user(username=username)
        return Employee.objects.create(
            user=user,
            employee_id=f"TEST_{username.upper()}",
            full_name=full_name,
            **kwargs,
        )

    def test_level_2_manager_takes_priority_over_direct_manager(self):
        self.assertEqual(
            get_approval_manager_id(self.level_2_employee),
            self.level_2_manager.pk,
        )
        self.assertTrue(is_approval_manager(self.level_2_manager, self.level_2_employee))
        self.assertFalse(is_approval_manager(self.direct_manager, self.level_2_employee))

    def test_direct_manager_is_used_when_level_2_is_empty(self):
        self.assertEqual(
            get_approval_manager_id(self.fallback_employee),
            self.direct_manager.pk,
        )
        self.assertTrue(is_approval_manager(self.direct_manager, self.fallback_employee))

    def test_manager_filter_routes_each_employee_to_only_one_manager(self):
        direct_employee_ids = set(
            Employee.objects.filter(get_approval_manager_filter(self.direct_manager))
            .values_list("pk", flat=True)
        )
        level_2_employee_ids = set(
            Employee.objects.filter(get_approval_manager_filter(self.level_2_manager))
            .values_list("pk", flat=True)
        )

        self.assertIn(self.fallback_employee.pk, direct_employee_ids)
        self.assertNotIn(self.level_2_employee.pk, direct_employee_ids)
        self.assertIn(self.level_2_employee.pk, level_2_employee_ids)

    def test_both_approval_flows_use_the_same_routing_rule(self):
        expected_direct_departments = [self.fallback_department.pk]
        expected_level_2_departments = [self.level_2_department.pk]

        for get_department_ids in (
            get_work_manageable_department_ids,
            get_attendance_manageable_department_ids,
        ):
            self.assertCountEqual(
                get_department_ids(self.direct_manager, 2026, 6),
                expected_direct_departments,
            )
            self.assertCountEqual(
                get_department_ids(self.level_2_manager, 2026, 6),
                expected_level_2_departments,
            )

    def test_employees_resigned_before_period_are_excluded(self):
        resigned_before_period = self._create_employee(
            "resigned_before_period",
            "Nhân sự đã nghỉ từ tháng trước",
            department=self.fallback_department,
            manager=self.direct_manager,
            # Mô phỏng dữ liệu trạng thái chưa được đồng bộ nhưng đã có ngày nghỉ.
            is_active=True,
            employment_status="ACTIVE",
            end_date=date(2026, 5, 31),
        )
        resigned_on_period_start = self._create_employee(
            "resigned_on_period_start",
            "Nhân sự nghỉ đúng ngày đầu tháng",
            department=self.fallback_department,
            manager=self.direct_manager,
            is_active=False,
            employment_status="INACTIVE",
            end_date=date(2026, 6, 1),
        )
        resigned_after_period_start = self._create_employee(
            "resigned_after_period_start",
            "Nhân sự nghỉ sau ngày đầu tháng",
            department=self.fallback_department,
            manager=self.direct_manager,
            is_active=False,
            employment_status="INACTIVE",
            end_date=date(2026, 6, 2),
        )

        for get_period_q in (
            get_work_employees_in_period_q,
            get_attendance_employees_in_period_q,
        ):
            employee_ids = set(
                Employee.objects.filter(get_period_q(2026, 6))
                .values_list("pk", flat=True)
            )
            self.assertNotIn(resigned_before_period.pk, employee_ids)
            self.assertNotIn(resigned_on_period_start.pk, employee_ids)
            self.assertIn(resigned_after_period_start.pk, employee_ids)
