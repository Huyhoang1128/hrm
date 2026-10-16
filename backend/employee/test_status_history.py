import datetime as dt

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee, EmployeeStatusHistory, compute_effective_employment_status


class EmployeeStatusHistoryTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='SH', name='Phòng SH')
        self.hr = self._emp('NV00501', is_hr=True)

    def _emp(self, code, start=dt.date(2026, 1, 1), end=None, status='ACTIVE', **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, start_date=start, end_date=end, employment_status=status, is_active=True, **kw)

    def _log(self, emp, day, from_status, to_status):
        EmployeeStatusHistory.objects.create(employee=emp, from_status=from_status, to_status=to_status, changed_at=day)
        Employee.objects.filter(pk=emp.pk).update(employment_status=to_status)  # không sinh thêm bản ghi

    def test_logs_creation_and_status_change_with_actor(self):
        emp = self._emp('NV00502')
        self.assertEqual(list(emp.status_history.values_list('from_status', 'to_status')), [(None, 'ACTIVE')])
        self.client.force_authenticate(self.hr.user)
        res = self.client.patch(f'/api-hrm/employees/{emp.id}/', {'employment_status': 'MATERNITY_LEAVE'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        latest = emp.status_history.first()
        self.assertEqual((latest.from_status, latest.to_status, latest.changed_by), ('ACTIVE', 'MATERNITY_LEAVE', self.hr.user))
        emp.refresh_from_db()
        emp.full_name = 'Tên mới'
        emp.save()  # không đổi trạng thái → không ghi thêm
        self.assertEqual(emp.status_history.count(), 2)
        self.assertEqual(compute_effective_employment_status('MATERNITY_LEAVE', None), 'MATERNITY_LEAVE')

    def test_stats_for_a_past_month_use_status_at_that_time(self):
        maternity = self._emp('NV00503')
        self._log(maternity, dt.date(2026, 9, 10), 'ACTIVE', 'MATERNITY_LEAVE')
        self._emp('NV00504', end=dt.date(2026, 8, 15), status='INACTIVE')   # nghỉ giữa tháng 8
        self._emp('NV00505', start=dt.date(2026, 9, 5))                      # vào làm tháng 9
        self.client.force_authenticate(self.hr.user)

        def stats(month):
            res = self.client.get('/api-hrm/employees/stats/', {'month': month})
            self.assertEqual(res.status_code, 200, res.data)
            return res.data

        july, aug, sep = stats('2026-07'), stats('2026-08'), stats('2026-09')
        # HR NV00501 + NV00503 + NV00504 đang làm tháng 7
        self.assertEqual((july['active'], july['maternity_leave'], july['inactive'], july['total']), (3, 0, 0, 3))
        self.assertEqual((aug['active'], aug['maternity_leave'], aug['inactive'], aug['total']), (2, 0, 1, 3))
        self.assertEqual((sep['active'], sep['maternity_leave'], sep['inactive'], sep['total']), (2, 1, 1, 4))
        self.assertEqual(self.client.get('/api-hrm/employees/stats/', {'month': '2026-13'}).status_code, 400)

    def test_list_filter_and_status_log(self):
        maternity = self._emp('NV00506')
        self._log(maternity, dt.date(2026, 9, 10), 'ACTIVE', 'MATERNITY_LEAVE')
        self._emp('NV00507', status='SUSPENDED')
        self.client.force_authenticate(self.hr.user)

        def codes(**params):
            res = self.client.get('/api-hrm/employees/', params)
            rows = res.data['results'] if isinstance(res.data, dict) else res.data
            return sorted(r['employee_id'] for r in rows)

        self.assertEqual(codes(employment_status='MATERNITY_LEAVE'), ['NV00506'])
        self.assertEqual(codes(employment_status='SUSPENDED'), ['NV00506', 'NV00507'])  # nhóm tạm không đi làm
        self.assertNotIn('NV00506', codes(employment_status='ACTIVE'))

        log = self.client.get('/api-hrm/employees/status-log/', {'month': '2026-09'}).data
        self.assertEqual([(r['employee_code'], r['from_status_label'], r['to_status_label']) for r in log['results']],
                         [('NV00506', 'Đang làm việc', 'Nghỉ thai sản')])
        self.client.force_authenticate(maternity.user)
        self.assertEqual(self.client.get('/api-hrm/employees/status-log/').status_code, 403)
