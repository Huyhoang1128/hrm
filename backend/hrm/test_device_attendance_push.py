"""
POST /api/v1/hrm/attendance-device/push/ — nhận lượt quẹt từ máy ZKTeco (tool
sync chạy tự động hằng ngày) thay cho việc HCNS upload file chấm công ngày 15.

Kết quả ghi DB phải tương đương luồng upload file (upload_serializers.py):
EmployeeEvent(attendance) + Attendance cũ, lượt quẹt lẻ xếp theo ca, đối soát
tăng ca ONSITE — và gửi lại cùng dữ liệu nhiều lần phải an toàn.
"""
import datetime as dt
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.models import Attendance

URL = "/api/v1/hrm/attendance-device/push/"
NGAY = dt.date(2026, 10, 5)


def _rec(code, when, device="MCC00001", punch=0):
    return {"device_user_id": code, "punch_time": when, "punch": punch, "device_name": device}


# Không có ca cấu hình -> lone_punch_is_checkout dùng khung hành chính 08:00-17:30.
@patch("hrm.shift_config_utils.get_registered_shift_configs_for_date", return_value=None)
@patch("hrm.shift_config_utils.load_shift_configs_for_employee", return_value=[])
@patch("hrm.shift_config_utils.get_all_candidate_shifts_for_employee", return_value=[])
@patch("hrm.overtime_reconciliation.reconcile_onsite_overtime", return_value=[])
class DeviceAttendancePushTests(TestCase):
    def setUp(self):
        hr_user = User.objects.create_user(username="hcns", password="x")
        self.hr = Employee.objects.create(user=hr_user, employee_id="NV00001", full_name="HCNS", is_hr=True)
        nv_user = User.objects.create_user(username="nv", password="x")
        self.nv = Employee.objects.create(user=nv_user, employee_id="NV02153", full_name="Nhân Viên")
        self.client = APIClient()
        self.client.force_authenticate(hr_user)

    def _push(self, *records):
        return self.client.post(URL, {"records": list(records)}, format="json")

    def _event(self, day=NGAY):
        return EmployeeEvent.objects.get(
            employee=self.nv, event_date=day, event_type="attendance", checkin_is_valid__isnull=True,
        )

    def test_chỉ_hcns_được_đẩy(self, *_):
        other = User.objects.create_user(username="khac", password="x")
        Employee.objects.create(user=other, employee_id="NV09999", full_name="Khác")
        self.client.force_authenticate(other)
        self.assertEqual(self._push(_rec("NV02153", "2026-10-05T08:01:00")).status_code, 403)
        self.assertFalse(EmployeeEvent.objects.filter(event_type="attendance").exists())

    def test_ghi_cả_event_lẫn_bảng_attendance_cũ(self, *_):
        res = self._push(
            _rec("NV02153", "2026-10-05T17:41:10", device="MCC00002"),
            _rec("NV02153", "2026-10-05T08:02:30"),
            _rec("NV02153", "2026-10-05T12:00:00"),
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual((res.data["processed"], res.data["skipped"], res.data["days_updated"]), (3, 0, 1))
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out), (dt.time(8, 2, 30), dt.time(17, 41, 10)))
        self.assertEqual(ev.data["import_source"], "device_push")
        self.assertEqual(ev.data["status"], "PRESENT")
        self.assertEqual(len(ev.data["raw_records"]), 3)
        att = Attendance.objects.get(employee=self.nv, attendance_date=NGAY)
        self.assertEqual(ev.data["attendance_id"], att.id)
        self.assertEqual((att.check_in, att.check_out, att.status), (dt.time(8, 2, 30), dt.time(17, 41, 10), "PRESENT"))
        self.assertEqual(att.import_batch, "device_push")

    def test_gửi_lại_cùng_dữ_liệu_không_đổi_gì(self, *_):
        recs = [_rec("NV02153", "2026-10-05T08:02:30"), _rec("NV02153", "2026-10-05T17:41:10")]
        self._push(*recs)
        before = self._event().updated_at if hasattr(EmployeeEvent, "updated_at") else None
        res = self._push(*recs)
        self.assertEqual((res.data["processed"], res.data["skipped"], res.data["days_updated"]), (0, 2, 0))
        self.assertEqual(EmployeeEvent.objects.filter(event_type="attendance").count(), 1)
        self.assertEqual(Attendance.objects.count(), 1)
        if before is not None:
            self.assertEqual(self._event().updated_at, before)

    def test_gửi_dần_trong_ngày_rồi_bổ_sung_giờ_ra(self, *_):
        self._push(_rec("NV02153", "2026-10-05T08:02:30"))
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out, ev.data["status"]), (dt.time(8, 2, 30), None, "HALF_DAY"))
        self._push(_rec("NV02153", "2026-10-05T08:02:30"), _rec("NV02153", "2026-10-05T17:35:00"))
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out), (dt.time(8, 2, 30), dt.time(17, 35)))
        att = Attendance.objects.get(employee=self.nv, attendance_date=NGAY)
        self.assertEqual((att.check_in, att.check_out, att.status), (dt.time(8, 2, 30), dt.time(17, 35), "PRESENT"))

    def test_quẹt_đúp_sát_nhau_tính_là_1_lần(self, *_):
        """08:00 + 08:03 là bấm lại vì máy chưa kêu — không được thành vào 08:00 /
        ra 08:03 (cả ngày bị tính về sớm) mà là quên chấm công ra."""
        self._push(_rec("NV02153", "2026-10-05T08:00:05"), _rec("NV02153", "2026-10-05T08:03:00"))
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out), (dt.time(8, 0, 5), None))
        self.assertEqual(len(ev.data["raw_records"]), 2)  # vẫn lưu đủ dữ liệu gốc

    def test_lượt_quẹt_lẻ_lúc_về_là_giờ_ra(self, *_):
        self._push(_rec("NV02153", "2026-10-05T17:20:00"))
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out), (None, dt.time(17, 20)))
        att = Attendance.objects.get(employee=self.nv, attendance_date=NGAY)
        self.assertEqual((att.check_in, att.check_out, att.status), (None, dt.time(17, 20), "HALF_DAY"))

    def test_lượt_lẻ_đã_lưu_nhầm_giờ_vào_được_xếp_lại(self, *_):
        """Upload file cũ lưu 17:04 vào giờ vào: đẩy lại từ máy phải chuyển thành
        giờ ra, không giữ lại giờ vào 17:04 trùng chính lượt đó."""
        Attendance.objects.create(employee=self.nv, attendance_date=NGAY, check_in=dt.time(17, 4), status="HALF_DAY")
        self._push(_rec("NV02153", "2026-10-05T17:04:00"))
        att = Attendance.objects.get(employee=self.nv, attendance_date=NGAY)
        self.assertEqual((att.check_in, att.check_out), (None, dt.time(17, 4)))

    def test_dùng_lại_event_do_upload_file_tạo(self, *_):
        att = Attendance.objects.create(
            employee=self.nv, attendance_date=NGAY, check_in=dt.time(8, 10), check_out=dt.time(17, 0), status="PRESENT",
        )
        EmployeeEvent.objects.create(
            employee=self.nv, event_date=NGAY, event_type="attendance",
            check_in=dt.time(8, 10), check_out=dt.time(17, 0),
            data={"attendance_id": att.id, "status": "PRESENT", "import_source": "attendance_upload"},
        )
        res = self._push(_rec("NV02153", "2026-10-05T08:05:00"), _rec("NV02153", "2026-10-05T17:35:00"))
        self.assertEqual(res.data["days_updated"], 1)
        self.assertEqual(EmployeeEvent.objects.filter(event_type="attendance").count(), 1)
        self.assertEqual(Attendance.objects.count(), 1)
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out, ev.data["import_source"]), (dt.time(8, 5), dt.time(17, 35), "device_push"))
        att.refresh_from_db()
        self.assertEqual((att.check_in, att.check_out), (dt.time(8, 5), dt.time(17, 35)))

    def test_không_đụng_event_chấm_công_app_mobile(self, *_):
        mobile = EmployeeEvent.objects.create(
            employee=self.nv, event_date=NGAY, event_type="attendance", checkin_is_valid=True,
            check_in=dt.time(7, 58), data={"source": "mobile"},
        )
        self._push(_rec("NV02153", "2026-10-05T08:02:30"), _rec("NV02153", "2026-10-05T17:41:10"))
        mobile.refresh_from_db()
        self.assertEqual((mobile.check_in, mobile.check_out, mobile.data), (dt.time(7, 58), None, {"source": "mobile"}))
        self.assertEqual(self._event().check_out, dt.time(17, 41, 10))

    def test_lỗi_từng_record_không_chặn_record_khác(self, *_):
        tomorrow = (timezone.localdate() + dt.timedelta(days=1)).isoformat()
        res = self._push(
            _rec("NV01265", "2026-10-05T08:00:00"),            # mã không có trong HRM
            _rec("NV02153", "05/10/2026 08:00"),              # sai định dạng
            _rec("NV02153", f"{tomorrow}T08:00:00"),          # đồng hồ máy lệch sang tương lai
            {"device_user_id": "NV02153", "punch_time": "2026-10-05T08:00:00"},  # thiếu punch
            _rec("NV02153", "2026-10-05T08:02:30"),
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["processed"], 1)
        self.assertEqual(sorted(e["index"] for e in res.data["errors"]), [0, 1, 2, 3])
        self.assertIn("NV01265", res.data["errors"][0]["error"])
        self.assertIn("tương lai", res.data["errors"][2]["error"])
        self.assertEqual(EmployeeEvent.objects.filter(event_type="attendance").count(), 1)

    def test_record_không_phải_object(self, *_):
        res = self._push("rác", _rec("NV02153", "2026-10-05T08:02:30"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["processed"], [e["index"] for e in res.data["errors"]]), (1, [0]))

    def test_đối_soát_tăng_ca_chỉ_cho_ngày_đã_trọn_vẹn(self, reconcile, *_):
        today = timezone.localdate()
        self._push(
            _rec("NV02153", f"{NGAY.isoformat()}T08:02:30"),
            _rec("NV02153", f"{NGAY.isoformat()}T17:41:10"),
            _rec("NV02153", f"{today.isoformat()}T08:00:00"),
        )
        reconcile.assert_called_once()
        pairs = reconcile.call_args[0][0]
        self.assertEqual([(e.id, d) for e, d in pairs], [(self.nv.id, NGAY)])
        reconcile.reset_mock()
        # Gửi lại không có gì mới -> không đối soát lại
        self._push(_rec("NV02153", f"{NGAY.isoformat()}T08:02:30"))
        reconcile.assert_not_called()

    def test_giờ_có_múi_giờ_được_quy_về_giờ_việt_nam(self, *_):
        self._push(_rec("NV02153", "2026-10-05T01:02:30+00:00"), _rec("NV02153", "2026-10-05T10:41:10+00:00"))
        ev = self._event()
        self.assertEqual((ev.check_in, ev.check_out), (dt.time(8, 2, 30), dt.time(17, 41, 10)))
