/**
 * Kiểu dữ liệu các section chấm công của GET /api-hrm/system-rules/ — khớp backend/hrm/system_rules/attendance.py.
 * Mỗi section là 1 object con (vd { tên_section: { ... } }); thêm field khi backend thêm.
 */
export interface AttendanceRules {
  /** Đơn tăng ca (hrm/overtime_reconciliation.py). */
  overtime?: {
    /** Thời lượng tối thiểu (phút) để đơn được tính. */
    min_minutes: number;
    /** Các registration_type áp sàn min_minutes (vd ['OVERTIME']). Loại khác không có sàn. */
    min_applies_to: string[];
  };
}
