import { managementApi } from '../utils/api';

/** Một kỳ đóng BHXH (từ tháng … đến tháng, lưu ngày 01). */
export interface SocialInsurancePeriod {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  from_month: string;
  to_month: string | null;
  contribution_level: number;
  /** % — API trả dạng chuỗi thập phân */
  employee_rate: string | number;
  employer_rate: string | number;
  note: string;
  created_at: string;
  updated_at: string;
}

const BASE = '/api-hrm/social-insurance-periods/';

export async function listSocialInsurancePeriods(employeeId: number): Promise<SocialInsurancePeriod[]> {
  const response = await managementApi.get(BASE, { params: { employee: employeeId } });
  return Array.isArray(response.data) ? response.data : response.data.results ?? [];
}

export async function createSocialInsurancePeriod(data: {
  employee: number;
  from_month: string;
  to_month: string | null;
  contribution_level: number;
  employee_rate?: number;
  employer_rate?: number;
  note?: string;
}): Promise<SocialInsurancePeriod> {
  const response = await managementApi.post(BASE, data);
  return response.data;
}

export async function updateSocialInsurancePeriod(
  id: number,
  data: Partial<{ to_month: string | null; contribution_level: number; note: string }>,
): Promise<SocialInsurancePeriod> {
  const response = await managementApi.patch(`${BASE}${id}/`, data);
  return response.data;
}

export async function deleteSocialInsurancePeriod(id: number): Promise<void> {
  await managementApi.delete(`${BASE}${id}/`);
}
