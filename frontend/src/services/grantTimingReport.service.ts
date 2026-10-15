import { managementApi } from '@/utils/api';

/** Nguyên nhân vượt mốc 3 giờ. Nhiều nguyên nhân có thể cùng xảy ra trên 1 dòng. */
export type GrantTimingCause =
  | 'HCNS_UNLOCK_LATE'
  | 'CREATED_LATE'
  | 'APPROVED_LATE'
  | 'NO_REQUEST_YET';

export interface GrantTimingRow {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  manager_name: string | null;
  request_type: 'LEAVE' | 'UNAUTHORIZED_ABSENCE';
  request_type_label: string;
  event_date: string;
  /** Mốc 3 giờ: giờ vào ca của ngày làm việc kế tiếp sau ngày nghỉ, + 3 giờ */
  deadline_3h: string | null;
  /** true = không tra được giờ ca nên phải dùng mốc dự phòng 10h00 -> đừng kết luận chắc */
  deadline_is_fallback: boolean;
  next_working_day: string | null;
  /** Thời điểm HCNS bấm mở khoá */
  granted_at: string;
  granted_by_name: string | null;
  grant_note: string;
  request_code: string | null;
  created_at: string | null;
  approved_at: string | null;
  created_overdue_minutes: number | null;
  approved_overdue_minutes: number | null;
  hcns_unlock_overdue_minutes: number | null;
  causes: GrantTimingCause[];
  cause_labels: string[];
}

export interface GrantTimingReport {
  year: number;
  month: number;
  generated_at: string;
  cause_labels: Record<GrantTimingCause, string>;
  summary: {
    grants_checked: number;
    late_rows: number;
    on_time_rows: number;
    by_cause: Record<GrantTimingCause, number>;
    fallback_rows: number;
  };
  rows: GrantTimingRow[];
}

class GrantTimingReportService {
  /** Đơn đã được HCNS mở khoá nhưng vẫn tạo/duyệt sau mốc 3 giờ (chỉ HCNS/Admin). */
  async get(params: { year: number; month: number; department_id?: number }): Promise<GrantTimingReport> {
    const res = await managementApi.get('/api-hrm/grant-timing-report/', { params });
    return res.data;
  }
}

export const grantTimingReportService = new GrantTimingReportService();
export default grantTimingReportService;
