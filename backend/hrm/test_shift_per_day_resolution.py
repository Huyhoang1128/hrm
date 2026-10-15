"""
Engine tính công phải giải ca cố định theo ĐÚNG TỪNG NGÀY, không phải 1 lần
bằng ngày đầu tháng.

Sự cố thực tế (tháng 9/2026): ca 01-21/09 là
08:00-17:00, từ 22/09 đổi sang 07:30-16:30. replay_month() gọi
load_shift_configs_for_employee() với `start_date` = ngày 01 rồi dùng kết quả
đó cho cả 30 ngày, nên các ngày 23-29/09 ra về đúng giờ 16:30 vẫn bị tính VỀ
SỚM 30 phút + phạt 100.000đ/ngày. Nói rộng hơn: hệ thống hoàn toàn không biểu
diễn được việc đổi ca GIỮA THÁNG, trong khi HCNS đổi ca giữa tháng thường
xuyên (chỉ riêng tháng 9/2026 đã 2 lần).

Nguyên tắc của bản sửa — chỉ đổi đúng chỗ sai, không đụng phần còn lại:
  • CHỈ ghi đè rule_type vốn được SINH từ ShiftConfig (rule_name mở đầu bằng
    'ShiftConfig: '). rule_type nào có RuleDefinition khai báo tường minh thì
    giữ nguyên, đúng thứ tự ưu tiên cũ của replay_month().
  • Ca ngày này TRÙNG ca đầu tháng -> trả None (no-op). Nhân viên KHÔNG đổi ca
    giữa tháng vì thế không bị ảnh hưởng gì.
"""
import datetime as dt
import types
from unittest.mock import patch

from django.test import SimpleTestCase

from hrm.main_api import EmployeeState


def _rule(rule_type, start, end, ten="ShiftConfig: Ca test", workday=0.5):
    return {
        "rule_name": ten,
        "rule_type": rule_type,
        "conditions": {"start_time": start, "end_time": end, "workday": workday},
        "priority": 50,
    }


def _shift(code, start, end, shift_type, working_hours=4.0):
    return types.SimpleNamespace(
        code=code, name=code, shift_type=shift_type, working_hours=working_hours,
        start_time=dt.time(*map(int, start.split(":")[:2])),
        end_time=dt.time(*map(int, end.split(":")[:2])),
    )


def _state(rules):
    """EmployeeState giả — chỉ cần đúng 3 thuộc tính hàm đang xét dùng tới."""
    return types.SimpleNamespace(
        employee_code="NV01704", rules=rules, _shift_by_date_cache={},
    )


GOI = EmployeeState._rules_from_shift_configs_for_date
NGAY = dt.date(2026, 9, 23)

CA_8H = [_shift("CA_8H_SANG", "08:00", "12:00", "MORNING"),
         _shift("CA_8H_CHIEU", "13:00", "17:00", "AFTERNOON")]
CA_730 = [_shift("CA_730_SANG", "07:30", "11:30", "MORNING"),
          _shift("CA_730_CHIEU", "12:30", "16:30", "AFTERNOON")]

RULES_8H = [_rule("SHIFT_RULE_MORNING", "08:00:00", "12:00:00"),
            _rule("SHIFT_RULE_AFTERNOON", "13:00:00", "17:00:00")]


class ShiftPerDayTests(SimpleTestCase):
    def test_ca_ngày_này_khác_ca_đầu_tháng_thì_ghi_đè(self):
        """Đúng case NV01704: đầu tháng 08:00-17:00, ngày 23/09 thật ra là
        07:30-16:30 -> phải dùng 16:30 để tính về sớm, không phải 17:00."""
        with patch("hrm.main_api._load_shift_configs_for_employee", return_value=CA_730):
            ket_qua = GOI(_state(list(RULES_8H)), NGAY)

        self.assertIsNotNone(ket_qua)
        theo_loai = {r["rule_type"]: r["conditions"] for r in ket_qua}
        self.assertEqual(theo_loai["SHIFT_RULE_MORNING"]["start_time"], "07:30:00")
        self.assertEqual(theo_loai["SHIFT_RULE_AFTERNOON"]["end_time"], "16:30:00")

    def test_ca_không_đổi_thì_no_op(self):
        """Tuyệt đại đa số nhân viên không đổi ca giữa tháng — phải trả None
        để giữ nguyên hành vi cũ, không phát sinh rủi ro hồi quy."""
        with patch("hrm.main_api._load_shift_configs_for_employee", return_value=CA_8H):
            self.assertIsNone(GOI(_state(list(RULES_8H)), NGAY))

    def test_không_đụng_rule_khai_báo_bằng_RuleDefinition(self):
        """rule_type có RuleDefinition tường minh (rule_name KHÔNG mở đầu bằng
        'ShiftConfig: ') phải giữ nguyên — replay_month vốn chỉ sinh synthetic
        rule cho loại CHƯA có RuleDefinition, bản sửa không được phá thứ tự đó."""
        rules = [
            _rule("SHIFT_RULE_MORNING", "08:00:00", "12:00:00", ten="Ca sáng (RuleDefinition)"),
            _rule("SHIFT_RULE_AFTERNOON", "13:00:00", "17:00:00"),
        ]
        with patch("hrm.main_api._load_shift_configs_for_employee", return_value=CA_730):
            ket_qua = GOI(_state(rules), NGAY)

        theo_loai = {r["rule_type"]: r["conditions"] for r in ket_qua}
        self.assertEqual(theo_loai["SHIFT_RULE_MORNING"]["start_time"], "08:00:00")   # giữ nguyên
        self.assertEqual(theo_loai["SHIFT_RULE_AFTERNOON"]["end_time"], "16:30:00")   # có ghi đè

    def test_không_có_rule_synthetic_thì_bỏ_qua(self):
        rules = [_rule("SHIFT_RULE_MORNING", "08:00:00", "12:00:00", ten="Ca sáng (RuleDefinition)")]
        with patch("hrm.main_api._load_shift_configs_for_employee") as m:
            self.assertIsNone(GOI(_state(rules), NGAY))
            m.assert_not_called()   # không tốn query khi chắc chắn không dùng tới

    def test_giữ_nguyên_các_rule_không_phải_ca(self):
        """Rule phạt/công tác... phải còn nguyên sau khi thay rule ca."""
        khac = {"rule_name": "Phạt đi muộn", "rule_type": "PENALTY_RULE", "conditions": {}}
        with patch("hrm.main_api._load_shift_configs_for_employee", return_value=CA_730):
            ket_qua = GOI(_state(list(RULES_8H) + [khac]), NGAY)
        self.assertIn(khac, ket_qua)

    def test_lỗi_khi_giải_ca_thì_giữ_ca_đầu_tháng(self):
        """Không bao giờ được làm sập luồng tính công của cả công ty."""
        with patch("hrm.main_api._load_shift_configs_for_employee", side_effect=RuntimeError("DB lỗi")):
            self.assertIsNone(GOI(_state(list(RULES_8H)), NGAY))

    def test_không_giải_được_ca_nào_thì_giữ_nguyên(self):
        with patch("hrm.main_api._load_shift_configs_for_employee", return_value=[]):
            self.assertIsNone(GOI(_state(list(RULES_8H)), NGAY))

    def test_hai_ca_cùng_loại_chỉ_lấy_ca_đầu(self):
        """Cấu hình lỗi (2 ca cùng rule_type) không được cộng gấp đôi công."""
        hai_ca = [_shift("A", "07:30", "11:30", "MORNING"),
                  _shift("B", "09:00", "13:00", "MORNING")]
        with patch("hrm.main_api._load_shift_configs_for_employee", return_value=hai_ca):
            ket_qua = GOI(_state(list(RULES_8H)), NGAY)
        sang = [r for r in ket_qua if r["rule_type"] == "SHIFT_RULE_MORNING"]
        self.assertEqual(len(sang), 1)
        self.assertEqual(sang[0]["conditions"]["start_time"], "07:30:00")
