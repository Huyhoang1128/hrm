"""
hrm/test_shift_registration.py
════════════════════════════════
Smoke tests cho tính năng "Đăng ký ca làm" tuỳ biến (song song với ca cố định):
  - ShiftRegistrationScopeConfig.employee_in_scope() (yêu cầu #1)
  - shift_registration_deadline() — hạn hết Thứ 7 tuần trước (yêu cầu #3)
  - get_registered_shift_configs_for_date() — ưu tiên tuyệt đối + cô lập NV
    ngoài phạm vi + mỗi "ca" gán ĐỦ CẢ 2 buổi sáng/chiều (yêu cầu #5)
  - Đơn "Đổi ca" (SHIFT_CHANGE): validate lúc tạo + effect khi duyệt xong,
    LUÔN đổi cả 2 buổi cùng lúc (yêu cầu #4)
"""
from datetime import date, time, timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Department, Employee, Position

from .event_models import EmployeeEvent
from .models import ShiftConfig
from .registration_serializers import RegistrationRequestCreateSerializer
from .registration_views import apply_shift_change_effect
from .shift_config_utils import get_registered_shift_configs_for_date
from .shift_registration_models import (
    ShiftRegistration,
    ShiftRegistrationDay,
    ShiftRegistrationScopeConfig,
    shift_registration_deadline,
)


def _next_monday(from_date=None):
    d = from_date or date.today()
    days_ahead = (7 - d.weekday()) % 7
    days_ahead = days_ahead or 7
    return d + timedelta(days=days_ahead)


def _make_ca_shifts(suffix):
    """Tạo 1 cặp ShiftConfig (ca sáng 7h30-12h00, ca chiều 13h00-16h30) để dùng làm 1 "ca"."""
    morning = ShiftConfig.objects.create(
        name=f"Ca sáng {suffix}", code=f"SANG{suffix}",
        start_time=time(7, 30), end_time=time(12, 0),
        shift_type='MORNING', effective_from=date(2020, 1, 1),
    )
    afternoon = ShiftConfig.objects.create(
        name=f"Ca chiều {suffix}", code=f"CHIEU{suffix}",
        start_time=time(13, 0), end_time=time(16, 30),
        shift_type='AFTERNOON', effective_from=date(2020, 1, 1),
    )
    return morning, afternoon


class ShiftRegistrationScopeTests(TestCase):
    def setUp(self):
        self.dept_in_scope = Department.objects.create(name="CSKH", code="CSKH")
        self.dept_out_of_scope = Department.objects.create(name="Kế toán", code="KT")
        self.position = Position.objects.create(title="Nhân viên", code="NV")
        self.position_out_of_scope = Position.objects.create(title="Quản lý", code="QL")

        self.ca1_morning, self.ca1_afternoon = _make_ca_shifts("1")
        self.ca2_morning, self.ca2_afternoon = _make_ca_shifts("2")

        self.config = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=self.ca1_morning, shift_1_afternoon=self.ca1_afternoon,
            shift_2_morning=self.ca2_morning, shift_2_afternoon=self.ca2_afternoon,
            doctor_teams="Huy, Thảo",
        )
        self.config.departments.add(self.dept_in_scope)
        self.config.positions.add(self.position)

        # Phạm vi = AND cả 3 điều kiện: phòng ban + vị trí + bác sĩ phụ trách.
        self.emp_in_scope = self._create_employee(
            "in_scope", "NV trong phạm vi", self.dept_in_scope, self.position, "Huy",
        )
        self.emp_out_of_scope = self._create_employee(
            "out_scope", "NV ngoài phạm vi", self.dept_out_of_scope, self.position, "Huy",
        )
        # Đủ phòng ban + bác sĩ phụ trách nhưng SAI vị trí -> vẫn ngoài phạm vi.
        self.emp_wrong_position = self._create_employee(
            "wrong_position", "NV sai vị trí", self.dept_in_scope, self.position_out_of_scope, "Huy",
        )
        # Đủ phòng ban + vị trí nhưng SAI bác sĩ phụ trách -> vẫn ngoài phạm vi.
        self.emp_wrong_doctor = self._create_employee(
            "wrong_doctor", "NV sai bác sĩ phụ trách", self.dept_in_scope, self.position, "Lành",
        )

    def _create_employee(self, username, full_name, department, position=None, doctor_team=""):
        user = User.objects.create_user(username=username)
        return Employee.objects.create(
            user=user, employee_id=f"TEST_{username.upper()}", full_name=full_name,
            department=department, position=position or self.position, doctor_team=doctor_team,
        )

    def _register_ca(self, employee, target_date, ca_choice):
        week_start = target_date - timedelta(days=target_date.weekday())
        reg, _ = ShiftRegistration.objects.get_or_create(employee=employee, week_start_date=week_start)
        day, _ = ShiftRegistrationDay.objects.get_or_create(registration=reg, date=target_date)
        day.apply_ca(self.config, ca_choice)
        day.save()
        return day

    def test_employee_in_scope_requires_all_3_conditions(self):
        # Đủ cả 3 điều kiện (phòng ban + vị trí + bác sĩ phụ trách, không phân
        # biệt hoa/thường + khoảng trắng thừa trong doctor_teams) -> trong phạm vi.
        self.assertTrue(self.config.employee_in_scope(self.emp_in_scope))
        # Thiếu cả phòng ban lẫn vị trí (position_out_of_scope không nằm trong
        # cấu hình) -> ngoài phạm vi.
        self.assertFalse(self.config.employee_in_scope(self.emp_out_of_scope))
        # Chỉ sai 1 trong 3 điều kiện (vị trí) -> vẫn PHẢI ngoài phạm vi (AND,
        # không phải OR như thiết kế cũ).
        self.assertFalse(self.config.employee_in_scope(self.emp_wrong_position))
        # Chỉ sai 1 trong 3 điều kiện (bác sĩ phụ trách) -> vẫn PHẢI ngoài phạm vi.
        self.assertFalse(self.config.employee_in_scope(self.emp_wrong_doctor))

    def test_employee_in_scope_doctor_team_case_insensitive(self):
        emp = self._create_employee(
            "case_test", "NV test hoa thường", self.dept_in_scope, self.position, "  huy  ",
        )
        self.assertTrue(self.config.employee_in_scope(emp))

    def test_employee_in_scope_doctor_teams_blank_means_condition_skipped(self):
        # Để trống doctor_teams (dùng cho phòng ban không liên quan bác sĩ,
        # VD: IT, AI...) -> KHÔNG còn bắt buộc khớp bác sĩ phụ trách, chỉ cần
        # đủ phòng ban + vị trí. emp_wrong_doctor có doctor_team="Lành" (không
        # khớp cấu hình cũ "Huy, Thảo") nhưng vẫn đủ phòng ban + vị trí -> nay
        # PHẢI trong phạm vi.
        self.config.doctor_teams = ""
        self.config.save()
        self.assertTrue(self.config.employee_in_scope(self.emp_in_scope))
        self.assertTrue(self.config.employee_in_scope(self.emp_wrong_doctor))
        # Nhân viên còn để trống cả doctor_team trong hồ sơ (VD: NV IT/AI
        # không phải bác sĩ) vẫn PHẢI trong phạm vi khi config không lọc theo
        # bác sĩ phụ trách.
        emp_no_doctor_team = self._create_employee(
            "no_doctor", "NV không có team bác sĩ", self.dept_in_scope, self.position, "",
        )
        self.assertTrue(self.config.employee_in_scope(emp_no_doctor_team))
        # Nhưng vẫn PHẢI ngoài phạm vi nếu sai phòng ban/vị trí — 2 điều kiện
        # này LUÔN bắt buộc, không phụ thuộc doctor_teams.
        self.assertFalse(self.config.employee_in_scope(self.emp_out_of_scope))
        self.assertFalse(self.config.employee_in_scope(self.emp_wrong_position))

    def test_config_inactive_means_no_one_in_scope(self):
        self.config.is_active = False
        self.config.save()
        self.assertFalse(self.config.employee_in_scope(self.emp_in_scope))

    def test_shift_registration_deadline_is_saturday_before(self):
        monday = _next_monday()
        deadline = shift_registration_deadline(monday)
        saturday_before = monday - timedelta(days=2)
        self.assertEqual(deadline.date(), saturday_before)
        self.assertEqual(deadline.weekday(), 5)  # Saturday

    def test_registering_ca1_assigns_both_morning_and_afternoon_shifts(self):
        """Yêu cầu cốt lõi: đăng ký 1 ca (7h30-16h30) -> gán ĐỦ 2 ca (sáng + chiều), không phải 1."""
        monday = _next_monday()
        self._register_ca(self.emp_in_scope, monday, 1)

        result = get_registered_shift_configs_for_date(self.emp_in_scope, monday)
        self.assertEqual(len(result), 2)
        self.assertIn(self.ca1_morning, result)
        self.assertIn(self.ca1_afternoon, result)

    def test_get_registered_shift_configs_isolates_out_of_scope_employee(self):
        monday = _next_monday()
        # Đăng ký ca cho CẢ HAI nhân viên (kể cả người ngoài phạm vi, mô phỏng
        # dữ liệu cũ/nhầm lẫn) — chỉ NV trong phạm vi mới được engine đọc.
        self._register_ca(self.emp_in_scope, monday, 1)
        self._register_ca(self.emp_out_of_scope, monday, 1)

        self.assertEqual(len(get_registered_shift_configs_for_date(self.emp_in_scope, monday)), 2)
        self.assertIsNone(get_registered_shift_configs_for_date(self.emp_out_of_scope, monday))

    def test_get_registered_shift_configs_off_day_returns_empty_list(self):
        monday = _next_monday()
        self._register_ca(self.emp_in_scope, monday, None)
        self.assertEqual(get_registered_shift_configs_for_date(self.emp_in_scope, monday), [])

    def test_get_registered_shift_configs_no_registration_returns_none(self):
        monday = _next_monday()
        self.assertIsNone(get_registered_shift_configs_for_date(self.emp_in_scope, monday))


class ShiftChangeRequestTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name="CSKH", code="CSKH")
        self.position = Position.objects.create(title="Nhân viên", code="NV")
        self.ca1_morning, self.ca1_afternoon = _make_ca_shifts("1B")
        self.ca2_morning, self.ca2_afternoon = _make_ca_shifts("2B")
        self.config = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=self.ca1_morning, shift_1_afternoon=self.ca1_afternoon,
            shift_2_morning=self.ca2_morning, shift_2_afternoon=self.ca2_afternoon,
            doctor_teams="Huy",
        )
        self.config.departments.add(self.dept)
        self.config.positions.add(self.position)

        user = User.objects.create_user(username="swap_emp")
        self.employee = Employee.objects.create(
            user=user, employee_id="TEST_SWAP", full_name="NV đổi ca",
            department=self.dept, position=self.position, doctor_team="Huy",
        )
        self.future_date = date.today() + timedelta(days=5)
        week_start = self.future_date - timedelta(days=self.future_date.weekday())
        self.registration = ShiftRegistration.objects.create(
            employee=self.employee, week_start_date=week_start,
        )
        self.day = ShiftRegistrationDay.objects.create(registration=self.registration, date=self.future_date)
        self.day.apply_ca(self.config, 1)
        self.day.save()

    def _base_payload(self, **overrides):
        payload = {
            "employee_id": self.employee.id,
            "attendance_date": self.future_date,
            "registration_type": "SHIFT_CHANGE",
            "to_ca": 2,
            "reason": "Bận việc cá nhân",
        }
        payload.update(overrides)
        return payload

    def test_valid_swap_passes_validation_and_creates_event(self):
        serializer = RegistrationRequestCreateSerializer(data=self._base_payload())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        event = serializer.save()
        self.assertEqual(event.event_type, EmployeeEvent.EventType.SHIFT_CHANGE)
        self.assertEqual(event.data["from_ca"], 1)
        self.assertEqual(event.data["to_ca"], 2)
        self.assertEqual(event.data["status"], "PENDING")

    def test_rejects_same_day_or_past_date(self):
        for bad_date in (date.today(), date.today() - timedelta(days=1)):
            serializer = RegistrationRequestCreateSerializer(data=self._base_payload(attendance_date=bad_date))
            self.assertFalse(serializer.is_valid())
            self.assertIn("attendance_date", serializer.errors)

    def test_rejects_when_day_has_no_registered_ca(self):
        other_date = self.future_date + timedelta(days=1)
        serializer = RegistrationRequestCreateSerializer(data=self._base_payload(attendance_date=other_date))
        self.assertFalse(serializer.is_valid())

    def test_rejects_target_ca_same_as_current(self):
        serializer = RegistrationRequestCreateSerializer(data=self._base_payload(to_ca=1))
        self.assertFalse(serializer.is_valid())
        self.assertIn("to_ca", serializer.errors)

    def test_rejects_employee_out_of_scope(self):
        other_dept = Department.objects.create(name="Không thuộc phạm vi", code="OUT")
        user2 = User.objects.create_user(username="out_of_scope_swap")
        outsider = Employee.objects.create(
            user=user2, employee_id="TEST_OUTSIDER", full_name="NV ngoài phạm vi",
            department=other_dept, position=self.position,
        )
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(employee_id=outsider.id)
        )
        self.assertFalse(serializer.is_valid())

    def test_apply_shift_change_effect_swaps_both_halves_on_approval(self):
        serializer = RegistrationRequestCreateSerializer(data=self._base_payload())
        serializer.is_valid(raise_exception=True)
        event = serializer.save()

        # Chưa duyệt xong -> chưa có tác động
        apply_shift_change_effect(event)
        self.day.refresh_from_db()
        self.assertEqual(self.day.ca_choice, 1)
        self.assertEqual(self.day.morning_shift_id, self.ca1_morning.id)
        self.assertEqual(self.day.afternoon_shift_id, self.ca1_afternoon.id)

        # Duyệt xong cả 2 bước -> áp dụng đổi ca (đổi CẢ 2 buổi cùng lúc)
        event.data["status"] = "APPROVED"
        event.save(update_fields=["data"])
        apply_shift_change_effect(event)
        self.day.refresh_from_db()
        self.assertEqual(self.day.ca_choice, 2)
        self.assertEqual(self.day.morning_shift_id, self.ca2_morning.id)
        self.assertEqual(self.day.afternoon_shift_id, self.ca2_afternoon.id)

        # Idempotent: gọi lại lần nữa vẫn đúng, không lỗi
        apply_shift_change_effect(event)
        self.day.refresh_from_db()
        self.assertEqual(self.day.ca_choice, 2)


class ShiftRegistrationTeamOverviewTests(APITestCase):
    """HR/Admin xem toàn bộ NV trong phạm vi; QLTT chỉ xem cấp dưới trực tiếp;
    NV thường không được xem trang này (chỉ xem)."""

    TEAM_OVERVIEW_URL = "/api-hrm/shift-registrations/team-overview/"

    def setUp(self):
        self.dept = Department.objects.create(name="CSKH", code="CSKH_TEAM")
        self.other_dept = Department.objects.create(name="Kế toán", code="KT_TEAM")
        self.manager_position = Position.objects.create(title="Trưởng phòng", code="TP_TEAM", is_management=True)
        self.staff_position = Position.objects.create(title="Nhân viên", code="NV_TEAM")

        self.ca1_morning, self.ca1_afternoon = _make_ca_shifts("1T")
        self.ca2_morning, self.ca2_afternoon = _make_ca_shifts("2T")
        self.config = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=self.ca1_morning, shift_1_afternoon=self.ca1_afternoon,
            shift_2_morning=self.ca2_morning, shift_2_afternoon=self.ca2_afternoon,
            doctor_teams="Huy",
        )
        self.config.departments.add(self.dept)
        # Phạm vi = AND cả 3 điều kiện — thêm cả 2 vị trí dùng trong test này
        # (trưởng phòng + nhân viên) vào cấu hình.
        self.config.positions.add(self.manager_position, self.staff_position)

        self.hr_user = User.objects.create_user(username="team_hr")
        self.hr_employee = Employee.objects.create(
            user=self.hr_user, employee_id="TEAM_HR", full_name="HR", is_hr=True,
        )

        manager_user = User.objects.create_user(username="team_manager")
        self.manager = Employee.objects.create(
            user=manager_user, employee_id="TEAM_MGR", full_name="Trưởng phòng",
            department=self.dept, position=self.manager_position, doctor_team="Huy",
        )

        report_user = User.objects.create_user(username="team_report")
        self.direct_report = Employee.objects.create(
            user=report_user, employee_id="TEAM_NV1", full_name="NV cấp dưới",
            department=self.dept, position=self.staff_position, manager=self.manager,
            doctor_team="Huy",
        )

        # NV cùng phòng ban trong phạm vi nhưng KHÔNG phải cấp dưới của manager
        other_report_user = User.objects.create_user(username="team_other")
        self.unrelated_employee = Employee.objects.create(
            user=other_report_user, employee_id="TEAM_NV2", full_name="NV khác nhóm",
            department=self.dept, position=self.staff_position, doctor_team="Huy",
        )

        staff_user = User.objects.create_user(username="team_staff")
        self.plain_staff = Employee.objects.create(
            user=staff_user, employee_id="TEAM_STAFF", full_name="NV thường",
            department=self.dept, position=self.staff_position, manager=self.manager,
            doctor_team="Huy",
        )

        self.week_start = _next_monday()
        reg = ShiftRegistration.objects.create(employee=self.direct_report, week_start_date=self.week_start)
        day = ShiftRegistrationDay.objects.create(registration=reg, date=self.week_start)
        day.apply_ca(self.config, 1)
        day.save()

    def test_hr_sees_all_employees_in_scope(self):
        self.client.force_authenticate(self.hr_user)
        resp = self.client.get(self.TEAM_OVERVIEW_URL, {"week_start_date": self.week_start.isoformat()})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        employee_ids = {row["employee_id"] for row in resp.data}
        self.assertIn(self.direct_report.id, employee_ids)
        self.assertIn(self.unrelated_employee.id, employee_ids)
        self.assertIn(self.plain_staff.id, employee_ids)

        report_row = next(row for row in resp.data if row["employee_id"] == self.direct_report.id)
        self.assertTrue(report_row["has_registration"])
        self.assertEqual(report_row["days"][0]["ca_choice"], 1)
        self.assertEqual(report_row["days"][0]["morning_shift_code"], self.ca1_morning.code)
        self.assertEqual(report_row["days"][0]["afternoon_shift_code"], self.ca1_afternoon.code)

    def test_manager_sees_only_direct_reports(self):
        self.client.force_authenticate(self.manager.user)
        resp = self.client.get(self.TEAM_OVERVIEW_URL, {"week_start_date": self.week_start.isoformat()})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        employee_ids = {row["employee_id"] for row in resp.data}
        self.assertIn(self.direct_report.id, employee_ids)
        self.assertIn(self.plain_staff.id, employee_ids)
        self.assertNotIn(self.unrelated_employee.id, employee_ids)
        self.assertNotIn(self.manager.id, employee_ids)  # manager không tự liệt kê chính mình

    def test_plain_staff_forbidden(self):
        self.client.force_authenticate(self.direct_report.user)
        resp = self.client.get(self.TEAM_OVERVIEW_URL, {"week_start_date": self.week_start.isoformat()})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_team_overview_includes_config_with_blank_doctor_teams(self):
        """Config KHÔNG liên quan bác sĩ (VD: IT/AI) để trống doctor_teams —
        team-overview vẫn phải liệt kê NV thuộc phòng ban/vị trí đó dù NV
        không hề có Employee.doctor_team (không phải bác sĩ)."""
        it_dept = Department.objects.create(name="CNTT", code="CNTT_TEAM")
        it_position = Position.objects.create(title="Nhân viên IT", code="NV_IT_TEAM")
        it_ca1_morning, it_ca1_afternoon = _make_ca_shifts("IT1")
        it_ca2_morning, it_ca2_afternoon = _make_ca_shifts("IT2")
        it_config = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=it_ca1_morning, shift_1_afternoon=it_ca1_afternoon,
            shift_2_morning=it_ca2_morning, shift_2_afternoon=it_ca2_afternoon,
            doctor_teams="",  # để trống -> không lọc theo bác sĩ phụ trách
        )
        it_config.departments.add(it_dept)
        it_config.positions.add(it_position)

        it_employee = Employee.objects.create(
            user=User.objects.create_user(username="team_it"),
            employee_id="TEAM_IT", full_name="NV IT", is_active=True,
            department=it_dept, position=it_position, doctor_team="",
        )

        self.client.force_authenticate(self.hr_user)
        resp = self.client.get(self.TEAM_OVERVIEW_URL, {"week_start_date": self.week_start.isoformat()})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        employee_ids = {row["employee_id"] for row in resp.data}
        self.assertIn(it_employee.id, employee_ids)

        it_row = next(row for row in resp.data if row["employee_id"] == it_employee.id)
        self.assertEqual(it_row["ca_1"]["morning"]["code"], it_ca1_morning.code)


class MultipleScopeConfigTests(TestCase):
    """Từ 1 config singleton -> nhiều config song song: mỗi nhóm phòng ban/
    vị trí/bác sĩ phụ trách có thể có cặp Ca 1/Ca 2 giờ khác nhau. Test
    ShiftRegistrationScopeConfig.for_employee() chọn ĐÚNG config cho từng
    nhân viên, không bị lẫn giữa các config."""

    def setUp(self):
        self.dept_a = Department.objects.create(name="Nhóm A", code="GRP_A")
        self.dept_b = Department.objects.create(name="Nhóm B", code="GRP_B")
        self.position = Position.objects.create(title="Nhân viên", code="MULTI_NV")

        self.a_ca1_morning, self.a_ca1_afternoon = _make_ca_shifts("A1")
        self.a_ca2_morning, self.a_ca2_afternoon = _make_ca_shifts("A2")
        self.config_a = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=self.a_ca1_morning, shift_1_afternoon=self.a_ca1_afternoon,
            shift_2_morning=self.a_ca2_morning, shift_2_afternoon=self.a_ca2_afternoon,
            doctor_teams="Huy",
        )
        self.config_a.departments.add(self.dept_a)
        self.config_a.positions.add(self.position)

        self.b_ca1_morning, self.b_ca1_afternoon = _make_ca_shifts("B1")
        self.b_ca2_morning, self.b_ca2_afternoon = _make_ca_shifts("B2")
        self.config_b = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=self.b_ca1_morning, shift_1_afternoon=self.b_ca1_afternoon,
            shift_2_morning=self.b_ca2_morning, shift_2_afternoon=self.b_ca2_afternoon,
            doctor_teams="Lành",
        )
        self.config_b.departments.add(self.dept_b)
        self.config_b.positions.add(self.position)

        self.emp_a = Employee.objects.create(
            user=User.objects.create_user(username="multi_a"),
            employee_id="MULTI_A", full_name="NV nhóm A",
            department=self.dept_a, position=self.position, doctor_team="Huy",
        )
        self.emp_b = Employee.objects.create(
            user=User.objects.create_user(username="multi_b"),
            employee_id="MULTI_B", full_name="NV nhóm B",
            department=self.dept_b, position=self.position, doctor_team="Lành",
        )
        # Không khớp config nào (đúng phòng ban + vị trí nhưng sai bác sĩ phụ trách).
        self.emp_none = Employee.objects.create(
            user=User.objects.create_user(username="multi_none"),
            employee_id="MULTI_NONE", full_name="NV không thuộc config nào",
            department=self.dept_a, position=self.position, doctor_team="Khác",
        )

    def test_for_employee_returns_correct_config_per_employee(self):
        self.assertEqual(ShiftRegistrationScopeConfig.for_employee(self.emp_a).id, self.config_a.id)
        self.assertEqual(ShiftRegistrationScopeConfig.for_employee(self.emp_b).id, self.config_b.id)
        self.assertIsNone(ShiftRegistrationScopeConfig.for_employee(self.emp_none))

    def test_registered_shift_configs_use_correct_pair_per_employee(self):
        """NV nhóm A đăng ký Ca 1 phải nhận đúng cặp ca của config A, không
        bị lẫn sang cặp ca của config B — dù cả 2 config đều có "Ca 1"."""
        monday = _next_monday()
        for emp, config in ((self.emp_a, self.config_a), (self.emp_b, self.config_b)):
            week_start = monday - timedelta(days=monday.weekday())
            reg, _ = ShiftRegistration.objects.get_or_create(employee=emp, week_start_date=week_start)
            day, _ = ShiftRegistrationDay.objects.get_or_create(registration=reg, date=monday)
            day.apply_ca(config, 1)
            day.save()

        result_a = get_registered_shift_configs_for_date(self.emp_a, monday)
        self.assertIn(self.a_ca1_morning, result_a)
        self.assertIn(self.a_ca1_afternoon, result_a)
        self.assertNotIn(self.b_ca1_morning, result_a)

        result_b = get_registered_shift_configs_for_date(self.emp_b, monday)
        self.assertIn(self.b_ca1_morning, result_b)
        self.assertIn(self.b_ca1_afternoon, result_b)
        self.assertNotIn(self.a_ca1_morning, result_b)

    def test_overlapping_configs_pick_lowest_id_and_log_warning(self):
        """Nếu HR lỡ cấu hình chồng lấn (1 NV khớp cả 2 config), for_employee()
        vẫn phải trả về ĐÚNG 1 config (không lỗi/crash) — lấy config id nhỏ
        nhất, để hành vi có thể dự đoán được thay vì tuỳ tiện."""
        # Mở rộng config_b để cùng khớp emp_a (chồng lấn với config_a).
        self.config_b.departments.add(self.dept_a)
        self.config_b.doctor_teams = "Huy, Lành"
        self.config_b.save()

        result = ShiftRegistrationScopeConfig.for_employee(self.emp_a)
        self.assertEqual(result.id, min(self.config_a.id, self.config_b.id))


class UserProfileShiftRegistrationScopeFlagTests(APITestCase):
    """/api/users/profile/ trả về shift_registration_in_scope — FE
    (Sidebar.tsx) dùng flag này để ẨN HẲN menu "Đăng ký ca làm", KHÔNG gọi
    lại scope-status/ để quyết định hiện/ẩn menu. Trước đây view này tự
    query ShiftRegistrationScopeConfig.objects.filter(is_active=True).first()
    thay vì dùng for_employee() — khi có NHIỀU config song song, NV chỉ
    thuộc config thứ 2 trở đi (VD: NV phòng IT/AI, config đầu tiên là của
    nhóm bác sĩ) bị tính sai thành "ngoài phạm vi", menu bị ẩn oan dù NV đó
    thực sự thuộc phạm vi của config khác."""

    PROFILE_URL = "/api/users/profile/"

    def setUp(self):
        # Config #1 (id nhỏ nhất): dành cho nhóm bác sĩ, không liên quan NV IT.
        doctor_dept = Department.objects.create(name="Phòng khám", code="PROFILE_KHAM")
        doctor_position = Position.objects.create(title="Bác sĩ", code="PROFILE_BS")
        d1_ca1_morning, d1_ca1_afternoon = _make_ca_shifts("PD1")
        d1_ca2_morning, d1_ca2_afternoon = _make_ca_shifts("PD2")
        self.doctor_config = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=d1_ca1_morning, shift_1_afternoon=d1_ca1_afternoon,
            shift_2_morning=d1_ca2_morning, shift_2_afternoon=d1_ca2_afternoon,
            doctor_teams="Huy",
        )
        self.doctor_config.departments.add(doctor_dept)
        self.doctor_config.positions.add(doctor_position)

        # Config #2 (id lớn hơn): phòng IT — không liên quan bác sĩ, để trống doctor_teams.
        it_dept = Department.objects.create(name="CNTT", code="PROFILE_IT")
        it_position = Position.objects.create(title="Nhân viên IT", code="PROFILE_NVIT")
        it_ca1_morning, it_ca1_afternoon = _make_ca_shifts("PIT1")
        it_ca2_morning, it_ca2_afternoon = _make_ca_shifts("PIT2")
        self.it_config = ShiftRegistrationScopeConfig.objects.create(
            shift_1_morning=it_ca1_morning, shift_1_afternoon=it_ca1_afternoon,
            shift_2_morning=it_ca2_morning, shift_2_afternoon=it_ca2_afternoon,
            doctor_teams="",
        )
        self.it_config.departments.add(it_dept)
        self.it_config.positions.add(it_position)
        self.assertLess(self.doctor_config.id, self.it_config.id)

        self.it_user = User.objects.create_user(username="profile_it_nv")
        self.it_employee = Employee.objects.create(
            user=self.it_user, employee_id="PROFILE_IT_NV", full_name="NV IT",
            department=it_dept, position=it_position, doctor_team="",
        )

    def test_employee_matching_only_second_config_still_flagged_in_scope(self):
        self.client.force_authenticate(self.it_user)
        resp = self.client.get(self.PROFILE_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["shift_registration_in_scope"])
        self.assertTrue(resp.data["employee_profile"]["shift_registration_in_scope"])
