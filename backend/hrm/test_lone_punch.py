"""
lone_punch_is_checkout(): ngày chỉ có ĐÚNG 1 lần chấm — là giờ ra hay giờ vào?

File xuất từ hệ thống chấm công luôn xếp lần chấm đầu tiên của ngày vào cột
"Vào", nên người quên chấm lúc đến, chỉ chấm lúc về (vd 17:04) bị lưu thành giờ
VÀO 17:04 (tháng 9/2026: 113 ngày, 86 nhân viên — vd NV02831 ngày 07/09).
"""
import datetime as dt
import types
from unittest.mock import patch

from django.test import SimpleTestCase

from hrm.shift_config_utils import lone_punch_is_checkout


def _sc(start, end, detection_only=False):
    return types.SimpleNamespace(
        start_time=dt.time(*map(int, start.split(":"))),
        end_time=dt.time(*map(int, end.split(":"))),
        detection_only=detection_only,
    )


EMP = types.SimpleNamespace(employee_id="NV02831")
NGAY = dt.date(2026, 9, 7)
CA_HC = [_sc("08:00", "12:00"), _sc("13:00", "16:30")]
CA_KINH_DOANH = _sc("13:00", "21:00", detection_only=True)


def _goi(punch, registered=None, cascade=CA_HC, candidates=()):
    with patch("hrm.shift_config_utils.get_registered_shift_configs_for_date", return_value=registered), \
         patch("hrm.shift_config_utils.load_shift_configs_for_employee", return_value=cascade), \
         patch("hrm.shift_config_utils.get_all_candidate_shifts_for_employee", return_value=list(candidates)):
        return lone_punch_is_checkout(EMP, NGAY, dt.time(*map(int, punch.split(":"))))


class LonePunchTests(SimpleTestCase):
    def test_chấm_lúc_về_là_giờ_ra(self):
        """Đúng case NV02831 07/09: chỉ có 17:04 -> giờ RA, không phải giờ vào."""
        self.assertTrue(_goi("17:04"))
        self.assertTrue(_goi("16:36"))

    def test_chấm_lúc_đến_vẫn_là_giờ_vào(self):
        self.assertFalse(_goi("07:55"))
        self.assertFalse(_goi("08:20"))

    def test_ca_kinh_doanh_chấm_13h_là_giờ_vào(self):
        """Người làm ca kinh doanh 13:00-21:00 quên chấm lúc về: lần chấm 13:00
        phải là giờ VÀO, dù ca hành chính của họ tan lúc 16:30."""
        self.assertFalse(_goi("13:00", candidates=[CA_KINH_DOANH]))
        self.assertTrue(_goi("20:58", candidates=[CA_KINH_DOANH]))

    def test_ưu_tiên_ca_đã_đăng_ký(self):
        """Ca 2 Điều dưỡng BS Doãn Dương 09:30-18:30: 09:40 là vào, 18:35 là ra."""
        ca2 = [_sc("09:30", "13:30"), _sc("14:30", "18:30")]
        self.assertFalse(_goi("09:40", registered=ca2))
        self.assertTrue(_goi("18:35", registered=ca2))

    def test_không_tra_được_ca_thì_dùng_khung_hành_chính(self):
        self.assertFalse(_goi("08:10", cascade=[]))
        self.assertTrue(_goi("17:20", cascade=[]))

    def test_lỗi_tra_ca_đăng_ký_không_làm_hỏng(self):
        with patch("hrm.shift_config_utils.get_registered_shift_configs_for_date", side_effect=RuntimeError), \
             patch("hrm.shift_config_utils.load_shift_configs_for_employee", return_value=CA_HC), \
             patch("hrm.shift_config_utils.get_all_candidate_shifts_for_employee", return_value=[]):
            self.assertTrue(lone_punch_is_checkout(EMP, NGAY, dt.time(17, 4)))


class LonePunchConservativeTests(SimpleTestCase):
    """Vùng giữa ngày phải giữ là giờ VÀO như trước khi có hàm này."""

    def test_nghỉ_sáng_đi_làm_chiều_chấm_13h_là_giờ_vào(self):
        self.assertFalse(_goi("13:00"))
        self.assertFalse(_goi("13:20"))

    def test_đến_muộn_lúc_11h_vẫn_là_giờ_vào(self):
        self.assertFalse(_goi("11:00"))

    def test_sát_giờ_tan_ca_mới_là_giờ_ra(self):
        self.assertTrue(_goi("16:10"))
        self.assertTrue(_goi("17:04"))
