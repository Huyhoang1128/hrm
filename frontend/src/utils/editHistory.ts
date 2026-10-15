// Hiển thị "Lịch sử chỉnh sửa đơn" (EmployeeEvent.data.edit_history do
// hrm/models.py::record_request_edit ghi) — dùng chung cho MỌI màn có chi tiết
// đơn: trang Phê duyệt, "Đơn của tôi", và modal chi tiết ngày ở Chấm công/Chốt
// công. Trước đây mỗi màn tự viết lại một kiểu nên nhãn/định dạng lệch nhau.

/** Nhãn tiếng Việt cho các field mà record_request_edit ghi lại. */
export const EDIT_FIELD_LABELS: Record<string, string> = {
  start_time: 'Giờ bắt đầu',
  end_time: 'Giờ kết thúc',
  hours: 'Số giờ',
  reason: 'Lý do',
  sessions: 'Buổi',
  attendance_date: 'Ngày',
};

// Thứ tự hiển thị các dòng thay đổi — theo thứ tự người đọc mong đợi (bắt đầu
// trước kết thúc), KHÔNG theo thứ tự key trong JSON của backend (HCNS báo
// 2026-09-23: "phải show giờ bắt đầu trc giờ kết thúc chứ").
const EDIT_FIELD_ORDER = ['start_time', 'end_time', 'hours', 'sessions', 'attendance_date', 'reason'];

/** Giá trị trong log có thể là "20:30:00", "20:30", số giờ, hoặc rỗng. */
export const formatEditValue = (v: any): string => {
  if (v === null || v === undefined || v === '') return '(trống)';
  const str = String(v);
  const m = str.match(/^(\d{2}):(\d{2})(:\d{2})?$/);
  return m ? `${m[1]}:${m[2]}` : str;
};

/**
 * Sắp xếp + BỎ các dòng "đổi" mà giá trị trước/sau thực ra giống hệt nhau.
 *
 * Backend đã được sửa (2026-09-23) để không ghi thêm loại rác này nữa — nó
 * sinh ra do so chuỗi "18:00" với "18:00:00" — nhưng các bản ghi CŨ trong DB
 * vẫn còn, và người dùng vẫn thấy dòng "Giờ bắt đầu 18:00 → 18:00" vô nghĩa.
 * Lọc tại chỗ hiển thị để làm sạch cả dữ liệu cũ lẫn mới.
 */
export const sortEditChanges = (changes: Record<string, any>): [string, any][] =>
  Object.entries(changes || {})
    .filter(([, val]: [string, any]) => formatEditValue(val?.old) !== formatEditValue(val?.new))
    .sort(([a], [b]) => {
      const ia = EDIT_FIELD_ORDER.indexOf(a);
      const ib = EDIT_FIELD_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

/** Số thay đổi THỰC SỰ của 1 bản ghi edit_history (đã bỏ dòng rác như trên). */
export const countRealEditChanges = (changes: Record<string, any>): number =>
  sortEditChanges(changes).length;
