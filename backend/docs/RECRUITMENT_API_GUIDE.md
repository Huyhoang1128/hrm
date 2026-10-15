# Recruitment API – Tài liệu tích hợp Frontend

> **Base URL:** `http://localhost:8000`  
> **API prefix:** `/api/v1/recruitment/`  
> **Authentication:** Tất cả endpoints đều yêu cầu JWT Bearer token  
> **Content-Type:** `application/json` (trừ upload file dùng `multipart/form-data`)

---

## Mục lục

1. [Authentication](#1-authentication)
2. [Nhu cầu tuyển dụng (RecruitmentNeed)](#2-nhu-cầu-tuyển-dụng)
3. [Tin tuyển dụng – JD (Job)](#3-tin-tuyển-dụng--jd)
4. [Kênh đăng tuyển (JobChannel)](#4-kênh-đăng-tuyển)
5. [Ứng viên (Candidate)](#5-ứng-viên)
6. [Đơn ứng tuyển – Pipeline (Application)](#6-đơn-ứng-tuyển--pipeline)
7. [Phỏng vấn (Interview)](#7-phỏng-vấn)
8. [Đánh giá phỏng vấn (InterviewEvaluation)](#8-đánh-giá-phỏng-vấn)
9. [Offer Letter (Offer)](#9-offer-letter)
10. [Enum Reference](#10-enum-reference)

---

## 1. Authentication

Sử dụng JWT token (xem `JWT_API_DOCUMENTATION.md`):

```http
Authorization: Bearer <access_token>
```

Lấy token:
```bash
POST /api-hrm/users/token/
{
  "username": "your_username",
  "password": "your_password"
}
```

---

## 2. Nhu cầu tuyển dụng

> Quản lý yêu cầu tuyển dụng từ phòng ban (vị trí, headcount, lương dự kiến).

### 2.1. Danh sách nhu cầu tuyển dụng

```http
GET /api/v1/recruitment/needs/
```

**Query params:**

| Param | Mô tả |
|-------|-------|
| *(không có)* | Trả về tất cả |

**Response 200:**
```json
[
  {
    "id": 1,
    "position_name": "Kỹ sư phần mềm Backend",
    "position_display": "Backend Developer",
    "department_name": "Phòng Công nghệ",
    "headcount": 2,
    "employment_type": "FULL_TIME",
    "employment_type_display": "Toàn thời gian",
    "status": "OPEN",
    "status_display": "Đang mở",
    "target_onboard_date": "2026-06-01",
    "created_at": "2026-04-19T08:00:00Z"
  }
]
```

### 2.2. Nhu cầu đang mở

```http
GET /api/v1/recruitment/needs/open/
```

Trả về các nhu cầu có `status` là `OPEN` hoặc `IN_PROGRESS`.

### 2.3. Chi tiết nhu cầu tuyển dụng

```http
GET /api/v1/recruitment/needs/{id}/
```

**Response 200:**
```json
{
  "id": 1,
  "position_name": "Kỹ sư phần mềm Backend",
  "position": 3,
  "position_display": "Backend Developer",
  "department": 2,
  "department_name": "Phòng Công nghệ",
  "headcount": 2,
  "employment_type": "FULL_TIME",
  "employment_type_display": "Toàn thời gian",
  "expected_salary_min": "15000000",
  "expected_salary_max": "25000000",
  "reason": "Mở rộng đội ngũ kỹ thuật",
  "target_onboard_date": "2026-06-01",
  "status": "OPEN",
  "status_display": "Đang mở",
  "requested_by": 5,
  "requested_by_name": "Nguyễn Văn A",
  "created_at": "2026-04-19T08:00:00Z",
  "updated_at": "2026-04-19T08:00:00Z"
}
```

### 2.4. Tạo nhu cầu tuyển dụng

```http
POST /api/v1/recruitment/needs/
```

**Request body:**
```json
{
  "position_name": "Kỹ sư phần mềm Backend",
  "position": 3,
  "department": 2,
  "headcount": 2,
  "employment_type": "FULL_TIME",
  "expected_salary_min": 15000000,
  "expected_salary_max": 25000000,
  "reason": "Mở rộng đội ngũ kỹ thuật",
  "target_onboard_date": "2026-06-01"
}
```

> `requested_by` được tự động gán theo user đang đăng nhập.

### 2.5. Cập nhật nhu cầu tuyển dụng

```http
PUT /api/v1/recruitment/needs/{id}/
PATCH /api/v1/recruitment/needs/{id}/
```

### 2.6. Xóa nhu cầu tuyển dụng

```http
DELETE /api/v1/recruitment/needs/{id}/
```

---

## 3. Tin tuyển dụng / JD

> Quản lý Job Description (JD), kỹ năng, quyền lợi và vòng đời tin đăng.

### 3.1. Danh sách tin tuyển dụng

```http
GET /api/v1/recruitment/jobs/
```

**Response 200:**
```json
[
  {
    "id": 1,
    "title": "Backend Developer – Python/Django",
    "status": "PUBLISHED",
    "status_display": "Đang đăng",
    "channel_count": 3,
    "published_at": "2026-04-20T09:00:00Z",
    "created_at": "2026-04-19T08:00:00Z"
  }
]
```

### 3.2. Danh sách tin đang đăng

```http
GET /api/v1/recruitment/jobs/published/
```

### 3.3. Chi tiết tin tuyển dụng

```http
GET /api/v1/recruitment/jobs/{id}/
```

**Response 200:**
```json
{
  "id": 1,
  "recruitment_need": 1,
  "title": "Backend Developer – Python/Django",
  "description": "Mô tả chi tiết công việc...",
  "requirements": "- 2+ năm kinh nghiệm Python/Django\n- Hiểu biết về REST API",
  "benefits": "- Lương cạnh tranh\n- Thưởng KPI hàng quý",
  "status": "PUBLISHED",
  "status_display": "Đang đăng",
  "published_at": "2026-04-20T09:00:00Z",
  "closed_at": null,
  "channels": [
    {
      "id": 1,
      "channel_type": "LINKEDIN",
      "channel_type_display": "LinkedIn",
      "url": "https://linkedin.com/jobs/view/123",
      "posted_at": "2026-04-20T10:00:00Z",
      "is_active": true,
      "notes": "",
      "created_at": "2026-04-20T09:30:00Z"
    }
  ],
  "created_by": 5,
  "created_by_name": "Nguyễn Văn A",
  "created_at": "2026-04-19T08:00:00Z",
  "updated_at": "2026-04-20T09:00:00Z"
}
```

### 3.4. Tạo tin tuyển dụng

```http
POST /api/v1/recruitment/jobs/
```

**Request body:**
```json
{
  "recruitment_need": 1,
  "title": "Backend Developer – Python/Django",
  "description": "Mô tả chi tiết công việc...",
  "requirements": "- 2+ năm kinh nghiệm Python/Django",
  "benefits": "- Lương cạnh tranh"
}
```

Tin mới được tạo ở trạng thái `DRAFT`.

### 3.5. Đăng tin (Draft → Published)

```http
POST /api/v1/recruitment/jobs/{id}/publish/
```

> Chỉ áp dụng cho tin ở trạng thái `DRAFT`. `published_at` được tự động set.

**Response 200:** trả về object Job đầy đủ.

### 3.6. Đóng tin

```http
POST /api/v1/recruitment/jobs/{id}/close/
```

> `closed_at` được tự động set. Áp dụng cho mọi trạng thái.

---

## 4. Kênh đăng tuyển

> Một tin tuyển dụng có thể đăng lên nhiều kênh để tracking hiệu quả.

### 4.1. Danh sách kênh (filter theo job)

```http
GET /api/v1/recruitment/job-channels/?job={job_id}
```

### 4.2. Tạo kênh đăng tuyển

```http
POST /api/v1/recruitment/job-channels/
```

**Request body:**
```json
{
  "job": 1,
  "channel_type": "TOPCV",
  "url": "https://topcv.vn/job/123",
  "posted_at": "2026-04-20T10:00:00Z",
  "is_active": true,
  "notes": "Budget: 500k/tháng"
}
```

> Mỗi job chỉ có thể gắn **một lần** với mỗi `channel_type` (unique_together constraint).

### 4.3. Cập nhật kênh

```http
PATCH /api/v1/recruitment/job-channels/{id}/
```

---

## 5. Ứng viên

### 5.1. Danh sách ứng viên

```http
GET /api/v1/recruitment/candidates/
```

**Query params:**

| Param | Mô tả | Ví dụ |
|-------|-------|-------|
| `search` | Tìm theo tên, email, SĐT | `?search=nguyen` |
| `source` | Lọc theo nguồn | `?source=LINKEDIN` |
| `blacklisted` | Lọc blacklist | `?blacklisted=false` |

**Response 200:**
```json
[
  {
    "id": 1,
    "full_name": "Trần Thị B",
    "email": "b.tran@example.com",
    "phone": "0901234567",
    "gender": "F",
    "gender_display": "Nữ",
    "source": "TOPCV",
    "source_display": "TopCV",
    "experience_years": 3,
    "current_position": "Backend Developer",
    "current_company": "Tech Corp",
    "is_blacklisted": false,
    "application_count": 1,
    "created_at": "2026-04-18T07:00:00Z"
  }
]
```

### 5.2. Chi tiết ứng viên

```http
GET /api/v1/recruitment/candidates/{id}/
```

**Response 200:**
```json
{
  "id": 1,
  "full_name": "Trần Thị B",
  "email": "b.tran@example.com",
  "phone": "0901234567",
  "gender": "F",
  "gender_display": "Nữ",
  "date_of_birth": "1995-03-15",
  "address": "Quận 1, TP.HCM",
  "cv_file": "/media/recruitment/cv/cv_tran_thi_b.pdf",
  "cv_url": "https://topcv.vn/cv/123",
  "avatar": null,
  "skills": "Python, Django, PostgreSQL, Docker",
  "experience_years": 3,
  "experience_summary": "3 năm phát triển backend với Python/Django...",
  "education": "Đại học Bách Khoa TP.HCM – Kỹ sư CNTT (2017)",
  "current_company": "Tech Corp",
  "current_position": "Backend Developer",
  "expected_salary": "20000000",
  "source": "TOPCV",
  "source_display": "TopCV",
  "tags": "python,senior,backend",
  "notes": "Ứng viên tiềm năng, ưu tiên",
  "is_blacklisted": false,
  "blacklist_reason": "",
  "created_by": 5,
  "created_by_name": "Nguyễn Văn A",
  "created_at": "2026-04-18T07:00:00Z",
  "updated_at": "2026-04-18T07:00:00Z"
}
```

### 5.3. Tạo ứng viên

```http
POST /api/v1/recruitment/candidates/
Content-Type: multipart/form-data  (khi upload CV/avatar)
```

**Request body:**
```json
{
  "full_name": "Trần Thị B",
  "email": "b.tran@example.com",
  "phone": "0901234567",
  "gender": "F",
  "date_of_birth": "1995-03-15",
  "address": "Quận 1, TP.HCM",
  "cv_url": "https://topcv.vn/cv/123",
  "skills": "Python, Django, PostgreSQL",
  "experience_years": 3,
  "experience_summary": "3 năm phát triển backend...",
  "education": "Đại học Bách Khoa TP.HCM",
  "current_company": "Tech Corp",
  "current_position": "Backend Developer",
  "expected_salary": 20000000,
  "source": "TOPCV",
  "tags": "python,senior,backend",
  "notes": "Ứng viên tiềm năng"
}
```

> `email` phải **unique** trong toàn hệ thống.

### 5.4. Thêm vào blacklist

```http
POST /api/v1/recruitment/candidates/{id}/blacklist/
```

```json
{
  "reason": "Vi phạm hợp đồng tại công ty cũ"
}
```

### 5.5. Xóa khỏi blacklist

```http
POST /api/v1/recruitment/candidates/{id}/unblacklist/
```

---

## 6. Đơn ứng tuyển / Pipeline

> Tracking quá trình tuyển dụng của từng ứng viên theo từng tin.

### 6.1. Danh sách đơn ứng tuyển

```http
GET /api/v1/recruitment/applications/
```

**Query params:**

| Param | Mô tả | Ví dụ |
|-------|-------|-------|
| `job` | Filter theo Job ID | `?job=1` |
| `stage` | Filter theo giai đoạn | `?stage=INTERVIEW` |
| `status` | Filter theo trạng thái | `?status=ACTIVE` |
| `assignee` | Filter theo người phụ trách | `?assignee=5` |

**Response 200:**
```json
[
  {
    "id": 1,
    "candidate": 1,
    "candidate_name": "Trần Thị B",
    "candidate_email": "b.tran@example.com",
    "job": 1,
    "job_title": "Backend Developer – Python/Django",
    "current_stage": "SCREENING",
    "current_stage_display": "Sàng lọc CV",
    "status": "ACTIVE",
    "status_display": "Đang tiến hành",
    "assignee": 5,
    "assignee_name": "Nguyễn Văn A",
    "applied_at": "2026-04-18T10:00:00Z"
  }
]
```

### 6.2. Chi tiết đơn ứng tuyển (kèm lịch sử stage)

```http
GET /api/v1/recruitment/applications/{id}/
```

**Response 200:**
```json
{
  "id": 1,
  "candidate": 1,
  "candidate_detail": { "id": 1, "full_name": "Trần Thị B", "email": "b.tran@example.com", ... },
  "job": 1,
  "job_detail": { "id": 1, "title": "Backend Developer – Python/Django", ... },
  "current_stage": "SCREENING",
  "current_stage_display": "Sàng lọc CV",
  "status": "ACTIVE",
  "status_display": "Đang tiến hành",
  "assignee": 5,
  "assignee_name": "Nguyễn Văn A",
  "source": "TOPCV",
  "rejection_reason": "",
  "rejection_note": "",
  "notes": "",
  "applied_at": "2026-04-18T10:00:00Z",
  "updated_at": "2026-04-19T09:00:00Z",
  "stage_history": [
    {
      "id": 2,
      "stage": "SCREENING",
      "stage_display": "Sàng lọc CV",
      "entered_at": "2026-04-19T09:00:00Z",
      "exited_at": null,
      "changed_by": 5,
      "changed_by_name": "Nguyễn Văn A",
      "note": "CV phù hợp"
    },
    {
      "id": 1,
      "stage": "APPLIED",
      "stage_display": "Đã ứng tuyển",
      "entered_at": "2026-04-18T10:00:00Z",
      "exited_at": "2026-04-19T09:00:00Z",
      "changed_by": null,
      "changed_by_name": null,
      "note": ""
    }
  ]
}
```

### 6.3. Tạo đơn ứng tuyển

```http
POST /api/v1/recruitment/applications/
```

```json
{
  "candidate": 1,
  "job": 1,
  "assignee": 5,
  "source": "TOPCV",
  "notes": "Ứng viên tự apply qua TopCV"
}
```

> Mỗi cặp `(candidate, job)` chỉ tồn tại **một đơn** (unique_together).  
> Stage khởi đầu mặc định là `APPLIED`.

### 6.4. Chuyển stage pipeline

```http
POST /api/v1/recruitment/applications/{id}/move-stage/
```

```json
{
  "stage": "INTERVIEW",
  "note": "Đã xác nhận lịch phỏng vấn vòng 1"
}
```

**Luồng pipeline:**
```
APPLIED → SCREENING → INTERVIEW → TEST → OFFER → HIRED
                                               ↘ REJECTED
                                    ↘ WITHDRAWN (bất kỳ stage)
```

> Khi chuyển sang `HIRED`, `REJECTED`, hoặc `WITHDRAWN`: `Application.status` được cập nhật tương ứng.

**Response 200:** trả về Application đầy đủ kèm `stage_history` mới.

**Các giá trị `stage` hợp lệ:**

| Value | Hiển thị |
|-------|----------|
| `APPLIED` | Đã ứng tuyển |
| `SCREENING` | Sàng lọc CV |
| `INTERVIEW` | Phỏng vấn |
| `TEST` | Kiểm tra/Test |
| `OFFER` | Offer |
| `HIRED` | Đã tuyển |
| `REJECTED` | Bị từ chối |
| `WITHDRAWN` | Ứng viên rút hồ sơ |

---

## 7. Phỏng vấn

### 7.1. Danh sách phỏng vấn

```http
GET /api/v1/recruitment/interviews/
```

**Query params:**

| Param | Mô tả | Ví dụ |
|-------|-------|-------|
| `application` | Filter theo application ID | `?application=1` |
| `status` | Filter theo trạng thái | `?status=SCHEDULED` |

**Response 200:**
```json
[
  {
    "id": 1,
    "application": 1,
    "candidate_name": "Trần Thị B",
    "job_title": "Backend Developer – Python/Django",
    "interview_type": "HR",
    "interview_type_display": "HR",
    "scheduled_at": "2026-04-22T14:00:00Z",
    "duration_minutes": 60,
    "location": "https://meet.google.com/abc-def",
    "status": "SCHEDULED",
    "status_display": "Đã lên lịch"
  }
]
```

### 7.2. Chi tiết phỏng vấn

```http
GET /api/v1/recruitment/interviews/{id}/
```

**Response 200:**
```json
{
  "id": 1,
  "application": 1,
  "interview_type": "HR",
  "interview_type_display": "HR",
  "scheduled_at": "2026-04-22T14:00:00Z",
  "duration_minutes": 60,
  "location": "https://meet.google.com/abc-def",
  "interviewers": [5, 6],
  "interviewer_names": ["Nguyễn Văn A", "Lê Thị C"],
  "status": "SCHEDULED",
  "status_display": "Đã lên lịch",
  "notes": "Tập trung vào kinh nghiệm Django REST Framework",
  "evaluation_count": 0,
  "created_by": 5,
  "created_at": "2026-04-21T10:00:00Z",
  "updated_at": "2026-04-21T10:00:00Z"
}
```

### 7.3. Tạo lịch phỏng vấn

```http
POST /api/v1/recruitment/interviews/
```

```json
{
  "application": 1,
  "interview_type": "TECHNICAL",
  "scheduled_at": "2026-04-22T14:00:00Z",
  "duration_minutes": 90,
  "location": "Phòng họp A3, tầng 3",
  "interviewers": [5, 7],
  "notes": "Kiểm tra technical Python/Django"
}
```

### 7.4. Đánh dấu phỏng vấn đã hoàn thành

```http
POST /api/v1/recruitment/interviews/{id}/mark-done/
```

### 7.5. Hủy lịch phỏng vấn

```http
POST /api/v1/recruitment/interviews/{id}/cancel/
```

---

## 8. Đánh giá phỏng vấn

> Mỗi người phỏng vấn điền đánh giá riêng sau vòng phỏng vấn. Thang điểm 1–5.

### 8.1. Danh sách đánh giá (filter theo interview)

```http
GET /api/v1/recruitment/evaluations/?interview={interview_id}
```

### 8.2. Tạo đánh giá

```http
POST /api/v1/recruitment/evaluations/
```

```json
{
  "interview": 1,
  "technical_score": 4,
  "cultural_fit_score": 5,
  "communication_score": 4,
  "overall_score": 4,
  "strengths": "Kiến thức Django tốt, chủ động trong công việc",
  "weaknesses": "Chưa có kinh nghiệm microservices",
  "recommendation": "Phù hợp với vị trí mid-level",
  "is_recommended": true
}
```

> `evaluator` được tự động gán theo user đang đăng nhập.  
> Mỗi người chỉ có thể đánh giá **một lần** cho mỗi vòng phỏng vấn (unique_together: `interview` + `evaluator`).

**Response 200:**
```json
{
  "id": 1,
  "interview": 1,
  "evaluator": 5,
  "evaluator_name": "Nguyễn Văn A",
  "technical_score": 4,
  "cultural_fit_score": 5,
  "communication_score": 4,
  "overall_score": 4,
  "strengths": "Kiến thức Django tốt",
  "weaknesses": "Chưa có kinh nghiệm microservices",
  "recommendation": "Phù hợp với vị trí mid-level",
  "is_recommended": true,
  "created_at": "2026-04-22T16:00:00Z",
  "updated_at": "2026-04-22T16:00:00Z"
}
```

---

## 9. Offer Letter

### 9.1. Danh sách offers

```http
GET /api/v1/recruitment/offers/
```

### 9.2. Chi tiết offer

```http
GET /api/v1/recruitment/offers/{id}/
```

**Response 200:**
```json
{
  "id": 1,
  "application": 1,
  "candidate_name": "Trần Thị B",
  "job_title": "Backend Developer – Python/Django",
  "proposed_salary": "22000000",
  "allowances": "1500000",
  "position_title": "Backend Developer",
  "probation_months": 2,
  "expected_onboard_date": "2026-05-15",
  "actual_onboard_date": null,
  "status": "PENDING",
  "status_display": "Chờ phản hồi",
  "rejection_note": "",
  "offer_letter_file": null,
  "sent_at": "2026-04-25T09:00:00Z",
  "responded_at": null,
  "created_by": 5,
  "created_by_name": "Nguyễn Văn A",
  "notes": "",
  "created_at": "2026-04-25T09:00:00Z",
  "updated_at": "2026-04-25T09:00:00Z"
}
```

### 9.3. Tạo offer

```http
POST /api/v1/recruitment/offers/
Content-Type: multipart/form-data  (khi đính kèm file offer letter)
```

```json
{
  "application": 1,
  "proposed_salary": 22000000,
  "allowances": 1500000,
  "position_title": "Backend Developer",
  "probation_months": 2,
  "expected_onboard_date": "2026-05-15",
  "sent_at": "2026-04-25T09:00:00Z",
  "notes": "Thống nhất sau vòng final interview"
}
```

> Mỗi `Application` chỉ có **một** Offer (OneToOneField).

### 9.4. Ứng viên chấp nhận offer

```http
POST /api/v1/recruitment/offers/{id}/accept/
```

```json
{
  "actual_onboard_date": "2026-05-15"
}
```

> Tự động cập nhật `Application.status = HIRED` và `Application.current_stage = HIRED`.

### 9.5. Ứng viên từ chối offer

```http
POST /api/v1/recruitment/offers/{id}/reject/
```

```json
{
  "note": "Ứng viên nhận offer từ công ty khác"
}
```

---

## 10. Enum Reference

### Nhu cầu tuyển dụng – `status`

| Value | Hiển thị |
|-------|----------|
| `OPEN` | Đang mở |
| `IN_PROGRESS` | Đang tuyển |
| `FILLED` | Đã tuyển đủ |
| `CANCELLED` | Đã hủy |

### Hình thức làm việc – `employment_type`

| Value | Hiển thị |
|-------|----------|
| `FULL_TIME` | Toàn thời gian |
| `PART_TIME` | Bán thời gian |
| `CONTRACT` | Hợp đồng |
| `INTERN` | Thực tập |
| `COLLABORATOR` | Cộng tác viên |

### Tin tuyển dụng – `status` (Job)

| Value | Hiển thị |
|-------|----------|
| `DRAFT` | Nháp |
| `PUBLISHED` | Đang đăng |
| `CLOSED` | Đóng |

### Kênh đăng tuyển – `channel_type`

| Value | Hiển thị |
|-------|----------|
| `WEBSITE` | Website công ty |
| `LINKEDIN` | LinkedIn |
| `TOPCV` | TopCV |
| `FACEBOOK` | Facebook |
| `ITVIEC` | ITViec |
| `VIETNAMWORKS` | VietnamWorks |
| `CAREERBUILDER` | CareerBuilder |
| `REFERRAL` | Giới thiệu nội bộ |
| `OTHER` | Khác |

### Nguồn ứng viên – `source` (Candidate)

| Value | Hiển thị |
|-------|----------|
| `DIRECT` | Ứng tuyển trực tiếp |
| `REFERRAL` | Giới thiệu nội bộ |
| `LINKEDIN` | LinkedIn |
| `TOPCV` | TopCV |
| `FACEBOOK` | Facebook |
| `WEBSITE` | Website công ty |
| `ITVIEC` | ITViec |
| `VIETNAMWORKS` | VietnamWorks |
| `HEADHUNTER` | Headhunter |
| `OTHER` | Khác |

### Pipeline stage – `current_stage` (Application)

| Value | Hiển thị |
|-------|----------|
| `APPLIED` | Đã ứng tuyển |
| `SCREENING` | Sàng lọc CV |
| `INTERVIEW` | Phỏng vấn |
| `TEST` | Kiểm tra/Test |
| `OFFER` | Offer |
| `HIRED` | Đã tuyển |
| `REJECTED` | Bị từ chối |
| `WITHDRAWN` | Ứng viên rút hồ sơ |

### Application status

| Value | Hiển thị |
|-------|----------|
| `ACTIVE` | Đang tiến hành |
| `HIRED` | Đã tuyển |
| `REJECTED` | Bị từ chối |
| `WITHDRAWN` | Ứng viên rút hồ sơ |

### Lý do từ chối – `rejection_reason`

| Value | Hiển thị |
|-------|----------|
| `SKILLS_MISMATCH` | Không phù hợp kỹ năng |
| `SALARY_MISMATCH` | Không phù hợp mức lương |
| `CULTURE_FIT` | Không phù hợp văn hóa |
| `OVERQUALIFIED` | Quá trình độ |
| `UNDERQUALIFIED` | Thiếu kinh nghiệm |
| `CANDIDATE_WITHDREW` | Ứng viên tự rút |
| `POSITION_CANCELLED` | Vị trí không còn tuyển |
| `OTHER` | Lý do khác |

### Loại phỏng vấn – `interview_type`

| Value | Hiển thị |
|-------|----------|
| `PHONE` | Điện thoại |
| `VIDEO` | Video call |
| `IN_PERSON` | Trực tiếp |
| `TECHNICAL` | Kỹ thuật |
| `HR` | HR |
| `FINAL` | Vòng cuối |

### Trạng thái phỏng vấn – `status` (Interview)

| Value | Hiển thị |
|-------|----------|
| `SCHEDULED` | Đã lên lịch |
| `DONE` | Đã phỏng vấn |
| `CANCELLED` | Đã hủy |
| `NO_SHOW` | Không đến |

### Trạng thái offer – `status` (Offer)

| Value | Hiển thị |
|-------|----------|
| `PENDING` | Chờ phản hồi |
| `ACCEPTED` | Đã chấp nhận |
| `REJECTED` | Đã từ chối |
| `EXPIRED` | Hết hạn |

---

## Ví dụ luồng tuyển dụng hoàn chỉnh

```
1. Tạo nhu cầu tuyển dụng
   POST /api/v1/recruitment/needs/

2. Tạo tin JD
   POST /api/v1/recruitment/jobs/

3. Đăng tin lên các kênh
   POST /api/v1/recruitment/job-channels/   (LINKEDIN)
   POST /api/v1/recruitment/job-channels/   (TOPCV)
   POST /api/v1/recruitment/jobs/{id}/publish/

4. Thêm ứng viên
   POST /api/v1/recruitment/candidates/

5. Tạo đơn ứng tuyển (stage mặc định: APPLIED)
   POST /api/v1/recruitment/applications/

6. Chuyển sang SCREENING
   POST /api/v1/recruitment/applications/{id}/move-stage/  {"stage": "SCREENING"}

7. Lên lịch phỏng vấn HR
   POST /api/v1/recruitment/interviews/
   POST /api/v1/recruitment/applications/{id}/move-stage/  {"stage": "INTERVIEW"}

8. Hoàn thành phỏng vấn + đánh giá
   POST /api/v1/recruitment/interviews/{id}/mark-done/
   POST /api/v1/recruitment/evaluations/

9. Tạo offer
   POST /api/v1/recruitment/applications/{id}/move-stage/  {"stage": "OFFER"}
   POST /api/v1/recruitment/offers/

10. Ứng viên chấp nhận → HIRED
    POST /api/v1/recruitment/offers/{id}/accept/
```
