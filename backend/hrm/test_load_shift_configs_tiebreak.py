"""
hrm/test_load_shift_configs_tiebreak.py
══════════════════════════════════════════
Bug thực tế #1 (2026-09-17, CSKH Miền Bắc): vị trí "NV_CSKH" được gán ĐỒNG
THỜI "Ca chiều CSKH" (13:00-17:00, 4 tiếng) và "Ca kinh doanh" (13:00-21:00,
8 tiếng) — 2 ca CÙNG CẤP (cùng gán qua vị trí), CÙNG start_time 13:00.

load_shift_configs_for_employee() trước đây chỉ order_by('start_time') khi
dedup theo rule_type — 2 ca trùng start_time thì "ai thắng" làm ca MẶC ĐỊNH
phụ thuộc thứ tự trả về không đảm bảo của DB. Có lúc "Ca kinh doanh" (8
tiếng) thắng, khiến MỌI ngày nhân viên làm ca thường (13:00-17:00) bị hiểu
nhầm "về sớm" gần 4 tiếng mỗi ngày — chỉ tính 0.5 công/ngày thay vì 1.0.

Fix #1: thêm working_hours làm khoá sắp phụ — ca NGẮN HƠN luôn thắng làm mặc
định khi 2 ca CÙNG CẤP trùng start_time.

Bug thực tế #2 (cùng ngày, sau khi gán "Ca kinh doanh" thêm vào phòng "Kinh
Doanh 1"): fix #1 chỉ xử lý được trường hợp 2 ca CÙNG CẤP — phòng "Kinh
Doanh 1" không có sẵn ca ngắn nào cạnh tranh Ở ĐÚNG CÙNG CẤP (phòng ban),
nên "Ca kinh doanh" tự động "thắng" làm mặc định ngay lập tức (không có gì
để so sánh), làm nhân viên đi làm giờ hành chính ở đó (NV80027) bị tính
thiếu công y hệt sự cố #1.

Fix #2 (đúng gốc): thêm field ShiftConfig.detection_only — ca được đánh dấu
cờ này bị LOẠI HẲN khỏi danh sách ứng viên "mặc định" của MỌI cấp (cá nhân/
vị trí/phòng ban), dù không có gì cạnh tranh cùng cấp — an toàn để gán vào
bất kỳ vị trí/phòng ban nào. Vẫn còn nguyên trong
get_all_candidate_shifts_for_employee() (không lọc) để tính năng "tự động
nhận diện ca" xét riêng cho từng ngày khớp giờ checkin/checkout thực tế.
"""
import datetime

from django.test import SimpleTestCase
from unittest.mock import MagicMock, patch

from hrm.shift_config_utils import load_shift_configs_for_employee


def _t(hh, mm):
    return datetime.time(hh, mm)


class _FakeShiftConfig:
    def __init__(self, id, start_time, end_time, shift_type, working_hours,
                 employee_ids=(), position_ids=(), department_ids=(), is_default=False,
                 detection_only=False):
        self.id = id
        self.start_time = start_time
        self.end_time = end_time
        self.shift_type = shift_type
        self.working_hours = working_hours
        self._employee_ids = set(employee_ids)
        self._position_ids = set(position_ids)
        self._department_ids = set(department_ids)
        self.is_default = is_default
        self.detection_only = detection_only
        self.no_attendance_required = False
        # Hàm lọc ngày hiệu lực bằng Python trên list đã cache -> cần 2 trường này.
        self.effective_from = datetime.date(2026, 1, 1)
        self.effective_to = None


class _FakeQS:
    """Chỉ mô phỏng đúng những gì load_shift_configs_for_employee() dùng:
    .filter(**kwargs) (kwargs quan tâm) / .filter(<Q object>) (bỏ qua, coi
    như luôn khớp) / .order_by(*fields)."""

    def __init__(self, items):
        self.items = list(items)

    def __iter__(self):
        return iter(self.items)

    def filter(self, *args, **kwargs):
        items = self.items

        def _id(value):  # nhận cả object (.id) lẫn id
            return getattr(value, 'id', value)

        if 'id__in' in kwargs:
            ids = set(kwargs['id__in'])
            items = [sc for sc in items if sc.id in ids]
        if 'apply_to_employees' in kwargs:
            emp = _id(kwargs['apply_to_employees'])
            items = [sc for sc in items if emp in sc._employee_ids]
        if 'apply_to_positions' in kwargs:
            pos = _id(kwargs['apply_to_positions'])
            items = [sc for sc in items if pos in sc._position_ids]
        if 'apply_to_departments' in kwargs:
            dept = _id(kwargs['apply_to_departments'])
            items = [sc for sc in items if dept in sc._department_ids]
        if kwargs.get('is_default'):
            items = [sc for sc in items if sc.is_default]
        # is_active / effective_from / effective_to (kwargs) và Q objects
        # (args, cho effective_to isnull/gte) không cần mô phỏng — test này
        # chỉ khoá lại phần tie-break, không phải phần lọc theo ngày hiệu lực.
        return _FakeQS(items)

    def order_by(self, *fields):
        items = list(self.items)
        for f in reversed(fields):
            items.sort(key=lambda sc: getattr(sc, f))
        return items


def _run(employee, shift_configs):
    # load_shift_configs_for_employee() làm deferred import
    # (`from .models import ShiftConfig`) NGAY TRONG hàm — phải patch đúng
    # `hrm.models.ShiftConfig` (nơi import thực sự lấy ra), patch
    # `hrm.shift_config_utils.ShiftConfig` sẽ không có tác dụng gì vì tên đó
    # không tồn tại ở module-level trong shift_config_utils.py.
    mock_shiftconfig_cls = MagicMock()
    mock_shiftconfig_cls.objects.filter.return_value = _FakeQS(shift_configs)
    # Employee lấy bằng .filter(...).first(); pk không phải int nên không tra lịch
    # sử điều chuyển (employee/assignment.py) — dùng đúng dữ liệu hiện tại.
    employee_qs = MagicMock()
    employee_qs.first.return_value = employee
    with patch('hrm.models.ShiftConfig', mock_shiftconfig_cls), \
         patch('employee.models.Employee.objects.filter', return_value=employee_qs):
        return load_shift_configs_for_employee(employee.employee_id, datetime.date(2026, 9, 1))


class LoadShiftConfigsTieBreakTests(SimpleTestCase):
    def _employee(self, position_id=None, department_id=None):
        emp = MagicMock()
        emp.employee_id = 'NV80022'
        emp.position = MagicMock(id=position_id) if position_id else None
        emp.department = MagicMock(id=department_id) if department_id else None
        emp.position_id = position_id
        emp.department_id = department_id
        return emp

    def test_shorter_shift_wins_default_when_tied_on_start_time(self):
        """Ca ngắn (4h) và ca dài (8h) cùng gán vị trí, cùng start 13:00 ->
        ca NGẮN phải là mặc định, bất kể thứ tự trong DB."""
        employee = self._employee(position_id=15)
        cskh_afternoon = _FakeShiftConfig(
            id=9, start_time=_t(13, 0), end_time=_t(17, 0),
            shift_type='AFTERNOON', working_hours=4.0, position_ids={15},
        )
        kd_full = _FakeShiftConfig(
            id=10, start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type='AFTERNOON', working_hours=8.0, position_ids={15},
        )
        morning = _FakeShiftConfig(
            id=18, start_time=_t(8, 0), end_time=_t(12, 0),
            shift_type='MORNING', working_hours=3.0, position_ids={15},
        )

        # Cố tình đặt ca DÀI trước ca NGẮN trong danh sách nguồn để mô phỏng
        # đúng trường hợp DB trả về "sai thứ tự mong muốn" nếu chỉ sort start_time.
        result = _run(employee, [morning, kd_full, cskh_afternoon])

        afternoon_result = next(sc for sc in result if sc.shift_type == 'AFTERNOON')
        self.assertIs(afternoon_result, cskh_afternoon)
        self.assertEqual(afternoon_result.working_hours, 4.0)

    def test_shorter_shift_wins_regardless_of_source_list_order(self):
        """Đảo ngược thứ tự nguồn (ca ngắn trước) vẫn phải ra cùng kết quả —
        xác nhận kết quả không phụ thuộc thứ tự DB trả về."""
        employee = self._employee(position_id=15)
        cskh_afternoon = _FakeShiftConfig(
            id=9, start_time=_t(13, 0), end_time=_t(17, 0),
            shift_type='AFTERNOON', working_hours=4.0, position_ids={15},
        )
        kd_full = _FakeShiftConfig(
            id=10, start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type='AFTERNOON', working_hours=8.0, position_ids={15},
        )

        result = _run(employee, [cskh_afternoon, kd_full])

        afternoon_result = next(sc for sc in result if sc.shift_type == 'AFTERNOON')
        self.assertIs(afternoon_result, cskh_afternoon)

    def test_only_one_shift_for_rule_type_is_unaffected(self):
        """Chỉ có 1 ca cho 1 rule_type (trường hợp phổ biến nhất) -> hành vi
        y hệt trước đây, không có gì để tie-break."""
        employee = self._employee(position_id=15)
        only_afternoon = _FakeShiftConfig(
            id=9, start_time=_t(13, 0), end_time=_t(17, 0),
            shift_type='AFTERNOON', working_hours=4.0, position_ids={15},
        )
        result = _run(employee, [only_afternoon])
        self.assertEqual(result, [only_afternoon])

    def test_kd_full_still_excluded_from_default_but_remains_a_row_in_source(self):
        """Ca dài thua tie-break thì KHÔNG có trong kết quả default (dedup
        theo rule_type chỉ giữ 1) — nhưng vẫn còn nguyên trong DB để
        get_all_candidate_shifts_for_employee() (không dedup) dùng tự nhận
        diện riêng."""
        employee = self._employee(position_id=15)
        cskh_afternoon = _FakeShiftConfig(
            id=9, start_time=_t(13, 0), end_time=_t(17, 0),
            shift_type='AFTERNOON', working_hours=4.0, position_ids={15},
        )
        kd_full = _FakeShiftConfig(
            id=10, start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type='AFTERNOON', working_hours=8.0, position_ids={15},
        )
        result = _run(employee, [kd_full, cskh_afternoon])
        self.assertNotIn(kd_full, result)
        self.assertEqual(len(result), 1)


class DetectionOnlyShiftExcludedFromDefaultTests(SimpleTestCase):
    """Sự cố #2: ca kinh doanh (detection_only=True) được gán vào 1 phòng ban
    (Kinh Doanh 1) KHÔNG có sẵn ca ngắn nào cạnh tranh ở đúng cùng cấp — phải
    bị loại khỏi mặc định NGAY CẢ KHI nó là ứng viên DUY NHẤT ở cấp đó, để
    hệ thống rơi xuống đúng ca mặc định công ty (cấp 4) thay vì tự thắng."""

    def _employee(self, position_id=None, department_id=None):
        emp = MagicMock()
        emp.employee_id = 'NV80027'
        emp.position = MagicMock(id=position_id) if position_id else None
        emp.department = MagicMock(id=department_id) if department_id else None
        emp.position_id = position_id
        emp.department_id = department_id
        return emp

    def test_detection_only_shift_alone_at_a_level_does_not_win_default(self):
        """Ca kinh doanh (detection_only) là ứng viên AFTERNOON DUY NHẤT ở
        cấp phòng ban 'Kinh Doanh 1' -> vẫn phải bị loại, rơi xuống ca mặc
        định công ty (cấp 4) thay vì tự thắng vì không có gì cạnh tranh."""
        employee = self._employee(department_id=200)  # phòng Kinh Doanh 1
        kd_full = _FakeShiftConfig(
            id=10, start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type='AFTERNOON', working_hours=8.0, department_ids={200},
            detection_only=True,
        )
        company_default_afternoon = _FakeShiftConfig(
            id=3, start_time=_t(13, 0), end_time=_t(17, 30),
            shift_type='AFTERNOON', working_hours=4.5, is_default=True,
        )

        result = _run(employee, [kd_full, company_default_afternoon])

        afternoon_result = next(sc for sc in result if sc.shift_type == 'AFTERNOON')
        self.assertIs(afternoon_result, company_default_afternoon)
        self.assertNotIn(kd_full, result)

    def test_detection_only_shift_never_wins_even_without_any_fallback(self):
        """Không có ca mặc định công ty nào để rơi xuống -> AFTERNOON đơn
        giản là KHÔNG có trong kết quả (không tính công 'ăn theo' ca kinh
        doanh), thay vì liều lĩnh dùng ca kinh doanh làm mặc định."""
        employee = self._employee(department_id=200)
        kd_full = _FakeShiftConfig(
            id=10, start_time=_t(13, 0), end_time=_t(21, 0),
            shift_type='AFTERNOON', working_hours=8.0, department_ids={200},
            detection_only=True,
        )
        result = _run(employee, [kd_full])
        self.assertEqual(result, [])

    def test_non_detection_only_shift_alone_at_a_level_still_wins_as_before(self):
        """Regression: ca THƯỜNG (không detection_only) là ứng viên duy nhất
        ở 1 cấp vẫn phải thắng làm mặc định như hành vi gốc — cờ detection_
        only không ảnh hưởng gì tới các ca bình thường khác."""
        employee = self._employee(department_id=200)
        normal_afternoon = _FakeShiftConfig(
            id=9, start_time=_t(13, 0), end_time=_t(17, 0),
            shift_type='AFTERNOON', working_hours=4.0, department_ids={200},
        )
        result = _run(employee, [normal_afternoon])
        self.assertEqual(result, [normal_afternoon])
