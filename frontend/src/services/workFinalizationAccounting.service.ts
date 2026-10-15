import { managementApi } from '../utils/api';

export interface WorkFinalizationAccountingExportRow {
  id: number;
  approval_id: number;
  year: number;
  month: number;
  department_code: string;
  department_name: string | null;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING' | string;
  decision_label: string | null;
  decision_note: string;
  decided_by_id: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  exported_by_id: number | null;
  exported_by_name: string | null;
  exported_at: string;
  snapshot: Record<string, any>;
}

export interface AccountingExportListParams {
  year: number;
  month: number;
  department_code?: string;
  employee_code?: string;
  decision?: string;
}

export interface AccountingExportListResponse {
  year: number;
  month: number;
  total: number;
  results: WorkFinalizationAccountingExportRow[];
}

export interface AccountingExportGenerateRequest {
  year: number;
  month: number;
  department_code?: string;
}

export interface AccountingExportGenerateResponse {
  year: number;
  month: number;
  department_code: string | null;
  total_exported: number;
  skipped_departments: Array<{
    department_code: string;
    department_name: string | null;
    missing_employees: number;
  }>;
  results: WorkFinalizationAccountingExportRow[];
}

class WorkFinalizationAccountingService {
  async list(params: AccountingExportListParams): Promise<AccountingExportListResponse> {
    const response = await managementApi.get('/api-hrm/work-finalization/accounting-exports/', { params });
    return response.data;
  }

  async generate(data: AccountingExportGenerateRequest): Promise<AccountingExportGenerateResponse> {
    const response = await managementApi.post('/api-hrm/work-finalization/accounting-exports/generate/', data);
    return response.data;
  }
}

export const workFinalizationAccountingService = new WorkFinalizationAccountingService();
export default workFinalizationAccountingService;
