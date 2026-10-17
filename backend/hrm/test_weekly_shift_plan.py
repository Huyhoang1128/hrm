"""Kế hoạch ca theo tuần (hrm/shift_plan_views.py)."""
import datetime as dt

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.models import ShiftConfig
from hrm.shift_config_utils import get_registered_shift_configs_for_date
from hrm.shift_plan_models import WeeklyShiftPlan, WeeklyShiftPlanLock

URL = '/api-hrm/weekly-shift-plans/'


def _monday(weeks_ahead=1):
    today = timezone.localdate()
    return today - dt.timedelta(days=today.weekday()) + dt.timedelta(weeks=weeks_ahead)


class WeeklyShiftPlanTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='WP', name='Phòng WP')
        self.morning = self._shift('WP_SANG', '08:00', '12:00')
        self.afternoon = self._shift('WP_CHIEU', '13:00', '17:00')
        self.manager = self._emp('NV00441')
        self.hr = self._emp('NV00442', is_hr=True)
        self.emp = self._emp('NV00443', manager=self.manager)
        self.admin = User.objects.create_superuser('wp-admin', 'a@example.com', 'x')
        self.week = _monday()

    def _shift(self, code, start, end):
        return ShiftConfig.objects.create(name=code, code=code, start_time=dt.time.fromisoformat(start),
                                          end_time=dt.time.fromisoformat(end),
                                          effective_from=dt.date(2025, 1, 1))

    def _emp(self, code, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE', **kw)

    def _as(self, who):
        self.client.force_authenticate(who if isinstance(who, User) else who.user)

    def _create(self, days=None):
        days = days if days is not None else [
            {'date': self.week.isoformat(), 'shift': self.morning.id, 'shift_2': self.afternoon.id},
            {'date': (self.week + dt.timedelta(days=1)).isoformat(), 'shift': None},
        ]
        return self.client.post(URL, {'week_start_date': self.week.isoformat(), 'days': days}, format='json')

    def test_two_step_flow(self):
        self._as(self.emp)
        res = self._create()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['status'], 'DRAFT')
        plan_id = res.data['id']
        self.assertEqual(self._create().status_code, 400)   # trùng tuần
        self.assertEqual(self.client.post(f'{URL}{plan_id}/submit/').data['status'], 'PENDING')
        self.assertEqual(self.client.patch(f'{URL}{plan_id}/', {'days': []}, format='json').status_code, 400)

        self._as(self.hr)   # HCNS trước quản lý → chặn
        self.assertEqual(self.client.post(f'{URL}{plan_id}/approve/').status_code, 403)
        self._as(self.manager)
        res = self.client.post(f'{URL}{plan_id}/approve/')
        self.assertEqual((res.data['status'], res.data['direct_manager_approved']), ('PENDING', True))
        # Đã duyệt bước 1 → quản lý không duyệt lại, danh sách chờ duyệt báo chưa duyệt được
        self.assertEqual(self.client.post(f'{URL}{plan_id}/approve/').status_code, 400)
        self.assertFalse(self.client.get(f'{URL}pending-approvals/').data[0]['can_approve_now'])
        # Chưa duyệt xong → engine chưa dùng kế hoạch
        self.assertIsNone(get_registered_shift_configs_for_date(self.emp, self.week))
        self._as(self.hr)
        self.assertEqual(self.client.post(f'{URL}{plan_id}/approve/').data['status'], 'APPROVED')

        self.assertEqual(get_registered_shift_configs_for_date(self.emp, self.week), [self.morning, self.afternoon])
        self.assertEqual(get_registered_shift_configs_for_date(self.emp, self.week + dt.timedelta(days=1)), [])
        self.assertIsNone(get_registered_shift_configs_for_date(self.emp, self.week + dt.timedelta(days=2)))
        cache = {}
        get_registered_shift_configs_for_date(self.emp, self.week, cache)
        with self.assertNumQueries(0):
            get_registered_shift_configs_for_date(self.emp, self.week + dt.timedelta(days=1), cache)

    def test_reject_resubmit_admin_and_bulk(self):
        self._as(self.emp)
        plan_id = self._create().data['id']
        self.client.post(f'{URL}{plan_id}/submit/')
        self._as(self.manager)
        self.assertEqual(self.client.post(f'{URL}{plan_id}/reject/', {}, format='json').status_code, 400)
        res = self.client.post(f'{URL}{plan_id}/reject/', {'reject_reason': 'Thiếu người ca chiều'}, format='json')
        self.assertEqual(res.data['status'], 'REJECTED')
        self._as(self.emp)
        res = self.client.patch(f'{URL}{plan_id}/', {'days': [{'date': self.week.isoformat(), 'shift': self.morning.id}]},
                                format='json')
        self.assertEqual(res.data['status'], 'DRAFT')
        self.client.post(f'{URL}{plan_id}/submit/')
        self._as(self.admin)
        pending = self.client.get(f'{URL}pending-approvals/').data
        self.assertEqual([p['id'] for p in pending], [plan_id])
        self.assertTrue(pending[0]['can_approve_now'])
        res = self.client.post(f'{URL}bulk-approve/', {'ids': [plan_id]}, format='json')
        self.assertEqual(res.data['success_count'], 1)
        self.assertEqual(WeeklyShiftPlan.objects.get(pk=plan_id).status, 'APPROVED')

    def test_validation_and_lock(self):
        self._as(self.emp)
        bad_week = self.client.post(URL, {'week_start_date': (self.week + dt.timedelta(days=1)).isoformat(),
                                          'days': []}, format='json')
        self.assertEqual(bad_week.status_code, 400)
        outside = self._create([{'date': (self.week + dt.timedelta(days=7)).isoformat(), 'shift': self.morning.id}])
        self.assertEqual(outside.status_code, 400)
        overlap = self._create([{'date': self.week.isoformat(), 'shift': self.morning.id, 'shift_2': self.morning.id}])
        self.assertEqual(overlap.status_code, 400)

        self._as(self.hr)
        self.assertEqual(self.client.post(f'{URL}lock-toggle/', {'is_locked': True}, format='json').data['is_locked'], True)
        self._as(self.emp)
        self.assertEqual(self._create().status_code, 423)
        self._as(self.admin)
        self.assertEqual(self._create().status_code, 423)   # khoá áp cho mọi người
        self._as(self.emp)
        self.assertEqual(self.client.post(f'{URL}lock-toggle/', {'is_locked': False}, format='json').status_code, 403)
        WeeklyShiftPlanLock.objects.update(is_locked=False)
        self.assertEqual(self._create().status_code, 201)

    def test_upload_and_export(self):
        self._as(self.hr)
        day1, day2 = self.week.strftime('%d/%m/%Y'), (self.week + dt.timedelta(days=1)).strftime('%d/%m/%Y')
        csv = ('Mã NV,Ngày,Mã ca\n'
               f'NV00443,{day1},WP_SANG + WP_CHIEU\n'
               f'NV00443,{day2},\n'
               f'NV00443,{day2},WP_SANG\n'
               f'NV00999,{day1},WP_SANG\n'
               f'NV00443,32/13/2026,WP_SANG\n'
               f'NV00443,{day1},KHONG_CO\n')
        res = self.client.post(f'{URL}upload/', {'file': SimpleUploadedFile('ca.csv', csv.encode('utf-8'))},
                               format='multipart')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual((res.data['imported_days'], res.data['created_plans']), (2, 1))
        self.assertEqual(len(res.data['failed']), 3)
        self.assertEqual(len(res.data['warnings']), 1)
        plan = WeeklyShiftPlan.objects.get(employee=self.emp)
        self.assertEqual((plan.status, plan.source), ('APPROVED', 'UPLOAD'))
        self.assertEqual(get_registered_shift_configs_for_date(self.emp, self.week + dt.timedelta(days=1)), [self.morning])

        res = self.client.get(f'{URL}export-monthly/', {'year': self.week.year, 'month': self.week.month})
        self.assertEqual(res.status_code, 200)
        self.assertIn('spreadsheetml', res['Content-Type'])
        self.assertEqual(self.client.get(f'{URL}upload-template/').status_code, 200)

        self._as(self.emp)
        self.assertEqual(self.client.post(f'{URL}upload/', {'file': SimpleUploadedFile('ca.csv', b'x')},
                                          format='multipart').status_code, 403)
