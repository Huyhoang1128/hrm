import { AxiosResponse } from 'axios';
import { managementApi } from '../utils/api';

// ==================== TYPES ====================

export interface OnboardingProcess {
  id: number;
  onboarding_code: string;

  // Frontend fields (alias)
  full_name: string;
  position_title: string;

  // Backend fields
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;

  // Personal info
  citizen_id?: string;
  date_of_birth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  permanent_address?: string;
  current_address?: string;

  // Education
  education_level?: string;
  university?: string;
  major?: string;
  graduation_year?: number;

  // Job info
  position?: number;
  position_name?: string;
  department?: number;
  department_name?: string;
  direct_manager?: number;
  start_date: string;
  expected_end_date?: string;
  rank?: string;
  section?: string;
  doctor_team?: string;

  // Contract
  contract_type: 'PROBATION' | 'INTERN' | 'COLLABORATOR' | 'ONE_YEAR' | 'TWO_YEAR' | 'INDEFINITE' | 'SERVICE' | 'CONFIDENTIALITY' | 'COMPANY_RULES' | 'NURSING_COMMITMENT';
  probation_period_months: number;
  salary?: string;
  salary_note?: string;

  // Financial
  bank_name?: string;
  bank_account_number?: string;
  bank_account_holder?: string;
  tax_code?: string;
  tax_dependents?: number;

  // Status
  status: 'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  progress: 'RECEIVE_DOC' | 'SIGN_CONTRACT' | 'TRAINING' | 'HANDOVER';
  stage: 1 | 2 | 3; // 1: Ứng viên mới, 2: Đang onboarding, 3: Hoàn thành
  stage_display?: string;
  progress_display?: string;
  progress_percentage: number;

  // Token / Employee form
  employee_info_completed?: boolean;
  employee_form_url?: string | null;
  token_status?: 'not_generated' | 'active' | 'expired' | 'completed';
  token_expires_at?: string | null;

  // Relationships
  hr_responsible?: number;
  hr_responsible_name?: string;
  employee?: number;

  // Files
  cv_file?: string;
  cv_file_url?: string;
  id_card_front?: string;
  id_card_front_url?: string;
  id_card_back?: string;
  id_card_back_url?: string;
  diploma_file?: string;
  diploma_file_url?: string;
  citizen_id_file?: string;
  citizen_id_file_url?: string;
  notes?: string;

  // System
  created_at: string;
  updated_at: string;
  completed_at?: string;
  created_by?: number;

  // Embedded relations (BE returns nested trong detail serializer)
  tasks?: OnboardingTask[];
  documents?: OnboardingDocument[];
}

export interface OnboardingTask {
  id: number;
  onboarding_process: number;
  name: string;
  description: string;
  task_type: 'DOCUMENT' | 'CONTRACT' | 'TRAINING' | 'IT_SETUP' | 'ORIENTATION' | 'EVALUATION' | 'OTHER';
  task_code?: 'FILL_INFO' | 'SIGN_CONTRACT' | 'READ_REGULATION' | 'SUBMIT_DOCS' | null;
  order: number;
  deadline?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  assigned_to?: number;
  assigned_to_name?: string;
  completion_note?: string;
  attachment?: string;
  attachment_url?: string;
  started_at?: string;
  completed_at?: string;
  is_overdue: boolean;
  days_until_deadline?: number;
  checklist_items?: OnboardingChecklist[];
  created_at: string;
  updated_at: string;
}

export interface OnboardingChecklist {
  id: number;
  task: number;
  title: string;
  description: string;
  order: number;
  is_completed: boolean;
  is_required: boolean;
  completed_at?: string;
  completed_by?: number;
  completed_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface OnboardingDocument {
  id: number;
  onboarding_process: number;
  document_name: string;
  document_type: 'CONTRACT' | 'REGULATION' | 'HANDBOOK' | 'FORM' | 'TRAINING' | 'OTHER';
  description?: string;
  file: string;
  file_url?: string;
  is_required: boolean;
  requires_signature: boolean;
  is_read: boolean;
  is_signed: boolean;
  signed_at?: string;
  signature_file?: string;
  signature_file_url?: string;
  uploaded_at: string;
  uploaded_by?: number;
  uploaded_by_name?: string;
}

export interface OnboardingStatistics {
  total: number;
  by_status: { status: string; count: number }[];
  in_progress: number;
  completed: number;
  pending: number;
  this_month: number;
}

export interface CreateOnboardingRequest {
  candidate_name: string;
  candidate_email: string;
  start_date: string;
  position?: number;
  department?: number;
  direct_manager?: number;
  gender?: 'M' | 'F' | 'O';
  // Extended fields
  full_name?: string;
  position_title?: string;
  stage?: 1 | 2 | 3;
  progress?: 'RECEIVE_DOC' | 'SIGN_CONTRACT' | 'TRAINING' | 'HANDOVER';
  candidate_phone?: string;
  contract_type?: string;
  probation_period_months?: number;
  notes?: string;
}

export interface UpdateOnboardingRequest extends Partial<CreateOnboardingRequest> {
  id: number;
}

export interface EmployeeFormData {
  candidate_name: string;
  candidate_phone: string;
  citizen_id: string;
  date_of_birth: string;
  gender: 'M' | 'F' | 'O';
  permanent_address: string;
  current_address?: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  tax_code?: string;
  education_level?: string;
  university?: string;
  major?: string;
  graduation_year?: number;
}

// Paginated response wrapper
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// Standard action response wrapper (dùng nội bộ)
interface ActionResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

// ==================== API SERVICE ====================

export const onboardingService = {
  // ========== Onboarding Processes ==========

  /**
   * Lấy danh sách onboarding
   */
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    status?: string;
    stage?: number;
    progress?: string;
    ordering?: string;
    month?: number;
    year?: number;
  }): Promise<PaginatedResponse<OnboardingProcess>> => {
    const response: AxiosResponse<PaginatedResponse<OnboardingProcess>> =
      await managementApi.get('/api-hrm/onboardings/', { params });
    return response.data;
  },

  /**
   * Lấy chi tiết onboarding
   */
  get: async (id: number): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.get(
      `/api-hrm/onboardings/${id}/`
    );
    return response.data;
  },

  /** Alias của get() — dùng khi cần tên rõ nghĩa hơn */
  getById: async (id: number): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.get(
      `/api-hrm/onboardings/${id}/`
    );
    return response.data;
  },

  /**
   * Lấy onboarding mới nhất của user hiện tại (dùng cho Home).
   * BE `get_queryset()` đã filter: nhân viên thường chỉ thấy onboarding của chính mình.
   */
  myOnboarding: async (): Promise<OnboardingProcess | null> => {
    const response: AxiosResponse<PaginatedResponse<OnboardingProcess>> =
      await managementApi.get('/api-hrm/onboardings/', {
        params: { page_size: 1, ordering: '-created_at' },
      });
    return response.data.results?.[0] || null;
  },

  /**
   * Tạo onboarding mới
   */
  create: async (data: CreateOnboardingRequest): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.post(
      '/api-hrm/onboardings/',
      data
    );
    return response.data;
  },

  /**
   * Cập nhật toàn bộ onboarding (PUT)
   */
  update: async (
    id: number,
    data: Partial<CreateOnboardingRequest>
  ): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.put(
      `/api-hrm/onboardings/${id}/`,
      data
    );
    return response.data;
  },

  /**
   * Cập nhật một phần onboarding (PATCH)
   */
  partialUpdate: async (
    id: number,
    data: Partial<CreateOnboardingRequest>
  ): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.patch(
      `/api-hrm/onboardings/${id}/`,
      data
    );
    return response.data;
  },

  /**
   * Cập nhật một phần onboarding qua super-admin API (PATCH)
   */
  superAdminPartialUpdate: async (
    onboardingId: number,
    data: Record<string, any>
  ): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.patch(
      `/api-hrm/super-admin/onboarding/`,
      data,
      { params: { id: onboardingId } }
    );
    return response.data;
  },

  /**
   * Upload/replace files (multipart) qua super-admin onboarding API
   */
  superAdminUploadFiles: async (
    onboardingId: number,
    formData: FormData
  ): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.patch(
      `/api-hrm/super-admin/onboarding/`,
      formData,
      {
        params: { id: onboardingId },
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  /**
   * Upload/replace files bằng employee_id (string code).
   * BE tự tìm OnboardingProcess qua reverse OneToOne.
   */
  superAdminUploadFilesByEmployeeId: async (
    employeeId: string,
    formData: FormData
  ): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.patch(
      `/api-hrm/super-admin/onboarding/`,
      formData,
      {
        params: { employee_id: employeeId },
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  /**
   * Xóa onboarding
   */
  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/onboardings/${id}/`);
  },

  /**
   * Bắt đầu quy trình onboarding
   */
  start: async (id: number): Promise<OnboardingProcess> => {
    const response: AxiosResponse<ActionResponse<OnboardingProcess>> =
      await managementApi.post(`/api-hrm/onboardings/${id}/start/`);
    return response.data.data;
  },

  /**
   * Hoàn thành quy trình onboarding
   */
  complete: async (id: number): Promise<OnboardingProcess> => {
    const response: AxiosResponse<ActionResponse<OnboardingProcess>> =
      await managementApi.post(`/api-hrm/onboardings/${id}/complete/`);
    return response.data.data;
  },

  /**
   * Tạo tài khoản nhân viên từ onboarding
   */
  createEmployee: async (
    id: number
  ): Promise<{ employee: any; message: string }> => {
    const response: AxiosResponse<{
      success: boolean;
      message: string;
      employee: any;
    }> = await managementApi.post(`/api-hrm/onboardings/${id}/create_employee/`);
    return {
      employee: response.data.employee,
      message: response.data.message,
    };
  },

  /**
   * Lấy thống kê onboarding
   */
  getStatistics: async (): Promise<OnboardingStatistics> => {
    const response: AxiosResponse<OnboardingStatistics> = await managementApi.get(
      '/api-hrm/onboardings/statistics/'
    );
    return response.data;
  },

  /**
   * Admin - Đồng bộ dữ liệu quy trình cũ
   */
  syncLegacyTasks: async (): Promise<{ success: boolean; message: string }> => {
    const response: AxiosResponse<{ success: boolean; message: string }> = await managementApi.post(
      '/api-hrm/onboardings/sync-legacy-tasks/'
    );
    return response.data;
  },

  // ========== Token & Email Actions ==========

  /**
   * Tạo token cho nhân viên
   */
  generateToken: async (
    id: number
  ): Promise<{ success: boolean; message: string; data: { token: string; expires_at: string; employee_form_url: string } }> => {
    const response: AxiosResponse<{ success: boolean; message: string; data: { token: string; expires_at: string; employee_form_url: string } }> =
      await managementApi.post(`/api-hrm/onboardings/${id}/generate_employee_token/`);
    return response.data;
  },

  /**
   * Gửi email cho nhân viên với link
   */
  sendEmployeeEmail: async (
    id: number
  ): Promise<{ success: boolean; message: string }> => {
    const response: AxiosResponse<{ success: boolean; message: string }> =
      await managementApi.post(`/api-hrm/onboardings/${id}/send-employee-email/`);
    return response.data;
  },
  /**
   * Gửi lại email chào mừng cho nhân viên
   */
  resendWelcomeEmail: async (
    id: number
  ): Promise<{ success: boolean; message: string }> => {
    const response: AxiosResponse<{ success: boolean; message: string }> =
      await managementApi.post(`/api-hrm/onboardings/${id}/resend_welcome_email/`);  // ← Đổi - thành _
    return response.data;
  },
  /**
   * Kiểm tra trạng thái điền form của nhân viên
   */
  getEmployeeInfoStatus: async (id: number): Promise<{
    employee_info_completed: boolean;
    token_status: 'not_generated' | 'active' | 'expired' | 'completed';
    token_expires_at: string | null;
  }> => {
    const response: AxiosResponse<{
      employee_info_completed: boolean;
      token_status: 'not_generated' | 'active' | 'expired' | 'completed';
      token_expires_at: string | null;
    }> = await managementApi.get(`/api-hrm/onboardings/${id}/employee-info-status/`);
    return response.data;
  },

  // ========== Onboarding Tasks ==========

  /**
   * Lấy danh sách tasks của onboarding
   */
  getTasks: async (onboardingId: number): Promise<OnboardingTask[]> => {
    const response: AxiosResponse<OnboardingTask[]> = await managementApi.get(
      `/api-hrm/onboardings/${onboardingId}/tasks/`
    );
    return response.data;
  },

  /**
   * Bắt đầu task
   */
  startTask: async (taskId: number): Promise<OnboardingTask> => {
    const response: AxiosResponse<ActionResponse<OnboardingTask>> =
      await managementApi.post(`/api-hrm/onboarding-tasks/${taskId}/start/`);
    return response.data.data;
  },

  /**
   * Hoàn thành task
   */
  completeTask: async (
    taskId: number,
    completionNote?: string
  ): Promise<OnboardingTask> => {
    const response: AxiosResponse<ActionResponse<OnboardingTask>> =
      await managementApi.post(`/api-hrm/onboarding-tasks/${taskId}/complete/`, {
        completion_note: completionNote,
      });
    return response.data.data;
  },

  /**
   * Bỏ qua task
   */
  skipTask: async (
    taskId: number,
    reason?: string
  ): Promise<OnboardingTask> => {
    const response: AxiosResponse<ActionResponse<OnboardingTask>> =
      await managementApi.post(`/api-hrm/onboarding-tasks/${taskId}/skip/`, { reason });
    return response.data.data;
  },

  /**
   * Toggle trạng thái checklist
   */
  toggleChecklist: async (
    checklistId: number
  ): Promise<{ success: boolean; message: string }> => {
    const response: AxiosResponse<{ success: boolean; message: string }> =
      await managementApi.post(
        `/api-hrm/onboarding-checklists/${checklistId}/toggle/`
      );
    return response.data;
  },

  // ========== Onboarding Documents ==========

  /**
   * Lấy danh sách documents của onboarding
   */
  getDocuments: async (onboardingId: number): Promise<OnboardingDocument[]> => {
    const response: AxiosResponse<OnboardingDocument[]> = await managementApi.get(
      `/api-hrm/onboardings/${onboardingId}/documents/`
    );
    return response.data;
  },

  /**
   * Upload document
   */
  uploadDocument: async (
    onboardingId: number,
    formData: FormData
  ): Promise<OnboardingDocument> => {
    const response: AxiosResponse<OnboardingDocument> = await managementApi.post(
      '/api-hrm/onboarding-documents/',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  /**
   * Đánh dấu tài liệu đã đọc
   */
  markDocumentAsRead: async (
    documentId: number
  ): Promise<{ success: boolean; message: string }> => {
    const response: AxiosResponse<{ success: boolean; message: string }> =
      await managementApi.post(
        `/api-hrm/onboarding-documents/${documentId}/mark_read/`
      );
    return response.data;
  },

  /**
   * Ký tài liệu
   */
  signDocument: async (
    documentId: number,
    signatureFile?: File
  ): Promise<OnboardingDocument> => {
    const formData = new FormData();
    if (signatureFile) {
      formData.append('signature_file', signatureFile);
    }
    const response: AxiosResponse<ActionResponse<OnboardingDocument>> =
      await managementApi.post(`/api-hrm/onboarding-documents/${documentId}/sign/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    return response.data.data;
  },

  // ========== Onboarding Document Templates ==========

  /**
   * Lấy danh sách templates
   */
  getTemplates: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    document_type?: string;
  }): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get(
      '/api-hrm/onboarding-document-templates/',
      { params }
    );
    return response.data.results || response.data;
  },

  /**
   * Áp dụng bulk templates vào onboarding
   */
  bulkApplyTemplates: async (
    onboardingId: number,
    templateIds: number[]
  ): Promise<{ success: boolean; message: string; created_count?: number }> => {
    const response: AxiosResponse<{
      success: boolean;
      message: string;
      created_count?: number;
    }> = await managementApi.post(
      '/api-hrm/onboarding-document-templates/bulk_apply/',
      {
        onboarding_id: onboardingId,
        template_ids: templateIds,
      }
    );
    return response.data;
  },

  /**
   * Tạo template mới (thực chất là upload doc mới vào onboarding này và lưu làm template)
   */
  createTemplate: async (formData: FormData): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.post(
      '/api-hrm/onboarding-document-templates/',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  updateTemplate: async (id: number, formData: FormData): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.patch(
      `/api-hrm/onboarding-document-templates/${id}/`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  deleteTemplate: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/onboarding-document-templates/${id}/`);
  },

  toggleTemplateActive: async (id: number): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.post(
      `/api-hrm/onboarding-document-templates/${id}/toggle_active/`
    );
    return response.data;
  },

  syncTemplateToActive: async (id: number): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.post(
      `/api-hrm/onboarding-document-templates/${id}/sync_to_active/`
    );
    return response.data;
  },

  // ========== Public Endpoints (không cần auth) ==========

  /**
   * Lấy thông tin onboarding bằng token (PUBLIC)
   */
  getByToken: async (token: string): Promise<OnboardingProcess> => {
    const response: AxiosResponse<OnboardingProcess> = await managementApi.get(
      `/api-hrm/employee-onboarding-form/by-token/${token}/`
    );
    return response.data;
  },

  /**
   * Submit form nhân viên (PUBLIC)
   */
  submitEmployeeInfo: async (
    token: string,
    data: EmployeeFormData
  ): Promise<{ success: boolean; message: string }> => {
    const response: AxiosResponse<{ success: boolean; message: string }> = await managementApi.post(
      `/api-hrm/employee-onboarding-form/submit/${token}/`,
      data
    );
    return response.data;
  },
};

export default onboardingService;