# -*- coding: utf-8 -*-
"""
hrm/test_asset_import_export_sim_cancellation_date.py
========================================================
Yêu cầu HCNS 2026-09-25: thêm 1 trường tuỳ biến cho phân loại Sim — "Ngày báo
huỷ" (ngày báo nhà mạng cắt sim). Field mới lưu trong Asset.specifications
(JSON), không phải cột DB riêng — theo đúng pattern các field Sim khác
(phone_number, sim_type, sim_company...).

asset_export.py/asset_import.py khai báo rõ "Schema cột khớp 100% ... để
round-trip: export → user sửa → import lại sẽ upsert đúng" — test này khoá
lại đúng cam kết đó cho cột mới, theo pattern test_asset_import_handover_
nql_columns.py (SimpleTestCase, mock Employee/Position/CompanyUnit models
khi cần, KHÔNG cần DB thật).
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm.asset_export import _build_base_fields, _row_from_base, COLUMNS
from hrm.asset_import import parse_row


def _headers(extra: dict) -> dict:
    headers = {"mã thiết bị": 1, "phân loại": 2}
    headers.update(extra)
    return headers


def _row(headers: dict, values: dict, total_cols: int) -> list:
    cells = [None] * total_cols
    for key, val in values.items():
        cells[headers[key] - 1] = val
    return cells


class SimCancellationDateImportTests(SimpleTestCase):
    def test_parses_iso_date_string_into_specifications(self):
        headers = _headers({
            "số điện thoại": 3, "ngày báo huỷ": 4,
        })
        cells = _row(headers, {
            "mã thiết bị": "SIM001",
            "phân loại": "Sim",
            "số điện thoại": "0912345678",
            "ngày báo huỷ": "2026-09-30",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["specifications"]["cancellation_report_date"], "2026-09-30")

    def test_parses_excel_dd_mm_yyyy_format(self):
        headers = _headers({
            "số điện thoại": 3, "ngày báo huỷ": 4,
        })
        cells = _row(headers, {
            "mã thiết bị": "SIM002",
            "phân loại": "Sim",
            "số điện thoại": "0912345678",
            "ngày báo huỷ": "30/09/2026",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["specifications"]["cancellation_report_date"], "2026-09-30")

    def test_missing_column_leaves_field_empty_backward_compatible(self):
        """File Excel cũ (export TRƯỚC khi có cột này) vẫn import được bình
        thường — không có cột "Ngày báo huỷ" thì để trống, không lỗi."""
        headers = _headers({"số điện thoại": 3})
        cells = _row(headers, {
            "mã thiết bị": "SIM003",
            "phân loại": "Sim",
            "số điện thoại": "0912345678",
        }, total_cols=3)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["specifications"]["cancellation_report_date"], "")


class SimCancellationDateExportTests(SimpleTestCase):
    def test_column_declared_in_schema_under_sim_group(self):
        self.assertIn(("Ngày báo huỷ", "SIM"), COLUMNS)

    def test_build_base_fields_reads_from_specifications(self):
        asset = MagicMock()
        asset.asset_type = "SIM"
        asset.specifications = {
            "phone_number": "0912345678",
            "cancellation_report_date": "2026-09-30",
        }
        asset.model = ""
        asset.name = "Sim test"
        asset.purchase_date = None
        asset.warranty_period = 0
        asset.supplier = ""
        asset.department = None
        asset.managed_by = None
        asset.description = ""

        base = _build_base_fields(asset)

        self.assertEqual(base["ngay_bao_huy"], "2026-09-30")

    def test_non_sim_asset_has_empty_cancellation_date(self):
        asset = MagicMock()
        asset.asset_type = "LAPTOP"
        asset.specifications = {}
        asset.model = ""
        asset.name = "Laptop test"
        asset.purchase_date = None
        asset.warranty_period = 0
        asset.supplier = ""
        asset.department = None
        asset.managed_by = None
        asset.description = ""

        base = _build_base_fields(asset)

        self.assertEqual(base["ngay_bao_huy"], "")

    def test_row_from_base_includes_cancellation_date_between_cong_ty_and_type_name(self):
        # Xây base dict tối giản đủ field _row_from_base cần, để kiểm tra ĐÚNG
        # VỊ TRÍ cột mới trong row (khớp COLUMNS: ... Công ty, Ngày báo huỷ, Tên loại chi tiết ...).
        fake_base = {
            'name': 'n', 'asset_type': 't', 'model': 'm', 'condition': 'c', 'status': 's',
            'cpu': '', 'mainboard': '', 'ram': '', 'storage': '', 'vga': '', 'power_supply': '',
            'quantity': '',
            'phone_number': 'p', 'network_provider': 'np', 'sim_type': 'st',
            'doctor': 'd', 'region': 'r', 'vi_tri': 'vt', 'cong_ty': 'ct', 'ngay_bao_huy': 'NBH',
            'type_name': 'tn',
            'purchase_date': '', 'warranty_period': 0, 'supplier': '',
            'department': '', 'managed_by_code': '', 'managed_by_name': '',
            'description': '',
        }
        row = _row_from_base(fake_base, '', '', '', '', '')
        cong_ty_idx = row.index('ct')
        type_name_idx = row.index('tn')
        self.assertEqual(row[cong_ty_idx + 1], 'NBH')
        self.assertEqual(type_name_idx, cong_ty_idx + 2)
