/**
 * Kiểu dữ liệu các section chấm công của GET /api-hrm/system-rules/ — khớp backend/hrm/system_rules/attendance.py.
 * Mỗi section là 1 object con (vd { tên_section: { ... } }); thêm field khi backend thêm.
 */

/** 1 bậc phạt đi muộn / về sớm (PenaltyTierConfig). */
export interface PenaltyTierRule {
  /** Phút tối đa của bậc; null = bậc cuối (> bậc trước). */
  max_minutes: number | null;
  fine_regular: number;
  fine_manager: number;
  /** > 0: bậc này trừ công thay vì phạt tiền. */
  work_deduction: number;
}

export interface AttendanceRules {
  /** Quy định chấm công / nghỉ chung (hrm/attendance_engine.PolicyLoader, hrm/penalty_config.py). */
  attendance?: {
    /** Chính sách phạt đang áp dụng hôm nay. */
    penalty_policy: {
      version_code: string;
      /** 'YYYY-MM-DD' — null khi chưa có phiên bản chính sách (đang dùng mặc định của engine). */
      effective_from: string | null;
      tiers: PenaltyTierRule[];
      multiplier_threshold: number;
      multiplier_value: number;
      incomplete_no_expl_deduction: number;
      incomplete_approved_deduction: number;
      incomplete_over_quota_deduction: number;
    };
    /** Phạt nghỉ không báo / không được duyệt (VNĐ); null = chưa áp dụng. */
    unreported_absence_penalty: number | null;
    /** Giờ vào–ra của đơn Quên chấm công >= ngưỡng này -> 1.0 công, còn lại 0.5 (shift_config_utils). */
    full_day_hours_threshold: number;
  };
  /** Đơn tăng ca (hrm/overtime_reconciliation.py). */
  overtime?: {
    /** Thời lượng tối thiểu (phút) để đơn được tính. */
    min_minutes: number;
    /** Các registration_type áp sàn min_minutes (vd ['OVERTIME']). Loại khác không có sàn. */
    min_applies_to: string[];
  };
}
