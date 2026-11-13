/**
 * Kiểu dữ liệu section "misc" của GET /api-hrm/system-rules/ — khớp backend/hrm/system_rules/misc.py.
 * Mỗi section là 1 object con (vd { tên_section: { ... } }); thêm field khi backend thêm.
 */

export interface RuleChoice {
  value: string;
  label: string;
}

/** Chính sách mật khẩu = AUTH_PASSWORD_VALIDATORS của backend (public). */
export interface PasswordRules {
  /** null = backend không cấu hình độ dài tối thiểu. */
  min_length: number | null;
  /** Câu mô tả từng quy tắc (password_validators_help_texts) — hiển thị nguyên văn. */
  help_texts: string[];
  /** Độ dài mật khẩu ngẫu nhiên khi HR cấp lại / nhân viên quên mật khẩu. */
  reset_generated_length: number;
}

/** Thông tin công ty backend dùng trong email / bản in (public). */
export interface BrandingRules {
  company_name: string;
  company_legal_name: string;
  hr_department_label: string;
  /** Địa danh trên văn bản in ("Hà Nội, ngày ..."). */
  company_city: string;
  /** Giờ hạn hoàn thành biên bản xử lý vi phạm (bản in), vd "17h30"; rỗng = không ghi. */
  penalty_report_submit_deadline: string;
}

export interface UploadRules {
  avatar: { max_bytes: number; types: string[] };
  announcement_attachment: { max_bytes: number; extensions: string[] };
  payment_document_attachment: { max_bytes: number; extensions: string[] };
  contract_template: { extensions: string[] };
}

export interface FeedbackRules {
  max_answer_length: number;
  max_images: number;
  max_image_bytes: number;
  /** Định dạng ảnh backend nhận (Pillow), vd "JPEG". */
  image_formats: string[];
  /** MIME tương ứng image_formats — dùng lọc file / accept. */
  image_types: string[];
  topics: RuleChoice[];
  /** Vấn đề do bộ phận IT xử lý; còn lại HCNS xử lý. */
  it_topics: string[];
  questions: { field: string; question: string }[];
}

export interface ChatRules {
  image_max_bytes: number;
  image_types: string[];
  reaction_source_max_bytes: number;
  /** Cạnh icon reaction sau khi backend chuẩn hoá (px). */
  reaction_icon_px: number;
}

export interface AssetRules {
  /** Loại chuẩn; "Phân loại" ngoài danh sách là loại tự do. */
  standard_types: RuleChoice[];
  type_max_length: number;
  /** Tên gọi khác (viết thường) -> mã chuẩn. */
  type_aliases: Record<string, string>;
  /** Loại có Số lượng + bàn giao nhiều người (loại tự do cũng vậy). */
  multi_holder_types: string[];
  /** Tình trạng không được bàn giao. */
  unassignable_conditions: string[];
}

export interface RecruitmentRules {
  need_statuses: RuleChoice[];
}

export interface RegulationRules {
  /** Số giây tối thiểu mở tài liệu trước khi được bấm "Đã đọc". */
  min_read_seconds: number;
}

export interface AccountRules {
  /** Thời gian chờ giữa 2 lần "Gửi email tài khoản cho tất cả". */
  send_all_emails_cooldown_seconds: number;
}

export interface MiscRules {
  password?: PasswordRules;
  branding?: BrandingRules;
  uploads?: UploadRules;
  feedback?: FeedbackRules;
  chat?: ChatRules;
  assets?: AssetRules;
  recruitment?: RecruitmentRules;
  regulation?: RegulationRules;
  account?: AccountRules;
}
