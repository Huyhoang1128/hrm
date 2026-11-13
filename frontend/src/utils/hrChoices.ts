/**
 * Danh sách lựa chọn nhân sự (cấp bậc, trạng thái làm việc, loại HĐ, hình thức làm việc, học vấn,
 * vùng/miền, khối...) — NGUỒN DUY NHẤT là backend (GET /api-hrm/system-rules/, section "choices").
 *
 * Trước đây mỗi trang tự chép 1 bản (8+ chỗ), lệch nhau và lệch backend (thiếu mã, sai nhãn).
 * Dùng các hàm ở đây thay cho bản chép; đang tải thì danh sách rỗng và nhãn hiện tạm bằng mã.
 */
import { useSystemRules } from '../services/systemRules.service';
import type { ChoiceOption, HrChoices } from '../types/systemRules/hr';

export type { ChoiceOption, HrChoices };

/** Danh sách lựa chọn từ backend — null khi đang tải / lỗi. */
export function useHrChoices(): HrChoices | null {
  return useSystemRules()?.choices ?? null;
}

/** Nhãn của 1 mã theo danh sách backend (so mã không phân biệt hoa thường). Không thấy -> fallback hoặc chính giá trị. */
export function choiceLabel(
  options: ChoiceOption[] | null | undefined,
  value?: string | null,
  fallback?: string | null,
): string {
  if (value === undefined || value === null || value === '') return fallback || '';
  const text = String(value).trim();
  const upper = text.toUpperCase();
  const found = options?.find((o) => o.value.toUpperCase() === upper);
  return found?.label ?? (fallback || text);
}

/** Map mã -> nhãn (cho chỗ cần tra nhiều lần, vd xuất Excel). */
export function choiceMap(options: ChoiceOption[] | null | undefined): Record<string, string> {
  return Object.fromEntries((options ?? []).map((o) => [o.value, o.label]));
}

/** Chỉ giữ các lựa chọn có mã nằm trong nhóm (vd nhóm HĐ lao động). */
export function pickChoices(options: ChoiceOption[] | null | undefined, codes: string[] | null | undefined): ChoiceOption[] {
  if (!options) return [];
  if (!codes) return options;
  return options.filter((o) => codes.includes(o.value));
}

/** Thêm giá trị hiện tại vào cuối nếu không có trong danh sách (dữ liệu cũ) để ô chọn vẫn hiện đúng. */
export function withCurrentChoice(options: ChoiceOption[], current?: string | null): ChoiceOption[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: current }];
}
