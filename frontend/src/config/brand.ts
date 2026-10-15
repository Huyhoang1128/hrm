// Thông tin thương hiệu dùng chung cho toàn app. Đổi tên/logo ở đây
// (hoặc qua biến môi trường VITE_*) thay vì sửa rải rác trong các trang.
export const BRAND = {
  appName: import.meta.env.VITE_APP_NAME || 'HRM',
  companyName: import.meta.env.VITE_COMPANY_NAME || 'Công ty của bạn',
  companyLegalName: import.meta.env.VITE_COMPANY_LEGAL_NAME || 'CÔNG TY CỦA BẠN',
  hrDepartmentLabel: import.meta.env.VITE_HR_DEPARTMENT_LABEL || 'Phòng Hành chính - Nhân sự',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || '',
  logoUrl: import.meta.env.VITE_LOGO_URL || '/logo.svg',
  defaultPasswordPrefix: import.meta.env.VITE_DEFAULT_PASSWORD_PREFIX || 'hrm',
} as const;
