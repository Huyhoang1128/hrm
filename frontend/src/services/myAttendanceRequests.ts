import { attendanceService } from './attendance.service';

/**
 * Gom 4 nhóm "đơn chấm công" (nằm ở model EmployeeEvent, tách hẳn khỏi
 * GenericRequest của trang Yêu cầu & Đơn từ) về một shape chung để trang
 * MyRequests hiển thị chung bảng với đơn GenericRequest:
 *
 *   - explanation : /api-hrm/attendance-explanations/  (giải trình đi muộn/về sớm/quên chấm công...)
 *   - leave       : /api-hrm/monthly-leave-requests/   (nghỉ phép tháng — BE loại trừ hẳn khỏi endpoint trên)
 *   - registration: /api-hrm/registration-requests/    (tăng ca, làm thêm giờ, trực tối, Live, vào/ra trực, nghỉ không phép, đổi ca)
 *   - online_work : /api-hrm/online-work-requests/     (làm việc online)
 *
 * Cố tình KHÔNG dùng endpoint calendar-view như trang Chấm công: calendar-view
 * chỉ trả dữ liệu theo đúng 1 tháng đang xem, trong khi ở đây cần xem được cả
 * năm (bộ lọc "Tất cả tháng").
 */

export type AttendanceRequestKind =
  | 'explanation'
  | 'leave'
  | 'registration'
  | 'online_work';

/** Trạng thái thật của EmployeeEvent — ít bước hơn GenericRequest (không có 2 mức chờ duyệt). */
export type AttendanceRequestStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface AttendanceRequestRow {
  /** Phân biệt với đơn GenericRequest khi trộn chung 1 bảng. */
  _source: 'attendance';
  _kind: AttendanceRequestKind;
  /** Bản ghi gốc từ API — giữ lại để dialog chi tiết hiển thị đầy đủ. */
  _raw: any;

  id: number;
  request_code: string | null;
  /** Nhãn loại đơn tiếng Việt, vd "Đơn đăng ký tăng ca". */
  type_label: string;
  /** Lý do/nội dung đơn (đã bỏ tiền tố trùng với tên loại đơn). */
  reason: string;
  /** Ngày áp dụng của đơn (ngày công, không phải ngày tạo đơn). */
  applied_date: string | null;
  status: AttendanceRequestStatus;
  created_at: string;
  /** Chủ đơn tự Sửa/Huỷ được (BE tính sẵn; fallback khi field chưa có). */
  can_self_cancel: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  LATE: 'Đơn giải trình đi muộn',
  EARLY_LEAVE: 'Đơn giải trình về sớm',
  INCOMPLETE_ATTENDANCE: 'Đơn giải trình quên chấm công',
  BUSINESS_TRIP: 'Đơn giải trình công tác',
  FIRST_DAY: 'Đơn giải trình ngày đầu',
  OVERTIME: 'Đơn đăng ký tăng ca',
  EXTRA_HOURS: 'Đơn đăng ký làm thêm giờ',
  NIGHT_SHIFT: 'Đơn đăng ký trực tối',
  LIVE: 'Đơn đăng ký Live',
  LEAVE: 'Đơn nghỉ phép tháng',
  ONLINE_WORK: 'Đơn làm việc online',
  OFF_DUTY: 'Đơn đăng ký Vào/Ra trực',
  UNAUTHORIZED_ABSENCE: 'Đơn nghỉ không phép',
  SHIFT_CHANGE: 'Đơn đổi ca',
};

/**
 * Backend lưu lý do kèm tiền tố tên loại đơn ("Tăng ca: sửa lỗi web") hoặc
 * tiền tố vi phạm trong ngoặc vuông ("[Đi muộn: 5 phút] kẹt xe") — bóc ra để
 * cột Nội dung không lặp lại nhãn đã hiển thị ở cột Loại đơn.
 */
const stripReasonPrefix = (raw: string, typeLabel: string): string => {
  let text = String(raw || '').trim();

  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close !== -1) {
      text = text.substring(close + 1).replace(/^[:\-\s]+/, '').trim();
    }
  }

  const prefixes = [...Object.values(TYPE_LABELS), typeLabel]
    .filter(Boolean)
    // Bỏ tiền tố dài trước để "Đơn giải trình đi muộn" không bị
    // "Đơn giải trình" cắt mất phần đuôi.
    .sort((a, b) => b.length - a.length);

  for (const p of prefixes) {
    if (text.toLowerCase().startsWith(p.toLowerCase())) {
      return text.substring(p.length).replace(/^[:\-\s]+/, '').trim();
    }
  }
  return text;
};

const normalizeStatus = (raw: any): AttendanceRequestStatus => {
  const s = String(raw || 'PENDING').toUpperCase();
  return (['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(s)
    ? s
    : 'PENDING') as AttendanceRequestStatus;
};

/**
 * can_self_cancel do BE tính (còn chờ duyệt + chưa qua bước quản lý trực tiếp
 * duyệt, HOẶC đã duyệt nhưng HCNS đã "Mở khoá đặc biệt" — xem
 * hrm/deadline_exception_models.py::can_owner_self_cancel). Fallback về điều
 * kiện xấp xỉ nếu serializer của endpoint list chưa trả field này.
 */
const resolveSelfCancel = (item: any): boolean =>
  Boolean(
    item?.can_self_cancel ??
      (normalizeStatus(item?.status) === 'PENDING' && !item?.direct_manager_approved)
  );

const toRow = (
  item: any,
  kind: AttendanceRequestKind,
  typeKey: string
): AttendanceRequestRow => {
  const type_label = TYPE_LABELS[typeKey] || typeKey || 'Đơn chấm công';
  return {
    _source: 'attendance',
    _kind: kind,
    _raw: item,
    id: Number(item?.id),
    request_code: item?.request_code || null,
    type_label,
    reason: stripReasonPrefix(item?.reason || item?.work_plan || '', type_label),
    applied_date:
      item?.attendance_date || item?.work_date || item?.start_date || null,
    status: normalizeStatus(item?.status),
    created_at: item?.created_at || item?.attendance_date || item?.work_date || '',
    can_self_cancel: resolveSelfCancel(item),
  };
};

/** Lấy tối đa 500 đơn/nhóm — đủ cho 1 nhân viên trong 1 năm. */
const PAGE_SIZE = 500;

/**
 * Tải toàn bộ đơn chấm công của 1 nhân viên. Lỗi của từng nhóm được nuốt
 * riêng (trả mảng rỗng) để 1 endpoint hỏng không làm trắng cả bảng.
 */
export const fetchMyAttendanceRequests = async (
  employeeId: number,
  params?: { month?: number; year?: number }
): Promise<AttendanceRequestRow[]> => {
  const base = {
    employee_id: employeeId,
    page_size: PAGE_SIZE,
    ordering: '-created_at',
    ...(params?.month ? { month: params.month, year: params.year } : {}),
  };

  const safe = async (fn: () => Promise<any>): Promise<any[]> => {
    try {
      const res = await fn();
      return res?.results || (Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Lỗi tải đơn chấm công:', e);
      return [];
    }
  };

  const [explanations, leaves, registrations, onlineWorks] = await Promise.all([
    safe(() => attendanceService.getAttendanceExplanations(base)),
    safe(() => attendanceService.getMonthlyLeaveRequests(base)),
    safe(() => attendanceService.getRegistrationRequests(base)),
    safe(() => attendanceService.getOnlineWorkRequests(base)),
  ]);

  const rows = [
    ...explanations.map((e) => toRow(e, 'explanation', e?.explanation_type)),
    ...leaves.map((l) => toRow(l, 'leave', 'LEAVE')),
    ...registrations.map((r) => toRow(r, 'registration', r?.registration_type)),
    ...onlineWorks.map((o) => toRow(o, 'online_work', 'ONLINE_WORK')),
  ];

  // Endpoint online-work-requests KHÔNG nhận month/year (chỉ work_date /
  // start_date / end_date) nên param ở trên bị bỏ qua → phải chặn lại ở đây,
  // nếu không lọc "Tháng 9" vẫn lọt đơn làm việc online của tháng khác.
  if (params?.month) {
    return rows.filter((r) => {
      if (!r.applied_date) return false;
      const d = new Date(r.applied_date);
      return (
        d.getMonth() + 1 === params.month &&
        (!params.year || d.getFullYear() === params.year)
      );
    });
  }

  return rows;
};

/**
 * Huỷ đơn (soft-delete có log, POST .../cancel/) — cơ chế DUY NHẤT để bỏ 1
 * đơn chấm công; backend đã bỏ hẳn xoá cứng.
 */
export const cancelAttendanceRequest = async (
  row: AttendanceRequestRow,
  reason?: string
): Promise<void> => {
  const r = reason?.trim() || undefined;
  if (row._kind === 'leave') {
    await attendanceService.cancelMonthlyLeaveRequest(row.id, r);
  } else if (row._kind === 'explanation') {
    await attendanceService.cancelAttendanceExplanation(row.id, r);
  } else if (row._kind === 'online_work') {
    await attendanceService.cancelOnlineWorkRequest(row.id, r);
  } else {
    await attendanceService.cancelRegistrationRequest(row.id, r);
  }
};

/**
 * Đơn này có KHUNG GIỜ sửa được không (tăng ca / làm thêm giờ / trực tối /
 * Live / ra trực — đều nằm ở endpoint registration-requests và đều lưu giờ ở
 * event.check_in/check_out). Đơn nghỉ phép, giải trình, làm online, nghỉ
 * không phép thì không có khung giờ để sửa.
 */
export const hasEditableTimeRange = (row: AttendanceRequestRow): boolean => {
  if (row._kind !== 'registration') return false;
  const type = String(row._raw?.registration_type || '').toUpperCase();
  return ['OVERTIME', 'EXTRA_HOURS', 'NIGHT_SHIFT', 'LIVE', 'LIVESTREAM', 'OFF_DUTY'].includes(type);
};

/**
 * Sửa đơn chấm công của CHÍNH MÌNH khi còn tự sửa được (xem can_self_cancel).
 *
 * Trước 2026-09-23 hàm này hard-code chỉ gửi `{ reason }` cho MỌI loại đơn,
 * nên trang "Yêu cầu & Đơn từ" không sửa được GIỜ đơn tăng ca dù endpoint
 * registration-requests đã nhận start_time/end_time từ lâu (HCNS báo). Nay
 * nhận thêm giờ; CỐ Ý không gửi `hours` — backend tự tính lại theo giờ mới
 * (compute_overtime_hours), gửi số giờ cũ lên sẽ ghi đè sai.
 */
export const updateAttendanceRequestReason = async (
  row: AttendanceRequestRow,
  reason: string,
  times?: { start_time?: string; end_time?: string }
): Promise<void> => {
  if (row._kind === 'leave') {
    await attendanceService.updateMonthlyLeaveRequest(row.id, { reason });
  } else if (row._kind === 'explanation') {
    await attendanceService.updateAttendanceExplanation(row.id, { reason });
  } else if (row._kind === 'online_work') {
    await attendanceService.updateOnlineWorkRequest(row.id, { reason });
  } else {
    await attendanceService.updateRegistrationRequest(row.id, {
      reason,
      ...(times?.start_time ? { start_time: times.start_time } : {}),
      ...(times?.end_time ? { end_time: times.end_time } : {}),
    });
  }
};
