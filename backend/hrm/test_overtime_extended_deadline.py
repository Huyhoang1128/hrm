"""
Hạn TẠO và DUYỆT đơn tăng ca — luật HCNS chốt 2026-09-24.

Chỉ còn 2 mốc, và cùng 1 mốc áp cho CẢ lúc tạo lẫn lúc duyệt:

  • Nhóm được gia hạn -> 10h00 sáng NGÀY LÀM VIỆC kế tiếp.
  • Mọi người khác    -> trước 2 GIỜ so với giờ bắt đầu tăng ca.

Đối tượng được gia hạn là DỮ LIỆU, không phải code: cờ
`Position.overtime_grace_deadline_enabled` (cả 1 vị trí — Điều dưỡng, Điều
dưỡng Trưởng, TLHA, Leader TLHA) HOẶC cờ
`Employee.overtime_extended_deadline_enabled` (đúng 1 người — hiện chưa bật
cho ai, để sẵn cho ngoại lệ lẻ). Các bản trước hard-code danh sách chức danh
tiếng Việt trong
deadline_utils.py và phải sửa code + deploy mỗi lần HCNS đổi ý (4 lần trong 2
tuần) — nay HCNS tự bật/tắt trong Django admin.

CHỐT LẠI 2026-09-26: bỏ hẳn ngoại lệ gia hạn trên — MỌI vị trí (kể cả Điều
dưỡng/TLHA) đều theo đúng 1 mốc "trước 2 giờ" kể từ đơn có attendance_date >=
OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM (2026-09-26). Đơn của NGÀY TRƯỚC mốc
này vẫn theo hạn gia hạn cũ (10h sáng hôm sau) — xem `CutoverTests` — để
không cắt ngang hạn mà nhóm này đang cần dùng nốt cho đơn của ngày hôm trước.

Không cần DB thật: dùng SimpleNamespace + mock HolidayConfig.objects.filter
(rỗng) để next_working_day() không lỗi khi truyền employee.
"""
import datetime as dt
import types
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from hrm.deadline_utils import (
    is_overtime_extended_deadline_eligible,
    overtime_extended_deadline,
    overtime_deadline_for,
    OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM,
)


def _make_employee(position_flag=False, employee_flag=False, has_position=True):
    position = types.SimpleNamespace(
        title="Content Tiktok",
        is_management=False,
        overtime_grace_deadline_enabled=position_flag,
    ) if has_position else None
    return types.SimpleNamespace(
        employee_id="NV00001",
        department=None,
        manager=None,
        position=position,
        overtime_extended_deadline_enabled=employee_flag,
        saturday_afternoon_always_workday=None,
    )


class EligibilityTests(SimpleTestCase):
    def test_cờ_ở_vị_trí_thì_được_gia_hạn(self):
        self.assertTrue(is_overtime_extended_deadline_eligible(_make_employee(position_flag=True)))

    def test_cờ_riêng_của_nhân_viên_thì_được_gia_hạn(self):
        """Ngoại lệ lẻ: cả vị trí KHÔNG được gia hạn nhưng riêng người này được
        HCNS xét. Hiện chưa bật cho ai trên dữ liệu thật."""
        self.assertTrue(is_overtime_extended_deadline_eligible(
            _make_employee(position_flag=False, employee_flag=True)))

    def test_không_cờ_nào_thì_không_được_gia_hạn(self):
        self.assertFalse(is_overtime_extended_deadline_eligible(_make_employee()))

    def test_không_có_vị_trí_vẫn_không_lỗi(self):
        self.assertFalse(is_overtime_extended_deadline_eligible(_make_employee(has_position=False)))
        self.assertFalse(is_overtime_extended_deadline_eligible(None))

    def test_không_còn_xét_theo_tên_chức_danh(self):
        """Chốt hẳn thay đổi thiết kế: chức danh không còn quyết định gì cả —
        cùng title 'Điều dưỡng' nhưng không bật cờ thì vẫn theo mốc 2 giờ.
        Tránh lỗi so chuỗi unicode NFD từng làm NV rơi khỏi mọi danh sách."""
        emp = _make_employee()
        emp.position.title = "Điều dưỡng"
        self.assertFalse(is_overtime_extended_deadline_eligible(emp))


class DeadlineTests(SimpleTestCase):
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_gia_hạn_là_10h_sáng_ngày_làm_việc_kế_tiếp(self, _m):
        emp = _make_employee(position_flag=True)
        # Thứ 4 23/09/2026 -> ngày làm việc kế tiếp là thứ 5 24/09
        deadline = overtime_extended_deadline(dt.date(2026, 9, 23), emp)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))
        self.assertEqual(timezone.localtime(deadline).hour, 10)

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_gia_hạn_nhảy_qua_chủ_nhật(self, _m):
        emp = _make_employee(position_flag=True)
        # Thứ 7 26/09/2026 -> bỏ qua Chủ nhật 27/09, sang thứ 2 28/09
        deadline = overtime_extended_deadline(dt.date(2026, 9, 26), emp)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 28))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_overtime_deadline_for_trả_đúng_2_nhánh(self, _m):
        ngày, giờ_bắt_đầu = dt.date(2026, 9, 23), dt.time(18, 0)

        deadline, is_extended = overtime_deadline_for(ngày, giờ_bắt_đầu, _make_employee(position_flag=True))
        self.assertTrue(is_extended)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))

        deadline, is_extended = overtime_deadline_for(ngày, giờ_bắt_đầu, _make_employee())
        self.assertFalse(is_extended)
        self.assertEqual(timezone.localtime(deadline).hour, 16)  # 18h - 2h

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_gia_hạn_không_cần_giờ_bắt_đầu(self, _m):
        """Nhóm được gia hạn tính hạn theo NGÀY nên thiếu giờ bắt đầu vẫn ra
        được hạn; nhóm thường thì không (caller phải bắt người dùng nhập giờ)."""
        deadline, _ = overtime_deadline_for(dt.date(2026, 9, 23), None, _make_employee(position_flag=True))
        self.assertIsNotNone(deadline)

        deadline, _ = overtime_deadline_for(dt.date(2026, 9, 23), None, _make_employee())
        self.assertIsNone(deadline)


class CutoverTests(SimpleTestCase):
    """HCNS chốt lại 2026-09-26: bỏ hẳn ngoại lệ gia hạn, MỌI vị trí theo mốc
    "trước 2 giờ" kể từ attendance_date >= OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM.
    Đơn của ngày TRƯỚC mốc này vẫn phải giữ nguyên hạn gia hạn cũ (10h sáng hôm
    sau) — nhóm này còn đang hoàn thiện nốt đơn của ngày hôm trước tới đúng
    hạn cũ, không được cắt ngang."""

    def test_mốc_chặn_đúng_ngày_26_09_2026(self):
        self.assertEqual(OVERTIME_EXTENDED_DEADLINE_REMOVED_FROM, dt.date(2026, 9, 26))

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_đơn_trước_mốc_vẫn_được_gia_hạn(self, _m):
        """Thứ 4 23/09 (trước mốc 26/09) — nhóm gia hạn vẫn theo hạn cũ 10h
        sáng ngày làm việc kế tiếp (24/09), đúng cái họ đang cần dùng nốt cho
        các đơn phát sinh trước ngày đổi luật."""
        emp = _make_employee(position_flag=True)
        deadline, is_extended = overtime_deadline_for(dt.date(2026, 9, 23), dt.time(18, 0), emp)
        self.assertTrue(is_extended)
        self.assertEqual(deadline.date(), dt.date(2026, 9, 24))
        self.assertEqual(timezone.localtime(deadline).hour, 10)

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_đơn_từ_mốc_trở_đi_không_còn_gia_hạn(self, _m):
        """Từ 26/09 trở đi, dù cờ gia hạn vẫn bật, phải rơi về mốc 2 giờ như
        mọi vị trí khác."""
        emp = _make_employee(position_flag=True)
        deadline, is_extended = overtime_deadline_for(dt.date(2026, 9, 26), dt.time(18, 0), emp)
        self.assertFalse(is_extended)
        self.assertEqual(timezone.localtime(deadline).hour, 16)  # 18h - 2h

    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_cờ_nhân_viên_riêng_cũng_hết_hiệu_lực_từ_mốc(self, _m):
        emp = _make_employee(employee_flag=True)
        deadline, is_extended = overtime_deadline_for(dt.date(2026, 9, 26), dt.time(18, 0), emp)
        self.assertFalse(is_extended)
        self.assertEqual(timezone.localtime(deadline).hour, 16)

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_duyệt_đơn_từ_mốc_trở_đi_cũng_không_còn_gia_hạn(self, _m1, _m2):
        """_check_approve_deadline phải theo đúng cutover — đơn attendance_date
        26/09 duyệt lúc 9h sáng 27/09 (từng được phép khi còn gia hạn) nay phải
        bị chặn vì đã quá mốc 2 giờ từ lâu."""
        from hrm.registration_views import _check_approve_deadline
        event = types.SimpleNamespace(
            employee=_make_employee(position_flag=True),
            event_date=dt.date(2026, 9, 26),
            check_in=dt.time(18, 0),
            data={"registration_type": "OVERTIME"},
        )
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 27, 9, 0))):
            self.assertIsNotNone(_check_approve_deadline(event, bypass=False))


class ApproveDeadlineTests(SimpleTestCase):
    """_check_approve_deadline() phải dùng ĐÚNG mốc như lúc tạo đơn.

    Bản 2026-09-23 siết hạn DUYỆT về 2 giờ cho mọi vị trí trong khi hạn TẠO
    vẫn theo bậc cũ — nhóm được gia hạn tạo được đơn nhưng QLTT không duyệt
    nổi, dồn hết sang HCNS. Nhóm test này khoá lại cái lệch đó.
    """

    def _event(self, requester, event_date, check_in=dt.time(18, 0)):
        return types.SimpleNamespace(
            employee=requester,
            event_date=event_date,
            check_in=check_in,
            data={"registration_type": "OVERTIME"},
        )

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_thường_bị_chặn_trong_vòng_2_giờ(self, _m1, _m2):
        from hrm.registration_views import _check_approve_deadline
        event = self._event(_make_employee(), dt.date(2026, 9, 23))
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 23, 17, 0))):
            err = _check_approve_deadline(event, bypass=False)
        self.assertIsNotNone(err)
        self.assertIn("2 giờ", err)

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_thường_duyệt_sớm_hơn_2_giờ_thì_được(self, _m1, _m2):
        from hrm.registration_views import _check_approve_deadline
        event = self._event(_make_employee(), dt.date(2026, 9, 23))
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 23, 15, 0))):
            self.assertIsNone(_check_approve_deadline(event, bypass=False))

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_gia_hạn_duyệt_được_tới_10h_sáng_hôm_sau(self, _m1, _m2):
        """Đây chính là hồi quy mà bản 23/09 gây ra: cùng thời điểm này nhóm
        gia hạn từng bị chặn dù luật cho phép."""
        from hrm.registration_views import _check_approve_deadline
        for emp in (_make_employee(position_flag=True),
                    _make_employee(employee_flag=True)):
            event = self._event(emp, dt.date(2026, 9, 23))
            # 9h sáng hôm sau — quá mốc 2 giờ từ lâu nhưng chưa tới 10h
            with patch("django.utils.timezone.now",
                       return_value=timezone.make_aware(dt.datetime(2026, 9, 24, 9, 0))):
                self.assertIsNone(_check_approve_deadline(event, bypass=False))

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_nhóm_gia_hạn_quá_10h_sáng_hôm_sau_thì_bị_chặn(self, _m1, _m2):
        from hrm.registration_views import _check_approve_deadline
        event = self._event(_make_employee(position_flag=True), dt.date(2026, 9, 23))
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 24, 10, 30))):
            self.assertIsNotNone(_check_approve_deadline(event, bypass=False))

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_xét_theo_vị_trí_CHỦ_ĐƠN_không_phải_người_duyệt(self, _m1, _m2):
        """Việc duyệt do QLTT làm hộ nhân viên — cờ gia hạn phải lấy theo chủ
        đơn, không phải theo người bấm duyệt."""
        from hrm.registration_views import _check_approve_deadline
        chủ_đơn = _make_employee(position_flag=True)
        chủ_đơn.manager = _make_employee()  # QLTT không được gia hạn
        event = self._event(chủ_đơn, dt.date(2026, 9, 23))
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 24, 9, 0))):
            self.assertIsNone(_check_approve_deadline(event, bypass=False))

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_HCNS_admin_luôn_bypass(self, _m1, _m2):
        from hrm.registration_views import _check_approve_deadline
        event = self._event(_make_employee(), dt.date(2026, 9, 23))
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 24, 9, 0))):
            self.assertIsNone(_check_approve_deadline(event, bypass=True))
            self.assertIsNotNone(_check_approve_deadline(event, bypass=False))

    @patch("hrm.deadline_exception_models.has_deadline_exception", return_value=False)
    @patch("hrm.models.HolidayConfig.objects.filter", return_value=[])
    def test_đơn_cũ_không_có_giờ_bắt_đầu_không_bị_chặn_hồi_tố(self, _m1, _m2):
        from hrm.registration_views import _check_approve_deadline
        event = self._event(_make_employee(), dt.date(2026, 9, 23), check_in=None)
        with patch("django.utils.timezone.now",
                   return_value=timezone.make_aware(dt.datetime(2026, 9, 24, 9, 0))):
            self.assertIsNone(_check_approve_deadline(event, bypass=False))
