from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Employee, EmployeeDependent
from hrm.finalization_views import _get_dependent_record_counts


def _employee(username, code):
    user = User.objects.create_user(username=username, password='x')
    return Employee.objects.create(
        user=user, employee_id=code, full_name=f'NV {code}',
        is_active=True, employment_status='ACTIVE',
    )


class EmployeeDependentApiTests(TestCase):
    url = '/api-hrm/employee-dependents/'

    def setUp(self):
        self.admin = User.objects.create_superuser('dep-admin', 'a@example.com', 'x')
        self.staff_emp = _employee('dep-staff', 'NV90001')
        self.other_emp = _employee('dep-other', 'NV90002')
        self.client = APIClient()

    def _create(self, employee, **extra):
        data = {'full_name': 'Người A', 'relationship': 'CHILD', **extra}
        return EmployeeDependent.objects.create(employee=employee, **data)

    def test_admin_creates_dependent(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(self.url, {
            'employee_id': self.staff_emp.id, 'full_name': 'Con 1', 'relationship': 'CHILD',
            'dependent_from': '2026-01-01', 'notes': 'ghi chú',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['relationship_display'], 'Con')
        self.assertEqual(res.data['notes'], 'ghi chú')
        self.assertEqual(self.staff_emp.dependents.count(), 1)

    def test_rejects_end_before_start(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(self.url, {
            'employee_id': self.staff_emp.id, 'full_name': 'Con 1',
            'dependent_from': '2026-05-01', 'dependent_to': '2026-04-01',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('dependent_to', res.data)

    def test_staff_cannot_write(self):
        self.client.force_authenticate(self.staff_emp.user)
        res = self.client.post(self.url, {
            'employee_id': self.staff_emp.id, 'full_name': 'Con 1',
        }, format='json')
        self.assertEqual(res.status_code, 403)

    def test_staff_only_sees_own_dependents(self):
        own = self._create(self.staff_emp)
        self._create(self.other_emp)
        self.client.force_authenticate(self.staff_emp.user)
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        ids = [row['id'] for row in res.data['results']]
        self.assertEqual(ids, [own.id])

    def test_delete_is_soft(self):
        dep = self._create(self.staff_emp)
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f'{self.url}{dep.id}/')
        self.assertEqual(res.status_code, 204)
        dep.refresh_from_db()
        self.assertTrue(dep.is_deleted)
        self.assertEqual(dep.deleted_by, self.admin)
        res = self.client.get(self.url)
        self.assertEqual(res.data['count'], 0)


class DependentRecordCountTests(TestCase):
    period = (date(2026, 3, 1), date(2026, 3, 31))

    def setUp(self):
        self.emp = _employee('dep-count', 'NV90010')
        self.no_records = _employee('dep-none', 'NV90011')

    def _add(self, **kwargs):
        return EmployeeDependent.objects.create(employee=self.emp, full_name='X', **kwargs)

    def test_employee_without_records_is_absent(self):
        """NV chưa có hồ sơ nào: không có khoá, bảng lương giữ số khai trong cấu hình."""
        counts = _get_dependent_record_counts([self.emp.id, self.no_records.id], *self.period)
        self.assertNotIn(self.no_records.id, counts)

    def test_counts_only_records_covering_period(self):
        self._add()                                                     # không giới hạn ngày
        self._add(dependent_from=date(2026, 3, 15))                     # bắt đầu giữa kỳ
        self._add(dependent_to=date(2026, 2, 28))                       # hết trước kỳ
        self._add(dependent_from=date(2026, 4, 1))                      # bắt đầu sau kỳ
        self._add(is_active=False)                                      # ngừng hiệu lực
        self._add(is_deleted=True)                                      # đã xoá
        counts = _get_dependent_record_counts([self.emp.id], *self.period)
        self.assertEqual(counts[self.emp.id], 2)

    def test_records_outside_period_give_zero(self):
        self._add(dependent_to=date(2026, 1, 31))
        counts = _get_dependent_record_counts([self.emp.id], *self.period)
        self.assertEqual(counts[self.emp.id], 0)

    def test_only_deleted_records_count_as_no_records(self):
        self._add(is_deleted=True)
        counts = _get_dependent_record_counts([self.emp.id], *self.period)
        self.assertNotIn(self.emp.id, counts)
