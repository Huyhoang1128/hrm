"""
hrm/test_leave_retroactive_deadline.py
════════════════════════════════════════
LỊCH SỬ: bản đầu (2026-09-2x) cho phép đơn Nghỉ phép tháng tạo SAU KHI ngày
nghỉ đã qua (đột xuất, vd cấp cứu) vẫn được tạo nếu HOÀN TẤT trong vòng 3 GIỜ
kể từ giờ vào ca của ngày làm việc kế tiếp ngày nghỉ cuối cùng — thay cho việc
bị chặn cứng bởi hạn báo trước bình thường (leave_deadline).

HCNS chốt lại 2026-09-28 (văn bản "Quy định thời gian tạo đơn trên HRM", mục
II.1): BỎ HẲN cơ chế tự động nới hạn 3h này cho Nghỉ phép/Nghỉ không lương —
trường hợp đột xuất giờ phải được HCNS cấp quyền THỦ CÔNG qua "Mở khoá đặc
biệt" (has_deadline_exception), không còn tự động cho qua trong ứng dụng nữa.
Quá hạn báo trước bình thường (leave_deadline) là bị chặn thẳng, bất kể ngày
nghỉ đã qua hay chưa — taodon_views.py không còn gọi
unauthorized_absence_deadline() ở nhánh LEAVE nữa.

unauthorized_absence_deadline() BẢN THÂN HÀM vẫn giữ nguyên và vẫn được dùng
— nhưng CHỈ còn cho đúng loại đơn Nghỉ KHÔNG PHÉP (UNAUTHORIZED_ABSENCE,
registration_serializers.py/registration_views.py), vốn về bản chất luôn là
khai báo sau nên không có khái niệm "hạn báo trước" — KHÔNG áp dụng cho Nghỉ
phép/Nghỉ không lương (ExplanationType.LEAVE) nữa. Test formula của hàm này
vẫn giữ nguyên ở dưới để đảm bảo nhánh UNAUTHORIZED_ABSENCE không bị ảnh
hưởng bởi thay đổi trên.

overtime_extended_deadline() (nhóm gia hạn tăng ca) viết ĐỘC LẬP, không gọi
chung unauthorized_absence_deadline() — test lại ở đây để xác nhận formula
"10h00 cố định" của riêng tăng ca không bị đổi theo.
"""
import datetime as dt
import types
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.deadline_utils import unauthorized_absence_deadline, overtime_extended_deadline


def _make_employee(shift_start=None, has_position=True):
    return types.SimpleNamespace(
        employee_id="NV00001",
        department=None,
        manager=None,
        position=types.SimpleNamespace(title="NV", is_management=False) if has_position else None,
        saturday_afternoon_always_workday=None,
    )


class UnauthorizedAbsenceDeadlineFormulaTests(SimpleTestCase):
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    @patch("hrm.deadline_utils.get_shift_start_time")
    def test_co_ca_thi_lay_3h_sau_gio_vao_ca(self, mock_shift_start, _m):
        mock_shift_start.return_value = dt.time(8, 30)
        emp = _make_employee()
        # Thứ 4 23/09/2026 -> ngày làm việc kế tiếp là thứ 5 24/09
        deadline = unauthorized_absence_deadline(dt.date(2026, 9, 23), emp)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))
        self.assertEqual(timezone.localtime(deadline).hour, 11)  # 8h30 + 3h
        self.assertEqual(timezone.localtime(deadline).minute, 30)

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    @patch("hrm.deadline_utils.get_shift_start_time", return_value=None)
    def test_khong_xac_dinh_duoc_ca_thi_fallback_10h(self, mock_shift_start, _m):
        emp = _make_employee()
        deadline = unauthorized_absence_deadline(dt.date(2026, 9, 23), emp)
        self.assertEqual(timezone.localtime(deadline).hour, 10)
        self.assertEqual(timezone.localtime(deadline).minute, 0)

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_employee_none_thi_fallback_10h(self, _m):
        deadline = unauthorized_absence_deadline(dt.date(2026, 9, 23), None)
        self.assertEqual(timezone.localtime(deadline).hour, 10)


class OvertimeExtendedDeadlineUnaffectedTests(SimpleTestCase):
    """overtime_extended_deadline() không còn dùng chung hàm với nghỉ không
    phép nữa — vẫn phải giữ nguyên 10h00 cố định dù đơn nghỉ không phép đã
    đổi công thức."""

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    @patch("hrm.deadline_utils.get_shift_start_time")
    def test_van_la_10h_co_dinh_du_co_ca_cau_hinh(self, mock_shift_start, _m):
        mock_shift_start.return_value = dt.time(8, 30)  # nếu còn dùng chung sẽ ra 11h30
        emp = _make_employee()
        deadline = overtime_extended_deadline(dt.date(2026, 9, 23), emp)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))
        self.assertEqual(timezone.localtime(deadline).hour, 10)
        mock_shift_start.assert_not_called()


def _leave_request(employee_id=1, attendance_date=None, end_date=None, expected_status='ABSENT',
                    half_day_period='', reason=''):
    return {
        'employee_id': employee_id,
        'attendance_date': attendance_date,
        'end_date': end_date,
        'original_status': 'PRESENT',
        'expected_status': expected_status,
        'explanation_type': 'LEAVE',
        'reason': reason,
        'half_day_period': half_day_period,
        'status': 'PENDING',
    }


class LeaveNoRetroactiveGraceTests(SimpleTestCase):
    """ExplanationEventCreateSerializer.validate(), nhánh LEAVE — từ
    2026-09-28: quá hạn báo trước bình thường (leave_deadline) là bị chặn
    thẳng, KHÔNG còn tự động nới thêm 3h dù ngày nghỉ đã ở quá khứ. Trường
    hợp đột xuất phải qua HCNS cấp "Mở khoá đặc biệt" thủ công
    (has_deadline_exception) — test riêng ở cuối class này."""

    def _validate(self, data, *, now, is_hr=False, has_exception=False):
        from hrm.taodon_views import ExplanationEventCreateSerializer

        request = MagicMock()
        request.user.is_staff = False
        request.user.is_superuser = False

        fake_employee = MagicMock()
        with patch("hrm.taodon_views.Employee") as mock_employee_cls, \
             patch("hrm.taodon_views.CompanyConfig") as mock_cfg_cls, \
             patch("hrm.taodon_views.EmployeeEvent") as mock_event_cls, \
             patch("hrm.taodon_views._is_hr", return_value=is_hr), \
             patch("hrm.deadline_utils.is_locked_effective", return_value=True), \
             patch("hrm.deadline_utils.in_backlog_grace_period", return_value=False), \
             patch("hrm.deadline_exception_models.has_deadline_exception", return_value=has_exception), \
             patch("django.utils.timezone.now", return_value=now):
            mock_employee_cls.objects.filter.return_value.exists.return_value = True
            mock_employee_cls.objects.filter.return_value.first.return_value = fake_employee
            mock_cfg_cls.objects.filter.return_value.order_by.return_value.first.return_value = None
            mock_event_cls.objects.filter.return_value = []
            mock_event_cls.EventType.EXPLANATION = "EXPLANATION"

            serializer = ExplanationEventCreateSerializer(data=data, context={'request': request})
            is_valid = serializer.is_valid()
            return is_valid, serializer.errors

    @patch("hrm.deadline_utils.unauthorized_absence_deadline")
    @patch("hrm.deadline_utils.leave_deadline")
    def test_ngay_nghi_da_qua_va_qua_han_bao_truoc_bi_chan_khong_con_noi_3h(
        self, mock_leave_deadline, mock_retro_deadline,
    ):
        """Ngày nghỉ 20/09 (đã qua so với 'hôm nay' 25/09), hạn báo trước
        bình thường đã hết — TRƯỚC ĐÂY còn được nới 3h, NAY bị chặn thẳng.
        unauthorized_absence_deadline() không còn được gọi ở nhánh này nữa."""
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 25, 9, 0))
        mock_leave_deadline.return_value = timezone.make_aware(dt.datetime(2026, 9, 19, 17, 30))

        data = _leave_request(attendance_date=dt.date(2026, 9, 20))
        is_valid, errors = self._validate(data, now=tz_now)

        self.assertFalse(is_valid)
        self.assertIn('attendance_date', errors)
        mock_retro_deadline.assert_not_called()

    @patch("hrm.deadline_utils.unauthorized_absence_deadline")
    @patch("hrm.deadline_utils.leave_deadline")
    def test_ngay_nghi_tuong_lai_qua_han_bao_truoc_van_bi_chan(
        self, mock_leave_deadline, mock_retro_deadline,
    ):
        """Ngày nghỉ 30/09 (TƯƠNG LAI so với hôm nay 25/09) nhưng hạn báo
        trước đã qua (nộp trễ cho kỳ nghỉ có kế hoạch) — bị chặn như cũ,
        hành vi này không đổi."""
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 25, 9, 0))
        mock_leave_deadline.return_value = timezone.make_aware(dt.datetime(2026, 9, 24, 17, 30))

        data = _leave_request(attendance_date=dt.date(2026, 9, 30))
        is_valid, errors = self._validate(data, now=tz_now)

        self.assertFalse(is_valid)
        self.assertIn('attendance_date', errors)
        mock_retro_deadline.assert_not_called()

    @patch("hrm.deadline_utils.unauthorized_absence_deadline")
    @patch("hrm.deadline_utils.leave_deadline")
    def test_con_kip_han_bao_truoc_thi_tao_duoc_binh_thuong(
        self, mock_leave_deadline, mock_retro_deadline,
    ):
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 15, 9, 0))
        mock_leave_deadline.return_value = timezone.make_aware(dt.datetime(2026, 9, 24, 17, 30))

        data = _leave_request(attendance_date=dt.date(2026, 9, 25))
        is_valid, errors = self._validate(data, now=tz_now)

        self.assertTrue(is_valid, errors)
        mock_retro_deadline.assert_not_called()

    @patch("hrm.deadline_utils.unauthorized_absence_deadline")
    @patch("hrm.deadline_utils.leave_deadline")
    def test_nghi_nhieu_ngay_da_qua_han_van_bi_chan(
        self, mock_leave_deadline, mock_retro_deadline,
    ):
        """Đơn nhiều ngày (multiday), ngày kết thúc đã qua và hết hạn báo
        trước — bị chặn thẳng, không còn xét retroactive theo end_date nữa."""
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 25, 9, 0))
        mock_leave_deadline.return_value = timezone.make_aware(dt.datetime(2026, 9, 10, 17, 30))

        data = _leave_request(attendance_date=dt.date(2026, 9, 18), end_date=dt.date(2026, 9, 20))
        is_valid, errors = self._validate(data, now=tz_now)

        self.assertFalse(is_valid)
        self.assertIn('attendance_date', errors)
        mock_retro_deadline.assert_not_called()

    @patch("hrm.deadline_utils.unauthorized_absence_deadline")
    @patch("hrm.deadline_utils.leave_deadline")
    def test_hcns_mo_khoa_dac_biet_thi_tao_duoc_du_qua_han(
        self, mock_leave_deadline, mock_retro_deadline,
    ):
        """Trường hợp đột xuất: HCNS đã cấp 'Mở khoá đặc biệt'
        (has_deadline_exception=True) cho đúng NV/ngày này — tạo được dù đã
        quá hạn báo trước, đây là con đường DUY NHẤT còn lại cho case đột
        xuất (thay cho cơ chế tự động 3h đã bị bỏ)."""
        tz_now = timezone.make_aware(dt.datetime(2026, 9, 25, 9, 0))
        mock_leave_deadline.return_value = timezone.make_aware(dt.datetime(2026, 9, 19, 17, 30))

        data = _leave_request(attendance_date=dt.date(2026, 9, 20))
        is_valid, errors = self._validate(data, now=tz_now, has_exception=True)

        self.assertTrue(is_valid, errors)
        mock_leave_deadline.assert_not_called()
        mock_retro_deadline.assert_not_called()
