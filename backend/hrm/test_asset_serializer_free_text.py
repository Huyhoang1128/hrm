"""Yêu cầu (2026-09-22): "Phân loại" và "Tình trạng vật lý" ở form web
(AssetCreateModal/AssetEditModal) không còn dropdown cố định — AssetSerializer
phải chấp nhận text tự do cho asset_type/condition thay vì reject "not a
valid choice" (hành vi mặc định của ChoiceField tự sinh từ
Asset.asset_type/condition có choices=...).

SimpleTestCase vì chỉ gọi serializer.is_valid() (validate field, không lưu
DB) — asset_type/condition không phải FK nên không cần query DB.
"""
from django.test import TestCase

from hrm.serializers import AssetSerializer


class AssetTypeConditionFreeTextTests(TestCase):
    def test_unknown_asset_type_is_valid(self):
        serializer = AssetSerializer(data={"name": "MISC-001", "asset_type": "Robot hút bụi"})
        serializer.is_valid()
        self.assertNotIn("asset_type", serializer.errors)

    def test_unknown_condition_is_valid(self):
        serializer = AssetSerializer(data={
            "name": "MISC-001", "asset_type": "Robot hút bụi", "condition": "Cần thay pin",
        })
        serializer.is_valid()
        self.assertNotIn("condition", serializer.errors)

    def test_known_enum_value_still_accepted(self):
        serializer = AssetSerializer(data={
            "name": "LAPTOP-001", "asset_type": "LAPTOP", "condition": "EXCELLENT",
        })
        serializer.is_valid()
        self.assertNotIn("asset_type", serializer.errors)
        self.assertNotIn("condition", serializer.errors)

    def test_asset_type_still_required(self):
        serializer = AssetSerializer(data={"name": "MISC-001"})
        serializer.is_valid()
        self.assertIn("asset_type", serializer.errors)

    def test_condition_optional_and_blank_allowed(self):
        serializer = AssetSerializer(data={"name": "MISC-001", "asset_type": "Khác"})
        serializer.is_valid()
        self.assertNotIn("condition", serializer.errors)

    def test_asset_type_over_max_length_rejected(self):
        serializer = AssetSerializer(data={"name": "MISC-001", "asset_type": "X" * 101})
        serializer.is_valid()
        self.assertIn("asset_type", serializer.errors)

    def test_long_free_text_asset_type_accepted(self):
        """Nới 20 -> 100 ký tự (2026-10-12): "Thiết bị công nghệ thông tin" (28)."""
        serializer = AssetSerializer(data={"name": "MISC-001", "asset_type": "Thiết bị công nghệ thông tin"})
        serializer.is_valid()
        self.assertNotIn("asset_type", serializer.errors)
        self.assertEqual(serializer.validated_data["asset_type"], "Thiết bị công nghệ thông tin")

    def test_asset_type_normalized_like_excel_import(self):
        for typed, expected in [("laptop", "LAPTOP"), (" Sim ", "SIM"), ("CCDC  VP", "CCDC VP")]:
            serializer = AssetSerializer(data={"name": "MISC-001", "asset_type": typed})
            serializer.is_valid()
            self.assertEqual(serializer.validated_data["asset_type"], expected, typed)

    def test_blank_asset_type_rejected(self):
        serializer = AssetSerializer(data={"name": "MISC-001", "asset_type": "   "})
        serializer.is_valid()
        self.assertIn("asset_type", serializer.errors)
