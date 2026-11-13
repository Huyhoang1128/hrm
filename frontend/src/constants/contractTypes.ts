/**
 * Nhóm loại hợp đồng của nhân viên (contract_type) — NGUỒN DUY NHẤT là backend (employee.models:
 * PROBATION_CONTRACT_TYPES, NON_OFFICIAL_CONTRACT_TYPES, OFFICIAL_LABOR_CONTRACT_TYPES, LABOR_CONTRACT_TYPES),
 * trả qua GET /api-hrm/system-rules/ (section "choices", key contract_type_groups).
 *
 * Các mảng dưới đây được điền khi quy định tải xong (bắt đầu tải ngay khi module được import); trước đó
 * rỗng nên các hàm kiểm tra trả false thay vì đoán. Component React nên dùng useHrChoices() (utils/hrChoices)
 * để re-render khi dữ liệu về; mảng ở đây dành cho hàm thuần không phải component.
 */
import { getSystemRules } from '../services/systemRules.service';
import type { HrChoices } from '../types/systemRules/hr';

export const PROBATION_CONTRACT_TYPES: string[] = [];
export const NON_OFFICIAL_CONTRACT_TYPES: string[] = [];
export const OFFICIAL_LABOR_CONTRACT_TYPES: string[] = [];
/** HĐ lao động thực sự (không gồm cam kết / thoả thuận). */
export const LABOR_CONTRACT_TYPES: string[] = [];

/** Ghi nhóm loại HĐ (giữ nguyên tham chiếu mảng để nơi đã import vẫn thấy dữ liệu mới). */
export function setContractTypeGroups(groups: HrChoices['contract_type_groups']): void {
  const fill = (target: string[], codes: string[]) => target.splice(0, target.length, ...codes);
  fill(PROBATION_CONTRACT_TYPES, groups.probation);
  fill(NON_OFFICIAL_CONTRACT_TYPES, groups.non_official);
  fill(OFFICIAL_LABOR_CONTRACT_TYPES, groups.official_labor);
  fill(LABOR_CONTRACT_TYPES, groups.labor);
}

getSystemRules()
  .then((rules) => {
    if (rules.choices) setContractTypeGroups(rules.choices.contract_type_groups);
  })
  .catch(() => {
    // Lỗi mạng: giữ mảng rỗng (không đoán); lần gọi getSystemRules() sau sẽ thử lại.
  });

export const isProbationContract = (contractType?: string | null) =>
  !!contractType && PROBATION_CONTRACT_TYPES.includes(contractType);
