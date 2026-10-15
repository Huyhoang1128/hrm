import { managementApi } from '../utils/api';

export interface DeadlineExceptionGrant {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  event_date: string;
  request_type: 'OVERTIME' | 'ONLINE_WORK' | 'LEAVE' | 'UNAUTHORIZED_ABSENCE' | 'LIVE' | 'BUSINESS_TRIP' | 'CA2' | 'CANCEL_EDIT';
  request_type_display: string;
  note: string;
  /** HCNS đã tick xác nhận mở khoá dù ngày đó đã có đơn cùng loại */
  overrode_existing_request?: boolean;
  granted_by_name: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by_name: string | null;
}

/** Đơn đang chặn việc mở khoá — backend trả kèm lỗi 409 EXISTING_REQUEST. */
export interface BlockingRequest {
  event_id: number;
  request_code: string;
  status: string;
  status_label: string;
  direct_manager_approved: boolean;
  created_at: string | null;
  reason: string;
}

/** Lượt mở khoá đã áp dụng cho 1 đơn — để gắn cờ "Mở khoá đặc biệt" khi HCNS rà soát hạn. */
export interface AppliedDeadlineException {
  id: number;
  request_type: string;
  request_type_display: string;
  note: string;
  granted_by_name: string | null;
  created_at: string;
  revoked_at: string | null;
  /** true: mở trước khi tạo đơn (gỡ hạn tạo); false: mở sau (gỡ hạn duyệt/huỷ/sửa). */
  granted_before_created: boolean;
}

class DeadlineExceptionService {
  /** Danh sách "mở khoá đặc biệt" gần đây — chỉ HR/Admin gọi được. */
  async list(params: {
    page: number;
    page_size: number;
    employee_id?: number;
    request_type?: string;
    search?: string;
  }): Promise<{ count: number; results: DeadlineExceptionGrant[] }> {
    const response = await managementApi.get('/api-hrm/deadline-exceptions/', { params });
    return response.data;
  }

  /** Tạo (hoặc cập nhật ghi chú nếu đã tồn tại đúng NV/ngày/loại đơn) 1 lượt mở khoá. */
  async create(data: {
    employee_id: number;
    event_date: string;
    request_type: 'OVERTIME' | 'ONLINE_WORK' | 'LEAVE' | 'UNAUTHORIZED_ABSENCE' | 'LIVE' | 'BUSINESS_TRIP' | 'CA2' | 'CANCEL_EDIT';
    note?: string;
    /** Vẫn mở khoá dù ngày đó đã có đơn cùng loại. Backend bắt buộc kèm `note`. */
    override_existing?: boolean;
  }): Promise<DeadlineExceptionGrant> {
    const response = await managementApi.post('/api-hrm/deadline-exceptions/', data);
    return response.data;
  }

  /** Thu hồi = đánh dấu đã thu hồi (backend giữ lại lịch sử). */
  async revoke(id: number): Promise<void> {
    await managementApi.delete(`/api-hrm/deadline-exceptions/${id}/`);
  }

  /** {event_id: lượt mở khoá đã áp dụng} — chỉ HR/Admin gọi được. */
  async forEvents(eventIds: number[]): Promise<Record<string, AppliedDeadlineException[]>> {
    if (!eventIds.length) return {};
    const response = await managementApi.get('/api-hrm/deadline-exceptions/for-events/', {
      params: { ids: eventIds.join(',') },
    });
    return response.data;
  }
}

export const deadlineExceptionService = new DeadlineExceptionService();
export default deadlineExceptionService;
