# API Import Nhân Viên Hàng Loạt

## Tổng quan

API cho phép upload file CSV hoặc Excel để tạo mới hoặc cập nhật nhiều nhân viên cùng lúc.  
Mỗi dòng trong file tương ứng với một nhân viên. Nếu mã nhân viên đã tồn tại thì **cập nhật**, nếu chưa có thì **tạo mới** (kèm tài khoản user tự động).

---

## Endpoint

```
POST /api-hrm/employees/import/
```

**Content-Type:** `multipart/form-data`

**Authentication:** Bearer JWT (bắt buộc)

---

## Request

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `file` | File | ✅ | File CSV, XLS hoặc XLSX. Tối đa **10 MB**. |

**Ví dụ cURL:**
```bash
curl -X POST https://your-domain.com/api-hrm/employees/import/ \
  -H "Authorization: Bearer <token>" \
  -F "file=@nhan_vien.xlsx"
```

---

## Response

### Thành công – tất cả dòng OK (HTTP 200)
```json
{
  "success": true,
  "summary": {
    "total": 50,
    "created": 45,
    "updated": 5,
    "failed": 0
  },
  "errors": []
}
```

### Thành công – có một số dòng lỗi/cảnh báo (HTTP 207)
```json
{
  "success": true,
  "summary": {
    "total": 50,
    "created": 43,
    "updated": 5,
    "failed": 2
  },
  "errors": [
    {
      "row": 3,
      "employee_id": "NV00042",
      "warnings": ["Không có mã nhân viên, đã tự sinh mã mới"]
    },
    {
      "row": 7,
      "employee_id": "NV00015",
      "errors": ["Giới tính không hợp lệ: 'unknown'"]
    }
  ]
}
```

### Lỗi file không hợp lệ (HTTP 400)
```json
{
  "success": false,
  "errors": {
    "file": ["Chỉ chấp nhận file CSV, XLS hoặc XLSX."]
  }
}
```

### Lỗi server (HTTP 500)
```json
{
  "success": false,
  "message": "Import thất bại. Vui lòng kiểm tra lại file và thử lại."
}
```

---

## Cột trong file

Tên cột **không phân biệt hoa/thường**, hỗ trợ tên tiếng Việt lẫn tiếng Anh.

### Thông tin cơ bản

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `mã nhân viên` | `mã nv`, `employee id`, `employee_id`, `mã` | `employee_id` |
| `họ và tên` | `họ tên`, `full name`, `full_name`, `tên` | `full_name` |
| `giới tính` | `gender` | `gender` |
| `ngày sinh` | `date of birth`, `dob` | `date_of_birth` |
| `số điện thoại` | `phone`, `phone number`, `điện thoại` | `phone_number` |
| `email cá nhân` | `email`, `personal email` | `personal_email` |
| `facebook` | `facebook link` | `facebook_link` |

### Tổ chức

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `vùng/miền` | `vùng`, `region` | `region` |
| `khối` | `block` | `block` |
| `bộ phận` | `section` | `section` |
| `cấp bậc` | `rank` | `rank` |
| `địa điểm làm việc` | `work location` | `work_location` |
| `team bác sĩ` | `doctor team` | `doctor_team` |
| `mã phòng ban` | `department code`, `phòng ban` | `department_code` |
| `mã vị trí` | `position code`, `vị trí`, `chức danh` | `position_code` |
| `mã quản lý` | `manager code`, `quản lý`, `quản lý trực tiếp` | `manager_code` |

### Hợp đồng & làm việc

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `hình thức làm việc` | `work form` | `work_form` |
| `trình độ học vấn` | `education level`, `học vấn` | `education_level` |
| `loại hợp đồng` | `contract type` | `contract_type` |
| `ngày bắt đầu` | `start date`, `ngày vào làm` | `start_date` |
| `ngày kết thúc` | `end date`, `ngày nghỉ việc` | `end_date` |
| `ngày kết thúc thử việc` | `probation end date` | `probation_end_date` |
| `ngày lên chính thức` | `official start date` | `official_start_date` |
| `tháng thử việc` | `probation months` | `probation_months` |
| `tỉ lệ thử việc` | `probation rate` | `probation_rate` |
| `trạng thái làm việc` | `employment status` | `employment_status` |
| `ghi chú trạng thái` | — | `employment_status_notes` |
| `lý do nghỉ việc` | — | `termination_reason` |

### Lương & phụ cấp

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `lương cơ bản` | `basic salary` | `basic_salary` |
| `phụ cấp` | `allowance` | `allowance` |
| `ghi chú lương` | — | `salary_notes` |
| `ghi chú phụ cấp` | — | `allowance_notes` |

### Ngân hàng

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `tên ngân hàng` | `bank name` | `bank_name` |
| `số tài khoản` | `bank account` | `bank_account` |
| `chi nhánh ngân hàng` | `bank branch` | `bank_branch` |

### BHXH & thuế

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `mã bhxh` | `social insurance` | `social_insurance_number` |
| `mã số thuế` | `tax code` | `tax_code` |
| `mã hộ gia đình` | — | `household_code` |
| `đang tham gia đóng` | `insurance participation` | `insurance_participation` |
| `thời điểm báo tăng` | — | `insurance_increase_time` |

### CCCD & địa chỉ

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `số cccd` | `cccd` | `cccd_number` |
| `số cmnd cũ` | `cmnd` | `old_id_number` |
| `ngày cấp cccd` | — | `cccd_issue_date` |
| `nơi cấp cccd` | — | `cccd_issue_place` |
| `nơi khai sinh` | — | `birth_place` |
| `nơi thường trú` | — | `permanent_residence` |
| `địa chỉ hiện tại` | — | `current_address` |
| `tình trạng hôn nhân` | `marital status` | `marital_status` |
| `dân tộc` | `ethnicity` | `ethnicity` |
| `quốc tịch` | `nationality` | `nationality` |

### Người liên hệ khẩn cấp

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `người liên hệ khẩn cấp` | `emergency contact name` | `emergency_contact_name` |
| `mối quan hệ` | `emergency contact relationship` | `emergency_contact_relationship` |
| `sđt người thân` | `emergency contact phone` | `emergency_contact_phone` |
| `ngày sinh người thân` | — | `emergency_contact_dob` |
| `nghề nghiệp người thân` | — | `emergency_contact_occupation` |
| `địa chỉ người liên hệ` | — | `emergency_contact_address` |

### Hồ sơ & tài liệu

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `trạng thái hồ sơ` | `file status` | `file_status` |
| `hạn nộp hồ sơ` | — | `file_submission_deadline` |
| `ngày nộp hồ sơ` | — | `file_submission_date` |
| `ghi chú hồ sơ` | — | `file_review_notes` |
| `sơ yếu lý lịch` | — | `doc_resume` (boolean) |
| `cccd (hồ sơ)` | — | `doc_cccd` (boolean) |
| `bằng cấp` | — | `doc_degree` (boolean) |
| `giấy khám sức khỏe` | — | `doc_health` (boolean) |

### Khác

| Tên cột (ví dụ) | Alias khác | Trường model |
|-----------------|------------|--------------|
| `ghi chú` | `notes` | `notes` |
| `đang hoạt động` | `is active` | `is_active` (boolean) |
| `là nhân viên hr` | `is hr` | `is_hr` (boolean) |

---

## Giá trị hợp lệ cho các trường Choice

### `gender` – Giới tính
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Nam` | `M` |
| `Nữ` | `F` |
| `Khác` | `O` |

### `employment_status` – Trạng thái làm việc
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Đang làm việc` | `ACTIVE` |
| `Tạm dừng` | `PAUSED` |
| `Đã nghỉ` | `INACTIVE` |

### `work_form` – Hình thức làm việc
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Toàn thời gian` | `FULL_TIME` |
| `Bán thời gian` | `PART_TIME` |
| `Hợp đồng` | `CONTRACT` |
| `Thực tập` | `INTERN` |
| `Cộng tác viên` | `COLLABORATOR` |

### `contract_type` – Loại hợp đồng
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Hợp đồng thử việc` | `PROBATION` |
| `Hợp đồng thực tập sinh` | `INTERN` |
| `Hợp đồng cộng tác viên` | `COLLABORATOR` |
| `Hợp đồng lao động 12 tháng` | `ONE_YEAR` |
| `Hợp đồng lao động 24 tháng` | `TWO_YEAR` |
| `Hợp đồng vô thời hạn` | `INDEFINITE` |
| `Hợp đồng dịch vụ` | `SERVICE` |
| `Thoả thuận bảo mật` | `CONFIDENTIALITY` |
| `Cam kết đọc hiểu nội quy công ty` | `COMPANY_RULES` |
| `Cam kết của CBNV Điều dưỡng` | `NURSING_COMMITMENT` |

### `file_status` – Trạng thái hồ sơ
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Nộp đủ` | `COMPLETE` |
| `Cần bổ sung hồ sơ` | `NEED_SUPPLEMENT` |
| `Chưa nộp` | `NOT_SUBMITTED` |
| `Chờ rà soát` | `PENDING_REVIEW` |

### `probation_rate` – Tỉ lệ thử việc
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Tháng đầu 85%, tháng sau 85%` | `OPTION_1` |
| `Tháng đầu 85%, tháng sau 100%` | `OPTION_2` |
| `Tháng đầu 100%, tháng sau 100%` | `OPTION_3` |

### `work_location` – Địa điểm làm việc
| Giá trị trong file | Lưu |
|-------------------|-----|
| `Văn phòng Hà Nội` | `VP_HA_NOI` |
| `Văn phòng TP. Hồ Chí Minh` | `VP_HCM` |

> **Lưu ý:** Tất cả các trường choice đều chấp nhận cả **giá trị hiển thị** (tiếng Việt) lẫn **mã code** (chữ in hoa, ví dụ `ACTIVE`, `M`, `FULL_TIME`).

---

## Quy tắc xử lý

### Mã nhân viên (`employee_id`)
- Nếu **có** trong file: dùng để tìm nhân viên (upsert).
- Nếu **không có**: hệ thống **tự sinh mã mới** theo dạng `NV00001` → `NV99999` (lấy số lớn nhất hiện có + 1). Một cảnh báo sẽ được ghi vào `errors[]`.

### Tạo tài khoản user tự động (chỉ khi tạo mới)
- **Username:** = `employee_id`
- **Mật khẩu mặc định:** `ChangeMe@2024` (hoặc giá trị env `EMPLOYEE_IMPORT_DEFAULT_PASSWORD`)

### Phòng ban / Vị trí / Quản lý
- Tra cứu theo **mã code** trước, nếu không thấy thì tra theo **tên**.
- Nếu vẫn không tìm thấy: ghi cảnh báo, bỏ qua trường đó (không làm thất bại cả dòng).

### Ngày tháng
Hỗ trợ nhiều định dạng: `DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`, giá trị datetime từ Excel, v.v.

### Boolean
Các giá trị được coi là `true`: `1`, `true`, `yes`, `có`, `x`.  
Các giá trị còn lại (hoặc rỗng) là `false`.

### Tính toán per-row
Mỗi dòng xử lý trong một transaction riêng. Dòng lỗi không ảnh hưởng đến các dòng khác.

---

## Ví dụ file CSV tối giản

```csv
mã nhân viên,họ và tên,giới tính,ngày sinh,trạng thái làm việc,phòng ban
NV00001,Nguyễn Văn An,Nam,15/03/1990,Đang làm việc,KD
NV00002,Trần Thị Bình,Nữ,22/07/1995,Đang làm việc,HR
,Lê Minh Cường,Nam,01/01/1998,Đang làm việc,IT
```

> Dòng 3 không có mã nhân viên → hệ thống tự sinh mã tiếp theo (ví dụ `NV00003`).

---

## Lỗi thường gặp

| Tình huống | HTTP Status | Mô tả |
|-----------|-------------|-------|
| Không đính kèm file | 400 | `file`: trường bắt buộc |
| Định dạng file sai | 400 | Chỉ chấp nhận `.csv`, `.xls`, `.xlsx` |
| File quá 10 MB | 400 | Vượt giới hạn kích thước |
| File rỗng / không có dữ liệu | 200 | `total: 0`, không có lỗi |
| Có dòng lỗi | 207 | `failed > 0`, xem chi tiết trong `errors[]` |
| Lỗi server | 500 | Kiểm tra lại file và thử lại |
