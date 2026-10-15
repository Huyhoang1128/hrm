import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { approvalService } from '../services/approval.service';
import { attendanceService } from '../services/attendance.service';
import FinalizationLockBanner from '../components/FinalizationLockBanner';
import { workFinalizationApprovalService } from '../services/workFinalizationApproval.service';
import { attendanceFinalizationApprovalService } from '../services/attendanceFinalizationApproval.service';
import { salaryService } from '../services/salary.service';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import { useAuth } from '../contexts/AuthContext';
import AttendanceCalendar from '../components/AttendanceCalendar';
import AttendanceWfDetailModal from '../components/AttendanceWfDetailModal';
import { PROBATION_RATE_OPTIONS } from '../constants/onboarding';
import shiftRegistrationService, { Ca2PendingApprovalRow, caLabels } from '../services/shiftRegistration.service';
import OvertimeReconciliationPanel from '../components/OvertimeReconciliationPanel';
import ApprovalActionModals from '../components/approvals/ApprovalActionModals';
import WorkFinalizationApprovalPanel from '../components/approvals/WorkFinalizationApprovalPanel';
import AttendanceFinalizationPanel from '../components/approvals/AttendanceFinalizationPanel';
import { EDIT_FIELD_LABELS, sortEditChanges, formatEditValue, countRealEditChanges } from '../utils/editHistory';
import deadlineExceptionService, { AppliedDeadlineException } from '../services/deadlineException.service';
import { DeadlineExceptionBadge, DeadlineExceptionDetail } from '../components/approvals/DeadlineExceptionFlag';
import { useNotePrompt } from '../components/NotePromptDialog';

// Giá trị đặc biệt cho lựa chọn "Tôi là QLTT" trong dropdown Phòng ban —
// không phải tên phòng ban thật nên không bao giờ trùng.
const MY_DIRECT_REPORTS_SENTINEL = '__MY_DIRECT_REPORTS__';

// Màu cho chip lọc loại đơn. PHẢI viết đủ chuỗi class tĩnh — trước đây dùng
// `bg-${opt.color}-600` và Tailwind JIT không quét được chuỗi ghép động (dự án
// cũng không có safelist), nên các chip này thực tế ĐANG MẤT MÀU trên bản
// build. Cùng cách làm với VARIANT_STYLES ở ConfirmDialog.tsx.
// Danh sách sub-filter — tách ra hằng số để dùng chung cho hàng chip "Chi tiết"
// (trước đây 2 mảng này viết inline trong JSX của 2 khối riêng).
const EXPLANATION_SUB_TYPES = [
  { value: 'LATE', label: 'Đi muộn' },
  { value: 'EARLY_LEAVE', label: 'Về sớm' },
  { value: 'LATE_EARLY', label: 'Đi muộn/Về sớm' },
  { value: 'INCOMPLETE_ATTENDANCE', label: 'Quên chấm công' },
  { value: 'BUSINESS_TRIP', label: 'Đi công tác' },
  { value: 'FIRST_DAY', label: 'Ngày đầu đi làm' },
];

const REGISTRATION_SUB_TYPES = [
  { value: 'OVERTIME', label: 'Tăng ca' },
  { value: 'NIGHT_SHIFT', label: 'Trực tối' },
  { value: 'LIVE', label: 'Live stream' },
  { value: 'OFF_DUTY', label: 'Vào/Ra trực' },
  { value: 'UNAUTHORIZED_ABSENCE', label: 'Nghỉ không phép' },
  // Đã bỏ chip "Đổi ca" (SHIFT_CHANGE) 2026-09-23: tra dữ liệu thật thì toàn
  // hệ thống có ĐÚNG 0 đơn loại này (kiểm cả event_type='shift_change' lẫn
  // data.registration_type='SHIFT_CHANGE'), nên chip đó không bao giờ lọc ra
  // gì. Luồng tạo/duyệt đơn đổi ca trong code vẫn giữ nguyên — khi nào thực
  // sự có người dùng thì thêm lại đúng 1 dòng ở đây.
  { value: 'CA2', label: 'Đăng ký ca (Ca 1/Ca 2)' },
];

const TYPE_CHIP_STYLES: Record<string, { active: string; idle: string; badge: string }> = {
  amber: {
    active: 'bg-amber-600 text-white border-transparent',
    idle: 'bg-white text-gray-600 border-gray-200 hover:border-amber-300',
    badge: 'bg-amber-50 text-amber-600',
  },
  primary: {
    active: 'bg-primary-600 text-white border-transparent',
    idle: 'bg-white text-gray-600 border-gray-200 hover:border-primary-300',
    badge: 'bg-primary-50 text-primary-600',
  },
  emerald: {
    active: 'bg-emerald-600 text-white border-transparent',
    idle: 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300',
    badge: 'bg-emerald-50 text-emerald-600',
  },
};

const Approvals: React.FC = () => {
  const { user } = useAuth();
  const { askNote, notePromptDialog } = useNotePrompt();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'pending' | 'approved' | 'rejected'
  >('pending');
  // Đối chiếu tăng ca: trước đây là 1 tab riêng, từ 2026-09-23 chuyển thành
  // modal mở từ nút ở đầu trang (yêu cầu HCNS: "move cái tab hiện tại đối
  // chiếu với máy chấm công vào 1 modal riêng cũng trong phê duyệt") — thanh
  // tab giờ chỉ còn đúng 3 trạng thái duyệt cho dễ nhìn.
  const [showOtReconciliationModal, setShowOtReconciliationModal] = useState(false);

  // Trang này gánh 4 nghiệp vụ khác nhau. Trước 2026-09-23 cả 4 xếp chồng trên
  // CÙNG 1 màn (phải cuộn ~1700px mới tới danh sách đơn); nay tách thành "khu
  // vực" riêng chọn bằng thanh tab (yêu cầu HCNS: "tách thành các tab riêng
  // trong cùng trang").
  // CHỦ Ý: dùng state RIÊNG chứ không nhét thêm giá trị vào `activeTab` — vì
  // `activeTab` đang được hàng chục useMemo/filter dùng để lọc trạng thái đơn
  // (PENDING/APPROVED/REJECTED); thêm giá trị lạ vào đó sẽ làm các filter kia
  // trả kết quả rỗng hoặc sai. Tách state giữ toàn bộ logic cũ nguyên vẹn.
  type ApprovalSection = 'requests' | 'work_finalization' | 'attendance_finalization';
  const [activeSection, setActiveSection] = useState<ApprovalSection>('requests');
  const [attendanceExplanations, setAttendanceExplanations] = useState<any[]>(
    []
  );
  const [approvedExplanations, setApprovedExplanations] = useState<any[]>([]);
  const [rejectedExplanations, setRejectedExplanations] = useState<any[]>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState<any[]>([]);
  const [approvedRegistrations, setApprovedRegistrations] = useState<any[]>([]);
  const [rejectedRegistrations, setRejectedRegistrations] = useState<any[]>([]);
  const [pendingLeaveRequests, setPendingLeaveRequests] = useState<any[]>([]);
  const [approvedLeaveRequests, setApprovedLeaveRequests] = useState<any[]>([]);
  const [rejectedLeaveRequests, setRejectedLeaveRequests] = useState<any[]>([]);
  const [pendingOvertimeRequests, setPendingOvertimeRequests] = useState<any[]>([]);
  const [approvedOvertimeRequests, setApprovedOvertimeRequests] = useState<any[]>([]);
  const [rejectedOvertimeRequests, setRejectedOvertimeRequests] = useState<any[]>([]);
  const [pendingOnlineWorkRequests, setPendingOnlineWorkRequests] = useState<any[]>([]);
  const [approvedOnlineWorkRequests, setApprovedOnlineWorkRequests] = useState<any[]>([]);
  const [rejectedOnlineWorkRequests, setRejectedOnlineWorkRequests] = useState<any[]>([]);
  const [workFinalizationApprovals, setWorkFinalizationApprovals] = useState<any[]>([]);
  const [allWfApprovals, setAllWfApprovals] = useState<any[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterExplanationSubTypes, setFilterExplanationSubTypes] = useState<string[]>([]);
  const [filterRegistrationSubTypes, setFilterRegistrationSubTypes] = useState<string[]>([]);
  const [filterName, setFilterName] = useState('');
  const debouncedFilterName = useDebounce(filterName, 300);
  const [filterDepartment, setFilterDepartment] = useState('');
  const [fetchProgress, setFetchProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  // Mặc định lọc theo THÁNG HIỆN TẠI (không lùi về tháng trước dù đang ở đầu
  // tháng) — trước đây "đầu tháng (ngày ≤ 15) thì mặc định lùi về tháng trước"
  // khiến toàn bộ đơn Tăng ca/Nghỉ phép/Giải trình phát sinh TRONG THÁNG MỚI bị
  // ẩn hết khỏi tab "Chờ duyệt" từ ngày 1-15 mỗi tháng (backend lọc thẳng theo
  // event_date__month, xem hrm/duyet_don_views.py::_apply_filters), dù đơn vẫn
  // tồn tại và đúng quyền duyệt. Việc mặc định hiển thị thêm dữ liệu "Chốt công
  // tháng" của tháng vừa đóng khi mới sang tháng mới được xử lý riêng trong
  // fetchWorkFinalizationData(), không còn dựa vào initialMonth/initialYear này.
  const nowForInit = new Date();
  const initialMonth = nowForInit.getMonth() + 1;
  const initialYear = nowForInit.getFullYear();

  // Bộ lọc tháng tách riêng 2 nhóm tab, vì mặc định HỢP LÝ của chúng khác nhau:
  //  - "Chờ duyệt": mặc định TẤT CẢ (0) — đơn chờ duyệt cho ngày tháng sau
  //    phải thấy được ngay, không thì bị bỏ quên (xem fetchPendingRequests).
  //  - "Đã duyệt"/"Từ chối": mặc định THÁNG HIỆN TẠI — chọn "Tất cả" ở đây là
  //    13.000+ đơn với tài khoản HCNS, tức ~66 lượt gọi API liên tiếp cho 1
  //    lần mở tab. Vẫn chọn được nếu cần, chỉ là không mặc định.
  const MONTH_ALL = 0;
  const [pendingMonth, setPendingMonth] = useState<number>(MONTH_ALL);
  const [historyMonth, setHistoryMonth] = useState<number>(initialMonth);
  const filterMonth = activeTab === 'pending' ? pendingMonth : historyMonth;
  const setFilterMonth = (m: number) =>
    (activeTab === 'pending' ? setPendingMonth : setHistoryMonth)(m);
  const [filterYear, setFilterYear] = useState<number>(initialYear);
  /** Tham số tháng gửi lên API — bỏ trống khi đang chọn "Tất cả". */
  const monthParams = () =>
    filterMonth === MONTH_ALL ? { day: 0 } : { day: 0, month: filterMonth, year: filterYear };
  const [filterOnlyMine, setFilterOnlyMine] = useState(false);
  // "Tôi là QLTT" — chỉ hiện đơn của cấp dưới trực tiếp của mình. Khác
  // filterOnlyMine (đơn CỦA chính mình). Chủ yếu hữu ích cho HR/Admin — nhân
  // viên/quản lý thường đã tự động bị giới hạn xuống đúng phạm vi này rồi
  // (xem block "isTrueSuperAdmin/isTrueHR" bên dưới), nên với họ toggle này
  // không đổi gì thêm — chỉ thật sự cần khi 1 người VỪA là QLTT VỪA là
  // HR/Admin (mặc định thấy toàn công ty, khó tìm đúng cấp dưới của mình).
  const [filterOnlyMyDirectReports, setFilterOnlyMyDirectReports] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState<any>(null);
  const isFetchingRef = useRef<boolean>(false);
  const lastFetchTimeRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [selectedExplanation, setSelectedExplanation] = useState<any>(null);
  const [selectedOnlineWorkRequest, setSelectedOnlineWorkRequest] =
    useState<any>(null);
  const [selectedWfApproval, setSelectedWfApproval] = useState<any>(null);
  const [selectedWfApprovalSource, setSelectedWfApprovalSource] = useState<'WORK' | 'ATTENDANCE'>('WORK');
  const [wfEmployees, setWfEmployees] = useState<any[]>([]);
  const [expandedWfEmployees, setExpandedWfEmployees] = useState<Record<string, boolean>>({});
  const [wfEmployeeActionLoadingId, setWfEmployeeActionLoadingId] = useState<number | null>(null);
  const [wfBulkApproveLoading, setWfBulkApproveLoading] = useState(false);
  const [wfPrintLoading, setWfPrintLoading] = useState(false);
  const [showWfDetailModal, setShowWfDetailModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [expandedDepartments, setExpandedDepartments] = useState<string[]>([]);
  const [expandedEmployees, setExpandedEmployees] = useState<string[]>([]);
  // Nhóm được TỰ mở sẵn (danh sách ít) mà người dùng chủ động đóng lại — phải
  // nhớ riêng, nếu không thì bấm đóng xong nó tự mở lại ngay.
  const [collapsedDepartments, setCollapsedDepartments] = useState<string[]>([]);
  const [collapsedEmployees, setCollapsedEmployees] = useState<string[]>([]);
  // Khối "Đang chờ quản lý trực tiếp" ở tab Chờ duyệt của HCNS — thu gọn sẵn vì
  // đó là việc của QLTT, HCNS chưa thao tác gì được.
  const [showWaitingManagerSection, setShowWaitingManagerSection] = useState(false);
  // Khối "Bạn đã duyệt · đang chờ HCNS" ở tab Chờ duyệt (QLTT) — đóng sẵn vì
  // không phải việc cần làm, chỉ để QLTT theo dõi tiến độ.
  const [showManagerApprovedSection, setShowManagerApprovedSection] = useState(false);
  const [departmentDateFilters, setDepartmentDateFilters] = useState<Record<string, string>>({});
  const [openDepartmentDateFilter, setOpenDepartmentDateFilter] = useState<string | null>(null);
  const [expandedWorkNotes, setExpandedWorkNotes] = useState<Record<string, boolean>>({});
  const [calendarModalEmployee, setCalendarModalEmployee] = useState<{ id: number; name: string; month: number; year: number } | null>(null);
  const [employeeCache, setEmployeeCache] = useState<Record<number, any>>({});
  const [loadingEmployees, setLoadingEmployees] = useState<Record<number, boolean>>({});

  const ensureEmployeeDetails = async (employeeId?: number) => {
    if (!employeeId) return null;
    if (employeeCache[employeeId]) return employeeCache[employeeId];
    if (loadingEmployees[employeeId]) return null;
    try {
      setLoadingEmployees(prev => ({ ...prev, [employeeId]: true }));
      let emp: any = null;
      try {
        emp = await salaryService.getEmployeeApprovalSummary(employeeId);
      } catch (approvalErr) {
        emp = await salaryService.getEmployeeSalaryConfig(employeeId);
      }
      setEmployeeCache(prev => ({ ...prev, [employeeId]: emp }));
      return emp;
    } catch (err) {
      console.error('Lỗi khi tải thông tin nhân sự', err);
      return null;
    } finally {
      setLoadingEmployees(prev => ({ ...prev, [employeeId]: false }));
    }
  };

  const getFieldAliases = (field: string) => {
    const map: Record<string, string[]> = {
      employee_name: ['full_name', 'ho_va_ten', 'name'],
      employee_code: ['employee_code', 'ma_nv', 'code'],
      position: ['position', 'vi_tri', 'title', 'position.title', 'position_name'],
      department_name: ['department_name', 'phong_ban', 'department.name', 'department.title', 'department.full_name', 'department'],
      start_date: ['start_date', 'date_start', 'joined_at'],
      probation_months: ['probation_months', 'probation'],
      basic_salary: ['basic_salary', 'luong_co_ban'],
      allowance: ['allowance', 'phu_cap', 'benefits'],
      doctor_team: ['doctor_team', 'team_doctor', 'bac_si_team', 'main_doctor', 'doctor_primary', 'bac_si_chinh'],
      work_form: ['work_form_display', 'work_form', 'hinh_thuc_lam_viec', 'work_type', 'working_type'],
      employee_status: ['status', 'employment_status', 'contract_status'],
      employment_status_notes: ['employment_status_notes', 'ghi_chu_trang_thai', 'ghi_chu_cong_viec', 'status_note'],
    };

    return map[field] || [field];
  };

  const getFirstAvailableValue = (sources: any[], field: string) => {
    for (const source of sources) {
      if (!source) continue;
      for (const key of getFieldAliases(field)) {
        const value = getNestedValue(source, key);
        if (value !== undefined && value !== null && value !== '') return value;
      }
    }
    return undefined;
  };

  const getEmpField = (item: any, field: string) => {
    if (!item) return '-';
    const empId = item.employee_id || (item.employee && typeof item.employee === 'object' ? item.employee.id : item.employee);
    const cached = empId ? employeeCache[empId] : null;
    const value = getFirstAvailableValue(
      [item, item?._employee_detail, cached, cached?._employee_detail],
      field
    );
    if (value !== undefined && value !== null && value !== '') return value;
    return '-';
  };

  const getNestedValue = (obj: any, path: string) => {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((acc: any, key: string) => {
      if (acc === undefined || acc === null) return undefined;
      return acc[key];
    }, obj);
  };

  const normalizeStatusText = (value: any) =>
    String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const isInactiveEmployee = (emp: any): boolean => {
    if (!emp) return false;

    const falseLike = ['false', '0', 'no', 'inactive', 'disabled'];
    const booleanCandidates = [
      emp?.is_active,
      emp?.active,
      emp?._employee_detail?.is_active,
      emp?._employee_detail?.active,
    ];

    if (booleanCandidates.some((value) => value === false)) return true;
    if (booleanCandidates.some((value) => falseLike.includes(normalizeStatusText(value)))) return true;

    const statusTexts = [
      emp?.tinh_trang,
      emp?.employee_status,
      emp?.status,
      emp?.employment_status,
      emp?._employee_detail?.status,
      emp?._employee_detail?.employment_status,
      emp?._employee_detail?.contract_status,
    ]
      .map(normalizeStatusText)
      .filter(Boolean);

    const inactiveKeywords = [
      'inactive',
      'disabled',
      'terminated',
      'resigned',
      'quit',
      'offboarded',
      'da nghi',
      'nghi viec',
      'thoi viec',
      'tam nghi',
      'ngung lam',
      'khong hoat dong',
      'vo hieu',
    ];

    return statusTexts.some((status) => inactiveKeywords.some((keyword) => status.includes(keyword)));
  };

  const parseDateValue = (value: any): Date | null => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const resignedInApprovalMonth = (emp: any, month?: number, year?: number): boolean => {
    if (!emp) return false;
    if (!month || !year || Number.isNaN(month) || Number.isNaN(year)) return false;

    const resignationDate =
      emp?.ngay_nghi_viec ||
      emp?.resignation_date ||
      emp?.leave_date ||
      emp?.end_date ||
      emp?._employee_detail?.end_date ||
      emp?._employee_detail?.resignation_date ||
      emp?._employee_detail?.leave_date;

    const date = parseDateValue(resignationDate);
    if (!date) return false;

    return date.getMonth() + 1 === month && date.getFullYear() === year;
  };

  const startedOnOrBeforeApprovalMonth = (emp: any, month?: number, year?: number): boolean => {
    if (!emp) return true;
    if (!month || !year || Number.isNaN(month) || Number.isNaN(year)) return true;

    const startDate =
      emp?.ngay_bat_dau_lam_viec ||
      emp?.start_date ||
      emp?.joined_at ||
      emp?.date_start ||
      emp?._employee_detail?.ngay_bat_dau_lam_viec ||
      emp?._employee_detail?.start_date ||
      emp?._employee_detail?.joined_at ||
      emp?._employee_detail?.date_start;

    const date = parseDateValue(startDate);
    if (!date) return true;

    const startMonthIndex = date.getFullYear() * 12 + (date.getMonth() + 1);
    const approvalMonthIndex = year * 12 + month;
    return startMonthIndex <= approvalMonthIndex;
  };

  const shouldKeepWorkFinalizationEmployee = (emp: any, month?: number, year?: number): boolean => {
    if (!startedOnOrBeforeApprovalMonth(emp, month, year)) return false;
    if (!isInactiveEmployee(emp)) return true;
    return resignedInApprovalMonth(emp, month, year);
  };

  const pickFirstAvailable = (obj: any, paths: string[]) => {
    for (const path of paths) {
      const value = getNestedValue(obj, path);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  };

  const enrichWorkFinalizationEmployees = async (employees: any[]) => {
    const enriched = await Promise.all(
      (employees || []).map(async (emp: any) => {
        const employeeId = emp.employee_id || (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee);
        if (!employeeId) return emp;

        const detail = await ensureEmployeeDetails(Number(employeeId));
        if (!detail) return emp;

        const extraInfo = detail.extra_info || {};
        const salaryAdjustments = detail.salary_adjustments || {};

        return {
          ...emp,
          ma_nv: emp.ma_nv || detail.employee_id,
          ho_va_ten: emp.ho_va_ten || detail.full_name,
          phong_ban: emp.phong_ban || detail.department?.name || detail.department_name || detail.department?.title || detail.department?.full_name,
          department_name: emp.department_name || detail.department?.name || detail.department_name || detail.department?.title || detail.department?.full_name,
          bo_phan: emp.bo_phan || detail.section || detail.block,
          cap_bac: emp.cap_bac || detail.rank || detail.management_level,
          vi_tri: emp.vi_tri || detail.position?.title,
          doctor_team: emp.doctor_team || detail.doctor_team || pickFirstAvailable(extraInfo, ['doctor_team', 'team_doctor', 'bac_si_team']),
          hinh_thuc_lam_viec: emp.hinh_thuc_lam_viec || detail.work_form,
          ngay_nghi_viec: detail.end_date || emp.ngay_nghi_viec,
          thoi_gian_thu_viec: emp.thoi_gian_thu_viec || detail.probation_months,
          ngay_bat_dau_lam_viec: emp.ngay_bat_dau_lam_viec || detail.start_date,
          ngay_ket_thuc_thu_viec: detail.probation_end_date || emp.ngay_ket_thuc_thu_viec,
          ti_le_huong_thu_viec: emp.ti_le_huong_thu_viec || detail.probation_rate_display || detail.probation_rate,
          ghi_chu_luong: emp.ghi_chu_luong || detail.salary_notes,
          phu_cap: emp.phu_cap ?? detail.allowance,
          ty_le_doanh_so_huong: emp.ty_le_doanh_so_huong ?? pickFirstAvailable(detail, [
            'sales_percent',
            'extra_info.sales_percent',
            'extra_info.ty_le_doanh_so_huong',
            'salary_adjustments.sales_percent',
            'salary_adjustments.ty_le_doanh_so_huong',
          ]),
          ty_le_loi_nhuan_huong: emp.ty_le_loi_nhuan_huong ?? pickFirstAvailable(detail, [
            'profit_percent',
            'extra_info.profit_percent',
            'extra_info.ty_le_loi_nhuan_huong',
            'salary_adjustments.profit_percent',
            'salary_adjustments.ty_le_loi_nhuan_huong',
          ]),
          khau_tru_bhxh: emp.khau_tru_bhxh ?? pickFirstAvailable(detail, [
            'insurance_participation',
            'extra_info.khaug_tru_bhxh',
            'extra_info.khau_tru_bhxh',
            'salary_adjustments.khau_tru_bhxh',
            'salary_adjustments.bhxh',
          ]),
          tinh_trang: emp.tinh_trang || detail.employment_status,
          ghi_chu_cong_viec: emp.ghi_chu_cong_viec || detail.employment_status_notes,
          bac_si_chinh: emp.bac_si_chinh || pickFirstAvailable(extraInfo, ['bac_si_chinh', 'main_doctor']),
          bac_si_phu: emp.bac_si_phu || pickFirstAvailable(extraInfo, ['bac_si_phu', 'assistant_doctor']),
          team_doctor: emp.team_doctor || detail.doctor_team || pickFirstAvailable(extraInfo, ['team_doctor', 'bac_si_team']),
          _employee_detail: detail,
          _extra_info: extraInfo,
          _salary_adjustments: salaryAdjustments,
        };
      })
    );

    return enriched;
  };

  // Debug log cho Quota và dữ liệu được chọn
  useEffect(() => {
    if (selectedExplanation) {
      console.log('🔵 [DEBUG] Đơn giải trình được chọn:', {
        id: selectedExplanation.id,
        type: selectedExplanation.explanation_type,
        attendance_date: selectedExplanation.attendance_date,
        quota_used: selectedExplanation.quota_used,
        quota_remaining: selectedExplanation.quota_remaining,
        full_data: selectedExplanation
      });
    }
  }, [selectedExplanation]);

  useEffect(() => {
    if (workFinalizationApprovals.length > 0) {
      console.log('💎 [DATA UPDATE] Work Finalization list updated:', workFinalizationApprovals);
    }
  }, [workFinalizationApprovals]);

  useEffect(() => {
    if (selectedOnlineWorkRequest) {
      console.log('🟢 [DEBUG] Đơn làm việc online được chọn:', selectedOnlineWorkRequest);
    }
  }, [selectedOnlineWorkRequest]);

  useEffect(() => {
    setDepartmentDateFilters({});
    setOpenDepartmentDateFilter(null);
  }, [activeTab, filterMonth, filterYear]);

  interface StatsType {
    pending_leave: number;
    pending_overtime: number;
    pending_explanation: number;
    pending_registration: number;
    pending_online_work: number;
    total_pending: number;
    total_approved: number;
    total_rejected: number;
  }

  const [stats, setStats] = useState<StatsType>({
    pending_leave: 0,
    pending_overtime: 0,
    pending_explanation: 0,
    pending_registration: 0,
    pending_online_work: 0,
    total_pending: 0,
    total_approved: 0,
    total_rejected: 0,
  });

  // Role-based permissions for UI elements
  const isAdmin = (user as any)?.is_supperuser ||
    (user as any)?.is_superuser ||
    user?.role?.toUpperCase() === 'ADMIN' ||
    currentEmployee?.user?.is_superuser;

  const isHR = currentEmployee?.is_hr === true || user?.role?.toUpperCase() === 'HR';

  const isDepartmentManager = currentEmployee?.department?.manager_id === currentEmployee?.id;

  const isManagement = currentEmployee?.is_manager === true ||
    currentEmployee?.position?.is_management === true ||
    isDepartmentManager ||
    false;

  const hasBulkApprovePermission = isAdmin || isHR || isManagement;
  const visibleWorkFinalizationApprovals = useMemo(
    () =>
      (workFinalizationApprovals || []).filter((item) =>
        shouldKeepWorkFinalizationEmployee(item, Number(item?.month), Number(item?.year))
      ),
    [workFinalizationApprovals]
  );
  const getWfApprovalProgress = (item: any) => ({
    approved: Number(item?.approved_employees || 0),
    total: Number(item?.total_employees || 0),
  });
  const isWfPartiallyApproved = (item: any) => {
    const { approved, total } = getWfApprovalProgress(item);
    return item?.status === 'PENDING' && approved > 0 && total > 0;
  };
  const showWorkFinalizationPanel = isAdmin || isHR || isManagement || visibleWorkFinalizationApprovals.length > 0;

  // ── Chờ duyệt Ca 2 (đăng ký ca theo ngày, cần quản lý trực tiếp duyệt
  // trước 0h — vd Điều dưỡng BS Ma BS A) — hoàn toàn tách biệt khỏi
  // hệ EmployeeEvent/duyet-don ở trên (dữ liệu nằm ở ShiftRegistrationDay,
  // không phải EmployeeEvent), nên fetch + hiển thị riêng tại đây thay vì
  // đi qua getAllPendingRequests()/categorizeDuyetDonList(). Chỉ hiện khi
  // có đơn PENDING mà người xem có quyền duyệt (QLTT: cấp dưới trực tiếp;
  // Admin/HR: tất cả) — tự nhiên đúng "chỉ phòng đó nhìn thấy".
  // Đơn Ca 2 theo từng trạng thái. Từ 2026-09-23 Ca 2 KHÔNG còn khối riêng nữa
  // mà trộn thẳng vào danh sách đơn của 3 tab như mọi loại đơn khác (yêu cầu
  // HCNS: "ca 2 cũng là 1 loại đơn thôi ... cho thêm vào đơn đăng ký là được").
  const [pendingCa2, setPendingCa2] = useState<Ca2PendingApprovalRow[]>([]);
  const [approvedCa2, setApprovedCa2] = useState<Ca2PendingApprovalRow[]>([]);
  const [rejectedCa2, setRejectedCa2] = useState<Ca2PendingApprovalRow[]>([]);

  const fetchPendingCa2 = async () => {
    try {
      const [p, a, r] = await Promise.all([
        shiftRegistrationService.getPendingCa2Approvals('PENDING'),
        shiftRegistrationService.getPendingCa2Approvals('APPROVED'),
        shiftRegistrationService.getPendingCa2Approvals('REJECTED'),
      ]);
      setPendingCa2(p);
      setApprovedCa2(a);
      setRejectedCa2(r);
    } catch (err) {
      console.error('Lỗi tải danh sách đơn đăng ký ca:', err);
    }
  };

  /**
   * Quy đổi 1 dòng Ca 2 (nguồn ShiftRegistrationDay, KHÁC hệ EmployeeEvent của
   * các đơn còn lại) về đúng hình dạng item mà danh sách đơn đang dùng, để
   * hiển thị xen kẽ và lọc chung được. Gắn `_isCa2` để lúc Duyệt/Từ chối biết
   * đường gọi API riêng của Ca 2 (xem confirmAction).
   */
  const mapCa2ToRequestItem = (row: Ca2PendingApprovalRow): any => {
    const ca = [row.morning?.start_time, row.afternoon?.end_time].filter(Boolean).join(' - ');
    return {
      ...row,
      _itemType: 'REGISTRATION',
      _isCa2: true,
      registration_type: 'CA2',
      event_type: 'CA2',
      attendance_date: row.date,
      start_time: row.morning?.start_time || null,
      end_time: row.afternoon?.end_time || null,
      reason: `Đăng ký làm ${caLabels(row).reg}${ca ? ` (${ca})` : ''}`,
      employee_department: row.department_name,
      department_name: row.department_name,
      // Ca 2 chỉ có 1 bước duyệt (quản lý trực tiếp) — không qua HCNS như đơn
      // khác, nên coi như bước QLTT quyết định luôn trạng thái cuối.
      direct_manager_approved: row.status === 'APPROVED',
      hr_approved: row.status === 'APPROVED',
      employee_is_hr: true,   // để stepper chỉ hiện 1 bước, xem getStatusBadge
      approved_by_name: row.reviewed_by_name || null,
      approved_at: row.reviewed_at || null,
      // Ca 2 chỉ có 1 bước duyệt, nhưng timeline/stepper đọc theo tên trường
      // của bước QLTT — không map thì hiện "Chưa xác định · chưa diễn ra" dù
      // server có đủ người duyệt và thời điểm duyệt.
      direct_manager_approved_by_name: row.reviewed_by_name || null,
      direct_manager_approved_at: row.reviewed_at || null,
      hr_approved_by_name: row.reviewed_by_name || null,
      hr_approved_at: row.reviewed_at || null,
      direct_manager_rejected_by_name: row.status === 'REJECTED' ? row.reviewed_by_name || null : null,
      direct_manager_rejected_at: row.status === 'REJECTED' ? row.reviewed_at || null : null,
      rejected_by_name: row.status === 'REJECTED' ? row.reviewed_by_name || null : null,
      rejected_at: row.status === 'REJECTED' ? row.reviewed_at || null : null,
      approval_note: row.review_note || '',
      // Mốc GỬI đơn thật (backend bổ sung 2026-09-25). KHÔNG fallback về
      // reviewed_at/date như trước: lấy giờ DUYỆT làm giờ TẠO khiến mọi đơn
      // Ca 2 trông như được duyệt ngay lúc gửi, còn lấy `date` thì ra 00:00
      // của chính ngày làm ca — cả hai đều là mốc bịa. Đơn cũ chưa có mốc này
      // thì để trống, UI hiện "—".
      created_at: row.created_at || null,
    };
  };

  /** Ca 2 lấy về theo TẤT CẢ các ngày (API không có tham số tháng), trong khi
   *  các loại đơn khác đã được lọc sẵn theo tháng/năm từ lúc fetch — nên phải
   *  tự lọc ở đây cho khớp bộ lọc Tháng/Năm của trang. */
  const filterCa2ByMonth = (rows: Ca2PendingApprovalRow[]) =>
    filterMonth === MONTH_ALL ? rows : rows.filter((r) => {
      const m = String(r.date || '').match(/^(\d{4})-(\d{2})/);
      return !!m && Number(m[1]) === filterYear && Number(m[2]) === filterMonth;
    });

  const ca2ItemsForTab = useMemo(() => {
    const rows = activeTab === 'pending' ? pendingCa2 : activeTab === 'approved' ? approvedCa2 : rejectedCa2;
    return filterCa2ByMonth(rows).map(mapCa2ToRequestItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pendingCa2, approvedCa2, rejectedCa2, filterMonth, filterYear]);

  useEffect(() => {
    // Tải cả 3 trạng thái 1 lượt để badge của cả 3 tab đều đúng — đơn Ca 2 giờ
    // nằm xen kẽ trong danh sách đơn chứ không còn khối riêng.
    fetchPendingCa2();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMonth, filterYear]);

  const showAttendanceFinalizationPanel = isAdmin || isHR || isManagement;
  const visibleAllWfApprovals = useMemo(() => {
    // Trước 2026-09-23 panel này nằm chung trong 3 tab trạng thái nên lọc theo
    // activeTab. Nay nó có tab riêng -> hiện HẾT mọi trạng thái (bảng đã có
    // sẵn cột "Trạng thái"), khỏi phải nhảy qua lại 3 tab mới xem đủ.
    if (activeSection === 'attendance_finalization') return allWfApprovals || [];
    const tabStatusMap: Record<string, string> = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };
    const statusFilter = tabStatusMap[activeTab];
    return (allWfApprovals || []).filter((item) => !statusFilter || item.status === statusFilter);
  }, [allWfApprovals, activeTab, activeSection]);


  // States cho các modal Dialog mới
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [targetItem, setTargetItem] = useState<any>(null);
  const [actionType, setActionType] = useState<'APPROVE' | 'REJECT' | 'DELETE'>(
    'APPROVE'
  );
  const [approvalNote, setApprovalNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // Sửa giờ đơn tăng ca ngay ở tab Chờ duyệt (QLTT/HCNS) — xem canEditOvertimeHours
  const [otEditItem, setOtEditItem] = useState<any | null>(null);
  const [otEditStart, setOtEditStart] = useState('');
  const [otEditEnd, setOtEditEnd] = useState('');
  const [otEditSaving, setOtEditSaving] = useState(false);

  // States cho Duyệt hàng loạt (Bulk Action)
  // backendErrors: lý do lỗi THẬT từ backend cho từng đơn (vd "Đã quá hạn
  // duyệt đơn nghỉ không phép... Chỉ HCNS/Admin mới có thể duyệt ngoại lệ")
  // — trước đây chỉ cộng tổng error_count rồi bỏ luôn mảng errors chi tiết
  // của từng response, khiến QLTT bấm "Duyệt nhanh" xong tưởng đã xong hết
  // (không thấy lý do cụ thể đơn nào bị chặn) — case thực tế 2026-09-24:
  // 4 đơn Nghỉ không phép vị trí Sale viện quá hạn duyệt bị chặn âm thầm,
  // QLTT không biết nên báo "đã duyệt rồi" trong khi vẫn PENDING.
  const [bulkActionResult, setBulkActionResult] = useState<{ success: number; error: number; groupName: string; approvalItems: any[]; rejectionItems: any[]; backendErrors: { id: number; label: string; error: string }[] } | null>(null);
  const [bulkConfirmModal, setBulkConfirmModal] = useState<{ items: any[]; name: string } | null>(null);
  const [isWorkFinalizationExpanded, setIsWorkFinalizationExpanded] = useState(false);
  const [isAttendanceFinalizationExpanded, setIsAttendanceFinalizationExpanded] = useState(false);
  const PREVIEW_ROWS = 3;
  const displayedWorkFinalizationApprovals = useMemo(
    () => (isWorkFinalizationExpanded ? visibleWorkFinalizationApprovals : visibleWorkFinalizationApprovals.slice(0, PREVIEW_ROWS)),
    [visibleWorkFinalizationApprovals, isWorkFinalizationExpanded]
  );
  const displayedAllWfApprovals = useMemo(
    () => (isAttendanceFinalizationExpanded ? visibleAllWfApprovals : visibleAllWfApprovals.slice(0, PREVIEW_ROWS)),
    [visibleAllWfApprovals, isAttendanceFinalizationExpanded]
  );

  useEffect(() => {
    setIsWorkFinalizationExpanded(false);
  }, [activeTab, filterMonth, filterYear, visibleWorkFinalizationApprovals.length]);

  useEffect(() => {
    setIsAttendanceFinalizationExpanded(false);
  }, [activeTab, filterMonth, filterYear, visibleAllWfApprovals.length]);

  // Lock body scroll khi modal mở
  useEffect(() => {
    const anyModalOpen = actionModalOpen || deleteModalOpen || errorModalOpen || !!bulkConfirmModal || !!bulkActionResult || showDetailModal || showWfDetailModal;
    if (anyModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [actionModalOpen, deleteModalOpen, errorModalOpen, bulkConfirmModal, bulkActionResult, showDetailModal, showWfDetailModal]);

  const currentItem = selectedExplanation || selectedOnlineWorkRequest;
  const isViewingExp = currentItem?._itemType === 'EXPLANATION' || (!currentItem?._itemType && currentItem?.explanation_type && currentItem?.explanation_type !== 'LEAVE');
  const isViewingOnl = currentItem?._itemType === 'ONLINE_WORK';
  const isViewingReg = currentItem?._itemType === 'REGISTRATION' || currentItem?._itemType === 'OVERTIME';
  const isViewingLea = currentItem?._itemType === 'LEAVE' || currentItem?.explanation_type === 'LEAVE';

  const statsCount = (isViewingExp ? 1 : 0) + (isViewingOnl ? 1 : 0) + (isViewingReg ? 1 : 0) + (isViewingLea ? 1 : 0);

  const allRequestsForDepList = [
    ...attendanceExplanations || [], ...approvedExplanations || [], ...rejectedExplanations || [],
    ...pendingRegistrations || [], ...approvedRegistrations || [], ...rejectedRegistrations || [],
    ...pendingLeaveRequests || [], ...approvedLeaveRequests || [], ...rejectedLeaveRequests || [],
    ...pendingOvertimeRequests || [], ...approvedOvertimeRequests || [], ...rejectedOvertimeRequests || [],
    ...pendingOnlineWorkRequests || [], ...approvedOnlineWorkRequests || [], ...rejectedOnlineWorkRequests || []
  ];

  const uniqueDepts = Array.from(new Set(
    allRequestsForDepList.map(r => r.employee_department || r.department_name).filter(Boolean)
  )).sort();

  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [showRefreshToast, setShowRefreshToast] = useState(false);

  // Skeleton component for better UX
  const SkeletonItem = () => (
    <div className="animate-pulse bg-white border border-gray-100 rounded-lg p-6 mb-4 shadow-sm">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-3 bg-gray-100 rounded w-1/6"></div>
        </div>
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-gray-50 rounded-lg border border-gray-100/50"></div>
        ))}
      </div>
    </div>
  );

  // HIện thị tính số giờ/phút từ giờ bắt đầu → giờ kết thúc
  const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return null;
    try {
      const [h1, m1] = start.split(':').map(Number);
      const [h2, m2] = end.split(':').map(Number);

      if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return null;

      let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (diff <= 0) diff += 24 * 60; // Xử lý qua đêm

      const hours = Math.floor(diff / 60);
      const mins = diff % 60;

      if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}p` : `${hours}h`;
      }
      return `${mins}p`;
    } catch (e) {
      return null;
    }
  };

  const deptOptions = [
    { value: '', label: 'Tất cả phòng ban' },
    // Đặt ngay đầu — dành cho người VỪA là QLTT VỪA có quyền HR/Admin (nếu
    // không thì đã chỉ thấy đúng cấp dưới trực tiếp từ trước, không cần mục
    // này). Dropdown "Phòng ban" chỉ hiện cho isAdmin/isHR nên tự động đúng
    // đối tượng, không cần điều kiện riêng ở đây.
    { value: MY_DIRECT_REPORTS_SENTINEL, label: '★ Tôi là QLTT' },
    ...uniqueDepts.map(dept => ({ value: dept as string, label: dept as string }))
  ];




  // Move fetch helpers here (above useEffect)
  const fetchCurrentEmployee = async () => {
    try {
      const employee = await approvalService.getCurrentEmployee();
      setCurrentEmployee(employee);
      return employee;
    } catch (error) {
      console.error('Error fetching current employee:', error);
      return null;
    }
  };

  const fetchPendingRequests = async (signal?: AbortSignal) => {
    try {
      const applyPendingResult = (result: any) => {
        if (signal?.aborted) return;
        setAttendanceExplanations(result.attendance_explanations);
        setPendingRegistrations(result.registration_requests || []);
        setPendingLeaveRequests(result.leave_requests || []);
        setPendingOvertimeRequests(result.overtime_requests || []);
        setPendingOnlineWorkRequests(result.online_work_requests || []);
        setStats((prev: StatsType) => ({
          ...prev,
          pending_leave: result.leave_requests.length,
          pending_overtime: result.overtime_requests.length,
          pending_explanation: result.attendance_explanations.length,
          pending_registration: (result.registration_requests || []).length,
          pending_online_work: result.online_work_requests.length,
          total_pending: result.total_pending || 0,
        }));
      };

      // filterMonth = 0 ("Tất cả") -> KHÔNG gửi month/year, backend trả hết.
      // Đây là mặc định của tab Chờ duyệt: đơn cho ngày tháng sau phải thấy
      // được ngay, không thì bị bỏ quên (HCNS chốt 2026-09-28).
      const result = await (approvalService as any).getAllPendingRequests(
        monthParams(),
        (loaded: number, total: number | null) => { if (!signal?.aborted) setFetchProgress({ loaded, total }); },
        applyPendingResult,
        signal
      );
      applyPendingResult(result);
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return;
      console.error('× [APPROVALS] Error fetching pending requests:', error);
    }
  };

  const fetchApprovedRequests = async (signal?: AbortSignal) => {
    try {
      const applyApprovedResult = (result: any) => {
        if (signal?.aborted) return;
        setApprovedExplanations(result.attendance_explanations);
        setApprovedRegistrations(result.registration_requests || []);
        setApprovedLeaveRequests(result.leave_requests || []);
        setApprovedOvertimeRequests(result.overtime_requests || []);
        setApprovedOnlineWorkRequests(result.online_work_requests || []);
        setStats((prev: StatsType) => ({
          ...prev,
          total_approved: result.total_approved || 0,
        }));
      };

      const result = await (approvalService as any).getAllApprovedRequests(
        monthParams(),
        (loaded: number, total: number | null) => { if (!signal?.aborted) setFetchProgress({ loaded, total }); },
        applyApprovedResult,
        signal
      );
      applyApprovedResult(result);
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return;
      console.error('Error fetching approved requests:', error);
    }
  };

  const fetchRejectedRequests = async (signal?: AbortSignal) => {
    try {
      const applyRejectedResult = (result: any) => {
        if (signal?.aborted) return;
        setRejectedExplanations(result.attendance_explanations);
        setRejectedRegistrations(result.registration_requests || []);
        setRejectedLeaveRequests(result.leave_requests || []);
        setRejectedOvertimeRequests(result.overtime_requests || []);
        setRejectedOnlineWorkRequests(result.online_work_requests || []);
        setStats((prev: StatsType) => ({
          ...prev,
          total_rejected: result.total_rejected || 0,
        }));
      };

      const result = await (approvalService as any).getAllRejectedRequests(
        monthParams(),
        (loaded: number, total: number | null) => { if (!signal?.aborted) setFetchProgress({ loaded, total }); },
        applyRejectedResult,
        signal
      );
      applyRejectedResult(result);
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return;
      console.error('Error fetching rejected requests:', error);
    }
  };

  const fetchWorkFinalizationData = async (empContext?: any, isAdminArg?: boolean, isHRArg?: boolean) => {
    try {
      const activeAdmin = isAdminArg !== undefined ? isAdminArg : isAdmin;
      const activeHR = isHRArg !== undefined ? isHRArg : isHR;

      const fetchMonth = async (m: number, y: number) => {
        try {
          const res = await workFinalizationApprovalService.list({ year: y, month: m });
          return res.results || [];
        } catch (err: any) {
          return [];
        }
      };

      const m0 = filterMonth;
      const y0 = filterYear;

      // Đầu tháng mới (ngày ≤ 15) mà đang xem đúng tháng hiện tại (chưa đổi
      // filter thủ công) → chốt công của tháng VỪA ĐÓNG thường vẫn còn đơn
      // PENDING, nên gộp thêm tháng liền trước để panel Chốt công tháng vẫn
      // hiện các đơn này mặc định — giữ nguyên hành vi cũ, dù initialMonth/
      // initialYear của trang giờ luôn là tháng hiện tại (không lùi tháng nữa,
      // xem giải thích ở khai báo initialMonth/initialYear phía trên).
      const todayForWf = new Date();
      const isEarlyInMonth = todayForWf.getDate() <= 15;
      const isViewingCurrentMonth =
        m0 === todayForWf.getMonth() + 1 && y0 === todayForWf.getFullYear();
      const monthsToFetch = [{ m: m0, y: y0 }];
      if (isEarlyInMonth && isViewingCurrentMonth) {
        monthsToFetch.push(
          m0 === 1 ? { m: 12, y: y0 - 1 } : { m: m0 - 1, y: y0 }
        );
      }

      const combined = (
        await Promise.all(monthsToFetch.map(({ m, y }) => fetchMonth(m, y)))
      ).flat();

      const uniqueMap = new Map();
      combined.forEach(item => uniqueMap.set(item.id, item));

      const pendingWfItems = Array.from(uniqueMap.values())
        .filter(item => {
          if (item.status === 'PENDING') return true;
          if (item.status === 'APPROVED') return activeAdmin || activeHR;
          return false;
        })
        .map(item => ({
          ...item,
          _itemType: 'WORK_FINALIZATION',
          employee_name: `Phòng ${item.department_name || item.department_code}`,
          employee_code: item.department_code,
          reason: item.note || `Chốt công tháng ${item.month}/${item.year}`
        }));

      setWorkFinalizationApprovals(pendingWfItems);

      // Also fetch all-status approvals for the attendance finalization panel
      try {
        const allResults = (
          await Promise.all(
            monthsToFetch.map(({ m, y }) =>
              attendanceFinalizationApprovalService
                .list({ year: y, month: m })
                .then((r: any) => r.results || [])
                .catch(() => [])
            )
          )
        ).flat();
        const allUniqueMap = new Map();
        allResults.forEach((item: any) => allUniqueMap.set(item.id, item));
        const allRes = { results: Array.from(allUniqueMap.values()) };
        const allItems = (allRes.results || []).map((item: any) => ({
          ...item,
          _itemType: 'WORK_FINALIZATION',
          _approvalSource: 'ATTENDANCE_FINALIZATION',
          employee_name: `Ph\u00f2ng ${item.department_name || item.department_code}`,
          employee_code: item.department_code,
          reason: item.note || `Ch\u1ed1t c\u00f4ng th\u00e1ng ${item.month}/${item.year}`,
        }));
        setAllWfApprovals(allItems);
      } catch {
        setAllWfApprovals([]);
      }
    } catch (error) {
      console.error('× [APPROVALS] Error fetching work finalization data:', error);
    }
  };

  const fetchAllData = async (force = false) => {
    const nowValue = Date.now();

    // Cancel any in-flight pagination loop
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    try {
      isFetchingRef.current = true;
      const prevFetchTime = lastFetchTimeRef.current;
      lastFetchTimeRef.current = nowValue;
      setLoading(true);
      setFetchProgress(null);

      const emp = await fetchCurrentEmployee();
      const currentIsAdmin = emp?.user?.is_superuser || (user as any)?.is_supperuser || (user as any)?.is_superuser || user?.role?.toUpperCase() === 'ADMIN';
      const currentIsHR = emp?.is_hr === true || user?.role?.toUpperCase() === 'HR';

      const tasks = [];

      // Only fetch the active tab to optimize performance
      if (activeTab === 'pending') {
        tasks.push(fetchPendingRequests(signal));
        // Work Finalization data is typically only shown/relevant in the Pending tab
        tasks.push(fetchWorkFinalizationData(emp, currentIsAdmin, currentIsHR));
      } else if (activeTab === 'approved') {
        tasks.push(fetchApprovedRequests(signal));
        // QLTT: tab "Đã duyệt" của họ KHÔNG chỉ gồm đơn status=APPROVED — nó
        // còn phải gộp các đơn họ đã duyệt nhưng HCNS chưa duyệt nốt (vẫn
        // status=PENDING), xem pickTabSources(). Những đơn đó nằm trong mảng
        // pending*, mà trước 2026-09-28 tab này KHÔNG tải pending -> nếu vào
        // thẳng/tải lại trang khi đang ở tab "Đã duyệt" thì chúng biến mất
        // khỏi CẢ HAI tab (Chờ duyệt đã lọc chúng đi vì việc của QLTT xong
        // rồi). Đổi tháng/năm tại tab này cũng để lại pending của tháng cũ.
        // QLTT báo "không nhìn thấy đủ đơn của cấp dưới"
        // — 23/26 đơn chờ duyệt của cấp dưới rơi đúng vào nhóm này.
        if (!currentIsAdmin && !currentIsHR) {
          tasks.push(fetchPendingRequests(signal));
        }
      } else if (activeTab === 'rejected') {
        tasks.push(fetchRejectedRequests(signal));
      }

      await Promise.all(tasks);

      if (signal.aborted) return;

      setLastRefreshedAt(new Date());
      // Chỉ hiện toast nếu là refresh thủ công/focus sau khi đã có dữ liệu (không hiện lần đầu)
      if (prevFetchTime > 0 && nowValue - prevFetchTime > 1000) {
        setShowRefreshToast(true);
        setTimeout(() => setShowRefreshToast(false), 3000);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return;
      console.error('❌ [APPROVALS] Error fetching all data:', error);
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setFetchProgress(null);
      }
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [activeTab, filterMonth, filterYear]);

  const EXPLANATION_TYPE_MAP: Record<string, string> = {
    explanation: 'Giải trình',
    registration: 'Đăng ký',
    LATE: 'Đi muộn',
    EARLY_LEAVE: 'Về sớm',
    LATE_EARLY: 'Đi muộn/Về sớm',
    INCOMPLETE_ATTENDANCE: 'Quên chấm công',
    BUSINESS_TRIP: 'Đi công tác',
    FIRST_DAY: 'Ngày đầu đi làm',
    OTHER: 'Giải trình khác',
    OVERTIME: 'Tăng ca',
    NIGHT_SHIFT: 'Trực tối',
    LIVE: 'Live stream',
    LEAVE: 'Nghỉ phép tháng',
    OFF_DUTY: 'Vào/Ra trực',
    UNAUTHORIZED_ABSENCE: 'Nghỉ không phép',
    SHIFT_CHANGE: 'Đổi ca',
    CA2: 'Đăng ký ca',
  };

  const getExplanationTypeLabel = (type: string): string => {
    if (!type) return '';
    const upperType = type.toUpperCase();
    return EXPLANATION_TYPE_MAP[upperType] || EXPLANATION_TYPE_MAP[type] || type;
  };

  // Mapping trạng thái chấm công sang tiếng Việt
  const ATTENDANCE_STATUS_MAP: Record<string, string> = {
    PRESENT: 'Có mặt',
    LATE: 'Đi muộn',
    EARLY_LEAVE: 'Về sớm',
    ABSENT: 'Vắng mặt',
    HALF_DAY: 'Nửa ngày',
    INCOMPLETE_ATTENDANCE: 'Quên chấm công',
    OFF: 'Nghỉ',
  };

  const EXPECTED_STATUS_MAP: Record<string, string> = {
    ...ATTENDANCE_STATUS_MAP,
    PRESENT: 'Tính đủ công',
    ABSENT: 'Vắng mặt',
    INCOMPLETE_ATTENDANCE: 'Xác nhận đủ công',
    HALF_DAY: 'Tính nửa ngày công',
  };

  const getOriginalStatusText = (status: string): string =>
    ATTENDANCE_STATUS_MAP[status] || status;

  const getExpectedStatusText = (status: string): string =>
    EXPECTED_STATUS_MAP[status] || status;

  // Returns icon path and color classes for each item type / registration sub-type
  const getItemTypeConfig = (item: any): { tableCls: string; mobileBg: string; iconPath: string } => {
    if (item._itemType === 'LEAVE') return {
      tableCls: 'bg-primary-50 text-primary-600 border-primary-100',
      mobileBg: 'bg-primary-500',
      iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    };
    if (item._itemType === 'OVERTIME') return {
      tableCls: 'bg-violet-50 text-violet-600 border-violet-100',
      mobileBg: 'bg-violet-500',
      iconPath: 'M13 10V3L4 14h7v7l9-11h-7z',
    };
    if (item._itemType === 'ONLINE_WORK') return {
      tableCls: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      mobileBg: 'bg-emerald-500',
      iconPath: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    };
    if (item._itemType === 'REGISTRATION') {
      // registration_type is the legacy field; event_type is returned by the unified API
      const regType = (item.registration_type || item.event_type || '').toUpperCase();
      switch (regType) {
        case 'OVERTIME':
          return { tableCls: 'bg-violet-50 text-violet-600 border-violet-100', mobileBg: 'bg-violet-500', iconPath: 'M13 10V3L4 14h7v7l9-11h-7z' };
        case 'NIGHT_SHIFT':
          return { tableCls: 'bg-primary-50 text-primary-600 border-primary-100', mobileBg: 'bg-primary-500', iconPath: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' };
        case 'LIVE':
          return { tableCls: 'bg-rose-50 text-rose-600 border-rose-100', mobileBg: 'bg-rose-500', iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' };
        case 'OFF_DUTY':
          return { tableCls: 'bg-amber-50 text-amber-600 border-amber-100', mobileBg: 'bg-amber-500', iconPath: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1' };
        case 'UNAUTHORIZED_ABSENCE':
          return { tableCls: 'bg-rose-50 text-rose-700 border-rose-200', mobileBg: 'bg-rose-700', iconPath: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' };
        case 'SHIFT_CHANGE':
          return { tableCls: 'bg-sky-50 text-sky-600 border-sky-100', mobileBg: 'bg-sky-500', iconPath: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' };
        case 'CA2':
          return { tableCls: 'bg-violet-50 text-violet-600 border-violet-100', mobileBg: 'bg-violet-500', iconPath: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' };
        default:
          return { tableCls: 'bg-primary-50 text-primary-600 border-primary-100', mobileBg: 'bg-primary-500', iconPath: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' };
      }
    }
    // EXPLANATION (default)
    return {
      tableCls: 'bg-amber-50 text-amber-600 border-amber-100',
      mobileBg: 'bg-amber-500',
      iconPath: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    };
  };

  const getRequestTypeLabel = (req: any): string => {
    let label = '';
    if (req._isCa2) label = `đăng ký ${caLabels(req).reg}`;
    else if (req._itemType === 'ONLINE_WORK') label = 'làm việc online';
    else if (req.explanation_type === 'LEAVE' || req._itemType === 'LEAVE') label = 'nghỉ phép tháng';
    else if (req._itemType === 'REGISTRATION' || req._itemType === 'OVERTIME') {
      // registration_type is the legacy field; event_type is returned by the unified API
      const type = req.registration_type || req.event_type || (req._itemType === 'OVERTIME' ? 'OVERTIME' : '');
      label = getExplanationTypeLabel(type) || 'Đăng ký';
    }
    else if (req._itemType === 'WORK_FINALIZATION') label = 'chốt công tháng';
    else {
      label = req.explanation_type_display || (req.explanation_type ? (getExplanationTypeLabel(req.explanation_level || req.explanation_type)) : 'Giải trình');
    }

    if (!label) return 'Đơn';
    // Đảm bảo viết hoa chữ cái đầu cho tiêu đề
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  /**
   * Phân loại "Nghỉ có lương" / "Nghỉ không lương" — hiển thị TRƯỚC loại nghỉ
   * cụ thể (Nghỉ phép tháng, Nghỉ không phép...) để người duyệt thấy ngay ảnh
   * hưởng lương mà không cần đoán qua tên loại đơn. "Nghỉ off tuần" không có
   * loại đơn riêng — nhân viên tạo bằng đúng đơn "Nghỉ không phép" hiện có,
   * nên cũng rơi vào nhóm "Nghỉ không lương" như mọi đơn nghỉ không phép khác.
   * Trả về null cho các loại đơn không phải nghỉ (tăng ca, live, làm online...).
   */
  const getLeavePayCategory = (req: any): 'PAID' | 'UNPAID' | null => {
    if (req.explanation_type === 'LEAVE' || req._itemType === 'LEAVE') return 'PAID';
    const type = (req.registration_type || req.event_type || '').toUpperCase();
    if (type === 'UNAUTHORIZED_ABSENCE') return 'UNPAID';
    return null;
  };

  const renderLeavePayCategoryBadge = (req: any) => {
    const category = getLeavePayCategory(req);
    if (!category) return null;
    const isPaid = category === 'PAID';
    return (
      <span
        className={`px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-tighter shrink-0 ${
          isPaid
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
            : 'bg-gray-100 text-gray-500 border border-gray-200'
        }`}
      >
        {isPaid ? 'Có lương' : 'Không lương'}
      </span>
    );
  };

  /**
   * Render badge hiển thị thống kê quota/số lần duyệt của nhân viên trong tháng
   */
  const renderRequestStatsBadge = (item: any) => {
    const isOnline = item._itemType === 'ONLINE_WORK';
    const isLeave = item._itemType === 'LEAVE';
    const isReg = item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME';

    if (isReg) return null; // Không hiện hạn mức cho đơn đăng ký/tăng ca

    // Đơn online rơi vào chiều T7 tuần 2/4 / Chủ nhật của phòng ban được miễn
    // (vd Kế toán) — không tính hạn mức, đừng hiện "Online 3/3" gây hiểu nhầm.
    if (isOnline && item.online_quota_amount === 0) {
      return (
        <div className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-xs font-bold tracking-tighter uppercase bg-emerald-50 text-emerald-600 border-emerald-100">
          Online · không tính hạn mức
        </div>
      );
    }

    // Thống kê từ backend (đã bọc trong item khi list)
    const qUsed = item.quota_used ?? 0;
    const mExp = item.max_explanation_quota ?? 3;
    const owUsed = item.online_work_used ?? 0;
    const mOnl = item.max_online_quota ?? 3;
    const lUsed = item.leave_used ?? 0;
    const mLea = item.max_leave_quota ?? 1;

    let used = 0;
    let max = 0;
    let label = '';

    if (isOnline) {
      used = owUsed;
      max = mOnl;
      label = 'Online';
    }
    else if (isLeave) {
      used = lUsed;
      max = mLea;
      label = 'Phép';
    }
    else {
      used = qUsed;
      max = mExp;
      label = 'Giải trình';
    }

    const ratio = max > 0 ? used / max : 0;

    // Premium color palette based on ratio
    const colors = ratio >= 1
      ? 'bg-rose-50 text-rose-600 border-rose-100'
      : ratio >= 0.7
        ? 'bg-amber-50 text-amber-600 border-amber-100'
        : 'bg-gray-50 text-gray-500 border-gray-100';

    return (
      <div className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-xs font-bold tracking-tighter uppercase transition-colors ${colors}`}>
        {label} {used}/{max}
      </div>
    );
  };

  /**
   * Làm sạch nội dung lý do: loại bỏ các prefixes lặp lại
   */
  const cleanReasonText = (rawReason: string, itemTypeLabel: string): string => {
    if (!rawReason) return '';
    let clean = rawReason.trim();

    // 0. Bóc các tiền tố trong ngoặc vuông [] (ví dụ: [Đi muộn: 5 phút])
    if (clean.startsWith('[')) {
      const closingBracketIndex = clean.indexOf(']');
      if (closingBracketIndex !== -1) {
        clean = clean.substring(closingBracketIndex + 1).replace(/^[\:\-\s]+/, '').trim();
      }
    }

    // Danh sách các tiền tố cần bóc tách
    const prefixes = [
      itemTypeLabel,
      itemTypeLabel.replace(/^Giải trình\s+/i, ''),
      itemTypeLabel.replace(/^Đăng ký\s+/i, ''),
      'Lý do:', 'Kế hoạch:', 'Nội dung:',
    ].filter(Boolean);

    // Sắp xếp theo chiều dài giảm dần để ưu tiên bóc chuỗi dài nhất trước
    prefixes.sort((a, b) => b.length - a.length);

    for (const p of prefixes) {
      if (p && clean.toLowerCase().startsWith(p.toLowerCase())) {
        // Tách bỏ prefix
        const temp = clean.substring(p.length).trim();
        // Xóa thêm các ký tự ngăn cách nếu có (: - )
        const afterStrip = temp.replace(/^[\:\-\s\.]+/i, '').trim();

        // Chỉ cập nhật nếu sau khi bóc vẫn còn nội dung (tránh bóc sạch trơn)
        if (afterStrip) {
          clean = afterStrip;
        }
        break;
      }
    }

    return clean;
  };

  // Kiểm tra xem người dùng hiện tại có quyền duyệt giải trình không
  const canApproveExplanation = (explanation: any): boolean => {
    if (!currentEmployee) return false;

    // Người tạo đơn không thể duyệt đơn của chính mình
    if (explanation.employee_id === currentEmployee.id) {
      return false;
    }

    // QUAN TRỌNG: Nếu người làm đơn là HR, chỉ quản lý trực tiếp mới được duyệt
    const employeeIsHR = explanation.employee_is_hr || false;

    // Kiểm tra quyền dựa trên vai trò và cấp bậc
    const isAdminUser =
      currentEmployee.user?.is_superuser || (user as any)?.is_supperuser || (user as any)?.is_superuser;
    // Chỉ dùng cờ is_hr
    const isHRUser = currentEmployee.is_hr === true;

    // Kiểm tra quyền can_approve_attendance từ permissions
    const hasApprovalPermission =
      currentEmployee.permissions?.can_approve_attendance || false;

    // Nếu người làm đơn là HR
    if (employeeIsHR) {
      // Admin vẫn có thể duyệt
      if (isAdminUser) {
        return true;
      }

      // Chỉ quản lý trực tiếp mới được duyệt (và chưa duyệt)
      if (explanation.employee_manager_id === currentEmployee.id) {
        return !explanation.direct_manager_approved;
      }

      // HR không được duyệt đơn của HR khác
      return false;
    }

    // Nếu người làm đơn KHÔNG phải HR
    // Kiểm tra nếu là quản lý trực tiếp (ƯU TIÊN TRƯỚC)
    if (explanation.employee_manager_id === currentEmployee.id) {
      // Nếu quản lý trực tiếp đã duyệt rồi thì không thể duyệt nữa
      if (explanation.direct_manager_approved) {
        return false;
      }
      return true;
    }

    // Admin, HR, và người có quyền can_approve_attendance có quyền duyệt
    if (isAdminUser || isHRUser || hasApprovalPermission) {
      // NẾU LÀ HR (hoặc có quyền tương đương) nhưng KHÔNG PHẢI QLTT
      // THÌ CHỈ ĐƯỢC DUYỆT KHI:
      // 1. Quản lý trực tiếp đã duyệt rồi (direct_manager_approved === true)
      // 2. HOẶC người tạo đơn là Senior Manager (employee_is_senior_manager === true)
      const directManagerAlreadyApproved =
        explanation.direct_manager_approved === true;
      const isCreatorSeniorManager =
        explanation.employee_is_senior_manager === true;

      if (directManagerAlreadyApproved || (isCreatorSeniorManager && !explanation.employee_manager_id)) {
        return true;
      }

      // Nếu chưa thỏa mãn các điều kiện trên, HR chưa được duyệt
      return false;
    }

    return false;

  };

  /**
   * Kiểm tra xem có thể xóa đơn không (Giải trình, Đăng ký, Online)
   * - Chỉ Admin/HR/Quản lý mới có quyền xóa đơn (kể cả đơn do chính họ tạo ra
   *   với tư cách nhân viên) — người tạo đơn thường (owner) không được tự xóa
   *   đơn của mình nữa, tránh việc nhân viên tự ý xóa đơn để né tránh xử lý.
   */
  const canDeleteRequest = (req: any): boolean => {
    if (!currentEmployee || !req) return false;

    // ── Đơn nghỉ phép / nghỉ không phép: QUẢN LÝ KHÔNG CÒN QUYỀN XOÁ ──────
    // HCNS siết từ 10/2026 cùng cơ chế phạt 500k: quản lý duyệt muộn chỉ cần
    // xoá đơn là biến lỗi "Duyệt đơn quá hạn" của mình thành "Nghỉ không tạo
    // đơn" của nhân viên. Backend chặn thật ở _cancel_single_event()
    // (registration_views) và AttendanceExplanationViewSet.cancel()
    // (taodon_views); đây chỉ là ẩn nút cho khớp, để không hiện nút rồi 403.
    // Backend còn chặn thêm: quá hạn duyệt thì KHÔNG AI xoá được, kể cả HCNS —
    // nên nếu có cờ can_delete từ backend thì cờ đó là tiếng nói cuối cùng.
    const ev = req.event_data || {};
    const reqType = String(
      req.registration_type || ev.registration_type || req.event_type || req._itemType || '',
    ).toUpperCase();
    const isLeaveLike =
      reqType === 'LEAVE' || reqType === 'UNAUTHORIZED_ABSENCE' || req._itemType === 'LEAVE';
    if (isLeaveLike) {
      if (typeof req.can_delete === 'boolean' && !req.can_delete) return false;
      if (typeof req.can_cancel === 'boolean' && !req.can_cancel) return false;
      if (isHR && activeTab === 'approved') return true;
      if (isAdmin && ['approved', 'pending', 'rejected'].includes(activeTab)) return true;
      return false;
    }

    // Nhân sự (HR) và Quản lý (Manager) được phép xóa ở tab "Đã duyệt" để xử lý các trường hợp duyệt nhầm
    if ((isHR || isManagement) && activeTab === 'approved') {
      return true;
    }

    // Admin giữ toàn quyền xóa ở cả 3 tab, kể cả tab "Từ chối" (VD: dọn rác đơn đã từ chối)
    if (isAdmin && (activeTab === 'approved' || activeTab === 'pending' || activeTab === 'rejected')) {
      return true;
    }

    return false;
  };

  /**
   * Hạn để QUẢN LÝ TRỰC TIẾP vào sửa giờ đơn tăng ca của nhân viên: 10h sáng
   * ngày lịch kế tiếp, riêng khi ngày đó là Chủ nhật thì tới hết ngày
   * (23:59:59) — PHẢI khớp đúng backend `manager_attendance_fix_deadline()`
   * ở hrm/deadline_utils.py, backend vẫn là chỗ chặn thật.
   */
  const getManagerFixDeadline = (dateStr?: string | null): Date | null => {
    if (!dateStr) return null;
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
    if (d.getDay() === 0) {            // Chủ nhật -> hết ngày
      d.setHours(23, 59, 59, 999);
    } else {
      d.setHours(10, 0, 0, 0);
    }
    return d;
  };

  /**
   * Quản lý trực tiếp (hoặc HCNS/Admin) có được sửa giờ đơn tăng ca Tại Viện/VP
   * này ngay trong tab "Chờ duyệt" không — yêu cầu HCNS 2026-09-23: ngày hôm
   * sau chưa có data máy chấm công nên QLTT phải tự review và sửa giờ cho nhân
   * viên, không chờ tới đợt đối soát cuối tháng. HCNS/Admin không bị giới hạn
   * thời gian, QLTT thì phải còn trong hạn (getManagerFixDeadline ở trên).
   */
  /** Đơn tăng ca Tại Viện/VP còn trong hạn QLTT được sửa giờ (10h sáng hôm
   *  sau, Chủ nhật tới hết ngày). Tách riêng vì dùng ở 2 chỗ: hiện nút "Sửa
   *  giờ", và giữ đơn lại trên màn hình QLTT sau khi họ đã duyệt (việc của họ
   *  chưa xong chừng nào còn hạn sửa). */
  const isOtWithinManagerFixWindow = (req: any): boolean => {
    if (!req) return false;
    const ev = req.event_data || {};
    const type = String(
      req.registration_type || ev.registration_type || req.event_type || req._itemType || '',
    ).toUpperCase();
    if (type !== 'OVERTIME') return false;
    if (String(req.ot_type || ev.ot_type || '').toUpperCase() !== 'ONSITE') return false;
    const deadline = getManagerFixDeadline(
      req.attendance_date || req.registration_date || req.event_date || req.start_date || req.date,
    );
    return !!deadline && new Date() <= deadline;
  };

  const canEditOvertimeHours = (req: any): boolean => {
    // Cho sửa ở CẢ tab "Chờ duyệt" lẫn "Đã duyệt" (yêu cầu HCNS 2026-09-23:
    // "nếu hnay tôi duyệt thì mai tôi là QLTT vẫn phải sửa lại được giờ vì có
    // thể nhân sự đó phát sinh việc hoặc làm ít hơn"). Vẫn bị chặn theo hạn
    // 10h sáng hôm sau như cũ; QLTT sửa đơn đã duyệt thì backend tự đưa đơn về
    // chờ HCNS duyệt lại (reset_approval_for_privileged_edit).
    if (!currentEmployee || !req) return false;
    if (activeTab !== 'pending' && activeTab !== 'approved') return false;
    // LƯU Ý: trang này lấy dữ liệu từ /api-hrm/duyet-don/ — endpoint đó KHÔNG
    // trả registration_type/ot_type ở cấp ngoài cùng (luôn null), mà để trong
    // event_data. Phải đọc cả 2 chỗ, nếu không nút sẽ không bao giờ hiện.
    const ev = req.event_data || {};
    const type = String(
      req.registration_type || ev.registration_type || req.event_type || req._itemType || '',
    ).toUpperCase();
    if (type !== 'OVERTIME') return false;
    if (String(req.ot_type || ev.ot_type || '').toUpperCase() !== 'ONSITE') return false;
    if (isAdmin || isHR) return true;
    const isDirectManager = req.employee_manager_id === currentEmployee.id;
    return isDirectManager && isOtWithinManagerFixWindow(req);
  };

  // Generic function to check if current user can approve any request type
  const canApproveRequest = (request: any): boolean => {
    if (!currentEmployee || !request) return false;

    // Ca 2: danh sách trả về từ pending-ca2-approvals ĐÃ được backend giới hạn
    // đúng người có quyền duyệt (QLTT của chính nhân viên đó, hoặc Admin/HR),
    // và API duyệt cũng kiểm tra lại lần nữa — nên ở đây chỉ cần xét còn chờ
    // duyệt và chưa quá hạn (Ca 2 phải duyệt trước 0h ngày áp dụng).
    if (request._isCa2) return request.status === 'PENDING' && !request.is_past_deadline;

    const isOnlineWork = request._itemType === 'ONLINE_WORK';
    const isRegistration = request._itemType === 'REGISTRATION' || request._itemType === 'OVERTIME';
    const isWorkFinalization = request._itemType === 'WORK_FINALIZATION';
    const isExplanation = !isOnlineWork && !isRegistration && !isWorkFinalization;

    if (isWorkFinalization) {
      // Ưu tiên cờ quyền từ backend vì một phòng có thể có nhiều quản lý trực tiếp
      if (typeof request.can_approve === 'boolean') {
        return request.can_approve;
      }

      // Fallback cho dữ liệu cũ chưa có can_approve
      const isAdminUser =
        currentEmployee.user?.is_superuser ||
        (user as any)?.is_supperuser ||
        (user as any)?.is_superuser;

      const myDeptCode = currentEmployee.department?.code ||
        currentEmployee.hrm_user?.department_code ||
        currentEmployee.employee_profile?.department_code;

      const isMyDept = request.department_code === myDeptCode;

      return isAdminUser || isMyDept;
    }

    // For explanations and leaves, use the dedicated logic
    if (isExplanation) {
      return canApproveExplanation(request);
    }

    // ==================== TWO-STEP WORKFLOW (ONLINE WORK / REGISTRATION) ====================
    // Creator cannot approve their own request
    if (request.employee_id === currentEmployee.id) {
      return false;
    }

    // Check user roles
    const isAdminUser = currentEmployee.user?.is_superuser || (user as any)?.is_supperuser || (user as any)?.is_superuser;
    // Chỉ dùng cờ is_hr
    const isHRUser = currentEmployee.is_hr === true;
    const isDirectManager = request.employee_manager_id === currentEmployee.id;
    const hasApprovalPermission = currentEmployee.permissions?.can_approve_attendance || false;

    // Nếu đã bị từ chối -> không thể duyệt
    if (request.direct_manager_rejected || request.hr_rejected || request.status === 'REJECTED') {
      return false;
    }

    if (isAdminUser) return !request.hr_approved;

    const requesterIsHR = request.employee_is_hr || request.is_hr || false;

    // Nếu người làm đơn là HR: chỉ 1 bước (QLTT duyệt là xong)
    if (requesterIsHR) {
      if (isDirectManager) return !request.direct_manager_approved;
      return false;
    }

    // Người làm đơn KHÔNG phải HR: bắt buộc 2 bước
    if (isDirectManager) {
      return !request.direct_manager_approved;
    }

    if (isHRUser || hasApprovalPermission) {
      // HR/Admin chỉ được duyệt SAU KHI QLTT đã duyệt (hoặc senior manager không có QLTT)
      if (request.direct_manager_approved === true || (request.employee_is_senior_manager && !request.employee_manager_id)) {
        return !request.hr_approved;
      }
    }



    return false;


  };

  // --- Triggers for Modals ---
  const openApproveModal = (item: any) => {
    setTargetItem(item);
    setActionType('APPROVE');
    setApprovalNote('Đã duyệt');
    setActionModalOpen(true);
  };

  const openRejectModal = (item: any) => {
    setTargetItem(item);
    setActionType('REJECT');
    setApprovalNote('Không hợp lệ');
    setActionModalOpen(true);
  };

  const openDeleteModal = (item: any) => {
    setTargetItem(item);
    setActionType('DELETE');
    setDeleteModalOpen(true);
  };

  const openOtEditModal = (item: any) => {
    setOtEditItem(item);
    setOtEditStart((item.start_time || '').substring(0, 5));
    setOtEditEnd((item.end_time || '').substring(0, 5));
  };

  /** Lưu giờ tăng ca QLTT/HCNS vừa sửa (tab Chờ duyệt). Số giờ để backend tự
   *  tính lại từ giờ vào/ra cho khớp đúng công thức lúc tạo đơn — không tự
   *  tính ở FE để tránh lệch cách làm tròn. */
  const submitOtEdit = async () => {
    if (!otEditItem) return;
    if (!otEditStart || !otEditEnd) {
      setErrorMessage('Vui lòng nhập đủ giờ vào và giờ ra.');
      setErrorModalOpen(true);
      return;
    }
    setOtEditSaving(true);
    try {
      await approvalService.updateRegistrationRequest(otEditItem.id, {
        start_time: otEditStart,
        end_time: otEditEnd,
      });
      setOtEditItem(null);
      await fetchAllData(true);
    } catch (error: any) {
      setErrorMessage(
        error?.response?.data?.error || 'Không sửa được giờ tăng ca. Vui lòng thử lại.',
      );
      setErrorModalOpen(true);
    } finally {
      setOtEditSaving(false);
    }
  };

  const isWorkFinalizationItem = (item: any): boolean => {
    if (!item) return false;
    if (item._itemType === 'WORK_FINALIZATION') return true;

    const hasApprovalShape =
      (typeof item.department_code === 'string' || item.department_code != null) &&
      Number.isInteger(Number(item.year)) &&
      Number.isInteger(Number(item.month)) &&
      ['PENDING', 'APPROVED', 'REJECTED'].includes(String(item.status || '').toUpperCase());

    return hasApprovalShape;
  };

  const getItemEmployeeId = (item: any): number | null => {
    const rawValue =
      item?.employee_id ??
      (typeof item?.employee === 'object' ? item.employee?.id : item?.employee);

    if (rawValue === undefined || rawValue === null || rawValue === '') return null;
    const employeeId = Number(rawValue);
    return Number.isNaN(employeeId) ? null : employeeId;
  };

  // Đơn nghỉ không phép nhiều ngày được gộp thành 1 dòng (_groupedIds chứa id của
  // TẤT CẢ các ngày trong nhóm) — duyệt/từ chối dòng này phải áp dụng cho mọi id.
  // Với mọi item khác (không gộp), _groupedIds không tồn tại → trả về đúng [item.id].
  const getRequestIds = (item: any): number[] =>
    Array.isArray(item?._groupedIds) && item._groupedIds.length > 0 ? item._groupedIds : [item?.id];

  const sortRequestsByCreatedAtDesc = (items: any[]) =>
    [...(items || [])].sort((a, b) => {
      const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });

  const replaceEmployeeItemsInList = (existing: any[], employeeId: number, incoming: any[]) => {
    const otherEmployees = (existing || []).filter(
      (entry) => getItemEmployeeId(entry) !== employeeId
    );
    return sortRequestsByCreatedAtDesc([...otherEmployees, ...(incoming || [])]);
  };

  const refreshAffectedEmployeeRequests = async (item: any) => {
    const employeeId = getItemEmployeeId(item);
    if (!employeeId) {
      applyLocalActionUpdate(item, actionType === 'APPROVE' ? 'APPROVE' : 'REJECT');
      return;
    }

    const scopedParams = {
      day: 0,
      month: filterMonth,
      year: filterYear,
      employee_id: employeeId,
    };

    const currentEmployeeStats = {
      pending_explanation: attendanceExplanations.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      pending_registration: pendingRegistrations.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      pending_leave: pendingLeaveRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      pending_overtime: pendingOvertimeRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      pending_online_work: pendingOnlineWorkRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      total_pending:
        attendanceExplanations.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        pendingRegistrations.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        pendingLeaveRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        pendingOvertimeRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        pendingOnlineWorkRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      total_approved:
        approvedExplanations.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        approvedRegistrations.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        approvedLeaveRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        approvedOvertimeRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        approvedOnlineWorkRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
      total_rejected:
        rejectedExplanations.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        rejectedRegistrations.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        rejectedLeaveRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        rejectedOvertimeRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length +
        rejectedOnlineWorkRequests.filter((entry) => getItemEmployeeId(entry) === employeeId).length,
    };

    try {
      const [pendingResult, approvedResult, rejectedResult] = await Promise.all([
        (approvalService as any).getAllPendingRequests(scopedParams),
        (approvalService as any).getAllApprovedRequests(scopedParams),
        (approvalService as any).getAllRejectedRequests(scopedParams),
      ]);

      setAttendanceExplanations((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, pendingResult.attendance_explanations || [])
      );
      setPendingRegistrations((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, pendingResult.registration_requests || [])
      );
      setPendingLeaveRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, pendingResult.leave_requests || [])
      );
      setPendingOvertimeRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, pendingResult.overtime_requests || [])
      );
      setPendingOnlineWorkRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, pendingResult.online_work_requests || [])
      );

      setApprovedExplanations((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, approvedResult.attendance_explanations || [])
      );
      setApprovedRegistrations((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, approvedResult.registration_requests || [])
      );
      setApprovedLeaveRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, approvedResult.leave_requests || [])
      );
      setApprovedOvertimeRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, approvedResult.overtime_requests || [])
      );
      setApprovedOnlineWorkRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, approvedResult.online_work_requests || [])
      );

      setRejectedExplanations((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, rejectedResult.attendance_explanations || [])
      );
      setRejectedRegistrations((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, rejectedResult.registration_requests || [])
      );
      setRejectedLeaveRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, rejectedResult.leave_requests || [])
      );
      setRejectedOvertimeRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, rejectedResult.overtime_requests || [])
      );
      setRejectedOnlineWorkRequests((prev) =>
        replaceEmployeeItemsInList(prev, employeeId, rejectedResult.online_work_requests || [])
      );

      const nextEmployeeStats = {
        pending_explanation: (pendingResult.attendance_explanations || []).length,
        pending_registration: (pendingResult.registration_requests || []).length,
        pending_leave: (pendingResult.leave_requests || []).length,
        pending_overtime: (pendingResult.overtime_requests || []).length,
        pending_online_work: (pendingResult.online_work_requests || []).length,
        total_pending:
          (pendingResult.total_pending || 0) +
          (pendingResult.overtime_requests || []).length,
        total_approved:
          (approvedResult.total_approved || 0) +
          (approvedResult.overtime_requests || []).length,
        total_rejected:
          (rejectedResult.total_rejected || 0) +
          (rejectedResult.overtime_requests || []).length,
      };

      setStats((prev) => ({
        ...prev,
        pending_explanation: Math.max(0, prev.pending_explanation - currentEmployeeStats.pending_explanation + nextEmployeeStats.pending_explanation),
        pending_registration: Math.max(0, prev.pending_registration - currentEmployeeStats.pending_registration + nextEmployeeStats.pending_registration),
        pending_leave: Math.max(0, prev.pending_leave - currentEmployeeStats.pending_leave + nextEmployeeStats.pending_leave),
        pending_overtime: Math.max(0, prev.pending_overtime - currentEmployeeStats.pending_overtime + nextEmployeeStats.pending_overtime),
        pending_online_work: Math.max(0, prev.pending_online_work - currentEmployeeStats.pending_online_work + nextEmployeeStats.pending_online_work),
        total_pending: Math.max(0, prev.total_pending - currentEmployeeStats.total_pending + nextEmployeeStats.total_pending),
        total_approved: Math.max(0, prev.total_approved - currentEmployeeStats.total_approved + nextEmployeeStats.total_approved),
        total_rejected: Math.max(0, prev.total_rejected - currentEmployeeStats.total_rejected + nextEmployeeStats.total_rejected),
      }));
    } catch (error) {
      console.error('Không thể tải lại dữ liệu theo nhân sự, dùng cập nhật cục bộ:', error);
      applyLocalActionUpdate(item, actionType === 'APPROVE' ? 'APPROVE' : 'REJECT');
    }
  };

  const applyLocalActionUpdate = (item: any, action: 'APPROVE' | 'REJECT') => {
    if (!item?.id) return;

    const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const withStatus = {
      ...item,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    // Với dòng gộp (đơn nghỉ không phép nhiều ngày), item.id chỉ là id của ngày đại
    // diện — phải xoá/thêm TẤT CẢ id trong nhóm (_groupedIds) để không bỏ sót các
    // ngày còn lại trong danh sách pending khi rơi vào nhánh fallback này (refetch lỗi).
    const groupedIds = getRequestIds(item);
    const removeById = (list: any[]) => (list || []).filter((entry) => !groupedIds.includes(entry.id));
    const upsertById = (list: any[], value: any) => {
      let base = list || [];
      for (const id of groupedIds) {
        const rowValue = { ...value, id };
        const index = base.findIndex((entry) => entry.id === id);
        if (index >= 0) {
          const clone = [...base];
          clone[index] = { ...clone[index], ...rowValue };
          base = clone;
        } else {
          base = [rowValue, ...base];
        }
      }
      return base;
    };

    const normalizeRegistrationType = (value: any) => String(value || '').toUpperCase();
    const isOvertimeRegistration =
      item._itemType === 'OVERTIME' ||
      normalizeRegistrationType(item.registration_type) === 'OVERTIME' ||
      normalizeRegistrationType(item.event_type) === 'OVERTIME';

    if (isWorkFinalizationItem(item)) {
      setWorkFinalizationApprovals((prev) => {
        if (nextStatus === 'REJECTED') {
          return removeById(prev);
        }
        return upsertById(prev, withStatus);
      });
      return;
    }

    if (item._itemType === 'ONLINE_WORK') {
      setPendingOnlineWorkRequests((prev) => removeById(prev));
      if (nextStatus === 'APPROVED') {
        setApprovedOnlineWorkRequests((prev) => upsertById(prev, withStatus));
      } else {
        setRejectedOnlineWorkRequests((prev) => upsertById(prev, withStatus));
      }
    } else if (item._itemType === 'LEAVE') {
      setPendingLeaveRequests((prev) => removeById(prev));
      if (nextStatus === 'APPROVED') {
        setApprovedLeaveRequests((prev) => upsertById(prev, withStatus));
      } else {
        setRejectedLeaveRequests((prev) => upsertById(prev, withStatus));
      }
    } else if (item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME') {
      if (isOvertimeRegistration) {
        setPendingOvertimeRequests((prev) => removeById(prev));
        if (nextStatus === 'APPROVED') {
          setApprovedOvertimeRequests((prev) => upsertById(prev, withStatus));
        } else {
          setRejectedOvertimeRequests((prev) => upsertById(prev, withStatus));
        }
      } else {
        setPendingRegistrations((prev) => removeById(prev));
        if (nextStatus === 'APPROVED') {
          setApprovedRegistrations((prev) => upsertById(prev, withStatus));
        } else {
          setRejectedRegistrations((prev) => upsertById(prev, withStatus));
        }
      }
    } else {
      setAttendanceExplanations((prev) => removeById(prev));
      if (nextStatus === 'APPROVED') {
        setApprovedExplanations((prev) => upsertById(prev, withStatus));
      } else {
        setRejectedExplanations((prev) => upsertById(prev, withStatus));
      }
    }

    setStats((prev) => {
      const next = { ...prev };
      next.total_pending = Math.max(0, (next.total_pending || 0) - 1);

      if (item._itemType === 'ONLINE_WORK') {
        next.pending_online_work = Math.max(0, (next.pending_online_work || 0) - 1);
      } else if (item._itemType === 'LEAVE') {
        next.pending_leave = Math.max(0, (next.pending_leave || 0) - 1);
      } else if (
        item._itemType === 'REGISTRATION' ||
        item._itemType === 'OVERTIME' ||
        isOvertimeRegistration
      ) {
        if (isOvertimeRegistration) {
          next.pending_overtime = Math.max(0, (next.pending_overtime || 0) - 1);
        } else {
          next.pending_registration = Math.max(0, (next.pending_registration || 0) - 1);
        }
      } else {
        next.pending_explanation = Math.max(0, (next.pending_explanation || 0) - 1);
      }

      if (nextStatus === 'APPROVED') {
        next.total_approved = (next.total_approved || 0) + 1;
      } else {
        next.total_rejected = (next.total_rejected || 0) + 1;
      }

      return next;
    });
  };

  // --- Confirm Actions (API Calls) ---
  const confirmAction = async () => {
    if (!targetItem) return;

    try {
      setIsProcessing(true);
      const isWorkFinalization = isWorkFinalizationItem(targetItem);
      const isRegistration = targetItem._itemType === 'REGISTRATION';
      const isOnlineWork = targetItem._itemType === 'ONLINE_WORK';
      const isExplanation = targetItem._itemType === 'EXPLANATION' || (!isRegistration && !isOnlineWork);
      const isApprove = actionType === 'APPROVE';

      const note = approvalNote || (isApprove ? 'Đã duyệt' : 'Đã từ chối');

      // Đơn nghỉ không phép nhiều ngày liên tiếp được gộp thành 1 dòng nhưng thực
      // chất là nhiều EmployeeEvent riêng (mỗi ngày 1 id) — duyệt/từ chối dòng gộp
      // phải áp dụng cho TẤT CẢ id trong nhóm. Với mọi item khác, getRequestIds trả
      // về đúng [targetItem.id] nên hành vi giữ nguyên y hệt trước đây.
      const registrationIds = getRequestIds(targetItem);

      // Đơn nghỉ không phép nhiều ngày có thể TRẢI QUA 2 THÁNG (vd 30/9–3/10),
      // trong khi danh sách trang này đã lọc theo tháng -> _groupedIds chỉ chứa
      // các ngày THUỘC THÁNG ĐANG XEM. Duyệt theo từng id như trước sẽ chỉ duyệt
      // phần ngày nhìn thấy, mấy ngày tháng sau vẫn treo PENDING mà không ai biết
      // (thực tế: QLTT duyệt ngày đầu
      // xong, các ngày sau treo lại; QLTT báo không thấy đơn).
      // Dùng endpoint approve_group/reject_group (backend gom theo request_code
      // nên bao trọn cả nhóm, không phụ thuộc bộ lọc tháng của FE) — đúng cách
      // AttendanceCalendar.tsx đang làm.
      const groupCode =
        String(targetItem.registration_type || targetItem.event_type || '').toUpperCase() === 'UNAUTHORIZED_ABSENCE'
          ? targetItem.request_code
          : null;

      if (isApprove) {
        if (targetItem._isCa2) {
          // Ca 2 nằm ở bảng ShiftRegistrationDay, KHÔNG phải EmployeeEvent nên
          // phải gọi đúng API riêng của nó (xem mapCa2ToRequestItem).
          await shiftRegistrationService.approveCa2(targetItem.id);
        } else if (isWorkFinalization) {
          await workFinalizationApprovalService.approve(targetItem.id, { note });
        } else if (isRegistration || targetItem._itemType === 'OVERTIME') {
          if (groupCode) await approvalService.approveRegistrationRequestGroup(groupCode, note);
          else await Promise.all(registrationIds.map(id => approvalService.approveRegistrationRequest(id, note)));
        } else if (isOnlineWork) {
          await approvalService.approveOnlineWorkRequest(targetItem.id, note);
        } else if (targetItem._itemType === 'LEAVE') {
          await approvalService.approveMonthlyLeaveRequest(targetItem.id, note);
        } else {
          await approvalService.approveAttendanceExplanation(targetItem.id, note);
        }
      } else {
        if (targetItem._isCa2) {
          await shiftRegistrationService.rejectCa2(targetItem.id, note);
        } else if (isWorkFinalization) {
          await workFinalizationApprovalService.reject(targetItem.id, { note });
        } else if (isRegistration || targetItem._itemType === 'OVERTIME') {
          if (groupCode) await approvalService.rejectRegistrationRequestGroup(groupCode, note);
          else await Promise.all(registrationIds.map(id => approvalService.rejectRegistrationRequest(id, note)));
        } else if (isOnlineWork) {
          await approvalService.rejectOnlineWorkRequest(targetItem.id, note);
        } else if (targetItem._itemType === 'LEAVE') {
          await approvalService.rejectMonthlyLeaveRequest(targetItem.id, note);
        } else {
          await approvalService.rejectAttendanceExplanation(targetItem.id, note);
        }
      }

      setActionModalOpen(false);
      const decidedItem = targetItem;
      setTargetItem(null);
      setApprovalNote('');
      if (decidedItem._isCa2) {
        // Ca 2 nằm ở nguồn dữ liệu khác nên refreshAffectedEmployeeRequests
        // (chỉ tải lại EmployeeEvent) không cập nhật được — phải tải lại riêng.
        await fetchPendingCa2();
      } else {
        await refreshAffectedEmployeeRequests(decidedItem);
      }
    } catch (error: any) {
      console.error(`Error ${actionType}:`, error);
      const data = error.response?.data;
      if (error.response?.status === 423 && data?.error === 'FINALIZATION_LOCKED') {
        setErrorMessage(data.message || 'Tháng này đã đóng chốt công. Không thể phê duyệt/từ chối. Vui lòng liên hệ HCNS để biết chi tiết.');
      } else if (data?.quota_exceeded) {
        let msg = data.error || 'Hết hạn mức';
        if (targetItem?._itemType === 'LEAVE') {
          const used = data.leave_used ?? '?';
          const max = data.max_leave ?? '?';
          const remaining = data.remaining ?? 0;
          msg = `Hết hạn mức nghỉ phép tháng này.\nĐã dùng: ${used}/${max} ngày — Còn lại: ${remaining} ngày.`;
        } else if (targetItem?._itemType === 'ONLINE_WORK') {
          const used = data.online_work_used ?? '?';
          const max = data.max_online ?? '?';
          const remaining = data.remaining ?? 0;
          msg = `Hết hạn mức làm việc online tháng này.\nĐã dùng: ${used}/${max} ngày — Còn lại: ${remaining} ngày.`;
        }
        setErrorMessage(msg);
      } else {
        setErrorMessage(data?.error || data?.detail || 'Thao tác thất bại');
      }
      setErrorModalOpen(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!targetItem) return;

    try {
      setIsProcessing(true);
      const isRegistration = targetItem._itemType === 'REGISTRATION';
      const isOnlineWork = targetItem._itemType === 'ONLINE_WORK';

      if (isOnlineWork) {
        await approvalService.cancelOnlineWorkRequest(targetItem.id);
      } else if (isRegistration || targetItem._itemType === 'OVERTIME') {
        // Dòng gộp (đơn nghỉ không phép nhiều ngày) → huỷ tất cả id trong nhóm
        await Promise.all(getRequestIds(targetItem).map(id => approvalService.cancelRegistrationRequest(id)));
      } else if (targetItem._itemType === 'LEAVE') {
        await attendanceService.cancelMonthlyLeaveRequest(targetItem.id);
      } else {
        await attendanceService.cancelAttendanceExplanation(targetItem.id);
      }

      setDeleteModalOpen(false);
      setTargetItem(null);
      fetchAllData(true);
    } catch (error: any) {
      console.error('Error deleting:', error);
      const msg = error.response?.data?.error || error.response?.data?.detail || 'Xóa thất bại';
      setErrorMessage(msg);
      setErrorModalOpen(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleViewOnlineWorkDetails = async (request: any) => {
    console.log('📂 [VIEW] Mở chi tiết đơn làm việc online');
    setSelectedOnlineWorkRequest(request);
    setSelectedExplanation(null);
    setShowDetailModal(true);
    try {
      const empId = request.employee_id || (typeof request.employee === 'object' ? request.employee.id : request.employee);
      if (empId) {
        const emp = await ensureEmployeeDetails(empId);
        if (emp) setSelectedOnlineWorkRequest((prev: any) => ({ ...(prev || {}), employee_name: emp.full_name || emp.ho_va_ten || emp.name, employee_code: emp.employee_code || emp.ma_nv || emp.code, position: emp.position || emp.vi_tri, department_name: emp.department_name || emp.phong_ban || emp.department }));
      }
    } catch (err) {
      console.error('Không thể tải nhân sự cho đơn làm việc online', err);
    }
  };

  const handleViewDetails = async (explanation: any) => {
    console.log('📂 [VIEW] Mở chi tiết đơn giải trình');
    setSelectedExplanation(explanation);
    setShowDetailModal(true);
    try {
      const empId = explanation.employee_id || (explanation.employee && typeof explanation.employee === 'object' ? explanation.employee.id : explanation.employee);
      if (empId) {
        const emp = await ensureEmployeeDetails(empId);
        if (emp) setSelectedExplanation((prev: any) => ({ ...(prev || {}), employee_name: emp.full_name || emp.ho_va_ten || emp.name, employee_code: emp.employee_code || emp.ma_nv || emp.code, position: emp.position || emp.vi_tri, department_name: emp.department_name || emp.phong_ban || emp.department, allowance: emp.phu_cap || emp.allowance }));
      }
    } catch (err) {
      console.error('Không thể tải nhân sự cho giải trình', err);
    }
  };

  const loadWfApprovalDetail = async (
    approvalId: number,
    openModal: boolean = false,
    source: 'WORK' | 'ATTENDANCE' = 'WORK'
  ) => {
    const service = source === 'ATTENDANCE'
      ? attendanceFinalizationApprovalService
      : workFinalizationApprovalService;
    const data = await service.get(approvalId);
    setSelectedWfApprovalSource(source);
    setSelectedWfApproval(data);
    if (source === 'WORK') {
      setWorkFinalizationApprovals((prev) =>
        (prev || []).map((item) => item.id === data.id ? { ...item, ...data } : item)
      );
    }
    const baseEmployees = data.employees || [];
    // Xóa cache cho các nhân sự trong danh sách để đảm bảo lấy dữ liệu mới nhất
    const employeeIds = baseEmployees.map((e: any) => e.employee_id || (typeof e.employee === 'object' ? e.employee?.id : e.employee)).filter(Boolean);
    setEmployeeCache(prev => {
      const updated = { ...prev };
      employeeIds.forEach((id: number) => { delete updated[id]; });
      return updated;
    });
    const enrichedEmployees = await enrichWorkFinalizationEmployees(baseEmployees);
    const approvalMonth = Number(data?.month);
    const approvalYear = Number(data?.year);
    const activeEmployees = enrichedEmployees.filter((emp: any) =>
      shouldKeepWorkFinalizationEmployee(emp, approvalMonth, approvalYear)
    );
    setWfEmployees(activeEmployees);
    setExpandedWfEmployees(() => {
      const initialExpanded: Record<string, boolean> = {};
      activeEmployees.slice(0, 2).forEach((emp: any, index: number) => {
        const key = String(
          emp.employee_id ||
          (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee) ||
          `idx-${index}`
        );
        initialExpanded[key] = true;
      });
      return initialExpanded;
    });
    if (openModal) setShowWfDetailModal(true);
    return data;
  };

  const handleViewWfDetails = async (approval: any) => {
    try {
      console.log('📂 [VIEW] Mở chi tiết chốt công:', approval.department_code);
      setLoading(true);
      await loadWfApprovalDetail(approval.id, true, 'WORK');
    } catch (error: any) {
      console.error("Lỗi khi lấy chi tiết chốt công:", error);
      setErrorMessage("Không thể tải danh sách nhân viên phòng ban này. Vui lòng thử lại.");
      setErrorModalOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleViewAttendanceWfDetails = async (approval: any) => {
    try {
      console.log('📂 [VIEW] Mở chi tiết chốt công nhân sự:', approval.department_code);
      setLoading(true);
      await loadWfApprovalDetail(approval.id, true, 'ATTENDANCE');
    } catch (error: any) {
      console.error("Lỗi khi lấy chi tiết chốt công:", error);
      setErrorMessage("Không thể tải danh sách nhân viên phòng ban này. Vui lòng thử lại.");
      setErrorModalOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleWfEmployeeDecision = async (employee: any, action: 'APPROVED' | 'REJECTED') => {
    if (!selectedWfApproval?.id) return;
    // Popup riêng của app thay cho window.prompt (trình duyệt nhúng trong app
    // thường không hiện hộp prompt nên trước đây bấm nút không có tác dụng).
    const isApprove = action === 'APPROVED';
    const note = await askNote({
      title: isApprove ? 'Duyệt chốt công nhân sự' : 'Từ chối chốt công nhân sự',
      message: [
        getWfValue(employee, ['ho_va_ten', 'employee_name', 'full_name', 'name'], ''),
        getWfValue(employee, ['ma_nv', 'employee_code', 'code'], ''),
      ].filter(Boolean).join(' · ') || undefined,
      label: isApprove ? 'Ghi chú duyệt (tuỳ chọn)' : 'Lý do từ chối',
      defaultValue: employee.individual_decision_note || '',
      required: !isApprove,
      confirmLabel: isApprove ? 'Duyệt' : 'Từ chối',
      variant: isApprove ? 'info' : 'warning',
    });
    if (note === null) return;

    try {
      setWfEmployeeActionLoadingId(employee.employee_id);
      const service = selectedWfApprovalSource === 'ATTENDANCE'
        ? attendanceFinalizationApprovalService
        : workFinalizationApprovalService;
      await service.decideEmployee(selectedWfApproval.id, employee.employee_id, {
        action,
        note: note.trim() || undefined,
      });
      await loadWfApprovalDetail(selectedWfApproval.id, false, selectedWfApprovalSource);
    } catch (error: any) {
      const msg = error?.response?.data?.error || 'Không thể cập nhật quyết định theo nhân sự.';
      setErrorMessage(msg);
      setErrorModalOpen(true);
    } finally {
      setWfEmployeeActionLoadingId(null);
    }
  };

  const handleWfApproveRemainingEmployees = async () => {
    if (!selectedWfApproval?.id) return;

    const pendingEmployees = (wfEmployees || []).filter((emp: any) => {
      if (emp.individual_decision === 'REJECTED') return false;
      if (isAdmin || isHR) return true;

      const managerId = Number(
        emp?.approval_manager_id ??
        emp?._employee_detail?.approval_manager_id ??
        emp?.manager_level_2_id ??
        emp?._employee_detail?.manager_level_2_id ??
        emp?.manager_id ??
        emp?._employee_detail?.manager_id ??
        emp?.manager?.id
      );
      const isSelf = Number(emp?.employee_id) === Number(currentEmployee.id);
      return !!currentEmployee?.id && (managerId === Number(currentEmployee.id) || isSelf);
    });

    if (pendingEmployees.length === 0) {
      setErrorMessage('Không còn nhân sự do bạn phụ trách phê duyệt.');
      setErrorModalOpen(true);
      return;
    }

    const confirmText = `Duyệt ${pendingEmployees.length} nhân sự do bạn phụ trách và giữ nguyên các nhân sự đã từ chối?`;
    if (!window.confirm(confirmText)) return;

    try {
      setWfBulkApproveLoading(true);
      const service = selectedWfApprovalSource === 'ATTENDANCE'
        ? attendanceFinalizationApprovalService
        : workFinalizationApprovalService;
      for (const emp of pendingEmployees) {
        await service.decideEmployee(selectedWfApproval.id, emp.employee_id, {
          action: 'APPROVED',
          note: emp.individual_decision_note || undefined,
        });
      }
      await loadWfApprovalDetail(selectedWfApproval.id, false, selectedWfApprovalSource);
    } catch (error: any) {
      const msg = error?.response?.data?.error || 'Không thể duyệt các nhân sự do bạn phụ trách còn lại.';
      setErrorMessage(msg);
      setErrorModalOpen(true);
    } finally {
      setWfBulkApproveLoading(false);
    }
  };

  const handlePrintWfApproval = async () => {
    if (!selectedWfApproval?.id) return;
    try {
      setWfPrintLoading(true);
      const service = selectedWfApprovalSource === 'ATTENDANCE'
        ? attendanceFinalizationApprovalService
        : workFinalizationApprovalService;
      const html = await service.getPrintableSheet(selectedWfApproval.id);
      const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900');
      if (!printWindow) {
        setErrorMessage('Trình duyệt đang chặn popup in. Vui lòng bật popup và thử lại.');
        setErrorModalOpen(true);
        return;
      }
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    } catch (error: any) {
      const msg = error?.response?.data?.error || 'Không thể tạo phiếu in ký xác nhận.';
      setErrorMessage(msg);
      setErrorModalOpen(true);
    } finally {
      setWfPrintLoading(false);
    }
  };

  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // --- Bulk Approval Handlers ---
  const handleBulkApproveItems = async (items: any[], groupName: string) => {
    // Chỉ lấy những đơn mà người dùng CÓ QUYỀN DUYỆT
    const approvableItems = items.filter(item => canApproveRequest(item));

    if (approvableItems.length === 0) {
      setErrorMessage(`Không có đơn nào trong ${groupName} đủ điều kiện để bạn duyệt nhanh.`);
      setErrorModalOpen(true);
      return;
    }

    // Các loại giải trình tính và quota
    const quotaSubjectTypes = ['LATE', 'EARLY_LEAVE', 'LATE_EARLY', 'INCOMPLETE_ATTENDANCE'];

    let approvalItems: any[] = [];
    let rejectionItems: any[] = [];

    const quotaItems: any[] = [];
    const leaveItems: any[] = [];
    const onlineWorkItems: any[] = [];
    const freeItems: any[] = [];

    approvableItems.forEach(item => {
      const isExplanation = item._itemType === 'EXPLANATION' || (item.explanation_type && item._itemType !== 'LEAVE' && item._itemType !== 'REGISTRATION');

      if (isExplanation && quotaSubjectTypes.includes(item.explanation_type)) {
        quotaItems.push(item);
      } else if (item._itemType === 'LEAVE' || item.explanation_type === 'LEAVE') {
        leaveItems.push(item);
      } else if (item._itemType === 'ONLINE_WORK') {
        onlineWorkItems.push(item);
      } else {
        freeItems.push(item);
      }
    });

    // Helper gom nhóm theo nhân viên + tháng
    const groupByEmpMonth = (list: any[]): Record<string, any[]> => {
      const groups: Record<string, any[]> = {};
      list.forEach(item => {
        const empId = Number(item.employee_id || (typeof item.employee === 'object' ? item.employee.id : item.employee));
        const dateStr = item.event_date || item.attendance_date || item.date || item.created_at;
        const d = new Date(dateStr);
        const key = `${empId}-${d.getFullYear()}-${d.getMonth() + 1}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      });
      return groups;
    };

    // 1. Đơn Giải trình — check quota (LATE, EARLY_LEAVE, LATE_EARLY, INCOMPLETE_ATTENDANCE)
    if (quotaItems.length > 0) {
      Object.entries(groupByEmpMonth(quotaItems)).forEach(([_key, group]) => {
        const defaultMax = Number(group[0]?.max_explanation_quota) || 3;
        const minRemaining = group.reduce((min, item) => {
          const rem = item.quota_remaining !== undefined ? Number(item.quota_remaining) : (Number(item.max_explanation_quota || 3) - Number(item.quota_used || 0));
          return Math.min(min, isNaN(rem) ? defaultMax : rem);
        }, defaultMax);

        const sortedGroup = [...group].sort((a, b) => {
          const isAForget = (a.explanation_type || '').toUpperCase() === 'INCOMPLETE_ATTENDANCE';
          const isBForget = (b.explanation_type || '').toUpperCase() === 'INCOMPLETE_ATTENDANCE';
          if (isAForget !== isBForget) return isAForget ? -1 : 1;
          const penaltyA = Number(a.penalty_amount) || 0;
          const penaltyB = Number(b.penalty_amount) || 0;
          if (penaltyA !== penaltyB) return penaltyB - penaltyA;
          // FCFS: đơn tạo sớm nhất được ưu tiên duyệt trước
          const tsA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tsB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tsA - tsB;
        });

        let currentRemaining = Math.max(0, minRemaining);
        sortedGroup.forEach(item => {
          const isForget = (item.explanation_type || '').toUpperCase() === 'INCOMPLETE_ATTENDANCE';
          if (isForget) {
            if (currentRemaining > 0) { approvalItems.push(item); currentRemaining--; }
            else { approvalItems.push({ ...item, is_penalty: true }); }
          } else {
            if (currentRemaining > 0) { approvalItems.push(item); currentRemaining--; }
            else { rejectionItems.push(item); }
          }
        });
      });
    }

    // 2. Đơn Nghỉ phép (LEAVE) — check quota từ item.max_leave_quota & item.leave_used
    if (leaveItems.length > 0) {
      Object.entries(groupByEmpMonth(leaveItems)).forEach(([_key, group]) => {
        const firstItem = group[0];
        const maxLeave = Number(firstItem.max_leave_quota ?? 1);
        const leaveUsed = Number(firstItem.leave_used ?? 0);
        let remaining = Math.max(0, maxLeave - leaveUsed);

        // FCFS: đơn tạo sớm nhất được ưu tiên duyệt trước
        const sorted = [...group].sort((a, b) => {
          const tsA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tsB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tsA - tsB;
        });

        sorted.forEach(item => {
          // Ưu tiên số ngày backend tính (0 với chiều T7 tuần 2/4 / Chủ nhật của
          // phòng được miễn); backend cũ chưa trả thì tự tính như trước.
          const amount = typeof item.online_quota_amount === 'number'
            ? item.online_quota_amount
            : (item.expected_status === 'HALF_DAY' ? 0.5 : 1.0);
          if (amount === 0 || remaining >= amount) {
            approvalItems.push(item);
            remaining -= amount;
          } else {
            rejectionItems.push(item);
          }
        });
      });
    }

    // 3. Đơn Online Work — check quota từ item.max_online_quota & item.online_work_used
    if (onlineWorkItems.length > 0) {
      Object.entries(groupByEmpMonth(onlineWorkItems)).forEach(([_key, group]) => {
        const firstItem = group[0];
        const maxOnline = Number(firstItem.max_online_quota ?? 3);
        const onlineUsed = Number(firstItem.online_work_used ?? 0);
        let remaining = Math.max(0, maxOnline - onlineUsed);

        // FCFS: đơn tạo sớm nhất được ưu tiên duyệt trước
        const sorted = [...group].sort((a, b) => {
          const tsA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tsB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tsA - tsB;
        });

        sorted.forEach(item => {
          // Ưu tiên số ngày backend tính (0 với chiều T7 tuần 2/4 / Chủ nhật của
          // phòng được miễn); backend cũ chưa trả thì tự tính như trước.
          const amount = typeof item.online_quota_amount === 'number'
            ? item.online_quota_amount
            : (item.expected_status === 'HALF_DAY' ? 0.5 : 1.0);
          if (amount === 0 || remaining >= amount) {
            approvalItems.push(item);
            remaining -= amount;
          } else {
            rejectionItems.push(item);
          }
        });
      });
    }

    // 4. Đơn tự do (Đăng ký OT, Live...) — approve hết, không tính quota
    approvalItems = [...approvalItems, ...freeItems];

    // Sort cả 2 danh sách theo FCFS (đơn gửi sớm nhất lên đầu)
    const fcfsSort = (a: any, b: any) => {
      const tsA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tsB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tsA - tsB;
    };
    approvalItems.sort(fcfsSort);
    rejectionItems.sort(fcfsSort);

    // Mở Modal xác nhận chi tiết
    setBulkConfirmModal({
      items: approvableItems,
      name: groupName,
      approvalItems,
      rejectionItems
    } as any);
  };

  const executeBulkApprove = async () => {
    if (!bulkConfirmModal) return;
    const { items: approvableItems, name: groupName } = bulkConfirmModal;
    const savedApprovalItems = (bulkConfirmModal as any).approvalItems || [];
    const savedRejectionItems = (bulkConfirmModal as any).rejectionItems || [];
    setBulkConfirmModal(null);

    try {
      setIsBulkProcessing(true);
      const note = 'Duyệt nhanh hàng loạt';

      const explanations = approvableItems.filter(i => i._itemType === 'EXPLANATION');
      const leaveRequests = approvableItems.filter(i => i._itemType === 'LEAVE');
      const registrations = approvableItems.filter(i => i._itemType === 'REGISTRATION' || i._itemType === 'OVERTIME');
      const onlineWorks = approvableItems.filter(i => i._itemType === 'ONLINE_WORK');

      // Tra ngược id backend -> nhãn hiển thị (tên NV + ngày) để hiện lý do lỗi
      // thật (vd quá hạn duyệt) theo ĐÚNG đơn — id có thể là 1 trong nhiều ngày
      // của 1 dòng gộp (đơn nghỉ không phép nhiều ngày), nên map qua getRequestIds.
      const idToLabel = new Map<number, string>();
      [...explanations, ...leaveRequests, ...registrations, ...onlineWorks].forEach((item: any) => {
        const label = `${item.employee_name || 'NV'} · ${getRequestTypeLabel(item)} · ${formatDate(item.attendance_date || item.start_date || item.work_date) || ''}`;
        getRequestIds(item).forEach(id => { if (id != null) idToLabel.set(id, label); });
      });

      const promises = [];
      if (explanations.length > 0) {
        // Sử dụng API Duyệt nhanh thông minh: BE tự tính toán quota và từ chối các đơn dư thừa
        promises.push(approvalService.smartBulkApproveAttendanceExplanations(explanations.map(i => i.id), note));
      }
      if (leaveRequests.length > 0) promises.push(approvalService.bulkApproveMonthlyLeaveRequests(leaveRequests.map(i => i.id), note));
      // registrations có thể chứa dòng gộp (đơn nghỉ không phép nhiều ngày) — flatMap
      // qua getRequestIds để duyệt đủ mọi ngày trong nhóm, không chỉ ngày đại diện.
      if (registrations.length > 0) promises.push(approvalService.bulkApproveRegistrationRequests(registrations.flatMap(getRequestIds), note));
      if (onlineWorks.length > 0) promises.push(approvalService.bulkApproveOnlineWorkRequests(onlineWorks.map(i => i.id), note));


      const results = await Promise.all(promises);
      let totalSuccess = 0;
      let totalError = 0;
      // Lý do lỗi THẬT từ backend cho từng đơn — trước đây bị bỏ qua, chỉ cộng
      // tổng số lỗi (xem comment ở khai báo bulkActionResult phía trên).
      const backendErrors: { id: number; label: string; error: string }[] = [];

      results.forEach(res => {
        totalSuccess += (res.success_count || 0);
        totalError += (res.error_count || 0);
        if (Array.isArray(res.errors)) {
          res.errors.forEach((e: { id: number; error: string }) => {
            backendErrors.push({ id: e.id, label: idToLabel.get(e.id) || `Đơn #${e.id}`, error: e.error });
          });
        }
      });

      const affectedEmployeeIds = Array.from(
        new Set(
          approvableItems
            .map((item: any) => getItemEmployeeId(item))
            .filter((employeeId): employeeId is number => employeeId !== null)
        )
      );

      // approvalItems/rejectionItems là DỰ TÍNH lúc mở modal xác nhận; đơn bị backend
      // chặn (vd quá hạn duyệt) không được duyệt/từ chối nên phải bỏ khỏi 2 danh sách
      // kết quả — nếu không, đơn quá hạn vừa hiện trong khối lỗi vừa nằm trong "Đã phê duyệt".
      const errorIds = new Set(backendErrors.map(e => e.id));
      const notBlocked = (item: any) => !getRequestIds(item).some(id => id != null && errorIds.has(id));

      // Hiển thị kết quả qua Modal thay vì alert
      setBulkActionResult({
        success: totalSuccess,
        error: totalError,
        groupName: groupName,
        approvalItems: savedApprovalItems.filter(notBlocked),
        rejectionItems: savedRejectionItems.filter(notBlocked),
        backendErrors,
      });

      if (affectedEmployeeIds.length === 1 && approvableItems.length > 0) {
        await refreshAffectedEmployeeRequests(approvableItems[0]);
      } else {
        fetchAllData(true);
      }
    } catch (error: any) {
      console.error(`Error bulk approving ${groupName}:`, error);
      const msg = error.response?.status === 423 && error.response?.data?.error === 'FINALIZATION_LOCKED'
        ? error.response.data.message || 'Tháng này đã đóng chốt công. Không thể phê duyệt. Vui lòng liên hệ HCNS để biết chi tiết.'
        : `Lỗi khi duyệt hàng loạt ${groupName}: ` + (error.response?.data?.error || error.message);
      setErrorMessage(msg);
      setErrorModalOpen(true);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  /**
   * @param deptKey  khoá đã kèm cấp duyệt ('L1::Phòng X') — cùng 1 phòng ban
   *                 xuất hiện ở cả dải Cấp 1 lẫn Cấp 2, dùng chung tên phòng
   *                 làm khoá sẽ khiến đóng bên này kéo theo bên kia.
   * @param isCurrentlyOpen  trạng thái ĐANG HIỂN THỊ, do nơi render truyền
   *                 vào. Trước đây hàm này tự suy đoán lại bằng 1 công thức
   *                 KHÁC công thức lúc render (thiếu vế `totalDepts <= 3`),
   *                 nên khi có trên 3 phòng ban thì 1 phòng đang đóng lại bị
   *                 coi là đang mở -> bấm lần đầu không có tác dụng gì.
   */
  const toggleDepartmentGroup = (deptKey: string, isCurrentlyOpen: boolean) => {
    if (isCurrentlyOpen) {
      setExpandedDepartments(prev => prev.filter(d => d !== deptKey));
      setCollapsedDepartments(prev => (prev.includes(deptKey) ? prev : [...prev, deptKey]));
    } else {
      setExpandedDepartments(prev => (prev.includes(deptKey) ? prev : [...prev, deptKey]));
      setCollapsedDepartments(prev => prev.filter(d => d !== deptKey));
    }
  };

  // mode: 'full' (badge + stepper, dùng ở bảng desktop) | 'badge' (chỉ badge)
  // | 'stepper' (chỉ stepper — card mobile đã có badge riêng ở đầu thẻ).
  const getStatusBadge = (item: any, onlyBadge?: boolean, mode: 'full' | 'stepper' = 'full') => {
    const status = item.status;
    const isApproved = status === 'APPROVED';
    const isRejected = status === 'REJECTED';
    const mgrApproved = item.direct_manager_approved || false;
    const hrApproved = item.hr_approved || (isApproved && !item.employee_is_hr);
    const isRequesterHR = item.employee_is_hr || false;

    // Xác định trạng thái từng bước
    const step1 = { label: 'QLTT', active: mgrApproved || isApproved, rejected: isRejected && !mgrApproved };
    const step2 = { label: 'Nhân sự', active: hrApproved || isApproved, rejected: isRejected && mgrApproved };

    if (onlyBadge) {
      return (
        <div className="flex items-center shrink-0">
          {isApproved ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 whitespace-nowrap">Hoàn tất</span>
          ) : isRejected ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 whitespace-nowrap">Từ chối</span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">Đang duyệt</span>
          )}
        </div>
      );
    }

    return (
      <div className={mode === 'stepper' ? 'flex items-center' : 'flex flex-col gap-2.5 min-w-[140px] group'}>
        {/* Main Status Badge */}
        {mode !== 'stepper' && (
        <div className="flex items-center">
          {isApproved ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">Hoàn tất</span>
          ) : isRejected ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">Từ chối</span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">Đang duyệt</span>
          )}
        </div>
        )}

        {/* Stepper Timeline UI */}
        <div className="flex items-center gap-0">
          {/* Step 1: Manager */}
          <div className="flex flex-col items-center relative">
            <div className={`z-10 w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all ${step1.rejected ? 'bg-red-500 border-red-100 text-white' :
              step1.active ? 'bg-emerald-500 border-emerald-100 text-white' :
                'bg-white border-gray-200 text-gray-400'
              }`}>
              {step1.rejected ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              ) : step1.active ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <span className="text-xs font-bold">1</span>
              )}
            </div>
            <span className={`text-xs font-medium mt-1 ${step1.active ? 'text-emerald-600' : step1.rejected ? 'text-red-600' : 'text-gray-400'}`}>QLTT</span>
          </div>

          {!isRequesterHR && (
            <>
              {/* Connecting Line */}
              <div className="flex-1 h-[2px] w-8 mx-0 mb-3.5 relative overflow-hidden bg-gray-100 -translate-y-0.5">
                <div className={`absolute inset-0 transition-transform duration-300 ${step1.active ? 'translate-x-0 bg-emerald-400' : '-translate-x-full'}`} />
              </div>

              {/* Step 2: HR */}
              <div className="flex flex-col items-center relative">
                <div className={`z-10 w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all ${step2.rejected ? 'bg-red-500 border-red-100 text-white' :
                  step2.active ? 'bg-emerald-500 border-emerald-100 text-white' :
                    'bg-white border-gray-200 text-gray-400'
                  }`}>
                  {step2.rejected ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                  ) : step2.active ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <span className="text-xs font-bold">2</span>
                  )}
                </div>
                <span className={`text-xs font-medium mt-1 ${step2.active ? 'text-emerald-600' : step2.rejected ? 'text-red-600' : 'text-gray-400'}`}>Nhân sự</span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };



  const getDayOfWeek = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    return days[date.getDay()];
  };

  const formatTimeOnly = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  /** "HH:MM · dd/MM" — dùng cho thẻ đơn trên mobile. formatDate() dùng
   *  toLocaleDateString('vi-VN') nên ra "23/9/2026" (tháng KHÔNG pad 0), cắt
   *  chuỗi sẽ hỏng, phải tự dựng. */
  const formatShortDateTime = (dateString: string) => {
    if (!dateString) return '';
    const dt = new Date(dateString);
    if (Number.isNaN(dt.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(dt.getHours())}:${p(dt.getMinutes())} · ${p(dt.getDate())}/${p(dt.getMonth() + 1)}`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('vi-VN');
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('vi-VN');
  };

  const getWfValue = (emp: any, keys: string[], fallback: any = '-') => {
    const sources = [emp, emp?._employee_detail, emp?._extra_info, emp?._salary_adjustments];

    for (const key of keys) {
      for (const source of sources) {
        const value = getNestedValue(source, key);
        if (value !== undefined && value !== null && value !== '') return value;
      }
    }
    return fallback;
  };

  const getWfEmploymentStatusNotes = (emp: any, fallback: any = '-') => {
    const detail = emp?._employee_detail;
    return (
      getWfValue(emp, ['employment_status_notes', 'ghi_chu_cong_viec', 'ghi_chu_trang_thai', 'status_note'], undefined) ??
      pickFirstAvailable(detail, ['employment_status_notes', 'ghi_chu_cong_viec', 'ghi_chu_trang_thai', 'status_note']) ??
      fallback
    );
  };

  const formatRankDisplay = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    const text = String(value).trim();
    if (!text) return '-';

    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    if (normalized === 'SUPERVISOR') return 'Quản lý';
    return text;
  };

  const toggleWorkNote = (noteKey: string) => {
    setExpandedWorkNotes((prev) => ({ ...prev, [noteKey]: !prev[noteKey] }));
  };

  const renderExpandableWorkNote = (
    noteValue: any,
    noteKey: string,
    options?: {
      maxWidthClass?: string;
      textClass?: string;
      buttonClass?: string;
      previewLength?: number;
    }
  ) => {
    const raw = noteValue === undefined || noteValue === null ? '' : String(noteValue).trim();
    if (!raw || raw === '-') return '-';

    const previewLength = options?.previewLength ?? 70;
    const isExpanded = !!expandedWorkNotes[noteKey];
    const isLong = raw.length > previewLength;
    const displayText = !isExpanded && isLong ? `${raw.slice(0, previewLength)}...` : raw;

    return (
      <div className={`${options?.maxWidthClass || 'max-w-[260px]'} whitespace-normal break-words leading-5`}>
        <span className={options?.textClass || ''}>{displayText}</span>
        {isLong ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleWorkNote(noteKey);
            }}
            className={options?.buttonClass || 'ml-1 inline text-primary-600 hover:text-primary-700 text-xs font-semibold'}
          >
            {isExpanded ? 'Thu gọn' : 'Xem thêm'}
          </button>
        ) : null}
      </div>
    );
  };

  const normalizeWorkToken = (value: any) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

  const toNumberOrUndefined = (value: any) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

    const text = String(value).trim();
    if (!text) return undefined;
    const normalized = text.replace(/,/g, '').replace(/\s/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const isOfficialForInsuranceDeduction = (params: {
    contractStatus?: any;
    employeeStatus?: any;
    workForm?: any;
  }) => {
    const contractStatus = normalizeWorkToken(params.contractStatus);
    const employeeStatus = normalizeWorkToken(params.employeeStatus);
    const workForm = normalizeWorkToken(params.workForm);

    const nonOfficialTokens = ['THU VIEC', 'PROBATION', 'INTERN', 'THUC TAP', 'TTS', 'COLLABORATOR', 'CONG TAC VIEN', 'CTV', 'CT TV', 'CTTV'];
    if (nonOfficialTokens.some((token) => contractStatus.includes(token) || employeeStatus.includes(token) || workForm.includes(token))) {
      return false;
    }

    const officialTokens = ['CHINH THUC', 'OFFICIAL', 'FULL TIME', 'PART TIME', 'CONTRACT', 'HOP DONG'];
    return officialTokens.some((token) => contractStatus.includes(token) || employeeStatus.includes(token) || workForm.includes(token));
  };

  const getWfSiDeduction = (emp: any, fallback: any = '-') => {
    const detail = emp?._employee_detail;
    if (!detail) {
      return getWfValue(emp, ['khau_tru_bhxh', 'si_deduction', 'bhxh', 'bhxh_deduction'], fallback);
    }

    const salaryAdjustments = detail.salary_adjustments || {};
    // Prioritize employee's social_insurance_contribution_level field over salary_adjustments config
    const insuranceSalaryBase =
      detail.social_insurance_contribution_level ??
      pickFirstAvailable(salaryAdjustments, [
        'payroll_config.taxPolicy.insuranceSalaryOverride',
        'payroll_config.tax_policy.insuranceSalaryOverride',
        'payroll_config.taxPolicy.insurance_salary_override',
        'payroll_config.tax_policy.insurance_salary_override',
        'insuranceSalaryOverride',
        'insurance_salary_override',
      ]) ?? undefined;
    const insuranceBaseNumber = toNumberOrUndefined(insuranceSalaryBase);

    if (
      insuranceBaseNumber !== undefined &&
      insuranceBaseNumber > 0 &&
      isOfficialForInsuranceDeduction({
        contractStatus: getWfValue(emp, ['cap_bac', 'contract_status'], detail.contract_status),
        employeeStatus: getWfValue(emp, ['tinh_trang', 'employee_status', 'status'], detail.employment_status),
        workForm: getWfValue(emp, ['hinh_thuc_lam_viec', 'work_form', 'work_type'], detail.work_form),
      })
    ) {
      const computed = Number((insuranceBaseNumber * 0.105).toFixed(2));
      return formatWfAllowance(computed);
    }

    return getWfValue(emp, ['khau_tru_bhxh', 'si_deduction', 'bhxh', 'bhxh_deduction'], fallback);
  };

  const getWfSalesPercentFromEmployee = (emp: any) => {
    const detail = emp?._employee_detail;
    if (!detail) return '-';
    return (
      pickFirstAvailable(detail, ['sales_percent']) ??
      pickFirstAvailable(detail, ['extra_info.sales_percent', 'extra_info.ty_le_doanh_so_huong']) ??
      pickFirstAvailable(detail, ['salary_adjustments.sales_percent', 'salary_adjustments.ty_le_doanh_so_huong']) ??
      '-'
    );
  };

  const getWfProfitPercentFromEmployee = (emp: any) => {
    const detail = emp?._employee_detail;
    if (!detail) return '-';
    return (
      pickFirstAvailable(detail, ['profit_percent']) ??
      pickFirstAvailable(detail, ['extra_info.profit_percent', 'extra_info.ty_le_loi_nhuan_huong']) ??
      pickFirstAvailable(detail, ['salary_adjustments.profit_percent', 'salary_adjustments.ty_le_loi_nhuan_huong']) ??
      '-'
    );
  };

  const formatWfDate = (value: any) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('vi-VN');
  };

  const formatWfPercent = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    const str = String(value);
    return str.includes('%') ? str : `${str}%`;
  };

  const formatProbationRateDisplay = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    const str = String(value);
    const mapped = PROBATION_RATE_OPTIONS.find((option) => option.value === str);
    if (mapped) return mapped.label;
    return str;
  };

  const formatWfAllowance = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    return `${num.toLocaleString('vi-VN')} VNĐ`;
  };

  const getDoctorTeamDisplay = (data: any) => {
    const team = getWfValue(data, ['doctor_team', 'team_doctor', 'bac_si_team'], '');
    if (team) return team;

    const main = getWfValue(data, ['bac_si_chinh', 'main_doctor', 'doctor_primary'], '');
    const assistant = getWfValue(data, ['bac_si_phu', 'assistant_doctor', 'doctor_secondary'], '');

    if (main && assistant) return `${main} / ${assistant}`;
    if (main) return main;
    if (assistant) return assistant;
    return '-';
  };

  const getRequestDisplayDate = (item: any) => (
    item.attendance_date ||
    item.registration_date ||
    item.work_date ||
    item.start_date ||
    item.date ||
    item.event_date ||
    item.created_at ||
    ''
  );

  const getRequestDateKey = (item: any) => {
    const rawDate = getRequestDisplayDate(item);
    if (!rawDate) return '';

    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateFilterLabel = (dateKey: string) => {
    if (!dateKey) return '';
    return formatDate(`${dateKey}T00:00:00`);
  };

  const getApprovalWorkflow = (explanation: any) => {
    const workflow = [];

    // Kiểm tra xem người làm đơn có phải HR không
    const employeeIsHR = explanation.employee_is_hr || false;
    let currentStep = 1;

    // Bước 1: Quản lý trực tiếp
    const hasManager =
      explanation.employee_manager_name &&
      explanation.employee_manager_name !== 'None';
    const managerApproved = explanation.direct_manager_approved || false;
    // LƯU Ý: Nếu trưởng phòng duyệt hoặc ai đó duyệt vòng 1 rồi thì managerApproved = true.
    // Nếu status = REJECTED mà chưa ai duyệt thì vòng 1 bị từ chối.
    const managerStatus = managerApproved
      ? 'Đã duyệt'
      : (explanation.status === 'REJECTED' && (explanation.rejection_level === 'DIRECT_MANAGER' || (!explanation.rejection_level && !explanation.hr_rejected_by_name)))
        ? 'Đã từ chối'
        : 'Chưa duyệt';

    // Ưu tiên hiển thị tên người đã duyệt thực tế. Nếu bị từ chối ở bước này thì dùng rejected_by_name.
    const actualManagerName =
      explanation.direct_manager_approved_by_name ||
      (managerStatus === 'Đã từ chối' ? explanation.rejected_by_name : null) ||
      explanation.employee_manager_name ||
      'Chưa xác định';

    workflow.push({
      step: currentStep++,
      role: 'Quản lý trực tiếp',
      approver: hasManager ? actualManagerName : 'Chưa xác định',
      status: managerStatus,
      date: explanation.direct_manager_approved_at || (managerStatus === 'Đã từ chối' ? explanation.rejected_at : null),
      note: explanation.approval_note || '',
    });



    // Bước 3: Nhân sự HR
    // CHỈ HIỂN THỊ bước HR nếu người làm đơn KHÔNG PHẢI HR
    // Nếu người làm đơn là HR, chỉ cần quản lý trực tiếp duyệt là đủ
    if (!employeeIsHR) {
      const hrStatus = explanation.hr_approved
        ? 'Đã duyệt'
        : (explanation.status === 'REJECTED' && (explanation.hr_rejected_by_name || explanation.rejection_level === 'HR' || managerApproved))
          ? 'Đã từ chối'
          : 'Chưa duyệt';

      const hrApproverName = hrStatus === 'Đã duyệt'
        ? (explanation.hr_approved_by_name || 'Nhân sự HR')
        : hrStatus === 'Đã từ chối'
          ? (explanation.hr_rejected_by_name ||
            explanation.rejected_by_name ||
            explanation.approved_by_name ||
            'Nhân sự HR')
          : 'Nhân sự HR'; // Chưa duyệt

      workflow.push({
        step: currentStep++,
        role: 'Nhân sự HR',
        approver: hrApproverName,
        status: hrStatus,
        date: explanation.hr_approved_at || (hrStatus === 'Đã từ chối' ? explanation.rejected_at : null),
        note: explanation.approval_note || '',
        approved_by: explanation.hr_approved_by_name || null,
      });
    }

    if (
      explanation.status === 'APPROVED' ||
      explanation.status === 'REJECTED'
    ) {
      const requestName = getRequestTypeLabel(explanation);
      const finalStatus =
        explanation.status === 'APPROVED'
          ? `${requestName} đã duyệt`
          : `${requestName} đã từ chối`;
      const finalApprover =
        explanation.status === 'REJECTED'
          ? (explanation.hr_rejected_by_name ||
            explanation.direct_manager_rejected_by_name ||
            explanation.rejected_by_name ||
            (explanation.rejection_level === 'HR' ? 'Nhân sự HR' : 'Hệ thống'))
          : (explanation.hr_approved_by_name ||
            explanation.approved_by_name ||
            explanation.direct_manager_approved_by_name ||
            'Chưa xác định');



      workflow.push({
        step: currentStep++,
        role: 'Kết quả cuối cùng',
        approver: finalApprover,
        status: finalStatus,
        date: explanation.approved_at || explanation.rejected_at || explanation.updated_at,
        note: explanation.approval_note || '',

      });
    }

    return workflow;
  };

  /**
   * Helper function cho timeline duyệt đơn làm việc online và đăng ký (2 bước)
   */
  const getOnlineWorkApprovalWorkflow = (request: any) => {
    const workflow = [];
    const employeeIsHR = request.employee_is_hr || false;
    // Registration requests have registration_type, online work requests have work_date mostly
    const isRegistration = !!request.registration_type;
    const requestName = isRegistration ? 'Đăng ký' : 'Làm việc online';
    let currentStep = 1;

    // Bước 1: Quản lý trực tiếp
    const managerStatus = request.direct_manager_approved
      ? 'Đã duyệt'
      : (request.status === 'REJECTED' && (request.rejection_level === 'DIRECT_MANAGER' || request.direct_manager_rejected || (!request.rejection_level && !request.hr_rejected_by_name)))
        ? 'Đã từ chối'
        : 'Chưa duyệt';

    const managerApproverName =
      request.direct_manager_approved_by_name ||
      request.direct_manager_rejected_by_name ||
      request.employee_manager_name ||
      'Chưa xác định';

    workflow.push({
      step: currentStep++,
      role: 'Quản lý trực tiếp',
      approver: managerApproverName,
      status: managerStatus,
      date:
        request.direct_manager_approved_at ||
        request.direct_manager_rejected_at ||
        null,
      note: request.direct_manager_note || '',
    });


    // Bước 3: Nhân sự HR
    if (!employeeIsHR) {
      const hrStatus = request.hr_approved
        ? 'Đã duyệt'
        : (request.status === 'REJECTED' && (request.hr_rejected_by_name || request.hr_rejected || request.rejection_level === 'HR' || request.direct_manager_approved))
          ? 'Đã từ chối'
          : 'Chưa duyệt';

      const hrApproverName =
        hrStatus === 'Đã duyệt'
          ? (request.hr_approved_by_name || 'Nhân sự HR')
          : hrStatus === 'Đã từ chối'
            ? (request.hr_rejected_by_name ||
              request.rejected_by_name ||
              request.approved_by_name ||
              'Nhân sự HR')
            : 'Nhân sự HR'; // Chưa duyệt

      workflow.push({
        step: currentStep++,
        role: 'Nhân sự HR',
        approver: hrApproverName,
        status: hrStatus,
        date: request.hr_approved_at || request.hr_rejected_at || null,
        note: request.hr_note || '',
      });
    }

    // Bước 4: Tổng hợp trạng thái cuối cùng
    if (request.status === 'APPROVED' || request.status === 'REJECTED') {
      const requestName = getRequestTypeLabel(request);
      const finalStatus =
        request.status === 'APPROVED'
          ? `${requestName} đã duyệt`
          : `${requestName} đã từ chối`;
      const finalApprover =
        request.hr_rejected_by_name ||
        (request.status === 'REJECTED' && request.rejected_by_name) ||
        request.direct_manager_rejected_by_name ||
        request.hr_approved_by_name ||
        request.direct_manager_approved_by_name ||
        request.approved_by_name ||
        (request.status === 'REJECTED' ? 'Hệ thống' : 'Chưa xác định');


      workflow.push({
        step: currentStep++,
        role: 'Kết quả cuối cùng',
        approver: finalApprover,
        status: finalStatus,
        date: request.approved_at || request.rejected_at || request.updated_at,
        note: request.approval_note || request.hr_note || request.direct_manager_note || '',

      });
    }

    return workflow;
  };
  const getCurrentTitle = () => {
    if (activeTab === 'pending') return 'Yêu cầu chờ duyệt';
    if (activeTab === 'approved') return 'Yêu cầu đã duyệt';
    return 'Yêu cầu đã từ chối';
  };

  const toggleFilter = (type: string) => {
    setFilterTypes(prev => {
      const isRemoving = prev.includes(type);
      const next = isRemoving ? prev.filter(t => t !== type) : [...prev, type];

      // Nếu bỏ chọn EXPLANATION, xóa luôn các sub-types
      if (isRemoving && type === 'EXPLANATION') {
        setFilterExplanationSubTypes([]);
      }
      // Nếu bỏ chọn REGISTRATION, xóa luôn các sub-types
      if (isRemoving && type === 'REGISTRATION') {
        setFilterRegistrationSubTypes([]);
      }
      return next;
    });
  };

  const toggleSubTypeFilter = (subType: string) => {
    setFilterExplanationSubTypes(prev =>
      prev.includes(subType) ? prev.filter(t => t !== subType) : [...prev, subType]
    );
  };

  const toggleRegSubTypeFilter = (subType: string) => {
    setFilterRegistrationSubTypes(prev =>
      prev.includes(subType) ? prev.filter(t => t !== subType) : [...prev, subType]
    );
  };

  const matchesTextFilters = (req: any) => {
    const name = (req.employee_name || '').toLowerCase();
    const dept = (req.employee_department || req.department_name || '').toLowerCase();
    const nameFilter = debouncedFilterName.toLowerCase();
    const deptFilter = filterDepartment.toLowerCase();

    if (debouncedFilterName && !name.includes(nameFilter) && !(req.employee_code || '').toLowerCase().includes(nameFilter)) return false;
    if (filterDepartment && !dept.includes(deptFilter)) return false;
    return true;
  };


  // Gộp các ngày thuộc cùng 1 "Đơn nghỉ không phép nhiều ngày liên tiếp" (chung
  // request_code) thành 1 dòng hiển thị duy
  // nhất trong danh sách duyệt, để QLTT/HR duyệt 1 lần cho cả khoảng ngày thay vì
  // phải duyệt từng ngày một. Đơn nghỉ không phép 1 ngày (không phải range) không bị
  // ảnh hưởng — vẫn hiển thị như cũ (_groupedIds chỉ có 1 phần tử).
  // confirmAction()/executeBulkApprove() đọc _groupedIds để áp dụng hành động cho
  // TẤT CẢ các ngày trong nhóm, không chỉ dòng đại diện.
  const groupUnauthorizedAbsenceRange = (items: any[]): any[] => {
    const groupsByCode = new Map<string, any>();
    const result: any[] = [];
    for (const item of items) {
      const type = String(item.registration_type || item.event_type || '').toUpperCase();
      const code = item.request_code;
      if (type === 'UNAUTHORIZED_ABSENCE' && code) {
        const existing = groupsByCode.get(code);
        if (existing) {
          existing._groupedIds.push(item.id);
          if (item.attendance_date && item.attendance_date < existing.attendance_date) {
            existing.attendance_date = item.attendance_date;
          }
          continue;
        }
        const grouped = { ...item, _groupedIds: [item.id] };
        groupsByCode.set(code, grouped);
        result.push(grouped);
        continue;
      }
      result.push(item);
    }
    return result;
  };

  // Áp toàn bộ filter hiện hành (tên, phòng ban, loại đơn, chỉ đơn của tôi, phân quyền xem)
  // lên 1 bộ dữ liệu (explanations/registrations/leave/overtime/online) bất kỳ, không phụ
  // thuộc activeTab — dùng chung cho cả danh sách hiển thị lẫn số đếm badge của từng tab.
  const buildFilteredCombinedList = (
    explanations: any[], registrations: any[], leaveRequests: any[], overtimeRequests: any[], onlineWorks: any[],
    ca2Items: any[] = [],
    // keepManagerApproved: GIỮ lại đơn QLTT đã duyệt (đang chờ HCNS) thay vì
    // lọc bỏ — dùng cho khối thu gọn "Bạn đã duyệt · đang chờ HCNS" ở tab
    // Chờ duyệt, xem memoizedManagerApprovedPending.
    opts: { keepManagerApproved?: boolean } = {}
  ) => {
    // 2. Map and filter
    const mappedExplanations = (explanations || [])
      .filter(matchesTextFilters)
      .map(e => ({ ...e, _itemType: 'EXPLANATION' }));

    const mappedRegistrations = groupUnauthorizedAbsenceRange(
      (registrations || [])
        .filter(matchesTextFilters)
        .map(r => ({ ...r, _itemType: 'REGISTRATION' }))
    );

    const mappedOnlineWorks = (onlineWorks || [])
      .filter(matchesTextFilters)
      .map(o => ({ ...o, _itemType: 'ONLINE_WORK' }));

    const mappedLeaves = (leaveRequests || [])
      .filter(matchesTextFilters)
      .map(l => ({ ...l, _itemType: 'LEAVE' }));

    const mappedOvertimes = (overtimeRequests || [])
      .filter(matchesTextFilters)
      .map(ov => ({
        ...ov,
        _itemType: 'REGISTRATION',
        registration_type: 'OVERTIME'
      }));

    // 3. Combine and filter by type (search bar filters)
    // Ca 2 đã được map sẵn ở mapCa2ToRequestItem, chỉ cần qua bộ lọc text
    // giống các loại khác rồi trộn vào chung.
    const mappedCa2 = (ca2Items || []).filter(matchesTextFilters);

    let all = [
      ...mappedExplanations,
      ...mappedRegistrations,
      ...mappedOnlineWorks,
      ...mappedLeaves,
      ...mappedOvertimes,
      ...mappedCa2
    ];

    // Đơn đã qua QLTT duyệt (đang chờ HCNS) là việc của HCNS/Admin — QLTT
    // thuần tuý không cần thấy nữa (yêu cầu HCNS 2026-09-23). Chỉ áp dụng ở
    // tab Chờ duyệt; tab Đã duyệt/Từ chối vẫn hiện đủ để họ tra cứu lại.
    if (activeTab === 'pending' && !isAdmin && !isHR && !opts.keepManagerApproved) {
      // Đơn đã qua QLTT thì ẩn khỏi Chờ duyệt (việc của HCNS), TRỪ đơn tăng
      // ca Tại Viện/VP còn trong hạn QLTT sửa giờ — với đơn này việc của QLTT
      // chưa xong: hôm sau họ vẫn phải review lại xem nhân viên có làm ít hơn
      // hay phát sinh gì không (yêu cầu HCNS 2026-09-23). Đơn đó đồng thời
      // cũng nằm ở tab "Đã duyệt" vì QLTT đã bấm duyệt rồi (xem pickTabSources).
      all = all.filter(item =>
        !item.direct_manager_approved || item._isCa2 || isOtWithinManagerFixWindow(item),
      );
    }

    if (filterOnlyMine) {
      all = all.filter(item => {
        const itemEmpId = item.employee_id || (typeof item.employee === 'object' ? item.employee?.id : item.employee);
        return itemEmpId === currentEmployee?.id;
      });
    }

    // Nếu không phải superadmin hoặc HR thật sự: chỉ hiển thị đơn của nhân viên mà mình là QLTT trực tiếp
    const isTrueSuperAdmin = (user as any)?.is_superuser || currentEmployee?.user?.is_superuser;
    const isTrueHR = currentEmployee?.is_hr === true || user?.role?.toUpperCase() === 'HR';

    if (!isTrueSuperAdmin && !isTrueHR && currentEmployee) {
      all = all.filter(item => {
        const itemEmpId = item.employee_id || (typeof item.employee === 'object' ? item.employee?.id : item.employee);
        const isMine = itemEmpId === currentEmployee.id;
        const isMyDirectReport = item.employee_manager_id === currentEmployee.id;
        return isMine || isMyDirectReport;
      });
    }

    // "Tôi là QLTT" — cho phép HR/Admin (vốn mặc định thấy toàn công ty ở
    // block trên) tự lọc riêng xuống đúng những đơn của cấp dưới trực tiếp
    // của chính họ, khi họ VỪA là quản lý VỪA có quyền HR/Admin. Phải khớp
    // CẢ 2: quản lý trực tiếp cá nhân (employee_manager_id, Employee.manager)
    // LẪN trưởng phòng ban (employee_department_manager_id, Department.manager)
    // — 1 người có thể là QLTT của cả phòng ban mà không đứng tên manager
    // riêng cho từng nhân viên trong đó, chỉ check employee_manager_id sẽ bị
    // sót đúng những phòng ban họ vừa duyệt đơn với tư cách trưởng phòng.
    if (filterOnlyMyDirectReports && currentEmployee) {
      all = all.filter(item =>
        item.employee_manager_id === currentEmployee.id ||
        item.employee_department_manager_id === currentEmployee.id
      );
    }

    if (filterTypes.length > 0) {
      all = all.filter(item => {
        if (filterTypes.includes('EXPLANATION') && item._itemType === 'EXPLANATION') {
          if (filterExplanationSubTypes.length > 0) {
            const type = (item.explanation_type || '').toUpperCase();
            return filterExplanationSubTypes.includes(type);
          }
          return true;
        }
        if (filterTypes.includes('REGISTRATION') && (item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME')) {
          if (filterRegistrationSubTypes.length > 0) {
            const type = (item.registration_type || item.event_type || item._itemType || '').toUpperCase();
            return filterRegistrationSubTypes.includes(type);
          }
          return true;
        }
        if (filterTypes.includes('ONLINE_WORK') && item._itemType === 'ONLINE_WORK') return true;
        if (filterTypes.includes('LEAVE') && item._itemType === 'LEAVE') return true;
        return false;
      });
    }

    return all;
  };

  /**
   * Chọn mảng dữ liệu nguồn theo tab.
   * QLTT (không phải HCNS/Admin): tab "Đã duyệt" phải gồm CẢ đơn họ đã duyệt
   * nhưng HCNS chưa duyệt (yêu cầu HCNS 2026-09-23) — những đơn này vẫn ở
   * trạng thái PENDING nên nằm trong mảng pending, phải gộp thêm vào. Với
   * HCNS/Admin thì "đã duyệt" vẫn là duyệt xong hẳn như cũ.
   */
  const pickTabSources = (tab: 'pending' | 'approved' | 'rejected'): any[][] => {
    const pending = [attendanceExplanations, pendingRegistrations, pendingLeaveRequests, pendingOvertimeRequests, pendingOnlineWorkRequests];
    const approved = [approvedExplanations, approvedRegistrations, approvedLeaveRequests, approvedOvertimeRequests, approvedOnlineWorkRequests];
    const rejected = [rejectedExplanations, rejectedRegistrations, rejectedLeaveRequests, rejectedOvertimeRequests, rejectedOnlineWorkRequests];
    if (tab === 'pending') return pending;
    if (tab === 'rejected') return rejected;
    if (isAdmin || isHR) return approved;
    // QLTT: tab "Đã duyệt" gộp thêm đơn họ đã duyệt nhưng HCNS chưa duyệt nốt
    // (vẫn PENDING). Mảng pending giờ KHÔNG còn lọc theo tháng (xem
    // fetchPendingRequests) nên phải lọc lại ở đây, nếu không tab này sẽ trộn
    // đơn của mọi tháng vào danh sách vốn đang hiển thị theo tháng đã chọn.
    const inSelectedMonth = (x: any): boolean => {
      const raw = x?.attendance_date || x?.start_date || x?.work_date || x?.event_date;
      if (filterMonth === MONTH_ALL) return true;
      const m = String(raw || '').match(/^(\d{4})-(\d{2})/);
      return !!m && Number(m[1]) === filterYear && Number(m[2]) === filterMonth;
    };
    return approved.map((arr, i) =>
      [...(arr || []), ...((pending[i] || []).filter((x: any) => x?.direct_manager_approved && inSelectedMonth(x)))]);
  };

  const memoizedGroupedRequests = useMemo(() => {
    // 1. Get base data based on active tab
    const [explanations, registrations, leaveRequests, overtimeRequests, onlineWorks] = pickTabSources(activeTab);

    const all = buildFilteredCombinedList(explanations, registrations, leaveRequests, overtimeRequests, onlineWorks, ca2ItemsForTab);

    // 4. Sort by created_at ascending (FCFS: đơn gửi trước hiện trước)
    const sorted = all.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateA - dateB;
    });

    // 5. Group by Department -> Position -> Employee for Accordion view
    const groups: Record<string, Record<string, Record<string, any[]>>> = {};
    sorted.forEach(item => {
      const itemEmpId = item.employee_id || (typeof item.employee === 'object' ? item.employee?.id : item.employee);
      const isMine = itemEmpId === currentEmployee?.id;

      const dept = isMine ? 'Đơn của Tôi' : (item.employee_department || item.department_name || 'Khác');
      const pos = item.employee_position || item.position_name || 'Nhân viên';
      const empName = item.employee_name || 'Không rõ';

      if (!groups[dept]) groups[dept] = {};
      if (!groups[dept][pos]) groups[dept][pos] = {};
      if (!groups[dept][pos][empName]) groups[dept][pos][empName] = [];
      groups[dept][pos][empName].push(item);
    });

    // Ensure "Đơn của Tôi" is first if it exists
    const finalGroups: Record<string, Record<string, Record<string, any[]>>> = {};
    if (groups['Đơn của Tôi']) {
      finalGroups['Đơn của Tôi'] = groups['Đơn của Tôi'];
    }

    Object.keys(groups).sort().forEach(dept => {
      if (dept !== 'Đơn của Tôi') {
        finalGroups[dept] = groups[dept];
      }
    });

    return finalGroups;
  }, [
    activeTab,
    attendanceExplanations, approvedExplanations, rejectedExplanations,
    pendingRegistrations, approvedRegistrations, rejectedRegistrations,
    pendingLeaveRequests, approvedLeaveRequests, rejectedLeaveRequests,
    pendingOvertimeRequests, approvedOvertimeRequests, rejectedOvertimeRequests,
    pendingOnlineWorkRequests, approvedOnlineWorkRequests, rejectedOnlineWorkRequests,
    ca2ItemsForTab,
    filterOnlyMine, filterOnlyMyDirectReports,
    filterTypes, filterExplanationSubTypes, filterRegistrationSubTypes,
    debouncedFilterName, filterDepartment,
    currentEmployee,
    user
  ]);

  // Gộp items thành cây Department -> Position -> Employee, y hệt logic trong
  // memoizedGroupedRequests ở trên — factor riêng để dùng lại cho việc tách Cấp 1/Cấp 2.
  const buildDeptPosEmpGroups = (items: any[]) => {
    const groups: Record<string, Record<string, Record<string, any[]>>> = {};
    items.forEach(item => {
      const itemEmpId = item.employee_id || (typeof item.employee === 'object' ? item.employee?.id : item.employee);
      const isMine = itemEmpId === currentEmployee?.id;
      const dept = isMine ? 'Đơn của Tôi' : (item.employee_department || item.department_name || 'Khác');
      const pos = item.employee_position || item.position_name || 'Nhân viên';
      const empName = item.employee_name || 'Không rõ';
      if (!groups[dept]) groups[dept] = {};
      if (!groups[dept][pos]) groups[dept][pos] = {};
      if (!groups[dept][pos][empName]) groups[dept][pos][empName] = [];
      groups[dept][pos][empName].push(item);
    });
    const finalGroups: Record<string, Record<string, Record<string, any[]>>> = {};
    if (groups['Đơn của Tôi']) finalGroups['Đơn của Tôi'] = groups['Đơn của Tôi'];
    Object.keys(groups).sort().forEach(dept => {
      if (dept !== 'Đơn của Tôi') finalGroups[dept] = groups[dept];
    });
    return finalGroups;
  };

  // Đơn QLTT ĐÃ duyệt nhưng HCNS chưa duyệt nốt. Chúng bị ẩn khỏi danh sách
  // "Chờ duyệt" (việc của QLTT xong rồi) và nằm ở tab "Đã duyệt" — đúng về
  // logic nhưng gây hiểu nhầm nặng: QLTT mở tab Chờ duyệt thấy gần như trống
  // rồi kết luận "không nhìn thấy đơn của cấp dưới" (thực tế
  // 23/29 đơn của cấp dưới rơi vào
  // nhóm này). Nay hiện lại ngay trong tab Chờ duyệt dưới 1 khối THU GỌN,
  // tách bạch với việc cần làm.
  const memoizedManagerApprovedPending = useMemo(() => {
    if (activeTab !== 'pending' || isAdmin || isHR) return null;
    const all = buildFilteredCombinedList(
      attendanceExplanations, pendingRegistrations, pendingLeaveRequests,
      pendingOvertimeRequests, pendingOnlineWorkRequests,
      pendingCa2.map(mapCa2ToRequestItem),
      { keepManagerApproved: true },
    ).filter((item: any) => item.direct_manager_approved && !item._isCa2);
    if (all.length === 0) return null;
    return { groups: buildDeptPosEmpGroups(all), count: all.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab, isAdmin, isHR,
    attendanceExplanations, pendingRegistrations, pendingLeaveRequests,
    pendingOvertimeRequests, pendingOnlineWorkRequests, pendingCa2,
    filterOnlyMine, filterOnlyMyDirectReports, filterTypes, filterExplanationSubTypes,
    filterRegistrationSubTypes, debouncedFilterName, filterDepartment, currentEmployee, user,
  ]);

  // Cấp 1 (direct_manager_approved chưa có -> đang chờ QLTT trực tiếp duyệt) vs Cấp 2
  // (direct_manager_approved đã có -> QLTT đã duyệt xong, đang chờ Nhân sự duyệt nốt).
  // Field direct_manager_approved có ở MỌI loại đơn hiện trong trang này (EXPLANATION,
  // LEAVE, ONLINE_WORK, REGISTRATION...) nên tách được đồng nhất, không cần biết loại đơn.
  //
  // Chỉ tách khi tab đang xem là "Chờ duyệt" VÀ người xem thực sự thấy CẢ 2 cấp cùng lúc
  // (vd vừa là QLTT trực tiếp của 1 số nhân viên, vừa có quyền HR/Admin nên thấy thêm đơn
  // cấp 2 của nhân viên khác không phải cấp dưới trực tiếp) — nếu chỉ thấy 1 cấp (QLTT
  // thuần tuý hoặc HR thuần tuý không quản lý ai) thì không cần chia, giữ giao diện như cũ.
  // Cờ "Mở khoá đặc biệt" (HCNS/Admin mở đột xuất ở Quản lý công) — để khi rà
  // soát hạn phân biệt được đơn quá hạn do mở đột xuất với đơn lọt hạn do lỗi.
  // Chỉ HR/Admin mới gọi được API này.
  const [deadlineExceptionFlags, setDeadlineExceptionFlags] = useState<Record<string, AppliedDeadlineException[]>>({});
  const fetchedFlagIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!(isAdmin || isHR)) return;
    const ids: number[] = [];
    Object.values(memoizedGroupedRequests).forEach((posGroups) =>
      Object.values(posGroups).forEach((empGroups) =>
        Object.values(empGroups).forEach((items) =>
          items.forEach((item: any) => {
            if (item._isCa2 || item._itemType === 'WORK_FINALIZATION') return;
            (item._groupedIds?.length ? item._groupedIds : [item.id]).forEach((id: number) => {
              if (typeof id === 'number' && !fetchedFlagIds.current.has(id)) ids.push(id);
            });
          }),
        ),
      ),
    );
    if (!ids.length) return;
    ids.forEach((id) => fetchedFlagIds.current.add(id));
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    chunks.forEach((chunk) => {
      deadlineExceptionService
        .forEvents(chunk)
        .then((flags) => setDeadlineExceptionFlags((prev) => ({ ...prev, ...flags })))
        .catch(() => chunk.forEach((id) => fetchedFlagIds.current.delete(id)));
    });
  }, [memoizedGroupedRequests, isAdmin, isHR]);

  const getDeadlineExceptionFlags = (item: any): AppliedDeadlineException[] => {
    if (!item || item._isCa2) return [];
    const seen = new Set<number>();
    const result: AppliedDeadlineException[] = [];
    (item._groupedIds?.length ? item._groupedIds : [item.id]).forEach((id: number) =>
      (deadlineExceptionFlags[String(id)] || []).forEach((g) => {
        if (!seen.has(g.id)) { seen.add(g.id); result.push(g); }
      }),
    );
    return result;
  };

  const memoizedApprovalLevelSplit = useMemo(() => {
    if (activeTab !== 'pending') return null;

    const all = buildFilteredCombinedList(
      attendanceExplanations, pendingRegistrations, pendingLeaveRequests, pendingOvertimeRequests, pendingOnlineWorkRequests,
      pendingCa2.map(mapCa2ToRequestItem)
    );
    const sorted = [...all].sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateA - dateB;
    });

    const level1Items = sorted.filter(item => !item.direct_manager_approved);
    // Cấp 2 = đơn đã qua QLTT, đang chờ HCNS duyệt -> việc của HCNS/Admin.
    // QLTT không thấy nữa vì phần việc của họ đã xong (yêu cầu HCNS
    // 2026-09-23: "để cho QLTT nhìn thấy cấp 1 thôi").
    const canSeeLevel2 = isAdmin || isHR;
    const level2Items = canSeeLevel2 ? sorted.filter(item => !!item.direct_manager_approved) : [];

    if (level1Items.length === 0 || level2Items.length === 0) return null;

    return {
      level1Groups: buildDeptPosEmpGroups(level1Items),
      level2Groups: buildDeptPosEmpGroups(level2Items),
      level1Count: level1Items.length,
      level2Count: level2Items.length,
    };
  }, [
    activeTab,
    attendanceExplanations, pendingRegistrations, pendingLeaveRequests, pendingOvertimeRequests, pendingOnlineWorkRequests,
    filterOnlyMine, filterOnlyMyDirectReports, filterTypes, filterExplanationSubTypes, filterRegistrationSubTypes,
    debouncedFilterName, filterDepartment,
    currentEmployee,
    user
  ]);

  // Số đếm badge của 3 tab (Chờ duyệt/Đã duyệt/Từ chối) — phải đi qua CÙNG bộ filter
  // (tên, phòng ban, loại đơn, chỉ đơn của tôi...) như danh sách hiển thị, nếu không sẽ bị
  // lệch số khi người dùng lọc theo phòng ban/tháng như báo cáo.
  const filteredPendingCount = useMemo(() => buildFilteredCombinedList(
    attendanceExplanations, pendingRegistrations, pendingLeaveRequests, pendingOvertimeRequests, pendingOnlineWorkRequests,
    pendingCa2.map(mapCa2ToRequestItem)
  ).length, [
    attendanceExplanations, pendingRegistrations, pendingLeaveRequests, pendingOvertimeRequests, pendingOnlineWorkRequests,
    filterOnlyMine, filterOnlyMyDirectReports, filterTypes, filterExplanationSubTypes, filterRegistrationSubTypes,
    debouncedFilterName, filterDepartment, currentEmployee, user,
    pendingCa2, approvedCa2, rejectedCa2
  ]);

  const filteredApprovedCount = useMemo(() => buildFilteredCombinedList(
    ...(pickTabSources('approved') as [any[], any[], any[], any[], any[]]),
    filterCa2ByMonth(approvedCa2).map(mapCa2ToRequestItem)
  ).length, [
    approvedExplanations, approvedRegistrations, approvedLeaveRequests, approvedOvertimeRequests, approvedOnlineWorkRequests,
    filterOnlyMine, filterOnlyMyDirectReports, filterTypes, filterExplanationSubTypes, filterRegistrationSubTypes,
    debouncedFilterName, filterDepartment, currentEmployee, user,
    pendingCa2, approvedCa2, rejectedCa2
  ]);

  const filteredRejectedCount = useMemo(() => buildFilteredCombinedList(
    rejectedExplanations, rejectedRegistrations, rejectedLeaveRequests, rejectedOvertimeRequests, rejectedOnlineWorkRequests,
    filterCa2ByMonth(rejectedCa2).map(mapCa2ToRequestItem)
  ).length, [
    rejectedExplanations, rejectedRegistrations, rejectedLeaveRequests, rejectedOvertimeRequests, rejectedOnlineWorkRequests,
    filterOnlyMine, filterOnlyMyDirectReports, filterTypes, filterExplanationSubTypes, filterRegistrationSubTypes,
    debouncedFilterName, filterDepartment, currentEmployee, user,
    pendingCa2, approvedCa2, rejectedCa2
  ]);

  const memoizedDisplayGroupedRequests = useMemo(() => {
    const visibleGroups: Record<string, Record<string, Record<string, any[]>>> = {};

    Object.entries(memoizedGroupedRequests).forEach(([deptName, posGroups]) => {
      const selectedDate = departmentDateFilters[deptName];
      const filteredPosGroups: Record<string, Record<string, any[]>> = {};

      Object.entries(posGroups).forEach(([posName, empGroups]) => {
        const filteredEmpGroups: Record<string, any[]> = {};

        Object.entries(empGroups).forEach(([empName, items]) => {
          const visibleItems = selectedDate
            ? items.filter((item) => getRequestDateKey(item) === selectedDate)
            : items;

          if (visibleItems.length > 0) {
            filteredEmpGroups[empName] = visibleItems;
          }
        });

        if (Object.keys(filteredEmpGroups).length > 0) {
          filteredPosGroups[posName] = filteredEmpGroups;
        }
      });

      if (Object.keys(filteredPosGroups).length > 0) {
        visibleGroups[deptName] = filteredPosGroups;
      }
    });

    return visibleGroups;
  }, [departmentDateFilters, memoizedGroupedRequests]);

  const getGroupedRequests = () => memoizedDisplayGroupedRequests;

  const getRawGroupedRequests = () => memoizedGroupedRequests;

  const getTotalCount = () => {
    const groups = getGroupedRequests();
    let count = 0;
    Object.values(groups).forEach(posGroup => {
      Object.values(posGroup).forEach(empGroup => {
        Object.values(empGroup).forEach(items => {
          count += items.length;
        });
      });
    });
    return count;
  };

  const getTabCount = (type: string) => {
    let requests: any[] = [];
    if (type === 'EXPLANATION') {
      requests = activeTab === 'pending' ? attendanceExplanations : activeTab === 'approved' ? approvedExplanations : rejectedExplanations;
    } else if (type === 'REGISTRATION') {
      const regs = activeTab === 'pending' ? pendingRegistrations : activeTab === 'approved' ? approvedRegistrations : rejectedRegistrations;
      const ots = activeTab === 'pending' ? pendingOvertimeRequests : activeTab === 'approved' ? approvedOvertimeRequests : rejectedOvertimeRequests;
      requests = [...regs, ...ots];
    } else if (type === 'LEAVE') {
      requests = activeTab === 'pending' ? pendingLeaveRequests : activeTab === 'approved' ? approvedLeaveRequests : rejectedLeaveRequests;
    } else if (type === 'ONLINE_WORK') {
      requests = activeTab === 'pending' ? pendingOnlineWorkRequests : activeTab === 'approved' ? approvedOnlineWorkRequests : rejectedOnlineWorkRequests;
    }

    let filtered = requests.filter(matchesTextFilters);
    if (filterOnlyMine) {
      filtered = filtered.filter(item => {
        const itemEmpId = item.employee_id || (typeof item.employee === 'object' ? item.employee?.id : item.employee);
        return itemEmpId === currentEmployee?.id;
      });
    }
    if (filterOnlyMyDirectReports) {
      filtered = filtered.filter(item =>
        item.employee_manager_id === currentEmployee?.id ||
        item.employee_department_manager_id === currentEmployee?.id
      );
    }
    return filtered.length;
  };


  // Đồng bộ với initialMonth/initialYear ở trên: mặc định/reset về đúng
  // tháng hiện tại, không lùi về tháng trước khi đang ở đầu tháng.
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const hasDepartmentDateFilter = Object.values(departmentDateFilters).some(Boolean);

  const hasActiveFilters = filterTypes.length > 0 || filterName !== '' || filterDepartment !== '' || filterOnlyMine || filterOnlyMyDirectReports
    // So với mặc định ĐÚNG của tab đang xem: Chờ duyệt mặc định "Tất cả",
    // 2 tab còn lại mặc định tháng hiện tại. Nếu so cứng với currentMonth thì
    // tab Chờ duyệt lúc nào cũng bị coi là "đang có bộ lọc".
    || filterMonth !== (activeTab === 'pending' ? MONTH_ALL : currentMonth)
    || (filterMonth !== MONTH_ALL && filterYear !== currentYear) || hasDepartmentDateFilter;

  const clearAllFilters = () => {
    setFilterTypes([]);
    setFilterExplanationSubTypes([]);
    setFilterRegistrationSubTypes([]);
    setFilterName('');
    setFilterDepartment('');
    setFilterOnlyMine(false);
    setFilterOnlyMyDirectReports(false);
    // Trả về mặc định ĐÚNG của từng nhóm tab, không phải luôn luôn tháng
    // hiện tại: tab Chờ duyệt mặc định "Tất cả".
    setPendingMonth(MONTH_ALL);
    setHistoryMonth(currentMonth);
    setFilterYear(currentYear);
    setDepartmentDateFilters({});
    setOpenDepartmentDateFilter(null);
  };

  const clearTypeFilters = () => {
    setFilterTypes([]);
    setFilterExplanationSubTypes([]);
    setFilterRegistrationSubTypes([]);
  };

  const getTotalFilteredCount = () => getTotalCount();

  // ── Cấu hình 2 nhóm tab (xem chú thích ở state `activeSection`) ──────────
  const REQUEST_TABS: {
    key: 'pending' | 'approved' | 'rejected';
    label: string; count: number; activeClass: string; badgeClass: string; icon: JSX.Element;
  }[] = [
    {
      key: 'pending', label: 'Chờ duyệt', count: filteredPendingCount,
      activeClass: 'border-primary-600 text-primary-600', badgeClass: 'bg-red-500',
      icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>),
    },
    {
      key: 'approved', label: 'Đã duyệt', count: filteredApprovedCount,
      activeClass: 'border-emerald-600 text-emerald-600', badgeClass: 'bg-emerald-500',
      icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>),
    },
    {
      key: 'rejected', label: 'Từ chối', count: filteredRejectedCount,
      activeClass: 'border-red-600 text-red-600', badgeClass: 'bg-amber-500',
      icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>),
    },
  ];

  // `visible`: tab chỉ hiện khi người xem thực sự có việc ở đó. Trước refactor
  // 2026-09-23 các khối này tự ẩn khi không có dữ liệu; khi chuyển thành tab
  // cố định thì AI CŨNG thấy tab (bấm vào chỉ là màn rỗng) — nhất là "Ca 2"
  // vốn chỉ liên quan tới quản lý nhóm có đăng ký ca theo ngày (CSKH).
  const SECTION_TABS: {
    key: 'work_finalization' | 'attendance_finalization';
    label: string; title: string; count: number; visible: boolean; icon: JSX.Element;
  }[] = [
    {
      key: 'work_finalization', label: 'Bảng công tháng',
      title: 'Duyệt bảng data nhân sự team (bảng công tháng)',
      count: visibleWorkFinalizationApprovals.filter((i: any) => i?.status === 'PENDING').length,
      visible: showWorkFinalizationPanel,
      icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>),
    },
    {
      key: 'attendance_finalization', label: 'Chốt công',
      title: 'Phê duyệt chốt công nhân sự tháng theo phòng ban',
      count: (allWfApprovals || []).filter((i: any) => i?.status === 'PENDING').length,
      visible: showAttendanceFinalizationPanel,
      icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>),
    },
  ];

  return (
    <div>
      {/* Cập nhật nhanh - Floating indicator */}
      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[60] transition-all duration-500 transform ${showRefreshToast ? 'translate-y-0 opacity-100' : '-translate-y-12 opacity-0 pointer-events-none'}`}>
        <div className="bg-gray-800 text-white px-4 py-2 rounded-lg shadow flex items-center gap-3">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <span className="text-xs font-medium">Đã cập nhật dữ liệu mới</span>
        </div>
      </div>

      {/* Header trang — gộp 3 lớp tiêu đề cũ (h1 "Phê duyệt" + đoạn mô tả +
          h2 "Yêu cầu chờ duyệt/Có N yêu cầu") làm 1 cho gọn, theo pattern
          MyRequests.tsx. */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Phê duyệt</h1>
          <p className="text-gray-500 text-sm mt-1">
            {activeSection === 'requests'
              ? `${getCurrentTitle()} · ${getTotalFilteredCount()} yêu cầu`
              : 'Duyệt đơn từ, bảng công tháng, chốt công và đăng ký ca của nhân viên'}
            {' · '}Cập nhật {lastRefreshedAt.toLocaleTimeString('vi-VN')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <button
            onClick={() => fetchAllData(true)}
            className="flex-1 sm:flex-none justify-center border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 flex items-center gap-2 text-sm font-medium"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            <span>Làm mới</span>
          </button>
          {/* Chỉ HCNS/Admin — HCNS chốt 2026-09-23 "giờ chỉ hcns mới có thể
              đối chiếu thôi" (trước đó QLTT cũng mở được modal này, xem đúng
              phạm vi cấp dưới của mình). Việc sửa giờ hằng ngày của QLTT đã có
              nút "Sửa giờ" ngay trong danh sách đơn. */}
          {(isAdmin || isHR) && (
            <button
              onClick={() => setShowOtReconciliationModal(true)}
              className="flex-1 sm:flex-none justify-center border border-indigo-200 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-md hover:bg-indigo-100 flex items-center gap-2 text-sm font-medium"
              title="So khớp giờ đăng ký tăng ca với dữ liệu máy chấm công (có dữ liệu sau khi upload chấm công cuối tháng)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Đối chiếu tăng ca</span>
            </button>
          )}
        </div>

        {/* Nút làm mới nổi trên mobile (nút duy nhất còn lại ngoài nút trên) */}
        <button
          onClick={() => fetchAllData(true)}
          className={`fixed bottom-6 right-6 sm:hidden z-50 w-14 h-14 bg-primary-600 text-white rounded-full shadow-lg flex items-center justify-center border-4 border-white transition-all active:scale-90 ${loading ? 'animate-pulse' : ''}`}
        >
          <svg className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
      </div>

      {/* Banner hạn chốt công */}
      <div className="mb-4">
        <FinalizationLockBanner year={filterYear} month={filterMonth} bypassRoles={['ADMIN', 'HR']} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {/* Thanh tab 2 nhóm — nhóm trái là 3 trạng thái duyệt đơn từ (giữ y
            như cũ), nhóm phải là 3 nghiệp vụ trước đây xếp chồng ngay trên
            danh sách đơn (bảng công tháng / chốt công / Ca 2). Badge số để
            không ai bỏ sót việc khi panel không còn tự hiện. */}
        {/* Mobile: cuộn ngang thay vì xuống dòng — 6 tab (3 trạng thái + 3
            nghiệp vụ) mà wrap thì vỡ thành 3 hàng trên máy điện thoại. */}
        <div className="flex items-center border-b border-gray-200 mb-5 overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible gap-y-1">
          {REQUEST_TABS.map((t) => {
            const isActive = activeSection === 'requests' && activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setActiveSection('requests'); setActiveTab(t.key); }}
                className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors ${
                  isActive ? t.activeClass : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
                {t.count > 0 && (
                  <span className={`ml-1 min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full text-xs font-bold text-white ${t.badgeClass}`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}

          <span className="mx-2 hidden h-6 w-px self-center bg-gray-200 sm:block" />

          {SECTION_TABS.filter((t) => t.visible || activeSection === t.key).map((t) => {
            const isActive = activeSection === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveSection(t.key)}
                title={t.title}
                className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors ${
                  isActive ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
                {t.count > 0 && (
                  <span className="ml-1 min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full text-xs font-bold bg-indigo-500 text-white">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Khu vực ĐƠN TỪ (3 tab trạng thái bên trái) — bộ lọc + danh sách.
            4 thẻ thống kê cũ ở đây đã bỏ: chúng hiện đúng cùng con số với 4
            chip lọc bên dưới mà lại không bấm được (HCNS duyệt bỏ 2026-09-23). */}
        {activeSection === 'requests' && (
        <>
        {/* Bộ lọc — gom về 1 hàng điều khiển + 2 hàng chip (2026-09-23).
            Bản cũ xếp 5 hàng rời nhau cao ~275px (mobile ~700px): nhãn có icon
            3x3 gần như vô hình, 2 khối sub-filter riêng mỗi khối 1 đường kẻ +
            tiêu đề, nút "Đơn của tôi" trôi sang tận mép phải. */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-6 space-y-3">
          {/* Hàng 1: các ô nhập/chọn */}
          <div className="flex flex-wrap items-end gap-3">
            {(isAdmin || isHR || isManagement) && (
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Tìm nhân viên</label>
                <div className="relative">
                  <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  <input
                    type="text"
                    value={filterName}
                    onChange={e => setFilterName(e.target.value)}
                    placeholder="Tên hoặc mã nhân viên..."
                    className="h-[42px] w-full pl-9 pr-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
                  />
                </div>
              </div>
            )}

            {(isAdmin || isHR) && (
              <div className="w-full sm:w-[220px]">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Phòng ban</label>
                <SelectBox
                  label=""
                  value={filterOnlyMyDirectReports ? MY_DIRECT_REPORTS_SENTINEL : filterDepartment}
                  options={deptOptions}
                  onChange={(v) => {
                    if (v === MY_DIRECT_REPORTS_SENTINEL) {
                      setFilterOnlyMyDirectReports(true);
                      setFilterDepartment('');
                    } else {
                      setFilterOnlyMyDirectReports(false);
                      setFilterDepartment(v);
                    }
                  }}
                  placeholder="Tất cả phòng ban"
                />
              </div>
            )}

            <div className="w-[120px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Tháng</label>
              <SelectBox
                label=""
                value={filterMonth.toString()}
                options={[
                  // "Tất cả" là mặc định của tab Chờ duyệt — xem khai báo
                  // pendingMonth/historyMonth.
                  { value: '0', label: 'Tất cả' },
                  ...Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: `Tháng ${i + 1}` })),
                ]}
                onChange={(val) => setFilterMonth(parseInt(val))}
              />
            </div>

            {/* Ô Năm LUÔN hiện, chỉ khoá lại khi đang chọn "Tất cả" (lúc đó
                năm không còn ý nghĩa). Trước đây ẩn hẳn -> chọn tháng là ô này
                hiện ra, đẩy các nút bên cạnh dịch chỗ. */}
            <div className="w-[100px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Năm</label>
              <SelectBox
                label=""
                value={filterYear.toString()}
                disabled={filterMonth === MONTH_ALL}
                options={Array.from({ length: 5 }, (_, i) => {
                  const y = 2026 + i;
                  return { value: y.toString(), label: y.toString() };
                })}
                onChange={(val) => setFilterYear(parseInt(val))}
              />
            </div>

            <button
              onClick={() => setFilterOnlyMine(!filterOnlyMine)}
              className={`h-[42px] flex items-center gap-2 px-3 rounded-lg text-sm font-medium border transition-colors ${filterOnlyMine
                ? 'bg-primary-600 text-white border-transparent'
                : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              Đơn của tôi
            </button>

            {/* LUÔN chiếm chỗ, chỉ mờ đi khi chưa lọc gì — trước đây ẩn/hiện
                theo hasActiveFilters nên vừa chọn bộ lọc là nút nhảy ra, xô
                lệch hàng nút. */}
            <button
              onClick={clearAllFilters}
              disabled={!hasActiveFilters}
              className={`h-[42px] ml-auto flex items-center gap-1.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                hasActiveFilters
                  ? 'text-gray-600 bg-white border-gray-200 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50'
                  : 'text-gray-300 bg-gray-50 border-gray-100 cursor-not-allowed'
              }`}
              title={hasActiveFilters ? 'Đặt lại toàn bộ bộ lọc về mặc định' : 'Chưa có bộ lọc nào đang bật'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Xoá lọc
            </button>
          </div>

          {/* Hàng 2: chip loại đơn */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-200/70">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-16 shrink-0">Loại đơn</span>
            {[
              { value: 'EXPLANATION', label: 'Giải trình', count: getTabCount('EXPLANATION'), color: 'amber' },
              { value: 'REGISTRATION', label: 'Đăng ký', count: getTabCount('REGISTRATION'), color: 'primary' },
              { value: 'LEAVE', label: 'Nghỉ phép tháng', count: getTabCount('LEAVE'), color: 'primary' },
              { value: 'ONLINE_WORK', label: 'Làm việc online', count: getTabCount('ONLINE_WORK'), color: 'emerald' },
            ].map(opt => {
              const isActive = filterTypes.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleFilter(opt.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    isActive ? TYPE_CHIP_STYLES[opt.color].active : TYPE_CHIP_STYLES[opt.color].idle
                  }`}
                >
                  {opt.label}
                  {opt.count > 0 && (
                    <span className={`px-1.5 rounded text-[11px] font-bold ${isActive ? 'bg-white/20 text-white' : TYPE_CHIP_STYLES[opt.color].badge}`}>
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Hàng 3: chip chi tiết — chỉ hiện khi đã chọn nhóm tương ứng.
              Gộp 2 khối sub-filter cũ, vẫn chọn nhiều như trước. */}
          {(filterTypes.includes('EXPLANATION') || filterTypes.includes('REGISTRATION')) && (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-200/70">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-16 shrink-0">Chi tiết</span>
              {filterTypes.includes('EXPLANATION') && EXPLANATION_SUB_TYPES.map((sub) => {
                const isSubActive = filterExplanationSubTypes.includes(sub.value);
                return (
                  <button
                    key={sub.value}
                    onClick={() => toggleSubTypeFilter(sub.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                      isSubActive
                        ? 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200'
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
              {filterTypes.includes('REGISTRATION') && REGISTRATION_SUB_TYPES.map((sub) => {
                const isSubActive = filterRegistrationSubTypes.includes(sub.value);
                return (
                  <button
                    key={sub.value}
                    onClick={() => toggleRegSubTypeFilter(sub.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                      isSubActive
                        ? 'bg-primary-50 text-primary-700 border-primary-300'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary-200'
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {loading && fetchProgress && (
            <div className="px-4 py-3 bg-primary-50 border border-primary-100 rounded-lg flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-primary-600 font-medium">
                <span>Đang tải dữ liệu...</span>
                <span>{fetchProgress.loaded}{fetchProgress.total ? ` / ${fetchProgress.total}` : ''} đơn</span>
              </div>
              {fetchProgress.total && (
                <div className="h-1.5 bg-primary-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (fetchProgress.loaded / fetchProgress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {loading && Object.keys(getGroupedRequests()).length === 0 ? (
            <div className="space-y-6">
              <SkeletonItem />
              <SkeletonItem />
            </div>
          ) : Object.keys(getGroupedRequests()).length === 0 ? (
            <div className="bg-white border rounded-lg overflow-hidden p-12 text-center shadow-sm">
              <div className="flex flex-col items-center justify-center">
                <svg
                  className="h-12 w-12 text-gray-400 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xl font-medium text-gray-900">
                  {activeTab === 'pending' ? 'Không có yêu cầu nào chờ duyệt' : 'Không có yêu cầu nào'}
                </p>
                <p className="text-gray-500 mt-1 text-base">
                  Tất cả yêu cầu đã được xử lý hoặc không tìm thấy kết quả phù hợp.
                </p>
                {hasActiveFilters && (
                  <button onClick={clearAllFilters} className="mt-4 text-primary-600 font-bold hover:underline text-base">
                    Xóa bộ lọc để xem tất cả
                  </button>
                )}
              </div>
            </div>
          ) : (() => {
            const rawGroupedRequests = getRawGroupedRequests();
            const groupedRequests = getGroupedRequests();
            const deptEntries = Object.entries(groupedRequests);
            const totalDepts = deptEntries.length;
            const approvalLevelSplit = memoizedApprovalLevelSplit;
            const managerApprovedPending = memoizedManagerApprovedPending;

            // `levelKey` tách khoá đóng/mở của 2 dải Cấp 1 / Cấp 2: cùng 1
            // phòng ban xuất hiện ở CẢ 2 dải, trước đây dùng chung deptName
            // làm khoá nên đóng phòng ở Cấp 1 là đóng luôn phòng đó ở Cấp 2.
            const renderDeptCard = (levelKey: string) => ([deptName, posGroups]: [string, any]) => {
              const deptKey = levelKey ? `${levelKey}::${deptName}` : deptName;
              // Mặc định mở sẵn khi danh sách ít (<= 3 phòng) thay vì chỉ khi
              // đúng 1 phòng như trước — trước đây cả 3 cấp đều đóng nên vào
              // trang KHÔNG thấy đơn nào, phải bấm 2 lần mới thấy dòng đầu tiên.
              // Người dùng vẫn đóng/mở tay được y như cũ.
              const isDeptExpanded =
                expandedDepartments.includes(deptKey)
                || (totalDepts <= 3 && !collapsedDepartments.includes(deptKey));
              const rawPosGroups = rawGroupedRequests[deptName] || posGroups;
              const activeDeptDate = departmentDateFilters[deptName] || '';
              const isDeptDateFilterOpen = openDepartmentDateFilter === deptKey;

              // Correctly flatten 3-level groups: posGroups -> empGroups -> items
              const allItemsInDept = Object.values(posGroups as Record<string, any>).reduce((acc: any[], empGroup: any) =>
                acc.concat(...Object.values(empGroup as Record<string, any>)), []
              );

              const rawItemsInDept = Object.values(rawPosGroups as Record<string, any>).reduce((acc: any[], empGroup: any) =>
                acc.concat(...Object.values(empGroup as Record<string, any>)), []
              );
              const deptItemCount = allItemsInDept.length;

              const availableDates = Array.from(new Set(rawItemsInDept.map((item: any) => getRequestDateKey(item)).filter(Boolean)))
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

              const pendingInDept = allItemsInDept.filter((r: any) => r.status === 'PENDING' && canApproveRequest(r)).length;

              return (
                <div key={deptName} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm mb-3">
                  {/* Department Header */}
                  <div className={`w-full flex items-center justify-between p-3 sm:p-4 ${deptName === 'Đơn của Tôi' ? 'bg-rose-50/80 border-rose-100' : 'bg-gray-50 border-gray-200'} border-b`}>
                    <button
                      onClick={() => toggleDepartmentGroup(deptKey, isDeptExpanded)}
                      className="flex items-center gap-2 sm:gap-3 text-left focus:outline-none flex-1 min-w-0"
                    >
                      <div className={`p-1.5 sm:p-2 rounded-lg ${isDeptExpanded ? 'bg-primary-600 text-white shadow-md' : 'bg-primary-50 text-primary-600'}`}>
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 overflow-hidden">
                        <h3 className="font-semibold text-gray-800 text-base truncate">{deptName}</h3>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {activeDeptDate ? `${allItemsInDept.length}/${rawItemsInDept.length}` : allItemsInDept.length} đơn
                          </span>
                          {activeDeptDate && (
                            <span className="text-xs font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded border border-primary-100">
                              {formatDateFilterLabel(activeDeptDate)}
                            </span>
                          )}
                          {pendingInDept > 0 && (activeTab === 'pending') && (
                            <span className="text-xs sm:text-sm font-semibold text-rose-600 flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                              {pendingInDept} mới
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* shrink-0 + nhãn rút gọn trên mobile: trước đây cụm 3 nút
                        này chiếm hết chiều ngang, tên phòng ban bị nuốt chỉ còn
                        1 mẩu icon (ảnh HCNS gửi 2026-09-23). */}
                    <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDepartmentDateFilter((prev) => prev === deptKey ? null : deptKey);
                        }}
                        className={`inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${activeDeptDate
                          ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        title={`Lọc đơn của phòng ${deptName} theo ngày`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <span className="hidden sm:inline">Lọc theo ngày</span>
                        <span className="sm:hidden">Ngày</span>
                      </button>

                      {hasBulkApprovePermission && activeTab === 'pending' && pendingInDept > 0 && (
                        <button
                          disabled={isBulkProcessing}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBulkApproveItems(allItemsInDept, `phòng ${deptName}`);
                          }}
                          className="flex items-center gap-1.5 h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                          title={`Duyệt nhanh tất cả đơn của phòng ${deptName}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          <span className="hidden sm:inline">Duyệt nhanh</span>
                          <span className="sm:hidden">Duyệt</span>
                        </button>
                      )}

                      <button
                        onClick={() => toggleDepartmentGroup(deptKey, isDeptExpanded)}
                        className={`p-2 hover:bg-gray-200 rounded-full transition-transform duration-300 ${isDeptExpanded ? 'rotate-180' : ''}`}
                      >
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                  </div>

                  {(isDeptDateFilterOpen || activeDeptDate) && (
                    <div className="px-3 sm:px-4 py-3 bg-white border-b border-gray-100">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Lọc đơn theo ngày trong phòng</div>
                            <div className="text-xs text-gray-400 mt-1">Chọn nhanh một ngày để gom toàn bộ đơn cần kiểm tra.</div>
                          </div>
                          {activeDeptDate && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDepartmentDateFilters((prev) => {
                                  const next = { ...prev };
                                  delete next[deptName];
                                  return next;
                                });
                                setOpenDepartmentDateFilter(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                              Bỏ lọc ngày
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDepartmentDateFilters((prev) => {
                                const next = { ...prev };
                                delete next[deptName];
                                return next;
                              });
                            }}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${!activeDeptDate
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-primary-200 hover:text-primary-600'
                              }`}
                          >
                            Tất cả ngày
                          </button>

                          {availableDates.map((dateKey) => {
                            const isActiveDate = activeDeptDate === dateKey;
                            return (
                              <button
                                key={dateKey}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDepartmentDateFilters((prev) => ({
                                    ...prev,
                                    [deptName]: dateKey
                                  }));
                                }}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${isActiveDate
                                  ? 'bg-primary-600 text-white border-primary-600'
                                  : 'bg-white text-gray-600 border-gray-200 hover:border-primary-200 hover:text-primary-600'
                                  }`}
                              >
                                {formatDateFilterLabel(dateKey)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Accordion Content - Positions */}
                  {isDeptExpanded && (
                    <div className="p-2 sm:p-4 space-y-6 bg-gray-50/30">
                      {Object.entries(posGroups as Record<string, any>).map(([posName, empGroups]: [string, any]) => {
                        const allItemsInPos = ([] as any[]).concat(...Object.values(empGroups as Record<string, any>));
                        const pendingInPos = allItemsInPos.filter((r: any) => r.status === 'PENDING' && canApproveRequest(r)).length;

                        return (
                          <div key={posName} className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-hidden border-l-4 border-l-primary-500">
                            {/* Position Sub-Header */}
                            {/* Mobile 2026-09-23: nút "Duyệt nhanh" không được co
                                phần chữ bên trái (min-w-0 + truncate + shrink-0),
                                nếu không trên điện thoại chữ "Vị trí: Điều dưỡng"
                                bị ép xuống dòng từng chữ một. Nút cũng rút gọn
                                nhãn trên màn hẹp. */}
                            <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-4 bg-gray-50/50 border-b border-gray-100">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 bg-primary-50 text-primary-600 rounded-lg shrink-0">
                                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-sm font-semibold text-gray-800 truncate">{posName}</h4>
                                  <span className="text-xs font-medium text-gray-400 whitespace-nowrap">
                                    {allItemsInPos.length} đơn đang xử lý
                                  </span>
                                </div>
                              </div>

                              {hasBulkApprovePermission && activeTab === 'pending' && pendingInPos > 0 && (
                                <button
                                  disabled={isBulkProcessing}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleBulkApproveItems(allItemsInPos, `vị trí ${posName}`);
                                  }}
                                  className="shrink-0 flex items-center gap-1.5 h-8 px-3 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white text-xs font-medium rounded-md border border-emerald-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                                  title={`Duyệt nhanh tất cả đơn của vị trí ${posName}`}
                                >
                                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                  <span className="hidden sm:inline">Duyệt nhanh {pendingInPos} đơn</span>
                                  <span className="sm:hidden">Duyệt {pendingInPos}</span>
                                </button>
                              )}
                            </div>

                            {/* New Level: Employee Accordion */}
                            <div className="p-4 space-y-4">
                              {Object.entries(empGroups as Record<string, any>).map(([empName, items]: [string, any[]]) => {
                                const accordionKey = `${deptKey}-${posName}-${empName}`;
                                // Mở sẵn nhân viên khi phòng đang mở và ít đơn
                                // (<= 10) — xem chú thích isDeptExpanded ở trên.
                                const isEmpExpanded =
                                  expandedEmployees.includes(accordionKey)
                                  || (isDeptExpanded
                                      && deptItemCount <= 10
                                      && !collapsedEmployees.includes(accordionKey));
                                const pendingInEmp = (items || []).filter((r: any) => r.status === 'PENDING' && canApproveRequest(r)).length;
                                const firstItem = items[0];

                                return (
                                  <div key={empName} className={`border rounded-lg overflow-hidden transition-colors ${isEmpExpanded ? 'border-primary-100 shadow-sm' : 'border-gray-100 hover:border-primary-200'}`}>
                                    {/* Employee Accordion Header */}
                                    <div
                                      className={`flex flex-col px-4 py-3 cursor-pointer transition-colors ${isEmpExpanded ? 'bg-primary-50/40' : 'bg-white hover:bg-gray-50'}`}
                                      onClick={async () => {
                                          const willExpand = !isEmpExpanded;
                                          if (willExpand) {
                                            setExpandedEmployees((prev: string[]) =>
                                              prev.includes(accordionKey) ? prev : [...prev, accordionKey]);
                                            setCollapsedEmployees((prev: string[]) => prev.filter(k => k !== accordionKey));
                                          } else {
                                            setExpandedEmployees((prev: string[]) => prev.filter(k => k !== accordionKey));
                                            setCollapsedEmployees((prev: string[]) =>
                                              prev.includes(accordionKey) ? prev : [...prev, accordionKey]);
                                          }
                                          if (willExpand && firstItem && (firstItem.employee_id || (firstItem.employee && typeof firstItem.employee === 'object' ? firstItem.employee.id : firstItem.employee))) {
                                            const empId = firstItem.employee_id || (firstItem.employee && typeof firstItem.employee === 'object' ? firstItem.employee.id : firstItem.employee);
                                            try { await ensureEmployeeDetails(empId); } catch (e) { /* ignore */ }
                                          }
                                        }}
                                    >
                                      {/* Row 1: Info and Actions */}
                                      {/* Mobile 2026-09-23: min-w-0 + truncate cho khối
                                          tên, nếu không "Test Điều Dưỡng 11" và "Mã
                                          nhân viên: TEST11" bị ép xuống dòng từng chữ.
                                          Badge vị trí bỏ trên mobile vì đã có ở tiêu đề
                                          cấp trên ngay phía trên; mã NV rút gọn còn mã. */}
                                      <div className="flex items-start justify-between w-full gap-2 min-w-0">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <div className="relative shrink-0">
                                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gray-700 flex items-center justify-center text-white text-xs font-semibold">
                                              {empName.charAt(0)}
                                            </div>
                                            {pendingInEmp > 0 && activeTab === 'pending' && (
                                              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-xs font-semibold flex items-center justify-center rounded-full border-2 border-white animate-pulse">
                                                {pendingInEmp}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <div className="text-sm sm:text-base font-semibold text-gray-800 leading-tight truncate">
                                                {empName}
                                              </div>
                                              <span className="hidden sm:inline shrink-0 px-2 py-0.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-semibold border border-primary-100 uppercase tracking-widest leading-none">
                                                {posName}
                                              </span>
                                            </div>
                                            <span className="mt-0.5 text-xs font-medium text-gray-400 truncate">
                                              {firstItem?.employee_code}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2.5 sm:gap-4 mt-0.5 sm:mt-0">
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const empId = firstItem.employee_id || (typeof firstItem.employee === 'object' ? firstItem.employee?.id : firstItem.employee);
                                                if (empId) {
                                                  setCalendarModalEmployee({ id: Number(empId), name: empName, month: filterMonth, year: filterYear });
                                                }
                                              }}
                                              className="flex items-center justify-center w-9 h-9 rounded-lg border border-primary-100 bg-white hover:bg-primary-50 text-primary-500 hover:text-primary-700 transition-all shadow-sm"
                                              title={`Xem lịch công của ${empName}`}
                                            >
                                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            </button>
                                          </div>
                                          <div className={`p-2 rounded-full transition-transform duration-500 ${isEmpExpanded ? 'rotate-180 bg-primary-100 text-primary-600' : 'bg-gray-50 text-gray-400'}`}>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Row 2: Hạn mức trong tháng. Mobile 2026-09-23:
                                          bỏ lưới 2x2 (chiếm gần nửa màn hình cho 4 ô
                                          thông tin phụ), đổi thành 1 hàng pill nhỏ. */}
                                      <div className="mt-2 w-full">
                                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full">
                                          {(() => {
                                            const empId = firstItem?.employee_id || (typeof firstItem?.employee === 'object' ? firstItem?.employee?.id : firstItem?.employee);

                                            const getMonthlyQuota = (type: string) => {
                                              const getAllTypedItems = () => {
                                                if (type === 'EXPLANATION') return [...attendanceExplanations, ...approvedExplanations, ...rejectedExplanations];
                                                if (type === 'LEAVE') return [...pendingLeaveRequests, ...approvedLeaveRequests];
                                                if (type === 'ONLINE_WORK') return [...pendingOnlineWorkRequests, ...approvedOnlineWorkRequests, ...rejectedOnlineWorkRequests];
                                                if (type === 'REGISTRATION') return [...pendingRegistrations, ...approvedRegistrations, ...pendingOvertimeRequests, ...approvedOvertimeRequests];
                                                return [];
                                              };

                                              const allOfThisType = getAllTypedItems().filter(i => {
                                                const iEmpId = i.employee_id || (typeof i.employee === 'object' ? i.employee?.id : i.employee);
                                                return iEmpId === empId;
                                              });

                                              if (allOfThisType.length === 0) return null;
                                              const itemWithQuota = allOfThisType.find(i => i.quota_used !== undefined);
                                              if (itemWithQuota && itemWithQuota.quota_used !== undefined) return itemWithQuota.quota_used;
                                              return allOfThisType.filter(i => (i.status === 'APPROVED' || i.hr_approved === true)).length;
                                            };

                                            const quotas = [
                                              { id: 'exp', label: 'Giải trình', value: getMonthlyQuota('EXPLANATION'), max: 3, color: 'amber', bg: 'bg-amber-50/70', text: 'text-amber-700', border: 'border-amber-200' },
                                              { id: 'leave', label: 'Nghỉ phép tháng', value: getMonthlyQuota('LEAVE'), max: 1, color: 'primary', bg: 'bg-primary-50/70', text: 'text-primary-700', border: 'border-primary-200' },
                                              { id: 'online', label: 'Làm việc online', value: getMonthlyQuota('ONLINE_WORK'), max: 3, color: 'emerald', bg: 'bg-emerald-50/70', text: 'text-emerald-700', border: 'border-emerald-200' },
                                              { id: 'reg', label: 'Đăng ký', value: getMonthlyQuota('REGISTRATION'), max: null, color: 'primary', bg: 'bg-primary-50/70', text: 'text-primary-700', border: 'border-primary-200' },
                                            ];

                                            return quotas.map(q => (
                                              <div key={q.id} className={`flex items-center gap-1 px-2 py-1 rounded-md border ${q.border} ${q.bg} shrink-0`}>
                                                <span className={`text-[10px] font-medium ${q.text} leading-none whitespace-nowrap`}>{q.label}</span>
                                                <span className={`text-[11px] font-bold ${q.text} leading-none whitespace-nowrap`}>
                                                  {q.value || 0}{q.max ? `/${q.max}` : ''}
                                                </span>
                                              </div>
                                            ));
                                          })()}
                                        </div>
                                      </div>
                                    </div>
                                    {/* Employee Accordion Content */}
                                    {isEmpExpanded && (
                                      <div className="bg-white">
                                        {/* Desktop Table */}
                                        <div className="hidden lg:block overflow-x-auto">
                                          <table className="min-w-full divide-y divide-gray-100">
                                            <thead className="bg-gray-50/50">
                                              <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Loại đơn & Lý do</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Thời gian</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chi tiết</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trạng thái</th>
                                                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-widest">Thao tác</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                              {items.map((item) => {
                                                const itemKey = `${item._itemType}-${item.id}`;
                                                const itemTypeConfig = getItemTypeConfig(item);
                                                return (
                                                  <tr key={itemKey} className="group hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4">
                                                      <div className="flex items-center gap-3">
                                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${itemTypeConfig.tableCls}`}>
                                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={itemTypeConfig.iconPath} /></svg>
                                                        </div>
                                                        <div>
                                                          <div className="flex items-center gap-1.5">
                                                            {renderLeavePayCategoryBadge(item)}
                                                            <div className="text-sm font-medium text-gray-900">{getRequestTypeLabel(item)}</div>
                                                            <DeadlineExceptionBadge grants={getDeadlineExceptionFlags(item)} />
                                                          </div>
                                                          <div className="text-xs text-gray-400 italic line-clamp-1 max-w-[200px]">{cleanReasonText(item.reason || item.work_plan || '', getRequestTypeLabel(item))}</div>
                                                        </div>
                                                      </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                      <div className="text-sm font-semibold text-gray-700">
                                                        {item._groupedIds?.length > 1 ? (
                                                          <>
                                                            {formatDate(item.start_date)} → {formatDate(item.end_date)}
                                                            <span className="ml-1.5 px-1.5 py-0.5 bg-violet-50 text-violet-600 text-xs font-medium rounded border border-violet-100 align-middle">
                                                              {item._groupedIds.length} ngày
                                                            </span>
                                                          </>
                                                        ) : (
                                                          <>{getDayOfWeek(item.attendance_date || item.registration_date || item.work_date || item.start_date || item.date)}, {formatDate(item.attendance_date || item.registration_date || item.work_date || item.start_date || item.date)}</>
                                                        )}
                                                      </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                      <div className="flex flex-col gap-1">
                                                        {item.late_minutes > 0 && (
                                                          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 w-fit">Muộn {item.late_minutes} phút</span>
                                                        )}
                                                        {item.early_leave_minutes > 0 && (
                                                          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 w-fit">Về sớm {item.early_leave_minutes} phút</span>
                                                        )}
                                                        {item.penalty_amount > 0 && (
                                                          <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 w-fit">-{(item.penalty_amount).toLocaleString('vi-VN')} VNĐ</span>
                                                        )}
                                                        {item._itemType === 'REGISTRATION' && calculateDuration(item.start_time, item.end_time) && (
                                                          <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded border border-primary-100 w-fit">
                                                            {calculateDuration(item.start_time, item.end_time)}
                                                          </span>
                                                        )}
                                                        {item.explanation_type === 'INCOMPLETE_ATTENDANCE' && (
                                                          (() => {
                                                            const checkIn = item.actual_check_in || item.forgot_checkin_time;
                                                            const checkOut = item.actual_check_out || item.forgot_checkout_time;
                                                            return (
                                                              <>
                                                                {checkIn && (
                                                                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 w-fit">
                                                                    Vào: {checkIn}
                                                                  </span>
                                                                )}
                                                                {checkOut && (
                                                                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 w-fit">
                                                                    Ra: {checkOut}
                                                                  </span>
                                                                )}
                                                              </>
                                                            );
                                                          })()
                                                        )}
                                                      </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(item)}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                      <div className="flex flex-col items-center gap-2">
                                                        <div className="flex items-center justify-center gap-2">
                                                          {activeTab === 'pending' && canApproveRequest(item) && (
                                                            <div className="flex items-center gap-2 mr-2">
                                                              <button
                                                                onClick={() => openApproveModal(item)}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-md border border-emerald-200 transition-colors"
                                                                title="Phê duyệt yêu cầu"
                                                              >
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                                                <span className="text-xs font-semibold uppercase tracking-wider">Phê duyệt</span>
                                                              </button>
                                                              <button
                                                                onClick={() => openRejectModal(item)}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-md border border-red-200 transition-colors"
                                                                title="Từ chối yêu cầu"
                                                              >
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                <span className="text-xs font-semibold uppercase tracking-wider">Từ chối</span>
                                                              </button>
                                                            </div>
                                                          )}

                                                          {canEditOvertimeHours(item) && (
                                                            <button
                                                              onClick={() => openOtEditModal(item)}
                                                              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white rounded-md border border-indigo-200 transition-colors"
                                                              title="Sửa lại giờ tăng ca thực tế cho nhân viên (hạn 10h sáng hôm sau, Chủ nhật tới hết ngày)"
                                                            >
                                                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                              <span className="text-xs font-semibold uppercase tracking-wider">Sửa giờ</span>
                                                            </button>
                                                          )}

                                                          <button
                                                            onClick={() => (item._itemType === 'ONLINE_WORK' || item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME') ? handleViewOnlineWorkDetails(item) : handleViewDetails(item)}
                                                            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 text-white hover:bg-primary-600 rounded-md text-xs font-medium transition-colors"
                                                          >
                                                            <span>Chi tiết</span>
                                                            <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                                                          </button>

                                                          {canDeleteRequest(item) && (
                                                            <button
                                                              onClick={() => openDeleteModal(item)}
                                                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                              title="Xóa đơn"
                                                            >
                                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                              </svg>
                                                            </button>
                                                          )}
                                                        </div>

                                                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 rounded border border-gray-200 text-xs text-gray-400">
                                                          Gửi lúc: <span className="text-gray-600">{formatTimeOnly(item.created_at)}</span> • {formatDate(item.created_at)}
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                              {(() => {
                                                const totalPenalty = items.reduce((sum, i) => sum + (i.penalty_amount || 0), 0);
                                                if (totalPenalty === 0) return null;
                                                return (
                                                  <tr className="bg-rose-50/30 border-t-2 border-rose-100/50">
                                                    <td colSpan={5} className="px-6 py-5 text-center">
                                                      <div className="flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-300">
                                                        <span className="text-xs font-semibold text-rose-400 uppercase tracking-widest">TỔNG CỘNG TIỀN PHẠT</span>
                                                        <div className="inline-flex items-center gap-2 px-8 py-2.5 bg-rose-600 shadow-xl shadow-rose-200 rounded-lg transform hover:scale-105 transition-transform duration-300">
                                                          <span className="text-2xl font-semibold text-white tracking-tighter drop-shadow-sm">
                                                            {totalPenalty.toLocaleString('vi-VN')} VNĐ
                                                          </span>
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                );
                                              })()}
                                            </tbody>
                                          </table>
                                        </div>

                                        {/* Mobile Cards */}
                                        <div className="lg:hidden p-3 space-y-2.5 bg-gray-50/50">
                                          {items.map((item) => {
                                            const itemKey = `${item._itemType}-${item.id}`;
                                            const itemTypeConfig = getItemTypeConfig(item);
                                            return (
                                              <div key={itemKey} className="p-3.5 bg-white rounded-xl border border-gray-100 shadow-sm">
                                                {/* Thiết kế lại cho mobile 2026-09-23: bản cũ có 5 khối
                                                    viền lồng nhau (thẻ > hộp lý do > hộp tiến độ > hộp
                                                    "gửi lúc") và tối đa 4 HÀNG nút full-width, mỗi thẻ
                                                    cao gần hết màn hình. Nay gộp còn 1 khối phẳng + tối
                                                    đa 2 hàng nút. Dữ liệu và thao tác giữ nguyên. */}
                                                <div className="flex items-start gap-3">
                                                  <div className={`p-2 rounded-lg ${itemTypeConfig.mobileBg} text-white shrink-0`}>
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={itemTypeConfig.iconPath} /></svg>
                                                  </div>
                                                  <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-2">
                                                      <h3 className="text-sm font-semibold text-gray-900 leading-tight capitalize">
                                                        {getRequestTypeLabel(item)}
                                                      </h3>
                                                      <div className="shrink-0 flex items-center gap-1">
                                                        <DeadlineExceptionBadge grants={getDeadlineExceptionFlags(item)} />
                                                        {getStatusBadge(item, true)}
                                                      </div>
                                                    </div>
                                                    <p className="mt-0.5 text-xs text-gray-500 truncate">
                                                      {item._groupedIds?.length > 1
                                                        ? `${formatDate(item.start_date)} → ${formatDate(item.end_date)} (${item._groupedIds.length} ngày)`
                                                        : `${getDayOfWeek(item.attendance_date || item.registration_date || item.work_date || item.start_date || item.date)}, ${formatDate(item.attendance_date || item.registration_date || item.work_date || item.start_date || item.date)}`}
                                                      {item._itemType === 'REGISTRATION' && calculateDuration(item.start_time, item.end_time)
                                                        ? ` · ${calculateDuration(item.start_time, item.end_time)}` : ''}
                                                      {item.employee_name ? ` · ${item.employee_name}` : ''}
                                                    </p>
                                                  </div>
                                                </div>

                                                {cleanReasonText(item.reason || item.work_plan || '', getRequestTypeLabel(item)) && (
                                                  <p className="mt-2 text-xs text-gray-600 italic line-clamp-2">
                                                    "{cleanReasonText(item.reason || item.work_plan || '', getRequestTypeLabel(item))}"
                                                  </p>
                                                )}

                                                {(item.late_minutes > 0 || item.early_leave_minutes > 0 || item.penalty_amount > 0
                                                  || (item.explanation_type === 'INCOMPLETE_ATTENDANCE' && (item.actual_check_in || item.forgot_checkin_time || item.actual_check_out || item.forgot_checkout_time))
                                                  || renderLeavePayCategoryBadge(item)) && (
                                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    {renderLeavePayCategoryBadge(item)}
                                                    {item.late_minutes > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-medium rounded border border-amber-100">Muộn {item.late_minutes}m</span>}
                                                    {item.early_leave_minutes > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-medium rounded border border-amber-100">Về sớm {item.early_leave_minutes}m</span>}
                                                    {item.explanation_type === 'INCOMPLETE_ATTENDANCE' && (item.actual_check_in || item.forgot_checkin_time) && <span className="px-2 py-0.5 bg-gray-50 text-gray-600 text-[11px] font-medium rounded border border-gray-200">Vào {(item.actual_check_in || item.forgot_checkin_time)?.substring(0, 5)}</span>}
                                                    {item.explanation_type === 'INCOMPLETE_ATTENDANCE' && (item.actual_check_out || item.forgot_checkout_time) && <span className="px-2 py-0.5 bg-gray-50 text-gray-600 text-[11px] font-medium rounded border border-gray-200">Ra {(item.actual_check_out || item.forgot_checkout_time)?.substring(0, 5)}</span>}
                                                    {item.penalty_amount > 0 && <span className="px-2 py-0.5 bg-rose-500 text-white text-[11px] font-semibold rounded">-{item.penalty_amount.toLocaleString('vi-VN')}</span>}
                                                  </div>
                                                )}

                                                {/* Tiến độ duyệt + thời điểm gửi trên CÙNG 1 dòng, thay
                                                    cho 2 hộp viền riêng trước đây. */}
                                                <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2 min-w-0">
                                                  <div className="min-w-0 shrink">{getStatusBadge(item, false, 'stepper')}</div>
                                                  {/* Rút gọn còn giờ:phút + ngày/tháng — bản đầy đủ
                                                      (kèm giây và năm) tràn khỏi thẻ trên điện thoại. */}
                                                  <span className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">
                                                    {formatShortDateTime(item.created_at)}
                                                  </span>
                                                </div>

                                                {activeTab === 'pending' && canApproveRequest(item) && (
                                                  <div className="mt-2.5 flex gap-2">
                                                    <button onClick={() => openApproveModal(item)} className="flex-1 h-10 bg-emerald-600 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                                      Phê duyệt
                                                    </button>
                                                    <button onClick={() => openRejectModal(item)} className="flex-1 h-10 bg-white text-red-600 border border-red-200 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                                                      Từ chối
                                                    </button>
                                                  </div>
                                                )}

                                                <div className="mt-2 flex gap-2">
                                                  {canEditOvertimeHours(item) && (
                                                    <button
                                                      onClick={() => openOtEditModal(item)}
                                                      className="flex-1 h-9 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                                                      title="Sửa lại giờ tăng ca thực tế (hạn 10h sáng hôm sau, Chủ nhật tới hết ngày)"
                                                    >
                                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                      Sửa giờ
                                                    </button>
                                                  )}
                                                  <button
                                                    onClick={() => (item._itemType === 'ONLINE_WORK' || item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME') ? handleViewOnlineWorkDetails(item) : handleViewDetails(item)}
                                                    className="flex-1 h-9 bg-white text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold active:scale-95 transition-transform"
                                                  >
                                                    Chi tiết
                                                  </button>
                                                  {canDeleteRequest(item) && (
                                                    <button
                                                      onClick={() => openDeleteModal(item)}
                                                      className="w-10 h-9 shrink-0 bg-white text-rose-500 border border-rose-100 rounded-lg flex items-center justify-center active:scale-95 transition-transform"
                                                      title="Xoá đơn"
                                                    >
                                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                      </svg>
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                          {(() => {
                                            const totalPenalty = items.reduce((sum, i) => sum + (i.penalty_amount || 0), 0);
                                            if (totalPenalty === 0) return null;
                                            return (
                                              <div className="p-5 bg-gradient-to-br from-rose-500 to-rose-600 rounded-lg shadow-xl shadow-rose-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                                <div className="flex flex-col items-center text-center gap-2">
                                                  <div className="flex flex-col">
                                                    <span className="text-sm font-semibold text-white mt-1 uppercase tracking-tight">
                                                      Tổng cộng tiền phạt
                                                    </span>
                                                  </div>
                                                  <div className="text-right">
                                                    <div className="text-2xl font-semibold text-white tracking-tighter drop-shadow-md">
                                                      {totalPenalty.toLocaleString('vi-VN')} <span className="text-xs text-rose-100 ml-0.5">VNĐ</span>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </div>
                                        {/* 
                                          QUY TẮC HIỂN THỊ: 
                                          - Duyệt nhanh tất cả đơn (cấp nhân viên): CHỈ dành cho Admin và Nhân sự (HR).
                                          - Quản lý (Manager) thông thường KHÔNG được sử dụng nút này để buộc phải xem chi tiết hoặc duyệt theo nhóm lớn hơn.
                                        */}
                                        {hasBulkApprovePermission && activeTab === 'pending' && pendingInEmp > 0 && (
                                          <div className="p-4 flex justify-end bg-gray-50/30 border-t border-gray-50">
                                            <button
                                              disabled={isBulkProcessing}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleBulkApproveItems(items, `nhân viên ${empName}`);
                                              }}
                                              className="flex items-center gap-2 h-10 px-6 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-lg shadow-emerald-100 transition-all uppercase tracking-wider"
                                            >

                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                              Duyệt nhanh tất cả đơn
                                            </button>
                                          </div>
                                        )}

                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            };

            // Cấp 1 (chờ QLTT trực tiếp duyệt) vs Cấp 2 (QLTT đã duyệt, đang chờ Nhân sự
            // duyệt) — tách 2 khu vực rõ ràng khi người xem có cả 2 loại quyền cùng lúc
            // (vừa là QLTT trực tiếp của 1 số nhân viên, vừa có quyền HR/Admin nên thấy
            // thêm đơn cấp 2 của nhân viên KHÁC không phải cấp dưới trực tiếp) — tránh
            // loạn giữa 2 loại đơn khác bản chất hành động cần làm.
            if (approvalLevelSplit) {
              const { level1Groups, level2Groups, level1Count, level2Count } = approvalLevelSplit;
              // Đảo thứ tự 2026-09-23: đơn ĐÃ qua QLTT mới là việc của HCNS nên
              // đưa lên TRƯỚC; đơn đang chờ QLTT duyệt (HCNS chưa làm gì được)
              // xuống dưới và THU GỌN sẵn. Đổi tên theo việc-cần-làm thay vì
              // "Cấp 1/Cấp 2" (ngôn ngữ quy trình, người dùng phải tự dịch).
              // Dải này chỉ HCNS/Admin thấy — với QLTT approvalLevelSplit luôn
              // null nên họ xem danh sách phẳng như cũ.
              return (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1.5 bg-violet-600 text-white text-xs font-bold rounded-lg uppercase tracking-wide shadow-sm shrink-0">
                      Cần bạn duyệt · đã qua quản lý trực tiếp
                    </span>
                    <span className="text-xs text-gray-400 font-semibold shrink-0">{level2Count} đơn</span>
                    <span className="h-[1px] flex-1 bg-gray-200"></span>
                  </div>
                  {Object.entries(level2Groups).map(renderDeptCard('L2'))}

                  <div className="flex items-center gap-3 mb-3 mt-8">
                    <button
                      onClick={() => setShowWaitingManagerSection(v => !v)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white text-gray-500 border border-gray-200 text-xs font-bold rounded-lg uppercase tracking-wide hover:text-gray-700 hover:border-gray-300 transition-colors shrink-0"
                      title="Các đơn này đang chờ quản lý trực tiếp duyệt bước 1 — bạn chưa cần làm gì"
                    >
                      <svg className={`w-3.5 h-3.5 transition-transform ${showWaitingManagerSection ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                      Đang chờ quản lý trực tiếp
                    </button>
                    <span className="text-xs text-gray-400 font-semibold shrink-0">{level1Count} đơn</span>
                    <span className="h-[1px] flex-1 bg-gray-200"></span>
                  </div>
                  {showWaitingManagerSection && Object.entries(level1Groups).map(renderDeptCard('L1'))}
                </>
              );
            }

            return (
              <>
                {deptEntries.map(renderDeptCard(''))}
                {/* Khối thu gọn: đơn CHÍNH MÌNH đã duyệt, đang chờ HCNS duyệt
                    nốt. Không phải việc cần làm nữa nên để cuối và đóng sẵn,
                    nhưng phải hiện ở đây — xem memoizedManagerApprovedPending. */}
                {managerApprovedPending && (
                  <>
                    <div className="flex items-center gap-3 mb-3 mt-8">
                      <button
                        onClick={() => setShowManagerApprovedSection(v => !v)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white text-gray-500 border border-gray-200 text-xs font-bold rounded-lg uppercase tracking-wide hover:text-gray-700 hover:border-gray-300 transition-colors shrink-0"
                        title="Bạn đã duyệt xong các đơn này, đang chờ Hành chính nhân sự duyệt nốt — bạn không cần làm gì thêm"
                      >
                        <svg className={`w-3.5 h-3.5 transition-transform ${showManagerApprovedSection ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                        </svg>
                        Bạn đã duyệt · đang chờ HCNS
                      </button>
                      <span className="text-xs text-gray-400 font-semibold shrink-0">{managerApprovedPending.count} đơn</span>
                      <span className="h-[1px] flex-1 bg-gray-200"></span>
                    </div>
                    {showManagerApprovedSection
                      && Object.entries(managerApprovedPending.groups).map(renderDeptCard('MA'))}
                  </>
                )}
              </>
            );
          })()
          }
        </div>


        </>
        )}

        {/* Khu vực BẢNG CÔNG THÁNG (trước đây là panel chèn giữa tab Chờ duyệt) */}
        {activeSection === 'work_finalization' && (
          <WorkFinalizationApprovalPanel
          activeTab={activeTab}
          loading={loading}
          showWorkFinalizationPanel={showWorkFinalizationPanel}
          visibleWorkFinalizationApprovals={visibleWorkFinalizationApprovals}
          displayedWorkFinalizationApprovals={displayedWorkFinalizationApprovals}
          isWorkFinalizationExpanded={isWorkFinalizationExpanded}
          setIsWorkFinalizationExpanded={setIsWorkFinalizationExpanded}
          PREVIEW_ROWS={PREVIEW_ROWS}
          canApproveRequest={canApproveRequest}
          openApproveModal={openApproveModal}
          openRejectModal={openRejectModal}
          handleViewDetails={handleViewDetails}
          handleViewOnlineWorkDetails={handleViewOnlineWorkDetails}
          handleViewWfDetails={handleViewWfDetails}
          getWfApprovalProgress={getWfApprovalProgress}
          isWfPartiallyApproved={isWfPartiallyApproved}
          getEmpField={getEmpField}
          getWfSiDeduction={getWfSiDeduction}
          getDoctorTeamDisplay={getDoctorTeamDisplay}
          formatWfAllowance={formatWfAllowance}
          formatRankDisplay={formatRankDisplay}
          formatProbationRateDisplay={formatProbationRateDisplay}
          formatDateTime={formatDateTime}
          getDayOfWeek={getDayOfWeek}
          renderExpandableWorkNote={renderExpandableWorkNote}
          />
        )}

        {/* Khu vực CHỐT CÔNG NHÂN SỰ THÁNG */}
        {activeSection === 'attendance_finalization' && (
          <AttendanceFinalizationPanel
          loading={loading}
          showAttendanceFinalizationPanel={showAttendanceFinalizationPanel}
          isAdmin={isAdmin}
          isHR={isHR}
          isManagement={isManagement}
          visibleAllWfApprovals={visibleAllWfApprovals}
          displayedAllWfApprovals={displayedAllWfApprovals}
          isAttendanceFinalizationExpanded={isAttendanceFinalizationExpanded}
          setIsAttendanceFinalizationExpanded={setIsAttendanceFinalizationExpanded}
          PREVIEW_ROWS={PREVIEW_ROWS}
          handleViewAttendanceWfDetails={handleViewAttendanceWfDetails}
          />
        )}

      </div>

      {/* Modal Sửa giờ tăng ca (QLTT/HCNS làm ngay ở tab Chờ duyệt) */}
      {otEditItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Sửa giờ tăng ca</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {otEditItem.employee_name || otEditItem.employee?.full_name || ''}
                {' · '}
                {formatDate(otEditItem.attendance_date || otEditItem.registration_date || otEditItem.event_date || otEditItem.start_date)}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-700">
                Sửa lại cho đúng giờ tăng ca thực tế của nhân viên. Số giờ sẽ được tính lại tự động theo
                giờ vào/ra mới. Tối thiểu 30 phút mới được tính tăng ca — nếu thực tế làm dưới 30 phút
                thì huỷ đơn thay vì sửa giờ.
                {!(isAdmin || isHR) && (() => {
                  const dl = getManagerFixDeadline(
                    otEditItem.attendance_date || otEditItem.registration_date || otEditItem.event_date || otEditItem.start_date,
                  );
                  return dl ? (
                    <div className="mt-1 font-semibold">
                      Hạn sửa: {dl.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Giờ vào</label>
                  <input
                    type="time"
                    value={otEditStart}
                    onChange={(e) => setOtEditStart(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Giờ ra</label>
                  <input
                    type="time"
                    value={otEditEnd}
                    onChange={(e) => setOtEditEnd(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-2">
              <button
                onClick={() => setOtEditItem(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-100"
              >
                Huỷ
              </button>
              <button
                onClick={submitOtEdit}
                disabled={otEditSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {otEditSaving ? 'Đang lưu...' : 'Lưu giờ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Đối chiếu tăng ca — trước đây là 1 tab riêng (xem
          showOtReconciliationModal ở đầu file) */}
      {showOtReconciliationModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Đối chiếu tăng ca với máy chấm công</h3>
              <button
                onClick={() => setShowOtReconciliationModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
                title="Đóng"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <OvertimeReconciliationPanel isHRAdmin={isAdmin || isHR} />
            </div>
          </div>
        </div>
      )}

      {/* Modal BẢNG TỔNG CÔNG NHÂN SỰ TEAM – chỉ hiển thị công, không có lương/hoa hồng/ghi chú */}
      {showWfDetailModal && selectedWfApproval && selectedWfApprovalSource === 'ATTENDANCE' && (
        <AttendanceWfDetailModal
          approval={selectedWfApproval}
          employees={wfEmployees}
          expandedEmployees={expandedWfEmployees}
          setExpandedEmployees={setExpandedWfEmployees}
          employeeActionLoadingId={wfEmployeeActionLoadingId}
          bulkApproveLoading={wfBulkApproveLoading}
          printLoading={wfPrintLoading}
          onClose={() => {
            setShowWfDetailModal(false);
            setSelectedWfApproval(null);
            setWfEmployees([]);
            setExpandedWfEmployees({});
          }}
          onEmployeeDecision={handleWfEmployeeDecision}
          onApproveRemaining={handleWfApproveRemainingEmployees}
          onPrint={handlePrintWfApproval}
          onApprove={(a) => { setShowWfDetailModal(false); openApproveModal(a); }}
          onReject={(a) => { setShowWfDetailModal(false); openRejectModal(a); }}
          onViewCalendar={setCalendarModalEmployee}
        />
      )}

      {/* Modal Chi tiết Chốt công BẢNG DATA NHÂN SỰ TEAM (Danh sách nhân viên) */}
      {showWfDetailModal && selectedWfApproval && selectedWfApprovalSource === 'WORK' && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-3xl sm:rounded-lg shadow-lg max-w-[98vw] w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-white flex items-start justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white shrink-0">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-xl font-semibold text-gray-800 uppercase tracking-tight line-clamp-2">PHÊ DUYỆT: BẢNG TỔNG CÔNG NHÂN SỰ TEAM {selectedWfApproval.department_name || selectedWfApproval.department_code}</h3>
                  <p className="text-xs text-gray-400 font-bold">Tháng {selectedWfApproval.month}/{selectedWfApproval.year} • {wfEmployees.length} nhân sự</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowWfDetailModal(false);
                  setSelectedWfApproval(null);
                  setWfEmployees([]);
                  setExpandedWfEmployees({});
                }}
                className="shrink-0 text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100 font-semibold text-xl"
              >
                ✕
              </button>
            </div>

            {/* Modal Body - Responsive Content */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-gray-50/30">
              {(() => {
                const canDecideWfEmployees =
                  selectedWfApproval?.status !== 'REJECTED' &&
                  !!(selectedWfApproval?.can_decide_employees ?? selectedWfApproval?.can_approve);
                return (
              <div className="bg-white border border-gray-200 rounded-lg sm:rounded-3xl overflow-hidden shadow-sm">

                {/* Desktop View (Table) */}
                <div className="hidden lg:block overflow-x-auto [&_table]:min-w-[2800px] [&_table]:border-collapse [&_table]:text-[11px] [&_th]:!px-2.5 [&_th]:!py-2 [&_th]:!text-[10px] [&_th]:!font-bold [&_th]:!text-primary-700 [&_th]:!bg-primary-50 [&_th]:!border [&_th]:!border-primary-100 [&_td]:!px-2.5 [&_td]:!py-2 [&_td]:!text-xs [&_td]:!border [&_td]:!border-gray-100 [&_tbody_tr:nth-child(even)]:!bg-slate-50/35">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-primary-50">
                      <tr>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">STT</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Mã NV</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Họ và Tên</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Phòng/Ban</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Bộ phận</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Cấp bậc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Vị trí</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Team Bác sĩ</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Hình thức làm việc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Ngày nghỉ việc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Thời gian thử việc (tháng)</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Ngày bắt đầu làm việc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Ngày kết thúc thử việc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Tỉ lệ hưởng thử việc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Lương cơ bản</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Phụ cấp</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Tỷ lệ % doanh số hưởng</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Tỷ lệ % lợi nhuận hưởng</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Khấu trừ BHXH</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Tình trạng</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Ghi chú công việc</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Thời gian gửi</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Quyết định</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {wfEmployees.length === 0 ? (
                        <tr>
                          <td colSpan={25} className="px-6 py-10 text-center text-gray-400 italic">Không tìm thấy dữ liệu nhân viên</td>
                        </tr>
                      ) : (
                        wfEmployees.map((emp, index) => (
                          <tr key={`wf-emp-${emp.employee_id}`} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-primary-50/40 group transition-colors`}>
                            <td className="px-5 py-4 text-sm text-gray-700">{index + 1}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['ma_nv', 'employee_code', 'code'])}</td>
                            <td className="px-5 py-4 text-sm font-semibold text-gray-800 tracking-tight group-hover:text-primary-600">
                              {getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'])}
                            </td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['phong_ban', 'department_name'])}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['bo_phan', 'unit', 'team', 'section'])}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatRankDisplay(getWfValue(emp, ['cap_bac', 'rank', 'level'], '-'))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['vi_tri', 'position', 'position_name'])}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getDoctorTeamDisplay(emp)}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['hinh_thuc_lam_viec', 'work_type', 'working_type'])}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfDate(getWfValue(emp, ['ngay_nghi_viec', 'resignation_date', 'leave_date'], ''))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['thoi_gian_thu_viec', 'probation_months'])}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfDate(getWfValue(emp, ['ngay_bat_dau_lam_viec', 'start_date'], ''))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfDate(getWfValue(emp, ['ngay_ket_thuc_thu_viec', 'probation_end_date', 'probation_end'], ''))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatProbationRateDisplay(getWfValue(emp, ['ti_le_huong_thu_viec', 'probation_rate_display', 'probation_rate', 'probation_ratio'], ''))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfAllowance(getWfValue(emp, ['luong_co_ban', 'basic_salary'], ''))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfAllowance(getWfValue(emp, ['phu_cap', 'allowance'], ''))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfPercent(getWfSalesPercentFromEmployee(emp))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{formatWfPercent(getWfProfitPercentFromEmployee(emp))}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfSiDeduction(emp)}</td>
                            <td className="px-5 py-4 text-sm text-gray-700">{getWfValue(emp, ['tinh_trang', 'employee_status', 'status'])}</td>
                            <td className="px-5 py-4 text-sm text-gray-700 align-top">
                              {renderExpandableWorkNote(
                                getWfEmploymentStatusNotes(emp),
                                `wf-table-${emp.employee_id || index}`,
                                { maxWidthClass: 'max-w-[300px]' }
                              )}
                            </td>
                            <td className="px-5 py-4 text-sm text-gray-700">
                              {formatDateTime(getWfValue(emp, ['thoi_gian_gui', 'submitted_at', 'created_at'], selectedWfApproval?.created_at || ''))}
                            </td>
                            <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">
                              {emp.individual_decision === 'APPROVED' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">Đã duyệt</span>
                              ) : emp.individual_decision === 'REJECTED' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-100">Đã từ chối</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Chưa quyết định</span>
                              )}
                            </td>
                            <td className="px-5 py-4 text-sm whitespace-nowrap">
                              {canDecideWfEmployees ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleWfEmployeeDecision(emp, 'APPROVED')}
                                    disabled={wfEmployeeActionLoadingId === emp.employee_id}
                                    className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
                                  >
                                    {wfEmployeeActionLoadingId === emp.employee_id ? 'Đang xử lý...' : 'Duyệt'}
                                  </button>
                                  <button
                                    onClick={() => handleWfEmployeeDecision(emp, 'REJECTED')}
                                    disabled={wfEmployeeActionLoadingId === emp.employee_id}
                                    className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 disabled:opacity-60"
                                  >
                                    Từ chối
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile/Tablet View (Cards) */}
                <div className="lg:hidden">
                  {wfEmployees.length === 0 ? (
                    <div className="px-6 py-10 text-center text-gray-400 italic">Không tìm thấy dữ liệu nhân viên</div>
                  ) : (
                    <>
                      {(() => {
                        const expandedCount = wfEmployees.filter((emp: any, index: number) => {
                          const key = String(
                            emp.employee_id ||
                            (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee) ||
                            `idx-${index}`
                          );
                          return !!expandedWfEmployees[key];
                        }).length;
                        const allExpanded = expandedCount > 0 && expandedCount === wfEmployees.length;

                        return (
                          <div className="sticky top-0 z-10 px-3 py-2 bg-white/95 backdrop-blur border-b border-gray-100 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                              Đang mở {expandedCount}/{wfEmployees.length}
                            </span>
                            <button
                              onClick={() => {
                                if (allExpanded) {
                                  setExpandedWfEmployees({});
                                  return;
                                }
                                const nextState: Record<string, boolean> = {};
                                wfEmployees.forEach((emp: any, idx: number) => {
                                  const key = String(
                                    emp.employee_id ||
                                    (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee) ||
                                    `idx-${idx}`
                                  );
                                  nextState[key] = true;
                                });
                                setExpandedWfEmployees(nextState);
                              }}
                              className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-primary-200 text-primary-700 bg-primary-50"
                            >
                              {allExpanded ? 'Thu gọn tất cả' : 'Mở tất cả'}
                            </button>
                          </div>
                        );
                      })()}

                      <div className="divide-y divide-gray-100">
                        {wfEmployees.map((emp, index) => {
                          const employeeKey = String(
                            emp.employee_id ||
                            (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee) ||
                            `idx-${index}`
                          );
                          const isExpanded = !!expandedWfEmployees[employeeKey];

                          return (
                            <div key={`wf-emp-mobile-${employeeKey}`} className={`p-3 sm:p-6 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-800 tracking-tight truncate">
                                      {getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'])}
                                    </span>
                                    {emp.is_locked && (
                                      <div className="bg-amber-100 text-amber-600 p-0.5 rounded shadow-sm shrink-0">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter mt-1 block">
                                    STT {index + 1} • {getWfValue(emp, ['ma_nv', 'employee_code', 'code'])}
                                  </span>
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {emp.individual_decision === 'APPROVED' ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">Đã duyệt</span>
                                    ) : emp.individual_decision === 'REJECTED' ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-100">Đã từ chối</span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Chưa quyết định</span>
                                    )}
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                                      {getWfValue(emp, ['phong_ban', 'department_name'])}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    setExpandedWfEmployees((prev) => ({
                                      ...prev,
                                      [employeeKey]: !prev[employeeKey],
                                    }));
                                  }}
                                  className="shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 text-gray-600 bg-white"
                                >
                                  {isExpanded ? 'Thu gọn' : 'Xem thêm'}
                                </button>
                              </div>

                              <div className="mt-2 text-[11px] font-semibold text-gray-500">
                                Thời gian gửi: {formatDateTime(getWfValue(emp, ['thoi_gian_gui', 'submitted_at', 'created_at'], selectedWfApproval?.created_at || ''))}
                              </div>

                              {isExpanded && (
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Bộ phận</span><div className="text-xs font-semibold text-gray-800 break-words">{getWfValue(emp, ['bo_phan', 'unit', 'team', 'section'])}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Cấp bậc</span><div className="text-xs font-semibold text-gray-800 break-words">{formatRankDisplay(getWfValue(emp, ['cap_bac', 'rank', 'level'], '-'))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Vị trí</span><div className="text-xs font-semibold text-gray-800 break-words">{getWfValue(emp, ['vi_tri', 'position', 'position_name'])}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Team Bác sĩ</span><div className="text-xs font-semibold text-gray-800 break-words">{getDoctorTeamDisplay(emp)}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Hình thức làm việc</span><div className="text-xs font-semibold text-gray-800 break-words">{getWfValue(emp, ['hinh_thuc_lam_viec', 'work_type', 'working_type'])}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Ngày nghỉ việc</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfDate(getWfValue(emp, ['ngay_nghi_viec', 'resignation_date', 'leave_date'], ''))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Thời gian thử việc (tháng)</span><div className="text-xs font-semibold text-gray-800 break-words">{getWfValue(emp, ['thoi_gian_thu_viec', 'probation_months'])}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Ngày bắt đầu làm việc</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfDate(getWfValue(emp, ['ngay_bat_dau_lam_viec', 'start_date'], ''))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Ngày kết thúc thử việc</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfDate(getWfValue(emp, ['ngay_ket_thuc_thu_viec', 'probation_end_date', 'probation_end'], ''))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Tỉ lệ hưởng thử việc</span><div className="text-xs font-semibold text-gray-800 break-words">{formatProbationRateDisplay(getWfValue(emp, ['ti_le_huong_thu_viec', 'probation_rate_display', 'probation_rate', 'probation_ratio'], ''))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Lương cơ bản</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfAllowance(getWfValue(emp, ['luong_co_ban', 'basic_salary'], ''))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Phụ cấp</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfAllowance(getWfValue(emp, ['phu_cap', 'allowance'], ''))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Tỷ lệ % doanh số hưởng</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfPercent(getWfSalesPercentFromEmployee(emp))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Tỷ lệ % lợi nhuận hưởng</span><div className="text-xs font-semibold text-gray-800 break-words">{formatWfPercent(getWfProfitPercentFromEmployee(emp))}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Khấu trừ BHXH</span><div className="text-xs font-semibold text-gray-800 break-words">{getWfSiDeduction(emp)}</div></div>
                                  <div className="bg-gray-900 p-2.5 rounded-lg border border-gray-900"><span className="text-xs text-gray-300">Tình trạng</span><div className="text-xs font-semibold text-white break-words">{getWfValue(emp, ['tinh_trang', 'employee_status', 'status'])}</div></div>
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 sm:col-span-2">
                                    <span className="text-xs text-gray-400">Ghi chú công việc</span>
                                    <div className="text-xs font-semibold text-gray-800">
                                      {renderExpandableWorkNote(
                                        getWfEmploymentStatusNotes(emp),
                                        `wf-card-${emp.employee_id || index}`,
                                        {
                                          maxWidthClass: 'max-w-full',
                                          previewLength: 85,
                                          buttonClass: 'ml-1 inline text-primary-600 hover:text-primary-700 text-[11px] font-semibold'
                                        }
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className={`mt-3 ${isExpanded ? 'pt-3 border-t border-gray-100' : ''}`}>
                                {(() => {
                                  const empId = emp.employee_id || (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee);
                                  const empName = getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'], 'Nhân viên');
                                  return (
                                    <div className="w-full flex flex-col sm:flex-row sm:justify-end sm:items-center gap-2">
                                      {canDecideWfEmployees && (
                                        <>
                                          <button
                                            onClick={() => handleWfEmployeeDecision(emp, 'APPROVED')}
                                            disabled={wfEmployeeActionLoadingId === emp.employee_id}
                                            className="w-full sm:w-auto px-2.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
                                          >
                                            {wfEmployeeActionLoadingId === emp.employee_id ? 'Đang xử lý...' : 'Duyệt'}
                                          </button>
                                          <button
                                            onClick={() => handleWfEmployeeDecision(emp, 'REJECTED')}
                                            disabled={wfEmployeeActionLoadingId === emp.employee_id}
                                            className="w-full sm:w-auto px-2.5 py-2 text-xs font-semibold rounded-lg border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 disabled:opacity-60"
                                          >
                                            Từ chối
                                          </button>
                                        </>
                                      )}
                                      <button
                                        onClick={() => {
                                          if (empId) {
                                            setCalendarModalEmployee({
                                              id: Number(empId),
                                              name: String(empName),
                                              month: selectedWfApproval.month,
                                              year: selectedWfApproval.year,
                                            });
                                          }
                                        }}
                                        className="w-full sm:w-auto px-2.5 py-2 text-xs font-semibold rounded-lg border border-primary-200 text-primary-700 bg-primary-50"
                                      >
                                        Chi tiết
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
                );
              })()}
            </div>

            {/* Mobile Quick Action */}
            {!!(selectedWfApproval?.can_decide_employees ?? selectedWfApproval?.can_approve) && selectedWfApproval?.status !== 'REJECTED' && (
              <div className="sm:hidden px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-100">
                <button
                  onClick={handleWfApproveRemainingEmployees}
                  disabled={wfBulkApproveLoading}
                  className="w-full h-12 px-5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xl shadow-emerald-100 uppercase tracking-widest disabled:opacity-60"
                >
                  {wfBulkApproveLoading ? 'Đang duyệt...' : 'Duyệt toàn bộ NV trực tiếp'}
                </button>
              </div>
            )}

            {/* Modal Footer */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 bg-white border-t border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="h-2 w-2 rounded-full bg-primary-500 shrink-0"></div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest italic leading-tight">Toàn bộ dữ liệu đã được đối soát tự động</p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={handlePrintWfApproval}
                  disabled={wfPrintLoading}
                  className="w-full sm:w-auto h-12 px-6 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg uppercase tracking-widest disabled:opacity-60"
                >
                  {wfPrintLoading ? 'Đang tạo bản in...' : 'In phiếu ký'}
                </button>
                {selectedWfApproval.status === 'APPROVED' && (
                  <span className="w-full sm:w-auto text-center px-4 py-3 bg-emerald-50 text-emerald-600 text-xs font-semibold rounded-lg border border-emerald-100 uppercase tracking-widest">
                    Bảng công đã được phê duyệt
                  </span>
                )}
                {selectedWfApproval.status === 'REJECTED' && (
                  <span className="w-full sm:w-auto text-center px-4 py-3 bg-rose-50 text-rose-600 text-xs font-semibold rounded-lg border border-rose-100 uppercase tracking-widest">
                    Bảng công đã bị từ chối
                  </span>
                )}
                {selectedWfApproval.status === 'PENDING' && selectedWfApproval?.can_approve && (
                  <>
                    {/* <button
                      onClick={() => {
                        setShowWfDetailModal(false);
                        openApproveModal(selectedWfApproval);
                      }}
                      className="w-full sm:w-auto h-12 px-8 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-xl shadow-emerald-100 uppercase tracking-widest"
                    >
                      Duyệt bảng công này
                    </button> */}
                    <button
                      onClick={() => {
                        setShowWfDetailModal(false);
                        openRejectModal(selectedWfApproval);
                      }}
                      className="w-full sm:w-auto h-12 px-8 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold rounded-lg border border-rose-200 uppercase tracking-widest"
                    >
                      Từ chối bảng công này
                    </button>
                  </>
                )}
                {!!(selectedWfApproval?.can_decide_employees ?? selectedWfApproval?.can_approve) && selectedWfApproval?.status !== 'REJECTED' && (
                  <button
                    onClick={handleWfApproveRemainingEmployees}
                    disabled={wfBulkApproveLoading}
                    className="hidden sm:block w-full sm:w-auto h-12 px-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xl shadow-emerald-100 uppercase tracking-widest disabled:opacity-60"
                  >
                    {wfBulkApproveLoading ? 'Đang duyệt...' : 'Duyệt toàn bộ NV trực tiếp'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal chi tiết */}
      {showDetailModal &&
        (selectedExplanation || selectedOnlineWorkRequest) && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 transition-all duration-300">
            <div className="bg-white rounded-t-xl sm:rounded-lg shadow-lg max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
              {/* Modal Header - Sticky */}
              <div className="sticky top-0 z-20 px-6 py-4 border-b border-gray-100 bg-white/95 shadow-sm">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center text-primary-600 shadow-sm">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-gray-800 leading-none">
                        Thông tin đơn
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs font-bold text-gray-400">Loại đơn:</span>
                        <span className="text-xs font-semibold text-primary-600">
                          {getRequestTypeLabel(selectedExplanation || selectedOnlineWorkRequest)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setShowDetailModal(false);
                      setSelectedExplanation(null);
                      setSelectedOnlineWorkRequest(null);
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-200"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              <div className="px-4 sm:px-6 py-4 sm:py-6">
                {/* 1. Kế hoạch / Lý do (Ẩn nếu là Nghỉ phép tháng theo yêu cầu) */}
                {!(selectedExplanation?._itemType === 'LEAVE') && (
                  <div className="mb-6">
                    <div className="bg-primary-50 border-l-4 border-primary-500 p-4 rounded-r-xl shadow-sm">
                      <h4 className="text-sm font-bold text-primary-800 uppercase tracking-wider mb-2">
                        NỘI DUNG
                      </h4>
                      <p className="text-gray-800 font-medium whitespace-pre-wrap text-base leading-relaxed">
                        {selectedExplanation
                          ? cleanReasonText(selectedExplanation.reason, getRequestTypeLabel(selectedExplanation))
                          : (selectedOnlineWorkRequest.work_plan || selectedOnlineWorkRequest.reason || selectedOnlineWorkRequest.note || 'N/A')}
                      </p>
                    </div>
                  </div>
                )}

                <DeadlineExceptionDetail grants={getDeadlineExceptionFlags(selectedExplanation || selectedOnlineWorkRequest)} />

                {/* 2. Grid Thông tin Nhân viên & Chi tiết Đơn */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  {/* Cột 1: Profile Card */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm ring-1 ring-black/5 hover:shadow-md transition-shadow">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                      <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      Thông tin nhân viên
                    </h4>
                    <div className="flex items-center gap-4 mb-6">
                      <div className="relative group">
                        <div className="h-16 w-16 bg-gradient-to-tr from-primary-500 to-primary-400 rounded-lg flex items-center justify-center text-white text-2xl font-semibold shadow-lg shadow-primary-100 ring-4 ring-white transition-transform group-hover:scale-105 duration-300">
                          {(selectedExplanation ? selectedExplanation.employee_name : selectedOnlineWorkRequest.employee_name)?.charAt(0) || 'U'}
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 border-2 border-white rounded-full shadow-sm flex items-center justify-center">
                          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-gray-800 leading-tight tracking-tight">
                          {selectedExplanation ? selectedExplanation.employee_name : selectedOnlineWorkRequest.employee_name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md border border-primary-100 uppercase tracking-wider">
                            {selectedExplanation ? selectedExplanation.employee_code : selectedOnlineWorkRequest.employee_code}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-gray-50">
                      {/* Department */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-gray-50 transition-colors group/item">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 group-hover/item:bg-primary-50 group-hover/item:text-primary-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                          </div>
                          <span className="text-sm font-bold text-gray-400 uppercase tracking-tighter">Phòng ban</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-700">
                          {(selectedExplanation ? (selectedExplanation.employee_department || selectedExplanation.department_name) : selectedOnlineWorkRequest.department_name) || 'N/A'}
                        </span>
                      </div>

                      {/* Position */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-gray-50 transition-colors group/item">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 group-hover/item:bg-primary-50 group-hover/item:text-primary-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                          </div>
                          <span className="text-sm font-bold text-gray-400 uppercase tracking-tighter">Vị trí</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-700">
                          {(selectedExplanation ? (selectedExplanation.employee_position || selectedExplanation.position_name) : (selectedOnlineWorkRequest.employee_position || selectedOnlineWorkRequest.position_name)) || 'N/A'}
                        </span>
                      </div>

                      {/* Manager */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-gray-50 transition-colors group/item">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 group-hover/item:bg-emerald-50 group-hover/item:text-emerald-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                          </div>
                          <span className="text-sm font-bold text-gray-400 uppercase tracking-tighter">Quản lý duyệt</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-700">
                          {(selectedExplanation ? (selectedExplanation.employee_manager_name || selectedExplanation.employee_department_manager_name) : (selectedOnlineWorkRequest.employee_manager_name || selectedOnlineWorkRequest.employee_department_manager_name)) || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cột 2: Request Info (Meta Data) */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm ring-1 ring-black/5 hover:shadow-md transition-shadow">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                      <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Cụ thể yêu cầu
                    </h4>

                    <div className="space-y-4">
                      {/* Priority Status Section */}
                      <div className="bg-gray-50/50 rounded-lg p-4 border border-gray-100 flex items-center justify-between group/status">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-gray-400 shadow-sm border border-gray-100 group-hover/status:text-primary-500 transition-colors">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </div>
                          <span className="text-sm font-bold text-gray-500 uppercase tracking-tight">Trạng thái duyệt</span>
                        </div>
                        {getStatusBadge(selectedExplanation || selectedOnlineWorkRequest)}
                      </div>

                      {/* Info List */}
                      <div className="space-y-3 px-1">
                        {/* Request ID */}
                        <div className="flex justify-between items-center py-2.5 border-b border-gray-50 gap-4">
                          <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">Mã định danh đơn</span>
                          <span className="text-xs font-mono font-semibold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 whitespace-nowrap">
                            {selectedExplanation?.request_code || selectedOnlineWorkRequest?.request_code || '---'}
                          </span>
                        </div>

                        {selectedExplanation ? (
                          <>
                            {/* Date Detail */}
                            <div className="flex justify-between items-center py-2.5 border-b border-gray-50 gap-4">
                              <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">
                                {selectedExplanation._itemType === 'REGISTRATION' ? 'Ngày đăng ký' :
                                  selectedExplanation._itemType === 'LEAVE' ? 'Thời gian nghỉ' :
                                    'Ngày hiệu lực'}
                              </span>
                              <span className="text-[15px] font-semibold text-gray-700 whitespace-nowrap">
                                {selectedExplanation._itemType === 'LEAVE'
                                  ? (selectedExplanation.start_date === selectedExplanation.end_date
                                    ? formatDate(selectedExplanation.start_date)
                                    : `${formatDate(selectedExplanation.start_date)} - ${formatDate(selectedExplanation.end_date)}`)
                                  : selectedExplanation._groupedIds?.length > 1
                                    ? `${formatDate(selectedExplanation.start_date)} - ${formatDate(selectedExplanation.end_date)} (${selectedExplanation._groupedIds.length} ngày)`
                                    : formatDate(selectedExplanation.attendance_date || selectedExplanation.registration_date || selectedExplanation.event_date || selectedExplanation.start_date)}
                              </span>
                            </div>

                            {/* Time Range (if applicable) */}
                            {selectedExplanation._itemType === 'REGISTRATION' && (selectedExplanation.start_time || selectedExplanation.end_time) && (
                              <div className="flex justify-between items-center py-2.5 border-b border-gray-50 gap-4">
                                <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">Khung thời gian</span>
                                <span className="text-sm font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-full border border-primary-100 whitespace-nowrap">
                                  {selectedExplanation.start_time?.substring(0, 5) || '??:??'} - {selectedExplanation.end_time?.substring(0, 5) || '??:??'}
                                </span>
                              </div>
                            )}

                            {/* Status Transitions (Attendance only) */}
                            {selectedExplanation._itemType !== 'REGISTRATION' && (
                              <>
                                <div className="flex flex-col gap-3 py-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Dữ liệu gốc</span>
                                    <span className="text-sm font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
                                      {selectedExplanation.original_status_display || getOriginalStatusText(selectedExplanation.original_status)}
                                    </span>
                                  </div>

                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kỳ vọng thay đổi</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full shadow-sm">
                                      <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                                      <span className="text-sm font-semibold text-emerald-700">
                                        {selectedExplanation.expected_status_display?.includes('đủ công đúng công') ? 'Tính đủ công' : (selectedExplanation.expected_status_display || getExpectedStatusText(selectedExplanation.expected_status))}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Hiển thị chi tiết vi phạm và phạt nếu có */}
                                {(selectedExplanation.late_minutes > 0 || selectedExplanation.early_leave_minutes > 0 || selectedExplanation.penalty_amount > 0) && (
                                  <div className="mt-4 p-4 rounded-lg bg-rose-50/50 border border-rose-100 shadow-sm relative overflow-hidden group/violation">
                                    {/* Decorative background element */}
                                    <div className="absolute -top-12 -right-12 w-32 h-32 bg-rose-100/30 rounded-full blur-2xl group-hover/violation:bg-rose-100/50 transition-colors duration-500" />

                                    <div className="flex items-center gap-3 mb-4 scale-in-center">
                                      <div className="flex-shrink-0 w-9 h-9 bg-rose-500 rounded-lg flex items-center justify-center text-white shadow-lg shadow-rose-200">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                      </div>
                                      <div>
                                        <span className="text-sm font-semibold text-rose-800 uppercase tracking-widest block leading-none">Thông tin vi phạm & Phạt</span>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      {/* Thời gian vi phạm card */}
                                      {(selectedExplanation.late_minutes > 0 || selectedExplanation.early_leave_minutes > 0) && (
                                        <div className="bg-white/80 p-3 rounded-lg border border-rose-100/50 shadow-sm hover:shadow-md transition-shadow duration-300">
                                          <span className="text-xs text-gray-400 font-semibold uppercase tracking-widest block mb-3">Thời gian vi phạm</span>
                                          <div className="space-y-2">
                                            {selectedExplanation.late_minutes > 0 && (
                                              <div className="flex justify-between items-center p-2 rounded-lg bg-amber-50/80 border border-amber-100/50 group/item">
                                                <div className="flex items-center gap-2">
                                                  <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                                                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-tighter">Đi muộn:</span>
                                                </div>
                                                <div className="flex items-baseline gap-0.5">
                                                  <span className="text-base font-semibold text-amber-600 tracking-tighter">{selectedExplanation.late_minutes}</span>
                                                  <span className="text-xs font-bold text-amber-400 uppercase ml-0.5">phút</span>
                                                </div>
                                              </div>
                                            )}
                                            {selectedExplanation.early_leave_minutes > 0 && (
                                              <div className="flex justify-between items-center p-2 rounded-lg bg-rose-50/80 border border-rose-100/50 group/item">
                                                <div className="flex items-center gap-2">
                                                  <div className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
                                                  <span className="text-xs font-semibold text-rose-700 uppercase tracking-tighter">Về sớm:</span>
                                                </div>
                                                <div className="flex items-baseline gap-0.5">
                                                  <span className="text-base font-semibold text-rose-600 tracking-tighter">{selectedExplanation.early_leave_minutes}</span>
                                                  <span className="text-xs font-bold text-rose-400 uppercase ml-0.5">phút</span>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {/* Tiền phạt card */}
                                      {selectedExplanation.penalty_amount > 0 && (
                                        <div className="bg-gradient-to-br from-rose-500 to-rose-600 p-3 rounded-lg shadow-lg shadow-rose-200 flex flex-col justify-between group/total">
                                          <span className="text-xs text-rose-100 font-semibold uppercase tracking-widest block mb-1">Tiền phạt</span>
                                          <div className="flex items-baseline gap-1.5 justify-end">
                                            <span className="text-2xl font-semibold text-white font-mono tracking-tighter drop-shadow-sm">
                                              {(selectedExplanation.penalty_amount || 0).toLocaleString('vi-VN')}
                                            </span>
                                            <span className="text-xs font-semibold text-rose-100 uppercase tracking-tighter">VNĐ</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Hiển thị timeline quên chấm công */}
                                {selectedExplanation.explanation_type === 'INCOMPLETE_ATTENDANCE' && (
                                  <div className="mt-4 p-4 rounded-lg bg-primary-50/50 border border-primary-100 shadow-sm">
                                    <div className="flex items-center gap-3 mb-4">
                                      <div className="flex-shrink-0 w-9 h-9 bg-primary-500 rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary-200">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                      </div>
                                      <span className="text-sm font-semibold text-primary-800 uppercase tracking-widest">Timeline chấm công</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                      {/* Giờ vào */}
                                      <div className="bg-white/80 p-3 rounded-lg border border-primary-100/50 shadow-sm">
                                        <span className="text-xs text-gray-400 font-semibold uppercase tracking-widest block mb-1">Giờ vào</span>
                                        <span className="text-lg font-semibold text-amber-600">
                                          {(selectedExplanation.actual_check_in || selectedExplanation.forgot_checkin_time)?.substring(0, 5) || '--:--'}
                                        </span>
                                        {selectedExplanation.forgot_punch_type === 'checkin' || selectedExplanation.forgot_punch_type === 'both' ? (
                                          <span className="block text-xs font-bold text-amber-500 uppercase mt-0.5">NV khai</span>
                                        ) : (
                                          <span className="block text-xs font-bold text-emerald-500 uppercase mt-0.5">Máy chấm</span>
                                        )}
                                      </div>
                                      {/* Giờ ra */}
                                      <div className="bg-white/80 p-3 rounded-lg border border-primary-100/50 shadow-sm">
                                        <span className="text-xs text-gray-400 font-semibold uppercase tracking-widest block mb-1">Giờ ra</span>
                                        <span className="text-lg font-semibold text-amber-600">
                                          {(selectedExplanation.actual_check_out || selectedExplanation.forgot_checkout_time)?.substring(0, 5) || '--:--'}
                                        </span>
                                        {selectedExplanation.forgot_punch_type === 'checkout' || selectedExplanation.forgot_punch_type === 'both' ? (
                                          <span className="block text-xs font-bold text-amber-500 uppercase mt-0.5">NV khai</span>
                                        ) : (
                                          <span className="block text-xs font-bold text-emerald-500 uppercase mt-0.5">Máy chấm</span>
                                        )}
                                      </div>
                                      {/* Tổng giờ */}
                                      {(() => {
                                        const ci = (selectedExplanation.actual_check_in || selectedExplanation.forgot_checkin_time)?.substring(0, 5);
                                        const co = (selectedExplanation.actual_check_out || selectedExplanation.forgot_checkout_time)?.substring(0, 5);
                                        if (ci && co) {
                                          const [h1, m1] = ci.split(':').map(Number);
                                          const [h2, m2] = co.split(':').map(Number);
                                          const hours = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
                                          return (
                                            <div className={`p-3 rounded-lg border shadow-sm ${hours >= 5.5 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                                              <span className="text-xs text-gray-400 font-semibold uppercase tracking-widest block mb-1">Tổng giờ</span>
                                              <span className={`text-lg font-semibold ${hours >= 5.5 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {hours.toFixed(1)}h
                                              </span>
                                              <span className={`block text-xs font-bold uppercase mt-0.5 ${hours >= 5.5 ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                {hours >= 5.5 ? '→ 1.0 công' : '→ 0.5 công'}
                                              </span>
                                            </div>
                                          );
                                        }
                                        return null;
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          /* Online Work / Registration specifics */
                          <>
                            <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
                              <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">Ngày thực hiện</span>
                              <span className="text-sm font-semibold text-gray-700">
                                {formatDate(selectedOnlineWorkRequest.work_date || selectedOnlineWorkRequest.attendance_date || selectedOnlineWorkRequest.registration_date || selectedOnlineWorkRequest.event_date)}
                              </span>
                            </div>
                            {/* Giờ bắt đầu / Giờ kết thúc / Tổng thời gian — luôn hiện cho REGISTRATION */}
                            {(selectedOnlineWorkRequest._itemType === 'REGISTRATION' || selectedOnlineWorkRequest._itemType === 'OVERTIME') && (
                              <>
                                <div className="flex justify-between items-center py-2.5 border-b border-gray-50 gap-4">
                                  <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">Giờ bắt đầu</span>
                                  <span className="text-sm font-semibold text-gray-700 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 whitespace-nowrap">
                                    {selectedOnlineWorkRequest.start_time?.substring(0, 5) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-2.5 border-b border-gray-50 gap-4">
                                  <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">Giờ kết thúc</span>
                                  <span className="text-sm font-semibold text-gray-700 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 whitespace-nowrap">
                                    {selectedOnlineWorkRequest.end_time?.substring(0, 5) || 'N/A'}
                                  </span>
                                </div>
                                {calculateDuration(selectedOnlineWorkRequest.start_time, selectedOnlineWorkRequest.end_time) && (
                                  <div className="flex justify-between items-center py-2.5 border-b border-gray-50 gap-4">
                                    <span className="text-sm font-bold text-gray-400 uppercase tracking-tight shrink-0 whitespace-nowrap">Tổng thời gian</span>
                                    <span className="text-sm font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-full border border-primary-100 whitespace-nowrap">
                                      {calculateDuration(selectedOnlineWorkRequest.start_time, selectedOnlineWorkRequest.end_time)}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}


                          </>
                        )}

                        {/* Common metadata footer */}
                        <div className="flex justify-between items-center pt-2.5 border-t border-gray-100 mt-2">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Ngày tạo đơn</span>
                          <span className="text-sm font-bold text-gray-600">
                            {formatDateTime(
                              selectedExplanation
                                ? selectedExplanation.created_at
                                : selectedOnlineWorkRequest.created_at
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>



                {/* Additional Fields for Online Work (Mở rộng) */}
                {!selectedExplanation && selectedOnlineWorkRequest.actual_result && (
                  <div className="mb-6">
                    <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-xl shadow-sm">
                      <h4 className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-2">
                        Kết quả thực tế
                      </h4>
                      <p className="text-gray-800 font-medium whitespace-pre-wrap text-base leading-relaxed">
                        {selectedOnlineWorkRequest.actual_result}
                      </p>
                    </div>
                  </div>
                )}

                {/* LỊCH SỬ ĐƠN — gộp "Quy trình duyệt" và "Lịch sử chỉnh sửa"
                    thành 1 dòng thời gian duy nhất xếp theo thứ tự thời gian, có
                    cả mốc tạo đơn (yêu cầu HCNS 2026-09-23: "gộp lịch sử chỉnh
                    sửa với quy trình duyệt đi, thành chronological luôn. Thêm cả
                    giờ tạo nhé"). Bước CHƯA diễn ra (chưa duyệt) không có mốc
                    thời gian nên luôn xếp cuối. */}
                {(() => {
                  const req: any = selectedOnlineWorkRequest || selectedExplanation;
                  if (!req) return null;
                  const history: any[] = req.edit_history || req.event_data?.edit_history || [];
                  const workflowSteps: any[] = selectedExplanation
                    ? getApprovalWorkflow(selectedExplanation)
                    : getOnlineWorkApprovalWorkflow(selectedOnlineWorkRequest);

                  type Entry = {
                    at: string | null;
                    kind: 'created' | 'edited' | 'approved' | 'rejected' | 'waiting';
                    title: string; who?: string; note?: string; changes?: any; reset?: boolean;
                  };
                  const entries: Entry[] = [
                    { at: req.created_at || null, kind: 'created', title: 'Tạo đơn', who: req.employee_name || undefined },
                    // Bỏ hẳn bản ghi chỉnh sửa mà thực chất KHÔNG đổi gì (dữ
                    // liệu cũ sinh từ lỗi so chuỗi "18:00" vs "18:00:00" —
                    // xem countRealEditChanges), trừ khi nó có kéo theo việc
                    // đưa đơn về chờ duyệt lại thì vẫn phải hiện.
                    ...history
                      .filter((h: any) => countRealEditChanges(h.changes) > 0 || h.reset_to_pending)
                      .map((h: any): Entry => ({
                        at: h.edited_at || null, kind: 'edited', title: 'Chỉnh sửa đơn',
                        who: h.edited_by_name || undefined, changes: h.changes, reset: !!h.reset_to_pending,
                      })),
                    ...workflowSteps.map((st: any): Entry => {
                      const isRejected = String(st.status).includes('từ chối');
                      const isApproved = String(st.status).includes('duyệt') && !String(st.status).includes('Chưa');
                      return {
                        at: st.date || null,
                        kind: isRejected ? 'rejected' : isApproved ? 'approved' : 'waiting',
                        title: `${st.role}: ${st.status}`,
                        who: st.approver, note: st.note,
                      };
                    }),
                  ];

                  entries.sort((a, b) => {
                    if (!a.at && !b.at) return 0;
                    if (!a.at) return 1;
                    if (!b.at) return -1;
                    return new Date(a.at).getTime() - new Date(b.at).getTime();
                  });

                  const DOT: Record<Entry['kind'], string> = {
                    created: 'bg-gray-300',
                    edited: 'bg-indigo-500',
                    approved: 'bg-emerald-500',
                    rejected: 'bg-red-500',
                    waiting: 'bg-white border-2 border-gray-200',
                  };

                  return (
                    <div className="mt-8">
                      <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Lịch sử đơn
                      </h4>
                      <div className="bg-white border border-gray-100 rounded-lg p-4 sm:p-5 shadow-sm ring-1 ring-black/5">
                        <ol className="relative border-l-2 border-gray-100 ml-2 space-y-5">
                          {entries.map((e, i) => (
                            <li key={i} className="relative pl-5">
                              <span className={`absolute -left-[26px] top-1.5 h-3 w-3 rounded-full ${DOT[e.kind]}`} />
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className={`text-sm font-semibold ${e.kind === 'waiting' ? 'text-gray-400' : 'text-gray-900'}`}>
                                  {e.title}
                                </span>
                                {e.who && <span className="text-sm text-gray-500">· {e.who}</span>}
                                <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                                  {e.at ? formatDateTime(e.at) : 'chưa diễn ra'}
                                </span>
                              </div>
                              {e.reset && (
                                <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                                  Đã đưa về chờ HCNS duyệt lại
                                </span>
                              )}
                              {e.changes && (
                                <div className="mt-1.5 space-y-1">
                                  {sortEditChanges(e.changes).map(([field, val]: [string, any]) => (
                                    <div key={field} className="flex flex-wrap items-center gap-2 text-sm">
                                      <span className="text-gray-500 min-w-[100px]">{EDIT_FIELD_LABELS[field] || field}</span>
                                      <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 line-through">{formatEditValue(val?.old)}</span>
                                      <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">{formatEditValue(val?.new)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {e.note && <p className="mt-1 text-sm text-gray-500 italic">"{e.note}"</p>}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Footer / Actions */}
              <div className="px-4 sm:px-6 py-4 border-t border-gray-200 bg-gray-50 flex flex-wrap sm:flex-nowrap justify-end gap-3 rounded-b-lg">
                <div className="mr-auto w-full sm:w-auto mb-2 sm:mb-0 order-last sm:order-first">
                  {((selectedExplanation && canDeleteRequest(selectedExplanation)) || (selectedOnlineWorkRequest && canDeleteRequest(selectedOnlineWorkRequest))) && (
                    <button
                      onClick={() => {
                        openDeleteModal(selectedExplanation || selectedOnlineWorkRequest);
                        setShowDetailModal(false);
                      }}
                      className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg sm:rounded-md hover:bg-red-100 transition-colors font-semibold"
                    >
                      Xoá đơn
                    </button>
                  )}
                </div>
                {/* Sửa giờ tăng ca ngay trong modal Chi tiết (2026-09-23) — trước
                    đây chỉ có ở hàng/thẻ ngoài danh sách, mở Chi tiết rồi thì phải
                    thoát ra mới sửa được. Dùng chung điều kiện canEditOvertimeHours
                    nên quyền và hạn giống hệt nút ngoài danh sách. */}
                {selectedOnlineWorkRequest && canEditOvertimeHours(selectedOnlineWorkRequest) && (
                  <button
                    onClick={() => {
                      openOtEditModal(selectedOnlineWorkRequest);
                      setShowDetailModal(false);
                    }}
                    className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold rounded-lg sm:rounded-md hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2 order-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    Sửa giờ
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedExplanation(null);
                    setSelectedOnlineWorkRequest(null);
                  }}
                  className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 border border-gray-300 text-gray-700 font-semibold rounded-lg sm:rounded-md hover:bg-gray-50 transition-colors order-1"
                >
                  Đóng
                </button>
                {activeTab === 'pending' && (
                  <>
                    {selectedExplanation &&
                      canApproveExplanation(selectedExplanation) && (
                        <>
                          <button
                            onClick={() => {
                              openApproveModal(selectedExplanation);
                              setShowDetailModal(false);
                            }}
                            className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 bg-emerald-600 text-white font-semibold rounded-lg sm:rounded-md hover:bg-emerald-700 transition-colors order-3"
                          >
                            Duyệt
                          </button>
                          <button
                            onClick={() => {
                              openRejectModal(selectedExplanation);
                              setShowDetailModal(false);
                            }}
                            className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 bg-red-600 text-white font-semibold rounded-lg sm:rounded-md hover:bg-red-700 transition-colors order-2"
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                    {selectedOnlineWorkRequest &&
                      canApproveRequest(selectedOnlineWorkRequest) && (
                        <>
                          <button
                            onClick={() => {
                              openApproveModal(selectedOnlineWorkRequest);
                              setShowDetailModal(false);
                            }}
                            className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 bg-emerald-600 text-white font-semibold rounded-lg sm:rounded-md hover:bg-emerald-700 transition-colors order-3"
                          >
                            Duyệt
                          </button>
                          <button
                            onClick={() => {
                              openRejectModal(selectedOnlineWorkRequest);
                              setShowDetailModal(false);
                            }}
                            className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 bg-red-600 text-white font-semibold rounded-lg sm:rounded-md hover:bg-red-700 transition-colors order-2"
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

      {/* 5 modal thao tác (duyệt/từ chối, huỷ đơn, lỗi, duyệt hàng loạt +
          kết quả) — đã tách sang components/approvals/ApprovalActionModals */}
      <ApprovalActionModals
        actionModalOpen={actionModalOpen}
        setActionModalOpen={setActionModalOpen}
        actionType={actionType}
        targetItem={targetItem}
        approvalNote={approvalNote}
        setApprovalNote={setApprovalNote}
        isProcessing={isProcessing}
        confirmAction={confirmAction}
        deleteModalOpen={deleteModalOpen}
        setDeleteModalOpen={setDeleteModalOpen}
        confirmDelete={confirmDelete}
        currentEmployee={currentEmployee}
        errorModalOpen={errorModalOpen}
        setErrorModalOpen={setErrorModalOpen}
        errorMessage={errorMessage}
        bulkConfirmModal={bulkConfirmModal}
        setBulkConfirmModal={setBulkConfirmModal}
        executeBulkApprove={executeBulkApprove}
        bulkActionResult={bulkActionResult}
        setBulkActionResult={setBulkActionResult}
        formatDate={formatDate}
        getRequestTypeLabel={getRequestTypeLabel}
      />


      {/* Employee Attendance Calendar Modal */}
      {calendarModalEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center text-primary-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-800">Lịch công của {calendarModalEmployee.name}</h2>
                  <p className="text-xs text-gray-400 font-semibold">Tháng {calendarModalEmployee.month}/{calendarModalEmployee.year}</p>
                </div>
              </div>
              <button
                onClick={() => setCalendarModalEmployee(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              <AttendanceCalendar
                year={calendarModalEmployee.year}
                month={calendarModalEmployee.month - 1}
                employeeId={calendarModalEmployee.id}
                showInternalDialog={true}
              />
            </div>
          </div>
        </div>
      )}
      {notePromptDialog}
    </div>
  );
};

export default Approvals;
