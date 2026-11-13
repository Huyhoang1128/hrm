import { useSystemRules } from '../services/systemRules.service';

// Thông tin thương hiệu dùng chung cho toàn app. Đổi tên/logo ở đây
// (hoặc qua biến môi trường VITE_*) thay vì sửa rải rác trong các trang.
// Tên công ty / phòng HCNS mà backend cũng in trong email, bản in: dùng useBrand() để lấy đúng giá trị
// backend (COMPANY_NAME, HR_DEPARTMENT_LABEL... qua system-rules "branding").
export const BRAND = {
  appName: import.meta.env.VITE_APP_NAME || 'HRM',
  companyName: import.meta.env.VITE_COMPANY_NAME || 'Công ty của bạn',
  companyLegalName: import.meta.env.VITE_COMPANY_LEGAL_NAME || 'CÔNG TY CỦA BẠN',
  hrDepartmentLabel: import.meta.env.VITE_HR_DEPARTMENT_LABEL || 'Phòng Hành chính - Nhân sự',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || '',
  logoUrl: import.meta.env.VITE_LOGO_URL || '/logo.svg',
} as const;

/**
 * BRAND với tên công ty / tên pháp lý / phòng HCNS lấy từ backend (cùng giá trị backend dùng trong
 * email và bản in). Trong lúc đang tải dùng tạm giá trị build-time để trang không bị trống chữ.
 */
export function useBrand() {
  const branding = useSystemRules()?.branding;
  if (!branding) return BRAND;
  return {
    ...BRAND,
    companyName: branding.company_name,
    companyLegalName: branding.company_legal_name,
    hrDepartmentLabel: branding.hr_department_label,
  };
}
