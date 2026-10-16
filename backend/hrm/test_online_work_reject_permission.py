"""Từ chối đơn làm online phải có quyền như khi duyệt: quản lý trực tiếp, HCNS/người
có quyền duyệt hoặc admin. Trước đây reject() không kiểm tra quyền — ai đăng nhập
cũng từ chối được đơn của người khác."""
import datetime as dt

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.event_models import EmployeeEvent

DAY = dt.date(2026, 9, 26)


class OnlineWorkRejectPermissionTests(APITestCase):
    def setUp(self):
        self.manager = Employee.objects.create(
            user=User.objects.create_user('ow-mgr', password='x'), employee_id='NV94001', full_name='Quản lý')
        self.staff = Employee.objects.create(
            user=User.objects.create_user('ow-nv', password='x'), employee_id='NV94002', full_name='Nhân viên',
            manager=self.manager)
        self.outsider = Employee.objects.create(
            user=User.objects.create_user('ow-other', password='x'), employee_id='NV94003', full_name='Người khác')
        self.event = EmployeeEvent.objects.create(
            employee=self.staff, event_date=DAY, event_type=EmployeeEvent.EventType.ONLINE_WORK,
            data={'status': 'PENDING'},
        )
        self.url = f'/api-hrm/online-work-requests/{self.event.id}/reject/'

    def test_unrelated_employee_cannot_reject(self):
        self.client.force_authenticate(self.outsider.user)
        res = self.client.post(self.url, {'approval_note': 'x'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.event.refresh_from_db()
        self.assertEqual(self.event.data['status'], 'PENDING')

    def test_owner_cannot_reject_own_request(self):
        self.client.force_authenticate(self.staff.user)
        res = self.client.post(self.url, {}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_direct_manager_can_reject(self):
        self.client.force_authenticate(self.manager.user)
        res = self.client.post(self.url, {'approval_note': 'Không hợp lệ'}, format='json')
        self.assertEqual(res.status_code, 200, getattr(res, 'data', None))
        self.event.refresh_from_db()
        self.assertEqual(self.event.data['status'], 'REJECTED')
