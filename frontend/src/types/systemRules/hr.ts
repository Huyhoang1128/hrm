/**
 * Kiểu dữ liệu các section nhân sự của GET /api-hrm/system-rules/ — khớp backend/hrm/system_rules/hr.py.
 *   - hr: quy định trang quản trị nhân sự (cần đăng nhập)
 *   - choices: danh sách lựa chọn lấy từ choices của model (public)
 *   - onboarding: giới hạn form nhận việc công khai (public)
 */

/** 1 lựa chọn: value = mã lưu DB, label = nhãn hiển thị. */
export interface ChoiceOption {
  value: string;
  label: string;
}

/** Giới hạn 1 ô số của Cấu hình công ty (lấy từ field model + khoảng nghiệp vụ ở backend). */
export interface NumericFieldRule {
  default: number | null;
  min: number | null;
  max: number | null;
  step: number;
  nullable: boolean;
}

export interface HrChoices {
  rank: ChoiceOption[];
  employment_status: ChoiceOption[];
  /** Loại HĐ của nhân viên / onboarding. */
  contract_type: ChoiceOption[];
  /** Loại của mẫu / bản hợp đồng (có thêm Phụ lục). */
  contract_document_type: ChoiceOption[];
  contract_type_groups: {
    probation: string[];
    non_official: string[];
    official_labor: string[];
    /** HĐ lao động thực sự (không gồm cam kết / thoả thuận). */
    labor: string[];
  };
  work_form: ChoiceOption[];
  education_level: ChoiceOption[];
  region: ChoiceOption[];
  block: ChoiceOption[];
}

export interface OnboardingFormRules {
  /** Số ký tự tối đa theo tên ô của form. */
  text_max_length: Record<string, number>;
  /** Biểu thức chính quy cho họ tên / người liên hệ / mối quan hệ (dùng được với new RegExp). */
  name_pattern: string;
  phone_digits: number;
  citizen_id_digits: number;
  old_id_digits: number;
  social_insurance_digits: number;
  tax_code_min_digits: number;
  tax_code_max_digits: number;
  min_age: number;
  max_age: number;
  emergency_contact_min_age: number;
  emergency_contact_max_age: number;
  /** yyyy-mm-dd */
  citizen_id_min_issue_date: string;
  citizen_id_file: { extensions: string[]; max_bytes: number };
  vneid_screenshot: { mime_types: string[]; extensions: string[]; max_bytes: number };
  /** Hình thức làm việc được chọn trên form nhận việc. */
  work_form: ChoiceOption[];
}

export interface HrRules {
  hr?: {
    /** Còn <= N ngày tới ngày kết thúc HĐ / thử việc là "sắp hết hạn". */
    contract_expiring_soon_days: number;
    contract_renewal_window_days: { default: number; min: number; max: number };
    company_config_fields: Record<string, NumericFieldRule>;
    company_unit_prefix: { max_length: number; required: boolean };
  };
  choices?: HrChoices;
  onboarding?: OnboardingFormRules;
}
