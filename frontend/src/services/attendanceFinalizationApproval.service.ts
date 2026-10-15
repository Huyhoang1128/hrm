import { managementApi } from '../utils/api';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AttendanceFinalizationApproval {
  id: number;
  department_code: string;
  department_name: string | null;
  year: number;
  month: number;
  status: ApprovalStatus;
  sent_by: number | null;
  sent_by_name: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SendApprovalRequest {
  department_code: string;
  year: number;
  month: number;
}

export interface SendAllApprovalsRequest {
  year: number;
  month: number;
}

export interface ApproveRejectRequest {
  note?: string;
  require_direct_manager_decisions?: boolean;
}

export interface EmployeeDecisionRequest {
  action: 'APPROVED' | 'REJECTED';
  note?: string;
}

export interface AttendanceFinalizationEmployeeEmailPreview {
  approval_id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  email: string;
  has_email: boolean;
  preview_subject: string;
  preview_body: string;
  decision_label: string;
}

export interface AttendanceFinalizationEmployeeEmailSendResponse {
  detail: string;
  batch_id: string;
  status: string;
  recipient_email: string;
}

export interface AttendanceFinalizationDepartmentEmailSendResponse {
  detail: string;
  batch_id: string;
  department_id: number;
  department_name: string;
  year: number;
  month: number;
  total: number;
  queued: number;
  skipped_no_email: number;
}

export interface AttendanceFinalizationEmailStatusItem {
  employee_id: number;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | null;
  processed_at: string | null;
  error_message: string | null;
  batch_id: string | null;
}

export interface AttendanceFinalizationEmailStatusesResponse {
  year: number;
  month: number;
  department_id: number;
  statuses: AttendanceFinalizationEmailStatusItem[];
}

export interface AttendanceFinalizationDepartmentEmailSendResponse {
  detail: string;
  batch_id: string;
  department_id: number;
  department_name: string;
  year: number;
  month: number;
  total: number;
  queued: number;
  skipped_no_email: number;
}

export interface AttendanceFinalizationEmailStatusItem {
  employee_id: number;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | null;
  processed_at: string | null;
  error_message: string | null;
  batch_id: string | null;
}

export interface AttendanceFinalizationEmailStatusesResponse {
  year: number;
  month: number;
  department_id: number;
  statuses: AttendanceFinalizationEmailStatusItem[];
}

export interface SendApprovalResponse {
  message: string;
  created: boolean;
  data: AttendanceFinalizationApproval;
}

export interface SendAllApprovalsResponse {
  year: number;
  month: number;
  total_processed: number;
  total_errors: number;
  results: AttendanceFinalizationApproval[];
  errors: { department_code: string; error: string }[];
}

export interface ApprovalListResponse {
  year: number;
  month: number;
  total: number;
  results: AttendanceFinalizationApproval[];
}

export interface ApprovalListParams {
  year: number;
  month: number;
  department_code?: string;
  status?: ApprovalStatus;
}

class AttendanceFinalizationApprovalService {
  async list(params: ApprovalListParams): Promise<ApprovalListResponse> {
    const response = await managementApi.get(
      '/api-hrm/attendance-finalization/approvals/',
      { params }
    );
    return response.data;
  }

  async send(data: SendApprovalRequest): Promise<SendApprovalResponse> {
    const response = await managementApi.post(
      '/api-hrm/attendance-finalization/approvals/send/',
      data
    );
    return response.data;
  }

  async sendAll(data: SendAllApprovalsRequest): Promise<SendAllApprovalsResponse> {
    const response = await managementApi.post(
      '/api-hrm/attendance-finalization/approvals/send-all/',
      data
    );
    return response.data;
  }

  async get(approvalId: number): Promise<AttendanceFinalizationApproval & { employees: any[], can_approve: boolean }> {
    const response = await managementApi.get(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/`
    );
    return response.data;
  }

  async approve(
    approvalId: number,
    data: ApproveRejectRequest = {}
  ): Promise<AttendanceFinalizationApproval> {
    const payload: any = { action: 'APPROVED' };
    if (data.note !== undefined && data.note !== '') payload.note = data.note;
    if (data.require_direct_manager_decisions !== undefined) {
      payload.require_direct_manager_decisions = data.require_direct_manager_decisions;
    }
    const response = await managementApi.post(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/approve/`,
      payload
    );
    return response.data;
  }

  async reject(
    approvalId: number,
    data: ApproveRejectRequest = {}
  ): Promise<AttendanceFinalizationApproval> {
    const payload: any = { action: 'REJECTED' };
    if (data.note !== undefined && data.note !== '') payload.note = data.note;
    const response = await managementApi.post(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/approve/`,
      payload
    );
    return response.data;
  }

  async decideEmployee(
    approvalId: number,
    employeeId: number,
    data: EmployeeDecisionRequest
  ): Promise<any> {
    const payload: any = { action: data.action };
    if (data.note !== undefined && data.note !== '') payload.note = data.note;
    const response = await managementApi.post(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/employees/${employeeId}/decision/`,
      payload
    );
    return response.data;
  }

  async getPrintableSheet(approvalId: number): Promise<string> {
    const response = await managementApi.get(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/print/`,
      {
        responseType: 'text',
        headers: {
          Accept: 'text/html',
        },
      }
    );
    return response.data;
  }

  async previewEmployeeEmail(
    approvalId: number,
    employeeId: number
  ): Promise<AttendanceFinalizationEmployeeEmailPreview> {
    const response = await managementApi.get(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/employees/${employeeId}/email-preview/`
    );
    return response.data;
  }

  async sendEmployeeEmail(
    approvalId: number,
    employeeId: number,
    data?: { subject?: string; body?: string }
  ): Promise<AttendanceFinalizationEmployeeEmailSendResponse> {
    const response = await managementApi.post(
      `/api-hrm/attendance-finalization/approvals/${approvalId}/employees/${employeeId}/send-email/`,
      data || {}
    );
    return response.data;
  }

  async sendDepartmentEmails(data: {
    year: number;
    month: number;
    department_id: number;
  }): Promise<AttendanceFinalizationDepartmentEmailSendResponse> {
    const response = await managementApi.post(
      '/api-hrm/attendance-finalization/approvals/send-department-emails/',
      data
    );
    return response.data;
  }

  async getEmailStatuses(params: {
    year: number;
    month: number;
    department_id: number;
  }): Promise<AttendanceFinalizationEmailStatusesResponse> {
    const response = await managementApi.get(
      '/api-hrm/attendance-finalization/approvals/email-statuses/',
      { params }
    );
    return response.data;
  }
}

export const attendanceFinalizationApprovalService = new AttendanceFinalizationApprovalService();
export default attendanceFinalizationApprovalService;
