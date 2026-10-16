import { managementApi } from "@/utils/api";


export interface ApprovalRequest {
  id: number;
  request_code: string;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  request_type: 'LEAVE' | 'OVERTIME' | 'ATTENDANCE_EXPLANATION';
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  total_days?: number;
  total_hours?: number;
  created_at: string;
  submitted_at?: string;
  approved_at?: string;
  rejected_at?: string;
  current_approval_level?: string;
  department_name?: string;
}

export interface ApprovalStats {
  total_pending: number;
  pending_leave: number;
  pending_overtime: number;
  pending_explanation: number;
  total_approved: number;
  approved_this_month: number;
}

export interface ApprovalActionRequest {
  action: 'APPROVE' | 'REJECT' | 'RETURN' | 'FORWARD';
  note?: string;
  next_approver_id?: number;
}

class ApprovalService {
  // Lấy danh sách các đơn chờ duyệt
  async getPendingApprovals(): Promise<ApprovalRequest[]> {
    try {
      // Tạm thời trả về mảng rỗng vì chưa có API tổng hợp
      // TODO: Tạo API endpoint tổng hợp trong backend
      return [];
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
      throw error;
    }
  }

  // Lấy thống kê approvals
  async getApprovalStats(): Promise<ApprovalStats> {
    try {
      // Tạm thời trả về dữ liệu mẫu
      // TODO: Tạo API endpoint thống kê trong backend
      return {
        total_pending: 0,
        pending_leave: 0,
        pending_overtime: 0,
        pending_explanation: 0,
        total_approved: 0,
        approved_this_month: 0
      };
    } catch (error) {
      console.error('Error fetching approval stats:', error);
      throw error;
    }
  }

  // Lấy danh sách attendance explanations theo trạng thái
  async getAttendanceExplanationsByStatus(status: string, params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-explanations/', {
        params: {
          status: status,
          ordering: '-created_at',
          day: params?.day && params.day !== 0 ? params.day : undefined,
          month: params?.month,
          year: params?.year
        }
      });
      return response.data.results || [];
    } catch (error) {
      console.error(`Error fetching ${status} attendance explanations:`, error);
      throw error;
    }
  }

  // Lấy danh sách attendance explanations chờ duyệt
  async getPendingAttendanceExplanations(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getAttendanceExplanationsByStatus('PENDING', params);
  }

  // Lấy danh sách attendance explanations đã duyệt
  async getApprovedAttendanceExplanations(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getAttendanceExplanationsByStatus('APPROVED', params);
  }

  // Lấy danh sách attendance explanations đã từ chối
  async getRejectedAttendanceExplanations(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getAttendanceExplanationsByStatus('REJECTED', params);
  }

  // Duyệt attendance explanation
  async approveAttendanceExplanation(explanationId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/attendance-explanations/${explanationId}/approve/`, {
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error approving attendance explanation:', error);
      throw error;
    }
  }

  // Từ chối attendance explanation
  async rejectAttendanceExplanation(explanationId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/attendance-explanations/${explanationId}/reject/`, {
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error rejecting attendance explanation:', error);
      throw error;
    }
  }

  // Duyệt monthly leave request
  async approveMonthlyLeaveRequest(leaveId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/monthly-leave-requests/${leaveId}/approve/`, {
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error approving monthly leave request:', error);
      throw error;
    }
  }

  // Từ chối monthly leave request
  async rejectMonthlyLeaveRequest(leaveId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/monthly-leave-requests/${leaveId}/reject/`, {
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error rejecting monthly leave request:', error);
      throw error;
    }
  }

  // Lấy thống kê attendance explanations
  async getAttendanceExplanationStats(): Promise<any> {
    try {
      const response = await managementApi.get('/api-hrm/attendance-explanations/stats/');
      return response.data;
    } catch (error) {
      console.error('Error fetching attendance explanation stats:', error);
      throw error;
    }
  }

  // Lấy danh sách monthly leave requests theo trạng thái
  async getMonthlyLeaveRequestsByStatus(status: string, params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    try {
      const response = await managementApi.get('/api-hrm/monthly-leave-requests/', {
        params: {
          status: status,
          ordering: '-created_at',
          day: params?.day && params.day !== 0 ? params.day : undefined,
          month: params?.month,
          year: params?.year
        }
      });
      return response.data.results || [];
    } catch (error) {
      console.error(`Error fetching ${status} monthly leave requests:`, error);
      throw error;
    }
  }

  // Lấy danh sách leave requests chờ duyệt
  async getPendingLeaveRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getMonthlyLeaveRequestsByStatus('PENDING', params);
  }

  // Lấy danh sách leave requests đã duyệt
  async getApprovedLeaveRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getMonthlyLeaveRequestsByStatus('APPROVED', params);
  }

  // Lấy danh sách leave requests đã từ chối
  async getRejectedLeaveRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getMonthlyLeaveRequestsByStatus('REJECTED', params);
  }

  // Lấy danh sách registration requests theo trạng thái
  async getRegistrationRequestsByStatus(status: string, params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    try {
      const response = await managementApi.get('/api-hrm/registration-requests/', {
        params: {
          status: status,
          ordering: '-created_at',
          day: params?.day && params.day !== 0 ? params.day : undefined,
          month: params?.month,
          year: params?.year
        }
      });
      return Array.isArray(response.data) ? response.data : (response.data.results || []);
    } catch (error) {
      console.error(`Error fetching ${status} registration requests:`, error);
      throw error;
    }
  }

  // Lấy danh sách registration requests chờ duyệt
  async getPendingRegistrationRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getRegistrationRequestsByStatus('PENDING', params);
  }

  // Lấy danh sách registration requests đã duyệt
  async getApprovedRegistrationRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getRegistrationRequestsByStatus('APPROVED', params);
  }

  // Lấy danh sách registration requests đã từ chối
  async getRejectedRegistrationRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getRegistrationRequestsByStatus('REJECTED', params);
  }

  // Duyệt registration request
  async approveRegistrationRequest(requestId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/registration-requests/${requestId}/approve/`, {
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error approving registration request:', error);
      throw error;
    }
  }

  // Từ chối registration request
  async rejectRegistrationRequest(requestId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/registration-requests/${requestId}/reject/`, {
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error rejecting registration request:', error);
      throw error;
    }
  }

  // Duyệt CẢ NHÓM đơn Nghỉ không phép nhiều ngày (cùng request_code) trong 1
  // lần — dùng khi duyệt từ màn "Chi tiết ngày" (AttendanceCalendar.tsx), nơi
  // chỉ thấy/duyệt được đúng 1 ngày nếu gọi approveRegistrationRequest(id) như
  // đơn 1 ngày bình thường, khiến các ngày còn lại trong đơn vẫn treo PENDING
  // dù QLTT tin là đã duyệt xong cả đơn (case thực tế 2026-09-24, NV00643).
  async approveRegistrationRequestGroup(requestCode: string, note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/approve_group/', {
        request_code: requestCode,
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error approving registration request group:', error);
      throw error;
    }
  }

  // Từ chối CẢ NHÓM đơn Nghỉ không phép nhiều ngày — xem approveRegistrationRequestGroup.
  async rejectRegistrationRequestGroup(requestCode: string, note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/reject_group/', {
        request_code: requestCode,
        approval_note: note || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error rejecting registration request group:', error);
      throw error;
    }
  }

  // Huỷ (thu hồi) registration request — cơ chế DUY NHẤT để bỏ 1 đơn (backend
  // đã bỏ hẳn xoá cứng). Admin/HR/Quản lý huỷ được ở bất kỳ trạng thái nào;
  // chủ đơn tự huỷ chỉ khi còn chờ duyệt.
  async cancelRegistrationRequest(requestId: number, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/registration-requests/${requestId}/cancel/`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error cancelling registration request:', error);
      throw error;
    }
  }

  // Huỷ CẢ NHÓM đơn Nghỉ không phép nhiều ngày (cùng request_code) — xem
  // approveRegistrationRequestGroup() cho lý do cần bản riêng cho nhóm nhiều
  // ngày thay vì cancelRegistrationRequest() từng ngày.
  async cancelRegistrationRequestGroup(requestCode: string, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/cancel_group/', {
        request_code: requestCode,
        reason
      });
      return response.data;
    } catch (error) {
      console.error('Error cancelling registration request group:', error);
      throw error;
    }
  }

  // Sửa 1 registration request CHỜ DUYỆT: chủ đơn sửa lý do, hoặc quản lý
  // trực tiếp/HCNS sửa giờ tăng ca (start_time/end_time/hours — backend chặn
  // theo hạn 10h sáng hôm sau, xem manager_attendance_fix_deadline).
  async updateRegistrationRequest(
    requestId: number,
    payload: { reason?: string; start_time?: string; end_time?: string; hours?: number },
  ): Promise<any> {
    try {
      const response = await managementApi.patch(`/api-hrm/registration-requests/${requestId}/`, payload);
      return response.data;
    } catch (error) {
      console.error('Error updating registration request:', error);
      throw error;
    }
  }

  // Lấy danh sách overtime requests chờ duyệt (tạm thời chưa có API)
  async getPendingOvertimeRequests(): Promise<any[]> {
    try {
      // TODO: Tạo API endpoint cho overtime requests
      return [];
    } catch (error) {
      console.error('Error fetching pending overtime requests:', error);
      throw error;
    }
  }

  // Lấy danh sách online work requests theo trạng thái
  async getOnlineWorkRequestsByStatus(status: string, params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    try {
      const response = await managementApi.get('/api-hrm/online-work-requests/', {
        params: {
          status: status,
          ordering: '-created_at',
          day: params?.day && params.day !== 0 ? params.day : undefined,
          month: params?.month,
          year: params?.year
        }
      });
      console.log(`🔵 [APPROVAL SERVICE] Online work ${status} response:`, response.data);
      // API có thể trả về array trực tiếp hoặc trong results field
      return Array.isArray(response.data) ? response.data : (response.data.results || []);
    } catch (error) {
      console.error(`Error fetching ${status} online work requests:`, error);
      throw error;
    }
  }

  // Lấy danh sách online work requests chờ duyệt
  async getPendingOnlineWorkRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getOnlineWorkRequestsByStatus('PENDING', params);
  }

  // Lấy danh sách online work requests đã duyệt
  async getApprovedOnlineWorkRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getOnlineWorkRequestsByStatus('APPROVED', params);
  }

  // Lấy danh sách online work requests đã từ chối
  async getRejectedOnlineWorkRequests(params?: { day?: number; month?: number; year?: number }): Promise<any[]> {
    return this.getOnlineWorkRequestsByStatus('REJECTED', params);
  }

  // Duyệt online work request
  async approveOnlineWorkRequest(requestId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(
        `/api-hrm/online-work-requests/${requestId}/approve/`,
        { approval_note: note || '' }
      );
      return response.data;
    } catch (error) {
      console.error('Error approving online work request:', error);
      throw error;
    }
  }

  // Từ chối online work request
  async rejectOnlineWorkRequest(requestId: number, note?: string): Promise<any> {
    try {
      const response = await managementApi.post(
        `/api-hrm/online-work-requests/${requestId}/reject/`,
        { approval_note: note || '' }
      );
      return response.data;
    } catch (error) {
      console.error('Error rejecting online work request:', error);
      throw error;
    }
  }

  // Huỷ (thu hồi) online work request — cơ chế DUY NHẤT để bỏ 1 đơn (backend
  // đã bỏ hẳn xoá cứng). Admin/HR/Quản lý huỷ được ở bất kỳ trạng thái nào;
  // chủ đơn tự huỷ chỉ khi còn chờ duyệt.
  async cancelOnlineWorkRequest(requestId: number, reason?: string): Promise<any> {
    try {
      const response = await managementApi.post(`/api-hrm/online-work-requests/${requestId}/cancel/`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error cancelling online work request:', error);
      throw error;
    }
  }

  // Chủ đơn tự sửa lý do online work request CHỜ DUYỆT của chính mình
  async updateOnlineWorkRequest(requestId: number, payload: { reason: string }): Promise<any> {
    try {
      const response = await managementApi.patch(`/api-hrm/online-work-requests/${requestId}/`, payload);
      return response.data;
    } catch (error) {
      console.error('Error updating online work request:', error);
      throw error;
    }
  }

  // Lấy danh sách tất cả các đơn theo trạng thái từ API tổng hợp
  async getDuyetDonList(
    status: string,
    params?: { day?: number; month?: number; year?: number; employee_id?: number },
    onProgress?: (loaded: number, total: number | null) => void,
    onPage?: (accumulated: any[]) => void,
    signal?: AbortSignal
  ): Promise<any[]> {
    const PAGE_SIZE = 200;
    const accumulated: any[] = [];
    let page = 1;
    let total: number | null = null;

    try {
      while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const response = await managementApi.get('/api-hrm/duyet-don/', {
          params: {
            status,
            ordering: '-created_at',
            day: params?.day && params.day !== 0 ? params.day : undefined,
            month: params?.month,
            year: params?.year,
            employee_id: params?.employee_id,
            page_size: PAGE_SIZE,
            page,
          },
          signal,
        });

        let items: any[] = [];
        if (Array.isArray(response.data)) {
          items = response.data;
        } else if (response.data?.results && Array.isArray(response.data.results)) {
          items = response.data.results;
          if (total === null && response.data.count != null) total = response.data.count;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          items = response.data.data;
        } else {
          console.warn('[ApprovalService] Unexpected response format:', response.data);
        }

        accumulated.push(...items);
        onProgress?.(accumulated.length, total);
        onPage?.(accumulated);

        if (items.length < PAGE_SIZE) break;
        if (total !== null && accumulated.length >= total) break;
        page++;
      }

      console.debug(`[ApprovalService] getDuyetDonList(${status}): ${accumulated.length} items (${page} pages)`);
      return accumulated;
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
        console.debug(`[ApprovalService] getDuyetDonList(${status}) cancelled`);
        throw error;
      }
      console.error(`Error fetching duyet-don list with status ${status}:`, error);
      throw error;
    }
  }

  // Phân loại danh sách đơn từ API tổng hợp theo request_type và các trường phân biệt khác
  private categorizeDuyetDonList(allRequests: any[]): {
    attendance_explanations: any[];
    leave_requests: any[];
    online_work_requests: any[];
    registration_requests: any[];
  } {
    const attendance_explanations: any[] = [];
    const leave_requests: any[] = [];
    const online_work_requests: any[] = [];
    const registration_requests: any[] = [];

    for (const item of allRequests) {
      // Chuẩn hóa request_type: uppercase và bỏ dấu gạch dưới để xử lý cả
      // 'ATTENDANCE_EXPLANATION' và 'ATTENDANCEEXPLANATION', 'ONLINE_WORK' và 'ONLINEWORK', v.v.
      const normalizedType = (item.request_type || '').toUpperCase().replace(/_/g, '');
      // event_type field returned by the unified API (e.g. "overtime", "live", "explanation")
      const eventType = (item.event_type || '').toLowerCase().replace(/_/g, '');

      if (normalizedType === 'ATTENDANCEEXPLANATION' || normalizedType === 'EXPLANATION') {
        if (item.explanation_type === 'LEAVE') {
          leave_requests.push(item);
        } else {
          attendance_explanations.push(item);
        }
      } else if (normalizedType === 'LEAVE' || normalizedType === 'MONTHLYLEAVE' || normalizedType === 'MONTHLYLEAVEREQUEST') {
        leave_requests.push(item);
      } else if (normalizedType === 'ONLINEWORK' || normalizedType === 'ONLINEWORKREQUEST') {
        online_work_requests.push(item);
      } else if (normalizedType === 'REGISTRATION' || normalizedType === 'REGISTRATIONREQUEST' || normalizedType === 'OVERTIME') {
        registration_requests.push(item);
      } else if (eventType === 'explanation' || eventType === 'explanationapproval') {
        // API trả về event_type: "explanation" hoặc "explanation_approval"
        if (item.explanation_type === 'LEAVE') {
          leave_requests.push(item);
        } else {
          attendance_explanations.push(item);
        }
      } else if (eventType === 'leaverequest') {
        // API trả về event_type: "leave_request"
        leave_requests.push(item);
      } else if (eventType === 'onlinework') {
        // API trả về event_type: "online_work"
        online_work_requests.push(item);
      } else if (
        eventType === 'overtime' || eventType === 'extrahours' || eventType === 'nightshift' ||
        eventType === 'live' || eventType === 'offduty' || eventType === 'requestapproval' ||
        eventType === 'unauthorizedabsence' || eventType === 'shiftchange'
      ) {
        // API trả về event_type: "overtime", "extra_hours", "night_shift", "live", "off_duty",
        // "request_approval", "unauthorized_absence", "shift_change".
        // unauthorized_absence/shift_change mới được thêm vào /api-hrm/duyet-don/ gần đây — thiếu
        // ở đây khiến chúng rơi xuống nhánh fallback bên dưới và bị nhận nhầm là "Nghỉ phép tháng"
        // (leave_requests) vì item không có field registration_type (chỉ /registration-requests/
        // mới trả field đó, /duyet-don/ thì không) — kéo theo bị tính nhầm vào hạn mức nghỉ phép
        // 1 lần/tháng (chỉ duyệt được đơn đầu, các đơn sau bị coi là "hết hạn mức") và khi bấm
        // duyệt còn gọi NHẦM sang API /monthly-leave-requests/ (đúng ra phải là
        // /registration-requests/) vì confirmAction() chọn endpoint theo _itemType.
        registration_requests.push(item);
      } else {
        // Fallback: phân loại dựa trên các trường của item khi request_type không xác định
        if (item.registration_type) {
          registration_requests.push(item);
        } else if (item.work_date !== undefined && !item.explanation_type && !item.attendance_date) {
          online_work_requests.push(item);
        } else if (item.explanation_type && item.explanation_type !== 'LEAVE') {
          attendance_explanations.push(item);
        } else {
          // Đơn nghỉ phép: có explanation_type === 'LEAVE', hoặc không có trường nhận dạng khác
          leave_requests.push(item);
        }
      }
    }

    return { attendance_explanations, leave_requests, online_work_requests, registration_requests };
  }

  // Tổng hợp tất cả các loại đơn chờ duyệt
  async getAllPendingRequests(
    params?: { day?: number; month?: number; year?: number; employee_id?: number },
    onProgress?: (loaded: number, total: number | null) => void,
    onPartialResult?: (result: { attendance_explanations: any[]; leave_requests: any[]; overtime_requests: any[]; online_work_requests: any[]; registration_requests: any[]; total_pending: number }) => void,
    signal?: AbortSignal
  ): Promise<{
    attendance_explanations: any[];
    leave_requests: any[];
    overtime_requests: any[];
    online_work_requests: any[];
    registration_requests: any[];
    total_pending: number;
  }> {
    try {
      const allRequests = await this.getDuyetDonList('PENDING', params, onProgress, onPartialResult ? (acc) => {
        const cat = this.categorizeDuyetDonList(acc);
        onPartialResult({ ...cat, overtime_requests: [], total_pending: acc.length });
      } : undefined, signal);
      const { attendance_explanations, leave_requests, online_work_requests, registration_requests } = this.categorizeDuyetDonList(allRequests);
      const total_pending = allRequests.length;

      return {
        attendance_explanations,
        leave_requests,
        overtime_requests: [],
        online_work_requests,
        registration_requests,
        total_pending
      };
    } catch (error) {
      console.error('Error fetching all pending requests:', error);
      throw error;
    }
  }

  // Tổng hợp tất cả các loại đơn đã duyệt
  async getAllApprovedRequests(
    params?: { day?: number; month?: number; year?: number; employee_id?: number },
    onProgress?: (loaded: number, total: number | null) => void,
    onPartialResult?: (result: { attendance_explanations: any[]; leave_requests: any[]; overtime_requests: any[]; online_work_requests: any[]; registration_requests: any[]; total_approved: number }) => void,
    signal?: AbortSignal
  ): Promise<{
    attendance_explanations: any[];
    leave_requests: any[];
    overtime_requests: any[];
    online_work_requests: any[];
    registration_requests: any[];
    total_approved: number;
  }> {
    try {
      const allRequests = await this.getDuyetDonList('APPROVED', params, onProgress, onPartialResult ? (acc) => {
        const cat = this.categorizeDuyetDonList(acc);
        onPartialResult({ ...cat, overtime_requests: [], total_approved: acc.length });
      } : undefined, signal);
      const { attendance_explanations, leave_requests, online_work_requests, registration_requests } = this.categorizeDuyetDonList(allRequests);
      const total_approved = allRequests.length;

      return {
        attendance_explanations,
        leave_requests,
        overtime_requests: [],
        online_work_requests,
        registration_requests,
        total_approved
      };
    } catch (error) {
      console.error('Error fetching all approved requests:', error);
      throw error;
    }
  }

  // Tổng hợp tất cả các loại đơn đã từ chối
  async getAllRejectedRequests(
    params?: { day?: number; month?: number; year?: number; employee_id?: number },
    onProgress?: (loaded: number, total: number | null) => void,
    onPartialResult?: (result: { attendance_explanations: any[]; leave_requests: any[]; overtime_requests: any[]; online_work_requests: any[]; registration_requests: any[]; total_rejected: number }) => void,
    signal?: AbortSignal
  ): Promise<{
    attendance_explanations: any[];
    leave_requests: any[];
    overtime_requests: any[];
    online_work_requests: any[];
    registration_requests: any[];
    total_rejected: number;
  }> {
    try {
      const allRequests = await this.getDuyetDonList('REJECTED', params, onProgress, onPartialResult ? (acc) => {
        const cat = this.categorizeDuyetDonList(acc);
        onPartialResult({ ...cat, overtime_requests: [], total_rejected: acc.length });
      } : undefined, signal);
      const { attendance_explanations, leave_requests, online_work_requests, registration_requests } = this.categorizeDuyetDonList(allRequests);
      const total_rejected = allRequests.length;

      return {
        attendance_explanations,
        leave_requests,
        overtime_requests: [],
        online_work_requests,
        registration_requests,
        total_rejected
      };
    } catch (error) {
      console.error('Error fetching all rejected requests:', error);
      throw error;
    }
  }

  // Kiểm tra xem người dùng hiện tại có quyền duyệt giải trình không
  async canApproveAttendanceExplanation(explanationId: number): Promise<{ can_approve: boolean; message?: string }> {
    try {
      // Tạm thời trả về true cho tất cả để đảm bảo tính tương thích
      // TODO: Tạo API endpoint để kiểm tra quyền trong backend
      return { can_approve: true };
    } catch (error) {
      console.error('Error checking approval permission:', error);
      return { can_approve: false, message: 'Lỗi kiểm tra quyền' };
    }
  }

  private currentEmployeePromise: Promise<any> | null = null;

  // Lấy thông tin employee của người dùng hiện tại
  async getCurrentEmployee(): Promise<any> {
    if (this.currentEmployeePromise) {
      return this.currentEmployeePromise;
    }

    this.currentEmployeePromise = (async () => {
      try {
        const response = await managementApi.get('/api-hrm/employees/me/');
        return response.data;
      } catch (error) {
        console.error('Error fetching current employee:', error);
        // Reset promise on error so next call can retry
        this.currentEmployeePromise = null;
        throw error;
      }
    })();

    return this.currentEmployeePromise;
  }

  // Kiểm tra xem người dùng có phải là HR không
  async isHR(): Promise<boolean> {
    try {
      const employee = await this.getCurrentEmployee();
      // Chỉ tin tưởng vào cờ is_hr được cấu hình từ hệ thống (đồng bộ với logic BE mới)
      return !!employee.is_hr;
    } catch (error) {
      console.error('Error checking HR status:', error);
      return false;
    }
  }

  // Kiểm tra xem người dùng có phải là quản lý trực tiếp của employee không
  async isDirectManagerOf(employeeId: number): Promise<boolean> {
    try {
      const currentEmployee = await this.getCurrentEmployee();
      const response = await managementApi.get(`/api-hrm/employees/${employeeId}/`);
      const employee = response.data;

      return employee.manager && employee.manager.id === currentEmployee.id;
    } catch (error) {
      console.error('Error checking direct manager status:', error);
      return false;
    }
  }

  // Kiểm tra xem người dùng có phải là trưởng phòng của employee không
  async isDepartmentHeadOf(employeeId: number): Promise<boolean> {
    try {
      const currentEmployee = await this.getCurrentEmployee();
      const response = await managementApi.get(`/api-hrm/employees/${employeeId}/`);
      const employee = response.data;

      return employee.department && employee.department.manager && employee.department.manager.id === currentEmployee.id;
    } catch (error) {
      console.error('Error checking department head status:', error);
      return false;
    }
  }

  // Duyệt hàng loạt giải trình chấm công
  async bulkApproveAttendanceExplanations(ids: number[], note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/attendance-explanations/bulk_approve/', {
        ids,
        approval_note: note || 'Duyệt nhanh hàng loạt'
      });
      return response.data;
    } catch (error) {
      console.error('Error in bulk approving attendance explanations:', error);
      throw error;
    }
  }

  // Duyệt nhanh thông minh: BE tự tính quota và từ chối các đơn dư thừa
  async smartBulkApproveAttendanceExplanations(ids: number[], note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/attendance-explanations/smart_bulk_approve/', {
        ids,
        approval_note: note || 'Duyệt nhanh'
      });
      return response.data;
    } catch (error) {
      console.error('Error in smart bulk approving attendance explanations:', error);
      throw error;
    }
  }

  // Duyệt hàng loạt đơn nghỉ phép tháng
  async bulkApproveMonthlyLeaveRequests(ids: number[], note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/monthly-leave-requests/bulk_approve/', {
        ids,
        approval_note: note || 'Duyệt nhanh hàng loạt'
      });
      return response.data;
    } catch (error) {
      console.error('Error in bulk approving monthly leave requests:', error);
      throw error;
    }
  }

  // Duyệt hàng loạt đơn đăng ký
  async bulkApproveRegistrationRequests(ids: number[], note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/registration-requests/bulk_approve/', {
        ids,
        approval_note: note || 'Duyệt nhanh hàng loạt'
      });
      return response.data;
    } catch (error) {
      console.error('Error in bulk approving registration requests:', error);
      throw error;
    }
  }

  // Duyệt hàng loạt đơn làm việc online
  async bulkApproveOnlineWorkRequests(ids: number[], note?: string): Promise<any> {
    try {
      const response = await managementApi.post('/api-hrm/online-work-requests/bulk_approve/', {
        ids,
        approval_note: note || 'Duyệt nhanh hàng loạt'
      });
      return response.data;
    } catch (error) {
      console.error('Error in bulk approving online work requests:', error);
      throw error;
    }
  }

  // Từ chối hàng loạt giải trình chấm công
  async bulkRejectAttendanceExplanations(ids: number[], note?: string): Promise<any> {
    const response = await managementApi.post('/api-hrm/attendance-explanations/bulk_reject/', {
      ids,
      approval_note: note || 'Từ chối nhanh hàng loạt',
    });
    return response.data;
  }

  // Từ chối hàng loạt đơn nghỉ phép tháng
  async bulkRejectMonthlyLeaveRequests(ids: number[], note?: string): Promise<any> {
    const response = await managementApi.post('/api-hrm/monthly-leave-requests/bulk_reject/', {
      ids,
      approval_note: note || 'Từ chối nhanh hàng loạt',
    });
    return response.data;
  }

  // Từ chối hàng loạt đơn đăng ký
  async bulkRejectRegistrationRequests(ids: number[], note?: string): Promise<any> {
    const response = await managementApi.post('/api-hrm/registration-requests/bulk_reject/', {
      ids,
      approval_note: note || 'Từ chối nhanh hàng loạt',
    });
    return response.data;
  }

  // Từ chối hàng loạt đơn làm việc online
  async bulkRejectOnlineWorkRequests(ids: number[], note?: string): Promise<any> {
    const response = await managementApi.post('/api-hrm/online-work-requests/bulk_reject/', {
      ids,
      approval_note: note || 'Từ chối nhanh hàng loạt',
    });
    return response.data;
  }
}

export const approvalService = new ApprovalService();
