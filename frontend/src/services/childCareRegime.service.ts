import { managementApi } from '../utils/api';

/** Chế độ con nhỏ: mỗi ngày trong khoảng được đi muộn / về sớm tối đa `allowance_minutes` phút. */
export interface ChildCareRegime {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  start_date: string;
  end_date: string | null;
  allowance_minutes: number;
  note: string;
  created_at: string;
  updated_at: string;
}

const BASE = '/api-hrm/child-care-regimes/';

export async function listChildCareRegimes(): Promise<ChildCareRegime[]> {
  const response = await managementApi.get(BASE);
  return Array.isArray(response.data) ? response.data : response.data.results ?? [];
}

export async function createChildCareRegime(data: {
  employee: number;
  start_date: string;
  end_date: string | null;
  allowance_minutes: number;
  note?: string;
}): Promise<ChildCareRegime> {
  const response = await managementApi.post(BASE, data);
  return response.data;
}

export async function updateChildCareRegime(
  id: number,
  data: Partial<Pick<ChildCareRegime, 'start_date' | 'end_date' | 'allowance_minutes' | 'note'>>,
): Promise<ChildCareRegime> {
  const response = await managementApi.patch(`${BASE}${id}/`, data);
  return response.data;
}

export async function deleteChildCareRegime(id: number): Promise<void> {
  await managementApi.delete(`${BASE}${id}/`);
}
