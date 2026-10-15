import { managementApi } from '../utils/api';

let attendanceStatsPromises: Record<string, Promise<AttendanceStats>> = {};
let calendarViewPromises: Record<string, Promise<CalendarViewData>> = {};

export interface AttendanceEvent {
  id: number;
  event_type: string;
  event_date: string;
  check_in: string | null;
  check_out: string | null;
  overtime_hours: number | null;
  explanation: string | null;
  notes: string;
  data: Record<string, any>;
  created_at: string;
  created_by: string | null;
  is_hr_created?: boolean;
  employee_is_hr?: boolean;
}

export interface AttendanceRecord {
  id: number;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  status_display: string;
  shift_type: string;
  shift_type_display: string;
  working_hours: number;
  overtime_hours: number;
  late_minutes: number;
  early_leave_minutes: number;
  late_penalty?: number;
  early_leave_penalty?: number;
  notes: string;
  employee_name: string;
  employee_code: string;
  department_name: string;
  events?: AttendanceEvent[];
}

export interface AttendanceStats {
  statistics: {
    total_days: number;
    status_summary: {
      PRESENT?: number;
      LATE?: number;
      ABSENT?: number;
      EARLY_LEAVE?: number;
      HALF_DAY?: number;
    };
    total_working_hours: number;
    total_overtime_hours: number;
    total_late_minutes: number;
    total_early_leave_minutes: number;
  };
  filters: {
    employee_id?: number;
    department_id?: number;
    start_date: string;
    end_date: string;
  };
  attendance_by_date: Array<{
    attendance_date: string;
    count: number;
    present: number;
    late: number;
    absent: number;
    early_leave: number;
    half_day: number;
  }>;
  employees: Array<{
    id: number;
    full_name: string;
    employee_id: string;
  }>;
}

export interface CalendarViewData {
  year: number;
  month: number;
  employee: {
    id: number;
    employee_id: string;
    full_name: string;
  };
  summary: {
    total_work_days: number;
    full_days: number;
    half_days: number;
    late_or_early_days: number;
    absent_days: number;
    forgot_checkin_days: number;
    overtime_hours: number;
    extra_hours: number;
    night_shift_sessions: number;
    live_sessions: number;
    leave_days: number;
    holiday_days?: number;
    holiday_credit?: number;
    explanation_quota_max?: number;
    online_work_quota_used?: number;
    online_work_quota_max?: number;
    online_work_quota_remaining?: number;
    remaining_annual_leave?: number;
  };
  engine_summary: {
    total_penalty_vnd: number;
    total_parking_allowance: number;
    total_live_allowance: number;
    total_holiday_credit?: number;
    explanation_quota_used: number;
    events_processed: number;
  };
  shift_configs: any[];
  legend: Array<{
    day_status: string;
    label: string;
    color: string;
    description: string;
  }>;
  calendar: Array<{
    date: string;
    day: number;
    weekday: number;
    weekday_label: string;
    is_weekend: boolean;
    is_holiday: boolean;
    holiday_name: string | null;
    is_leave: boolean;
    day_status: string;
    status_badge: string | null;
    engine_context: {
      is_holiday: boolean;
      is_leave_day: boolean;
      is_absent: boolean;
      is_incomplete: boolean;
      work_credit: number;
      holiday_credit?: number;
      penalty_amount: number;
      overtime_hours: number;
      extra_hours: number;
      night_shift_sessions: number;
      live_sessions: number;
      late_minutes: number;
      early_leave_minutes: number;
      late_penalty?: number;
      early_leave_penalty?: number;
      rules_applied: string[];
    };
    shifts: Array<{
      shift_type: string;
      shift_label: string;
      shift_code?: string;
      scheduled_start?: string;
      scheduled_end?: string;
      check_in: string | null;
      check_out: string | null;
      status: string;
      status_color: string;
    }>;
    registrations: any[];
    raw_checkin_checkout: Array<{
      check_in: string | null;
      check_out: string | null;
    }>;
  }>;
  total_days_in_month: number;
}

export interface AttendanceParams {
  page?: number;
  page_size?: number;
  employee_id?: number;
  department_id?: number;
  start_date?: string;
  end_date?: string;
  status?: string;
  shift_type?: string;
  imported_from_file?: boolean;
  import_batch?: string;
  search?: string;
  ordering?: string;
}

export interface CalendarViewParams {
  employee_id?: number;
  department_id?: number;
  year?: number;
  month?: number;
}

export interface MonthlyWorkCreditsParams {
  month?: number;
  year?: number;
  employee_id?: number;
  department_id?: number;
}

export interface MonthlyWorkCreditsResult {
  employee: {
    id: number;
    employee_id: string;
    full_name: string;
    department: string | null;
    position: string | null;
  };
  month: number;
  year: number;
  date_range: {
    start_date: string;
    end_date: string;
  };
  attendance_summary: {
    total_days: number;
    total_work_hours: number;
    total_overtime_hours: number;
    total_late_minutes: number;
    total_early_leave_minutes: number;
    status_summary: Record<string, number>;
    attendance_rate: number;
    working_days_in_month: number;
  };
  approved_requests: {
    explanations: number;
    leaves: number;
  };
  credit_calculation: {
    work_credits: number;
    overtime_credits: number;
    penalty_credits: number;
    total_credits: number;
    overtime_multiplier: number;
  };
  notes: string[];
}

export interface MonthlyWorkCreditsResponse {
  filters: {
    month: number;
    year: number;
    employee_id?: number;
    department_id?: number;
  };
  company_config: {
    default_working_hours_per_day: number;
    overtime_multiplier_weekday: number;
    overtime_multiplier_weekend: number;
    overtime_multiplier_holiday: number;
  };
  results: MonthlyWorkCreditsResult[];
  summary: {
    total_employees: number;
    total_work_days: number;
    total_work_hours: number;
    total_work_credits: number;
    total_overtime_hours: number;
    total_overtime_credits: number;
    total_late_minutes: number;
    total_early_leave_minutes: number;
    total_penalty_credits: number;
    avg_work_credits: number;
    avg_overtime_credits: number;
    avg_penalty_credits: number;
    avg_total_credits: number;
  };
  calculation_rules: {
    work_credits: string;
    overtime_credits: string;
    penalty_credits: string;
    total_credits: string;
  };
}

class AttendanceService {
  /**
   * Lấy danh sách bản ghi chấm công
   */
  async getAttendanceRecords(params?: AttendanceParams): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AttendanceRecord[];
  }> {
    try {
      const response = await managementApi.get('/api-hrm/attendance/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance records:', error);
      throw error;
    }
  }

  /**
   * Lấy thống kê chấm công
   */
  async getAttendanceStats(params?: {
    employee_id?: number;
    department_id?: number;
    start_date?: string;
    end_date?: string;
  }): Promise<AttendanceStats> {
    const cacheKey = JSON.stringify(params || {});
    if (cacheKey in attendanceStatsPromises) {
      return attendanceStatsPromises[cacheKey];
    }
    
    attendanceStatsPromises[cacheKey] = (async () => {
      try {
        const response = await managementApi.get('/api-hrm/attendance/stats/', { params });
        return response.data;
      } catch (error) {
        console.error('Error fetching attendance stats:', error);
        throw error;
      } finally {
        setTimeout(() => { delete attendanceStatsPromises[cacheKey]; }, 100);
      }
    })();
    return attendanceStatsPromises[cacheKey];
  }

  /**
   * Lấy dữ liệu lịch chấm công
   */
  async getCalendarView(params?: CalendarViewParams): Promise<CalendarViewData> {
    const cacheKey = JSON.stringify(params || {});
    if (cacheKey in calendarViewPromises) {
      return calendarViewPromises[cacheKey];
    }
    
    calendarViewPromises[cacheKey] = (async () => {
      try {
        const response = await managementApi.get('/api-hrm/attendance/calendar-view/', { params });
        return response.data;
      } catch (error) {
        console.error('Error fetching calendar view:', error);
        throw error;
      } finally {
        // clear cache slightly later to deduplicate very close concurrent requests
        setTimeout(() => { delete calendarViewPromises[cacheKey]; }, 100);
      }
    })();
    return calendarViewPromises[cacheKey];
  }

  /**
   * Lấy chi tiết một bản ghi chấm công
   */
  async getAttendanceRecordById(id: number): Promise<AttendanceRecord> {
    try {
      const response = await managementApi.get(`/api-hrm/attendance/${id}/`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching attendance record ${id}:`, error);
      throw error;
    }
  }

  /**
   * Tạo bản ghi chấm công mới
   */
  async createAttendanceRecord(data: Partial<AttendanceRecord>): Promise<AttendanceRecord> {
    try {
      const response = await managementApi.post('/api-hrm/attendance/', data);
      return response.data;
    } catch (error) {
      console.error('Error creating attendance record:', error);
      throw error;
    }
  }

  /**
   * Cập nhật bản ghi chấm công
   */
  async updateAttendanceRecord(id: number, data: Partial<AttendanceRecord>): Promise<AttendanceRecord> {
    try {
      const response = await managementApi.put(`/api-hrm/attendance/${id}/`, data);
      return response.data;
    } catch (error) {
      console.error(`Error updating attendance record ${id}:`, error);
      throw error;
    }
  }

  /**
   * Xóa bản ghi chấm công
   */
  async deleteAttendanceRecord(id: number): Promise<void> {
    try {
      await managementApi.delete(`/api-hrm/attendance/${id}/`);
    } catch (error) {
      console.error(`Error deleting attendance record ${id}:`, error);
      throw error;
    }
  }

  /**
   * Tải lên file chấm công
   */
  async uploadAttendanceFile(file: File, importBatch?: string): Promise<any> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (importBatch) {
        formData.append('import_batch', importBatch);
      }

      const response = await managementApi.post('/api-hrm/attendance/upload/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error uploading attendance file:', error);
      throw error;
    }
  }

  /**
   * Tải mẫu file chấm công
   */
  async downloadAttendanceTemplate(): Promise<Blob> {
    try {
      const response = await managementApi.get('/api-hrm/attendance/upload/template/', {
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      console.error('Error downloading attendance template:', error);
      throw error;
    }
  }

  /**
   * Validate file chấm công trước khi import
   */
  async validateAttendanceFile(file: File): Promise<any> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await managementApi.post('/api-hrm/attendance/upload/validate/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error validating attendance file:', error);
      throw error;
    }
  }

  /**
   * Lấy lịch sử upload file
   */
  async getUploadHistory(params?: {
    page?: number;
    page_size?: number;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> {
    try {
      const response = await managementApi.get('/api-hrm/attendance/upload_history/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching upload history:', error);
      throw error;
    }
  }

  /**
   * Lấy lịch sử import attendance (mới)
   */
  async getAttendanceImportLogs(params?: {
    page?: number;
    page_size?: number;
    start_date?: string;
    end_date?: string;
    status?: string;
    imported_by?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: any[];
  }> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-import-logs/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance import logs:', error);
      throw error;
    }
  }

  /**
   * Lấy chi tiết import log
   */
  async getAttendanceImportLogDetails(id: number): Promise<any> {
    try {
      const response = await managementApi.get(`/api-hrm/attendance-import-logs/${id}/details/`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching attendance import log details ${id}:`, error);
      throw error;
    }
  }

  /**
   * Lấy thống kê import
   */
  async getAttendanceImportStats(): Promise<any> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-import-logs/stats/');
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance import stats:', error);
      throw error;
    }
  }

  /**
   * Lấy lịch sử import gần đây
   */
  async getRecentAttendanceImports(): Promise<any[]> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-import-logs/recent/');
      return response.data;
    } catch (error) {
      console.error('Error fetching recent attendance imports:', error);
      throw error;
    }
  }

  /**
   * Lấy thống kê giải trình chấm công
   */
  async getAttendanceExplanationStats(params?: {
    employee_id?: number;
    department_id?: number;
    month?: number;
    year?: number;
  }): Promise<{
    filters: {
      employee_id?: number;
      department_id?: number;
      month: number;
      year: number;
    };
    statistics: {
      total_explanations: number;
      pending_explanations: number;
      approved_explanations: number;
      rejected_explanations: number;
      remaining_explanations: number;
      max_explanations_per_month: number;
      // THÊM MỚI (optional để tương thích ngược)
      non_quota_explanations?: number;
      quota_consuming_explanations?: number;
      // ONLINE WORK STATS
      max_online_work_per_month?: number;
      remaining_online_work?: number;
      // Phòng ban được làm online chiều T7 tuần 2/4 & Chủ nhật không giới hạn
      online_weekend_unlimited?: boolean;
      approved_online_work?: number;
      approved_leave?: number;
      max_leave_per_month?: number;
      approved_registrations?: number;
    };
  }> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-explanations/stats/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance explanation stats:', error);
      throw error;
    }
  }

  /**
   * Lấy số lần giải trình còn lại của tháng hiện tại cho nhân viên
   */
  async getEmployeeRemainingExplanationCount(employeeId: number): Promise<{
    employee: {
      id: number;
      full_name: string;
      employee_id: string;
    };
    month: number;
    year: number;
    explanation_count: number;
    max_explanations_per_month: number;
    remaining_count: number;
  }> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-explanations/employee_remaining_count/', {
        params: { employee_id: employeeId }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching employee remaining explanation count:', error);
      throw error;
    }
  }

  /**
   * ==================== MONTHLY LEAVE REQUESTS (Nghỉ phép tháng) ====================
   */

  /**
   * Lấy danh sách đơn nghỉ phép tháng
   */
  async getMonthlyLeaveRequests(params?: {
    employee_id?: number;
    month?: number;
    year?: number;
    status?: string;
    start_date?: string;
    end_date?: string;
    page_size?: number;
    ordering?: string;
  }): Promise<{ count: number; results: any[] }> {
    try {
      const response = await managementApi.get('/api-hrm/monthly-leave-requests/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching monthly leave requests:', error);
      throw error;
    }
  }

  /**
   * Tạo đơn nghỉ phép tháng mới
   */
  async createMonthlyLeaveRequest(data: {
    employee_id: number;
    attendance_date: string;
    reason: string;
    expected_status: string; // HALF_DAY or PRESENT (Full day)
    original_status?: string;
    // Bắt buộc truyền khi expected_status=HALF_DAY — dùng để BE tính đúng
    // hạn tạo đơn (4 giờ trước GIỜ BẮT ĐẦU ca sáng/chiều tương ứng). KHÔNG
    // được bỏ trống rồi trông chờ BE tự đoán qua chữ "sáng"/"chiều" trong
    // `reason` — nếu nhân sự gõ ghi chú riêng, hạn sẽ bị tính nhầm theo ca
    // sáng (sớm hơn thực tế rất nhiều).
    half_day_period?: 'MORNING' | 'AFTERNOON';
  }): Promise<any> {
    try {
      const payload = {
        ...data,
        explanation_type: 'LEAVE',
        original_status: data.original_status || 'ABSENT',
      };
      const response = await managementApi.post('/api-hrm/monthly-leave-requests/', payload);
      return response.data;
    } catch (error) {
      console.error('Error creating monthly leave request:', error);
      throw error;
    }
  }

  /**
   * Huỷ (thu hồi) đơn nghỉ phép tháng — cơ chế DUY NHẤT để bỏ 1 đơn (backend
   * đã bỏ hẳn xoá cứng). Admin/HR/Quản lý huỷ được ở bất kỳ trạng thái nào;
   * chủ đơn tự huỷ chỉ khi còn chờ duyệt.
   */
  async cancelMonthlyLeaveRequest(leaveId: number, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/monthly-leave-requests/${leaveId}/cancel/`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error cancelling monthly leave request:', error);
      throw error;
    }
  }

  /**
   * Chủ đơn tự sửa lý do/ngày nghỉ đơn nghỉ phép tháng CHỜ DUYỆT của chính
   * mình — đổi attendance_date được backend validate lại hạn + trùng ngày.
   */
  async updateMonthlyLeaveRequest(leaveId: number, payload: { reason?: string; attendance_date?: string }): Promise<any> {
    try {
      const response = await managementApi.patch(`/api-hrm/monthly-leave-requests/${leaveId}/`, payload);
      return response.data;
    } catch (error) {
      console.error('Error updating monthly leave request:', error);
      throw error;
    }
  }

  /**
   * Lấy hạn mức nghỉ phép tháng (Quota)
   */
  async getMonthlyLeaveQuota(params: {
    employee_id?: number;
    month?: number;
    year?: number;
  }): Promise<{
    total_quota: number;
    used: number;
    remaining: number;
  }> {
    try {
      const response = await managementApi.get('/api-hrm/monthly-leave-requests/remaining_quota/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching monthly leave quota:', error);
      throw error;
    }
  }


  /**
   * Tạo giải trình chấm công (Đơn bổ sung công)
   */
  async createAttendanceExplanation(data: {
    employee_id: number;
    attendance_date: string;
    original_status: string;
    expected_status: string;
    reason: string;
    evidence?: File;
    actual_check_in?: string;
    actual_check_out?: string;
    expected_check_in?: string;
    expected_check_out?: string;
    status?: string;
  }): Promise<any> {
    try {
      const formData = new FormData();

      // Add all fields to formData
      formData.append('employee_id', data.employee_id.toString());
      formData.append('attendance_date', data.attendance_date);
      formData.append('original_status', data.original_status);
      formData.append('expected_status', data.expected_status);
      formData.append('reason', data.reason);

      // CRITICAL: Add explanation_type to FormData
      if ((data as any).explanation_type) {
        formData.append('explanation_type', (data as any).explanation_type);
      }

      if (data.actual_check_in) {
        formData.append('actual_check_in', data.actual_check_in);
      }
      if (data.actual_check_out) {
        formData.append('actual_check_out', data.actual_check_out);
      }
      if (data.expected_check_in) {
        formData.append('expected_check_in', data.expected_check_in);
      }
      if (data.expected_check_out) {
        formData.append('expected_check_out', data.expected_check_out);
      }

      if (data.status) {
        formData.append('status', data.status);
      }

      if (data.evidence) {
        formData.append('evidence', data.evidence);
      }

      // Add penalty and minute fields if they exist in data (passed as any/extended)
      const extendedData = data as any;
      if (extendedData.late_penalty !== undefined) formData.append('late_penalty', String(extendedData.late_penalty));
      if (extendedData.early_leave_penalty !== undefined) formData.append('early_leave_penalty', String(extendedData.early_leave_penalty));
      if (extendedData.late_minutes !== undefined) formData.append('late_minutes', String(extendedData.late_minutes));
      if (extendedData.early_leave_minutes !== undefined) formData.append('early_leave_minutes', String(extendedData.early_leave_minutes));
      if (extendedData.forgot_punch_type) formData.append('forgot_punch_type', extendedData.forgot_punch_type);
      if (extendedData.forgot_checkin_time) formData.append('forgot_checkin_time', extendedData.forgot_checkin_time);
      if (extendedData.forgot_checkout_time) formData.append('forgot_checkout_time', extendedData.forgot_checkout_time);
      // Chỉ dùng khi expected_status='HALF_DAY' (hiện áp dụng cho Công tác) —
      // BẮT BUỘC gửi tường minh, không để BE đoán qua chữ "sáng"/"chiều"
      // trong reason (xem createMonthlyLeaveRequest() cho bug class gốc).
      if (extendedData.half_day_period) formData.append('half_day_period', extendedData.half_day_period);

      const response = await managementApi.post('/api-hrm/attendance-explanations/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error creating attendance explanation:', error);
      throw error;
    }
  }

  /**
   * Gửi giải trình để duyệt
   */
  async submitAttendanceExplanationForApproval(explanationId: number): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/attendance-explanations/${explanationId}/submit_for_approval/`);
      return response.data;
    } catch (error) {
      console.error('Error submitting attendance explanation for approval:', error);
      throw error;
    }
  }

  /**
   * Huỷ (thu hồi) giải trình chấm công — cơ chế DUY NHẤT để bỏ 1 đơn (backend
   * đã bỏ hẳn xoá cứng). Admin/HR/Quản lý huỷ được ở bất kỳ trạng thái nào;
   * chủ đơn tự huỷ chỉ khi còn chờ duyệt.
   */
  async cancelAttendanceExplanation(explanationId: number, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/attendance-explanations/${explanationId}/cancel/`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error cancelling attendance explanation:', error);
      throw error;
    }
  }

  /**
   * Chủ đơn tự sửa lý do/giờ check-in-out thực tế của giải trình CHỜ DUYỆT
   * của chính mình — QLTT/HR/Admin sửa được bất kỳ lúc nào, kể cả đã duyệt
   * (yêu cầu HCNS 2026-09-21), gồm cả đổi ngày (attendance_date) áp dụng
   * cho LEAVE/BUSINESS_TRIP.
   */
  async updateAttendanceExplanation(
    explanationId: number,
    payload: { reason?: string; actual_check_in?: string; actual_check_out?: string; attendance_date?: string },
  ): Promise<any> {
    try {
      const response = await managementApi.patch(`/api-hrm/attendance-explanations/${explanationId}/`, payload);
      return response.data;
    } catch (error) {
      console.error('Error updating attendance explanation:', error);
      throw error;
    }
  }

  /**
   * Lấy danh sách giải trình chấm công
   */
  async getAttendanceExplanations(params?: {
    employee_id?: number;
    start_date?: string;
    end_date?: string;
    month?: number;
    year?: number;
    status?: string;
    page_size?: number;
    ordering?: string;
  }): Promise<{ count: number; results: any[] }> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-explanations/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance explanations:', error);
      throw error;
    }
  }

  /**
   * Lấy chi tiết một giải trình (bao gồm stats quota mới nhất)
   */
  async getAttendanceExplanation(id: number): Promise<any> {
    try {
      const response = await managementApi.get(`/api-hrm/attendance-explanations/${id}/`);
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance explanation detail:', error);
      throw error;
    }
  }

  /**
   * Lấy điểm công hàng tháng cho nhân viên
   */
  async getMonthlyWorkCredits(params?: MonthlyWorkCreditsParams): Promise<MonthlyWorkCreditsResponse> {
    try {
      const response = await managementApi.get('/api-hrm/monthly-work-credits/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching monthly work credits:', error);
      throw error;
    }
  }

  /**
   * ==================== ONLINE WORK REQUESTS ====================
   */

  /**
   * Tạo đơn làm việc online mới
   */
  async createOnlineWorkRequest(data: {
    employee_id: number;
    work_date: string;
    reason: string;
    work_plan?: string;
    half_day_period?: 'MORNING' | 'AFTERNOON';
  }): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/online-work-requests/', data);
      return response.data;
    } catch (error) {
      console.error('Error creating online work request:', error);
      throw error;
    }
  }

  /**
   * Lấy danh sách đơn làm việc online
   */
  async getOnlineWorkRequests(params?: {
    status?: string;
    work_date?: string;
    employee_id?: number;
    start_date?: string;
    end_date?: string;
    page_size?: number;
    ordering?: string;
  }): Promise<any> {
    try {
      const response = await managementApi.get('/api-hrm/online-work-requests/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching online work requests:', error);
      throw error;
    }
  }

  /**
   * Huỷ (thu hồi) đơn làm việc online — cơ chế DUY NHẤT để bỏ 1 đơn (backend
   * đã bỏ hẳn xoá cứng). Admin/HR/Quản lý huỷ được ở bất kỳ
   * trạng thái nào; chủ đơn tự huỷ chỉ khi còn chờ duyệt.
   */
  async cancelOnlineWorkRequest(id: number, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/online-work-requests/${id}/cancel/`, { reason });
      return response.data;
    } catch (error) {
      console.error(`Error cancelling online work request ${id}:`, error);
      throw error;
    }
  }

  /**
   * Chủ đơn tự sửa lý do đơn làm việc online CHỜ DUYỆT của chính mình
   */
  async updateOnlineWorkRequest(id: number, payload: { reason?: string }): Promise<any> {
    try {
      const response = await managementApi.patch(`/api-hrm/online-work-requests/${id}/`, payload);
      return response.data;
    } catch (error) {
      console.error(`Error updating online work request ${id}:`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách đơn đăng ký công (tăng ca, làm thêm giờ, trực tối, live)
   */
  async getRegistrationRequests(params?: {
    employee_id?: number;
    month?: number;
    year?: number;
    registration_type?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    page_size?: number;
    ordering?: string;
  }): Promise<{ count: number; results: RegistrationRequest[] }> {
    try {
      const response = await managementApi.get('/api-hrm/registration-requests/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching registration requests:', error);
      throw error;
    }
  }

  /**
   * Tạo đơn đăng ký công mới
   */
  async createRegistrationRequest(data: {
    employee_id: number;
    attendance_date: string;
    // Chỉ dùng cho registration_type=UNAUTHORIZED_ABSENCE: chọn khoảng ngày liên
    // tiếp (attendance_date = ngày bắt đầu) thay vì tạo từng đơn 1 ngày một. Khi
    // có end_date khác attendance_date, backend trả về { results, skipped_dates }
    // thay vì 1 RegistrationRequest duy nhất.
    end_date?: string;
    registration_type: 'OVERTIME' | 'EXTRA_HOURS' | 'NIGHT_SHIFT' | 'LIVE' | 'OFF_DUTY' | 'UNAUTHORIZED_ABSENCE' | 'SHIFT_CHANGE';
    start_time?: string;
    end_time?: string;
    reason: string;
    status?: string;
    // Chỉ dùng cho registration_type=OVERTIME: Tại Viện/VP (ONSITE, mặc định —
    // sẽ được tự đối chiếu giờ ra thực tế cuối tháng) hoặc Online (không đối
    // chiếu). Bỏ trống thì backend coi như chưa phân loại.
    ot_type?: 'ONSITE' | 'ONLINE' | '';
    // Chỉ dùng cho registration_type=UNAUTHORIZED_ABSENCE: 'ABSENT' (cả ngày,
    // mặc định) hoặc 'HALF_DAY' (nghỉ nửa ngày) — không dùng kèm end_date.
    expected_status?: 'ABSENT' | 'HALF_DAY';
    // Bắt buộc khi expected_status='HALF_DAY': buổi nghỉ cụ thể.
    half_day_period?: 'MORNING' | 'AFTERNOON';
  }): Promise<RegistrationRequest | { results: RegistrationRequest[]; skipped_dates: string[] }> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/', data);
      return response.data;
    } catch (error) {
      console.error('Error creating registration request:', error);
      throw error;
    }
  }

  /**
   * Huỷ (thu hồi) đơn đăng ký công — cơ chế DUY NHẤT để bỏ 1 đơn (backend đã
   * bỏ hẳn xoá cứng). Admin/HR/Quản lý huỷ được ở bất kỳ
   * trạng thái nào; chủ đơn tự huỷ chỉ khi còn chờ duyệt.
   */
  async cancelRegistrationRequest(id: number, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/registration-requests/${id}/cancel/`, { reason });
      return response.data;
    } catch (error) {
      console.error(`Error cancelling registration request ${id}:`, error);
      throw error;
    }
  }

  /**
   * Chủ đơn tự sửa lý do/giờ bắt đầu-kết thúc đơn đăng ký công (Tăng ca/Trực
   * tối/Live...) CHỜ DUYỆT của chính mình.
   */
  async updateRegistrationRequest(
    id: number,
    payload: { reason?: string; start_time?: string; end_time?: string },
  ): Promise<any> {
    try {
      const response = await managementApi.patch(`/api-hrm/registration-requests/${id}/`, payload);
      return response.data;
    } catch (error) {
      console.error(`Error updating registration request ${id}:`, error);
      throw error;
    }
  }

  /**
   * Huỷ CẢ NHÓM đơn Nghỉ không phép nhiều ngày liên tiếp (cùng request_code
   * — mỗi ngày là 1 bản ghi riêng ở backend, xem cancel_group()). Trả về
   * { cancelled_dates, skipped } — skipped liệt kê ngày không huỷ được
   * (đã quá hạn/đã duyệt) kèm lý do, để FE báo rõ thay vì huỷ nửa vời.
   */
  async cancelRegistrationRequestGroup(requestCode: string, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/cancel_group/', {
        request_code: requestCode,
        reason,
      });
      return response.data;
    } catch (error) {
      console.error(`Error cancelling registration request group ${requestCode}:`, error);
      throw error;
    }
  }

  /**
   * Sửa lý do cho CẢ NHÓM đơn Nghỉ không phép nhiều ngày (cùng request_code
   * — xem update_group()). Trả về { updated_dates, skipped }.
   */
  async updateRegistrationRequestGroup(requestCode: string, payload: { reason: string }): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/update_group/', {
        request_code: requestCode,
        ...payload,
      });
      return response.data;
    } catch (error) {
      console.error(`Error updating registration request group ${requestCode}:`, error);
      throw error;
    }
  }

  /**
   * Đổi loại đơn Nghỉ phép tháng → Nghỉ không phép (cùng ngày) — huỷ đơn cũ
   * (tôn trọng đúng quyền tự huỷ/"Mở khoá đặc biệt" của cancelMonthlyLeaveRequest)
   * rồi tạo đơn Nghỉ không phép mới. Nếu bước tạo đơn mới thất bại (vd hết
   * hạn/quota), đơn cũ ĐÃ bị huỷ rồi — không tự khôi phục lại (nhất quán với
   * cách "sửa đơn" hiện có: huỷ cũ + tạo mới, không phải giao dịch 2 chiều).
   */
  async convertLeaveToUnauthorized(item: {
    id: number;
    employee_id: number;
    attendance_date: string;
    reason?: string;
  }): Promise<any> {
    await this.cancelMonthlyLeaveRequest(item.id);
    return this.createRegistrationRequest({
      employee_id: item.employee_id,
      attendance_date: item.attendance_date,
      registration_type: 'UNAUTHORIZED_ABSENCE',
      reason: item.reason || 'Chuyển từ đơn Nghỉ phép tháng',
    });
  }

  /**
   * Đổi loại đơn Nghỉ không phép → Nghỉ phép tháng (cùng ngày) — chiều
   * ngược lại của convertLeaveToUnauthorized().
   */
  async convertUnauthorizedToLeave(item: {
    id: number;
    employee_id: number;
    attendance_date: string;
    reason?: string;
  }): Promise<any> {
    await this.cancelRegistrationRequest(item.id);
    return this.createMonthlyLeaveRequest({
      employee_id: item.employee_id,
      attendance_date: item.attendance_date,
      reason: item.reason || 'Chuyển từ đơn Nghỉ không phép',
      expected_status: 'PRESENT',
    });
  }

  /**
   * Sửa thông tin check-in/check-out của một ngày
   */
  async editAttendance(data: {
    employee_id: number;
    date: string;
    check_in?: string | null;
    check_out?: string | null;
  }): Promise<any> {
    try {
      const response = await managementApi.post('/api/v1/hrm/attendance/edit-attendance/', data);
      return response.data;
    } catch (error) {
      console.error('Error editing attendance:', error);
      throw error;
    }
  }

  /**
   * Tính toán & lưu bảng xếp hạng cho một tháng (chỉ HR/superuser)
   */
  async computeRanking(year: number, month: number): Promise<any> {
    try {
      const response = await managementApi.post('/api/v1/hrm/attendance/ranking/compute/', { year, month });
      return response.data;
    } catch (error) {
      console.error('Error computing ranking:', error);
      throw error;
    }
  }

  /**
   * Lấy bảng xếp hạng chấm công
   */
  async getRanking(params?: {
    year?: number;
    month?: number;
    type?: 'early' | 'on_time';
    top?: number;
    employee_id?: number;
  }): Promise<AttendanceRankingEntry[]> {
    try {
      const response = await managementApi.get('/api/v1/hrm/attendance/ranking/', { params });
      // API wraps result: { success, data: { rankings: [...] } }
      const body = response.data;
      if (body?.success && Array.isArray(body?.data?.rankings)) {
        return body.data.rankings;
      }
      // Fallback: flat array returned directly
      return Array.isArray(body) ? body : [];
    } catch (error) {
      console.error('Error fetching attendance ranking:', error);
      throw error;
    }
  }
}

export const attendanceService = new AttendanceService();
export default attendanceService;

// AttendanceRankingEntry interface
export interface AttendanceRankingEntry {
  employee_id: number;
  employee_code: string;
  full_name: string;
  avatar: string | null;
  department: string | null;
  year: number;
  month: number;
  early_days: number;
  total_early_minutes: number;
  avg_early_minutes: number;
  early_ratio: number;
  on_time_days: number;
  total_working_days: number;
  rank_early: number | null;
  rank_on_time: number | null;
  computed_at: string | null;
  remaining_explanations?: number | null;
  max_explanations_per_month?: number | null;
}

// RegistrationRequest interface
export interface RegistrationRequest {
  id: number;
  request_code: string;
  employee: number;
  employee_name: string;
  employee_id_code?: string;
  department_name?: string;
  registration_type: 'OVERTIME' | 'EXTRA_HOURS' | 'NIGHT_SHIFT' | 'LIVE' | 'OFF_DUTY' | 'UNAUTHORIZED_ABSENCE';
  registration_type_display: string;
  attendance_date: string;
  // Với đơn nghỉ không phép nhiều ngày: start_date/end_date là cả khoảng ngày của
  // đơn (mỗi ngày trong khoảng là 1 record riêng nhưng đều mang chung khoảng này).
  start_date?: string;
  end_date?: string;
  start_time: string | null;
  end_time: string | null;
  total_hours: number;
  reason: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  status_display: string;
  direct_manager_approved: boolean;
  hr_approved: boolean;
  direct_manager_approved_at: string | null;
  hr_approved_at: string | null;
  created_at: string;
  updated_at: string;
}
