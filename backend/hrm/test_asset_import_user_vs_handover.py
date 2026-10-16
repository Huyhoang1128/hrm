"""Phát hiện (2026-09-22): 2 cột "Mã/Tên người bàn giao" trong Excel tài sản
thực chất đang lưu data của NGƯỜI SỬ DỤNG (Asset.assigned_to — xem
AssetDetailModal.tsx hiển thị không nhãn "bàn giao", còn assigned_by mới có
nhãn "Người bàn giao:"), không phải người thực hiện bàn giao.

Fix: thêm cột "Mã/Tên người sử dụng" (assigned_to) tách riêng khỏi "Mã/Tên
người bàn giao" (assigned_by — giờ mới đúng nghĩa). File cũ (chỉ có cột
"người bàn giao") vẫn phải đọc được, coi cột đó là người sử dụng như trước
(tương thích ngược).

Cũng khoá lại "Phân loại" tự do: từ 2026-10-12 gõ gì lưu nấy (trước đó giá
trị lạ bị quy về "Khác" + Tên loại chi tiết), KHÔNG được bị hiểu nhầm thành
continuation row/reject cả dòng.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm.asset_import import parse_row


def _row(headers: dict, values: dict, total_cols: int) -> list:
    cells = [None] * total_cols
    for key, val in values.items():
        cells[headers[key] - 1] = val
    return cells


class NewFormatUserVsInitiatorTests(SimpleTestCase):
    """File MỚI: có cả cột "người sử dụng" lẫn "người bàn giao" — phải tách
    đúng 2 vai trò, không gộp làm một."""

    def _make_employees(self, mock_employee, by_code: dict):
        def _filter(**kwargs):
            m = MagicMock()
            code = kwargs.get("employee_id__iexact")
            m.first.return_value = by_code.get(code)
            return m
        mock_employee.objects.filter.side_effect = _filter

    @patch("hrm.asset_import.Employee")
    def test_user_and_initiator_resolved_separately(self, mock_employee):
        user_emp = MagicMock(full_name="Nguyễn Văn Dùng")
        giver_emp = MagicMock(full_name="Trần Thị Giao")
        self._make_employees(mock_employee, {
            "NV00100": user_emp,
            "NV00200": giver_emp,
        })

        headers = {
            "mã thiết bị": 1, "phân loại": 2,
            "mã người sử dụng": 3, "tên người sử dụng": 4,
            "mã người bàn giao": 5, "tên người bàn giao": 6,
        }
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-010",
            "phân loại": "Laptop",
            "mã người sử dụng": "NV00100",
            "mã người bàn giao": "NV00200",
        }, total_cols=6)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["_handover_recipients"]), 1)
        self.assertEqual(payload["_handover_recipients"][0]["employee"], user_emp)
        self.assertEqual(payload["_handover_initiator"], giver_emp)


class OldFormatBackwardCompatTests(SimpleTestCase):
    """File CŨ: chỉ có cột "người bàn giao" (không có "người sử dụng") — phải
    tiếp tục được hiểu là người sử dụng như hành vi cũ, không có initiator."""

    @patch("hrm.asset_import.Employee")
    def test_ban_giao_column_still_means_recipient_without_user_column(self, mock_employee):
        mock_emp = MagicMock(full_name="Lê Văn Cũ")
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = {
            "mã thiết bị": 1, "phân loại": 2,
            "mã người bàn giao": 3, "tên người bàn giao": 4,
        }
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-011",
            "phân loại": "Laptop",
            "mã người bàn giao": "NV00300",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(len(payload["_handover_recipients"]), 1)
        self.assertEqual(payload["_handover_recipients"][0]["employee"], mock_emp)
        self.assertIsNone(payload["_handover_initiator"])


class FreeTextAssetTypeTests(SimpleTestCase):
    """"Phân loại" gõ tự do — gõ gì lưu nấy, không quy về "Khác"."""

    def test_unknown_asset_type_kept_verbatim(self):
        headers = {"mã thiết bị": 1, "phân loại": 2, "tên loại chi tiết": 3, "số lượng": 4}
        cells = _row(headers, {
            "mã thiết bị": "MISC-001",
            "phân loại": "  CCDC   văn phòng ",
            "số lượng": 25,
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["asset_type"], "CCDC văn phòng")
        # Loại tự do có Số lượng như "Khác" (vd 25 ghế), không còn type_name thừa
        self.assertEqual(payload["specifications"], {"quantity": 25})
        self.assertFalse(any("Phân loại" in w for w in warnings))

    def test_free_type_keeps_explicit_type_name(self):
        headers = {"mã thiết bị": 1, "phân loại": 2, "tên loại chi tiết": 3}
        cells = _row(headers, {
            "mã thiết bị": "MISC-002",
            "phân loại": "Robot hút bụi",
            "tên loại chi tiết": "Robot Xiaomi X10",
        }, total_cols=3)

        payload, warnings = parse_row(cells, headers)

        self.assertEqual(payload["asset_type"], "Robot hút bụi")
        self.assertEqual(payload["specifications"]["type_name"], "Robot Xiaomi X10")

    def test_known_label_any_case_maps_to_enum(self):
        headers = {"mã thiết bị": 1, "phân loại": 2}
        for typed, expected in [("máy in", "PRINTER"), ("MÀN HÌNH", "MONITOR"), ("Khác", "OTHER"),
                                ("Máy tính xách tay", "LAPTOP")]:
            payload, _ = parse_row(_row(headers, {"mã thiết bị": "X-1", "phân loại": typed}, 2), headers)
            self.assertEqual(payload["asset_type"], expected, typed)

    def test_too_long_asset_type_rejected(self):
        headers = {"mã thiết bị": 1, "phân loại": 2}
        payload, errors = parse_row(_row(headers, {"mã thiết bị": "X-1", "phân loại": "x" * 101}, 2), headers)
        self.assertIsNone(payload)
        self.assertTrue(any("Phân loại dài quá" in e for e in errors))

    def test_known_asset_type_label_still_maps_to_enum(self):
        headers = {"mã thiết bị": 1, "phân loại": 2}
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-020",
            "phân loại": "Laptop",
        }, total_cols=2)

        payload, warnings = parse_row(cells, headers)

        self.assertEqual(payload["asset_type"], "LAPTOP")

    def test_blank_asset_type_is_still_treated_as_continuation_row(self):
        headers = {
            "mã thiết bị": 1, "phân loại": 2,
            "mã người bàn giao": 3,
        }
        cells = _row(headers, {
            "mã thiết bị": "LAPTOP-020",
            "mã người bàn giao": "NV00400",
        }, total_cols=3)

        with patch("hrm.asset_import.Employee") as mock_employee:
            mock_employee.objects.filter.return_value.first.return_value = MagicMock(full_name="X")
            payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertTrue(payload.get("_continuation"))


class ManagedByColumnReadFromRealExportTests(SimpleTestCase):
    """Cùng lỗi với "Mã/Tên người bàn giao" nhưng ở cột khác: asset_export.py
    xuất "Mã NQL (Kho)"/"Tên NQL (Kho)" (Người quản lý kho) tách riêng, nhưng
    parse_row() chưa từng nhận diện 2 header này — chỉ có alias cũ ("Người
    quản lý (Kho)"...) không còn tồn tại trong file export hiện tại. Phát
    hiện khi rà soát cùng logic cho bug tương tự (2026-09-23)."""

    @patch("hrm.asset_import.Employee")
    def test_managed_by_reads_ma_nql_kho(self, mock_employee):
        mock_emp = MagicMock(full_name="Người Nhận")
        mock_employee.objects.filter.return_value.first.return_value = mock_emp

        headers = {
            "mã thiết bị": 1, "phân loại": 2,
            "mã nql (kho)": 3, "tên nql (kho)": 4,
        }
        cells = _row(headers, {
            "mã thiết bị": "MH001",
            "phân loại": "Màn hình",
            "mã nql (kho)": "NV80012",
        }, total_cols=4)

        payload, warnings = parse_row(cells, headers)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["managed_by"], mock_emp)
        mock_employee.objects.filter.assert_any_call(employee_id__iexact="NV80012")
