import { managementApi } from '@/utils/api';

/** 1 dòng vi phạm. `fault_side` quyết định lỗi thuộc về nhân viên hay quản lý. */
export interface ViolationRow {
  request_type: string | null;
  request_type_label: string;
  /** "Cả ngày" / "Nửa ngày · Sáng" / "Nửa ngày · Chiều" / "3 ngày · 12/10–14/10".
   *  null với dòng không gắn đơn nào (nghỉ không tạo đơn, bấm tạo bị chặn).
   *  Cần thiết vì hạn khác nhau hẳn theo kiểu nghỉ: cả ngày = 17h30 hôm trước,
   *  nửa ngày = giờ vào ca − 4h (cùng ngày) — lệch tới 15,5 tiếng. */
  leave_style_label?: string | null;
  /** PAID = nghỉ phép tháng (có lương), UNPAID = nghỉ không phép (không lương) */
  pay_category: 'PAID' | 'UNPAID' | null;
  event_date: string;
  request_code: string | null;
  status: string | null;
  deadline: string | null;
  /** Đơn tạo trước khi hệ thống lưu mốc hạn — không kết luận được quá hạn hay chưa */
  deadline_unknown: boolean;
  /** Hạn do báo cáo TÍNH LẠI vì đơn không có snapshot mốc hạn (66% đơn nghỉ
   *  rơi vào diện này) — tính theo đúng phiên bản luật lúc tạo đơn. */
  deadline_recomputed?: boolean;
  created_at: string | null;
  approved_at: string | null;
  /** HCNS đã "Mở khoá đặc biệt" cho ngày này */
  has_grant: boolean;
  /** Ngày thứ 7 — không phải phòng ban nào cũng làm, HCNS nên rà lại */
  is_saturday?: boolean;
  /** Trễ bao nhiêu phút so với hạn — phân biệt trễ 1 phút với trễ mấy ngày */
  overdue_minutes?: number | null;
  detail: string;
  /** Tiền phạt của dòng này (đồng). 0 khi chưa cấu hình ngày hiệu lực, khi
   *  ngày nghỉ trước ngày hiệu lực, hoặc khi chưa xác định được người chịu
   *  trách nhiệm. Chỉ để CẢNH BÁO — backend không ghi vào lương. */
  penalty_amount: number;
  /** VÌ SAO dòng này không ra tiền — backend quyết, frontend KHÔNG tự đoán.
   *  CHARGED | NOT_CONFIGURED | BEFORE_EFFECTIVE_DATE | WARN_ONLY |
   *  HAD_BLOCKED_ATTEMPT | MERGED_INTO_SAME_REQUEST | MERGED_CONSECUTIVE_DAYS |
   *  NO_RESPONSIBLE | HAD_GRANT */
  penalty_reason: string;
  penalty_reason_label: string;
  /** HCNS đã tự quyết áp/gỡ phạt cho dòng này */
  override?: { id: number; action: 'apply' | 'waive'; reason: string; by: string | null; at: string };
  /** Đã vào bấm tạo đơn nhưng bị hệ thống chặn -> chỉ cảnh báo, không phạt */
  had_blocked_attempt?: boolean;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  fault_side: 'EMPLOYEE' | 'MANAGER';
  violation_code:
    | 'NO_REQUEST' | 'LATE_CREATED' | 'HALF_DAY_ONLY'
    | 'NOT_APPROVED' | 'APPROVED_LATE';
  responsible_id: number | null;
  responsible_code: string;
  responsible_name: string;
  responsible_department: string | null;
}

export interface ViolationGroup {
  fault_side: 'EMPLOYEE' | 'MANAGER';
  employee_id: number | null;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  violation_count: number;
  /** Tổng tiền phạt của người này trong tháng */
  penalty_total: number;
  violations: ViolationRow[];
}

export interface ViolationReport {
  year: number;
  month: number;
  /** Phạm vi người xem đang thấy: toàn công ty / mình + team / chỉ mình */
  scope: 'ALL' | 'TEAM' | 'SELF';
  /** Chỉ HCNS/Admin mới được áp/gỡ phạt */
  can_manage_penalty: boolean;
  generated_at: string;
  summary: {
    /** Số vi phạm = số dòng trong bảng (nhóm "chờ HCNS" đã bỏ hẳn từ 08/10). */
    total_violations: number;
    /** Bằng total_violations — giữ lại cho tương thích, sẽ gỡ sau. */
    total_rows: number;
    employee_faults: number;
    manager_faults: number;
    by_type: Record<string, number>;
    saturday_rows: number;
    undetermined_requests: number;
    /** Đơn có "Mở khoá đặc biệt" -> hạn hết hiệu lực, đã bỏ qua không tính lỗi */
    granted_skipped: number;
    /** false = chưa cấu hình ngày hiệu lực -> mọi dòng đều 0 đồng */
    penalty_configured: boolean;
    penalty_effective_date: string | null;
    penalty_amount_per_violation: number;
    total_penalty: number;
    /** Số dòng thực sự ra tiền (ngày nghỉ >= ngày hiệu lực) */
    penalty_rows: number;
    /** Số dòng không ra tiền (cảnh báo / đã gộp / trước ngày hiệu lực) */
    warn_rows: number;
    /** Đang xem thử với mốc khác mốc thật -> phải ghi rõ trên màn và trong Excel */
    preview_mode: boolean;
    real_effective_date: string | null;
    penalty_codes: string[];
    warn_only_codes: string[];
    reason_labels: Record<string, string>;
    /** Chấm công nạp theo đợt Excel -> giữa tháng còn thiếu, mà "Nghỉ không
     *  tạo đơn" lại quét đúng bảng này. So với CHÍNH tháng trước. */
    attendance_coverage: {
      employees_with_data: number;
      attendance_rows: number;
      prev_month: string;
      prev_employees_with_data: number;
      prev_attendance_rows: number;
      percent_of_prev_month: number | null;
      looks_incomplete: boolean;
    };
  };
  violation_labels: Record<string, string>;
  groups: ViolationGroup[];
  rows: ViolationRow[];
}

export interface FinalizePreview {
  year: number;
  month: number;
  /** Số dòng ra tiền của tháng */
  charged_rows: number;
  /** Đã chốt từ lần trước -> lần này bỏ qua */
  already_issued: number;
  /** Sẽ tạo mới bấy nhiêu biên bản */
  to_create: number;
  people: number;
  total_amount: number;
}

export interface FinalizeResult {
  year: number;
  month: number;
  created: number;
  skipped_already_issued: number;
  people: number;
  total_amount: number;
}

class ViolationReportService {
  /** Đối soát vi phạm đơn nghỉ phép tháng / nghỉ không phép (chỉ HCNS/Admin). */
  async get(params: {
    year: number;
    month: number;
    department_id?: number;
    /** Xem thử với mốc hiệu lực khác — KHÔNG đổi mốc thật trong cấu hình */
    preview_effective_date?: string;
  }): Promise<ViolationReport> {
    const res = await managementApi.get('/api-hrm/violation-report/', { params });
    return res.data;
  }

  /** HCNS áp phạt / gỡ phạt / trả dòng về tính tự động. Luôn bắt buộc lý do. */
  async setPenaltyOverride(data: {
    employee_id: number;
    event_date: string;
    violation_code: string;
    action: 'apply' | 'waive' | 'clear';
    reason: string;
  }): Promise<any> {
    const res = await managementApi.post('/api-hrm/violation-report/penalty-override/', data);
    return res.data;
  }

  /** Xem trước việc chốt tháng — KHÔNG ghi gì, chỉ đếm sẽ tạo bao nhiêu. */
  async previewFinalize(params: { year: number; month: number }): Promise<FinalizePreview> {
    const res = await managementApi.get('/api-hrm/violation-report/finalize/', { params });
    return res.data;
  }

  /** Chốt tháng: tạo biên bản phạt (đã duyệt) cho mọi dòng ra tiền chưa chốt.
   *  Trừ tiền THẬT vào lương tháng đó. Bấm nhiều lần an toàn — chỉ thêm cái
   *  thiếu, backend chặn trùng bằng ràng buộc unique. */
  async finalizeMonth(data: { year: number; month: number }): Promise<FinalizeResult> {
    const res = await managementApi.post('/api-hrm/violation-report/finalize/', data);
    return res.data;
  }
}

export const violationReportService = new ViolationReportService();
export default violationReportService;
