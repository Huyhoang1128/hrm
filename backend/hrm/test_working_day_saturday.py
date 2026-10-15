"""
hrm/test_working_day_saturday.py
══════════════════════════════════
Bug thực tế 2026-09-26: QLTT tự test tài khoản (vị trí
NV_AI, không bật cờ `saturday_afternoon_always_workday`) tạo đơn Nghỉ không
phép cho 24-25/9 (Fri), hệ thống tính hạn = 28/9 (Mon) thay vì đúng ra phải
là 26/9 (Sat) — vì `is_working_day()` coi Thứ 7 là False khi thiếu cờ
`saturday_afternoon_always_workday`.

HCNS xác nhận: Thứ 7 LUÔN là ngày làm việc — chỉ khác nhau ở việc làm CẢ
NGÀY hay chỉ NỬA NGÀY sáng (tuần chẵn trong tháng, trừ khi bật cờ trên thì
làm cả ngày mọi tuần). Cờ `saturday_afternoon_always_workday` (xem
employee/models.py:183 help_text) chỉ ảnh hưởng CÔNG tính được của buổi
chiều thứ 7 — không quyết định thứ 7 có phải "ngày làm việc" cho mục đích
tính hạn (next_working_day/subtract_working_days) hay không. is_working_day()
trước đây dùng nhầm cờ này để quyết định cả điều đó.

Test này không cần DB thật (SimpleTestCase, mock HolidayConfig.objects.filter).
"""
import datetime as dt
import types
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.deadline_utils import (
    is_working_day, next_working_day, unauthorized_absence_deadline,
)


def _make_employee(saturday_flag=False, dept_saturday_flag=False, has_department=False):
    dept = types.SimpleNamespace(
        saturday_afternoon_always_workday=dept_saturday_flag,
    ) if has_department else None
    return types.SimpleNamespace(
        employee_id="NV02790",
        department=dept,
        saturday_afternoon_always_workday=saturday_flag,
        position=None,
        manager=None,
    )


class SaturdayAlwaysWorkingDayTests(SimpleTestCase):
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_thu_7_luon_la_ngay_lam_viec_du_khong_bat_co(self, _m):
        emp = _make_employee(saturday_flag=False)
        # 26/09/2026 là Thứ 7
        self.assertTrue(is_working_day(dt.date(2026, 9, 26), emp))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_thu_7_van_la_ngay_lam_viec_khi_employee_none(self, _m):
        self.assertTrue(is_working_day(dt.date(2026, 9, 26), None))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_thu_7_van_la_ngay_lam_viec_du_co_bat_co(self, _m):
        emp = _make_employee(saturday_flag=True)
        self.assertTrue(is_working_day(dt.date(2026, 9, 26), emp))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_chu_nhat_van_luon_khong_phai_ngay_lam_viec(self, _m):
        emp = _make_employee(saturday_flag=True)
        # 27/09/2026 là Chủ nhật
        self.assertFalse(is_working_day(dt.date(2026, 9, 27), emp))
        self.assertFalse(is_working_day(dt.date(2026, 9, 27), None))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_next_working_day_sau_thu_6_la_thu_7_khong_phai_thu_2(self, _m):
        """Đây chính là bug thực tế: Thứ 6 25/09 -> next_working_day phải là
        Thứ 7 26/09, không phải nhảy cóc qua tận Thứ 2 28/09."""
        emp = _make_employee(saturday_flag=False)
        self.assertEqual(next_working_day(dt.date(2026, 9, 25), emp), dt.date(2026, 9, 26))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_ngay_le_roi_vao_thu_7_van_bi_loai(self, _m):
        """Thứ 7 là ngày làm việc theo mặc định, nhưng ngày lễ chính thức rơi
        vào Thứ 7 vẫn phải bị loại như bình thường."""
        holiday = types.SimpleNamespace(
            holiday_date=dt.date(2026, 9, 26), is_recurring=False, is_working_day=False,
            should_apply_to_employee=lambda emp: True,
        )
        emp = _make_employee(saturday_flag=False)
        with patch("hrm.models.HolidayConfig.objects.filter", return_value=[holiday]):
            self.assertFalse(is_working_day(dt.date(2026, 9, 26), emp))


class UnauthorizedAbsenceDeadlineSaturdayRegressionTests(SimpleTestCase):
    """Tái hiện đúng case NV02790: nghỉ không phép 24-25/9 (last_absence=25,
    Thứ 6) — hạn phải rơi vào Thứ 7 26/9, không phải Thứ 2 28/9."""

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    @patch("hrm.deadline_utils.get_shift_start_time", return_value=dt.time(8, 30))
    def test_han_dung_la_thu_7_khong_phai_thu_2(self, mock_shift_start, _m):
        emp = _make_employee(saturday_flag=False)
        deadline = unauthorized_absence_deadline(dt.date(2026, 9, 25), emp)

        self.assertEqual(deadline.date(), dt.date(2026, 9, 26))
        self.assertEqual(timezone.localtime(deadline).hour, 11)
        self.assertEqual(timezone.localtime(deadline).minute, 30)
        mock_shift_start.assert_called_once_with(emp, dt.date(2026, 9, 26), half='FULL')
