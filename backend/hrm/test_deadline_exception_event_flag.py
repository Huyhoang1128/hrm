"""
Cờ "Mở khoá đặc biệt" trên đơn (yêu cầu HCNS 2026-10-02): khi rà soát hạn,
HCNS cần phân biệt đơn quá hạn được tạo/duyệt nhờ HCNS/Admin mở đột xuất ở
trang Quản lý công với đơn lọt hạn do lỗi hệ thống. Thu hồi lượt mở khoá phải
giữ lại lịch sử, nếu không đơn đã dùng nó sẽ trông như lọt hạn do lỗi.
"""
import datetime as dt

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.deadline_exception_models import DeadlineExceptionGrant, has_deadline_exception
from hrm.event_models import EmployeeEvent

DAY = dt.date(2026, 9, 26)


class DeadlineExceptionEventFlagTests(APITestCase):
    def setUp(self):
        self.hr_user = User.objects.create_user(username='dex-hr', password='x')
        self.hr = Employee.objects.create(user=self.hr_user, employee_id='DEX-HR', full_name='HCNS', is_hr=True)
        self.staff = Employee.objects.create(
            user=User.objects.create_user(username='dex-nv', password='x'),
            employee_id='DEX-NV', full_name='Nhân viên',
        )
        self.client.force_authenticate(self.hr_user)
        self.t0 = timezone.now() - dt.timedelta(days=3)

    def _grant(self, request_type='OVERTIME', at=None, revoked_at=None):
        g = DeadlineExceptionGrant.objects.create(
            employee=self.staff, event_date=DAY, request_type=request_type, granted_by=self.hr, note='ca mổ gấp',
        )
        DeadlineExceptionGrant.objects.filter(pk=g.pk).update(created_at=at or self.t0, revoked_at=revoked_at)
        return g

    def _event(self, created_at, status_='PENDING', reg_type='OVERTIME', updated_at=None):
        ev = EmployeeEvent.objects.create(
            employee=self.staff, event_date=DAY, event_type=EmployeeEvent.EventType.OVERTIME,
            data={'status': status_, 'registration_type': reg_type},
        )
        EmployeeEvent.objects.filter(pk=ev.pk).update(created_at=created_at, updated_at=updated_at or created_at)
        return ev

    def _flags(self, *events):
        ids = ','.join(str(e.id) for e in events)
        response = self.client.get('/api-hrm/deadline-exceptions/for-events/', {'ids': ids})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_grant_before_creation_is_flagged(self):
        self._grant(at=self.t0)
        ev = self._event(created_at=self.t0 + dt.timedelta(minutes=11))
        flags = self._flags(ev)[str(ev.id)]
        self.assertEqual(len(flags), 1)
        self.assertTrue(flags[0]['granted_before_created'])
        self.assertEqual(flags[0]['note'], 'ca mổ gấp')

    def test_grant_after_creation_but_before_approval_is_flagged_for_approval(self):
        ev = self._event(
            created_at=self.t0, status_='APPROVED', updated_at=self.t0 + dt.timedelta(days=1),
        )
        self._grant(at=self.t0 + dt.timedelta(hours=2))
        flags = self._flags(ev)[str(ev.id)]
        self.assertFalse(flags[0]['granted_before_created'])

    def test_unrelated_or_late_grants_are_not_flagged(self):
        approved = self._event(created_at=self.t0, status_='APPROVED', updated_at=self.t0 + dt.timedelta(hours=1))
        self._grant(at=self.t0 + dt.timedelta(days=1))           # mở SAU khi đơn đã xử lý xong
        self._grant(request_type='LEAVE', at=self.t0 - dt.timedelta(hours=1))  # sai loại đơn
        self.assertEqual(self._flags(approved), {})

    def test_revoked_grant_keeps_history_and_still_flags_events_it_served(self):
        g = self._grant(at=self.t0)
        ev = self._event(created_at=self.t0 + dt.timedelta(minutes=5))

        response = self.client.delete(f'/api-hrm/deadline-exceptions/{g.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        g.refresh_from_db()
        self.assertIsNotNone(g.revoked_at)
        self.assertEqual(g.revoked_by, self.hr)
        self.assertFalse(has_deadline_exception(self.staff, DAY, 'OVERTIME'))
        self.assertIn(str(ev.id), self._flags(ev))

        # Đơn tạo SAU khi đã thu hồi thì không được gắn cờ.
        later = self._event(created_at=timezone.now() + dt.timedelta(minutes=1))
        self.assertNotIn(str(later.id), self._flags(later))

    def test_can_grant_again_after_revoke(self):
        g = self._grant()
        self.client.delete(f'/api-hrm/deadline-exceptions/{g.id}/')
        response = self.client.post('/api-hrm/deadline-exceptions/', {
            'employee_id': self.staff.id, 'event_date': DAY.isoformat(), 'request_type': 'OVERTIME',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(has_deadline_exception(self.staff, DAY, 'OVERTIME'))
        self.assertEqual(DeadlineExceptionGrant.objects.filter(employee=self.staff).count(), 2)

    def test_staff_cannot_query_flags(self):
        ev = self._event(created_at=self.t0)
        self.client.force_authenticate(self.staff.user)
        response = self.client.get('/api-hrm/deadline-exceptions/for-events/', {'ids': str(ev.id)})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
