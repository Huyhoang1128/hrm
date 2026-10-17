import { managementApi } from '../utils/api';

export type EmployeeChangeType = 'ORG' | 'SALARY';
export type EmployeeChangeStatus = 'SCHEDULED' | 'APPLIED' | 'CANCELLED';

/** Một lần điều chỉnh nhân sự (phòng ban / chức vụ hoặc lương / phụ cấp) có ngày áp dụng. */
export interface EmployeeChangeRecord {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  change_type: EmployeeChangeType;
  change_type_display: string;
  status: EmployeeChangeStatus;
  status_display: string;
  effective_date: string;
  note: string;
  changes_department: boolean;
  old_department_name: string;
  new_department_name: string;
  changes_position: boolean;
  old_position_name: string;
  new_position_name: string;
  /** Tiền — API trả chuỗi thập phân; new_* null = khoản đó không đổi */
  old_basic_salary: string | null;
  new_basic_salary: string | null;
  old_allowance: string | null;
  new_allowance: string | null;
  created_by_name: string;
  created_at: string;
  applied_at: string | null;
  cancelled_by_name: string;
  cancelled_at: string | null;
  apply_error: string;
}

export interface EmployeeCurrentValues {
  employee: number;
  employee_code: string;
  employee_name: string;
  department_id: number | null;
  department_name: string;
  position_id: number | null;
  position_name: string;
  basic_salary: string | null;
  allowance: string | null;
  pending: EmployeeChangeRecord[];
}

export interface EmployeeChangeCreatePayload {
  employee: number;
  change_type: EmployeeChangeType;
  effective_date: string;
  note?: string;
  /** Chỉ gửi khoá này khi đổi (null = bỏ trống) */
  department_id?: number | null;
  position_id?: number | null;
  basic_salary?: number;
  allowance?: number;
}

const BASE = '/api-hrm/employee-changes/';

export const employeeChangeService = {
  async list(params: {
    page?: number;
    page_size?: number;
    employee?: number;
    search?: string;
    change_type?: EmployeeChangeType | '';
    status?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{ count: number; results: EmployeeChangeRecord[] }> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    const response = await managementApi.get(BASE, { params: clean });
    return response.data;
  },

  async current(employeeId: number): Promise<EmployeeCurrentValues> {
    const response = await managementApi.get(`${BASE}current/`, { params: { employee: employeeId } });
    return response.data;
  },

  async create(payload: EmployeeChangeCreatePayload): Promise<EmployeeChangeRecord> {
    const response = await managementApi.post(BASE, payload);
    return response.data;
  },

  async cancel(id: number): Promise<EmployeeChangeRecord> {
    const response = await managementApi.post(`${BASE}${id}/cancel/`);
    return response.data;
  },
};

export const apiErrorMessage = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    const first = Object.values(data as Record<string, unknown>)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (typeof first === 'string') return first;
  }
  return fallback;
};
