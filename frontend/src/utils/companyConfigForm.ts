/**
 * Ô số của form Cấu hình công ty (tạo / sửa).
 *
 * Giá trị mặc định khi tạo mới và min / max / step của ô nhập lấy từ backend
 * (GET /api-hrm/system-rules/, section "hr", key company_config_fields — tính từ field model CompanyConfig
 * + khoảng nghiệp vụ ở backend/hrm/company_config_rules.py). Trước đây ghi cứng ở web và lệch model
 * (nghỉ ốm 12 vs 5, nghỉ thai sản cho cha 14 vs 5, hệ số OT cho tới 10 trong khi cột chỉ chứa 9.99),
 * và gửi `Number(x) || mặc định` nên số 0 bị đổi thành mặc định.
 */
import type { NumericFieldRule } from '../types/systemRules/hr';

export type CompanyConfigFieldRules = Record<string, NumericFieldRule>;

/** Thuộc tính min / max / step cho <input type="number"> theo backend; chưa tải được thì không đặt. */
export const numberInputProps = (rules: CompanyConfigFieldRules | null, name: string) => {
  const rule = rules?.[name];
  if (!rule) return {};
  return { min: rule.min ?? undefined, max: rule.max ?? undefined, step: rule.step };
};

/** Giá trị mặc định (default của field model) cho các ô chưa có giá trị — dùng khi tạo mới. */
export const withFieldDefaults = <T extends Record<string, any>>(form: T, rules: CompanyConfigFieldRules): T => {
  const next: Record<string, any> = { ...form };
  for (const [name, rule] of Object.entries(rules)) {
    if (next[name] === undefined) next[name] = rule.default;
  }
  return next as T;
};

/**
 * Payload các ô số có trên form: gửi đúng số đã nhập (kể cả 0). Ô để trống: field cho phép null thì gửi
 * null, còn lại không gửi (backend giữ giá trị cũ / dùng mặc định của model).
 */
export const numericPayload = (
  form: Record<string, any>,
  fields: readonly string[],
  rules: CompanyConfigFieldRules | null,
): Record<string, number | null> => {
  const out: Record<string, number | null> = {};
  for (const name of fields) {
    const raw = form[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (rules?.[name]?.nullable) out[name] = null;
      continue;
    }
    out[name] = Number(raw);
  }
  return out;
};

/** Các ô số đang có trên form Cấu hình công ty (tên field model). */
export const COMPANY_CONFIG_FORM_NUMERIC_FIELDS = [
  'default_working_hours_per_day',
  'default_working_days_per_week',
  'overtime_multiplier_weekday',
  'overtime_multiplier_weekend',
  'overtime_multiplier_holiday',
  'late_threshold_minutes',
  'early_leave_threshold_minutes',
  'half_day_threshold_hours',
  'annual_leave_days_per_year',
  'sick_leave_days_per_year',
  'maternity_leave_days',
  'paternity_leave_days',
  'max_explanation_count_per_month',
  'supplement_work_hours_per_month',
  'max_late_explanation_per_month',
  'max_early_leave_explanation_per_month',
  'max_incomplete_attendance_explanation_per_month',
  'manager_combined_explanation_quota',
  'manager_incomplete_explanation_quota',
] as const;
