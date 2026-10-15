"""
Regression test cho bug: mã thiết bị (Asset.name) NV0001 hợp lệ khi có nhiều
loại tài sản khác nhau (vd: Màn hình + Máy tính để bàn cùng mã), nhưng
validate_name() cũ chặn TRÙNG THEO name một mình (không xét asset_type) nên
thêm loại tài sản thứ 2 cho cùng 1 mã thiết bị bị báo lỗi "đã tồn tại" sai.

Đúng: chỉ chặn khi trùng CẢ mã thiết bị (name) LẪN loại tài sản (asset_type).
"""
from django.test import TestCase

from hrm.models import Asset
from hrm.serializers import AssetSerializer


class AssetDeviceCodeDuplicateValidationTests(TestCase):
    def setUp(self):
        self.existing = Asset.objects.create(
            name='NV0003',
            asset_type='DESKTOP',
        )

    def test_same_name_different_asset_type_is_allowed(self):
        """NV0003 đã có Máy tính để bàn -> thêm Màn hình cùng mã NV0003 phải OK."""
        serializer = AssetSerializer(data={'name': 'NV0003', 'asset_type': 'MONITOR'})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_same_name_same_asset_type_is_blocked(self):
        """NV0003 đã có Máy tính để bàn -> thêm Máy tính để bàn khác cùng mã NV0003 phải bị chặn."""
        serializer = AssetSerializer(data={'name': 'NV0003', 'asset_type': 'DESKTOP'})
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)

    def test_same_name_same_asset_type_case_insensitive_is_blocked(self):
        serializer = AssetSerializer(data={'name': 'nv0003', 'asset_type': 'DESKTOP'})
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)

    def test_different_name_same_asset_type_is_allowed(self):
        serializer = AssetSerializer(data={'name': 'NV0004', 'asset_type': 'DESKTOP'})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_update_keeping_same_name_and_type_on_itself_is_allowed(self):
        """PATCH không đổi name/asset_type của chính nó -> không tự báo trùng với chính mình."""
        serializer = AssetSerializer(
            instance=self.existing,
            data={'location': 'Kho HN'},
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_update_asset_type_colliding_with_another_asset_is_blocked(self):
        """Đổi loại tài sản của 1 asset khác (NV0003/MONITOR) trùng vào
        (NV0003, DESKTOP) đã tồn tại -> phải bị chặn."""
        other = Asset.objects.create(name='NV0003', asset_type='MONITOR')
        serializer = AssetSerializer(
            instance=other,
            data={'asset_type': 'DESKTOP'},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)
