"""
Nhãn hiển thị 2 ô ca theo từng cấu hình đăng ký ca.

Ô shift_1 luôn là ca MẶC ĐỊNH, ô shift_2 luôn là ca PHẢI ĐĂNG KÝ — nhưng mỗi
team gọi khác nhau: Điều dưỡng BS BS A mặc định "Ca 1" / đăng ký "Ca 2";
Sale BS B (thông báo 02/10/2026) ngược lại — mặc định "Ca 2" / đăng
ký "Ca 1". API phải trả đúng nhãn của config để FE hiện đúng tên nút.
"""
import types

from django.test import SimpleTestCase

from hrm.shift_registration_views import _ca_labels


class CaLabelTests(SimpleTestCase):
    def test_không_có_config_thì_dùng_tên_mặc_định(self):
        self.assertEqual(_ca_labels(None),
                         {"default_ca_label": "Ca 1", "registrable_ca_label": "Ca 2",
                          "registration_enabled": True})

    def test_team_bs_a_giữ_nguyên(self):
        cfg = types.SimpleNamespace(default_ca_label="Ca 1", registrable_ca_label="Ca 2")
        self.assertEqual(_ca_labels(cfg)["registrable_ca_label"], "Ca 2")

    def test_team_sale_bs_b_đảo_tên(self):
        cfg = types.SimpleNamespace(default_ca_label="Ca 2", registrable_ca_label="Ca 1")
        nhan = _ca_labels(cfg)
        self.assertEqual(nhan["default_ca_label"], "Ca 2")
        self.assertEqual(nhan["registrable_ca_label"], "Ca 1")

    def test_nhãn_để_trống_thì_không_trả_chuỗi_rỗng(self):
        """Admin lỡ xoá trắng ô nhãn -> FE không được hiện nút 'Đăng ký ' cụt."""
        cfg = types.SimpleNamespace(default_ca_label="", registrable_ca_label="")
        self.assertEqual(_ca_labels(cfg),
                         {"default_ca_label": "Ca 1", "registrable_ca_label": "Ca 2",
                          "registration_enabled": True})

    def test_config_cũ_chưa_có_cờ_thì_vẫn_cho_đăng_ký(self):
        cfg = types.SimpleNamespace(default_ca_label="Ca 1", registrable_ca_label="Ca 2")
        self.assertTrue(_ca_labels(cfg)["registration_enabled"])

    def test_sale_bs_b_ngừng_ca_1_thì_ẩn_nút(self):
        """Từ 14/10/2026 Sale BS B chỉ còn ca 07:30-16:30."""
        cfg = types.SimpleNamespace(default_ca_label="Ca 2", registrable_ca_label="Ca 1",
                                    registration_enabled=False)
        self.assertFalse(_ca_labels(cfg)["registration_enabled"])
