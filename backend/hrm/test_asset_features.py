"""Khấu hao, ảnh, QR, gợi ý Phân loại và file mẫu import của tài sản."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from hrm.models import Asset


class AssetDepreciationTests(TestCase):
    def _asset(self, **kw):
        return Asset.objects.create(name=kw.pop('name', 'A-1'), asset_type='LAPTOP', **kw)

    def test_no_depreciation_config_keeps_purchase_price(self):
        asset = self._asset(purchase_price=Decimal('12000000'))
        self.assertIsNone(asset.monthly_depreciation)
        self.assertEqual(asset.current_value, Decimal('12000000'))

    def test_straight_line_after_some_months(self):
        purchase = date.today().replace(day=1) - timedelta(days=1)  # cuối tháng trước
        purchase = purchase.replace(day=1)                          # đầu tháng trước
        asset = self._asset(purchase_price=Decimal('12000000'), purchase_date=purchase,
                            depreciation_period_months=12)
        self.assertEqual(asset.monthly_depreciation, Decimal('1000000'))
        self.assertEqual(asset.months_since_purchase, 1)
        self.assertEqual(asset.current_value, Decimal('11000000'))

    def test_value_never_below_zero(self):
        asset = self._asset(purchase_price=Decimal('1200'), purchase_date=date(2000, 1, 1),
                            depreciation_period_months=12)
        self.assertEqual(asset.accumulated_depreciation, Decimal('1200'))
        self.assertEqual(asset.current_value, 0)


@override_settings(FRONTEND_URL='http://hrm.local')
class AssetEndpointTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser('asset-admin', 'a@example.com', 'x')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.asset = Asset.objects.create(name='MAY-01', asset_type='DESKTOP')
        Asset.objects.create(name='GHE-01', asset_type='Ghế xoay', specifications={'quantity': 3})

    def test_qr_code_returns_png(self):
        res = self.client.get(f'/api-hrm/assets/{self.asset.id}/qr_code/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'image/png')
        self.assertTrue(res.content.startswith(b'\x89PNG'))

    def test_type_options_include_free_text_and_standard_types(self):
        res = self.client.get('/api-hrm/assets/type_options/')
        self.assertEqual(res.status_code, 200)
        by_value = {o['value']: o for o in res.data}
        self.assertEqual(by_value['Ghế xoay']['count'], 1)
        self.assertEqual(by_value['DESKTOP']['count'], 1)
        self.assertEqual(by_value['LAPTOP']['count'], 0)

    def test_free_text_type_is_multi_holder(self):
        self.assertTrue(Asset.is_multi_holder_type('Ghế xoay'))
        self.assertFalse(Asset.is_multi_holder_type('DESKTOP'))

    def test_export_template_is_xlsx(self):
        res = self.client.get('/api-hrm/assets/export_template/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('spreadsheetml', res['Content-Type'])

    def test_upload_and_clear_image(self):
        image = SimpleUploadedFile('a.png', b'\x89PNG fake', content_type='image/png')
        with patch('hrm.utils.upload_file_to_cloudfly', return_value='assets/images/a.png'), \
                patch('hrm.utils.get_cloudfly_presigned_url', return_value='https://cdn/a.png'):
            res = self.client.post(f'/api-hrm/assets/{self.asset.id}/upload_image/',
                                   {'image': image, 'image_type': 'current'}, format='multipart')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['current_image_url'], 'https://cdn/a.png')
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.current_image, 'assets/images/a.png')

        res = self.client.post(f'/api-hrm/assets/{self.asset.id}/clear_image/', {'image_type': 'current'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.asset.refresh_from_db()
        self.assertIsNone(self.asset.current_image)

    def test_upload_rejects_non_image(self):
        doc = SimpleUploadedFile('a.pdf', b'%PDF', content_type='application/pdf')
        res = self.client.post(f'/api-hrm/assets/{self.asset.id}/upload_image/',
                               {'image': doc, 'image_type': 'current'}, format='multipart')
        self.assertEqual(res.status_code, 400)
