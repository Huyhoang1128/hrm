import type { AxiosResponse } from 'axios';
import { managementApi } from './client';
import type {
  Employee,
  SuperAdminEmployee,
  EmployeeCreateData,
  EmployeeUpdateData,
  Department,
  Position,
  BirthdayWish,
  CompanyUnit,
} from './types';

let mePromise: Promise<Employee> | null = null;

// Employees API
export interface EmployeeStatusLogEntry {
  id: number;
  employee: number;
  employee_code: string;
  full_name: string;
  from_status: string | null;
  from_status_label: string | null;
  to_status: string;
  to_status_label: string;
  changed_at: string;
  changed_by: string | null;
  note: string;
}

export const employeesAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    employment_status?: string;
    department?: number;
    position?: number;
    gender?: string;
    ordering?: string;
    contract_type?: string;
    is_active?: boolean;
    end_date_from?: string;
    end_date_to?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Employee[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Employee[];
    }> = await managementApi.get('/api-hrm/employees/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<Employee> => {
    const response: AxiosResponse<Employee> = await managementApi.get(`/api-hrm/employees/${id}/`);
    return response.data;
  },

  getByEmployeeId: async (employeeId: string): Promise<SuperAdminEmployee> => {
    const response: AxiosResponse<SuperAdminEmployee> = await managementApi.get(
      `/api-hrm/super-admin/employee/`,
      { params: { employee_id: employeeId } }
    );
    return response.data;
  },

  partialUpdateByEmployeeId: async (
    employeeId: string,
    data: Partial<EmployeeUpdateData>
  ): Promise<SuperAdminEmployee> => {
    const response: AxiosResponse<SuperAdminEmployee> = await managementApi.patch(
      `/api-hrm/super-admin/employee/`,
      data,
      { params: { employee_id: employeeId } }
    );
    return response.data;
  },

  uploadFilesByEmployeeId: async (
    employeeId: string,
    formData: FormData
  ): Promise<SuperAdminEmployee> => {
    const response: AxiosResponse<SuperAdminEmployee> = await managementApi.patch(
      `/api-hrm/super-admin/employee/`,
      formData,
      {
        params: { employee_id: employeeId },
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  /** HCNS/Admin: tạo link để NV đang làm tự cập nhật thông tin cá nhân (dùng lại form onboarding). */
  generateSelfUpdateLink: async (id: number): Promise<{ employee_form_url: string; expires_at: string }> => {
    const response = await managementApi.post(`/api-hrm/employees/${id}/generate-self-update-link/`);
    return response.data.data;
  },

  me: async (): Promise<Employee> => {
    if (mePromise) return mePromise;

    mePromise = (async () => {
      try {
        const response: AxiosResponse<Employee> = await managementApi.get('/api-hrm/employees/me/');
        return response.data;
      } finally {
        mePromise = null;
      }
    })();
    return mePromise;
  },

  create: async (data: EmployeeCreateData): Promise<Employee> => {
    const response: AxiosResponse<Employee> = await managementApi.post('/api-hrm/employees/', data);
    return response.data;
  },

  update: async (id: number, data: EmployeeUpdateData): Promise<Employee> => {
    const response: AxiosResponse<Employee> = await managementApi.put(`/api-hrm/employees/${id}/`, data);
    return response.data;
  },

  partialUpdate: async (id: number, data: Partial<EmployeeUpdateData>): Promise<Employee> => {
    const response: AxiosResponse<Employee> = await managementApi.patch(`/api-hrm/employees/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/employees/${id}/`);
  },

  /** month = 'YYYY-MM' → số liệu tại cuối tháng đó (theo nhật ký trạng thái); bỏ trống = hiện tại. */
  stats: async (params?: { month?: string }): Promise<{
    total: number;
    active: number;
    inactive: number;
    probation: number;
    suspended?: number;
    maternity_leave?: number;
    department_stats: Array<{
      department_id: number;
      department_name: string;
      count: number;
    }>;
    gender_stats: {
      male: number;
      female: number;
      other: number;
    };
  }> => {
    const response: AxiosResponse<{
      total: number;
      active: number;
      inactive: number;
      probation: number;
      department_stats: Array<{
        department_id: number;
        department_name: string;
        count: number;
      }>;
      gender_stats: {
        male: number;
        female: number;
        other: number;
      };
    }> = await managementApi.get('/api-hrm/employees/stats/', { params });
    return response.data;
  },

  /** Nhật ký đổi trạng thái làm việc trong tháng (HCNS/Admin). */
  statusLog: async (month: string): Promise<{ count: number; results: EmployeeStatusLogEntry[] }> => {
    const response = await managementApi.get('/api-hrm/employees/status-log/', { params: { month } });
    return response.data;
  },

  hr_employees: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    employment_status?: string;
    department?: number;
    gender?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Employee[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Employee[];
    }> = await managementApi.get('/api-hrm/employees/hr_employees/', { params });
    return response.data;
  },

  activate: async (id: number): Promise<Employee> => {
    const response: AxiosResponse<Employee> = await managementApi.post(`/api-hrm/employees/${id}/activate/`);
    return response.data;
  },

  deactivate: async (id: number): Promise<Employee> => {
    const response: AxiosResponse<Employee> = await managementApi.post(`/api-hrm/employees/${id}/deactivate/`);
    return response.data;
  },

  birthdays_today: async (date?: string): Promise<Array<{
    employee_id: number;
    full_name: string;
    date_of_birth: string;
    avatar_url?: string | null;
    department: {
      id: number;
      name: string;
      code: string;
    } | null;
  }>> => {
    const params = date ? { date } : undefined;
    const response = await managementApi.get('/api-hrm/employees/birthdays_today/', { params });
    const data = response.data;
    return Array.isArray(data) ? data : (data?.results ?? []);
  },

  exportAll: async (): Promise<{
    count: number;
    results: Employee[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      results: Employee[];
    }> = await managementApi.get('/api-hrm/employees/export-all/');
    return response.data;
  },

  changeAvatar: async (file: File): Promise<{ avatar_url: string | null }> => {
    const formData = new FormData();
    formData.append('avatar', file);
    const response: AxiosResponse<{ avatar_url: string | null }> =
      await managementApi.post('/api-hrm/change-avatar/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    return response.data;
  },

  importFile: async (file: File): Promise<{
    success: boolean;
    summary: { total: number; created: number; updated: number; failed: number };
    errors: Array<{ row: number; employee_id?: string; warnings?: string[]; errors?: string[] }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await managementApi.post('/api-hrm/employees/import/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // Đổi quản lý trực tiếp hàng loạt — dùng khi 1 quản lý offboard, chuyển toàn
  // bộ nhân viên đang report cho họ sang quản lý mới trong 1 lần submit.
  changeManager: async (oldManagerId: number, newManagerId: number): Promise<{
    success: boolean;
    message: string;
    count: number;
    employees: Array<{ id: number; employee_id: string; full_name: string }>;
  }> => {
    const response = await managementApi.post('/api-hrm/employees/change_manager/', {
      old_manager_id: oldManagerId,
      new_manager_id: newManagerId,
    });
    return response.data;
  },
};

// Departments API
export const departmentsAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    parent_department?: number;
    // Tra "phòng ban mà 1 nhân viên đang quản lý" — vd khoá cứng filter phòng
    // ban ở trang Quản lý nhân viên cho user is_manager.
    manager?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Department[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Department[];
    }> = await managementApi.get('/api-hrm/departments/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<Department> => {
    const response: AxiosResponse<Department> = await managementApi.get(`/api-hrm/departments/${id}/`);
    return response.data;
  },

  create: async (data: Partial<Department>): Promise<Department> => {
    const response: AxiosResponse<Department> = await managementApi.post('/api-hrm/departments/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<Department>): Promise<Department> => {
    const response: AxiosResponse<Department> = await managementApi.put(`/api-hrm/departments/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/departments/${id}/`);
  },

  employees: async (id: number, params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Employee[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Employee[];
    }> = await managementApi.get(`/api-hrm/departments/${id}/employees/`, { params });
    return response.data;
  },

  importFile: async (file: File): Promise<{
    success: boolean;
    summary: { total: number; created: number; updated: number; failed: number };
    errors: Array<{ row: number; code?: string; warnings?: string[]; errors?: string[] }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await managementApi.post('/api-hrm/departments/import/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

// Sections API (Bộ phận - dùng chung model Department, BE auto set is_section=true)
export const sectionsAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    parent_department?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Department[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Department[];
    }> = await managementApi.get('/api-hrm/sections/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<Department> => {
    const response: AxiosResponse<Department> = await managementApi.get(`/api-hrm/sections/${id}/`);
    return response.data;
  },

  create: async (data: Partial<Department>): Promise<Department> => {
    const response: AxiosResponse<Department> = await managementApi.post('/api-hrm/sections/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<Department>): Promise<Department> => {
    const response: AxiosResponse<Department> = await managementApi.put(`/api-hrm/sections/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/sections/${id}/`);
  },
};

// Positions API
export const positionsAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    department?: number;
    is_management?: boolean;
    level?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Position[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Position[];
    }> = await managementApi.get('/api-hrm/positions/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<Position> => {
    const response: AxiosResponse<Position> = await managementApi.get(`/api-hrm/positions/${id}/`);
    return response.data;
  },

  create: async (data: Partial<Position>): Promise<Position> => {
    const response: AxiosResponse<Position> = await managementApi.post('/api-hrm/positions/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<Position>): Promise<Position> => {
    const response: AxiosResponse<Position> = await managementApi.put(`/api-hrm/positions/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/positions/${id}/`);
  },

  employees: async (id: number, params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Employee[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Employee[];
    }> = await managementApi.get(`/api-hrm/positions/${id}/employees/`, { params });
    return response.data;
  },

  importFile: async (file: File): Promise<{
    success: boolean;
    summary: { total: number; created: number; updated: number; failed: number };
    errors: Array<{ row: number; code?: string; warnings?: string[]; errors?: string[] }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await managementApi.post('/api-hrm/positions/import/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

// Send Account Emails API
export const sendAccountEmailsAPI = {
  sendEmails: async (data: {
    send_all?: boolean;
    employee_ids?: number[];
  }): Promise<{
    success: boolean;
    message: string;
    total?: number;
    passwords_reset?: number;
    batch_id?: string;
    estimated_time?: string;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      message: string;
      total?: number;
      passwords_reset?: number;  // ✅ THÊM
      batch_id?: string;
      estimated_time?: string;
    }> = await managementApi.post('/api-hrm/employees/send-account-emails/', data);
    return response.data;
  },
  checkBatchStatus: async (batchId: string): Promise<{
    success: boolean;
    batch_id: string;
    status: string;
    total: number;
    sent: number;
    failed: number;
    pending: number;
    progress_percentage: number;
    created_at?: string;
    completed_at?: string;
  }> => {
    const response = await managementApi.get(`/api-hrm/email-batch/${batchId}/status/`);
    return response.data;
  },
};

// Birthday Wishes API
export const birthdayWishesAPI = {
  list: async (params?: {
    recipient?: number;
    sender?: number;
    year?: number;
  }): Promise<BirthdayWish[]> => {
    const response = await managementApi.get('/api-hrm/birthday-wishes/', { params });
    const data = response.data;
    return Array.isArray(data) ? data : (data?.results ?? []);
  },

  create: async (data: {
    recipient: number;
    sender: number;
    message: string;
    year: number;
  }): Promise<BirthdayWish> => {
    const response: AxiosResponse<BirthdayWish> = await managementApi.post('/api-hrm/birthday-wishes/', data);
    return response.data;
  },

  getByRecipient: async (recipientId: number, year?: number): Promise<BirthdayWish[]> => {
    return birthdayWishesAPI.list({ recipient: recipientId, year });
  },
};

// Company Units API
export const companyUnitsAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    active_only?: boolean;
  }): Promise<{ count: number; results: CompanyUnit[] }> => {
    const response = await managementApi.get('/api-hrm/company-units/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<CompanyUnit> => {
    const response = await managementApi.get(`/api-hrm/company-units/${id}/`);
    return response.data;
  },

  create: async (data: Partial<CompanyUnit>): Promise<CompanyUnit> => {
    const response = await managementApi.post('/api-hrm/company-units/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<CompanyUnit>): Promise<CompanyUnit> => {
    const response = await managementApi.put(`/api-hrm/company-units/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/company-units/${id}/`);
  },
};

// ============================================
// EMPLOYEE DEPENDENTS (Người phụ thuộc - giảm trừ gia cảnh)
// ============================================
export interface EmployeeDependent {
  id: number;
  employee: {
    id: number;
    employee_id: string;
    full_name: string;
    avatar_url: string | null;
  };
  full_name: string;
  date_of_birth: string | null;
  relationship: string | null;
  relationship_display: string | null;
  personal_identification_number: string | null;
  tax_code: string | null;
  nationality: string | null;
  dependent_from: string | null;
  dependent_to: string | null;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDependentPayload {
  employee_id?: number;
  full_name: string;
  date_of_birth?: string | null;
  relationship?: string | null;
  personal_identification_number?: string | null;
  tax_code?: string | null;
  nationality?: string | null;
  dependent_from?: string | null;
  dependent_to?: string | null;
  is_active?: boolean;
  notes?: string;
}

export const employeeDependentsAPI = {
  list: async (params?: {
    employee?: number;
    employee_code?: string;
    relationship?: string;
    is_active?: boolean;
    search?: string;
    ordering?: string;
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: EmployeeDependent[];
  }> => {
    const response = await managementApi.get('/api-hrm/employee-dependents/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<EmployeeDependent> => {
    const response = await managementApi.get(`/api-hrm/employee-dependents/${id}/`);
    return response.data;
  },

  create: async (data: EmployeeDependentPayload): Promise<EmployeeDependent> => {
    const response = await managementApi.post('/api-hrm/employee-dependents/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<EmployeeDependentPayload>): Promise<EmployeeDependent> => {
    const response = await managementApi.patch(`/api-hrm/employee-dependents/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/employee-dependents/${id}/`);
  },
};
