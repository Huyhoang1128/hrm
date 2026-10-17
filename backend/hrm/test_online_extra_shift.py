"""Ca online cộng thêm trong kế hoạch ca tuần (hrm/online_shift.py)."""
import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.attendance_views import AttendanceCalendarView
from hrm.main_api import EmployeeState
from hrm.models import ShiftConfig
from hrm.shift_config_utils import (get_all_candidate_shifts_for_employee, get_registered_shift_configs_for_date,
                                    load_shift_configs_for_employee)
from hrm.shift_plan_models import WeeklyShiftPlan, WeeklyShiftPlanDay

URL = '/api-hrm/weekly-shift-plans/'
PAST_MONDAY = dt.date(2026, 9, 7)


def _monday(weeks_ahead=1):
    today = timezone.localdate()
    return today - dt.timedelta(days=today.weekday()) + dt.timedelta(weeks=weeks_ahead)


class OnlineExtraShiftTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='ONL', name='Phòng ONL')
        self.morning = self._shift('ONL_SANG', '08:00', '12:00')
        self.online = self._shift('ONL_TOI', '18:00', '21:00', no_attendance_required=True, shift_type='EVENING')
        self.emp = Employee.objects.create(
            user=User.objects.create_user('nv00451', password='x'), employee_id='NV00451', full_name='NV ONL',
            department=self.dept, start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE')
        self.hr = Employee.objects.create(
            user=User.objects.create_user('nv00452', password='x'), employee_id='NV00452', full_name='HR ONL',
            department=self.dept, start_date=dt.date(2025, 1, 1), is_active=True, employment_status='ACTIVE',
            is_hr=True)

    def _shift(self, code, start, end, **kw):
        return ShiftConfig.objects.create(name=code, code=code, start_time=dt.time.fromisoformat(start),
                                          end_time=dt.time.fromisoformat(end), effective_from=dt.date(2025, 1, 1), **kw)

    def _plan(self, status, days):
        plan = WeeklyShiftPlan.objects.create(employee=self.emp, week_start_date=PAST_MONDAY,
                                              week_end_date=PAST_MONDAY + dt.timedelta(days=6), status=status)
        for offset, shift, extra in days:
            WeeklyShiftPlanDay.objects.create(plan=plan, date=PAST_MONDAY + dt.timedelta(days=offset),
                                              shift=shift, extra_shift=extra)
        return plan

    def _credits(self):
        return EmployeeState.replay_month('NV00451', PAST_MONDAY.year, PAST_MONDAY.month)['state']['tong_ngay_cong']

    def test_plan_validation(self):
        self.client.force_authenticate(self.emp.user)
        week = _monday()

        def create(day):
            return self.client.post(URL, {'week_start_date': week.isoformat(),
                                          'days': [{'date': week.isoformat(), **day}]}, format='json')

        self.assertEqual(create({'shift': self.online.id}).status_code, 400)          # ca online ở ô ca chính
        self.assertEqual(create({'shift': self.morning.id, 'extra_shift': self.morning.id}).status_code, 400)
        res = create({'shift': self.morning.id, 'extra_shift': self.online.id})
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['days'][0]['extra_shift_detail']['code'], 'ONL_TOI')
        # Ca online không đổi ca chấm công của ngày
        plan = WeeklyShiftPlan.objects.get(pk=res.data['id'])
        plan.status = WeeklyShiftPlan.Status.APPROVED
        plan.save()
        self.assertEqual(get_registered_shift_configs_for_date(self.emp, week), [self.morning])

    def test_engine_adds_online_credit_after_approval(self):
        plan = self._plan(WeeklyShiftPlan.Status.PENDING, [(0, None, self.online), (1, self.morning, self.online)])
        self.assertEqual(self._credits(), 0)        # chưa duyệt → chưa cộng
        plan.status = WeeklyShiftPlan.Status.APPROVED
        plan.save()
        self.assertEqual(self._credits(), 1.0)      # 2 ngày × 0,5 (không chấm công ca chính)
        self.online.fixed_workday = Decimal('1.0')
        self.online.save()
        self.assertEqual(self._credits(), 2.0)

    def test_online_shift_never_matches_attendance(self):
        self.online.is_default = True
        self.online.save()
        self.online.apply_to_departments.add(self.dept)
        self.assertNotIn(self.online, load_shift_configs_for_employee('NV00451', PAST_MONDAY))
        self.assertNotIn(self.online, get_all_candidate_shifts_for_employee('NV00451', PAST_MONDAY))

    def test_upload_and_export_with_online_shift(self):
        self.client.force_authenticate(self.hr.user)
        week = _monday()
        day1, day2 = week.strftime('%d/%m/%Y'), (week + dt.timedelta(days=1)).strftime('%d/%m/%Y')
        csv = ('Mã NV,Ngày,Mã ca\n'
               f'NV00451,{day1},ONL_SANG + ONL_TOI\n'
               f'NV00451,{day2},ONL_TOI\n'
               f'NV00451,{day2},ONL_TOI + ONL_TOI\n')
        res = self.client.post(f'{URL}upload/', {'file': SimpleUploadedFile('ca.csv', csv.encode('utf-8'))},
                               format='multipart')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual((res.data['imported_days'], len(res.data['failed'])), (2, 1))
        days = {d.date: d for d in WeeklyShiftPlanDay.objects.filter(plan__employee=self.emp)}
        self.assertEqual((days[week].shift, days[week].extra_shift), (self.morning, self.online))
        self.assertEqual((days[week + dt.timedelta(days=1)].shift, days[week + dt.timedelta(days=1)].extra_shift),
                         (None, self.online))
        res = self.client.get(f'{URL}export-monthly/', {'year': week.year, 'month': week.month})
        self.assertEqual(res.status_code, 200)

    def test_calendar_badge(self):
        status = AttendanceCalendarView._day_status_from_events_data
        self.assertEqual(status({'nua_ngay_cong': 1.5}, {'cong_ca_online': 0.5}, [], {}, PAST_MONDAY),
                         ('FULL', 'Có mặt + ca online'))
        self.assertEqual(status({'nua_ngay_cong': 0.5}, {'cong_ca_online': 0.5}, [], {}, PAST_MONDAY),
                         ('HALF', 'Ca online'))
        self.assertEqual(status({'nua_ngay_cong': 1.0}, {'cong_ca_online': 0.5}, [], {}, PAST_MONDAY),
                         ('FULL', 'Nửa công + ca online'))
