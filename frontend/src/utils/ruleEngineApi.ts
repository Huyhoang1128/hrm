import { managementApi } from './api';

// Rule Engine API Types
export interface RuleEngineInfo {
  name: string;
  version: string;
  capabilities: string[];
  available_engines: string[];
}

export interface EmployeeRuleInfo {
  employee: {
    id: number;
    full_name: string;
    employee_id: string;
    department: string | null;
    position: string | null;
  };
  date: string;
  attendance_rules: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    configuration: any;
    effective_from: string;
    effective_to: string | null;
    priority: number;
  }>;
  leave_policies: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    advance_notice_rules: any[];
    max_days_per_year: number;
    max_consecutive_days: number;
    effective_from: string;
    effective_to: string | null;
  }>;
  summary: {
    total_attendance_rules: number;
    total_leave_policies: number;
    rule_types: string[];
    leave_types: string[];
  };
}

export interface DepartmentRuleSummary {
  department: {
    id: number;
    name: string;
    code: string;
  };
  date: string;
  summary: any;
  configuration: any;
}

export interface DepartmentComplianceReport {
  department_id: number;
  department_name: string;
  report_period: {
    start_date: string;
    end_date: string;
  };
  total_employees: number;
  compliance_summary: {
    total_attendances: number;
    compliant_attendances: number;
    non_compliant_attendances: number;
    compliance_rate: number;
  };
  rule_violations: Record<string, number>;
  employee_compliance: Array<{
    employee_id: number;
    employee_name: string;
    total_attendances: number;
    compliant_attendances: number;
    non_compliant_attendances: number;
    violations: any[];
  }>;
}

export interface LeaveValidationRequest {
  employee_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
}

export interface LeaveValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  policy?: {
    id: number;
    code: string;
    name: string;
  };
}

export interface RuleApplicationResult {
  success: boolean;
  attendance_id: number;
  attendance_code: string;
  calculation_result: any;
  updated_fields: {
    status: string;
    working_hours: number;
    late_minutes: number;
    early_leave_minutes: number;
    overtime_hours: number;
  };
}

export interface RuleTestScenario {
  employee_id: number;
  employee_name: string;
  attendance_date: string;
  check_in?: string;
  check_out?: string;
  shift_type: string;
}

export interface RuleTestResult {
  test_scenario: RuleTestScenario;
  calculation_result: any;
  rule_application_summary: {
    total_rules_applied: number;
    final_status: string;
    calculated_work_hours: number;
    calculated_overtime_hours: number;
  };
}

export interface DepartmentRuleConfiguration {
  department_id: number;
  department_name: string;
  attendance_rules: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    configuration: any;
    effective_from: string;
    effective_to: string | null;
    applies_to: string;
  }>;
  leave_policies: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    advance_notice_rules: any[];
    max_days_per_year: number;
    max_consecutive_days: number;
    effective_from: string;
    effective_to: string | null;
    applies_to: string;
  }>;
}

export interface ApplyDepartmentRulesRequest {
  start_date: string;
  end_date: string;
}

export interface ApplyDepartmentRulesResponse {
  department_id: number;
  department_name: string;
  date_range: {
    start_date: string;
    end_date: string;
  };
  total_employees: number;
  processed_attendances: number;
  successful_applications: number;
  failed_applications: number;
  employee_results: Array<{
    employee_id: number;
    employee_name: string;
    processed_attendances: number;
    successful_applications: number;
    failed_applications: number;
    last_error?: string;
  }>;
}

// Rule Engine API
export const ruleEngineAPI = {
  // Get rule engine information
  getInfo: async (): Promise<RuleEngineInfo> => {
    const response = await managementApi.get('/api-hrm/rule-engine/');
    return response.data;
  },

  // Employee rule operations
  getEmployeeRules: async (employeeId: number, date?: string): Promise<EmployeeRuleInfo> => {
    const params: any = {};
    if (date) params.date = date;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/employees/${employeeId}/`, { params });
    return response.data;
  },

  applyEmployeeRules: async (employeeId: number, date: string): Promise<any> => {
    const response = await managementApi.post(`/api-hrm/rule-engine/employees/${employeeId}/`, { date });
    return response.data;
  },

  // Department rule operations
  getDepartmentRules: async (departmentId: number, date?: string, ruleType?: string): Promise<DepartmentRuleSummary> => {
    const params: any = {};
    if (date) params.date = date;
    if (ruleType) params.rule_type = ruleType;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/departments/${departmentId}/`, { params });
    return response.data;
  },

  getDepartmentRuleConfiguration: async (departmentId: number, ruleType?: string): Promise<DepartmentRuleConfiguration> => {
    const params: any = {};
    if (ruleType) params.rule_type = ruleType;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/departments/${departmentId}/configuration/`, { params });
    return response.data;
  },

  applyDepartmentRules: async (departmentId: number, data: ApplyDepartmentRulesRequest): Promise<ApplyDepartmentRulesResponse> => {
    const response = await managementApi.post(`/api-hrm/rule-engine/departments/${departmentId}/apply/`, data);
    return response.data;
  },

  // Compliance reports
  getDepartmentCompliance: async (departmentId: number, startDate?: string, endDate?: string): Promise<DepartmentComplianceReport> => {
    const params: any = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const response = await managementApi.get(`/api-hrm/rule-engine/departments/${departmentId}/compliance/`, { params });
    return response.data;
  },

  // Leave validation
  validateLeave: async (data: LeaveValidationRequest): Promise<LeaveValidationResult> => {
    const response = await managementApi.post('/api-hrm/rule-engine/leave-validation/', data);
    return response.data;
  },

  // Rule application
  applyRulesToAttendance: async (attendanceId: number): Promise<RuleApplicationResult> => {
    const response = await managementApi.post(`/api-hrm/rule-engine/attendance/${attendanceId}/apply-rules/`);
    return response.data;
  },

  // Rule testing
  testRuleApplication: async (data: {
    employee_id: number;
    attendance_date: string;
    check_in?: string;
    check_out?: string;
    shift_type?: string;
  }): Promise<RuleTestResult> => {
    const response = await managementApi.post('/api-hrm/rule-engine/test/', data);
    return response.data;
  },

  // Apply department rules to new employee
  applyDepartmentRulesToEmployee: async (employeeId: number, departmentId: number): Promise<{
    success: boolean;
    message: string;
    applied_rules: number;
    applied_policies: number;
  }> => {
    const response = await managementApi.post(`/api-hrm/rule-engine/employees/${employeeId}/apply-department-rules/`, {
      department_id: departmentId
    });
    return response.data;
  },
};

export default ruleEngineAPI;
