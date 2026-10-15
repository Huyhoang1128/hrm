# Hướng dẫn cấu hình ca làm việc chi tiết

## Tổng quan

Hệ thống HRM đã được thiết kế để cấu hình linh hoạt các ca làm việc. Dưới đây là hướng dẫn chi tiết để cấu hình từng ca làm việc theo yêu cầu.

## Các bước cấu hình

### Bước 1: Truy cập giao diện cấu hình

1. **Đăng nhập** vào hệ thống HRM
2. **Truy cập**: `/attendance-rules` (Quy tắc chấm công)
3. **Click "Tạo mới"** để bắt đầu cấu hình

### Bước 2: Cấu hình từng ca làm việc

Dưới đây là cấu hình chi tiết cho từng ca:

---

## 1. Ca hành chính (HC-FULL)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca hành chính
- **Mã quy tắc**: HC-FULL
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca làm việc hành chính từ 8h30 đến 17h30

### Cấu hình JSON:
```json
{
  "shift_type": "FULL_DAY",
  "start_time": "08:30",
  "end_time": "17:30",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 1.0,
  "break_start_time": "12:00",
  "break_end_time": "13:00",
  "work_hours": 8,
  "working_hours": 7,
  "break_duration_minutes": 60
}
```

### Các trường cần điền:
- **Áp dụng cho**: Tất cả (hoặc chọn phòng ban hành chính)
- **Ngày có hiệu lực**: 01/01/2025
- **Kích hoạt**: Bật

---

## 2. Ca sáng hành chính (HC-MORNING)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca sáng hành chính
- **Mã quy tắc**: HC-MORNING
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca sáng hành chính từ 8h30 đến 12h00

### Cấu hình JSON:
```json
{
  "shift_type": "MORNING",
  "start_time": "08:30",
  "end_time": "12:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 3.5,
  "working_hours": 3.5
}
```

---

## 3. Ca chiều hành chính (HC-AFTERNOON)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca chiều hành chính
- **Mã quy tắc**: HC-AFTERNOON
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca chiều hành chính từ 13h00 đến 17h30

### Cấu hình JSON:
```json
{
  "shift_type": "AFTERNOON",
  "start_time": "13:00",
  "end_time": "17:30",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 4.5,
  "working_hours": 4.5
}
```

---

## 4. Ca ADS (ADS-FULL)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca ADS
- **Mã quy tắc**: ADS-FULL
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca ADS từ 9h00 đến 17h30

### Cấu hình JSON:
```json
{
  "shift_type": "FULL_DAY",
  "start_time": "09:00",
  "end_time": "17:30",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 1.0,
  "break_start_time": "12:00",
  "break_end_time": "13:00",
  "work_hours": 8.5,
  "working_hours": 7.5,
  "break_duration_minutes": 60
}
```

---

## 5. Ca sáng ADS (ADS-MORNING)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca sáng ADS
- **Mã quy tắc**: ADS-MORNING
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca sáng ADS từ 9h00 đến 12h00

### Cấu hình JSON:
```json
{
  "shift_type": "MORNING",
  "start_time": "09:00",
  "end_time": "12:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 3,
  "working_hours": 3
}
```

---

## 6. Ca chiều ADS (ADS-AFTERNOON)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca chiều ADS
- **Mã quy tắc**: ADS-AFTERNOON
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca chiều ADS từ 13h00 đến 17h30

### Cấu hình JSON:
```json
{
  "shift_type": "AFTERNOON",
  "start_time": "13:00",
  "end_time": "17:30",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 4.5,
  "working_hours": 4.5
}
```

---

## 7. Ca CSKH MB (CSKH-FULL)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca CSKH MB
- **Mã quy tắc**: CSKH-FULL
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca CSKH MB từ 8h00 đến 17h00

### Cấu hình JSON:
```json
{
  "shift_type": "FULL_DAY",
  "start_time": "08:00",
  "end_time": "17:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 1.0,
  "break_start_time": "12:00",
  "break_end_time": "13:00",
  "work_hours": 9,
  "working_hours": 8,
  "break_duration_minutes": 60
}
```

---

## 8. Ca sáng CSKH MB (CSKH-MORNING)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca sáng CSKH MB
- **Mã quy tắc**: CSKH-MORNING
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca sáng CSKH MB từ 8h00 đến 12h00

### Cấu hình JSON:
```json
{
  "shift_type": "MORNING",
  "start_time": "08:00",
  "end_time": "12:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 4,
  "working_hours": 4
}
```

---

## 9. Ca chiều CSKH MB (CSKH-AFTERNOON)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca chiều CSKH MB
- **Mã quy tắc**: CSKH-AFTERNOON
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca chiều CSKH MB từ 13h00 đến 17h00

### Cấu hình JSON:
```json
{
  "shift_type": "AFTERNOON",
  "start_time": "13:00",
  "end_time": "17:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 4,
  "working_hours": 4
}
```

---

## 10. Ca kinh doanh (KD-FULL)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca kinh doanh
- **Mã quy tắc**: KD-FULL
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca kinh doanh từ 13h00 đến 21h00

### Cấu hình JSON:
```json
{
  "shift_type": "EVENING",
  "start_time": "13:00",
  "end_time": "21:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 1.0,
  "break_start_time": "17:00",
  "break_end_time": "18:00",
  "work_hours": 8,
  "working_hours": 7,
  "break_duration_minutes": 60
}
```

---

## 11. Ca gãy kinh doanh (KD-SPLIT)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca gãy kinh doanh
- **Mã quy tắc**: KD-SPLIT
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca gãy kinh doanh (8h30-12h + trực tối)

### Cấu hình JSON:
```json
{
  "shift_type": "SPLIT_SHIFT",
  "morning_start_time": "08:30",
  "morning_end_time": "12:00",
  "evening_start_time": "18:00",
  "evening_end_time": "21:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 1.0,
  "total_work_hours": 6.5,
  "working_hours": 6.5,
  "description": "Làm việc tại văn phòng buổi sáng, trực tối tại nhà"
}
```

---

## 12. Ca tối (EVENING)

### Thông tin cơ bản:
- **Tên quy tắc**: Ca tối
- **Mã quy tắc**: EVENING
- **Loại quy tắc**: SHIFT_RULE
- **Mô tả**: Ca tối từ 17h30 đến 21h00

### Cấu hình JSON:
```json
{
  "shift_type": "EVENING",
  "start_time": "17:30",
  "end_time": "21:00",
  "late_threshold_minutes": 15,
  "early_leave_threshold_minutes": 15,
  "work_coefficient": 0.5,
  "work_hours": 3.5,
  "working_hours": 3.5
}
```

---

## Bước 3: Áp dụng ca làm việc cho nhân viên

### Cách 1: Áp dụng theo phòng ban

1. **Tạo phòng ban** nếu chưa có
2. **Trong form cấu hình ca**, chọn phòng ban cần áp dụng
3. **Tất cả nhân viên** trong phòng ban sẽ tự động áp dụng ca đó

### Cách 2: Áp dụng riêng cho nhân viên

1. **Truy cập** trang nhân viên
2. **Chọn "Áp dụng quy tắc chấm công"**
3. **Chọn ca làm việc** từ danh sách đã cấu hình

### Cách 3: Sử dụng API

```bash
# Áp dụng quy tắc cho nhân viên
curl -X POST http://localhost:8000/api-hrm/rule-engine/employees/1/apply-department-rules/ \
  -H "Authorization: Bearer <token>"
```

---

## Bước 4: Kiểm tra và xác nhận

### Kiểm tra cấu hình:

1. **Truy cập** `/attendance-rules` để xem danh sách ca đã cấu hình
2. **Click vào từng ca** để xem chi tiết
3. **Kiểm tra** thông tin thời gian và hệ số công

### Test tính toán:

1. **Truy cập** `/rule-engine/test`
2. **Chọn nhân viên** và **chọn ca**
3. **Nhập thời gian** chấm công
4. **Xem kết quả** tính toán tự động

---

## Lưu ý quan trọng

### 1. Ngưỡng đi trễ/về sớm
- Mặc định: 15 phút cho tất cả các ca
- Có thể điều chỉnh trong cấu hình JSON

### 2. Hệ số công (work_coefficient)
- Ca đầy đủ: 1.0
- Ca nửa ngày: 0.5
- Đảm bảo đúng với quy định tính công

### 3. Thời gian nghỉ
- Ca đầy đủ có 60 phút nghỉ trưa
- Ca nửa ngày không có thời gian nghỉ
- Có thể điều chỉnh trong cấu hình

### 4. Ngày hiệu lực
- Đặt ngày bắt đầu áp dụng
- Có thể đặt ngày kết thúc nếu cần
- Nếu không đặt ngày kết thúc, ca sẽ áp dụng vĩnh viễn

---

## Xử lý sự cố

### 1. Lỗi validation
- **Kiểm tra** định dạng JSON
- **Đảm bảo** thời gian đúng định dạng HH:MM
- **Kiểm tra** các trường bắt buộc

### 2. Không áp dụng được
- **Kiểm tra** ngày hiệu lực
- **Kiểm tra** trạng thái kích hoạt
- **Kiểm tra** phòng ban/nhân viên được áp dụng

### 3. Tính toán sai
- **Kiểm tra** cấu hình work_coefficient
- **Kiểm tra** thời gian làm việc
- **Test lại** với rule engine

---

## Script tự động hóa

Tạo file `create_shifts.py` để tự động cấu hình tất cả ca:

```python
import requests
import json

BASE_URL = "http://localhost:8000/api-hrm"
TOKEN = "your_jwt_token_here"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

# Danh sách ca cần tạo
shifts = [
    {
        "name": "Ca hành chính",
        "code": "HC-FULL",
        "configuration": {
            "shift_type": "FULL_DAY",
            "start_time": "08:30",
            "end_time": "17:30",
            "late_threshold_minutes": 15,
            "early_leave_threshold_minutes": 15,
            "work_coefficient": 1.0,
            "break_start_time": "12:00",
            "break_end_time": "13:00",
            "work_hours": 8,
            "working_hours": 7,
            "break_duration_minutes": 60
        }
    },
    # Thêm các ca khác tương tự...
]

for shift in shifts:
    data = {
        "name": shift["name"],
        "code": shift["code"],
        "rule_type": "SHIFT_RULE",
        "configuration": shift["configuration"],
        "apply_to_all": True,
        "effective_from": "2025-01-01",
        "is_active": True
    }
    
    response = requests.post(
        f"{BASE_URL}/attendance-rule-configs/",
        json=data,
        headers=headers
    )
    
    if response.status_code in [200, 201]:
        print(f"✓ Đã tạo ca: {shift['name']}")
    else:
        print(f"✗ Lỗi tạo ca {shift['name']}: {response.text}")
```

---

## Kết luận

Hệ thống HRM đã được
