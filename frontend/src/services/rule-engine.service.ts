import { managementApi } from '../utils/api';

// Re-export types from ruleEngineApi for convenience
export type {
  RuleEngineInfo,
  EmployeeRuleInfo,
  DepartmentRuleSummary,
  DepartmentComplianceReport,
  LeaveValidationRequest,
  LeaveValidationResult,
  RuleApplicationResult,
  RuleTestScenario,
  RuleTestResult,
  DepartmentRuleConfiguration,
  ApplyDepartmentRulesRequest,
  ApplyDepartmentRulesResponse,
} from '../utils/ruleEngineApi';

class RuleEngineService {
  /**
   * Lấy thông tin rule engine
   */
  async getInfo() {
    const response = await managementApi.get('/api-hrm/rule-engine/');
    return response.data;
  }

  /**
   * Lấy quy tắc của nhân viên
   */
  async getEmployeeRules(employeeId: number, date?: string) {
    const params: any = {};
    if (date) params.date = date;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/employees/${employeeId}/`, { params });
    return response.data;
  }

  /**
   * Áp dụng quy tắc cho nhân viên
   */
  async applyEmployeeRules(employeeId: number, date: string) {
    const response = await managementApi.post(`/api-hrm/rule-engine/employees/${employeeId}/`, { date });
    return response.data;
  }

  /**
   * Lấy quy tắc của phòng ban
   */
  async getDepartmentRules(departmentId: number, date?: string, ruleType?: string) {
    const params: any = {};
    if (date) params.date = date;
    if (ruleType) params.rule_type = ruleType;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/departments/${departmentId}/`, { params });
    return response.data;
  }

  /**
   * Lấy cấu hình quy tắc của phòng ban
   */
  async getDepartmentRuleConfiguration(departmentId: number, ruleType?: string) {
    const params: any = {};
    if (ruleType) params.rule_type = ruleType;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/departments/${departmentId}/configuration/`, { params });
    return response.data;
  }

  /**
   * Áp dụng quy tắc cho phòng ban
   */
  async applyDepartmentRules(departmentId: number, data: { start_date: string; end_date: string }) {
    const response = await managementApi.post(`/api-hrm/rule-engine/departments/${departmentId}/apply/`, data);
    return response.data;
  }

  /**
   * Lấy báo cáo tuân thủ của phòng ban
   */
  async getDepartmentCompliance(departmentId: number, startDate?: string, endDate?: string) {
    const params: any = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/departments/${departmentId}/compliance/`, { params });
    return response.data;
  }

  /**
   * Kiểm tra tính hợp lệ của đơn xin nghỉ phép
   */
  async validateLeave(data: {
    employee_id: number;
    leave_type: string;
    start_date: string;
    end_date: string;
    total_days: number;
  }) {
    const response = await managementApi.post('/api-hrm/rule-engine/leave-validation/', data);
    return response.data;
  }

  /**
   * Áp dụng quy tắc cho bản ghi chấm công
   */
  async applyRulesToAttendance(attendanceId: number) {
    const response = await managementApi.post(`/api-hrm/rule-engine/attendance/${attendanceId}/apply-rules/`);
    return response.data;
  }

  /**
   * Kiểm thử áp dụng quy tắc
   */
  async testRuleApplication(data: {
    employee_id: number;
    attendance_date: string;
    check_in?: string;
    check_out?: string;
    shift_type?: string;
  }) {
    const response = await managementApi.post('/api-hrm/rule-engine/test/', data);
    return response.data;
  }

  /**
   * Áp dụng quy tắc phòng ban cho nhân viên mới
   */
  async applyDepartmentRulesToEmployee(employeeId: number, departmentId: number) {
    const response = await managementApi.post(`/api-hrm/rule-engine/employees/${employeeId}/apply-department-rules/`, {
      department_id: departmentId
    });
    return response.data;
  }

  /**
   * Tính toán chấm công với quy tắc
   */
  async calculateAttendanceWithRules(data: {
    employee_id: number;
    attendance_date: string;
    check_in?: string;
    check_out?: string;
    shift_type?: string;
    rule_id?: number;
  }) {
    const response = await managementApi.post('/api-hrm/attendance-rule-engine/', data);
    return response.data;
  }

  /**
   * Lấy cấu hình quy tắc chấm công hiện tại
   */
  async getCurrentAttendanceRules(params?: {
    employee_id?: number;
    department_id?: number;
    date?: string;
  }) {
    const response = await managementApi.get('/api-hrm/attendance-rule-configs/current/', { params });
    return response.data;
  }

  /**
   * Lấy cấu hình chính sách nghỉ phép hiện tại
   */
  async getCurrentLeavePolicies(params?: {
    employee_id?: number;
    department_id?: number;
    date?: string;
  }) {
    const response = await managementApi.get('/api-hrm/leave-policy-configs/current/', { params });
    return response.data;
  }
}

export const ruleEngineService = new RuleEngineService();
export default ruleEngineService;
