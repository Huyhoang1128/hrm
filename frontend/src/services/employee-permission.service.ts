import { managementApi } from '../utils/api';

export interface EmployeePermission {
  id: number;
  employee: {
    id: number;
    full_name: string;
    employee_id: string;
    department?: {
      id: number;
      name: string;
      code: string;
    };
    position?: {
      id: number;
      title: string;
      code: string;
    };
  };
  can_approve_attendance: boolean;
  can_create_employee: boolean;
  can_manage_attendance: boolean;
  can_manage_assets: boolean;
  can_approve_leave: boolean;
  can_approve_overtime: boolean;
  can_view_all_employees: boolean;
  can_manage_departments: boolean;
  can_manage_positions: boolean;
  can_manage_company_config: boolean;
  can_manage_attendance_rules: boolean;
  can_manage_leave_policies: boolean;
  can_view_reports: boolean;
  can_export_reports: boolean;
  can_manage_disciplinary_penalties: boolean;
  can_view_dashboard_overview?: boolean;
  can_view_dashboard_employee?: boolean;
  can_view_dashboard_recruitment?: boolean;
  can_view_dashboard_insurance?: boolean;
  can_view_dashboard_asset?: boolean;
  has_any_permission: boolean;
  permission_summary?: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeePermissionStats {
  total: number;
  employees_with_permissions: number;
  employees_without_permissions: number;
  permission_stats: {
    [key: string]: {
      display_name: string;
      count: number;
      percentage: number;
    };
  };
  department_stats: Array<{
    department_id: number;
    department_name: string;
    count: number;
  }>;
}

export interface EmployeePermissionSummary {
  is_admin: boolean;
  has_all_permissions: boolean;
  permissions: {
    can_approve_attendance: boolean;
    can_create_employee: boolean;
    can_manage_attendance: boolean;
    can_manage_assets: boolean;
    can_approve_leave: boolean;
    can_approve_overtime: boolean;
    can_view_all_employees: boolean;
    can_manage_departments: boolean;
    can_manage_positions: boolean;
    can_manage_company_config: boolean;
    can_manage_attendance_rules: boolean;
    can_manage_leave_policies: boolean;
    can_view_reports: boolean;
    can_export_reports: boolean;
    can_manage_disciplinary_penalties: boolean;
  };
  permission_summary: string[];
}

export interface EmployeePermissionParams {
  page?: number;
  page_size?: number;
  employee_id?: number;
  department_id?: number;
  has_any_permission?: boolean;
  can_approve_attendance?: boolean;
  can_create_employee?: boolean;
  can_manage_attendance?: boolean;
  can_manage_assets?: boolean;
  can_approve_leave?: boolean;
  can_approve_overtime?: boolean;
  can_view_all_employees?: boolean;
  can_manage_departments?: boolean;
  can_manage_positions?: boolean;
  can_manage_company_config?: boolean;
  can_manage_attendance_rules?: boolean;
  can_manage_leave_policies?: boolean;
  can_view_reports?: boolean;
  can_export_reports?: boolean;
  can_manage_disciplinary_penalties?: boolean;
  can_view_dashboard_overview?: boolean;
  can_view_dashboard_employee?: boolean;
  can_view_dashboard_recruitment?: boolean;
  can_view_dashboard_insurance?: boolean;
  can_view_dashboard_asset?: boolean;
  search?: string;
  ordering?: string;
}

export interface PermissionCheckRequest {
  employee_id: number;
  permissions: {
    can_approve_attendance?: boolean;
    can_create_employee?: boolean;
    can_manage_attendance?: boolean;
    can_manage_assets?: boolean;
    can_approve_leave?: boolean;
    can_approve_overtime?: boolean;
    can_view_all_employees?: boolean;
    can_manage_departments?: boolean;
    can_manage_positions?: boolean;
    can_manage_company_config?: boolean;
    can_manage_attendance_rules?: boolean;
    can_manage_leave_policies?: boolean;
    can_view_reports?: boolean;
    can_export_reports?: boolean;
    can_manage_disciplinary_penalties?: boolean;
  };
}

export interface PermissionCheckResult {
  has_permission: boolean;
  missing_permissions: string[];
  employee_permission: EmployeePermission;
}

export interface BulkPermissionUpdate {
  employee_id: number;
  can_approve_attendance?: boolean;
  can_create_employee?: boolean;
  can_manage_attendance?: boolean;
  can_manage_assets?: boolean;
  can_approve_leave?: boolean;
  can_approve_overtime?: boolean;
  can_view_all_employees?: boolean;
  can_manage_departments?: boolean;
  can_manage_positions?: boolean;
  can_manage_company_config?: boolean;
  can_manage_attendance_rules?: boolean;
  can_manage_leave_policies?: boolean;
  can_view_reports?: boolean;
  can_export_reports?: boolean;
  can_manage_disciplinary_penalties?: boolean;
  can_view_dashboard_overview?: boolean;
  can_view_dashboard_employee?: boolean;
  can_view_dashboard_recruitment?: boolean;
  can_view_dashboard_insurance?: boolean;
  can_view_dashboard_asset?: boolean;
  notes?: string;
}

class EmployeePermissionService {
  /**
   * Lấy danh sách phân quyền nhân viên
   */
  async getEmployeePermissions(params?: EmployeePermissionParams): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: EmployeePermission[];
  }> {
    try {
      const response = await managementApi.get('/api-hrm/employee-permissions/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching employee permissions:', error);
      throw error;
    }
  }

  /**
   * Lấy chi tiết phân quyền của một nhân viên
   */
  async getEmployeePermissionById(id: number): Promise<EmployeePermission> {
    try {
      const response = await managementApi.get(`/api-hrm/employee-permissions/${id}/`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching employee permission ${id}:`, error);
      throw error;
    }
  }

  /**
   * Lấy phân quyền của một nhân viên theo employee_id
   */
  async getEmployeePermissionByEmployeeId(employeeId: number): Promise<EmployeePermission> {
    try {
      const response = await managementApi.get('/api-hrm/employee-permissions/employee_permissions/', {
        params: { employee_id: employeeId }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching employee permission for employee ${employeeId}:`, error);
      throw error;
    }
  }

  /**
   * Tạo phân quyền mới cho nhân viên
   */
  async createEmployeePermission(data: Partial<EmployeePermission>): Promise<EmployeePermission> {
    try {
      const response = await managementApi.post('/api-hrm/employee-permissions/', data);
      return response.data;
    } catch (error) {
      console.error('Error creating employee permission:', error);
      throw error;
    }
  }

  /**
   * Cập nhật phân quyền nhân viên
   */
  async updateEmployeePermission(id: number, data: Partial<EmployeePermission>): Promise<EmployeePermission> {
    try {
      const response = await managementApi.put(`/api-hrm/employee-permissions/${id}/`, data);
      return response.data;
    } catch (error) {
      console.error(`Error updating employee permission ${id}:`, error);
      throw error;
    }
  }

  /**
   * Xóa phân quyền nhân viên
   */
  async deleteEmployeePermission(id: number): Promise<void> {
    try {
      await managementApi.delete(`/api-hrm/employee-permissions/${id}/`);
    } catch (error) {
      console.error(`Error deleting employee permission ${id}:`, error);
      throw error;
    }
  }

  /**
   * Lấy thống kê phân quyền
   */
  async getPermissionStats(): Promise<EmployeePermissionStats> {
    try {
      const response = await managementApi.get('/api-hrm/employee-permissions/stats/');
      return response.data;
    } catch (error) {
      console.error('Error fetching permission stats:', error);
      throw error;
    }
  }

  /**
   * Kiểm tra quyền của nhân viên
   */
  async checkPermissions(data: PermissionCheckRequest): Promise<PermissionCheckResult> {
    try {
      const response = await managementApi.post('/api-hrm/employee-permissions/check_permissions/', data);
      return response.data;
    } catch (error) {
      console.error('Error checking permissions:', error);
      throw error;
    }
  }

  /**
   * Lấy phân quyền của người dùng hiện tại
   */
  async getMyPermissions(): Promise<EmployeePermission> {
    try {
      const response = await managementApi.get('/api-hrm/employee-permissions/my_permissions/');
      return response.data;
    } catch (error) {
      console.error('Error fetching my permissions:', error);
      throw error;
    }
  }

  /**
   * Lấy tổng quan phân quyền của người dùng hiện tại
   */
  async getMyPermissionSummary(): Promise<EmployeePermissionSummary> {
    try {
      const response = await managementApi.get('/api-hrm/employee-permissions/permission_summary/');
      return response.data;
    } catch (error) {
      console.error('Error fetching my permission summary:', error);
      throw error;
    }
  }

  /**
   * Cập nhật hàng loạt phân quyền
   */
  async bulkUpdatePermissions(data: BulkPermissionUpdate[]): Promise<{
    updated: number;
    updated_ids: number[];
    errors: any[];
    message: string;
  }> {
    try {
      const response = await managementApi.post('/api-hrm/employee-permissions/bulk_update/', data);
      return response.data;
    } catch (error) {
      console.error('Error bulk updating permissions:', error);
      throw error;
    }
  }

  /**
   * Xuất danh sách phân quyền ra CSV
   */
  async exportPermissionsToCSV(params?: EmployeePermissionParams): Promise<Blob> {
    try {
      const response = await managementApi.get('/api-hrm/employee-permissions/export/', {
        params,
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      console.error('Error exporting permissions to CSV:', error);
      throw error;
    }
  }

  /**
   * Tải xuống file CSV phân quyền
   */
  async downloadPermissionsCSV(params?: EmployeePermissionParams): Promise<void> {
    try {
      const blob = await this.exportPermissionsToCSV(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employee_permissions.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading permissions CSV:', error);
      throw error;
    }
  }

  /**
   * Lấy danh sách nhân viên có quyền cụ thể
   */
  async getEmployeesWithPermission(permissionField: string, value: boolean = true): Promise<EmployeePermission[]> {
    try {
      const params: EmployeePermissionParams = {
        [permissionField]: value
      };
      const response = await this.getEmployeePermissions(params);
      return response.results;
    } catch (error) {
      console.error(`Error fetching employees with permission ${permissionField}=${value}:`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách nhân viên có quyền phê duyệt công
   */
  async getAttendanceApprovers(): Promise<EmployeePermission[]> {
    return this.getEmployeesWithPermission('can_approve_attendance', true);
  }

  /**
   * Lấy danh sách nhân viên có quyền tạo nhân viên
   */
  async getEmployeeCreators(): Promise<EmployeePermission[]> {
    return this.getEmployeesWithPermission('can_create_employee', true);
  }

  /**
   * Lấy danh sách nhân viên có quyền quản lý chấm công
   */
  async getAttendanceManagers(): Promise<EmployeePermission[]> {
    return this.getEmployeesWithPermission('can_manage_attendance', true);
  }

  /**
   * Lấy danh sách nhân viên có quyền quản lý tài sản
   */
  async getAssetManagers(): Promise<EmployeePermission[]> {
    return this.getEmployeesWithPermission('can_manage_assets', true);
  }

  /**
   * Kiểm tra xem nhân viên có quyền cụ thể không
   */
  async hasPermission(employeeId: number, permissionField: string): Promise<boolean> {
    try {
      const permission = await this.getEmployeePermissionByEmployeeId(employeeId);
      return permission[permissionField as keyof EmployeePermission] as boolean;
    } catch (error) {
      console.error(`Error checking permission ${permissionField} for employee ${employeeId}:`, error);
      return false;
    }
  }

  /**
   * Kiểm tra xem người dùng hiện tại có quyền cụ thể không
   */
  async currentUserHasPermission(permissionField: string): Promise<boolean> {
    try {
      const summary = await this.getMyPermissionSummary();
      return summary.permissions[permissionField as keyof EmployeePermissionSummary['permissions']];
    } catch (error) {
      console.error(`Error checking current user permission ${permissionField}:`, error);
      return false;
    }
  }
}

export const employeePermissionService = new EmployeePermissionService();
export default employeePermissionService;
