import { managementApi } from '../utils/api';

export interface DailySummaryItem {
  date: string;
  day: number;
  weekday_label: string;
  is_weekend: boolean;
  work_credit: number;
  day_type: '' | 'P' | 'OLW' | 'L' | 'KP';
  holiday_name?: string | null;
}

export interface WorkFinalizationRecord {
  stt: number;
  id: number;
  employee_id: number;
  ma_nv: string;
  ho_va_ten: string;
  phong_ban: string | null;
  vi_tri: string | null;
  bac_si: string | null;
  ngay_bat_dau_lam_viec: string | null;
  ngay_ket_thuc_thu_viec: string | null;
  on_off: string | null;
  ngay_nghi_viec: string | null;
  hinh_thuc_lam_viec: string | null;
  cong_thu_viec: number;
  cong_chinh_thuc: number;
  co_le: number | null;
  /** Phần công lễ rơi vào thời gian thử việc (tính lương như công thử việc) / chính thức. */
  co_le_thu_viec?: number;
  co_le_chinh_thuc?: number;
  cong_thuc_te: number;
  tong_cong: number;
  tong_phat: number;
  tang_ca: number;
  lam_toi: number | null;
  truc_toi: number;
  lam_them_gio: number;
  live: number;
  phu_cap_gui_xe: number;
  nghi_phep: number;
  nghi_khong_phep?: number;
  lam_viec_online?: number;
  giam_tru_khac?: number;
  year: number;
  month: number;
  finalized_at: string;
  daily_summary?: DailySummaryItem[];
}

export interface WorkFinalizationListResponse {
  year: number;
  month: number;
  total: number;
  results: WorkFinalizationRecord[];
}

export interface WorkFinalizationParams {
  year: number;
  month: number;
  employee_code?: string;
  department_id?: number;
}

export interface FinalizeRequest {
  employee_code: string;
  year: number;
  month: number;
}

export interface FinalizeResponse {
  message: string;
  created: boolean;
  data: WorkFinalizationRecord;
}

export interface FinalizeAllRequest {
  year: number;
  month: number;
}

export interface FinalizeDepartmentRequest {
  year: number;
  month: number;
  department_id?: number;
  department_code?: string;
}

export interface FinalizeDepartmentResponse {
  year: number;
  month: number;
  department_id: number | null;
  department_code: string | null;
  total_processed: number;
  total_errors: number;
  results: FinalizeAllResultItem[];
  errors: FinalizeAllErrorItem[];
}

export interface FinalizeAllResultItem {
  employee_code: string;
  ho_va_ten: string;
  created: boolean;
}

export interface FinalizeAllErrorItem {
  employee_code: string;
  ho_va_ten: string;
  error: string;
}

export interface FinalizeAllResponse {
  year: number;
  month: number;
  total_processed: number;
  total_errors: number;
  results: FinalizeAllResultItem[];
  errors: FinalizeAllErrorItem[];
}

// ─── Finalization Lock types ───

export type LockPeriod = 'FIRST_HALF' | 'SECOND_HALF';

export interface LockStatusResponse {
  id?: number;
  year: number;
  month: number;
  period?: LockPeriod;
  period_display?: string;
  is_locked: boolean;
  lock_start_at: string | null;
  locked_by: string | null;
  locked_by_id?: number | null;
  locked_by_role?: string | null;
  locked_at: string | null;
  unlocked_by?: string | null;
  unlocked_at?: string | null;
  note?: string;
}

export interface LockStatusBothResponse {
  year: number;
  month: number;
  first_half: LockStatusResponse;
  second_half: LockStatusResponse;
}

export interface ToggleLockRequest {
  year: number;
  month: number;
  period: LockPeriod;
  is_locked: boolean;
  note?: string;
  lock_start_at?: string | null;
}

export interface ToggleLockResponse extends LockStatusResponse {
  message: string;
  performed_by: string;
  performed_by_role: string;
}

export interface LockCheckResponse {
  year: number;
  month: number;
  period?: LockPeriod;
  is_locked: boolean;
  first_half_locked?: boolean;
  second_half_locked?: boolean;
  message: string | null;
  lock_start_at?: string | null;
  locked_at?: string | null;
}

export interface LockLogEntry {
  id: number;
  action: 'LOCKED' | 'UNLOCKED';
  action_display: string;
  performed_by: string | null;
  performed_by_role: string;
  note: string;
  created_at: string;
}

// ─── Finalization Lock — per-employee override ───

export interface LockEmployeeOverride {
  id: number;
  year: number;
  month: number;
  period: LockPeriod;
  period_display: string;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  is_unlocked: boolean;
  note: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SetLockEmployeeOverrideRequest {
  year: number;
  month: number;
  period: LockPeriod;
  employee_ids: number[];
  is_unlocked: boolean;
  note?: string;
}

export interface SetLockEmployeeOverrideResponse {
  message: string;
  overrides: LockEmployeeOverride[];
  missing_employee_ids: number[];
}

// ─── Detail export (giờ vào/ra + đơn từ theo ngày) ───

export interface DetailExportDay {
  date: string;
  day: number;
  check_in: string | null;
  check_out: string | null;
  requests: string[];
  request_contents: string[];
}

export interface DetailExportEmployee {
  ma_nv: string;
  ho_va_ten: string;
  phong_ban: string;
  vi_tri: string;
  days: DetailExportDay[];
}

export interface DetailExportParams {
  year: number;
  month: number;
  employee_code?: string;
  department_id?: number;
  /** Danh sách phòng ban dạng chuỗi id cách nhau bởi dấu phẩy, vd: "1,2,3" */
  department_ids?: string;
  search?: string;
}

export interface DetailExportResponse {
  year: number;
  month: number;
  total: number;
  results: DetailExportEmployee[];
}

class WorkFinalizationService {
  async list(params: WorkFinalizationParams): Promise<WorkFinalizationListResponse> {
    const response = await managementApi.get('/api-hrm/work-finalization/', { params });
    return response.data;
  }

  async finalize(data: FinalizeRequest): Promise<FinalizeResponse> {
    const response = await managementApi.post('/api-hrm/work-finalization/finalize/', data);
    return response.data;
  }

  async finalizeAll(data: FinalizeAllRequest): Promise<FinalizeAllResponse> {
    const response = await managementApi.post('/api-hrm/work-finalization/finalize-all/', data);
    return response.data;
  }

  async finalizeDepartment(data: FinalizeDepartmentRequest): Promise<FinalizeDepartmentResponse> {
    const response = await managementApi.post('/api-hrm/work-finalization/finalize-department/', data);
    return response.data;
  }

  async getDetailExport(params: DetailExportParams): Promise<DetailExportResponse> {
    const response = await managementApi.get('/api-hrm/work-finalization/export-detail/', { params });
    return response.data;
  }

  async getDetail(
    employeeCode: string,
    year: number,
    month: number
  ): Promise<WorkFinalizationRecord> {
    const response = await managementApi.get(
      `/api-hrm/work-finalization/${employeeCode}/${year}/${month}/`
    );
    return response.data;
  }

  // ─── Finalization Lock ───

  async getLockStatus(year: number, month: number): Promise<LockStatusBothResponse> {
    const response = await managementApi.get('/api-hrm/finalization-lock/status/', {
      params: { year, month },
    });
    return response.data;
  }

  async getLockStatusForPeriod(year: number, month: number, period: LockPeriod): Promise<LockStatusResponse> {
    const response = await managementApi.get('/api-hrm/finalization-lock/status/', {
      params: { year, month, period },
    });
    return response.data;
  }

  async toggleLock(data: ToggleLockRequest): Promise<ToggleLockResponse> {
    const response = await managementApi.post('/api-hrm/finalization-lock/toggle/', data);
    return response.data;
  }

  async checkLock(year: number, month: number): Promise<LockCheckResponse> {
    const response = await managementApi.get('/api-hrm/finalization-lock/check/', {
      params: { year, month },
    });
    return response.data;
  }

  async getLockList(year?: number): Promise<LockStatusResponse[]> {
    const response = await managementApi.get('/api-hrm/finalization-lock/list/', {
      params: year ? { year } : {},
    });
    return response.data;
  }

  async getLockLogs(lockId: number): Promise<LockLogEntry[]> {
    const response = await managementApi.get(`/api-hrm/finalization-lock/${lockId}/logs/`);
    return response.data;
  }

  // ─── Finalization Lock — per-employee override ───

  async getLockEmployeeOverrides(
    year: number, month: number, period: LockPeriod
  ): Promise<LockEmployeeOverride[]> {
    const response = await managementApi.get('/api-hrm/finalization-lock/employee-overrides/', {
      params: { year, month, period },
    });
    return response.data;
  }

  async setLockEmployeeOverride(
    data: SetLockEmployeeOverrideRequest
  ): Promise<SetLockEmployeeOverrideResponse> {
    const response = await managementApi.post('/api-hrm/finalization-lock/employee-overrides/', data);
    return response.data;
  }

  async deleteLockEmployeeOverride(id: number): Promise<{ message: string }> {
    const response = await managementApi.delete(`/api-hrm/finalization-lock/employee-overrides/${id}/`);
    return response.data;
  }
}

export const workFinalizationService = new WorkFinalizationService();
export default workFinalizationService;
