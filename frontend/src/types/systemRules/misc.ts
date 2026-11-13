/**
 * Kiểu dữ liệu section "misc" của GET /api-hrm/system-rules/ — khớp backend/hrm/system_rules/misc.py.
 * Mỗi section là 1 object con (vd { tên_section: { ... } }); thêm field khi backend thêm.
 */

/** Chính sách mật khẩu = AUTH_PASSWORD_VALIDATORS của backend (public). */
export interface PasswordRules {
  /** null = backend không cấu hình độ dài tối thiểu. */
  min_length: number | null;
  /** Câu mô tả từng quy tắc (password_validators_help_texts) — hiển thị nguyên văn. */
  help_texts: string[];
  /** Độ dài mật khẩu ngẫu nhiên khi HR cấp lại / nhân viên quên mật khẩu. */
  reset_generated_length: number;
}

export interface MiscRules {
  password?: PasswordRules;
}
