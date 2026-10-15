"""
business_trip_deadline() đếm theo NGÀY LỊCH (chốt 2026-10-04): Chủ nhật cũng
tính là 1 ngày, hạn tới hết ngày (23h59) — cùng cách đếm với hạn nghỉ phép.
"""
import datetime as dt

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.deadline_utils import business_trip_deadline

THU_2 = dt.date(2026, 10, 5)


class BusinessTripCalendarDaysTests(SimpleTestCase):
    def test_công_tác_1_ngày_thứ_2_tạo_tới_hết_chủ_nhật(self):
        deadline = timezone.localtime(business_trip_deadline(THU_2, 1))
        self.assertEqual(deadline.date(), dt.date(2026, 10, 4))
        self.assertEqual((deadline.hour, deadline.minute), (23, 59))

    def test_công_tác_nhiều_ngày_lùi_3_ngày_lịch(self):
        deadline = timezone.localtime(business_trip_deadline(THU_2, 2))
        self.assertEqual(deadline.date(), dt.date(2026, 10, 2))

    def test_ngày_thường(self):
        deadline = timezone.localtime(business_trip_deadline(dt.date(2026, 10, 7), 1))
        self.assertEqual(deadline.date(), dt.date(2026, 10, 6))
