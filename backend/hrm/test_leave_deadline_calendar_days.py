"""
leave_deadline() đếm theo NGÀY LỊCH (chốt 2026-10-04): Chủ nhật cũng tính là 1
ngày, giờ chốt 17h30 thứ 2 - thứ 7, Chủ nhật tới 23h59.

Ví dụ HCNS: nghỉ 2-3 ngày bắt đầu thứ 2 phải báo trước 2 ngày -> chậm nhất thứ
7. Ca thực tế: NV80008 muốn nghỉ cả ngày thứ 2 05/10/2026, tạo đơn sáng Chủ
nhật 04/10 bị chặn "quá hạn 17:30 03/10" vì bản 28/09 đếm ngày làm việc (bỏ
qua Chủ nhật) — đúng ra hạn là 23h59 Chủ nhật 04/10.

start_date mốc: Thứ 2 28/09/2026.
"""
import datetime as dt

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.deadline_utils import leave_deadline

_START = dt.date(2026, 9, 28)  # Thứ 2


class LeaveDeadlineCalendarDaysTests(SimpleTestCase):
    def test_1_ngày_hạn_là_23h59_chủ_nhật_hôm_trước(self):
        deadline = timezone.localtime(leave_deadline(_START, 1, None))
        self.assertEqual(deadline.date(), dt.date(2026, 9, 27))
        self.assertEqual((deadline.hour, deadline.minute), (23, 59))

    def test_ca_thực_tế_HM00968_nghỉ_thứ_2_05_10(self):
        deadline = timezone.localtime(leave_deadline(dt.date(2026, 10, 5), 1, None))
        self.assertEqual(deadline.date(), dt.date(2026, 10, 4))
        self.assertEqual((deadline.hour, deadline.minute), (23, 59))

    def test_2_3_ngày_báo_từ_thứ_7(self):
        """Đúng ví dụ HCNS: nghỉ 2-3 ngày từ thứ 2 -> chậm nhất 17h30 thứ 7."""
        deadline = timezone.localtime(leave_deadline(_START, 3, None))
        self.assertEqual(deadline.date(), dt.date(2026, 9, 26))
        self.assertEqual((deadline.hour, deadline.minute), (17, 30))

    def test_4_7_ngày_lùi_7_ngày_lịch(self):
        deadline = leave_deadline(_START, 7, None)
        self.assertEqual(timezone.localtime(deadline).date(), dt.date(2026, 9, 21))

    def test_từ_8_ngày_lùi_10_ngày_lịch(self):
        deadline = leave_deadline(_START, 8, None)
        self.assertEqual(timezone.localtime(deadline).date(), dt.date(2026, 9, 18))

    def test_ngày_thường_chốt_17h30(self):
        """Nghỉ thứ 4 -> hạn 17h30 thứ 3."""
        deadline = timezone.localtime(leave_deadline(dt.date(2026, 9, 30), 1, None))
        self.assertEqual(deadline.date(), dt.date(2026, 9, 29))
        self.assertEqual((deadline.hour, deadline.minute), (17, 30))
