"""Regression test: import phải đọc được cột "Mã người bàn giao"/"Tên người
bàn giao" (tách ra từ export ở commit ff2f9aa) — trước khi sửa, parse_row()
chỉ tìm alias cột gộp cũ ("Người được bàn giao"...) nên bàn giao bị bỏ qua
âm thầm (dòng đầy đủ) hoặc fail hẳn (dòng nối tiếp multi-holder)."""
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


class HandoverColumnAliasTests(SimpleTestCase):

    @patch("hrm.asset_import.Employee")
    def test_full_row_reads_ma_nguoi_ban_giao(self, mock_employee):
        mock_emp = MagicMock()
        mock_emp.full_name = "Nguyễn Văn A"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"mã người bàn giao": 3, "tên người bàn giao": 4})
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-001",
            "phân loại": "Laptop",
            "mã người bàn giao": "NV80005",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["_handover_recipients"]), 1)
        self.assertEqual(payload["_handover_recipients"][0]["employee"], mock_emp)
        mock_employee.objects.filter.assert_any_call(employee_id__iexact="NV80005")

    @patch("hrm.asset_import.Employee")
    def test_continuation_row_reads_ma_nguoi_ban_giao(self, mock_employee):
        mock_emp = MagicMock()
        mock_emp.full_name = "Trần Thị B"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"mã người bàn giao": 3, "tên người bàn giao": 4})
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-001",
            "mã người bàn giao": "NV80006",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertTrue(payload.get("_continuation"))
        self.assertEqual(len(payload["_handover_recipients"]), 1)
        self.assertEqual(payload["_handover_recipients"][0]["employee"], mock_emp)

    @patch("hrm.asset_import.Employee")
    def test_old_combined_column_alias_still_works(self, mock_employee):
        mock_emp = MagicMock()
        mock_emp.full_name = "Lê Văn C"
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = _headers({"người được bàn giao": 3})
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-002",
            "phân loại": "Laptop",
            "người được bàn giao": "Lê Văn C",
        }, total_cols=3)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["_handover_recipients"]), 1)
