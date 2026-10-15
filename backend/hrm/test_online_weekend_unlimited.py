"""
Đơn làm việc online tính vào hạn mức online/tháng bao nhiêu (online_quota_amount).

Chính sách Kế toán (chốt 2026-10-02): được làm online chiều thứ 7 tuần 2/4 và
các ngày Chủ nhật KHÔNG giới hạn — những đơn đó không tính vào hạn mức 3 ngày/
tháng. Đơn ngày thường vẫn tính bình thường. Bật qua Department.online_weekend_
unlimited, các phòng khác không đổi.
"""
import datetime as dt
import types

from django.test import SimpleTestCase

from hrm.stats_utils import online_quota_amount


def _nv(unlimited=True, dept_sat=False, emp_sat=None):
    return types.SimpleNamespace(
        department=types.SimpleNamespace(online_weekend_unlimited=unlimited,
                                         saturday_afternoon_always_workday=dept_sat),
        saturday_afternoon_always_workday=emp_sat,
    )


CN = dt.date(2026, 10, 4)          # Chủ nhật
T7_TUAN2 = dt.date(2026, 10, 10)   # thứ 7 thứ 2 của tháng
T7_TUAN1 = dt.date(2026, 10, 3)    # thứ 7 thứ 1
T2 = dt.date(2026, 10, 5)          # ngày thường
CA_NGAY = {"expected_status": "PRESENT"}
CHIEU = {"expected_status": "HALF_DAY", "half_day_period": "AFTERNOON"}
SANG = {"expected_status": "HALF_DAY", "half_day_period": "MORNING"}


class OnlineQuotaTests(SimpleTestCase):
    def test_kế_toán_chủ_nhật_không_tính(self):
        self.assertEqual(online_quota_amount(_nv(), CN, CA_NGAY), 0.0)
        self.assertEqual(online_quota_amount(_nv(), CN, SANG), 0.0)

    def test_kế_toán_chiều_t7_tuần_2_không_tính(self):
        self.assertEqual(online_quota_amount(_nv(), T7_TUAN2, CHIEU), 0.0)

    def test_kế_toán_cả_ngày_t7_tuần_2_chỉ_tính_buổi_sáng(self):
        self.assertEqual(online_quota_amount(_nv(), T7_TUAN2, CA_NGAY), 0.5)
        self.assertEqual(online_quota_amount(_nv(), T7_TUAN2, SANG), 0.5)

    def test_kế_toán_t7_tuần_1_và_ngày_thường_vẫn_tính(self):
        self.assertEqual(online_quota_amount(_nv(), T7_TUAN1, CHIEU), 0.5)
        self.assertEqual(online_quota_amount(_nv(), T2, CA_NGAY), 1.0)

    def test_phòng_khác_không_đổi(self):
        self.assertEqual(online_quota_amount(_nv(unlimited=False), CN, CA_NGAY), 1.0)
        self.assertEqual(online_quota_amount(_nv(unlimited=False), T7_TUAN2, CHIEU), 0.5)

    def test_làm_chiều_t7_mọi_tuần_thì_không_miễn(self):
        """Chiều thứ 7 là giờ làm bình thường của họ -> vẫn tính hạn mức."""
        self.assertEqual(online_quota_amount(_nv(dept_sat=True), T7_TUAN2, CHIEU), 0.5)
        self.assertEqual(online_quota_amount(_nv(emp_sat=True), T7_TUAN2, CHIEU), 0.5)
