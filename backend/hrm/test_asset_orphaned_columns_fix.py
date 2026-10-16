"""
hrm/test_asset_orphaned_columns_fix.py
════════════════════════════════════════
Bug thực tế (2026-09-14): "Thêm tài sản mới" luôn báo lỗi 500
"Request failed with status code 500". Nguyên nhân: bảng hrm_asset có 4 cột
current_image/depreciation_method/depreciation_period_months/purchase_image
trong khi model `Asset` chưa khai báo các field
này. Cột `depreciation_method` là NOT NULL và không có DB-level default -> Django
INSERT không gửi giá trị cho cột này -> Postgres NotNullViolation -> 500.

Fix: khai báo lại đúng 4 field này trên model Asset (hrm/models.py), với
depreciation_method có default='STRAIGHT_LINE' để Django tự điền khi tạo mới — khớp
migration 0135 (SeparateDatabaseAndState + RunSQL IF NOT EXISTS, không re-run ALTER
TABLE trên production vì cột đã tồn tại sẵn).

Không cần DB thật để test phần cốt lõi của fix (Django tự áp default field trước khi
gửi INSERT) — chỉ cần introspect model field, không cần SimpleTestCase chạm DB.
"""
from django.test import SimpleTestCase

from hrm.models import Asset
from hrm.serializers import AssetSerializer


class AssetOrphanedColumnsFixTests(SimpleTestCase):
    def test_depreciation_method_field_exists_with_straight_line_default(self):
        """Field phải tồn tại trên model VÀ có default khớp đúng giá trị đã backfill
        cho toàn bộ 465 asset hiện có trên production — nếu thiếu field này, Django
        sẽ không tự điền giá trị khi INSERT -> lại crash NotNullViolation như cũ."""
        field = Asset._meta.get_field('depreciation_method')
        self.assertEqual(field.default, 'STRAIGHT_LINE')
        self.assertFalse(field.null)

    def test_other_three_orphaned_columns_are_declared_and_nullable(self):
        """current_image / depreciation_period_months / purchase_image vốn nullable
        ở DB — không gây lỗi 500 như depreciation_method, nhưng vẫn cần khai báo lại
        để Django không báo 'model has changed, missing migration' và để queryset
        không bị lỗi khi SELECT * ánh xạ ra các cột này."""
        for name in ('current_image', 'depreciation_period_months', 'purchase_image'):
            field = Asset._meta.get_field(name)
            self.assertTrue(field.null, f"{name} phải nullable (khớp DB thật)")

    def test_asset_create_with_only_required_fields_gets_default_depreciation_method(self):
        """Mô phỏng đúng lỗi thực tế: gọi Asset(**validated_data) với validated_data
        KHÔNG hề chứa depreciation_method (giống hệt AssetSerializer.create(), vốn
        không khai báo field này) — object phải tự nhận default trước khi save(),
        không rơi vào tình trạng thiếu giá trị."""
        asset = Asset(
            asset_code='TEST-0001',
            name='Test asset',
            asset_type='OTHER',
        )
        self.assertEqual(asset.depreciation_method, 'STRAIGHT_LINE')
