/** Nhãn trạng thái làm việc của nhân viên (employment_status). */
export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Đang làm việc',
  PROBATION: 'Thử việc',
  SUSPENDED: 'Tạm nghỉ',
  PAUSED: 'Tạm dừng',
  MATERNITY_LEAVE: 'Nghỉ thai sản',
  INACTIVE: 'Đã nghỉ',
};

export const employmentStatusLabel = (status?: string | null) =>
  (status && EMPLOYMENT_STATUS_LABELS[status]) || status || '';
