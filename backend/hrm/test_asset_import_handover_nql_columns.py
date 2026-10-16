"""Bug thực tế (2026-09-23): upload lại file Excel vừa
export ra ("Xuất Excel" rồi "Nhập Excel" ngay, không sửa gì) — cột "Người sử
dụng" trên web luôn trống, "Trạng thái bàn giao" luôn "CHƯA BÀN GIAO", dù file
Excel có đủ dữ liệu ở cột "Mã người bàn giao"/"Tên người bàn giao".

Nguyên nhân: asset_export.py xuất 2 cột TÁCH RIÊNG "Mã người bàn giao"/"Tên
người bàn giao" (và "Mã NQL (Kho)"/"Tên NQL (Kho)" cho người quản lý kho),
nhưng asset_import.py chưa từng được cập nhật để nhận diện các header này —
parse_row() chỉ tìm alias cũ ("Người được bàn giao", "Người quản lý (Kho)"...)
nên recipient_raw/managed_by luôn rỗng, bàn giao bị bỏ qua ÂM THẦM.

Vụ "NQL (Kho)" phát hiện luôn khi rà lại cùng logic.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

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


class HandoverColumnsReadFromRealExportTests(SimpleTestCase):
    """File export thật hiện tại (asset_export.COLUMNS) chỉ có "Mã/Tên người
    bàn giao" tách riêng — KHÔNG có cột gộp "Người được bàn giao"."""

    @patch("hrm.asset_import.Employee")
    def test_full_row_reads_ma_nguoi_ban_giao(self, mock_employee):
        mock_emp = MagicMock()
        mock_emp.full_name = "Người Quản Lý"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"mã người bàn giao": 3, "tên người bàn giao": 4})
        cells = _row(headers, {
            "mã thiết bị": "MH001",
            "phân loại": "Màn hình",
            "mã người bàn giao": "NV80004",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["_handover_recipients"]), 1)
        self.assertEqual(payload["_handover_recipients"][0]["employee"], mock_emp)
        mock_employee.objects.filter.assert_any_call(employee_id__iexact="NV80004")

    @patch("hrm.asset_import.Employee")
    def test_continuation_row_reads_ma_nguoi_ban_giao(self, mock_employee):
        mock_emp = MagicMock()
        mock_emp.full_name = "Nguyễn Văn A"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"mã người bàn giao": 3, "tên người bàn giao": 4})
        cells = _row(headers, {
            "mã thiết bị": "MH002",
            "mã người bàn giao": "NV80032",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertTrue(payload.get("_continuation"))
        self.assertEqual(len(payload["_handover_recipients"]), 1)
        self.assertEqual(payload["_handover_recipients"][0]["employee"], mock_emp)

    @patch("hrm.asset_import.Employee")
    def test_old_combined_column_alias_still_works(self, mock_employee):
        """Tương thích ngược với file rất cũ (trước khi tách cột Mã/Tên)."""
        mock_emp = MagicMock()
        mock_emp.full_name = "Lê Văn C"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"người được bàn giao": 3})
        cells = _row(headers, {
            "mã thiết bị": "MH003",
            "phân loại": "Màn hình",
            "người được bàn giao": "Lê Văn C",
        }, total_cols=3)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["_handover_recipients"]), 1)


class ManagedByColumnReadFromRealExportTests(SimpleTestCase):
    """"Mã NQL (Kho)"/"Tên NQL (Kho)" (asset_export.py) cũng chưa từng được
    parse_row() nhận diện — cùng lỗi, khác cột."""

    @patch("hrm.asset_import.Employee")
    def test_managed_by_reads_ma_nql_kho(self, mock_employee):
        mock_emp = MagicMock()
        mock_emp.full_name = "Người Nhận"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"mã nql (kho)": 3, "tên nql (kho)": 4})
        cells = _row(headers, {
            "mã thiết bị": "MH001",
            "phân loại": "Màn hình",
            "mã nql (kho)": "NV80012",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["managed_by"], mock_emp)
        mock_employee.objects.filter.assert_any_call(employee_id__iexact="NV80012")
