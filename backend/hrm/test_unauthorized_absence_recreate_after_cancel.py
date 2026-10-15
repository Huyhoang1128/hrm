# -*- coding: utf-8 -*-
"""
hrm/test_unauthorized_absence_recreate_after_cancel.py
========================================================
Bug thực tế (2026-09-24): nhân viên tạo đơn Nghỉ không phép nhiều ngày liên
tiếp (26-28/9), sau đó huỷ (CANCELLED) để tạo lại theo cách khác (chỉ 26 và
28, bỏ 27 vì là Chủ nhật) — nhưng bị chặn "Tất cả các ngày trong khoảng đã có
đơn nghỉ không phép" dù đơn cũ đã huỷ.

Nguyên nhân: RegistrationRequestCreateSerializer.create() (nhánh multi-day
UNAUTHORIZED_ABSENCE) tính existing_dates bằng cách CHỈ loại trừ đơn
REJECTED, quên loại trừ CANCELLED — nên ngày đã có đơn CANCELLED vẫn bị coi
là "đang bị chiếm", khiến created_events rỗng và ném lỗi.

Fix: exclude cả REJECTED lẫn CANCELLED (Q(...) | Q(...)), khớp đúng convention
dùng ở mọi nơi khác trong codebase khi kiểm tra "đơn có còn tính hay không"
(vd get_explanation_quota_by_type, _get_quota_used).

Không có DB thật (SimpleTestCase) — mock Employee/EmployeeEvent, theo đúng
pattern các test khác trong file này.
"""
from datetime import date
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm.registration_serializers import RegistrationRequestCreateSerializer


def _setup(mock_employee_cls, mock_event_cls, existing_dates):
    employee = MagicMock(id=1)
    mock_employee_cls.objects.get.return_value = employee

    qs = MagicMock()
    qs.exclude.return_value.values_list.return_value = existing_dates
    mock_event_cls.objects.filter.return_value = qs
    mock_event_cls.objects.create.side_effect = lambda **kwargs: MagicMock(**kwargs)
    return employee, qs


def _base_data(**overrides):
    data = {
        "employee_id": 1,
        "registration_type": "UNAUTHORIZED_ABSENCE",
        "attendance_date": date(2026, 9, 26),
        "end_date": date(2026, 9, 28),
        "reason": "Việc cá nhân",
        "status": "PENDING",
        "created_by": None,
    }
    data.update(overrides)
    return data


class UnauthorizedAbsenceRecreateAfterCancelTests(SimpleTestCase):
    @patch("hrm.registration_serializers.EmployeeEvent")
    @patch("hrm.registration_serializers.Employee")
    def test_cancelled_days_are_not_counted_as_existing(self, mock_employee_cls, mock_event_cls):
        # existing_dates=set() mô phỏng đúng hành vi SAU KHI Django áp
        # Q(REJECTED)|Q(CANCELLED) loại hết 2 ngày cũ (cả 2 đều đã CANCELLED)
        # ra khỏi kết quả filter — tức là "trống", được phép tạo lại.
        _setup(mock_employee_cls, mock_event_cls, existing_dates=set())

        serializer = RegistrationRequestCreateSerializer()
        result = serializer.create(_base_data())

        self.assertEqual(len(result["created"]), 3)
        self.assertEqual(result["skipped_dates"], [])

    @patch("hrm.registration_serializers.EmployeeEvent")
    @patch("hrm.registration_serializers.Employee")
    def test_exclude_call_includes_both_rejected_and_cancelled(self, mock_employee_cls, mock_event_cls):
        """Guard trực tiếp chống regression: exclude() phải được gọi với Q
        bao gồm CẢ REJECTED lẫn CANCELLED, không chỉ REJECTED như bug cũ."""
        _, qs = _setup(mock_employee_cls, mock_event_cls, existing_dates=set())

        serializer = RegistrationRequestCreateSerializer()
        serializer.create(_base_data())

        qs.exclude.assert_called_once()
        called_q_str = str(qs.exclude.call_args[0][0])
        self.assertIn("REJECTED", called_q_str)
        self.assertIn("CANCELLED", called_q_str)

    @patch("hrm.registration_serializers.EmployeeEvent")
    @patch("hrm.registration_serializers.Employee")
    def test_still_skips_genuinely_pending_or_approved_days(self, mock_employee_cls, mock_event_cls):
        """Ngày đã có đơn PENDING/APPROVED thật sự vẫn phải bị bỏ qua (hành
        vi cũ giữ nguyên) — chỉ REJECTED/CANCELLED mới được coi là "trống"."""
        _setup(mock_employee_cls, mock_event_cls, existing_dates={date(2026, 9, 27)})

        serializer = RegistrationRequestCreateSerializer()
        result = serializer.create(_base_data())

        self.assertEqual(len(result["created"]), 2)
        self.assertEqual(result["skipped_dates"], ["2026-09-27"])

    @patch("hrm.registration_serializers.EmployeeEvent")
    @patch("hrm.registration_serializers.Employee")
    def test_all_days_still_blocked_raises_error(self, mock_employee_cls, mock_event_cls):
        """Nếu TẤT CẢ ngày trong khoảng thật sự còn bị chiếm (PENDING/
        APPROVED), vẫn phải báo lỗi như cũ — không phải bỏ hẳn validation."""
        _setup(
            mock_employee_cls, mock_event_cls,
            existing_dates={date(2026, 9, 26), date(2026, 9, 27), date(2026, 9, 28)},
        )

        serializer = RegistrationRequestCreateSerializer()
        from rest_framework import serializers as drf_serializers
        with self.assertRaises(drf_serializers.ValidationError):
            serializer.create(_base_data())
