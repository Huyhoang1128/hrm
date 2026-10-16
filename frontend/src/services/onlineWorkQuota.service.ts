import { managementApi } from '../utils/api';

export type OnlineWorkQuotaScope = 'employee' | 'position' | 'department';

export interface OnlineWorkQuotaOverride {
  id: number;
  employee: number | null;
  position: number | null;
  department: number | null;
  /** Số ngày (có thể lẻ 0.5), API trả dạng chuỗi thập phân */
  max_online_days: string | number;
  employee_detail: { id: number; employee_id: string; full_name: string } | null;
  position_detail: { id: number; title: string } | null;
  department_detail: { id: number; name: string } | null;
  updated_at: string;
}

const BASE = '/api-hrm/online-work-quota-overrides/';

export async function listOnlineWorkQuotaOverrides(): Promise<OnlineWorkQuotaOverride[]> {
  const response = await managementApi.get(BASE, { params: { page_size: 500 } });
  return response.data.results ?? response.data;
}

export async function createOnlineWorkQuotaOverride(data: {
  employee?: number | null;
  position?: number | null;
  department?: number | null;
  max_online_days: number;
}): Promise<OnlineWorkQuotaOverride> {
  const response = await managementApi.post(BASE, data);
  return response.data;
}

export async function updateOnlineWorkQuotaOverride(id: number, data: { max_online_days: number }): Promise<OnlineWorkQuotaOverride> {
  const response = await managementApi.patch(`${BASE}${id}/`, data);
  return response.data;
}

export async function deleteOnlineWorkQuotaOverride(id: number): Promise<void> {
  await managementApi.delete(`${BASE}${id}/`);
}
