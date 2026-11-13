"""Số ngày mỗi buổi làm online tính vào hạn mức, theo từng ngày của tháng (stats_utils.
online_quota_cost_for_month, trả trong GET /api-hrm/attendance-explanations/stats/ là
`online_quota_cost_by_date`).

Web dùng map này để khoá/mở thẻ "Làm việc online" và lọc buổi được chọn — thay cho luật tự suy
"Chủ nhật / chiều T7 tuần 2-4" ở web (bỏ sót NV/phòng ban làm chiều T7 mọi tuần, và không biết
phòng ban của NV theo từng ngày).
"""
import datetime as dt
import types

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.stats_utils import ONLINE_SESSION_DATA, online_quota_amount, online_quota_cost_for_month


def _nv(unlimited=True, dept_sat=False):
    return types.SimpleNamespace(
        department=types.SimpleNamespace(online_weekend_unlimited=unlimited,
                                         saturday_afternoon_always_workday=dept_sat),
        saturday_afternoon_always_workday=None,
    )


class OnlineQuotaCostForMonthTests(SimpleTestCase):
    def test_every_day_matches_online_quota_amount(self):
        emp = _nv()
        cost = online_quota_cost_for_month(emp, 2026, 10)
        self.assertEqual(len(cost), 31)
        for key, per_session in cost.items():
            day = dt.date.fromisoformat(key)
            for session, data in ONLINE_SESSION_DATA.items():
                self.assertEqual(per_session[session], online_quota_amount(emp, day, data), (key, session))

    def test_free_slots_of_unlimited_department(self):
        cost = online_quota_cost_for_month(_nv(), 2026, 10)
        self.assertEqual(cost['2026-10-04'], {'morning': 0.0, 'afternoon': 0.0, 'full_day': 0.0})  # Chủ nhật
        self.assertEqual(cost['2026-10-10'], {'morning': 0.5, 'afternoon': 0.0, 'full_day': 0.5})  # T7 tuần 2
        self.assertEqual(cost['2026-10-05'], {'morning': 0.5, 'afternoon': 0.5, 'full_day': 1.0})  # ngày thường

    def test_saturday_afternoon_workday_is_not_free(self):
        """Web cũ bỏ sót ngoại lệ này: phòng làm chiều T7 mọi tuần thì chiều T7 vẫn tính."""
        cost = online_quota_cost_for_month(_nv(dept_sat=True), 2026, 10)
        self.assertEqual(cost['2026-10-10']['afternoon'], 0.5)


class StatsEndpointOnlineCostTests(TestCase):
    def test_stats_returns_cost_map_for_viewer(self):
        user = User.objects.create_user(username='_olcost_emp', password='x')
        Employee.objects.create(user=user, employee_id='OLCOST-1', full_name='NV Test')
        client = APIClient()
        client.force_authenticate(user)
        res = client.get('/api-hrm/attendance-explanations/stats/', {'month': 2, 'year': 2026})
        self.assertEqual(res.status_code, 200, res.content)
        cost = res.json()['statistics']['online_quota_cost_by_date']
        self.assertEqual(len(cost), 28)
        self.assertEqual(cost['2026-02-02'], {'morning': 0.5, 'afternoon': 0.5, 'full_day': 1.0})
