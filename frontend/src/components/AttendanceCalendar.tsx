import React, { useState, useEffect } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  BoltIcon,
  ExclamationCircleIcon,
  CalendarDaysIcon,
  XMarkIcon,
  DocumentTextIcon,
  PencilIcon,
  CheckIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { attendanceService } from '../services/attendance.service';
import { approvalService } from '../services/approval.service';
import { useAuth } from '../contexts/AuthContext';
import { useNotePrompt } from './NotePromptDialog';

// Types for attendance data
export interface AttendanceDay {
  date: Date;
  day: number;
  weekday: number;
  weekday_label: string;
  is_weekend: boolean;
  is_holiday: boolean;
  holiday_name: string | null;
  is_leave: boolean;
  day_status: string;
  status_badge: string | null;
  engine_context: {
    is_holiday: boolean;
    is_leave_day: boolean;
    is_absent: boolean;
    is_incomplete: boolean;
    work_credit: number;
    holiday_credit?: number;
    penalty_amount: number;
    overtime_hours: number;
    extra_hours: number;
    night_shift_sessions: number;
    live_sessions: number;
    late_minutes: number;
    early_leave_minutes: number;
    /** Chế độ con nhỏ: số phút được đi muộn / về sớm thêm của ngày (0 = không hưởng). */
    child_care_minutes?: number;
    rules_applied: string[];
  };
  shifts: Array<{
    shift_type: string;
    shift_label: string;
    check_in: string | null;
    check_out: string | null;
    status: string;
    status_color: string;
  }>;
  registrations: any[];
  raw_checkin_checkout?: Array<{
    check_in: string | null;
    check_out: string | null;
  }>;
  // Compatibility fields for AttendanceManagement.tsx
  approvedExplanations?: any[];
  allExplanations?: any[];
  approvedRegistrations?: any[];
  approvedLeaveRequests?: any[];
  approvedOnlineWorks?: any[];
  // UI extended fields
  dayStatusSummary?: {
    has_approved_explanation: boolean;
    has_approved_registration: boolean;
    has_approved_leave: boolean;
    has_approved_online_work: boolean;
    has_pending_request: boolean;
    summary_text: string;
    display_color: string;
    pending_request_types?: string[];
  };
  pendingRequests?: any[];
  // Fallback for old UI logic or specific convenience
  morning: AttendanceStatus;
  afternoon: AttendanceStatus;
  evening: AttendanceStatus;
  morningData?: any;
  afternoonData?: any;
  eveningData?: any;
}

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'incomplete_attendance'
  | 'off'
  | 'holiday'
  | 'no_data';

export interface AttendanceCalendarProps {
  year?: number;
  month?: number; // 0-indexed (0 = January, 11 = December)
  onDateClick?: (date: Date, dayData?: AttendanceDay) => void;
  onMonthChange?: (date: Date) => void;
  employeeId?: number;
  departmentId?: number;
  refreshTrigger?: number;
  onDataLoaded?: (data: { calendar: any[]; summary: any }) => void;
  showInternalDialog?: boolean;
}

/** "20:30:00" | "20:30" -> "20:30" (giá trị cho <input type="time">). */
const toHHMMDraft = (v: any): string => {
  if (!v) return '';
  const m = String(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

/** Đơn có KHUNG GIỜ sửa được (đều ở endpoint registration-requests). */
const hasEditableTimeRange = (reg: any): boolean => {
  const eventType = String(reg?.event_type || '').toUpperCase();
  if (['EXPLANATION', 'ONLINE_WORK'].includes(eventType)) return false;
  const type = String(reg?.data?.registration_type || eventType || '').toUpperCase();
  return ['OVERTIME', 'EXTRA_HOURS', 'NIGHT_SHIFT', 'LIVE', 'LIVESTREAM', 'OFF_DUTY'].includes(type);
};

const AttendanceCalendar: React.FC<AttendanceCalendarProps> = ({
  year = new Date().getFullYear(),
  month = new Date().getMonth(),
  onDateClick,
  onMonthChange,
  employeeId,
  departmentId,
  refreshTrigger,
  onDataLoaded,
  showInternalDialog,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date(year, month, 1));
  const [attendanceData, setAttendanceData] = useState<AttendanceDay[]>([]);
  const [engineSummary, setEngineSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Dialog state for day detail
  const [dialogDay, setDialogDay] = useState<AttendanceDay | null>(null);

  // Edit attendance state
  const [showEditForm, setShowEditForm] = useState(false);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);
  const [requestActionLoadingId, setRequestActionLoadingId] = useState<string | null>(null);
  const [requestActionError, setRequestActionError] = useState<string | null>(null);
  const [cancelConfirmReg, setCancelConfirmReg] = useState<any | null>(null);
  const [editRequestReg, setEditRequestReg] = useState<any | null>(null);
  const [editRequestReasonDraft, setEditRequestReasonDraft] = useState('');
  // Giờ bắt đầu/kết thúc cho đơn có khung giờ (tăng ca, làm thêm giờ, trực
  // tối, Live, ra trực) — trước 2026-09-23 dialog này chỉ sửa được mỗi lý do
  // nên không sửa được giờ đơn tăng ca (HCNS báo).
  const [editRequestStartDraft, setEditRequestStartDraft] = useState('');
  const [editRequestEndDraft, setEditRequestEndDraft] = useState('');
  const [editRequestSubmitting, setEditRequestSubmitting] = useState(false);
  const [editRequestError, setEditRequestError] = useState<string | null>(null);

  // Auth context for permission check
  const { user } = useAuth();
  const { askNote, notePromptDialog } = useNotePrompt();

  // Determine if we should show the internal detail dialog.
  // Default to showing it ONLY if no external date click handler is provided.
  const shouldShowInternal = showInternalDialog ?? !onDateClick;

  // DEBUG: Log engine summary when it changes
  useEffect(() => {
    if (engineSummary) {
      console.log('--- [AttendanceCalendar] LOG DEBUG engineSummary ---');
      console.log('Used:', engineSummary.explanation_quota_used);
      console.log('Remaining:', engineSummary.explanation_quota_remaining);
      console.log('Max:', engineSummary.explanation_quota_max);
      console.log('Data:', engineSummary);
    }
  }, [engineSummary]);

  // Reset edit form when the selected dialog day changes
  useEffect(() => {
    setShowEditForm(false);
    setEditCheckIn('');
    setEditCheckOut('');
    setEditError(null);
    setEditSuccess(false);
  }, [dialogDay]);

  // Map API shift status string to AttendanceStatus
  const mapShiftStatus = (shift: any): AttendanceStatus => {
    if (!shift) return 'no_data';
    const status = (shift.status || '').toUpperCase();

    // Logic override: If shift has both check-in and check-out, it's present (green)
    // even if backend returns ABSENT/EMPTY (common on weekends or during processing)
    if (shift.check_in && shift.check_out && (status === 'ABSENT' || status === 'EMPTY')) {
      return 'present';
    }

    // If shift has at least one log, return present (green) instead of incomplete (purple)
    // as per user request to show "có mặt" color for forgot clocking with logs.
    if ((shift.check_in || shift.check_out)) {
      return 'present';
    }

    switch (status) {
      case 'PRESENT': return 'present';
      case 'ABSENT': return 'absent';
      case 'HALF_DAY': return 'present';
      case 'INCOMPLETE_ATTENDANCE': return 'present';
      case 'FORGOT_CC': return 'present';
      case 'LATE': return 'present';
      case 'EARLY_LEAVE': return 'present';
      case 'LATE_EARLY': return 'present';
      case 'EMPTY': return 'no_data';
      default: return 'no_data';
    }
  };

  const getRequestTypeLabel = (reg: any): string => {
    const type = (reg.event_type || '').toUpperCase();
    const data = reg.data || {};
    const regType = (data.registration_type || '').toUpperCase();

    if (type === 'EXPLANATION') {
      const expType = (data.explanation_type || '').toUpperCase();
      switch (expType) {
        case 'LATE': return 'đi muộn';
        case 'EARLY_LEAVE': return 'về sớm';
        case 'INCOMPLETE_ATTENDANCE': return 'quên chấm công';
        case 'MACHINE_ERROR': return 'lỗi máy chấm công';
        case 'BUSINESS_TRIP': return 'công tác';
        case 'FIRST_DAY': return 'ngày đầu đi làm';
        case 'LEAVE': return 'nghỉ phép tháng';
        default: return 'giải trình';
      }
    }

    // Ưu tiên sử dụng registration_type từ BE, nếu không có mới dùng event_type
    const effectiveType = regType || type;

    switch (effectiveType) {
      case 'OVERTIME': return 'tăng ca';
      case 'EXTRA_HOURS': return 'làm thêm giờ';
      case 'NIGHT_SHIFT': return 'trực tối';
      case 'ONLINE_WORK': return 'làm việc online';
      case 'LEAVE': return 'nghỉ phép tháng';
      case 'LIVE':
      case 'LIVESTREAM':
        return 'livestream';
      case 'OFF_DUTY': return 'ra trực';
      case 'UNAUTHORIZED_ABSENCE': return 'nghỉ không phép';
      case 'SHIFT_CHANGE': return 'đổi ca';
      default: return 'đơn';
    }
  };

  // Map day_status to display color
  const getDayStatusDisplayColor = (dayStatus: string): string => {
    switch (dayStatus) {
      case 'FULL': return 'green';
      case 'HALF': return 'orange';
      case 'ABSENT': return 'red';
      case 'UNAUTHORIZED_ABSENCE': return 'indigo';
      case 'LATE': return 'green';
      case 'EARLY_LEAVE': return 'green';
      case 'LATE_EARLY': return 'green';
      case 'FORGOT_CC': return 'green'; // Use green instead of purple for forgot clocking
      case 'LEAVE': return 'gray';
      case 'HOLIDAY': return 'blue';
      default: return 'default';
    }
  };



  // Fetch calendar data from API
  const fetchCalendarData = async () => {
    try {
      setLoading(true);
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1; // API expects 1-indexed month

      const params: any = { year, month };
      if (employeeId) params.employee_id = employeeId;
      if (departmentId) params.department_id = departmentId;

      console.log('AttendanceCalendar fetching calendar data with params:', params);

      const responseData = await attendanceService.getCalendarView(params);

      // Support new API format: { success: true, data: { calendar: [...], ... } }
      // and old format: { calendar_data: [...], ... }
      const calendarDays: any[] =
        (responseData as any)?.data?.calendar ||
        (responseData as any)?.calendar_data ||
        [];
      
      const summary = (responseData as any)?.data?.engine_summary || null;
      setEngineSummary(summary);

      const transformedData: AttendanceDay[] = calendarDays.map((dayItem: any) => {
        // Parse date as local time (append T00:00:00 to avoid UTC offset shifting the day)
        const date = new Date(dayItem.date + 'T00:00:00');

        const morningShift = dayItem.shifts?.find((s: any) => s.shift_type === 'MORNING' || s.shift_type === 'FULL_DAY');
        const afternoonShift = dayItem.shifts?.find((s: any) => s.shift_type === 'AFTERNOON' || s.shift_type === 'FULL_DAY');
        const eveningShift = dayItem.shifts?.find((s: any) => s.shift_type === 'EVENING' || s.shift_type === 'NIGHT');

        // Extract raw logs for easier processing
        const rawLogs: string[] = (dayItem.raw_checkin_checkout || []).reduce((acc: string[], curr: any) => {
          if (curr.check_in) acc.push(curr.check_in);
          if (curr.check_out) acc.push(curr.check_out);
          return acc;
        }, []);

        // Logic override: If shifts are empty but raw logs exist, populate virtual shift data
        // especially for 'Quên chấm công' (FORGOT_CC)
        let processedMorningShift = morningShift ? { ...morningShift } : null;
        let processedAfternoonShift = afternoonShift ? { ...afternoonShift } : null;
        let processedEveningShift = eveningShift ? { ...eveningShift } : null;

        if (rawLogs.length > 0) {
          rawLogs.forEach(logTime => {
            const hour = parseInt(logTime.split(':')[0]);
            
            // Morning: < 12 (standard) but we can allow up to 12:00 as checkout
            if (hour < 12 || logTime === '12:00') {
              if (processedMorningShift) {
                if (!processedMorningShift.check_in) processedMorningShift.check_in = logTime;
                else if (!processedMorningShift.check_out && processedMorningShift.check_in !== logTime) processedMorningShift.check_out = logTime;
              } else {
                processedMorningShift = { shift_type: 'MORNING', check_in: logTime, check_out: null, status: 'INCOMPLETE_ATTENDANCE' };
              }
            }
            
            // Afternoon: 12:00 up to 18:00
            if (hour >= 12 && hour <= 18) {
              if (processedAfternoonShift) {
                if (!processedAfternoonShift.check_in && !processedAfternoonShift.check_out) processedAfternoonShift.check_in = logTime;
                else if (!processedAfternoonShift.check_out && processedAfternoonShift.check_in !== logTime) processedAfternoonShift.check_out = logTime;
                else if (!processedAfternoonShift.check_out) processedAfternoonShift.check_out = logTime;
              } else {
                processedAfternoonShift = { shift_type: 'AFTERNOON', check_in: logTime, check_out: null, status: 'INCOMPLETE_ATTENDANCE' };
              }
            }
            
            // Evening: 18:00 onwards
            if (hour >= 18) {
              if (processedEveningShift) {
                if (!processedEveningShift.check_in) processedEveningShift.check_in = logTime;
                else if (!processedEveningShift.check_out && processedEveningShift.check_in !== logTime) processedEveningShift.check_out = logTime;
              } else {
                processedEveningShift = { shift_type: 'EVENING', check_in: logTime, check_out: null, status: 'INCOMPLETE_ATTENDANCE' };
              }
            }
          });
        }

        // Map statuses for compatibility
        let morning = dayItem.is_holiday ? 'holiday' : mapShiftStatus(processedMorningShift);
        let afternoon = dayItem.is_holiday ? 'holiday' : mapShiftStatus(processedAfternoonShift);
        let evening = dayItem.is_holiday ? 'holiday' : mapShiftStatus(processedEveningShift);

        // Logic: Inheritance - If Evening is present, make Afternoon present too (Green)
        if (evening === 'present' && (afternoon === 'absent' || afternoon === 'no_data' || afternoon === 'incomplete_attendance')) {
          afternoon = 'present';
        }

        // If day is incomplete or has FORGOT_CC status, force absent shifts to incomplete_attendance (purple)
        const isForgotCC = dayItem.day_status === 'FORGOT_CC' || dayItem.engine_context?.is_incomplete;
        if (isForgotCC) {
          if (morning === 'absent' || morning === 'no_data') morning = 'incomplete_attendance';
          if (afternoon === 'absent' || afternoon === 'no_data') afternoon = 'incomplete_attendance';
          if (evening === 'absent' || evening === 'no_data') evening = 'incomplete_attendance';
        }

        // Process registrations for summary and compatibility
        const registrations = dayItem.registrations || [];
        const approvedExplanations = registrations
          .filter((r: any) => (r.event_type || '').toUpperCase() === 'EXPLANATION' && r.data?.status === 'APPROVED')
          .map((r: any) => ({
            ...r.data,
            reason: r.explanation || r.data?.reason,
          }));

        const allExplanations = registrations
          .filter((r: any) => (r.event_type || '').toUpperCase() === 'EXPLANATION' && ['APPROVED', 'PENDING'].includes(r.data?.status))
          .map((r: any) => ({
            ...r.data,
            reason: r.explanation || r.data?.reason,
          }));

        const approvedRegistrations = registrations
          .filter((r: any) => {
            const t = (r.event_type || '').toUpperCase();
            // Cố tình KHÔNG thêm SHIFT_CHANGE vào đây: đơn đổi ca không nên "chiếm" text/màu
            // của ngày (getDayBadgeText ưu tiên approvedRegistrations[0] TRƯỚC cả trạng thái
            // đi muộn/về sớm thật) — 1 ngày có đổi ca vẫn cần hiện đúng "Đi muộn"/"Có mặt"
            // theo ca MỚI thay vì luôn bị đè thành "Đã duyệt đổi ca". UNAUTHORIZED_ABSENCE thì
            // an toàn hơn vì getDayBadgeStyle đã chặn riêng ở nhánh day_status phía trên rồi.
            return ['OVERTIME', 'EXTRA_HOURS', 'NIGHT_SHIFT', 'LIVE', 'LIVESTREAM', 'ONLINE_WORK', 'OFF_DUTY', 'UNAUTHORIZED_ABSENCE'].includes(t) && r.data?.status === 'APPROVED';
          })
          .map((r: any) => r);

        const onlineWorkRequests = registrations
          .filter((r: any) => (r.event_type || '').toUpperCase() === 'ONLINE_WORK' && r.data?.status === 'APPROVED')
          .map((r: any) => r.data);

        const hasApprovedExplanations = approvedExplanations.length > 0;
        const hasApprovedRegistration = approvedRegistrations.length > 0;
        const pendingRequests = registrations.filter((r: any) => {
          const t = (r.event_type || '').toUpperCase();
          // UNAUTHORIZED_ABSENCE/SHIFT_CHANGE thiếu trong whitelist này khiến đơn
          // "Nghỉ không phép"/"Đổi ca" đang PENDING hoàn toàn vô hình trên lịch
          // (hiện "Chưa có dữ liệu" thay vì badge "Chờ duyệt") cho tới khi được duyệt.
          return ['EXPLANATION', 'OVERTIME', 'EXTRA_HOURS', 'NIGHT_SHIFT', 'LIVE', 'LIVESTREAM', 'ONLINE_WORK', 'LEAVE', 'OFF_DUTY', 'UNAUTHORIZED_ABSENCE', 'SHIFT_CHANGE'].includes(t) &&
                 r.data?.status === 'PENDING';
        });

        const pendingRequestLabels = Array.from(new Set(pendingRequests.map((r: any) => getRequestTypeLabel(r))));
        const hasPendingRequest = pendingRequests.length > 0;
        const hasApprovedOnlineWork = onlineWorkRequests.length > 0;

        const late = dayItem.engine_context?.late_minutes || 0;
        const early = dayItem.engine_context?.early_leave_minutes || 0;

        let summaryText = dayItem.status_badge;

        // Ưu tiên hiển thị "Ra trực" nếu có đơn đã duyệt
        const approvedOffDuty = approvedRegistrations.find((r: any) => (r.event_type || '').toUpperCase() === 'OFF_DUTY');
        
        if (approvedOffDuty) {
          summaryText = 'Đã duyệt ra trực';
        } else if (isForgotCC && !summaryText) {
          summaryText = 'Quên chấm công';
        } else if (!summaryText && hasApprovedExplanations) {
          summaryText = approvedExplanations[0].reason || 'Có đơn đã duyệt';
        }

        // Determine display color: priority Green > Purple > others
        let displayColor = getDayStatusDisplayColor(dayItem.day_status);
        if (approvedOffDuty) {
          displayColor = 'green'; // Ra trực luôn hiển thị màu xanh
        } else if (dayItem.engine_context?.work_credit >= 1.0) {
          displayColor = 'green';
        } else if (dayItem.engine_context?.work_credit >= 0.5) {
          displayColor = 'orange'; // 0.5 công -> màu Cam (Orange)
        } else if (isForgotCC) {
          displayColor = 'purple';
        } else if (dayItem.status_badge === 'Nghỉ phép tháng' || hasApprovedOnlineWork || hasApprovedExplanations) {
          displayColor = dayItem.engine_context?.work_credit >= 1.0 ? 'green' : (dayItem.engine_context?.work_credit >= 0.5 ? 'orange' : displayColor);
        }

        return {
          ...dayItem, // Spread all fields from API
          date,
          morning,
          afternoon,
          evening,
          morningData: processedMorningShift,
          afternoonData: processedAfternoonShift,
          eveningData: processedEveningShift,
          // Compatibility fields for AttendanceManagement.tsx
          approvedExplanations,
          allExplanations,
          approvedRegistrations,
          approvedLeaveRequests: dayItem.is_leave ? [{ leave: true }] : [],
          approvedOnlineWorks: onlineWorkRequests,
          dayStatusSummary: {
            has_approved_explanation: hasApprovedExplanations,
            has_approved_registration: hasApprovedRegistration,
            has_approved_leave: dayItem.is_leave || false,
            has_approved_online_work: hasApprovedOnlineWork,
            has_pending_request: hasPendingRequest,
            pending_request_types: pendingRequestLabels,
            summary_text: summaryText,
            display_color: displayColor,
          },
          pendingRequests,
        };
      });

      setAttendanceData(transformedData);
      
      // Notify parent of the data (to avoid duplicate API calls in parent)
      if (onDataLoaded) {
        onDataLoaded({
          calendar: calendarDays,
          summary: (responseData as any)?.data?.summary || (responseData as any)?.summary || null
        });
      }

      return transformedData;
    } catch (error) {
      console.error('Error fetching calendar data:', error);
      setAttendanceData([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Navigation
  const goToPreviousMonth = () => {
    const newDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 1,
      1
    );
    setCurrentDate(newDate);
    if (onMonthChange) {
      onMonthChange(newDate);
    }
  };

  const goToNextMonth = () => {
    const newDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      1
    );
    setCurrentDate(newDate);
    if (onMonthChange) {
      onMonthChange(newDate);
    }
  };

  const goToToday = () => {
    const newDate = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );
    setCurrentDate(newDate);
    if (onMonthChange) {
      onMonthChange(newDate);
    }
  };

  // Get day names in Vietnamese
  const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  // Get month name in Vietnamese
  const monthNames = [
    'Tháng 1',
    'Tháng 2',
    'Tháng 3',
    'Tháng 4',
    'Tháng 5',
    'Tháng 6',
    'Tháng 7',
    'Tháng 8',
    'Tháng 9',
    'Tháng 10',
    'Tháng 11',
    'Tháng 12',
  ];

  // Get status color
  // Fetch data when month or triggers change
  useEffect(() => {
    fetchCalendarData();
  }, [currentDate, employeeId, departmentId, refreshTrigger]);

  const getStatusColor = (status: AttendanceStatus): string => {
    switch (status) {
      case 'present':
        return 'bg-green-500';
      case 'absent':
        return 'bg-red-500';
      case 'late':
        return 'bg-yellow-500';
      case 'incomplete_attendance':
        return 'bg-purple-500';
      case 'off':
        return 'bg-gray-300';
      case 'holiday':
        return 'bg-blue-300';
      case 'no_data':
        return 'bg-gray-400';
      default:
        return 'bg-gray-200';
    }
  };

  // Get first day of month (0 = Sunday, 1 = Monday, etc.)
  const firstDayOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay();

  // Adjust for Vietnamese week (Monday first)
  const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  // Create empty cells for days before the first day of month
  const emptyCells = Array.from({ length: adjustedFirstDay }, (_, i) => i);

  // Helper: Get full Vietnamese day name
  const getDayNameFull = (dayOfWeek: number): string => {
    const names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return names[dayOfWeek];
  };

  // Helper: Get badge style for a day
  const getDayBadgeStyle = (day: AttendanceDay): string => {
    // Priority 1: Pending requests should be highly visible
    if (day.dayStatusSummary?.has_pending_request) {
      return 'bg-blue-50 text-blue-600 ring-1 ring-blue-200 animate-pulse font-medium';
    }

    // Priority 2: Approved requests
    // Ưu tiên: Ra trực → màu xanh lá
    const hasApprovedOffDuty = (day.approvedRegistrations || []).some((r: any) => (r.event_type || '').toUpperCase() === 'OFF_DUTY');
    if (hasApprovedOffDuty) {
      return 'bg-green-100 text-green-700 ring-1 ring-green-400 font-bold';
    }

    // Priority 2: Approved requests → màu xanh lá
    if (day.dayStatusSummary?.has_approved_explanation || day.dayStatusSummary?.has_approved_registration || day.dayStatusSummary?.has_approved_online_work) {
      return 'bg-green-100 text-green-700 ring-1 ring-green-400 font-medium';
    }

    // Priority 2.5: Nghỉ không phép — không có shift/attendance data (shifts toàn
    // EMPTY) nên nếu không chặn ở đây sẽ rơi xuống nhánh allNoData bên dưới, tô
    // MÀU XÁM giống hệt ngày "Chưa có dữ liệu" thật — dù nhãn chữ (getDayBadgeText)
    // vẫn hiện đúng "Nghỉ không phép", tạo cảm giác ngày này không có gì đặc biệt.
    // Cố tình KHÔNG dùng chung màu xanh lá "đã duyệt" ở trên — nghỉ không phép (dù
    // đã duyệt hay đang chờ) vẫn là 1 trạng thái cần chú ý riêng, không nên trông
    // "tốt"/hoàn tất giống các đơn đăng ký khác.
    if (day.day_status === 'UNAUTHORIZED_ABSENCE') {
      // CHÀM (indigo) — HCNS chọn 2026-10-12 sau khi thấy vàng khó nhìn.
      // Mọi màu khác trong hàm này đã có chủ: xanh dương = đơn chờ duyệt,
      // xanh lá = đã duyệt/đủ công, tím = quên chấm công, vàng = đi muộn/về
      // sớm, cam = nửa công, đỏ = vắng, xám = chưa có dữ liệu. Chàm là màu
      // duy nhất còn trống trong họ xanh–tím, nên đổi sang màu khác phải
      // kiểm lại cả danh sách trên kẻo trùng nghĩa.
      return 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-500 font-bold';
    }

    // Priority 3: Incomplete/Forgot CC (Purple) - More critical than just being late
    if (day.dayStatusSummary?.display_color === 'purple' || day.engine_context?.is_incomplete) {
      return 'bg-purple-100 text-purple-700 ring-1 ring-purple-300';
    }

    // Priority 4: Late/Early badge (Yellow) - Only if not enough credit to be Green/Orange
    const late = day.engine_context?.late_minutes || 0;
    const early = day.engine_context?.early_leave_minutes || 0;
    const credit = day.engine_context?.work_credit || 0;

    if (late > 0 || early > 0) {
      return 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300';
    }
    if (day.dayStatusSummary?.display_color === 'yellow') {
      return 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300 animate-pulse';
    }

    if (day.dayStatusSummary?.display_color === 'green') {
      return 'bg-green-100 text-green-700 ring-1 ring-green-400';
    }
    if (day.dayStatusSummary?.display_color === 'orange' || credit >= 0.5) {
      return 'bg-orange-100 text-orange-700 ring-1 ring-orange-300';
    }
    const hasIncomplete = day.engine_context?.is_incomplete;
    if (hasIncomplete) return 'bg-purple-100 text-purple-700 ring-1 ring-purple-300';
    const allNoData = day.shifts?.every(s => s.status === 'EMPTY');
    if (allNoData) return 'bg-gray-100 text-gray-500';
    const allAbsent = day.engine_context?.is_absent;
    if (allAbsent) return 'bg-red-100 text-red-700';

    if (day.engine_context?.work_credit >= 1.0) return 'bg-green-100 text-green-700';
    if (day.engine_context?.work_credit >= 0.5) return 'bg-orange-100 text-orange-700';

    if (day.dayStatusSummary?.has_pending_request) {
      return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    }

    if (day.engine_context?.work_credit === 0) {
      return 'bg-red-50 text-red-700 border-red-200';
    }
    return 'bg-gray-50 text-gray-500 border-gray-200';
  };

  // Helper: Get badge text for a day
  const getDayBadgeText = (day: AttendanceDay): string => {
    if (day.dayStatusSummary?.has_pending_request) {
      const pendingTypes = day.dayStatusSummary.pending_request_types || [];
      if (pendingTypes.length > 0) {
        return `Chờ duyệt đơn ${pendingTypes.join(', ')}`;
      }
      return 'Chờ duyệt đơn';
    }

    // Nếu có đơn đã duyệt, hiển thị chi tiết duyệt đơn gì
    if (day.dayStatusSummary?.has_approved_explanation || day.dayStatusSummary?.has_approved_registration || day.dayStatusSummary?.has_approved_online_work) {
      // Ưu tiên: Ra trực
      const offDutyReg = (day.approvedRegistrations || []).find((r: any) => (r.event_type || '').toUpperCase() === 'OFF_DUTY');
      if (offDutyReg) return 'Đã duyệt ra trực';

      // Ưu tiên hiện đơn giải trình
      const approvedExpls = day.approvedExplanations || [];
      if (approvedExpls.length > 0) {
        const types = approvedExpls.map(e => e.explanation_type);

        // Nếu có cả đi muộn và về sớm
        if (types.includes('LATE') && types.includes('EARLY_LEAVE')) {
          return 'Đã duyệt đi muộn - về sớm';
        }

        const typeMap: Record<string, string> = {
          'LATE': 'Đã duyệt đi muộn',
          'EARLY_LEAVE': 'Đã duyệt về sớm',
          'INCOMPLETE_ATTENDANCE': 'Đã duyệt quên chấm công',
          'MACHINE_ERROR': 'Đã duyệt lỗi máy chấm công',
          'LEAVE': 'Đã duyệt nghỉ phép tháng',
          'BUSINESS_TRIP': 'Đã duyệt đi công tác',
          'FIRST_DAY': 'Đã duyệt làm ngày đầu'
        };

        // Trả về type đầu tiên tìm được
        for (const exp of approvedExpls) {
          const t = exp.explanation_type;
          if (t === 'LEAVE') {
            return exp.expected_status === 'HALF_DAY' ? 'Duyệt nghỉ phép nửa ngày' : 'Duyệt nghỉ phép tháng';
          }
          if (typeMap[t]) return typeMap[t];
        }
        return 'Đã duyệt GPT';
      }

      // Sau đó tới các đơn đăng ký
      const reg = (day.approvedRegistrations || [])[0];
      if (reg) {
        const type = (reg.event_type || '').toUpperCase();
        if (type === 'ONLINE_WORK' && reg.data?.expected_status === 'HALF_DAY' && !reg.data?.reason?.toLowerCase().includes('checkpage')) {
          return 'Đã duyệt làm online nửa ngày';
        }
        const label = getRequestTypeLabel(reg);
        return 'Đã duyệt ' + label;
      }

      return 'Đã duyệt';
    }
    if (day.dayStatusSummary?.summary_text) return day.dayStatusSummary.summary_text;
    const hasIncomplete = day.engine_context?.is_incomplete;
    if (hasIncomplete) return 'Quên chấm công';

    const allNoData = day.shifts?.every(s => s.status === 'EMPTY');
    if (allNoData) return 'Chưa có dữ liệu';

    const late = day.engine_context?.late_minutes || 0;
    const early = day.engine_context?.early_leave_minutes || 0;
    if (late > 0 && early > 0) return 'Đi muộn - Về sớm';
    if (late > 0) return 'Đi muộn';
    if (early > 0) return 'Về sớm';

    if (day.engine_context?.work_credit >= 1.0) return 'Có mặt';
    if (day.engine_context?.work_credit >= 0.5) return 'Nửa công';
    if (day.engine_context?.work_credit > 0) return 'Thiếu công';
    return 'Vắng mặt';
  };

  // Helper: Check if day has attendance data
  const dayHasData = (day: AttendanceDay): boolean => {
    const hasShiftLogs = day.morningData?.check_in || day.morningData?.check_out ||
      day.afternoonData?.check_in || day.afternoonData?.check_out ||
      day.eveningData?.check_in || day.eveningData?.check_out;
    const hasRawLogs = (day.raw_checkin_checkout || []).length > 0;
    const isNotEmptyStatus = !day.shifts?.every(s => s.status === 'EMPTY');
    return !!hasShiftLogs || hasRawLogs || isNotEmptyStatus;
  };

  // Helper: Get info box style based on penalty case
  const getInfoBoxStyle = (day: AttendanceDay): string => {
    const hasLate = Number(day.engine_context?.late_minutes) > 0;
    const hasEarly = Number(day.engine_context?.early_leave_minutes) > 0;
    const hasPenalty = (day.engine_context?.penalty_amount || 0) > 0;
    if (hasPenalty) return 'bg-red-50 border-red-200';
    if (hasLate || hasEarly) return 'bg-yellow-50 border-yellow-200';
    return 'bg-slate-50 border-slate-200';
  };

  const getWorkCreditLabel = (day: AttendanceDay): string => {
    const credit = Number(day.engine_context?.work_credit || 0);
    if (!credit) return '0 công';
    return day.is_holiday || Number(day.engine_context?.holiday_credit || 0) > 0
      ? `${credit} công lễ`
      : `${credit} công`;
  };

  // ===== Day Detail Dialog =====
  const getDayFullLabel = (date: Date) => {
    const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    return `${dayNames[date.getDay()]}, ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`;
  };

  const getRequestLabel = (reg: any): { title: string; icon: string; color: string } => {
    const type = (reg.event_type || '').toUpperCase();
    const data = reg.data || {};
    const expType = (data.explanation_type || '').toUpperCase();
    const regType = (data.registration_type || type).toUpperCase();

    if (type === 'EXPLANATION') {
      const labelMap: Record<string, { title: string; icon: string; color: string }> = {
        LATE:                  { title: 'Giải trình đi muộn',       icon: '⏰', color: 'yellow' },
        EARLY_LEAVE:           { title: 'Giải trình về sớm',        icon: '🚪', color: 'yellow' },
        INCOMPLETE_ATTENDANCE: { title: 'Giải trình quên chấm công', icon: '🔔', color: 'purple' },
        MACHINE_ERROR:         { title: 'Giải trình lỗi máy chấm công', icon: '🛠️', color: 'purple' },
        BUSINESS_TRIP:         { title: 'Giải trình công tác',      icon: '✈️', color: 'blue'   },
        FIRST_DAY:             { title: 'Giải trình ngày đầu',      icon: '🌟', color: 'blue'   },
        LEAVE:                 { title: 'Giải trình nghỉ phép',     icon: '🌴', color: 'green'  },
      };
      return labelMap[expType] || { title: 'Giải trình', icon: '📝', color: 'gray' };
    }
    const typeMap: Record<string, { title: string; icon: string; color: string }> = {
      OVERTIME:   { title: 'Tăng ca',          icon: '⚡', color: 'orange' },
      EXTRA_HOURS:{ title: 'Làm thêm giờ',     icon: '⏱️', color: 'orange' },
      NIGHT_SHIFT:{ title: 'Trực tối',          icon: '🌙', color: 'indigo' },
      LIVE:       { title: 'Livestream',        icon: '🎥', color: 'pink'   },
      LIVESTREAM: { title: 'Livestream',        icon: '🎥', color: 'pink'   },
      ONLINE_WORK:{ title: 'Làm việc online',   icon: '💻', color: 'teal'  },
      LEAVE:      { title: 'Nghỉ phép tháng',   icon: '📅', color: 'green'  },
      OFF_DUTY:   { title: 'Ra trực',           icon: '🏃', color: 'green'  },
      UNAUTHORIZED_ABSENCE: { title: 'Nghỉ không phép', icon: '🚫', color: 'indigo' },
      SHIFT_CHANGE:         { title: 'Đổi ca',          icon: '🔄', color: 'blue' },
    };
    return typeMap[regType] || { title: 'Đơn', icon: '📄', color: 'gray' };
  };

  const getStatusBadge = (status: string) => {
    switch ((status || '').toUpperCase()) {
      case 'APPROVED': return { label: 'Đã duyệt', cls: 'bg-green-100 text-green-700 border border-green-200' };
      case 'PENDING':  return { label: 'Chờ duyệt', cls: 'bg-yellow-100 text-yellow-700 border border-yellow-200' };
      case 'REJECTED': return { label: 'Bị từ chối', cls: 'bg-red-100 text-red-700 border border-red-200' };
      case 'CANCELLED': return { label: 'Đã huỷ', cls: 'bg-gray-100 text-gray-500 border border-gray-200' };
      default:         return { label: status || '—', cls: 'bg-gray-100 text-gray-600 border border-gray-200' };
    }
  };

  const colorMap: Record<string, string> = {
    yellow: 'bg-yellow-50 border-yellow-200',
    purple: 'bg-purple-50 border-purple-200',
    orange: 'bg-orange-50 border-orange-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    blue:   'bg-blue-50 border-blue-200',
    pink:   'bg-pink-50   border-pink-200',
    teal:   'bg-teal-50   border-teal-200',
    green:  'bg-green-50  border-green-200',
    red:    'bg-red-50    border-red-200',
    gray:   'bg-gray-50   border-gray-200',
  };

  const getRequestStatus = (reg: any): string => String(reg?.data?.status || reg?.status || '').toUpperCase();

  const getRequestId = (reg: any): number | null => {
    // reg.id is the EmployeeEvent (calendar wrapper) ID.
    // reg.data.id is the actual approval request ID (AttendanceExplanation, RegistrationRequest, etc.)
    // We must prefer reg.data.id to match what Approvals.tsx uses.
    const rawId = reg?.data?.id ?? reg?.data?.request_id ?? reg?.request_id ?? reg?.id;
    const parsed = Number(rawId);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getRequesterId = (reg: any): number | null => {
    const rawId =
      reg?.employee_id ??
      reg?.data?.employee_id ??
      (typeof reg?.employee === 'object' ? reg.employee?.id : reg?.employee);
    const parsed = Number(rawId);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const canApproveRequest = (reg: any): boolean => {
    if (getRequestStatus(reg) !== 'PENDING') return false;
    if (typeof reg?.can_approve === 'boolean') return reg.can_approve;
    if (typeof reg?.data?.can_approve === 'boolean') return reg.data.can_approve;

    const role = String(user?.role || '').toUpperCase();
    const isAdmin =
      role === 'ADMIN' ||
      Boolean((user as any)?.is_supperuser) ||
      Boolean((user as any)?.is_superuser) ||
      Boolean((user as any)?.is_super_admin);
    const isHR = role === 'HR' || Boolean((user as any)?.is_hr);
    const isManagement = ['MANAGER', 'MANAGEMENT', 'LEADER', 'TEAM_LEAD'].includes(role);

    const currentEmployeeId = Number(
      (user as any)?.employee_id ??
      (user as any)?.employee?.id ??
      (user as any)?.id
    );
    const requesterId = getRequesterId(reg);
    if (Number.isFinite(currentEmployeeId) && requesterId === currentEmployeeId) return false;

    const directManagerId = Number(reg?.employee_manager_id ?? reg?.data?.employee_manager_id);
    const isDirectManager = Number.isFinite(currentEmployeeId) && directManagerId === currentEmployeeId;
    const directManagerApproved = Boolean(reg?.direct_manager_approved ?? reg?.data?.direct_manager_approved);
    const hrApproved = Boolean(reg?.hr_approved ?? reg?.data?.hr_approved);
    const directManagerRejected = Boolean(reg?.direct_manager_rejected ?? reg?.data?.direct_manager_rejected);
    const hrRejected = Boolean(reg?.hr_rejected ?? reg?.data?.hr_rejected);
    const requesterIsHR = Boolean(reg?.employee_is_hr ?? reg?.data?.employee_is_hr ?? reg?.is_hr ?? reg?.data?.is_hr);
    const employeeIsSeniorManager = Boolean(reg?.employee_is_senior_manager ?? reg?.data?.employee_is_senior_manager);

    if (directManagerRejected || hrRejected) return false;
    if (isAdmin) return !hrApproved;

    if (requesterIsHR) {
      return isDirectManager && !directManagerApproved;
    }

    if (isDirectManager) return !directManagerApproved;

    if (isHR) {
      if (directManagerApproved || (employeeIsSeniorManager && !reg?.employee_manager_id)) {
        return !hrApproved;
      }
      return false;
    }

    return isManagement;
  };

  // Admin/HR/Quản lý huỷ đơn (POST .../cancel/, soft-delete) để xử lý duyệt
  // nhầm — backend cho phép ở bất kỳ trạng thái (kể cả APPROVED). Không còn
  // xoá cứng (destroy() đã bị bỏ hẳn khỏi backend — yêu cầu HCNS 2026-09-17:
  // "chỉ giữ lại phần cancel").
  const canCancelAsPrivileged = (reg: any): boolean => {
    // Backend đã tính sẵn các cờ này (hrm/request_permissions.py::
    // compute_request_permissions, trả qua calendar-view) — tin cờ backend,
    // đừng đoán lại ở FE. Trước đây BE chưa bao giờ trả `can_delete` nên hai
    // dòng đầu luôn trượt và hàm rơi hẳn về đoán theo user.role; nay BE đã
    // trả cả can_delete lẫn can_cancel.
    if (typeof reg?.can_delete === 'boolean') return reg.can_delete;
    if (typeof reg?.data?.can_delete === 'boolean') return reg.data.can_delete;
    if (typeof reg?.can_cancel === 'boolean') return reg.can_cancel;
    if (typeof reg?.data?.can_cancel === 'boolean') return reg.data.can_cancel;

    // Không có cờ (API cũ / dữ liệu rút gọn) thì đoán tối thiểu. RIÊNG đơn nghỉ
    // phép và nghỉ không phép: từ 10/2026 quản lý KHÔNG còn quyền huỷ (cơ chế
    // phạt 500k — xem backend _cancel_single_event), nên không đoán cho MANAGER.
    const status = getRequestStatus(reg);
    const role = String(user?.role || '').toUpperCase();
    const t = String(
      reg?.registration_type || reg?.data?.registration_type ||
      reg?.explanation_type || reg?.data?.explanation_type || reg?.event_type || '',
    ).toUpperCase();
    const isLeaveLike = t === 'LEAVE' || t === 'UNAUTHORIZED_ABSENCE';
    const isPrivileged = isLeaveLike
      ? role === 'ADMIN' || role === 'HR'
      : role === 'ADMIN' || role === 'HR' || role === 'MANAGER';

    return isPrivileged && ['PENDING', 'APPROVED'].includes(status);
  };

  // Chủ đơn tự Sửa/Huỷ đơn CHỜ DUYỆT của chính mình — dùng đúng field
  // can_self_cancel backend đã tính sẵn (serialize_registration_event /
  // serialize_explanation_event, xem hrm/deadline_exception_models.py::
  // can_owner_self_cancel) thay vì tự suy luận lại logic hạn/duyệt ở FE.
  const canSelfEditOrCancelRequest = (reg: any): boolean => {
    if (getRequestStatus(reg) !== 'PENDING') return false;
    const requesterId = getRequesterId(reg);
    const currentUserId = Number(
      (user as any)?.employee_id ?? (user as any)?.employee?.id ?? (user as any)?.id
    );
    const isOwner = Number.isFinite(currentUserId) && requesterId === currentUserId;
    if (!isOwner) return false;
    return Boolean(reg?.can_self_cancel ?? reg?.data?.can_self_cancel);
  };

  // 1 nút "Huỷ đơn" duy nhất cho MỌI actor được phép (chủ đơn hoặc Admin/HR/
  // Quản lý) — không còn tách nút "Xoá" riêng.
  const canCancelRequest = (reg: any): boolean =>
    canSelfEditOrCancelRequest(reg) || canCancelAsPrivileged(reg);

  const refreshDialogDay = async () => {
    if (!dialogDay) return;
    const updated = await fetchCalendarData();
    const refreshedDay = (updated || []).find((item: AttendanceDay) =>
      item.date.toDateString() === dialogDay.date.toDateString()
    );
    if (refreshedDay) {
      setDialogDay(refreshedDay);
    } else {
      setDialogDay(null);
    }
  };

  const handleRequestAction = async (
    action: 'approve' | 'reject' | 'cancel',
    reg: any,
    skipDeleteConfirm = false
  ) => {
    const requestId = getRequestId(reg);
    const eventType = String(reg?.event_type || '').toUpperCase();
    // Đơn nghỉ phép tháng vẫn có event_type='EXPLANATION' (dùng chung EmployeeEvent),
    // chỉ phân biệt qua data.explanation_type='LEAVE' — phải check trước nhánh
    // 'EXPLANATION' bên dưới, nếu không sẽ luôn gọi nhầm API attendance-explanations
    // (bị exclude LEAVE ở backend) thay vì monthly-leave-requests, gây lỗi
    // "No EmployeeEvent matches the given query." khi duyệt/từ chối/xoá.
    const explanationType = String(reg?.data?.explanation_type || '').toUpperCase();
    const isLeaveRequest = eventType === 'EXPLANATION' && explanationType === 'LEAVE';
    // Đơn Nghỉ không phép NHIỀU NGÀY lưu thành nhiều EmployeeEvent riêng (mỗi
    // ngày 1 bản ghi, cùng data.request_code) — màn "Chi tiết ngày" chỉ hiện
    // đúng ngày đang xem nên duyệt/từ chối ở đây PHẢI áp dụng cho cả nhóm qua
    // request_code, nếu không các ngày khác trong cùng đơn vẫn treo PENDING dù
    // QLTT tin là đã duyệt xong cả đơn (case thực tế 2026-09-24, NV80007 xin
    // nghỉ 4 ngày liên tiếp, duyệt ở đây chỉ xong đúng 1/4 ngày).
    const regType = String(reg?.data?.registration_type || '').toUpperCase();
    const requestCode = reg?.data?.request_code;
    const startDate = reg?.data?.start_date;
    const endDate = reg?.data?.end_date;
    const isMultiDayUnauthorizedAbsence =
      eventType === 'UNAUTHORIZED_ABSENCE' || regType === 'UNAUTHORIZED_ABSENCE'
        ? !!requestCode && !!startDate && !!endDate && startDate !== endDate
        : false;

    if (!requestId) {
      setRequestActionError('Không xác định được mã đơn để xử lý.');
      return;
    }

    let note = '';
    if (action === 'reject') {
      // Popup riêng của app thay cho window.prompt: bấm Huỷ thì KHÔNG từ chối
      // (xem NotePromptDialog — case từ chối nhầm KP-202610-A1B2C3D4).
      const reason = await askNote({
        title: 'Từ chối đơn',
        message: `Bạn chắc chắn muốn từ chối ${getRequestLabel(reg).title.toLowerCase()} này? Nhân viên sẽ thấy lý do từ chối.`,
        label: 'Lý do từ chối',
        defaultValue: 'Không hợp lệ',
        confirmLabel: 'Từ chối đơn',
        variant: 'warning',
      });
      if (reason === null) return;
      note = reason || 'Không hợp lệ';
    } else if (action === 'approve') {
      note = 'Đã duyệt';
    } else if (action === 'cancel') {
      if (!skipDeleteConfirm) {
        setCancelConfirmReg(reg);
        return;
      }
    }

    setRequestActionError(null);
    setRequestActionLoadingId(`${action}-${requestId}`);

    try {
      if (action === 'approve') {
        if (isLeaveRequest) {
          await approvalService.approveMonthlyLeaveRequest(requestId, note);
        } else if (eventType === 'EXPLANATION') {
          await approvalService.approveAttendanceExplanation(requestId, note);
        } else if (eventType === 'ONLINE_WORK') {
          await approvalService.approveOnlineWorkRequest(requestId, note);
        } else if (isMultiDayUnauthorizedAbsence) {
          await approvalService.approveRegistrationRequestGroup(requestCode, note);
        } else {
          await approvalService.approveRegistrationRequest(requestId, note);
        }
      } else if (action === 'reject') {
        if (isLeaveRequest) {
          await approvalService.rejectMonthlyLeaveRequest(requestId, note);
        } else if (eventType === 'EXPLANATION') {
          await approvalService.rejectAttendanceExplanation(requestId, note);
        } else if (eventType === 'ONLINE_WORK') {
          await approvalService.rejectOnlineWorkRequest(requestId, note);
        } else if (isMultiDayUnauthorizedAbsence) {
          await approvalService.rejectRegistrationRequestGroup(requestCode, note);
        } else {
          await approvalService.rejectRegistrationRequest(requestId, note);
        }
      } else {
        // Huỷ đơn (soft-delete có log, POST .../cancel/) — cơ chế DUY NHẤT
        // để bỏ 1 đơn (không còn xoá cứng). Chủ đơn chỉ huỷ được khi còn
        // chờ duyệt; Admin/HR/Quản lý huỷ được ở bất kỳ trạng thái nào —
        // backend tự phân biệt qua is_privileged, xem canCancelRequest ở trên.
        if (isLeaveRequest) {
          await attendanceService.cancelMonthlyLeaveRequest(requestId);
        } else if (eventType === 'EXPLANATION') {
          await attendanceService.cancelAttendanceExplanation(requestId);
        } else if (eventType === 'ONLINE_WORK') {
          await approvalService.cancelOnlineWorkRequest(requestId);
        } else if (isMultiDayUnauthorizedAbsence) {
          await approvalService.cancelRegistrationRequestGroup(requestCode);
        } else {
          await approvalService.cancelRegistrationRequest(requestId);
        }
      }

      await refreshDialogDay();
    } catch (err: any) {
      const respData = err?.response?.data;
      // approve_group()/reject_group() trả kèm "skipped": [{event_date, reason}]
      // khi KHÔNG ngày nào duyệt được — trước đây chỉ hiện data.error chung
      // chung ("Không duyệt được ngày nào."), khiến QLTT không biết lý do thật
      // (vd quá hạn duyệt, HR chưa duyệt...) cho từng ngày trong nhóm.
      let msg = respData?.error || respData?.detail || 'Thao tác thất bại';
      if (Array.isArray(respData?.skipped) && respData.skipped.length > 0) {
        const details = respData.skipped
          .map((s: { event_date?: string; reason?: string }) => {
            const d = s.event_date ? s.event_date.split('-').reverse().slice(0, 2).join('/') : '';
            return d ? `${d}: ${s.reason || 'Không rõ lý do'}` : (s.reason || 'Không rõ lý do');
          })
          .join('; ');
        msg = `${msg} ${details}`;
      }
      setRequestActionError(msg);
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  const openEditRequestModal = (reg: any) => {
    setEditRequestError(null);
    setEditRequestReasonDraft(String(reg?.reason ?? reg?.data?.reason ?? ''));
    setEditRequestStartDraft(toHHMMDraft(reg?.check_in ?? reg?.data?.start_time));
    setEditRequestEndDraft(toHHMMDraft(reg?.check_out ?? reg?.data?.end_time));
    setEditRequestReg(reg);
  };

  const handleEditRequestSubmit = async () => {
    if (!editRequestReg) return;
    const requestId = getRequestId(editRequestReg);
    if (!requestId) {
      setEditRequestError('Không xác định được mã đơn để xử lý.');
      return;
    }
    const eventType = String(editRequestReg?.event_type || '').toUpperCase();
    const explanationType = String(editRequestReg?.data?.explanation_type || '').toUpperCase();
    const isLeaveRequest = eventType === 'EXPLANATION' && explanationType === 'LEAVE';

    setEditRequestSubmitting(true);
    setEditRequestError(null);
    try {
      const payload = { reason: editRequestReasonDraft };
      if (isLeaveRequest) {
        await attendanceService.updateMonthlyLeaveRequest(requestId, payload);
      } else if (eventType === 'EXPLANATION') {
        await attendanceService.updateAttendanceExplanation(requestId, payload);
      } else if (eventType === 'ONLINE_WORK') {
        await approvalService.updateOnlineWorkRequest(requestId, payload);
      } else {
        // CỐ Ý không gửi `hours` — backend tự tính lại theo giờ mới
        // (compute_overtime_hours); gửi số giờ cũ lên sẽ ghi đè sai.
        await approvalService.updateRegistrationRequest(requestId, {
          ...payload,
          ...(hasEditableTimeRange(editRequestReg)
            ? { start_time: editRequestStartDraft, end_time: editRequestEndDraft }
            : {}),
        });
      }
      setEditRequestReg(null);
      await refreshDialogDay();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.detail || 'Cập nhật thất bại';
      setEditRequestError(msg);
    } finally {
      setEditRequestSubmitting(false);
    }
  };

  // Permission: can edit attendance (admin always can, or user with can_edit_attendance)
  const userRole = (user?.role || '').toUpperCase();
  const canEditAttendance = !!(
    userRole === 'ADMIN' ||
    (user as any)?.is_supperuser ||
    (user as any)?.is_superuser ||
    user?.is_super_admin ||
    user?.employee_permission?.can_edit_attendance ||
    (user as any)?.can_edit_attendance
  );

  // Handle edit attendance submission
  const handleEditAttendance = async () => {
    if (!dialogDay || !employeeId) return;
    setEditSubmitting(true);
    setEditError(null);
    setEditSuccess(false);
    try {
      const d = dialogDay.date;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await attendanceService.editAttendance({
        employee_id: employeeId,
        date: dateStr,
        check_in: editCheckIn || null,
        check_out: editCheckOut || null,
      });
      setEditSuccess(true);
      setShowEditForm(false);
      // Refresh calendar data
      fetchCalendarData();
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        'Có lỗi xảy ra, vui lòng thử lại.';
      setEditError(msg);
    } finally {
      setEditSubmitting(false);
    }
  };

  const DayDetailDialog = () => {
    if (!dialogDay) return null;
    const day = dialogDay;
    const allRegs = (day.registrations || []).filter((r: any) => {
      const t = (r.event_type || '').toUpperCase();
      // UNAUTHORIZED_ABSENCE/SHIFT_CHANGE thiếu ở đây khiến khung "Đơn trong ngày"
      // báo "Không có đơn..." dù ngày đó thực sự có đơn Nghỉ không phép/Đổi ca đang
      // chờ duyệt hoặc đã duyệt — cùng dạng lỗi (whitelist quên cập nhật) đã gặp ở
      // pendingRequests/categorizeDuyetDonList/DUYET_DON_EVENT_TYPES.
      return [
        'EXPLANATION','OVERTIME','EXTRA_HOURS','NIGHT_SHIFT',
        'LIVE','LIVESTREAM','ONLINE_WORK','LEAVE','OFF_DUTY',
        'UNAUTHORIZED_ABSENCE','SHIFT_CHANGE',
      ].includes(t);
    });
    const pendingRegs = allRegs.filter((r: any) => getRequestStatus(r) === 'PENDING');
    const approvedRegs = allRegs.filter((r: any) => getRequestStatus(r) === 'APPROVED');
    // Đơn đã huỷ vẫn hiển thị ở đây (khác "Lịch sử đơn tháng" — nơi đã ẩn để
    // tránh trùng lặp) vì khung "Chi tiết ngày" này còn được nhúng trong
    // trang Chốt công (WorkFinalization.tsx) để quản lý/HR đối chiếu đầy đủ
    // những gì đã xảy ra trong ngày, kể cả đơn đã bị huỷ.
    const cancelledRegs = allRegs.filter((r: any) => getRequestStatus(r) === 'CANCELLED');

    const isMorningTime = (time: string | null) => !!time && (parseInt(time.split(':')[0]) < 12 || time === '12:00');
    const isAfternoonTime = (time: string | null) => !!time && parseInt(time.split(':')[0]) >= 12 && parseInt(time.split(':')[0]) < 18;
    const isEveningTime = (time: string | null) => !!time && parseInt(time.split(':')[0]) >= 18;

    const morningIn  = isMorningTime(day.morningData?.check_in)   ? day.morningData?.check_in   : '';
    const morningOut = isMorningTime(day.morningData?.check_out)  ? day.morningData?.check_out  : '';
    const afternoonIn  = isAfternoonTime(day.afternoonData?.check_in)  ? day.afternoonData?.check_in  : '';
    const afternoonOut = isAfternoonTime(day.afternoonData?.check_out) ? day.afternoonData?.check_out : '';
    const eveningIn  = isEveningTime(day.eveningData?.check_in)  ? day.eveningData?.check_in  : '';
    const eveningOut = isEveningTime(day.eveningData?.check_out) ? day.eveningData?.check_out : '';

    const shifts = [
      { label: 'Sáng',  status: day.morning,    inn: morningIn,   out: morningOut   },
      { label: 'Chiều', status: day.afternoon,  inn: afternoonIn, out: afternoonOut },
      { label: 'Tối',   status: day.evening,    inn: eveningIn,   out: eveningOut   },
    ].filter(s => s.inn || s.out || s.status === 'holiday');

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        onClick={() => setDialogDay(null)}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
            <div>
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">Chi tiết ngày</p>
              <h3 className="text-base font-bold text-gray-900">{getDayFullLabel(day.date)}</h3>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {canEditAttendance && employeeId && (
                <button
                  onClick={() => {
                    const next = !showEditForm;
                    setShowEditForm(next);
                    setEditError(null);
                    setEditSuccess(false);
                    if (next) {
                      setEditCheckIn(morningIn || afternoonIn || eveningIn || '');
                      setEditCheckOut(eveningOut || afternoonOut || morningOut || '');
                    }
                  }}
                  className={`p-1.5 rounded-lg transition-colors ${showEditForm ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                  title="Sửa check-in / check-out"
                >
                  <PencilIcon className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => setDialogDay(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="px-5 py-4 space-y-5">

            {/* Edit Attendance Form */}
            {showEditForm && canEditAttendance && employeeId && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">Sửa check-in / check-out</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Check-in</label>
                    <input
                      type="time"
                      value={editCheckIn}
                      onChange={e => setEditCheckIn(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Check-out</label>
                    <input
                      type="time"
                      value={editCheckOut}
                      onChange={e => setEditCheckOut(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>
                {editError && (
                  <p className="text-xs text-red-600 mb-2">{editError}</p>
                )}
                {editSuccess && (
                  <p className="text-xs text-green-600 mb-2 flex items-center gap-1">
                    <CheckIcon className="h-3.5 w-3.5" /> Cập nhật thành công!
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setEditCheckIn('');
                      setEditCheckOut('');
                    }}
                    disabled={editSubmitting}
                    className="mr-auto px-3 py-1.5 text-xs font-semibold text-red-600 bg-white border border-red-100 rounded-lg hover:bg-red-50 disabled:opacity-50 flex items-center gap-1"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Đặt trống
                  </button>
                  <button
                    onClick={() => { setShowEditForm(false); setEditError(null); setEditSuccess(false); }}
                    disabled={editSubmitting}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleEditAttendance}
                    disabled={editSubmitting}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {editSubmitting ? (
                      <>
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Đang lưu...
                      </>
                    ) : (
                      <>
                        <CheckIcon className="h-3.5 w-3.5" />
                        Lưu
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Work credit summary */}
            <div className={`flex items-center gap-3 p-3 rounded-xl border ${getDayBadgeStyle(day)} bg-opacity-30`}>
              <span className="text-xl">
                {day.is_holiday ? '🎉' : day.is_leave ? '🌴' : day.engine_context?.work_credit >= 1 ? '✅' : day.engine_context?.work_credit >= 0.5 ? '🟡' : day.dayStatusSummary?.has_pending_request ? '⏳' : '❌'}
              </span>
              <div className="flex-1">
                <p className={`text-sm font-bold ${getDayBadgeStyle(day).includes('green') ? 'text-green-700' : getDayBadgeStyle(day).includes('red') ? 'text-red-700' : 'text-gray-700'}`}>
                  {getDayBadgeText(day)}
                </p>
                {day.engine_context?.work_credit !== undefined && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Hệ số công: <span className="font-bold text-green-600">{getWorkCreditLabel(day)}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Shifts / Check-in Check-out */}
            {shifts.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Chấm công</p>
                <div className="space-y-2">
                  {shifts.map((shift, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(shift.status)}`} />
                        <span className="text-sm font-semibold text-gray-700">{shift.label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-sm text-gray-800">
                        {shift.inn && (
                          <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-lg font-bold text-xs">
                            Vào {shift.inn}
                          </span>
                        )}
                        {shift.out && shift.inn !== shift.out && (
                          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-lg font-bold text-xs">
                            Ra {shift.out}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chế độ con nhỏ */}
            {Number(day.engine_context?.child_care_minutes) > 0 && (
              <div className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-xs text-pink-800">
                <p className="font-semibold">Chế độ con nhỏ</p>
                <p className="mt-1">
                  Ngày này được đi muộn tối đa {day.engine_context.child_care_minutes} phút và về sớm tối đa{' '}
                  {day.engine_context.child_care_minutes} phút mà không tính lỗi. Chỉ phần vượt mới tính là đi muộn / về sớm.
                </p>
              </div>
            )}

            {/* Late / Early / Penalty */}
            {(Number(day.engine_context?.late_minutes) > 0 ||
              Number(day.engine_context?.early_leave_minutes) > 0 ||
              (day.engine_context?.penalty_amount || 0) > 0) && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Vi phạm</p>
                <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 space-y-2">
                  {Number(day.engine_context?.late_minutes) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-yellow-800 font-semibold">
                        <ClockIcon className="h-4 w-4 text-yellow-500" /> Đi muộn
                      </div>
                      <span className="font-bold text-yellow-900 bg-yellow-100 px-2 py-0.5 rounded-lg text-xs">
                        {day.engine_context.late_minutes} phút
                      </span>
                    </div>
                  )}
                  {Number(day.engine_context?.early_leave_minutes) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-yellow-800 font-semibold">
                        <ClockIcon className="h-4 w-4 text-yellow-500" /> Về sớm
                      </div>
                      <span className="font-bold text-yellow-900 bg-yellow-100 px-2 py-0.5 rounded-lg text-xs">
                        {day.engine_context.early_leave_minutes} phút
                      </span>
                    </div>
                  )}
                  {(day.engine_context?.penalty_amount || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm border-t border-yellow-200 pt-2 mt-1">
                      <div className="flex items-center gap-2 text-red-700 font-bold">
                        <BoltIcon className="h-4 w-4 text-red-500" /> Tiền phạt
                      </div>
                      <span className="font-black text-red-700 bg-red-100 px-2 py-0.5 rounded-lg text-xs">
                        {(day.engine_context.penalty_amount || 0).toLocaleString('vi-VN')} VNĐ
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* All requests submitted this day */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                Đơn trong ngày
              </p>
              {!!requestActionError && (
                <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {requestActionError}
                </div>
              )}

              {pendingRegs.length === 0 && approvedRegs.length === 0 && cancelledRegs.length === 0 ? (
                <div className="text-center py-6 rounded-xl border border-dashed border-gray-200 bg-gray-50">
                  <DocumentTextIcon className="h-8 w-8 text-gray-300 mx-auto mb-1" />
                  <p className="text-sm text-gray-400">Không có đơn chờ duyệt hoặc đã duyệt trong ngày này</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {[
                    { title: `Đơn chờ duyệt (${pendingRegs.length})`, records: pendingRegs, headerCls: 'text-yellow-700' },
                    { title: `Đơn đã duyệt (${approvedRegs.length})`, records: approvedRegs, headerCls: 'text-green-700' },
                    ...(cancelledRegs.length > 0
                      ? [{ title: `Đơn đã huỷ (${cancelledRegs.length})`, records: cancelledRegs, headerCls: 'text-gray-500' }]
                      : []),
                  ].map((section) => (
                    <div key={section.title}>
                      <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${section.headerCls}`}>
                        {section.title}
                      </p>
                      {section.records.length === 0 ? (
                        <div className="text-xs text-gray-400 italic bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                          Không có dữ liệu
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {section.records.map((reg: any, i: number) => {
                            const info = getRequestLabel(reg);
                            const data = reg.data || {};
                            const type = (reg.event_type || '').toUpperCase();
                            const regType = (data.registration_type || type).toUpperCase();
                            const statusBadge = getStatusBadge(data.status);
                            const cardCls = colorMap[info.color] || 'bg-gray-50 border-gray-200';
                            const requestId = getRequestId(reg);
                            const approveLoading = requestActionLoadingId === `approve-${requestId}`;
                            const rejectLoading = requestActionLoadingId === `reject-${requestId}`;
                            const cancelLoading = requestActionLoadingId === `cancel-${requestId}`;
                            return (
                              <div key={`${section.title}-${requestId || i}`} className={`rounded-xl border px-4 py-3 ${cardCls}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{info.icon}</span>
                                    <span className="text-sm font-bold text-gray-800">{info.title}</span>
                                  </div>
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${statusBadge.cls}`}>
                                    {statusBadge.label}
                                  </span>
                                </div>
                                <div className="mt-2.5">
                                  <div className="space-y-1 text-xs text-gray-600 mb-2">
                                    {data.start_time && (
                                      <p><span className="font-semibold text-gray-700">Thời gian bắt đầu:</span> {data.start_time}</p>
                                    )}
                                    {data.end_time && (
                                      <p><span className="font-semibold text-gray-700">Thời gian kết thúc:</span> {data.end_time}</p>
                                    )}
                                    {data.hours && (
                                      <p><span className="font-semibold text-gray-700">Số giờ:</span> {data.hours}h</p>
                                    )}
                                    {data.expected_status && (
                                      <p><span className="font-semibold text-gray-700">Hình thức:</span>{' '}
                                        {({
                                          PRESENT:              'Đủ công',
                                          FULL_DAY:             'Cả ngày',
                                          HALF_DAY:             'Nửa ngày',
                                          ABSENT:               'Vắng mặt',
                                          LATE:                 'Đi muộn',
                                          EARLY_LEAVE:          'Về sớm',
                                          LATE_EARLY:           'Đi muộn & Về sớm',
                                          FORGOT_CC:            'Quên chấm công',
                                          INCOMPLETE_ATTENDANCE:'Thiếu công',
                                          LEAVE:                'Nghỉ phép',
                                          HOLIDAY:              'Ngày lễ',
                                          BUSINESS_TRIP:        'Công tác',
                                          ONLINE_WORK:          'Làm việc online',
                                          OVERTIME:             'Tăng ca',
                                          NIGHT_SHIFT:          'Trực tối',
                                          EXTRA_HOURS:          'Làm thêm giờ',
                                        } as Record<string, string>)[data.reason?.toLowerCase().includes('checkpage') ? 'ABSENT' : data.expected_status] || data.expected_status}
                                        {data.reason?.toLowerCase().includes('checkpage') && ' (CheckPage)'}
                                      </p>
                                    )}
                                    {data.approved_by_name && (
                                      <p className="text-green-700"><span className="font-semibold">Duyệt bởi:</span> {data.approved_by_name}</p>
                                    )}
                                  </div>

                                  <div className="space-y-2">
                                    {data.reason && (
                                      <div className="bg-white/60 border border-gray-100 rounded-md p-2 text-xs">
                                        {(regType === 'NIGHT_SHIFT' || regType === 'ONLINE_WORK') && (
                                          <span className="font-semibold text-gray-700 block mb-1">
                                            Ca: {regType === 'NIGHT_SHIFT'
                                                  ? (data.reason.toLowerCase().includes('checkpage') ? 'CheckPage' : (data.reason.toLowerCase().includes('chiều tối') ? 'Chiều tối' : (data.reason.toLowerCase().includes('gãy') ? 'Ca gãy' : 'Trực tối')))
                                                  : (data.reason.toLowerCase().includes('checkpage') ? 'CheckPage' : (data.reason.toLowerCase().includes('sáng') ? 'Sáng' : (data.reason.toLowerCase().includes('chiều') ? 'Chiều' : (data.reason.toLowerCase().includes('cả ngày') ? 'Cả ngày' : 'Online'))))}
                                          </span>
                                        )}
                                        <p className="text-gray-600 italic leading-relaxed">
                                          <span className="font-semibold text-gray-700 not-italic mr-1.5">Nội dung:</span>
                                          {data.reason.replace(/^(Làm online checkpage|Làm online sáng|Làm online chiều|Làm online cả ngày|Làm việc online|Trực tối|Ca CheckPage|Ca chiều tối|Ca gãy)(:\s*)?/i, '')}
                                        </p>
                                      </div>
                                    )}
                                    {data.note && (
                                      <div className="bg-blue-50/50 border border-blue-50/50 rounded-md p-2 text-xs">
                                        <span className="font-semibold text-blue-800 block mb-0.5">Ghi chú:</span>
                                        <p className="text-blue-700 italic leading-relaxed">{data.note}</p>
                                      </div>
                                    )}
                                    {data.rejected_reason && (
                                      <div className="bg-red-50/50 border border-red-100 rounded-md p-2 text-xs">
                                        <span className="font-semibold text-red-700 block mb-0.5">Lý do từ chối:</span>
                                        <p className="text-red-700 italic leading-relaxed">{data.rejected_reason}</p>
                                      </div>
                                    )}
                                  </div>

                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {canApproveRequest(reg) && (
                                      <>
                                        <button
                                          onClick={() => handleRequestAction('approve', reg)}
                                          disabled={approveLoading || !!requestActionLoadingId}
                                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                          {approveLoading ? 'Đang duyệt...' : 'Phê duyệt'}
                                        </button>
                                        <button
                                          onClick={() => handleRequestAction('reject', reg)}
                                          disabled={rejectLoading || !!requestActionLoadingId}
                                          className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                          {rejectLoading ? 'Đang xử lý...' : 'Từ chối'}
                                        </button>
                                      </>
                                    )}
                                    {canSelfEditOrCancelRequest(reg) && (
                                      <button
                                        onClick={() => openEditRequestModal(reg)}
                                        disabled={!!requestActionLoadingId}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        <PencilIcon className="h-3.5 w-3.5" />
                                        Sửa
                                      </button>
                                    )}
                                    {canCancelRequest(reg) && (
                                      <button
                                        onClick={() => handleRequestAction('cancel', reg)}
                                        disabled={cancelLoading || !!requestActionLoadingId}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        {!cancelLoading && <TrashIcon className="h-3.5 w-3.5" />}
                                        {cancelLoading ? 'Đang huỷ...' : 'Huỷ đơn'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {cancelConfirmReg && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
              onClick={() => setCancelConfirmReg(null)}
            >
              <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-900">Xác nhận huỷ đơn</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Bạn có chắc muốn huỷ đơn
                    {' '}
                    <span className="font-semibold text-red-600">
                      {getRequestLabel(cancelConfirmReg).title.toLowerCase()}
                    </span>
                    ? Đơn sẽ chuyển sang trạng thái Đã huỷ, không tính công cho ngày này nữa.
                  </p>
                </div>
                <div className="px-4 py-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setCancelConfirmReg(null)}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Đóng
                  </button>
                  <button
                    onClick={() => {
                      const target = cancelConfirmReg;
                      setCancelConfirmReg(null);
                      handleRequestAction('cancel', target, true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Huỷ đơn
                  </button>
                </div>
              </div>
            </div>
          )}

          {editRequestReg && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
              onClick={() => (editRequestSubmitting ? null : setEditRequestReg(null))}
            >
              <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-900">
                    Sửa đơn {getRequestLabel(editRequestReg).title.toLowerCase()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Chỉ sửa được khi đơn còn chờ duyệt và chưa quá hạn tạo đơn.
                  </p>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {hasEditableTimeRange(editRequestReg) && (
                    <div className="grid grid-cols-2 gap-2 pb-1">
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Giờ bắt đầu</label>
                        <input
                          type="time"
                          value={editRequestStartDraft}
                          onChange={(e) => setEditRequestStartDraft(e.target.value)}
                          className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Giờ kết thúc</label>
                        <input
                          type="time"
                          value={editRequestEndDraft}
                          onChange={(e) => setEditRequestEndDraft(e.target.value)}
                          className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <p className="col-span-2 text-[11px] text-gray-500">
                        Số giờ được tính lại tự động theo giờ mới.
                      </p>
                    </div>
                  )}
                  <label className="text-xs font-semibold text-gray-700">Lý do</label>
                  <textarea
                    value={editRequestReasonDraft}
                    onChange={(e) => setEditRequestReasonDraft(e.target.value)}
                    rows={4}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Nhập lý do..."
                  />
                  {editRequestError && (
                    <p className="text-xs text-red-600">{editRequestError}</p>
                  )}
                </div>
                <div className="px-4 py-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setEditRequestReg(null)}
                    disabled={editRequestSubmitting}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                  >
                    Đóng
                  </button>
                  <button
                    onClick={handleEditRequestSubmit}
                    disabled={editRequestSubmitting || !editRequestReasonDraft.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {editRequestSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 animate-pulse">
        <div className="flex justify-between items-center mb-6">
          <div className="h-8 w-48 bg-gray-100 rounded-lg"></div>
          <div className="h-8 w-24 bg-gray-100 rounded-lg"></div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-50 rounded-lg border border-gray-100"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
    {/* Day Detail Dialog */}
    <DayDetailDialog />
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Calendar header */}
      <div className="flex justify-between items-center px-2.5 py-3 md:px-6 md:py-4 border-b border-gray-100">
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={goToPreviousMonth}
            className="p-1.5 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
            title="Tháng trước"
          >
            <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
          </button>
          <h2 className="text-base md:text-xl font-bold text-gray-900 min-w-[130px] md:min-w-[160px] text-center">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h2>
          <button
            onClick={goToNextMonth}
            className="p-1.5 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
            title="Tháng sau"
          >
            <ChevronRightIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <button
          onClick={goToToday}
          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 active:bg-primary-800 transition-colors font-medium"
        >
          Hôm nay
        </button>
      </div>

      {/* Legend - compact chips */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-2.5 py-2.5 md:px-6 md:py-3 border-b border-gray-100 bg-gray-50/50">
        {[
          { color: 'bg-green-500', label: 'Đủ công' },
          { color: 'bg-orange-500', label: 'Nửa công' },
          { color: 'bg-red-500', label: 'Vắng' },
          { color: 'bg-yellow-500', label: 'Đi muộn/Về sớm' },
          { color: 'bg-purple-500', label: 'Quên CC' },
          { color: 'bg-gray-300', label: 'Nghỉ' },
          { color: 'bg-blue-300', label: 'Lễ' },
          { color: 'bg-gray-400', label: 'Trống' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 md:w-2.5 md:h-2.5 rounded-full ${item.color}`} />
            <span className="text-[10px] md:text-xs text-gray-500">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Explanation Quota Info - Professional Display */}
      {engineSummary && engineSummary.explanation_quota_max !== undefined && (
        <div className="px-2.5 py-2.5 md:px-6 md:py-3 border-b border-gray-100 bg-amber-50/30 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="p-1.5 md:p-2 bg-amber-100 rounded-xl text-amber-600 shadow-sm border border-amber-200">
              <BoltIcon className="h-4 w-4 md:h-5 md:w-5" />
            </div>
            <div>
              <p className="text-[9px] md:text-[11px] font-black text-amber-800 uppercase tracking-widest leading-tight">Hạn mức giải trình tháng {currentDate.getMonth() + 1}</p>
              <div className="flex items-center gap-1.5 md:gap-2 mt-0.5">
                <span className="text-base md:text-xl font-black text-amber-900 leading-none">
                  {engineSummary.explanation_quota_used}
                  <span className="text-xs md:text-sm font-bold text-amber-500 mx-0.5 md:mx-1">/</span>
                  {engineSummary.explanation_quota_max}
                </span>
                <span className="text-[8px] md:text-[10px] font-bold text-amber-600 bg-amber-100/50 px-1.5 py-0.5 rounded-md border border-amber-200/50 leading-none">
                  đã dùng
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] md:tracking-[0.2em] leading-tight">Còn lại</span>
              <span className={`text-sm md:text-lg font-black mt-0.5 leading-none ${
                engineSummary.explanation_quota_remaining > 0 
                ? 'text-green-600' 
                : 'text-red-500'
              }`}>
                {engineSummary.explanation_quota_remaining} lượt
              </span>
            </div>
            <div className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center rounded-xl md:rounded-2xl bg-white shadow-sm border border-slate-100 ring-1 ring-slate-200/50">
              <div className="relative w-7 h-7 md:w-10 md:h-10">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50" cy="50" r="40"
                    className="stroke-amber-100 fill-none"
                    strokeWidth="8"
                    pathLength="100"
                  />
                  <circle
                    cx="50" cy="50" r="40"
                    className={`${engineSummary.explanation_quota_remaining > 0 ? 'stroke-amber-500' : 'stroke-red-500'} fill-none transition-all duration-1000 ease-out`}
                    strokeWidth="8"
                    strokeDasharray="100"
                    strokeDashoffset={Math.max(0, 100 - ((engineSummary.explanation_quota_used / engineSummary.explanation_quota_max) * 100))}
                    strokeLinecap="round"
                    pathLength="100"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[8px] md:text-[10px] font-black text-amber-700">
                  {Math.min(100, Math.round((engineSummary.explanation_quota_used / engineSummary.explanation_quota_max) * 100))}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hạn mức theo từng loại: số đã dùng / tối đa của từng giỏ */}
      {engineSummary?.explanation_quota_mode === 'PER_TYPE' && engineSummary.explanation_quota_by_type && (
        <div className="px-2.5 pb-2.5 md:px-6 md:pb-3 border-b border-gray-100 bg-amber-50/30 flex flex-wrap items-center gap-2">
          {engineSummary.explanation_quota_shared ? (
            <span className="text-[10px] md:text-xs font-semibold text-amber-700">
              {engineSummary.is_manager_combined_quota ? 'Rổ gộp: ' : ''}dùng chung cho Đi muộn / Về sớm / Quên chấm công
            </span>
          ) : (
            ([['LATE', 'Đi muộn'], ['EARLY_LEAVE', 'Về sớm'], ['INCOMPLETE_ATTENDANCE', 'Quên chấm công']] as const).map(([key, label]) => {
              const q = engineSummary.explanation_quota_by_type[key];
              if (!q) return null;
              return (
                <span
                  key={key}
                  className={`rounded-full border px-2 py-0.5 text-[10px] md:text-xs font-semibold ${
                    q.remaining > 0 ? 'border-amber-200 bg-white text-amber-800' : 'border-red-200 bg-red-50 text-red-600'
                  }`}
                >
                  {label}: {q.used}/{q.max} lần
                </span>
              );
            })
          )}
        </div>
      )}

      <div className="p-2.5 md:p-5">
        {/* ===== DESKTOP: Calendar Grid (md+) ===== */}
        <div className="hidden md:block">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {dayNames.map((day, index) => (
              <div
                key={index}
                className={`text-center text-xs font-semibold uppercase tracking-wider py-2 rounded-lg
                  ${index >= 5 ? 'text-red-400 bg-red-50/50' : 'text-gray-400'}`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1.5">
            {emptyCells.map((_, index) => (
              <div key={`empty-${index}`} />
            ))}

            {attendanceData.map((day, index) => {
              const isToday = day.date.toDateString() === new Date().toDateString();
              const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
              const hasData = dayHasData(day);

              return (
                <div
                  key={index}
                  onClick={() => {
                    if (shouldShowInternal) {
                      setDialogDay(day);
                    }
                    if (onDateClick) onDateClick(day.date, day);
                  }}
                  className={`group relative flex flex-col rounded-xl p-2 transition-all duration-200 cursor-pointer min-h-[120px]
                    hover:shadow-lg hover:-translate-y-0.5
                    ${isToday
                      ? 'ring-2 ring-primary-500 bg-primary-50/40 shadow-sm'
                      : day.dayStatusSummary?.display_color === 'green'
                        ? 'ring-2 ring-green-400 bg-green-50/30'
                      : day.dayStatusSummary?.display_color === 'orange'
                        ? 'ring-2 ring-orange-300 bg-orange-50/30'
                      : (day.dayStatusSummary?.display_color === 'purple' || day.engine_context?.is_incomplete)
                        ? 'ring-2 ring-purple-400 bg-purple-50/30'
                      : day.dayStatusSummary?.display_color === 'red'
                        ? 'ring-2 ring-red-200 bg-red-50/30'
                      : day.dayStatusSummary?.display_color === 'blue'
                        ? 'ring-2 ring-blue-300 bg-blue-50/30'
                      : (Number(day.engine_context?.late_minutes) > 0 || Number(day.engine_context?.early_leave_minutes) > 0)
                        ? 'ring-2 ring-yellow-300 bg-yellow-50/30'
                      : 'border border-gray-200 bg-gray-50/50'}
                  `}
                >
                  {/* Date + work coefficient */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-sm font-bold leading-none
                        ${isToday
                          ? 'bg-primary-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs'
                          : isWeekend ? 'text-red-500' : 'text-gray-800'}`}
                    >
                      {day.date.getDate()}
                    </span>
                    {day.engine_context?.work_credit !== undefined && day.engine_context.work_credit > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-sm border ${
                        day.engine_context.work_credit >= 1.0 
                          ? 'text-green-600 bg-green-50 border-green-100/50' 
                          : 'text-orange-600 bg-orange-50 border-orange-100/50'
                      }`}>
                        {getWorkCreditLabel(day)}
                      </span>
                    )}
                  </div>

                  {hasData ? (
                    <>
                      {/* Shift rows - Sáng, Chiều, Tối mapped from backend shifts */}
                      <div className="space-y-1 mb-1.5">
                        {(() => {
                          const isMorningTime = (time: string | null) => {
                            if (!time) return false;
                            const h = parseInt(time.split(':')[0]);
                            return h < 12 || time === '12:00';
                          };
                          const isAfternoonTime = (time: string | null) => {
                            if (!time) return false;
                            const h = parseInt(time.split(':')[0]);
                            return h >= 12 && h < 18;
                          };
                          const isEveningTime = (time: string | null) => {
                            if (!time) return false;
                            const h = parseInt(time.split(':')[0]);
                            return h >= 18;
                          };

                          const morningIn = isMorningTime(day.morningData?.check_in) ? day.morningData?.check_in : '';
                          const morningOut = isMorningTime(day.morningData?.check_out) ? day.morningData?.check_out : '';

                          const afternoonIn = isAfternoonTime(day.afternoonData?.check_in) ? day.afternoonData?.check_in : '';
                          const afternoonOut = isAfternoonTime(day.afternoonData?.check_out) ? day.afternoonData?.check_out : '';

                          const eveningIn = isEveningTime(day.eveningData?.check_in) ? day.eveningData?.check_in : '';
                          const eveningOut = isEveningTime(day.eveningData?.check_out) ? day.eveningData?.check_out : '';

                          const morningInfo = {
                            in: morningIn,
                            out: morningOut,
                            hasIn: !!morningIn,
                            hasOut: !!morningOut
                          };
                          const afternoonInfo = {
                            in: afternoonIn,
                            out: afternoonOut,
                            hasIn: !!afternoonIn,
                            hasOut: !!afternoonOut
                          };
                          const eveningInfo = {
                            in: eveningIn,
                            out: eveningOut,
                            hasIn: !!eveningIn,
                            hasOut: !!eveningOut
                          };

                          return [
                            { key: 'MORNING', label: 'Sáng', status: day.morning, info: morningInfo },
                            { key: 'AFTERNOON', label: 'Chiều', status: day.afternoon, info: afternoonInfo },
                            { key: 'EVENING', label: 'Tối', status: day.evening, info: eveningInfo },
                          ].map((shift) => (
                            <div key={shift.key} className="flex items-center justify-between min-h-[16px]">
                              <div className="flex items-center gap-1 overflow-hidden">
                                <div className={`w-2 h-2 shrink-0 rounded-full ${getStatusColor(shift.status)}`} />
                                <span className="text-[10px] text-gray-500 truncate">{shift.label}</span>
                              </div>
                              <div className="flex gap-1 shrink-0 items-center">
                                {shift.info.hasIn && (
                                  <span className="text-[10px] font-mono text-gray-700 font-bold">
                                    {shift.info.in}
                                  </span>
                                )}
                                {shift.info.hasIn && shift.info.hasOut && shift.info.in !== shift.info.out && (
                                  <span className="text-[9px] text-gray-300">|</span>
                                )}
                                {shift.info.hasOut && shift.info.in !== shift.info.out && (
                                  <span className="text-[10px] font-mono text-gray-700 font-bold">
                                    {shift.info.out}
                                  </span>
                                )}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>

                    </>
                  ) : null}

                  {/* Penalty info + Status badge - always stick together at bottom */}
                  <div className="mt-auto pt-1.5 space-y-1">
                    {hasData && (Number(day.engine_context?.late_minutes) > 0 ||
                      Number(day.engine_context?.early_leave_minutes) > 0 ||
                      (day.engine_context?.penalty_amount || 0) > 0) && (
                        <div className={`p-1.5 rounded-lg border text-[9px] space-y-0.5 ${getInfoBoxStyle(day)}`}>
                          {Number(day.engine_context.late_minutes) > 0 && (
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="text-yellow-700 font-medium">Đi muộn:</span>
                              <span className="font-bold text-yellow-800 text-right">{day.engine_context.late_minutes} phút</span>
                            </div>
                          )}
                          {Number(day.engine_context.early_leave_minutes) > 0 && (
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="text-yellow-700 font-medium">Về sớm:</span>
                              <span className="font-bold text-yellow-800 text-right">{day.engine_context.early_leave_minutes} phút</span>
                            </div>
                          )}
                          {(day.engine_context?.penalty_amount || 0) > 0 && (
                            <div className="flex flex-wrap items-baseline justify-between pt-0.5 border-t border-red-200 mt-0.5 overflow-hidden">
                              <span className="text-red-600 font-black">Phạt:</span>
                              <span className="font-black text-red-700">
                                {(day.engine_context.penalty_amount || 0).toLocaleString('vi-VN')} VNĐ
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full text-center truncate ${getDayBadgeStyle(day)}`}>
                      {getDayBadgeText(day)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== MOBILE: List View (<md) ===== */}
        <div className="md:hidden space-y-2.5">
          {attendanceData.map((day, index) => {
            const isToday = day.date.toDateString() === new Date().toDateString();
            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
            const hasData = dayHasData(day);

            return (
              <div
                key={index}
                onClick={() => {
                  if (shouldShowInternal) {
                    setDialogDay(day);
                  }
                  if (onDateClick) onDateClick(day.date, day);
                }}
                className={`flex flex-col gap-4 p-4 rounded-[20px] cursor-pointer transition-all shadow-sm border
                  ${isToday
                    ? 'ring-2 ring-primary-500 bg-primary-50/50'
                    : day.dayStatusSummary?.display_color === 'green'
                      ? 'border-green-200 bg-green-50/20'
                      : (day.dayStatusSummary?.display_color === 'purple' || day.engine_context?.is_incomplete)
                        ? 'border-purple-200 bg-purple-50/20'
                        : 'border-slate-100 bg-white hover:bg-slate-50'}`}
              >
                {/* --- Row 1: Header (Identity) --- */}
                <div className="flex items-center justify-between gap-4">
                  {/* Date Block Left */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex flex-col items-center justify-center w-12 h-12 rounded-2xl shrink-0 shadow-sm border
                        ${isToday
                          ? 'bg-primary-600 text-white border-primary-400'
                          : isWeekend
                            ? 'bg-rose-50 text-rose-500 border-rose-100'
                            : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                    >
                      <span className="text-xl font-black leading-none">{day.date.getDate()}</span>
                      <span className="text-[9px] font-black uppercase tracking-widest mt-1 opacity-80">
                        {getDayNameFull(day.date.getDay())}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      {/* Status Badge */}
                      <div className={`text-[11px] font-black px-3 py-1 rounded-full shadow-sm w-fit ${getDayBadgeStyle(day)}`}>
                        {getDayBadgeText(day)}
                      </div>

                      {/* Work Credit Pill */}
                      {day.engine_context?.work_credit !== undefined && day.engine_context.work_credit > 0 && (
                        <div className={`text-[10px] font-black flex items-center gap-1 ${
                          day.engine_context.work_credit >= 1.0 ? 'text-green-500' : 'text-orange-500'
                        }`}>
                          <div className={`w-1.5 h-1.5 rounded-full animate-blink ${
                            day.engine_context.work_credit >= 1.0 ? 'bg-green-500' : 'bg-orange-500'
                          }`} />
                            {getWorkCreditLabel(day)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Subtle Icon on top right */}
                  <div className="opacity-10">
                    <CalendarDaysIcon className="h-8 w-8 text-slate-400" />
                  </div>
                </div>

                {/* --- Row 2: Attendance Details (Timeline) --- */}
                {hasData ? (
                  <div className="flex flex-col gap-3 bg-slate-50/50 p-3 rounded-2xl border border-slate-100/50">
                    {(() => {
                      const isMorningTime = (time: string | null) => {
                        if (!time) return false;
                        const h = parseInt(time.split(':')[0]);
                        return h < 12 || time === '12:00';
                      };
                      const isAfternoonTime = (time: string | null) => {
                        if (!time) return false;
                        const h = parseInt(time.split(':')[0]);
                        return h >= 12 && h < 18;
                      };
                      const isEveningTime = (time: string | null) => {
                        if (!time) return false;
                        const h = parseInt(time.split(':')[0]);
                        return h >= 18;
                      };

                      const morningIn = isMorningTime(day.morningData?.check_in) ? day.morningData?.check_in : '';
                      const morningOut = isMorningTime(day.morningData?.check_out) ? day.morningData?.check_out : '';

                      const afternoonIn = isAfternoonTime(day.afternoonData?.check_in) ? day.afternoonData?.check_in : '';
                      const afternoonOut = isAfternoonTime(day.afternoonData?.check_out) ? day.afternoonData?.check_out : '';

                      const eveningIn = isEveningTime(day.eveningData?.check_in) ? day.eveningData?.check_in : '';
                      const eveningOut = isEveningTime(day.eveningData?.check_out) ? day.eveningData?.check_out : '';

                      const morningInfo = {
                        in: morningIn,
                        out: morningOut,
                        hasIn: !!morningIn,
                        hasOut: !!morningOut
                      };
                      const afternoonInfo = {
                        in: afternoonIn,
                        out: afternoonOut,
                        hasIn: !!afternoonIn,
                        hasOut: !!afternoonOut
                      };
                      const eveningInfo = {
                        in: eveningIn,
                        out: eveningOut,
                        hasIn: !!eveningIn,
                        hasOut: !!eveningOut
                      };

                      const dayShifts = [
                        { label: 'SÁNG', status: day.morning, info: morningInfo, iconColor: 'text-amber-500', alwaysShow: false },
                        { label: 'CHIỀU', status: day.afternoon, info: afternoonInfo, iconColor: 'text-orange-500', alwaysShow: false },
                        { label: 'TỐI', status: day.evening, info: eveningInfo, iconColor: 'text-indigo-500', alwaysShow: true },
                      ];
                      return dayShifts.filter(shift => shift.alwaysShow || shift.status !== 'no_data').map((shift, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(shift.status)}`} />
                            <span className="text-[10px] font-black text-slate-400 tracking-wider w-12">{shift.label}</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-end opacity-100">
                              <span className="text-[12px] font-mono font-black text-slate-700">
                                {shift.info.in} {shift.info.hasIn && shift.info.hasOut ? '-' : ''} {shift.info.out}
                              </span>
                            </div>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                    <span className="text-xs text-slate-400 font-medium italic">Không phát sinh dữ liệu chấm công</span>
                  </div>
                )}

                {/* --- Row 3: Violation & Penalty Footer --- */}
                {(Number(day.engine_context?.late_minutes) > 0 ||
                  Number(day.engine_context?.early_leave_minutes) > 0 ||
                  (day.engine_context?.penalty_amount || 0) > 0) && (
                    <div className={`flex flex-col gap-3 p-4 rounded-2xl border-l-[4px] shadow-sm ${getInfoBoxStyle(day)}`}>
                      {/* Time Violations */}
                      <div className="flex flex-col gap-2">
                        {Number(day.engine_context.late_minutes) > 0 && (
                          <div className="flex items-center justify-between text-xs font-bold text-yellow-800">
                            <div className="flex items-center gap-2">
                              <ClockIcon className="h-4 w-4 text-yellow-500" />
                              Đi muộn:
                            </div>
                            <span className="text-yellow-600 bg-yellow-100/50 px-2 py-0.5 rounded">{day.engine_context.late_minutes} phút</span>
                          </div>
                        )}
                        {Number(day.engine_context.early_leave_minutes) > 0 && (
                          <div className="flex items-center justify-between text-xs font-bold text-yellow-800">
                            <div className="flex items-center gap-2">
                              <ClockIcon className="h-4 w-4 text-yellow-500" />
                              Về sớm:
                            </div>
                            <span className="text-yellow-600 bg-yellow-100/50 px-2 py-0.5 rounded">{day.engine_context.early_leave_minutes} phút</span>
                          </div>
                        )}
                      </div>

                      {/* Money Penalty Box */}
                      {(day.engine_context?.penalty_amount || 0) > 0 && (
                        <div className="mt-1 pt-3 border-t border-red-100/50 flex items-center justify-between bg-red-50/50 -mx-4 px-4 py-2 rounded-b-2xl">
                          <div className="flex items-center gap-2 text-red-600 font-bold text-[11px] uppercase tracking-wider shrink-0">
                            <BoltIcon className="h-4 w-4" />
                            Phạt:
                          </div>
                          <div className="text-sm font-black text-red-600">
                            {day.engine_context.penalty_amount.toLocaleString('vi-VN')} VNĐ
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                {/* Approved Requests / Empty with notes */}
                {!hasData && day.dayStatusSummary?.summary_text && (
                  <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-2xl flex items-center gap-3">
                    <div className="bg-blue-100 p-1.5 rounded-xl">
                      <ExclamationCircleIcon className="h-4 w-4 text-blue-600" />
                    </div>
                    <span className="text-xs text-blue-700 font-bold tracking-tight">
                      {day.dayStatusSummary.summary_text}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    {notePromptDialog}
    </>
  );
};

export default AttendanceCalendar;
