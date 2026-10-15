"""
hrm/shift_config_utils.py
─────────────────────────
Utility helpers for integrating ShiftConfig into the attendance engine.

Used by:
  • EmployeeState.replay_month()  (main_api.py)
  • AttendanceCalendarView.get()  (attendance_views.py)
"""

from datetime import datetime


# Mapping shift_type → rule_type for the rule engine
_SHIFT_TYPE_TO_RULE_TYPE = {
    'MORNING':   'SHIFT_RULE_MORNING',
    'AFTERNOON': 'SHIFT_RULE_AFTERNOON',
    'EVENING':   'SHIFT_RULE_AFTERNOON',
    'NIGHT':     'SHIFT_RULE_AFTERNOON',
    'FLEXIBLE':  'SHIFT_RULE_MORNING',
    'OTHER':     'SHIFT_RULE_MORNING',
}

# Shifts with working_hours above this threshold are treated as full-day (workday=1.0)
_FULL_DAY_HOURS_THRESHOLD = 5.5


def _employee_on_date(employee_code: str, ref_date, _cache: dict = None):
    """(employee như vào ngày ref_date, id ca cá nhân vào ngày đó hoặc None = ca cá
    nhân hiện tại) theo lịch sử điều chuyển (employee/assignment.py) — chuyển phòng
    ban/vị trí/ca không đổi ca của các ngày trước đó. (None, None) nếu không có NV.

    Employee + lịch sử điều chuyển chỉ query 1 lần mỗi `_cache` (nếu có)."""
    from employee.models import Employee as EmpModel
    from employee.assignment import AssignmentResolver

    emp_key = ('__employee__', employee_code)
    if _cache is not None and emp_key in _cache:
        employee = _cache[emp_key]
    else:
        employee = EmpModel.objects.filter(employee_id=employee_code).first()
        if _cache is not None:
            _cache[emp_key] = employee
    if employee is None:
        return None, None

    if _cache is not None:
        assignment = _cache.setdefault('__assignment__', AssignmentResolver())
    else:
        assignment = AssignmentResolver()
    return assignment.employee_on(employee, ref_date), assignment.personal_shift_ids(employee, ref_date)


def _scope_key(employee, personal_ids):
    return (
        employee.pk, employee.department_id, employee.position_id,
        None if personal_ids is None else tuple(sorted(personal_ids)),
    )


def load_shift_configs_for_employee(employee_code: str, ref_date, _cache: dict = None) -> list:
    """
    Load ShiftConfig records applicable to an employee on ref_date.

    Priority (highest first):
      1. Employee-specific shifts
      2. Position shifts  (fills shift_types not covered at level 1)
      3. Department shifts (fills shift_types not covered at levels 1–2)
      4. Company-wide defaults (apply_to_all / is_default) – fallback only when
         levels 1–3 yield nothing at all.

    Deduplication by rule_type: AFTERNOON, EVENING, and NIGHT all map to
    SHIFT_RULE_AFTERNOON; MORNING, FLEXIBLE, and OTHER all map to
    SHIFT_RULE_MORNING.  If the employee already has a shift that covers
    SHIFT_RULE_MORNING, position/department shifts for MORNING, FLEXIBLE, and
    OTHER are all ignored.  If the employee is missing a SHIFT_RULE_AFTERNOON
    slot, the first AFTERNOON/EVENING/NIGHT shift from position (level 2) or
    department (level 3) is used.

    The returned list is ordered by start_time.

    `_cache`: dict tuỳ chọn do CALLER tạo mới (rỗng) cho MỖI lượt gọi liên tiếp
    cùng employee_code với các ref_date khác nhau — y hệt pattern đã có ở
    get_all_candidate_shifts_for_employee(). Phần Employee + scope ShiftConfig
    theo từng CẤP (cá nhân/vị trí/phòng ban/mặc định) không đổi giữa các ngày
    nên chỉ query 1 lần; riêng phần lọc effective_from/effective_to phụ thuộc
    ref_date thì lọc bằng Python trên list đã cache. Nhờ vậy engine tính công
    gọi được hàm này 1 lần/NGÀY (thay vì 1 lần/tháng) mà không sinh N+1 query.
    Không truyền _cache (None) -> giữ NGUYÊN hành vi cũ (luôn query mới).
    """
    from .models import ShiftConfig

    # Phòng ban/vị trí/ca cá nhân VÀO NGÀY ref_date (lịch sử điều chuyển).
    employee, personal_ids = _employee_on_date(employee_code, ref_date, _cache)
    if employee is None:
        return []
    key = ('levels',) + _scope_key(employee, personal_ids)
    if _cache is not None and key in _cache:
        cached = _cache[key]
    else:
        # KHÔNG lọc effective_from/effective_to ở đây -> tái dùng được cho
        # mọi ref_date; giữ nguyên thứ tự ưu tiên bằng cách cache RIÊNG
        # từng cấp đúng như 4 lời gọi _add() bên dưới.
        base = ShiftConfig.objects.filter(is_active=True)
        cached = (
            list(base.filter(id__in=personal_ids) if personal_ids is not None
                 else base.filter(apply_to_employees=employee.pk)),
            list(base.filter(apply_to_positions=employee.position_id)) if employee.position_id else [],
            list(base.filter(apply_to_departments=employee.department_id)) if employee.department_id else [],
            list(base.filter(is_default=True)),
        )
        if _cache is not None:
            _cache[key] = cached

    def _active_on(sc):
        if sc.effective_from > ref_date:
            return False
        if sc.effective_to is not None and sc.effective_to < ref_date:
            return False
        return True

    seen_rule_types: set[str] = set()
    result: list = []  # list[ShiftConfig] – import is deferred, cannot use as annotation

    def _add(queryset):
        """Add shifts whose mapped rule_type has not yet been seen (dedup by rule_type).

        AFTERNOON, EVENING and NIGHT all map to SHIFT_RULE_AFTERNOON; MORNING,
        FLEXIBLE and OTHER all map to SHIFT_RULE_MORNING.  Deduplicating by
        rule_type ensures that only the highest-priority shift survives for each
        logical slot (morning / afternoon), regardless of the raw shift_type.

        Bỏ qua HẲN các ca detection_only=True — chúng KHÔNG BAO GIỜ được phép
        trở thành ca mặc định, dù được gán ở cấp nào (cá nhân/vị trí/phòng
        ban) và dù không có ca nào khác cạnh tranh cùng cấp. Chúng vẫn còn
        nguyên trong get_all_candidate_shifts_for_employee() (không lọc gì) để
        tính năng "tự động nhận diện ca" xét riêng cho từng ngày.

        Sự cố thực tế (2026-09-17, CSKH Miền Bắc rồi Kinh Doanh 1): ca "Ca
        kinh doanh" (13:00-21:00, dài) được gán thêm vào 1 vị trí/phòng ban
        CHƯA có sẵn ca ngắn cạnh tranh ở ĐÚNG CÙNG CẤP (vd phòng đó vốn dùng
        ca mặc định công ty ở cấp 4, hoặc ca vị trí ở cấp 2 — không phải cấp
        3) — nó tự động "thắng" thành ca mặc định NGAY LẬP TỨC vì không có
        gì để so sánh ở cấp đó cả, khiến mọi nhân viên đi làm giờ hành chính
        bình thường ở nơi đó bị tính thiếu công. Chỉ so sánh working_hours
        trong CÙNG 1 lần gọi _add() (tie-break start_time) là KHÔNG ĐỦ vì nó
        chỉ xử lý được trường hợp 2 ca cùng cấp — cờ detection_only xử lý
        đúng gốc: ca kinh doanh an toàn để gán vào BẤT KỲ vị trí/phòng ban
        nào mà không cần phòng đó có sẵn ca ngắn nào để "đấu" cùng cấp.
        """
        for sc in sorted(queryset, key=lambda sc: (sc.start_time, sc.working_hours)):
            if sc.detection_only:
                continue
            rule_type = _SHIFT_TYPE_TO_RULE_TYPE.get(sc.shift_type, 'SHIFT_RULE_MORNING')
            if rule_type not in seen_rule_types:
                seen_rule_types.add(rule_type)
                result.append(sc)

    lv_emp, lv_pos, lv_dept, lv_default = cached

    # Level 1: personal (highest priority)
    _add([sc for sc in lv_emp if _active_on(sc)])

    # Level 2: position (fills shift types not covered at level 1)
    _add([sc for sc in lv_pos if _active_on(sc)])

    # Level 3: department (fills shift types not covered at levels 1–2)
    _add([sc for sc in lv_dept if _active_on(sc)])

    # Level 4: company-wide defaults — fills any rule_type slot STILL missing
    # after levels 1–3, instead of only kicking in when `result` is
    # COMPLETELY empty. Trước đây 1 nhân viên có ca cá nhân/vị trí/phòng ban
    # CHỈ che được 1 nửa ngày (vd chỉ có ca sáng riêng, không có ca chiều nào
    # ở bất kỳ cấp nào) sẽ bị MẤT HẲN nửa ngày còn lại thay vì tự bù đúng ca
    # mặc định công ty cho phần còn thiếu — vì toàn bộ fallback bị bỏ qua chỉ
    # vì result đã có 1 phần tử. Gọi _add() y hệt các cấp trên (đã tự bỏ qua
    # rule_type nào đã được cấp cao hơn cung cấp) nên không ảnh hưởng khi
    # levels 1–3 đã che đủ cả 2 nửa ngày.
    _add([sc for sc in lv_default if _active_on(sc)])

    return sorted(result, key=lambda sc: sc.start_time)


def get_all_candidate_shifts_for_employee(employee_code: str, ref_date, _cache: dict = None) -> list:
    """
    Giống load_shift_configs_for_employee() nhưng KHÔNG dedup theo rule_type —
    trả về TẤT CẢ ShiftConfig áp dụng cho nhân viên (cấp cá nhân, vị trí, phòng
    ban), kể cả khi 2+ ca cùng map vào 1 rule_type (vd: 2 ca cùng AFTERNOON).

    Dùng cho tính năng "tự động nhận diện ca thực tế theo giờ checkin/checkout"
    (xem detect_best_matching_shift()): nhân viên có thể được gán sẵn 1 ca mặc
    định (vd: ca hành chính 13:00-17:30) VÀ 1 ca mở rộng (vd: ca kinh doanh
    13:00-21:00) cùng lúc — load_shift_configs_for_employee() sẽ dedup mất 1
    trong 2 (chỉ giữ ca ưu tiên cao nhất), khiến ca còn lại không bao giờ được
    xét tới dù giờ chấm công thực tế khớp đúng ca đó.

    Phạm vi áp dụng do người cấu hình ShiftConfig.apply_to_employees /
    apply_to_positions / apply_to_departments quyết định — không hardcode
    phòng ban/vị trí nào ở đây.

    `_cache`: dict tuỳ chọn do CALLER tạo mới (rỗng) cho MỖI lượt gọi liên
    tiếp cùng employee_code với các ref_date khác nhau (vd: EmployeeState
    replay 1 tháng gọi hàm này 1 lần/ngày attendance cho ĐÚNG 1 nhân viên) —
    tránh N+1 thật đã gây trang Phê duyệt load treo (2026-09-16): trước đây
    mỗi lần gọi query lại Employee + toàn bộ scope ShiftConfig dù 2 phần này
    không đổi giữa các ngày trong cùng 1 lượt, chỉ có phần lọc effective_from/
    effective_to là phụ thuộc ref_date -> giờ tách phần đó ra lọc bằng Python
    trên list đã cache, thay vì query lại DB. Không truyền _cache (None) ->
    giữ NGUYÊN hành vi cũ (luôn query mới) cho các lời gọi lẻ tẻ khác chưa
    cần tối ưu này (vd main_api.py dùng cho calendar-view).
    """
    from .models import ShiftConfig
    from django.db.models import Q

    # Phòng ban/vị trí/ca cá nhân VÀO NGÀY ref_date (lịch sử điều chuyển).
    employee, personal_ids = _employee_on_date(employee_code, ref_date, _cache)
    if employee is None:
        return []
    key = ('candidates',) + _scope_key(employee, personal_ids)
    if _cache is not None and key in _cache:
        cached = _cache[key]
    else:
        scope_q = Q(id__in=personal_ids) if personal_ids is not None else Q(apply_to_employees=employee.pk)
        if employee.position_id:
            scope_q |= Q(apply_to_positions=employee.position_id)
        if employee.department_id:
            scope_q |= Q(apply_to_departments=employee.department_id)
        # Không lọc effective_from/effective_to ở đây -> tái dùng được cho
        # MỌI ref_date của cùng nhân viên; lọc theo ngày làm ở Python bên dưới.
        scoped = list(ShiftConfig.objects.filter(is_active=True).filter(scope_q).distinct())
        default_fallback = list(ShiftConfig.objects.filter(is_active=True, is_default=True))
        cached = (scoped, default_fallback)
        if _cache is not None:
            _cache[key] = cached

    scoped, default_fallback = cached

    def _active_on(sc):
        # Giữ đúng semantics SQL gốc: effective_from luôn có giá trị (not null)
        # -> effective_from__lte=ref_date; effective_to nullable -> isnull HOẶC >= ref_date.
        if sc.effective_from > ref_date:
            return False
        if sc.effective_to is not None and sc.effective_to < ref_date:
            return False
        return True

    result = sorted((sc for sc in scoped if _active_on(sc)), key=lambda sc: sc.start_time)
    if result:
        return result

    # Không có ca nào gán riêng/theo vị trí/phòng ban -> fallback ca mặc định công ty
    return sorted((sc for sc in default_fallback if _active_on(sc)), key=lambda sc: sc.start_time)


def detect_best_matching_shift(shift_configs: list, check_in_str: str, check_out_str: str,
                                tolerance_minutes: int = 60,
                                current_rules_by_type: dict = None,
                                min_improvement_minutes: int = 20):
    """
    Tìm ShiftConfig khớp NHẤT với giờ checkin/checkout thực tế, trong 1
    khoảng dung sai (mặc định ±60 phút) cho CẢ 2 đầu ca (start_time lẫn
    end_time) — chặt hơn find_matching_shift() (vốn chỉ cần overlap khoảng,
    dễ khớp nhầm 1 ca chỉ trùng 1 phần rất nhỏ).

    Trả về None nếu thiếu check_in/check_out, hoặc không có ca nào khớp cả 2
    đầu trong khoảng dung sai — khi đó nơi gọi phải giữ nguyên hành vi cũ
    (fallback cascade ca cố định), không suy diễn thêm.

    Nếu có nhiều ca cùng khớp trong dung sai, chọn ca có tổng độ lệch
    (|lệch start| + |lệch end|) nhỏ nhất.

    `current_rules_by_type` (tuỳ chọn): dict {rule_type: (start, end)} — giờ
    của ca ĐANG ĐƯỢC DÙNG làm mặc định cho nhân viên ở từng loại (SHIFT_RULE_
    MORNING/AFTERNOON), vd ca cá nhân CA_SANG_8h30. Khi truyền vào, 1 ứng
    viên chỉ được chọn thay ca mặc định CÙNG LOẠI của nó nếu độ lệch thấp hơn
    độ lệch của ca mặc định đó ít nhất `min_improvement_minutes` phút — ứng
    viên không có current tương ứng (rule_type đó chưa có ca mặc định nào)
    thì không bị áp margin, xét như trước.

    Lý do cần margin này (bug thực tế 2026-09-16): 1 NV có ca cá nhân riêng
    (vd 8h30-12h00) nhưng phòng ban ANH/CHỊ ẤY cũng thuộc lại có 1 ca khác gần
    giống hệt (vd 8h00-12h00, chỉ lệch 30 phút) — hôm nào NV checkout đúng lúc
    12h00/12h01 (thường là ngày nửa công, vd thứ 7 tuần 2/4), độ lệch của ca
    phòng ban (14+1=15') vô tình NHỎ HƠN ca cá nhân (16+1=17') chỉ đúng 2
    phút — khiến hệ thống ÂM THẦM đổi sang tính công theo ca phòng ban 8h00,
    biến 1 lần đi làm lúc 8h14 (vốn sớm hơn ca cá nhân 8h30) thành "đi muộn 14
    phút" so với ca 8h00 không phải của họ. Không có margin này, BẤT KỲ 2 ca
    nào cách nhau vài phút và cùng lọt dung sai đều có thể đổi qua lại ngẫu
    nhiên giữa các ngày chỉ vì chênh lệch vài phút trong giờ chấm công thực
    tế — hoàn toàn không phải NV "thực sự làm ca khác" như mục đích ban đầu
    của tính năng này (vd checkin 13h/checkout 21h so với ca mặc định
    13h-17h30, lệch hàng trăm phút — margin 20' không ảnh hưởng trường hợp
    này vì chênh lệch quá lớn).
    """
    def _pt(t: str):
        if not t:
            return None
        for fmt in ('%H:%M:%S', '%H:%M'):
            try:
                return datetime.strptime(str(t), fmt).time()
            except ValueError:
                continue
        return None

    check_in = _pt(check_in_str)
    check_out = _pt(check_out_str)
    if not check_in or not check_out:
        return None

    def _minutes(t):
        return t.hour * 60 + t.minute

    ci_min = _minutes(check_in)
    co_min = _minutes(check_out)

    def _current_deviation_for(sc):
        if not current_rules_by_type:
            return None
        rule_type = _SHIFT_TYPE_TO_RULE_TYPE.get(sc.shift_type, 'SHIFT_RULE_MORNING')
        current = current_rules_by_type.get(rule_type)
        if not current:
            return None
        current_start, current_end = current
        current_start_t = _pt(current_start) if isinstance(current_start, str) else current_start
        current_end_t = _pt(current_end) if isinstance(current_end, str) else current_end
        if not current_start_t or not current_end_t:
            return None
        return abs(_minutes(current_start_t) - ci_min) + abs(_minutes(current_end_t) - co_min)

    best = None
    best_deviation = None
    for sc in shift_configs:
        start_diff = abs(_minutes(sc.start_time) - ci_min)
        end_diff = abs(_minutes(sc.end_time) - co_min)
        if start_diff > tolerance_minutes or end_diff > tolerance_minutes:
            continue
        deviation = start_diff + end_diff

        current_deviation = _current_deviation_for(sc)
        if current_deviation is not None and deviation > current_deviation - min_improvement_minutes:
            # Không lệch RÕ RỆT hơn ca mặc định hiện có CHO ĐÚNG LOẠI CA này
            # (sáng/chiều) -> bỏ qua ứng viên này, tránh đổi ca chỉ vì vài
            # phút trùng hợp ngẫu nhiên.
            continue

        if best is None or deviation < best_deviation:
            best = sc
            best_deviation = deviation

    return best


def shift_configs_to_rules(shift_configs: list) -> list:
    """
    Convert ShiftConfig objects to synthetic rule dicts compatible with
    EmployeeState.rules.  Used when no SHIFT_RULE entries exist in
    RuleDefinition so the engine still honours the configured schedule.

    workday is derived from working_hours:
      - half-day shifts (≤ 5.5 h) → 0.5
      - full-day shifts (> 5.5 h)  → 1.0
    """
    rules = []
    for sc in shift_configs:
        rule_type = _SHIFT_TYPE_TO_RULE_TYPE.get(sc.shift_type, 'SHIFT_RULE_MORNING')
        hours = float(sc.working_hours or 0)
        workday = 1.0 if hours > _FULL_DAY_HOURS_THRESHOLD else 0.5
        rules.append({
            'rule_name': f'ShiftConfig: {sc.name}',
            'rule_type': rule_type,
            'conditions': {
                'start_time': str(sc.start_time)[:8],
                'end_time':   str(sc.end_time)[:8],
                'workday':    workday,
            },
            'priority': 50,
        })
    return rules


def find_matching_shift(shift_configs: list, check_in_str: str, check_out_str: str):
    """
    Find the best-matching ShiftConfig for a given check_in / check_out pair.

    Matching rules:
      • Both times present: shift window [start, end) must overlap [check_in, check_out)
      • Only check_in: start <= check_in < end  (inclusive start, exclusive end)
      • Only check_out: start < check_out <= end (exclusive start, inclusive end)
      • Neither time: first shift is returned as fallback

    Returns the first matching ShiftConfig, or the first element if no match found.
    """
    def _pt(t: str):
        if not t:
            return None
        for fmt in ('%H:%M:%S', '%H:%M'):
            try:
                return datetime.strptime(str(t), fmt).time()
            except ValueError:
                continue
        return None

    check_in  = _pt(check_in_str)
    check_out = _pt(check_out_str)

    if not check_in and not check_out:
        return shift_configs[0] if shift_configs else None

    for sc in shift_configs:
        s = sc.start_time
        e = sc.end_time
        if check_in and check_out:
            if check_in < e and check_out > s:
                return sc
        elif check_in:
            if s <= check_in < e:
                return sc
        elif check_out:
            if s < check_out <= e:
                return sc

    # Fallback: return first shift when no window matches
    return shift_configs[0] if shift_configs else None


def get_registered_shift_configs_for_date(employee, target_date, _scope_cache: dict = None):
    """
    Các ShiftConfig đã ĐĂNG KÝ (tính năng "Đăng ký ca làm") cho nhân viên vào
    1 ngày cụ thể — chỉ có giá trị nếu nhân viên đang thuộc phạm vi cấu hình
    ShiftRegistrationScopeConfig. Đây là bước ưu tiên TUYỆT ĐỐI, được kiểm tra
    TRƯỚC cascade employee > position > department > default ở trên, để đảm
    bảo:
      • Nhân viên thuộc phạm vi: công tính đúng theo ca đã đăng ký/đổi ca.
      • Nhân viên KHÔNG thuộc phạm vi: hàm này luôn trả về None ngay từ đầu,
        tuyệt đối không đụng tới cascade ca cố định hiện có (yêu cầu #5).

    Mỗi "ca" (Ca 1/Ca 2) là 1 CẶP (ca sáng, ca chiều) — không phải 1
    ShiftConfig duy nhất cho cả ngày (xem shift_registration_models.py) — nên
    hàm này trả về LIST tối đa 2 phần tử để tái sử dụng thẳng
    find_matching_shift() y hệt cascade ca cố định (đã hỗ trợ sẵn khớp theo
    danh sách nhiều ShiftConfig).

    Trả về:
      - [ca_sáng, ca_chiều] (bỏ None) nếu ngày đó có đăng ký đi làm (Ca 1/Ca 2).
      - []   nếu ngày đó đăng ký NGHỈ (ca_choice=null) — không nên gán ca nào.
      - None nếu nhân viên ngoài phạm vi, hoặc trong phạm vi nhưng chưa đăng
             ký gì cho ngày này (fallback cascade cũ áp dụng bình thường).

    `_scope_cache`: dict tuỳ chọn (do caller tạo mới mỗi lượt gọi liên tiếp
    cùng 1 nhân viên, vd EmployeeState.replay_month() gọi hàm này 1 lần/ngày
    chấm công trong tháng) để khỏi tính lại ShiftRegistrationScopeConfig.
    for_employee() mỗi ngày — hàm đó tự query kiểm tra phạm vi (phòng ban/
    vị trí/bác sĩ phụ trách) tốn vài query mỗi lần, trong khi kết quả không
    đổi trong cùng 1 lượt (phát hiện 2026-09-16: N+1 y hệt lỗi đã fix ở
    get_all_candidate_shifts_for_employee, cùng góp phần gây trang Phê
    duyệt chậm). Không truyền -> giữ nguyên hành vi cũ (luôn tính lại).
    """
    if not employee:
        return None

    from .shift_registration_models import ShiftRegistrationScopeConfig, ShiftRegistrationDay
    from employee.assignment import AssignmentResolver

    # Phạm vi đăng ký ca xét theo phòng ban/vị trí/Team bác sĩ VÀO NGÀY target_date
    # (lịch sử điều chuyển) — chuyển ra khỏi nhóm đăng ký ca không làm mất ca đã
    # đăng ký của các ngày trước đó.
    if _scope_cache is not None:
        assignment = _scope_cache.setdefault('__assignment__', AssignmentResolver())
    else:
        assignment = AssignmentResolver()
    scoped_employee = assignment.employee_on(employee, target_date)

    if _scope_cache is not None:
        cache_key = (
            employee.id, scoped_employee.department_id, scoped_employee.position_id,
            scoped_employee.doctor_team,
        )
        if cache_key in _scope_cache:
            config = _scope_cache[cache_key]
        else:
            config = ShiftRegistrationScopeConfig.for_employee(scoped_employee)
            _scope_cache[cache_key] = config
    else:
        config = ShiftRegistrationScopeConfig.for_employee(scoped_employee)

    if not config:
        return None

    day = ShiftRegistrationDay.objects.filter(
        registration__employee=employee,
        date=target_date,
    ).select_related('morning_shift', 'afternoon_shift').first()

    # Mô hình "mặc định Ca 1, chỉ đăng ký NGOẠI LỆ Ca 2 cần duyệt"
    # (config.requires_manager_approval=True — vd 8 Điều dưỡng BS Ma Doãn
    # Dương): không có đăng ký nào cho ngày này, HOẶC có nhưng chưa được
    # quản lý trực tiếp duyệt (PENDING/REJECTED/quá hạn chưa duyệt kịp) =>
    # luôn áp dụng Ca 1 mặc định, KHÔNG rơi về cascade ca cố định (vốn không
    # có ý nghĩa cho nhóm này — xem ShiftConfig của Ca 1/Ca 2 chỉ được gán
    # qua ShiftRegistrationScopeConfig, không qua apply_to_departments/
    # positions/employees). Các scope khác (requires_manager_approval=False,
    # vd AI/IT) giữ NGUYÊN hành vi cũ tuyệt đối — status luôn mặc định
    # 'APPROVED' cho các bản ghi thuộc scope đó nên nhánh dưới không ảnh hưởng.
    if day is None or day.status != ShiftRegistrationDay.Status.APPROVED:
        if config.requires_manager_approval:
            return [sc for sc in config.ca_pair(1) if sc]
        return None

    if day.ca_choice is None:
        return []
    return sorted(
        (sc for sc in (day.morning_shift, day.afternoon_shift) if sc),
        key=lambda sc: sc.start_time,
    )


def lone_punch_is_checkout(employee, target_date, punch, _shift_cache: dict = None,
                           _reg_cache: dict = None, _cand_cache: dict = None) -> bool:
    """Ngày chỉ có ĐÚNG 1 lần chấm: đó là giờ RA hay giờ VÀO?

    File xuất từ máy/hệ thống chấm công luôn xếp lần chấm đầu tiên của ngày vào
    cột "Vào", bất kể mấy giờ — nên nhân viên quên chấm lúc đến, chỉ chấm lúc về
    (vd 17:04) bị lưu thành giờ VÀO 17:04, đơn quên chấm công hiện "Giờ ra --:--"
    và cả 2 buổi trên lịch hiện "Vắng mặt" dù đủ công (tháng 9/2026: 113 ngày,
    86 nhân viên).

    So lần chấm với giờ VÀO ca và giờ TAN ca thật của chính nhân viên ngày đó
    (ca đã đăng ký trước, rồi ca cố định theo đúng ngày), cộng thêm các ca thay
    thế chỉ dùng để tự nhận diện (detection_only, vd ca kinh doanh 13:00-21:00)
    để người chấm lúc 13:00 vẫn là giờ vào. Gần giờ tan ca hơn -> giờ ra.
    Không tra được ca nào thì dùng khung hành chính 08:00-17:30.
    """
    import datetime as _d

    def _mins(t):
        return t.hour * 60 + t.minute

    day_shifts = None
    try:
        day_shifts = get_registered_shift_configs_for_date(employee, target_date, _reg_cache)
    except Exception:
        day_shifts = None
    if not day_shifts:
        day_shifts = load_shift_configs_for_employee(employee.employee_id, target_date, _shift_cache)

    # THẬN TRỌNG: "giờ vào" gồm giờ bắt đầu của TỪNG buổi (sáng VÀ chiều), còn
    # "giờ ra" chỉ là giờ tan ca cuối ngày. Nhờ vậy lần chấm giữa ngày (vd
    # 13:00 của người nghỉ sáng, đi làm chiều) vẫn là giờ VÀO — chỉ những lần
    # chấm thật sự sát giờ tan ca mới bị chuyển. Tháng 9/2026: 82 lần chấm
    # trước 09:00, 111 lần từ 16:00, chỉ 15 lần ở vùng giữa 09:00-16:00; vùng
    # giữa giữ nguyên như trước khi có hàm này (không tạo lỗi mới).
    starts, ends = [], []
    if day_shifts:
        starts.extend(sc.start_time for sc in day_shifts)
        ends.append(max(sc.end_time for sc in day_shifts))
    try:
        for sc in get_all_candidate_shifts_for_employee(employee.employee_id, target_date, _cand_cache):
            if sc.detection_only and sc.end_time > sc.start_time:
                starts.append(sc.start_time)
                ends.append(sc.end_time)
    except Exception:
        pass
    if not starts:
        starts, ends = [_d.time(8, 0)], [_d.time(17, 30)]

    p = _mins(punch)
    return min(abs(p - _mins(e)) for e in ends) < min(abs(p - _mins(s)) for s in starts)
