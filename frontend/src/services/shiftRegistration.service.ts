import { managementApi } from '../utils/api';

export interface ShiftBrief {
  id: number;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
}

/** Tên gọi 2 ô ca theo ĐÚNG cấu hình của nhân viên — mỗi team gọi khác nhau
 * (Điều dưỡng BS BS A: mặc định "Ca 1", đăng ký "Ca 2"; Sale BS B: mặc định "Ca 2", đăng ký "Ca 1"). Backend cũ không trả -> dùng
 * caLabels() để luôn có giá trị. */
export interface CaLabels {
  default_ca_label?: string;
  registrable_ca_label?: string;
  /** false => team đã ngừng ca phải đăng ký (vd Sale BS Trung từ 14/10/2026):
   * ẩn mọi nút đăng ký. Backend cũ không trả -> coi như vẫn cho đăng ký. */
  registration_enabled?: boolean;
}

export const caLabels = (src?: CaLabels | null) => ({
  def: src?.default_ca_label || 'Ca 1',
  reg: src?.registrable_ca_label || 'Ca 2',
  canRegister: src?.registration_enabled !== false,
});

/** 1 "ca" = 1 cặp (ca sáng, ca chiều) — không phải 1 khối thời gian liên tục. */
export interface CaBrief {
  morning: ShiftBrief | null;
  afternoon: ShiftBrief | null;
}

export interface ShiftScopeStatus extends CaLabels {
  in_scope: boolean;
  ca_1: CaBrief | null;
  ca_2: CaBrief | null;
  // true => nhóm này KHÔNG đăng ký theo tuần: Ca 1 mặc định cho mọi ngày,
  // muốn làm Ca 2 phải đăng ký riêng cho 1 ngày cụ thể (registerCa2) và chờ
  // quản lý trực tiếp duyệt trước 0h ngày đó (xem Ca2Request bên dưới).
  requires_manager_approval: boolean;
  is_admin_or_hr: boolean;
  can_view_team_overview: boolean;
  scope_departments: Array<{ id: number; name: string }>;
}

/** 1 đơn đăng ký Ca 2 theo NGÀY (mô hình requires_manager_approval=True) —
 * khác hẳn ShiftRegistrationDay ở lưới đăng ký theo TUẦN bên dưới. */
export interface Ca2Request extends CaLabels {
  id: number;
  date: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  morning: ShiftBrief | null;
  afternoon: ShiftBrief | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  /** Thời điểm NHÂN VIÊN gửi đăng ký. null với bản ghi tạo trước 2026-09-25. */
  created_at: string | null;
  review_note: string;
  registration_deadline: string;
  is_past_deadline: boolean;
  /** Người đang xem được huỷ đơn này không (chỉ ca2-day-status trả về). */
  can_cancel?: boolean;
}

export interface Ca2PendingApprovalRow extends Ca2Request {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
}

export interface ShiftOverviewDay {
  date: string;
  registered: boolean;
  ca_choice: 1 | 2 | null;
  morning_shift_code: string | null;
  afternoon_shift_code: string | null;
  // Thêm 2026-09-17 — chỉ có ý nghĩa khi row.requires_manager_approval=true
  // (nhóm Điều dưỡng): id của ShiftRegistrationDay (dùng gọi approve-ca2/
  // reject-ca2) + trạng thái duyệt của NGÀY ĐÓ. null/None khi ngày chưa có
  // bản ghi nào (chưa đăng ký gì, đang mặc định Ca 1).
  day_id: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | null;
  is_past_deadline: boolean | null;
  reviewed_by_name: string | null;
  /** QLTT/HCNS được bấm "Huỷ" ngày này không (backend tự tính theo quyền + ngày). */
  can_cancel?: boolean;
}

export interface ShiftOverviewRow extends CaLabels {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  position_name: string | null;
  has_registration: boolean;
  registration_deadline: string;
  is_past_deadline: boolean;
  // true => nhóm "mặc định Ca 1, đăng ký Ca 2 theo NGÀY cần duyệt" (Điều
  // dưỡng) — dòng này render nút đăng ký/duyệt Ca 2 theo ngày (register-ca2/
  // approve-ca2/reject-ca2) thay vì ô chọn cả tuần (save(), bị chặn 403 cho
  // nhóm này — xem create() ở backend).
  requires_manager_approval: boolean;
  days: ShiftOverviewDay[];
  // Ca 1/Ca 2 ĐÚNG của config áp dụng cho NHÂN VIÊN NÀY — có thể khác nhau
  // giữa các dòng nếu công ty cấu hình nhiều ShiftRegistrationScopeConfig
  // song song (mỗi nhóm phòng ban/vị trí/bác sĩ phụ trách 1 cặp giờ riêng).
  // Dùng khi "sửa hộ" — KHÔNG dùng ca_1/ca_2 của scope-status (đó là của
  // người đang xem, có thể khác/rỗng).
  ca_1: CaBrief | null;
  ca_2: CaBrief | null;
}

export interface ShiftRegistrationDay {
  id: number;
  date: string;
  ca_choice: 1 | 2 | null;
  morning_shift_code: string | null;
  morning_shift_name: string | null;
  morning_start_time: string | null;
  morning_end_time: string | null;
  afternoon_shift_code: string | null;
  afternoon_shift_name: string | null;
  afternoon_start_time: string | null;
  afternoon_end_time: string | null;
}

export interface ShiftRegistration {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  week_start_date: string;
  week_end_date: string;
  days: ShiftRegistrationDay[];
  is_past_deadline: boolean;
  registration_deadline: string;
  created_at: string;
  updated_at: string;
}

class ShiftRegistrationService {
  /** NV hiện tại có thuộc phạm vi tính năng Đăng ký ca làm không + thông tin 2 ca. */
  async getScopeStatus(): Promise<ShiftScopeStatus> {
    const response = await managementApi.get('/api-hrm/shift-registrations/scope-status/');
    return response.data;
  }

  /**
   * Lưới đăng ký ca của cả nhóm trong 1 tuần — CHỈ XEM.
   * HR/Admin: toàn bộ NV trong phạm vi (lọc thêm được theo department_id).
   * Quản lý trực tiếp: chỉ cấp dưới trực tiếp đang trong phạm vi.
   */
  async getTeamOverview(params: {
    week_start_date: string;
    department_id?: number;
  }): Promise<ShiftOverviewRow[]> {
    const response = await managementApi.get('/api-hrm/shift-registrations/team-overview/', { params });
    return response.data;
  }

  /** Danh sách đăng ký ca làm (mặc định: của chính mình, tối đa 12 tuần gần nhất). */
  async list(params?: { week_start_date?: string; employee_id?: number }): Promise<ShiftRegistration[]> {
    const response = await managementApi.get('/api-hrm/shift-registrations/', { params });
    return response.data;
  }

  /** Upsert đăng ký ca cho 1 tuần. ca: 1 (Ca 1) | 2 (Ca 2) | null (Nghỉ). */
  async save(data: {
    employee_id?: number;
    week_start_date: string;
    days: Array<{ date: string; ca: 1 | 2 | null }>;
  }): Promise<ShiftRegistration> {
    const response = await managementApi.post('/api-hrm/shift-registrations/', data);
    return response.data;
  }

  /**
   * Tạo Đơn đổi ca (đổi giữa Ca 1 / Ca 2 cho 1 ngày cụ thể đã đăng ký — LUÔN
   * đổi cả ca sáng lẫn ca chiều vì đi theo cặp).
   * Tái sử dụng /api-hrm/registration-requests/ (cùng luồng duyệt QLTT -> HR
   * với các đơn đăng ký khác — chỉ khác registration_type=SHIFT_CHANGE).
   * Chỉ tạo được cho ngày TRƯƠNG LAI (backend cũng validate lại).
   */
  async createShiftChangeRequest(data: {
    employee_id: number;
    attendance_date: string;
    to_ca: 1 | 2;
    reason: string;
  }): Promise<any> {
    const response = await managementApi.post('/api-hrm/registration-requests/', {
      employee_id: data.employee_id,
      registration_type: 'SHIFT_CHANGE',
      attendance_date: data.attendance_date,
      to_ca: data.to_ca,
      reason: data.reason,
    });
    return response.data;
  }

  // ── Đăng ký Ca 2 theo NGÀY, cần quản lý trực tiếp duyệt trước 0h ────────
  // (chỉ áp dụng khi scope-status trả requires_manager_approval=true — khác
  // hẳn save() ở trên, vốn đăng ký CẢ TUẦN và có hiệu lực ngay, không duyệt.)

  /**
   * Đăng ký làm Ca 2 cho 1 ngày cụ thể. Thường là ngày TƯƠNG LAI; riêng khi
   * chính quản lý trực tiếp của nhân viên gọi (tạo hộ), backend còn cho
   * phép lùi tối đa 2 NGÀY LÀM VIỆC gần nhất (không cần "mở khoá đặc biệt")
   * — và trong trường hợp đó tự động DUYỆT LUÔN (status trả về đã là
   * APPROVED, không cần gọi thêm approveCa2()).
   */
  async registerCa2(data: { employee_id?: number; date: string }): Promise<Ca2Request> {
    const response = await managementApi.post('/api-hrm/shift-registrations/register-ca2/', data);
    return response.data;
  }

  /**
   * Trạng thái Ca 2 của 1 nhân viên vào 1 ngày cụ thể — dùng để hiển thị
   * đúng trạng thái (chưa có/chờ duyệt/đã duyệt/từ chối) trước khi cho
   * phép tạo hộ, vd ở modal "Chi tiết chấm công ngày". `in_scope: false`
   * nghĩa là nhân viên này không thuộc nhóm áp dụng Ca 2 theo ngày — ẩn
   * hẳn UI đăng ký Ca 2 trong trường hợp đó.
   */
  async getCa2DayStatus(params: { employee_id: number; date: string }): Promise<{ in_scope: boolean } & Partial<Ca2Request>> {
    const response = await managementApi.get('/api-hrm/shift-registrations/ca2-day-status/', { params });
    return response.data;
  }

  /** Lịch sử đăng ký Ca 2 của chính mình (tối đa 60 bản ghi gần nhất). */
  async getMyCa2Requests(): Promise<Ca2Request[]> {
    const response = await managementApi.get('/api-hrm/shift-registrations/my-ca2-requests/');
    return response.data;
  }

  /** Đơn Ca 2 đang chờ duyệt mà người gọi có quyền duyệt (QLTT: cấp dưới trực tiếp; Admin/HR: tất cả). */
  /**
   * Đơn Ca 2 mà người gọi có quyền duyệt. Backend tự giới hạn phạm vi (QLTT
   * chỉ thấy cấp dưới trực tiếp, Admin/HR thấy tất cả) nên không cần lọc thêm
   * ở FE. `status` mặc định PENDING — truyền APPROVED/REJECTED để hiện đơn
   * Ca 2 ở tab "Đã duyệt"/"Từ chối" của trang Phê duyệt.
   */
  async getPendingCa2Approvals(
    status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
  ): Promise<Ca2PendingApprovalRow[]> {
    const response = await managementApi.get(
      '/api-hrm/shift-registrations/pending-ca2-approvals/', { params: { status } },
    );
    return response.data;
  }

  async approveCa2(dayId: number): Promise<Ca2Request> {
    const response = await managementApi.post(`/api-hrm/shift-registrations/${dayId}/approve-ca2/`, {});
    return response.data;
  }

  async rejectCa2(dayId: number, note?: string): Promise<Ca2Request> {
    const response = await managementApi.post(`/api-hrm/shift-registrations/${dayId}/reject-ca2/`, { note });
    return response.data;
  }

  /**
   * Huỷ đơn đăng ký ca đã duyệt/đang chờ (nhân viên không làm ca đó nữa) —
   * ngày đó quay về ca mặc định. QLTT: ngày tương lai hoặc 2 ngày làm việc
   * gần nhất; HCNS/Admin: mọi ngày.
   */
  async cancelCa2(dayId: number, note?: string): Promise<Ca2Request> {
    const response = await managementApi.post(`/api-hrm/shift-registrations/${dayId}/cancel-ca2/`, { note });
    return response.data;
  }
}

export const shiftRegistrationService = new ShiftRegistrationService();
export default shiftRegistrationService;
