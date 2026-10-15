import type { AxiosResponse } from 'axios';
import { managementApi } from './client';
import type {
  CompanyConfig,
  ShiftConfig,
  HolidayConfig,
  CurrentCompanyConfig,
  AttendanceRuleConfig,
  AttendanceRuleHistory,
  LeavePolicyConfig,
  AttendanceRuleEngineRequest,
  AttendanceRuleEngineResponse,
} from './types';

// Company Configuration API
export const companyConfigAPI = {
  // Company Configs
  listCompanyConfigs: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    is_active?: boolean;
    is_current?: string;
    start_date?: string;
    end_date?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: CompanyConfig[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: CompanyConfig[];
    }> = await managementApi.get('/api-hrm/company-configs/', { params });
    return response.data;
  },

  getCompanyConfigById: async (id: number): Promise<CompanyConfig> => {
    const response: AxiosResponse<CompanyConfig> = await managementApi.get(`/api-hrm/company-configs/${id}/`);
    return response.data;
  },

  createCompanyConfig: async (data: Partial<CompanyConfig>): Promise<CompanyConfig> => {
    const response: AxiosResponse<CompanyConfig> = await managementApi.post('/api-hrm/company-configs/', data);
    return response.data;
  },

  updateCompanyConfig: async (id: number, data: Partial<CompanyConfig>): Promise<CompanyConfig> => {
    const response: AxiosResponse<CompanyConfig> = await managementApi.put(`/api-hrm/company-configs/${id}/`, data);
    return response.data;
  },

  partialUpdateCompanyConfig: async (id: number, data: Partial<CompanyConfig>): Promise<CompanyConfig> => {
    const response: AxiosResponse<CompanyConfig> = await managementApi.patch(`/api-hrm/company-configs/${id}/`, data);
    return response.data;
  },

  deleteCompanyConfig: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/company-configs/${id}/`);
  },

  getCurrentCompanyConfig: async (): Promise<CompanyConfig> => {
    const response: AxiosResponse<CompanyConfig> = await managementApi.get('/api-hrm/company-configs/current/');
    return response.data;
  },

  getCompanyConfigStats: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/company-configs/stats/');
    return response.data;
  },

  // Shift Configs
  listShiftConfigs: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    is_active?: boolean;
    is_default?: boolean;
    shift_type?: string;
    is_current?: string;
    employee_id?: number;
    department_id?: number;
    start_date?: string;
    end_date?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: ShiftConfig[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: ShiftConfig[];
    }> = await managementApi.get('/api-hrm/shift-configs/', { params });
    return response.data;
  },

  getShiftConfigById: async (id: number): Promise<ShiftConfig> => {
    const response: AxiosResponse<ShiftConfig> = await managementApi.get(`/api-hrm/shift-configs/${id}/`);
    return response.data;
  },

  createShiftConfig: async (data: Partial<ShiftConfig>): Promise<ShiftConfig> => {
    const response: AxiosResponse<ShiftConfig> = await managementApi.post('/api-hrm/shift-configs/', data);
    return response.data;
  },

  updateShiftConfig: async (id: number, data: Partial<ShiftConfig>): Promise<ShiftConfig> => {
    const response: AxiosResponse<ShiftConfig> = await managementApi.put(`/api-hrm/shift-configs/${id}/`, data);
    return response.data;
  },

  partialUpdateShiftConfig: async (id: number, data: Partial<ShiftConfig>): Promise<ShiftConfig> => {
    const response: AxiosResponse<ShiftConfig> = await managementApi.patch(`/api-hrm/shift-configs/${id}/`, data);
    return response.data;
  },

  deleteShiftConfig: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/shift-configs/${id}/`);
  },

  getCurrentShiftConfigs: async (): Promise<ShiftConfig[]> => {
    const response: AxiosResponse<ShiftConfig[]> = await managementApi.get('/api-hrm/shift-configs/current/');
    return response.data;
  },

  getEmployeeShiftConfigs: async (employeeId: number): Promise<ShiftConfig[]> => {
    const response: AxiosResponse<ShiftConfig[]> = await managementApi.get(`/api-hrm/shift-configs/employee_shifts/?employee_id=${employeeId}`);
    return response.data;
  },

  getShiftConfigStats: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/shift-configs/stats/');
    return response.data;
  },

  getShiftConfigAssignOptions: async (shiftConfigId: number): Promise<{
    shift: ShiftConfig;
    current_assignments: {
      employees: any[];
      positions: any[];
      departments: any[];
    };
    available_options: {
      employees: any[];
      positions: any[];
      departments: any[];
    };
  }> => {
    const response: AxiosResponse = await managementApi.get(`/api-hrm/shift-configs/${shiftConfigId}/assign-options/`);
    return response.data;
  },
  
  removeEmployeeFromShift: async (
    shiftConfigId: number,
    employeeId: number
  ): Promise<{ message: string }> => {
    const response: AxiosResponse<{ message: string }> = await managementApi.post(
      `/api-hrm/shift-configs/${shiftConfigId}/remove-employee/`,
      { employee_id: employeeId }
    );
    return response.data;
  },
 
  assignShiftConfig: async (
    shiftConfigId: number,
    data: {
      employee_ids?: number[];
      position_ids?: number[];
      department_ids?: number[];
    }
  ): Promise<{
    message: string;
    shift: ShiftConfig;
  }> => {
    const response: AxiosResponse = await managementApi.post(
      `/api-hrm/shift-configs/${shiftConfigId}/assign/`,
      data
    );
    return response.data;
  },

  // Holiday Configs
  listHolidayConfigs: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    is_active?: boolean;
    is_recurring?: boolean;
    holiday_type?: string;
    is_working_day?: boolean;
    allow_voluntary_work?: boolean;
    start_date?: string;
    end_date?: string;
    is_today?: string;
    employee_id?: number;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: HolidayConfig[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: HolidayConfig[];
    }> = await managementApi.get('/api-hrm/holiday-configs/', { params });
    return response.data;
  },

  getHolidayConfigById: async (id: number): Promise<HolidayConfig> => {
    const response: AxiosResponse<HolidayConfig> = await managementApi.get(`/api-hrm/holiday-configs/${id}/`);
    return response.data;
  },

  createHolidayConfig: async (data: Partial<HolidayConfig>): Promise<HolidayConfig> => {
    const response: AxiosResponse<HolidayConfig> = await managementApi.post('/api-hrm/holiday-configs/', data);
    return response.data;
  },

  updateHolidayConfig: async (id: number, data: Partial<HolidayConfig>): Promise<HolidayConfig> => {
    const response: AxiosResponse<HolidayConfig> = await managementApi.put(`/api-hrm/holiday-configs/${id}/`, data);
    return response.data;
  },

  partialUpdateHolidayConfig: async (id: number, data: Partial<HolidayConfig>): Promise<HolidayConfig> => {
    const response: AxiosResponse<HolidayConfig> = await managementApi.patch(`/api-hrm/holiday-configs/${id}/`, data);
    return response.data;
  },

  deleteHolidayConfig: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/holiday-configs/${id}/`);
  },

  getUpcomingHolidays: async (): Promise<HolidayConfig[]> => {
    const response: AxiosResponse<HolidayConfig[]> = await managementApi.get('/api-hrm/holiday-configs/upcoming/');
    return response.data;
  },

  getTodayHolidays: async (): Promise<HolidayConfig[]> => {
    const response: AxiosResponse<HolidayConfig[]> = await managementApi.get('/api-hrm/holiday-configs/today/');
    return response.data;
  },

  getEmployeeHolidays: async (employeeId: number, startDate?: string, endDate?: string): Promise<HolidayConfig[]> => {
    const params: any = { employee_id: employeeId };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    
    const response: AxiosResponse<HolidayConfig[]> = await managementApi.get('/api-hrm/holiday-configs/employee_holidays/', { params });
    return response.data;
  },

  getHolidayConfigStats: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/holiday-configs/stats/');
    return response.data;
  },

  // Current Company Config
  getCurrentCompanyConfiguration: async (): Promise<CurrentCompanyConfig> => {
    const response: AxiosResponse<CurrentCompanyConfig> = await managementApi.get('/api-hrm/current-company-config/');
    return response.data;
  },
};

// HRM Company Information API
export const hrmAPI = {
  // Company Documents
  getEmployeeCompanyInfo: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/company-info/employee/');
    return response.data;
  },

  getCompanyDocuments: async (params?: {
    page?: number;
    page_size?: number;
    document_type?: string;
    access_level?: string;
    department?: number;
    status?: string;
    is_current?: boolean;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: any[];
    }> = await managementApi.get('/api-hrm/company-documents/', { params });
    return response.data;
  },

  getCompanyDocumentById: async (id: number): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get(`/api-hrm/company-documents/${id}/`);
    return response.data;
  },

  recordDocumentView: async (documentId: number): Promise<void> => {
    await managementApi.post(`/api-hrm/company-documents/${documentId}/record-view/`);
  },

  // Company Announcements
  getCompanyAnnouncements: async (params?: {
    page?: number;
    page_size?: number;
    announcement_type?: string;
    priority?: string;
    is_active?: boolean;
    is_current?: boolean;
    home_feed?: boolean;
    unread_only?: boolean;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: any[];
    }> = await managementApi.get('/api-hrm/company-announcements/', { params });
    return response.data;
  },

  getCompanyAnnouncementById: async (id: number): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get(`/api-hrm/company-announcements/${id}/`);
    return response.data;
  },

  acknowledgeAnnouncement: async (announcementId: number): Promise<void> => {
    await managementApi.post(`/api-hrm/company-announcements/${announcementId}/acknowledge/`);
  },

  markAllCompanyAnnouncementsRead: async (): Promise<void> => {
    await managementApi.post('/api-hrm/company-announcements/mark-all-read/?is_current=true&home_feed=true');
  },

  recordAnnouncementView: async (id: number): Promise<void> => {
    await managementApi.post(`/api-hrm/company-announcements/${id}/record_view/`);
  },

  createAnnouncement: async (formData: FormData): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.post('/api-hrm/company-announcements/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  updateAnnouncement: async (id: number, formData: FormData): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.patch(`/api-hrm/company-announcements/${id}/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  deleteAnnouncement: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/company-announcements/${id}/`);
  },

  // Company Policies
  getCompanyPolicies: async (params?: {
    page?: number;
    page_size?: number;
    policy_type?: string;
    is_active?: boolean;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: any[];
    }> = await managementApi.get('/api-hrm/company-policies/', { params });
    return response.data;
  },

  // Company Procedures
  getCompanyProcedures: async (params?: {
    page?: number;
    page_size?: number;
    department?: number;
    is_active?: boolean;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: any[];
    }> = await managementApi.get('/api-hrm/company-procedures/', { params });
    return response.data;
  },

  // Company Forms
  getCompanyForms: async (params?: {
    page?: number;
    page_size?: number;
    form_type?: string;
    department?: number;
    is_active?: boolean;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: any[];
    }> = await managementApi.get('/api-hrm/company-forms/', { params });
    return response.data;
  },

  // Company Training Materials
  getCompanyTrainingMaterials: async (params?: {
    page?: number;
    page_size?: number;
    training_type?: string;
    department?: number;
    is_active?: boolean;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: any[];
    }> = await managementApi.get('/api-hrm/company-training-materials/', { params });
    return response.data;
  },

  // Company Stats
  getCompanyInfoStats: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/company-info/stats/');
    return response.data;
  },
};

// Attendance Rule Configuration API
export const attendanceRuleAPI = {
  // Attendance Rule Configs
  listAttendanceRuleConfigs: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    rule_type?: string;
    is_active?: boolean;
    is_default?: boolean;
    is_current?: string;
    employee_id?: number;
    department_id?: number;
    position_id?: number;
    start_date?: string;
    end_date?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AttendanceRuleConfig[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AttendanceRuleConfig[];
    }> = await managementApi.get('/api-hrm/attendance-rule-configs/', { params });
    return response.data;
  },

  getAttendanceRuleConfigById: async (id: number): Promise<AttendanceRuleConfig> => {
    const response: AxiosResponse<AttendanceRuleConfig> = await managementApi.get(`/api-hrm/attendance-rule-configs/${id}/`);
    return response.data;
  },

  createAttendanceRuleConfig: async (data: Partial<AttendanceRuleConfig>): Promise<AttendanceRuleConfig> => {
    const response: AxiosResponse<AttendanceRuleConfig> = await managementApi.post('/api-hrm/attendance-rule-configs/', data);
    return response.data;
  },

  updateAttendanceRuleConfig: async (id: number, data: Partial<AttendanceRuleConfig>): Promise<AttendanceRuleConfig> => {
    const response: AxiosResponse<AttendanceRuleConfig> = await managementApi.put(`/api-hrm/attendance-rule-configs/${id}/`, data);
    return response.data;
  },

  partialUpdateAttendanceRuleConfig: async (id: number, data: Partial<AttendanceRuleConfig>): Promise<AttendanceRuleConfig> => {
    const response: AxiosResponse<AttendanceRuleConfig> = await managementApi.patch(`/api-hrm/attendance-rule-configs/${id}/`, data);
    return response.data;
  },

  deleteAttendanceRuleConfig: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/attendance-rule-configs/${id}/`);
  },

  getCurrentAttendanceRuleConfigs: async (): Promise<AttendanceRuleConfig[]> => {
    const response: AxiosResponse<AttendanceRuleConfig[]> = await managementApi.get('/api-hrm/attendance-rule-configs/current/');
    return response.data;
  },

  getEmployeeAttendanceRuleConfigs: async (employeeId: number): Promise<AttendanceRuleConfig[]> => {
    const response: AxiosResponse<AttendanceRuleConfig[]> = await managementApi.get(`/api-hrm/attendance-rule-configs/employee_rules/?employee_id=${employeeId}`);
    return response.data;
  },

  getAttendanceRuleConfigStats: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/attendance-rule-configs/stats/');
    return response.data;
  },

  // Attendance Rule History
  listAttendanceRuleHistory: async (params?: {
    page?: number;
    page_size?: number;
    attendance?: number;
    rule?: number;
    applied_by?: number;
    start_date?: string;
    end_date?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AttendanceRuleHistory[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AttendanceRuleHistory[];
    }> = await managementApi.get('/api-hrm/attendance-rule-history/', { params });
    return response.data;
  },

  getAttendanceRuleHistoryById: async (id: number): Promise<AttendanceRuleHistory> => {
    const response: AxiosResponse<AttendanceRuleHistory> = await managementApi.get(`/api-hrm/attendance-rule-history/${id}/`);
    return response.data;
  },

  // Leave Policy Configs
  listLeavePolicyConfigs: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    leave_type?: string;
    is_active?: boolean;
    is_current?: string;
    employee_id?: number;
    department_id?: number;
    position_id?: number;
    start_date?: string;
    end_date?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: LeavePolicyConfig[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: LeavePolicyConfig[];
    }> = await managementApi.get('/api-hrm/leave-policy-configs/', { params });
    return response.data;
  },

  getLeavePolicyConfigById: async (id: number): Promise<LeavePolicyConfig> => {
    const response: AxiosResponse<LeavePolicyConfig> = await managementApi.get(`/api-hrm/leave-policy-configs/${id}/`);
    return response.data;
  },

  createLeavePolicyConfig: async (data: Partial<LeavePolicyConfig>): Promise<LeavePolicyConfig> => {
    const response: AxiosResponse<LeavePolicyConfig> = await managementApi.post('/api-hrm/leave-policy-configs/', data);
    return response.data;
  },

  updateLeavePolicyConfig: async (id: number, data: Partial<LeavePolicyConfig>): Promise<LeavePolicyConfig> => {
    const response: AxiosResponse<LeavePolicyConfig> = await managementApi.put(`/api-hrm/leave-policy-configs/${id}/`, data);
    return response.data;
  },

  partialUpdateLeavePolicyConfig: async (id: number, data: Partial<LeavePolicyConfig>): Promise<LeavePolicyConfig> => {
    const response: AxiosResponse<LeavePolicyConfig> = await managementApi.patch(`/api-hrm/leave-policy-configs/${id}/`, data);
    return response.data;
  },

  deleteLeavePolicyConfig: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/leave-policy-configs/${id}/`);
  },

  getCurrentLeavePolicyConfigs: async (): Promise<LeavePolicyConfig[]> => {
    const response: AxiosResponse<LeavePolicyConfig[]> = await managementApi.get('/api-hrm/leave-policy-configs/current/');
    return response.data;
  },

  getEmployeeLeavePolicyConfigs: async (employeeId: number): Promise<LeavePolicyConfig[]> => {
    const response: AxiosResponse<LeavePolicyConfig[]> = await managementApi.get(`/api-hrm/leave-policy-configs/employee_policies/?employee_id=${employeeId}`);
    return response.data;
  },

  calculateAdvanceNotice: async (data: {
    employee_id: number;
    leave_type: string;
    total_days: number;
    start_date?: string;
  }): Promise<{
    required_advance_notice_days: number;
    required_advance_notice_hours: number;
    is_emergency: boolean;
    can_request: boolean;
    message: string;
  }> => {
    const response: AxiosResponse<{
      required_advance_notice_days: number;
      required_advance_notice_hours: number;
      is_emergency: boolean;
      can_request: boolean;
      message: string;
    }> = await managementApi.post('/api-hrm/leave-policy-configs/calculate_advance_notice/', data);
    return response.data;
  },

  getLeavePolicyConfigStats: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/leave-policy-configs/stats/');
    return response.data;
  },

  // Attendance Rule Engine
  calculateAttendance: async (data: AttendanceRuleEngineRequest): Promise<AttendanceRuleEngineResponse> => {
    const response: AxiosResponse<AttendanceRuleEngineResponse> = await managementApi.post('/api-hrm/attendance-rule-engine/', data);
    return response.data;
  },

  testRuleApplication: async (params?: {
    employee_id?: number;
    rule_id?: number;
    date?: string;
  }): Promise<AttendanceRuleEngineResponse> => {
    const response: AxiosResponse<AttendanceRuleEngineResponse> = await managementApi.get('/api-hrm/attendance-rule-engine/test_rule_application/', { params });
    return response.data;
  },
};
