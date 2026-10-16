"""Xuất toàn bộ nhân viên (export-all) mở cho Admin/HCNS, nhân viên thường bị chặn."""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee


class ExportAllPermissionTests(APITestCase):
    url = '/api-hrm/employees/export-all/'

    def setUp(self):
        self.hr = Employee.objects.create(user=User.objects.create_user('ex-hr', password='x'),
                                          employee_id='NV97001', full_name='HCNS', is_hr=True)
        self.staff = Employee.objects.create(user=User.objects.create_user('ex-nv', password='x'),
                                             employee_id='NV97002', full_name='Nhân viên')

    def test_hr_can_export(self):
        self.client.force_authenticate(self.hr.user)
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['count'], 2)

    def test_staff_cannot_export(self):
        self.client.force_authenticate(self.staff.user)
        self.assertEqual(self.client.get(self.url).status_code, 403)
