"""GET /api/v1/hrm/attendance/shifts/employee/<id>/[?date=] — các ca áp dụng cho NV vào ngày đó,
kèm giờ nghỉ giữa ca.

Web dựng lựa chọn giờ cho đơn Quên chấm công / Lỗi máy chấm công từ giờ vào/ra/nghỉ của các ca
đang áp dụng cho nhân viên (ShiftConfig) thay vì danh sách giờ ghi cứng — nên API phải trả đủ
break_start_time / break_end_time. Trước đây view lọc theo field `apply_to_all` không còn tồn
tại nên luôn lỗi 500; nay dùng đúng hàm engine chấm công dùng (shift_config_utils).
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.models import ShiftConfig


class EmployeeShiftOptionsApiTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username='_shiftopt_emp', password='x')
        self.employee = Employee.objects.create(
            user=user, employee_id='SHIFTOPT-1', full_name='NV Ca', gender='F', is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user)
        since = datetime.date(2024, 1, 1)
        full = ShiftConfig.objects.create(
            name='Ca hành chính', code='SHIFTOPT-HC', start_time=datetime.time(8, 30),
            end_time=datetime.time(17, 30), break_start_time=datetime.time(12, 0),
            break_end_time=datetime.time(13, 0), effective_from=since,
        )
        full.apply_to_employees.add(self.employee)
        evening = ShiftConfig.objects.create(
            name='Ca tối', code='SHIFTOPT-EVE', shift_type='EVENING', start_time=datetime.time(17, 30),
            end_time=datetime.time(21, 0), effective_from=since,
        )
        evening.apply_to_employees.add(self.employee)
        # Ca có hiệu lực từ 30 ngày tới (lịch sử gán ca cá nhân tính từ hôm nay nên xét các ngày tới).
        self.later_from = datetime.date.today() + datetime.timedelta(days=30)
        later = ShiftConfig.objects.create(
            name='Ca mới', code='SHIFTOPT-LATER', start_time=datetime.time(9, 0),
            end_time=datetime.time(18, 0), effective_from=self.later_from,
        )
        later.apply_to_employees.add(self.employee)

    def _shifts(self, date=None):
        params = {'date': date} if date else {}
        res = self.client.get(f'/api/v1/hrm/attendance/shifts/employee/{self.employee.id}/', params)
        self.assertEqual(res.status_code, 200, res.content)
        return {s['code']: s for s in res.json()['data']['shifts']}

    def test_shifts_effective_on_date(self):
        day_before = (self.later_from - datetime.timedelta(days=1)).isoformat()
        self.assertNotIn('SHIFTOPT-LATER', self._shifts(day_before))
        on_day = self._shifts(self.later_from.isoformat())
        self.assertIn('SHIFTOPT-LATER', on_day)
        self.assertEqual(on_day['SHIFTOPT-HC']['scope'], 'personal')

    def test_invalid_date_is_400(self):
        res = self.client.get(f'/api/v1/hrm/attendance/shifts/employee/{self.employee.id}/', {'date': 'x'})
        self.assertEqual(res.status_code, 400)

    def test_returns_break_times(self):
        res = self.client.get(f'/api/v1/hrm/attendance/shifts/employee/{self.employee.id}/')
        self.assertEqual(res.status_code, 200, res.content)
        shifts = {s['code']: s for s in res.json()['data']['shifts']}
        self.assertEqual(shifts['SHIFTOPT-HC']['start_time'], '08:30:00')
        self.assertEqual(shifts['SHIFTOPT-HC']['break_start_time'], '12:00:00')
        self.assertEqual(shifts['SHIFTOPT-HC']['break_end_time'], '13:00:00')
        self.assertIsNone(shifts['SHIFTOPT-EVE']['break_start_time'])
        self.assertIsNone(shifts['SHIFTOPT-EVE']['break_end_time'])
