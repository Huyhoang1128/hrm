"""
Huỷ đơn đăng ký ca theo ngày (cancel-ca2) — yêu cầu 2026-10-06: QLTT đã duyệt
"Ca 1" ngày 07/10 cho một nhân viên rồi nhân viên đó không làm nữa,
mà đơn đã duyệt thì không có cách nào gỡ. Huỷ xong ngày đó quay về ca mặc định.

QLTT huỷ được trong cùng khung ngày họ được TẠO HỘ (tương lai, hoặc 2 ngày làm
việc gần nhất); HCNS/Admin huỷ được mọi ngày.
"""
import datetime as dt
import types
from unittest.mock import patch

from django.test import SimpleTestCase

from hrm.shift_registration_models import ShiftRegistrationDay
from hrm.shift_registration_views import _can_cancel_ca2

HOM_NAY = dt.date(2026, 10, 6)   # Thứ 3
QLTT = types.SimpleNamespace(id=10)
NGUOI_KHAC = types.SimpleNamespace(id=99)
NV = types.SimpleNamespace(id=1, manager_id=10)


def _don(ngay, status=ShiftRegistrationDay.Status.APPROVED):
    return types.SimpleNamespace(
        date=ngay, status=status,
        registration=types.SimpleNamespace(employee=NV),
    )


def _huy(viewer, don, hr=False):
    with patch("hrm.shift_registration_views.timezone.localdate", return_value=HOM_NAY), \
         patch("hrm.deadline_utils.subtract_working_days", return_value=dt.date(2026, 10, 3)):
        return _can_cancel_ca2(viewer, hr, don)


class CancelCa2Tests(SimpleTestCase):
    def test_qltt_huỷ_ngày_tương_lai(self):
        """Đúng case thực tế: huỷ Ca 1 đã duyệt của ngày mai."""
        self.assertEqual(_huy(QLTT, _don(dt.date(2026, 10, 7))), (True, None))

    def test_qltt_huỷ_được_cả_đơn_đang_chờ(self):
        self.assertTrue(_huy(QLTT, _don(dt.date(2026, 10, 9), ShiftRegistrationDay.Status.PENDING))[0])

    def test_qltt_huỷ_ngày_đã_qua_trong_2_ngày_làm_việc(self):
        self.assertTrue(_huy(QLTT, _don(dt.date(2026, 10, 3)))[0])
        self.assertTrue(_huy(QLTT, _don(HOM_NAY))[0])

    def test_qltt_không_huỷ_quá_2_ngày_làm_việc(self):
        ok, ly_do = _huy(QLTT, _don(dt.date(2026, 10, 2)))
        self.assertFalse(ok)
        self.assertIn("HCNS", ly_do)

    def test_hcns_huỷ_được_mọi_ngày(self):
        self.assertTrue(_huy(NGUOI_KHAC, _don(dt.date(2026, 9, 1)), hr=True)[0])

    def test_không_phải_qltt_thì_không_huỷ(self):
        self.assertFalse(_huy(NGUOI_KHAC, _don(dt.date(2026, 10, 7)))[0])

    def test_đơn_đã_từ_chối_hoặc_đã_huỷ_thì_không_huỷ_nữa(self):
        for st in (ShiftRegistrationDay.Status.REJECTED, ShiftRegistrationDay.Status.CANCELLED):
            self.assertFalse(_huy(QLTT, _don(dt.date(2026, 10, 7), st))[0])
            self.assertFalse(_huy(NGUOI_KHAC, _don(dt.date(2026, 10, 7), st), hr=True)[0])
