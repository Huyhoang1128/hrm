"""
Công lễ trong thời gian thử việc tính như công thử việc (yêu cầu
2026-10-03, case NV02931 T9/2026: hết thử việc 04/09, lễ 01-02/09 trước đây
không nằm trong Công thử việc/chính thức nên bảng lương bỏ sót). Công lễ vẫn
hiển thị riêng (co_le), chỉ tách thêm phần thử việc / chính thức.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from hrm.finalization_views import _holiday_credit_split, _split_holiday_credit

SUMMARY = [
    {"date": "2026-09-01", "day_type": "L"},
    {"date": "2026-09-02", "day_type": "L"},
    {"date": "2026-09-03", "day_type": ""},
]


class HolidayProbationSplitTests(SimpleTestCase):
    def test_holidays_before_probation_end_are_probation(self):
        self.assertEqual(_split_holiday_credit(SUMMARY, date(2026, 9, 4)), (2.0, 0.0))

    def test_probation_end_between_holidays(self):
        self.assertEqual(_split_holiday_credit(SUMMARY, date(2026, 9, 1)), (1.0, 1.0))

    def test_no_probation_means_official(self):
        self.assertEqual(_split_holiday_credit(SUMMARY, None), (0.0, 2.0))

    def test_old_record_without_stored_split_is_recomputed(self):
        rec = SimpleNamespace(raw_state={"daily_summary": SUMMARY})
        emp = SimpleNamespace(probation_end_date=date(2026, 9, 4))
        self.assertEqual(_holiday_credit_split(rec, emp), (Decimal("2.0"), Decimal("0.0")))

    def test_part_time_holiday_is_half_credit(self):
        # NV02826 T9/2026: part-time, lễ 01-02/09 mỗi ngày 0.5 -> tổng 1 công lễ, không phải 2.
        self.assertEqual(_split_holiday_credit(SUMMARY, None, 0.5), (0.0, 1.0))
        self.assertEqual(_split_holiday_credit(SUMMARY, date(2026, 9, 1), 0.5), (0.5, 0.5))

    def test_old_part_time_record_is_recomputed_with_half_credit(self):
        rec = SimpleNamespace(raw_state={"daily_summary": SUMMARY})
        emp = SimpleNamespace(probation_end_date=None, work_form="PART_TIME")
        self.assertEqual(_holiday_credit_split(rec, emp), (Decimal("0.0"), Decimal("1.0")))

    def test_stored_split_is_used(self):
        rec = SimpleNamespace(raw_state={"daily_summary": SUMMARY, "co_le_thu_viec": 1, "co_le_chinh_thuc": 1})
        emp = SimpleNamespace(probation_end_date=date(2026, 9, 4))
        self.assertEqual(_holiday_credit_split(rec, emp), (Decimal("1"), Decimal("1")))


class HolidayCreditToAddTests(SimpleTestCase):
    """Bản chốt mới lưu sẵn công lễ trong công thử việc/chính thức (cờ
    cong_includes_holiday) -> bảng lương/API không cộng thêm; bản cũ thì cộng."""

    def test_new_record_with_flag_adds_nothing(self):
        from hrm.finalization_views import _holiday_credit_to_add
        rec = SimpleNamespace(raw_state={"daily_summary": SUMMARY, "co_le_thu_viec": 2, "co_le_chinh_thuc": 0, "cong_includes_holiday": True})
        emp = SimpleNamespace(probation_end_date=date(2026, 9, 4))
        self.assertEqual(_holiday_credit_to_add(rec, emp), (Decimal("0"), Decimal("0")))

    def test_old_record_without_flag_adds_split(self):
        from hrm.finalization_views import _holiday_credit_to_add
        rec = SimpleNamespace(raw_state={"daily_summary": SUMMARY})
        emp = SimpleNamespace(probation_end_date=date(2026, 9, 4))
        self.assertEqual(_holiday_credit_to_add(rec, emp), (Decimal("2.0"), Decimal("0.0")))


class PartTimeFinalizationRecordTests(SimpleTestCase):
    """Chốt công NV part-time: công lễ 0.5/ngày như bảng công tháng (case NV02826
    T9/2026 — lịch hiện 0.5 công lễ ngày 01 và 02/09 nhưng chốt công ra 2 công lễ)."""

    def _build(self, work_form):
        from unittest import mock
        from hrm import finalization_views as fv

        emp = SimpleNamespace(
            employee_id="NV02826", full_name="NV part-time", department=None, department_id=None,
            position=None, doctor_team=None, start_date=date(2026, 8, 1), probation_end_date=None,
            official_start_date=None, employment_status="ACTIVE", end_date=None,
            contract_type="CT", work_form=work_form,
        )
        replay = {"state": {"tong_ngay_cong": 4.0, "nghi_phep": 0}, "calendar": []}
        with mock.patch.object(fv.EmployeeState, "replay_month", return_value=replay), \
                mock.patch.object(fv, "_build_daily_summary", return_value=SUMMARY), \
                mock.patch.object(fv, "_get_parking_allowance_override", return_value=None):
            return fv._build_finalization_record(emp, 2026, 9)

    def test_part_time_gets_half_holiday_credit_per_day(self):
        rec = self._build("PART_TIME")
        self.assertEqual(rec["co_le"], 1.0)
        self.assertEqual(rec["tong_cong"], 5.0)
        self.assertEqual(rec["cong_chinh_thuc"], 1.0)  # calendar rỗng -> chỉ còn phần công lễ
        self.assertEqual(rec["raw_state"]["co_le_chinh_thuc"], 1.0)

    def test_full_time_keeps_one_credit_per_holiday(self):
        rec = self._build("FULL_TIME")
        self.assertEqual(rec["co_le"], 2.0)
        self.assertEqual(rec["tong_cong"], 6.0)
