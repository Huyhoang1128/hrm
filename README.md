# HRM

Hệ thống quản lý nhân sự: hồ sơ nhân viên, chấm công, đơn từ và phê duyệt, chốt công, tính lương,
hợp đồng, onboarding/offboarding, tài sản, tuyển dụng, KPI và chat nội bộ.

| Thư mục | Công nghệ |
| --- | --- |
| [backend/](backend/) | Django 5.2, Django REST Framework, JWT (simplejwt), PostgreSQL (SQLite khi dev) |
| [frontend/](frontend/) | React 18, TypeScript, Vite 5, Tailwind CSS |

## Chạy local

### Backend

```bash
cd backend
py -3.13 -m venv .venv                      # Linux/macOS: python3 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cp .env.example .env                        # để trống DATABASE_URL => dùng SQLite
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py createsuperuser
.venv/Scripts/python manage.py runserver 8000
```

Seed cấu hình mặc định (tuỳ chọn): `python manage.py <lệnh>` với `seed_rules`, `seed_shift_config`,
`seed_leave_policy`, `seed_attendance_policy`, `seed_tax_bracket_config`,
`populate_notification_templates`.

Chạy test: `PYTHONUTF8=1 python manage.py test --parallel 1`. Trên Windows cần `PYTHONUTF8=1`,
nếu không log tiếng Việt sẽ làm hỏng output.

API docs: <http://localhost:8000/swagger/>

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env.local      # VITE_API_BASE_URL trỏ về backend
npm run dev                     # http://localhost:3000
```

## Cấu hình công ty / thương hiệu

Tên công ty, logo, chữ ký email và mật khẩu mặc định đều lấy từ biến môi trường:

- **Backend**: `COMPANY_NAME`, `COMPANY_LEGAL_NAME`, `HR_DEPARTMENT_LABEL`, `HR_CONTACT_ADDRESS`,
  `HR_CONTACT_PHONE`, `EMAIL_LOGO_URL`, `EMAIL_BANNER_URL`, `DEFAULT_PASSWORD_PREFIX`,
  `EMPLOYEE_ID_FALLBACK_PREFIX`. Xem [backend/.env.example](backend/.env.example) và
  [backend/hrm/branding.py](backend/hrm/branding.py).
- **Frontend**: `VITE_APP_NAME`, `VITE_COMPANY_NAME`, `VITE_LOGO_URL`… Xem
  [frontend/.env.example](frontend/.env.example) và
  [frontend/src/config/brand.ts](frontend/src/config/brand.ts).
  Logo mặc định nằm ở [frontend/public/logo.svg](frontend/public/logo.svg).

## Kế hoạch

Xem [docs/ROADMAP.md](docs/ROADMAP.md).
