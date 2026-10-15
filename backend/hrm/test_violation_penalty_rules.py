"""Luật phạt quanh đơn nghỉ: ai ra tiền, ai chỉ cảnh báo, và vì sao.

Toàn bộ cơ chế phạt 500.000 đ/lần (hiệu lực 14/10/2026) trước đó KHÔNG có một
test nào — 454 test của repo không đụng tới `violation_report_views.py`,
`penalty_config.py` hay `violation_ledger.py`. Mà đây là code quyết định tiền
phạt của người thật, và đã từng sai nặng: đảo chiều mặc định cờ Chủ nhật làm
tháng 9/2026 nhảy từ 210 lên 1.038 dòng (483 triệu tiền phạt ảo).

Cố ý dùng SimpleTestCase: các luật dưới đây là hàm thuần, không cần DB, nên
test chạy mili-giây và không mục theo thời gian như mấy test hardcode tháng 9.
"""
import datetime as dt
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm import penalty_config as pc
from hrm.violation_ledger import _hash_row, months_in_range
from hrm.violation_report_views import (
    EMPLOYEE_FAULTS,
    NON_COVERING_EVENT_TYPES,
    OVERTIME,
    PAID_LEAVE,
    REPORTED_REQUEST_TYPES,
    TYPE_LABEL,
    UNPAID_LEAVE,
    VIOLATION_LABEL,
    VIOLATION_PRIORITY,
    LeaveViolationReportView,
)

EFF = dt.date(2026, 10, 13)


def _row(**kw):
    base = {
        "violation_code": "NO_REQUEST",
        "fault_side": "EMPLOYEE",
        "event_date": "2026-10-20",
        "responsible_id": 7,
        "has_grant": False,
        "had_blocked_attempt": False,
    }
    base.update(kw)
    return base


class DecidePenaltyTests(SimpleTestCase):
    """Thứ tự xét trong decide_penalty — đổi thứ tự là đổi tiền của người thật."""

    def test_loi_ra_tien_thi_ra_dung_500k(self):
        amount, reason = pc.decide_penalty(_row(), effective_date=EFF)
        self.assertEqual(amount, 500_000)
        self.assertEqual(reason, pc.REASON_CHARGED)

    def test_truoc_ngay_hieu_luc_thi_khong_ra_tien(self):
        amount, reason = pc.decide_penalty(
            _row(event_date="2026-10-12"), effective_date=EFF)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_BEFORE_EFFECTIVE)

    def test_dung_ngay_hieu_luc_la_da_tinh(self):
        """Biên phải tính vào, không phải "sau ngày hiệu lực"."""
        amount, _ = pc.decide_penalty(_row(event_date="2026-10-13"), effective_date=EFF)
        self.assertEqual(amount, 500_000)

    def test_tao_don_qua_han_chi_canh_bao(self):
        amount, reason = pc.decide_penalty(
            _row(violation_code="LATE_CREATED"), effective_date=EFF)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_WARN_ONLY)

    def test_chi_co_don_nua_ngay_chi_canh_bao(self):
        amount, reason = pc.decide_penalty(
            _row(violation_code="HALF_DAY_ONLY"), effective_date=EFF)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_WARN_ONLY)

    def test_da_mo_khoa_thi_khong_tu_ra_tien_nhung_van_co_dong(self):
        """Mở khoá đặc biệt = hệ thống ĐÃ CHO PHÉP làm muộn -> 0 đ.

        Trước 2026-10-12 dòng này bị xoá hẳn khỏi báo cáo (45 dòng T9 + 57 dòng
        T10 biến mất). Nay chỉ hạ về cảnh báo, vì mở khoá chính là đường dùng
        để cứu trưởng phòng quên duyệt nên phải nhìn thấy được.
        """
        amount, reason = pc.decide_penalty(
            _row(violation_code="NOT_APPROVED", fault_side="MANAGER", has_grant=True),
            effective_date=EFF)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_HAD_GRANT)

    def test_da_bam_tao_don_nhung_bi_chan_thi_khong_phat(self):
        amount, reason = pc.decide_penalty(
            _row(had_blocked_attempt=True), effective_date=EFF)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_HAD_ATTEMPT)

    def test_bi_chan_duoc_xet_TRUOC_mo_khoa(self):
        """Cả hai cùng đúng thì lý do hiện ra phải là "đã cố tạo đơn"."""
        _, reason = pc.decide_penalty(
            _row(had_blocked_attempt=True, has_grant=True), effective_date=EFF)
        self.assertEqual(reason, pc.REASON_HAD_ATTEMPT)

    def test_khong_xac_dinh_duoc_nguoi_chiu_trach_nhiem(self):
        amount, reason = pc.decide_penalty(_row(responsible_id=None), effective_date=EFF)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_NO_RESPONSIBLE)

    def test_cung_mot_don_chi_tinh_1_lan(self):
        """Đơn nghỉ 15 ngày mà tính theo ngày thì 1 lần bấm duyệt muộn = 7,5 triệu."""
        amount, reason = pc.decide_penalty(
            _row(violation_code="APPROVED_LATE", fault_side="MANAGER"),
            effective_date=EFF, is_duplicate_of_request=True)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_SAME_REQUEST)

    def test_nghi_lien_ngay_chi_tinh_o_ngay_dau_dot(self):
        amount, reason = pc.decide_penalty(
            _row(), effective_date=EFF, is_consecutive_followup=True)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_CONSECUTIVE)

    def test_chua_cau_hinh_ngay_hieu_luc_thi_khong_dong_nao(self):
        amount, reason = pc.decide_penalty(_row(), effective_date=None)
        self.assertEqual(amount, 0)
        self.assertEqual(reason, pc.REASON_NOT_CONFIGURED)

    def test_moi_ly_do_deu_co_nhan_tieng_Viet(self):
        """Thiếu nhãn thì giao diện hiện mã trần trên cột tiền."""
        for reason in (pc.REASON_CHARGED, pc.REASON_NOT_CONFIGURED,
                       pc.REASON_BEFORE_EFFECTIVE, pc.REASON_WARN_ONLY,
                       pc.REASON_HAD_ATTEMPT, pc.REASON_SAME_REQUEST,
                       pc.REASON_CONSECUTIVE, pc.REASON_NO_RESPONSIBLE,
                       pc.REASON_HAD_GRANT, pc.REASON_APPLIED_BY_HR,
                       pc.REASON_WAIVED_BY_HR):
            self.assertIn(reason, pc.REASON_LABEL, reason)


class ViolationCodeConsistencyTests(SimpleTestCase):
    def test_moi_ma_loi_deu_co_nhan_va_do_uu_tien(self):
        for code in VIOLATION_LABEL:
            self.assertIn(code, VIOLATION_PRIORITY, code)

    def test_khong_ma_nao_vua_ra_tien_vua_chi_canh_bao(self):
        self.assertFalse(pc.PENALTY_CODES & pc.WARN_ONLY_CODES)

    def test_moi_ma_deu_duoc_phan_loai(self):
        self.assertEqual(set(VIOLATION_LABEL), pc.PENALTY_CODES | pc.WARN_ONLY_CODES)

    def test_lo_hong_don_che_ca_ngay_chi_bit_dung_tang_ca(self):
        """CỐ Ý không chặn online_work/off_duty: đó là đi làm thật mà không có
        lượt quẹt nào, bỏ che là phạt oan người đã khai báo tử tế (53 ngày)."""
        self.assertIn("overtime", NON_COVERING_EVENT_TYPES)
        for safe in ("online_work", "off_duty", "explanation", "attendance"):
            self.assertNotIn(safe, NON_COVERING_EVENT_TYPES, safe)

    def test_nua_ngay_la_loi_nhan_vien(self):
        self.assertIn("HALF_DAY_ONLY", EMPLOYEE_FAULTS)


class AfternoonRestTests(SimpleTestCase):
    """Chiều thứ 7 tuần 2/4 — thiếu luật này thì HALF_DAY_ONLY phạt oan 44 dòng."""

    def _emp(self, emp_flag=None, dept_flag=False):
        emp = MagicMock()
        emp.saturday_afternoon_always_workday = emp_flag
        emp.department.saturday_afternoon_always_workday = dept_flag
        return emp

    def test_thu_7_tuan_2_va_4_mac_dinh_la_gio_nghi(self):
        for d in (dt.date(2026, 9, 12), dt.date(2026, 9, 26)):
            self.assertTrue(
                LeaveViolationReportView._afternoon_is_rest(self._emp(), d), d)

    def test_thu_7_tuan_1_va_3_van_la_gio_lam(self):
        for d in (dt.date(2026, 9, 5), dt.date(2026, 9, 19)):
            self.assertFalse(
                LeaveViolationReportView._afternoon_is_rest(self._emp(), d), d)

    def test_phong_bat_co_lam_moi_tuan_thi_khong_phai_gio_nghi(self):
        """CSKH/Kinh doanh đang bật cờ này và thực tế có 26-72 người đi làm."""
        self.assertFalse(LeaveViolationReportView._afternoon_is_rest(
            self._emp(dept_flag=True), dt.date(2026, 9, 26)))

    def test_cai_dat_rieng_cua_nhan_vien_de_len_cai_dat_phong(self):
        self.assertTrue(LeaveViolationReportView._afternoon_is_rest(
            self._emp(emp_flag=False, dept_flag=True), dt.date(2026, 9, 26)))
        self.assertFalse(LeaveViolationReportView._afternoon_is_rest(
            self._emp(emp_flag=True, dept_flag=False), dt.date(2026, 9, 26)))

    def test_ngay_thuong_khong_bao_gio_la_gio_nghi_chieu(self):
        self.assertFalse(LeaveViolationReportView._afternoon_is_rest(
            self._emp(), dt.date(2026, 9, 24)))


class LedgerHashTests(SimpleTestCase):
    """Băm nội dung quyết định khi nào sổ ghi bản mới."""

    def test_cung_noi_dung_thi_cung_ma(self):
        self.assertEqual(_hash_row(_row(penalty_amount=0)),
                         _hash_row(_row(penalty_amount=0)))

    def test_doi_tien_phat_thi_doi_ma(self):
        self.assertNotEqual(_hash_row(_row(penalty_amount=0)),
                            _hash_row(_row(penalty_amount=500_000)))

    def test_doi_ly_do_thi_doi_ma(self):
        self.assertNotEqual(_hash_row(_row(penalty_reason="WARN_ONLY")),
                            _hash_row(_row(penalty_reason="APPLIED_BY_HR")))

    def test_truong_doi_theo_thoi_diem_chay_KHONG_lam_doi_ma(self):
        """Nếu không thì chạy lại lần nào cũng đẻ bản ghi mới, sổ phình vô ích."""
        self.assertEqual(_hash_row(_row(generated_at="2026-10-12T08:00:00")),
                         _hash_row(_row(generated_at="2026-10-13T09:30:00")))


class MonthsInRangeTests(SimpleTestCase):
    """Đợt nạp chấm công vắt qua giao tháng phải chạy lại cả hai tháng."""

    def test_trong_mot_thang(self):
        self.assertEqual(months_in_range(dt.date(2026, 9, 1), dt.date(2026, 9, 30)),
                         [(2026, 9)])

    def test_vat_qua_hai_thang(self):
        self.assertEqual(months_in_range(dt.date(2026, 9, 28), dt.date(2026, 10, 2)),
                         [(2026, 9), (2026, 10)])

    def test_vat_qua_giao_nam(self):
        self.assertEqual(months_in_range(dt.date(2026, 12, 15), dt.date(2027, 1, 5)),
                         [(2026, 12), (2027, 1)])


class RecomputedDeadlineTests(SimpleTestCase):
    """Tính lại hạn cho đơn KHÔNG có snapshot (66% đơn nghỉ rơi vào diện này).

    Phải tôn trọng PHIÊN BẢN LUẬT lúc tạo đơn, nếu không là lặp lại sự cố
    28/09/2026: đơn tạo hợp lệ theo luật cũ bị báo quá hạn hàng loạt.
    """

    def _ev(self, event_date=dt.date(2026, 9, 25)):
        ev = MagicMock()
        ev.event_date = event_date
        ev.employee = MagicMock()
        return ev

    def test_don_nghi_khong_phep_tao_TRUOC_29_09_dung_luat_cu(self):
        created = dt.datetime(2026, 9, 10, 9, 0, tzinfo=dt.timezone.utc)
        with patch("hrm.deadline_utils.unauthorized_absence_deadline") as old_rule, \
             patch("hrm.deadline_utils.leave_style_deadline") as new_rule:
            LeaveViolationReportView()._recomputed_deadline(
                self._ev(), {"request_code": "KP-1"}, "UNAUTHORIZED_ABSENCE",
                created, {})
        old_rule.assert_called_once()
        new_rule.assert_not_called()

    def test_don_nghi_khong_phep_tao_TU_29_09_dung_luat_nghi_phep(self):
        created = dt.datetime(2026, 10, 1, 9, 0, tzinfo=dt.timezone.utc)
        with patch("hrm.deadline_utils.unauthorized_absence_deadline") as old_rule, \
             patch("hrm.deadline_utils.leave_style_deadline") as new_rule:
            LeaveViolationReportView()._recomputed_deadline(
                self._ev(), {"request_code": "KP-1"}, "UNAUTHORIZED_ABSENCE",
                created, {})
        new_rule.assert_called_once()
        old_rule.assert_not_called()

    def test_don_nhieu_ngay_dung_khoang_ngay_THAT_cua_ca_don(self):
        """Lấy ngày của riêng 1 event thì đơn 5 ngày bị tính như đơn 1 ngày."""
        spans = {"KP-9": (dt.date(2026, 9, 20), dt.date(2026, 9, 24))}
        with patch("hrm.deadline_utils.leave_style_deadline") as new_rule:
            LeaveViolationReportView()._recomputed_deadline(
                self._ev(dt.date(2026, 9, 22)), {"request_code": "KP-9"},
                "LEAVE", None, spans)
        self.assertEqual(new_rule.call_args.args[0], dt.date(2026, 9, 20))
        self.assertEqual(new_rule.call_args.args[1], dt.date(2026, 9, 24))

    def test_tra_None_khi_khong_tra_duoc_gio_ca(self):
        """Thà không kết luận còn hơn kết luận sai — dòng này dính tiền."""
        with patch("hrm.deadline_utils.leave_style_deadline",
                   side_effect=ValueError("khong co ca")):
            out = LeaveViolationReportView()._recomputed_deadline(
                self._ev(), {}, "LEAVE", None, {})
        self.assertIsNone(out)


class OvertimeViolationTests(SimpleTestCase):
    """Tăng ca vào bảng từ 2026-10-14 — hạn KHÁC HẲN đơn nghỉ.

    Phải tạo VÀ duyệt xong trước 2 GIỜ so với giờ bắt đầu ca. Mốc "10h sáng
    hôm sau" mà nhiều người nhớ là hạn QLTT SỬA GIỜ của đơn đã có, không phải
    hạn tạo/duyệt — nhầm hai cái này là tính sai tiền của quản lý.
    """

    def _ev(self, check_in=dt.time(17, 0), event_date=dt.date(2026, 10, 13)):
        ev = MagicMock()
        ev.event_date = event_date
        ev.check_in = check_in
        ev.employee = MagicMock()
        return ev

    def test_tang_ca_co_nhan_va_duoc_phan_loai(self):
        self.assertIn(OVERTIME, TYPE_LABEL)

    def test_tang_ca_dang_AN_HAN_khoi_bang(self):
        """HCNS 2026-10-14: "bạn cứ ẩn hẳn cả cảnh báo nhé".

        Toàn bộ phần tính hạn/gộp dòng cho tăng ca vẫn giữ (các test dưới vẫn
        chạy) để bật lại chỉ cần thêm OVERTIME vào REPORTED_REQUEST_TYPES.
        """
        self.assertNotIn(OVERTIME, REPORTED_REQUEST_TYPES)
        self.assertEqual(REPORTED_REQUEST_TYPES,
                         frozenset({PAID_LEAVE, UNPAID_LEAVE}))

    def test_tang_ca_KHONG_tu_ra_tien(self):
        """HCNS 2026-10-14: "bỏ cái phạt liên quan đến tăng ca đi đã".
        Dòng vẫn hiện để đối soát, nhưng mức phạt phải là 0."""
        for code in ("NOT_APPROVED", "APPROVED_LATE"):
            amount, reason = pc.decide_penalty(
                _row(violation_code=code, fault_side="MANAGER",
                     request_type=OVERTIME),
                effective_date=EFF)
            self.assertEqual(amount, 0, code)
            self.assertEqual(reason, pc.REASON_TYPE_NOT_CHARGED, code)

    def test_don_nghi_cung_ma_loi_thi_VAN_ra_tien(self):
        """Chốt chặn: việc miễn phạt phải bám theo LOẠI ĐƠN, không được
        vô tình tắt phạt của đơn nghỉ."""
        amount, reason = pc.decide_penalty(
            _row(violation_code="NOT_APPROVED", fault_side="MANAGER",
                 request_type="UNAUTHORIZED_ABSENCE"),
            effective_date=EFF)
        self.assertEqual(amount, 500_000)
        self.assertEqual(reason, pc.REASON_CHARGED)

    def test_bat_lai_phat_tang_ca_chi_can_xoa_khoi_mot_tap(self):
        """Tài liệu sống cho cách bật lại — nếu ai đó đổi chỗ khác thì test đỏ."""
        self.assertEqual(pc.WARN_ONLY_REQUEST_TYPES, frozenset({"OVERTIME"}))

    def test_dung_dung_ham_han_cua_TANG_CA(self):
        """Không được rơi vào leave_style_deadline — đó là luật đơn nghỉ."""
        with patch("hrm.deadline_utils.overtime_deadline_for",
                   return_value=(None, False)) as ot_rule, \
             patch("hrm.deadline_utils.leave_style_deadline") as leave_rule:
            LeaveViolationReportView()._recomputed_deadline(
                self._ev(), {}, OVERTIME, None, {})
        ot_rule.assert_called_once()
        leave_rule.assert_not_called()

    def test_lay_gio_bat_dau_tu_check_in_khi_data_rong(self):
        """Dữ liệu thật: data['start_time'] gần như luôn rỗng, giờ nằm ở
        check_in của event (đơn OT-202610-6DFDD853 HCNS gửi đúng kiểu đó)."""
        with patch("hrm.deadline_utils.overtime_deadline_for",
                   return_value=(None, False)) as ot_rule:
            LeaveViolationReportView()._recomputed_deadline(
                self._ev(check_in=dt.time(17, 0)), {"start_time": None},
                OVERTIME, None, {})
        self.assertEqual(ot_rule.call_args.args[1], dt.time(17, 0))

    def test_uu_tien_data_start_time_khi_co(self):
        with patch("hrm.deadline_utils.overtime_deadline_for",
                   return_value=(None, False)) as ot_rule:
            LeaveViolationReportView()._recomputed_deadline(
                self._ev(check_in=dt.time(17, 0)), {"start_time": "19:30"},
                OVERTIME, None, {})
        self.assertEqual(ot_rule.call_args.args[1], dt.time(19, 30))

    def test_khong_tinh_duoc_han_thi_tra_None(self):
        with patch("hrm.deadline_utils.overtime_deadline_for",
                   side_effect=ValueError("khong co ca")):
            out = LeaveViolationReportView()._recomputed_deadline(
                self._ev(), {}, OVERTIME, None, {})
        self.assertIsNone(out)

    def test_cung_ngay_vua_loi_don_nghi_vua_loi_tang_ca_thi_tinh_RIENG(self):
        """HCNS chốt 2026-10-14: hai lần không tuân thủ khác nhau thì tính
        hai lần. Gộp lại là giấu mất một vi phạm khỏi bảng đối soát."""
        rows = [
            {"fault_side": "MANAGER", "employee_id": 7, "event_date": "2026-10-20",
             "violation_code": "APPROVED_LATE", "request_type": "LEAVE", "detail": ""},
            {"fault_side": "MANAGER", "employee_id": 7, "event_date": "2026-10-20",
             "violation_code": "APPROVED_LATE", "request_type": OVERTIME, "detail": ""},
        ]
        out = LeaveViolationReportView._dedup_one_per_day(rows)
        self.assertEqual(len(out), 2)
        self.assertEqual({r["request_type"] for r in out}, {"LEAVE", OVERTIME})

    def test_trong_CUNG_mot_ho_don_thi_van_gop(self):
        """Vừa bị chặn tạo đơn vừa không quẹt thẻ -> 1 lỗi, không phải 2."""
        rows = [
            {"fault_side": "EMPLOYEE", "employee_id": 7, "event_date": "2026-10-20",
             "violation_code": "NO_REQUEST", "request_type": None, "detail": ""},
            {"fault_side": "EMPLOYEE", "employee_id": 7, "event_date": "2026-10-20",
             "violation_code": "LATE_CREATED", "request_type": "LEAVE", "detail": ""},
        ]
        out = LeaveViolationReportView._dedup_one_per_day(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["violation_code"], "NO_REQUEST")
