import { managementApi } from '../utils/api';
import type { Department, Employee } from '../utils/api';

export interface SalaryFormulaConfig {
  employee_id: number;
  basic_salary: number;
  allowance: number;
  probation_rate?: string;
  salary_notes?: string;
  allowance_notes?: string;
  salary_adjustments?: Record<string, unknown>;
}

export interface SalaryRecord {
  employee_id: number;
  ma_nv: string;
  ho_va_ten: string;
  phap_nhan_con?: string | null;
  phong_ban: string | null;
  vi_tri: string | null;
  luong_co_ban: number;
  phu_cap: number;
  thu_nhap_khac?: number;
  ngay_cong: number;
  cong_thu_viec?: number;
  cong_chinh_thuc: number;
  probation_rate_percent?: number;
  luong_ngay_cong_thu_viec?: number;
  luong_ngay_cong_chinh_thuc?: number;
  luong_ngay_cong?: number;
  tang_ca: number;
  truc_toi: number;
  lam_them_gio: number;
  thuong?: number;
  phu_cap_gui_xe: number;
  phu_cap_khac: number;
  phu_cap_livestream?: number;
  so_phien_livestream?: number;
  muc_phu_cap_moi_phien_livestream?: number;
  tong_cong: number;
  cong_chuan?: number;
  tong_phat: number;
  tong_phat_bienban: number;
  bh_deduction: number;
  so_gio_tang_ca: number;
  luong_tang_ca: number;
  contract_type?: string;
  contract_status?: 'CHINH_THUC' | 'THU_VIEC';
  phu_cap_an_trua?: number;
  tong_thu_nhap_chiu_thue?: number;
  thue_tncn?: number;
  tax_method?: 'PROGRESSIVE' | 'FLAT_10_PROBATION' | 'FLAT_10_NON_OFFICIAL' | 'FLAT_10_MIXED_LT14';
  so_nguoi_phu_thuoc?: number;
  thu_nhap_tinh_thue?: number;
  giam_tru_ban_than?: number;
  giam_tru_nguoi_phu_thuoc?: number;
  bao_hiem_bat_buoc?: number;
  tam_ung: number;
  luong_thuc_linh: number;
  year: number;
  month: number;
}

export interface SalaryListResponse {
  year: number;
  month: number;
  department_id: number | null;
  legal_entity?: string | null;
  department_name: string | null;
  employment_filter?: 'all' | 'working' | 'left';
  working_count?: number;
  left_count?: number;
  /** Số người đã nghỉ nhưng VẪN còn lương phải trả của những ngày đã làm trong tháng */
  left_payable_count?: number;
  left_payable_amount?: number;
  total: number;
  results: SalaryRecord[];
}

export interface SalaryFormulaUpdateData {
  basic_salary?: number;
  allowance?: number;
  salary_notes?: string;
  allowance_notes?: string;
  salary_adjustments?: Record<string, unknown>;
}

export interface KPIRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  commission_amount: number;
  notes: string;
}

export interface PenaltyRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  department_name?: string | null;
  company_unit_name?: string | null;
  year: number;
  month: number;
  amount: number;
  status: 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED';
  reason: string;
  notes: string;
  created_by?: number | null;
  created_by_name?: string | null;
  direct_manager_approved_by?: number | null;
  direct_manager_approved_by_name?: string | null;
  direct_manager_approved_at?: string | null;
  approved_by?: number | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  rejected_by?: number | null;
  rejected_by_name?: string | null;
  rejected_at?: string | null;
  approval_note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BulkImportPenaltyRecord {
  employee_code: string;
  amount: number;
  reason: string;
}

export interface BulkImportPenaltySuccessItem {
  id: number;
  employee_code: string;
  employee_name: string;
  amount: number;
  reason: string;
}

export interface BulkImportPenaltyErrorItem {
  employee_code: string;
  error: string;
}

export interface BulkImportPenaltyResponse {
  success: BulkImportPenaltySuccessItem[];
  errors: BulkImportPenaltyErrorItem[];
}

export interface CommissionRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  amount: number;
  notes: string;
}

export interface BulkImportCommissionRecord {
  employee_code: string;
  commission_amount: number;
}

export interface BulkImportCommissionResponse {
  success: { employee_code: string; employee_name: string; commission_amount: number; created: boolean }[];
  errors:  { employee_code: string; error: string }[];
}

export interface AdvanceRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  department_name: string | null;
  manager_name: string | null;
  start_date: string | null;
  basic_salary: string | number | null;
  region: string | null;
  bank_account: string | null;
  bank_name: string | null;
  year: number;
  month: number;
  amount: number;
  notes: string;
}

export interface BulkImportAdvanceRecord {
  employee_code: string;
  amount: number;
}

export interface BulkImportAdvanceResponse {
  success: { employee_code: string; employee_name: string; amount: number; created: boolean }[];
  errors:  { employee_code: string; error: string }[];
}

export interface OtherAllowanceRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  amount: number;
  description: string;
  notes: string;
}

export interface BulkImportOtherAllowanceRecord {
  employee_code: string;
  amount: number;
  description: string;
}

export interface BulkImportOtherAllowanceResponse {
  success: { employee_code: string; employee_name: string; amount: number; description: string; created: boolean }[];
  errors:  { employee_code: string; error: string }[];
}

export interface ParkingAllowanceOverrideRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  amount: number;
  notes: string;
}

export interface BulkImportParkingAllowanceRecord {
  employee_code: string;
  amount: number;
  notes: string;
}

export interface BulkImportParkingAllowanceResponse {
  success: { employee_code: string; employee_name: string; amount: number; notes: string; created: boolean }[];
  errors:  { employee_code: string; error: string }[];
}

// PC ăn trưa nhập tay dùng chung dạng dữ liệu với PC gửi xe.
export type LunchAllowanceOverrideRecord = ParkingAllowanceOverrideRecord;
export type BulkImportLunchAllowanceRecord = BulkImportParkingAllowanceRecord;
export type BulkImportLunchAllowanceResponse = BulkImportParkingAllowanceResponse;

/** Kết quả tạo bản ghi cho những nhân viên chưa có trong kỳ. */
export interface FillMissingAllowanceResponse {
  created_count: number;
  skipped_existing_count: number;
  errors: { employee_code: string; error: string }[];
}

export interface SalaryAdjustmentRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  component_code: string;
  component_name: string;
  component_type: string;
  amount: number;
  is_addition: boolean;
  notes: string;
}

export interface MonthlySalaryInputRecord {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  year: number;
  month: number;
  luong_doanh_so: number | null;
  luong_ot: number | null;
  ban_san_pham: number | null;
  phu_mo: number | null;
  truc_ca: number | null;
  thuong: number | null;
  notes: string;
}

export interface BulkImportMonthlySalaryInputRecord {
  employee_code: string;
  luong_doanh_so?: number | null;
  luong_ot?: number | null;
  ban_san_pham?: number | null;
  phu_mo?: number | null;
  truc_ca?: number | null;
  thuong?: number | null;
}

export interface BulkImportMonthlySalaryInputResponse {
  success: {
    employee_code: string;
    employee_name: string;
    luong_doanh_so: number | null;
    luong_ot: number | null;
    ban_san_pham: number | null;
    phu_mo: number | null;
    truc_ca: number | null;
    thuong: number | null;
    created: boolean;
  }[];
  errors: { employee_code: string; error: string }[];
}

export interface BulkImportSalaryAdjustmentRecord {
  employee_code: string;
  amount: number;
  notes?: string;
}

export interface BulkImportSalaryAdjustmentResponse {
  success: { employee_code: string; employee_name: string; amount: number; created: boolean }[];
  errors:  { employee_code: string; error: string }[];
}

export interface OvertimeRateConfig {
  id: number;
  department_ids:    number[];
  department_names:  string[];
  position_ids:      number[];
  position_names:    string[];
  employee_ids:      number[];
  employee_names:    { id: number; name: string; code: string }[];
  apply_to_all:      boolean;
  calc_method:       'FIXED' | 'FROM_BASIC';
  rate_per_hour:     number;
  multiplier:        number;
  use_kpi:           boolean;
  kpi_multiplier:    number | null;
  kpi_rate_per_hour: number | null;
  kpi_threshold:     number;
  effective_from:    string;
  effective_to:      string | null;
  is_active:         boolean;
  notes:             string;
  created_at:        string;
  updated_at:        string;
}

export type OvertimeRateLevel = 'department' | 'position' | 'employee' | 'all';

export interface BulkSalaryConfigRecord {
  employee_code: string;
  effective_date: string;
  basic_salary?: number;
  salary_factor?: number;
  lunch_mode?: string;
  lunch_amount?: number;
  parking_mode?: string;
  parking_rate?: number;
  responsibility_mode?: string;
  responsibility_amount?: number;
  region?: string;
  insurance_mode?: string;
  insurance_override?: number;
  dependent_count?: number;
  union_fee?: number;
}

export interface BulkSalaryConfigResponse {
  success: { employee_code: string; employee_name: string }[];
  errors: { employee_code: string; error: string }[];
}

export interface SendDepartmentPayslipPayload {
  year: number;
  month: number;
  department_id: number;
  subject_template?: string;
  body_template?: string;
}

export interface SendDepartmentPayslipResponse {
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

export interface DepartmentPayslipRecipient {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  email: string;
  has_email: boolean;
  preview_subject: string;
  preview_body: string;
}

export interface DepartmentPayslipRecipientsResponse {
  year: number;
  month: number;
  department_id: number;
  department_name: string;
  total: number;
  can_send: number;
  no_email_count: number;
  recipients: DepartmentPayslipRecipient[];
}

export interface DepartmentPayslipEmailStatusItem {
  employee_id: number;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | null;
  processed_at: string | null;
  error_message: string | null;
  batch_id: string | null;
}

export interface DepartmentPayslipEmailStatusesResponse {
  statuses: DepartmentPayslipEmailStatusItem[];
}

export interface CompanyPayslipRecipientsResponse {
  year: number;
  month: number;
  total: number;
  can_send: number;
  no_email_count: number;
  recipients: DepartmentPayslipRecipient[];
}

export interface SendCompanyPayslipPayload {
  year: number;
  month: number;
  legal_entity?: string;
  subject_template?: string;
  body_template?: string;
}

export interface SendCompanyPayslipResponse {
  detail: string;
  batch_id: string;
  year: number;
  month: number;
  total: number;
  queued: number;
  skipped_no_email: number;
}

export interface PayslipEmailItem {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  email: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  processed_at: string | null;
  error_message: string | null;
  retry_count: number;
}

export interface PayslipEmailBatchStatus {
  batch_id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  total: number;
  sent: number;
  failed: number;
  pending: number;
  progress_pct: number;
  created_at: string;
  completed_at: string | null;
  emails: PayslipEmailItem[];
}

class SalaryService {
  async listSalaryDepartments(): Promise<Pick<Department, 'id' | 'name' | 'code'>[]> {
    const response = await managementApi.get('/api/v1/salary/records/departments/');
    return response.data;
  }

  async listSalaryLegalEntities(): Promise<Array<{ value: string; label: string }>> {
    const response = await managementApi.get('/api/v1/salary/records/legal-entities/');
    return response.data;
  }

  async getSalaryByDepartment(params: {
    year: number;
    month: number;
    department_id?: number;
    legal_entity?: string;
    employee_code?: string;
    /** working = chỉ người đang làm việc | left = chỉ người đã nghỉ | bỏ trống = tất cả */
    employment_filter?: 'working' | 'left';
  }): Promise<SalaryListResponse> {
    const response = await managementApi.get('/api-hrm/salary/department/', { params });
    return response.data;
  }

  async updateSalaryFormula(
    employeeId: number,
    data: SalaryFormulaUpdateData
  ): Promise<Employee> {
    const response = await managementApi.patch(`/api-hrm/employees/${employeeId}/`, data);
    return response.data;
  }

  async getEmployeeSalaryConfig(employeeId: number): Promise<Employee> {
    const response = await managementApi.get(`/api-hrm/employees/${employeeId}/`);
    return response.data;
  }

  async getEmployeeApprovalSummary(employeeId: number): Promise<any> {
    const response = await managementApi.get(`/api-hrm/employees/${employeeId}/approval-summary/`);
    return response.data;
  }

  async listEmployeeSalaries(params: {
    page?: number;
    page_size?: number;
    search?: string;
    department?: number;
    employment_status?: string;
    ordering?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Employee[];
  }> {
    const response = await managementApi.get('/api-hrm/employees/', { params });
    return response.data;
  }

  async listKPIRecords(params: { year: number; month: number }): Promise<KPIRecord[]> {
    const response = await managementApi.get('/api/v1/salary/kpi-records/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async updateKPIRecord(id: number, data: { commission_amount: number; notes?: string }): Promise<KPIRecord> {
    const response = await managementApi.patch(`/api/v1/salary/kpi-records/${id}/`, data);
    return response.data;
  }

  async deleteKPIRecord(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/kpi-records/${id}/`);
  }

  async listPenalties(params: { year: number; month: number; status?: string; employee?: number }): Promise<PenaltyRecord[]> {
    const response = await managementApi.get('/api/v1/salary/penalties/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async listPendingPenaltyApprovals(): Promise<PenaltyRecord[]> {
    const response = await managementApi.get('/api/v1/salary/penalties/pending-approvals/');
    return response.data.results ?? response.data;
  }

  async listMyPendingPenalties(employeeId: number): Promise<PenaltyRecord[]> {
    const response = await managementApi.get('/api/v1/salary/penalties/my-penalties/');
    return response.data.results ?? response.data;
  }

  async approvePenalty(id: number, note?: string): Promise<PenaltyRecord> {
    const response = await managementApi.post(`/api/v1/salary/penalties/${id}/approve/`, { note });
    return response.data;
  }

  async rejectPenalty(id: number, note?: string): Promise<PenaltyRecord> {
    const response = await managementApi.post(`/api/v1/salary/penalties/${id}/reject/`, { note });
    return response.data;
  }

  async finalizePenaltyMonth(year: number, month: number): Promise<{ updated: number; message?: string }> {
    const response = await managementApi.post('/api/v1/salary/penalties/finalize-month/', { year, month });
    return response.data;
  }

  async createPenalty(data: {
    employee: number;
    year: number;
    month: number;
    amount: number;
    reason?: string;
    notes?: string;
  }): Promise<PenaltyRecord> {
    const response = await managementApi.post('/api/v1/salary/penalties/', data);
    return response.data;
  }

  async updatePenalty(id: number, data: { amount: number; reason: string; notes?: string }): Promise<PenaltyRecord> {
    const response = await managementApi.patch(`/api/v1/salary/penalties/${id}/`, data);
    return response.data;
  }

  async deletePenalty(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/penalties/${id}/`);
  }

  async bulkImportPenalties(params: {
    year: number;
    month: number;
    records: BulkImportPenaltyRecord[];
  }): Promise<BulkImportPenaltyResponse> {
    const response = await managementApi.post('/api/v1/salary/penalties/bulk-import/', params);
    return response.data;
  }

  async listCommissions(params: { year: number; month: number }): Promise<CommissionRecord[]> {
    const response = await managementApi.get('/api/v1/salary/commissions/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async createCommission(data: {
    employee: number;
    year: number;
    month: number;
    amount: number;
    notes?: string;
  }): Promise<CommissionRecord> {
    const response = await managementApi.post('/api/v1/salary/commissions/', data);
    return response.data;
  }

  async updateCommission(id: number, data: { amount: number; notes?: string }): Promise<CommissionRecord> {
    const response = await managementApi.patch(`/api/v1/salary/commissions/${id}/`, data);
    return response.data;
  }

  async deleteCommission(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/commissions/${id}/`);
  }

  async bulkImportCommissions(params: {
    year: number;
    month: number;
    records: BulkImportCommissionRecord[];
  }): Promise<BulkImportCommissionResponse> {
    const response = await managementApi.post('/api/v1/salary/commissions/bulk-import/', params);
    return response.data;
  }

  // --- OvertimeRateConfig ---

  async listOvertimeRates(level?: OvertimeRateLevel): Promise<OvertimeRateConfig[]> {
    const params = level ? { level } : {};
    const response = await managementApi.get('/api/v1/salary/overtime-rates/', { params });
    return response.data.results ?? response.data;
  }

  async createOvertimeRate(data: Omit<OvertimeRateConfig, 'id' | 'created_at' | 'updated_at'>): Promise<OvertimeRateConfig> {
    const response = await managementApi.post('/api/v1/salary/overtime-rates/', data);
    return response.data;
  }

  async updateOvertimeRate(id: number, data: Partial<Omit<OvertimeRateConfig, 'id' | 'created_at' | 'updated_at'>>): Promise<OvertimeRateConfig> {
    const response = await managementApi.patch(`/api/v1/salary/overtime-rates/${id}/`, data);
    return response.data;
  }

  async deleteOvertimeRate(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/overtime-rates/${id}/`);
  }

  async listAdvances(params: { year: number; month: number }): Promise<AdvanceRecord[]> {
    const response = await managementApi.get('/api/v1/salary/advances/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async updateAdvance(id: number, data: { amount: number; notes?: string }): Promise<AdvanceRecord> {
    const response = await managementApi.patch(`/api/v1/salary/advances/${id}/`, data);
    return response.data;
  }

  async deleteAdvance(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/advances/${id}/`);
  }

  async bulkImportAdvances(params: {
    year: number;
    month: number;
    records: BulkImportAdvanceRecord[];
  }): Promise<BulkImportAdvanceResponse> {
    const response = await managementApi.post('/api/v1/salary/advances/bulk-import/', params);
    return response.data;
  }

  async listOtherAllowances(params: { year: number; month: number }): Promise<OtherAllowanceRecord[]> {
    const response = await managementApi.get('/api/v1/salary/other-allowances/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async createOtherAllowance(data: {
    employee: number;
    year: number;
    month: number;
    amount: number;
    description?: string;
    notes?: string;
  }): Promise<OtherAllowanceRecord> {
    const response = await managementApi.post('/api/v1/salary/other-allowances/', data);
    return response.data;
  }

  async updateOtherAllowance(id: number, data: { amount: number; description?: string; notes?: string }): Promise<OtherAllowanceRecord> {
    const response = await managementApi.patch(`/api/v1/salary/other-allowances/${id}/`, data);
    return response.data;
  }

  async deleteOtherAllowance(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/other-allowances/${id}/`);
  }

  async bulkImportOtherAllowances(params: {
    year: number;
    month: number;
    records: BulkImportOtherAllowanceRecord[];
  }): Promise<BulkImportOtherAllowanceResponse> {
    const response = await managementApi.post('/api/v1/salary/other-allowances/bulk-import/', params);
    return response.data;
  }

  async listParkingAllowanceOverrides(params: { year: number; month: number }): Promise<ParkingAllowanceOverrideRecord[]> {
    const response = await managementApi.get('/api/v1/salary/parking-allowance-overrides/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async createParkingAllowanceOverride(data: {
    employee: number;
    year: number;
    month: number;
    amount: number;
    notes?: string;
  }): Promise<ParkingAllowanceOverrideRecord> {
    const response = await managementApi.post('/api/v1/salary/parking-allowance-overrides/', data);
    return response.data;
  }

  async updateParkingAllowanceOverride(id: number, data: { amount: number; notes?: string }): Promise<ParkingAllowanceOverrideRecord> {
    const response = await managementApi.patch(`/api/v1/salary/parking-allowance-overrides/${id}/`, data);
    return response.data;
  }

  async deleteParkingAllowanceOverride(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/parking-allowance-overrides/${id}/`);
  }

  async bulkImportParkingAllowanceOverrides(params: {
    year: number;
    month: number;
    records: BulkImportParkingAllowanceRecord[];
  }): Promise<BulkImportParkingAllowanceResponse> {
    const response = await managementApi.post('/api/v1/salary/parking-allowance-overrides/bulk-import/', params);
    return response.data;
  }

  async fillRemainingParkingAllowanceZero(params: { year: number; month: number }): Promise<FillMissingAllowanceResponse> {
    const response = await managementApi.post('/api/v1/salary/parking-allowance-overrides/fill-remaining-zero/', params);
    return response.data;
  }

  async listLunchAllowanceOverrides(params: { year: number; month: number }): Promise<LunchAllowanceOverrideRecord[]> {
    const response = await managementApi.get('/api/v1/salary/lunch-allowance-overrides/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async createLunchAllowanceOverride(data: {
    employee: number;
    year: number;
    month: number;
    amount: number;
    notes?: string;
  }): Promise<LunchAllowanceOverrideRecord> {
    const response = await managementApi.post('/api/v1/salary/lunch-allowance-overrides/', data);
    return response.data;
  }

  async updateLunchAllowanceOverride(id: number, data: { amount: number; notes?: string }): Promise<LunchAllowanceOverrideRecord> {
    const response = await managementApi.patch(`/api/v1/salary/lunch-allowance-overrides/${id}/`, data);
    return response.data;
  }

  async deleteLunchAllowanceOverride(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/lunch-allowance-overrides/${id}/`);
  }

  async bulkImportLunchAllowanceOverrides(params: {
    year: number;
    month: number;
    records: BulkImportLunchAllowanceRecord[];
  }): Promise<BulkImportLunchAllowanceResponse> {
    const response = await managementApi.post('/api/v1/salary/lunch-allowance-overrides/bulk-import/', params);
    return response.data;
  }

  async syncCurrentLunchAllowances(params: { year: number; month: number }): Promise<FillMissingAllowanceResponse> {
    const response = await managementApi.post('/api/v1/salary/lunch-allowance-overrides/sync-current/', params);
    return response.data;
  }

  async listSalaryAdjustments(params: { year: number; month: number }): Promise<SalaryAdjustmentRecord[]> {
    const response = await managementApi.get('/api/v1/salary/overrides/', {
      params: { ...params, component_code: 'salary_adjustment', page_size: 500 },
    });
    return (response.data.results ?? response.data).filter((item: SalaryAdjustmentRecord) => item.component_code === 'salary_adjustment');
  }

  async createSalaryAdjustment(data: {
    employee: number;
    year: number;
    month: number;
    amount: number;
    notes?: string;
  }): Promise<SalaryAdjustmentRecord> {
    const response = await managementApi.post('/api/v1/salary/overrides/', {
      ...data,
      component_code: 'salary_adjustment',
    });
    return response.data;
  }

  async bulkImportSalaryAdjustments(params: {
    year: number;
    month: number;
    records: BulkImportSalaryAdjustmentRecord[];
  }): Promise<BulkImportSalaryAdjustmentResponse> {
    const response = await managementApi.post('/api/v1/salary/overrides/bulk-import/', params);
    return response.data;
  }

  async listMonthlyInputs(params: { year: number; month: number }): Promise<MonthlySalaryInputRecord[]> {
    const response = await managementApi.get('/api/v1/salary/monthly-inputs/', { params: { ...params, page_size: 500 } });
    return response.data.results ?? response.data;
  }

  async createMonthlyInput(data: {
    employee: number;
    year: number;
    month: number;
    luong_doanh_so?: number | null;
    luong_ot?: number | null;
    ban_san_pham?: number | null;
    phu_mo?: number | null;
    truc_ca?: number | null;
    thuong?: number | null;
    notes?: string;
  }): Promise<MonthlySalaryInputRecord> {
    const response = await managementApi.post('/api/v1/salary/monthly-inputs/', data);
    return response.data;
  }

  async updateMonthlyInput(id: number, data: {
    luong_doanh_so?: number | null;
    luong_ot?: number | null;
    ban_san_pham?: number | null;
    phu_mo?: number | null;
    truc_ca?: number | null;
    thuong?: number | null;
    notes?: string;
  }): Promise<MonthlySalaryInputRecord> {
    const response = await managementApi.patch(`/api/v1/salary/monthly-inputs/${id}/`, data);
    return response.data;
  }

  async deleteMonthlyInput(id: number): Promise<void> {
    await managementApi.delete(`/api/v1/salary/monthly-inputs/${id}/`);
  }

  async bulkImportMonthlyInputs(params: {
    year: number;
    month: number;
    records: BulkImportMonthlySalaryInputRecord[];
  }): Promise<BulkImportMonthlySalaryInputResponse> {
    const response = await managementApi.post('/api/v1/salary/monthly-inputs/bulk-import/', params);
    return response.data;
  }

  async bulkImportSalaryConfig(records: BulkSalaryConfigRecord[]): Promise<BulkSalaryConfigResponse> {
    const response = await managementApi.post('/api-hrm/employees/bulk-salary-config/', { records });
    return response.data;
  }

  async sendPayslipEmail(
    payload: { email: string; subject: string; body: string; employee_id: number; year: number; month: number; recipient_name?: string },
    options?: { timeoutMs?: number }
  ): Promise<{ detail: string }> {
    const response = await managementApi.post('/api/v1/salary/records/send-payslip-email/', payload, {
      timeout: options?.timeoutMs ?? 120000,
    });
    return response.data;
  }

  async sendDepartmentPayslipEmails(
    payload: SendDepartmentPayslipPayload,
    options?: { timeoutMs?: number }
  ): Promise<SendDepartmentPayslipResponse> {
    const response = await managementApi.post('/api/v1/salary/records/send-department-payslip-emails/', payload, {
      timeout: options?.timeoutMs ?? 30000,
    });
    return response.data;
  }

  async getDepartmentPayslipRecipients(params: {
    year: number;
    month: number;
    department_id: number;
  }): Promise<DepartmentPayslipRecipientsResponse> {
    const response = await managementApi.get('/api/v1/salary/records/department-payslip-recipients/', { params });
    return response.data;
  }

  async getDepartmentPayslipEmailStatuses(params: {
    year: number;
    month: number;
    department_id?: number;
    legal_entity?: string;
  }): Promise<DepartmentPayslipEmailStatusesResponse> {
    const response = await managementApi.get('/api/v1/salary/records/department-payslip-email-statuses/', { params });
    return response.data;
  }

  async getCompanyPayslipRecipients(params: {
    year: number;
    month: number;
    legal_entity?: string;
  }): Promise<CompanyPayslipRecipientsResponse> {
    const response = await managementApi.get('/api/v1/salary/records/company-payslip-recipients/', { params });
    return response.data;
  }

  async sendCompanyPayslipEmails(
    payload: SendCompanyPayslipPayload,
    options?: { timeoutMs?: number }
  ): Promise<SendCompanyPayslipResponse> {
    const response = await managementApi.post('/api/v1/salary/records/send-company-payslip-emails/', payload, {
      timeout: options?.timeoutMs ?? 30000,
    });
    return response.data;
  }

  async getPayslipEmailBatchStatus(batchId: string): Promise<PayslipEmailBatchStatus> {
    const response = await managementApi.get(`/api/v1/salary/records/payslip-email-batch/${batchId}/`);
    return response.data;
  }

  async getTotalSalarySummary(params: {
    year: number;
    month: number;
    department?: number;
    legal_entity?: string;
  }): Promise<{
    year: number;
    month: number;
    department_id: number | null;
    legal_entity?: string | null;
    total_luong_thuc_linh: number;
    total_con_phai_thanh_toan: number;
    total_thue_tncn: number;
    total_net_salary: number;
    employee_count: number;
  }> {
    const response = await managementApi.get('/api/v1/salary/records/total-summary/', { params });
    return response.data;
  }

  async predictBonus(params: {
    scheme: 'fixed_3m_basic' | 'prorated' | 'custom';
    fixed_amount?: number;
    bonus_months?: number;
    department_id?: number;
    legal_entity?: string;
    under_one_year_amount?: number;
  }): Promise<{
    scheme: string;
    fixed_amount: number | null;
    bonus_months: number;
    department_filter: number | null;
    legal_entity_filter: string | null;
    total_employee_count: number;
    total_bonus: number;
    employees: Array<{
      employee_id: number;
      employee_code: string;
      employee_name: string;
      department: string;
      basic_salary: number;
      start_date: string | null;
      months_worked: number;
      is_over_1_year: boolean;
      scheme: string;
      bonus_amount: number;
      bonus_months: number;
      reason: string;
    }>;
    departments: Array<{
      department_id: number | null;
      department_name: string;
      employee_count: number;
      total_bonus: number;
      employees: Array<any>;
    }>;
    generated_at: string;
  }> {
    const response = await managementApi.post('/api/v1/salary/records/bonus-prediction/', params);
    return response.data;
  }
}

export const salaryService = new SalaryService();
export default salaryService;
