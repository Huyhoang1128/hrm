import { managementApi } from '@/utils/api';

// Đơn giản hoá 2026-09-18 (yêu cầu HCNS "focus vào việc duyệt và chưa duyệt
// hơn"): chỉ còn 3 tab — lý do chi tiết (shortfall/multi_segment/...) vẫn
// hiện ở cột Trạng thái/Ghi chú từng dòng, không dùng để chia tab nữa.
export type OvertimeReconciliationTab = 'pending' | 'done' | 'rejected';

export const OT_RECONCILIATION_TABS: { key: OvertimeReconciliationTab; label: string }[] = [
  { key: 'pending', label: 'Chưa duyệt' },
  { key: 'done', label: 'Đã duyệt' },
  { key: 'rejected', label: 'Từ chối' },
];

// Tab mà HR còn cần thao tác (Duyệt/Từ chối/Sửa) — 'done'/'rejected' chỉ để xem.
export const ACTIONABLE_TABS: OvertimeReconciliationTab[] = ['pending'];

export interface OvertimeReconciliationNote {
  status: string;
  checked_at: string;
  message?: string;
  actual_checkin?: string | null;
  actual_checkout?: string | null;
  shortfall_minutes?: number;
  excess_minutes?: number;
  // Hạn QLTT trực tiếp phải sửa xong đơn 'excess' (10h sáng ngày lịch kế
  // tiếp) — theo thống nhất với Sếp 2026-09-22.
  manager_fix_deadline?: string;
  registered_hours?: number | null;
  // HR/QLTT đã bấm Duyệt/Sửa auto/Sửa tay ở màn này chưa (xem reconciliationAction).
  // MANAGER_EXCESS_FIX = QLTT trực tiếp vừa sửa đơn 'excess', đang chờ HCNS duyệt lại.
  hr_decision?: 'ACCEPT' | 'AUTO_FIX' | 'MANUAL_FIX' | 'MANAGER_EXCESS_FIX';
  hr_decided_by_name?: string;
  hr_decided_at?: string;
  hr_note?: string;
}

export const HR_DECISION_LABEL: Record<string, string> = {
  ACCEPT: 'Đã duyệt',
  AUTO_FIX: 'Đã sửa tự động',
  MANUAL_FIX: 'Đã sửa tay',
  MANAGER_EXCESS_FIX: 'QLTT đã sửa — chờ HCNS duyệt lại',
};

// auto_fix (nút "Sửa auto") — CHỈ còn 'missing_checkin_note' (có giờ ra
// thực tế rõ ràng để tự áp dụng); 'shortfall' cũ giờ hệ thống TỰ ĐỘNG áp
// dụng ngay lúc đối soát nên không còn cần bấm gì nữa (thống nhất Sếp
// 2026-09-22) — khớp đúng điều kiện backend (reconciliation_action()).
export const AUTO_FIX_ELIGIBLE_STATUSES = ['missing_checkin_note'];

export interface OvertimeReconciliationRow {
  event_id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_name?: string | null;
  date: string;
  request_code: string;
  reason: string;
  registered_check_in: string | null;
  registered_check_out: string | null;
  overtime_hours: number | null;
  ot_type: string;
  reconciliation: OvertimeReconciliationNote | null;
  status: string;
  // Chỉ có giá trị khi status === 'REJECTED' (tab 'rejected').
  rejected_by_name?: string | null;
  rejected_at?: string | null;
  rejection_note?: string;
}

export interface OvertimeReconciliationResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: OvertimeReconciliationRow[];
  summary: Record<OvertimeReconciliationTab, number>;
  tab: OvertimeReconciliationTab;
  month: number;
  year: number;
  policy_note?: string;
}

export const overtimeReconciliationService = {
  async getReconciliation(params: {
    month: number;
    year: number;
    tab: OvertimeReconciliationTab;
    page?: number;
    page_size?: number;
  }): Promise<OvertimeReconciliationResponse> {
    const response = await managementApi.get('/api-hrm/registration-requests/overtime-reconciliation/', {
      params,
    });
    return response.data;
  },

  /**
   * Duyệt/Sửa auto/Sửa tay 1 đơn tăng ca ngay ở màn Đối chiếu tăng ca (chỉ
   * HR/admin) — "Từ chối" dùng thẳng approvalService.rejectRegistrationRequest,
   * không có ở đây. Trả về bản ghi OvertimeReconciliationRow-compatible (đủ
   * field để cập nhật lại dòng trong bảng không cần fetch lại cả trang).
   */
  async reconciliationAction(
    eventId: number,
    payload:
      | { action: 'accept'; note?: string }
      | { action: 'auto_fix'; note?: string }
      | { action: 'manual_fix'; check_out: string; check_in?: string; note?: string }
  ): Promise<{ start_time: string | null; end_time: string | null; hours: number | null; reconciliation: OvertimeReconciliationNote | null }> {
    const response = await managementApi.post(
      `/api-hrm/registration-requests/${eventId}/reconciliation-action/`,
      payload
    );
    return response.data;
  },
};

export default overtimeReconciliationService;
