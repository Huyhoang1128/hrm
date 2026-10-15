"""
Đơn giải trình vi phạm trùng cùng ngày không được hoàn phạt 2 lần.

Case thật NV00040 30/09/2026: nhân viên tạo 2 đơn Đi muộn cách nhau 4 phút,
cả 2 đều được QLTT + HCNS duyệt -> phạt 50.000đ bị hoàn 2 lần, tổng phạt
tháng = -50.000đ. Sửa 2 lớp:
  - Tạo đơn: chặn đơn Đi muộn/Về sớm cùng loại cùng ngày khi đã có đơn chờ/đã duyệt.
  - Engine: bỏ qua đơn Đi muộn/Về sớm duyệt trùng; tổng tiền hoàn (mọi loại)
    không vượt phạt còn lại của ngày.
"""
from django.contrib.auth.models import User
from django.test import SimpleTestCase
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.event import Event
from hrm.main_api import EmployeeState

DAY = "2026-08-03"  # trước mốc "cứu 30 phút đầu" để số hoàn = toàn bộ phạt


def _state(entries):
    state = EmployeeState("TEST_NV")
    state.calendar_result = list(entries)
    return state


def _attendance(effects):
    return {"date": DAY, "event_type": "attendance", "rules_applied": [], "effects": effects, "delta": dict(effects)}


def _approval(explanation_type, **extra):
    return Event("explanation_approval", {
        "action": "APPROVE", "approval_level": "HR", "explanation_type": explanation_type, "date": DAY, **extra,
    })


def _apply(state, event):
    """Áp effects vào calendar_result như replay_month làm sau mỗi event."""
    effects = state._evaluate_explanation_approval_rule(event, {})
    state.calendar_result.append({"date": DAY, "event_type": "explanation_approval", "effects": effects, "delta": effects})
    return effects


class DuplicateExplanationRefundTests(SimpleTestCase):
    def test_duplicate_late_approval_refunds_once(self):
        state = _state([_attendance({"di_muon_ve_som": 1, "tong_phat": 50_000, "late_penalty": 50_000})])
        first = _apply(state, _approval("LATE"))
        second = _apply(state, _approval("LATE"))
        self.assertEqual(first.get("tong_phat"), -50_000)
        self.assertEqual(first.get("explanation_quota_used"), 1)
        self.assertEqual(second, {})

    def test_refund_capped_by_remaining_penalty_of_the_day(self):
        state = _state([_attendance({"di_muon_ve_som": 1, "tong_phat": 50_000, "late_penalty": 50_000})])
        _apply(state, _approval("LATE"))
        trip = _apply(state, _approval("BUSINESS_TRIP"))
        self.assertNotIn("tong_phat", trip)
        self.assertEqual(sum(e["effects"].get("tong_phat", 0) for e in state.calendar_result), 0)

    def test_two_forgot_explanations_same_day_are_not_deduped(self):
        # Quên CC sáng + chiều: 2 đơn hợp lệ cùng loại cùng ngày, đều phải áp dụng.
        state = _state([_attendance({"quen_cham_cong": 2})])
        _apply(state, _approval("INCOMPLETE_ATTENDANCE", forgot_punch_type="checkin"))
        second = _apply(state, _approval("INCOMPLETE_ATTENDANCE", forgot_punch_type="checkin"))
        self.assertEqual(second.get("explanation_quota_used"), 1)


class DuplicateExplanationCreateTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="dup-expl", password="x")
        self.employee = Employee.objects.create(user=self.user, employee_id="DUP-EXPL-NV", full_name="NV")
        self.client.force_authenticate(self.user)

    def _post(self, explanation_type="LATE", **extra):
        payload = {
            "employee_id": self.employee.id, "attendance_date": "2026-08-03",
            "original_status": "LATE", "expected_status": "PRESENT",
            "explanation_type": explanation_type, "reason": "Kẹt xe", **extra,
        }
        return self.client.post("/api-hrm/attendance-explanations/", payload, format="json")

    def test_second_late_explanation_same_day_is_blocked(self):
        self.assertEqual(self._post().status_code, status.HTTP_201_CREATED)
        response = self._post()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("đã có đơn giải trình", str(response.data))

    def test_second_early_leave_blocked_but_other_type_allowed(self):
        self.assertEqual(self._post("EARLY_LEAVE").status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._post("EARLY_LEAVE").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._post("LATE").status_code, status.HTTP_201_CREATED)
