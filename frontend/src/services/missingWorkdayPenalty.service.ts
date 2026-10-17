import { managementApi } from '../utils/api';

/** 1 nhân viên trong danh sách phạt thiếu công, áp dụng từ tháng … đến tháng (lưu ngày 01). */
export interface MissingWorkdayPenalty {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  /** Nhân viên đang có lương cơ bản — thường chỉ áp dụng cho người không có lương cứng */
  has_basic_salary: boolean;
  from_month: string;
  to_month: string | null;
  /** Mốc lương tính phạt (VNĐ), API trả dạng chuỗi thập phân */
  base_amount: string | number;
  note: string;
  created_at: string;
  updated_at: string;
}

const BASE = '/api/v1/salary/missing-workday-penalties/';

export async function listMissingWorkdayPenalties(): Promise<MissingWorkdayPenalty[]> {
  const response = await managementApi.get(BASE);
  return Array.isArray(response.data) ? response.data : response.data.results ?? [];
}

export async function createMissingWorkdayPenalty(data: {
  employee: number;
  from_month: string;
  to_month: string | null;
  base_amount: number;
  note?: string;
}): Promise<MissingWorkdayPenalty> {
  const response = await managementApi.post(BASE, data);
  return response.data;
}

export async function updateMissingWorkdayPenalty(
  id: number,
  data: Partial<{ to_month: string | null; base_amount: number; note: string }>,
): Promise<MissingWorkdayPenalty> {
  const response = await managementApi.patch(`${BASE}${id}/`, data);
  return response.data;
}

export async function deleteMissingWorkdayPenalty(id: number): Promise<void> {
  await managementApi.delete(`${BASE}${id}/`);
}
