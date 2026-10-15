"""
Công lễ không được cộng cho ngày lễ rơi đúng/sau "Ngày kết thúc làm việc"
(yêu cầu 2026-10-03, cả 3 tenant): HCNS nhập end_date là ngày bắt đầu nghỉ
(vd nghỉ từ 01/09 -> end_date = 01/09), nên nhân sự nghỉ việc 01/09 không
được 1 công lễ của ngày nghỉ bù Quốc khánh 01/09.
"""
from datetime import date

from django.test import SimpleTestCase

from employee.models import Employee
from hrm.employee_work_utils import is_employee_active_on_date, is_holiday_creditable


class HolidayCreditEndDateTests(SimpleTestCase):
    def _emp(self, start=None, end=None):
        return Employee(start_date=start, end_date=end)

    def test_holiday_on_end_date_is_not_credited(self):
        emp = self._emp(end=date(2026, 9, 1))
        self.assertFalse(is_holiday_creditable(emp, date(2026, 9, 1)))
        # Ngày làm việc thực tế end_date vẫn còn tính là đang làm (chỉ công lễ bị loại).
        self.assertTrue(is_employee_active_on_date(emp, date(2026, 9, 1)))

    def test_holiday_after_end_date_is_not_credited(self):
        emp = self._emp(end=date(2026, 8, 31))
        self.assertFalse(is_holiday_creditable(emp, date(2026, 9, 2)))

    def test_holiday_before_end_date_is_credited(self):
        emp = self._emp(end=date(2026, 9, 3))
        self.assertTrue(is_holiday_creditable(emp, date(2026, 9, 2)))

    def test_holiday_before_start_date_is_not_credited(self):
        emp = self._emp(start=date(2026, 9, 2))
        self.assertFalse(is_holiday_creditable(emp, date(2026, 9, 1)))
        self.assertTrue(is_holiday_creditable(emp, date(2026, 9, 2)))

    def test_active_employee_without_dates_is_credited(self):
        self.assertTrue(is_holiday_creditable(self._emp(), date(2026, 9, 2)))
