"""
GET /api-hrm/employees/?active_in_month=YYYY-MM — phạm vi nhân viên của tháng chốt công.

Trước đây trang Chốt công tự lọc ở web "người nghỉ việc trong 46 ngày tính từ HÔM NAY", lệch với
tập backend thật sự chốt (finalize-all / finalize-department dùng _active_in_month_q: còn làm ít
nhất 1 ngày trong tháng đang chọn). Tham số này trả đúng tập đó để web dùng chung.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.finalization_views import _active_in_month_q


class EmployeeActiveInMonthFilterTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='_aim_admin', password='x', is_staff=True, is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        def make(code, **kwargs):
            user = User.objects.create_user(username=f'u_{code}', password='x')
            return Employee.objects.create(
                user=user, employee_id=code, full_name=f'NV {code}', gender='F', is_active=True, **kwargs,
            )

        # Tháng chọn: 03/2026
        self.working = make('AIM-WORK', start_date=datetime.date(2025, 1, 1))
        self.left_in_month = make('AIM-LEFT-IN', start_date=datetime.date(2025, 1, 1),
                                  end_date=datetime.date(2026, 3, 1))
        self.left_before = make('AIM-LEFT-BEFORE', start_date=datetime.date(2025, 1, 1),
                                end_date=datetime.date(2026, 2, 28))
        self.starts_after = make('AIM-START-AFTER', start_date=datetime.date(2026, 4, 1))
        self.starts_last_day = make('AIM-START-LAST', start_date=datetime.date(2026, 3, 31))
        self.no_dates = make('AIM-NODATE')

    def _codes(self, params):
        res = self.client.get('/api-hrm/employees/', {'page_size': 1000, **params})
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        rows = data['results'] if isinstance(data, dict) else data
        return {r['employee_id'] for r in rows if r['employee_id'].startswith('AIM-')}

    def test_scope_matches_finalize_all(self):
        codes = self._codes({'active_in_month': '2026-03'})
        expected = set(
            Employee.objects.filter(is_active=True, employee_id__startswith='AIM-')
            .filter(_active_in_month_q(2026, 3)).values_list('employee_id', flat=True)
        )
        self.assertEqual(codes, expected)
        self.assertEqual(codes, {'AIM-WORK', 'AIM-LEFT-IN', 'AIM-START-LAST', 'AIM-NODATE'})

    def test_without_param_unchanged(self):
        self.assertIn('AIM-START-AFTER', self._codes({}))
        self.assertIn('AIM-LEFT-BEFORE', self._codes({}))

    def test_invalid_value_is_400(self):
        for bad in ('2026', '2026-13', 'abc', '2026-03-01'):
            res = self.client.get('/api-hrm/employees/', {'active_in_month': bad})
            self.assertEqual(res.status_code, 400, bad)
