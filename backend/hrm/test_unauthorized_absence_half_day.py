"""
Regression test cho tính năng: đơn "Nghỉ không phép" (UNAUTHORIZED_ABSENCE) hỗ
trợ chọn nửa ngày cụ thể — expected_status = 'ABSENT' (cả ngày, mặc định) hoặc
'HALF_DAY' (nửa ngày) kèm half_day_period = 'MORNING'/'AFTERNOON'.

Lịch sử: ban đầu chỉ có 1 checkbox "Nghỉ nửa ngày" chung chung (không phân
biệt sáng/chiều). Sau đó đổi thành 2 lựa chọn cụ thể "Nghỉ ca sáng"/"Nghỉ ca
chiều" (giống giao diện Nghỉ phép tháng) — half_day_period dùng lại đúng field
name/value đã có sẵn trong hệ thống (LeaveRequest.half_day_period, contract
EmployeeEvent.data ở đầu models.py) để hàm đọc "Ca làm" sẵn có
(hrm/views.py: nhận diện nửa ngày) tự động nhận ra, không cần sửa thêm.

Ràng buộc: 'HALF_DAY' chỉ áp dụng cho registration_type=UNAUTHORIZED_ABSENCE,
không được kết hợp với end_date (chọn khoảng nhiều ngày) — nửa ngày chỉ có ý
nghĩa cho đúng 1 ngày — và BẮT BUỘC phải chọn half_day_period (sáng hoặc
chiều). Ngược lại, half_day_period chỉ được set khi expected_status=HALF_DAY.
"""
import datetime as dt

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from employee.models import Employee
from hrm.registration_serializers import RegistrationRequestCreateSerializer


def _upcoming_monday():
    """Thứ Hai cách hôm nay ít nhất 7 ngày — còn trong hạn tạo đơn, khoảng 3 ngày
    (thứ Hai → thứ Tư) không dính Chủ nhật."""
    day = timezone.localdate() + dt.timedelta(days=7)
    return day + dt.timedelta(days=(7 - day.weekday()) % 7)


class UnauthorizedAbsenceHalfDaySerializerTests(TestCase):
    def setUp(self):
        self.day = _upcoming_monday()
        self.day_plus_2 = (self.day + dt.timedelta(days=2)).isoformat()
        user = User.objects.create_user(username="ta_halfday_test", password="x")
        self.employee = Employee.objects.create(
            user=user,
            employee_id="TA_HALFDAY_01",
            full_name="Test Employee",
        )

    def _base_payload(self, **overrides):
        payload = {
            "employee_id": self.employee.id,
            "attendance_date": self.day.isoformat(),
            "registration_type": "UNAUTHORIZED_ABSENCE",
            "reason": "Nghỉ đột xuất",
        }
        payload.update(overrides)
        return payload

    def test_half_day_morning_unauthorized_absence_is_valid_and_stored(self):
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(expected_status="HALF_DAY", half_day_period="MORNING")
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        event = serializer.save()
        self.assertEqual(event.data.get("expected_status"), "HALF_DAY")
        self.assertEqual(event.data.get("half_day_period"), "MORNING")

    def test_half_day_afternoon_unauthorized_absence_is_valid_and_stored(self):
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(expected_status="HALF_DAY", half_day_period="AFTERNOON")
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        event = serializer.save()
        self.assertEqual(event.data.get("expected_status"), "HALF_DAY")
        self.assertEqual(event.data.get("half_day_period"), "AFTERNOON")

    def test_half_day_without_period_is_rejected(self):
        """Trước đây chỉ cần expected_status=HALF_DAY là đủ — giờ bắt buộc
        phải chọn rõ ca sáng/chiều, không còn "nửa ngày" mập mờ nữa."""
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(expected_status="HALF_DAY")
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("half_day_period", serializer.errors)

    def test_half_day_period_rejected_when_not_half_day(self):
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(half_day_period="MORNING")
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("half_day_period", serializer.errors)

    def test_default_full_day_unauthorized_absence_is_absent(self):
        serializer = RegistrationRequestCreateSerializer(data=self._base_payload())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        event = serializer.save()
        self.assertEqual(event.data.get("expected_status"), "ABSENT")
        self.assertEqual(event.data.get("half_day_period"), "")

    def test_half_day_rejected_for_non_unauthorized_absence_type(self):
        # Dùng LIVE (không phải OVERTIME/UNAUTHORIZED_ABSENCE) để tránh bị chặn
        # sớm hơn bởi rule khoá hạn tạo đơn (deadline_utils) — chỉ muốn kiểm tra
        # riêng validation của expected_status='HALF_DAY'.
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(registration_type="LIVE", expected_status="HALF_DAY",
                                     start_time="20:00", end_time="22:00")
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("expected_status", serializer.errors)

    def test_half_day_rejected_when_combined_with_date_range(self):
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(
                expected_status="HALF_DAY", half_day_period="MORNING", end_date=self.day_plus_2
            )
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("expected_status", serializer.errors)

    def test_multi_day_range_without_half_day_defaults_to_absent_each_day(self):
        serializer = RegistrationRequestCreateSerializer(
            data=self._base_payload(end_date=self.day_plus_2)
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        result = serializer.save()
        created = result["created"]
        self.assertEqual(len(created), 3)
        for event in created:
            self.assertEqual(event.data.get("expected_status"), "ABSENT")
