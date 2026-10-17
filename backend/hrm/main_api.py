from .constant import EVENT_RULE_CATEGORY_MAP
from hrm.event import Event
from .rules import RuleRegistry, get_rules_for_employee, initialize_rule_registry
import logging
import math
import datetime as _dt
from employee.models import PROBATION_CONTRACT_TYPES

try:
    from hrm.attendance_engine import PolicyLoader as _PolicyLoader
except ImportError:
    _PolicyLoader = None

logger = logging.getLogger(__name__)

# Global rule registry instance
_rule_registry = RuleRegistry()

# Mức phụ cấp gửi xe áp dụng cho nhân viên hợp đồng thử việc (VNĐ/ngày công)
PROBATION_PARKING_ALLOWANCE_PER_DAY = 5_000

# Khoảng cách tối thiểu (phút) giữa check_in và check_out để được coi là hợp lệ.
# Nếu nhỏ hơn hoặc bằng ngưỡng này → coi là quên chấm công.
_MIN_CHECKIN_CHECKOUT_DIFF_MINUTES = 30


def _calc_checkin_checkout_diff(check_in_str: str, check_out_str: str) -> int:
    """
    Tính khoảng cách (phút) giữa check_in và check_out.

    Trả về -1 nếu không parse được hoặc check_out trước check_in
    (ví dụ: ca qua đêm sẽ không bị tính là quên chấm công).
    """
    def _parse(t: str):
        for fmt in ("%H:%M:%S", "%H:%M"):
            try:
                return _dt.datetime.strptime(t, fmt).time()
            except ValueError:
                continue
        return None

    try:
        ci = _parse(check_in_str)
        co = _parse(check_out_str)
        if ci is None or co is None:
            return -1
        diff = int(
            (_dt.datetime.combine(_dt.date.today(), co)
             - _dt.datetime.combine(_dt.date.today(), ci)).total_seconds() / 60
        )
        return diff
    except (TypeError, AttributeError):
        return -1



# Giải trình đi muộn chỉ "cứu" được 30 phút đầu tiên; phần muộn vượt quá
# ngưỡng này vẫn bị phạt theo đúng bậc tương ứng với số phút còn lại
# (vd: muộn 31 phút, giải trình duyệt -> vẫn tính như muộn 1 phút -> phạt 50k).
LATE_EXPLANATION_GRACE_MINUTES = 30
# Ngưỡng 30 phút chỉ áp dụng cho giải trình của các ngày từ mốc này trở đi -
# các ngày trước đó (1-9/9/2026, trước khi quy định thời hạn tạo/duyệt đơn chính
# thức áp dụng) giữ nguyên hành vi cũ (miễn hoàn toàn khi giải trình LATE
# được duyệt), không hồi tố. (Dời từ 2026-09-01 sang 2026-09-10 theo yêu cầu
# HCNS 2026-09-16 — khớp đúng mốc EFFECTIVE_DATE dùng cho các khoá hạn khác,
# xem hrm/deadline_utils.py::EFFECTIVE_DATE = 2026-09-09, cộng 1 ngày.)
LATE_EXPLANATION_GRACE_EFFECTIVE_DATE = "2026-09-10"


# Trực tối tự động theo ca (ShiftConfig.counts_as_night_duty) áp dụng từ ngày này
# (yêu cầu 2026-10-03, tính cả tháng 9/2026).
NIGHT_DUTY_SHIFT_EFFECTIVE_FROM = _dt.date(2026, 9, 1)


class EmployeeState:
    """Main class for employee attendance calculation"""

    # ------------------------------------------------------------------
    # Mapping: event_type  →  danh sách rule_type được phép xử lý
    #
    # Đây là "bảng routing" – khi nhận một event, apply_rules() chỉ
    # thử áp dụng các rule thuộc nhóm tương ứng, bỏ qua tất cả rule
    # còn lại.  Thêm dòng mới vào dict này khi hệ thống mở rộng.
    # ------------------------------------------------------------------
    EVENT_RULE_CATEGORY_MAP = EVENT_RULE_CATEGORY_MAP

    # Fields in effects that are informational only and must not be committed to state
    _INFORMATIONAL_EFFECT_FIELDS = frozenset({"late_minutes", "early_leave_minutes", "late_penalty", "early_leave_penalty"})

    # Sanity threshold for annual leave balance (days). Values beyond this indicate bad data.
    _MAX_REASONABLE_ANNUAL_LEAVE_DAYS = 9999


    def __init__(self, employee_code: str):
        self.employee_code = employee_code
        self.events = []
        self.rules = []
        
        # Summary fields
        self.tong_ngay_cong = 0
        self.ngay_du_cong = 0
        self.nua_ngay_cong = 0
        self.di_muon_ve_som = 0
        self.vang_mat = 0
        self.quen_cham_cong = 0
        self.tang_ca = 0
        self.lam_them_gio = 0
        self.truc_toi = 0
        self.live = 0
        self.nghi_phep = 0
        self.nghi_khong_luong = 0
        self.giai_trinh_cham_cong = 0
        self.tong_phat = 0
        self.tong_phu_cap_gui_xe = 0
        self.tong_phu_cap_livestream = 0
        self.lam_viec_online = 0
        
        # Monthly context
        self.violation_count_month = 0
        self.explanation_quota_used = 0

        # Annual leave tracking
        self.remaining_annual_leave = 0.0

        self.calendar_result = []  # Dùng để lưu kết quả chi tiết từng ngày, có thể dùng để hiển thị lịch chấm công
        self._approved_off_duty_dates = set()  # Lưu các ngày đã được duyệt ra trực
        self.position_code = None  # Mã vị trí của nhân viên (e.g. "NV_TELESALE")
        # {'YYYY-MM-DD': N} — ngày NV hưởng chế độ con nhỏ, được đi muộn / về sớm thêm
        # N phút mỗi chiều (hrm/child_care_regime.py, nạp trong replay_month).
        self._child_care_minutes = {}
        # Mặc định: thứ 7 tuần 2/4 trong tháng chỉ làm nửa ngày (xem
        # _evaluate_afternoon_shift_rule). Phòng ban nào làm chiều thứ 7 mọi tuần thì
        # set True qua Department.saturday_afternoon_always_workday (xem replay_month).
        self.saturday_afternoon_always_workday = False
        # {date: bool} cho từng thứ 7 của tháng — lịch phòng ban đổi giữa tháng
        # (employee.DepartmentScheduleChange) thì mỗi thứ 7 theo lịch của chính ngày đó.
        # Ngày không có trong map thì dùng saturday_afternoon_always_workday.
        self._saturday_afternoon_by_date = {}
        # Cache trong đời 1 EmployeeState (= đúng phạm vi 1 lượt replay_month
        # cho 1 nhân viên) cho get_all_candidate_shifts_for_employee — tránh
        # N+1 query lặp lại Employee+ShiftConfig scope mỗi ngày trong tháng
        # (xem docstring hàm đó). Tạo mới cho mỗi instance -> không có rủi ro
        # dữ liệu cũ giữa các request/replay khác nhau.
        self._shift_scope_cache = {}
        # Cache tương tự cho ShiftRegistrationScopeConfig.for_employee() —
        # dùng bởi get_registered_shift_configs_for_date() (xem docstring
        # hàm đó), gọi 1 lần/ngày attendance trong replay_month cho ĐÚNG 1
        # nhân viên -> cache theo employee.id, tạo mới mỗi instance.
        self._registration_scope_cache = {}
        # Cache tương tự cho load_shift_configs_for_employee() — engine giờ giải
        # ca cố định theo ĐÚNG TỪNG NGÀY (xem _rules_from_shift_configs_for_date)
        # thay vì 1 lần bằng ngày đầu tháng, nên hàm đó được gọi 1 lần/ngày
        # attendance; cache giữ phần Employee + scope ShiftConfig theo từng cấp
        # (không đổi giữa các ngày) để không sinh N+1 query.
        self._shift_by_date_cache = {}
        # Cache đối tượng Employee (ORM) của chính nhân viên đang replay —
        # get_registered_shift_configs_for_date() nhận vào Employee chứ không
        # phải employee_code, mà _resolve_effective_rules_for_event() gọi nó 1
        # lần cho MỖI ngày chấm công trong tháng. Tra 1 lần rồi dùng lại để
        # không sinh N+1 query. Dùng cờ riêng thay vì kiểm tra None vì nhân
        # viên không tồn tại cũng là kết quả hợp lệ cần nhớ (khỏi query lại).
        self._employee_obj = None
        self._employee_obj_loaded = False
        # {date_str: [so_loi_muon_som, so_loi_quen_cc]} đã được trừ sớm tại ngày vi
        # phạt bởi event "counter_release_only" (xem replay_month).
        self._counter_released_by_date = {}
        # (ngày, loại, kiểu quên CC) của đơn giải trình vi phạm đã áp dụng —
        # đơn duyệt TRÙNG cho cùng khoá bị bỏ qua (xem _evaluate_explanation_approval_rule).
        self._applied_explanation_keys = set()
        # Trực tối tự động theo ca (ShiftConfig.counts_as_night_duty, vd "Ca kinh
        # doanh" 13-21): ngày nhận diện được ca đó / ngày đã cộng tự động / ngày
        # có đơn Trực tối được duyệt (để 2 nguồn không cộng trùng).
        self._night_duty_shift_dates = set()
        self._auto_night_duty_counted = set()
        self._night_shift_request_dates = set()

    def _saturday_afternoon_workday_on(self, day) -> bool:
        """Chiều thứ 7 ngày `day` có là giờ làm (làm chiều T7 mọi tuần) không — theo
        lịch của chính ngày đó (_saturday_afternoon_by_date, dựng ở replay_month), thiếu
        thì theo cờ chung của state."""
        return self._saturday_afternoon_by_date.get(day, self.saturday_afternoon_always_workday)

    def add_event(self, event: Event):
        self.events.append(event)
        print(f"Added event: {event.event_type} with data: {event.data}")
        self.apply_rules(event)
    
    def init_rules(self, employee_info: dict = None):
        # Get rules for this employee using the rule registry
        self.rules = get_rules_for_employee(self.employee_code, employee_info)
        # Store position code for position-specific logic (e.g. Telesale)
        if employee_info:
            self.position_code = employee_info.get("position_code") or None
        print(f"Loaded {len(self.rules)} rules for employee {self.employee_code}")
        for rule in self.rules:
            print(f"  - {rule['rule_name']} (priority: {rule.get('priority', 0)})")
    
    def _get_rules_from_db(self, employee_code: str, employee_info: dict = None) -> list:
        """
        Get rules for an employee from the database.
        This replaces the in-memory rule registry with database queries.
        """
        from collections import defaultdict
        from django.utils import timezone
        from hrm.event_models import RuleDefinition
        
        # Get all active rules from RuleDefinition
        today = timezone.now().date()
        all_rules = RuleDefinition.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).exclude(
            effective_to__lt=today
        )
        
        # Collect all rules that apply to this employee
        collected_rules = []

        # Check rules from most specific to least specific scope:
        # INDIVIDUAL(4) > POSITION(3) > GROUP(~3) > DEPARTMENT(2) > COMPANY(1)
        scopes_to_check = [
            ("INDIVIDUAL", employee_code),
            ("POSITION", None),   # Will check position of this employee
            ("GROUP", None),      # Will check all groups
            ("DEPARTMENT", None), # Will check all departments
            ("COMPANY", "ALL")
        ]

        for scope, identifier in scopes_to_check:
            if scope in ("POSITION", "GROUP", "DEPARTMENT"):
                keys_to_check = []
                if scope == "POSITION" and employee_info and "position_id" in employee_info:
                    keys_to_check.append((scope, str(employee_info["position_id"])))
                elif scope == "GROUP" and employee_info and "group_ids" in employee_info:
                    for group_id in employee_info.get("group_ids", []):
                        keys_to_check.append((scope, group_id))
                elif scope == "DEPARTMENT" and employee_info and "department_id" in employee_info:
                    keys_to_check.append((scope, employee_info.get("department_id")))

                for key in keys_to_check:
                    scope_rules = all_rules.filter(scope=key[0], identifier=key[1])
                    collected_rules.extend(scope_rules)
            else:
                # For individual and company scopes
                scope_rules = all_rules.filter(scope=scope, identifier=identifier)
                collected_rules.extend(scope_rules)

        # Group rules by rule_type
        rules_by_type = defaultdict(list)
        for rule in collected_rules:
            rules_by_type[rule.rule_type].append(rule)

        # For each rule_type, select the rule with highest priority
        # Convention: INDIVIDUAL=4, POSITION=3, DEPARTMENT=2, COMPANY=1
        final_rules = []
        for rule_type, rules in rules_by_type.items():
            highest_priority_rule = max(rules, key=lambda r: r.priority)
            final_rules.append(highest_priority_rule.to_dict())

        # Sort by priority (higher priority first) for consistent ordering
        final_rules.sort(key=lambda x: x.get("priority", 0), reverse=True)
        return final_rules

    # ------------------------------------------------------------------
    # Phase 1: Match (pure, no mutation)
    # ------------------------------------------------------------------
    def _match_rule_for_event(self, event: Event, rule: dict) -> bool:
        """
        Pure matching function - determines if a rule applies to an event.
        No side effects, no state mutation.
        
        Returns True if rule should be considered for this event.
        """
        rule_type = rule.get("rule_type", "")

        # Category matching
        allowed_types = self.EVENT_RULE_CATEGORY_MAP.get(event.event_type, [])
        if rule_type not in allowed_types:
            return False

        # For non-shift rules, category matching is sufficient
        if not rule_type.startswith("SHIFT_RULE"):
            return True

        # For shift rules, we need to check time window
        # This is still pure matching logic
        from datetime import datetime, timedelta
        
        conditions = rule.get("conditions", {})
        start_time_str = conditions.get("start_time")
        end_time_str = conditions.get("end_time")

        if not start_time_str or not end_time_str:
            return True  # Rule without time window applies to all attendance

        def parse_t(t: str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.strptime(t, fmt).time()
                except ValueError:
                    continue
            return None

        shift_start = parse_t(start_time_str)
        shift_end = parse_t(end_time_str)
        if not shift_start or not shift_end:
            return True  # Invalid time format

        check_in_str = event.data.get("check_in")
        check_out_str = event.data.get("check_out")
        check_in = parse_t(check_in_str) if check_in_str else None
        check_out = parse_t(check_out_str) if check_out_str else None

        if check_in and check_out:
            # Both check-in and check-out: check overlap with shift
            return check_in < shift_end and check_out > shift_start

        if check_in:
            # Only check-in: check if within shift window (with buffer)
            buffer = timedelta(minutes=15)
            window_start = (datetime.combine(datetime.today(), shift_start) - buffer).time()
            return window_start <= check_in < shift_end

        if check_out:
            # Only check-out: check if within shift window
            return shift_start < check_out <= shift_end

        # No time information
        return False

    # ------------------------------------------------------------------
    # Phase 2: Evaluate (calculate effect, no mutation)
    # ------------------------------------------------------------------
    def _evaluate_rule_effect(self, event: Event, rule: dict, current_effects: dict = None) -> dict:
        """
        Evaluate the effect of applying a rule to an event.
        Returns a dictionary of state changes (deltas).
        Pure function - no side effects, no state mutation.
        """
        rule_type = rule.get("rule_type", "")
        
        if rule_type == "SHIFT_RULE_MORNING":
            return self._evaluate_morning_shift_rule(event, rule, current_effects=current_effects)
        elif rule_type == "SHIFT_RULE_AFTERNOON":
            return self._evaluate_afternoon_shift_rule(event, rule, current_effects=current_effects)
        elif rule_type in ("LEAVE_RULE_PAID", "LEAVE_RULE_UNPAID"):
            return self._evaluate_leave_rule(event, rule)
        elif rule_type == "OVERTIME_RULE":
            return self._evaluate_overtime_rule(event, rule)
        elif rule_type == "LIVESTREAM_RULE":
            return self._evaluate_livestream_rule(event, rule)
        elif rule_type == "EXPLANATION_RULE":
            return self._evaluate_explanation_rule(event, rule)
        elif rule_type == "EXPLANATION_APPROVAL_RULE":
            return self._evaluate_explanation_approval_rule(event, rule)
        elif rule_type == "ONLINE_WORK_RULE":
            return self._evaluate_online_work_rule(event, rule)
        else:
            return {}  # Unknown rule type, no effect

    # ------------------------------------------------------------------
    # Phase 3: Commit (apply effects to state)
    # ------------------------------------------------------------------
    def _commit_effects(self, effects: dict):
        """
        Apply effects to the current state.
        Mutates the state based on calculated effects.
        """
        # Fields that are informational only and should not be committed to state
        for key, value in effects.items():
            if key in self._INFORMATIONAL_EFFECT_FIELDS:
                continue
            if hasattr(self, key):
                current_value = getattr(self, key)
                if isinstance(current_value, (int, float)):
                    setattr(self, key, current_value + value)
                else:
                    # For non-numeric fields, we might need special handling
                    # For now, assume numeric addition
                    setattr(self, key, current_value + value)
            else:
                logger.warning("Unknown state field '%s' in effects", key)

        # Recalculate tong_ngay_cong whenever nua_ngay_cong or ngay_du_cong changes.
        # Convert accumulated half-days to full days when they reach 1.0
        # (e.g. morning + afternoon attendance on the same day each add 0.5).
        if "nua_ngay_cong" in effects or "ngay_du_cong" in effects:
            if self.nua_ngay_cong >= 1.0:
                full_days_count = int(self.nua_ngay_cong)
                self.ngay_du_cong += full_days_count
                self.nua_ngay_cong -= full_days_count
            self.tong_ngay_cong = self.ngay_du_cong + self.nua_ngay_cong

    # ------------------------------------------------------------------
    # Ca đã đăng ký theo ngày ("Đăng ký ca làm") — ưu tiên tuyệt đối
    # ------------------------------------------------------------------
    def _get_employee_obj(self):
        """Employee ORM object của nhân viên đang replay (cache 1 lần/instance).

        Trả về None nếu không tìm thấy — nơi gọi phải coi như "không có thông
        tin bổ sung" và giữ nguyên hành vi cascade, tuyệt đối không raise (hàm
        này nằm trên đường đi của MỌI lượt chấm công).
        """
        if not self._employee_obj_loaded:
            self._employee_obj_loaded = True
            try:
                from employee.models import Employee as _Emp
                self._employee_obj = _Emp.objects.filter(employee_id=self.employee_code).first()
            except Exception:
                logger.exception(
                    "[RegisteredShift] Lỗi khi tra Employee cho NV=%s -> bỏ qua ca đăng ký",
                    self.employee_code,
                )
                self._employee_obj = None
        return self._employee_obj

    def _rules_from_registered_shifts(self, event_date):
        """
        Rule ca sáng/chiều sinh từ (các) ca đã ĐĂNG KÝ ("Đăng ký ca làm") cho
        ĐÚNG ngày `event_date`, hoặc None nếu không áp dụng.

        Đây là ưu tiên TUYỆT ĐỐI, đứng trên cả cascade ca cố định lẫn bước tự
        động nhận diện ca: nhân viên thuộc phạm vi ShiftRegistrationScopeConfig
        đã đăng ký/được duyệt Ca 1 hay Ca 2 cho ngày nào thì công, đi muộn, về
        sớm của ngày đó phải tính theo đúng cặp ca ấy.

        Trước đây bước này CHỈ ghi `event_data['shift_start_time']` trong
        replay_month — mà không nơi nào đọc lại — nên ca đăng ký hoàn toàn
        không ảnh hưởng tới công/phạt: nhân viên đăng ký Ca 2 (9h30) vẫn bị
        tính đi muộn theo ca cascade 7h30 (sự cố thực tế: NV80026 ngày
        2026-09-09, muộn 103' + phạt 200.000đ dù đã duyệt Ca 2).

        Trả về:
          - list rule (đã thay thế TOÀN BỘ SHIFT_RULE_MORNING/AFTERNOON của
            self.rules) nếu ngày đó có ca đăng ký.
          - None nếu nhân viên ngoài phạm vi, chưa đăng ký gì cho ngày này,
            hoặc đăng ký NGHỈ ([]) -> nơi gọi giữ nguyên hành vi cũ.

        Lưu ý về nhánh `[]` (đăng ký nghỉ): CỐ Ý trả None để giữ đúng hành vi
        hiện tại (rơi về cascade). Nếu coi `[]` là "không có ca nào" thì ngày
        nghỉ mà nhân viên vẫn chấm công sẽ mất sạch công lẫn phạt — thay đổi
        nghiệp vụ rộng hơn phạm vi sửa lỗi này, cần chốt riêng.
        """
        employee = self._get_employee_obj()
        if not employee:
            return None

        # Bọc try/except theo đúng convention phòng thủ của khối ca đăng ký
        # trong replay_month: đây là bảng của 1 tính năng PHỤ, lỗi ở đây tuyệt
        # đối không được làm sập luồng tính công/chấm công của mọi nhân viên.
        try:
            registered = _get_registered_shift_configs_for_date(
                employee, event_date, self._registration_scope_cache,
            )
        except Exception:
            logger.exception(
                "[RegisteredShift] Lỗi khi lấy ca đã đăng ký cho NV=%s ngày=%s "
                "-> bỏ qua, dùng cascade ca cố định",
                self.employee_code, event_date,
            )
            return None

        if not registered:  # None (ngoài phạm vi/chưa đăng ký) hoặc [] (nghỉ)
            return None

        synthetic = _shift_configs_to_rules(registered)

        # Dedup theo rule_type: mỗi ca đăng ký là 1 CẶP (ca sáng, ca chiều) nên
        # bình thường ra đúng 1 rule mỗi loại. Nếu cấu hình bị đặt nhầm thành 2
        # ca cùng loại, giữ ca đầu tiên (registered đã sắp theo start_time) thay
        # vì để cả 2 cùng cộng công -> tránh vượt 1 công/ngày.
        deduped, seen = [], set()
        for r in synthetic:
            rt = r.get('rule_type')
            if rt in seen:
                logger.warning(
                    "[RegisteredShift] NV=%s ngày=%s: 2 ca đăng ký cùng rule_type=%s "
                    "-> bỏ qua ca '%s'. Kiểm tra lại ShiftRegistrationScopeConfig.",
                    self.employee_code, event_date, rt, r.get('rule_name'),
                )
                continue
            seen.add(rt)
            deduped.append(r)

        # Ca đăng ký định nghĩa TRỌN VẸN ngày làm việc đó -> bỏ hết rule ca
        # sáng/chiều cũ (cascade) rồi thay bằng rule sinh từ cặp ca đăng ký.
        # Không giữ lại rule cascade cho nửa ngày mà cặp ca không phủ, vì cặp
        # ca đăng ký mới là nguồn sự thật cho ngày này.
        effective = [
            r for r in self.rules
            if r.get('rule_type') not in ('SHIFT_RULE_MORNING', 'SHIFT_RULE_AFTERNOON')
        ]
        effective.extend(deduped)

        print(
            f"[RegisteredShift] {event_date}: dùng ca đã đăng ký "
            f"{[(sc.name, str(sc.start_time)[:5], str(sc.end_time)[:5]) for sc in registered]} "
            f"-> thay rule ca sáng/chiều cho riêng ngày này"
        )
        return effective

    def _rules_from_shift_configs_for_date(self, event_date) -> list:
        """Ca cố định (ShiftConfig) giải theo ĐÚNG NGÀY này, thay cho ca đã
        giải 1 lần bằng ngày ĐẦU THÁNG lúc dựng self.rules (replay_month).

        VÌ SAO CẦN: replay_month gọi load_shift_configs_for_employee() với
        `start_date` = ngày 01 của tháng rồi dùng kết quả đó cho cả 30 ngày.
        Nhân viên đổi ca GIỮA THÁNG vì thế bị tính sai toàn bộ phần sau mốc
        đổi — hệ thống không biểu diễn được việc đổi ca giữa tháng.

        Sự cố thực tế (NV80010, 2026-09): ca 01-21/09 là 08:00-17:00, từ 22/09
        đổi sang 07:30-16:30. Engine chỉ thấy ca đầu tháng nên các ngày 23-29/09
        ra về đúng giờ 16:30 vẫn bị tính VỀ SỚM 30 phút + phạt 100.000đ/ngày.

        CHỈ ghi đè những rule_type vốn được SINH RA từ ShiftConfig ở đầu tháng
        (rule_name bắt đầu bằng 'ShiftConfig: ') — rule_type nào có
        RuleDefinition khai báo tường minh thì giữ nguyên, đúng thứ tự ưu tiên
        cũ (replay_month chỉ thêm synthetic rule cho loại CHƯA có RuleDefinition).

        Trả về None khi không có gì phải đổi (không có rule synthetic, không
        giải được ca, hoặc ca của ngày này trùng ca đang dùng) -> nơi gọi giữ
        nguyên hành vi cũ, nên nhân viên KHÔNG đổi ca giữa tháng không bị
        ảnh hưởng gì.
        """
        synthetic_types = {
            r.get('rule_type') for r in self.rules
            if str(r.get('rule_name', '')).startswith('ShiftConfig: ')
            and r.get('rule_type') in ('SHIFT_RULE_MORNING', 'SHIFT_RULE_AFTERNOON')
        }
        if not synthetic_types:
            return None

        try:
            configs = _load_shift_configs_for_employee(
                self.employee_code, event_date, self._shift_by_date_cache,
            )
        except Exception:
            logger.exception(
                "[ShiftPerDay] Lỗi khi giải ca theo ngày cho NV=%s ngày=%s -> giữ ca đầu tháng",
                self.employee_code, event_date,
            )
            return None
        if not configs:
            return None

        per_day, seen = [], set()
        for r in _shift_configs_to_rules(configs):
            rt = r.get('rule_type')
            if rt not in synthetic_types or rt in seen:
                continue
            seen.add(rt)
            per_day.append(r)
        if not per_day:
            return None

        hien_tai = {
            r.get('rule_type'): r.get('conditions', {})
            for r in self.rules if r.get('rule_type') in seen
        }
        if all(
            hien_tai.get(r['rule_type'], {}).get('start_time') == r['conditions']['start_time']
            and hien_tai.get(r['rule_type'], {}).get('end_time') == r['conditions']['end_time']
            for r in per_day
        ):
            return None  # ca ngày này trùng ca đầu tháng -> no-op

        print(
            f"[ShiftPerDay] {event_date}: ca cố định của ngày này khác ca đầu tháng "
            f"-> dùng {[(r['conditions']['start_time'][:5], r['conditions']['end_time'][:5]) for r in per_day]}"
        )
        effective = [r for r in self.rules if r.get('rule_type') not in seen]
        effective.extend(per_day)
        return effective

    # ------------------------------------------------------------------
    # Tự động nhận diện ca làm thực tế theo giờ checkin/checkout
    # ------------------------------------------------------------------
    def _resolve_effective_rules_for_event(self, event: Event) -> list:
        """
        Trả về self.rules, trừ khi:

          (a) Ngày này nhân viên có ca đã ĐĂNG KÝ ("Đăng ký ca làm") -> dùng
              đúng cặp ca đó, ưu tiên tuyệt đối (xem
              _rules_from_registered_shifts); hoặc
          (b) Ngày này là chấm công (attendance) và giờ
        checkin/checkout thực tế khớp (trong dung sai ±60 phút cho cả 2 đầu)
        với 1 ShiftConfig KHÁC đang gán cho nhân viên (cá nhân/vị trí/phòng
        ban) — không phải ca mặc định (SHIFT_RULE_MORNING/AFTERNOON) đang
        dùng để tính công cho họ.

        Rule mới: NV checkin ~13h/checkout ~21h mà công ty đã cấu hình 1 ca
        13:00-21:00 áp dụng cho NV/vị trí/phòng ban đó -> ngày này tính công
        theo đúng ca đó (đủ công, đi muộn/về sớm tính theo khung 13-21) thay
        vì ca mặc định (vd: ca chiều hành chính 13:00-17:30, vốn sẽ chỉ chấm
        đủ nửa công và cần làm đơn tăng ca cho phần dư).

        Chỉ thay thế CHO NGÀY NÀY (không sửa self.rules) — các ngày khác
        trong tháng vẫn tính theo ca mặc định như cũ. Nhân viên không được
        gán thêm ca nào khác ngoài ca mặc định thì không bị ảnh hưởng gì
        (candidates chỉ có đúng 1 ca -> không có gì để "phát hiện thêm").
        """
        if event.event_type != "attendance":
            return self.rules

        event_date_str = event.data.get("date")
        if not event_date_str:
            return self.rules

        from datetime import datetime as _dt
        try:
            event_date = _dt.strptime(str(event_date_str), "%Y-%m-%d").date()
        except ValueError:
            return self.rules

        # ── Ưu tiên TUYỆT ĐỐI: (các) ca đã ĐĂNG KÝ cho đúng ngày này ──
        # Đặt TRƯỚC cả guard check_in/check_out bên dưới vì ca đăng ký không
        # phụ thuộc giờ chấm công thực tế — ngày quên chấm công (thiếu
        # check_out) cũng phải được tính đi muộn theo đúng ca đã đăng ký.
        registered_rules = self._rules_from_registered_shifts(event_date)
        if registered_rules is not None:
            return registered_rules

        # ── Ca cố định giải theo ĐÚNG NGÀY này (không phải ca đầu tháng) ──
        # Đặt ngay sau ca đăng ký và TRƯỚC mọi bước còn lại để `base_rules`
        # trở thành nền cho cả nhánh thiếu giờ chấm công lẫn bước tự động
        # nhận diện ca bên dưới — nếu chỉ sửa ở cuối thì
        # detect_best_matching_shift() vẫn so với ca đầu tháng (sai) và có
        # thể "ghi đè" nhầm hoặc bỏ qua nhầm.
        base_rules = self._rules_from_shift_configs_for_date(event_date) or self.rules

        check_in_str = event.data.get("check_in")
        check_out_str = event.data.get("check_out")
        if not check_in_str or not check_out_str:
            return base_rules

        try:
            candidates = _get_all_candidate_shifts_for_employee(self.employee_code, event_date, self._shift_scope_cache)
        except Exception:
            logger.exception(
                "[AutoShiftDetect] Lỗi khi lấy danh sách ca cho NV=%s ngày=%s -> bỏ qua, dùng ca mặc định",
                self.employee_code, event_date,
            )
            return base_rules

        if not candidates:
            # Không có ca nào áp dụng -> không có gì để "phát hiện thêm"
            return base_rules
        # Lưu ý: KHÔNG yêu cầu len(candidates) >= 2. Khi phòng ban/vị trí chỉ
        # được gán DUY NHẤT 1 ca và ca đó là detection_only=True (vd "Ca kinh
        # doanh" 13:00-21:00 gán riêng cho 1 phòng ban không có ca ngắn nào
        # khác cạnh tranh), get_all_candidate_shifts_for_employee() trả về
        # đúng 1 phần tử -- nhưng ca mặc định THỰC TẾ (từ
        # load_shift_configs_for_employee(), có loại trừ detection_only) lại
        # là ca công ty ở cấp khác hẳn, nên vẫn CẦN so khớp ca duy nhất này
        # với giờ chấm công thực tế. Nếu bỏ qua (như guard "< 2" cũ), NV làm
        # đúng ca kinh doanh vẫn bị tính theo ca mặc định ngắn hơn -> thiếu
        # công (sự cố thực tế NV80027, phòng Kinh Doanh 1, 2026-09-17).
        # An toàn vì detect_best_matching_shift() vẫn đòi khớp trong dung sai
        # ±60' cả 2 đầu, và bước so sánh "detected == current" ngay dưới đây
        # tự động no-op khi ca duy nhất đó vốn đã là ca mặc định đang dùng.

        # Ca mặc định ĐANG DÙNG cho từng loại (sáng/chiều) — truyền vào để
        # detect_best_matching_shift() chỉ ghi đè khi ứng viên lệch RÕ RỆT
        # hơn ca mặc định (margin, xem docstring hàm đó) thay vì đổi ca chỉ
        # vì chênh nhau vài phút ngẫu nhiên.
        current_rules_by_type = {
            r['rule_type']: (r.get('conditions', {}).get('start_time'), r.get('conditions', {}).get('end_time'))
            for r in base_rules
            if r.get('rule_type') in ('SHIFT_RULE_MORNING', 'SHIFT_RULE_AFTERNOON')
        }

        detected = _detect_best_matching_shift(
            candidates, check_in_str, check_out_str,
            current_rules_by_type=current_rules_by_type,
        )
        if not detected:
            return base_rules

        if getattr(detected, 'counts_as_night_duty', False) and event_date >= NIGHT_DUTY_SHIFT_EFFECTIVE_FROM:
            self._night_duty_shift_dates.add(event_date_str)

        detected_rule_type = _AUTO_SHIFT_TYPE_TO_RULE_TYPE.get(detected.shift_type, 'SHIFT_RULE_MORNING')
        from .shift_config_utils import shift_workday
        override_rule = {
            'rule_name': f'Tự động nhận diện ca: {detected.name}',
            'rule_type': detected_rule_type,
            'conditions': {
                'start_time': str(detected.start_time)[:8],
                'end_time': str(detected.end_time)[:8],
                'workday': shift_workday(detected),
            },
            'priority': 999,
        }

        # Nếu ca phát hiện được GIỐNG HỆT rule hiện có (cùng rule_type, cùng
        # start/end) thì không cần thay gì -> tránh log/tính toán thừa.
        current = next((r for r in base_rules if r.get('rule_type') == detected_rule_type), None)
        if (
            current
            and current.get('conditions', {}).get('start_time') == override_rule['conditions']['start_time']
            and current.get('conditions', {}).get('end_time') == override_rule['conditions']['end_time']
        ):
            return base_rules

        print(
            f"[AutoShiftDetect] {event_date_str}: checkin={check_in_str} checkout={check_out_str} "
            f"khớp ca '{detected.name}' ({detected.start_time}-{detected.end_time}) "
            f"-> ghi đè rule {detected_rule_type} cho riêng ngày này"
        )

        effective = [r for r in base_rules if r.get('rule_type') != detected_rule_type]
        effective.append(override_rule)
        return effective

    # ------------------------------------------------------------------
    # Bước 2: Điều phối rule phù hợp và cập nhật state (refactored)
    # ------------------------------------------------------------------
    def apply_rules(self, event: Event):
        """
        Áp dụng các rule phù hợp với event vừa nhận.

        Luồng xử lý mới:
          1. Load rules nếu chưa có.
          2. Với mỗi rule, gọi _match_rule_for_event() để kiểm tra xem
             rule này có được phép xử lý event đó không.
          3. Nếu match → gọi _evaluate_rule_effect() để tính toán hiệu ứng.
          4. Áp dụng hiệu ứng vào state bằng _commit_effects().
          5. Ghi snapshot trạng thái vào calendar_result.
        """
        # --- Load rules nếu cần ---
        if not self.rules:
            self.init_rules()

        # --- Snapshot TRƯỚC khi xử lý (để tính delta) ---
        state_before = {
            "tong_ngay_cong": self.tong_ngay_cong,
            "ngay_du_cong":   self.ngay_du_cong,
            "nua_ngay_cong":  self.nua_ngay_cong,
            "di_muon_ve_som": self.di_muon_ve_som,
            "vang_mat":       self.vang_mat,
            "quen_cham_cong": self.quen_cham_cong,
            "tong_phat":      self.tong_phat,
            "explanation_quota_used": self.explanation_quota_used,
        }

        applied_rules = []
        all_effects = {}

        # --- Duyệt qua từng rule ---
        # effective_rules == self.rules, trừ khi checkin/checkout hôm nay khớp
        # 1 ca khác đã gán cho NV (xem _resolve_effective_rules_for_event) —
        # khi đó rule ca sáng/chiều mặc định được thay bằng ca đó CHO NGÀY NÀY.
        effective_rules = self._resolve_effective_rules_for_event(event)

        # An toàn thứ tự: đảm bảo SHIFT_RULE_MORNING luôn được xét TRƯỚC
        # SHIFT_RULE_AFTERNOON. Khi rule sinh tự động từ ShiftConfig (trường
        # hợp phổ biến nhất) thứ tự này vốn đã đúng (sắp theo start_time),
        # nhưng rule tường minh từ RuleDefinition (DB) không đảm bảo thứ tự
        # -> nếu 1 NV có cả 2 rule cùng khớp 1 lượt chấm công dài (vd: ca
        # sáng 8h30-17h30 + ca chiều mở rộng 13h-21h cùng gán cho 1 phòng
        # ban), xét sai thứ tự có thể gây "vắng mặt" giả trên 1 ngày đã đủ
        # công (rule chiều hiểu nhầm checkout của ca sáng là "về sớm" so với
        # khung giờ của nó, trước khi rule sáng kịp chốt đủ công). Không ảnh
        # hưởng rule loại khác: attendance chỉ khớp 2 loại SHIFT_RULE_* này
        # (xem EVENT_RULE_CATEGORY_MAP ở constant.py) nên sort không đổi vị
        # trí tương đối của bất kỳ rule nào khác cho event loại attendance.
        _SHIFT_ORDER = {"SHIFT_RULE_MORNING": 0, "SHIFT_RULE_AFTERNOON": 1}
        if event.event_type == "attendance":
            effective_rules = sorted(effective_rules, key=lambda r: _SHIFT_ORDER.get(r.get("rule_type"), 2))

        for rule in effective_rules:
            # Bỏ qua nếu rule không liên quan đến event này
            if not self._match_rule_for_event(event, rule):
                continue

            rule_type = rule.get("rule_type")
 
            # Evaluate effect (phiên bản mới: truyền trạng thái hiện tại để tính phạt chính xác)
            effects = self._evaluate_rule_effect(event, rule, current_effects=all_effects)
            if effects is None:
                logger.error(
                    "[apply_rules] Rule '%s' (type=%s) returned None effects; bỏ qua.",
                    rule.get('rule_name', '?'), rule_type,
                )
                effects = {}
            
            # Merge effects
            for key, value in effects.items():
                if key in all_effects:
                    all_effects[key] += value
                else:
                    all_effects[key] = value

            # Ghi nhận rule đã được thực thi
            applied_rules.append({
                "rule_name": rule.get("rule_name"),
                "rule_type": rule_type,
            })

        # --- Trực tối tự động: ngày làm ca có cờ counts_as_night_duty ---
        # (yêu cầu 2026-10-03: làm "Ca kinh doanh" 13-21 thì được tính 1 buổi trực
        # tối, không cần đơn). Ngày đã có đơn Trực tối duyệt -> chỉ tính theo đơn.
        night_date = event.data.get("date") if event.event_type == "attendance" else None
        if (
            night_date in self._night_duty_shift_dates
            and night_date not in self._auto_night_duty_counted
            and night_date not in self._night_shift_request_dates
        ):
            all_effects["truc_toi"] = all_effects.get("truc_toi", 0) + 1
            self._auto_night_duty_counted.add(night_date)
            print(f"[NightDutyShift] {night_date}: làm ca tính trực tối -> truc_toi += 1")

        # --- Fallback: attendance với check_in nhưng không có check_out ---
        # Nếu không có shift rule nào xử lý quen_cham_cong (ví dụ: không có rule
        # nào khớp, hoặc check_in nằm ngoài mọi cửa sổ ca), ta vẫn phải ghi nhận
        # ngày quên chấm công để summary.forgot_checkin_days được tính đúng.
        if (
            event.event_type == "attendance"
            and event.data.get("check_in")
            and not event.data.get("check_out")
            and all_effects.get("quen_cham_cong", 0) == 0
            and event.data.get("date") not in self._approved_off_duty_dates
        ):
            all_effects["quen_cham_cong"] = 1
            print(
                f"[Fallback] Attendance có check_in nhưng không có check_out "
                f"→ quen_cham_cong += 1 (tổng: {self.quen_cham_cong + 1})"
            )

        # --- Fallback: attendance có check_out nhưng KHÔNG có check_in ---
        # Đối xứng với fallback ngay trên. Cần vì _match_rule_for_event() chỉ
        # khớp ngày "chỉ có giờ ra" khi giờ ra nằm TRONG ca (shift_start <
        # check_out <= shift_end) — mà người quên chấm lúc đến thường về SAU giờ
        # tan ca (vd 17:36 với ca tan 17:30), nên không rule nào khớp và ngày đó
        # không bị tính quên chấm công. Trước đây hiếm gặp vì file chấm công
        # luôn xếp lần chấm duy nhất vào cột giờ vào; từ khi upload phân loại
        # đúng lần chấm lúc về thành giờ ra (shift_config_utils.
        # lone_punch_is_checkout) thì đây là trường hợp phổ biến.
        if (
            event.event_type == "attendance"
            and event.data.get("check_out")
            and not event.data.get("check_in")
            and all_effects.get("quen_cham_cong", 0) == 0
            and event.data.get("date") not in self._approved_off_duty_dates
        ):
            all_effects["quen_cham_cong"] = 1
            print(
                f"[Fallback] Attendance có check_out nhưng không có check_in "
                f"→ quen_cham_cong += 1 (tổng: {self.quen_cham_cong + 1})"
            )

        # --- Fallback: attendance có check_in và check_out quá gần nhau ---
        # Nếu không có shift rule nào phát hiện ra khoảng cách checkin/checkout ngắn
        # (ví dụ: sự kiện nằm ngoài cửa sổ ca), ta vẫn ghi nhận quên chấm công.
        _fb_ci = event.data.get("check_in")
        _fb_co = event.data.get("check_out")
        if (
            event.event_type == "attendance"
            and _fb_ci
            and _fb_co
            and all_effects.get("quen_cham_cong", 0) == 0
            and event.data.get("date") not in self._approved_off_duty_dates
        ):
            _diff = _calc_checkin_checkout_diff(_fb_ci, _fb_co)
            if 0 <= _diff <= _MIN_CHECKIN_CHECKOUT_DIFF_MINUTES:
                all_effects["quen_cham_cong"] = 1
                print(
                    f"[Fallback] check_in={_fb_ci}, check_out={_fb_co} cách nhau {_diff} phút "
                    f"(≤ {_MIN_CHECKIN_CHECKOUT_DIFF_MINUTES} phút) "
                    f"→ quen_cham_cong += 1 (tổng: {self.quen_cham_cong + 1})"
                )

        # --- Bảo vệ: tổng công từ ca không vượt quá 1.0/ngày ---
        # Dù các hàm đánh giá ca đã có guard riêng, đây là lưới an toàn cuối cùng
        # để xử lý các trường hợp biên (ví dụ: cấu hình ca đặc biệt, rule ưu tiên cao).
        if event.event_type == "attendance":
            raw_cong = all_effects.get("nua_ngay_cong", 0)
            if raw_cong > 1.0:
                print(
                    f"[Cap] Tổng công ca trong ngày = {raw_cong:.2f} > 1.0 "
                    f"→ làm tròn về 1.0 (tăng ca cần làm đơn riêng)"
                )
                all_effects["nua_ngay_cong"] = 1.0

        # --- Commit all effects to state ---
        self._commit_effects(all_effects)

        # --- Snapshot SAU khi xử lý ---
        state_after = {
            "tong_ngay_cong": self.tong_ngay_cong,
            "ngay_du_cong":   self.ngay_du_cong,
            "nua_ngay_cong":  self.nua_ngay_cong,
            "di_muon_ve_som": self.di_muon_ve_som,
            "vang_mat":       self.vang_mat,
            "quen_cham_cong": self.quen_cham_cong,
            "tong_phat":      self.tong_phat,
            "explanation_quota_used": self.explanation_quota_used,
        }

        # --- Lưu vào calendar_result để hiển thị lịch chấm công ---
        self.calendar_result.append({
            # Metadata
            "date":          event.data.get("date"),
            "employee_id":   event.data.get("employee_id"),
            "employee_name": event.data.get("employee_name"),
            "event_type":    event.event_type,

            # Dữ liệu chấm công thô
            "check_in":  event.data.get("check_in"),
            "check_out": event.data.get("check_out"),

            # Rules nào đã được áp dụng
            "rules_applied": applied_rules,

            # Trạng thái trước / sau khi xử lý event này
            "state_before": state_before,
            "state_after":  state_after,

            # Thay đổi trong lần xử lý này (delta)
            "delta": {k: state_after[k] - state_before[k] for k in state_after},
            
            # Effects that were calculated (for debugging)
            "effects": all_effects,
        })

    # ------------------------------------------------------------------
    # Helper: tính phạt theo số phút vi phạm
    # ------------------------------------------------------------------
    def _calc_penalty(self, minutes: int, pending_violations: int = 0) -> int:
        """
        Tra mức phạt (VNĐ) từ AttendancePolicyVersion trong DB.
        - Áp dụng nhân đôi khi số lần ĐI MUỘN/VỀ SỚM trong tháng >= threshold
          (KHÔNG tính quên chấm công — quy tắc xác nhận 01/10/2026).
        - Trả về -1 nếu phải trừ công thay vì phạt tiền (>120 phút).
        """
        if _PolicyLoader is not None:
            try:
                cfg = _PolicyLoader.load(_dt.date.today())
                policy = cfg.get("policy", {})
                tiers  = cfg.get("penalty_tiers", [])
                threshold    = int(policy.get("penalty_multiplier_threshold", 7))
                multiplier_v = float(policy.get("penalty_multiplier_value", 2.0))

                # Số lần vi phạm = đi muộn/về sớm + lỗi muộn/sớm treo cùng ngày (pending) + 1 (lần này)
                current_violation = self.di_muon_ve_som + pending_violations + 1
                multiplier = multiplier_v if current_violation >= threshold else 1.0

                fine, work_ded = _PolicyLoader.lookup_penalty(minutes, False, tiers)
                
                logger.info(
                    "[_calc_penalty] Mã NV: %s | Vi phạm: %d phút -> Lần vi phạm thứ: %d (Muộn/sớm: %d, Quên CC: %d). Ngưỡng phạt: %d -> Hệ số: %.1f",
                    self.employee_code, minutes, current_violation, 
                    self.di_muon_ve_som, self.quen_cham_cong, threshold, multiplier
                )

                if work_ded > 0:
                    return -1  # sentinel: trừ 0.5 công
                return int(fine * multiplier)
            except Exception as exc:
                logger.warning("_calc_penalty: không tải được policy từ DB (%s), dùng bảng cứng", exc)

        # Fallback: bảng phạt cứng khi chưa có DB config
        if minutes <= 10:
            return 50_000
        elif minutes <= 30:
            return 100_000
        elif minutes <= 60:
            return 120_000
        elif minutes < 120:
            return 200_000
        else:
            return -1  # Sentinel: muộn/sớm >= 2 tiếng → trừ 0.5 công

    def _get_penalty_for_date(self, event_date: str, explanation_type: str = None) -> int:
        """Tính tiền phạt đã áp dụng cho một ngày (hoặc từng loại đi muộn/về sớm cụ thể)."""
        field_to_sum = "tong_phat"
        if explanation_type == "LATE":
            field_to_sum = "late_penalty"
        elif explanation_type == "EARLY_LEAVE":
            field_to_sum = "early_leave_penalty"

        return sum(
            entry.get("effects", {}).get(field_to_sum, 0)
            for entry in self.calendar_result
            if entry.get("date") == event_date and entry.get("event_type") == "attendance"
        )

    def _get_remaining_penalty_for_date(self, event_date: str, explanation_type: str = None) -> int:
        """Tiền phạt CÒN LẠI của ngày (phạt gốc + các khoản đã hoàn, vốn mang dấu
        âm) — trần cho số tiền 1 đơn giải trình được hoàn, để 2 đơn cùng ngày
        (trùng loại, hoặc Đi muộn rồi Công tác cả ngày) không hoàn quá số đã phạt."""
        field_to_sum = "tong_phat"
        if explanation_type == "LATE":
            field_to_sum = "late_penalty"
        elif explanation_type == "EARLY_LEAVE":
            field_to_sum = "early_leave_penalty"
        return max(0, sum(
            entry.get("effects", {}).get(field_to_sum, 0) or 0
            for entry in self.calendar_result
            if entry.get("date") == event_date
        ))

    def _get_late_minutes_for_date(self, event_date: str, explanation_type: str = "LATE") -> int:
        """Tổng số phút đi muộn (hoặc về sớm, nếu explanation_type='EARLY_LEAVE')
        đã ghi nhận cho một ngày cụ thể."""
        field = "early_leave_minutes" if explanation_type == "EARLY_LEAVE" else "late_minutes"
        return int(sum(
            entry.get("effects", {}).get(field, 0)
            for entry in self.calendar_result
            if entry.get("date") == event_date and entry.get("event_type") == "attendance"
        ))

    # vang_mat và nua_ngay_cong là loại trừ nhau trong shift rules: khi đi muộn >= 120 phút
    # thì rule set vang_mat (không set nua_ngay_cong). Trừ vang_mat ở đây sẽ làm
    # existing_credit thấp hơn thực tế, khiến approval cộng thêm công sai (bug 1.5 công).
    def _get_work_credit_for_date(self, event_date_target: str) -> float:
        """Tính tổng công dương đã được ghi nhận cho một ngày cụ thể (để tránh cộng dồn > 1.0)."""
        if not event_date_target:
            return 0.0
        
        credit = 0.0
        for entry in self.calendar_result:
            if entry.get("date") == event_date_target:
                eff = entry.get("effects", {})
                credit += eff.get("nua_ngay_cong", 0)
                credit += eff.get("ngay_du_cong", 0)
        return credit

    def _has_afternoon_shift_attendance(self, event_date: str) -> bool:
        """Kiểm tra xem NV có thực sự CHẤM CÔNG (check_in) ca chiều cho ngày cụ
        thể hay không — dùng để quyết định có cộng thêm 0.5 công cho đơn Trực
        tối hay không (xem _evaluate_overtime_rule, nhánh NIGHT_SHIFT).

        Trước đây chỉ coi effects.nua_ngay_cong > 0 là "có chấm công", nhưng
        khi đi muộn >= 120 phút, _evaluate_afternoon_shift_rule() set
        effects.vang_mat (KHÔNG set nua_ngay_cong) dù NV VẪN check_in bình
        thường (chỉ là quá muộn) — khiến hàm này trả về False y hệt trường
        hợp hoàn toàn không chấm công, làm đơn Trực tối được duyệt không
        cộng công gì cả (bug: NV đi muộn >120p + có đơn Trực tối duyệt ->
        0 công, thay vì đúng ra phải là 0.5 công từ đơn Trực tối). Tính thêm
        cả vang_mat > 0 vì trong _evaluate_afternoon_shift_rule(), vang_mat
        CHỈ được set khi đã xác nhận có check_in/check_out thực tế (đi muộn/
        về sớm >= 120 phút) — hoàn toàn không chấm công thì chỉ có
        quen_cham_cong=1, không có vang_mat — nên không lẫn với trường hợp
        NV vắng mặt cả ngày."""
        for entry in self.calendar_result:
            if entry.get("date") != event_date:
                continue
            if entry.get("event_type") != "attendance":
                continue
            rules_applied = entry.get("rules_applied", [])
            has_afternoon_rule = any(
                r.get("rule_type") == "SHIFT_RULE_AFTERNOON"
                for r in rules_applied
            )
            if not has_afternoon_rule:
                continue
            eff = entry.get("effects", {})
            if eff.get("nua_ngay_cong", 0) > 0 or eff.get("vang_mat", 0) > 0:
                return True
        return False

    # ------------------------------------------------------------------
    # Evaluate methods (pure functions, return effects)
    # ------------------------------------------------------------------
    def _evaluate_morning_shift_rule(self, event: Event, rule: dict, current_effects: dict = None) -> dict:
        """
        Evaluate morning shift rule effect.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type != "attendance":
            return {}
        
        # Nếu ngày này đã có đơn Ra trực được duyệt, bỏ qua tính toán chấm công (ghi đè 1 công)
        if event.data.get("date") in self._approved_off_duty_dates:
            print(f"[Ca sáng] Ngày {event.data.get('date')} đã duyệt Ra trực -> Bỏ qua tính ca")
            return {}

        # Nếu các ca trước trong cùng ngày đã tích lũy đủ 1 công, bỏ qua ca này.
        # Tránh tình trạng đi làm sáng+chiều mà ngồi thêm một chút vào ca tối
        # khiến tổng công vượt 1.0 (ví dụ thành 1.5).  Nhân viên muốn tính ca tối
        # cần làm đơn tăng ca theo quy trình hiện có.
        if current_effects and current_effects.get("nua_ngay_cong", 0) >= 1.0:
            print(
                f"[Ca sáng ({rule.get('rule_name', '?')})] Ngày {event.data.get('date')} đã đủ 1 công "
                f"(nua_ngay_cong={current_effects['nua_ngay_cong']:.1f}) → bỏ qua ca (đã đạt giới hạn 1 công/ngày)"
            )
            return {}

        from datetime import datetime

        start_time_str = rule.get('conditions', {}).get('start_time')
        end_time_str = rule.get('conditions', {}).get('end_time')
        workday = rule.get('conditions', {}).get('workday', 0.5)

        if not start_time_str or not end_time_str:
            logger.warning(
                "[Ca sáng] Rule '%s' thiếu start_time/end_time trong conditions → bỏ qua",
                rule.get('rule_name', '?'),
            )
            return {}

        def parse_time(t: str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.strptime(t, fmt).time()
                except ValueError:
                    continue
            raise ValueError(f"Cannot parse time: {t}")

        shift_start = parse_time(start_time_str)
        shift_end = parse_time(end_time_str)

        check_in_str = event.data.get("check_in")
        check_out_str = event.data.get("check_out")
        check_in = parse_time(check_in_str) if check_in_str else None
        check_out = parse_time(check_out_str) if check_out_str else None

        effects = {}
        # Chế độ con nhỏ: mốc tính đi muộn / về sớm nới thêm N phút (hrm/child_care_regime.py)
        late_from, early_before = self._child_care_bounds(event, shift_start, shift_end)

        # Lấy số lỗi đã có từ các rule trước đó trong cùng 1 ngày (ví dụ ca đêm trước đó nếu có)
        pending = 0
        if current_effects:
            pending = current_effects.get("di_muon_ve_som", 0)

        # --- Trường hợp thiếu dữ liệu ---
        if not check_in or not check_out:
            effects["quen_cham_cong"] = 1
            missing = "check_out" if check_in else ("check_in" if check_out else "check_in & check_out")
            print(f"[Ca sáng] Thiếu {missing} → quen_cham_cong += 1")

            # Dù thiếu dữ liệu, vẫn kiểm tra vi phạm nếu còn đủ thông tin
            if check_in and check_in > late_from:
                late_minutes = int(
                    (datetime.combine(datetime.today(), check_in)
                    - datetime.combine(datetime.today(), late_from)).total_seconds() / 60
                )
                penalty = self._calc_penalty(late_minutes, pending_violations=pending)
                if penalty == -1:
                    effects["vang_mat"] = workday
                    print(f"[Ca sáng] Đi muộn {late_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                else:
                    effects["tong_phat"] = penalty
                    # Gắn tag late_penalty (giống nhánh "đủ cả check_in/check_out" bên dưới) để
                    # duyệt đơn giải trình "Đi muộn" riêng có thể truy vết và xóa đúng phần phạt
                    # này — không phụ thuộc vào việc đơn "Quên chấm công" có được duyệt hay không.
                    effects["late_penalty"] = penalty
                    effects["di_muon_ve_som"] = 1
                    effects["violation_count_month"] = 1
                    effects["late_minutes"] = late_minutes
                    print(f"[Ca sáng] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ")
                    print(f"[Ca sáng] Vi phạm → di_muon_ve_som += 1")

            if check_out and check_out < early_before:
                early_minutes = int(
                    (datetime.combine(datetime.today(), early_before)
                    - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
                )
                penalty = self._calc_penalty(early_minutes, pending_violations=pending)
                if penalty == -1:
                    effects["vang_mat"] = workday
                    print(f"[Ca sáng] Về sớm {early_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                else:
                    # Nếu đã có phạt đi muộn ở trên (check_in), cần cộng dồn tiền phạt
                    effects["tong_phat"] = effects.get("tong_phat", 0) + penalty
                    effects["early_leave_penalty"] = penalty
                    effects["di_muon_ve_som"] = effects.get("di_muon_ve_som", 0) + 1
                    effects["violation_count_month"] = effects.get("violation_count_month", 0) + 1
                    effects["early_leave_minutes"] = early_minutes
                    print(f"[Ca sáng] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ")
                    print(f"[Ca sáng] Vi phạm → di_muon_ve_som += 1")

            # Không tính công vì thiếu dữ liệu
            return effects

        # --- Có đủ cả check_in và check_out ---

        # Nếu check_out trước giờ bắt đầu ca → không liên quan ca sáng
        if check_out <= shift_start:
            return effects

        # --- Checkin/checkout quá gần nhau → quên chấm công ---
        # Nếu khoảng cách giữa check_in và check_out ≤ ngưỡng cho phép,
        # coi như nhân viên quên chấm công (checkin hoặc checkout bị thiếu thực tế).
        diff_minutes = _calc_checkin_checkout_diff(check_in_str, check_out_str)
        if 0 <= diff_minutes <= _MIN_CHECKIN_CHECKOUT_DIFF_MINUTES:
            if (current_effects or {}).get("quen_cham_cong", 0) == 0:
                effects["quen_cham_cong"] = 1
                print(
                    f"[Ca sáng] check_in={check_in_str}, check_out={check_out_str} "
                    f"cách nhau {diff_minutes} phút "
                    f"(≤ {_MIN_CHECKIN_CHECKOUT_DIFF_MINUTES} phút) → quên chấm công"
                )
            return effects

        is_violation = False
        violation_effects = {}
        rule_local_pending = pending

        # Đi muộn
        if check_in > late_from:
            late_minutes = int(
                (datetime.combine(datetime.today(), check_in)
                - datetime.combine(datetime.today(), late_from)).total_seconds() / 60
            )
            penalty = self._calc_penalty(late_minutes, pending_violations=rule_local_pending)
            if penalty == -1:
                effects["vang_mat"] = workday
                print(f"[Ca sáng] Đi muộn {late_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                return effects
            violation_effects["tong_phat"] = penalty
            violation_effects["late_penalty"] = penalty
            violation_effects["late_minutes"] = late_minutes
            is_violation = True
            rule_local_pending += 1 # Tăng lỗi treo để nếu có "về sớm" sẽ tính tiếp
            print(f"[Ca sáng] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ")

        # Về sớm
        if check_out < early_before:
            early_minutes = int(
                (datetime.combine(datetime.today(), early_before)
                - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
            )
            penalty = self._calc_penalty(early_minutes, pending_violations=rule_local_pending)
            if penalty == -1:
                effects["vang_mat"] = workday
                print(f"[Ca sáng] Về sớm {early_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                return effects
            violation_effects["tong_phat"] = violation_effects.get("tong_phat", 0) + penalty
            violation_effects["early_leave_penalty"] = penalty
            violation_effects["early_leave_minutes"] = early_minutes
            is_violation = True
            print(f"[Ca sáng] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ")

        if is_violation:
            # Lưu ý ở đây di_muon_ve_som vẫn là số lượng sự kiện vi phạm (đi muộn và/hoặc về sớm)
            # Nếu vi phạm cả 2 trong 1 ca, ta tính là 2 lần lỗi (để cộng dồn nhân x2 chính xác)
            violation_count = 0
            if check_in > late_from: violation_count += 1
            if check_out < early_before: violation_count += 1
            
            violation_effects["di_muon_ve_som"] = violation_count
            violation_effects["violation_count_month"] = violation_count
            print(f"[Ca sáng] Vi phạm ({violation_count} lỗi) → di_muon_ve_som += {violation_count}")

        # Merge violation effects
        for key, value in violation_effects.items():
            if key in effects:
                effects[key] += value
            else:
                effects[key] = value

        # Tính công ca sáng
        effects["nua_ngay_cong"] = workday
        print(f"[Ca sáng] Tính {workday} công")

        return effects

    def _evaluate_afternoon_shift_rule(self, event: Event, rule: dict, current_effects: dict = None) -> dict:
        """
        Evaluate afternoon shift rule effect.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type != "attendance":
            return {}
        
        # Nếu ngày này đã có đơn Ra trực được duyệt, bỏ qua tính toán chấm công (ghi đè 1 công)
        if event.data.get("date") in self._approved_off_duty_dates:
            print(f"[Ca chiều] Ngày {event.data.get('date')} đã duyệt Ra trực -> Bỏ qua tính ca")
            return {}

        # Thứ 7 của tuần thứ 2 và thứ 4 trong tháng: mặc định KHÔNG có ca chiều (chỉ
        # làm nửa ngày buổi sáng) — trừ phòng ban được đánh dấu làm chiều thứ 7 mọi
        # tuần (Department.saturday_afternoon_always_workday, tương tự cơ chế cho
        # phép 1 số phòng ban làm việc Chủ nhật). Chấm công thô (event_type=attendance)
        # buổi chiều những ngày này KHÔNG được tự động khớp vào ca chiều/tính công —
        # nhân viên phải làm đơn tăng ca riêng nếu thực sự có đi làm, tránh trường hợp
        # tăng ca không chính thức bị cộng nhầm thành công thường (0.5 + 0.5 = 1.0).
        from datetime import datetime as _datetime
        _event_date_str = event.data.get("date")
        _event_date = None
        if _event_date_str:
            try:
                _event_date = _datetime.strptime(str(_event_date_str), "%Y-%m-%d").date()
            except ValueError:
                _event_date = None
        if _event_date and not self._saturday_afternoon_workday_on(_event_date):
            if _event_date.weekday() == 5:  # Thứ 7
                saturday_occurrence = (_event_date.day - 1) // 7 + 1
                if saturday_occurrence in (2, 4):
                    print(
                        f"[Ca chiều] {_event_date_str} là thứ 7 tuần {saturday_occurrence}/tháng "
                        f"(nửa ngày) → bỏ qua ca chiều, không tự cộng công (cần làm đơn tăng ca)"
                    )
                    return {}

        # Nếu các ca trước trong cùng ngày đã tích lũy đủ 1 công, bỏ qua ca này.
        # Tránh tình trạng 3 ca (sáng+chiều+tối) cộng thành 1.5 công, hoặc nhân viên bị
        # tính "về sớm" / "vắng mặt" ở ca tối khi họ không làm ca đó.
        if current_effects and current_effects.get("nua_ngay_cong", 0) >= 1.0:
            print(
                f"[Ca chiều ({rule.get('rule_name', '?')})] Ngày {event.data.get('date')} đã đủ 1 công "
                f"(nua_ngay_cong={current_effects['nua_ngay_cong']:.1f}) → bỏ qua ca (đã đạt giới hạn 1 công/ngày)"
            )
            return {}

        from datetime import datetime

        start_time_str = rule.get('conditions', {}).get('start_time')
        end_time_str = rule.get('conditions', {}).get('end_time')
        workday = rule.get('conditions', {}).get('workday', 0.5)

        if not start_time_str or not end_time_str:
            logger.warning(
                "[Ca chiều] Rule '%s' thiếu start_time/end_time trong conditions → bỏ qua",
                rule.get('rule_name', '?'),
            )
            return {}

        def parse_time(t: str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.strptime(t, fmt).time()
                except ValueError:
                    continue
            raise ValueError(f"Cannot parse time: {t}")

        shift_start = parse_time(start_time_str)
        shift_end = parse_time(end_time_str)

        check_in_str = event.data.get("check_in")
        check_out_str = event.data.get("check_out")
        check_in = parse_time(check_in_str) if check_in_str else None
        check_out = parse_time(check_out_str) if check_out_str else None

        effects = {}
        # Chế độ con nhỏ: mốc tính đi muộn / về sớm nới thêm N phút (hrm/child_care_regime.py)
        late_from, early_before = self._child_care_bounds(event, shift_start, shift_end)

        # Lấy số lỗi đã có từ các rule trước đó trong cùng 1 ngày (ví dụ ca sáng vừa xử lý xong)
        pending = 0
        if current_effects:
            pending = current_effects.get("di_muon_ve_som", 0)

        # --- Trường hợp thiếu dữ liệu ---
        if not check_in or not check_out:
            effects["quen_cham_cong"] = 1
            missing = "check_out" if check_in else ("check_in" if check_out else "check_in & check_out")
            print(f"[Ca chiều] Thiếu {missing} → quen_cham_cong += 1")

            # Dù thiếu dữ liệu, vẫn kiểm tra vi phạm nếu còn đủ thông tin
            if check_in:
                effective_check_in = max(check_in, shift_start)
                if effective_check_in > late_from:
                    late_minutes = int(
                        (datetime.combine(datetime.today(), effective_check_in)
                         - datetime.combine(datetime.today(), late_from)).total_seconds() / 60
                    )
                    penalty = self._calc_penalty(late_minutes, pending_violations=pending)
                    if penalty == -1:
                        effects["vang_mat"] = workday
                        print(f"[Ca chiều] Đi muộn {late_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                    else:
                        effects["tong_phat"] = penalty
                        # Gắn tag late_penalty để đơn giải trình "Đi muộn" riêng truy vết/xóa
                        # được đúng phần phạt này, độc lập với đơn "Quên chấm công".
                        effects["late_penalty"] = penalty
                        effects["di_muon_ve_som"] = 1
                        effects["violation_count_month"] = 1
                        effects["late_minutes"] = late_minutes
                        print(f"[Ca chiều] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ")
                        print(f"[Ca chiều] Vi phạm → di_muon_ve_som += 1")

            if check_out and check_out < early_before:
                early_minutes = int(
                    (datetime.combine(datetime.today(), early_before)
                     - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
                )
                penalty = self._calc_penalty(early_minutes, pending_violations=pending)
                if penalty == -1:
                    effects["vang_mat"] = workday
                    print(f"[Ca chiều] Về sớm {early_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                else:
                    # Nếu đã có phạt đi muộn ở trên (check_in), cần cộng dồn tiền phạt
                    effects["tong_phat"] = effects.get("tong_phat", 0) + penalty
                    effects["early_leave_penalty"] = penalty
                    effects["di_muon_ve_som"] = effects.get("di_muon_ve_som", 0) + 1
                    effects["violation_count_month"] = effects.get("violation_count_month", 0) + 1
                    effects["early_leave_minutes"] = early_minutes
                    print(f"[Ca chiều] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ")
                    print(f"[Ca chiều] Vi phạm → di_muon_ve_som += 1")

            # Không tính công vì thiếu dữ liệu
            return effects

        # --- Có đủ cả check_in và check_out ---

        # Nếu check_out trước hoặc bằng giờ bắt đầu ca chiều → không liên quan
        if check_out <= shift_start:
            return effects

        # --- Checkin/checkout quá gần nhau → quên chấm công ---
        # Nếu khoảng cách giữa check_in và check_out ≤ ngưỡng cho phép,
        # coi như nhân viên quên chấm công (checkin hoặc checkout bị thiếu thực tế).
        diff_minutes = _calc_checkin_checkout_diff(check_in_str, check_out_str)
        if 0 <= diff_minutes <= _MIN_CHECKIN_CHECKOUT_DIFF_MINUTES:
            if (current_effects or {}).get("quen_cham_cong", 0) == 0:
                effects["quen_cham_cong"] = 1
                print(
                    f"[Ca chiều] check_in={check_in_str}, check_out={check_out_str} "
                    f"cách nhau {diff_minutes} phút "
                    f"(≤ {_MIN_CHECKIN_CHECKOUT_DIFF_MINUTES} phút) → quên chấm công"
                )
            return effects

        effective_check_in = max(check_in, shift_start)
        is_violation = False
        violation_effects = {}
        rule_local_pending = pending

        # Đi muộn (tính từ đầu ca chiều)
        if effective_check_in > late_from:
            late_minutes = int(
                (datetime.combine(datetime.today(), effective_check_in)
                 - datetime.combine(datetime.today(), late_from)).total_seconds() / 60
            )
            penalty = self._calc_penalty(late_minutes, pending_violations=rule_local_pending)
            if penalty == -1:
                effects["vang_mat"] = workday
                print(f"[Ca chiều] Đi muộn {late_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                return effects
            violation_effects["tong_phat"] = penalty
            violation_effects["late_penalty"] = penalty
            violation_effects["late_minutes"] = late_minutes
            is_violation = True
            rule_local_pending += 1 # Tăng lỗi treo để nếu có "về sớm" sẽ tính tiếp
            print(f"[Ca chiều] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ")

        # Về sớm
        if check_out < early_before:
            early_minutes = int(
                (datetime.combine(datetime.today(), early_before)
                 - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
            )
            penalty = self._calc_penalty(early_minutes, pending_violations=rule_local_pending)
            if penalty == -1:
                effects["vang_mat"] = workday
                print(f"[Ca chiều] Về sớm {early_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                return effects
            violation_effects["tong_phat"] = violation_effects.get("tong_phat", 0) + penalty
            violation_effects["early_leave_penalty"] = penalty
            violation_effects["early_leave_minutes"] = early_minutes
            is_violation = True
            print(f"[Ca chiều] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ")

        if is_violation:
            # Lưu ý ở đây di_muon_ve_som vẫn là số lượng sự kiện vi phạm (đi muộn và/hoặc về sớm)
            violation_count = 0
            if effective_check_in > late_from: violation_count += 1
            if check_out < early_before: violation_count += 1

            violation_effects["di_muon_ve_som"] = violation_count
            violation_effects["violation_count_month"] = violation_count
            print(f"[Ca chiều] Vi phạm ({violation_count} lỗi) → di_muon_ve_som += {violation_count}")

        # Merge violation effects
        for key, value in violation_effects.items():
            if key in effects:
                effects[key] += value
            else:
                effects[key] = value

        # Tính công ca chiều
        effects["nua_ngay_cong"] = workday
        print(f"[Ca chiều] Tính {workday} công")

        return effects

    def _child_care_bounds(self, event: Event, shift_start, shift_end):
        """(mốc tính đi muộn, mốc tính về sớm) của ca trong ngày của event.

        Ngày NV hưởng chế độ con nhỏ (N phút): đi muộn chỉ tính khi vào sau
        shift_start + N, về sớm chỉ tính khi ra trước shift_end - N; số phút muộn /
        sớm tính từ mốc mới nên phần vượt N phút tính như bình thường. Hai mốc không
        vượt ra ngoài ca. Ngày khác, hoặc ca qua đêm → giữ nguyên (shift_start, shift_end).
        """
        minutes = self._child_care_minutes.get(event.data.get("date"), 0)
        if not minutes:
            return shift_start, shift_end
        from datetime import datetime, timedelta
        base = datetime(2000, 1, 1)
        start_dt = datetime.combine(base, shift_start)
        end_dt = datetime.combine(base, shift_end)
        if end_dt <= start_dt:
            return shift_start, shift_end
        late_from = min(start_dt + timedelta(minutes=minutes), end_dt)
        early_before = max(end_dt - timedelta(minutes=minutes), start_dt)
        print(f"[Chế độ con nhỏ] {event.data.get('date')}: được đi muộn / về sớm tối đa {minutes} phút")
        return late_from.time(), early_before.time()

    # Leave types treated as paid leave (có lương)
    _PAID_LEAVE_TYPES = frozenset({"PAID", "ANNUAL", "SICK", "MATERNITY", "PATERNITY", "MARRIAGE", "FUNERAL", "OTHER"})

    def _evaluate_leave_rule(self, event: Event, rule: dict) -> dict:
        """
        Evaluate leave rule effect.
        Returns dictionary of state changes (deltas).

        Paid-leave types: PAID, ANNUAL, SICK, MATERNITY, PATERNITY, MARRIAGE, FUNERAL, OTHER
        Unpaid-leave type: UNPAID
        """
        if event.event_type != "leave_request":
            return {}

        rule_type = rule.get("rule_type", "")
        conditions = rule.get("conditions", {})

        # Lấy thông tin từ event
        leave_type = event.data.get("leave_type", "")
        reason = event.data.get("reason", "")
        date = event.data.get("date", "")
        is_half_day = event.data.get("is_half_day", False)

        print(f"[Leave Rule] Xử lý đơn nghỉ phép: {leave_type} - {reason} - {date}")

        effects = {}

        is_paid = leave_type in self._PAID_LEAVE_TYPES

        # Kiểm tra xem rule có match với loại leave không
        if rule_type == "LEAVE_RULE_PAID" and is_paid:
            workday = 0.5 if is_half_day else conditions.get("workday", 1.0)
            effects["nghi_phep"] = 0.5 if is_half_day else 1
            effects["nua_ngay_cong"] = workday
            print(f"[Leave Rule] Nghỉ phép có lương ({leave_type}) → nghi_phep += {effects['nghi_phep']}, nua_ngay_cong += {workday}")

        elif rule_type == "LEAVE_RULE_UNPAID" and leave_type == "UNPAID":
            effects["nghi_khong_luong"] = 1
            print(f"[Leave Rule] Nghỉ không lương → nghi_khong_luong += 1")

            # Trừ công cho nghỉ không lương
            workday = conditions.get("workday", 1.0)
            return effects

    def _evaluate_online_work_rule(self, event: Event, rule: dict) -> dict:
        """
        Evaluate online work rule effect.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type != "online_work":
            return {}

        status = event.data.get("status", "PENDING")
        if status != "APPROVED":
            return {}

        is_half_day = event.data.get("is_half_day", False) or event.data.get("expected_status") == "HALF_DAY"
        workday = 0.5 if is_half_day else 1.0
        
        effects = {
            "nua_ngay_cong": workday,
            "lam_viec_online": workday,
        }
        print(f"[Online Work Rule] Làm việc online ({'nửa ngày' if is_half_day else 'cả ngày'}) → nua_ngay_cong += {workday}, lam_viec_online += {workday}")
        return effects

    def _evaluate_overtime_rule(self, event: Event, rule: dict) -> dict:
        """
        Evaluate overtime rule effect.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type not in ["overtime", "extra_hours", "night_shift", "off_duty"]:
            return {}

        # Chỉ tính các đơn đã được phê duyệt (APPROVED)
        status = event.data.get("status", "")
        if status != "APPROVED":
            return {}

        # Lấy số giờ thực tế
        overtime_hours = float(event.data.get("overtime_hours", 0) or 0)
        registration_type = event.data.get("registration_type", "").upper()
        
        effects = {}
        
        # --- Xử lý riêng cho RA TRỰC (OFF_DUTY) ---
        if registration_type == "OFF_DUTY" or event.event_type == "off_duty":
            # Ra trực mặc định được tính 1 công và ghi đè các lỗi khác (đã skip ở shift rules)
            effects["nua_ngay_cong"] = 1.0
            
            # Xóa triệt để các lỗi phạt nếu có (đảm bảo an toàn nếu shift rules chưa skip)
            event_date = event.data.get("date")
            if event_date:
                penalty_on_day = self._get_penalty_for_date(event_date)
                if penalty_on_day > 0:
                    effects["tong_phat"] = -penalty_on_day
                    effects["late_penalty"] = -self._get_penalty_for_date(event_date, "LATE")
                    effects["early_leave_penalty"] = -self._get_penalty_for_date(event_date, "EARLY_LEAVE")
                    print(f"[Overtime Rule] Đơn Ra trực ({event_date}) -> Xóa {penalty_on_day:,} VNĐ tiền phạt")

                # Xóa các số lần vi phạm tích lũy trong ngày
                day_violations = 0
                day_forgot = 0
                day_absent = 0
                for entry in self.calendar_result:
                    if entry.get("date") == event_date:
                        delta = entry.get("delta", {})
                        day_violations += delta.get("di_muon_ve_som", 0)
                        day_forgot += delta.get("quen_cham_cong", 0)
                        day_absent += delta.get("vang_mat", 0)
                
                if day_violations > 0:
                    effects["di_muon_ve_som"] = -day_violations
                    # violation_count_month là tổng dồn nên ta trừ đúng số lỗi của ngày
                    effects["violation_count_month"] = effects.get("violation_count_month", 0) - day_violations
                    print(f"[Overtime Rule] Đơn Ra trực ({event_date}) -> Xóa {day_violations} lần vi phạm sớm/muộn")
                if day_forgot > 0:
                    effects["quen_cham_cong"] = -day_forgot
                    effects.setdefault("violation_count_month", 0)
                    effects["violation_count_month"] -= day_forgot
                    print(f"[Overtime Rule] Đơn Ra trực ({event_date}) -> Xóa {day_forgot} lần quên chấm công")
                if day_absent > 0:
                    effects["vang_mat"] = -day_absent
                    print(f"[Overtime Rule] Đơn Ra trực ({event_date}) -> Xóa {day_absent} công vắng mặt")

            print(f"[Overtime Rule] Đơn Ra trực (OFF_DUTY) được duyệt -> nua_ngay_cong += 1.0")
            return effects

        # --- Xử lý riêng cho TRỰC TỐI (NIGHT_SHIFT) ---
        if registration_type == "NIGHT_SHIFT":
            event_date = event.data.get("date", "")
            sessions = max(1.0, float(event.data.get("sessions") or 1))

            # Luôn đếm số buổi trực tối khi đơn được duyệt
            effects["truc_toi"] = sessions
            if event_date:
                self._night_shift_request_dates.add(event_date)
                if event_date in self._auto_night_duty_counted:
                    # Ngày này đã được cộng 1 buổi tự động theo ca -> đơn thay thế
                    # (tổng = số buổi trên đơn, không cộng trùng).
                    effects["truc_toi"] = sessions - 1

            # Telesale positions: NV_TELESALE, TP_TELESALE
            _TELESALE_POSITION_CODES = {"NV_TELESALE", "TP_TELESALE","LEADER_TELESALE"}
            is_telesale = self.position_code in _TELESALE_POSITION_CODES

            if event_date and self._has_afternoon_shift_attendance(event_date):
                # Có dữ liệu chấm công ca chiều → cộng 0.5 công thêm cho ca tối
                # Nhưng nếu ngày đó đã đủ 1 công (sáng + chiều) thì không cộng thêm để tránh 1.5 công
                existing_credit = self._get_work_credit_for_date(event_date)
                if existing_credit >= 1.0:
                    print(f"[Overtime Rule] Đơn Trực tối + có chấm công ca chiều ({event_date}) nhưng đã đủ {existing_credit} công -> bỏ qua cộng thêm công, tính truc_toi += {sessions}")
                else:
                    effects["nua_ngay_cong"] = 0.5
                    print(f"[Overtime Rule] Đơn Trực tối + có chấm công ca chiều ({event_date}) -> nua_ngay_cong += 0.5, truc_toi += {sessions}")
            
            elif is_telesale:
                # Telesale: không có chấm công ca chiều → vẫn cộng 0.5 công nếu chưa đủ 1 công
                existing_credit = self._get_work_credit_for_date(event_date) if event_date else 0.0
                if existing_credit < 1.0:
                    effects["nua_ngay_cong"] = 0.5
                    print(f"[Overtime Rule] Telesale - Trực tối không có ca chiều ({event_date}) -> nua_ngay_cong += 0.5, truc_toi += {sessions}")
                else:
                    print(f"[Overtime Rule] Telesale - Trực tối ({event_date}) đã đủ {existing_credit} công -> chỉ tính truc_toi += {sessions}")

            else:
                # Không có chấm công ca chiều → đếm ca trực tối, không cộng công
                print(f"[Overtime Rule] Đơn Trực tối được duyệt -> truc_toi += {sessions} (không cộng công)")
            return effects

        # --- LOGIC TỐI ƯU: Sử dụng Mapping để xác định cột dữ liệu ---
        # Map: registration_type -> (tên field trong effects, giá trị cộng thêm)
        TYPE_TO_EFFECT_MAP = {
            "EXTRA_HOURS": ("lam_them_gio", overtime_hours),
            "OVERTIME": ("tang_ca", overtime_hours),
        }

        # Lấy cấu hình dựa trên registration_type, mặc định là Tăng ca (OVERTIME)
        target_field, value = TYPE_TO_EFFECT_MAP.get(registration_type, ("tang_ca", overtime_hours))
        
        effects[target_field] = value
        print(f"[Overtime Rule] Đơn {registration_type or 'OVERTIME'}: {value} (Target: {target_field})")

        # Flag ban đêm từ đơn (nếu có)
        if event.data.get("is_night_shift") and registration_type != "NIGHT_SHIFT":
            effects["truc_toi"] = 1
            print(f"[Overtime Rule] Đơn kèm làm ban đêm -> truc_toi += 1")

        return effects

    def _evaluate_livestream_rule(self, event: Event, rule: dict) -> dict:
        """
        Evaluate livestream rule effect.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type != "live":
            return {}

        # Chỉ tính các buổi live đã được duyệt
        status = event.data.get("status", "")
        if status != "APPROVED":
            print(f"[Livestream Rule] Bỏ qua: status={status!r}, cần APPROVED")
            return {}

        conditions = rule.get("conditions", {})

        # Lấy thông tin từ event
        session_duration = event.data.get("session_duration", 0)  # giờ
        date = event.data.get("date", "")
        session_time = event.data.get("session_time", "")

        print(f"[Livestream Rule] Xử lý livestream: {session_duration} giờ - {session_time} - {date}")

        # Lấy cấu hình từ rule
        min_duration_for_count = conditions.get("min_duration_for_count", 1.0)  # giờ
        allowance_per_session = conditions.get("allowance_per_session", 100000)  # VNĐ
        max_sessions_per_month = conditions.get("max_sessions_per_month", 8)
        prime_time_allowance = conditions.get("prime_time_allowance", 0)  # VNĐ thêm cho 21h-23h

        effects = {}

        # Kiểm tra thời lượng tối thiểu
        if session_duration >= min_duration_for_count:
            effects["live"] = 1
            print(f"[Livestream Rule] Đủ thời lượng {session_duration} giờ → live += 1")

            # Phụ cấp cơ bản
            total_allowance = allowance_per_session
            # Cộng thêm phụ cấp prime-time 21h-23h (+100.000 VNĐ)
            if prime_time_allowance and event.data.get("is_prime_time"):
                total_allowance += prime_time_allowance
                print(
                    f"[Livestream Rule] Phiên prime-time 21h-23h → "
                    f"tong_phu_cap_livestream += {prime_time_allowance:,}"
                )

            effects["tong_phu_cap_livestream"] = total_allowance
            print(
                f"[Livestream Rule] Phụ cấp livestream {total_allowance:,} VNĐ → "
                f"tong_phu_cap_livestream += {total_allowance:,}"
            )

            # Kiểm tra giới hạn số buổi mỗi tháng (note: this check requires state, so it's handled in apply_rules)
        else:
            print(f"[Livestream Rule] Không đủ thời lượng: {session_duration} giờ < {min_duration_for_count} giờ")

        return effects

    def _evaluate_explanation_rule(self, event: Event, rule: dict) -> dict:
        """
        Evaluate explanation rule effect.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type != "explanation":
            return {}

        conditions = rule.get("conditions", {})

        # Lấy thông tin từ event
        explanation_type = event.data.get("explanation_type", "")
        status = event.data.get("status", "")  # PENDING, APPROVED, REJECTED
        original_penalty = event.data.get("original_penalty", 0)
        date = event.data.get("date", "")
        reason = event.data.get("reason", "")

        print(f"[Explanation Rule] Xử lý giải trình: {explanation_type} - {status} - {date}")

        # Lấy cấu hình từ rule
        max_explanations_per_month = conditions.get("max_explanations_per_month", 3)
        penalty_reduction_rate = conditions.get("penalty_reduction_rate", 0.5)  # 50% giảm phạt
        allowed_types = conditions.get("allowed_types", ["FORGOT", "INCOMPLETE_ATTENDANCE", "LATE", "EARLY_LEAVE", "BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME"])

        effects = {}

        # Kiểm tra loại giải trình có được phép không
        if explanation_type not in allowed_types:
            print(f"[Explanation Rule] Loại giải trình {explanation_type} không được phép")
            return effects

        # Kiểm tra giới hạn số lần giải trình mỗi tháng (note: this check requires state, so it's handled in apply_rules)

        # Xử lý theo trạng thái
        if status == "APPROVED":
            effects["giai_trinh_cham_cong"] = 1
            # Note: explanation_quota_used increment has been moved 
            # only to EXPLANATION_APPROVAL_RULE to avoid double counting.
            
            print(f"[Explanation Rule] Giải trình được chấp nhận → giai_trinh_cham_cong += 1")
            
            # Ghi chú: Logic trừ tiền phạt thực tế đã được chuyển sang EXPLANATION_APPROVAL_RULE
            # để đảm bảo truy vết đúng số tiền phạt gốc tại thời điểm vi phạm.
        
        elif status == "REJECTED":
            print(f"[Explanation Rule] Giải trình bị từ chối")
        
        else:  # PENDING
            print(f"[Explanation Rule] Giải trình đang chờ xử lý")

        return effects

    def _count_day_violations(self, event_date: str):
        """(số lỗi muộn/sớm, số lỗi quên CC) còn lại (net) của 1 ngày trong calendar_result."""
        v = f = 0
        for entry in self.calendar_result:
            if entry.get("date") == event_date:
                delta = entry.get("delta", {})
                v += delta.get("di_muon_ve_som", 0)
                f += delta.get("quen_cham_cong", 0)
        return v, f

    def _evaluate_explanation_approval_rule(self, event: Event, rule: dict) -> dict:
        """
        Evaluate explanation_approval rule effect.
        Khi HR duyệt một giải trình → tính công cho ngày đó và tăng nghi_phep.
        Returns dictionary of state changes (deltas).
        """
        if event.event_type != "explanation_approval":
            return {}

        action = event.data.get("action", "")
        approval_level = event.data.get("approval_level", "")

        _FINAL_APPROVAL_LEVELS = ("HR", "ADMIN")

        if action != "APPROVE" or approval_level not in _FINAL_APPROVAL_LEVELS:
            logger.debug(
                "[Explanation Approval Rule] Bỏ qua: action=%s, approval_level=%s",
                action, approval_level,
            )
            return {}

        approved_for_event_id = event.data.get("approved_for_event_id")
        approved_by_name = event.data.get("approved_by_name", "")
        explanation_type = event.data.get("explanation_type", "")

        # Đơn có thể được duyệt rồi sau đó bị từ chối lại (HR duyệt nhầm rồi
        # reject, hoặc reject rồi tạo đơn mới thay thế). Chỉ áp dụng hiệu ứng
        # (miễn phạt, cộng công, trừ quota) nếu trạng thái HIỆN TẠI của đơn gốc
        # vẫn là APPROVED — nếu không, event APPROVE này đã bị ghi đè bởi 1
        # REJECT sau đó và không còn giá trị, bỏ qua để tránh cộng công/trừ
        # quota "ma" cho 1 đơn cuối cùng đã bị từ chối.
        if approved_for_event_id:
            from hrm.event_models import EmployeeEvent as _EmployeeEvent
            original = _EmployeeEvent.objects.filter(id=approved_for_event_id).values("data").first()
            original_status = (original or {}).get("data", {}).get("status")
            if original_status != "APPROVED":
                logger.debug(
                    "[Explanation Approval Rule] Bỏ qua: đơn gốc id=%s hiện tại status=%s (không còn APPROVED)",
                    approved_for_event_id, original_status,
                )
                return {}

        # BUSINESS_TRIP / FIRST_DAY / FORGOT / INCOMPLETE_ATTENDANCE / LATE / EARLY_LEAVE
        # Duyệt giải trình: miễn phạt và có thể cộng thêm công.
        VALID_EXPLANATION_TYPES = (
            "LATE", "EARLY_LEAVE", "FORGOT", "INCOMPLETE_ATTENDANCE", 
            "BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME"
        )
        
        if explanation_type in VALID_EXPLANATION_TYPES:
            event_date = event.data.get("date")
            is_exempt_type = explanation_type in ("BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME")

            # Event tách riêng, xử lý NGAY tại ngày vi phạm: chỉ trừ lỗi khỏi bộ
            # đếm x2, không hoàn phạt/quota/công (phần đó vẫn chạy ở event duyệt
            # gốc theo thứ tự ngày HR duyệt).
            if event.data.get("counter_release_only"):
                release_effects = {}
                if event_date:
                    v, f = self._count_day_violations(event_date)
                    released = self._counter_released_by_date.setdefault(event_date, [0, 0])
                    if v > 0:
                        release_effects["di_muon_ve_som"] = -v
                        release_effects["violation_count_month"] = -v
                        released[0] += v
                    if f > 0:
                        release_effects["quen_cham_cong"] = -f
                        release_effects["violation_count_month"] = release_effects.get("violation_count_month", 0) - f
                        released[1] += f
                    logger.info(
                        "[Explanation Approval Rule] %s (%s) -> trừ sớm tại ngày vi phạm: %d muộn/sớm, %d quên CC",
                        explanation_type, event_date, v, f,
                    )
                return release_effects

            # Đơn Đi muộn/Về sớm TRÙNG (cùng ngày, cùng loại) đã được duyệt trước
            # đó -> bỏ qua hẳn: không hoàn phạt lần 2, không trừ thêm lượt giải
            # trình (NV80002 30/09/2026: 2 đơn Đi muộn trùng được duyệt -> phạt
            # 50.000đ bị hoàn 2 lần, tổng phạt -50.000đ). KHÔNG áp cho quên chấm
            # công: quên CC sáng + chiều là 2 đơn hợp lệ cùng loại cùng ngày.
            if explanation_type in ("LATE", "EARLY_LEAVE") and event_date:
                dedupe_key = (event_date, explanation_type)
                if dedupe_key in self._applied_explanation_keys:
                    logger.warning(
                        "[Explanation Approval Rule] Bỏ qua đơn %s trùng ngày %s (đơn gốc id=%s) — đã áp dụng 1 đơn cùng loại",
                        explanation_type, event_date, approved_for_event_id,
                    )
                    return {}
                self._applied_explanation_keys.add(dedupe_key)

            # 1. Truy vết và xóa phạt của ngày đó (nếu có)
            # Đối với các loại "miễn hoàn toàn" hoặc thay đổi cả ngày (đi công tác, ngày đầu
            # làm việc, làm việc online): xóa TOÀN BỘ phạt của ngày đó.
            if explanation_type in ("FIRST_DAY", "WORK_FROM_HOME", "BUSINESS_TRIP"):
                penalty_to_remove = self._get_penalty_for_date(event_date) if event_date else 0
                late_penalty = self._get_penalty_for_date(event_date, "LATE") if event_date else 0
                early_penalty = self._get_penalty_for_date(event_date, "EARLY_LEAVE") if event_date else 0
            elif explanation_type in ("FORGOT", "INCOMPLETE_ATTENDANCE"):
                # "Quên chấm công" chỉ miễn phần thiếu công do quên chấm công (xử lý riêng ở
                # quota/target_credit bên dưới) — KHÔNG được đụng vào phạt đi muộn/về sớm, vì đi
                # muộn/về sớm là lỗi độc lập, không liên quan đến việc quên chấm công. Muốn miễn
                # phạt đi muộn/về sớm thì phải có đơn giải trình LATE/EARLY_LEAVE riêng được duyệt.
                penalty_to_remove = 0
                late_penalty = 0
                early_penalty = 0
            else:
                # LATE / EARLY_LEAVE chỉ xóa phạt tương ứng
                penalty_to_remove = self._get_penalty_for_date(event_date, explanation_type) if event_date else 0

                # Giải trình LATE/EARLY_LEAVE chỉ miễn phạt cho 30 phút đầu
                # tiên - phần vượt quá vẫn phải chịu phạt tương ứng với số
                # phút còn lại sau khi trừ đi phần được "cứu". Áp dụng như
                # nhau cho cả 2 loại (bảng phạt đi muộn/về sớm dùng chung 1
                # barem) — TRƯỚC ĐÂY chỉ viết cho LATE, EARLY_LEAVE bị bỏ sót
                # nên giải trình về sớm được duyệt vẫn miễn phạt toàn bộ dù
                # đã qua mốc hiệu lực 2026-09-10 (bug, yêu cầu HCNS 2026-09-18).
                if (
                    explanation_type in ("LATE", "EARLY_LEAVE")
                    and event_date
                    and event_date >= LATE_EXPLANATION_GRACE_EFFECTIVE_DATE
                    and penalty_to_remove > 0
                ):
                    actual_late_minutes = self._get_late_minutes_for_date(event_date, explanation_type)
                    remaining_minutes = max(0, actual_late_minutes - LATE_EXPLANATION_GRACE_MINUTES)
                    remaining_penalty = self._calc_penalty(remaining_minutes) if remaining_minutes > 0 else 0
                    if remaining_penalty == -1:
                        # Sentinel "trừ công thay vì phạt tiền" (>120 phút) - trường hợp
                        # hiếm (muộn/sớm gốc phải > 150 phút); không xử lý trừ công ở đây,
                        # chỉ giữ lại phạt tiền gốc cho phần vượt để tránh miễn phạt sai.
                        remaining_penalty = penalty_to_remove
                    penalty_to_remove = max(0, penalty_to_remove - remaining_penalty)
                    logger.info(
                        "[Explanation Approval Rule] %s %s: %d phút, cứu %d phút đầu, "
                        "còn lại %d phút vẫn bị phạt %s VNĐ -> chỉ hoàn %s VNĐ",
                        explanation_type, event_date, actual_late_minutes, LATE_EXPLANATION_GRACE_MINUTES,
                        remaining_minutes, remaining_penalty, penalty_to_remove,
                    )

                late_penalty = penalty_to_remove if explanation_type == "LATE" else 0
                early_penalty = penalty_to_remove if explanation_type == "EARLY_LEAVE" else 0

            # Không hoàn quá số tiền phạt còn lại của ngày (đã trừ các khoản hoàn trước).
            if event_date and penalty_to_remove > 0:
                penalty_to_remove = min(penalty_to_remove, self._get_remaining_penalty_for_date(event_date))
                late_penalty = min(late_penalty, self._get_remaining_penalty_for_date(event_date, "LATE"))
                early_penalty = min(early_penalty, self._get_remaining_penalty_for_date(event_date, "EARLY_LEAVE"))
                if explanation_type in ("LATE", "EARLY_LEAVE"):
                    penalty_to_remove = min(penalty_to_remove, late_penalty + early_penalty)

            effects = {}
            if penalty_to_remove > 0:
                effects.update({
                    "tong_phat": -penalty_to_remove,
                    "late_penalty": -late_penalty,
                    "early_leave_penalty": -early_penalty,
                })

            # Xóa các lỗi vi phạm tích luỹ: duyệt đơn giải trình đồng nghĩa với việc rút lại lỗi
            # (day_violations được khởi tạo ở ngoài, dùng lại bên dưới ở bước tính công để biết
            # ngày này có buổi nào "đi muộn/về sớm nhưng vẫn có công" hay không — xem giải thích
            # chi tiết ở bước 3.)
            day_violations = 0
            if event_date:
                day_violations, day_forgot = self._count_day_violations(event_date)

                # Bộ đếm (di_muon_ve_som + quen_cham_cong) là input của _calc_penalty()
                # để nhân đôi tiền phạt từ lỗi thứ 7. Quy tắc (xác nhận 01/10/2026):
                # đơn giải trình ĐI MUỘN/VỀ SỚM được duyệt chỉ hoàn tiền phạt, KHÔNG
                # trừ lỗi khỏi bộ đếm; mọi loại giải trình khác được duyệt thì trừ.
                if event.data.get("counter_released_early"):
                    # Lỗi đã được trừ ngay tại ngày vi phạm; cộng lại để bước 3 vẫn
                    # thấy đúng số lỗi gốc của ngày như trước.
                    released = self._counter_released_by_date.get(event_date, [0, 0])
                    day_violations += released[0]
                    day_forgot += released[1]
                elif explanation_type not in ("LATE", "EARLY_LEAVE"):
                    if day_violations > 0:
                        effects["di_muon_ve_som"] = -day_violations
                        effects["violation_count_month"] = -day_violations
                        logger.info("[Explanation Approval Rule] %s (%s) -> Xóa %d lần vi phạm sớm/muộn", explanation_type, event_date, day_violations)
                    if day_forgot > 0:
                        effects["quen_cham_cong"] = -day_forgot
                        effects.setdefault("violation_count_month", 0)
                        effects["violation_count_month"] -= day_forgot
                        logger.info("[Explanation Approval Rule] %s (%s) -> Xóa %d lần quên chấm công", explanation_type, event_date, day_forgot)
            
            # 2. Hạn mức giải trình (Exemption không tính quota)
            if not is_exempt_type:
                effects["explanation_quota_used"] = 1
                logger.info(
                    "[Explanation Approval Rule] %s sử dụng 1 lượt giải trình (đã dùng %d lượt)",
                    explanation_type, self.explanation_quota_used,
                )

            # 3. Tính toán cộng công (Work Credit)
            # Chỉ áp dụng cho các loại được coi là "làm bù" hoặc "đi vắng có phép"
            if explanation_type in ("FORGOT", "INCOMPLETE_ATTENDANCE", "BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME", "LEAVE"):
                # Get policy for quota
                quota_max = 3
                over_quota_deduction = 0.5
                if _PolicyLoader is not None:
                    try:
                        # Load policy for the month being processed
                        from datetime import date as _d
                        policy_date = _d.fromisoformat(event_date) if event_date else _dt.date.today()
                        cfg = _PolicyLoader.load(policy_date)
                        policy = cfg.get("policy", {})
                        quota_max = int(policy.get("max_explanation_quota", 3))
                        over_quota_deduction = float(policy.get("incomplete_over_quota_deduction", 0.5))
                    except Exception: pass

                is_over_quota = not is_exempt_type and self.explanation_quota_used >= quota_max
                logger.info(
                    "[Explanation Approval Rule] Quota: đơn thứ %d/%d | is_over_quota=%s | type=%s",
                    self.explanation_quota_used + 1, quota_max, is_over_quota, explanation_type,
                )

                # Mặc định công mục tiêu là 1.0 (cả ngày)
                target_credit = 1.0
                is_half_day_expected = (event.data.get("expected_status") == "HALF_DAY")
                is_additive_half_day_type = explanation_type in (
                    "LEAVE", "BUSINESS_TRIP", "FIRST_DAY", "WORK_FROM_HOME", "INCOMPLETE_ATTENDANCE"
                )
                
                # Nếu là đơn nghỉ phép tháng (LEAVE) nửa ngày (HALF_DAY) -> mục tiêu 0.5
                if explanation_type == "LEAVE" and is_half_day_expected:
                    target_credit = 0.5
                    logger.info("[Explanation Approval Rule] Đơn nghỉ phép tháng nửa ngày -> mục tiêu 0.5 công")

                # Nếu là đơn công tác (BUSINESS_TRIP) nửa ngày (HALF_DAY) -> mục tiêu 0.5
                elif explanation_type == "BUSINESS_TRIP" and is_half_day_expected:
                    target_credit = 0.5
                    logger.info("[Explanation Approval Rule] Đơn công tác nửa ngày -> mục tiêu 0.5 công")

                # Nếu là đơn ngày đầu đi làm (FIRST_DAY) nửa ngày (HALF_DAY) -> mục tiêu 0.5
                elif explanation_type == "FIRST_DAY" and is_half_day_expected:
                    target_credit = 0.5
                    logger.info("[Explanation Approval Rule] Đơn ngày đầu đi làm nửa ngày -> mục tiêu 0.5 công")

                # INCOMPLETE_ATTENDANCE: tính công dựa trên timeline thực tế
                # INCOMPLETE_ATTENDANCE: tính công dựa trên timeline
                # FE gửi actual_check_in/out (từ máy chấm công) + forgot_checkin/out_time (NV khai)
                # Ghép lại → tính giờ làm → trả 0.5 hay 1.0
                elif explanation_type == "INCOMPLETE_ATTENDANCE":
                    shift_type = event.data.get("shift_type", "")
                    forgot_punch_type = event.data.get("forgot_punch_type", "")
                    forgot_checkin_time_str = event.data.get("forgot_checkin_time", "")
                    forgot_checkout_time_str = event.data.get("forgot_checkout_time", "")
                    actual_check_in_str = event.data.get("actual_check_in", "")
                    actual_check_out_str = event.data.get("actual_check_out", "")

                    # Fallback: actual_check_in/out là SNAPSHOT chụp lúc TẠO đơn — nếu
                    # nhân viên nộp đơn trước khi chấm công thật của phía còn lại phát
                    # sinh trong ngày (vd quên check-in buổi sáng, nộp đơn giữa trưa,
                    # rồi chiều tối mới chấm công ra), snapshot đó mãi mãi rỗng dù chấm
                    # công thật đã có. Tra lại calendar_result của đúng event_date —
                    # explanation_approval luôn được sắp xếp xử lý theo NGÀY DUYỆT thực
                    # tế (xem _get_sort_key trong replay_month), nên tại đây chấm công
                    # thật của event_date chắc chắn đã nằm trong calendar_result rồi.
                    # CHỈ lấy đúng phía nhân viên khai đã QUÊN (forgot_punch_type) —
                    # không lấy phía ngược lại, vì 1 lượt chấm công duy nhất trong ngày
                    # được ghi đè lên CẢ check_in lẫn check_out (xem attendance import),
                    # lấy nhầm phía sẽ hiểu sai bản chất (vd quên check-in nhưng lại bị
                    # hiểu thành có check-in thật, mất luôn giờ check-out thật).
                    # Bug thực tế: NV NV80038, 17/9/2026.
                    # Có bản ghi chỉ có ĐÚNG 1 lượt chấm nằm ở ô check_in (check_out
                    # rỗng) — nếu NV khai quên check-in mà lượt chấm đó MUỘN hơn giờ
                    # vào đã khai thì nó chính là giờ ra (và ngược lại cho quên
                    # check-out). Bug thực tế: NV NV80025, 7/9/2026 (chấm 17:04 lưu ở
                    # check_in, khai vào 08:00 -> thiếu giờ ra -> chỉ được 0.5 công).
                    def _lone_punch(_entry):
                        ci, co = _entry.get("check_in"), _entry.get("check_out")
                        return (ci or co) if not (ci and co) else None

                    if forgot_punch_type == "checkin" and not actual_check_out_str:
                        for _entry in self.calendar_result:
                            if _entry.get("date") == event_date and _entry.get("event_type") == "attendance":
                                if _entry.get("check_out"):
                                    actual_check_out_str = str(_entry["check_out"])
                                else:
                                    lone = _lone_punch(_entry)
                                    if lone and forgot_checkin_time_str and str(lone)[:5] > str(forgot_checkin_time_str)[:5]:
                                        actual_check_out_str = str(lone)
                                break
                    elif forgot_punch_type == "checkout" and not actual_check_in_str:
                        for _entry in self.calendar_result:
                            if _entry.get("date") == event_date and _entry.get("event_type") == "attendance":
                                if _entry.get("check_in"):
                                    actual_check_in_str = str(_entry["check_in"])
                                else:
                                    lone = _lone_punch(_entry)
                                    if lone and forgot_checkout_time_str and str(lone)[:5] < str(forgot_checkout_time_str)[:5]:
                                        actual_check_in_str = str(lone)
                                break

                    def _safe_parse_time(t_str):
                        if not t_str:
                            return None
                        try:
                            return _dt.time.fromisoformat(t_str)
                        except (ValueError, TypeError):
                            return None

                    # Ghép: ưu tiên giờ thật từ máy chấm công, fallback giờ NV khai
                    start_time = _safe_parse_time(actual_check_in_str) or _safe_parse_time(forgot_checkin_time_str)
                    end_time = _safe_parse_time(actual_check_out_str) or _safe_parse_time(forgot_checkout_time_str)

                    # Nếu quên cả hai → chỉ dùng giờ NV khai
                    if forgot_punch_type == "both":
                        start_time = _safe_parse_time(forgot_checkin_time_str)
                        end_time = _safe_parse_time(forgot_checkout_time_str)

                    logger.info(
                        "[Explanation Approval Rule] INCOMPLETE_ATTENDANCE: "
                        "punch_type=%s, actual_ci=%s, actual_co=%s, "
                        "forgot_ci=%s, forgot_co=%s → start=%s, end=%s",
                        forgot_punch_type,
                        actual_check_in_str, actual_check_out_str,
                        forgot_checkin_time_str, forgot_checkout_time_str,
                        start_time, end_time,
                    )

                    # Tính timeline: đổi giờ vào/ra sang phút → trừ nhau → chia 60 ra số giờ
                    # VD: 08:30→17:30 = (17*60+30)-(8*60+30) = 540 phút = 9.0h >= 5.5h → 1.0 công
                    if start_time and end_time:
                        worked_minutes = (end_time.hour * 60 + end_time.minute) - (start_time.hour * 60 + start_time.minute)
                        worked_hours = worked_minutes / 60
                        if worked_hours >= 5.5:
                            target_credit = 1.0
                        elif worked_hours > 0:
                            target_credit = 0.5
                        else:
                            target_credit = 0.5
                        logger.info(
                            "[Explanation Approval Rule] Timeline: %s → %s = %.1fh → %.1f công",
                            start_time, end_time, worked_hours, target_credit,
                        )
                    else:
                        # Phân biệt đơn LEGACY (gửi trước khi đổi logic chia ca, không có field timeline nào)
                        # vs đơn MỚI thiếu dữ liệu timeline
                        is_legacy_form = (
                            not forgot_punch_type
                            and not actual_check_in_str and not actual_check_out_str
                            and not forgot_checkin_time_str and not forgot_checkout_time_str
                        )
                        if is_legacy_form:
                            # Đơn cũ gửi trước khi có logic chia ca → giữ default 1.0 công như logic cũ
                            target_credit = 1.0
                            logger.info(
                                "[Explanation Approval Rule] Đơn LEGACY (không có field timeline) → 1.0 công"
                            )
                        else:
                            # Không đủ 2 mốc thời gian → mặc định 0.5 công
                            target_credit = 0.5
                            logger.info(
                                "[Explanation Approval Rule] Không đủ timeline (start=%s, end=%s) → 0.5 công",
                                start_time, end_time,
                            )

                if is_over_quota:
                    target_credit -= over_quota_deduction
                    target_credit = max(target_credit, 0.0)  # Chống công âm
                    logger.info("[Explanation Approval Rule] Quá quota (%d/%d) -> Mục tiêu %.1f công",
                                self.explanation_quota_used + 1, quota_max, target_credit)

                # Tránh cộng dồn quá 1.0 công mỗi ngày
                existing_credit = self._get_work_credit_for_date(event_date)

                # Với đơn nửa ngày thuộc nhóm cộng bù (LEAVE/BUSINESS_TRIP/FIRST_DAY/WORK_FROM_HOME),
                # target_credit là phần CỘNG THÊM của đơn (0.5), không phải tổng công mục tiêu của cả ngày.
                # Ví dụ: đã đi làm ca chiều 0.5 + đơn công tác sáng 0.5 => tổng 1.0.
                #
                # NHƯNG: chỉ được cộng thêm khi existing_credit đến từ buổi CÒN LẠI (buổi không
                # liên quan đến đơn này). Nếu ngày đó có buổi bị "đi muộn/về sớm" (day_violations
                # > 0) — tức nhân viên vẫn có mặt, chỉ muộn/sớm nhưng chưa tới mức bị coi vắng mặt
                # (< 120 phút) nên buổi đó đã tự được 0.5 công từ chấm công thực tế — thì rất có
                # khả năng existing_credit chính là công của buổi mà đơn nửa ngày này đang giải
                # trình (vd: "Công tác nửa ngày" dùng để xin miễn phạt đi muộn, không phải để bù
                # công cho buổi vắng). Khi đó KHÔNG cộng thêm target_credit nữa — đơn chỉ có tác
                # dụng miễn phạt (đã xử lý ở bước 1), giữ nguyên công thực tế đã có.
                #
                # INCOMPLETE_ATTENDANCE (quên chấm công) không dùng expected_status="HALF_DAY"
                # (field này mang giá trị "PRESENT") nên không tự khớp is_half_day_expected —
                # nhưng target_credit của nó VẪN có thể là phần công của MỘT buổi (khi timeline
                # chỉ tính ra 0.5, xem nhánh tính INCOMPLETE_ATTENDANCE ở trên), nên vẫn cần cộng
                # bù với buổi còn lại thay vì so target_credit với existing_credit của CẢ NGÀY.
                # Bug thực tế: NV nghỉ phép nửa ngày sáng (0.5) + quên chấm công chiều được giải
                # trình ra 0.5 công (làm 4.5h, dưới ngưỡng 5.5h) -> needed=max(0, 0.5-0.5)=0,
                # cả ngày chỉ còn 0.5 công thay vì đúng ra 1.0 (NV80023, 03/9/2026).
                is_partial_credit_type = is_half_day_expected or explanation_type == "INCOMPLETE_ATTENDANCE"
                if is_additive_half_day_type and is_partial_credit_type and day_violations == 0:
                    needed = max(0.0, min(1.0, existing_credit + target_credit) - existing_credit)
                else:
                    needed = max(0.0, target_credit - existing_credit)
                
                # Fix: Nếu là đơn nghỉ phép nửa ngày nhưng người đó đã đi làm nửa ngày (0.5), 
                # thì needed phải là 0.5 để tổng là 1.0. 
                # Nếu người đó chưa đi làm (0.0), thì needed là target_credit (0.5).
                # Nếu target_credit là 1.0 và đã đi làm 0.5, needed là 0.5.
                
                logger.info(
                    "[DEBUG CREDIT] target_credit=%.1f | existing_credit=%.1f | needed=%.1f | is_over_quota=%s",
                    target_credit, existing_credit, needed, is_over_quota,
                )
                if needed > 0:
                    effects["nua_ngay_cong"] = needed
                    logger.info("[Explanation Approval Rule] Điều chỉnh %.1f công cho %s (Đã có %.1f, Mục tiêu %.1f)",
                                 needed, explanation_type, existing_credit, target_credit)
            
            return effects

        # Regular LEAVE: consumes annual leave balance
        if explanation_type == "LEAVE":
            event_date = event.data.get("date")
            is_half = (event.data.get("expected_status") == "HALF_DAY")
            target_credit = 0.5 if is_half else 1.0

            effects = {
                "nghi_phep": target_credit,
                "remaining_annual_leave": -target_credit,
            }

            # Cộng bù công cho buổi CÒN LẠI trong ngày (vd: đi làm buổi sáng + nghỉ
            # phép nửa ngày buổi chiều = 1.0 công). existing_credit chỉ tính công
            # DƯƠNG đã ghi nhận thật (nua_ngay_cong/ngay_du_cong — xem
            # _get_work_credit_for_date), KHÔNG tính vang_mat, nên trần min(1.0,
            # existing+target) đã đủ để chặn cộng dư quá 1 công/ngày — không cần
            # thêm điều kiện "ngày đó không có vi phạm nào đi muộn/về sớm" (khác
            # BUSINESS_TRIP: NV có thể dùng đơn công tác để giải trình CHO buổi
            # đi muộn/về sớm đó — còn "Nghỉ phép" gần như luôn là buổi HỌ KHÔNG
            # đi làm, tách biệt với buổi có vi phạm).
            #
            # Bug đã gặp: NV chấm công sáng (vd: 08:31, muộn 1 phút, vẫn được
            # 0.5 công vì < 120 phút) rồi xin nghỉ phép nửa ngày (chiều) — điều
            # kiện "day_violations == 0" cũ (copy từ fix BUSINESS_TRIP, không phù
            # hợp với LEAVE) hiểu nhầm buổi nghỉ chiều với buổi sáng bị muộn, chặn
            # không cộng thêm 0.5 công của đơn nghỉ phép -> cả ngày chỉ ra 0.5
            # công thay vì đúng ra 1.0.
            existing_credit = self._get_work_credit_for_date(event_date) if event_date else 0.0

            if is_half:
                needed = max(0.0, min(1.0, existing_credit + target_credit) - existing_credit)
            else:
                needed = max(0.0, target_credit - existing_credit)

            if needed > 0:
                effects["nua_ngay_cong"] = needed

            return effects

        return {}
        logger.info(
            "[Explanation Approval Rule] %s duyệt event_id=%s bởi %s (type=%s) → nghi_phep += 1, nua_ngay_cong += 1, remaining_annual_leave -= 1",
            approval_level, approved_for_event_id, approved_by_name, explanation_type,
        )
        return effects

    # ------------------------------------------------------------------
    # REPLAY FUNCTION
    # ------------------------------------------------------------------
    @classmethod
    def replay_month(cls, employee_code: str, year: int, month: int, employee_info: dict = None):
        """
        Replay toàn bộ event của một employee trong một tháng cụ thể.
        
        Args:
            employee_code: Mã nhân viên
            year: Năm cần replay
            month: Tháng cần replay (1-12)
            employee_info: Thông tin bổ sung về nhân viên (department, group, etc.)
            
        Returns:
            dict: Chứa toàn bộ state và calendar sau khi replay
                {
                    "employee_code": "E001",
                    "year": 2024,
                    "month": 1,
                    "state": {...},
                    "calendar": [...],
                    "events_processed": 10,
                    "start_date": "2024-01-01",
                    "end_date": "2024-01-31",
                    "shift_configs": [...]
                }
        """
        from hrm.event_models import EmployeeEvent
        from django.utils import timezone
        from datetime import datetime, date
        from employee.models import Employee as EmployeeModel

        # Tạo đối tượng EmployeeState
        state = cls(employee_code)

        # Fetch employee object trước để có department_id cho init_rules
        try:
            employee_obj = EmployeeModel.objects.get(employee_id=employee_code)
        except EmployeeModel.DoesNotExist:
            employee_obj = None
            logger.warning(
                "[replay_month] Không tìm thấy employee %s, dùng mặc định 12 ngày phép",
                employee_code,
            )

        # Dùng lại chính object này cho _rules_from_registered_shifts() (ca đã
        # đăng ký theo ngày) thay vì để _get_employee_obj() query lại — đường đi
        # chính của engine, tránh thêm 1 query mỗi lượt replay. Đánh dấu đã tải
        # kể cả khi employee_obj là None: "không tìm thấy" cũng là kết quả cuối.
        state._employee_obj = employee_obj
        state._employee_obj_loaded = True

        # Đảm bảo _rules_info có department_id và position_id để rule engine áp dụng
        # đúng RuleDefinition theo phòng ban và vị trí của nhân viên.
        #
        # Phòng ban/vị trí lấy THEO THÁNG ĐANG TÍNH (lịch sử điều chuyển, employee/
        # assignment.py — ngày cuối tháng): chuyển phòng ban/vị trí từ tháng sau
        # không làm đổi công tháng này khi mở lại / chốt lại. Ca, lịch phòng ban,
        # phạm vi đăng ký ca thì tra theo TỪNG NGÀY ở chỗ dùng.
        _rules_info = dict(employee_info) if employee_info else {}
        _assignment = None
        _employee_month = employee_obj
        if employee_obj:
            import calendar as _cal_assign
            from employee.assignment import AssignmentResolver
            _assignment = AssignmentResolver()
            _employee_month = _assignment.employee_on(
                employee_obj, date(year, month, _cal_assign.monthrange(year, month)[1]),
            )
            if _employee_month.department_id and "department_id" not in _rules_info:
                _rules_info["department_id"] = str(_employee_month.department_id)
            if _employee_month.position_id and "position_id" not in _rules_info:
                _rules_info["position_id"] = str(_employee_month.position_id)
            if _employee_month.position and "position_code" not in _rules_info:
                _rules_info["position_code"] = _employee_month.position.code

        # Khởi tạo rules với _rules_info (đã bao gồm department_id nếu có)
        state.init_rules(_rules_info or None)

        # Chế độ con nhỏ: các ngày trong tháng NV đang hưởng (kèm số phút được nới).
        if employee_obj:
            import calendar as _cal_cc
            from .child_care_regime import child_care_minutes_by_date
            state._child_care_minutes = child_care_minutes_by_date(
                employee_obj.id, date(year, month, 1), date(year, month, _cal_cc.monthrange(year, month)[1]),
            )

        # Phòng ban làm chiều thứ 7 mọi tuần (kể cả tuần 2/4) → tắt guard "nửa ngày
        # thứ 7 tuần 2/4" cho nhân viên này (xem _evaluate_afternoon_shift_rule).
        # Ưu tiên TUYỆT ĐỐI cờ ghi đè riêng của nhân viên (Employee.saturday_afternoon_
        # always_workday) nếu có set (khác None) — cho phép 1-2 nhân viên lẻ trong 1
        # phòng ban đi làm/nghỉ chiều thứ 7 khác với mặc định chung của cả phòng ban.
        # Không set (None) thì mới rơi về cờ của phòng ban như trước đây.
        if employee_obj:
            employee_override = employee_obj.saturday_afternoon_always_workday
            if employee_override is not None:
                state.saturday_afternoon_always_workday = bool(employee_override)
            elif _employee_month.department:
                state.saturday_afternoon_always_workday = bool(
                    _employee_month.department.saturday_afternoon_always_workday
                )
                # Lịch phòng ban có thể đổi giữa tháng (vd GSCL làm chiều T7 mọi tuần từ
                # 15/10/2026), NV cũng có thể chuyển phòng — tra cờ cho TỪNG thứ 7 của
                # tháng theo phòng ban + lịch của chính ngày đó.
                from employee.schedule import ScheduleResolver
                import calendar as _cal_sat
                _schedule = ScheduleResolver(_assignment)
                for _day in range(1, _cal_sat.monthrange(year, month)[1] + 1):
                    _d = date(year, month, _day)
                    if _d.weekday() == 5:
                        state._saturday_afternoon_by_date[_d] = _schedule.saturday_afternoon_workday(
                            employee_obj, _d,
                        )

        # Khởi tạo số ngày nghỉ phép năm còn lại từ Employee model
        if employee_obj:
            # Nếu năm trong balance khác với năm đang tính, reset về mặc định (12 ngày/năm)
            if employee_obj.annual_leave_balance_year != year:
                from hrm.models import CompanyConfig
                config = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
                default_days = config.annual_leave_days_per_year if config else 12
                employee_obj.annual_leave_balance = default_days
                employee_obj.annual_leave_balance_year = year
                employee_obj.save(update_fields=['annual_leave_balance', 'annual_leave_balance_year'])
                logger.info(
                    "[replay_month] Khởi tạo số ngày phép năm %d cho %s: %d ngày",
                    year, employee_code, default_days,
                )
            state.remaining_annual_leave = float(employee_obj.annual_leave_balance)
        else:
            state.remaining_annual_leave = 12.0

        # Xác định khoảng thời gian tháng
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1) - timezone.timedelta(days=1)
        else:
            end_date = date(year, month + 1, 1) - timezone.timedelta(days=1)

        # Lấy ShiftConfig áp dụng cho nhân viên trong tháng này
        shift_configs = _load_shift_configs_for_employee(employee_code, start_date)

        # Nếu một rule_type SHIFT_RULE chưa có trong RuleDefinition, sinh rule từ ShiftConfig
        # cho đúng loại đó. Điều này đảm bảo rằng nếu RuleDefinition chỉ có SHIFT_RULE_AFTERNOON
        # nhưng ShiftConfig có cả ca sáng lẫn ca chiều, ca sáng vẫn được xử lý đúng.
        existing_shift_types = {
            r.get('rule_type', '')
            for r in state.rules
            if r.get('rule_type', '').startswith('SHIFT_RULE')
        }
        if shift_configs:
            synthetic_rules = _shift_configs_to_rules(shift_configs)
            # Only add synthetic rules for shift types that do NOT already have an
            # explicit RuleDefinition entry, so a partial DB config (e.g. only
            # SHIFT_RULE_AFTERNOON) still gets the missing types filled in from
            # ShiftConfig (e.g. SHIFT_RULE_MORNING).
            added = [r for r in synthetic_rules if r.get('rule_type', '') not in existing_shift_types]
            if added:
                state.rules.extend(added)
                print(f"Generated {len(added)} synthetic shift rules from ShiftConfig (missing types: {[r['rule_type'] for r in added]})")

        # Nếu chưa có LEAVE_RULE trong RuleDefinition, thêm rule mặc định
        # để đảm bảo đơn nghỉ phép đã duyệt được tính vào nghi_phep / nghi_khong_luong.
        has_leave_rules = any(
            r.get('rule_type', '') in ('LEAVE_RULE_PAID', 'LEAVE_RULE_UNPAID')
            for r in state.rules
        )
        if not has_leave_rules:
            state.rules.extend([
                {
                    "rule_name": "Default Paid Leave Rule",
                    "rule_type": "LEAVE_RULE_PAID",
                    "conditions": {"workday": 1.0},
                    "priority": 0,
                },
                {
                    "rule_name": "Default Unpaid Leave Rule",
                    "rule_type": "LEAVE_RULE_UNPAID",
                    "conditions": {"workday": 1.0},
                    "priority": 0,
                },
            ])
            print("Added default LEAVE_RULE_PAID and LEAVE_RULE_UNPAID fallback rules")
        
        has_livestream_rules = any(
            r.get('rule_type', '') == 'LIVESTREAM_RULE'
            for r in state.rules
        )

        if not has_livestream_rules:
            state.rules.append({
                "rule_name": "Default Livestream Rule",
                "rule_type": "LIVESTREAM_RULE",
                "conditions": {
                    "min_duration_for_count": 0,
                    "allowance_per_session": 0,
                    "prime_time_start_hour": 21,
                    "prime_time_end_hour": 23,
                    "prime_time_allowance": 100_000,
                    "max_prime_time_pct": 0.20,
                    "max_sessions_per_month": 999,
                },
                "priority": 0,
            })
            print("Added default LIVESTREAM_RULE fallback rule")

        # Online work default rule
        has_online_rules = any(
            r.get('rule_type', '') == 'ONLINE_WORK_RULE'
            for r in state.rules
        )
        if not has_online_rules:
            state.rules.append({
                "rule_name": "Default Online Work Rule",
                "rule_type": "ONLINE_WORK_RULE",
                "conditions": {},
                "priority": 0,
            })
            print("Added default ONLINE_WORK_RULE fallback rule")

        # Tăng ca / Làm thêm giờ default rule
        has_ot_rules = any(
            r.get('rule_type', '') == 'OVERTIME_RULE'
            for r in state.rules
        )
        if not has_ot_rules:
            state.rules.append({
                "rule_name": "Default Overtime Rule",
                "rule_type": "OVERTIME_RULE",
                "conditions": {
                    "multiplier": 1.5,
                    "max_overtime_per_day": 4.0
                },
                "priority": 0,
            })
            print("Added default OVERTIME_RULE fallback rule")

        # Giải trình quên chấm công / đi muộn được duyệt
        has_explanation_approval_rules = any(
            r.get('rule_type', '') == 'EXPLANATION_APPROVAL_RULE'
            for r in state.rules
        )
        if not has_explanation_approval_rules:
            state.rules.append({
                "rule_name": "Default Explanation Approval Rule",
                "rule_type": "EXPLANATION_APPROVAL_RULE",
                "conditions": {},
                "priority": 0,
            })
            print("Added default EXPLANATION_APPROVAL_RULE fallback rule")

        # Tùy chỉnh sắp xếp để đảm bảo:
        # 1. Các đơn giải trình/duyệt duy trì thứ tự created_at để tính quota chính xác.
        # 2. Trên cùng một ngày, các event machine (attendance) được ưu tiên xử lý TRƯỚC các event duyệt (approval).
        #    Điều này giúp rule điều chỉnh công (needed = target - existing) thấy được công đã có từ máy chấm công.
        raw_events = list(EmployeeEvent.objects.filter(
            employee__employee_id=employee_code,
            event_date__gte=start_date,
            event_date__lte=end_date
        ).select_related('reference_event', 'employee').order_by('created_at', 'id'))

        # ── Deduplicate explanation_approval events ──────────────────────────────
        # Vấn đề: Hệ thống có thể tạo nhiều bản ghi HR approval cho cùng một đơn giải trình
        # (ví dụ: duyệt nhanh hàng loạt + duyệt lại thủ công). Mỗi lần xử lý approval sẽ:
        # 1. Xóa tiền phạt một lần → Xử lý 2 lần sẽ làm tong_phat âm (double refund)
        # 2. Tăng explanation_quota_used → Xử lý 2 lần sẽ dùng 2 quota thay vì 1
        # Giải pháp: Với mỗi approved_for_event_id, chỉ giữ lại 1 event duyệt CUỐI CÙNG
        # có action=APPROVE + approval_level thuộc nhóm FINAL (HR/ADMIN) — bất kể
        # approval_level cụ thể là gì (ưu tiên event cũ nhất để đảm bảo thứ tự xử lý
        # nhất quán).
        #
        # LƯU Ý: trước đây key dedup là (approved_for_event_id, approval_level) — tức
        # là 2 event duyệt CÙNG 1 đơn gốc nhưng approval_level KHÁC NHAU (vd: "duyệt
        # nhanh hàng loạt" bởi ADMIN tạo level='ADMIN', sau đó ai đó bấm duyệt lại thủ
        # công qua nút Duyệt từng đơn với tài khoản HR (không phải admin) tạo thêm 1
        # event level='HR' cho CÙNG đơn đó) sẽ KHÔNG bị coi là trùng lặp — vẫn lọt qua
        # dedup cũ, khiến effects (xoá phạt, +1 explanation_quota_used) bị áp dụng 2
        # lần cho đúng 1 đơn giải trình. Dedup theo approved_for_event_id ĐƠN THUẦN (bỏ
        # qua approval_level) mới chặn được đúng lớp bug này.
        _seen_approvals: set = set()
        _deduplicated_events = []
        for ev in raw_events:
            if ev.event_type == "explanation_approval":
                d = ev.data or {}
                approved_for = d.get("approved_for_event_id")
                level = d.get("approval_level", "")
                action = d.get("action", "")
                # DIRECT_MANAGER chỉ là bước trung gian (không có hiệu ứng công/phạt/quota
                # — xem _evaluate_explanation_approval_rule, _FINAL_APPROVAL_LEVELS chỉ
                # gồm HR/ADMIN), nên không cần/không được dedup chung với các approval
                # FINAL — 1 đơn luôn có tối đa 1 event DIRECT_MANAGER + 1 event FINAL hợp lệ.
                if action == "APPROVE" and approved_for is not None and level in ("HR", "ADMIN"):
                    key = approved_for
                    if key in _seen_approvals:
                        logger.info(
                            "[replay_month] Bỏ qua approval trùng lặp (đã có 1 approval FINAL cho đơn này): "
                            "event_id=%s, approved_for=%s, level=%s",
                            ev.id, approved_for, level,
                        )
                        continue
                    _seen_approvals.add(key)
            _deduplicated_events.append(ev)
        raw_events = _deduplicated_events

        # Event duyệt giải trình được xếp theo NGÀY HR DUYỆT (để tính quota đúng thứ
        # tự), nên nếu để nó trừ lỗi luôn thì các ngày vi phạm nằm giữa ngày vi phạm
        # và ngày duyệt vẫn bị đếm lỗi đó -> x2 sai (case NV80039 T9/2026: quên chấm
        # công 3/9 có đơn "làm ngày đầu" duyệt 18/9 -> 18/9 bị tính lỗi thứ 7).
        # Tách phần trừ lỗi ra 1 event riêng (không lưu DB) xếp tại ngày vi phạm.
        # BUSINESS_TRIP vốn đã xếp theo ngày vi phạm nên không cần.
        _COUNTER_RELEASE_TYPES = ("FORGOT", "INCOMPLETE_ATTENDANCE", "FIRST_DAY", "WORK_FROM_HOME")
        _release_events = []
        for ev in raw_events:
            if ev.event_type != "explanation_approval" or not ev.data:
                continue
            d = ev.data
            if d.get("action") != "APPROVE" or d.get("approval_level") not in ("HR", "ADMIN"):
                continue
            etype = d.get("explanation_type") or (
                (ev.reference_event.data or {}).get("explanation_type", "") if ev.reference_event else ""
            )
            if etype not in _COUNTER_RELEASE_TYPES:
                continue
            release = EmployeeEvent(
                employee=ev.employee,
                event_date=ev.event_date,
                event_type="explanation_approval",
                reference_event=ev.reference_event,
                data={**d, "explanation_type": etype, "counter_release_only": True},
            )
            release.created_at = ev.created_at
            d["counter_released_early"] = True
            _release_events.append(release)
        raw_events.extend(_release_events)

        def _get_event_order_key(ev):
            # Thứ tự ưu tiên xử lý TRONG CÙNG MỘT NGÀY:
            # 10: Attendance (Máy chấm công)
            # 20: Off Duty (Ra trực)
            # 30: Leave/Explanation Request (Đơn gửi)
            # 40: Explanation Approval (Phê duyệt - cần tính toán "needed" credit)
            prio = 30
            if ev.event_type == "attendance": prio = 10
            elif ev.event_type == "off_duty": prio = 20
            elif ev.event_type == "explanation_approval": prio = 40
            return prio

        import datetime as _sort_dt

        def _get_sort_key(ev):
            """
            Key sắp xếp event để đảm bảo:
            1. Máy chấm công (attendance) xử lý trước trong cùng 1 ngày.
            2. explanation_approval được sắp theo THỨ TỰ DUYỆT THỰC TẾ (approved_at),
               không theo ngày vi phạm (event_date). Điều này đảm bảo quota được tính
               theo đúng thứ tự HR duyệt, không theo thứ tự ngày trong tháng.
            """
            prio = _get_event_order_key(ev)
            
            if ev.event_type == "explanation_approval":
                # Dùng thời gian duyệt thực tế làm sort key "ngày"
                d = ev.data or {}
                explanation_type = d.get("explanation_type", "")
                ts_str = (
                    d.get("approved_at")
                    or d.get("hr_approved_at")
                    or d.get("direct_manager_approved_at")
                    or ""
                )
                
                # Bắt buộc kéo riêng duyệt công tác (BUSINESS_TRIP) về thời điểm xảy ra sự kiện
                # để hệ thống chấm công hủy lỗi kịp thời, ngăn chặn việc phạt x2 ở các ngày liền sau.
                is_business_trip = (explanation_type == "BUSINESS_TRIP") or bool(d.get("counter_release_only"))

                if ts_str and not is_business_trip:
                    try:
                        # ISO 8601 string tự sort đúng thứ tự khi so sánh string
                        # Nhưng để nhất quán với datetime, ta parse
                        ts = _sort_dt.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        # Dùng date từ timestamp để nhóm đúng với attendance của ngày đó
                        # nhưng ưu tiên prio cao hơn attendance (prio=40)
                        return (ts.date(), prio, ts)
                    except (ValueError, TypeError):
                        pass
                # Không có approved_at hoặc là loại BUSINESS_TRIP → dùng event_date
                return (
                    ev.event_date,
                    prio,
                    ev.created_at or _sort_dt.datetime.min,
                )
            
            # Tất cả loại event khác: sort theo (event_date, prio, created_at)
            return (
                ev.event_date,
                prio,
                ev.created_at or _sort_dt.datetime.min,
            )

        events = sorted(raw_events, key=_get_sort_key)
        
        print(f"Found {len(events)} events for employee {employee_code} in {month}/{year} (Custom ordered for credit accuracy)")

        # Pre-scan: Tìm các ngày có đơn Ra trực được duyệt để ưu tiên ghi đè logic chấm công
        from hrm.event_models import EmployeeEvent as _EE
        for ev in events:
            if ev.event_type == _EE.EventType.OFF_DUTY:
                data = ev.data or {}
                if data.get("status") == "APPROVED":
                    # Lưu date string YYYY-MM-DD
                    state._approved_off_duty_dates.add(ev.event_date.isoformat())
                    print(f"[replay_month] Phát hiện ngày Ra trực được duyệt: {ev.event_date}")

        # Xử lý từng event theo thứ tự thời gian
        for event in events:
            # Chuyển đổi EmployeeEvent thành Event object
            event_data = event.data or {}
            
            # Thêm thông tin cơ bản từ model
            if not event_data.get('date'):
                event_data['date'] = event.event_date.isoformat()
            if not event_data.get('employee_id'):
                event_data['employee_id'] = employee_code
            if not event_data.get('employee_name') and event.employee:
                event_data['employee_name'] = event.employee.full_name
            
            # Thêm thông tin cụ thể theo loại event
            if event.event_type == "attendance":
                if event.check_in and not event_data.get('check_in'):
                    event_data['check_in'] = event.check_in.strftime('%H:%M')
                if event.check_out and not event_data.get('check_out'):
                    event_data['check_out'] = event.check_out.strftime('%H:%M')
                # Inject shift timing so rules can use correct schedule.
                # Ưu tiên TUYỆT ĐỐI: (các) ca đã ĐĂNG KÝ (tính năng "Đăng ký ca
                # làm") cho đúng ngày này — chỉ có giá trị nếu nhân viên thuộc
                # phạm vi cấu hình (ShiftRegistrationScopeConfig). Nhân viên
                # NGOÀI phạm vi (ca làm cố định) luôn nhận về None ở bước này
                # nên hành vi giữ nguyên y hệt trước đây — không bị ảnh hưởng
                # bởi tính năng mới (yêu cầu #5: chạy song song, không phá ca
                # cố định). Mỗi "ca" đăng ký là 1 CẶP (ca sáng, ca chiều) nên
                # hàm trả về LIST tối đa 2 phần tử, tái dùng thẳng
                # _find_matching_shift() y hệt cascade ca cố định.
                if not event_data.get('shift_start_time'):
                    # Bọc try/except: đây là bảng của 1 tính năng PHỤ (Đăng ký ca
                    # làm), engine tính công dùng chung này chạy cho MỌI nhân
                    # viên/mọi lần chấm công. Nếu bảng chưa tồn tại (migration
                    # chưa kịp chạy xong lúc deploy) hoặc có lỗi DB bất kỳ ở đây,
                    # TUYỆT ĐỐI không được để sập cả luồng chấm công/check-in —
                    # coi như nhân viên ngoài phạm vi (None) và rơi về cascade ca
                    # cố định y hệt trước khi có tính năng này (sự cố đã xảy ra
                    # 29/8/2026: lỗi "relation does not exist" ở đúng chỗ này làm
                    # sập cả app check-in mobile).
                    try:
                        registered_shift_configs = (
                            _get_registered_shift_configs_for_date(employee_obj, event.event_date, state._registration_scope_cache)
                            if employee_obj else None
                        )
                    except Exception:
                        logger.exception(
                            "[replay_month] Lỗi khi lấy ca đã đăng ký cho NV=%s ngày=%s "
                            "-> bỏ qua, dùng cascade ca cố định",
                            employee_code, event.event_date,
                        )
                        registered_shift_configs = None
                    if registered_shift_configs is not None:
                        # [] (đăng ký nghỉ) -> matching=None; [1-2 ca] -> khớp theo giờ chấm công
                        matching = (
                            _find_matching_shift(
                                registered_shift_configs,
                                event_data.get('check_in'),
                                event_data.get('check_out'),
                            )
                            if registered_shift_configs else None
                        )
                    elif shift_configs:
                        matching = _find_matching_shift(
                            shift_configs,
                            event_data.get('check_in'),
                            event_data.get('check_out'),
                        )
                        # Tự động nhận diện ca thực tế (xem
                        # _resolve_effective_rules_for_event trong apply_rules,
                        # dùng chung logic): nếu NV được gán thêm 1 ca khác
                        # (vd: ca kinh doanh 13:00-21:00) mà giờ chấm công thực
                        # tế khớp đúng ca đó hơn ca vừa chọn ở cascade dedup ở
                        # trên -> hiển thị đúng ca đó thay vì ca mặc định, cho
                        # khớp với công đã tính ở apply_rules(). Bọc try/except
                        # theo đúng convention phòng thủ ở khối này — lỗi ở
                        # đây tuyệt đối không được làm sập chấm công.
                        try:
                            all_candidates = _get_all_candidate_shifts_for_employee(
                                employee_code, event.event_date, state._shift_scope_cache,
                            )
                            if all_candidates:
                                # Ca mặc định đang dùng cho từng loại (từ
                                # shift_configs — cascade dedup y hệt
                                # _resolve_effective_rules_for_event) — cùng
                                # margin chống đổi ca vì lệch vài phút ngẫu
                                # nhiên, để hiển thị luôn khớp với công đã tính.
                                current_rules_by_type = {
                                    _AUTO_SHIFT_TYPE_TO_RULE_TYPE.get(sc.shift_type, 'SHIFT_RULE_MORNING'): (sc.start_time, sc.end_time)
                                    for sc in shift_configs
                                }
                                detected = _detect_best_matching_shift(
                                    all_candidates,
                                    event_data.get('check_in'),
                                    event_data.get('check_out'),
                                    current_rules_by_type=current_rules_by_type,
                                )
                                if detected:
                                    matching = detected
                        except Exception:
                            logger.exception(
                                "[replay_month] Lỗi khi tự nhận diện ca cho NV=%s ngày=%s "
                                "-> bỏ qua, giữ ca theo cascade cố định",
                                employee_code, event.event_date,
                            )
                    else:
                        matching = None
                    if matching:
                        event_data['shift_start_time'] = str(matching.start_time)[:5]
                        event_data['shift_end_time'] = str(matching.end_time)[:5]
            
            elif event.event_type in ["overtime", "extra_hours", "night_shift", "off_duty"]:
                # Tính số giờ tăng ca từ check_in/check_out nếu model chưa có overtime_hours
                _MAX_OT_HOURS = 8.0  # Tối đa 8h/ngày (không tính giờ nghỉ trưa)
                if not event_data.get('overtime_hours'):
                    if event.overtime_hours:
                        event_data['overtime_hours'] = min(float(event.overtime_hours), _MAX_OT_HOURS)
                    elif event.check_in and event.check_out:
                        from datetime import datetime as _dt
                        c_in = _dt.combine(_dt.today(), event.check_in)
                        c_out = _dt.combine(_dt.today(), event.check_out)
                        diff = (c_out - c_in).total_seconds() / 3600
                        if diff > 0:
                            event_data['overtime_hours'] = min(diff, _MAX_OT_HOURS)
                
                # Gắn cờ trực tối nếu registration_type là NIGHT_SHIFT
                reg_type = event_data.get("registration_type", "").upper()
                if reg_type == "NIGHT_SHIFT":
                    event_data["is_night_shift"] = True
                
                # Đảm bảo Ra trực luôn có registration_type = OFF_DUTY
                if event.event_type == "off_duty" and not event_data.get("registration_type"):
                    event_data["registration_type"] = "OFF_DUTY"
            
            elif event.event_type == "livestream":
                if event.check_in and event.check_out and not event_data.get('session_duration'):
                    from datetime import datetime as _dt
                    check_in_dt = _dt.combine(_dt.today(), event.check_in)
                    check_out_dt = _dt.combine(_dt.today(), event.check_out)
                    duration_hours = (check_out_dt - check_in_dt).total_seconds() / 3600
                    if duration_hours > 0:
                        event_data['session_duration'] = duration_hours
                # Xác định prime time (21:00-23:00) nếu chưa có trong data
                if event.check_in and 'is_prime_time' not in event_data:
                    from datetime import time as _time
                    event_data['is_prime_time'] = (
                        _time(21, 0) <= event.check_in < _time(23, 0)
                    )

            elif event.event_type == "explanation":
                if event.explanation and not event_data.get('reason'):
                    event_data['reason'] = event.explanation

            elif event.event_type == "explanation_approval":
                # Inject explanation_type from the referenced explanation event when
                # the approval event itself does not carry it (e.g. legacy records).
                if event.reference_event:
                    ref_data = event.reference_event.data or {}
                    if not event_data.get('explanation_type'):
                        event_data['explanation_type'] = ref_data.get('explanation_type', '')
                    if not event_data.get('expected_status'):
                        event_data['expected_status'] = ref_data.get('expected_status', '')

            # Nhân viên thử việc (PROBATION) không tính công từ đơn nghỉ phép
            if (
                event.event_type == "leave_request"
                and employee_obj is not None
                and getattr(employee_obj, 'contract_type', None) in PROBATION_CONTRACT_TYPES
            ):
                print(f"[replay_month] Bỏ qua leave_request cho nhân viên thử việc ngày {event.event_date}")
                continue

            # Tạo Event object và thêm vào state
            event_obj = Event(event.event_type, event_data)
            print(f"Applying rules for event: {event.event_type} on {event.event_date} (Status: {event_data.get('status')})")
            state.apply_rules(event_obj)

        # Lưu số ngày phép còn lại sau khi tính toán
        if employee_obj is not None:
            balance_to_save = round(float(state.remaining_annual_leave), 2)
            if abs(balance_to_save) > cls._MAX_REASONABLE_ANNUAL_LEAVE_DAYS:
                logger.warning(
                    "[replay_month] Giá trị remaining_annual_leave bất thường cho %s: %s ngày (năm %d) — có thể do dữ liệu event không hợp lệ",
                    employee_code, balance_to_save, year,
                )
            employee_obj.annual_leave_balance = balance_to_save
            employee_obj.annual_leave_balance_year = year
            employee_obj.save(update_fields=['annual_leave_balance', 'annual_leave_balance_year'])
            logger.info(
                "[replay_month] Đã lưu số ngày phép còn lại cho %s: %s ngày (năm %d)",
                employee_code, balance_to_save, year,
            )

        # Tính công thử việc / chính thức dựa trên probation_end_date
        cong_thu_viec = 0.0
        cong_chinh_thuc = 0.0
        probation_end_date = employee_obj.probation_end_date if employee_obj else None
        for day_entry in state.calendar_result:
            delta = day_entry.get("delta", {})
            day_work = (
                delta.get("tong_ngay_cong", 0)
                or delta.get("ngay_du_cong", 0)
                or delta.get("nua_ngay_cong", 0)
            )
            if not day_work:
                continue
            try:
                entry_date = date.fromisoformat(day_entry.get("date", ""))
            except (ValueError, TypeError):
                continue
            if probation_end_date and entry_date <= probation_end_date:
                cong_thu_viec += float(day_work)
            else:
                cong_chinh_thuc += float(day_work)

        # Phụ cấp gửi xe: 5.000 VNĐ/ngày thực tế, chỉ áp dụng cho hợp đồng thử việc (PROBATION)
        # Các loại hợp đồng khác đã có vé xe nên không nhận phụ cấp này
        # Nếu có nửa ngày công thì vẫn tính là 1 ngày gửi xe (làm ceil)
        if employee_obj is not None and employee_obj.contract_type in PROBATION_CONTRACT_TYPES:
            state.tong_phu_cap_gui_xe = PROBATION_PARKING_ALLOWANCE_PER_DAY * math.ceil(state.tong_ngay_cong)
        else:
            state.tong_phu_cap_gui_xe = 0

        # Trả về kết quả
        return {
            "employee_code": employee_code,
            "year": year,
            "month": month,
            "state": state.get_state_summary(),
            "calendar": state.calendar_result,
            "events_processed": len(events),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "cong_thu_viec": round(cong_thu_viec, 2),
            "cong_chinh_thuc": round(cong_chinh_thuc, 2),
            "hinh_thuc_lam_viec": employee_obj.contract_type if employee_obj else None,
            "shift_configs": [
                {
                    "id": sc.id,
                    "name": sc.name,
                    "code": sc.code,
                    "shift_type": sc.shift_type,
                    "start_time": str(sc.start_time)[:5],
                    "end_time": str(sc.end_time)[:5],
                    "working_hours": float(sc.working_hours or 0),
                    "is_default": sc.is_default,
                }
                for sc in shift_configs
            ],
        }
    
    def get_state_summary(self):
        """
        Trả về summary của state hiện tại.
        """
        return {
            "tong_ngay_cong": self.tong_ngay_cong,
            "ngay_du_cong": self.ngay_du_cong,
            "nua_ngay_cong": self.nua_ngay_cong,
            "di_muon_ve_som": self.di_muon_ve_som,
            "vang_mat": self.vang_mat,
            "quen_cham_cong": self.quen_cham_cong,
            "tang_ca": self.tang_ca,
            "lam_them_gio": self.lam_them_gio,
            "truc_toi": self.truc_toi,
            "live": self.live,
            "nghi_phep": self.nghi_phep,
            "nghi_khong_luong": self.nghi_khong_luong,
            "giai_trinh_cham_cong": self.giai_trinh_cham_cong,
            "tong_phat": self.tong_phat,
            "tong_phu_cap_gui_xe": self.tong_phu_cap_gui_xe,
            "tong_phu_cap_livestream": self.tong_phu_cap_livestream,
            "lam_viec_online": self.lam_viec_online,
            "violation_count_month": self.violation_count_month,
            "explanation_quota_used": self.explanation_quota_used,
            "remaining_annual_leave": self.remaining_annual_leave,
        }

        return effects

    def apply_morning_shift_rule(self, event: Event, rule: dict):
        """
        Áp dụng rule ca sáng.

        Xử lý dữ liệu thiếu một phần:
          - Chỉ có check_in  → ghi quen_cham_cong; VẪN kiểm tra đi muộn.
          - Chỉ có check_out → ghi quen_cham_cong; VẪN kiểm tra về sớm.
          - Không có gì      → ghi quen_cham_cong, không tính công.
          - Có cả hai        → kiểm tra đầy đủ đi muộn + về sớm, tính 0.5 công.
        """
        if event.event_type != "attendance":
            return

        from datetime import datetime

        start_time_str = rule['conditions']['start_time']
        end_time_str   = rule['conditions']['end_time']
        workday        = rule['conditions']['workday']   # 0.5

        def parse_time(t: str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.strptime(t, fmt).time()
                except ValueError:
                    continue
            raise ValueError(f"Cannot parse time: {t}")

        shift_start = parse_time(start_time_str)
        shift_end   = parse_time(end_time_str)

        check_in_str  = event.data.get("check_in")
        check_out_str = event.data.get("check_out")
        check_in      = parse_time(check_in_str)  if check_in_str  else None
        check_out     = parse_time(check_out_str) if check_out_str else None

        # --- Trường hợp thiếu dữ liệu ---
        if not check_in or not check_out:
            self.quen_cham_cong += 1
            missing = "check_out" if check_in else ("check_in" if check_out else "check_in & check_out")
            print(f"[Ca sáng] Thiếu {missing} → quen_cham_cong += 1 (tổng: {self.quen_cham_cong})")

            # Dù thiếu dữ liệu, vẫn kiểm tra vi phạm nếu còn đủ thông tin
            if check_in and check_in > shift_start:
                late_minutes = int(
                    (datetime.combine(datetime.today(), check_in)
                     - datetime.combine(datetime.today(), shift_start)).total_seconds() / 60
                )
                penalty = self._calc_penalty(late_minutes)
                if penalty == -1:
                    self.vang_mat += workday
                    print(f"[Ca sáng] Đi muộn {late_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                else:
                    self.tong_phat            += penalty
                    self.di_muon_ve_som       += 1
                    self.violation_count_month += 1
                    print(f"[Ca sáng] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")
                    print(f"[Ca sáng] Vi phạm → di_muon_ve_som += 1 (tổng tháng: {self.di_muon_ve_som})")

            if check_out and check_out < shift_end:
                early_minutes = int(
                    (datetime.combine(datetime.today(), shift_end)
                     - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
                )
                penalty = self._calc_penalty(early_minutes)
                if penalty == -1:
                    self.vang_mat += workday
                    print(f"[Ca sáng] Về sớm {early_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                else:
                    self.tong_phat            += penalty
                    self.di_muon_ve_som       += 1
                    self.violation_count_month += 1
                    print(f"[Ca sáng] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")
                    print(f"[Ca sáng] Vi phạm → di_muon_ve_som += 1 (tổng tháng: {self.di_muon_ve_som})")

            # Không tính công vì thiếu dữ liệu
            return

        # --- Có đủ cả check_in và check_out ---

        # Nếu check_out trước giờ bắt đầu ca → không liên quan ca sáng
        if check_out <= shift_start:
            return

        is_violation = False

        # Đi muộn
        if check_in > shift_start:
            late_minutes = int(
                (datetime.combine(datetime.today(), check_in)
                 - datetime.combine(datetime.today(), shift_start)).total_seconds() / 60
            )
            penalty = self._calc_penalty(late_minutes)
            if penalty == -1:
                self.vang_mat += workday
                print(f"[Ca sáng] Đi muộn {late_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                return
            self.tong_phat += penalty
            is_violation    = True
            print(f"[Ca sáng] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")

        # Về sớm
        if check_out < shift_end:
            early_minutes = int(
                (datetime.combine(datetime.today(), shift_end)
                 - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
            )
            penalty = self._calc_penalty(early_minutes)
            if penalty == -1:
                self.vang_mat += workday
                print(f"[Ca sáng] Về sớm {early_minutes} phút → vắng mặt ca sáng (vang_mat += {workday})")
                return
            self.tong_phat += penalty
            is_violation    = True
            print(f"[Ca sáng] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")

        if is_violation:
            self.di_muon_ve_som       += 1
            self.violation_count_month += 1
            print(f"[Ca sáng] Vi phạm → di_muon_ve_som += 1 (tổng tháng: {self.di_muon_ve_som})")

        # Tính công ca sáng
        self.nua_ngay_cong += workday
        self.tong_ngay_cong = self.ngay_du_cong + self.nua_ngay_cong
        print(f"[Ca sáng] Tính {workday} công → tổng {self.tong_ngay_cong} công")

    def apply_afternoon_shift_rule(self, event: Event, rule: dict):
        """
        Áp dụng rule ca chiều.

        Xử lý dữ liệu thiếu một phần:
          - Chỉ có check_in  → ghi quen_cham_cong; VẪN kiểm tra đi muộn.
          - Chỉ có check_out → ghi quen_cham_cong; VẪN kiểm tra về sớm.
          - Không có gì      → ghi quen_cham_cong, không tính công.
          - Có cả hai        → kiểm tra đầy đủ đi muộn + về sớm, tính 0.5 công.
        """
        if event.event_type != "attendance":
            return

        from datetime import datetime

        start_time_str = rule['conditions']['start_time']
        end_time_str   = rule['conditions']['end_time']
        workday        = rule['conditions']['workday']   # 0.5

        def parse_time(t: str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.strptime(t, fmt).time()
                except ValueError:
                    continue
            raise ValueError(f"Cannot parse time: {t}")

        shift_start = parse_time(start_time_str)
        shift_end   = parse_time(end_time_str)

        check_in_str  = event.data.get("check_in")
        check_out_str = event.data.get("check_out")
        check_in      = parse_time(check_in_str)  if check_in_str  else None
        check_out     = parse_time(check_out_str) if check_out_str else None

        # --- Trường hợp thiếu dữ liệu ---
        if not check_in or not check_out:
            self.quen_cham_cong += 1
            missing = "check_out" if check_in else ("check_in" if check_out else "check_in & check_out")
            print(f"[Ca chiều] Thiếu {missing} → quen_cham_cong += 1 (tổng: {self.quen_cham_cong})")

            # Dù thiếu dữ liệu, vẫn kiểm tra vi phạm nếu còn đủ thông tin
            if check_in:
                effective_check_in = max(check_in, shift_start)
                if effective_check_in > shift_start:
                    late_minutes = int(
                        (datetime.combine(datetime.today(), effective_check_in)
                         - datetime.combine(datetime.today(), shift_start)).total_seconds() / 60
                    )
                    penalty = self._calc_penalty(late_minutes)
                    if penalty == -1:
                        self.vang_mat += workday
                        print(f"[Ca chiều] Đi muộn {late_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                    else:
                        self.tong_phat            += penalty
                        self.di_muon_ve_som       += 1
                        self.violation_count_month += 1
                        print(f"[Ca chiều] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")
                        print(f"[Ca chiều] Vi phạm → di_muon_ve_som += 1 (tổng tháng: {self.di_muon_ve_som})")

            if check_out and check_out < shift_end:
                early_minutes = int(
                    (datetime.combine(datetime.today(), shift_end)
                     - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
                )
                penalty = self._calc_penalty(early_minutes)
                if penalty == -1:
                    self.vang_mat += workday
                    print(f"[Ca chiều] Về sớm {early_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                else:
                    self.tong_phat            += penalty
                    self.di_muon_ve_som       += 1
                    self.violation_count_month += 1
                    print(f"[Ca chiều] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")
                    print(f"[Ca chiều] Vi phạm → di_muon_ve_som += 1 (tổng tháng: {self.di_muon_ve_som})")

            # Không tính công vì thiếu dữ liệu
            return

        # --- Có đủ cả check_in và check_out ---

        # Nếu check_out trước hoặc bằng giờ bắt đầu ca chiều → không liên quan
        if check_out <= shift_start:
            return

        effective_check_in = max(check_in, shift_start)
        is_violation = False

        # Đi muộn (tính từ đầu ca chiều)
        if effective_check_in > shift_start:
            late_minutes = int(
                (datetime.combine(datetime.today(), effective_check_in)
                 - datetime.combine(datetime.today(), shift_start)).total_seconds() / 60
            )
            penalty = self._calc_penalty(late_minutes)
            if penalty == -1:
                self.vang_mat += workday
                print(f"[Ca chiều] Đi muộn {late_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                return
            self.tong_phat += penalty
            is_violation    = True
            print(f"[Ca chiều] Đi muộn {late_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")

        # Về sớm
        if check_out < shift_end:
            early_minutes = int(
                (datetime.combine(datetime.today(), shift_end)
                 - datetime.combine(datetime.today(), check_out)).total_seconds() / 60
            )
            penalty = self._calc_penalty(early_minutes)
            if penalty == -1:
                self.vang_mat += workday
                print(f"[Ca chiều] Về sớm {early_minutes} phút → vắng mặt ca chiều (vang_mat += {workday})")
                return
            self.tong_phat += penalty
            is_violation    = True
            print(f"[Ca chiều] Về sớm {early_minutes} phút → phạt {penalty:,} VNĐ | tong_phat += {penalty:,} (tổng: {self.tong_phat:,})")

        if is_violation:
            self.di_muon_ve_som       += 1
            self.violation_count_month += 1
            print(f"[Ca chiều] Vi phạm → di_muon_ve_som += 1 (tổng tháng: {self.di_muon_ve_som})")

        # Tính công ca chiều
        self.nua_ngay_cong += workday

        if self.nua_ngay_cong >= 1.0:
            full_days = int(self.nua_ngay_cong)
            self.ngay_du_cong  += full_days
            self.nua_ngay_cong -= full_days

        self.tong_ngay_cong = self.ngay_du_cong + self.nua_ngay_cong
        print(f"[Ca chiều] Tính {workday} công → tổng {self.tong_ngay_cong} công")

    # ------------------------------------------------------------------
    # LEAVE_RULE_PAID và LEAVE_RULE_UNPAID handler
    # ------------------------------------------------------------------
    def apply_leave_rule(self, event: Event, rule: dict):
        """
        Áp dụng rule nghỉ phép (có lương hoặc không lương).
        
        Xử lý:
          - LEAVE_RULE_PAID: tính vào nghi_phep, không trừ công
          - LEAVE_RULE_UNPAID: tính vào nghi_khong_luong, trừ công
        """
        if event.event_type != "leave_request":
            return
        
        rule_type = rule.get("rule_type", "")
        conditions = rule.get("conditions", {})
        
        # Lấy thông tin từ event
        leave_type = event.data.get("leave_type", "")
        reason = event.data.get("reason", "")
        date = event.data.get("date", "")
        
        print(f"[Leave Rule] Xử lý đơn nghỉ phép: {leave_type} - {reason} - {date}")
        
        # Kiểm tra xem rule có match với loại leave không
        if rule_type == "LEAVE_RULE_PAID" and leave_type == "PAID":
            self.nghi_phep += 1
            print(f"[Leave Rule] Nghỉ phép có lương → nghi_phep += 1 (tổng: {self.nghi_phep})")
            
            # Có thể có điều kiện bổ sung từ rule
            max_days_per_year = conditions.get("max_days_per_year", 12)
            requires_approval = conditions.get("requires_approval", True)
            
            if requires_approval:
                print(f"[Leave Rule] Yêu cầu phê duyệt cho nghỉ phép có lương")
            
        elif rule_type == "LEAVE_RULE_UNPAID" and leave_type == "UNPAID":
            self.nghi_khong_luong += 1
            print(f"[Leave Rule] Nghỉ không lương → nghi_khong_luong += 1 (tổng: {self.nghi_khong_luong})")
            
            # Trừ công cho nghỉ không lương
            workday = conditions.get("workday", 1.0)
            self.vang_mat += workday
            print(f"[Leave Rule] Trừ {workday} công do nghỉ không lương → vang_mat += {workday} (tổng: {self.vang_mat})")
            
            max_days_per_month = conditions.get("max_days_per_month", 3)
            print(f"[Leave Rule] Giới hạn {max_days_per_month} ngày nghỉ không lương mỗi tháng")
        
        else:
            print(f"[Leave Rule] Rule type {rule_type} không khớp với leave_type {leave_type}")

    # ------------------------------------------------------------------
    # OVERTIME_RULE handler
    # ------------------------------------------------------------------
    def apply_overtime_rule(self, event: Event, rule: dict):
        """
        Áp dụng rule tăng ca.
        
        Xử lý:
          - Tính giờ tăng ca dựa trên thời gian làm thêm
          - Áp dụng hệ số nhân lương cho tăng ca
        """
        if event.event_type != "overtime":
            return
        
        conditions = rule.get("conditions", {})
        
        # Lấy thông tin từ event
        overtime_hours = event.data.get("overtime_hours", 0)
        date = event.data.get("date", "")
        reason = event.data.get("reason", "")
        
        print(f"[Overtime Rule] Xử lý tăng ca: {overtime_hours} giờ - {reason} - {date}")
        
        # Lấy cấu hình từ rule
        regular_hours_threshold = conditions.get("regular_hours_threshold", 8.0)
        multiplier = conditions.get("multiplier", 1.5)
        max_overtime_per_day = conditions.get("max_overtime_per_day", 4.0)
        
        # Kiểm tra giới hạn tăng ca mỗi ngày
        if overtime_hours > max_overtime_per_day:
            print(f"[Overtime Rule] Cảnh báo: {overtime_hours} giờ vượt quá giới hạn {max_overtime_per_day} giờ/ngày")
            overtime_hours = max_overtime_per_day
        
        # Tính tăng ca
        self.tang_ca += overtime_hours
        print(f"[Overtime Rule] Thêm {overtime_hours} giờ tăng ca → tang_ca += {overtime_hours} (tổng: {self.tang_ca})")
        
        # Tính làm thêm giờ (có thể khác với tăng ca)
        extra_hours = overtime_hours * multiplier
        self.lam_them_gio += extra_hours
        print(f"[Overtime Rule] Tính {extra_hours} giờ làm thêm (hệ số {multiplier}x) → lam_them_gio += {extra_hours} (tổng: {self.lam_them_gio})")
        
        # Kiểm tra nếu là tăng ca ban đêm
        is_night_shift = event.data.get("is_night_shift", False)
        if is_night_shift:
            self.truc_toi += 1
            print(f"[Overtime Rule] Tăng ca ban đêm → truc_toi += 1 (tổng: {self.truc_toi})")

    # ------------------------------------------------------------------
    # LIVESTREAM_RULE handler
    # ------------------------------------------------------------------
    def apply_livestream_rule(self, event: Event, rule: dict):
        """
        Áp dụng rule livestream.
        
        Xử lý:
          - Tính số buổi livestream
          - Tính phụ cấp livestream
        """
        if event.event_type != "livestream":
            return
        
        conditions = rule.get("conditions", {})
        
        # Lấy thông tin từ event
        session_duration = event.data.get("session_duration", 0)  # giờ
        date = event.data.get("date", "")
        session_time = event.data.get("session_time", "")
        
        print(f"[Livestream Rule] Xử lý livestream: {session_duration} giờ - {session_time} - {date}")
        
        # Lấy cấu hình từ rule
        min_duration_for_count = conditions.get("min_duration_for_count", 1.0)  # giờ
        allowance_per_session = conditions.get("allowance_per_session", 100000)  # VNĐ
        max_sessions_per_month = conditions.get("max_sessions_per_month", 8)
        
        # Kiểm tra thời lượng tối thiểu
        if session_duration >= min_duration_for_count:
            self.live += 1
            print(f"[Livestream Rule] Đủ thời lượng {session_duration} giờ → live += 1 (tổng: {self.live})")
            
            # Tính phụ cấp
            self.tong_phu_cap_livestream += allowance_per_session
            print(f"[Livestream Rule] Phụ cấp livestream {allowance_per_session:,} VNĐ → tong_phu_cap_livestream += {allowance_per_session:,} (tổng: {self.tong_phu_cap_livestream:,})")
            
            # Kiểm tra giới hạn số buổi mỗi tháng
            if self.live > max_sessions_per_month:
                print(f"[Livestream Rule] Cảnh báo: Đã vượt quá giới hạn {max_sessions_per_month} buổi livestream/tháng")
        else:
            print(f"[Livestream Rule] Không đủ thời lượng: {session_duration} giờ < {min_duration_for_count} giờ")

    # ------------------------------------------------------------------
    # EXPLANATION_RULE handler
    # ------------------------------------------------------------------
    def apply_explanation_rule(self, event: Event, rule: dict):
        """
        Áp dụng rule giải trình chấm công.
        
        Xử lý:
          - Xử lý đơn giải trình cho vi phạm chấm công
          - Giảm/loại bỏ phạt nếu giải trình được chấp nhận
        """
        if event.event_type != "explanation":
            return
        
        conditions = rule.get("conditions", {})
        
        # Lấy thông tin từ event
        explanation_type = event.data.get("explanation_type", "")
        status = event.data.get("status", "")  # PENDING, APPROVED, REJECTED
        original_penalty = event.data.get("original_penalty", 0)
        date = event.data.get("date", "")
        reason = event.data.get("reason", "")
        
        print(f"[Explanation Rule] Xử lý giải trình: {explanation_type} - {status} - {date}")
        
        # Lấy cấu hình từ rule
        max_explanations_per_month = conditions.get("max_explanations_per_month", 3)
        penalty_reduction_rate = conditions.get("penalty_reduction_rate", 0.5)  # 50% giảm phạt
        allowed_types = conditions.get("allowed_types", ["FORGOT", "INCOMPLETE_ATTENDANCE", "LATE", "EARLY_LEAVE"])
        
        # Kiểm tra loại giải trình có được phép không
        if explanation_type not in allowed_types:
            print(f"[Explanation Rule] Loại giải trình {explanation_type} không được phép")
            return
        
        # Kiểm tra giới hạn số lần giải trình mỗi tháng
        if self.explanation_quota_used >= max_explanations_per_month:
            print(f"[Explanation Rule] Đã vượt quá giới hạn {max_explanations_per_month} lần giải trình/tháng")
            return
        
        # Xử lý theo trạng thái
        if status == "APPROVED":
            self.giai_trinh_cham_cong += 1
            self.explanation_quota_used += 1
            
            print(f"[Explanation Rule] Giải trình được chấp nhận → giai_trinh_cham_cong += 1 (tổng: {self.giai_trinh_cham_cong})")
            print(f"[Explanation Rule] Đã sử dụng {self.explanation_quota_used}/{max_explanations_per_month} quota giải trình tháng")
            
            # Giảm phạt nếu có
            if original_penalty > 0:
                reduced_penalty = int(original_penalty * penalty_reduction_rate)
                self.tong_phat -= reduced_penalty
                print(f"[Explanation Rule] Giảm {reduced_penalty:,} VNĐ phạt → tong_phat -= {reduced_penalty:,} (tổng: {self.tong_phat:,})")
                
                # Giảm số lần vi phạm nếu giải trình cho đi muộn/về sớm
                if explanation_type in ["LATE", "EARLY_LEAVE"] and self.di_muon_ve_som > 0:
                    self.di_muon_ve_som -= 1
                    print(f"[Explanation Rule] Giảm 1 lần vi phạm đi muộn/về sớm → di_muon_ve_som -= 1 (tổng: {self.di_muon_ve_som})")
        
        elif status == "REJECTED":
            print(f"[Explanation Rule] Giải trình bị từ chối")
        
        else:  # PENDING
            print(f"[Explanation Rule] Giải trình đang chờ xử lý")



# Shift config helpers are in shift_config_utils.py
from .shift_config_utils import (
    load_shift_configs_for_employee as _load_shift_configs_for_employee,
    shift_configs_to_rules as _shift_configs_to_rules,
    find_matching_shift as _find_matching_shift,
    get_registered_shift_configs_for_date as _get_registered_shift_configs_for_date,
    get_all_candidate_shifts_for_employee as _get_all_candidate_shifts_for_employee,
    detect_best_matching_shift as _detect_best_matching_shift,
    _SHIFT_TYPE_TO_RULE_TYPE as _AUTO_SHIFT_TYPE_TO_RULE_TYPE,
)
