import { managementApi } from '../utils/api/client';
import { GenericRequestType } from './genericRequest.service';

export interface RequestTemplate {
  id: number;
  name: string;
  request_type: GenericRequestType;
  request_type_display: string;
  company_unit: number;
  company_unit_name: string;
  company_unit_code: string;
  file: string;
  file_url: string;
  file_size: number;
  description: string;
  is_active: boolean;
  created_by: number | null;
  created_by_name: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestTemplateListParams {
  page?: number;
  page_size?: number;
  search?: string;
  request_type?: GenericRequestType | '';
  company_unit?: number | '';
  is_active?: boolean;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

class RequestTemplateService {
  private base = '/api-hrm/request-templates/';

  async list(params: RequestTemplateListParams = {}): Promise<PaginatedResponse<RequestTemplate>> {
    const clean: Record<string, any> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== '' && v !== undefined && v !== null) clean[k] = v;
    });
    const res = await managementApi.get(this.base, { params: clean });
    return res.data;
  }

  async create(data: {
    name: string;
    request_type: GenericRequestType;
    company_unit: number;
    file: File;
    description?: string;
    is_active?: boolean;
  }): Promise<RequestTemplate> {
    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('request_type', data.request_type);
    formData.append('company_unit', String(data.company_unit));
    formData.append('file', data.file);
    if (data.description) formData.append('description', data.description);
    formData.append('is_active', String(data.is_active ?? true));
    const res = await managementApi.post(this.base, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  }

  async update(
    id: number,
    data: Partial<{
      name: string;
      request_type: GenericRequestType;
      company_unit: number;
      file: File;
      description: string;
      is_active: boolean;
    }>
  ): Promise<RequestTemplate> {
    const formData = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined) formData.append(k, v instanceof File ? v : String(v));
    });
    const res = await managementApi.patch(`${this.base}${id}/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  }

  async remove(id: number): Promise<void> {
    await managementApi.delete(`${this.base}${id}/`);
  }

  /**
   * Lấy URL PDF preview cho template (cần auth header → fetch blob).
   * Trả về object URL để gán vào <iframe src>.
   */
  async previewPdf(id: number): Promise<string> {
    const res = await managementApi.get(`${this.base}${id}/preview-pdf/`, {
      responseType: 'blob',
    });
    return URL.createObjectURL(res.data);
  }
}

export default new RequestTemplateService();
