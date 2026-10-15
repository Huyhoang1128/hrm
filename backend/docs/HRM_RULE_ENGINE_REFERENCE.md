# HRM Rule Engine – Tài liệu kỹ thuật tham khảo

> Tài liệu mô tả chi tiết kiến trúc rule engine trong `hrm/main_api.py`:
> bảng DB, các loại rule với cấu trúc `conditions` JSON, dữ liệu event và state fields.
>
> Xem hướng dẫn cấu hình thực tế tại [HRM_RULE_ENGINE_SETUP.md](./HRM_RULE_ENGINE_SETUP.md).

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Luồng xử lý event → rule → state](#2-luồng-xử-lý-event--rule--state)
3. [Bảng dữ liệu cấu hình](#3-bảng-dữ-liệu-cấu-hình)
4. [Ánh xạ Event → Rule (EVENT_RULE_CATEGORY_MAP)](#4-ánh-xạ-event--rule-event_rule_category_map)
5. [Các loại rule và cấu trúc conditions JSON](#5-các-loại-rule-và-cấu-trúc-conditions-json)
6. [Phạm vi áp dụng (scope & identifier)](#6-phạm-vi-áp-dụng-scope--identifier)
7. [Bảng phạt đi muộn / về sớm](#7-bảng-phạt-đi-muộn--về-sớm)
8. [Dữ liệu event (event.data) – JSON chi tiết](#8-dữ-liệu-event-eventdata--json-chi-tiết)
9. [State fields – ý nghĩa từng trường kết quả](#9-state-fields--ý-nghĩa-từng-trường-kết-quả)

---

## 1. Tổng quan kiến trúc

Hệ thống chấm công HRM sử dụng kiến trúc **Event-based + Rule Engine**:

```
User action
    │
    ▼
EmployeeEvent (DB)
    │
    ▼                 ┌──────────────────────────┐
Event object ──────► │  EmployeeState.add_event  │
                      │  (hrm/main_api.py)        │
                      └──────────┬───────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  apply_rules(event)      │
                    │  1. Match rule           │
                    │  2. Evaluate effect      │
                    │  3. Commit to state      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  EmployeeState fields    │
                    │  (tong_ngay_cong, ...)   │
                    └─────────────────────────┘
```

**Các thành phần chính:**

| File | Vai trò |
|------|---------|
| `hrm/main_api.py` | `EmployeeState` – class trung tâm điều phối rule |
| `hrm/event_models.py` | Model DB: `RuleDefinition`, `EmployeeEvent`, `RuleExecutionLog` |
| `hrm/attendance_models.py` | Model DB: `AttendancePolicyVersion`, `PenaltyTierConfig`, `AttendancePolicyConfig` |
| `hrm/constant.py` | `EVENT_RULE_CATEGORY_MAP` – ánh xạ event → rule type |
| `rule/rules.py` | `RuleRegistry`, `RuleDefinition`, `RuleTarget` (in-memory, dùng cho testing) |
| `hrm/event.py` | `Event` – value object đơn giản |

---

## 2. Luồng xử lý event → rule → state

```
add_event(event)
    │
    ├─ init_rules()        ← Nạp rules từ DB (RuleDefinition) hoặc registry
    │
    ├─ Với mỗi rule trong self.rules:
    │   │
    │   ├─ _match_rule_for_event(event, rule)
    │   │     - Kiểm tra EVENT_RULE_CATEGORY_MAP (event.event_type → allowed rule_type)
    │   │     - Với SHIFT_RULE: kiểm tra thêm cửa sổ thời gian (time window overlap)
    │   │     - Trả về True/False
    │   │
    │   └─ _evaluate_rule_effect(event, rule)  [nếu match]
    │         - Tính toán effects (dict) dựa trên rule_type
    │         - Không thay đổi state (pure function)
    │
    ├─ _commit_effects(all_effects)
    │     - Cộng dồn effects vào state fields
    │     - Bỏ qua các field "informational only" (late_minutes, early_leave_minutes)
    │
    └─ Ghi snapshot vào calendar_result[]
```

---

## 3. Bảng dữ liệu cấu hình

### 3.1 RuleDefinition (`hrm_ruledefinition`)

Đây là bảng chính để cấu hình tất cả các rule. Model Django trong `hrm/event_models.py`.

| Trường | Kiểu DB | Bắt buộc | Mô tả |
|--------|---------|----------|-------|
| `id` | AutoField | tự sinh | Khoá chính |
| `rule_name` | VARCHAR(255) | ✓ | Tên rule, hiển thị cho người dùng |
| `rule_type` | VARCHAR(100) | ✓ | Loại rule – xem mục 5 |
| `conditions` | JSONField | ✓ | Tham số cấu hình – cấu trúc khác nhau theo `rule_type` |
| `scope` | VARCHAR(20) | ✓ | Phạm vi: `COMPANY` / `DEPARTMENT` / `GROUP` / `INDIVIDUAL` |
| `identifier` | VARCHAR(100) | tùy | Mã định danh phạm vi (xem mục 6) |
| `priority` | INTEGER | ✓ | Ưu tiên – số cao hơn thắng khi nhiều rule cùng `rule_type` |
| `effective_from` | DATE | ✓ | Ngày bắt đầu có hiệu lực |
| `effective_to` | DATE | | Ngày hết hiệu lực (null = không giới hạn) |
| `is_active` | BOOLEAN | ✓ | Bật/tắt rule |
| `description` | TEXT | | Mô tả chi tiết |
| `created_at` | DATETIME | tự sinh | Thời điểm tạo |
| `updated_at` | DATETIME | tự sinh | Thời điểm cập nhật |
| `created_by_id` | FK → Employee | | Người tạo |

**Indexes:**
- `(rule_type)` – lọc nhanh theo loại rule
- `(scope, identifier)` – lọc nhanh theo phạm vi
- `(is_active)` – lọc rule đang hoạt động
- `(effective_from, effective_to)` – kiểm tra hiệu lực

---

### 3.2 AttendancePolicyVersion

Quản lý phiên bản chính sách chấm công theo thời gian.

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `version_code` | VARCHAR(32) | Mã phiên bản, unique (ví dụ: `v2025_01`) |
| `name` | VARCHAR(255) | Tên phiên bản |
| `effective_from` | DATE | Ngày bắt đầu áp dụng |
| `effective_to` | DATE | Ngày kết thúc (null = đang áp dụng) |
| `is_active` | BOOLEAN | Chỉ 1 version được active tại một thời điểm |

---

### 3.3 PenaltyTierConfig (bảng phạt)

Cấu hình bảng phạt gắn với từng `AttendancePolicyVersion`.

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `version` | FK | Thuộc phiên bản chính sách nào |
| `order` | INTEGER | Thứ tự tier (0, 1, 2, ...) |
| `max_minutes` | INTEGER | Phút vi phạm tối đa của tier (null = tier cuối, không giới hạn) |
| `fine_amount_regular` | INTEGER | Tiền phạt nhân viên thường (VNĐ) |
| `fine_amount_manager` | INTEGER | Tiền phạt quản lý (VNĐ) |
| `deduct_work_credit` | DECIMAL | Số công bị trừ (0.5 = trừ nửa công; 1.0 = trừ cả ngày) |
| `description` | VARCHAR(255) | Mô tả mức phạt |

---

### 3.4 AttendancePolicyConfig (tham số chính sách)

Các tham số bổ sung, gắn 1-1 với `AttendancePolicyVersion`.

| Trường | Kiểu | Mặc định | Mô tả |
|--------|------|----------|-------|
| `max_explanation_quota` | INTEGER | 3 | Số lần giải trình tối đa mỗi tháng |
| `penalty_multiplier_threshold` | INTEGER | 7 | Từ lần vi phạm thứ N → nhân hệ số phạt |
| `penalty_multiplier_value` | DECIMAL | 2.0 | Hệ số nhân phạt khi vượt ngưỡng |
| `parking_allowance_per_day` | INTEGER | 5,000 | Phụ cấp gửi xe (VNĐ/ngày) |
| `live_prime_time_allowance` | INTEGER | 100,000 | Phụ cấp live khung giờ vàng (VNĐ/phiên) |
| `live_prime_start_hour` | INTEGER | 21 | Giờ bắt đầu khung prime-time |
| `live_prime_end_hour` | INTEGER | 23 | Giờ kết thúc khung prime-time |
| `max_live_prime_time_pct` | DECIMAL | 0.20 | % tối đa phiên live prime-time / tổng phiên team/tháng |
| `max_ot_live_pct` | DECIMAL | 0.20 | % tối đa OT live / tổng OT cá nhân/tháng |
| `incomplete_no_expl_deduction` | DECIMAL | 1.0 | Trừ công khi quên CC, không giải trình |
| `incomplete_approved_deduction` | DECIMAL | 0.5 | Trừ công khi quên CC, được duyệt giải trình |

---

## 4. Ánh xạ Event → Rule (`EVENT_RULE_CATEGORY_MAP`)

File `hrm/constant.py` – bảng routing khi nhận một event, engine chỉ thử các rule_type được liệt kê:

```python
EVENT_RULE_CATEGORY_MAP = {
    "attendance":    ["SHIFT_RULE_MORNING", "SHIFT_RULE_AFTERNOON"],
    "leave_request": ["LEAVE_RULE_PAID", "LEAVE_RULE_UNPAID"],
    "overtime":      ["OVERTIME_RULE"],
    "livestream":    ["LIVESTREAM_RULE"],
    "explanation":   ["EXPLANATION_RULE"],
}
```

> Khi thêm loại rule mới, cần cập nhật bảng này để rule được nhận diện.

---

## 5. Các loại rule và cấu trúc conditions JSON

### 5.1 `SHIFT_RULE_MORNING` – Ca sáng

**Trigger:** event `attendance`

**Matching bổ sung:** Kiểm tra time window overlap giữa `[check_in, check_out]` của nhân viên và `[start_time, end_time]` của rule (với buffer ±15 phút ở đầu ca).

**`conditions` JSON:**

```json
{
  "start_time": "08:30",
  "end_time":   "12:00",
  "workday":    0.5
}
```

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `start_time` | `"HH:MM"` | ✓ | Giờ bắt đầu ca sáng |
| `end_time` | `"HH:MM"` | ✓ | Giờ kết thúc ca sáng |
| `workday` | float | ✓ | Hệ số công khi hoàn thành ca (thường `0.5`) |

**Effects:**

| Trường state | Khi nào |
|-------------|---------|
| `nua_ngay_cong += workday` | Có đủ check_in & check_out, không bị vắng mặt |
| `di_muon_ve_som += 1` | Đi muộn hoặc về sớm ≤ 120 phút |
| `tong_phat += <penalty>` | Đi muộn hoặc về sớm ≤ 120 phút |
| `vang_mat += workday` | Đi muộn hoặc về sớm > 120 phút |
| `quen_cham_cong += 1` | Thiếu check_in hoặc check_out |
| `violation_count_month += 1` | Mỗi lần vi phạm đi muộn/về sớm |

---

### 5.2 `SHIFT_RULE_AFTERNOON` – Ca chiều

**Trigger:** event `attendance`

Tương tự `SHIFT_RULE_MORNING`. Khác biệt: `effective_check_in = max(check_in, shift_start)` – chấp nhận nhân viên check in từ trước giờ ca chiều.

**`conditions` JSON:**

```json
{
  "start_time": "13:00",
  "end_time":   "17:30",
  "workday":    0.5
}
```

**Effects:** Tương tự ca sáng (xem 5.1).

---

### 5.3 `LEAVE_RULE_PAID` – Nghỉ phép có lương

**Trigger:** event `leave_request` với `leave_type = "PAID"`

**`conditions` JSON:**

```json
{
  "max_days_per_year":  12,
  "requires_approval":  true,
  "workday":            1.0
}
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `max_days_per_year` | integer | Số ngày nghỉ phép tối đa mỗi năm |
| `requires_approval` | boolean | Đơn có cần phê duyệt không |
| `workday` | float | Hệ số công cho 1 ngày (tham khảo) |

**Effects:**

| Trường state | Khi nào |
|-------------|---------|
| `nghi_phep += 1` | Rule PAID match với event `leave_type=PAID` |

---

### 5.4 `LEAVE_RULE_UNPAID` – Nghỉ không lương

**Trigger:** event `leave_request` với `leave_type = "UNPAID"`

**`conditions` JSON:**

```json
{
  "max_days_per_month": 3,
  "workday":            1.0
}
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `max_days_per_month` | integer | Số ngày nghỉ không lương tối đa mỗi tháng |
| `workday` | float | Số công bị trừ mỗi ngày nghỉ không lương |

**Effects:**

| Trường state | Khi nào |
|-------------|---------|
| `nghi_khong_luong += 1` | Luôn luôn |
| `vang_mat += workday` | Luôn luôn (trừ công do nghỉ không lương) |

---

### 5.5 `OVERTIME_RULE` – Tăng ca

**Trigger:** event `overtime`

**`conditions` JSON:**

```json
{
  "regular_hours_threshold": 8.0,
  "multiplier":              1.5,
  "max_overtime_per_day":    4.0
}
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `regular_hours_threshold` | float | Ngưỡng giờ làm bình thường (tham khảo) |
| `multiplier` | float | Hệ số nhân (`lam_them_gio = overtime_hours × multiplier`) |
| `max_overtime_per_day` | float | Giới hạn giờ tăng ca tối đa/ngày (vượt → bị cap) |

**Effects:**

| Trường state | Khi nào |
|-------------|---------|
| `tang_ca += overtime_hours` | Luôn luôn (sau khi cap) |
| `lam_them_gio += overtime_hours × multiplier` | Luôn luôn |
| `truc_toi += 1` | Khi `event.data["is_night_shift"] == true` |

---

### 5.6 `LIVESTREAM_RULE` – Livestream

**Trigger:** event `livestream`

**`conditions` JSON:**

```json
{
  "min_duration_for_count":  1.0,
  "allowance_per_session":   100000,
  "max_sessions_per_month":  8
}
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `min_duration_for_count` | float | Thời lượng tối thiểu (giờ) để buổi live được tính |
| `allowance_per_session` | integer | Phụ cấp mỗi buổi live đủ điều kiện (VNĐ) |
| `max_sessions_per_month` | integer | Số buổi tối đa được tính phụ cấp mỗi tháng |

**Effects:**

| Trường state | Khi nào |
|-------------|---------|
| `live += 1` | `session_duration >= min_duration_for_count` |
| `tong_phu_cap_livestream += allowance_per_session` | Khi đủ thời lượng |

---

### 5.7 `EXPLANATION_RULE` – Giải trình chấm công

**Trigger:** event `explanation`

**`conditions` JSON:**

```json
{
  "max_explanations_per_month": 3,
  "penalty_reduction_rate":     0.5,
  "allowed_types":              ["FORGOT", "LATE", "EARLY_LEAVE"]
}
```

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `max_explanations_per_month` | integer | Số lần giải trình tối đa mỗi tháng |
| `penalty_reduction_rate` | float | Tỉ lệ giảm phạt khi được duyệt (0.5 = giảm 50%) |
| `allowed_types` | array | Loại giải trình hợp lệ: `FORGOT`, `LATE`, `EARLY_LEAVE` |

**Effects (chỉ khi `status == "APPROVED"`):**

| Trường state | Khi nào |
|-------------|---------|
| `giai_trinh_cham_cong += 1` | Luôn luôn khi APPROVED |
| `explanation_quota_used += 1` | Luôn luôn khi APPROVED |
| `tong_phat -= original_penalty × penalty_reduction_rate` | Khi `original_penalty > 0` |
| `di_muon_ve_som -= 1` | Khi `explanation_type` là `LATE` hoặc `EARLY_LEAVE` |

---

## 6. Phạm vi áp dụng (scope & identifier)

| `scope` | `identifier` | Mô tả |
|---------|-------------|-------|
| `COMPANY` | `ALL` | Áp dụng toàn bộ nhân viên |
| `DEPARTMENT` | Mã phòng ban (ví dụ: `MARKETING`) | Áp dụng cho nhân viên trong phòng ban |
| `GROUP` | Mã nhóm (ví dụ: `MANAGERS`) | Áp dụng cho nhân viên trong nhóm |
| `INDIVIDUAL` | Mã nhân viên (ví dụ: `NV001`) | Áp dụng riêng cho một nhân viên |

**Thuật toán chọn rule khi có nhiều rule cùng `rule_type`:**

```
Độ ưu tiên scope: INDIVIDUAL > GROUP > DEPARTMENT > COMPANY

Trong cùng scope và cùng type: rule có priority cao hơn → được chọn
```

**Ví dụ:** nhân viên `NV001` thuộc phòng `MARKETING`, nhóm `MANAGERS`:

| Rule | scope | priority | Kết quả |
|------|-------|----------|---------|
| Ca sáng HC (company) | COMPANY | 10 | Bị ghi đè |
| Ca sáng Marketing | DEPARTMENT:MARKETING | 20 | Bị ghi đè |
| Ca sáng NV001 đặc biệt | INDIVIDUAL:NV001 | 30 | **ĐƯỢC CHỌN** |

---

## 7. Bảng phạt đi muộn / về sớm

Hàm `EmployeeState._calc_penalty(minutes)` hardcode trong `hrm/main_api.py`:

| Số phút vi phạm | Mức phạt | Ghi chú |
|----------------|----------|---------|
| 1 – 10 phút | 50,000 VNĐ | |
| 11 – 30 phút | 100,000 VNĐ | |
| 31 – 60 phút | 120,000 VNĐ | |
| 61 – 120 phút | 200,000 VNĐ | |
| > 120 phút | `-1` (sentinel) | Engine xử lý: `vang_mat += 0.5` |

> Để cấu hình bảng phạt linh hoạt qua DB, sử dụng `PenaltyTierConfig` (mục 3.3).
> Xem hướng dẫn tạo tại [HRM_RULE_ENGINE_SETUP.md § 7](./HRM_RULE_ENGINE_SETUP.md#7-cấu-hình-bảng-phạt-penaltytierconfig).

---

## 8. Dữ liệu event (`event.data`) – JSON chi tiết

### 8.1 Event `attendance`

```json
{
  "date":             "2025-01-15",
  "employee_id":      "NV001",
  "employee_name":    "Nguyễn Văn A",
  "check_in":         "08:35",
  "check_out":        "12:10",
  "shift_start_time": "08:30",
  "shift_end_time":   "12:00"
}
```

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| `date` | ✓ | Ngày chấm công `YYYY-MM-DD` |
| `employee_id` | ✓ | Mã nhân viên |
| `employee_name` | | Tên nhân viên |
| `check_in` | | Giờ vào `HH:MM` (thiếu → `quen_cham_cong`) |
| `check_out` | | Giờ ra `HH:MM` (thiếu → `quen_cham_cong`) |
| `shift_start_time` | | Tự động điền từ `ShiftConfig` nếu không có |
| `shift_end_time` | | Tự động điền từ `ShiftConfig` nếu không có |

---

### 8.2 Event `leave_request`

```json
{
  "date":       "2025-01-15",
  "leave_type": "PAID",
  "reason":     "Nghỉ phép năm",
  "employee_id":"NV001"
}
```

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| `date` | ✓ | Ngày nghỉ `YYYY-MM-DD` |
| `leave_type` | ✓ | `"PAID"` (có lương) hoặc `"UNPAID"` (không lương) |
| `reason` | | Lý do nghỉ |
| `employee_id` | ✓ | Mã nhân viên |

---

### 8.3 Event `overtime`

```json
{
  "date":           "2025-01-15",
  "overtime_hours": 2.5,
  "reason":         "Gấp deadline dự án",
  "is_night_shift": false,
  "employee_id":    "NV001"
}
```

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| `date` | ✓ | Ngày tăng ca `YYYY-MM-DD` |
| `overtime_hours` | ✓ | Số giờ tăng ca (float) |
| `reason` | | Lý do |
| `is_night_shift` | | `true` nếu ca đêm → thêm `truc_toi` |
| `employee_id` | ✓ | Mã nhân viên |

---

### 8.4 Event `livestream`

```json
{
  "date":             "2025-01-15",
  "session_duration": 1.5,
  "session_time":     "20:00",
  "employee_id":      "NV001"
}
```

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| `date` | ✓ | Ngày livestream `YYYY-MM-DD` |
| `session_duration` | ✓ | Thời lượng buổi live (giờ, float) |
| `session_time` | | Giờ bắt đầu buổi live `HH:MM` |
| `employee_id` | ✓ | Mã nhân viên |

---

### 8.5 Event `explanation`

```json
{
  "date":             "2025-01-15",
  "explanation_type": "LATE",
  "status":           "APPROVED",
  "original_penalty": 100000,
  "reason":           "Xe hỏng giữa đường",
  "employee_id":      "NV001"
}
```

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| `date` | ✓ | Ngày cần giải trình `YYYY-MM-DD` |
| `explanation_type` | ✓ | `"FORGOT"`, `"LATE"`, hoặc `"EARLY_LEAVE"` |
| `status` | ✓ | `"PENDING"`, `"APPROVED"`, hoặc `"REJECTED"` |
| `original_penalty` | | Số tiền phạt ban đầu (VNĐ) – dùng để tính giảm phạt |
| `reason` | | Lý do giải trình |
| `employee_id` | ✓ | Mã nhân viên |

---

## 9. State fields – ý nghĩa từng trường kết quả

Kết quả trả về bởi `get_state_summary()` / `replay_month()["state"]`:

| Trường | Kiểu | Mô tả | Rule tác động |
|--------|------|-------|--------------|
| `tong_ngay_cong` | float | Tổng ngày công = `ngay_du_cong + nua_ngay_cong` | Tự động |
| `ngay_du_cong` | float | Số ngày đủ công (1.0 mỗi ngày) | (chưa có rule trực tiếp) |
| `nua_ngay_cong` | float | Tổng nửa ngày công tích luỹ | `SHIFT_RULE_MORNING`, `SHIFT_RULE_AFTERNOON` |
| `di_muon_ve_som` | int | Số lần đi muộn hoặc về sớm có phạt | `SHIFT_RULE_MORNING`, `SHIFT_RULE_AFTERNOON` |
| `vang_mat` | float | Số ngày/nửa ngày vắng mặt | `SHIFT_RULE_*`, `LEAVE_RULE_UNPAID` |
| `quen_cham_cong` | int | Số lần thiếu check_in hoặc check_out | `SHIFT_RULE_MORNING`, `SHIFT_RULE_AFTERNOON` |
| `tang_ca` | float | Tổng giờ tăng ca thực tế | `OVERTIME_RULE` |
| `lam_them_gio` | float | Tổng giờ làm thêm (đã nhân hệ số) | `OVERTIME_RULE` |
| `truc_toi` | int | Số đêm trực tối | `OVERTIME_RULE` (khi `is_night_shift=true`) |
| `live` | int | Số buổi livestream đủ điều kiện | `LIVESTREAM_RULE` |
| `nghi_phep` | int | Số ngày nghỉ phép có lương | `LEAVE_RULE_PAID` |
| `nghi_khong_luong` | int | Số ngày nghỉ không lương | `LEAVE_RULE_UNPAID` |
| `giai_trinh_cham_cong` | int | Số lần giải trình được duyệt | `EXPLANATION_RULE` |
| `tong_phat` | int | Tổng tiền phạt (VNĐ) – âm nếu được giảm phạt | `SHIFT_RULE_*`, `EXPLANATION_RULE` |
| `tong_phu_cap_gui_xe` | int | Tổng phụ cấp gửi xe (VNĐ) | (tính riêng) |
| `tong_phu_cap_livestream` | int | Tổng phụ cấp livestream (VNĐ) | `LIVESTREAM_RULE` |
| `violation_count_month` | int | Tổng số vi phạm trong tháng | `SHIFT_RULE_MORNING`, `SHIFT_RULE_AFTERNOON` |
| `explanation_quota_used` | int | Số lần giải trình đã dùng trong tháng | `EXPLANATION_RULE` |

---

**Ngày cập nhật:** 2026-03-02  
**Phiên bản:** 1.0  
**Liên quan:** `hrm/main_api.py`, `hrm/event_models.py`, `hrm/attendance_models.py`, `hrm/constant.py`  
**Xem thêm:** [HRM_RULE_ENGINE_SETUP.md](./HRM_RULE_ENGINE_SETUP.md) – hướng dẫn cấu hình thực tế
