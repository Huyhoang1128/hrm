/**
 * Kiểu dữ liệu section "payroll" của GET /api-hrm/system-rules/ — khớp backend/hrm/system_rules/payroll.py.
 * Mỗi section là 1 object con (vd { tên_section: { ... } }); thêm field khi backend thêm.
 *
 * Bảng lương / phiếu lương KHÔNG tính lại trên web (mọi số đã có trong dòng lương backend trả về);
 * section này chỉ cho phần "xem trước" khi cấu hình lương 1 nhân viên và các câu chữ giải thích.
 */

/** Một bậc thuế TNCN luỹ tiến (max null = không giới hạn). */
export interface PayrollTaxBracketRule {
  min: number;
  max: number | null;
  rate: number;
}

export interface PayrollRegionalMinimumRule {
  /** null = áp cho mọi ngày trước mốc của dòng phía trên (danh sách mới nhất trước) */
  effective_from: string | null;
  legal_basis: string;
  by_region: Record<'I' | 'II' | 'III' | 'IV', number>;
}

export interface PayrollRules {
  payroll?: {
    /** Tỷ lệ BH phần người lao động (0.08 = 8%) */
    insurance_rates: { bhxh: number; bhyt: number; bhtn: number; total: number };
    /** Trần mức lương đóng BH = hệ số × lương cơ sở (BHXH, BHYT) / × lương tối thiểu vùng (BHTN) — chỉ phần xem trước */
    insurance_salary_cap_multiplier: number;
    /** Thuế khấu trừ cố định (mọi phương pháp FLAT_*) */
    flat_tax_rate: number;
    /** Biểu thuế + giảm trừ gia cảnh bảng lương áp cho hôm nay (cấu hình trong DB hoặc biểu mặc định) */
    tax: {
      as_of: string;
      source: 'config' | 'default';
      personal_deduction: number;
      dependent_deduction: number;
      brackets: PayrollTaxBracketRule[];
    };
    /** Lương cơ sở theo ngày hiệu lực (mới nhất trước) */
    base_salary_history: Array<{ effective_from: string | null; amount: number }>;
    /** Lương tối thiểu vùng theo ngày hiệu lực (mới nhất trước) */
    regional_minimum_history: PayrollRegionalMinimumRule[];
    /** Trần phụ cấp ăn trưa/tháng; trần riêng để trống / 0 = dùng trần này */
    lunch_allowance_max_cap: number;
    /** Mức gửi xe/ngày mặc định của chính sách chấm công */
    parking_allowance_per_day: number;
    /** Đơn giá OT tính từ lương: lương cơ bản ÷ công chuẩn ÷ số giờ này */
    ot_hours_per_day: number;
  };
}
