"""
HCNS chốt 2026-09-28: "Nghỉ không phép" (registration_type=UNAUTHORIZED_
ABSENCE) chính là nhánh "Nghỉ không lương" trong văn bản "Quy định thời gian
tạo đơn trên HRM" (hệ thống không có loại đơn nghỉ-không-lương riêng — mọi
trường hợp không lương đều đi qua đúng loại đơn này, xem comment
getLeavePayCategory() ở FE Approvals.tsx). Phải áp ĐÚNG bậc thang báo trước
như Nghỉ phép tháng, không còn ngoại lệ "đột xuất tạo trong 3h sau khi đi
làm trở lại" nữa (trường hợp đột xuất thực sự phải báo HCNS mở "Mở khoá đặc
biệt" thủ công).

Hai điểm quan trọng: (1) mốc hiệu lực UNAUTHORIZED_ABSENCE_LEAVE_RULE_EFFECTIVE_DATE
để không áp ngược luật mới cho đơn đã tạo hợp lệ trước đó (nếu áp ngược, QLTT
sẽ "không duyệt được ngày nào"); (2) đọc start_date của CẢ NHÓM (không phải
event_date của riêng ngày đang xét) khi duyệt 1 ngày trong đơn nhiều ngày.

2 hàm cốt lõi ở deadline_utils.py:
  - leave_style_deadline(start_date, last_date, employee, ...) — gom 3 nhánh
    nhiều ngày/nửa ngày/1 ngày, dùng chung cho cả Nghỉ phép tháng lẫn Nghỉ
    không phép.
  - unauthorized_absence_uses_leave_rule(created_at) — True nếu đơn tạo TỪ
    UNAUTHORIZED_ABSENCE_LEAVE_RULE_EFFECTIVE_DATE (29/09/2026) trở đi.

2 điểm cần nhất quán (tránh lệch như case OVERTIME đã từng gặp 2026-09-23):
  1. RegistrationRequestCreateSerializer.validate() — hạn TẠO đơn (luôn theo
     leave_style_deadline, không cần gate hiệu lực vì đơn MỚI tạo từ hôm nay
     trở đi rồi).
  2. registration_views._check_approve_deadline() — hạn DUYỆT đơn (CÓ gate
     hiệu lực theo event.created_at, vì đơn CŨ có thể đã tạo hợp lệ trước
     khi đổi luật).
"""
import datetime as dt
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.utils import timezone


def _unauth_absence_data(employee_id=1, attendance_date=None, end_date=None,
                          expected_status='', half_day_period='', reason='Nghỉ không phép: test'):
    return {
        'employee_id': employee_id,
        'attendance_date': attendance_date,
        'end_date': end_date,
        'registration_type': 'UNAUTHORIZED_ABSENCE',
        'start_time': None,
        'end_time': None,
        'hours': None,
        'reason': reason,
        'status': 'PENDING',
        'expected_status': expected_status,
        'half_day_period': half_day_period,
    }


class LeaveStyleDeadlineFormulaTests(SimpleTestCase):
    """deadline_utils.leave_style_deadline() — hàm dùng chung, test trực tiếp
    không qua serializer/view để cô lập đúng công thức."""

    @patch("hrm.deadline_utils.get_shift_start_time")
    def test_nhieu_ngay_dung_leave_deadline_theo_tong_so_ngay(self, mock_shift_start):
        from hrm.deadline_utils import leave_style_deadline
        # 20-22/9 = 3 ngày -> bậc "2-3 ngày" -> trước 2 ngày làm việc
        deadline = leave_style_deadline(dt.date(2026, 9, 20), dt.date(2026, 9, 22), None)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 18))
        mock_shift_start.assert_not_called()

    def test_nua_ngay_dung_cong_thuc_4_gio_truoc_gio_vao_ca(self):
        from hrm.deadline_utils import leave_style_deadline
        emp = MagicMock()
        with patch("hrm.deadline_utils.get_shift_start_time", return_value=dt.time(8, 30)):
            deadline = leave_style_deadline(
                dt.date(2026, 9, 25), dt.date(2026, 9, 25), emp,
                expected_status="HALF_DAY", half_day_period="MORNING",
            )
        self.assertEqual(deadline, timezone.make_aware(dt.datetime(2026, 9, 25, 4, 30)))

    def test_nua_ngay_khong_xac_dinh_duoc_ca_thi_lui_ve_1_ngay_khong_tra_none(self):
        """Không trả None — lùi về mốc
        1-ngày thay vì để hạn vô hiệu."""
        from hrm.deadline_utils import leave_style_deadline
        with patch("hrm.deadline_utils.get_shift_start_time", return_value=None):
            deadline = leave_style_deadline(
                dt.date(2026, 9, 25), dt.date(2026, 9, 25), None,
                expected_status="HALF_DAY", half_day_period="MORNING",
            )
        self.assertIsNotNone(deadline)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))

    def test_ca_ngay_don_le_dung_leave_deadline_1_ngay(self):
        from hrm.deadline_utils import leave_style_deadline
        deadline = leave_style_deadline(dt.date(2026, 9, 25), dt.date(2026, 9, 25), None)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))


class UnauthorizedAbsenceUsesLeaveRuleTests(SimpleTestCase):
    def test_tao_truoc_moc_hieu_luc_dung_luat_cu(self):
        from hrm.deadline_utils import unauthorized_absence_uses_leave_rule
        created = timezone.make_aware(dt.datetime(2026, 9, 28, 13, 1))
        self.assertFalse(unauthorized_absence_uses_leave_rule(created))

    def test_tao_dung_moc_hieu_luc_dung_luat_moi(self):
        from hrm.deadline_utils import unauthorized_absence_uses_leave_rule
        created = timezone.make_aware(dt.datetime(2026, 9, 29, 0, 0, 1))
        self.assertTrue(unauthorized_absence_uses_leave_rule(created))

    def test_tao_sau_moc_hieu_luc_dung_luat_moi(self):
        from hrm.deadline_utils import unauthorized_absence_uses_leave_rule
        created = timezone.make_aware(dt.datetime(2026, 10, 5, 9, 0))
        self.assertTrue(unauthorized_absence_uses_leave_rule(created))

    def test_created_at_none_mac_dinh_dung_luat_moi(self):
        from hrm.deadline_utils import unauthorized_absence_uses_leave_rule
        self.assertTrue(unauthorized_absence_uses_leave_rule(None))


class CreateDeadlineUsesLeaveStyleDeadlineTests(SimpleTestCase):
    """RegistrationRequestCreateSerializer.validate(), nhánh UNAUTHORIZED_ABSENCE."""

    def _validate(self, data, *, now, leave_style_deadline_return=None):
        from hrm.registration_serializers import RegistrationRequestCreateSerializer

        request = MagicMock()
        request.user.is_staff = False
        request.user.is_superuser = False

        with patch("hrm.registration_serializers.Employee") as mock_employee_cls, \
             patch("hrm.registration_serializers._is_hr", return_value=False), \
             patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.deadline_utils.leave_style_deadline", return_value=leave_style_deadline_return) as mock_lsd, \
             patch("hrm.violation_models.log_blocked_attempt"), \
             patch("django.utils.timezone.now", return_value=now):
            mock_employee_cls.objects.filter.return_value.exists.return_value = True
            mock_employee_cls.objects.filter.return_value.first.return_value = MagicMock()

            serializer = RegistrationRequestCreateSerializer(data=data, context={'request': request})
            is_valid = serializer.is_valid()
            return is_valid, serializer.errors, mock_lsd

    def test_qua_han_bi_chan(self):
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 25, 9, 0))
        past_deadline = timezone.make_aware(dt.datetime(2026, 9, 24, 17, 30))
        data = _unauth_absence_data(attendance_date=dt.date(2026, 9, 25))

        is_valid, errors, mock_lsd = self._validate(data, now=tz_now, leave_style_deadline_return=past_deadline)

        self.assertFalse(is_valid)
        self.assertIn('attendance_date', errors)
        # 2 lần: snapshot mốc hạn vào đơn (data['_advance_deadline']) + kiểm tra quá hạn.
        self.assertEqual(mock_lsd.call_count, 2)
        # (attendance_date, last_date, employee, ...) — attendance_date == last_date khi không có end_date
        for call in mock_lsd.call_args_list:
            self.assertEqual(call.args[0], dt.date(2026, 9, 25))
            self.assertEqual(call.args[1], dt.date(2026, 9, 25))

    def test_con_kip_han_thi_tao_duoc(self):
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 20, 9, 0))
        future_deadline = timezone.make_aware(dt.datetime(2026, 9, 24, 17, 30))
        data = _unauth_absence_data(attendance_date=dt.date(2026, 9, 25))

        is_valid, errors, _ = self._validate(data, now=tz_now, leave_style_deadline_return=future_deadline)

        self.assertTrue(is_valid, errors)

    def test_nhieu_ngay_truyen_dung_last_date_tu_end_date(self):
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 10, 9, 0))
        future_deadline = timezone.make_aware(dt.datetime(2026, 9, 24, 17, 30))
        data = _unauth_absence_data(
            attendance_date=dt.date(2026, 9, 20), end_date=dt.date(2026, 9, 22),
        )

        is_valid, errors, mock_lsd = self._validate(data, now=tz_now, leave_style_deadline_return=future_deadline)

        self.assertTrue(is_valid, errors)
        self.assertEqual(mock_lsd.call_args.args[0], dt.date(2026, 9, 20))
        self.assertEqual(mock_lsd.call_args.args[1], dt.date(2026, 9, 22))

    def test_hcns_mo_khoa_dac_biet_van_tao_duoc_du_qua_han(self):
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 25, 9, 0))
        past_deadline = timezone.make_aware(dt.datetime(2026, 9, 24, 17, 30))
        data = _unauth_absence_data(attendance_date=dt.date(2026, 9, 25))

        with patch("hrm.registration_serializers.Employee") as mock_employee_cls, \
             patch("hrm.registration_serializers._is_hr", return_value=False), \
             patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=True), \
             patch("hrm.deadline_utils.leave_style_deadline", return_value=past_deadline), \
             patch("django.utils.timezone.now", return_value=tz_now):
            from hrm.registration_serializers import RegistrationRequestCreateSerializer
            request = MagicMock()
            request.user.is_staff = False
            request.user.is_superuser = False
            mock_employee_cls.objects.filter.return_value.exists.return_value = True
            mock_employee_cls.objects.filter.return_value.first.return_value = MagicMock()

            serializer = RegistrationRequestCreateSerializer(data=data, context={'request': request})
            is_valid = serializer.is_valid()

        self.assertTrue(is_valid, serializer.errors)


class ApproveDeadlineEffectiveDateGateTests(SimpleTestCase):
    """registration_views._check_approve_deadline(), nhánh UNAUTHORIZED_ABSENCE
    — điểm khác biệt cốt lõi so với bản nháp đầu của tôi: có gate hiệu lực
    theo event.created_at (bug thực tế 2026-09-28: nhân viên tạo đơn
    07/09 hợp lệ theo luật cũ, QLTT không duyệt được vì
    luật mới áp ngược lại)."""

    def _event(self, event_date, created_at, data_extra=None):
        return MagicMock(
            event_date=event_date,
            created_at=created_at,
            employee=MagicMock(),
            data={'registration_type': 'UNAUTHORIZED_ABSENCE', **(data_extra or {})},
        )

    def test_don_tao_truoc_moc_hieu_luc_dung_cong_thuc_cu_khong_bi_chan_nguoc(self):
        """Case thực tế: đơn tạo 07/09 (trước 29/09) cho ngày nghỉ xa trong
        tương lai — PHẢI dùng unauthorized_absence_deadline() cũ (rất rộng),
        KHÔNG được áp leave_style_deadline ngược lại."""
        from hrm.registration_views import _check_approve_deadline
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 28, 15, 0))
        event = self._event(
            dt.date(2026, 9, 30),
            timezone.make_aware(dt.datetime(2026, 9, 7, 10, 0)),
            {'end_date': '2026-10-03'},
        )

        with patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.deadline_utils.leave_style_deadline") as mock_lsd, \
             patch("hrm.deadline_utils.unauthorized_absence_deadline") as mock_old, \
             patch("django.utils.timezone.now", return_value=tz_now):
            mock_old.return_value = timezone.make_aware(dt.datetime(2026, 10, 6, 10, 0))
            reason = _check_approve_deadline(event, bypass=False)

        self.assertIsNone(reason)
        mock_lsd.assert_not_called()
        mock_old.assert_called_once_with(dt.date(2026, 10, 3), event.employee)

    def test_don_tao_tu_moc_hieu_luc_dung_leave_style_deadline(self):
        from hrm.registration_views import _check_approve_deadline
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 29, 9, 0))
        event = self._event(
            dt.date(2026, 9, 29),
            timezone.make_aware(dt.datetime(2026, 9, 29, 8, 0)),
        )

        with patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.deadline_utils.leave_style_deadline") as mock_lsd, \
             patch("hrm.deadline_utils.unauthorized_absence_deadline") as mock_old, \
             patch("django.utils.timezone.now", return_value=tz_now):
            mock_lsd.return_value = timezone.make_aware(dt.datetime(2026, 9, 30, 10, 0))
            reason = _check_approve_deadline(event, bypass=False)

        self.assertIsNone(reason)
        mock_old.assert_not_called()
        mock_lsd.assert_called_once()

    def test_doc_dung_start_date_cua_ca_nhom_khong_phai_event_date_rieng_ngay(self):
        """Duyệt ngày thứ 3 trong 1 đơn nghỉ nhiều ngày (event_date = ngày đó)
        vẫn phải tính bậc thang từ start_date lưu trong data, không phải từ
        event_date riêng của ngày đang duyệt."""
        from hrm.registration_views import _check_approve_deadline
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 29, 9, 0))
        event = self._event(
            dt.date(2026, 10, 2),  # ngày thứ 3 trong nhóm 30/9-3/10
            timezone.make_aware(dt.datetime(2026, 9, 29, 8, 0)),
            {'start_date': '2026-09-30', 'end_date': '2026-10-03'},
        )

        with patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False), \
             patch("hrm.deadline_utils.leave_style_deadline", return_value=timezone.make_aware(dt.datetime(2026, 9, 30, 10, 0))) as mock_lsd, \
             patch("django.utils.timezone.now", return_value=tz_now):
            _check_approve_deadline(event, bypass=False)

        # start_date phải là 30/9 (đầu nhóm), KHÔNG phải 2/10 (event_date riêng ngày này)
        self.assertEqual(mock_lsd.call_args.args[0], dt.date(2026, 9, 30))
        self.assertEqual(mock_lsd.call_args.args[1], dt.date(2026, 10, 3))

    def test_bypass_admin_hr_luon_bo_qua(self):
        from hrm.registration_views import _check_approve_deadline
        event = self._event(dt.date(2026, 9, 25), timezone.now())
        reason = _check_approve_deadline(event, bypass=True)
        self.assertIsNone(reason)
