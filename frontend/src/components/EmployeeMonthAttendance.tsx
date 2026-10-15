import React, { useState, useEffect } from 'react';
import AttendanceCalendar from './AttendanceCalendar';
import {
  XMarkIcon,
  PencilIcon,
  ClockIcon,
  InformationCircleIcon,
  CalendarIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  ExclamationTriangleIcon,
  ShieldExclamationIcon,
  BanknotesIcon,
  BoltIcon,
  BriefcaseIcon,
  MoonIcon,
  VideoCameraIcon,
  HeartIcon,
  ComputerDesktopIcon,
  ChatBubbleBottomCenterTextIcon,
  CalendarDaysIcon,
  CheckIcon,
  ArrowPathIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { attendanceService, AttendanceRecord } from '../services/attendance.service';
import { approvalService } from '../services/approval.service';
import shiftRegistrationService, { Ca2Request, caLabels } from '../services/shiftRegistration.service';
import { EDIT_FIELD_LABELS, sortEditChanges, formatEditValue, countRealEditChanges } from '../utils/editHistory';

// Khối "chọn 1 nhân viên xong thì xem KPI/lịch/chi tiết ngày" DÙNG CHUNG cho
// tab "Nhân viên" (AttendanceView.tsx) VÀ trang "Chốt công" (WorkFinalization.tsx)
// — theo yêu cầu HCNS 2026-09-21: "đang có tình trạng lặp lại khá nhiều giữa
// chấm công tab nhân viên và chốt công" -> gộp phần xem chi tiết vào 1 chỗ,
// mỗi trang vẫn giữ nguyên phần việc RIÊNG của nó (chọn nhân viên, khoá/chốt,
// bất thường, xuất Excel...) — chỉ khối bên trong này dùng chung, sửa 1 chỗ
// là cả 2 trang cùng được lợi.

// 4 loại đơn QLTT/HR/Admin được sửa trực tiếp ở modal này (yêu cầu HCNS
// 2026-09-21) — mỗi loại đi 1 endpoint khác nhau, xem submitEditModal().
type EditKind = 'LEAVE' | 'BUSINESS_TRIP' | 'UNAUTHORIZED_ABSENCE' | 'ONLINE_WORK';

function getEditKind(item: any): EditKind | null {
  const eventType = (item.event_type || '').toUpperCase();
  const explanationType = (item.data?.explanation_type || '').toUpperCase();
  const registrationType = (item.data?.registration_type || '').toUpperCase();
  if (eventType === 'EXPLANATION' && explanationType === 'LEAVE') return 'LEAVE';
  if (eventType === 'EXPLANATION' && explanationType === 'BUSINESS_TRIP') return 'BUSINESS_TRIP';
  if (eventType === 'ONLINE_WORK') return 'ONLINE_WORK';
  if (eventType === 'UNAUTHORIZED_ABSENCE' || registrationType === 'UNAUTHORIZED_ABSENCE') return 'UNAUTHORIZED_ABSENCE';
  return null;
}

const EDIT_KIND_LABEL: Record<EditKind, string> = {
  LEAVE: 'nghỉ phép tháng',
  BUSINESS_TRIP: 'công tác',
  UNAUTHORIZED_ABSENCE: 'nghỉ không phép',
  ONLINE_WORK: 'làm việc online',
};

// Nhãn hiển thị cho MỌI loại đơn (không chỉ 4 loại sửa được ở trên) — mirror
// getRequestTypeLabel() của AttendanceCalendar.tsx (không export nên viết lại).
function getRequestTypeLabel(item: any): string {
  const eventType = (item.event_type || '').toUpperCase();
  const data = item.data || {};
  if (eventType === 'EXPLANATION') {
    switch ((data.explanation_type || '').toUpperCase()) {
      case 'LATE': return 'Đi muộn';
      case 'EARLY_LEAVE': return 'Về sớm';
      case 'LATE_EARLY': return 'Đi muộn/Về sớm';
      case 'INCOMPLETE_ATTENDANCE': return 'Quên chấm công';
      case 'BUSINESS_TRIP': return 'Công tác';
      case 'FIRST_DAY': return 'Ngày đầu đi làm';
      case 'LEAVE': return 'Nghỉ phép tháng';
      default: return 'Giải trình';
    }
  }
  const effectiveType = (data.registration_type || eventType || '').toUpperCase();
  switch (effectiveType) {
    case 'OVERTIME': return 'Tăng ca';
    case 'EXTRA_HOURS': return 'Làm thêm giờ';
    case 'NIGHT_SHIFT': return 'Trực tối';
    case 'ONLINE_WORK': return 'Làm việc online';
    case 'LIVE':
    case 'LIVESTREAM': return 'Livestream';
    case 'OFF_DUTY': return 'Ra trực';
    case 'UNAUTHORIZED_ABSENCE': return 'Nghỉ không phép';
    case 'SHIFT_CHANGE': return 'Đổi ca';
    default: return effectiveType || 'Khác';
  }
}

// Mỗi "họ" đơn đi 1 bộ endpoint riêng (duyệt/từ chối/huỷ/sửa) — xem
// approval.service.ts. Gom về 1 chỗ để 5 nút thao tác bên dưới không phải
// lặp lại chuỗi if/else như Approvals.tsx đang làm.
type RequestFamily = 'LEAVE' | 'EXPLANATION' | 'ONLINE_WORK' | 'REGISTRATION';

function getRequestFamily(item: any): RequestFamily {
  const eventType = (item.event_type || '').toUpperCase();
  const explanationType = (item.data?.explanation_type || '').toUpperCase();
  if (eventType === 'EXPLANATION') return explanationType === 'LEAVE' ? 'LEAVE' : 'EXPLANATION';
  if (eventType === 'ONLINE_WORK') return 'ONLINE_WORK';
  return 'REGISTRATION';
}

const approveByFamily = (item: any, note: string) => {
  switch (getRequestFamily(item)) {
    case 'LEAVE': return approvalService.approveMonthlyLeaveRequest(item.id, note);
    case 'EXPLANATION': return approvalService.approveAttendanceExplanation(item.id, note);
    case 'ONLINE_WORK': return approvalService.approveOnlineWorkRequest(item.id, note);
    default: return approvalService.approveRegistrationRequest(item.id, note);
  }
};

const rejectByFamily = (item: any, note: string) => {
  switch (getRequestFamily(item)) {
    case 'LEAVE': return approvalService.rejectMonthlyLeaveRequest(item.id, note);
    case 'EXPLANATION': return approvalService.rejectAttendanceExplanation(item.id, note);
    case 'ONLINE_WORK': return approvalService.rejectOnlineWorkRequest(item.id, note);
    default: return approvalService.rejectRegistrationRequest(item.id, note);
  }
};

const cancelByFamily = (item: any, reason: string) => {
  switch (getRequestFamily(item)) {
    case 'LEAVE': return attendanceService.cancelMonthlyLeaveRequest(item.id, reason);
    case 'EXPLANATION': return attendanceService.cancelAttendanceExplanation(item.id, reason);
    case 'ONLINE_WORK': return attendanceService.cancelOnlineWorkRequest(item.id, reason);
    default: return attendanceService.cancelRegistrationRequest(item.id, reason);
  }
};

/** Rút thông điệp lỗi dễ đọc nhất từ response của DRF. */
function extractApiError(error: any, fallback: string): string {
  const data = error?.response?.data;
  if (!data) return error?.message || fallback;
  if (typeof data === 'string') return data;
  return data.error || data.detail || data.message || fallback;
}

/** "2026-09-23T16:41:46+07:00" -> "16:41 23/09/2026". */
function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "20:30:00" | "20:30" -> "20:30"; rỗng -> null. */
function formatTimeOnly(value?: string | null): string | null {
  if (!value) return null;
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(value);
}

function getRequestStatusBadge(status: string): { label: string; className: string } {
  switch ((status || '').toUpperCase()) {
    case 'APPROVED': return { label: 'Đã duyệt', className: 'bg-emerald-100 text-emerald-700' };
    case 'PENDING': return { label: 'Chờ duyệt', className: 'bg-amber-100 text-amber-700' };
    case 'REJECTED': return { label: 'Từ chối', className: 'bg-red-100 text-red-700' };
    case 'CANCELLED': return { label: 'Đã huỷ', className: 'bg-gray-200 text-gray-600' };
    default: return { label: status || '—', className: 'bg-gray-100 text-gray-600' };
  }
}

const toYMD = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// explanation_approval/request_approval là bản ghi LƯỢT DUYỆT của 1 đơn khác, không
// phải đơn — trạng thái duyệt đã hiện trên chính đơn gốc. Để lọt vào danh sách thì
// nó hiện như 1 đơn riêng kèm nút Từ chối/Huỷ thao tác nhầm lên bản ghi duyệt.
const APPROVAL_RECORD_TYPES = ['explanation_approval', 'request_approval'];
const onlyRealRequests = (registrations: any[] | undefined): any[] =>
  (registrations || []).filter((r: any) => !APPROVAL_RECORD_TYPES.includes(r?.event_type));

interface EmployeeMonthAttendanceProps {
  employeeId: number;
  year: number;
  month: number; // 1-indexed
  onMonthChange?: (year: number, month: number) => void;
  // Chốt công đã có sẵn khối số liệu snapshot riêng ("Kết quả chốt công") nên
  // không cần thêm 1 bộ KPI live nữa — mặc định true cho tab Nhân viên.
  showKpiCards?: boolean;
}

const EmployeeMonthAttendance: React.FC<EmployeeMonthAttendanceProps> = ({
  employeeId,
  year,
  month,
  onMonthChange,
  showKpiCards = true,
}) => {
  const { user } = useAuth();
  // Sửa thẳng giờ check-in/check-out thô (khác "Sửa đơn" — đây là sửa bản
  // ghi chấm công gốc) — mirror đúng điều kiện canEditAttendance cũ của
  // AttendanceCalendar.tsx (internal dialog), giờ chuyển hẳn vào đây vì
  // modal chi tiết ngày dùng riêng của component này đã thay thế internal
  // dialog đó (onDateClick tắt nó đi) — không mất tính năng khi gộp.
  const canEditAttendance = !!(
    (user?.role || '').toUpperCase() === 'ADMIN' ||
    (user as any)?.is_supperuser ||
    (user as any)?.is_superuser ||
    (user as any)?.is_super_admin ||
    (user as any)?.employee_permission?.can_edit_attendance ||
    (user as any)?.can_edit_attendance
  );

  const [currentDate, setCurrentDate] = useState<Date>(() => new Date(year, month - 1, 1));
  const [calendarSummary, setCalendarSummary] = useState<any>(null);
  const [attendanceStats, setAttendanceStats] = useState<any>(null);

  // Date detail modal
  const [dateDetailModalOpen, setDateDetailModalOpen] = useState(false);
  const [dateDetailLoading, setDateDetailLoading] = useState(false);
  const [dateDetailRecords, setDateDetailRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDateDetail, setSelectedDateDetail] = useState<Date | null>(null);
  const [showEditAttendanceForm, setShowEditAttendanceForm] = useState(false);
  const [editAttendanceCheckIn, setEditAttendanceCheckIn] = useState('');
  const [editAttendanceCheckOut, setEditAttendanceCheckOut] = useState('');
  const [editAttendanceSaving, setEditAttendanceSaving] = useState(false);
  const [editAttendanceError, setEditAttendanceError] = useState<string | null>(null);
  // TẤT CẢ đơn từ trong ngày (mọi loại, mọi trạng thái — không chỉ đơn đã
  // duyệt) — lấy thẳng từ dayData.registrations do AttendanceCalendar đã
  // tính sẵn, theo yêu cầu HCNS 2026-09-21 "màn đó hiển thị tất cả các loại
  // đơn". Cho QLTT/HR/Admin sửa trực tiếp Nghỉ phép/Nghỉ không phép/Làm
  // online/Công tác ngay tại đây (backend đã cho phép sửa dù đã duyệt).
  const [allDayRequests, setAllDayRequests] = useState<any[]>([]);
  // `item` là cả bản ghi đơn (cần để biết họ đơn + nhãn hiển thị). Trước đây
  // chỉ lưu `kind` thuộc 4 loại cố định nên đơn TĂNG CA không có nút "Sửa" nào
  // — không sửa được cả lý do (HCNS báo 2026-09-23).
  const [editModal, setEditModal] = useState<{ item: any; id: number; reason: string; date: string; originalStatus: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Báo khi đơn vừa sửa bị chuyển về Chờ duyệt (QLTT sửa đơn đã duyệt ->
  // backend tự yêu cầu HCNS duyệt lại) — không thì đơn "biến mất" khỏi Đã
  // duyệt sẽ gây khó hiểu.
  const [editResultMessage, setEditResultMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  // Duyệt / Từ chối / Huỷ đơn ngay trong modal chi tiết ngày — yêu cầu HCNS
  // 2026-09-23: "cho QLTT có quyền duyệt, từ chối, sửa giờ trong đó too
  // (Nhân viên thì tự sửa/huỷ được đơn của bản thân nếu chưa được duyệt)".
  // Nút nào hiện là do BACKEND quyết (cờ can_approve/can_reject/can_cancel/
  // can_edit/can_edit_hours trả kèm mỗi đơn — xem hrm/request_permissions.py),
  // KHÔNG tự suy luận lại luật duyệt ở đây.
  const [actionModal, setActionModal] = useState<
    { kind: 'APPROVE' | 'REJECT' | 'CANCEL'; item: any; note: string } | null
  >(null);
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sửa giờ đơn tăng ca Tại viện/VP (hạn 10h sáng hôm sau, Chủ nhật tới hết ngày)
  const [hoursModal, setHoursModal] = useState<
    { item: any; start: string; end: string } | null
  >(null);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);

  // Mở/đóng khối "Lịch sử chỉnh sửa" của từng đơn (theo id đơn)
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());

  // Bump để ép AttendanceCalendar tải lại sau khi duyệt/sửa/huỷ 1 đơn — nếu
  // không, lưới lịch phía sau vẫn hiện badge/công/phạt theo dữ liệu cũ.
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // Đăng ký Ca 2 hộ nhân viên cho ngày đang xem trong modal — null = chưa
  // tải xong hoặc nhân viên này không thuộc phạm vi (in_scope=false).
  const [ca2Status, setCa2Status] = useState<({ in_scope: boolean } & Partial<Ca2Request>) | null>(null);
  const [ca2Loading, setCa2Loading] = useState(false);
  const [ca2Busy, setCa2Busy] = useState(false);
  const [ca2Message, setCa2Message] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Đồng bộ lại currentDate khi PARENT đổi employeeId/year/month từ bên
  // ngoài (vd Chốt công có bộ chọn Năm/Tháng riêng) — bản thân
  // AttendanceCalendar chỉ đọc year/month lúc mount nên còn cần key riêng
  // ở JSX bên dưới để ép remount đúng lúc.
  useEffect(() => {
    setCurrentDate(new Date(year, month - 1, 1));
  }, [employeeId, year, month]);

  // Tải hạn mức (nghỉ phép/online/giải trình còn lại) khi đổi nhân viên/tháng.
  // Số liệu KPI chính (phạt, đủ công, đi muộn...) lấy từ AttendanceCalendar
  // (xem handleCalendarDataLoaded) để khỏi gọi API 2 lần. Bỏ qua hẳn nếu
  // showKpiCards=false (Chốt công không cần, đỡ tốn API).
  useEffect(() => {
    if (!showKpiCards || !employeeId) {
      setAttendanceStats(null);
      setCalendarSummary(null);
      return;
    }
    let cancelled = false;
    const fetchQuotaStats = async () => {
      try {
        const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const [stats, explanationStats] = await Promise.all([
          attendanceService.getAttendanceStats({
            employee_id: employeeId,
            start_date: fmt(firstDay),
            end_date: fmt(lastDay),
          }),
          attendanceService.getAttendanceExplanationStats({
            employee_id: employeeId,
            month: currentDate.getMonth() + 1,
            year: currentDate.getFullYear(),
          }).catch(() => null),
        ]);

        if (cancelled) return;
        setAttendanceStats({
          ...stats.statistics,
          ...(explanationStats?.statistics || {}),
        });
      } catch (error) {
        console.error('Error fetching quota stats:', error);
        if (!cancelled) setAttendanceStats(null);
      }
    };
    fetchQuotaStats();
    return () => { cancelled = true; };
  }, [employeeId, currentDate, showKpiCards]);

  const handleCalendarDataLoaded = (data: { calendar: any[]; summary: any }) => {
    if (!showKpiCards) return;
    const { calendar: calendarArray, summary } = data;
    if (!summary) {
      setCalendarSummary(null);
      return;
    }
    const totalLate = calendarArray.reduce((acc: number, d: any) => acc + (d.engine_context?.late_minutes || 0), 0);
    const totalEarly = calendarArray.reduce((acc: number, d: any) => acc + (d.engine_context?.early_leave_minutes || 0), 0);
    const totalPenalty = calendarArray.reduce((acc: number, d: any) => acc + (d.engine_context?.penalty_amount || d.summary?.penalty_amount || 0), 0);

    setCalendarSummary({
      ...summary,
      total_late_minutes: totalLate,
      total_early_leave_minutes: totalEarly,
      total_penalty: totalPenalty,
    });
  };

  const handleCalendarMonthChange = (date: Date) => {
    setCurrentDate(date);
    onMonthChange?.(date.getFullYear(), date.getMonth() + 1);
  };

  const handleDateClick = async (date: Date, dayData?: any) => {
    if (!employeeId) return;
    setSelectedDateDetail(date);
    setDateDetailModalOpen(true);
    setDateDetailLoading(true);
    setCa2Status(null);
    setCa2Message(null);
    setEditResultMessage(null);
    setShowEditAttendanceForm(false);
    setEditAttendanceError(null);

    const dateStr = toYMD(date);

    try {
      const response = await attendanceService.getAttendanceRecords({
        employee_id: employeeId,
        start_date: dateStr,
        end_date: dateStr,
      });
      const records = response.results || [];
      setDateDetailRecords(records);
      setAllDayRequests(onlyRealRequests(dayData?.registrations));
      // Chuẩn bị sẵn giờ vào/ra sớm nhất-muộn nhất trong ngày cho form "Sửa
      // check-in/check-out" (nếu người xem có quyền) — không cần đợi bấm nút.
      const checkIns = records.map((r) => r.check_in).filter(Boolean).sort();
      const checkOuts = records.map((r) => r.check_out).filter(Boolean).sort();
      setEditAttendanceCheckIn(checkIns[0] || '');
      setEditAttendanceCheckOut(checkOuts[checkOuts.length - 1] || '');
    } catch (error) {
      console.error('Error fetching date details:', error);
      setDateDetailRecords([]);
      setAllDayRequests([]);
    } finally {
      setDateDetailLoading(false);
    }

    // Tải trạng thái Ca 2 riêng — lỗi ở đây (vd nhân viên không thuộc phạm
    // vi) không được làm hỏng phần xem chấm công chính, nên tách hẳn
    // try/catch riêng và không set ca2Status khi lỗi (giữ null -> ẩn UI).
    setCa2Loading(true);
    try {
      const ca2 = await shiftRegistrationService.getCa2DayStatus({ employee_id: employeeId, date: dateStr });
      setCa2Status(ca2);
    } catch (error) {
      console.error('Error fetching Ca2 day status:', error);
      setCa2Status(null);
    } finally {
      setCa2Loading(false);
    }
  };

  const handleRegisterCa2InModal = async () => {
    if (!employeeId || !selectedDateDetail) return;
    const dateStr = toYMD(selectedDateDetail);

    setCa2Busy(true);
    setCa2Message(null);
    try {
      const updated = await shiftRegistrationService.registerCa2({ employee_id: employeeId, date: dateStr });
      setCa2Status({ in_scope: true, ...updated });
      const { reg } = caLabels(updated);
      setCa2Message({
        type: 'success',
        text: updated.status === 'APPROVED' ? `Đã đăng ký và duyệt ${reg} cho ngày này.` : `Đã gửi đăng ký ${reg}, chờ quản lý trực tiếp duyệt.`,
      });
    } catch (error: any) {
      const data = error?.response?.data;
      const msg = (typeof data === 'string' ? data : data?.error) || `Đăng ký ${caLabels(ca2Status).reg} thất bại.`;
      setCa2Message({ type: 'error', text: msg });
    } finally {
      setCa2Busy(false);
    }
  };

  // Huỷ đơn đăng ký ca đã duyệt/đang chờ (nhân viên không làm ca đó nữa) —
  // ngày đó quay về ca mặc định. Nút chỉ hiện khi backend trả can_cancel.
  const handleCancelCa2InModal = async () => {
    if (!ca2Status?.id) return;
    const { def, reg } = caLabels(ca2Status);
    if (!window.confirm(`Huỷ đơn ${reg} ngày này? Ngày này sẽ quay về ${def} (mặc định).`)) return;

    setCa2Busy(true);
    setCa2Message(null);
    try {
      const updated = await shiftRegistrationService.cancelCa2(ca2Status.id);
      setCa2Status({ in_scope: true, ...updated });
      setCa2Message({ type: 'success', text: `Đã huỷ ${reg}, ngày này tính ${def} (mặc định).` });
    } catch (error: any) {
      const data = error?.response?.data;
      const msg = (typeof data === 'string' ? data : data?.error) || `Huỷ ${reg} thất bại.`;
      setCa2Message({ type: 'error', text: msg });
    } finally {
      setCa2Busy(false);
    }
  };

  const cancelCa2Button = ca2Status?.can_cancel ? (
    <button
      onClick={handleCancelCa2InModal}
      disabled={ca2Busy}
      className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
    >
      {ca2Busy ? 'Đang xử lý...' : `Huỷ ${caLabels(ca2Status).reg}`}
    </button>
  ) : null;

  const closeDateDetailModal = () => {
    setDateDetailModalOpen(false);
    setDateDetailRecords([]);
    setSelectedDateDetail(null);
    setCa2Status(null);
    setCa2Message(null);
    setAllDayRequests([]);
    setEditModal(null);
    setEditError(null);
    setEditResultMessage(null);
    setShowEditAttendanceForm(false);
    setEditAttendanceError(null);
  };

  const submitEditAttendance = async () => {
    if (!employeeId || !selectedDateDetail) return;
    setEditAttendanceSaving(true);
    setEditAttendanceError(null);
    try {
      await attendanceService.editAttendance({
        employee_id: employeeId,
        date: toYMD(selectedDateDetail),
        check_in: editAttendanceCheckIn || null,
        check_out: editAttendanceCheckOut || null,
      });
      setShowEditAttendanceForm(false);
      // Tải lại chấm công của đúng ngày này để hiện ngay giá trị mới.
      const response = await attendanceService.getAttendanceRecords({
        employee_id: employeeId,
        start_date: toYMD(selectedDateDetail),
        end_date: toYMD(selectedDateDetail),
      });
      setDateDetailRecords(response.results || []);
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ||
        error?.response?.data?.message ||
        error?.message ||
        'Có lỗi xảy ra, vui lòng thử lại.';
      setEditAttendanceError(msg);
    } finally {
      setEditAttendanceSaving(false);
    }
  };

  const openEditModal = (item: any) => {
    setEditError(null);
    setEditResultMessage(null);
    setEditModal({
      item,
      id: item.id,
      reason: item.data?.reason || item.explanation || '',
      date: item.event_date || (selectedDateDetail ? toYMD(selectedDateDetail) : ''),
      originalStatus: item.data?.status || '',
    });
  };

  const submitEditModal = async () => {
    if (!editModal) return;
    setEditSaving(true);
    setEditError(null);
    try {
      // Chỉ 2 endpoint nhận đổi NGÀY (nghỉ phép tháng / công tác) — các loại
      // còn lại chỉ sửa lý do, gửi attendance_date lên sẽ bị bỏ qua hoặc lỗi.
      const editKind = getEditKind(editModal.item);
      const supportsDate = editKind === 'LEAVE' || editKind === 'BUSINESS_TRIP';
      const family = getRequestFamily(editModal.item);
      let updated: any;
      if (family === 'LEAVE') {
        updated = await attendanceService.updateMonthlyLeaveRequest(editModal.id, { reason: editModal.reason, attendance_date: editModal.date });
      } else if (family === 'EXPLANATION') {
        updated = supportsDate
          ? await attendanceService.updateAttendanceExplanation(editModal.id, { reason: editModal.reason, attendance_date: editModal.date })
          : await attendanceService.updateAttendanceExplanation(editModal.id, { reason: editModal.reason });
      } else if (family === 'ONLINE_WORK') {
        updated = await attendanceService.updateOnlineWorkRequest(editModal.id, { reason: editModal.reason });
      } else {
        updated = await attendanceService.updateRegistrationRequest(editModal.id, { reason: editModal.reason });
      }
      const newStatus = updated?.status;
      // QLTT sửa đơn đã duyệt -> BE tự chuyển về Chờ duyệt, cần HCNS duyệt
      // lại (yêu cầu HCNS 2026-09-21) — báo rõ để không hiểu nhầm đơn biến mất.
      const wasResetToPending = editModal.originalStatus === 'APPROVED' && newStatus === 'PENDING';
      // Cập nhật lại state cục bộ để hiện ngay, không cần tải lại cả lịch.
      setAllDayRequests((prev) => prev.map((it) => (
        it.id === editModal.id
          ? {
              ...it,
              data: { ...it.data, reason: editModal.reason, status: newStatus ?? it.data?.status, hr_approved: wasResetToPending ? false : it.data?.hr_approved },
              event_date: supportsDate ? editModal.date : it.event_date,
            }
          : it
      )));
      setEditModal(null);
      setEditResultMessage(
        wasResetToPending
          ? { type: 'info', text: 'Đã lưu — vì đơn đã duyệt trước đó nên chuyển về "Chờ duyệt", cần HCNS duyệt lại.' }
          : { type: 'success', text: 'Đã lưu thay đổi.' }
      );
    } catch (error: any) {
      const data = error?.response?.data;
      const msg = (typeof data === 'string' ? data : data?.error) || 'Sửa đơn thất bại.';
      setEditError(msg);
    } finally {
      setEditSaving(false);
    }
  };

  /**
   * Tải lại danh sách đơn của ĐÚNG ngày đang mở sau khi duyệt/từ chối/sửa/huỷ.
   * Không có API "đơn theo 1 ngày" nên gọi lại lịch tháng rồi lấy ra ngày đó —
   * đồng thời bump calendarRefreshKey để lưới lịch phía sau (badge, phạt, công)
   * cũng khớp với thay đổi vừa rồi thay vì hiện số cũ.
   */
  const reloadDayRequests = async () => {
    if (!employeeId || !selectedDateDetail) return;
    const dateStr = toYMD(selectedDateDetail);
    try {
      const responseData: any = await attendanceService.getCalendarView({
        year: selectedDateDetail.getFullYear(),
        month: selectedDateDetail.getMonth() + 1,
        employee_id: employeeId,
      });
      const days: any[] = responseData?.data?.calendar || responseData?.calendar_data || [];
      const day = days.find((d: any) => d.date === dateStr);
      setAllDayRequests(onlyRealRequests(day?.registrations));
    } catch (error) {
      console.error('Error reloading day requests:', error);
    }
    setCalendarRefreshKey((k: number) => k + 1);
  };

  const openActionModal = (kind: 'APPROVE' | 'REJECT' | 'CANCEL', item: any) => {
    setActionError(null);
    setEditResultMessage(null);
    setActionModal({ kind, item, note: '' });
  };

  const submitActionModal = async () => {
    if (!actionModal) return;
    const { kind, item, note } = actionModal;
    setActionSaving(true);
    setActionError(null);
    try {
      if (kind === 'APPROVE') {
        await approveByFamily(item, note || 'Đã duyệt');
      } else if (kind === 'REJECT') {
        // Từ chối BẮT BUỘC có lý do — chặn ở đây thay vì để backend nhận note rỗng.
        await rejectByFamily(item, note);
      } else {
        await cancelByFamily(item, note);
      }
      setActionModal(null);
      await reloadDayRequests();
      setEditResultMessage({
        type: 'success',
        text: kind === 'APPROVE' ? 'Đã duyệt đơn.' : kind === 'REJECT' ? 'Đã từ chối đơn.' : 'Đã huỷ đơn.',
      });
    } catch (error: any) {
      setActionError(extractApiError(error, 'Thao tác thất bại.'));
    } finally {
      setActionSaving(false);
    }
  };

  const openHoursModal = (item: any) => {
    setHoursError(null);
    setEditResultMessage(null);
    setHoursModal({
      item,
      start: formatTimeOnly(item.check_in || item.data?.start_time) || '',
      end: formatTimeOnly(item.check_out || item.data?.end_time) || '',
    });
  };

  const submitHoursModal = async () => {
    if (!hoursModal) return;
    const { item, start, end } = hoursModal;
    if (!start || !end) {
      setHoursError('Nhập đủ giờ bắt đầu và giờ kết thúc.');
      return;
    }
    setHoursSaving(true);
    setHoursError(null);
    try {
      const wasApproved = (item.data?.status || '').toUpperCase() === 'APPROVED';
      // CỐ Ý không gửi `hours`: backend tự tính lại số giờ theo giờ mới
      // (compute_overtime_hours) — gửi số giờ cũ sẽ ghi đè sai.
      const updated = await attendanceService.updateRegistrationRequest(item.id, {
        start_time: start,
        end_time: end,
      });
      setHoursModal(null);
      await reloadDayRequests();
      const nowPending = (updated?.status || '').toUpperCase() === 'PENDING';
      setEditResultMessage(
        wasApproved && nowPending
          ? { type: 'info', text: 'Đã sửa giờ — vì đơn đã duyệt trước đó nên chuyển về "Chờ duyệt", cần HCNS duyệt lại.' }
          : { type: 'success', text: 'Đã cập nhật giờ tăng ca.' }
      );
    } catch (error: any) {
      setHoursError(extractApiError(error, 'Sửa giờ thất bại.'));
    } finally {
      setHoursSaving(false);
    }
  };

  const toggleHistory = (id: number) => {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PRESENT': return 'bg-green-100 text-green-800';
      case 'LATE': return 'bg-yellow-100 text-yellow-800';
      case 'ABSENT': return 'bg-red-100 text-red-800';
      case 'EARLY_LEAVE': return 'bg-orange-100 text-orange-800';
      case 'HALF_DAY': return 'bg-blue-100 text-blue-800';
      case 'INCOMPLETE': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCorrectStatusDisplay = (record: AttendanceRecord): string => {
    const hasCheckIn = !!record.check_in;
    const hasCheckOut = !!record.check_out;
    const workingHours = record.working_hours || 0;
    if (hasCheckIn && hasCheckOut && workingHours > 0) return record.status_display;
    if (!hasCheckIn && !hasCheckOut) return 'Chưa chấm công';
    if (!hasCheckIn) return 'Thiếu giờ vào';
    if (!hasCheckOut) return 'Thiếu giờ ra';
    return 'Thiếu dữ liệu';
  };

  const getStatusForColor = (record: AttendanceRecord): string => {
    const hasCheckIn = !!record.check_in;
    const hasCheckOut = !!record.check_out;
    const workingHours = record.working_hours || 0;
    if (hasCheckIn && hasCheckOut && workingHours > 0) return record.status;
    return 'INCOMPLETE';
  };

  const formatDate = (date: Date) => date.toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div>
      {showKpiCards && (
        <>
          {/* KPI chính */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <div className="group bg-white p-4 rounded-2xl shadow-sm border border-red-100 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1/2 h-full bg-gradient-to-r from-red-600 to-transparent opacity-5"></div>
              <div className="absolute top-0 left-0 w-1 h-full bg-red-600"></div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-red-50 rounded-lg">
                  <BanknotesIcon className="h-6 w-6 text-red-600" />
                </div>
                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-wider italic">Tổng phạt tháng</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-tight">Tổng phạt dự kiến</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-black text-red-600">
                  {(calendarSummary?.total_penalty || 0).toLocaleString('vi-VN')}
                </span>
                <span className="text-xs text-red-500 font-bold uppercase">VNĐ</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-red-500 font-bold">
                <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                <span className="text-[11px] uppercase tracking-wider">
                  {(calendarSummary?.late_or_early_days || 0) + (calendarSummary?.absent_days || 0) + (calendarSummary?.forgot_checkin_days || 0)} Lỗi vi phạm
                </span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-2xl shadow-sm border border-primary-100 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary-500"></div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-primary-50 rounded-lg">
                  <CalendarIcon className="h-6 w-6 text-primary-600" />
                </div>
                <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Tháng này</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-600">Tổng ngày công</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-bold text-gray-900">{calendarSummary?.total_work_days ?? 0}</span>
                <span className="text-sm text-gray-500">ngày</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-2xl shadow-sm border border-emerald-100 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
                </div>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Ổn định</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-600">Ngày đủ công</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-bold text-gray-900">{calendarSummary?.full_days ?? 0}</span>
                <span className="text-sm text-gray-500">ngày</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-2xl shadow-sm border border-amber-100 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <ClockIcon className="h-6 w-6 text-amber-600" />
                </div>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Cần chú ý</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-600">Số phút Muộn/Sớm</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-bold text-gray-900">
                  {(calendarSummary?.total_late_minutes || 0) + (calendarSummary?.total_early_leave_minutes || 0)}
                </span>
                <span className="text-sm text-gray-500">phút</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-2xl shadow-sm border border-red-100 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-red-50 rounded-lg">
                  <NoSymbolIcon className="h-6 w-6 text-red-600" />
                </div>
                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Cảnh báo</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-600">Số ngày Vắng mặt</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-bold text-gray-900">{calendarSummary?.absent_days ?? 0}</span>
                <span className="text-sm text-gray-500">ngày</span>
              </div>
            </div>
          </div>

          {/* Công việc bổ sung & Hạn mức */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-4 mb-10">
            {/* Chàm — HCNS chọn 2026-10-12. Đồng bộ với ô ngày trên lịch
                (AttendanceCalendar) và thẻ bên trang Chốt công. */}
            <div className="group bg-white p-4 rounded-xl border border-indigo-200 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <ShieldExclamationIcon className="h-5 w-5 text-indigo-700" />
                </div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Nghỉ không phép</h3>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-indigo-800">{calendarSummary?.unauthorized_absence_days ?? 0}</span>
                <span className="text-[10px] text-indigo-500 font-medium">ngày</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-xl border border-violet-100 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-violet-50 rounded-lg">
                  <ExclamationTriangleIcon className="h-5 w-5 text-violet-600" />
                </div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Quên chấm công</h3>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-violet-600">{calendarSummary?.forgot_checkin_days ?? 0}</span>
                <span className="text-[10px] text-violet-500 font-medium">ngày</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-xl border border-amber-100 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <BoltIcon className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Tăng ca</h3>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-amber-600">{calendarSummary?.overtime_hours ?? 0}</span>
                <span className="text-[10px] text-amber-500 font-medium">giờ</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-xl border border-violet-100 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-violet-50 rounded-lg">
                  <BriefcaseIcon className="h-5 w-5 text-violet-600" />
                </div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Làm thêm</h3>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-violet-600">{calendarSummary?.extra_hours ?? 0}</span>
                <span className="text-[10px] text-violet-500 font-medium">giờ</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-xl border border-slate-100 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <MoonIcon className="h-5 w-5 text-slate-600" />
                </div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Trực tối</h3>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-600">{calendarSummary?.night_shift_sessions ?? 0}</span>
                <span className="text-[10px] text-slate-500 font-medium">ca</span>
              </div>
            </div>

            <div className="group bg-white p-4 rounded-xl border border-rose-100 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-rose-50 rounded-lg">
                  <VideoCameraIcon className="h-5 w-5 text-rose-600" />
                </div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Live</h3>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-rose-600">{calendarSummary?.live_sessions ?? 0}</span>
                <span className="text-[10px] text-rose-500 font-medium">ca</span>
              </div>
            </div>

            {(() => {
              const maxMonthlyLeave = attendanceStats?.max_leave_per_month || 1;
              const remainingMonthlyLeave = attendanceStats?.remaining_leave ?? maxMonthlyLeave;
              return (
                <div className="group bg-white p-4 rounded-xl border border-primary-100 hover:shadow-md transition-all duration-300">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary-50 rounded-lg">
                      <HeartIcon className="h-5 w-5 text-primary-600" />
                    </div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Nghỉ phép tháng</h3>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-primary-600">{remainingMonthlyLeave}</span>
                    <span className="text-[10px] text-primary-500 font-medium">/{maxMonthlyLeave} ngày</span>
                  </div>
                </div>
              );
            })()}

            {(() => {
              const maxOnline = attendanceStats?.max_online_work_per_month || 3;
              const usedOnline = (attendanceStats?.max_online_work_per_month || 0) - (attendanceStats?.remaining_online_work || 0);
              const remainingOnline = Math.max(0, maxOnline - usedOnline);
              return (
                <div className="group bg-white p-4 rounded-xl border border-emerald-100 hover:shadow-md transition-all duration-300">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-50 rounded-lg">
                      <ComputerDesktopIcon className="h-5 w-5 text-emerald-600" />
                    </div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Online</h3>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-emerald-600">{remainingOnline}</span>
                    <span className="text-[10px] text-emerald-500 font-medium">/{maxOnline} lần</span>
                  </div>
                </div>
              );
            })()}

            {attendanceStats?.max_explanations_per_month > 0 && (
              <div className="group bg-white p-4 rounded-xl border border-primary-100 hover:shadow-md transition-all duration-300">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-primary-50 rounded-lg">
                    <ChatBubbleBottomCenterTextIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Giải trình công</h3>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-primary-600">{attendanceStats?.remaining_explanations || 0}</span>
                  <span className="text-[10px] text-primary-500 font-medium">/{attendanceStats?.max_explanations_per_month || 0} lần</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Lịch chấm công — key ép remount đúng khi đổi nhân viên/tháng từ bên
          ngoài (vd Chốt công có bộ chọn Năm/Tháng riêng), vì bản thân
          AttendanceCalendar chỉ đọc year/month lúc mount. */}
      <div className="mb-6">
        <AttendanceCalendar
          key={`${employeeId}-${year}-${month}-${calendarRefreshKey}`}
          year={year}
          month={month - 1}
          onDateClick={handleDateClick}
          onMonthChange={handleCalendarMonthChange}
          employeeId={employeeId}
          onDataLoaded={handleCalendarDataLoaded}
        />
      </div>

      {/* Date Detail Modal */}
      {dateDetailModalOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Chi tiết chấm công ngày</h2>
                <p className="text-gray-600 mt-1">{selectedDateDetail && formatDate(selectedDateDetail)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {canEditAttendance && (
                  <button
                    onClick={() => { setShowEditAttendanceForm((v) => !v); setEditAttendanceError(null); }}
                    className={`p-1.5 rounded-lg transition-colors ${showEditAttendanceForm ? 'bg-primary-100 text-primary-600' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                    title="Sửa check-in / check-out"
                  >
                    <PencilIcon className="h-5 w-5" />
                  </button>
                )}
                <button onClick={closeDateDetailModal} className="text-gray-400 hover:text-gray-500">
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Sửa thẳng giờ check-in/check-out (bản ghi chấm công gốc) —
                chỉ Admin/người có quyền can_edit_attendance mới thấy nút này. */}
            {canEditAttendance && showEditAttendanceForm && (
              <div className="px-6 pt-4">
                <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3">
                  <p className="text-xs font-bold text-primary-600 uppercase tracking-widest mb-3">Sửa check-in / check-out</p>
                  {editAttendanceError && (
                    <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editAttendanceError}</div>
                  )}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Check-in</label>
                      <input
                        type="time"
                        value={editAttendanceCheckIn}
                        onChange={(e) => setEditAttendanceCheckIn(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Check-out</label>
                      <input
                        type="time"
                        value={editAttendanceCheckOut}
                        onChange={(e) => setEditAttendanceCheckOut(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowEditAttendanceForm(false)}
                      disabled={editAttendanceSaving}
                      className="px-3 py-1.5 text-sm font-medium border border-gray-200 text-gray-600 rounded-md hover:bg-gray-100 disabled:opacity-50"
                    >
                      Huỷ
                    </button>
                    <button
                      onClick={submitEditAttendance}
                      disabled={editAttendanceSaving}
                      className="px-3 py-1.5 text-sm font-semibold bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                    >
                      {editAttendanceSaving ? 'Đang lưu...' : 'Lưu'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Đăng ký Ca 2 hộ nhân viên — chỉ hiện với nhân viên thuộc phạm
                vi (vd Điều dưỡng nhóm BS Ma BS A); backend tự kiểm tra
                lại quyền (chính mình/quản lý trực tiếp/Admin/HR) khi bấm. */}
            {!ca2Loading && ca2Status?.in_scope && (
              <div className="px-6 pt-4">
                <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarDaysIcon className="h-5 w-5 text-violet-600" />
                    <h3 className="text-sm font-bold text-violet-900">Ca làm việc ({caLabels(ca2Status).def} / {caLabels(ca2Status).reg})</h3>
                  </div>
                  {ca2Message && (
                    <div
                      className={`mb-2 text-sm rounded-lg px-3 py-2 ${
                        ca2Message.type === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {ca2Message.text}
                    </div>
                  )}
                  {ca2Status.status === 'PENDING' ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm text-amber-700">
                        Nhân viên đã tự đăng ký {caLabels(ca2Status).reg}, đang chờ duyệt — vào trang Phê duyệt để duyệt/từ chối.
                      </p>
                      {cancelCa2Button}
                    </div>
                  ) : ca2Status.status === 'APPROVED' ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-sm text-violet-700 font-medium">
                        ✓ {caLabels(ca2Status).reg} đã duyệt{ca2Status.reviewed_by_name ? ` bởi ${ca2Status.reviewed_by_name}` : ''}
                        {ca2Status.morning && ca2Status.afternoon && (
                          <span className="block text-xs text-gray-500 font-normal mt-1">
                            Sáng {ca2Status.morning.start_time}–{ca2Status.morning.end_time}, Chiều{' '}
                            {ca2Status.afternoon.start_time}–{ca2Status.afternoon.end_time}
                          </span>
                        )}
                      </div>
                      {cancelCa2Button}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm text-gray-600">
                        {ca2Status.status === 'REJECTED'
                          ? `Đăng ký ${caLabels(ca2Status).reg} trước đó đã bị từ chối.`
                          : ca2Status.status === 'CANCELLED'
                            ? `${caLabels(ca2Status).reg} đã huỷ${ca2Status.reviewed_by_name ? ` bởi ${ca2Status.reviewed_by_name}` : ''} — đang tính ${caLabels(ca2Status).def} (mặc định).`
                            : `Đang tính ${caLabels(ca2Status).def} (mặc định) cho ngày này.`}
                      </p>
                      {caLabels(ca2Status).canRegister && (
                        <button
                          onClick={handleRegisterCa2InModal}
                          disabled={ca2Busy}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          {ca2Busy ? 'Đang xử lý...' : `Đăng ký ${caLabels(ca2Status).reg} cho ngày này`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              {dateDetailLoading ? (
                <div className="flex justify-center items-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : dateDetailRecords.length === 0 && allDayRequests.length === 0 ? (
                <div className="text-center py-8">
                  <InformationCircleIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Không có dữ liệu</h3>
                  <p className="text-gray-600">
                    Không tìm thấy chấm công hay đơn từ nào cho ngày {selectedDateDetail && formatDate(selectedDateDetail)}
                  </p>
                </div>
              ) : (
                <div>
                  {dateDetailRecords.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Giờ vào</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Giờ ra</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tổng giờ</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trạng thái</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {dateDetailRecords.map((record) => (
                          <tr key={record.id} className="hover:bg-gray-50">
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <ClockIcon className="h-4 w-4 text-gray-400 mr-1" />
                                <span className="text-sm text-gray-900">{record.check_in || '-'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <ClockIcon className="h-4 w-4 text-gray-400 mr-1" />
                                <span className="text-sm text-gray-900">{record.check_out || '-'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                              {Number(record.working_hours).toFixed(1)} giờ
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(getStatusForColor(record))}`}>
                                {getCorrectStatusDisplay(record)}
                              </span>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div className="space-y-1">
                                {record.notes && <div>{record.notes}</div>}
                                {(record.late_minutes > 0 || record.early_leave_minutes > 0) && (
                                  <div className="text-xs text-gray-600">
                                    {record.late_minutes > 0 && <div>Đi muộn: {record.late_minutes} phút</div>}
                                    {record.early_leave_minutes > 0 && <div>Về sớm: {record.early_leave_minutes} phút</div>}
                                  </div>
                                )}
                                {!record.notes && record.late_minutes === 0 && record.early_leave_minutes === 0 && <div>-</div>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}

                  {/* Tất cả đơn từ trong ngày — mọi loại, mọi trạng thái, có
                      đủ thao tác duyệt/từ chối/sửa giờ/sửa/huỷ ngay tại chỗ
                      (yêu cầu HCNS 2026-09-23). Nút nào hiện là do BACKEND
                      quyết qua cờ can_* trả kèm mỗi đơn — xem
                      hrm/request_permissions.py. */}
                  {allDayRequests.length > 0 && (
                    <div className={dateDetailRecords.length > 0 ? 'mt-6' : ''}>
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-lg font-semibold text-gray-900">Đơn từ trong ngày</h3>
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                          {allDayRequests.length}
                        </span>
                      </div>
                      {editResultMessage && (
                        <div
                          className={`mb-3 text-sm rounded-lg px-3 py-2 ${
                            editResultMessage.type === 'success'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : editResultMessage.type === 'error'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {editResultMessage.text}
                        </div>
                      )}
                      <div className="space-y-3">
                        {allDayRequests.map((item, index) => {
                          const d = item.data || {};
                          const typeLabel = getRequestTypeLabel(item);
                          const badge = getRequestStatusBadge(d.status);
                          const editKind = getEditKind(item);
                          const isOvertime = (d.registration_type || '').toUpperCase() === 'OVERTIME';
                          const startTime = formatTimeOnly(item.check_in || d.start_time);
                          const endTime = formatTimeOnly(item.check_out || d.end_time);
                          const hours = d.hours ?? item.overtime_hours;
                          const history = (d.edit_history || []).filter(
                            (h: any) => countRealEditChanges(h.changes) > 0 || h.reset_to_pending
                          );
                          const isRejected = (d.status || '').toUpperCase() === 'REJECTED';
                          const showHistory = expandedHistory.has(item.id);
                          // Đơn nhiều ngày (nghỉ không phép) có event_date khác
                          // ngày đang mở modal — phải nói rõ kẻo hiểu nhầm.
                          const itemDate = item.event_date;
                          const isOtherDate =
                            itemDate && selectedDateDetail && itemDate !== toYMD(selectedDateDetail);

                          return (
                            <div
                              key={item.id || index}
                              className="border border-gray-200 rounded-xl overflow-hidden bg-white"
                            >
                              {/* Tiêu đề */}
                              <div className="px-3.5 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-gray-900 text-sm">{typeLabel}</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}>
                                  {badge.label}
                                </span>
                                {isOvertime && d.ot_type && (
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                                    {String(d.ot_type).toUpperCase() === 'ONSITE' ? 'Tại viện/VP' : 'Online'}
                                  </span>
                                )}
                                {isOtherDate && (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                                    Đơn của ngày {itemDate.split('-').reverse().join('/')}
                                  </span>
                                )}
                                {d.request_code && (
                                  <span className="ml-auto text-xs text-gray-400 font-mono">#{d.request_code}</span>
                                )}
                              </div>

                              <div className="px-3.5 py-3 space-y-2.5">
                                {/* Thông tin đơn */}
                                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                                  {(startTime || endTime) && (
                                    <div className="flex gap-2">
                                      <dt className="text-gray-500 shrink-0 w-24">Thời gian</dt>
                                      <dd className="text-gray-900 font-medium">
                                        {startTime || '—'} – {endTime || '—'}
                                        {hours != null && hours !== '' && (
                                          <span className="text-gray-500 font-normal"> · {hours} giờ</span>
                                        )}
                                      </dd>
                                    </div>
                                  )}
                                  {!startTime && !endTime && hours != null && hours !== '' && (
                                    <div className="flex gap-2">
                                      <dt className="text-gray-500 shrink-0 w-24">Số giờ</dt>
                                      <dd className="text-gray-900 font-medium">{hours} giờ</dd>
                                    </div>
                                  )}
                                  {d.sessions != null && (
                                    <div className="flex gap-2">
                                      <dt className="text-gray-500 shrink-0 w-24">Số buổi</dt>
                                      <dd className="text-gray-900 font-medium">{d.sessions}</dd>
                                    </div>
                                  )}
                                  {(item.created_by_name || item.created_at) && (
                                    <div className="flex gap-2">
                                      <dt className="text-gray-500 shrink-0 w-24">Người tạo</dt>
                                      <dd className="text-gray-900">
                                        {item.created_by_name || '—'}
                                        {item.created_at && (
                                          <span className="text-gray-400"> · {formatDateTime(item.created_at)}</span>
                                        )}
                                      </dd>
                                    </div>
                                  )}
                                  {(d.reason || item.explanation) && (
                                    <div className="flex gap-2 sm:col-span-2">
                                      <dt className="text-gray-500 shrink-0 w-24">Lý do</dt>
                                      <dd className="text-gray-900">{d.reason || item.explanation}</dd>
                                    </div>
                                  )}
                                </dl>

                                {/* Tiến trình duyệt — 2 bước QLTT rồi HCNS */}
                                {isRejected ? (
                                  <div className="text-sm rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                                    <span className="font-semibold text-red-700">Đã từ chối</span>
                                    {d.approved_by_name && (
                                      <span className="text-red-600"> · {d.approved_by_name}</span>
                                    )}
                                    {d.approved_at && (
                                      <span className="text-red-400"> · {formatDateTime(d.approved_at)}</span>
                                    )}
                                    {d.approval_note && (
                                      <p className="text-red-600 italic mt-0.5">"{d.approval_note}"</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 space-y-1">
                                    {[
                                      {
                                        label: 'Quản lý trực tiếp',
                                        done: !!d.direct_manager_approved,
                                        who: d.direct_manager_approved_by_name,
                                        at: d.direct_manager_approved_at,
                                      },
                                      {
                                        label: 'Nhân sự HR',
                                        done: !!d.hr_approved,
                                        who: d.hr_approved_by_name,
                                        at: d.hr_approved_at,
                                      },
                                    ].map((step) => (
                                      <div key={step.label} className="flex items-center gap-2 text-sm">
                                        {step.done ? (
                                          <CheckCircleIcon className="h-4 w-4 text-emerald-500 shrink-0" />
                                        ) : (
                                          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-300" />
                                        )}
                                        <span className={step.done ? 'text-gray-900' : 'text-gray-500'}>
                                          {step.label}
                                        </span>
                                        <span className={step.done ? 'text-gray-500' : 'text-gray-400'}>
                                          {step.done
                                            ? `· ${step.who || 'đã duyệt'}${step.at ? ` · ${formatDateTime(step.at)}` : ''}`
                                            : '· chưa duyệt'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Đơn bị đưa về chờ duyệt lại sau khi QLTT sửa */}
                                {d.reapproval_reason && (
                                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                    {d.reapproval_reason}
                                  </p>
                                )}

                                {/* Lịch sử chỉnh sửa — gập lại cho gọn */}
                                {history.length > 0 && (
                                  <div>
                                    <button
                                      onClick={() => toggleHistory(item.id)}
                                      className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
                                    >
                                      {showHistory ? (
                                        <ChevronDownIcon className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronRightIcon className="h-3.5 w-3.5" />
                                      )}
                                      Lịch sử chỉnh sửa ({history.length})
                                    </button>
                                    {showHistory && (
                                      <div className="mt-1.5 space-y-1.5">
                                        {[...history].reverse().map((h: any, i: number) => (
                                          <div
                                            key={i}
                                            className="text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2"
                                          >
                                            <div className="font-semibold text-gray-700">
                                              {h.edited_by_name || 'Không rõ'}
                                              <span className="font-normal text-gray-400">
                                                {' '}· {formatDateTime(h.edited_at)}
                                              </span>
                                            </div>
                                            {sortEditChanges(h.changes).map(([field, val]: [string, any]) => (
                                              <div key={field} className="text-gray-600 mt-0.5">
                                                {EDIT_FIELD_LABELS[field] || field}:{' '}
                                                <span className="line-through text-rose-500">
                                                  {formatEditValue(val?.old)}
                                                </span>
                                                {' → '}
                                                <span className="text-emerald-600 font-semibold">
                                                  {formatEditValue(val?.new)}
                                                </span>
                                              </div>
                                            ))}
                                            {h.reset_to_pending && (
                                              <div className="text-amber-600 font-medium mt-0.5">
                                                Đã đưa về chờ HCNS duyệt lại
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Thao tác */}
                                {(item.can_approve || item.can_reject || item.can_edit_hours ||
                                  (item.can_edit && editKind) || item.can_cancel ||
                                  item.approve_blocked_reason) && (
                                  <div className="pt-1 border-t border-gray-100">
                                    {item.approve_blocked_reason && (
                                      <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
                                        {item.approve_blocked_reason}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap gap-2 pt-2">
                                      {item.can_approve && (
                                        <button
                                          onClick={() => openActionModal('APPROVE', item)}
                                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                        >
                                          <CheckIcon className="h-3.5 w-3.5" />
                                          Duyệt
                                        </button>
                                      )}
                                      {item.can_reject && (
                                        <button
                                          onClick={() => openActionModal('REJECT', item)}
                                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                                        >
                                          <XMarkIcon className="h-3.5 w-3.5" />
                                          Từ chối
                                        </button>
                                      )}
                                      {item.can_edit_hours && (
                                        <button
                                          onClick={() => openHoursModal(item)}
                                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100"
                                        >
                                          <ClockIcon className="h-3.5 w-3.5" />
                                          Sửa giờ
                                        </button>
                                      )}
                                      {item.can_edit && editKind && (
                                        <button
                                          onClick={() => openEditModal(item)}
                                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                                        >
                                          <PencilIcon className="h-3.5 w-3.5" />
                                          Sửa
                                        </button>
                                      )}
                                      {item.can_cancel && (
                                        <button
                                          onClick={() => openActionModal('CANCEL', item)}
                                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
                                        >
                                          <TrashIcon className="h-3.5 w-3.5" />
                                          Huỷ đơn
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
              <div className="flex justify-end">
                <button
                  onClick={closeDateDetailModal}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sửa đơn (Nghỉ phép/Nghỉ không phép/Làm online/Công tác) — chỉ
          QLTT/HR/Admin mới thấy được nút "Sửa" mở ra modal này (backend đã
          cho phép sửa dù đơn đã duyệt, yêu cầu HCNS 2026-09-21). */}
      {editModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-base font-bold text-gray-900">
                Sửa đơn {(EDIT_KIND_LABEL[getEditKind(editModal.item) as EditKind]
                  || getRequestTypeLabel(editModal.item).toLowerCase())}
              </h3>
              <button onClick={() => setEditModal(null)} className="text-gray-400 hover:text-gray-500">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {editError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</div>
              )}
              {(['LEAVE', 'BUSINESS_TRIP'] as const).includes(getEditKind(editModal.item) as any) && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Ngày</label>
                  <input
                    type="date"
                    value={editModal.date}
                    onChange={(e) => setEditModal({ ...editModal, date: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Lý do</label>
                <textarea
                  rows={3}
                  value={editModal.reason}
                  onChange={(e) => setEditModal({ ...editModal, reason: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button
                onClick={() => setEditModal(null)}
                disabled={editSaving}
                className="px-4 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-md hover:bg-gray-100 disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={submitEditModal}
                disabled={editSaving}
                className="px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {editSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duyệt / Từ chối / Huỷ đơn — cùng 1 modal vì cả 3 chỉ khác nhau ở
          nhãn và ô ghi chú (yêu cầu HCNS 2026-09-23: QLTT duyệt/từ chối được
          ngay trong Chấm công + Chốt công, nhân viên tự huỷ đơn của mình). */}
      {actionModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-base font-bold text-gray-900">
                {actionModal.kind === 'APPROVE'
                  ? 'Duyệt đơn'
                  : actionModal.kind === 'REJECT'
                  ? 'Từ chối đơn'
                  : 'Huỷ đơn'}
              </h3>
              <button onClick={() => setActionModal(null)} className="text-gray-400 hover:text-gray-500">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {actionError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 whitespace-pre-line">{actionError}</div>
              )}
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{getRequestTypeLabel(actionModal.item)}</span>
                {actionModal.item.data?.request_code && (
                  <span className="text-gray-400"> · #{actionModal.item.data.request_code}</span>
                )}
                {actionModal.kind === 'CANCEL' && (
                  <p className="mt-1 text-amber-700">Đơn sẽ chuyển sang trạng thái "Đã huỷ" và không còn hiệu lực.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  {actionModal.kind === 'REJECT' ? 'Lý do từ chối' : 'Ghi chú'}
                  {actionModal.kind === 'REJECT' && <span className="text-red-500"> *</span>}
                </label>
                <textarea
                  rows={3}
                  value={actionModal.note}
                  onChange={(e) => setActionModal({ ...actionModal, note: e.target.value })}
                  placeholder={actionModal.kind === 'REJECT' ? 'Nêu rõ lý do để nhân viên biết...' : 'Không bắt buộc'}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button
                onClick={() => setActionModal(null)}
                disabled={actionSaving}
                className="px-4 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-md hover:bg-gray-100 disabled:opacity-50"
              >
                Đóng
              </button>
              <button
                onClick={submitActionModal}
                disabled={actionSaving || (actionModal.kind === 'REJECT' && !actionModal.note.trim())}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-md disabled:opacity-50 ${
                  actionModal.kind === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {actionSaving
                  ? 'Đang xử lý...'
                  : actionModal.kind === 'APPROVE'
                  ? 'Duyệt'
                  : actionModal.kind === 'REJECT'
                  ? 'Từ chối'
                  : 'Huỷ đơn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sửa GIỜ đơn tăng ca Tại viện/VP — CỐ Ý không cho nhập số giờ: backend
          tự tính lại theo giờ vào/ra (compute_overtime_hours) nên nhập tay chỉ
          gây lệch. Hạn sửa (10h sáng hôm sau, Chủ nhật tới hết ngày) do backend
          chặn và cũng là điều kiện để nút này xuất hiện. */}
      {hoursModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-base font-bold text-gray-900">Sửa giờ tăng ca</h3>
              <button onClick={() => setHoursModal(null)} className="text-gray-400 hover:text-gray-500">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {hoursError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 whitespace-pre-line">{hoursError}</div>
              )}
              <div className="text-sm text-gray-600">
                Giờ hiện tại:{' '}
                <span className="font-semibold text-gray-900">
                  {formatTimeOnly(hoursModal.item.check_in || hoursModal.item.data?.start_time) || '—'} –{' '}
                  {formatTimeOnly(hoursModal.item.check_out || hoursModal.item.data?.end_time) || '—'}
                </span>
                {(hoursModal.item.data?.hours ?? hoursModal.item.overtime_hours) != null && (
                  <span className="text-gray-400">
                    {' '}· {hoursModal.item.data?.hours ?? hoursModal.item.overtime_hours} giờ
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Giờ bắt đầu</label>
                  <input
                    type="time"
                    value={hoursModal.start}
                    onChange={(e) => setHoursModal({ ...hoursModal, start: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Giờ kết thúc</label>
                  <input
                    type="time"
                    value={hoursModal.end}
                    onChange={(e) => setHoursModal({ ...hoursModal, end: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Tối thiểu 30 phút mới được tính tăng ca. Số giờ được tính lại tự động theo giờ vào/ra mới.
                {(hoursModal.item.data?.status || '').toUpperCase() === 'APPROVED' &&
                  ' Đơn đã duyệt sẽ quay lại "Chờ duyệt" để HCNS duyệt lại.'}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button
                onClick={() => setHoursModal(null)}
                disabled={hoursSaving}
                className="px-4 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-md hover:bg-gray-100 disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={submitHoursModal}
                disabled={hoursSaving}
                className="px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {hoursSaving ? 'Đang lưu...' : 'Lưu giờ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeMonthAttendance;
