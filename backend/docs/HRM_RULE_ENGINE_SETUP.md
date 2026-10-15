# HRM Rule Engine – Hướng dẫn cấu hình & Tuỳ chỉnh

> Tài liệu hướng dẫn thực hành cấu hình rule engine cho công ty.
> Xem thêm tài liệu kỹ thuật tại [HRM_RULE_ENGINE_REFERENCE.md](./HRM_RULE_ENGINE_REFERENCE.md).

---

## Mục lục

1. [Quy trình cấu hình nhanh](#1-quy-trình-cấu-hình-nhanh)
2. [Cấu hình qua Django Admin](#2-cấu-hình-qua-django-admin)
3. [Cấu hình qua Python shell / script](#3-cấu-hình-qua-python-shell--script)
4. [Ví dụ cấu hình hoàn chỉnh cho công ty](#4-ví-dụ-cấu-hình-hoàn-chỉnh-cho-công-ty)
5. [Tuỳ chỉnh theo phòng ban, nhóm, cá nhân](#5-tuỳ-chỉnh-theo-phòng-ban-nhóm-cá-nhân)
6. [Quản lý hiệu lực rule theo thời gian](#6-quản-lý-hiệu-lực-rule-theo-thời-gian)
7. [Cấu hình bảng phạt (PenaltyTierConfig)](#7-cấu-hình-bảng-phạt-penaltytierconfig)
8. [Kiểm tra và debug rule](#8-kiểm-tra-và-debug-rule)
9. [Replay tháng và đọc kết quả](#9-replay-tháng-và-đọc-kết-quả)

---

## 1. Quy trình cấu hình nhanh

```
1. Tạo các RuleDefinition cho toàn công ty (scope=COMPANY)
   ↓
2. Override cho phòng ban có ca riêng (scope=DEPARTMENT)
   ↓
3. Override cho nhóm đặc biệt như Quản lý (scope=GROUP)
   ↓
4. Override cá nhân nếu cần (scope=INDIVIDUAL)
   ↓
5. Kiểm tra rule qua shell hoặc API replay_month
```

**Bảng rule tối thiểu cần tạo cho mọi công ty:**

| rule_type | Bắt buộc | Ghi chú |
|-----------|----------|---------|
| `SHIFT_RULE_MORNING` | ✓ | Cần ít nhất 1 rule cho toàn công ty |
| `SHIFT_RULE_AFTERNOON` | ✓ | Cần ít nhất 1 rule cho toàn công ty |
| `LEAVE_RULE_PAID` | ✓ | Chính sách nghỉ phép có lương |
| `LEAVE_RULE_UNPAID` | ✓ | Chính sách nghỉ không lương |
| `OVERTIME_RULE` | Khuyến nghị | Nếu công ty có tăng ca |
| `LIVESTREAM_RULE` | Tuỳ chọn | Chỉ cần nếu có nhân viên livestream |
| `EXPLANATION_RULE` | Khuyến nghị | Quản lý giải trình quên chấm công |

---

## 2. Cấu hình qua Django Admin

### 2.1 Truy cập

```
/admin/hrm/ruledefinition/
```

### 2.2 Tạo rule mới

1. Click **"Thêm Rule definition +"**
2. Điền thông tin:
   - **Rule name**: Tên hiển thị (ví dụ: "Ca sáng hành chính")
   - **Rule type**: Chọn loại rule (xem mục 5 trong [HRM_RULE_ENGINE_REFERENCE.md](./HRM_RULE_ENGINE_REFERENCE.md))
   - **Conditions**: JSON cấu hình – dán theo mẫu trong tài liệu reference
   - **Scope**: `COMPANY` / `DEPARTMENT` / `GROUP` / `INDIVIDUAL`
   - **Identifier**: `ALL` (cho COMPANY), mã phòng ban, mã nhóm, hoặc mã nhân viên
   - **Priority**: 10 cho rule mặc định; 20 cho phòng ban; 30 cho cá nhân
   - **Effective from**: Ngày bắt đầu có hiệu lực
   - **Is active**: Tích chọn
3. Click **Lưu**

### 2.3 Lọc và kiểm tra rule

```
# Tất cả rule đang hoạt động
/admin/hrm/ruledefinition/?is_active__exact=1

# Rule của toàn công ty
/admin/hrm/ruledefinition/?scope__exact=COMPANY

# Rule của một phòng ban cụ thể
/admin/hrm/ruledefinition/?scope__exact=DEPARTMENT
```

---

## 3. Cấu hình qua Python shell / script

### 3.1 Mở shell

```bash
python manage.py shell
```

### 3.2 Tạo rule cơ bản

```python
from django.utils import timezone
from hrm.event_models import RuleDefinition, RuleScope

# Ca sáng toàn công ty
RuleDefinition.objects.create(
    rule_name="Ca sáng hành chính",
    rule_type="SHIFT_RULE_MORNING",
    conditions={
        "start_time": "08:30",
        "end_time":   "12:00",
        "workday":    0.5,
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
    description="Ca sáng mặc định áp dụng toàn công ty",
)

# Ca chiều toàn công ty
RuleDefinition.objects.create(
    rule_name="Ca chiều hành chính",
    rule_type="SHIFT_RULE_AFTERNOON",
    conditions={
        "start_time": "13:00",
        "end_time":   "17:30",
        "workday":    0.5,
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
)
```

### 3.3 Tạo rule nghỉ phép

```python
# Nghỉ phép có lương
RuleDefinition.objects.create(
    rule_name="Nghỉ phép năm",
    rule_type="LEAVE_RULE_PAID",
    conditions={
        "max_days_per_year":  12,
        "requires_approval":  True,
        "workday":            1.0,
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
)

# Nghỉ không lương
RuleDefinition.objects.create(
    rule_name="Nghỉ không lương",
    rule_type="LEAVE_RULE_UNPAID",
    conditions={
        "max_days_per_month": 3,
        "workday":            1.0,
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
)
```

### 3.4 Tạo rule tăng ca và livestream

```python
# Tăng ca
RuleDefinition.objects.create(
    rule_name="Tăng ca tiêu chuẩn",
    rule_type="OVERTIME_RULE",
    conditions={
        "regular_hours_threshold": 8.0,
        "multiplier":              1.5,
        "max_overtime_per_day":    4.0,
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
)

# Livestream
RuleDefinition.objects.create(
    rule_name="Livestream tiêu chuẩn",
    rule_type="LIVESTREAM_RULE",
    conditions={
        "min_duration_for_count":  1.0,
        "allowance_per_session":   100000,
        "max_sessions_per_month":  8,
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
)

# Giải trình chấm công
RuleDefinition.objects.create(
    rule_name="Giải trình chấm công",
    rule_type="EXPLANATION_RULE",
    conditions={
        "max_explanations_per_month": 3,
        "penalty_reduction_rate":     0.5,
        "allowed_types":              ["FORGOT", "LATE", "EARLY_LEAVE"],
    },
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=timezone.now().date(),
    is_active=True,
)
```

---

## 4. Ví dụ cấu hình hoàn chỉnh cho công ty

Dưới đây là script tạo toàn bộ rule mẫu cho một công ty có nhiều phòng ban:

```python
from django.utils import timezone
from hrm.event_models import RuleDefinition, RuleScope

today = timezone.now().date()

RULES_CONFIG = [
    # ══ TOÀN CÔNG TY ════════════════════════════════════════════════════
    ("Ca sáng HC",         "SHIFT_RULE_MORNING",
     {"start_time": "08:30", "end_time": "12:00", "workday": 0.5},
     "COMPANY", "ALL", 10),

    ("Ca chiều HC",        "SHIFT_RULE_AFTERNOON",
     {"start_time": "13:00", "end_time": "17:30", "workday": 0.5},
     "COMPANY", "ALL", 10),

    ("Nghỉ phép năm",      "LEAVE_RULE_PAID",
     {"max_days_per_year": 12, "requires_approval": True, "workday": 1.0},
     "COMPANY", "ALL", 10),

    ("Nghỉ không lương",   "LEAVE_RULE_UNPAID",
     {"max_days_per_month": 3, "workday": 1.0},
     "COMPANY", "ALL", 10),

    ("Tăng ca",            "OVERTIME_RULE",
     {"regular_hours_threshold": 8.0, "multiplier": 1.5, "max_overtime_per_day": 4.0},
     "COMPANY", "ALL", 10),

    ("Livestream",         "LIVESTREAM_RULE",
     {"min_duration_for_count": 1.0, "allowance_per_session": 100000,
      "max_sessions_per_month": 8},
     "COMPANY", "ALL", 10),

    ("Giải trình CC",      "EXPLANATION_RULE",
     {"max_explanations_per_month": 3, "penalty_reduction_rate": 0.5,
      "allowed_types": ["FORGOT", "LATE", "EARLY_LEAVE"]},
     "COMPANY", "ALL", 10),

    # ══ PHÒNG ADS (bắt đầu 09:00) ═══════════════════════════════════════
    ("Ca sáng ADS",        "SHIFT_RULE_MORNING",
     {"start_time": "09:00", "end_time": "12:00", "workday": 0.5},
     "DEPARTMENT", "ADS", 20),

    ("Ca chiều ADS",       "SHIFT_RULE_AFTERNOON",
     {"start_time": "13:00", "end_time": "17:30", "workday": 0.5},
     "DEPARTMENT", "ADS", 20),

    # ══ PHÒNG CSKH MB (08:00 – 17:00) ════════════════════════════════════
    ("Ca sáng CSKH MB",    "SHIFT_RULE_MORNING",
     {"start_time": "08:00", "end_time": "12:00", "workday": 0.5},
     "DEPARTMENT", "CSKH_MB", 20),

    ("Ca chiều CSKH MB",   "SHIFT_RULE_AFTERNOON",
     {"start_time": "13:00", "end_time": "17:00", "workday": 0.5},
     "DEPARTMENT", "CSKH_MB", 20),

    # ══ NHÓM QUẢN LÝ (nghỉ phép nhiều hơn) ══════════════════════════════
    ("Nghỉ phép – Quản lý","LEAVE_RULE_PAID",
     {"max_days_per_year": 15, "requires_approval": False, "workday": 1.0},
     "GROUP", "MANAGERS", 30),
]

created = 0
for rule_name, rule_type, conditions, scope, identifier, priority in RULES_CONFIG:
    obj, was_created = RuleDefinition.objects.get_or_create(
        rule_name=rule_name,
        rule_type=rule_type,
        scope=scope,
        identifier=identifier,
        defaults={
            "conditions":     conditions,
            "priority":       priority,
            "effective_from": today,
            "is_active":      True,
        }
    )
    if was_created:
        created += 1

print(f"Created {created} rules (skipped {len(RULES_CONFIG) - created} existing).")
```

---

## 5. Tuỳ chỉnh theo phòng ban, nhóm, cá nhân

### 5.1 Override ca làm việc cho một phòng ban

```python
from hrm.event_models import RuleDefinition, RuleScope
from django.utils import timezone

# Phòng Kinh doanh – ca chiều kết thúc 21:00
RuleDefinition.objects.create(
    rule_name="Ca chiều Kinh doanh",
    rule_type="SHIFT_RULE_AFTERNOON",
    conditions={"start_time": "13:00", "end_time": "21:00", "workday": 0.5},
    scope=RuleScope.DEPARTMENT,
    identifier="KINH_DOANH",  # khớp với department.code trong employee_info
    priority=20,               # cao hơn rule toàn công ty (priority=10)
    effective_from=timezone.now().date(),
    is_active=True,
)
```

> **Lưu ý:** `identifier` của `DEPARTMENT` phải khớp với giá trị `employee_info["department_id"]`
> được truyền vào `replay_month()` hoặc `init_rules()`.

### 5.2 Override rule cho một nhóm

```python
# Nhóm nhân viên ADS Team được tăng ca nhiều hơn
RuleDefinition.objects.create(
    rule_name="Tăng ca ADS Team",
    rule_type="OVERTIME_RULE",
    conditions={
        "regular_hours_threshold": 8.0,
        "multiplier":              2.0,   # hệ số cao hơn
        "max_overtime_per_day":    6.0,   # cho phép nhiều giờ hơn
    },
    scope=RuleScope.GROUP,
    identifier="ADS_TEAM",  # khớp với employee_info["group_ids"]
    priority=20,
    effective_from=timezone.now().date(),
    is_active=True,
)
```

### 5.3 Override rule cho một nhân viên cụ thể

```python
# Nhân viên NV001 có chế độ đặc biệt
RuleDefinition.objects.create(
    rule_name="Tăng ca đặc biệt NV001",
    rule_type="OVERTIME_RULE",
    conditions={
        "regular_hours_threshold": 7.0,
        "multiplier":              2.5,
        "max_overtime_per_day":    6.0,
    },
    scope=RuleScope.INDIVIDUAL,
    identifier="NV001",  # mã nhân viên
    priority=30,          # luôn thắng mọi rule khác cùng type
    effective_from=timezone.now().date(),
    is_active=True,
)
```

### 5.4 Vô hiệu hoá rule tạm thời

```python
# Tắt toàn bộ rule livestream trong tháng này
RuleDefinition.objects.filter(
    rule_type="LIVESTREAM_RULE",
    is_active=True,
).update(is_active=False)
```

---

## 6. Quản lý hiệu lực rule theo thời gian

### 6.1 Đặt ngày hết hiệu lực

```python
from datetime import date
from hrm.event_models import RuleDefinition

# Rule chỉ áp dụng đến hết Q1 2025
RuleDefinition.objects.filter(
    rule_name="Ca sáng hành chính",
    scope="COMPANY",
    identifier="ALL"
).update(effective_to=date(2025, 3, 31))
```

### 6.2 Tạo rule mới có hiệu lực từ tháng sau

```python
from datetime import date
from hrm.event_models import RuleDefinition, RuleScope

# Rule mới thay thế từ 01/04/2025
RuleDefinition.objects.create(
    rule_name="Ca sáng hành chính (v2)",
    rule_type="SHIFT_RULE_MORNING",
    conditions={"start_time": "08:00", "end_time": "12:00", "workday": 0.5},
    scope=RuleScope.COMPANY,
    identifier="ALL",
    priority=10,
    effective_from=date(2025, 4, 1),
    is_active=True,
    description="Điều chỉnh giờ vào sớm hơn từ Q2 2025",
)
```

### 6.3 Kiểm tra rule nào đang có hiệu lực

```python
from django.utils import timezone
from hrm.event_models import RuleDefinition

today = timezone.now().date()
active_rules = RuleDefinition.objects.filter(
    is_active=True,
    effective_from__lte=today,
).filter(
    effective_to__isnull=True
) | RuleDefinition.objects.filter(
    is_active=True,
    effective_from__lte=today,
    effective_to__gte=today,
)

for rule in active_rules.order_by("rule_type", "-priority"):
    print(f"{rule.rule_type:30s} | {rule.scope:12s} | {rule.identifier:15s} | priority={rule.priority}")
```

---

## 7. Cấu hình bảng phạt (PenaltyTierConfig)

Hiện tại bảng phạt được hardcode trong `EmployeeState._calc_penalty()`. Để cấu hình linh hoạt qua DB, sử dụng `AttendancePolicyVersion` và `PenaltyTierConfig`:

```python
from hrm.attendance_models import AttendancePolicyVersion, PenaltyTierConfig, AttendancePolicyConfig
from datetime import date

# 1. Tạo phiên bản chính sách
version = AttendancePolicyVersion.objects.create(
    version_code="v2025_01",
    name="Chính sách chấm công 2025",
    effective_from=date(2025, 1, 1),
    is_active=True,
)

# 2. Tạo các mức phạt
penalty_tiers = [
    # (order, max_minutes, fine_regular, fine_manager, deduct_work, description)
    (0, 10,   50_000,  70_000,  0,   "≤10 phút"),
    (1, 30,  100_000, 150_000,  0,   "11–30 phút"),
    (2, 60,  120_000, 180_000,  0,   "31–60 phút"),
    (3, 120, 200_000, 300_000,  0,   "61–120 phút"),
    (4, None,      0,       0, 0.5,  ">120 phút – trừ 0.5 công"),
]

for order, max_min, fine_reg, fine_mgr, deduct, desc in penalty_tiers:
    PenaltyTierConfig.objects.create(
        version=version,
        order=order,
        max_minutes=max_min,
        fine_amount_regular=fine_reg,
        fine_amount_manager=fine_mgr,
        deduct_work_credit=deduct,
        description=desc,
    )

# 3. Tạo tham số chính sách
AttendancePolicyConfig.objects.create(
    version=version,
    max_explanation_quota=3,
    penalty_multiplier_threshold=7,
    penalty_multiplier_value=2.0,
    parking_allowance_per_day=5000,
    live_prime_time_allowance=100_000,
    live_prime_start_hour=21,
    live_prime_end_hour=23,
    max_live_prime_time_pct=0.20,
    max_ot_live_pct=0.20,
    incomplete_no_expl_deduction=1.0,
    incomplete_approved_deduction=0.5,
)

print(f"Created policy version: {version.version_code}")
```

---

## 8. Kiểm tra và debug rule

### 8.1 Xem rule nào áp dụng cho một nhân viên

```python
from hrm.main_api import EmployeeState

state = EmployeeState("NV001")
state.init_rules(employee_info={
    "department_id": "MARKETING",
    "group_ids":      ["MANAGERS"],
})

print(f"Loaded {len(state.rules)} rules:")
for rule in state.rules:
    print(f"  [{rule['rule_type']:25s}] priority={rule.get('priority',0):3d} | {rule['rule_name']}")
```

### 8.2 Kiểm tra một event thủ công

```python
from hrm.main_api import EmployeeState
from hrm.event import Event

state = EmployeeState("NV001")
state.init_rules()

# Giả lập sự kiện chấm công
event = Event("attendance", {
    "date":       "2025-01-15",
    "employee_id":"NV001",
    "check_in":   "08:45",
    "check_out":  "12:05",
})
state.add_event(event)

print("State sau event:", state.get_state_summary())
print("Calendar result:", state.calendar_result[-1])
```

### 8.3 Kiểm tra rule match / no-match

```python
# Kiểm tra xem rule có match với event không
match = state._match_rule_for_event(event, rule_dict)
print("Match:", match)

# Tính effect mà không commit vào state
effects = state._evaluate_rule_effect(event, rule_dict)
print("Effects:", effects)
```

---

## 9. Replay tháng và đọc kết quả

### 9.1 Gọi replay

```python
from hrm.main_api import EmployeeState

result = EmployeeState.replay_month(
    employee_code="NV001",
    year=2025,
    month=1,
    employee_info={
        "department_id": "MARKETING",
        "group_ids":      ["MANAGERS"],
    }
)
```

### 9.2 Đọc tổng kết tháng

```python
state = result["state"]
print(f"Tổng ngày công:       {state['tong_ngay_cong']}")
print(f"Đi muộn/về sớm:      {state['di_muon_ve_som']} lần")
print(f"Vắng mặt:             {state['vang_mat']} ngày")
print(f"Quên chấm công:       {state['quen_cham_cong']} lần")
print(f"Tăng ca:              {state['tang_ca']} giờ")
print(f"Livestream:           {state['live']} buổi")
print(f"Nghỉ phép:            {state['nghi_phep']} ngày")
print(f"Tổng phạt:            {state['tong_phat']:,} VNĐ")
print(f"Phụ cấp livestream:   {state['tong_phu_cap_livestream']:,} VNĐ")
```

### 9.3 Đọc chi tiết từng ngày (calendar)

```python
for day in result["calendar"]:
    print(f"[{day['date']}] {day['event_type']:12s} | "
          f"check_in={day['check_in']} check_out={day['check_out']} | "
          f"rules={[r['rule_type'] for r in day['rules_applied']]}")
    print(f"  delta: {day['delta']}")
```

---

**Ngày cập nhật:** 2026-03-02  
**Xem thêm:** [HRM_RULE_ENGINE_REFERENCE.md](./HRM_RULE_ENGINE_REFERENCE.md) – tài liệu kỹ thuật chi tiết về rule types, bảng DB và state fields.
