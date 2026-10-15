import { managementApi } from '../utils/api';

export interface BranchLocation {
  id: number;
  name: string;
  company_unit: number | null;
  company_unit_name?: string | null;
  address: string;
  latitude: string;
  longitude: string;
  radius_meters: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BranchLocationPayload {
  name: string;
  company_unit: number | null;
  address: string;
  latitude: string;
  longitude: string;
  radius_meters: number;
  is_active: boolean;
}

const baseUrl = '/api-hrm/branch-locations/';

export const branchLocationService = {
  async list(): Promise<BranchLocation[]> {
    const response = await managementApi.get(baseUrl, { params: { page_size: 500 } });
    return response.data?.results || response.data || [];
  },
  async create(payload: BranchLocationPayload): Promise<BranchLocation> {
    const response = await managementApi.post(baseUrl, payload);
    return response.data;
  },
  async update(id: number, payload: BranchLocationPayload): Promise<BranchLocation> {
    const response = await managementApi.put(`${baseUrl}${id}/`, payload);
    return response.data;
  },
  async remove(id: number): Promise<void> {
    await managementApi.delete(`${baseUrl}${id}/`);
  },
};
