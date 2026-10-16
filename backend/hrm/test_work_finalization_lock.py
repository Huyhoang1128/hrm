"""Khoá số công sửa tay: chốt công lại bỏ qua bản ghi đã khoá; PATCH khoá/mở khoá;
DELETE; quyền xem/sửa bản ghi chốt công."""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.finalization_views import locked_finalizations
from hrm.models import WorkFinalization

Y, M = 2026, 8


class WorkFinalizationLockTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='KD', name='Kinh doanh')
        self.hr = Employee.objects.create(user=User.objects.create_user('wf-hr', password='x'),
                                          employee_id='NV96001', full_name='HCNS', is_hr=True)
        self.mgr = Employee.objects.create(user=User.objects.create_user('wf-mgr', password='x'),
                                           employee_id='NV96002', full_name='Quản lý')
        self.emp = Employee.objects.create(user=User.objects.create_user('wf-nv', password='x'),
                                           employee_id='NV96003', full_name='Nhân viên',
                                           department=self.dept, manager=self.mgr, is_active=True)
        self.other = Employee.objects.create(user=User.objects.create_user('wf-other', password='x'),
                                             employee_id='NV96004', full_name='Người khác')
        self.rec = WorkFinalization.objects.create(
            employee=self.emp, employee_code=self.emp.employee_id, ho_va_ten=self.emp.full_name,
            year=Y, month=M, tong_cong=Decimal('26'))
        self.url = f'/api-hrm/work-finalization/{self.emp.employee_id}/{Y}/{M}/'

    def test_patch_edits_and_locks_in_one_request(self):
        self.client.force_authenticate(self.hr.user)
        res = self.client.patch(self.url, {'tong_cong': '0', 'is_locked': True, 'lock_note': 'Thoả thuận riêng'},
                                format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.rec.refresh_from_db()
        self.assertEqual(self.rec.tong_cong, 0)
        self.assertTrue(self.rec.is_locked)
        self.assertEqual(self.rec.lock_note, 'Thoả thuận riêng')
        self.assertEqual(self.rec.locked_by, self.hr)
        self.assertIsNotNone(self.rec.locked_at)
        self.assertEqual(res.data['locked_by'], 'HCNS')

        res = self.client.patch(self.url, {'is_locked': False}, format='json')
        self.rec.refresh_from_db()
        self.assertFalse(self.rec.is_locked)
        self.assertIsNone(self.rec.locked_by)

    def test_locked_record_skipped_by_finalize_department(self):
        self.rec.is_locked = True
        self.rec.lock_note = 'đã chốt tay'
        self.rec.save()
        self.assertIn(self.emp.pk, locked_finalizations(Y, M))
        self.client.force_authenticate(self.hr.user)
        with patch('hrm.finalization_views._build_finalization_record') as build, \
                patch('hrm.finalization_views.require_both_halves_locked', return_value=(True, None)):
            res = self.client.post('/api-hrm/work-finalization/finalize-department/',
                                   {'year': Y, 'month': M, 'department_id': self.dept.pk}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        build.assert_not_called()
        self.assertEqual(res.data['total_skipped_locked'], 1)
        self.assertEqual(res.data['skipped_locked'][0]['lock_note'], 'đã chốt tay')
        self.rec.refresh_from_db()
        self.assertEqual(self.rec.tong_cong, Decimal('26'))

    def test_only_hr_can_patch_or_delete(self):
        for user in (self.emp.user, self.mgr.user, self.other.user):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.patch(self.url, {'tong_cong': '1'}, format='json').status_code, 403)
            self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.rec.refresh_from_db()
        self.assertEqual(self.rec.tong_cong, Decimal('26'))

    def test_get_visible_to_owner_manager_and_hr_only(self):
        for user, code in ((self.emp.user, 200), (self.mgr.user, 200), (self.hr.user, 200), (self.other.user, 403)):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(self.url).status_code, code, user.username)

    def test_delete(self):
        self.client.force_authenticate(self.hr.user)
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(WorkFinalization.objects.filter(pk=self.rec.pk).exists())
        self.assertEqual(self.client.delete(self.url).status_code, 404)

    def test_records_only_list_for_hr(self):
        self.client.force_authenticate(self.hr.user)
        res = self.client.get('/api-hrm/work-finalization/', {'year': Y, 'month': M, 'records_only': 'true',
                                                               'search': 'NV96003'})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual([r['ma_nv'] for r in res.data['results']], ['NV96003'])
        self.assertIn('is_locked', res.data['results'][0])
        self.client.force_authenticate(self.mgr.user)
        res = self.client.get('/api-hrm/work-finalization/', {'year': Y, 'month': M, 'records_only': 'true'})
        self.assertEqual(res.status_code, 403)
