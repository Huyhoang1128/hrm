# API Chốt công (Work Finalization)

Tài liệu mô tả các API endpoint phục vụ tính năng **Chốt công** (Work Finalization) trong hệ thống HRM HRM.

Toàn bộ endpoint được mount tại: `/api-hrm/work-finalization/...`

---

## 📋 Tổng quan

Chốt công là bước cuối cùng trong quy trình tính lương tháng. Hệ thống tổng hợp toàn bộ dữ liệu chấm công, đơn từ đã duyệt, quy tắc phạt và các phụ cấp từ **Rule Engine** (`EmployeeState.replay_month`) để tạo bản ghi `WorkFinalization` cho từng nhân viên.

### Dữ liệu được tính toán

| Trường           | Mô tả                                                           |
|------------------|-----------------------------------------------------------------|
| `cong_thu_viec`  | Công thử việc (ngày công trước `probation_end_date`)            |
| `cong_chinh_thuc`| Công chính thức (ngày công sau `probation_end_date`)            |
| `cong_thuc_te`   | Tổng công thực tế (`tong_ngay_cong` từ rule engine)             |
| `tong_cong`      | Tổng công (bằng `cong_thuc_te`)                                 |
| `tong_phat`      | Tổng tiền phạt (VNĐ) do vi phạm chấm công                      |
| `tang_ca`        | Tổng giờ tăng ca được duyệt                                     |
| `truc_toi`       | Số buổi trực tối được duyệt                                     |
| `them_gio`       | Số giờ làm thêm được duyệt                                      |
| `live`           | Số buổi Livestream được duyệt                                   |
| `phu_cap_gui_xe` | Tổng phụ cấp gửi xe (VNĐ)                                       |

---

## 🔐 Xác thực

Tất cả các endpoint yêu cầu JWT token trong header:

```
Authorization: Bearer <access_token>
```

---

## 1. Danh sách chốt công theo tháng

**Endpoint:** `GET /api-hrm/work-finalization/`

**Mô tả:** Lấy danh sách các bản ghi đã chốt công theo tháng/năm. Hỗ trợ lọc theo nhân viên hoặc phòng ban.

### Query Parameters

| Tham số         | Kiểu     | Bắt buộc | Mô tả                         |
|-----------------|----------|----------|-------------------------------|
| `year`          | integer  | ✅       | Năm (VD: `2026`)              |
| `month`         | integer  | ✅       | Tháng (1–12)                  |
| `employee_code` | string   | ❌       | Lọc theo mã nhân viên         |
| `department_id` | integer  | ❌       | Lọc theo ID phòng ban         |

### Response `200 OK`

```json
{
  "year": 2026,
  "month": 3,
  "total": 2,
  "results": [
    {
      "stt": 1,
      "id": 1,
      "employee_id": 10,
      "ma_nv": "NV001",
      "ho_va_ten": "Nguyễn Văn A",
      "phong_ban": "Phòng CSKH",
      "vi_tri": "Chuyên viên",
      "bac_si": null,
      "ngay_bat_dau_lam_viec": "2024-01-15",
      "ngay_ket_thuc_thu_viec": "2024-04-14",
      "on_off": "ON",
      "ngay_nghi_viec": null,
      "hinh_thuc_lam_viec": "FULL_TIME",
      "cong_thu_viec": 0.0,
      "cong_chinh_thuc": 22.0,
      "co_le": null,
      "cong_thuc_te": 22.0,
      "tong_cong": 22.0,
      "tong_phat": 100000.0,
      "tang_ca": 8.0,
      "lam_toi": null,
      "truc_toi": 2.0,
      "them_gio": 0.0,
      "live": 5,
      "phu_cap_gui_xe": 110000.0,
      "year": 2026,
      "month": 3,
      "finalized_at": "2026-03-01T14:00:00Z"
    }
  ]
}
```

### Response `400 Bad Request`

```json
{
  "error": "year và month là bắt buộc và phải là số nguyên"
}
```

---

## 2. Thực hiện chốt công (Upsert)

**Endpoint:** `POST /api-hrm/work-finalization/finalize/`

**Mô tả:** Tính toán và lưu (upsert) dữ liệu chốt công cho một nhân viên trong một tháng cụ thể. Nếu bản ghi đã tồn tại sẽ được cập nhật, nếu chưa có sẽ tạo mới.

### Request Body

```json
{
  "employee_code": "NV001",
  "year": 2026,
  "month": 3
}
```

| Trường          | Kiểu    | Bắt buộc | Mô tả                             |
|-----------------|---------|----------|-----------------------------------|
| `employee_code` | string  | ✅       | Mã nhân viên                      |
| `year`          | integer | ✅       | Năm (2000–2100)                   |
| `month`         | integer | ✅       | Tháng (1–12)                      |

### Response `201 Created` (Tạo mới)

```json
{
  "message": "Chốt công thành công",
  "created": true,
  "data": {
    "id": 1,
    "employee_id": 10,
    "ma_nv": "NV001",
    "ho_va_ten": "Nguyễn Văn A",
    "phong_ban": "Phòng CSKH",
    "vi_tri": "Chuyên viên",
    "bac_si": null,
    "ngay_bat_dau_lam_viec": "2024-01-15",
    "ngay_ket_thuc_thu_viec": "2024-04-14",
    "on_off": "ON",
    "ngay_nghi_viec": null,
    "hinh_thuc_lam_viec": "FULL_TIME",
    "cong_thu_viec": 0.0,
    "cong_chinh_thuc": 22.0,
    "co_le": null,
    "cong_thuc_te": 22.0,
    "tong_cong": 22.0,
    "tong_phat": 100000.0,
    "tang_ca": 8.0,
    "lam_toi": null,
    "truc_toi": 2.0,
    "them_gio": 0.0,
    "live": 5,
    "phu_cap_gui_xe": 110000.0,
    "year": 2026,
    "month": 3,
    "finalized_at": "2026-03-01T14:00:00Z"
  }
}
```

### Response `200 OK` (Cập nhật)

```json
{
  "message": "Đã cập nhật chốt công",
  "created": false,
  "data": { ... }
}
```

### Response `400 Bad Request`

```json
{ "error": "employee_code là bắt buộc" }
```

```json
{ "error": "year và month phải là số nguyên hợp lệ" }
```

```json
{ "error": "month phải từ 1 đến 12" }
```

```json
{ "error": "year phải từ 2000 đến 2100" }
```

### Response `404 Not Found`

```json
{
  "error": "Không tìm thấy nhân viên với mã 'NV999'"
}
```

### Response `500 Internal Server Error`

```json
{
  "error": "Lỗi khi tính toán công: <chi tiết lỗi>"
}
```

---

## 3. Chi tiết chốt công theo nhân viên & tháng

**Endpoint:** `GET /api-hrm/work-finalization/<employee_code>/<year>/<month>/`

**Mô tả:** Lấy chi tiết bản ghi chốt công của một nhân viên trong một tháng. Yêu cầu đã thực hiện chốt công trước (gọi endpoint finalize).

### URL Parameters

| Tham số         | Kiểu    | Mô tả                      |
|-----------------|---------|----------------------------|
| `employee_code` | string  | Mã nhân viên (VD: `NV001`) |
| `year`          | integer | Năm (VD: `2026`)           |
| `month`         | integer | Tháng (1–12)               |

### Ví dụ request

```
GET /api-hrm/work-finalization/NV001/2026/3/
```

### Response `200 OK`

```json
{
  "id": 1,
  "employee_id": 10,
  "ma_nv": "NV001",
  "ho_va_ten": "Nguyễn Văn A",
  "phong_ban": "Phòng CSKH",
  "vi_tri": "Chuyên viên",
  "bac_si": null,
  "ngay_bat_dau_lam_viec": "2024-01-15",
  "ngay_ket_thuc_thu_viec": "2024-04-14",
  "on_off": "ON",
  "ngay_nghi_viec": null,
  "hinh_thuc_lam_viec": "FULL_TIME",
  "cong_thu_viec": 0.0,
  "cong_chinh_thuc": 22.0,
  "co_le": null,
  "cong_thuc_te": 22.0,
  "tong_cong": 22.0,
  "tong_phat": 100000.0,
  "tang_ca": 8.0,
  "lam_toi": null,
  "truc_toi": 2.0,
  "them_gio": 0.0,
  "live": 5,
  "phu_cap_gui_xe": 110000.0,
  "year": 2026,
  "month": 3,
  "finalized_at": "2026-03-01T14:00:00Z"
}
```

### Response `404 Not Found`

```json
{
  "error": "Chưa có dữ liệu chốt công cho nhân viên và tháng này"
}
```

---

## 📌 Quy trình sử dụng điển hình

### Bước 1 – Chốt công cho từng nhân viên

Gọi API finalize cho mỗi nhân viên trong danh sách:

```bash
curl -X POST /api-hrm/work-finalization/finalize/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"employee_code": "NV001", "year": 2026, "month": 3}'
```

### Bước 2 – Lấy danh sách toàn bộ nhân viên đã chốt

```bash
curl /api-hrm/work-finalization/?year=2026&month=3 \
  -H "Authorization: Bearer <token>"
```

### Bước 3 – Xem chi tiết từng nhân viên (nếu cần)

```bash
curl /api-hrm/work-finalization/NV001/2026/3/ \
  -H "Authorization: Bearer <token>"
```

---

## 🗄️ Mô hình dữ liệu `WorkFinalization`

| Trường                   | Kiểu          | Mô tả                                              |
|--------------------------|---------------|----------------------------------------------------|
| `id`                     | integer       | Khóa chính                                         |
| `employee`               | FK Employee   | Nhân viên (CASCADE delete)                         |
| `year`                   | integer       | Năm                                                |
| `month`                  | integer       | Tháng (1–12)                                       |
| `employee_code`          | string        | Mã nhân viên (snapshot)                            |
| `ho_va_ten`              | string        | Họ và tên (snapshot)                               |
| `phong_ban`              | string/null   | Phòng ban (snapshot)                               |
| `vi_tri`                 | string/null   | Vị trí (snapshot)                                  |
| `bac_si`                 | string/null   | Bác sĩ phụ trách                                   |
| `ngay_bat_dau_lam_viec`  | date/null     | Ngày bắt đầu làm việc                              |
| `ngay_ket_thuc_thu_viec` | date/null     | Ngày kết thúc thử việc                             |
| `on_off`                 | string/null   | Trạng thái làm việc: `ON` / `OFF`                  |
| `ngay_nghi_viec`         | date/null     | Ngày nghỉ việc (nếu đã nghỉ)                       |
| `hinh_thuc_lam_viec`     | string/null   | Hình thức làm việc                                 |
| `cong_thu_viec`          | decimal       | Công thử việc                                      |
| `cong_chinh_thuc`        | decimal       | Công chính thức                                    |
| `co_le`                  | decimal/null  | Công lễ                                            |
| `cong_thuc_te`           | decimal       | Công thực tế                                       |
| `tong_cong`              | decimal       | Tổng công                                          |
| `tong_phat`              | decimal       | Tổng phạt (VNĐ)                                    |
| `tang_ca`                | decimal       | Tổng giờ tăng ca                                   |
| `lam_toi`                | decimal/null  | Làm tối                                            |
| `truc_toi`               | decimal       | Số buổi trực tối                                   |
| `them_gio`               | decimal       | Số giờ làm thêm                                    |
| `live`                   | integer       | Số buổi Livestream                                 |
| `phu_cap_gui_xe`         | decimal       | Phụ cấp gửi xe (VNĐ)                               |
| `raw_state`              | JSON          | Toàn bộ state từ `EmployeeState.replay_month()`   |
| `finalized_at`           | datetime      | Thời điểm chốt công gần nhất (auto_now)            |
| `created_at`             | datetime      | Thời điểm tạo bản ghi lần đầu                      |

> **Ràng buộc unique:** `(employee, year, month)` – mỗi nhân viên chỉ có một bản ghi chốt công cho mỗi tháng. Gọi lại `/finalize/` sẽ cập nhật bản ghi hiện có.

---

## 🔗 Tài liệu liên quan

- [HRM Configuration Guide](HRM_CONFIGURATION_GUIDE.md)
- [Attendance Rule System Design](ATTENDANCE_RULE_SYSTEM_DESIGN.md)
