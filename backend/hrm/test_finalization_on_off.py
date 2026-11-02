"""
Chốt công — cột ON/OFF: NV có ngày nghỉ việc (hồ sơ hiện "Đã nghỉ") phải ra OFF, kể cả
khi trạng thái lưu vẫn là Đang làm việc (HCNS Alan báo 02/11/2026, cùng lỗi ở bản này).
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Department, Employee
from hrm.finalization_views import _on_off, _serialize_employee_no_record, _serialize_record
from hrm.models import WorkFinalization

TODAY = datetime.date.today()
PAST = TODAY - datetime.timedelta(days=30)
FUTURE = TODAY + datetime.timedelta(days=30)


class OnOffRuleTests(TestCase):
    def test_rule(self):
        self.assertEqual(_on_off("ACTIVE", None), "ON")
        self.assertEqual(_on_off("ACTIVE", PAST), "OFF")
        self.assertEqual(_on_off("ACTIVE", TODAY), "OFF")
        self.assertEqual(_on_off("ACTIVE", FUTURE), "ON")
        self.assertEqual(_on_off("INACTIVE", None), "OFF")
        self.assertEqual(_on_off("PAUSED", None), "ON")


class OnOffSerializationTests(TestCase):
    def setUp(self):
        dept = Department.objects.create(name="Kinh doanh", code="KD")
        self.emp = Employee.objects.create(
            user=User.objects.create_user(username="onoff-nv", password="x"), employee_id="NV-ONOFF",
            full_name="Nguyễn Ngọc Mai", department=dept, start_date=PAST - datetime.timedelta(days=60),
            end_date=PAST,
        )
        # Lưu thẳng trạng thái ACTIVE (như dữ liệu thật: chỉ set ngày nghỉ việc)
        Employee.objects.filter(pk=self.emp.pk).update(employment_status="ACTIVE")
        self.emp.refresh_from_db()

    def _record(self, end_date):
        return WorkFinalization.objects.create(
            employee=self.emp, year=TODAY.year, month=TODAY.month, employee_code="NV-ONOFF",
            ho_va_ten="Nguyễn Ngọc Mai", on_off="ON", trang_thai_lam_viec="ACTIVE", ngay_nghi_viec=end_date,
            raw_state={"holiday_credit": 0},
        )

    def test_employee_without_record_shows_off(self):
        self.assertEqual(_serialize_employee_no_record(self.emp, TODAY.year, TODAY.month)["on_off"], "OFF")

    def test_old_record_saved_as_on_is_shown_off(self):
        self.assertEqual(_serialize_record(self._record(PAST))["on_off"], "OFF")

    def test_working_record_stays_on(self):
        self.assertEqual(_serialize_record(self._record(None))["on_off"], "ON")
