// Buổi (sáng / chiều / cả ngày) của các đơn trong ngày — dùng khi gửi đơn mới để
// chỉ ghi đè / chặn những đơn đụng buổi. Trước đây gửi Nghỉ phép tháng là huỷ
// sạch mọi đơn chờ duyệt trong ngày, kể cả đơn ở buổi khác (NV80033 10/10/2026:
// gửi nghỉ phép chiều làm mất đơn nghỉ không phép sáng).

export type DayPeriod = 'MORNING' | 'AFTERNOON' | 'FULL_DAY';

/** Buổi của 1 đơn đã có trong ngày — null nếu không xác định được (đơn tăng ca,
 * giải trình đi muộn/về sớm, đơn nửa ngày cũ chưa lưu half_day_period...). */
export const requestPeriod = (r: any): DayPeriod | null => {
  const d = r?.data || r || {};
  const type = String(r?.event_type || '').toLowerCase();
  const half = String(d.half_day_period || '').toUpperCase();
  if (half === 'MORNING' || half === 'AFTERNOON') return half;
  const reason = String(d.reason || '').toLowerCase();
  if (type === 'unauthorized_absence' || (type === 'explanation' && d.explanation_type === 'LEAVE')) {
    if (d.expected_status !== 'HALF_DAY') return 'FULL_DAY';
    // Đơn nghỉ phép cũ chưa có half_day_period — đoán theo lý do như phần hiển thị.
    if (type === 'explanation') {
      if (reason.includes('sáng')) return 'MORNING';
      if (reason.includes('chiều')) return 'AFTERNOON';
    }
    return null;
  }
  if (type === 'online_work') {
    // Đơn online cũ chưa có half_day_period: lý do bắt đầu bằng nhãn ca đã chọn.
    const label = reason.match(/online (sáng|chiều|cả ngày)/)?.[1];
    if (label === 'cả ngày') return 'FULL_DAY';
    if (label === 'sáng') return 'MORNING';
    if (label === 'chiều') return 'AFTERNOON';
  }
  return null;
};

/** Ca chọn trên form ('morning' | 'afternoon' | 'full_day') -> DayPeriod. */
export const shiftToPeriod = (s: string | null | undefined): DayPeriod | null =>
  s === 'morning' ? 'MORNING' : s === 'afternoon' ? 'AFTERNOON' : s === 'full_day' ? 'FULL_DAY' : null;

/** Hai đơn có đụng nhau về buổi không. Không xác định được buổi của 1 bên thì
 * coi như đụng (giữ cách xử lý cũ); chỉ khi chắc chắn 1 đơn sáng, 1 đơn chiều
 * mới coi là không đụng — vd nghỉ không phép sáng + nghỉ phép chiều cùng ngày. */
export const periodsOverlap = (a: DayPeriod | null, b: DayPeriod | null) =>
  !a || !b || a === 'FULL_DAY' || b === 'FULL_DAY' || a === b;
