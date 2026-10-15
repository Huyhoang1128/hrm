import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AttendanceCalendar from '../components/AttendanceCalendar';
import AttendanceView from './AttendanceView';
import FinalizationLockBanner from '../components/FinalizationLockBanner';
import { requestPeriod, shiftToPeriod, periodsOverlap, type DayPeriod } from '../utils/requestPeriod';
import {
  attendanceService,
  AttendanceRecord,
  AttendanceEvent,
} from '../services/attendance.service';
import shiftRegistrationService, { caLabels } from '../services/shiftRegistration.service';

import {
  XMarkIcon,
  DocumentPlusIcon,
  ClockIcon,
  CalendarIcon,
  UserIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  ClipboardDocumentListIcon,
  ExclamationCircleIcon,
  BoltIcon,
  BriefcaseIcon,
  MoonIcon,
  VideoCameraIcon,
  HeartIcon,
  ChatBubbleBottomCenterTextIcon,
  ExclamationTriangleIcon,
  ArrowLeftOnRectangleIcon,
  ArrowRightOnRectangleIcon,
  CheckIcon,
  VideoCameraIcon as VideoIcon,
  HomeIcon,
  ComputerDesktopIcon,
  BanknotesIcon,
  ShieldExclamationIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { Employee, employeesAPI } from '@/utils/api';

/**
 * Trích xuất thông báo lỗi dễ đọc từ response lỗi của DRF (Django REST
 * Framework). DRF trả về nhiều dạng khác nhau tuỳ loại lỗi:
 *   - { detail: "..." } — lỗi permission/exception chung
 *   - { message: "..." } — 1 số endpoint tự định nghĩa
 *   - { field_name: ["msg1", ...] } — ValidationError MẶC ĐỊNH của DRF khi
 *     raise ValidationError({...}) với dict — mỗi field là 1 mảng chuỗi lỗi
 *   - ["msg"] — non_field_errors dạng mảng ở cấp cao nhất
 * Trước đây các nơi gọi API ở trang này chỉ check .detail/.message, nên MỌI
 * lỗi validate hợp lệ (400, dạng field->mảng lỗi — chiếm phần lớn lỗi từ
 * RegistrationRequestCreateSerializer/ExplanationEventCreateSerializer) đều
 * lọt qua fallback, hiển thị nhầm 1 câu lỗi hệ thống chung chung thay vì lý
 * do thực sự (vd: "Tất cả các ngày trong khoảng đã có đơn nghỉ không phép").
 */
function extractApiErrorMessage(error: any, fallback: string): string {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data.detail === 'string' && data.detail) return data.detail;
  if (typeof data.message === 'string' && data.message) return data.message;
  if (Array.isArray(data) && typeof data[0] === 'string' && data[0]) return data[0];
  if (typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0];
      if (typeof value === 'string' && value) return value;
    }
  }
  return fallback;
}



/** Ngày `date` có rơi vào khung làm online KHÔNG tính hạn mức không — chỉ áp
 * cho phòng ban bật Department.online_weekend_unlimited (vd Kế toán): cả ngày
 * Chủ nhật, và buổi chiều thứ 7 tuần 2/4 (buổi sáng thứ 7 vẫn tính). Khớp
 * backend stats_utils.online_quota_amount(). */
const onlineFreeSlot = (date: Date | null, unlimited?: boolean) => {
  if (!date || !unlimited) return { sunday: false, satAfternoon: false };
  const wd = date.getDay(); // 0 = Chủ nhật, 6 = Thứ 7
  if (wd === 0) return { sunday: true, satAfternoon: false };
  const occurrence = Math.floor((date.getDate() - 1) / 7) + 1;
  return { sunday: false, satAfternoon: wd === 6 && (occurrence === 2 || occurrence === 4) };
};

const AttendanceManagement: React.FC = () => {
  const { user } = useAuth();

  // Tab "Bản thân" / "Nhân viên" — tab "Nhân viên" chỉ dành cho Admin/HR/
  // Trưởng phòng (is_manager) xem chấm công của người khác (quản lý trực
  // tiếp/cấp dưới hoặc toàn bộ nếu Admin/HR), tái dùng nguyên AttendanceView.
  const [activeTab, setActiveTab] = useState<'self' | 'team'>('self');
  const canViewTeamAttendance =
    user?.role === 'ADMIN' ||
    user?.role === 'HR' ||
    !!(user as any)?.is_super_admin ||
    !!user?.is_manager;

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showSupplementaryRequestModal, setShowSupplementaryRequestModal] =
    useState(false);
  const [attendanceStats, setAttendanceStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  // NV thuộc nhóm "đăng ký Ca 2 theo ngày, cần quản lý trực tiếp duyệt
  // trước 0h" (vd Điều dưỡng BS Ma BS A) — chỉ nhóm này mới thấy lý
  // do "Đăng ký Ca 2" trong Đơn đăng ký. Kiểm tra 1 lần khi vào trang.
  const [ca2InScope, setCa2InScope] = useState(false);
  // Tên ca PHẢI ĐĂNG KÝ của team mình ("Ca 2" với Điều dưỡng BS BS A,
  // "Ca 1" với Sale BS B) — lấy từ scope-status.
  const [ca2RegLabel, setCa2RegLabel] = useState('Ca 2');
  const [attendanceDetails, setAttendanceDetails] = useState<
    AttendanceRecord[]
  >([]);
  const [selectedDayData, setSelectedDayData] = useState<any>(null);
  const isFullPresent = selectedDayData?.status_badge === 'Có mặt' || selectedDayData?.status_badge === 'Đủ công' || selectedDayData?.day_status === 'FULL';

  console.log('attendanceDetails', attendanceDetails);
  const [fetchingDetails, setFetchingDetails] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const isMounted = React.useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const [allExplanations, setAllExplanations] = useState<any[]>([]);
  const [monthlyWorkCredits, setMonthlyWorkCredits] = useState<any>(null);
  const [penaltyAmount, setPenaltyAmount] = useState<number>(0);
  const [refreshDataTrigger, setRefreshDataTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // === Lịch sử đơn tháng ===
  const [showRequestHistoryDrawer, setShowRequestHistoryDrawer] = useState(false);
  const [monthlyRequestHistory, setMonthlyRequestHistory] = useState<{
    explanations: any[];
    registrations: any[];
    onlineWorks: any[];
    leaveRequests: any[];
  }>({
    explanations: [],
    registrations: [],
    onlineWorks: [],
    leaveRequests: [],
  });
  const [historyActiveTab, setHistoryActiveTab] = useState<'all' | 'explanation' | 'registration' | 'online_work' | 'leave'>('all');
  const [notification, setNotification] = useState<{
    show: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
  }>({
    show: false,
    type: 'success',
    title: '',
    message: '',
  });

  const showNotify = (
    type: 'success' | 'error' | 'warning',
    title: string,
    message: string
  ) => {
    setNotification({ show: true, type, title, message });
  };

  // Kiểm tra ngày được chọn có dữ liệu chấm công không (dùng để disable Đơn giải trình)
  const hasAttendanceData = attendanceDetails && attendanceDetails.length > 0;

  // Mapping trạng thái chấm công sang tiếng Việt
  const ATTENDANCE_STATUS_MAP: Record<string, string> = {
    PRESENT: 'Có mặt',
    LATE: 'Đi muộn',
    EARLY_LEAVE: 'Về sớm',
    LATE_EARLY: 'Đi muộn/Về sớm',
    ABSENT: 'Vắng mặt',
    HALF_DAY: 'Nửa ngày',
    INCOMPLETE_ATTENDANCE: 'Quên chấm công',
    LEAVE: 'Nghỉ phép tháng',
  };

  // Mapping loại đơn giải trình/đăng ký sang tiếng Việt
  const EXPLANATION_TYPE_MAP: Record<string, string> = {
    explanation: 'Đơn giải trình',
    registration: 'Đơn đăng ký',
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
    ABSENT: 'Vắng mặt',
    FULL_DAY: 'Cả ngày',
  };

  const getExplanationTypeLabel = (type: string): string => {
    if (!type) return '';
    const upperType = type.toUpperCase();
    return EXPLANATION_TYPE_MAP[upperType] || EXPLANATION_TYPE_MAP[type] || type;
  };

  // Mapping nguồn dữ liệu chấm công sang tiếng Việt
  const IMPORT_SOURCE_MAP: Record<string, string> = {
    attendance_upload: 'Tải tệp lên',
    manual_checkin: 'Chấm công thủ công',
    face_id: 'Face ID',
    fingerprint: 'Vân tay',
    system: 'Hệ thống',
  };

  // ===================== STEP-BASED FORM STATE =====================
  type ContextType =
    | 'explanation'
    | 'registration'
    | 'monthly_leave'
    | 'online_work'
    | 'unauthorized_absence'
    | null;
  type ExplanationReason =
    | 'late_minutes'
    | 'early_leave_minutes'
    | 'first_day'
    | 'business_trip'
    | 'incomplete_attendance';
  type RegistrationReason = 'overtime' | 'extra_hours' | 'night_shift' | 'live' | 'off_duty' | 'ca2';
  type OnlineWorkReason = 'morning' | 'afternoon' | 'full_day' | 'checkpage';
  type LeaveReason = 'morning' | 'afternoon' | 'full_day';
  // "Nghỉ không phép" giờ là 1 loại yêu cầu (context) riêng, không còn là 1 lý do
  // nằm trong "Đơn đăng ký" — chỉ có duy nhất 1 giá trị vì đơn này không có lựa chọn con.
  type UnauthorizedAbsenceReason = 'unauthorized_absence';
  type ReasonType = ExplanationReason | RegistrationReason | OnlineWorkReason | LeaveReason | UnauthorizedAbsenceReason | null;

  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [selectedContext, setSelectedContext] = useState<ContextType>(null);
  const [selectedReason, setSelectedReason] = useState<ReasonType>(null);
  // Đơn nghỉ không phép nhiều ngày liên tiếp: bật "chọn khoảng ngày" thì cho chọn
  // thêm ngày kết thúc (ngày bắt đầu vẫn là selectedDate — ngày đang xem/click).
  const [unauthorizedAbsenceIsRange, setUnauthorizedAbsenceIsRange] = useState(false);
  const [unauthorizedAbsenceEndDate, setUnauthorizedAbsenceEndDate] = useState<string>('');
  // Nghỉ không phép nửa ngày — chọn cụ thể ca sáng/chiều thay vì 1 checkbox
  // "nửa ngày" chung chung (giống giao diện chọn ca của Nghỉ phép tháng).
  // 'full_day' = cả ngày (mặc định). Loại trừ với "nghỉ nhiều ngày liên tiếp"
  // (chỉ áp dụng 1 ngày). Gửi thẳng half_day_period ('MORNING'/'AFTERNOON')
  // lên backend — field thật, không suy đoán qua text.
  const [unauthorizedAbsenceHalfDayPeriod, setUnauthorizedAbsenceHalfDayPeriod] = useState<'morning' | 'afternoon' | 'full_day'>('full_day');
  const [businessTripShift, setBusinessTripShift] = useState<'morning' | 'afternoon' | 'full_day' | null>(null);
  const [firstDayShift, setFirstDayShift] = useState<'morning' | 'afternoon' | 'full_day' | null>(null);
  const [formNote, setFormNote] = useState('');

  // Overtime (Tăng ca) state
  const [overtimeStartTime, setOvertimeStartTime] = useState('');
  const [overtimeEndTime, setOvertimeEndTime] = useState('');
  // Loại tăng ca: Tại Viện/VP (ONSITE, mặc định) hay Online — dùng để cuối
  // tháng tự đối chiếu giờ ra thực tế với đơn ONSITE (xem Đối chiếu tăng ca
  // ở trang Phê duyệt). Mặc định ONSITE vì đa số đơn tăng ca là tại viện/VP.
  const [overtimeType, setOvertimeType] = useState<'ONSITE' | 'ONLINE'>('ONSITE');

  // Extra Hours (Làm thêm giờ) state - for part-time employees
  const [extraHoursStartTime, setExtraHoursStartTime] = useState('');
  const [extraHoursEndTime, setExtraHoursEndTime] = useState('');

  // Night Shift (Trực tối) state - for sales department
  const [nightShiftStartTime, setNightShiftStartTime] = useState<string | null>(null);
  const [nightShiftEndTime, setNightShiftEndTime] = useState<string | null>(null);

  // Live state - for TikTok department
  const [liveStartTime, setLiveStartTime] = useState('');
  const [liveEndTime, setLiveEndTime] = useState('');

  // Incomplete Attendance (Quên chấm công) state
  const [forgotPunchType, setForgotPunchType] = useState<'checkin' | 'checkout'>('checkin');
  const [forgotCheckinTime, setForgotCheckinTime] = useState<string | null>(null);
  const [forgotCheckoutTime, setForgotCheckoutTime] = useState<string | null>(null);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Huỷ đơn (tự phục vụ) trong drawer "Lịch sử đơn tháng" — modal xác nhận
  // riêng thay vì hàng "Xác nhận/Không" chèn
  // ngay trong thẻ, vốn làm hàng nút Sửa/Huỷ bị lệch/chật khi xuất hiện.
  const [cancelRequestItem, setCancelRequestItem] = useState<any | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  // Đổi loại đơn Nghỉ phép tháng ⇄ Nghỉ không phép — cùng kiểu modal xác nhận.
  const [convertRequestItem, setConvertRequestItem] = useState<any | null>(null);
  const [convertSubmitting, setConvertSubmitting] = useState(false);

  // Sửa đơn (tự phục vụ) trong drawer "Lịch sử đơn tháng" — form theo từng
  // loại đơn (giờ bắt đầu/kết thúc cho tăng ca..., ngày cho nghỉ phép, giờ
  // check-in/out thực tế cho giải trình...). editRequestItem=null nghĩa là
  // modal đang đóng.
  const [editRequestItem, setEditRequestItem] = useState<any | null>(null);
  const [editRequestForm, setEditRequestForm] = useState<{
    reason: string;
    start_time: string;
    end_time: string;
    attendance_date: string;
    actual_check_in: string;
    actual_check_out: string;
  }>({ reason: '', start_time: '', end_time: '', attendance_date: '', actual_check_in: '', actual_check_out: '' });
  const [editRequestSubmitting, setEditRequestSubmitting] = useState(false);
  const [editRequestError, setEditRequestError] = useState<string | null>(null);

  // Calculate overtime duration in hours
  const calculateOvertimeDuration = () => {
    if (!overtimeStartTime || !overtimeEndTime) return 0;
    const [startHour, startMin] = overtimeStartTime.split(':').map(Number);
    const [endHour, endMin] = overtimeEndTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const diffMinutes = endMinutes - startMinutes;
    return diffMinutes / 60;
  };

  // Calculate extra hours duration
  const calculateExtraHoursDuration = () => {
    if (!extraHoursStartTime || !extraHoursEndTime) return 0;
    const [startHour, startMin] = extraHoursStartTime.split(':').map(Number);
    const [endHour, endMin] = extraHoursEndTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const diffMinutes = endMinutes - startMinutes;
    return diffMinutes / 60;
  };

  // Calculate night shift duration
  const calculateNightShiftDuration = () => {
    if (!nightShiftStartTime || !nightShiftEndTime) return 0;
    const [startHour, startMin] = (nightShiftStartTime as string).split(':').map(Number);
    const [endHour, endMin] = (nightShiftEndTime as string).split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const diffMinutes = endMinutes - startMinutes;
    return diffMinutes / 60;
  };

  // Calculate live duration
  const calculateLiveDuration = () => {
    if (!liveStartTime || !liveEndTime) return 0;
    const [startHour, startMin] = liveStartTime.split(':').map(Number);
    const [endHour, endMin] = liveEndTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const diffMinutes = endMinutes - startMinutes;
    return diffMinutes / 60;
  };

  const overtimeDuration = calculateOvertimeDuration();
  const extraHoursDuration = calculateExtraHoursDuration();
  const nightShiftDuration = calculateNightShiftDuration();
  const liveDuration = calculateLiveDuration();

  // Validate registration time fields
  // - Must have start and end time
  // - Duration must be positive (end > start)
  // - Minimum hours based on type
  const isRegistrationTimeValid = () => {
    // Explanation requests don't need time validation here
    if (selectedContext === 'explanation') return true;
    // Monthly leave doesn't need time validation
    if (selectedContext === 'monthly_leave') return true;
    // Online work form note is validated later or is optional
    if (selectedContext === 'online_work') return true;
    // Đơn nghỉ không phép chỉ cần ghi chú (validate riêng ở note-required check), không có time picker
    if (selectedContext === 'unauthorized_absence') return true;

    if (!selectedReason) return false;

    const MIN_HOURS = 0.5; // Default minimum for most registrations (30 minutes)

    switch (selectedReason) {
      case 'overtime':
        return (
          !!(overtimeStartTime && overtimeEndTime) &&
          overtimeDuration >= MIN_HOURS
        );
      case 'extra_hours':
        return (
          !!(extraHoursStartTime && extraHoursEndTime) &&
          extraHoursDuration >= MIN_HOURS
        );
      case 'night_shift':
        // Cho phép Ca CheckPage không có giờ cố định
        if (!nightShiftStartTime && !nightShiftEndTime) return true;
        return (
          !!(nightShiftStartTime && nightShiftEndTime) &&
          nightShiftDuration >= MIN_HOURS
        );
      case 'live':
        return !!(liveStartTime && liveEndTime) && liveDuration >= MIN_HOURS;
      default:
        return true;
    }
  };

  // Get validation error message for registration
  const getRegistrationTimeError = (): string | null => {
    if (selectedContext !== 'registration') return null;

    const MIN_HOURS = 0.5;
    let hasTime = false;
    let duration = 0;

    switch (selectedReason) {
      case 'overtime':
        hasTime = !!(overtimeStartTime && overtimeEndTime);
        duration = overtimeDuration;
        break;
      case 'extra_hours':
        hasTime = !!(extraHoursStartTime && extraHoursEndTime);
        duration = extraHoursDuration;
        break;
      case 'night_shift':
        hasTime = !!(nightShiftStartTime && nightShiftEndTime);
        duration = nightShiftDuration;
        break;
      case 'live':
        hasTime = !!(liveStartTime && liveEndTime);
        duration = liveDuration;
        break;
      default:
        return null;
    }

    if (!hasTime) return null; // Don't show error until user selects times
    if (duration <= 0) return 'Giờ kết thúc phải sau giờ bắt đầu';
    if (duration < MIN_HOURS) return 'Tối thiểu 30 phút';
    return null;
  };

  const registrationTimeError = getRegistrationTimeError();

  // Reason options based on context
  const explanationReasons: {
    id: ExplanationReason;
    label: string;
    icon: string;
  }[] = [
      { id: 'late_minutes', label: 'Đi muộn', icon: 'clock' },
      { id: 'early_leave_minutes', label: 'Về sớm', icon: 'clock' },
      { id: 'incomplete_attendance', label: 'Quên chấm công', icon: 'warning' },
      { id: 'business_trip', label: 'Đi công tác', icon: 'briefcase' },
      { id: 'first_day', label: 'Ngày đầu đi làm', icon: 'calendar' },
    ];

  // Danh sách lý do giải trình còn hợp lệ để chọn cho 1 ngày cụ thể — dùng chung cho cả
  // "hiện/ẩn thẻ Đơn giải trình" (bước 1) và "danh sách lý do" (bước 2), để 2 nơi này
  // không bị lệch logic (trước đây bị lệch: bước 1 dùng "có bất kỳ đơn giải trình nào
  // đã duyệt thì ẩn cả thẻ", nên duyệt "Quên chấm công" xong thì mất luôn cả lựa chọn
  // "Đi muộn" dù đi muộn là lỗi độc lập, không liên quan đến quên chấm công).
  const getAvailableExplanationReasons = (detail: any, registrations: any[]) => {
    return explanationReasons.filter(reason => {
      // 1. Ngăn chặn nếu đã có đơn CÙNG LOẠI được PHÊ DUYỆT
      const isAlreadyApproved = registrations.some((r: any) => {
        if (r.status?.toUpperCase() !== 'APPROVED' || r.event_type?.toUpperCase() !== 'EXPLANATION') return false;
        const rData = r.data || r;
        const targetType = (({
          late_minutes: 'LATE',
          early_leave_minutes: 'EARLY_LEAVE',
          incomplete_attendance: 'INCOMPLETE_ATTENDANCE',
          business_trip: 'BUSINESS_TRIP',
          first_day: 'FIRST_DAY'
        } as Record<string, string>)[reason.id]);
        return rData?.explanation_type?.toUpperCase() === targetType;
      });
      if (isAlreadyApproved) return false;

      // 2. Các logic lọc theo dữ liệu thực tế
      const isIncomplete = detail?.status === 'INCOMPLETE_ATTENDANCE';
      // Đi muộn/Về sớm là lỗi độc lập với việc quên chấm công — vẫn cho phép làm đơn
      // "Đi muộn"/"Về sớm" dù ngày đó là INCOMPLETE_ATTENDANCE, miễn là có dữ liệu
      // late_minutes/early_leave_minutes thực tế.
      if (reason.id === 'late_minutes') return (detail?.late_minutes || 0) > 0;
      if (reason.id === 'early_leave_minutes') return (detail?.early_leave_minutes || 0) > 0;
      if (reason.id === 'incomplete_attendance') return isIncomplete || detail?.status === 'ABSENT';
      if (reason.id === 'first_day') return !detail || detail.status === 'ABSENT' || detail?.status === 'INCOMPLETE_ATTENDANCE';
      if (reason.id === 'business_trip') {
        return !detail || detail.status === 'ABSENT' || (detail?.late_minutes || 0) > 0 || (detail?.early_leave_minutes || 0) > 0 || detail?.status === 'INCOMPLETE_ATTENDANCE';
      }
      return true;
    });
  };

  const registrationReasons: {
    id: RegistrationReason;
    label: string;
    icon: string;
  }[] = [
      { id: 'overtime', label: 'Tăng ca', icon: 'bolt' },
      // { id: 'extra_hours', label: 'Làm thêm giờ', icon: 'clock' }, // tạm ẩn vì có chức năng giống Tăng ca
      { id: 'night_shift', label: 'Trực tối', icon: 'moon' },
      { id: 'live', label: 'Live', icon: 'video' },
      { id: 'off_duty', label: 'Vào/Ra trực', icon: 'briefcase' },
      // Chỉ nhóm dùng mô hình "mặc định Ca 1, đăng ký Ca 2 theo ngày cần
      // quản lý trực tiếp duyệt trước 0h" (ca2InScope, vd Điều dưỡng BS Ma
      // BS A) mới thấy lý do này — khác hẳn các lý do trên (không tạo
      // EmployeeEvent, xem nhánh submit riêng bên dưới).
      ...(ca2InScope ? [{ id: 'ca2' as const, label: `Đăng ký ${ca2RegLabel}`, icon: 'clock' }] : []),
    ];

  const onlineWorkReasons: {
    id: OnlineWorkReason;
    label: string;
    icon: string;
  }[] = [
      { id: 'morning', label: 'Làm online sáng', icon: 'desktop' },
      { id: 'afternoon', label: 'Làm online chiều', icon: 'desktop' },
      { id: 'full_day', label: 'Làm online cả ngày', icon: 'desktop' },
      // { id: 'checkpage', label: 'Làm online checkpage', icon: 'desktop' },
    ];

  const monthlyLeaveReasons: {
    id: LeaveReason;
    label: string;
    icon: string;
  }[] = [
      { id: 'morning', label: 'Nghỉ ca sáng', icon: 'calendar' },
      { id: 'afternoon', label: 'Nghỉ ca chiều', icon: 'calendar' },
      { id: 'full_day', label: 'Nghỉ cả ngày', icon: 'calendar' },
    ];

  const normalizeRequestReason = (value: any): string =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(':')[0]
      .trim();

  const requestReasonMatchesSession = (value: any, session: string): boolean => {
    const normalized = normalizeRequestReason(value);
    const aliases: Record<string, string[]> = {
      morning: ['morning', 'ca sang', 'nghi ca sang', 'lam online sang'],
      afternoon: ['afternoon', 'ca chieu', 'nghi ca chieu', 'lam online chieu'],
      full_day: ['full_day', 'full day', 'ca ngay', 'nghi ca ngay', 'lam online ca ngay'],
    };

    return aliases[session]?.includes(normalized) || false;
  };

  // Handle context selection
  const handleContextSelect = (context: ContextType) => {
    setSelectedContext(context);
    // Đơn nghỉ không phép không có lý do con để chọn → tự gán luôn lý do duy nhất,
    // bỏ qua bước chọn "lý do cụ thể" và đi thẳng vào ô ghi chú.
    setSelectedReason(context === 'unauthorized_absence' ? 'unauthorized_absence' : null);
    setBusinessTripShift(null);
    setFirstDayShift(null);
    setUnauthorizedAbsenceIsRange(false);
    setUnauthorizedAbsenceEndDate('');
    setUnauthorizedAbsenceHalfDayPeriod('full_day');
    // Move to step 2 for contexts that have sub-reasons (including monthly_leave now)
    if (context && (context === 'explanation' || context === 'registration' || context === 'online_work' || context === 'monthly_leave' || context === 'unauthorized_absence')) {
      setCurrentStep(2);
    }
  };

  // Handle reason selection
  const handleReasonSelect = (reason: ReasonType) => {
    setSelectedReason(reason);
    if (reason !== 'business_trip') setBusinessTripShift(null);
    if (reason !== 'first_day') setFirstDayShift(null);
    // Set overtime end time to checkout time when selecting overtime only
    if (
      reason === 'overtime' &&
      attendanceDetails.length > 0 &&
      attendanceDetails[0]?.check_out
    ) {
      setOvertimeEndTime(attendanceDetails[0].check_out.substring(0, 5)); // Format HH:MM
    }
    // Set default start time of 21:00 for live
    if (reason === 'live') {
      setLiveStartTime('21:00');
    }
    // Auto-detect ca bị quên chấm công từ shifts[] của ngày đang chọn
    if (reason === 'incomplete_attendance' && selectedDayData?.shifts?.length) {
      const allShifts = (selectedDayData.shifts as any[])
        .slice()
        .sort((a: any, b: any) => (a.scheduled_start || '').localeCompare(b.scheduled_start || ''));

      const incompleteShifts = allShifts.filter(
        (s: any) =>
          s.status?.toUpperCase() === 'INCOMPLETE_ATTENDANCE' ||
          (s.check_in && !s.check_out) ||
          (!s.check_in && s.check_out)
      );
      if (incompleteShifts.length === 1) {
        const shift = incompleteShifts[0];
        const shiftIndex = allShifts.indexOf(shift);
        // Khi máy chấm công cả ngày chỉ ghi nhận ĐÚNG 1 lần quẹt, lần quẹt đó luôn
        // được lưu vào field check_in (BE: "check_in = punch sớm nhất trong ngày"),
        // BẤT KỂ thời điểm quẹt thực tế là giờ vào hay giờ ra. Vì vậy không thể suy
        // luận thẳng "shift có check_in, thiếu check_out" = "NV quên check-out".
        // Nếu có 1 ca LIỀN TRƯỚC ca này hoàn toàn không có dữ liệu chấm công (không
        // phải chỉ thiếu 1 trong 2 mốc, mà thiếu cả 2) → nhiều khả năng NV đã đi làm
        // từ đầu ngày nhưng quên bấm máy chấm công, và lần quẹt duy nhất ghi nhận
        // được (dù rơi vào field check_in) thực chất là giờ RA cuối ngày → NV quên
        // CHECK-IN chứ không phải quên check-out.
        const earlierEmptyShift = allShifts
          .slice(0, shiftIndex)
          .find((s: any) => !s.check_in && !s.check_out);

        // Auto-detect loại quên và suggest giờ
        if (shift.check_in && !shift.check_out) {
          if (earlierEmptyShift) {
            setForgotPunchType('checkin');
            setForgotCheckinTime(earlierEmptyShift.scheduled_start || null);
            setForgotCheckoutTime(null);
          } else {
            setForgotPunchType('checkout');
            setForgotCheckinTime(null);
            setForgotCheckoutTime(shift.scheduled_end || null);
          }
        } else if (!shift.check_in && shift.check_out) {
          setForgotPunchType('checkin');
          setForgotCheckinTime(shift.scheduled_start || null);
          setForgotCheckoutTime(null);
        } else {
          setForgotPunchType('checkin');
          setForgotCheckinTime(shift.scheduled_start || null);
          setForgotCheckoutTime(null);
        }
      } else if (incompleteShifts.length > 1) {
        // Nhiều ca bị incomplete → reset để user chọn
        setForgotPunchType('checkin');
        setForgotCheckinTime(null);
        setForgotCheckoutTime(null);
      }
    }
  };

  // Reset form when modal closes
  const resetSupplementaryForm = () => {
    setCurrentStep(1);
    setSelectedContext(null);
    setSelectedReason(null);
    setFormNote('');
    setOvertimeStartTime('');
    setOvertimeEndTime('');
    setOvertimeType('ONSITE');
    setExtraHoursStartTime('');
    setExtraHoursEndTime('');
    setNightShiftStartTime(null);
    setNightShiftEndTime(null);
    setLiveStartTime('');
    setLiveEndTime('');
    setForgotPunchType('checkin');
    setForgotCheckinTime(null);
    setForgotCheckoutTime(null);
    setUnauthorizedAbsenceIsRange(false);
    setUnauthorizedAbsenceEndDate('');
    setUnauthorizedAbsenceHalfDayPeriod('full_day');
  };

  // Icon render helper
  // Icon render helper
  const renderIcon = (iconName: string, isSelected: boolean) => {
    const iconClass = `w-4 h-4 mr-2 ${isSelected ? 'text-violet-500' : 'text-gray-400'}`;
    switch (iconName) {
      case 'clock':
        return <ClockIcon className={iconClass} />;
      case 'calendar':
        return <CalendarIcon className={iconClass} />;
      case 'warning':
        return <ExclamationTriangleIcon className={iconClass} />;
      case 'bolt':
        return <BoltIcon className={iconClass} />;
      case 'moon':
        return <MoonIcon className={iconClass} />;
      case 'video':
        return <VideoIcon className={iconClass} />;
      case 'home':
        return <HomeIcon className={iconClass} />;
      case 'desktop':
        return <ComputerDesktopIcon className={iconClass} />;
      case 'briefcase':
        return <BriefcaseIcon className={iconClass} />;
      case 'no-symbol':
        return <NoSymbolIcon className={iconClass} />;
      default:
        return null;
    }
  };
  // ===================== END STEP-BASED FORM STATE =====================
  /* Removed calendarData state */
  const [calendarSummary, setCalendarSummary] = useState<{
    total_work_days: number;
    full_days: number;
    violation_count: number;
    late_or_early_days: number;
    absent_days: number;
    forgot_checkin_days: number;
    unauthorized_absence_days?: number;
    overtime_hours: number;
    extra_hours: number;
    night_shift_sessions: number;
    live_sessions: number;
    leave_days: number;
    remaining_annual_leave?: number;
    total_late_minutes?: number;
    total_early_leave_minutes?: number;
    total_penalty?: number;
  } | null>(null);

  // Effect 1: Fetch employee only on mount
  useEffect(() => {
    fetchCurrentEmployee();
    shiftRegistrationService
      .getScopeStatus()
      .then((s) => {
        setCa2InScope(!!s.in_scope && !!s.requires_manager_approval && caLabels(s).canRegister);
        setCa2RegLabel(caLabels(s).reg);
      })
      .catch(() => setCa2InScope(false));
  }, []);

  // Effect 2: Fetch all data when employee or date changes
  useEffect(() => {
    if (!currentEmployee) return;

    const fetchAllData = async () => {
      if (!currentEmployee || !isMounted.current) return;
      if (initialLoading) setLoading(true);

      try {
        // Tối ưu hóa: Gọi tuần tự (Sequential Await) theo ý USER
        await fetchAttendanceStats(currentEmployee, true);
        if (!isMounted.current) return;

        await fetchMonthlyWorkCredits(
          currentDate.getMonth() + 1,
          currentDate.getFullYear(),
          currentEmployee.id,
          true
        );
        if (!isMounted.current) return;

        // fetchCalendarData sẽ KHÔNG được gọi ở đây nữa để tránh Duplicate 
        // Thay vào đó dùng dữ liệu từ AttendanceCalendar truyền lên
      } catch (err) {
        console.error('Error fetching all data:', err);
      } finally {
        if (isMounted.current) {
          setLoading(false);
          setInitialLoading(false);
        }
      }
    };

    fetchAllData();
  }, [currentEmployee?.id, currentDate.getMonth(), currentDate.getFullYear()]);

  // Effect 3: Đồng bộ allExplanations và approvedRegistrations khi monthlyRequestHistory hoặc selectedDate thay đổi
  // Điều này đảm bảo khi nhấn Làm đơn bổ sung lần nữa (hoặc đang mở), dữ liệu lọc sẽ luôn mới nhất
  useEffect(() => {
    if (selectedDate && currentEmployee) {
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      // Lọc giải trình của ngày đang chọn
      const dayExplanations = monthlyRequestHistory.explanations.filter(e => 
        e.attendance_date === dateStr || (e.event_date && e.event_date === dateStr)
      );
      setAllExplanations(dayExplanations);
    }
  }, [monthlyRequestHistory, selectedDate, currentEmployee?.id]);

  const fetchCurrentEmployee = async (): Promise<Employee | null> => {
    try {
      const employee = await employeesAPI.me();
      console.log('Current employee:', employee);
      setCurrentEmployee(employee);
      return employee;
    } catch (error) {
      console.error('Error fetching current employee:', error);
      return null;
    }
  };

  const fetchAttendanceStats = async (employee?: Employee | null, silent = false) => {
    try {
      if (!silent) setLoading(true);
      const today = currentDate || new Date();
      const firstDayOfMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      );
      const lastDayOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0
      );

      // Format dates in local timezone
      const formatDateLocal = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Use employee parameter or currentEmployee from state
      const targetEmployee = employee || currentEmployee;

      // Fetch attendance statistics with employee_id and department_id
      const stats = await attendanceService.getAttendanceStats({
        start_date: formatDateLocal(firstDayOfMonth),
        end_date: formatDateLocal(lastDayOfMonth),
        employee_id: targetEmployee?.id,
        department_id: targetEmployee?.department?.id,
      });

      // Fetch attendance explanation statistics for current month
      let explanationStats = null;
      if (targetEmployee && targetEmployee.id) {
        try {
          console.log(
            '🔵 [STATS] Fetching explanation stats for employee:',
            targetEmployee.id
          );
          explanationStats =
            await attendanceService.getAttendanceExplanationStats({
              employee_id: targetEmployee.id,
              month: today.getMonth() + 1,
              year: today.getFullYear(),
            });
          console.log(
            '🔵 [STATS] Explanation stats response:',
            explanationStats
          );
          console.log(
            '🔵 [STATS] remaining_online_work:',
            explanationStats?.statistics?.remaining_online_work
          );
        } catch (error) {
          console.error('❌ [STATS] Error fetching explanation stats:', error);
        }
      }

      // Combine stats - merge all fields from both APIs
      const mergedStats = {
        ...stats.statistics,
        ...(explanationStats?.statistics || {}),
      };

      setAttendanceStats(mergedStats);
    } catch (error) {
      console.error('❌ [STATS] Error fetching attendance stats:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  /* Removed fetchAttendanceRecords function */

  const fetchMonthlyWorkCredits = async (
    month?: number,
    year?: number,
    employeeId?: number,
    silent = false
  ) => {
    try {
      const today = new Date();
      const params = {
        month: month || today.getMonth() + 1,
        year: year || today.getFullYear(),
        employee_id: employeeId || currentEmployee?.id,
      };

      const response = await attendanceService.getMonthlyWorkCredits(params);
      setMonthlyWorkCredits(response);
    } catch (error) {
      console.error('Error fetching monthly work credits:', error);
    }
  };

  // Xử lý dữ liệu trả về từ AttendanceCalendar (Tránh gọi API 2 lần)
  const handleCalendarDataLoaded = (data: { calendar: any[]; summary: any }) => {
    const { calendar: calendarArray, summary } = data;
    if (summary) {
      const totalLate = calendarArray.reduce((acc: number, d: any) => acc + (d.engine_context?.late_minutes || 0), 0);
      const totalEarly = calendarArray.reduce((acc: number, d: any) => acc + (d.engine_context?.early_leave_minutes || 0), 0);
      const totalPenalty = calendarArray.reduce((acc: number, d: any) => acc + (d.engine_context?.penalty_amount || d.summary?.penalty_amount || 0), 0);
      
      setCalendarSummary({
        ...summary,
        total_late_minutes: totalLate,
        total_early_leave_minutes: totalEarly,
        total_penalty: totalPenalty,
      });

      // === SYNC selectedDayData === 
      // Important to keep overwrite logic accurate when staying in modal
      if (selectedDate) {
        const year = selectedDate.getFullYear();
        const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const day = String(selectedDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        const freshDayData = calendarArray.find((d: any) => d.date === dateStr);
        if (freshDayData) {
          setSelectedDayData(freshDayData);
        }
      }
    }

    // Trích xuất lịch sử đơn từ calendarArray thay vì gọi 3 API rời rạc
    const explanations: any[] = [];
    const registrations: any[] = [];
    const onlineWorks: any[] = [];
    const leaveRequests: any[] = [];

    calendarArray.forEach((day: any) => {
      const dayRegs = day.registrations || [];
      dayRegs.forEach((r: any) => {
        const type = (r.event_type || '').toUpperCase();
        // Fallback or use event_date from data, or day.date as fallback
        const details = r.data || r;

        // Bỏ đơn đã CANCELLED khỏi "Lịch sử đơn tháng" — tránh nhìn như đơn
        // đang hoạt động/trùng lặp (vd đơn cũ bị Admin huỷ khi thay thế bằng
        // đơn mới). CHỈ lọc ở đây (nguồn dữ liệu calendar-view vẫn trả đầy đủ
        // để DayDetailDialog/trang Chốt công còn thấy được đơn đã huỷ khi cần
        // đối chiếu — xem comment ở attendance_views.py).
        if (details.status === 'CANCELLED') return;

        // r.id là ID thật của EmployeeEvent (nằm ở top-level, KHÔNG có trong
        // details/r.data) — cần giữ lại để có thể gọi API huỷ/xoá đúng đơn.
        const item = { ...details, id: r.id ?? details.id };
        if (!item.created_at && day.date) {
            item.created_at = new Date(day.date).toISOString(); // fake created_at for sorting if missing
        }

        if (type === 'EXPLANATION') {
          if (details.explanation_type === 'LEAVE') {
            leaveRequests.push(item);
          } else {
            explanations.push(item);
          }
        } else if (type === 'ONLINE_WORK') {
          onlineWorks.push(item);
        } else {
          registrations.push(item);
        }
      });
    });

    // Gộp đơn Nghỉ không phép nhiều ngày liên tiếp (mỗi ngày là 1
    // EmployeeEvent riêng ở backend nhưng dùng chung 1 request_code — xem
    // RegistrationRequestCreateSerializer.create()) thành 1 item duy nhất để
    // hiển thị 1 thẻ/1 đơn thay vì N thẻ trùng lặp theo từng ngày. _groupIds
    // giữ id của TẤT CẢ bản ghi trong nhóm để Sửa/Huỷ áp dụng cho cả nhóm
    // (qua cancel_group()/update_group() ở backend) — chỉ thật sự là nhóm
    // khi có từ 2 bản ghi trở lên chung request_code.
    const registrationGroups = new Map<string, any>();
    const groupedRegistrations: any[] = [];
    registrations.forEach((item: any) => {
      const code = item.request_code;
      if (item.registration_type === 'UNAUTHORIZED_ABSENCE' && code) {
        const existing = registrationGroups.get(code);
        if (existing) {
          existing._groupIds.push(item.id);
          return;
        }
        const grouped = { ...item, _groupIds: [item.id], _requestCode: code };
        registrationGroups.set(code, grouped);
        groupedRegistrations.push(grouped);
      } else {
        groupedRegistrations.push(item);
      }
    });

    // Sắp xếp các mảng theo thời gian giảm dần
    const sortByParam = (a: any, b: any) => new Date(b.created_at || b.event_date || 0).getTime() - new Date(a.created_at || a.event_date || 0).getTime();

    explanations.sort(sortByParam);
    groupedRegistrations.sort(sortByParam);
    onlineWorks.sort(sortByParam);
    leaveRequests.sort(sortByParam);

    setMonthlyRequestHistory({
      explanations,
      registrations: groupedRegistrations,
      onlineWorks,
      leaveRequests,
    });
  };

  // Cập nhật dữ liệu
  const refreshAllData = async () => {
    if (currentEmployee) {
      console.log('🔄 [REFRESH] Synchronous data refresh triggered...');
      setLoading(true);
      try {
        await Promise.all([
          fetchAttendanceStats(currentEmployee, true),
          fetchMonthlyWorkCredits(
            currentDate.getMonth() + 1,
            currentDate.getFullYear(),
            currentEmployee.id,
            true
          ),
          // Nếu đang mở Modal chi tiết ngày, fetch lại chi tiết ngày đó
          selectedDate ? fetchAttendanceDetailsForDate(selectedDate) : Promise.resolve(),
        ]);

        // RefreshTrigger sẽ điều khiển AttendanceCalendar tự fetch
        setRefreshDataTrigger((prev) => prev + 1);
      } finally {
        setLoading(false);
      }
    }
  };

  // Huỷ đơn (tự phục vụ) trong drawer "Lịch sử đơn tháng" — dùng được khi
  // BE trả can_self_cancel=true (còn Chờ duyệt + chưa qua bước quản lý trực
  // tiếp duyệt, HOẶC đã duyệt nhưng HCNS đã "Mở khoá đặc biệt" cho đúng
  // NV/ngày/loại đơn này — xem hrm/deadline_exception_models.py::can_owner_self_cancel).
  const openCancelRequest = (item: any) => {
    setCancelRequestItem(item);
    setCancelReasonText('');
  };

  const handleCancelRequest = async () => {
    const item = cancelRequestItem;
    if (!item?.id) {
      showNotify('error', 'Lỗi', 'Không xác định được đơn cần huỷ.');
      return;
    }
    const reason = cancelReasonText.trim() || undefined;
    setCancelSubmitting(true);
    try {
      if (item._groupIds?.length > 1 && item._requestCode) {
        // Đơn Nghỉ không phép nhiều ngày (gộp hiển thị) — huỷ cả nhóm 1 lần
        // qua request_code, xem cancel_group() ở backend.
        const result = await attendanceService.cancelRegistrationRequestGroup(item._requestCode, reason);
        const skipped = result?.skipped || [];
        if (skipped.length > 0) {
          showNotify(
            'error',
            'Huỷ chưa trọn vẹn',
            `Có ${skipped.length} ngày không huỷ được (đã quá hạn/đã duyệt): ${skipped.map((s: any) => s.reason).join('; ')}`,
          );
        } else {
          showNotify('success', 'Đã huỷ đơn', 'Đơn đã được huỷ thành công.');
        }
      } else if (item._type === 'explanation' && item.explanation_type === 'LEAVE') {
        // Nghỉ phép tháng nằm ở router riêng (monthly-leave-requests), KHÔNG
        // phải attendance-explanations (endpoint đó loại trừ hẳn LEAVE) —
        // trước đây gọi nhầm cancelAttendanceExplanation() nên luôn 404.
        await attendanceService.cancelMonthlyLeaveRequest(item.id, reason);
        showNotify('success', 'Đã huỷ đơn', 'Đơn đã được huỷ thành công.');
      } else if (item._type === 'registration') {
        await attendanceService.cancelRegistrationRequest(item.id, reason);
        showNotify('success', 'Đã huỷ đơn', 'Đơn đã được huỷ thành công.');
      } else if (item._type === 'online_work') {
        await attendanceService.cancelOnlineWorkRequest(item.id, reason);
        showNotify('success', 'Đã huỷ đơn', 'Đơn đã được huỷ thành công.');
      } else {
        await attendanceService.cancelAttendanceExplanation(item.id, reason);
        showNotify('success', 'Đã huỷ đơn', 'Đơn đã được huỷ thành công.');
      }
      setCancelRequestItem(null);
      await refreshAllData();
    } catch (error: any) {
      const errorMessage = extractApiErrorMessage(error, 'Huỷ đơn thất bại. Vui lòng thử lại.');
      showNotify('error', 'Không thể huỷ đơn', errorMessage);
    } finally {
      setCancelSubmitting(false);
    }
  };

  // Đổi loại đơn Nghỉ phép tháng ⇄ Nghỉ không phép (cùng ngày) — tự phục vụ,
  // dùng chung điều kiện can_self_cancel với Huỷ đơn (huỷ đơn cũ + tạo đơn
  // mới loại kia, xem attendanceService.convertLeaveToUnauthorized/
  // convertUnauthorizedToLeave).
  const handleConvertRequest = async () => {
    const item = convertRequestItem;
    if (!item?.id) {
      showNotify('error', 'Lỗi', 'Không xác định được đơn cần đổi loại.');
      return;
    }
    setConvertSubmitting(true);
    try {
      const attendanceDate = item.attendance_date || item.start_date;
      if (item._type === 'explanation' && item.explanation_type === 'LEAVE') {
        await attendanceService.convertLeaveToUnauthorized({
          id: item.id,
          employee_id: item.employee_id,
          attendance_date: attendanceDate,
          reason: item.reason,
        });
      } else {
        await attendanceService.convertUnauthorizedToLeave({
          id: item.id,
          employee_id: item.employee_id,
          attendance_date: attendanceDate,
          reason: item.reason,
        });
      }
      setConvertRequestItem(null);
      showNotify('success', 'Đã đổi loại đơn', 'Đơn đã được chuyển sang loại mới thành công.');
      await refreshAllData();
    } catch (error: any) {
      const errorMessage = extractApiErrorMessage(error, 'Đổi loại đơn thất bại. Vui lòng thử lại.');
      showNotify('error', 'Không thể đổi loại đơn', errorMessage);
    } finally {
      setConvertSubmitting(false);
    }
  };

  // Mở modal "Sửa" trong drawer "Lịch sử đơn tháng" — form hiện field theo
  // đúng loại đơn (giờ bắt đầu/kết thúc cho Tăng ca/Trực tối/Live, ngày cho
  // Nghỉ phép tháng, giờ check-in/out thực tế cho Giải trình...).
  const openEditRequestModal = (item: any) => {
    setEditRequestError(null);
    setEditRequestForm({
      reason: item.reason || '',
      start_time: item.start_time || item.check_in || '',
      end_time: item.end_time || item.check_out || '',
      attendance_date: item.attendance_date || item.event_date || '',
      actual_check_in: item.actual_check_in || '',
      actual_check_out: item.actual_check_out || '',
    });
    setEditRequestItem(item);
  };

  const hasTimeRange = (item: any) =>
    item._type === 'registration' &&
    !['OFF_DUTY', 'UNAUTHORIZED_ABSENCE', 'SHIFT_CHANGE'].includes(item.registration_type) &&
    !(item._groupIds?.length > 1);

  // Các event_type trong "Lịch sử sự kiện" (modal Chi tiết ngày) thực sự là
  // MỘT LÁ ĐƠN (Sửa/Huỷ được) — khác với event log chấm công và các event
  // phê duyệt tổng hợp (*_approval) vốn chỉ để hiển thị.
  const TIMELINE_REQUEST_EVENT_TYPES = [
    'explanation', 'overtime', 'extra_hours', 'night_shift', 'live',
    'livestream', 'online_work', 'off_duty', 'unauthorized_absence',
    'shift_change',
  ];

  /**
   * Tìm item đơn (đúng shape mà openEditRequestModal/openCancelRequest cần —
   * có _type, _groupIds, can_self_cancel...) tương ứng với 1 event trong
   * timeline "Chi tiết ngày".
   *
   * Cố tình tra ngược về monthlyRequestHistory (dựng từ calendar-view) thay vì
   * dựng item mới từ chính `ev`: timeline lấy dữ liệu từ
   * attendanceDetails[].events nên KHÔNG có can_self_cancel/_groupIds. Nhờ tra
   * ngược, nút Sửa/Huỷ ở đây dùng chung 100% điều kiện quyền + API với drawer
   * "Lịch sử đơn tháng" (kể cả huỷ cả nhóm đơn Nghỉ không phép nhiều ngày).
   */
  const findRequestItemForEvent = (ev: any): any | null => {
    if (!TIMELINE_REQUEST_EVENT_TYPES.includes(ev?.event_type)) return null;

    const pools: Array<[any[], string]> = [
      [monthlyRequestHistory.explanations, 'explanation'],
      [monthlyRequestHistory.leaveRequests, 'explanation'],
      [monthlyRequestHistory.registrations, 'registration'],
      [monthlyRequestHistory.onlineWorks, 'online_work'],
    ];
    const evId = ev?.id;
    const evCode = ev?.data?.request_code;

    for (const [pool, _type] of pools) {
      const found = pool.find(
        (it: any) =>
          String(it.id) === String(evId) ||
          (it._groupIds || []).some((gid: any) => String(gid) === String(evId)) ||
          (!!evCode && it.request_code === evCode)
      );
      if (found) return { ...found, _type };
    }
    return null;
  };

  // Cùng điều kiện với drawer "Lịch sử đơn tháng": BE tính sẵn can_self_cancel
  // (còn Chờ duyệt + chưa qua bước quản lý trực tiếp duyệt, hoặc HCNS đã "Mở
  // khoá đặc biệt"). Fallback cho dữ liệu cache cũ chưa có field này.
  const canSelfEditRequest = (item: any): boolean =>
    !!item?.id &&
    !!(item.can_self_cancel ?? (item.status === 'PENDING' && !item.direct_manager_approved));

  const handleUpdateRequest = async () => {
    const item = editRequestItem;
    if (!item) return;
    setEditRequestSubmitting(true);
    setEditRequestError(null);
    try {
      if (item._groupIds?.length > 1 && item._requestCode) {
        const result = await attendanceService.updateRegistrationRequestGroup(item._requestCode, {
          reason: editRequestForm.reason,
        });
        const skipped = result?.skipped || [];
        if (skipped.length > 0) {
          showNotify(
            'error',
            'Sửa chưa trọn vẹn',
            `Có ${skipped.length} ngày không sửa được (đã quá hạn/đã duyệt): ${skipped.map((s: any) => s.reason).join('; ')}`,
          );
        } else {
          showNotify('success', 'Đã lưu thay đổi', 'Đơn đã được cập nhật thành công.');
        }
      } else if (item._type === 'explanation' && item.explanation_type === 'LEAVE') {
        await attendanceService.updateMonthlyLeaveRequest(item.id, {
          reason: editRequestForm.reason,
          attendance_date: editRequestForm.attendance_date,
        });
        showNotify('success', 'Đã lưu thay đổi', 'Đơn đã được cập nhật thành công.');
      } else if (item._type === 'registration') {
        const payload: any = { reason: editRequestForm.reason };
        if (hasTimeRange(item)) {
          payload.start_time = editRequestForm.start_time;
          payload.end_time = editRequestForm.end_time;
        }
        await attendanceService.updateRegistrationRequest(item.id, payload);
        showNotify('success', 'Đã lưu thay đổi', 'Đơn đã được cập nhật thành công.');
      } else if (item._type === 'online_work') {
        await attendanceService.updateOnlineWorkRequest(item.id, { reason: editRequestForm.reason });
        showNotify('success', 'Đã lưu thay đổi', 'Đơn đã được cập nhật thành công.');
      } else {
        await attendanceService.updateAttendanceExplanation(item.id, {
          reason: editRequestForm.reason,
          actual_check_in: editRequestForm.actual_check_in || undefined,
          actual_check_out: editRequestForm.actual_check_out || undefined,
        });
        showNotify('success', 'Đã lưu thay đổi', 'Đơn đã được cập nhật thành công.');
      }
      setEditRequestItem(null);
      await refreshAllData();
    } catch (error: any) {
      const errorMessage = extractApiErrorMessage(error, 'Sửa đơn thất bại. Vui lòng thử lại.');
      setEditRequestError(errorMessage);
    } finally {
      setEditRequestSubmitting(false);
    }
  };

  const fetchAttendanceDetailsForDate = async (date: Date) => {
    try {
      setFetchingDetails(true);
      // Format date to YYYY-MM-DD in local timezone
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      // Fetch attendance records for the selected date
      const response = await attendanceService.getAttendanceRecords({
        start_date: dateStr,
        end_date: dateStr,
        employee_id: currentEmployee?.id,
        department_id: currentEmployee?.department?.id,
        page_size: 50,
      });

      setAttendanceDetails(response.results);

      // Cập nhật lại penaltyAmount từ record mới nhất nếu có
      if (response.results && response.results.length > 0) {
        const record = response.results[0];
        // Ưu tiên dùng dữ liệu từ engine nếu có (engine_summary hoặc engine_context thường được map vào record ở BE)
        // Nếu không có trường penalty tổng, ta cộng late + early
        const newPenalty = (record.late_penalty || 0) + (record.early_leave_penalty || 0);
        setPenaltyAmount(newPenalty);
      }
      
      return response.results;
    } catch (error) {
      console.error('Error fetching attendance details:', error);
      setAttendanceDetails([]);
      return [];
    } finally {
      setFetchingDetails(false);
    }
  };

  const handleDateClick = async (date: Date, dayData?: any) => {
    setSelectedDate(date);
    setSelectedDayData(dayData);
    setShowAttendanceModal(true);

    // Set approved requests từ dayData ngay lập tức (không reset về mảng rỗng)
    setAllExplanations(dayData?.allExplanations || []);
    setPenaltyAmount(dayData?.engine_context?.penalty_amount || 0);

    // Fetch chi tiết bản ghi (bao gồm Lịch sử sự kiện)
    await fetchAttendanceDetailsForDate(date);
  };

  const handleCloseModal = () => {
    setShowAttendanceModal(false);
    setSelectedDate(null);
    setSelectedDayData(null);
    setAllExplanations([]);
  };

  const handleOpenSupplementaryRequest = () => {
    setShowSupplementaryRequestModal(true);
  };

  const handleCloseSupplementaryRequest = () => {
    setShowSupplementaryRequestModal(false);
    resetSupplementaryForm();
  };

  const handleSupplementaryRequestChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;
    if (name === 'note') setFormNote(value);
  };

  const handleSubmitSupplementaryRequest = async () => {
    if (!selectedDate || !currentEmployee || !selectedContext) {
      showNotify(
        'error',
        'Thông tin chưa đầy đủ',
        'Vui lòng hoàn thành thông tin trước khi gửi.'
      );
      return;
    }

    if (!formNote?.trim() && selectedReason !== 'incomplete_attendance' && selectedContext !== 'monthly_leave' && selectedReason !== 'off_duty' && selectedReason !== 'ca2') {
      showNotify(
        'error',
        'Thiếu ghi chú',
        'Vui lòng nhập ghi chú/lý do trước khi gửi đơn.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // -------------------------------------------------------------------------
      // OVERWRITE LOGIC: Delete existing pending requests for the same day/type
      // -------------------------------------------------------------------------
      try {
        const existingRegistrations = selectedDayData?.registrations || [];

        // Buổi của đơn đang gửi. Đơn ở buổi khác (vd đã có nghỉ không phép sáng,
        // giờ gửi nghỉ phép chiều) không bị chặn và không bị huỷ ở dưới — trước
        // đây gửi nghỉ phép tháng là huỷ sạch mọi đơn chờ duyệt trong ngày.
        const newPeriod: DayPeriod | null =
          selectedContext === 'monthly_leave' || selectedContext === 'online_work' ? shiftToPeriod(selectedReason)
          : selectedReason === 'business_trip' ? shiftToPeriod(businessTripShift)
          : selectedReason === 'first_day' ? shiftToPeriod(firstDayShift)
          : null;
        const sameSlot = (r: any) => periodsOverlap(newPeriod, requestPeriod(r));

        // 1. NGĂN CHẶN nếu đã có đơn cùng loại được PHÊ DUYỆT (cùng buổi)
        const approvedSameType = existingRegistrations.find((r: any) => {
          if (r.status?.toUpperCase() !== 'APPROVED') return false;
          if (!sameSlot(r)) return false;
          const rType = r.event_type?.toUpperCase();
          const rData = r.data || r;
          const rReason = (rData.reason || '').toLowerCase();
          const rExplType = rData.explanation_type?.toUpperCase();

          if (selectedContext === 'explanation') {
             const targetType = (({
               late_minutes: 'LATE', early_leave_minutes: 'EARLY_LEAVE', incomplete_attendance: 'INCOMPLETE_ATTENDANCE',
               business_trip: 'BUSINESS_TRIP', first_day: 'FIRST_DAY'
             } as Record<string, string>)[selectedReason as string]);
             return rType === 'EXPLANATION' && rExplType === targetType;
          }
          if (selectedContext === 'monthly_leave') {
             return rType === 'EXPLANATION' && rExplType === 'LEAVE';
          }
          if (selectedContext === 'online_work') {
             return rType === 'ONLINE_WORK';
          }
          return false;
        });

        if (approvedSameType) {
           showNotify('error', 'Không thể gửi đơn', 'Đã có đơn cùng loại được duyệt cho ngày/ca này.');
           setIsSubmitting(false);
           return;
        }

        // Chỉ ghi đè đơn chờ duyệt đụng buổi với đơn mới.
        const pendingRequests = existingRegistrations.filter((r: any) => r.status === 'PENDING' && sameSlot(r));

        if (['monthly_leave', 'online_work', 'explanation', 'registration'].includes(selectedContext)) {
          for (const existing of pendingRequests) {
            const modelId = existing.data?.id || existing.id;
            const existingType = (existing.event_type || '').toLowerCase();
            const isExistingReg = ['overtime', 'extra_hours', 'night_shift', 'live', 'off_duty'].includes(existingType);

            // A. Nếu đang gửi Nghỉ phép tháng: Xóa hết (các đơn cùng buổi)
            if (selectedContext === 'monthly_leave') {
              console.log(`Global Overwrite: Deleting existing pending ${existingType} due to Leave`);
              if (existingType === 'online_work') {
                await attendanceService.cancelOnlineWorkRequest(modelId);
              } else if (existingType === 'explanation' && existing.data?.explanation_type === 'LEAVE') {
                await attendanceService.cancelMonthlyLeaveRequest(modelId);
              } else if (existingType === 'explanation') {
                await attendanceService.cancelAttendanceExplanation(existing.id);
              } else {
                await attendanceService.cancelRegistrationRequest(modelId);
              }
            }
            // B. Nếu đang gửi Làm online: Xóa Giải trình, Nghỉ phép, online cũ và "Vào/Ra trực"
            else if (selectedContext === 'online_work') {
              if (existingType === 'explanation' && existing.data?.explanation_type === 'LEAVE') {
                await attendanceService.cancelMonthlyLeaveRequest(modelId);
              } else if (existingType === 'explanation') {
                await attendanceService.cancelAttendanceExplanation(existing.id);
              } else if (existingType === 'online_work') {
                await attendanceService.cancelOnlineWorkRequest(modelId);
              } else if (existingType === 'off_duty') {
                console.log('Global Overwrite: Deleting Off-Duty Registration due to Online Work');
                await attendanceService.cancelRegistrationRequest(modelId);
              }
            }
            // C. Nếu đang gửi Giải trình: Xóa Online, Nghỉ phép và Giải trình cùng loại
            else if (selectedContext === 'explanation') {
               if (existingType === 'online_work') {
                 await attendanceService.cancelOnlineWorkRequest(modelId);
               } else if (existingType === 'explanation' && existing.data?.explanation_type === 'LEAVE') {
                 await attendanceService.cancelMonthlyLeaveRequest(modelId);
               } else if (existingType === 'explanation') {
                  const explMap: any = {
                    late_minutes: 'LATE',
                    early_leave_minutes: 'EARLY_LEAVE',
                    incomplete_attendance: 'INCOMPLETE_ATTENDANCE',
                    business_trip: 'BUSINESS_TRIP',
                    first_day: 'FIRST_DAY',
                  };
                  const targetType = explMap[selectedReason as string];
                  if (existing.data?.explanation_type === targetType) {
                    console.log(`Overwriting existing pending same-type explanation (${targetType}) request:`, existing.id);
                    await attendanceService.cancelAttendanceExplanation(existing.id);
                  }
               }
            }
            // D. Nếu đang gửi Đăng ký (OT, Trực...):
            else if (selectedContext === 'registration') {
              // Chỉ xóa đơn Đăng ký cũ CÙNG LOẠI VÀ CÙNG KHUNG GIỜ (tức đang gửi lại/sửa
              // đúng đơn cũ). Nếu khung giờ khác thì đây là 1 đơn khác trong cùng ngày
              // (VD: tăng ca 5h30-6h30 ở công ty + tăng ca 21h-23h seeding live) — phải
              // giữ cả 2, không được xoá đơn cũ chỉ vì cùng loại "overtime".
              if (isExistingReg && existingType === selectedReason) {
                const newStartTime = selectedReason === 'overtime' ? overtimeStartTime
                  : selectedReason === 'extra_hours' ? extraHoursStartTime
                  : selectedReason === 'night_shift' ? nightShiftStartTime
                  : selectedReason === 'live' ? liveStartTime
                  : selectedReason === 'off_duty' ? '08:30'
                  : null;
                const newEndTime = selectedReason === 'overtime' ? overtimeEndTime
                  : selectedReason === 'extra_hours' ? extraHoursEndTime
                  : selectedReason === 'night_shift' ? nightShiftEndTime
                  : selectedReason === 'live' ? liveEndTime
                  : selectedReason === 'off_duty' ? '17:30'
                  : null;
                const existingStartTime = existing.start_time ?? existing.data?.start_time ?? null;
                const existingEndTime = existing.end_time ?? existing.data?.end_time ?? null;
                const isSameTimeWindow = (existingStartTime || null) === (newStartTime || null)
                  && (existingEndTime || null) === (newEndTime || null);
                if (isSameTimeWindow) {
                  await attendanceService.cancelRegistrationRequest(modelId);
                }
              }
              // Nếu đăng ký mới là "Vào/Ra trực": Xóa Online, Nghỉ phép
              if (selectedReason === 'off_duty') {
                if (existingType === 'online_work') {
                  await attendanceService.cancelOnlineWorkRequest(modelId);
                } else if (existingType === 'explanation' && existing.data?.explanation_type === 'LEAVE') {
                  await attendanceService.cancelMonthlyLeaveRequest(modelId);
                }
              }
              // Nếu đăng ký OT/Trực...: Xóa Nghỉ phép (nhưng vẫn cho phép Online)
              else {
                if (existingType === 'explanation' && existing.data?.explanation_type === 'LEAVE') {
                  await attendanceService.cancelMonthlyLeaveRequest(modelId);
                }
              }
            }
          }
        }
      } catch (deleteError) {
        console.warn('Silent failure during overwrite (deleting old request):', deleteError);
        // Vẫn tiếp tục submit dù huỷ đơn cũ thất bại. Từ 10/2026 việc huỷ đơn
        // nghỉ phép / nghỉ không phép có thể bị backend chặn hợp lệ, KHÔNG phải
        // lỗi lạ: quản lý không còn quyền huỷ 2 loại đơn này, và quá hạn duyệt
        // thì không ai huỷ được (xem hrm/registration_views.py
        // ::_cancel_single_event). Khi đó bước tạo đơn mới ngay bên dưới sẽ tự
        // báo lỗi hạn/trùng ngày cho người dùng, nên không cần chặn ở đây.
      }

      // Get original status from attendance details
      let originalStatus = 'ABSENT';
      if (attendanceDetails.length > 0) {
        originalStatus = attendanceDetails[0].status;
      }

      // Format date to YYYY-MM-DD
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      // 1. NGĂN CHẶN NẾU ĐƠN CỦA LOẠI ĐANG CHỌN ĐÃ PHÊ DUYỆT (LỚP PHÒNG THỦ THỨ 2)
      const registrations = selectedDayData?.registrations || [];
      const hasApprovedSameType = registrations.some((r: any) => {
        if (r.status?.toUpperCase() !== 'APPROVED') return false;
        const rType = r.event_type?.toUpperCase();
        const rData = r.data || r;
        const rExplType = rData.explanation_type?.toUpperCase();
        const rReason = (rData.reason || '').toLowerCase();

        if (selectedContext === 'explanation') {
          const targetType = (({
            late_minutes: 'LATE', early_leave_minutes: 'EARLY_LEAVE', incomplete_attendance: 'INCOMPLETE_ATTENDANCE',
            business_trip: 'BUSINESS_TRIP', first_day: 'FIRST_DAY'
          } as Record<string, string>)[selectedReason as string]);
          return rType === 'EXPLANATION' && rExplType === targetType;
        }
        if (selectedContext === 'monthly_leave') {
          const isLeave = rType === 'EXPLANATION' && rExplType === 'LEAVE';
          return isLeave && (
            requestReasonMatchesSession(rReason, selectedReason as string) ||
            requestReasonMatchesSession(rReason, 'full_day')
          );
        }
        if (selectedContext === 'online_work') {
          const isOnline = rType === 'ONLINE_WORK';
          return isOnline && (
            requestReasonMatchesSession(rReason, selectedReason as string) ||
            requestReasonMatchesSession(rReason, 'full_day')
          );
        }
        return false;
      });

      if (hasApprovedSameType && selectedContext !== 'registration') {
        showNotify(
          'warning',
          'Đã có đơn được duyệt',
          'Bạn đã có một đơn cùng loại/ca này được phê duyệt cho ngày đang chọn.'
        );
        setIsSubmitting(false);
        return;
      }

      // Validate business trip shift selection
      if (selectedReason === 'business_trip' && !businessTripShift) {
        showNotify('error', 'Thiếu thông tin', 'Vui lòng chọn ca (sáng/chiều/cả ngày) cho đơn công tác');
        setIsSubmitting(false);
        return;
      }
      if (selectedReason === 'first_day' && !firstDayShift) {
        showNotify('error', 'Thiếu thông tin', 'Vui lòng chọn ca (sáng/chiều/cả ngày) cho đơn ngày đầu đi làm');
        setIsSubmitting(false);
        return;
      }

      // Construct reason string
      let reasonLabel = '';
      if (selectedContext === 'explanation') {
        if (selectedReason === 'business_trip') {
          const btShiftMap: Record<string, string> = {
            morning: 'Đi công tác ca sáng',
            afternoon: 'Đi công tác ca chiều',
            full_day: 'Đi công tác cả ngày',
          };
          reasonLabel = btShiftMap[businessTripShift || ''] || 'Đi công tác';
        } else if (selectedReason === 'first_day') {
          const fdShiftMap: Record<string, string> = {
            morning: 'Ngày đầu đi làm ca sáng',
            afternoon: 'Ngày đầu đi làm ca chiều',
            full_day: 'Ngày đầu đi làm cả ngày',
          };
          reasonLabel = fdShiftMap[firstDayShift || ''] || 'Ngày đầu đi làm';
        } else {
          reasonLabel = explanationReasons.find((r) => r.id === selectedReason)?.label || '';
        }
      } else if (selectedContext === 'registration') {
        reasonLabel =
          registrationReasons.find((r) => r.id === selectedReason)?.label || '';
      } else if (selectedContext === 'online_work') {
        const onlineMap: Record<string, string> = {
          morning: 'Làm online sáng',
          afternoon: 'Làm online chiều',
          full_day: 'Làm online cả ngày',
          checkpage: 'Làm online checkpage',
        };
        reasonLabel = onlineMap[selectedReason as string] || 'Làm việc online';
      } else if (selectedContext === 'monthly_leave') {
        const leaveMap: Record<string, string> = {
          morning: 'Nghỉ ca sáng',
          afternoon: 'Nghỉ ca chiều',
          full_day: 'Nghỉ cả ngày',
        };
        reasonLabel = leaveMap[selectedReason as string] || 'Nghỉ phép tháng';
      } else if (selectedContext === 'unauthorized_absence') {
        const halfDayLabelMap: Record<string, string> = {
          morning: 'Nghỉ không phép (sáng)',
          afternoon: 'Nghỉ không phép (chiều)',
          full_day: 'Nghỉ không phép',
        };
        reasonLabel = halfDayLabelMap[unauthorizedAbsenceHalfDayPeriod] || 'Nghỉ không phép';
      }

      let finalReason = formNote
        ? (reasonLabel ? `${reasonLabel}: ${formNote}` : formNote)
        : reasonLabel;

      // Đặc biệt cho nghỉ phép: Ưu tiên note, nếu không có note thì dùng label (ca sáng/chiều)
      if (selectedContext === 'monthly_leave') {
        finalReason = formNote || reasonLabel;
      }

      // Map expected status
      let expectedStatus = 'PRESENT';
      if (selectedContext === 'monthly_leave' || selectedContext === 'online_work') {
        expectedStatus = (selectedReason === 'full_day' || selectedReason === 'checkpage') ? 'ABSENT' : 'HALF_DAY';
      } else if (selectedReason === 'business_trip') {
        if (businessTripShift === 'full_day') expectedStatus = 'ABSENT';
        else if (businessTripShift === 'morning' || businessTripShift === 'afternoon') expectedStatus = 'HALF_DAY';
      } else if (selectedReason === 'first_day') {
        if (firstDayShift === 'full_day') expectedStatus = 'ABSENT';
        else if (firstDayShift === 'morning' || firstDayShift === 'afternoon') expectedStatus = 'HALF_DAY';
      } else if (selectedContext === 'unauthorized_absence') {
        expectedStatus = unauthorizedAbsenceHalfDayPeriod !== 'full_day' ? 'HALF_DAY' : 'ABSENT';
      }

      let result;
      if (selectedContext === 'online_work') {
        const onlineWorkData = {
          employee_id: currentEmployee.id,
          work_date: dateStr, // Sử dụng work_date thay vì attendance_date
          work_plan: formNote || reasonLabel, // Thêm work_plan
          reason: finalReason,
          status: 'PENDING',
          expected_status: expectedStatus, // Thêm expected_status
          // Truyền tường minh thay vì để BE đoán qua chữ "sáng"/"chiều" trong
          // `reason` (finalReason ưu tiên formNote — nếu nhân sự gõ ghi chú
          // riêng không chứa đúng chữ đó, hạn tạo đơn sẽ bị tính nhầm theo ca
          // sáng) — cùng pattern đã dùng cho monthly_leave.
          half_day_period: (selectedReason === 'morning' ? 'MORNING' : selectedReason === 'afternoon' ? 'AFTERNOON' : undefined) as 'MORNING' | 'AFTERNOON' | undefined,
        };

        console.log(
          '🔵 [ONLINE WORK] Data gửi lên API:',
          JSON.stringify(onlineWorkData, null, 2)
        );

        try {
          result =
            await attendanceService.createOnlineWorkRequest(onlineWorkData);
          console.log('✅ [ONLINE WORK] API Response:', result);

          await refreshAllData();

          showNotify(
            'success',
            'Thành công',
            'Đơn làm việc online đã được gửi thành công!'
          );
        } catch (error: any) {
          console.error('❌ [ONLINE WORK] Lỗi khi tạo đơn:', error);
          console.error(
            '❌ [ONLINE WORK] Error response:',
            error.response?.data
          );

          // Kiểm tra khóa chốt công (HTTP 423)
          if (error.response?.status === 423 && error.response?.data?.error === 'FINALIZATION_LOCKED') {
            showNotify('error', 'Đã khóa chốt công', error.response.data.message || 'Tháng này đã đóng chốt công. Không thể tạo đơn. Vui lòng liên hệ HCNS để biết chi tiết.');
            return;
          }

          // Hiển thị error message từ Backend
          const errorMessage = extractApiErrorMessage(
            error,
            error.message ? `Lỗi: ${error.message}` : 'Lỗi khi tạo đơn làm việc online'
          );

          showNotify('error', 'Lỗi gửi đơn', errorMessage);
          return;
        }
      } else if (selectedContext === 'registration') {
        // Tách riêng logic xử lý cho từng loại đơn đăng ký để đảm bảo tính chính xác và thông báo rõ ràng
        if (selectedReason === 'ca2') {
          // Đăng ký làm Ca 2 cho ngày này — KHÔNG tạo EmployeeEvent như các lý
          // do khác (Tăng ca/Trực tối/...), mà ghi thẳng vào
          // ShiftRegistrationDay (mô hình requires_manager_approval): mặc
          // định Ca 1, chỉ có hiệu lực Ca 2 khi quản lý trực tiếp duyệt
          // TRƯỚC 0h ngày áp dụng (duyệt ở trang Phê duyệt).
          await shiftRegistrationService.registerCa2({
            employee_id: currentEmployee.id,
            date: dateStr,
          });
          await refreshAllData();
          showNotify('success', 'Thành công', `Đã gửi đăng ký ${ca2RegLabel}, chờ quản lý trực tiếp duyệt trước 0h ngày áp dụng.`);
        } else if (selectedReason === 'overtime') {
          // 1. Phân đoạn gửi Đơn Tăng ca (Overtime)
          const overtimeData = {
            employee_id: currentEmployee.id,
            attendance_date: dateStr,
            registration_type: 'OVERTIME' as const,
            start_time: overtimeStartTime,
            end_time: overtimeEndTime,
            reason: finalReason,
            status: 'PENDING' as const,
            ot_type: overtimeType,
          };
          result = await attendanceService.createRegistrationRequest(overtimeData);
          await refreshAllData();
          showNotify('success', 'Thành công', 'Đơn đăng ký tăng ca đã được gửi thành công!');
        } else if (selectedReason === 'extra_hours') {
          // 2. Phân đoạn gửi Đơn Làm thêm giờ (Extra Hours - Thường dành cho Part-time)
          const extraHoursData = {
            employee_id: currentEmployee.id,
            attendance_date: dateStr,
            registration_type: 'EXTRA_HOURS' as const,
            start_time: extraHoursStartTime,
            end_time: extraHoursEndTime,
            reason: finalReason,
            status: 'PENDING' as const,
          };
          result = await attendanceService.createRegistrationRequest(extraHoursData);
          await refreshAllData();
          showNotify('success', 'Thành công', 'Đơn làm thêm giờ đã được gửi thành công!');
        } else {
          // 3. Các loại đăng ký khác (Trực tối, Live, Ra trực, Nghỉ không phép)
          const otherRegMap: Record<string, 'NIGHT_SHIFT' | 'LIVE' | 'OFF_DUTY' | 'UNAUTHORIZED_ABSENCE'> = {
            night_shift: 'NIGHT_SHIFT',
            live: 'LIVE',
            off_duty: 'OFF_DUTY',
            unauthorized_absence: 'UNAUTHORIZED_ABSENCE',
          };
          const regType = otherRegMap[selectedReason as string] || 'NIGHT_SHIFT';
          const startTime = selectedReason === 'night_shift' ? nightShiftStartTime :
                           (selectedReason === 'live' ? liveStartTime : (selectedReason === 'off_duty' ? '08:30' : ''));
          const endTime = selectedReason === 'night_shift' ? nightShiftEndTime :
                         (selectedReason === 'live' ? liveEndTime : (selectedReason === 'off_duty' ? '17:30' : ''));

          const otherRegData: any = {
            employee_id: currentEmployee.id,
            attendance_date: dateStr,
            registration_type: regType,
            start_time: startTime || null,
            end_time: endTime || null,
            reason: finalReason || 'Đơn Vào/Ra trực',
            status: 'PENDING' as const,
          };
          result = await attendanceService.createRegistrationRequest(otherRegData);
          await refreshAllData();
          const regSuccessLabel = selectedReason === 'off_duty' ? 'Vào/Ra trực'
            : selectedReason === 'live' ? 'Live'
            : selectedReason === 'unauthorized_absence' ? 'Nghỉ không phép'
            : 'trực tối';
          showNotify('success', 'Thành công', `Đơn ${regSuccessLabel} đã gửi thành công!`);
        }
      } else if (selectedContext === 'unauthorized_absence') {
        // Đơn nghỉ không phép: không có giờ, không tính công — chỉ để kiểm soát số buổi nghỉ.
        // Nếu bật "nghỉ nhiều ngày liên tiếp" và có chọn ngày kết thúc hợp lệ → gửi kèm
        // end_date để backend tạo 1 đơn cho mỗi ngày trong khoảng (dateStr = ngày bắt đầu).
        const isValidRange =
          unauthorizedAbsenceIsRange && unauthorizedAbsenceEndDate && unauthorizedAbsenceEndDate >= dateStr;
        const unauthorizedAbsenceData: any = {
          employee_id: currentEmployee.id,
          attendance_date: dateStr,
          ...(isValidRange ? { end_date: unauthorizedAbsenceEndDate } : {}),
          registration_type: 'UNAUTHORIZED_ABSENCE' as const,
          start_time: null,
          end_time: null,
          reason: finalReason,
          status: 'PENDING' as const,
          // Nghỉ nửa ngày không áp dụng khi chọn khoảng nhiều ngày (isValidRange).
          expected_status: isValidRange ? 'ABSENT' : expectedStatus,
          ...(!isValidRange && expectedStatus === 'HALF_DAY'
            ? { half_day_period: unauthorizedAbsenceHalfDayPeriod === 'morning' ? 'MORNING' : 'AFTERNOON' }
            : {}),
        };
        result = await attendanceService.createRegistrationRequest(unauthorizedAbsenceData);
        await refreshAllData();
        if (result && typeof result === 'object' && 'results' in (result as any)) {
          // Response dạng nhiều ngày: { results: [...], skipped_dates: [...] }
          const multiResult = result as { results: any[]; skipped_dates: string[] };
          const createdCount = multiResult.results.length;
          const skippedCount = multiResult.skipped_dates.length;
          const skippedNote = skippedCount > 0
            ? ` (bỏ qua ${skippedCount} ngày đã có đơn: ${multiResult.skipped_dates.join(', ')})`
            : '';
          showNotify('success', 'Thành công', `Đơn nghỉ không phép đã được gửi cho ${createdCount} ngày${skippedNote}!`);
        } else {
          showNotify('success', 'Thành công', 'Đơn nghỉ không phép đã được gửi thành công!');
        }
      } else {
        // Giải trình (LATE, EARLY_LEAVE, INCOMPLETE_ATTENDANCE, BUSINESS_TRIP, FIRST_DAY)
        const explanationTypeMap: Record<string, string> = {
          late_minutes: 'LATE',
          early_leave_minutes: 'EARLY_LEAVE',
          incomplete_attendance: 'INCOMPLETE_ATTENDANCE',
          business_trip: 'BUSINESS_TRIP',
          first_day: 'FIRST_DAY',
        };
        let explanationType = explanationTypeMap[selectedReason as string] || 'LATE';

        // Đảm bảo đơn nghỉ phép tháng có type là LEAVE
        if (selectedContext === 'monthly_leave') {
          explanationType = 'LEAVE';
        }

        console.log('🔍 DEBUG explanation_type mapping:', {
          selectedContext,
          selectedReason,
          explanationType,
          finalReason,
        });

        const explanationData: any = {
          employee_id: currentEmployee.id,
          attendance_date: dateStr,
          original_status: originalStatus,
          expected_status: expectedStatus,
          reason: finalReason,
          explanation_type: explanationType,
          status: 'PENDING',
        };

        // Công tác nửa ngày — gửi tường minh buổi sáng/chiều thay vì để BE
        // đoán qua chữ trong reason (cùng bug class đã sửa cho Nghỉ phép
        // tháng/Nghỉ không phép: nếu nhân sự gõ ghi chú riêng, hạn tạo đơn
        // 2 giờ trước ca sẽ bị tính nhầm theo ca sáng).
        if (explanationType === 'BUSINESS_TRIP' && (businessTripShift === 'morning' || businessTripShift === 'afternoon')) {
          explanationData.half_day_period = businessTripShift === 'morning' ? 'MORNING' : 'AFTERNOON';
        }

        if (explanationType === 'INCOMPLETE_ATTENDANCE') {
          // Validate: phải chọn giờ bị quên
          if (forgotPunchType === 'checkin' && !forgotCheckinTime) {
            showNotify('error', 'Thiếu thông tin', 'Vui lòng chọn giờ check-in bị quên');
            return;
          }
          if (forgotPunchType === 'checkout' && !forgotCheckoutTime) {
            showNotify('error', 'Thiếu thông tin', 'Vui lòng chọn giờ check-out bị quên');
            return;
          }

          explanationData.forgot_punch_type = forgotPunchType;
          explanationData.forgot_checkin_time = forgotCheckinTime;
          explanationData.forgot_checkout_time = forgotCheckoutTime;
          // Lấy check_in/check_out thật từ máy chấm công (raw_checkin_checkout)
          // Khi chỉ có 1 lần quẹt, máy chấm công luôn ghi vào check_in
          // → dựa vào forgotPunchType để map đúng actual_check_in/out
          const rawLogs = selectedDayData?.raw_checkin_checkout || [];
          const firstLog = rawLogs[0];
          const rawCheckIn = firstLog?.check_in || null;
          const rawCheckOut = firstLog?.check_out || null;

          if (forgotPunchType === 'checkin') {
            // NV quên vào → lần quẹt duy nhất (nằm ở check_in) thực ra là giờ ra
            explanationData.actual_check_in = null;
            explanationData.actual_check_out = rawCheckOut || rawCheckIn;
          } else {
            // NV quên ra → check_in là đúng
            explanationData.actual_check_in = rawCheckIn;
            explanationData.actual_check_out = null;
          }
        }

        // Gửi kèm tiền phạt và số phút của vi phạm tương ứng (Snapshot data)
        const record = attendanceDetails[0];
        if (record) {
          if (explanationType === 'LATE') {
            explanationData.late_penalty = record.late_penalty;
            explanationData.late_minutes = record.late_minutes;
          } else if (explanationType === 'EARLY_LEAVE') {
            explanationData.early_leave_penalty = record.early_leave_penalty;
            explanationData.early_leave_minutes = record.early_leave_minutes;
          } else if (explanationType === 'BUSINESS_TRIP') {
            // Đối với đi công tác, gửi kèm tất cả vi phạm hiện có để BE xử lý miễn giảm snapshot
            if (record.late_minutes > 0) {
              explanationData.late_penalty = record.late_penalty;
              explanationData.late_minutes = record.late_minutes;
            }
            if (record.early_leave_minutes > 0) {
              explanationData.early_leave_penalty = record.early_leave_penalty;
              explanationData.early_leave_minutes = record.early_leave_minutes;
            }
          }
        }

        if (selectedContext === 'monthly_leave') {
          result = await attendanceService.createMonthlyLeaveRequest({
            employee_id: currentEmployee.id,
            attendance_date: dateStr,
            reason: finalReason,
            expected_status: expectedStatus,
            original_status: originalStatus,
            // Truyền tường minh thay vì để BE đoán qua chữ "sáng"/"chiều"
            // trong `reason` (finalReason ưu tiên formNote — nếu nhân sự gõ
            // ghi chú riêng không chứa đúng chữ đó, hạn tạo đơn sẽ bị tính
            // nhầm theo ca sáng).
            half_day_period: selectedReason === 'morning' ? 'MORNING' : selectedReason === 'afternoon' ? 'AFTERNOON' : undefined,
          });
        } else {
          result = await attendanceService.createAttendanceExplanation(explanationData);
        }

        await refreshAllData();
        const successMsg = `Đơn ${reasonLabel || (selectedContext === 'monthly_leave' ? 'nghỉ phép tháng' : 'giải trình')} đã được gửi thành công!`;
        showNotify('success', 'Thành công', successMsg);

        // Nếu là đơn giải trình, không đóng modal mà reset về bước 2 (Chọn lý do)
        // để người dùng có thể làm tiếp các đơn khác (ví dụ xong đi muộn còn về sớm)
        if (selectedContext === 'explanation') {
          const prevContext = selectedContext;
          resetSupplementaryForm();
          setSelectedContext(prevContext);
          setCurrentStep(2);
          return; // Dừng lại ở đây, không gọi handleClose...
        }
      }

      handleCloseSupplementaryRequest();
    } catch (error: any) {
      console.error('Error submitting supplementary request:', error);

      // Kiểm tra khóa chốt công (HTTP 423)
      if (error.response?.status === 423 && error.response?.data?.error === 'FINALIZATION_LOCKED') {
        showNotify('error', 'Đã khóa chốt công', error.response.data.message || `Tháng này đã đóng chốt công. Không thể tạo đơn. Vui lòng liên hệ HCNS để biết chi tiết.`);
      } else {
        const errorMessage = extractApiErrorMessage(
          error,
          selectedContext === 'online_work'
            ? 'Gửi đơn làm việc online thất bại. Vui lòng thử lại.'
            : 'Gửi đơn bổ sung công thất bại. Vui lòng thử lại.'
        );
        showNotify('error', 'Lỗi hệ thống', errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý chấm công</h1>
          <p className="text-gray-900 mt-0.5 text-sm">
            Theo dõi và quản lý chấm công, đi muộn, về sớm, nghỉ phép của nhân
            viên.
          </p>
        </div>
        <button
          onClick={() => {
            setShowRequestHistoryDrawer(true);
            setHistoryActiveTab('all');
          }}
          className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white border border-violet-200 text-violet-700 rounded-xl shadow-sm hover:bg-violet-50 hover:border-violet-300 hover:shadow-md transition-all duration-200 font-medium text-sm"
        >
          <ClipboardDocumentListIcon className="h-5 w-5" />
          <span className="hidden sm:inline">Lịch sử đơn tháng</span>
          <span className="sm:hidden">Lịch sử</span>
          {/* Badge tổng số đơn */}
          {(monthlyRequestHistory.explanations.length + monthlyRequestHistory.registrations.length + monthlyRequestHistory.onlineWorks.length) > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-violet-600 text-white rounded-full">
              {monthlyRequestHistory.explanations.length + monthlyRequestHistory.registrations.length + monthlyRequestHistory.onlineWorks.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab Bản thân / Nhân viên - chỉ hiện tab "Nhân viên" cho Admin/HR/Trưởng phòng */}
      {canViewTeamAttendance && (
        <div className="flex items-center gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('self')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'self'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            Bản thân
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('team')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'team'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            Nhân viên
          </button>
        </div>
      )}

      {activeTab === 'team' && canViewTeamAttendance ? (
        <AttendanceView />
      ) : (
        <>
          {/* Banner hạn chốt công */}
          <FinalizationLockBanner
            year={currentDate.getFullYear()}
            month={currentDate.getMonth() + 1}
            bypassRoles={['ADMIN']}
          />


          {/* Skeleton Loading for Stats */}
      {loading && initialLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-gray-50 h-32 rounded-2xl animate-pulse border border-gray-100"></div>
          ))}
        </div>
      )}

      {/* Summary Statistics - Responsive Grid */}
      {!initialLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {/* === KPIs chính === */}
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
              <span className="text-3xl font-bold text-gray-900">
                {calendarSummary?.total_work_days ?? monthlyWorkCredits?.results?.[0]?.attendance_summary?.total_days ?? 0}
              </span>
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
              <span className="text-3xl font-bold text-gray-900">
                {calendarSummary?.full_days ?? 0}
              </span>
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
              <span className="text-3xl font-bold text-gray-900">
                {calendarSummary?.absent_days ?? 0}
              </span>
              <span className="text-sm text-gray-500">ngày</span>
            </div>
          </div>

          <div className="group bg-white p-4 rounded-2xl shadow-sm border border-rose-200 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-rose-700"></div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-rose-50 rounded-lg">
                <ShieldExclamationIcon className="h-6 w-6 text-rose-700" />
              </div>
              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Nghiêm trọng</span>
            </div>
            <h3 className="text-sm font-semibold text-gray-600">Nghỉ không phép</h3>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-3xl font-bold text-gray-900">
                {calendarSummary?.unauthorized_absence_days ?? 0}
              </span>
              <span className="text-sm text-gray-500">ngày</span>
            </div>
          </div>

          <div className="group bg-white p-4 rounded-2xl shadow-sm border border-violet-100 hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-violet-500"></div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-violet-50 rounded-lg">
                <ExclamationTriangleIcon className="h-6 w-6 text-violet-600" />
              </div>
              <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Chưa hoàn thành</span>
            </div>
            <h3 className="text-sm font-semibold text-gray-600">Quên chấm công</h3>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-3xl font-bold text-gray-900">
                {calendarSummary?.forgot_checkin_days ?? 0}
              </span>
              <span className="text-sm text-gray-500">ngày</span>
            </div>
          </div>
        </div>
      )}

      {/* Skeleton Loading for Secondary Stats */}
      {loading && initialLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-4 mb-10">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="bg-gray-50 h-24 rounded-xl animate-pulse border border-gray-100"></div>
          ))}
        </div>
      )}

      {/* Công việc bổ sung & Hạn mức */}
      {!initialLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-4 mb-10">
          {/* === Công việc bổ sung / Loại hình làm việc === */}
          <div className="group bg-white p-4 rounded-xl border border-amber-100 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-amber-50 rounded-lg">
                <BoltIcon className="h-5 w-5 text-amber-600" />
              </div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Tăng ca</h3>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-amber-600">
                {calendarSummary?.overtime_hours ?? 0}
              </span>
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
              <span className="text-2xl font-bold text-violet-600">
                {calendarSummary?.extra_hours ?? 0}
              </span>
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
              <span className="text-2xl font-bold text-slate-600">
                {calendarSummary?.night_shift_sessions ?? 0}
              </span>
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
              <span className="text-2xl font-bold text-rose-600">
                {calendarSummary?.live_sessions ?? 0}
              </span>
              <span className="text-[10px] text-rose-500 font-medium">ca</span>
            </div>
          </div>

          {/* === Hạn mức còn lại === */}
          {(() => {
            const maxMonthlyLeave = attendanceStats?.max_leave_per_month || 1;
            const remainingMonthlyLeave = attendanceStats?.remaining_leave ?? 1;

            return (
              <div className="group bg-white p-4 rounded-xl border border-primary-100 hover:shadow-md transition-all duration-300">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-primary-50 rounded-lg">
                    <HeartIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-tight">Nghỉ phép tháng</h3>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-primary-600">
                    {remainingMonthlyLeave}
                  </span>
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
                    <span className="text-2xl font-bold text-emerald-600">
                      {remainingOnline}
                    </span>
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
                <span className="text-2xl font-bold text-primary-600">
                  {attendanceStats?.remaining_explanations || 0}
                </span>
                <span className="text-[10px] text-primary-500 font-medium">/{attendanceStats?.max_explanations_per_month || 0} lần</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Calendar Section */}
      <div className="mb-6">
        <AttendanceCalendar
          onDateClick={handleDateClick}
          onMonthChange={(date: Date) => setCurrentDate(date)}
          employeeId={currentEmployee?.id}
          refreshTrigger={refreshDataTrigger}
          onDataLoaded={handleCalendarDataLoaded}
        />
      </div>

      {/* Disciplinary Regulations & Labor Rules Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-8">
        <div className="bg-gradient-to-r from-red-50 to-amber-50 px-6 py-4 border-b border-red-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg shadow-sm">
              <ExclamationCircleIcon className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-tight">
                Quy định kỷ luật & Nội quy lao động
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"></span>
                <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest leading-none">
                  Cập nhật mới nhất • Hiệu lực từ 08/2024
                </p>
              </div>
            </div>
          </div>
          <div className="hidden sm:block text-right">
            <span className="px-3 py-1 bg-white/60 rounded-full border border-red-200 text-[10px] font-bold text-red-600 uppercase">Ban hành: Nội bộ</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="px-6 py-3 text-left text-[10px] font-black text-gray-400 border-r border-gray-100 uppercase tracking-widest w-1/2">Nội dung vi phạm</th>
                <th className="px-6 py-3 text-left text-[10px] font-black text-gray-400 border-r border-gray-100 uppercase tracking-widest">Xử lý vi phạm</th>
                <th className="px-6 py-3 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest italic">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium whitespace-pre-wrap">
              {[
                { nội_dung: 'Quên chấm công (In-Out) nhưng không chứng minh được đi làm đúng giờ', xử_lý: 'Trừ 1.0 công làm việc', ghi_chú: '' },
                { nội_dung: 'Quên chấm công (In-Out) nhưng chứng minh được đi làm đúng giờ (nhưng quá 3 lỗi giải trình/tháng)', xử_lý: 'Trừ 0.5 công làm việc', ghi_chú: '' },
                { nội_dung: 'Đi muộn / Về sớm < 10 phút', xử_lý: '50.000 VNĐ', ghi_chú: 'Từ lần vi phạm thứ 7: x2/lần vi phạm' },
                { nội_dung: 'Đi muộn / Về sớm 11 - 30 phút', xử_lý: '100.000 VNĐ', ghi_chú: 'Từ lần vi phạm thứ 7: x2/lần vi phạm' },
                { nội_dung: 'Đi muộn / Về sớm 31 - 60 phút', xử_lý: 'Quản lý: 150.000 VNĐ\nNhân viên: 120.000 VNĐ', ghi_chú: 'Từ lần vi phạm thứ 7: x2/lần vi phạm' },
                { nội_dung: 'Đi muộn / Về sớm 61 - 120 phút', xử_lý: 'Quản lý: 250.000 VNĐ\nNhân viên: 200.000 VNĐ', ghi_chú: 'Từ lần vi phạm thứ 7: x2/lần vi phạm' },
                { nội_dung: 'Đi muộn / Về sớm > 120 phút', xử_lý: 'Trừ 0.5 công làm việc', ghi_chú: 'Từ lần vi phạm thứ 7: x2/lần vi phạm' },
                { nội_dung: 'Nghỉ không báo / Nghỉ không được duyệt', xử_lý: '500.000 VNĐ\nvà tùy mức độ vi phạm, sa thải...', ghi_chú: 'Hình thức xử lý cao nhất: Sa thải' },
              ].map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50/40 transition-colors group">
                  <td className="px-6 py-4 text-[13px] text-gray-600 border-r border-gray-50 group-hover:text-primary-600 transition-colors leading-relaxed">
                    {item.nội_dung}
                  </td>
                  <td className="px-6 py-4 text-[12px] font-black text-red-600 border-r border-gray-50">
                    {item.xử_lý}
                  </td>
                  <td className="px-6 py-4 text-[11px] text-gray-400 italic">
                    {item.ghi_chú}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-red-50/30 px-6 py-3 border-t border-red-100/50">
          <p className="text-[10px] text-gray-500 font-medium leading-relaxed italic">
            * Lưu ý: Mọi vi phạm sẽ được hệ thống dữ liệu tự động ghi nhận và áp dụng mức xử phạt theo quy định trên. Đối với các trường hợp đặc biệt phát sinh, Ban lãnh đạo HRM sẽ xem xét và quyết định hình thức xử lý cuối cùng.
          </p>
        </div>
      </div>

      {/* Attendance Details Modal */}
      {showAttendanceModal && selectedDate && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="inline-block align-bottom bg-white rounded-t-lg sm:rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-10 w-10 md:h-12 md:w-12 rounded-full bg-primary-100 sm:mx-0">
                    <CalendarIcon className="h-5 w-5 md:h-6 md:w-6 text-primary-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <div className="flex justify-between items-start">
                      <h3 className="text-base md:text-lg leading-6 font-bold text-gray-900">
                        Chi tiết ngày {selectedDate.toLocaleDateString('vi-VN')}
                      </h3>
                      <button
                        onClick={handleCloseModal}
                        className="text-gray-400 hover:text-gray-500 p-1"
                      >
                        <XMarkIcon className="h-6 w-6" />
                      </button>
                    </div>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Thông tin chi tiết về chấm công cho ngày đã chọn
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {/* Employee Info */}
                  <div className="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 mr-3 shrink-0">
                        <UserIcon className="h-6 w-6" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900 leading-tight">
                          {currentEmployee?.full_name || 'Nhân viên'}
                        </h4>
                        <p className="text-xs text-gray-500 font-medium">
                          Mã NV: {currentEmployee?.employee_id || '---'} • {currentEmployee?.department?.name || 'Vị trí'}
                        </p>
                      </div>
                    </div>
                    {penaltyAmount > 0 && (
                      <div className="flex items-center gap-3 bg-red-600 text-white px-4 py-2 rounded-xl shadow-md border border-red-700 animate-pulse">
                        <div className="bg-white/20 p-1.5 rounded-lg">
                          <ExclamationTriangleIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-black tracking-widest opacity-80 leading-none mb-1">Cần thanh toán Phạt</p>
                          <p className="text-lg font-black leading-none">{penaltyAmount.toLocaleString('vi-VN')} VNĐ</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {penaltyAmount > 0 && (
                    <div className="mb-6 p-3 bg-red-50/50 border border-red-100 rounded-xl flex items-center gap-2 text-xs text-red-700 italic">
                      <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
                      Lưu ý: Số tiền phạt được hệ thống tự động tính dựa trên quy định đi muộn/về sớm của công ty.
                    </div>
                  )}



                  {/* Attendance Details Table */}
                  <div className="border rounded-xl overflow-y-auto max-h-[60vh] shadow-sm scrollbar-thin scrollbar-thumb-gray-200">
                    {fetchingDetails ? (
                      <div className="p-8 text-center">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        <p className="mt-2 text-gray-600">
                          Đang tải chi tiết chấm công...
                        </p>
                      </div>
                    ) : attendanceDetails.length > 0 ? (
                      <>
                        {/* Desktop: Table */}
                        <table className="hidden md:table min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50 sticky top-0 z-20 shadow-sm">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
                                Ca làm
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
                                Giờ vào
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
                                Giờ ra
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
                                Tổng giờ
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
                                Trạng thái
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
                                Ghi chú / Vi phạm
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {attendanceDetails.map((record, index) => (
                              <tr key={record.id || index}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {record.shift_type_display || 'Cả ngày'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {(() => {
                                    if (
                                      (record.status === 'INCOMPLETE_ATTENDANCE' ||
                                        record.status === 'ABSENT' ||
                                        record.status === 'HALF_DAY') &&
                                      record.check_in &&
                                      !record.check_out
                                    ) {
                                      const checkInTime =
                                        record.check_in.substring(0, 5);
                                      if (checkInTime >= '12:00')
                                        return '--:--';
                                    }
                                    return record.check_in
                                      ? new Date(
                                        `2000-01-01T${record.check_in}`
                                      ).toLocaleTimeString('vi-VN', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                      : '--:--';
                                  })()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {(() => {
                                    if (
                                      (record.status === 'INCOMPLETE_ATTENDANCE' ||
                                        record.status === 'ABSENT' ||
                                        record.status === 'HALF_DAY') &&
                                      record.check_in &&
                                      !record.check_out
                                    ) {
                                      const checkInTime =
                                        record.check_in.substring(0, 5);
                                      if (checkInTime >= '12:00') {
                                        return new Date(
                                          `2000-01-01T${record.check_in}`
                                        ).toLocaleTimeString('vi-VN', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        });
                                      }
                                    }
                                    return record.check_out
                                      ? new Date(
                                        `2000-01-01T${record.check_out}`
                                      ).toLocaleTimeString('vi-VN', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                      : '--:--';
                                  })()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {record.working_hours
                                    ? `${Number(record.working_hours).toFixed(1)} giờ`
                                    : '0 giờ'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${record.status === 'LEAVE'
                                      ? 'bg-primary-100 text-primary-800'
                                      : record.status === 'INCOMPLETE_ATTENDANCE' ||
                                        ((record.check_in || record.check_out) &&
                                          (!record.check_in || !record.check_out))
                                        ? 'bg-violet-100 text-violet-800'
                                        : record.status === 'PRESENT'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : record.status === 'LATE' ||
                                            record.status === 'EARLY_LEAVE' ||
                                            record.status === 'LATE_EARLY'
                                            ? 'bg-amber-100 text-amber-800'
                                            : record.status === 'ABSENT'
                                              ? 'bg-red-100 text-red-800'
                                              : record.status === 'HALF_DAY'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-gray-100 text-gray-800'
                                      }`}
                                  >
                                    {record.status === 'INCOMPLETE_ATTENDANCE' ||
                                      ((record.check_in || record.check_out) &&
                                        (!record.check_in || !record.check_out))
                                      ? 'Quên chấm công'
                                      : record.status_display ||
                                      ATTENDANCE_STATUS_MAP[record.status] ||
                                      (record.status === 'PRESENT' ? 'Đủ công' : record.status)}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  <div className="space-y-1">
                                    {record.notes && <div>{record.notes}</div>}
                                    {(record.late_minutes > 0 ||
                                      record.early_leave_minutes > 0) && (
                                        <div className="text-xs text-gray-600">
                                          {record.late_minutes > 0 && (
                                            <div>
                                              Đi muộn: {record.late_minutes} phút
                                            </div>
                                          )}
                                          {record.early_leave_minutes > 0 && (
                                            <div>
                                              Về sớm: {record.early_leave_minutes}{' '}
                                              phút
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    {!record.notes &&
                                      record.late_minutes === 0 &&
                                      record.early_leave_minutes === 0 && (
                                        <div>-</div>
                                      )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Mobile: Card layout */}
                        <div className="md:hidden divide-y divide-gray-100">
                          {attendanceDetails.map((record, index) => {
                            const checkIn = (() => {
                              if (
                                (record.status === 'INCOMPLETE_ATTENDANCE' ||
                                  record.status === 'ABSENT' ||
                                  record.status === 'HALF_DAY') &&
                                record.check_in &&
                                !record.check_out
                              ) {
                                if (record.check_in.substring(0, 5) >= '12:00')
                                  return '--:--';
                              }
                              return record.check_in
                                ? new Date(
                                  `2000-01-01T${record.check_in}`
                                ).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                                : '--:--';
                            })();
                            const checkOut = (() => {
                              if (
                                (record.status === 'INCOMPLETE_ATTENDANCE' ||
                                  record.status === 'ABSENT' ||
                                  record.status === 'HALF_DAY') &&
                                record.check_in &&
                                !record.check_out
                              ) {
                                if (
                                  record.check_in.substring(0, 5) >= '12:00'
                                ) {
                                  return new Date(
                                    `2000-01-01T${record.check_in}`
                                  ).toLocaleTimeString('vi-VN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  });
                                }
                              }
                              return record.check_out
                                ? new Date(
                                  `2000-01-01T${record.check_out}`
                                ).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                                : '--:--';
                            })();

                            return (
                              <div
                                key={record.id || index}
                                className="p-3 space-y-2"
                              >
                                {/* Row 1: Shift name + Status badge */}
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-gray-900">
                                    {record.shift_type_display || 'Cả ngày'}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${record.status === 'LEAVE'
                                      ? 'bg-primary-100 text-primary-800'
                                      : record.status === 'INCOMPLETE_ATTENDANCE' ||
                                        ((record.check_in || record.check_out) &&
                                          (!record.check_in || !record.check_out))
                                        ? 'bg-violet-100 text-violet-800'
                                        : record.status === 'PRESENT'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : record.status === 'LATE' ||
                                            record.status === 'EARLY_LEAVE' ||
                                            record.status === 'LATE_EARLY'
                                            ? 'bg-amber-100 text-amber-800'
                                            : record.status === 'ABSENT'
                                              ? 'bg-red-100 text-red-800'
                                              : record.status === 'HALF_DAY'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-gray-100 text-gray-800'
                                      }`}
                                  >
                                    {record.status === 'INCOMPLETE_ATTENDANCE' ||
                                      ((record.check_in || record.check_out) &&
                                        (!record.check_in || !record.check_out))
                                      ? 'Quên chấm công'
                                      : record.status_display ||
                                      ATTENDANCE_STATUS_MAP[record.status] ||
                                      (record.status === 'PRESENT' ? 'Đủ công' : record.status)}
                                  </span>
                                </div>
                                {/* Row 2: Times + Hours */}
                                <div className="flex items-center gap-3 text-sm text-gray-600">
                                  <span className="font-mono">
                                    {checkIn} &rarr; {checkOut}
                                  </span>
                                  <span className="text-gray-400">|</span>
                                  <span>
                                    {record.working_hours
                                      ? `${Number(record.working_hours).toFixed(1)}h`
                                      : '0h'}
                                  </span>
                                </div>
                                {/* Row 3: Notes/penalties (if any) */}
                                {(record.notes ||
                                  record.late_minutes > 0 ||
                                  record.early_leave_minutes > 0) && (
                                    <div className="text-xs text-gray-500">
                                      {record.notes && (
                                        <span>{record.notes}</span>
                                      )}
                                      {record.late_minutes > 0 && (
                                        <span className="text-amber-600">
                                          {record.notes ? ' · ' : ''}Muộn{' '}
                                          {record.late_minutes} phút
                                        </span>
                                      )}
                                      {record.early_leave_minutes > 0 && (
                                        <span className="text-amber-600">
                                          {record.notes || record.late_minutes > 0
                                            ? ' · '
                                            : ''}
                                          Sớm {record.early_leave_minutes} phút
                                        </span>
                                      )}
                                    </div>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="p-8 text-center">
                        <svg
                          className="mx-auto h-12 w-12 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <p className="mt-2 text-gray-600">
                          Không có dữ liệu chấm công cho ngày này
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Events Timeline */}
                  {(() => {
                    // Extract all events and expand registration approvals into virtual events for the timeline
                    const allEvents: any[] = [];
                    attendanceDetails.forEach((r) => {
                      (r.events || []).forEach((ev) => {
                        // Chỉ skip các approval event đã được "synthetic expansion" (vượt qua filter phía dưới)
                        // Giữ lại các event REJECT để hiển thị chi tiết lý do từ chối
                        if (
                          ['request_approval', 'explanation_approval'].includes(
                            ev.event_type
                          ) && (ev.data?.action === 'APPROVE' || ev.data?.status === 'APPROVED')
                        )
                          return;

                        allEvents.push({
                          ...ev,
                          recordStatus: r.status,
                          recordStatusDisplay: r.status_display,
                        });

                        // Expand registrations and explanations into separate approval steps if they exist
                        if (
                          [
                            'overtime',
                            'extra_hours',
                            'night_shift',
                            'live',
                            'livestream',
                            'explanation',
                            'online_work',
                            'off_duty',
                            'unauthorized_absence',
                            'shift_change',
                          ].includes(ev.event_type)
                        ) {
                          if (ev.data?.direct_manager_approved_by_name) {
                            allEvents.push({
                              id: `v-dm-${ev.id}`,
                              event_type: 'registration_approval',
                              // Giờ duyệt THẬT. Trước 2026-09-25 chỗ này lấy giờ
                              // TẠO ĐƠN cộng thêm 1 giây — vốn chỉ là mẹo để xếp
                              // dòng duyệt nằm sau dòng tạo đơn, nhưng nó được
                              // hiển thị ra như mốc thời gian thật nên đơn duyệt
                              // sau cả tiếng vẫn hiện "duyệt 1 giây sau khi tạo",
                              // trông như hệ thống tự duyệt (HCNS báo 2026-09-25).
                              created_at: ev.data.direct_manager_approved_at || null,
                              // Khoá SẮP XẾP tách riêng khỏi mốc hiển thị: đơn
                              // cũ không có *_approved_at thì vẫn phải đứng sau
                              // dòng tạo đơn, nhưng KHÔNG được hiển thị mốc bịa
                              // (đó chính là lỗi "duyệt 1 giây sau khi tạo").
                              _sortAt: ev.data.direct_manager_approved_at ||
                                new Date(new Date(ev.created_at).getTime() + 1000).toISOString(),
                              data: {
                                approval_level: 'DIRECT_MANAGER',
                                approved_by_name:
                                  ev.data.direct_manager_approved_by_name,
                                status: 'APPROVED',
                                registration_type:
                                  ev.data.explanation_type || ev.data.registration_type || ev.event_type,
                              },
                            });
                          }
                          // Only show HR approval if NOT created by HR and NOT for an HR employee
                          const isStaffHR =
                            ev.is_hr_created ||
                            ev.employee_is_hr ||
                            ev.data?.employee_is_hr;
                          if (ev.data?.hr_approved_by_name && !isStaffHR) {
                            allEvents.push({
                              id: `v-hr-${ev.id}`,
                              event_type: 'registration_approval',
                              // Giờ duyệt THẬT — xem chú thích ở bước QLTT trên.
                              created_at: ev.data.hr_approved_at || null,
                              _sortAt: ev.data.hr_approved_at ||
                                new Date(new Date(ev.created_at).getTime() + 2000).toISOString(),
                              data: {
                                approval_level: 'HR',
                                approved_by_name: ev.data.hr_approved_by_name,
                                status: 'APPROVED',
                                registration_type:
                                  ev.data.explanation_type || ev.data.registration_type || ev.event_type,
                              },
                            });
                          }
                        }
                      });
                    });

                    const sortedEvents = [...allEvents].sort(
                      (a, b) =>
                        new Date(a._sortAt || a.created_at).getTime() -
                        new Date(b._sortAt || b.created_at).getTime()
                    );

                    const hasAnyPunch = attendanceDetails.some(
                      (r) => r.check_in || r.check_out
                    );
                    const filteredEvents = sortedEvents.filter((ev) => {
                      if (ev.event_type === 'attendance') {
                        if (!hasAnyPunch) return false;
                        // Bỏ các bản ghi chấm công (event_type === 'attendance') không có thông tin status hoặc import_source, đó là các log rác/thừa
                        if (!ev.data?.status && !ev.data?.import_source) return false;
                      }
                      return true;
                    });

                    if (filteredEvents.length === 0) return null;
                      const eventTypeLabel: Record<string, string> = {
                        attendance: 'Chấm công',
                        explanation: 'Đơn giải trình',
                        explanation_approval: 'Phê duyệt giải trình',
                        request_approval: 'Phê duyệt đơn',
                        registration_approval: 'Phê duyệt đăng ký',
                        overtime: 'Đơn đăng ký tăng ca',
                        extra_hours: 'Đơn đăng ký làm thêm giờ',
                        night_shift: 'Đơn đăng ký trực tối',
                        live: 'Đơn đăng ký Live',
                        livestream: 'Đơn đăng ký Livestream',
                        online_work: 'Đơn làm việc online',
                        off_duty: 'Đơn đăng ký Vào/Ra trực',
                        leave: 'Đơn nghỉ phép tháng',
                        unauthorized_absence: 'Đơn nghỉ không phép',
                        shift_change: 'Đơn đổi ca',
                      };
                    const statusLabel: Record<string, string> = {
                      ...ATTENDANCE_STATUS_MAP,
                      APPROVED: 'Đã duyệt',
                      REJECTED: 'Từ chối',
                      PENDING: 'Chờ duyệt',
                      CANCELLED: 'Đã huỷ',
                    };
                    // Hiển thị "Huỷ bởi ai/lúc nào/lý do gì" trong Lịch sử sự kiện —
                    // dữ liệu do soft_cancel_request() (hrm/models.py) ghi vào
                    // event.data khi huỷ qua .../cancel/. Đơn huỷ TRƯỚC khi tính
                    // năng log này triển khai (2026-09-17) sẽ không có các field
                    // này — hiển thị trống là đúng, không phải lỗi thiếu dữ liệu.
                    const renderCancelInfo = (d: any) =>
                      d?.status === 'CANCELLED' && (d?.deleted_by_name || d?.cancel_reason) ? (
                        <p className="text-gray-500">
                          Huỷ bởi: {d.deleted_by_name || 'Không rõ (huỷ trước khi có log)'}
                          {d.deleted_at && ` lúc ${new Date(d.deleted_at).toLocaleString('vi-VN')}`}
                          {d.cancel_reason && ` — "${d.cancel_reason}"`}
                        </p>
                      ) : null;
                    const approvalLevelLabel: Record<string, string> = {
                      DIRECT_MANAGER: 'Quản lý trực tiếp',
                      HR: 'HR',
                    };
                    const isApproved = (ev: AttendanceEvent) => {
                      if (
                        (ev.event_type === 'explanation' ||
                          ['overtime', 'extra_hours', 'night_shift', 'live', 'online_work', 'off_duty', 'unauthorized_absence', 'shift_change'].includes(ev.event_type) ||
                          ev.event_type === 'registration_approval') &&
                        ev.data?.status === 'APPROVED'
                      )
                        return true;
                      if (
                        (ev.event_type === 'explanation_approval' || ev.event_type === 'request_approval') &&
                        (ev.data?.action === 'APPROVE' || ev.data?.status === 'APPROVED')
                      )
                        return true;
                      return false;
                    };

                    const isRejected = (ev: AttendanceEvent) => {
                      if (
                        (ev.event_type === 'explanation' ||
                          ['overtime', 'extra_hours', 'night_shift', 'live', 'online_work', 'off_duty', 'unauthorized_absence', 'shift_change', 'request_approval', 'registration_approval'].includes(ev.event_type)) &&
                        ev.data?.status === 'REJECTED'
                      )
                        return true;
                      if (
                        (ev.event_type === 'explanation_approval' || ev.event_type === 'request_approval') &&
                        ev.data?.action === 'REJECT'
                      )
                        return true;
                      return false;
                    };
                    return (
                      <div className="mt-6">
                        <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                          <ClockIcon className="h-5 w-5 mr-2 text-primary-600" />
                          Lịch sử sự kiện
                        </h4>
                        <ol className="relative border-l border-gray-200 ml-3 space-y-4">
                          {filteredEvents.map((ev) => {
                            const approved = isApproved(ev);
                            const rejected = isRejected(ev);

                            // Clean redundant prefixes from reason (e.g., "Tăng ca: abc" -> "abc")
                            const rawReason = ev.explanation || ev.data?.reason || ev.notes || '';
                            let cleanedReason = rawReason.trim();
                            
                            // Bóc các tiền tố trong ngoặc vuông [] (ví dụ: [Đi muộn: 5 phút] Lý do -> Lý do)
                            if (cleanedReason.startsWith('[')) {
                              const closingBracketIndex = cleanedReason.indexOf(']');
                              if (closingBracketIndex !== -1) {
                                cleanedReason = cleanedReason.substring(closingBracketIndex + 1).replace(/^[\:\-\s]+/, '').trim();
                              }
                            }

                            const prefixes = [
                              ...Object.values(EXPLANATION_TYPE_MAP),
                              'Tăng ca', 'Làm thêm giờ', 'Trực tối', 'Live', 'Livestream',
                              'Ca CheckPage', 'Ca chiều tối', 'Ca gãy',
                              'Giải trình đi muộn', 'Giải trình về sớm', 'Giải trình quên chấm công', 'Giải trình đi công tác', 'Giải trình ngày đầu đi làm',
                              'Đi muộn', 'Về sớm', 'Quên chấm công', 'Làm online checkpage', 'Làm online', 'Nghỉ phép'
                            ].filter(Boolean);
                            prefixes.sort((a, b) => b.length - a.length);

                            for (const p of prefixes) {
                              if (cleanedReason.toLowerCase().startsWith(p.toLowerCase())) {
                                cleanedReason = cleanedReason.substring(p.length).replace(/^[\:\-\s]+/, '').trim();
                                break;
                              }
                            }

                            return (
                              <li key={ev.id} className="ml-4">
                                <div
                                  className={`absolute w-3 h-3 rounded-full mt-1.5 -left-1.5 border ${approved
                                    ? 'bg-emerald-500 border-emerald-300'
                                    : rejected
                                      ? 'bg-red-500 border-red-300'
                                      : 'bg-gray-300 border-gray-200'
                                    }`}
                                />
                                <div
                                  className={`p-3 rounded-lg border ${approved
                                    ? 'bg-emerald-50 border-emerald-200'
                                    : rejected
                                      ? 'bg-red-50 border-red-200'
                                      : 'bg-gray-50 border-gray-200'
                                    }`}
                                >
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${ev.event_type === 'attendance'
                                        ? 'bg-primary-100 text-primary-800'
                                        : ev.event_type === 'explanation' || (ev.event_type === 'explanation_approval' && (ev.recordStatus === 'LEAVE' || ev.data?.explanation_type === 'LEAVE'))
                                          ? 'bg-primary-100 text-primary-800'
                                          : ['overtime', 'extra_hours', 'night_shift', 'live', 'online_work', 'off_duty', 'unauthorized_absence', 'shift_change'].includes(ev.event_type) || ev.event_type === 'registration_approval' || ev.event_type === 'request_approval'
                                            ? 'bg-violet-100 text-violet-800'
                                            : 'bg-gray-100 text-gray-800'
                                        }`}
                                    >
                                      {(ev.event_type === 'explanation' || (ev.event_type === 'explanation_approval' && ev.data?.explanation_type))
                                        ? (EXPLANATION_TYPE_MAP[ev.data?.explanation_type || ''] || EXPLANATION_TYPE_MAP[ev.recordStatus || ''] || 'Giải trình')
                                        : (eventTypeLabel[ev.event_type] || ev.event_type)}
                                    </span>
                                    {approved && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
                                        ✓ Đã duyệt
                                      </span>
                                    )}
                                    {rejected && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 whitespace-nowrap">
                                        ✕ Từ chối
                                      </span>
                                    )}
                                    <time className="text-xs text-gray-500 ml-auto">
                                      {ev.created_at
                                        ? new Date(ev.created_at).toLocaleString('vi-VN')
                                        : '—'}
                                    </time>
                                  </div>
                                  {ev.event_type === 'attendance' && (ev.data?.status || ev.data?.import_source) && (
                                    <p className="text-xs text-gray-600">
                                      {ev.data?.status ? (
                                        <span>
                                          Trạng thái: Có mặt
                                        </span>
                                      ) : null}
                                      {ev.data?.import_source && (
                                        <span className={ev.data?.status ? "ml-2 text-gray-400" : "text-gray-400"}>
                                          ({IMPORT_SOURCE_MAP[ev.data.import_source] || ev.data.import_source})
                                        </span>
                                      )}
                                    </p>
                                  )}
                                  {ev.event_type === 'explanation' && (
                                    <div className="text-xs text-gray-600 space-y-0.5">
                                      {ev.data?.explanation_type === 'LEAVE' ? (
                                        <>
                                          <p className="text-gray-900 font-medium">
                                            Ca: {ev.data?.expected_status === 'HALF_DAY'
                                              ? (ev.data?.half_day_period === 'MORNING' ? 'Sáng'
                                                : ev.data?.half_day_period === 'AFTERNOON' ? 'Chiều'
                                                // Fallback cho đơn cũ tạo trước khi có half_day_period
                                                : rawReason.toLowerCase().includes('sáng') ? 'Sáng'
                                                : rawReason.toLowerCase().includes('chiều') ? 'Chiều' : 'Nửa ngày')
                                              : 'Cả ngày'}
                                          </p>
                                          {rawReason.includes(':') && (
                                            <p>{rawReason.split(':').slice(1).join(':').trim()}</p>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          {ev.data?.explanation_type === 'INCOMPLETE_ATTENDANCE' && (
                                            <div className="bg-violet-50 p-2 rounded-lg mb-2 text-violet-800 border border-violet-100">
                                              <p className="font-bold flex items-center">
                                                <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                {(() => {
                                                  const type = ev.data.forgot_punch_type;
                                                  const hasIn = ev.data.forgot_checkin_time || ev.data.actual_check_in;
                                                  const hasOut = ev.data.forgot_checkout_time || ev.data.actual_check_out;
                                                  if (type === 'checkin' || (hasIn && !hasOut)) return 'Quên Check-in';
                                                  if (type === 'checkout' || (!hasIn && hasOut)) return 'Quên Check-out';
                                                  return 'Quên cả Check-in/out';
                                                })()}
                                              </p>
                                              <p>
                                                Giờ bổ sung: {ev.data.forgot_checkin_time || ev.data.actual_check_in || '--:--'} — {ev.data.forgot_checkout_time || ev.data.actual_check_out || '--:--'}
                                              </p>
                                            </div>
                                          )}
                                          {cleanedReason && (
                                            <p className="text-gray-900 font-medium">{cleanedReason}</p>
                                          )}
                                        </>
                                      )}
                                      
                                      {/* Hiển thị chi tiết vi phạm nếu có trong dữ liệu đơn */}
                                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 font-semibold">
                                        {(ev.data?.late_minutes > 0 || ev.data?.late_penalty > 0) && (
                                          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 flex items-center gap-1">
                                            <ClockIcon className="h-3 w-3" />
                                            {ev.data.late_minutes > 0 && `Đi muộn ${ev.data.late_minutes} phút`}
                                            {ev.data.late_penalty > 0 && ` • Phạt ${ev.data.late_penalty.toLocaleString('vi-VN')}đ`}
                                          </span>
                                        )}
                                        {(ev.data?.early_leave_minutes > 0 || ev.data?.early_leave_penalty > 0) && (
                                          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 flex items-center gap-1">
                                            <ClockIcon className="h-3 w-3" />
                                            {ev.data.early_leave_minutes > 0 && `Về sớm ${ev.data.early_leave_minutes} phút`}
                                            {ev.data.early_leave_penalty > 0 && ` • Phạt ${ev.data.early_leave_penalty.toLocaleString('vi-VN')}đ`}
                                          </span>
                                        )}
                                      </div>
                                      {ev.data?.status && ev.data.status !== 'APPROVED' && (
                                        <p>
                                          Trạng thái:{' '}
                                          {statusLabel[ev.data.status] ??
                                            ev.data.status}
                                        </p>
                                      )}
                                      {renderCancelInfo(ev.data)}
                                      {ev.data?.request_code && (
                                        <p className="font-mono text-gray-500">
                                          {ev.data.request_code}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {(ev.event_type === 'explanation_approval' || ev.event_type === 'request_approval') && (
                                    <div className="text-xs text-gray-600 space-y-0.5">
                                      <p>
                                        {approvalLevelLabel[
                                          ev.data?.level || ev.data?.approval_level
                                        ] ??
                                          (ev.data?.level || ev.data?.approval_level) ??
                                          'Hệ thống'}
                                        :{' '}
                                        {ev.data?.approver_name || ev.data?.approved_by_name}
                                      </p>
                                      {ev.data?.note && ev.data.note !== 'Đã duyệt' && (
                                        <p className="italic text-gray-500">
                                          "{ev.data.note}"
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {ev.event_type === 'registration_approval' && (
                                    <div className="text-xs text-gray-600 space-y-0.5">
                                      <p>
                                        {approvalLevelLabel[
                                          ev.data?.approval_level
                                        ] ??
                                          ev.data?.approval_level ??
                                          'Unknown'}
                                        :{' '}
                                        {ev.data?.approved_by_name}
                                      </p>
                                      {ev.data?.status && ev.data.status !== 'APPROVED' && (
                                        <p>
                                          Trạng thái:{' '}
                                          {statusLabel[ev.data.status] ??
                                            ev.data.status}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {['overtime', 'extra_hours', 'night_shift', 'live', 'off_duty', 'online_work', 'unauthorized_absence', 'shift_change'].includes(ev.event_type) && (
                                    <div className="text-xs text-gray-600 space-y-0.5">
                                      {!['online_work'].includes(ev.event_type) && (ev.check_in || ev.check_out || ev.data?.start_time || ev.data?.end_time) && (
                                        <p>
                                          Thời gian: {ev.check_in || ev.data?.start_time || '--'} —{' '}
                                          {ev.check_out || ev.data?.end_time || '--'}
                                        </p>
                                      )}
                                       {ev.event_type === 'online_work' || ev.event_type === 'night_shift' || ev.event_type === 'unauthorized_absence' ? (
                                         <>
                                           <p className="text-gray-900 font-medium">
                                             Ca: {ev.event_type === 'night_shift'
                                                  ? (rawReason.toLowerCase().includes('checkpage') ? 'CheckPage' : (rawReason.toLowerCase().includes('chiều tối') ? 'Chiều tối' : (rawReason.toLowerCase().includes('gãy') ? 'Ca gãy' : 'Trực tối')))
                                                  : ev.event_type === 'unauthorized_absence'
                                                  // half_day_period là field thật (không suy đoán qua text như online_work) —
                                                  // đơn cũ tạo trước khi có field này sẽ không rõ buổi, hiện "Nửa ngày".
                                                  ? (ev.data?.expected_status === 'HALF_DAY'
                                                      ? (ev.data?.half_day_period === 'MORNING' ? 'Sáng' : ev.data?.half_day_period === 'AFTERNOON' ? 'Chiều' : 'Nửa ngày')
                                                      : 'Cả ngày')
                                                  : (rawReason.toLowerCase().includes('checkpage') ? 'CheckPage' : (rawReason.toLowerCase().includes('sáng') ? 'Sáng' : rawReason.toLowerCase().includes('chiều') ? 'Chiều' : 'Cả ngày'))}
                                           </p>
                                           {cleanedReason && (
                                             <p>{cleanedReason}</p>
                                           )}
                                         </>
                                       ) : (
                                         cleanedReason && (
                                           <p>{cleanedReason}</p>
                                         )
                                       )}
                                      {ev.data?.status && ev.data.status !== 'APPROVED' && (
                                        <p>
                                          Trạng thái:{' '}
                                          {statusLabel[ev.data.status] ??
                                            ev.data.status}
                                        </p>
                                      )}
                                      {renderCancelInfo(ev.data)}
                                      {ev.data?.request_code && (
                                        <p className="font-mono text-gray-500">
                                          {ev.data.request_code}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {ev.created_by && (
                                    <p className="text-xs text-gray-400 mt-1">
                                      Bởi: {ev.created_by}
                                    </p>
                                  )}
                                  {/* Sửa/Huỷ đơn ngay tại chỗ khi đơn CHƯA được
                                      duyệt — dùng lại đúng modal + API của drawer
                                      "Lịch sử đơn tháng" (xem findRequestItemForEvent). */}
                                  {(() => {
                                    const reqItem = findRequestItemForEvent(ev);
                                    if (!reqItem || !canSelfEditRequest(reqItem)) return null;
                                    return (
                                      <div className="flex items-center justify-end gap-1.5 mt-1.5">
                                        <button
                                          onClick={() => openEditRequestModal(reqItem)}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                                        >
                                          <PencilSquareIcon className="h-3 w-3" />
                                          Sửa
                                        </button>
                                        <button
                                          onClick={() => openCancelRequest(reqItem)}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                                        >
                                          <TrashIcon className="h-3 w-3" />
                                          Huỷ
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    );
                  })()}


                  {/* Action Buttons */}
                  <div className="mt-6 flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
                    {/* Luôn hiện nút làm đơn bổ sung để cho phép tạo đơn đăng ký (OT, tăng ca...) bất kể trạng thái ngày */}
                    <button
                      onClick={handleOpenSupplementaryRequest}
                      className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
                    >
                      <DocumentPlusIcon className="h-5 w-5 mr-2" />
                      Làm đơn bổ sung
                    </button>
                    <button
                      onClick={handleCloseModal}
                      className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
      }

      {/* Supplementary Request Modal */}
      {
        showSupplementaryRequestModal && selectedDate && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

              <div className="inline-block align-bottom bg-white rounded-t-lg sm:rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl w-full">
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-10 w-10 md:h-12 md:w-12 rounded-full bg-violet-100 sm:mx-0">
                      <DocumentPlusIcon className="h-5 w-5 md:h-6 md:w-6 text-violet-600" />
                    </div>
                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                      <div className="flex justify-between items-start">
                        <h3 className="text-base md:text-lg leading-6 font-bold text-gray-900">
                          Đơn bổ sung
                        </h3>
                        <button
                          onClick={handleCloseSupplementaryRequest}
                          className="text-gray-400 hover:text-gray-500 p-1"
                        >
                          <XMarkIcon className="h-6 w-6" />
                        </button>
                      </div>
                      <div className="mt-2">
                        <p className="text-sm text-gray-500">
                          Gửi đơn bổ sung cho ngày{' '}
                          {selectedDate.toLocaleDateString('vi-VN')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    {/* ===================== STEP-BASED FORM UI ===================== */}

                    {/* === StepIndicator === */}
                    <div className="flex items-center justify-center mb-8">
                      <div className="flex items-center">
                        {/* Step 1 */}
                        <div className="flex items-center">
                          <div
                            className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold text-sm transition-all duration-300 ${currentStep >= 1
                              ? 'bg-violet-600 text-white shadow-lg'
                              : 'bg-gray-200 text-gray-500 border-2 border-gray-300'
                              }`}
                          >
                            {selectedContext ? (
                              <svg
                                className="w-5 h-5"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            ) : (
                              '1'
                            )}
                          </div>
                          <span
                            className={`ml-3 text-sm font-medium hidden sm:block transition-colors ${currentStep >= 1 ? 'text-gray-900' : 'text-gray-400'
                              }`}
                          >
                            Chọn loại yêu cầu
                          </span>
                        </div>

                        {/* Connector Line */}
                        <div
                          className={`w-12 sm:w-24 h-1 mx-4 rounded-full transition-all duration-500 ${currentStep >= 2
                            ? 'bg-gradient-to-r from-violet-600 to-violet-600'
                            : 'bg-gradient-to-r from-violet-600 to-gray-300'
                            }`}
                        />

                        {/* Step 2 */}
                        <div className="flex items-center">
                          <div
                            className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold text-sm transition-all duration-300 ${currentStep >= 2
                              ? 'bg-violet-600 text-white shadow-lg'
                              : 'bg-gray-200 text-gray-500 border-2 border-gray-300'
                              }`}
                          >
                            {selectedReason ? (
                              <svg
                                className="w-5 h-5"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            ) : (
                              '2'
                            )}
                          </div>
                          <span
                            className={`ml-3 text-sm font-medium hidden sm:block transition-colors ${currentStep >= 2 ? 'text-gray-900' : 'text-gray-400'
                              }`}
                          >
                            Chọn lý do
                          </span>
                        </div>
                      </div>
                    </div>

                      {/* === ContextSelector (Step 1) === */}
                    <div className="space-y-4 mb-6">
                      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Chọn loại yêu cầu
                      </h3>
                      {/* Thông báo trạng thái ngày */}
                      {isFullPresent && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 animate-fadeIn mb-4">
                          <CheckCircleIcon className="h-5 w-5 text-amber-600 shrink-0" />
                          <div className="text-xs text-amber-800">
                            Ngày này bạn đã <strong>{selectedDayData?.status_badge || 'Đủ công'}</strong>. 
                            Bạn vẫn có thể làm đơn bổ sung nếu còn quota (lượt đăng ký).
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {(() => {
                          const registrations = selectedDayData?.registrations || [];
                          const hasApprovedOnlineWork = registrations.some((r: any) =>
                            r.status?.toUpperCase() === 'APPROVED' && 
                            r.event_type?.toUpperCase() === 'ONLINE_WORK'
                          );
                          const hasApprovedLeave = registrations.some((r: any) =>
                            r.status?.toUpperCase() === 'APPROVED' &&
                            r.event_type?.toUpperCase() === 'EXPLANATION' &&
                            r.data?.explanation_type === 'LEAVE'
                          );
                          const hasApprovedUnauthorizedAbsence = registrations.some((r: any) =>
                            r.status?.toUpperCase() === 'APPROVED' &&
                            r.event_type?.toUpperCase() === 'UNAUTHORIZED_ABSENCE'
                          );

                          const detail = attendanceDetails[0];
                          // Chỉ ẩn thẻ khi KHÔNG còn lý do giải trình nào khả dụng (đã lọc theo
                          // từng loại — vd đã duyệt "Quên chấm công" thì vẫn còn "Đi muộn" nếu có
                          // late_minutes thực tế), thay vì ẩn cả thẻ chỉ vì có 1 đơn bất kỳ đã duyệt.
                          const showExplanationCard = getAvailableExplanationReasons(detail, registrations).length > 0;
                          const showMonthlyLeaveCard = !hasApprovedLeave;
                          const showOnlineWorkCard = !hasApprovedOnlineWork;
                          const showUnauthorizedAbsenceCard = !hasApprovedUnauthorizedAbsence;

                          return (
                            <>
                              {/* Card 1: Giải trình đơn */}
                              {showExplanationCard && (
                                <button
                                  type="button"
                                  onClick={() => handleContextSelect('explanation')}
                                  className={`group relative p-5 bg-white border-2 rounded-xl shadow-sm transition-all duration-200 text-left ${selectedContext === 'explanation'
                                    ? 'border-violet-500 ring-2 ring-violet-100 hover:border-violet-600'
                                    : 'border-gray-200 hover:border-violet-400'
                                  }`}
                                >
                                  <div className="flex items-start space-x-4">
                                    <div className={`p-3 rounded-lg ${selectedContext === 'explanation' ? 'bg-violet-100' : 'bg-gray-100'}`}>
                                      <svg className={`w-6 h-6 ${selectedContext === 'explanation' ? 'text-violet-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </div>
                                    <div className="flex-1">
                                      <h4 className="text-base font-semibold text-gray-900">Đơn giải trình</h4>
                                      <p className="mt-1 text-sm text-gray-500">Giải trình các vi phạm hoặc lý do công việc</p>
                                    </div>
                                  </div>
                                </button>
                              )}

                              {/* Card 2: Đơn đăng ký (Always show) */}
                              <button
                                type="button"
                                onClick={() => handleContextSelect('registration')}
                                className={`group relative p-5 bg-white border-2 rounded-xl shadow-sm transition-all duration-200 text-left ${selectedContext === 'registration'
                                  ? 'border-violet-500 ring-2 ring-violet-100 hover:border-violet-600'
                                  : 'border-gray-200 hover:border-violet-400'
                                }`}
                              >
                                <div className="flex items-start space-x-4">
                                  <div className={`p-3 rounded-lg ${selectedContext === 'registration' ? 'bg-violet-100' : 'bg-primary-50'}`}>
                                    <svg className={`w-6 h-6 ${selectedContext === 'registration' ? 'text-violet-600' : 'text-primary-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="text-base font-semibold text-gray-900">Đơn đăng ký</h4>
                                    <p className="mt-1 text-sm text-gray-500">Tăng ca, trực tối, live, Vào/Ra trực</p>
                                  </div>
                                </div>
                              </button>

                              {/* Card 3: Nghỉ phép tháng */}
                              {showMonthlyLeaveCard && (() => {
                                const maxLeave = attendanceStats?.max_leave_per_month || 1;
                                const remainingLeave = attendanceStats?.remaining_leave ?? 1;
                                const isQuotaExhausted = remainingLeave <= 0;

                                return (
                                  <button
                                    type="button"
                                    disabled={isQuotaExhausted}
                                    onClick={() => !isQuotaExhausted && handleContextSelect('monthly_leave')}
                                    className={`group relative p-5 bg-white border-2 rounded-xl shadow-sm transition-all duration-200 text-left 
                                      ${isQuotaExhausted 
                                        ? 'opacity-60 grayscale-[0.5] cursor-not-allowed bg-gray-50/50 border-gray-100' 
                                        : selectedContext === 'monthly_leave' 
                                          ? 'border-violet-500 ring-2 ring-violet-100' 
                                          : 'border-gray-200 hover:border-violet-400'
                                      }`}
                                  >
                                    <div className="flex items-start space-x-4">
                                      <div className={`p-3 rounded-lg ${selectedContext === 'monthly_leave' ? 'bg-violet-100' : 'bg-primary-50'}`}>
                                        <svg className={`w-6 h-6 ${selectedContext === 'monthly_leave' ? 'text-violet-600' : 'text-primary-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                      </div>
                                      <div className="flex-1">
                                        <h4 className={`text-base font-semibold ${isQuotaExhausted ? 'text-gray-500' : 'text-gray-900'}`}>Nghỉ phép tháng</h4>
                                        <p className="mt-1 text-sm text-gray-500">
                                          {isQuotaExhausted 
                                            ? 'Đã hết lượt nghỉ phép tháng này'
                                            : `Đăng ký nghỉ phép (Còn ${remainingLeave}/${maxLeave} ngày)`}
                                        </p>
                                      </div>
                                    </div>
                                    {isQuotaExhausted && (
                                      <div className="absolute top-2 right-2">
                                        <div className="bg-gray-200 rounded-full p-1">
                                          <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                          </svg>
                                        </div>
                                      </div>
                                    )}
                                  </button>
                                );
                              })()}

                              {/* Card 4: Làm việc online */}
                              {showOnlineWorkCard && (() => {
                                const maxOnline = attendanceStats?.max_online_work_per_month || 3;
                                const remainingOnline = attendanceStats?.remaining_online_work || 0;
                                const freeSlot = onlineFreeSlot(selectedDate, attendanceStats?.online_weekend_unlimited);
                                // Chủ nhật / chiều T7 tuần 2-4 không tính hạn mức -> không khoá thẻ
                                const isOnlineQuotaExhausted =
                                  remainingOnline <= 0 && !freeSlot.sunday && !freeSlot.satAfternoon;
                                return (
                                  <button
                                    type="button"
                                    disabled={isOnlineQuotaExhausted}
                                    onClick={() => !isOnlineQuotaExhausted && handleContextSelect('online_work')}
                                    className={`group relative p-5 bg-white border-2 rounded-xl shadow-sm transition-all duration-200 text-left 
                                      ${isOnlineQuotaExhausted 
                                        ? 'opacity-60 grayscale-[0.5] cursor-not-allowed bg-gray-50/50 border-gray-100' 
                                        : selectedContext === 'online_work' 
                                          ? 'border-violet-500 ring-2 ring-violet-100 hover:border-violet-600' 
                                          : 'border-gray-200 hover:border-violet-400'
                                      }`}
                                  >
                                    <div className="flex items-start space-x-4">
                                      <div className={`p-3 rounded-lg ${selectedContext === 'online_work' ? 'bg-violet-100' : 'bg-emerald-50'}`}>
                                        <svg className={`w-6 h-6 ${selectedContext === 'online_work' ? 'text-violet-600' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                      </div>
                                      <div className="flex-1">
                                        <h4 className={`text-base font-semibold ${isOnlineQuotaExhausted ? 'text-gray-500' : 'text-gray-900'}`}>Làm việc online</h4>
                                        <p className="mt-1 text-sm text-gray-500">
                                          {isOnlineQuotaExhausted
                                            ? 'Đã hết lượt làm online tháng này'
                                            : freeSlot.sunday
                                              ? 'Làm việc từ xa (Chủ nhật — không tính hạn mức)'
                                              : freeSlot.satAfternoon
                                                ? `Làm việc từ xa (buổi chiều không tính hạn mức · còn ${remainingOnline}/${maxOnline} ngày)`
                                                : `Làm việc từ xa (Còn ${remainingOnline}/${maxOnline} ngày)`}
                                        </p>
                                      </div>
                                    </div>
                                    {isOnlineQuotaExhausted && (
                                      <div className="absolute top-2 right-2">
                                        <div className="bg-gray-200 rounded-full p-1">
                                          <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                          </svg>
                                        </div>
                                      </div>
                                    )}
                                  </button>
                                );
                              })()}

                              {/* Card 5: Đơn nghỉ không phép (loại yêu cầu riêng, không tính công) */}
                              {showUnauthorizedAbsenceCard && (
                                <button
                                  type="button"
                                  onClick={() => handleContextSelect('unauthorized_absence')}
                                  className={`group relative p-5 bg-white border-2 rounded-xl shadow-sm transition-all duration-200 text-left ${selectedContext === 'unauthorized_absence'
                                    ? 'border-violet-500 ring-2 ring-violet-100 hover:border-violet-600'
                                    : 'border-gray-200 hover:border-violet-400'
                                  }`}
                                >
                                  <div className="flex items-start space-x-4">
                                    <div className={`p-3 rounded-lg ${selectedContext === 'unauthorized_absence' ? 'bg-violet-100' : 'bg-rose-50'}`}>
                                      <NoSymbolIcon className={`w-6 h-6 ${selectedContext === 'unauthorized_absence' ? 'text-violet-600' : 'text-rose-600'}`} />
                                    </div>
                                    <div className="flex-1">
                                      <h4 className="text-base font-semibold text-gray-900">Đơn nghỉ không phép</h4>
                                      <p className="mt-1 text-sm text-gray-500">Khai báo ngày nghỉ không phép (không tính công, chỉ để kiểm soát số buổi)</p>
                                    </div>
                                  </div>
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* === ReasonSelector (Step 2) === */}
                    {selectedContext &&
                      (selectedContext === 'explanation' ||
                        selectedContext === 'registration' ||
                        selectedContext === 'monthly_leave' ||
                        selectedContext === 'online_work') && (
                        <div className="space-y-4 mb-6 animate-fadeIn">
                          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            {(selectedContext === 'monthly_leave' || selectedContext === 'online_work') ? 'Chọn ca' : 'Chọn lý do cụ thể'}
                          </h3>

                          {/* Chip buttons - Render based on selected context */}
                          <div className="flex flex-wrap gap-3">
                            {(() => {
                              const reasons: any[] = selectedContext === 'explanation'
                                ? explanationReasons
                                : selectedContext === 'registration'
                                  ? registrationReasons
                                  : selectedContext === 'monthly_leave'
                                    ? monthlyLeaveReasons
                                    : onlineWorkReasons;

                              // Lọc lý do cho Đơn giải trình dựa trên thực tế chấm công — dùng chung
                              // với logic hiện/ẩn thẻ "Đơn giải trình" ở bước 1 (getAvailableExplanationReasons)
                              if (selectedContext === 'explanation') {
                                const detail = attendanceDetails[0];
                                const registrations = selectedDayData?.registrations || [];
                                return getAvailableExplanationReasons(detail, registrations);
                              }

                              // Lọc lý do cho Đăng ký (OT, Trực...)
                              if (selectedContext === 'registration') {
                                const dateStr = selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}` : '';
                                const hasOnline = monthlyRequestHistory.onlineWorks.some(w => (w.work_date === dateStr || w.attendance_date === dateStr) && w.status?.toUpperCase() !== 'REJECTED');
                                
                                return reasons.filter(r => {
                                  // 1. Ẩn Vào/Ra trực nếu đã có đơn Online
                                  if (r.id === 'off_duty' && hasOnline) return false;
                                  
                                  // 2. Ẩn nếu đã có đơn cùng loại được PHÊ DUYỆT
                                  const isAlreadyApproved = (selectedDayData?.registrations || []).some((reg: any) => {
                                    if (reg.status?.toUpperCase() !== 'APPROVED') return false;
                                    const regType = (reg.event_type || '').toLowerCase();
                                    return regType === r.id; 
                                  });
                                  
                                  return !isAlreadyApproved;
                                });
                              }

                              // Lọc lý do cho Nghỉ phép tháng và Làm việc online
                              if (selectedContext === 'monthly_leave' || selectedContext === 'online_work') {
                                const isLeave = selectedContext === 'monthly_leave';
                                const remaining = isLeave 
                                  ? (attendanceStats?.remaining_leave ?? 1)
                                  : (attendanceStats?.remaining_online_work ?? 3);
                                
                                let filtered = [...reasons];
                                const freeSlotReasons = isLeave
                                  ? { sunday: false, satAfternoon: false }
                                  : onlineFreeSlot(selectedDate, attendanceStats?.online_weekend_unlimited);
                                if (freeSlotReasons.sunday) {
                                  // Chủ nhật không tính hạn mức -> giữ đủ sáng/chiều/cả ngày
                                } else if (freeSlotReasons.satAfternoon) {
                                  // Chiều T7 tuần 2/4 miễn hạn mức; sáng & cả ngày đều chỉ tính 0.5
                                  if (remaining < 0.5) {
                                    filtered = filtered.filter(r => r.id === 'afternoon');
                                  }
                                } else if (remaining < 1.0) {
                                  filtered = filtered.filter(r => r.id !== 'full_day');
                                }

                                // Kiểm tra các ca đã có dữ liệu (chính xác hơn)
                                const dayShifts = selectedDayData?.shifts || [];
                                const recoverableLeaveStatuses = ['LATE', 'EARLY_LEAVE', 'LATE_EARLY'];
                                const hasShiftLevelRecoverableStatus = dayShifts.some((s: any) =>
                                  recoverableLeaveStatuses.includes(String(s?.status || '').toUpperCase())
                                );
                                const hasRecoverableLeaveViolation =
                                  isLeave &&
                                  (
                                    recoverableLeaveStatuses.includes(String(selectedDayData?.day_status || '').toUpperCase()) ||
                                    Number(selectedDayData?.engine_context?.late_minutes || 0) > 0 ||
                                    Number(selectedDayData?.engine_context?.early_leave_minutes || 0) > 0 ||
                                    hasShiftLevelRecoverableStatus
                                  );

                                const isOccupied = (type: string, allowRecoverableLeave = false) => dayShifts.some((s: any) => {
                                  const status = String(s?.status || '').toUpperCase();
                                  const isSameSlot = s?.shift_type === type || s?.shift_type === 'FULL_DAY';
                                  if (!isSameSlot || ['ABSENT', 'EMPTY', 'NO_DATA'].includes(status)) return false;

                                  if (
                                    allowRecoverableLeave &&
                                    hasRecoverableLeaveViolation &&
                                    (
                                      recoverableLeaveStatuses.includes(status) ||
                                      (!hasShiftLevelRecoverableStatus && (s?.shift_type === type || s?.shift_type === 'FULL_DAY'))
                                    )
                                  ) {
                                    return false;
                                  }

                                  return true;
                                });

                                // Kiểm tra đơn đã được PHÊ DUYỆT (mới thêm)
                                const registrations = selectedDayData?.registrations || [];
                                const hasApproved = (session: string) => registrations.some((r: any) => {
                                  const rType = r.event_type?.toUpperCase();
                                  const rStatus = r.status?.toUpperCase();
                                  if (rStatus !== 'APPROVED') return false;
                                  
                                  const rData = r.data || r;
                                  const rReason = (rData.reason || '').toLowerCase();
                                  const rExplType = rData.explanation_type?.toUpperCase();

                                  if (isLeave) {
                                    const isLeaveType = rType === 'EXPLANATION' && rExplType === 'LEAVE';
                                    return isLeaveType && (
                                      requestReasonMatchesSession(rReason, session) ||
                                      requestReasonMatchesSession(rReason, 'full_day')
                                    );
                                  } else { // online_work
                                    const isOnlineType = rType === 'ONLINE_WORK';
                                    return isOnlineType && (
                                      requestReasonMatchesSession(rReason, session) ||
                                      requestReasonMatchesSession(rReason, 'full_day')
                                    );
                                  }
                                });

                                if (isOccupied('MORNING', isLeave) || hasApproved('morning')) {
                                  filtered = filtered.filter(r => r.id !== 'morning');
                                }
                                if (isOccupied('MORNING') || hasApproved('morning')) {
                                  filtered = filtered.filter(r => r.id !== 'full_day');
                                }
                                if (isOccupied('AFTERNOON', isLeave) || hasApproved('afternoon')) {
                                  filtered = filtered.filter(r => r.id !== 'afternoon');
                                }
                                if (isOccupied('AFTERNOON') || hasApproved('afternoon')) {
                                  filtered = filtered.filter(r => r.id !== 'full_day');
                                }
                                return filtered;
                              }

                              return reasons;
                            })().map((reason) => {
                              const isSelected = selectedReason === reason.id;

                              // Xác định xem lý do này có bị tính vào quota giải trình không (đối với context explanation)
                              const isQuotaConsuming = selectedContext === 'explanation' &&
                                ['late_minutes', 'early_leave_minutes', 'incomplete_attendance'].includes(reason.id);
                              const isNonQuota = (selectedContext === 'explanation' &&
                                ['business_trip', 'first_day'].includes(reason.id)) || (selectedContext === 'online_work' && reason.id === 'checkpage');

                              return (
                                <div key={reason.id} className="relative group/chip">
                                  <button
                                    type="button"
                                    onClick={() => handleReasonSelect(reason.id)}
                                    className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium border-2 transition-all duration-150 ${isSelected
                                      ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                                      } ${isNonQuota && !isSelected ? 'border-dashed border-primary-200' : ''}`}
                                  >
                                    {renderIcon(reason.icon, isSelected)}
                                    {reason.label}
                                    {isSelected && (
                                      <svg
                                        className="w-4 h-4 ml-2 text-violet-500"
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                      >
                                        <path
                                          fillRule="evenodd"
                                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                  {isNonQuota && (
                                    <div className="absolute -top-2 -right-1 bg-primary-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter opacity-0 group-hover/chip:opacity-100 transition-opacity whitespace-nowrap">
                                      Không mất lượt
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    {/* === Shift Selection for Business Trip === */}
                    {selectedContext === 'explanation' && selectedReason === 'business_trip' && (
                      <div className="space-y-3 mb-4 animate-fadeIn">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Chọn ca
                        </h3>
                        <div className="flex flex-wrap gap-3">
                          {[
                            { id: 'morning' as const, label: 'Ca sáng' },
                            { id: 'afternoon' as const, label: 'Ca chiều' },
                            { id: 'full_day' as const, label: 'Cả ngày' },
                          ].map((shift) => {
                            const isSelected = businessTripShift === shift.id;
                            return (
                              <button
                                key={shift.id}
                                type="button"
                                onClick={() => setBusinessTripShift(shift.id)}
                                className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium border-2 transition-all duration-150 ${isSelected
                                  ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                                  : 'border-dashed border-primary-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                                }`}
                              >
                                {renderIcon('briefcase', isSelected)}
                                {shift.label}
                                {isSelected && (
                                  <svg className="w-4 h-4 ml-2 text-violet-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* === Shift Selection for First Day === */}
                    {selectedContext === 'explanation' && selectedReason === 'first_day' && (
                      <div className="space-y-3 mb-4 animate-fadeIn">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Chọn ca
                        </h3>
                        <div className="flex flex-wrap gap-3">
                          {[
                            { id: 'morning' as const, label: 'Ca sáng' },
                            { id: 'afternoon' as const, label: 'Ca chiều' },
                            { id: 'full_day' as const, label: 'Cả ngày' },
                          ].map((shift) => {
                            const isSelected = firstDayShift === shift.id;
                            return (
                              <button
                                key={shift.id}
                                type="button"
                                onClick={() => setFirstDayShift(shift.id)}
                                className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium border-2 transition-all duration-150 ${isSelected
                                  ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                                  : 'border-dashed border-primary-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                                }`}
                              >
                                {renderIcon('calendar', isSelected)}
                                {shift.label}
                                {isSelected && (
                                  <svg className="w-4 h-4 ml-2 text-violet-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* === Time Info for Late/Early Leave === */}
                    {selectedContext === 'explanation' &&
                      (selectedReason === 'late_minutes' ||
                        selectedReason === 'early_leave_minutes') && (
                        <div className="space-y-4 mb-6 animate-fadeIn">
                          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            Thông tin chấm công
                          </h3>
                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            {attendanceDetails.length > 0 ? (
                              <div className="space-y-3">
                                {/* Time Info Grid - Responsive */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {/* Giờ đi */}
                                  <div className="bg-white rounded-lg p-3 border border-gray-100">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <svg
                                        className="w-4 h-4 text-emerald-500"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                                        />
                                      </svg>
                                      <span className="text-xs font-medium text-gray-500 uppercase">
                                        Giờ đi
                                      </span>
                                    </div>
                                    <p className="text-xl font-bold text-gray-900">
                                      {attendanceDetails[0]?.check_in
                                        ? new Date(
                                          `2000-01-01T${attendanceDetails[0].check_in}`
                                        ).toLocaleTimeString('vi-VN', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                        : '--:--'}
                                    </p>
                                  </div>

                                  {/* Giờ về */}
                                  <div className="bg-white rounded-lg p-3 border border-gray-100">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <svg
                                        className="w-4 h-4 text-red-500"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                        />
                                      </svg>
                                      <span className="text-xs font-medium text-gray-500 uppercase">
                                        Giờ về
                                      </span>
                                    </div>
                                    <p className="text-xl font-bold text-gray-900">
                                      {attendanceDetails[0]?.check_out
                                        ? new Date(
                                          `2000-01-01T${attendanceDetails[0].check_out}`
                                        ).toLocaleTimeString('vi-VN', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                        : '--:--'}
                                    </p>
                                  </div>
                                </div>

                                {/* Late/Early Minutes Info */}
                                {selectedReason === 'late_minutes' &&
                                  attendanceDetails[0]?.late_minutes > 0 && (
                                    <>
                                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center space-x-2">
                                            <svg
                                              className="w-5 h-5 text-amber-600"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                              />
                                            </svg>
                                            <span className="text-sm font-medium text-amber-800">
                                              Số phút đi muộn
                                            </span>
                                          </div>
                                          <span className="text-lg font-bold text-amber-700">
                                            {attendanceDetails[0].late_minutes}{' '}
                                            phút
                                          </span>
                                        </div>
                                        {(attendanceDetails[0].late_penalty || 0) > 0 && (
                                          <div className="mt-2 pt-2 border-t border-amber-200 space-y-1">
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-bold text-red-600 uppercase tracking-tighter">Số tiền phạt:</span>
                                              <span className="text-sm font-black text-red-700">
                                                {(attendanceDetails[0].late_penalty || 0).toLocaleString('vi-VN')} VNĐ
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                    </>
                                  )}

                                {selectedReason === 'early_leave_minutes' &&
                                  attendanceDetails[0]?.early_leave_minutes >
                                  0 && (
                                    <>
                                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center space-x-2">
                                            <svg
                                              className="w-5 h-5 text-amber-600"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                              />
                                            </svg>
                                            <span className="text-sm font-medium text-amber-800">
                                              Số phút về sớm
                                            </span>
                                          </div>
                                          <span className="text-lg font-bold text-amber-700">
                                            {
                                              attendanceDetails[0]
                                                .early_leave_minutes
                                            }{' '}
                                            phút
                                          </span>
                                        </div>
                                        {(attendanceDetails[0].early_leave_penalty || 0) > 0 && (
                                          <div className="mt-2 pt-2 border-t border-amber-200 space-y-1">
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-bold text-red-600 uppercase tracking-tighter">Số tiền phạt:</span>
                                              <span className="text-sm font-black text-red-700">
                                                {(attendanceDetails[0].early_leave_penalty || 0).toLocaleString('vi-VN')} VNĐ
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                    </>
                                  )}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500">
                                <svg
                                  className="w-8 h-8 mx-auto mb-2 text-gray-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                <p className="text-sm">
                                  Không có dữ liệu chấm công cho ngày này
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    {/* === Note Input for Late/Early Leave === */}
                    {selectedContext === 'explanation' &&
                      (selectedReason === 'late_minutes' ||
                        selectedReason === 'early_leave_minutes') && (
                        <div className="space-y-3 mb-6 animate-fadeIn">
                          <label
                            htmlFor="explanation-note"
                            className="block text-sm font-semibold text-gray-700 uppercase tracking-wide"
                          >
                            Ghi chú giải trình (bắt buộc)
                          </label>
                          <textarea
                            id="explanation-note"
                            rows={3}
                            value={formNote}
                            onChange={(e) => setFormNote(e.target.value)}
                            placeholder="Nhập lý do đi muộn/về sớm cụ thể..."
                            className="block w-full rounded-xl border-2 border-gray-100 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none placeholder:text-gray-300"
                          />
                        </div>
                      )}

                    {/* === Time Picker for Overtime (Tăng ca) === */}
                    {selectedContext === 'registration' &&
                      selectedReason === 'overtime' && (
                        <div className="space-y-4 mb-6 animate-fadeIn">
                          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            Thời gian tăng ca
                          </h3>

                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Giờ bắt đầu */}
                              <div>
                                <label
                                  htmlFor="overtime-start"
                                  className="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >
                                  Giờ bắt đầu
                                </label>
                                <input
                                  type="time"
                                  id="overtime-start"
                                  value={overtimeStartTime}
                                  onChange={(e) =>
                                    setOvertimeStartTime(e.target.value)
                                  }
                                  className="block w-full rounded-lg border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200"
                                />
                              </div>

                              {/* Giờ kết thúc */}
                              <div>
                                <label
                                  htmlFor="overtime-end"
                                  className="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >
                                  Giờ kết thúc
                                </label>
                                <input
                                  type="time"
                                  id="overtime-end"
                                  value={overtimeEndTime}
                                  onChange={(e) =>
                                    setOvertimeEndTime(e.target.value)
                                  }
                                  className="block w-full rounded-lg border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200"
                                />
                              </div>
                            </div>

                            {/* Duration display */}
                            {overtimeStartTime && overtimeEndTime && (
                              <div className="mt-4">
                                <div
                                  className={`flex items-center justify-between bg-white rounded-lg p-3 border ${overtimeDuration <= 0 || overtimeDuration < 2
                                    ? 'border-red-300'
                                    : 'border-gray-100'
                                    }`}
                                >
                                  <span className="text-sm text-gray-600">
                                    Tổng thời gian:
                                  </span>
                                  <span
                                    className={`text-lg font-bold ${overtimeDuration <= 0 ||
                                      overtimeDuration < 2
                                      ? 'text-red-600'
                                      : 'text-violet-700'
                                      }`}
                                  >
                                    {overtimeDuration.toFixed(1)} giờ
                                  </span>
                                </div>

                                {/* Validation error */}
                                {selectedReason === 'overtime' &&
                                  registrationTimeError && (
                                    <div className="mt-2 bg-red-50 rounded-lg p-3 border border-red-200">
                                      <div className="flex items-center space-x-2">
                                        <svg
                                          className="w-5 h-5 text-red-500"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                          />
                                        </svg>
                                        <span className="text-sm font-medium text-red-700">
                                          {registrationTimeError}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                              </div>
                            )}

                            {/* Loại tăng ca: Tại Viện/VP hay Online — dùng để cuối tháng tự
                                đối chiếu giờ ra thực tế với đơn Tại Viện/VP (xem "Đối chiếu
                                tăng ca" ở trang Phê duyệt). */}
                            <div className="mt-4 space-y-2">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                Hình thức tăng ca
                              </label>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setOvertimeType('ONSITE')}
                                  className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                                    overtimeType === 'ONSITE'
                                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                  }`}
                                >
                                  Tại Viện/VP
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOvertimeType('ONLINE')}
                                  className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                                    overtimeType === 'ONLINE'
                                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                  }`}
                                >
                                  Online
                                </button>
                              </div>
                              {overtimeType === 'ONSITE' && (
                                <p className="text-[11px] text-gray-400">
                                  Tại Viện/VP: cuối tháng hệ thống sẽ tự đối chiếu với giờ chấm công ra thực tế.
                                </p>
                              )}
                            </div>

                            {/* Note input for Overtime */}
                            <div className="mt-4 space-y-2">
                              <label
                                htmlFor="overtime-note"
                                className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                              >
                                Ghi chú tăng ca (bắt buộc)
                              </label>
                              <textarea
                                id="overtime-note"
                                rows={3}
                                value={formNote}
                                onChange={(e) => setFormNote(e.target.value)}
                                placeholder="Nhập ghi chú, lý do tăng ca chi tiết..."
                                className="block w-full rounded-xl border-2 border-gray-100 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none placeholder:text-gray-300"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                    {/* === Time Picker for Extra Hours (Làm thêm giờ) - Part-time === */}
                    {selectedContext === 'registration' &&
                      selectedReason === 'extra_hours' && (
                        <div className="space-y-4 mb-6 animate-fadeIn">
                          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            Thời gian làm thêm giờ
                          </h3>

                          {/* Part-time reminder */}
                          <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                            <div className="flex items-start space-x-2">
                              <svg
                                className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              <div>
                                <span className="text-sm font-medium text-amber-800">
                                  Dành cho nhân viên vị trí giám sát nội bộ
                                  Part-time
                                </span>
                                <p className="text-xs text-amber-700 mt-1">
                                  Vui lòng nhập chính xác thời gian làm thêm để
                                  được tính công đầy đủ
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Giờ bắt đầu */}
                              <div>
                                <label
                                  htmlFor="extra-hours-start"
                                  className="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >
                                  Giờ bắt đầu
                                </label>
                                <input
                                  type="time"
                                  id="extra-hours-start"
                                  value={extraHoursStartTime}
                                  onChange={(e) =>
                                    setExtraHoursStartTime(e.target.value)
                                  }
                                  className="block w-full rounded-lg border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200"
                                />
                              </div>

                              {/* Giờ kết thúc */}
                              <div>
                                <label
                                  htmlFor="extra-hours-end"
                                  className="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >
                                  Giờ kết thúc
                                </label>
                                <input
                                  type="time"
                                  id="extra-hours-end"
                                  value={extraHoursEndTime}
                                  onChange={(e) =>
                                    setExtraHoursEndTime(e.target.value)
                                  }
                                  className="block w-full rounded-lg border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200"
                                />
                              </div>
                            </div>

                            {/* Duration display */}
                            {extraHoursStartTime && extraHoursEndTime && (
                              <div className="mt-4">
                                <div
                                  className={`flex items-center justify-between bg-white rounded-lg p-3 border ${extraHoursDuration <= 0 ||
                                    extraHoursDuration < 2
                                    ? 'border-red-300'
                                    : 'border-gray-100'
                                    }`}
                                >
                                  <span className="text-sm text-gray-600">
                                    Tổng thời gian làm thêm:
                                  </span>
                                  <span
                                    className={`text-lg font-bold ${extraHoursDuration <= 0 ||
                                      extraHoursDuration < 2
                                      ? 'text-red-600'
                                      : 'text-violet-700'
                                      }`}
                                  >
                                    {extraHoursDuration.toFixed(1)} giờ
                                  </span>
                                </div>

                                {/* Validation error */}
                                {selectedReason === 'extra_hours' &&
                                  registrationTimeError && (
                                    <div className="mt-2 bg-red-50 rounded-lg p-3 border border-red-200">
                                      <div className="flex items-center space-x-2">
                                        <svg
                                          className="w-5 h-5 text-red-500"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                          />
                                        </svg>
                                        <span className="text-sm font-medium text-red-700">
                                          {registrationTimeError}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                              </div>
                            )}

                            {/* Note input for Extra Hours */}
                            <div className="mt-4 space-y-2">
                              <label
                                htmlFor="extra-hours-note"
                                className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                              >
                                Ghi chú làm thêm giờ (bắt buộc)
                              </label>
                              <textarea
                                id="extra-hours-note"
                                rows={3}
                                value={formNote}
                                onChange={(e) => setFormNote(e.target.value)}
                                placeholder="Nhập ghi chú, lý do làm thêm giờ..."
                                className="block w-full rounded-xl border-2 border-gray-100 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none placeholder:text-gray-300"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                    {/* === Time Picker for Home Duty (Trực tại nhà) - Sales Department === */}
                    {selectedContext === 'registration' &&
                      selectedReason === 'night_shift' && (
                        <div className="space-y-4 mb-6 animate-fadeIn">
                          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            Thời gian trực tại nhà
                          </h3>

                          {/* Sales Department reminder */}
                          <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                            <div className="flex items-start space-x-2">
                              <svg
                                className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                                />
                              </svg>
                              <div>
                                <span className="text-sm font-medium text-emerald-800">
                                  Dành cho vị trí Telesale và CSKH, CheckPage
                                </span>
                                <p className="text-xs text-emerald-700 mt-1">
                                  Ca sáng: 8h30 - 12h | Ca chiều tối: 17h30 - 23h
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Preset Ca */}
                          <div>
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                              Chọn nhanh ca trực
                            </h4>
                            <div className="grid grid-cols-1 gap-2">
                              {(() => {
                                const _TELESALE_CODES = ['NV_TELESALE', 'TP_TELESALE', 'LEADER_TELESALE'];
                                const isTelesale = _TELESALE_CODES.includes(currentEmployee?.position?.code ?? '');
                                return [
                                  {
                                    label: 'Ca chiều tối',
                                    time: '13h → 21h',
                                    start: '13:00',
                                    end: '21:00',
                                    color: 'indigo',
                                    icon: '🏢',
                                    telesaleOnly: false,
                                  },
                                  {
                                    label: 'Ca gãy',
                                    time: '8h30→12h + 17h30→23h',
                                    start: '08:30',
                                    end: '23:00',
                                    color: 'purple',
                                    icon: '🔀',
                                    telesaleOnly: true,
                                  },
                                  {
                                    label: 'Ca CheckPage',
                                    time: '',
                                    start: '',
                                    end: '',
                                    color: 'blue',
                                    icon: '📱',
                                    telesaleOnly: false,
                                  },
                                ].filter(p => !p.telesaleOnly || isTelesale);
                              })().map((preset) => {
                                const isSelected =
                                  nightShiftStartTime === preset.start &&
                                  nightShiftEndTime === preset.end;
                                const colorMap: Record<string, { card: string; badge: string; dot: string }> = {
                                  blue: {
                                    card: isSelected
                                      ? 'bg-primary-600 border-primary-600 text-white shadow-md'
                                      : 'bg-white border-primary-200 text-gray-700 hover:border-primary-400 hover:bg-primary-50',
                                    badge: isSelected ? 'bg-primary-500 text-white' : 'bg-primary-50 text-primary-700',
                                    dot: 'bg-primary-400',
                                  },
                                  indigo: {
                                    card: isSelected
                                      ? 'bg-primary-600 border-primary-600 text-white shadow-md'
                                      : 'bg-white border-primary-200 text-gray-700 hover:border-primary-400 hover:bg-primary-50',
                                    badge: isSelected ? 'bg-primary-500 text-white' : 'bg-primary-50 text-primary-700',
                                    dot: 'bg-primary-400',
                                  },
                                  purple: {
                                    card: isSelected
                                      ? 'bg-violet-600 border-violet-600 text-white shadow-md'
                                      : 'bg-white border-violet-200 text-gray-700 hover:border-violet-400 hover:bg-violet-50',
                                    badge: isSelected ? 'bg-violet-500 text-white' : 'bg-violet-50 text-violet-700',
                                    dot: 'bg-violet-400',
                                  },
                                };
                                const c = colorMap[preset.color];
                                return (
                                  <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => {
                                      setNightShiftStartTime(preset.start);
                                      setNightShiftEndTime(preset.end);
                                      if (!formNote) {
                                        setFormNote(preset.label);
                                      }
                                    }}
                                    className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border-2 transition-all font-medium ${c.card} ${isSelected ? 'scale-[1.01]' : ''}`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <span className="text-lg">{preset.icon}</span>
                                      <div className="text-left">
                                        <div className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                                          {preset.label}
                                        </div>
                                      </div>
                                    </div>
                                    {preset.time && (
                                      <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${c.badge}`}>
                                        {preset.time}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>


                          {/* Duration display */}
                          {nightShiftStartTime && nightShiftEndTime && (
                            <div className={`flex items-center justify-between bg-white rounded-xl border px-4 py-3 ${nightShiftDuration <= 0 || nightShiftDuration < 2 ? 'border-red-300' : 'border-gray-200'}`}>
                              <span className="text-sm text-gray-600">Tổng thời gian trực:</span>
                              <span className={`text-lg font-bold ${nightShiftDuration <= 0 || nightShiftDuration < 2 ? 'text-red-600' : 'text-violet-700'}`}>
                                {nightShiftDuration.toFixed(1)} giờ
                              </span>
                            </div>
                          )}

                          {/* Note input for Night Shift */}
                          <div className="mt-2 space-y-2">
                            <label
                              htmlFor="night-shift-note"
                              className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                            >
                              Ghi chú trực tối (bắt buộc)
                            </label>
                            <textarea
                              id="night-shift-note"
                              rows={3}
                              value={formNote}
                              onChange={(e) => setFormNote(e.target.value)}
                              placeholder="Nhập ghi chú, ca trực cụ thể..."
                              className="block w-full rounded-xl border-2 border-gray-100 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none placeholder:text-gray-300"
                            />
                          </div>

                          {/* Validation error */}
                          {selectedReason === 'night_shift' && registrationTimeError && (
                            <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                              <div className="flex items-center space-x-2">
                                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-sm font-medium text-red-700">{registrationTimeError}</span>
                              </div>
                            </div>
                          )}

                        </div>
                      )}

                    {/* === Time Picker for Live - TikTok Department === */}
                    {selectedContext === 'registration' &&
                      selectedReason === 'live' && (
                        <div className="space-y-4 mb-6 animate-fadeIn">
                          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            Thời gian Live
                          </h3>

                          {/* TikTok Department reminder */}
                          <div className="bg-pink-50 rounded-lg p-3 border border-pink-200">
                            <div className="flex items-start space-x-2">
                              <svg
                                className="w-5 h-5 text-pink-600 mt-0.5 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                              <div>
                                <span className="text-sm font-medium text-pink-800">
                                  Dành cho phòng ban TikTok, Truyền thông thương
                                  hiệu, Kinh doanh
                                </span>
                                <p className="text-xs text-pink-700 mt-1">
                                  Live sau 21h không được vượt quá 20% tổng số
                                  live của Team. Tối đa ≤10 phiên live Team trong
                                  tháng.
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Giờ bắt đầu */}
                              <div>
                                <label
                                  htmlFor="live-start"
                                  className="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >
                                  Giờ bắt đầu
                                </label>
                                <input
                                  type="time"
                                  id="live-start"
                                  value={liveStartTime}
                                  onChange={(e) =>
                                    setLiveStartTime(e.target.value)
                                  }
                                  className="block w-full rounded-lg border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200"
                                />
                              </div>

                              {/* Giờ kết thúc */}
                              <div>
                                <label
                                  htmlFor="live-end"
                                  className="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >
                                  Giờ kết thúc
                                </label>
                                <input
                                  type="time"
                                  id="live-end"
                                  value={liveEndTime}
                                  onChange={(e) => setLiveEndTime(e.target.value)}
                                  className="block w-full rounded-lg border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200"
                                />
                              </div>
                            </div>

                            {/* Duration display */}
                            {liveStartTime && liveEndTime && (
                              <div className="mt-4">
                                <div
                                  className={`flex items-center justify-between bg-white rounded-lg p-3 border ${liveDuration <= 0 || liveDuration < 2
                                    ? 'border-red-300'
                                    : 'border-gray-100'
                                    }`}
                                >
                                  <span className="text-sm text-gray-600">
                                    Tổng thời gian live:
                                  </span>
                                  <span
                                    className={`text-lg font-bold ${liveDuration <= 0 || liveDuration < 2
                                      ? 'text-red-600'
                                      : 'text-violet-700'
                                      }`}
                                  >
                                    {liveDuration.toFixed(1)} giờ
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Note input for Live */}
                            <div className="mt-4 space-y-2">
                              <label
                                htmlFor="live-note"
                                className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                              >
                                Ghi chú live (bắt buộc)
                              </label>
                              <textarea
                                id="live-note"
                                rows={3}
                                value={formNote}
                                onChange={(e) => setFormNote(e.target.value)}
                                placeholder="Nhập ghi chú, phiên live cụ thể..."
                                className="block w-full rounded-xl border-2 border-gray-100 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none placeholder:text-gray-300"
                              />
                            </div>

                            {liveStartTime && liveEndTime && (
                              <>
                                {/* Validation error */}
                                {selectedReason === 'live' &&
                                  registrationTimeError && (
                                    <div className="mt-2 bg-red-50 rounded-lg p-3 border border-red-200">
                                      <div className="flex items-center space-x-2">
                                        <svg
                                          className="w-5 h-5 text-red-500"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                          />
                                        </svg>
                                        <span className="text-sm font-medium text-red-700">
                                          {registrationTimeError}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                {/* Night live session indicator */}
                                <div className="mt-3 bg-gradient-to-r from-pink-50 to-violet-50 rounded-lg p-3 border border-pink-200">
                                  <div className="flex items-center space-x-2">
                                    <svg
                                      className="w-5 h-5 text-pink-600"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                                      />
                                    </svg>
                                    <span className="text-sm font-semibold text-pink-700">
                                      Tính 1 ca live tối
                                    </span>
                                  </div>
                                  <p className="text-xs text-pink-600 mt-1 ml-7">
                                    Phiên live sau 21h được tính là 1 ca live tối
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                    {/* === Note Input for First Day === */}
                    {selectedContext === 'explanation' &&
                      selectedReason === 'first_day' && (
                        <div className="space-y-3 mb-6 animate-fadeIn">
                          <label
                            htmlFor="first-day-note"
                            className="block text-sm font-semibold text-gray-700 uppercase tracking-wide"
                          >
                            Ghi chú (bắt buộc)
                          </label>
                          <textarea
                            id="first-day-note"
                            rows={4}
                            value={formNote}
                            onChange={(e) => setFormNote(e.target.value)}
                            placeholder="Nhập ghi chú về ngày đầu đi làm..."
                            className="block w-full rounded-xl border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none"
                          />
                          <p className="text-xs text-gray-500">
                            Vui lòng mô tả chi tiết về ngày đầu đi làm (ví dụ:
                            chưa được cấp thẻ, chưa đăng ký vân tay...)
                          </p>
                        </div>
                      )}

                    {/* === Note Input for Business Trip === */}
                    {selectedContext === 'explanation' &&
                      selectedReason === 'business_trip' && (
                        <div className="space-y-3 mb-6 animate-fadeIn">
                          <label
                            htmlFor="business-trip-note"
                            className="block text-sm font-semibold text-gray-700 uppercase tracking-wide"
                          >
                            Ghi chú (bắt buộc)
                          </label>
                          <textarea
                            id="business-trip-note"
                            rows={4}
                            value={formNote}
                            onChange={(e) => setFormNote(e.target.value)}
                            placeholder="Nhập ghi chú về chuyến công tác..."
                            className="block w-full rounded-xl border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none"
                          />
                          <p className="text-xs text-gray-500">
                            Vui lòng mô tả chi tiết về chuyến công tác (ví dụ: địa
                            điểm, mục đích, thời gian...)
                          </p>
                        </div>
                      )}

                    {/* === Note Input for Online Work === */}
                    {selectedContext === 'online_work' &&
                      selectedReason && (
                        <div className="space-y-3 mb-6 animate-fadeIn">
                          <label
                            htmlFor="online-work-note"
                            className="block text-sm font-semibold text-gray-700 uppercase tracking-wide"
                          >
                            Nội dung (bắt buộc)
                          </label>
                          <textarea
                            id="online-work-note"
                            rows={4}
                            value={formNote}
                            onChange={(e) => setFormNote(e.target.value)}
                            placeholder="Nhập ghi chú về ca làm việc online (VD: nội dung công việc, kết quả dự kiến...)"
                            className="block w-full rounded-xl border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none"
                          />
                          <p className="text-xs text-gray-500">
                            Mô tả chi tiết để quản lý xem xét phê duyệt đơn làm
                            việc online của bạn.
                          </p>
                        </div>
                      )}

                    {/* === Note Input for Unauthorized Absence (Nghỉ không phép) === */}
                    {selectedContext === 'unauthorized_absence' && (() => {
                      const startDateStr = selectedDate
                        ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
                        : '';
                      // Giới hạn tối đa 30 ngày kể từ ngày bắt đầu (khớp giới hạn 31 ngày/đơn bên backend)
                      const maxEndDate = selectedDate
                        ? (() => {
                            const d = new Date(selectedDate);
                            d.setDate(d.getDate() + 30);
                            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          })()
                        : undefined;
                      const rangeInvalid = unauthorizedAbsenceIsRange && unauthorizedAbsenceEndDate && unauthorizedAbsenceEndDate < startDateStr;

                      return (
                        <div className="space-y-3 mb-6 animate-fadeIn">
                          <label className={`flex items-center gap-2 text-sm font-medium cursor-pointer select-none ${unauthorizedAbsenceHalfDayPeriod !== 'full_day' ? 'text-gray-400' : 'text-gray-700'}`}>
                            <input
                              type="checkbox"
                              checked={unauthorizedAbsenceIsRange}
                              disabled={unauthorizedAbsenceHalfDayPeriod !== 'full_day'}
                              onChange={(e) => {
                                setUnauthorizedAbsenceIsRange(e.target.checked);
                                if (!e.target.checked) setUnauthorizedAbsenceEndDate('');
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 disabled:opacity-50"
                            />
                            Nghỉ nhiều ngày liên tiếp
                          </label>

                          {/* Nghỉ ca sáng/chiều — chọn cụ thể buổi nghỉ thay vì 1 checkbox
                              "nửa ngày" chung chung (giống giao diện chọn ca của Nghỉ phép
                              tháng), chỉ áp dụng cho 1 ngày nên loại trừ với "nhiều ngày liên tiếp". */}
                          {!unauthorizedAbsenceIsRange && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                Chọn ca
                              </p>
                              <div className="flex flex-wrap gap-3">
                                {[
                                  { id: 'morning' as const, label: 'Nghỉ ca sáng' },
                                  { id: 'afternoon' as const, label: 'Nghỉ ca chiều' },
                                  { id: 'full_day' as const, label: 'Nghỉ cả ngày' },
                                ].map((shift) => {
                                  const isSelected = unauthorizedAbsenceHalfDayPeriod === shift.id;
                                  return (
                                    <button
                                      key={shift.id}
                                      type="button"
                                      onClick={() => setUnauthorizedAbsenceHalfDayPeriod(shift.id)}
                                      className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium border-2 transition-all duration-150 ${isSelected
                                        ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                                        }`}
                                    >
                                      {shift.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {unauthorizedAbsenceIsRange && (
                            <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-4 border border-gray-200">
                              <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                                  Từ ngày
                                </label>
                                <input
                                  type="date"
                                  value={startDateStr}
                                  disabled
                                  className="block w-full rounded-lg border-2 border-gray-200 bg-gray-100 shadow-sm sm:text-sm p-3 text-gray-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                                  Đến ngày
                                </label>
                                <input
                                  type="date"
                                  value={unauthorizedAbsenceEndDate}
                                  min={startDateStr}
                                  max={maxEndDate}
                                  onChange={(e) => setUnauthorizedAbsenceEndDate(e.target.value)}
                                  className={`block w-full rounded-lg border-2 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 ${rangeInvalid ? 'border-red-300' : 'border-gray-200'}`}
                                />
                              </div>
                              {rangeInvalid && (
                                <p className="col-span-2 text-xs text-red-600">Ngày kết thúc phải từ ngày bắt đầu trở đi</p>
                              )}
                            </div>
                          )}

                          <label
                            htmlFor="unauthorized-absence-note"
                            className="block text-sm font-semibold text-gray-700 uppercase tracking-wide"
                          >
                            Lý do nghỉ không phép (bắt buộc)
                          </label>
                          <textarea
                            id="unauthorized-absence-note"
                            rows={4}
                            value={formNote}
                            onChange={(e) => setFormNote(e.target.value)}
                            placeholder="Nhập lý do nghỉ không phép..."
                            className="block w-full rounded-xl border-2 border-gray-200 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm p-3 transition-colors duration-200 resize-none"
                          />
                          <p className="text-xs text-gray-500">
                            Đơn này không được tính công (như trước khi có loại đơn này) — chỉ dùng để
                            kiểm soát số buổi nghỉ không phép, kể cả các ngày làm việc không cố định
                            (VD: Chủ nhật đối với NV có lịch làm Chủ nhật).
                            {unauthorizedAbsenceIsRange && !rangeInvalid && unauthorizedAbsenceEndDate && (
                              <> Tất cả các ngày từ <strong>{startDateStr}</strong> đến <strong>{unauthorizedAbsenceEndDate}</strong> sẽ hiển thị "Nghỉ không phép" sau khi đơn được duyệt.</>
                            )}
                            {unauthorizedAbsenceHalfDayPeriod !== 'full_day' && (
                              <> Chỉ tính <strong>{unauthorizedAbsenceHalfDayPeriod === 'morning' ? 'buổi sáng' : 'buổi chiều'} ({startDateStr})</strong> là nghỉ không phép.</>
                            )}
                          </p>
                        </div>
                      );
                    })()}



                    {/* === Detailed Options for Incomplete Attendance === */}
                    {selectedContext === 'explanation' &&
                      selectedReason === 'incomplete_attendance' && (
                        <div className="space-y-4 mb-6 animate-fadeIn">

                          {/* Tiêu đề */}
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-1 h-5 bg-violet-500 rounded-full"></div>
                            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
                              Bạn quên chấm công lúc nào?
                            </h3>
                          </div>

                          {/* Bước 1: 2 card lựa chọn */}
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              {
                                id: 'checkin',
                                label: 'Quên\nCheck-in',
                                icon: <ArrowLeftOnRectangleIcon className="w-6 h-6" />,
                                activeColor: 'bg-violet-600 border-violet-600 text-white shadow-lg',
                                inactiveColor: 'bg-white border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50',
                                dotColor: 'bg-violet-500',
                              },
                              {
                                id: 'checkout',
                                label: 'Quên\nCheck-out',
                                icon: <ArrowRightOnRectangleIcon className="w-6 h-6" />,
                                activeColor: 'bg-amber-500 border-amber-500 text-white shadow-lg',
                                inactiveColor: 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50',
                                dotColor: 'bg-amber-500',
                              },
                            ].map((type) => {
                              const isActive = forgotPunchType === type.id;
                              return (
                                <button
                                  key={type.id}
                                  type="button"
                                  onClick={() => {
                                    setForgotPunchType(type.id as any);
                                    setForgotCheckinTime(null);
                                    setForgotCheckoutTime(null);
                                  }}
                                  className={`relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-2xl border-2 transition-all duration-200 font-semibold ${isActive ? type.activeColor : type.inactiveColor} ${isActive ? 'scale-[1.03]' : ''}`}
                                >
                                  {isActive && (
                                    <span className="absolute top-2 right-2 w-4 h-4 bg-white bg-opacity-30 rounded-full flex items-center justify-center">
                                      <CheckIcon className="w-2.5 h-2.5 text-white" />
                                    </span>
                                  )}
                                  <span className={`${isActive ? 'text-white opacity-90' : 'text-gray-400'}`}>{type.icon}</span>
                                  <span className={`text-xs font-bold text-center leading-tight whitespace-pre-line ${isActive ? 'text-white' : 'text-gray-700'}`}>
                                    {type.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Bước 2a: Chọn giờ check-in */}
                          {forgotPunchType === 'checkin' && (
                            <div className="rounded-2xl border border-violet-100 overflow-hidden">
                              <div className="bg-violet-600 px-4 py-2.5 flex items-center gap-2">
                                <svg className="w-4 h-4 text-white opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5-4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                                </svg>
                                <span className="text-xs font-bold text-white tracking-wide uppercase">Giờ check-in bị quên</span>
                              </div>
                              <div className="bg-violet-50 p-3 flex gap-2">
                                {[
                                  { value: '07:30', label: '7h30', desc: 'Sáng' },
                                  { value: '08:00', label: '8h00', desc: 'Sáng' },
                                  { value: '08:30', label: '8h30', desc: 'Sáng' },
                                  { value: '09:00', label: '9h00', desc: 'Sáng' },
                                  // Giờ bắt đầu Ca 2 (Điều dưỡng BS Ma BS A, 09:30-13:30/
                                  // 14:30-18:30) — thêm 2026-09-18 cùng đợt với giờ check-out
                                  // 18h30, cho đủ cặp giờ vào/ra của Ca 2 trong form này.
                                  { value: '09:30', label: '9h30', desc: 'Sáng' },
                                  { value: '13:00', label: '13h00', desc: 'Chiều' },
                                  { value: '14:30', label: '14h30', desc: 'Chiều' },
                                  { value: '17:30', label: '17h30', desc: 'Tối' },
                                ].map((opt) => {
                                  const sel = forgotCheckinTime === opt.value;
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => setForgotCheckinTime(sel ? null : opt.value)}
                                      className={`flex-1 flex flex-col items-center py-2.5 rounded-xl border-2 transition-all duration-150 ${sel ? 'bg-violet-600 border-violet-600 shadow-md scale-[1.04]' : 'bg-white border-violet-200 hover:border-violet-400 hover:bg-violet-50'}`}
                                    >
                                      <span className={`text-sm font-extrabold ${sel ? 'text-white' : 'text-violet-700'}`}>{opt.label}</span>
                                      <span className={`text-[10px] mt-0.5 font-medium ${sel ? 'text-violet-200' : 'text-gray-400'}`}>{opt.desc}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Bước 2b: Chọn giờ check-out */}
                          {forgotPunchType === 'checkout' && (
                            <div className="rounded-2xl border border-amber-100 overflow-hidden">
                              <div className="bg-amber-500 px-4 py-2.5 flex items-center gap-2">
                                <svg className="w-4 h-4 text-white opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                                <span className="text-xs font-bold text-white tracking-wide uppercase">Giờ check-out bị quên</span>
                              </div>
                              <div className="bg-amber-50 p-3 flex gap-2">
                                {[
                                  { value: '12:00', label: '12h00', desc: 'Trưa' },
                                  { value: '16:30', label: '16h30', desc: 'Chiều' },
                                  { value: '17:00', label: '17h00', desc: 'Chiều' },
                                  { value: '17:30', label: '17h30', desc: 'Chiều' },
                                  // Giờ kết thúc Ca 2 chiều (Điều dưỡng BS Ma BS A,
                                  // 14:30-18:30) — thêm 2026-09-18 vì thiếu mốc này khiến
                                  // NV làm Ca 2 quên chấm công không chọn được đúng giờ về.
                                  { value: '18:30', label: '18h30', desc: 'Chiều' },
                                  { value: '21:00', label: '21h00', desc: 'Tối' },
                                ].map((opt) => {
                                  const sel = forgotCheckoutTime === opt.value;
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => setForgotCheckoutTime(sel ? null : opt.value)}
                                      className={`flex-1 flex flex-col items-center py-2.5 rounded-xl border-2 transition-all duration-150 ${sel ? 'bg-amber-500 border-amber-500 shadow-md scale-[1.04]' : 'bg-white border-amber-200 hover:border-amber-400 hover:bg-amber-50'}`}
                                    >
                                      <span className={`text-sm font-extrabold ${sel ? 'text-white' : 'text-amber-600'}`}>{opt.label}</span>
                                      <span className={`text-[10px] mt-0.5 font-medium ${sel ? 'text-amber-200' : 'text-gray-400'}`}>{opt.desc}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                        </div>
                      )}



                    {/* Placeholder when no context selected */}
                    {!selectedContext && (
                      <div className="text-center py-8 text-gray-400">
                        <svg
                          className="w-12 h-12 mx-auto mb-3 opacity-50"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M8 9l4-4 4 4m0 6l-4 4-4-4"
                          />
                        </svg>
                        <p className="text-sm">
                          Vui lòng chọn loại yêu cầu trước
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* === FooterButtons === */}
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 sm:flex sm:flex-row-reverse sm:gap-3 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={
                      isSubmitting ||
                      !selectedContext ||
                      ((selectedContext === 'explanation' ||
                        selectedContext === 'registration' ||
                        selectedContext === 'monthly_leave' ||
                        selectedContext === 'online_work' ||
                        selectedContext === 'unauthorized_absence') &&
                        !selectedReason) ||
                      !isRegistrationTimeValid() ||
                      (!formNote?.trim() && selectedReason !== 'incomplete_attendance' && selectedContext !== 'monthly_leave' && selectedReason !== 'off_duty' && selectedReason !== 'ca2') ||
                      (selectedContext === 'unauthorized_absence' && unauthorizedAbsenceIsRange && (
                        !unauthorizedAbsenceEndDate ||
                        unauthorizedAbsenceEndDate < (selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}` : '')
                      ))
                    }
                    className={`w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-xl border border-transparent shadow-lg text-base font-semibold transition-all duration-200 ${isSubmitting
                      ? 'bg-violet-400 text-white cursor-wait'
                      : (selectedContext &&
                        selectedReason) &&
                        isRegistrationTimeValid() &&
                        (formNote?.trim() || selectedReason === 'incomplete_attendance' || selectedContext === 'monthly_leave' || selectedReason === 'off_duty' || selectedReason === 'ca2') &&
                        !(selectedContext === 'unauthorized_absence' && unauthorizedAbsenceIsRange && (
                          !unauthorizedAbsenceEndDate ||
                          unauthorizedAbsenceEndDate < (selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}` : '')
                        ))
                        ? 'text-white bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 transform hover:scale-[1.02]'
                        : 'text-gray-400 bg-gray-200 cursor-not-allowed'
                      }`}
                  >
                    {isSubmitting ? (
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                        Đang xử lý...
                      </div>
                    ) : (
                      <>
                        <svg
                          className="w-5 h-5 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                          />
                        </svg>
                        Gửi đơn
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetSupplementaryForm();
                      handleCloseSupplementaryRequest();
                    }}
                    className="mt-3 sm:mt-0 w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-xl border-2 border-gray-300 shadow-sm text-base font-semibold text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-all duration-200"
                  >
                    Hủy
                  </button>
                </div>

                {/* Form Completion Summary */}
                {selectedContext &&
                  (selectedContext === 'monthly_leave' ||
                    selectedContext === 'online_work' ||
                    selectedReason) && (
                    <div className="px-6 py-3 bg-emerald-50 border-t border-emerald-100">
                      <div className="flex items-center text-sm text-emerald-700">
                        <svg
                          className="w-5 h-5 mr-2 text-emerald-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>
                          <strong>
                            {selectedContext === 'explanation'
                              ? 'Đơn giải trình'
                              : selectedContext === 'registration'
                                ? 'Đơn đăng ký'
                                : selectedContext === 'monthly_leave'
                                  ? 'Nghỉ phép tháng'
                                  : selectedContext === 'online_work'
                                    ? 'Làm việc online'
                                    : selectedContext === 'unauthorized_absence'
                                      ? 'Đơn nghỉ không phép'
                                      : ''}
                          </strong>
                          {(selectedContext === 'explanation' ||
                            selectedContext === 'registration' ||
                            selectedContext === 'monthly_leave' ||
                            selectedContext === 'online_work') &&
                            selectedReason && (
                              <>
                                {' - '}
                                {
                                  (selectedContext === 'explanation'
                                    ? explanationReasons
                                    : selectedContext === 'registration'
                                      ? registrationReasons
                                      : selectedContext === 'monthly_leave'
                                        ? monthlyLeaveReasons
                                        : onlineWorkReasons
                                  ).find((r: any) => r.id === selectedReason)?.label
                                }
                              </>
                            )}
                        </span>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </div>
        )
      }

      {/* Confirmation Modal */}
      {
        showConfirmModal && (
          <div className="fixed inset-0 z-[60] overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
                onClick={() => setShowConfirmModal(false)}
              />

              {/* Modal */}
              <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 transform transition-all">
                {/* Icon */}
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center">
                    <svg
                      className="w-8 h-8 text-violet-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold text-gray-900 text-center mb-2">
                  Xác nhận gửi đơn
                </h3>

                {/* Modern Request Summary Card */}
                <div className="bg-gray-50 rounded-2xl p-5 mb-6 border border-gray-100">
                  <div className="space-y-4">
                    {/* Row: Type */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center text-gray-500">
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <span className="text-[10px] uppercase font-bold tracking-wider">
                          Loại đơn
                        </span>
                      </div>
                      <span className="text-sm font-bold text-gray-900 bg-white px-2 py-1 rounded-lg border border-gray-100 shadow-sm">
                        {selectedContext === 'explanation'
                          ? 'Giải trình'
                          : selectedContext === 'registration'
                            ? 'Đăng ký'
                            : selectedContext === 'monthly_leave'
                              ? 'Nghỉ phép tháng'
                              : selectedContext === 'unauthorized_absence'
                                ? 'Nghỉ không phép'
                                : 'Làm online'}
                      </span>
                    </div>

                    {/* Row: Reason (Đơn nghỉ không phép chỉ có 1 lý do duy nhất, đã hiện ở "Loại đơn" nên bỏ qua) */}
                    {selectedReason && selectedContext !== 'unauthorized_absence' && (
                      <div className="flex justify-between items-center">
                        <div className="flex items-center text-gray-500">
                          <svg
                            className="w-4 h-4 mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                            />
                          </svg>
                          <span className="text-[10px] uppercase font-bold tracking-wider">
                            Lý do
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-violet-700">
                          {
                            (selectedContext === 'explanation'
                              ? explanationReasons
                              : selectedContext === 'registration'
                                ? registrationReasons
                                : selectedContext === 'monthly_leave'
                                  ? monthlyLeaveReasons
                                  : onlineWorkReasons
                            ).find((r: any) => r.id === selectedReason)?.label
                          }
                        </span>
                      </div>
                    )}
                    {/* Row: Shift (Optional, for Night Shift) */}
                    {selectedReason === 'night_shift' && (
                      <div className="flex justify-between items-center bg-primary-50/50 p-2 rounded-xl border border-primary-100/50">
                        <div className="flex items-center text-primary-600">
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-[10px] uppercase font-bold tracking-wider">Ca trực</span>
                        </div>
                        <span className="text-sm font-bold text-primary-700">
                          {!nightShiftStartTime && !nightShiftEndTime ? 'CheckPage' : (nightShiftStartTime === '13:00' ? 'Chiều tối' : 'Ca gãy')}
                        </span>
                      </div>
                    )}

                    {/* Row: Note */}
                    {formNote &&
                      (selectedReason === 'incomplete_attendance' ||
                        selectedReason === 'business_trip' ||
                        selectedReason === 'first_day' ||
                        selectedContext === 'registration' ||
                        selectedContext === 'online_work' ||
                        selectedContext === 'unauthorized_absence') && (
                        <div className="flex flex-col space-y-1.5 pt-1">
                          <div className="flex items-center text-gray-500">
                            <svg
                              className="w-4 h-4 mr-2"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                            <span className="text-[10px] uppercase font-bold tracking-wider">
                              Ghi chú chi tiết
                            </span>
                          </div>
                          <div className="text-sm text-gray-700 bg-white/60 p-3 rounded-xl border border-gray-100 italic leading-relaxed">
                            {formNote.replace(/^(Ca chiều tối|Ca gãy|Ca CheckPage)(:\s*)?/, '') || formNote}
                          </div>
                        </div>
                      )}

                    {/* Row: Date */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center text-gray-500">
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <span className="text-[10px] uppercase font-bold tracking-wider">
                          Ngày áp dụng
                        </span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">
                        {selectedDate?.toLocaleDateString('vi-VN', {
                          weekday: 'long',
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Row: Time Range (for Overtime, Extra Hours, Night Shift, Live) */}
                    {selectedContext === 'registration' &&
                      selectedReason &&
                      ['overtime', 'extra_hours', 'night_shift', 'live'].includes(selectedReason as any) &&
                      !(selectedReason === 'night_shift' && !nightShiftStartTime && !nightShiftEndTime) && (
                        <div className="flex justify-between items-center p-2 bg-violet-50 rounded-xl">
                          <div className="flex items-center text-violet-700">
                            <svg
                              className="w-4 h-4 mr-2"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <span className="text-[10px] uppercase font-bold tracking-wider">
                              Thời gian
                            </span>
                          </div>
                          <span className="text-sm font-black text-violet-800">
                            {selectedReason === 'extra_hours'
                              ? `${extraHoursStartTime} — ${extraHoursEndTime}`
                              : selectedReason === 'night_shift'
                                ? (nightShiftStartTime && nightShiftEndTime ? `${nightShiftStartTime} — ${nightShiftEndTime}` : '')
                                : selectedReason === 'live'
                                  ? `${liveStartTime} — ${liveEndTime}`
                                  : `${overtimeStartTime} — ${overtimeEndTime}`}
                          </span>
                        </div>
                      )}

                    {/* Quota Warning for Explanation */}
                    {selectedContext === 'explanation' &&
                      attendanceStats?.remaining_explanations <= 0 && (
                        <div className="mt-4 p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start space-x-3">
                          <svg
                            className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 17c-.77 1.333.192 3 1.732 3z"
                            />
                          </svg>
                          <p className="text-xs text-amber-800 leading-relaxed">
                            <span className="font-bold">Lưu ý:</span> Bạn đã hết
                            lượt giải trình miễn phí trong tháng này (tối đa 3
                            lần). Đơn này vẫn có thể gửi đi nhưng có thể sẽ bị
                            tính phí bổ sung tùy theo quy định của công ty.
                          </p>
                        </div>
                      )}
                  </div>
                </div>
                <p className="text-gray-600 text-center mb-6">
                  Bạn đã chắc chắn gửi đơn?
                </p>

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 hover:border-gray-400 transition-all duration-200"
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setShowConfirmModal(false);
                      handleSubmitSupplementaryRequest();
                    }}
                    className={`flex-1 px-4 py-3 rounded-xl font-semibold transition-all duration-200 shadow-lg flex items-center justify-center ${isSubmitting
                      ? 'bg-violet-400 text-white cursor-wait'
                      : 'bg-gradient-to-r from-violet-600 to-violet-700 text-white hover:from-violet-700 hover:to-violet-800'
                      }`}
                  >
                    {isSubmitting ? (
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Đang gửi...
                      </div>
                    ) : (
                      'OK'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      {/* ===== DRAWER: Lịch sử đơn tháng ===== */}
      {
        showRequestHistoryDrawer && (
          <div className="fixed inset-0 z-[80] overflow-hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black bg-opacity-40 transition-opacity"
              onClick={() => setShowRequestHistoryDrawer(false)}
            />
            {/* Drawer panel */}
            <div className="absolute inset-y-0 right-0 flex max-w-full">
              <div className="relative w-screen max-w-md transform transition-transform duration-300 ease-in-out">
                <div className="flex h-full flex-col bg-white shadow-2xl">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-violet-600 to-violet-700 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-white bg-opacity-20 rounded-xl flex items-center justify-center">
                          <ClipboardDocumentListIcon className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-white">Lịch sử đơn tháng</h2>
                          <p className="text-violet-200 text-xs mt-0.5">
                            Tháng {currentDate.getMonth() + 1}/{currentDate.getFullYear()}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowRequestHistoryDrawer(false)}
                        className="w-8 h-8 bg-white bg-opacity-20 rounded-lg flex items-center justify-center hover:bg-opacity-30 transition-colors"
                      >
                        <XMarkIcon className="h-5 w-5 text-white" />
                      </button>
                    </div>

                    {/* Summary badges */}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {[
                        { label: 'Giải trình', count: monthlyRequestHistory.explanations.length, color: 'bg-primary-400' },
                        { label: 'Nghỉ phép', count: monthlyRequestHistory.leaveRequests.length, color: 'bg-primary-400' },
                        { label: 'Đăng ký', count: monthlyRequestHistory.registrations.length, color: 'bg-amber-400' },
                        { label: 'Làm việc online', count: monthlyRequestHistory.onlineWorks.length, color: 'bg-teal-400' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-1.5 bg-white bg-opacity-15 rounded-lg px-2.5 py-1">
                          <span className={`w-2 h-2 rounded-full ${item.color}`} />
                          <span className="text-white text-xs font-medium">{item.label}</span>
                          <span className="text-white text-xs font-bold">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tab filter */}
                  <div className="border-b border-gray-100 bg-gray-50 px-4 pt-3 pb-0">
                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                      {[
                        {
                          key: 'all',
                          label: 'Tất cả',
                          count: monthlyRequestHistory.explanations.length + monthlyRequestHistory.leaveRequests.length + monthlyRequestHistory.registrations.length
                            + monthlyRequestHistory.onlineWorks.length,
                        },
                        { key: 'explanation', label: 'Giải trình', count: monthlyRequestHistory.explanations.length },
                        { key: 'leave', label: 'Nghỉ phép', count: monthlyRequestHistory.leaveRequests.length },
                        { key: 'registration', label: 'Đăng ký', count: monthlyRequestHistory.registrations.length },
                        { key: 'online_work', label: 'Làm việc online', count: monthlyRequestHistory.onlineWorks.length },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setHistoryActiveTab(tab.key as any)}
                          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${historyActiveTab === tab.key
                            ? 'border-violet-600 text-violet-700'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                          {tab.label}
                          {tab.count > 0 && (
                            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full ${historyActiveTab === tab.key ? 'bg-violet-100 text-violet-700' : 'bg-gray-200 text-gray-600'
                              }`}>
                              {tab.count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto">
                    {(() => {
                      // Tổng hợp danh sách theo tab
                      const allItems = [
                        ...(historyActiveTab === 'all' || historyActiveTab === 'explanation'
                          ? monthlyRequestHistory.explanations.map((e) => ({ ...e, _type: 'explanation' }))
                          : []),
                        ...(historyActiveTab === 'all' || historyActiveTab === 'leave'
                          ? monthlyRequestHistory.leaveRequests.map((l) => ({ ...l, _type: 'explanation' }))
                          : []),
                        ...(historyActiveTab === 'all' || historyActiveTab === 'registration'
                          ? monthlyRequestHistory.registrations.map((r) => ({ ...r, _type: 'registration' }))
                          : []),
                        ...(historyActiveTab === 'all' || historyActiveTab === 'online_work'
                          ? monthlyRequestHistory.onlineWorks.map((ow) => ({ ...ow, _type: 'online_work' }))
                          : []),
                      ].sort((a, b) => {
                        const dateA = new Date(a.created_at || a.attendance_date || a.work_date || a.event_date || 0).getTime();
                        const dateB = new Date(b.created_at || b.attendance_date || b.event_date || b.work_date || 0).getTime();
                        return dateB - dateA;
                      });

                      if (allItems.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
                            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
                              <ClipboardDocumentListIcon className="h-7 w-7 text-gray-400" />
                            </div>
                            <p className="text-gray-500 text-sm font-medium">Chưa có đơn nào trong tháng này</p>
                            <p className="text-gray-400 text-xs">Các đơn bạn tạo sẽ hiển thị tại đây</p>
                          </div>
                        );
                      }

                      return (
                        <div className="p-4 space-y-3 bg-gray-50/50 min-h-full">
                          {allItems.map((item, idx) => {
                            const statusConfig = ({
                              APPROVED: { label: 'Đã duyệt', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20' },
                              REJECTED: { label: 'Từ chối', cls: 'bg-red-50 text-red-700 ring-1 ring-red-600/20' },
                              PENDING: { label: 'Chờ duyệt', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20' },
                              DRAFT: { label: 'Nháp', cls: 'bg-gray-50 text-gray-600 ring-1 ring-gray-500/20' },
                              CANCELLED: { label: 'Đã huỷ', cls: 'bg-gray-50 text-gray-500 ring-1 ring-gray-500/20' },
                            } as Record<string, { label: string; cls: string }>)[item.status] || { label: item.status, cls: 'bg-gray-50 text-gray-600 ring-1 ring-gray-500/20' };

                            const typeConfig = (() => {
                              if (item._type === 'explanation' && item.explanation_type === 'LEAVE') {
                                return { label: 'Nghỉ phép tháng', bg: 'bg-primary-50 text-primary-700 ring-1 ring-primary-600/20' };
                              }
                              if (item._type === 'registration' && item.registration_type === 'OFF_DUTY') {
                                return { label: 'Đăng ký Vào/Ra trực', bg: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20' };
                              }
                              return ({
                                explanation: { label: 'Giải trình', bg: 'bg-primary-50 text-primary-700 ring-1 ring-primary-600/20' },
                                registration: { label: 'Đăng ký', bg: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20' },
                                online_work: { label: 'Làm việc online', bg: 'bg-teal-50 text-teal-700 ring-1 ring-teal-600/20' },
                              } as Record<string, { label: string; bg: string }>)[item._type] || { label: getExplanationTypeLabel(item._type), bg: 'bg-gray-50 text-gray-700 ring-1 ring-gray-600/20' };
                            })();

                            const dateStr = item.attendance_date || item.work_date || item.created_at;
                            const fmtDate = (s: string) =>
                              new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
                            const isMultiDayGroup = item._groupIds?.length > 1 && item.start_date && item.end_date && item.start_date !== item.end_date;
                            const displayDate = isMultiDayGroup
                              ? `${fmtDate(item.start_date)} — ${fmtDate(item.end_date)}`
                              : dateStr ? fmtDate(dateStr) : '—';

                            let requestName = '';
                            if (item._type === 'explanation') {
                              requestName = item.explanation_type ? (EXPLANATION_TYPE_MAP[item.explanation_type] || item.explanation_type) : 'Đơn giải trình';
                            } else if (item._type === 'registration') {
                              requestName = item.registration_type ? (EXPLANATION_TYPE_MAP[item.registration_type] || item.registration_type) : 'Đơn đăng ký';
                            } else if (item._type === 'online_work') {
                              requestName = 'Đơn làm việc online';
                            } else if (item._type === 'explanation' && item.explanation_type === 'LEAVE') {
                              requestName = 'Đơn nghỉ phép tháng';
                            }

                            return (
                              <div key={`${item._type}-${item.id}-${idx}`} className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-violet-200 transition-all duration-300">
                                <div className="flex flex-col gap-3">
                                  {/* Header: Badges & Code */}
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${typeConfig.bg}`}>
                                        {typeConfig.label}
                                      </span>
                                      {item.request_code && (
                                        <span className="text-[11px] font-mono text-gray-400 font-medium bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100/50">
                                          {item.request_code}
                                        </span>
                                      )}
                                    </div>
                                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${statusConfig.cls}`}>
                                      {statusConfig.label}
                                    </span>
                                  </div>

                                  {/* Body: Title & Reason */}
                                  <div className="flex flex-col gap-2 relative z-10">
                                    {requestName && (
                                      <h4 className="text-[15px] font-bold text-gray-900 leading-snug">
                                        {requestName}
                                      </h4>
                                    )}

                                    {(() => {
                                      let rawReason = item.reason || item.work_plan || '';

                                      const prefixes = [
                                        requestName,
                                        item.explanation_type ? EXPLANATION_TYPE_MAP[item.explanation_type] : '',
                                        item.registration_type ? EXPLANATION_TYPE_MAP[item.registration_type] : '',
                                        'Giải trình đi muộn', 'Giải trình về sớm', 'Giải trình quên chấm công',
                                        'Giải trình đi công tác', 'Giải trình ngày đầu đi làm',
                                        'Đi muộn', 'Về sớm', 'Quên chấm công', 'Đi công tác', 'Ngày đầu đi làm',
                                        'Đăng ký tăng ca', 'Đăng ký làm thêm giờ', 'Đăng ký trực tối', 'Đăng ký Live',
                                        'Tăng ca', 'Làm thêm giờ', 'Trực tối', 'Live',
                                        'Làm việc online', 'Làm online', 'Nghỉ phép'
                                      ].filter(Boolean);

                                      prefixes.sort((a, b) => b.length - a.length);

                                      for (const p of prefixes) {
                                        if (p && rawReason.toLowerCase().startsWith(p.toLowerCase())) {
                                          rawReason = rawReason.substring(p.length).replace(/^[\:\-\s]+/, '').trim();
                                          break;
                                        }
                                      }

                                      return rawReason ? (
                                        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100/60 shadow-inner overflow-hidden relative">
                                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-gray-200 to-gray-100"></div>
                                          <div className="flex items-start gap-2 pl-1">
                                            <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
                                            </svg>
                                            <span className="text-[13px] text-gray-600 font-medium leading-relaxed line-clamp-2">
                                              {rawReason}
                                            </span>
                                          </div>
                                        </div>
                                      ) : null;
                                    })()}
                                  </div>

                                  {/* Footer: Date */}
                                  <div className="flex items-center justify-between pt-2.5 mt-0.5 border-t border-gray-50">
                                    <div className="flex items-center gap-1.5 text-gray-400">
                                      <CalendarIcon className="h-4 w-4" />
                                      <span className="text-xs font-semibold">{displayDate}</span>
                                    </div>
                                    {item.registration_type !== 'OFF_DUTY' && (item.start_time || item.end_time || item.check_in || item.check_out) && (
                                      <div className="flex items-center gap-1.5 text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
                                        <ClockIcon className="h-3.5 w-3.5" />
                                        <span className="text-[11px] font-bold">
                                          {item.start_time || item.check_in || '--'} — {item.end_time || item.check_out || '--'}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Huỷ đơn / Đổi loại đơn — hiện khi BE báo can_self_cancel=true:
                                      còn Chờ duyệt + CHƯA qua bước quản lý trực tiếp duyệt, HOẶC đã
                                      duyệt nhưng HCNS đã "Mở khoá đặc biệt" cho đúng NV/ngày/loại đơn
                                      này (xem can_owner_self_cancel() ở backend). Fallback về điều
                                      kiện cũ nếu can_self_cancel chưa có (phòng cache cũ). */}
                                  {(item.can_self_cancel ?? (item.status === 'PENDING' && !item.direct_manager_approved)) && item.id && (() => {
                                    const isGroup = item._groupIds?.length > 1;
                                    // Đổi loại đơn giả định 1 ngày duy nhất — không áp dụng cho
                                    // đơn Nghỉ không phép nhiều ngày (gộp hiển thị).
                                    const canConvert = !isGroup && (
                                      (item._type === 'explanation' && item.explanation_type === 'LEAVE') ||
                                      (item._type === 'registration' && item.registration_type === 'UNAUTHORIZED_ABSENCE')
                                    );
                                    return (
                                      <div className="pt-1 space-y-2">
                                        {canConvert && (
                                          <button
                                            onClick={() => setConvertRequestItem(item)}
                                            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
                                          >
                                            Đổi loại đơn
                                          </button>
                                        )}
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => openEditRequestModal(item)}
                                            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                          >
                                            Sửa đơn
                                          </button>
                                          <button
                                            onClick={() => openCancelRequest(item)}
                                            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                          >
                                            Huỷ đơn
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Footer */}
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <button
                      onClick={() => {
                        refreshAllData();
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 text-sm text-violet-600 font-medium hover:text-violet-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Làm mới
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* ===== MODAL: Sửa đơn (tự phục vụ, chờ duyệt) ===== */}
      {editRequestItem && (
        <div className="fixed inset-0 z-[110] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-6">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => !editRequestSubmitting && setEditRequestItem(null)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-900">
                  Sửa đơn{editRequestItem._groupIds?.length > 1 ? ` (${editRequestItem._groupIds.length} ngày)` : ''}
                </h3>
                <button
                  onClick={() => !editRequestSubmitting && setEditRequestItem(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-3">
                {editRequestItem._type === 'explanation' && editRequestItem.explanation_type === 'LEAVE' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Ngày nghỉ</label>
                    <input
                      type="date"
                      value={editRequestForm.attendance_date}
                      onChange={(e) => setEditRequestForm((f) => ({ ...f, attendance_date: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                )}

                {hasTimeRange(editRequestItem) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Giờ bắt đầu</label>
                      <input
                        type="time"
                        value={editRequestForm.start_time}
                        onChange={(e) => setEditRequestForm((f) => ({ ...f, start_time: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Giờ kết thúc</label>
                      <input
                        type="time"
                        value={editRequestForm.end_time}
                        onChange={(e) => setEditRequestForm((f) => ({ ...f, end_time: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  </div>
                )}

                {editRequestItem._type === 'explanation' && editRequestItem.explanation_type !== 'LEAVE' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Check-in thực tế</label>
                      <input
                        type="time"
                        value={editRequestForm.actual_check_in}
                        onChange={(e) => setEditRequestForm((f) => ({ ...f, actual_check_in: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Check-out thực tế</label>
                      <input
                        type="time"
                        value={editRequestForm.actual_check_out}
                        onChange={(e) => setEditRequestForm((f) => ({ ...f, actual_check_out: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Lý do</label>
                  <textarea
                    value={editRequestForm.reason}
                    onChange={(e) => setEditRequestForm((f) => ({ ...f, reason: e.target.value }))}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                  />
                </div>

                {editRequestError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{editRequestError}</p>
                )}
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setEditRequestItem(null)}
                  disabled={editRequestSubmitting}
                  className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  onClick={handleUpdateRequest}
                  disabled={editRequestSubmitting}
                  className="flex-1 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {editRequestSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: Xác nhận huỷ đơn (thu hồi, tự phục vụ) ===== */}
      {cancelRequestItem && (
        <div className="fixed inset-0 z-[110] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => !cancelSubmitting && setCancelRequestItem(null)}
            ></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-1">Huỷ đơn?</h3>
              <p className="text-sm text-gray-500 mb-4">
                Đơn sẽ chuyển sang trạng thái "Đã huỷ" và không còn chờ duyệt nữa. Bạn có thể tạo lại đơn mới sau khi huỷ.
              </p>
              <textarea
                value={cancelReasonText}
                onChange={(e) => setCancelReasonText(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="Lý do huỷ (không bắt buộc)..."
                disabled={cancelSubmitting}
              />
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setCancelRequestItem(null)}
                  disabled={cancelSubmitting}
                  className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleCancelRequest}
                  disabled={cancelSubmitting}
                  className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {cancelSubmitting ? 'Đang huỷ...' : 'Xác nhận huỷ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: Xác nhận đổi loại đơn ===== */}
      {convertRequestItem && (
        <div className="fixed inset-0 z-[110] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => !convertSubmitting && setConvertRequestItem(null)}
            ></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                {convertRequestItem.explanation_type === 'LEAVE' ? 'Đổi thành Nghỉ không phép?' : 'Đổi thành Nghỉ phép tháng?'}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Đơn hiện tại sẽ được huỷ và tạo đơn mới cùng ngày với loại vừa chọn. Không thể tự khôi phục lại đơn cũ.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConvertRequestItem(null)}
                  disabled={convertSubmitting}
                  className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleConvertRequest}
                  disabled={convertSubmitting}
                  className="flex-1 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {convertSubmitting ? 'Đang đổi...' : 'Xác nhận đổi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notification Dialog */}

      {
        notification.show && (
          <div className="fixed inset-0 z-[100] overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div
                className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                onClick={() =>
                  setNotification((prev) => ({ ...prev, show: false }))
                }
              ></div>

              <span
                className="hidden sm:inline-block sm:align-middle sm:h-screen"
                aria-hidden="true"
              >
                &#8203;
              </span>

              <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-sm sm:w-full sm:p-6">
                <div>
                  <div
                    className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${notification.type === 'success'
                      ? 'bg-emerald-100'
                      : notification.type === 'error'
                        ? 'bg-red-100'
                        : 'bg-amber-100'
                      }`}
                  >
                    {notification.type === 'success' ? (
                      <CheckCircleIcon
                        className="h-6 w-6 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : notification.type === 'error' ? (
                      <XMarkIcon
                        className="h-6 w-6 text-red-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <ClockIcon
                        className="h-6 w-6 text-amber-600"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3 className="text-lg leading-6 font-bold text-gray-900">
                      {notification.title}
                    </h3>
                    <div className="mt-2 text-sm text-gray-500">
                      <p>{notification.message}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:mt-6">
                  <button
                    type="button"
                    className={`inline-flex justify-center w-full rounded-md border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:text-sm transition-colors ${notification.type === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'
                      : notification.type === 'error'
                        ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                        : 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
                      }`}
                    onClick={() =>
                      setNotification((prev) => ({ ...prev, show: false }))
                    }
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
        </>
      )}
    </div >
  );
};

export default AttendanceManagement;
