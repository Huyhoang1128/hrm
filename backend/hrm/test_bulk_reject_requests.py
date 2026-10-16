"""Từ chối hàng loạt (bulk_reject) cho giải trình, nghỉ phép tháng, đơn đăng ký và
đơn làm online — gọi lại reject() đơn lẻ cho từng đơn đang PENDING."""
import datetime as dt

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.constant import ExplanationType
from hrm.event_models import EmployeeEvent

DAY = dt.date(2026, 9, 26)
ET = EmployeeEvent.EventType


class BulkRejectTests(APITestCase):
    def setUp(self):
        self.manager = Employee.objects.create(
            user=User.objects.create_user('br-mgr', password='x'), employee_id='NV95001', full_name='Quản lý')
        self.staff = Employee.objects.create(
            user=User.objects.create_user('br-nv', password='x'), employee_id='NV95002', full_name='Nhân viên',
            manager=self.manager)
        self.other_staff = Employee.objects.create(
            user=User.objects.create_user('br-nv2', password='x'), employee_id='NV95003', full_name='NV phòng khác')
        self.client.force_authenticate(self.manager.user)

    def _event(self, event_type, employee=None, status='PENDING', **data):
        return EmployeeEvent.objects.create(
            employee=employee or self.staff, event_date=DAY, event_type=event_type,
            data={'status': status, **data})

    def _bulk(self, path, ids):
        return self.client.post(f'/api-hrm/{path}/bulk_reject/', {'ids': ids, 'approval_note': 'Từ chối nhanh'},
                                format='json')

    def _status(self, event):
        event.refresh_from_db()
        return event.data['status']

    def test_explanations_only_pending_are_rejected(self):
        pending = self._event(ET.EXPLANATION, explanation_type=ExplanationType.LATE)
        approved = self._event(ET.EXPLANATION, status='APPROVED', explanation_type=ExplanationType.LATE)
        res = self._bulk('attendance-explanations', [pending.id, approved.id, 999999])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['results'], [pending.id])
        self.assertEqual(res.data['error_count'], 2)
        self.assertEqual(self._status(pending), 'REJECTED')
        self.assertEqual(self._status(approved), 'APPROVED')
        self.assertEqual(pending.data.get('approval_note'), 'Từ chối nhanh')

    def test_monthly_leave_inherits_bulk_reject(self):
        leave = self._event(ET.EXPLANATION, explanation_type=ExplanationType.LEAVE)
        res = self._bulk('monthly-leave-requests', [leave.id])
        self.assertEqual(res.data['success_count'], 1)
        self.assertEqual(self._status(leave), 'REJECTED')

    def test_registration_and_online_work(self):
        reg = self._event(ET.OVERTIME, registration_type='OVERTIME')
        online = self._event(ET.ONLINE_WORK)
        self.assertEqual(self._bulk('registration-requests', [reg.id]).data['success_count'], 1)
        self.assertEqual(self._bulk('online-work-requests', [online.id]).data['success_count'], 1)
        self.assertEqual(self._status(reg), 'REJECTED')
        self.assertEqual(self._status(online), 'REJECTED')

    def test_no_permission_for_other_teams_requests(self):
        foreign = self._event(ET.ONLINE_WORK, employee=self.other_staff)
        res = self._bulk('online-work-requests', [foreign.id])
        self.assertEqual(res.data['success_count'], 0)
        self.assertEqual(res.data['errors'][0]['id'], foreign.id)
        self.assertEqual(self._status(foreign), 'PENDING')

    def test_empty_ids_rejected(self):
        res = self.client.post('/api-hrm/registration-requests/bulk_reject/', {'ids': []}, format='json')
        self.assertEqual(res.status_code, 400)
