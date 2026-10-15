# Hướng dẫn cấu hình hệ thống HRM - Chấm công & Nghỉ phép

## Tổng quan

Hệ thống HRM đã được triển khai với các tính năng:
1. **Quản lý quy tắc chấm công** - Cấu hình ca làm việc, tính công tự động
2. **Quản lý chính sách nghỉ phép** - Cấu hình quy định nghỉ phép, thời gian báo trước
3. **Rule Engine** - Xử lý logic chấm công tự động
4. **API đầy đủ** - REST API cho tích hợp frontend và hệ thống khác

## 1. Cấu hình quy tắc chấm công (Attendance Rules)

### 1.1. Các loại ca làm việc cần cấu hình

Dựa trên yêu cầu, cần cấu hình các ca sau:

| Tên ca | Thời gian | Số công | Mã ca (gợi ý) |
|--------|-----------|---------|---------------|
| Ca hành chính | 8h30 - 17h30 | 1.0 | HC-FULL |
| Ca sáng hành chính | 8h30 - 12h00 | 0.5 | HC-MORNING |
| Ca chiều hành chính | 13h00 - 17h30 | 0.5 | HC-AFTERNOON |
| Ca ADS | 9h00 - 17h30 | 1.0 | ADS-FULL |
| Ca sáng ADS | 9h00 - 12h00 | 0.5 | ADS-MORNING |
| Ca chiều ADS | 13h00 - 17h30 | 0.5 | ADS-AFTERNOON |
| Ca CSKH MB | 8h00 - 17h00 | 1.0 | CSKH-FULL |
| Ca sáng CSKH MB | 8h00 - 12h00 | 0.5 | CSKH-MORNING |
| Ca chiều CSKH MB | 13h00 - 17h00 | 0.5 | CSKH-AFTERNOON |
| Ca kinh doanh | 13h00 - 21h00 | 1.0 | KD-FULL |
| Ca gãy kinh doanh | 8h30-12h + trực tối | 1.0 | KD-SPLIT |
| Ca tối | 17h30 - 21h00 | 0.5 | EVENING |

### 1.2. Cách cấu hình qua giao diện

1. **Truy cập**: `/attendance-rules` (Quy tắc chấm công)
2. **Click "Tạo mới"**
3. **Điền thông tin**:
   - **Tên quy tắc**: Tên ca làm việc
   - **Mã quy tắc**: Mã duy nhất (theo bảng trên)
   - **Loại quy tắc**: Chọn "SHIFT_CONFIG"
   - **Cấu hình JSON**:
   ```json
   {
     "shift_type": "FULL_DAY",  // hoặc "MORNING", "AFTERNOON", "EVENING"
     "start_time": "08:30",
     "end_time": "17:30",
     "late_threshold_minutes": 15,
     "early_leave_threshold_minutes": 15,
     "work_coefficient": 1.0,
     "break_start_time": "12:00",
     "break_end_time": "13:00"
   }
   ```
   - **Áp dụng cho**: Chọn phòng ban hoặc "Tất cả"
   - **Ngày có hiệu lực**: Ngày bắt đầu áp dụng
   - **Kích hoạt**: Bật

### 1.3. Cách cấu hình qua API

```bash
# Tạo quy tắc ca hành chính
curl -X POST http://localhost:8000/api-hrm/attendance-rule-configs/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ca hành chính",
    "code": "HC-FULL",
    "rule_type": "SHIFT_CONFIG",
    "configuration": {
      "shift_type": "FULL_DAY",
      "start_time": "08:30",
      "end_time": "17:30",
      "late_threshold_minutes": 15,
      "early_leave_threshold_minutes": 15,
      "work_coefficient": 1.0,
      "break_start_time": "12:00",
      "break_end_time": "13:00"
    },
    "apply_to_all": true,
    "effective_from": "2025-01-01",
    "is_active": true
  }'
```

## 2. Cấu hình chính sách nghỉ phép (Leave Policies)

### 2.1. Quy định thời gian báo trước

Theo yêu cầu, cấu hình các quy tắc báo trước:

| Số ngày nghỉ | Thời gian báo trước | Mô tả |
|--------------|---------------------|-------|
| Dưới 1 ngày | 4 giờ làm việc | Nghỉ dưới 1 ngày: báo trước 4 giờ làm việc |
| 1-3 ngày | 1 ngày làm việc | Nghỉ từ 1-3 ngày: báo trước 1 ngày làm việc |
| 4-7 ngày | 5 ngày làm việc | Nghỉ từ 4-7 ngày: báo trước 5 ngày làm việc |
| 8+ ngày | 10 ngày làm việc | Nghỉ từ 8 ngày trở lên: báo trước 10 ngày làm việc |

**Lưu ý**: Trường hợp khẩn cấp (ốm đau, việc gia đình cấp bách): Báo trước 2 giờ

### 2.2. Cách cấu hình qua giao diện

1. **Truy cập**: `/leave-policies` (Chính sách nghỉ phép)
2. **Click "Tạo mới"**
3. **Điền thông tin**:
   - **Mã chính sách**: VD: `ANNUAL-LEAVE`
   - **Tên chính sách**: VD: "Nghỉ phép năm"
   - **Loại nghỉ phép**: Chọn loại (ANNUAL, SICK, MATERNITY, etc.)
   - **Quy định báo trước (JSON)**:
   ```json
   [
     {
       "max_days": 1,
       "advance_hours": 4,
       "advance_days": null,
       "description": "Nghỉ dưới 1 ngày: báo trước 4 giờ làm việc"
     },
     {
       "max_days": 3,
       "advance_hours": null,
       "advance_days": 1,
       "description": "Nghỉ từ 1-3 ngày: báo trước 1 ngày làm việc"
     },
     {
       "max_days": 7,
       "advance_hours": null,
       "advance_days": 5,
       "description": "Nghỉ từ 4-7 ngày: báo trước 5 ngày làm việc"
     },
     {
       "max_days": null,
       "advance_hours": null,
       "advance_days": 10,
       "description": "Nghỉ từ 8 ngày trở lên: báo trước 10 ngày làm việc"
     }
   ]
   ```
   - **Số giờ báo trước (khẩn cấp)**: 2
   - **Yêu cầu giấy khám bệnh**: Tùy loại nghỉ
   - **Cần phê duyệt**: Có/Không
   - **Số ngày tối đa/năm**: 12 (phép năm)
   - **Số ngày liên tiếp tối đa**: 5
   - **Áp dụng cho**: Chọn phòng ban hoặc "Tất cả"

### 2.3. Cách cấu hình qua API

```bash
# Tạo chính sách nghỉ phép năm
curl -X POST http://localhost:8000/api-hrm/leave-policy-configs/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nghỉ phép năm",
    "code": "ANNUAL-LEAVE",
    "leave_type": "ANNUAL",
    "advance_notice_rules": [
      {
        "max_days": 1,
        "advance_hours": 4,
        "advance_days": null,
        "description": "Nghỉ dưới 1 ngày: báo trước 4 giờ làm việc"
      },
      {
        "max_days": 3,
        "advance_hours": null,
        "advance_days": 1,
        "description": "Nghỉ từ 1-3 ngày: báo trước 1 ngày làm việc"
      },
      {
        "max_days": 7,
        "advance_hours": null,
        "advance_days": 5,
        "description": "Nghỉ từ 4-7 ngày: báo trước 5 ngày làm việc"
      },
      {
        "max_days": null,
        "advance_hours": null,
        "advance_days": 10,
        "description": "Nghỉ từ 8 ngày trở lên: báo trước 10 ngày làm việc"
      }
    ],
    "emergency_notice_hours": 2,
    "requires_medical_certificate": false,
    "requires_approval": true,
    "max_days_per_year": 12,
    "max_consecutive_days": 5,
    "apply_to_all": true,
    "effective_from": "2025-01-01",
    "is_active": true
  }'
```

## 3. Áp dụng quy tắc cho nhân viên

### 3.1. Cách 1: Áp dụng theo phòng ban

Khi tạo quy tắc, chọn phòng ban cụ thể. Tất cả nhân viên trong phòng ban sẽ tự động áp dụng.

### 3.2. Cách 2: Áp dụng riêng cho nhân viên

1. **Truy cập** trang nhân viên
2. **Chọn "Áp dụng quy tắc chấm công"**
3. **Chọn quy tắc** từ danh sách

### 3.3. API áp dụng quy tắc

```bash
# Áp dụng quy tắc cho nhân viên
curl -X POST http://localhost:8000/api-hrm/rule-engine/employees/1/apply-department-rules/ \
  -H "Authorization: Bearer <token>"
```

## 4. Import và xử lý dữ liệu chấm công

### 4.1. Định dạng file import

Tạo file CSV/Excel với các cột:
```
employee_id,date,check_in,check_out,shift_type
NV001,2025-01-10,08:25,17:35,FULL_DAY
NV002,2025-01-10,08:45,12:10,MORNING
```

### 4.2. Các bước import

1. **Truy cập**: `/attendance-upload` (Upload chấm công)
2. **Chọn file** CSV/Excel
3. **Xác nhận import**
4. **Hệ thống tự động**:
   - Áp dụng quy tắc chấm công
   - Tính công, đi trễ, về sớm
   - Tạo báo cáo vi phạm

### 4.3. API import

```bash
# Upload file chấm công
curl -X POST http://localhost:8000/api-hrm/attendance-import/ \
  -H "Authorization: Bearer <token>" \
  -F "file=@attendance_data.csv"
```

## 5. Rule Engine - Kiểm tra logic

### 5.1. Test quy tắc chấm công

Truy cập: `/rule-engine/test` để test logic:

1. **Chọn nhân viên**
2. **Chọn ngày và giờ**
3. **Xem kết quả** tính toán tự động

### 5.2. API test rule engine

```bash
# Test rule engine
curl -X POST http://localhost:8000/api-hrm/rule-engine/test/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "employee_id": 1,
    "attendance_date": "2025-01-10",
    "check_in": "08:45",
    "check_out": "17:30",
    "shift_type": "FULL_DAY"
  }'
```

## 6. Báo cáo và giám sát

### 6.1. Các báo cáo có sẵn

1. **Báo cáo chấm công theo phòng ban**
2. **Báo cáo vi phạm** (đi trễ, về sớm, vắng mặt)
3. **Thống kê công** theo tháng/quý/năm
4. **Báo cáo nghỉ phép** theo nhân viên/phòng ban

### 6.2. Truy cập báo cáo

- **Dashboard**: `/dashboard` - Tổng quan HRM
- **Quản lý chấm công**: `/attendance-management` - Xem và xử lý chấm công
- **Báo cáo**: Có export Excel/PDF

## 7. Cấu hình nâng cao

### 7.1. Tùy chỉnh rule engine

File cấu hình: `backend/hrm/rule_engine.py`

Các hàm chính:
- `calculate_attendance_status()`: Tính trạng thái chấm công
- `calculate_work_hours()`: Tính số giờ làm việc
- `calculate_late_minutes()`: Tính số phút đi trễ
- `apply_leave_policy()`: Áp dụng chính sách nghỉ phép

### 7.2. Thêm loại quy tắc mới

1. **Thêm vào model** `AttendanceRuleConfig.RULE_TYPE_CHOICES`
2. **Cập nhật rule engine** xử lý logic mới
3. **Cập nhật frontend** hiển thị loại quy tắc mới

### 7.3. Tích hợp với hệ thống khác

Các API có sẵn:
- **Webhook** khi có thay đổi chấm công
- **Real-time notification** qua WebSocket
- **Export data** định kỳ

## 8. Khắc phục sự cố

### 8.1. Lỗi phổ biến

1. **Lỗi validation date**: Đảm bảo định dạng `YYYY-MM-DD`
2. **Lỗi không áp dụng quy tắc**: Kiểm tra ngày hiệu lực
3. **Lỗi tính toán sai**: Kiểm tra cấu hình quy tắc

### 8.2. Kiểm tra hệ thống

```bash
# Kiểm tra API
curl http://localhost:8000/api-hrm/attendance-rule-configs/

# Kiểm tra database
cd backend
python manage.py shell -c "from hrm.models import AttendanceRuleConfig; print(AttendanceRuleConfig.objects.count())"
```

### 8.3. Log và monitoring

- **Log file**: `backend/logs/hrm.log`
- **Admin panel**: `/admin/hrm/` để xem dữ liệu
- **API documentation**: `/swagger/` hoặc `/redoc/`

## 9. Script tự động hóa

### 9.1. Script tạo cấu hình mẫu

```python
# create_sample_configs.py
import requests
import json

BASE_URL = "http://localhost:8000/api-hrm"
TOKEN = "your_jwt_token_here"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

# Tạo các ca làm việc mẫu
shift_configs = [
    {
        "name": "Ca hành chính",
        "code": "HC-FULL",
        "rule_type": "SHIFT_CONFIG",
        "configuration": {
            "shift_type": "FULL_DAY",
            "start_time": "08:30",
            "end_time": "17:30",
            "late_threshold_minutes": 15,
            "early_leave_threshold_minutes": 15,
            "work_coefficient": 1.0,
            "break_start_time":
