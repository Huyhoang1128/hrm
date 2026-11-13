"""bulk_approve dry_run của đơn Nghỉ phép tháng / Làm việc online.

Trang Phê duyệt trước đây tự xếp đơn (FCFS theo created_at) và tự tính hạn mức (`?? 1` / `?? 3`)
để dựng hộp xác nhận duyệt hàng loạt — lệch với backend (xét đơn theo ngày, hạn mức theo người).
Nay web hỏi backend bằng dry_run=true: chạy đúng vòng duyệt + hạn mức nhưng KHÔNG lưu gì.
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.models import CompanyConfig


class BulkApproveDryRunTests(TestCase):
    def setUp(self):
        CompanyConfig.objects.create(
            name='Cfg', code='CFG-DRY', effective_from=datetime.date(2020, 1, 1),
            max_leave_count_per_month=1, max_online_work_count_per_month=1,
        )
        admin = User.objects.create_user(username='_dry_admin', password='x', is_staff=True, is_superuser=True)
        Employee.objects.create(user=admin, employee_id='DRY-ADMIN', full_name='Admin')
        user = User.objects.create_user(username='_dry_emp', password='x')
        self.employee = Employee.objects.create(user=user, employee_id='DRY-1', full_name='NV Test')
        self.client = APIClient()
        self.client.force_authenticate(admin)

    def _leave(self, day):
        return EmployeeEvent.objects.create(
            employee=self.employee, event_date=datetime.date(2026, 10, day),
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data={'explanation_type': 'LEAVE', 'status': 'PENDING', 'expected_status': 'ABSENT', 'reason': 'x'},
        )

    def _online(self, day):
        return EmployeeEvent.objects.create(
            employee=self.employee, event_date=datetime.date(2026, 10, day),
            event_type=EmployeeEvent.EventType.ONLINE_WORK,
            data={'status': 'PENDING', 'expected_status': 'PRESENT', 'reason': 'x'},
        )

    def _assert_nothing_saved(self, events):
        for ev in events:
            ev.refresh_from_db()
            self.assertEqual(ev.data['status'], 'PENDING')
        self.assertFalse(EmployeeEvent.objects.filter(reference_event__in=events).exists())

    def test_leave_preview_matches_quota_and_saves_nothing(self):
        first, second = self._leave(5), self._leave(6)
        res = self.client.post('/api-hrm/monthly-leave-requests/bulk_approve/',
                               {'ids': [second.id, first.id], 'dry_run': True}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertTrue(data['dry_run'])
        # Backend xét theo ngày nghỉ: đơn ngày 5 dùng hết 1 ngày phép, đơn ngày 6 vượt hạn mức.
        self.assertEqual(data['approved'], [first.id])
        self.assertEqual([r['id'] for r in data['rejected']], [second.id])
        self._assert_nothing_saved([first, second])

    def test_online_preview_matches_quota_and_saves_nothing(self):
        first, second = self._online(5), self._online(6)
        res = self.client.post('/api-hrm/online-work-requests/bulk_approve/',
                               {'ids': [first.id, second.id], 'dry_run': True}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual(data['approved'], [first.id])
        self.assertEqual([r['id'] for r in data['rejected']], [second.id])
        self._assert_nothing_saved([first, second])

    def test_real_run_still_approves_and_rejects(self):
        first, second = self._leave(5), self._leave(6)
        res = self.client.post('/api-hrm/monthly-leave-requests/bulk_approve/',
                               {'ids': [first.id, second.id]}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.data['status'], 'APPROVED')
        self.assertEqual(second.data['status'], 'REJECTED')

    def test_remaining_quota_uses_company_config(self):
        """remaining_quota trước đây ghi cứng 1.0 — nay theo đúng hạn mức bulk_approve dùng."""
        CompanyConfig.objects.update(max_leave_count_per_month=2.5)
        self.client.force_authenticate(self.employee.user)
        res = self.client.get('/api-hrm/monthly-leave-requests/remaining_quota/', {'month': 10, 'year': 2026})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['total_quota'], 2.5)
        self.assertEqual(res.json()['remaining'], 2.5)
