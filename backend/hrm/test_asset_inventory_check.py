from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.models import Asset, AssetInventoryCheck


class AssetInventoryCheckApiTests(TestCase):
    url = '/api-hrm/asset-inventory-checks/'

    def setUp(self):
        self.admin = User.objects.create_superuser('inv-admin', 'a@example.com', 'x')
        self.admin_emp = Employee.objects.create(user=self.admin, employee_id='NV91000', full_name='Quản trị')
        staff_user = User.objects.create_user('inv-staff', password='x')
        self.staff = Employee.objects.create(user=staff_user, employee_id='NV91001', full_name='Nhân viên')
        self.asset = Asset.objects.create(name='MAY-01', asset_type='DESKTOP')
        self.client = APIClient()

    def test_create_defaults_created_by_to_current_employee(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(self.url, {
            'asset_id': self.asset.id, 'check_date': '2026-10-01',
            'checked_by_id': self.staff.id, 'result': 'DAMAGED', 'actual_condition': 'POOR',
            'notes': 'Vỡ màn hình',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        check = AssetInventoryCheck.objects.get(pk=res.data['id'])
        self.assertEqual(check.asset, self.asset)
        self.assertEqual(check.checked_by, self.staff)
        self.assertEqual(check.created_by, self.admin_emp)
        self.assertEqual(res.data['result_display'], 'Hư hỏng')

    def test_unknown_asset_is_rejected(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(self.url, {'asset_id': 999999, 'check_date': '2026-10-01'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('asset_id', res.data)

    def test_inventory_history_lists_newest_first(self):
        AssetInventoryCheck.objects.create(asset=self.asset, check_date='2026-01-10', result='MATCH')
        AssetInventoryCheck.objects.create(asset=self.asset, check_date='2026-06-10', result='MISSING')
        self.client.force_authenticate(self.admin)
        res = self.client.get(f'/api-hrm/assets/{self.asset.id}/inventory_history/')
        self.assertEqual(res.status_code, 200)
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        self.assertEqual([r['result'] for r in rows], ['MISSING', 'MATCH'])
