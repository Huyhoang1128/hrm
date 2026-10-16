import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownTrayIcon,
  FunnelIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  UserIcon,
  CalendarIcon,
  BoltIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  EyeIcon,
  ShieldExclamationIcon,
  LockClosedIcon,
  LockOpenIcon,
  ClockIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { departmentsAPI, employeesAPI, Department, Employee } from '../utils/api';
import { workFinalizationService, WorkFinalizationRecord } from '../services/workFinalization.service';
import attendanceService from '../services/attendance.service';
import type {
  DailySummaryItem,
  FinalizeAllResponse,
  FinalizeDepartmentResponse,
  LockStatusResponse,
  LockStatusBothResponse,
  LockPeriod,
  FinalizeAllResultItem,
  FinalizeAllErrorItem,
  LockEmployeeOverride,
} from '../services/workFinalization.service';
import deptAttendanceViolationReportService from '../services/deptAttendanceViolationReport.service';
import type { DeptAttendanceViolationResponse } from '../services/deptAttendanceViolationReport.service';
import EmployeeMonthAttendance from '../components/EmployeeMonthAttendance';
import { SelectBox } from '../components/LandingLayout/SelectBox';

// --- Optimizations: Global Helpers & Memoized Sub-components ---

const formatNumber = (value: number | null) => {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('vi-VN');
};

const formatDate = (val: string | null | undefined) => {
  if (!val) return '—';
  const d = new Date(val);
  return isNaN(d.getTime())
    ? '—'
    : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const RESIGNED_RETENTION_DAYS = 46;

const normalizeStatusText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const normalizeToken = (value: unknown) =>
  String(value ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const parseDateValue = (value: unknown): Date | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isProbationEffectiveInMonth = (emp: Employee, year: number, month: number): boolean => {
  const contractType = normalizeToken(emp.contract_type);
  const employmentStatus = normalizeToken(emp.employment_status);
  const isProbation = contractType === 'PROBATION' || employmentStatus === 'PROBATION';
  if (!isProbation) return false;

  const monthStart = new Date(year, month - 1, 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0);
  monthEnd.setHours(23, 59, 59, 999);

  const startDate = parseDateValue(emp.start_date);
  if (startDate && startDate > monthEnd) return false;

  const probationEnd = parseDateValue(emp.probation_end_date);
  if (!probationEnd) return true;

  return probationEnd >= monthStart;
};

const isInactiveEmployee = (emp: Employee): boolean => {
  const falseLike = ['false', '0', 'no', 'inactive', 'disabled'];
  const data = emp as Employee & {
    active?: unknown;
    status?: unknown;
    tinh_trang?: unknown;
  };

  const booleanCandidates = [emp.is_active, data.active];
  if (booleanCandidates.some((value) => value === false)) return true;
  if (booleanCandidates.some((value) => falseLike.includes(normalizeStatusText(value)))) return true;

  const statusTexts = [data.tinh_trang, emp.employment_status, data.status]
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

const shouldShowInWorkFinalizationList = (emp: Employee): boolean => {
  if (!isInactiveEmployee(emp)) return true;

  const date = parseDateValue(emp.end_date);
  if (!date) return true;

  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() - RESIGNED_RETENTION_DAYS);
  return date >= cutoffDate;
};

const shouldShowRecordInWorkFinalizationList = (rec: WorkFinalizationRecord): boolean => {
  const status = normalizeStatusText(rec.on_off);
  const isInactive = ['inactive', 'disabled', 'terminated', 'resigned', 'da nghi', 'nghi viec', 'thoi viec']
    .some((keyword) => status.includes(keyword));

  if (!isInactive) return true;

  const date = parseDateValue(rec.ngay_nghi_viec);
  if (!date) return true;

  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() - RESIGNED_RETENTION_DAYS);
  return date >= cutoffDate;
};

const EmployeeListItem = React.memo(({
  emp,
  rec,
  isSelected,
  isBeingFinalized,
  isLocked,
  canBypassLock,
  onSelect,
  onFinalize,
}: {
  emp: Employee;
  rec?: WorkFinalizationRecord;
  isSelected: boolean;
  isBeingFinalized: boolean;
  isLocked: boolean;
  canBypassLock: boolean;
  onSelect: (emp: Employee) => void;
  onFinalize: (emp: Employee) => void;
}) => {
  return (
    <li
      onClick={() => onSelect(emp)}
      className={`px-3 py-3 cursor-pointer hover:bg-primary-50 transition-colors ${
        isSelected ? 'bg-primary-50 border-l-4 border-primary-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
            <UserIcon className="h-4 w-4 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {emp.full_name}
            </p>
            <p className="text-xs text-gray-500 font-mono">
              {emp.employee_id}
            </p>
            <div className="flex flex-col">
              {emp.department && (
                <p className="text-xs text-gray-400 truncate">
                  {emp.department.name}
                </p>
              )}
              {emp.position && (
                <p className="text-[10px] text-primary-400 font-medium truncate">
                  {emp.position.title}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          {rec ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
              <CheckCircleIcon className="w-3 h-3 mr-0.5" />
              Đã chốt
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
              Chưa chốt
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFinalize(emp);
            }}
            disabled={isBeingFinalized || (isLocked && !canBypassLock)}
            title={isLocked ? 'Tháng này đã khóa chốt công' : undefined}
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed ${
              rec
                ? 'text-primary-700 bg-primary-50 hover:bg-primary-100'
                : 'text-white bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {isBeingFinalized ? (
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
            ) : rec ? (
              'Chốt lại'
            ) : (
              'Chốt công'
            )}
          </button>
        </div>
      </div>
      {rec && (
        <div className="mt-2 flex gap-3 text-xs text-gray-500">
          <span>Công: <strong className="text-gray-700">{rec.tong_cong}</strong></span>
          <span>Phạt: <strong className="text-red-600">{formatNumber(rec.tong_phat)}đ</strong></span>
        </div>
      )}
    </li>
  );
});

const WorkFinalization: React.FC = () => {
  const { user } = useAuth();
  const userRole = user?.role ? user.role.toUpperCase() : 'USER';
  const canBypassLock = userRole === 'ADMIN' || userRole === 'HR';

  const isSuperUser =
    (user as any)?.is_supperuser === true ||
    user?.is_superuser === true ||
    (user as any)?.is_super_admin === true;
  const isAdmin = isSuperUser || userRole === 'ADMIN';
  const isHR =
    userRole === 'HR' ||
    (user as any)?.is_hr === true ||
    (user as any)?.employee_profile?.is_hr === true ||
    (user as any)?.hrm_user?.is_hr === true;
  // Trưởng phòng (is_manager) được XEM trang này nhưng chỉ thấy dữ liệu của NV
  // đang có mình là "quản lý trực tiếp" — filter phòng ban KHÔNG bị khoá vì
  // cấp dưới trực tiếp có thể thuộc nhiều phòng ban khác nhau (chỉ lọc thêm
  // trong phạm vi đã được phép). Toàn bộ nút thao tác (Chốt/Khóa/Xuất) bị ẩn
  // — backend cũng tự chặn các API mutate này với role không phải ADMIN/HR,
  // không phụ thuộc hoàn toàn vào FE.
  const isManagerRestricted = !isAdmin && !isHR && (user as any)?.is_manager === true;

  // Backend (EmployeeViewSet.get_queryset) chỉ trả về CẤP DƯỚI TRỰC TIẾP
  // (manager_id=chính mình) cho Trưởng phòng không phải Admin/HR — KHÔNG bao
  // gồm chính họ. Theo yêu cầu HCNS 2026-09-21 "chỉ xem được data chốt công
  // của bản thân và nhân viên thuộc mình" — tự thêm bản ghi CHÍNH MÌNH vào
  // danh sách bên dưới (employeesAPI.me()) để Trưởng phòng xem được cả công
  // của mình, không chỉ cấp dưới.
  const [selfEmployee, setSelfEmployee] = useState<Employee | null>(null);
  useEffect(() => {
    if (isManagerRestricted) {
      employeesAPI.me().then(setSelfEmployee).catch(() => setSelfEmployee(null));
    }
  }, [isManagerRestricted]);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<WorkFinalizationRecord[]>([]);

  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const [showViolationModal, setShowViolationModal] = useState(false);
  const [violationReport, setViolationReport] = useState<DeptAttendanceViolationResponse | null>(null);
  const [loadingViolation, setLoadingViolation] = useState(false);
  const [exportingViolation, setExportingViolation] = useState(false);
  const [showAttendanceAnomalyModal, setShowAttendanceAnomalyModal] = useState(false);
  const [pendingMonthlyLeaveRequests, setPendingMonthlyLeaveRequests] = useState<any[]>([]);
  const [loadingPendingMonthlyLeave, setLoadingPendingMonthlyLeave] = useState(false);

  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingDetail, setExportingDetail] = useState(false);
  const [showExportDeptModal, setShowExportDeptModal] = useState(false);
  const [exportDeptIds, setExportDeptIds] = useState<number[]>([]);
  const [finalizing, setFinalizing] = useState<string | null>(null);
  const [finalizingAll, setFinalizingAll] = useState(false);
  const [finalizingDepartment, setFinalizingDepartment] = useState(false);
  const [finalizeAllResult, setFinalizeAllResult] = useState<FinalizeAllResponse | null>(null);
  const [finalizeDepartmentResult, setFinalizeDepartmentResult] = useState<FinalizeDepartmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selected employee for calendar view
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Finalization Lock state — chia theo 2 nửa tháng
  const [lockStatus, setLockStatus] = useState<LockStatusBothResponse | null>(null);
  const [togglingLock, setTogglingLock] = useState(false);
  const [lockConfirmPeriod, setLockConfirmPeriod] = useState<LockPeriod | null>(null);
  const [lockNote, setLockNote] = useState('');
  const [lockStartAt, setLockStartAt] = useState('');

  // Daily detail pivot modal
  const [showDailyPreviewModal, setShowDailyPreviewModal] = useState(false);
  const [exportingDaily, setExportingDaily] = useState(false);

  // Khóa/Mở khóa riêng theo nhân viên — độc lập với khóa chung 2 nửa tháng
  const [showEmployeeOverrideModal, setShowEmployeeOverrideModal] = useState(false);
  const [overridePeriod, setOverridePeriod] = useState<LockPeriod>('FIRST_HALF');
  const [overrideEmployeeIds, setOverrideEmployeeIds] = useState<number[]>([]);
  const [overrideEmployeeSearch, setOverrideEmployeeSearch] = useState('');
  const [overrideIsUnlocked, setOverrideIsUnlocked] = useState(true);
  const [overrideNote, setOverrideNote] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideList, setOverrideList] = useState<LockEmployeeOverride[]>([]);
  const [overrideListLoading, setOverrideListLoading] = useState(false);
  const [overrideDeletingId, setOverrideDeletingId] = useState<number | null>(null);
  // Danh sách nhân viên riêng cho modal này — KHÔNG dùng chung `employees` của
  // trang vì state đó chỉ nạp khi trang có filter phòng ban/tìm kiếm.
  const [overrideAllEmployees, setOverrideAllEmployees] = useState<Employee[]>([]);
  const [overrideEmployeesLoading, setOverrideEmployeesLoading] = useState(false);

  const firstHalf = lockStatus?.first_half ?? null;
  const secondHalf = lockStatus?.second_half ?? null;
  const firstHalfLocked = firstHalf?.is_locked ?? false;
  const secondHalfLocked = secondHalf?.is_locked ?? false;
  const bothLocked = firstHalfLocked && secondHalfLocked;
  const anyLocked = firstHalfLocked || secondHalfLocked;
  // Giữ tên `isLocked` cho backward-compat — true nếu BẤT KỲ nửa nào đang khóa
  const isLocked = anyLocked;
  const periodConfirmStatus: LockStatusResponse | null =
    lockConfirmPeriod === 'FIRST_HALF' ? firstHalf
    : lockConfirmPeriod === 'SECOND_HALF' ? secondHalf
    : null;
  const periodConfirmLocked = periodConfirmStatus?.is_locked ?? false;

  // Helper: ISO string → datetime-local value
  const toLocalInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // Format theo local timezone cho input datetime-local
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Load lock status when month/year changes
  useEffect(() => {
    workFinalizationService
      .getLockStatus(selectedYear, selectedMonth)
      .then((res) => {
        setLockStatus(res);
      })
      .catch(() => setLockStatus(null));
  }, [selectedYear, selectedMonth]);

  const handleToggleLock = async () => {
    if (!lockConfirmPeriod) return;
    setTogglingLock(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await workFinalizationService.toggleLock({
        year: selectedYear,
        month: selectedMonth,
        period: lockConfirmPeriod,
        is_locked: !periodConfirmLocked,
        note: lockNote,
        lock_start_at: lockStartAt ? new Date(lockStartAt).toISOString() : null,
      });
      setLockStatus((prev) => {
        if (!prev) {
          return {
            year: selectedYear,
            month: selectedMonth,
            first_half: lockConfirmPeriod === 'FIRST_HALF' ? res : ({} as LockStatusResponse),
            second_half: lockConfirmPeriod === 'SECOND_HALF' ? res : ({} as LockStatusResponse),
          };
        }
        return {
          ...prev,
          first_half: lockConfirmPeriod === 'FIRST_HALF' ? res : prev.first_half,
          second_half: lockConfirmPeriod === 'SECOND_HALF' ? res : prev.second_half,
        };
      });
      setSuccessMsg(res.message);
      setLockConfirmPeriod(null);
      setLockNote('');
      setLockStartAt(toLocalInput(res.lock_start_at));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể thay đổi trạng thái khóa.');
    } finally {
      setTogglingLock(false);
    }
  };

  const handleCancelSchedule = async (period: LockPeriod) => {
    setTogglingLock(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await workFinalizationService.toggleLock({
        year: selectedYear,
        month: selectedMonth,
        period,
        is_locked: false,
        note: 'Hủy lịch hẹn khóa',
        lock_start_at: null,
      });
      setLockStatus((prev) => prev ? ({
        ...prev,
        first_half: period === 'FIRST_HALF' ? res : prev.first_half,
        second_half: period === 'SECOND_HALF' ? res : prev.second_half,
      }) : prev);
      setSuccessMsg('Đã hủy lịch hẹn khóa.');
      setLockStartAt('');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể hủy lịch hẹn khóa.');
    } finally {
      setTogglingLock(false);
    }
  };

  const openLockConfirm = (period: LockPeriod) => {
    const target = period === 'FIRST_HALF' ? firstHalf : secondHalf;
    setLockStartAt(toLocalInput(target?.lock_start_at ?? null) || toLocalInput(new Date().toISOString()));
    setLockNote(target?.note ?? '');
    setLockConfirmPeriod(period);
  };

  // ─── Khóa/Mở khóa riêng theo nhân viên ───

  const fetchEmployeeOverrides = useCallback(async (period: LockPeriod) => {
    setOverrideListLoading(true);
    try {
      const res = await workFinalizationService.getLockEmployeeOverrides(
        selectedYear, selectedMonth, period
      );
      setOverrideList(res);
    } catch {
      setOverrideList([]);
    } finally {
      setOverrideListLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  const openEmployeeOverrideModal = () => {
    setOverrideEmployeeIds([]);
    setOverrideEmployeeSearch('');
    setOverrideIsUnlocked(true);
    setOverrideNote('');
    setShowEmployeeOverrideModal(true);
    fetchEmployeeOverrides(overridePeriod);
    if (overrideAllEmployees.length === 0) {
      setOverrideEmployeesLoading(true);
      employeesAPI.list({ page_size: 5000 })
        .then((res) => setOverrideAllEmployees(res.results))
        .catch(() => setOverrideAllEmployees([]))
        .finally(() => setOverrideEmployeesLoading(false));
    }
  };

  const handleOverridePeriodChange = (period: LockPeriod) => {
    setOverridePeriod(period);
    fetchEmployeeOverrides(period);
  };

  const handleSubmitEmployeeOverride = async () => {
    if (overrideEmployeeIds.length === 0) return;
    setOverrideSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await workFinalizationService.setLockEmployeeOverride({
        year: selectedYear,
        month: selectedMonth,
        period: overridePeriod,
        employee_ids: overrideEmployeeIds,
        is_unlocked: overrideIsUnlocked,
        note: overrideNote,
      });
      setSuccessMsg(res.message);
      setOverrideEmployeeIds([]);
      setOverrideNote('');
      await fetchEmployeeOverrides(overridePeriod);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể khóa/mở khóa riêng cho nhân viên đã chọn.');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleDeleteEmployeeOverride = async (ov: LockEmployeeOverride) => {
    setOverrideDeletingId(ov.id);
    try {
      await workFinalizationService.deleteLockEmployeeOverride(ov.id);
      setOverrideList((prev) => prev.filter((o) => o.id !== ov.id));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể gỡ ngoại lệ.');
    } finally {
      setOverrideDeletingId(null);
    }
  };

  // Load departments once
  useEffect(() => {
    departmentsAPI
      .list({ page_size: 1000 })
      .then((res) => setDepartments(res.results))
      .catch(() => { });
  }, []);


  // Load employees when dept filter changes
  const loadEmployees = useCallback(async () => {
    // Trưởng phòng: luôn thấy CHÍNH MÌNH trong danh sách kể cả khi chưa
    // chọn phòng ban/tìm kiếm gì (xem selfEmployee ở trên) — trước đây trả
    // rỗng hoàn toàn nếu chưa lọc gì, khiến họ không tìm thấy công của mình.
    const selfEntry = isManagerRestricted && selfEmployee && shouldShowInWorkFinalizationList(selfEmployee)
      ? selfEmployee
      : null;
    if (!selectedDepartment && !debouncedSearchTerm) {
      setEmployees(selfEntry ? [selfEntry] : []);
      return;
    }
    setLoadingEmployees(true);
    try {
      const params: any = { page_size: 1000 };
      if (selectedDepartment && selectedDepartment !== 'all') {
        params.department = Number(selectedDepartment);
      }
      if (debouncedSearchTerm) params.search = debouncedSearchTerm;
      const res = await employeesAPI.list(params);
      const list = res.results.filter(shouldShowInWorkFinalizationList);
      setEmployees(
        selfEntry && !list.some((e) => e.id === selfEntry.id) ? [selfEntry, ...list] : list
      );
    } catch {
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, [selectedDepartment, debouncedSearchTerm, isManagerRestricted, selfEmployee]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  // Load finalization records for the selected month/year/dept
  const loadRecords = useCallback(async () => {
    // Nếu không chọn phòng ban VÀ không có từ khóa tìm kiếm thì không tải
    if (!selectedDepartment && !debouncedSearchTerm) {
      setRecords([]);
      return;
    }
    setLoadingRecords(true);
    setError(null);
    try {
      const params: any = { year: selectedYear, month: selectedMonth };
      if (selectedDepartment && selectedDepartment !== 'all') {
        params.department_id = Number(selectedDepartment);
      }
      // Tìm theo tên hoặc mã giống danh sách NV (loadEmployees). Trước đây gửi
      // employee_code (khớp chính xác mã) nên tìm theo tên thì không lấy được bản
      // chốt -> báo "Chưa chốt công" và ẩn khung "Kết quả chốt công".
      if (debouncedSearchTerm) {
        params.search = debouncedSearchTerm;
      }
      const res = await workFinalizationService.list(params);
      setRecords(res.results.filter(shouldShowRecordInWorkFinalizationList));
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
        'Không thể tải dữ liệu chốt công. Vui lòng thử lại.'
      );
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [selectedYear, selectedMonth, selectedDepartment, debouncedSearchTerm]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    let isMounted = true;
    const loadPendingMonthlyLeaveRequests = async () => {
      setLoadingPendingMonthlyLeave(true);
      try {
        const response = await attendanceService.getMonthlyLeaveRequests({
          month: selectedMonth,
          year: selectedYear,
          status: 'PENDING',
          page_size: 2000,
          ordering: '-created_at',
        });
        if (isMounted) {
          setPendingMonthlyLeaveRequests(response.results || []);
        }
      } catch {
        if (isMounted) {
          setPendingMonthlyLeaveRequests([]);
        }
      } finally {
        if (isMounted) {
          setLoadingPendingMonthlyLeave(false);
        }
      }
    };

    loadPendingMonthlyLeaveRequests();
    return () => {
      isMounted = false;
    };
  }, [selectedMonth, selectedYear]);

  // Memoized records map for O(1) lookup performance
  const recordsMap = useMemo(() => {
    const map = new Map<string, WorkFinalizationRecord>();
    records.forEach((r) => map.set(r.ma_nv, r));
    return map;
  }, [records]);

  const attendanceAnomalies = useMemo(
    () =>
      employees
        .map((emp) => {
          const rec = recordsMap.get(emp.employee_id);
          const hasApprovedLeave = Number(rec?.nghi_phep ?? 0) > 0;
          const reasons: string[] = [];

          if (isProbationEffectiveInMonth(emp, selectedYear, selectedMonth) && hasApprovedLeave) {
            reasons.push('Thử việc còn hiệu lực + có đơn nghỉ phép đã duyệt');
          }

          const rankToken = normalizeToken(emp.rank);
          const isInternOrTts = rankToken === 'INTERN' || rankToken.includes('TTS') || rankToken.includes('THUC TAP');
          if (isInternOrTts && hasApprovedLeave) {
            reasons.push('INTERN/TTS + có đơn nghỉ phép đã duyệt');
          }

          const overCreditDays = (rec?.daily_summary || []).filter((day) => Number(day.work_credit ?? 0) > 1);
          if (overCreditDays.length > 0) {
            reasons.push(
              `Có ngày công > 1 (${overCreditDays
                .map((day) => `${String(day.day).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}: ${day.work_credit}`)
                .join(', ')})`
            );
          }

          if (reasons.length === 0) return null;
          return { emp, rec, reasons };
        })
        .filter(Boolean) as Array<{
        emp: Employee;
        rec?: WorkFinalizationRecord;
        reasons: string[];
      }>,
    [employees, selectedYear, selectedMonth, recordsMap]
  );

  const pendingLeaveAnomalies = useMemo(() => {
    const pendingByEmployeeId = new Map<number, any[]>();

    pendingMonthlyLeaveRequests.forEach((request) => {
      const employeeIdRaw = request.employee_id ?? request.employee ?? request?.employee?.id;
      const employeeId = Number(employeeIdRaw);
      if (!Number.isFinite(employeeId) || employeeId <= 0) return;

      const existing = pendingByEmployeeId.get(employeeId) || [];
      existing.push(request);
      pendingByEmployeeId.set(employeeId, existing);
    });

    return employees
      .map((emp) => {
        const requests = pendingByEmployeeId.get(emp.id) || [];
        if (requests.length === 0) return null;

        const reasons: string[] = [];
        if (isProbationEffectiveInMonth(emp, selectedYear, selectedMonth)) {
          reasons.push('Thử việc còn hiệu lực + có đơn nghỉ phép chưa duyệt');
        }

        const rankToken = normalizeToken(emp.rank);
        const isInternOrTts = rankToken === 'INTERN' || rankToken.includes('TTS') || rankToken.includes('THUC TAP');
        if (isInternOrTts) {
          reasons.push('INTERN/TTS + có đơn nghỉ phép chưa duyệt');
        }

        if (reasons.length === 0) return null;
        return { emp, requests, reasons };
      })
      .filter(Boolean) as Array<{
      emp: Employee;
      requests: any[];
      reasons: string[];
    }>;
  }, [pendingMonthlyLeaveRequests, employees, selectedYear, selectedMonth]);

  const totalAttendanceAnomalies = attendanceAnomalies.length + pendingLeaveAnomalies.length;

  const handleSelectEmployee = useCallback((emp: Employee) => {
    setSelectedEmployee(emp);
  }, []);

  const handleOpenEmployeeCalendar = useCallback((emp: Employee) => {
    setSelectedEmployee(emp);
    setShowAttendanceAnomalyModal(false);
  }, []);

  const handleFinalize = useCallback(async (emp: Employee) => {
    setFinalizing(emp.employee_id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await workFinalizationService.finalize({
        employee_code: emp.employee_id,
        year: selectedYear,
        month: selectedMonth,
      });
      setSuccessMsg(
        `${res.created ? 'Chốt công thành công' : 'Đã cập nhật chốt công'} cho ${emp.employee_id} - ${emp.full_name}`
      );
      
      // Update local records state immediately for better UX
      if (res.data) {
        setRecords(prev => {
          const index = prev.findIndex(r => r.ma_nv === emp.employee_id);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = res.data;
            return updated;
          }
          return [...prev, res.data];
        });
      }

      await loadRecords();
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
        `Lỗi khi chốt công cho ${emp.employee_id}`
      );
    } finally {
      setFinalizing(null);
    }
  }, [selectedYear, selectedMonth, loadRecords]);

  const handleFinalizeAll = async () => {
    if (!window.confirm(`Bạn có chắc muốn chốt công cho toàn bộ nhân viên tháng ${selectedMonth}/${selectedYear}?`)) {
      return;
    }
    setFinalizingAll(true);
    setError(null);
    setSuccessMsg(null);
    setFinalizeAllResult(null);
    try {
      const employeesRes = await employeesAPI.list({ page_size: 1000 });
      const eligibleEmployees = employeesRes.results.filter(shouldShowInWorkFinalizationList);

      const results: FinalizeAllResultItem[] = [];
      const errors: FinalizeAllErrorItem[] = [];
      let skippedLocked = 0;

      for (const emp of eligibleEmployees) {
        try {
          const finalizeRes = await workFinalizationService.finalize({
            employee_code: emp.employee_id,
            year: selectedYear,
            month: selectedMonth,
          });
          // Bản ghi đã khoá số công: backend giữ nguyên, không tính lại
          if (finalizeRes.skipped_locked) {
            skippedLocked += 1;
            continue;
          }
          results.push({
            employee_code: emp.employee_id,
            ho_va_ten: emp.full_name,
            created: finalizeRes.created,
          });
        } catch (err: any) {
          errors.push({
            employee_code: emp.employee_id,
            ho_va_ten: emp.full_name,
            error: err?.response?.data?.error || 'Không thể chốt công',
          });
        }
      }

      const res: FinalizeAllResponse = {
        year: selectedYear,
        month: selectedMonth,
        total_processed: results.length,
        total_errors: errors.length,
        results,
        errors,
      };

      setFinalizeAllResult(res);
      setSuccessMsg(
        `Đã chốt công ${res.total_processed} nhân viên tháng ${selectedMonth}/${selectedYear}` +
        (res.total_errors > 0 ? ` (${res.total_errors} lỗi)` : '') +
        (skippedLocked > 0 ? ` — bỏ qua ${skippedLocked} người đã khoá số công` : '')
      );
      await loadRecords();
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
        'Lỗi khi chốt công toàn bộ. Vui lòng thử lại.'
      );
    } finally {
      setFinalizingAll(false);
    }
  };

  const handleFinalizeDepartment = async () => {
    if (!selectedDepartment) return;
    const dept = departments.find((d) => d.id === Number(selectedDepartment));
    const deptName = dept ? dept.name : `Phòng ban #${selectedDepartment}`;
    if (!window.confirm(`Bạn có chắc muốn chốt công cho phòng ban "${deptName}" tháng ${selectedMonth}/${selectedYear}?`)) {
      return;
    }
    setFinalizingDepartment(true);
    setError(null);
    setSuccessMsg(null);
    setFinalizeDepartmentResult(null);
    try {
      const employeesRes = await employeesAPI.list({
        page_size: 1000,
        department: Number(selectedDepartment),
      });
      const eligibleEmployees = employeesRes.results.filter(shouldShowInWorkFinalizationList);

      const results: FinalizeAllResultItem[] = [];
      const errors: FinalizeAllErrorItem[] = [];
      let skippedLocked = 0;

      for (const emp of eligibleEmployees) {
        try {
          const finalizeRes = await workFinalizationService.finalize({
            employee_code: emp.employee_id,
            year: selectedYear,
            month: selectedMonth,
          });
          // Bản ghi đã khoá số công: backend giữ nguyên, không tính lại
          if (finalizeRes.skipped_locked) {
            skippedLocked += 1;
            continue;
          }
          results.push({
            employee_code: emp.employee_id,
            ho_va_ten: emp.full_name,
            created: finalizeRes.created,
          });
        } catch (err: any) {
          errors.push({
            employee_code: emp.employee_id,
            ho_va_ten: emp.full_name,
            error: err?.response?.data?.error || 'Không thể chốt công',
          });
        }
      }

      const res: FinalizeDepartmentResponse = {
        year: selectedYear,
        month: selectedMonth,
        department_id: Number(selectedDepartment),
        department_code: null,
        total_processed: results.length,
        total_errors: errors.length,
        results,
        errors,
      };

      setFinalizeDepartmentResult(res);
      setSuccessMsg(
        `Đã chốt công ${res.total_processed} nhân viên phòng ban "${deptName}" tháng ${selectedMonth}/${selectedYear}` +
        (res.total_errors > 0 ? ` (${res.total_errors} lỗi)` : '') +
        (skippedLocked > 0 ? ` — bỏ qua ${skippedLocked} người đã khoá số công` : '')
      );
      await loadRecords();
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
        'Lỗi khi chốt công phòng ban. Vui lòng thử lại.'
      );
    } finally {
      setFinalizingDepartment(false);
    }
  };

  const handleExport = async () => {
    if (records.length === 0) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(
        `Tháng ${selectedMonth}_${selectedYear}`
      );

      const HEADER_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FF4472C4' },
      };
      const HEADER_FONT = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 10,
      };
      const BORDER = {
        top: { style: 'thin' as const },
        left: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        right: { style: 'thin' as const },
      };

      const headers = [
        { header: 'STT', key: 'stt', width: 6 },
        { header: 'Mã NV', key: 'ma_nv', width: 10 },
        { header: 'Họ và Tên', key: 'ho_va_ten', width: 24 },
        { header: 'Phòng Ban', key: 'phong_ban', width: 18 },
        { header: 'Vị Trí', key: 'vi_tri', width: 18 },
        { header: 'Bác Sĩ', key: 'bac_si', width: 10 },
        { header: 'Ngày BĐ Làm Việc', key: 'ngay_bat_dau_lam_viec', width: 18 },
        { header: 'Ngày KT Thử Việc', key: 'ngay_ket_thuc_thu_viec', width: 18 },
        { header: 'ON/OFF', key: 'on_off', width: 8 },
        { header: 'Ngày Nghỉ Việc', key: 'ngay_nghi_viec', width: 16 },
        { header: 'Hình Thức LV', key: 'hinh_thuc_lam_viec', width: 14 },
        { header: 'Công Thử Việc', key: 'cong_thu_viec', width: 14 },
        { header: 'Công Chính Thức', key: 'cong_chinh_thuc', width: 16 },
        { header: 'Có Lễ', key: 'co_le', width: 10 },
        { header: 'Công Thực Tế', key: 'cong_thuc_te', width: 14 },
        { header: 'Tổng Công', key: 'tong_cong', width: 12 },
        { header: 'Nghỉ Phép', key: 'nghi_phep', width: 12 },
        { header: 'Nghỉ Không Phép', key: 'nghi_khong_phep', width: 14 },
        { header: 'Làm Việc Online', key: 'lam_viec_online', width: 14 },
        { header: 'Tổng Phạt', key: 'tong_phat', width: 14 },
        { header: 'Tăng Ca', key: 'tang_ca', width: 10 },
        { header: 'Làm Tối', key: 'lam_toi', width: 10 },
        { header: 'Trực Tối', key: 'truc_toi', width: 10 },
        { header: 'Làm Thêm Giờ', key: 'lam_them_gio', width: 14 },
        { header: 'Live', key: 'live', width: 8 },
        { header: 'Phụ Cấp Gửi Xe', key: 'phu_cap_gui_xe', width: 16 },
      ];

      sheet.columns = headers;

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER;
      });
      headerRow.height = 36;

      records.forEach((rec) => {
        const row = sheet.addRow({
          stt: rec.stt,
          ma_nv: rec.ma_nv,
          ho_va_ten: rec.ho_va_ten,
          phong_ban: rec.phong_ban ?? '',
          vi_tri: rec.vi_tri ?? '',
          bac_si: rec.bac_si ?? '',
          ngay_bat_dau_lam_viec: rec.ngay_bat_dau_lam_viec
            ? new Date(rec.ngay_bat_dau_lam_viec)
            : '',
          ngay_ket_thuc_thu_viec: rec.ngay_ket_thuc_thu_viec
            ? new Date(rec.ngay_ket_thuc_thu_viec)
            : '',
          on_off: rec.on_off ?? '',
          ngay_nghi_viec: rec.ngay_nghi_viec
            ? new Date(rec.ngay_nghi_viec)
            : '',
          hinh_thuc_lam_viec: rec.hinh_thuc_lam_viec ?? '',
          cong_thu_viec: rec.cong_thu_viec,
          cong_chinh_thuc: rec.cong_chinh_thuc,
          co_le: rec.co_le ?? '',
          cong_thuc_te: rec.cong_thuc_te,
          tong_cong: rec.tong_cong,
          nghi_phep: rec.nghi_phep,
          nghi_khong_phep: rec.nghi_khong_phep,
          lam_viec_online:rec.lam_viec_online,
          tong_phat: rec.tong_phat,
          tang_ca: rec.tang_ca,
          lam_toi: rec.lam_toi ?? '',
          truc_toi: rec.truc_toi,
          lam_them_gio: rec.lam_them_gio,
          live: rec.live,
          phu_cap_gui_xe: rec.phu_cap_gui_xe,
        });

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = BORDER;
          if (colNumber >= 12) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else {
            cell.alignment = { vertical: 'middle' };
          }
        });

        ['ngay_bat_dau_lam_viec', 'ngay_ket_thuc_thu_viec', 'ngay_nghi_viec'].forEach(
          (key) => {
            const col = headers.findIndex((h) => h.key === key) + 1;
            const cell = row.getCell(col);
            if (cell.value instanceof Date) {
              cell.numFmt = 'dd/mm/yyyy';
            }
          }
        );

        const tongPhatCol = headers.findIndex((h) => h.key === 'tong_phat') + 1;
        const phuCapCol = headers.findIndex((h) => h.key === 'phu_cap_gui_xe') + 1;
        row.getCell(tongPhatCol).numFmt = '#,##0';
        row.getCell(phuCapCol).numFmt = '#,##0';
      });

      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Bang_cham_cong_Thang${selectedMonth}_${selectedYear}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      setError('Không thể xuất file Excel. Vui lòng thử lại.');
    } finally {
      setExporting(false);
    }
  };

  const handlePreviewExport = () => {
    setShowPreviewModal(false);
    handleExport();
  };

  const handleExportDetail = async (deptIdsOverride?: number[]) => {
    const deptIds = deptIdsOverride || [];
    if (deptIds.length === 0 && !selectedDepartment && !debouncedSearchTerm) return;
    setExportingDetail(true);
    setError(null);
    try {
      const params: any = { year: selectedYear, month: selectedMonth };
      if (deptIds.length > 0) {
        params.department_ids = deptIds.join(',');
      } else if (selectedDepartment && selectedDepartment !== 'all') {
        params.department_id = Number(selectedDepartment);
      }
      if (debouncedSearchTerm) {
        params.employee_code = debouncedSearchTerm;
      }
      const res = await workFinalizationService.getDetailExport(params);

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(`Chi tiet Thang${selectedMonth}_${selectedYear}`);

      sheet.columns = [
        { header: 'Ngày', key: 'ngay', width: 14 },
        { header: 'Phòng Ban', key: 'phong_ban', width: 16 },
        { header: 'Họ và Tên', key: 'ho_va_ten', width: 24 },
        { header: 'Giờ Vào', key: 'gio_vao', width: 10 },
        { header: 'Giờ Ra', key: 'gio_ra', width: 10 },
        { header: 'Đơn Từ Trong Ngày', key: 'don_tu', width: 40 },
        { header: 'Nội Dung', key: 'noi_dung', width: 40 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' },
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      // Gộp theo Ngày → trong mỗi ngày gộp theo Phòng Ban, giống mẫu báo cáo chấm công theo ngày.
      interface FlatRow {
        date: string;
        day: number;
        phong_ban: string;
        ho_va_ten: string;
        gio_vao: string;
        gio_ra: string;
        don_tu: string;
        noi_dung: string;
      }
      const flatRows: FlatRow[] = [];
      res.results.forEach((emp) => {
        emp.days.forEach((d) => {
          flatRows.push({
            date: `${String(d.day).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}/${selectedYear}`,
            day: d.day,
            phong_ban: emp.phong_ban || '',
            ho_va_ten: emp.ho_va_ten,
            gio_vao: d.check_in || '',
            gio_ra: d.check_out || '',
            don_tu: d.requests.join('; '),
            noi_dung: d.request_contents.join('; '),
          });
        });
      });
      flatRows.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        const pb = a.phong_ban.localeCompare(b.phong_ban, 'vi');
        if (pb !== 0) return pb;
        return a.ho_va_ten.localeCompare(b.ho_va_ten, 'vi');
      });

      flatRows.forEach((r) => {
        sheet.addRow({
          ngay: r.date,
          phong_ban: r.phong_ban,
          ho_va_ten: r.ho_va_ten,
          gio_vao: r.gio_vao,
          gio_ra: r.gio_ra,
          don_tu: r.don_tu,
          noi_dung: r.noi_dung,
        });
      });

      // Kẻ khung + căn giữa cho toàn bộ vùng dữ liệu (kể cả ô sẽ bị merge).
      for (let i = 1; i <= flatRows.length; i++) {
        const row = sheet.getRow(i + 1);
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' },
          };
          cell.alignment = { vertical: 'middle', wrapText: true };
        });
      }

      // Gộp các ô liên tiếp có cùng giá trị trong 1 cột (dữ liệu đã được sort nên các ô cùng
      // nhóm luôn liền kề nhau).
      const mergeColumn = (colIndex: number, getKey: (r: FlatRow) => string) => {
        let start = 0;
        for (let i = 1; i <= flatRows.length; i++) {
          const boundary = i === flatRows.length || getKey(flatRows[i]) !== getKey(flatRows[start]);
          if (boundary) {
            const startRow = start + 2;
            const endRow = i + 1;
            if (endRow > startRow) {
              sheet.mergeCells(startRow, colIndex, endRow, colIndex);
            }
            sheet.getCell(startRow, colIndex).alignment = { vertical: 'middle', horizontal: 'center' };
            start = i;
          }
        }
      };
      mergeColumn(1, (r) => r.date);
      mergeColumn(2, (r) => `${r.date}|${r.phong_ban}`);

      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Chi_tiet_cham_cong_Thang${selectedMonth}_${selectedYear}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export detail error:', err);
      setError('Không thể xuất file chi tiết. Vui lòng thử lại.');
    } finally {
      setExportingDetail(false);
    }
  };

  const handleOpenViolationReport = async () => {
    setShowViolationModal(true);
    setLoadingViolation(true);
    setViolationReport(null);
    try {
      const res = await deptAttendanceViolationReportService.get({
        // Không chọn phòng ban cụ thể (hoặc "Tất cả phòng ban") -> bỏ department_id,
        // backend trả báo cáo gộp mọi phòng ban trong 1 lần.
        ...(selectedDepartment && selectedDepartment !== 'all'
          ? { department_id: Number(selectedDepartment) }
          : {}),
        year: selectedYear,
        month: selectedMonth,
      });
      setViolationReport(res);
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
        'Không thể tải báo cáo vi phạm. Vui lòng thử lại.'
      );
      setShowViolationModal(false);
    } finally {
      setLoadingViolation(false);
    }
  };

  const handleExportViolation = async () => {
    if (!violationReport) return;
    setExportingViolation(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(
        `Vi_Pham_T${violationReport.month}_${violationReport.year}`
      );

      const HEADER_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFD32F2F' },
      };
      const HEADER_FONT = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 10,
      };
      const BORDER = {
        top: { style: 'thin' as const },
        left: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        right: { style: 'thin' as const },
      };

      const headers = [
        { header: 'Mã NV', key: 'ma_nhan_vien', width: 12 },
        { header: 'Tên Nhân Viên', key: 'ten_nhan_vien', width: 24 },
        { header: 'Phòng Ban', key: 'phong_ban', width: 18 },
        { header: 'Chức Danh', key: 'chuc_danh', width: 16 },
        { header: 'Vị Trí', key: 'vi_tri', width: 16 },
        { header: 'Bác Sĩ', key: 'bac_si', width: 16 },
        { header: 'Tổng Công', key: 'tong_cong', width: 12 },
        { header: 'Số Lần Vi Phạm', key: 'so_lan_vi_pham', width: 16 },
        { header: 'Số Lần Đi Muộn', key: 'so_lan_di_muon', width: 16 },
        { header: 'Số Lần Về Sớm', key: 'so_lan_ve_som', width: 16 },
        { header: 'Quên Chấm Công', key: 'so_lan_quen_cham_cong', width: 16 },
      ];
      const firstNumericCol = headers.findIndex((h) => h.key === 'tong_cong') + 1;

      sheet.columns = headers;

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER;
      });
      headerRow.height = 36;

      violationReport.data.forEach((item, idx) => {
        const row = sheet.addRow({
          ma_nhan_vien: item.ma_nhan_vien,
          ten_nhan_vien: item.ten_nhan_vien,
          phong_ban: item.phong_ban,
          chuc_danh: item.chuc_danh,
          vi_tri: item.vi_tri,
          bac_si: item.bac_si,
          tong_cong: item.tong_cong,
          so_lan_vi_pham: item.so_lan_vi_pham,
          so_lan_di_muon: item.so_lan_di_muon,
          so_lan_ve_som: item.so_lan_ve_som,
          so_lan_quen_cham_cong: item.so_lan_quen_cham_cong,
        });

        const isEvenRow = idx % 2 === 0;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = BORDER;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isEvenRow ? 'FFFFFFFF' : 'FFFFF8F8' },
          };
          if (colNumber >= firstNumericCol) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else {
            cell.alignment = { vertical: 'middle' };
          }
        });
      });

      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BaoCao_ViPham_${violationReport.department_name}_T${violationReport.month}_${violationReport.year}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export violation error:', err);
      setError('Không thể xuất file Excel báo cáo vi phạm. Vui lòng thử lại.');
    } finally {
      setExportingViolation(false);
    }
  };

  // --- Daily detail pivot helpers ---
  const formatDailyCredit = (item: DailySummaryItem): string => {
    const c = item.work_credit;
    if (item.day_type === 'L') return c ? `${c} L` : 'L';
    if (item.day_type === 'P') return c ? `${c} P` : '';
    if (item.day_type === 'OLW') return c ? `${c} OLW` : '';
    if (item.day_type === 'KP') return 'KP';
    if (c > 0) return String(c);
    return '';
  };

  const dailyPivotRecords = useMemo(() =>
    records.filter((r) => r.daily_summary && r.daily_summary.length > 0),
    [records]
  );

  const pivotDayHeaders = useMemo(() => {
    if (dailyPivotRecords.length === 0) return [];
    const first = dailyPivotRecords[0].daily_summary!;
    return first.map((d) => ({
      day: d.day,
      label: `${String(d.day).padStart(2, '0')}(${d.weekday_label.replace('Thứ ', 'T').replace('Chủ nhật', 'CN')})`,
    }));
  }, [dailyPivotRecords]);

  const handleExportDailyPivot = async () => {
    if (dailyPivotRecords.length === 0) return;
    setExportingDaily(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const dept = departments.find((d) => d.id === Number(selectedDepartment));
      const sheetLabel = dept ? dept.name : 'TatCa';
      const sheet = workbook.addWorksheet(`ChiTiet_${sheetLabel}_T${selectedMonth}_${selectedYear}`);

      const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF4472C4' } };
      const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      const BORDER = {
        top: { style: 'thin' as const }, left: { style: 'thin' as const },
        bottom: { style: 'thin' as const }, right: { style: 'thin' as const },
      };

      // Color fills for day_type
      const FILL_P = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF3E0' } };
      const FILL_OL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE0F7FA' } };
      const FILL_L = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE3F2FD' } };
      const FILL_KP = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFCE4EC' } };

      // Build headers
      const dayLabels = pivotDayHeaders.map((h) => h.label);

      const FIXED_COLS = 5; // STT, Mã NV, Họ Tên, Phòng Ban, Vị Trí
      sheet.columns = [
        { header: 'STT', key: 'stt', width: 6 },
        { header: 'Mã NV', key: 'ma_nv', width: 10 },
        { header: 'Họ và Tên', key: 'ho_va_ten', width: 24 },
        { header: 'Phòng Ban', key: 'phong_ban', width: 18 },
        { header: 'Vị Trí', key: 'vi_tri', width: 18 },
        ...dayLabels.map((lbl, i) => ({ header: lbl, key: `d${i + 1}`, width: 8 })),
        { header: 'Tổng', key: 'tong', width: 8 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER;
      });
      headerRow.height = 32;

      dailyPivotRecords.forEach((rec, idx) => {
        const rowData: Record<string, any> = {
          stt: idx + 1,
          ma_nv: rec.ma_nv,
          ho_va_ten: rec.ho_va_ten,
          phong_ban: rec.phong_ban ?? '',
          vi_tri: rec.vi_tri ?? '',
          tong: rec.tong_cong,
        };
        (rec.daily_summary || []).forEach((d, i) => {
          if (d.day_type === 'L' || d.day_type === 'KP') {
            rowData[`d${i + 1}`] = d.work_credit > 0 ? d.work_credit : 0;
          } else {
            rowData[`d${i + 1}`] = d.work_credit > 0 ? d.work_credit : null;
          }
        });

        const row = sheet.addRow(rowData);
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = BORDER;
          cell.alignment = { vertical: 'middle', horizontal: colNumber <= FIXED_COLS ? 'left' : 'center' };
        });

        // Apply day_type coloring + custom number format
        (rec.daily_summary || []).forEach((d, i) => {
          const cell = row.getCell(FIXED_COLS + 1 + i);
          if (d.day_type === 'P') {
            cell.fill = FILL_P;
            cell.numFmt = '0.## "P"';
          } else if (d.day_type === 'OLW') {
            cell.fill = FILL_OL;
            cell.numFmt = '0.## "OLW"';
          } else if (d.day_type === 'L') {
            cell.fill = FILL_L;
            cell.numFmt = '0.## "L"';
          } else if (d.day_type === 'KP') {
            cell.fill = FILL_KP;
            cell.numFmt = '"KP"';
          }
        });
      });

      sheet.views = [{ state: 'frozen', xSplit: FIXED_COLS, ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BangCong_ChiTiet_${sheetLabel}_T${selectedMonth}_${selectedYear}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export daily pivot error:', err);
      setError('Không thể xuất file Excel bảng công chi tiết. Vui lòng thử lại.');
    } finally {
      setExportingDaily(false);
    }
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const finalizedRec = useMemo(() =>
    selectedEmployee ? recordsMap.get(selectedEmployee.employee_id) : undefined
  , [selectedEmployee, recordsMap]);

  if (userRole !== 'ADMIN' && userRole !== 'HR' && !isManagerRestricted) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Bạn không có quyền truy cập trang này.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Chốt Công</h1>
          <p className="mt-0.5 text-sm text-gray-900">
            Quản lý bảng tính công hàng tháng và xuất báo cáo tính lương
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Trưởng phòng (is_manager) chỉ được XEM trang này — ẩn toàn bộ nút
              Khóa/Chốt/Phê duyệt (mang tính thao tác/thay đổi dữ liệu lương). */}
          {!isManagerRestricted && (
          <>
          {/* Nút Đóng/Mở chốt công — 2 nửa tháng */}
          {(['FIRST_HALF', 'SECOND_HALF'] as LockPeriod[]).map((period) => {
            const target = period === 'FIRST_HALF' ? firstHalf : secondHalf;
            const locked = target?.is_locked ?? false;
            const label = period === 'FIRST_HALF' ? 'nửa đầu (1-15)' : 'nửa sau (16-cuối)';
            return (
              <React.Fragment key={period}>
                <button
                  onClick={() => openLockConfirm(period)}
                  disabled={togglingLock}
                  className={`inline-flex items-center px-3 py-2 border rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    locked
                      ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100 focus:ring-red-500'
                      : 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 focus:ring-emerald-500'
                  }`}
                >
                  {locked ? <LockClosedIcon className="w-4 h-4 mr-2" /> : <LockOpenIcon className="w-4 h-4 mr-2" />}
                  {locked
                    ? `Đang khóa ${label}`
                    : target?.lock_start_at
                      ? `Hẹn khóa ${label} ${new Date(target.lock_start_at).toLocaleDateString('vi-VN')}`
                      : `Đang mở ${label}`}
                </button>
                {!locked && target?.lock_start_at && (
                  <button
                    onClick={() => handleCancelSchedule(period)}
                    disabled={togglingLock}
                    className="inline-flex items-center px-2 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`Hủy hẹn khóa ${label}`}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )}
              </React.Fragment>
            );
          })}

          <button
            onClick={openEmployeeOverrideModal}
            className="inline-flex items-center px-3 py-2 border border-amber-300 rounded-md shadow-sm text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
            title="Khóa/Mở khóa tạo đơn giải trình riêng cho 1 hoặc 1 số nhân viên"
          >
            <UserIcon className="w-4 h-4 mr-2" />
            Khóa/Mở khóa theo NV
          </button>

          <Link
            to="/dashboard/work-finalization/approvals"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <ClipboardDocumentCheckIcon className="w-4 h-4 mr-2" />
            Phê duyệt chốt công
          </Link>
          <button
            onClick={handleFinalizeAll}
            disabled={!bothLocked || finalizingAll || finalizingDepartment || finalizing !== null || exporting}
            title={!bothLocked ? 'Cần khóa cả 2 nửa tháng trước khi chốt tất cả' : undefined}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BoltIcon className="w-4 h-4 mr-2" />
            {finalizingAll ? 'Đang chốt...' : `Chốt tất cả (Tháng ${selectedMonth}/${selectedYear})`}
          </button>
          {selectedDepartment && selectedDepartment !== 'all' && (
            <button
              onClick={handleFinalizeDepartment}
              disabled={!bothLocked || finalizingDepartment || finalizingAll || finalizing !== null || exporting}
              title={!bothLocked ? 'Cần khóa cả 2 nửa tháng trước khi chốt phòng ban' : undefined}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <BoltIcon className="w-4 h-4 mr-2" />
              {finalizingDepartment
                ? 'Đang chốt...'
                : `Chốt phòng ban (Tháng ${selectedMonth}/${selectedYear})`}
            </button>
          )}
          </>
          )}
          <button
            onClick={() => setShowPreviewModal(true)}
            disabled={records.length === 0}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <EyeIcon className="w-4 h-4 mr-2" />
            Xem trước
          </button>
          <button
            onClick={() => setShowDailyPreviewModal(true)}
            disabled={dailyPivotRecords.length === 0}
            className="inline-flex items-center px-4 py-2 border border-primary-300 rounded-md shadow-sm text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <TableCellsIcon className="w-4 h-4 mr-2" />
            {`Bảng công chi tiết (${dailyPivotRecords.length})`}
          </button>
          <button
            onClick={handleOpenViolationReport}
            disabled={loadingViolation}
            className="inline-flex items-center px-4 py-2 border border-amber-300 rounded-md shadow-sm text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ShieldExclamationIcon className="w-4 h-4 mr-2" />
            {loadingViolation ? 'Đang tải...' : 'Báo cáo vi phạm'}
          </button>
          <button
            onClick={() => setShowAttendanceAnomalyModal(true)}
            disabled={employees.length === 0 && records.length === 0}
            className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ExclamationCircleIcon className="w-4 h-4 mr-2" />
            {`Bất thường chấm công (${totalAttendanceAnomalies})`}
          </button>
          {!isManagerRestricted && (
          <>
          <button
            onClick={handleExport}
            disabled={exporting || records.length === 0}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
            {exporting ? 'Đang xuất...' : `Xuất Excel (${records.length} đã chốt)`}
          </button>
          <button
            onClick={() => {
              if (debouncedSearchTerm) {
                // Tìm theo nhân viên cụ thể → xuất luôn, không cần chọn phòng ban
                handleExportDetail();
                return;
              }
              setExportDeptIds(
                selectedDepartment && selectedDepartment !== 'all' ? [Number(selectedDepartment)] : []
              );
              setShowExportDeptModal(true);
            }}
            disabled={exportingDetail || (departments.length === 0 && !debouncedSearchTerm)}
            title="Xuất chi tiết giờ vào/ra và đơn từ từng ngày"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
            {exportingDetail ? 'Đang xuất...' : 'Xuất chi tiết'}
          </button>
          </>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center p-4 text-sm text-red-800 bg-red-50 rounded-2xl border border-red-200">
          <ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center p-4 text-sm text-emerald-800 bg-emerald-50 rounded-2xl border border-emerald-200">
          <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Lock banner — chỉ hiện khi có ít nhất 1 nửa khóa */}
      {anyLocked && (
        <div className="flex items-center justify-between p-4 text-sm bg-red-50 rounded-2xl border border-red-200">
          <div className="flex items-center gap-2 text-red-800">
            <LockClosedIcon className="w-5 h-5 flex-shrink-0" />
            <div>
              <span className="font-semibold">
                Tháng {selectedMonth}/{selectedYear}:{' '}
                {firstHalfLocked ? 'nửa đầu (1-15) đã khóa' : 'nửa đầu (1-15) đang mở'},{' '}
                {secondHalfLocked ? 'nửa sau (16-cuối) đã khóa' : 'nửa sau (16-cuối) đang mở'}.
              </span>
              <span className="ml-1">
                Tạo đơn / phê duyệt cho ngày thuộc nửa đã khóa sẽ bị chặn.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Finalize-all result summary */}
      {finalizeAllResult && (
        <div className="bg-white shadow-sm rounded-2xl p-4 border border-primary-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <BoltIcon className="w-4 h-4 text-primary-500" />
              Kết quả chốt công toàn công ty — Tháng {finalizeAllResult.month}/{finalizeAllResult.year}
            </span>
            <button
              onClick={() => setFinalizeAllResult(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Đóng
            </button>
          </div>
          <div className="flex gap-4 text-sm mb-3">
            <span className="text-emerald-700 font-medium">✓ Đã xử lý: {finalizeAllResult.total_processed}</span>
            {finalizeAllResult.total_errors > 0 && (
              <span className="text-red-600 font-medium">✗ Lỗi: {finalizeAllResult.total_errors}</span>
            )}
          </div>
          {finalizeAllResult.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-red-700 mb-1">Chi tiết lỗi:</p>
              <ul className="space-y-1">
                {finalizeAllResult.errors.map((e) => (
                  <li key={e.employee_code} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                    <span className="font-mono">{e.employee_code}</span> — {e.ho_va_ten}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Finalize-department result summary */}
      {finalizeDepartmentResult && (
        <div className="bg-white shadow-sm rounded-2xl p-4 border border-violet-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <BoltIcon className="w-4 h-4 text-violet-500" />
              Kết quả chốt công phòng ban — Tháng {finalizeDepartmentResult.month}/{finalizeDepartmentResult.year}
            </span>
            <button
              onClick={() => setFinalizeDepartmentResult(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Đóng
            </button>
          </div>
          <div className="flex gap-4 text-sm mb-3">
            <span className="text-emerald-700 font-medium">✓ Đã xử lý: {finalizeDepartmentResult.total_processed}</span>
            {finalizeDepartmentResult.total_errors > 0 && (
              <span className="text-red-600 font-medium">✗ Lỗi: {finalizeDepartmentResult.total_errors}</span>
            )}
          </div>
          {finalizeDepartmentResult.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-red-700 mb-1">Chi tiết lỗi:</p>
              <ul className="space-y-1">
                {finalizeDepartmentResult.errors.map((e) => (
                  <li key={e.employee_code} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                    <span className="font-mono">{e.employee_code}</span> — {e.ho_va_ten}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        <div className="flex items-center mb-3">
          <FunnelIcon className="w-4 h-4 mr-2 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Bộ lọc & Tìm kiếm</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <SelectBox
            label="Tháng"
            value={selectedMonth}
            options={months.map((m) => ({ value: m, label: `Tháng ${m}` }))}
            onChange={(v) => setSelectedMonth(v)}
          />
          <SelectBox
            label="Năm"
            value={selectedYear}
            options={years.map((y) => ({ value: y, label: String(y) }))}
            onChange={(v) => setSelectedYear(v)}
          />
          <SelectBox
            label="Phòng Ban"
            value={selectedDepartment}
            options={[
              { value: '', label: 'Chưa chọn phòng ban' },
              { value: 'all', label: 'Tất cả phòng ban' },
              ...departments.map((d) => ({ value: String(d.id), label: d.name })),
            ]}
            onChange={(v) => {
              setSelectedDepartment(v);
              setSelectedEmployee(null);
            }}
          />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tìm kiếm</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setSelectedEmployee(null);
                }}
                placeholder="Tên hoặc mã NV..."
                className="block w-full pl-10 pr-10 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedEmployee(null);
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { loadEmployees(); loadRecords(); }}
              className="inline-flex items-center px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <ArrowPathIcon className="w-4 h-4 mr-1" />
              Làm mới
            </button>
          </div>
        </div>
      </div>

      {/* Main two-panel layout */}
      <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
        {/* Left: Employee list — giới hạn chiều cao + tự cuộn riêng (thay vì để
            danh sách 399 NV kéo dài cả khối 2 cột), và `self-start` để không bị
            "stretch" theo — nhờ đó khối bên phải không còn bị kéo giãn theo
            chiều cao rất lớn của danh sách và luôn nằm gọn trong khung nhìn. */}
        <div className="w-full lg:w-80 lg:flex-shrink-0 lg:self-start lg:max-h-[calc(100vh-6rem)] bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">
              Danh sách nhân sự
            </span>
            <span className="text-xs text-gray-500">
              {employees.length} NV · {records.length} đã chốt
            </span>
          </div>
          {loadingEmployees ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-4 text-center">
              {searchTerm ? 'Không tìm thấy kết quả phù hợp' : 'Không có nhân viên nào'}
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {employees.map((emp) => (
                <EmployeeListItem
                  key={emp.id}
                  emp={emp}
                  rec={recordsMap.get(emp.employee_id)}
                  isSelected={selectedEmployee?.id === emp.id}
                  isBeingFinalized={finalizing === emp.employee_id}
                  isLocked={isLocked}
                  canBypassLock={canBypassLock}
                  onSelect={handleSelectEmployee}
                  onFinalize={handleFinalize}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Right: Calendar / Detail panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!selectedEmployee ? (
            <div className="flex-1 bg-white shadow-sm rounded-2xl border border-gray-100 flex flex-col items-center justify-center text-gray-400 p-10">
              <CalendarIcon className="h-16 w-16 mb-4 text-gray-200" />
              <p className="text-base font-medium">Chọn một nhân viên</p>
              <p className="text-sm mt-1">để xem lịch chấm công</p>
            </div>
          ) : (
            <>
              {/* Employee info bar */}
              <div className="bg-white shadow-sm rounded-2xl border border-gray-100 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                    <UserIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{selectedEmployee.full_name}</p>
                    <p className="text-xs text-gray-500 font-mono">
                      {selectedEmployee.employee_id}
                      {selectedEmployee.department && ` · ${selectedEmployee.department.name}`}
                      {selectedEmployee.position && ` · ${selectedEmployee.position.title}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {finalizedRec ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-700">
                      <CheckCircleIcon className="w-4 h-4 mr-1" />
                      Đã chốt công tháng {selectedMonth}/{selectedYear}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-800">
                      Chưa chốt công tháng {selectedMonth}/{selectedYear}
                    </span>
                  )}
                  {!isManagerRestricted && (
                  <button
                    onClick={() => handleFinalize(selectedEmployee)}
                    disabled={(isLocked && !canBypassLock) || finalizing === selectedEmployee.employee_id}
                    title={isLocked ? 'Tháng này đã khóa chốt công' : undefined}
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {finalizing === selectedEmployee.employee_id ? (
                      <ArrowPathIcon className="w-4 h-4 animate-spin mr-1" />
                    ) : isLocked ? (
                      <LockClosedIcon className="w-4 h-4 mr-1" />
                    ) : (
                      <CheckCircleIcon className="w-4 h-4 mr-1" />
                    )}
                    {finalizedRec ? 'Chốt lại' : 'Chốt công'}
                  </button>
                  )}
                </div>
              </div>

              {/* Lịch chấm công + xem/sửa chi tiết ngày — dùng chung khối với
                  tab "Nhân viên" (AttendanceView.tsx), theo yêu cầu HCNS
                  2026-09-21 "đang có tình trạng lặp lại khá nhiều giữa chấm
                  công tab nhân viên và chốt công". Không hiện KPI live ở đây
                  vì bên dưới đã có "Kết quả chốt công" (snapshot đã khoá). */}
              <EmployeeMonthAttendance
                employeeId={selectedEmployee.id}
                year={selectedYear}
                month={selectedMonth}
                onMonthChange={(y, m) => { setSelectedYear(y); setSelectedMonth(m); }}
                showKpiCards={false}
              />

              {/* Finalization details if finalized */}
              {finalizedRec && (
                <div className="bg-white shadow-sm rounded-2xl border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">
                    Kết quả chốt công tháng {selectedMonth}/{selectedYear}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                    {[
                      // Công thử việc/chính thức từ BE đã gồm công lễ theo ngày kết thúc thử
                      // việc (cùng số với Excel và bảng lương); ô "Công lễ" vẫn hiển thị riêng.
                      { label: 'Công thử việc', value: `${finalizedRec.cong_thu_viec} công`, cardCls: 'bg-primary-50', labelCls: 'text-primary-700', valCls: 'text-primary-800 font-bold' },
                      { label: 'Công chính thức', value: `${finalizedRec.cong_chinh_thuc} công`, cardCls: 'bg-primary-50', labelCls: 'text-primary-700', valCls: 'text-primary-800 font-bold' },
                      {
                        // Phần công lễ rơi vào thời gian thử việc đã nằm trong "Công thử việc" ở trên.
                        label: Number(finalizedRec.co_le_thu_viec || 0) > 0
                          ? `Công lễ (${finalizedRec.co_le_thu_viec} trong thử việc)`
                          : 'Công lễ',
                        value: `${finalizedRec.co_le ?? 0} công`, cardCls: 'bg-sky-50', labelCls: 'text-sky-700', valCls: 'text-sky-800 font-bold',
                      },
                      { label: 'Công thực tế', value: `${finalizedRec.cong_thuc_te} công`, cardCls: 'bg-emerald-50', labelCls: 'text-emerald-700', valCls: 'text-emerald-800 font-bold' },
                      { label: 'Tổng công', value: `${finalizedRec.tong_cong} công`, cardCls: 'bg-emerald-50', labelCls: 'text-emerald-700', valCls: 'text-emerald-800 font-extrabold' },
                      { label: 'Nghỉ phép tháng', value: `${finalizedRec.nghi_phep} ngày`, cardCls: 'bg-primary-50/50', labelCls: 'text-primary-700', valCls: 'text-primary-800 font-bold' },
                      { label: 'Nghỉ không phép', value: `${finalizedRec.nghi_khong_phep ?? 0} ngày`, cardCls: 'bg-indigo-50', labelCls: 'text-indigo-700', valCls: 'text-indigo-800 font-bold' },
                      { label: 'Làm việc online', value: `${finalizedRec.lam_viec_online ?? 0} ngày`, cardCls: 'bg-primary-50', labelCls: 'text-primary-700', valCls: 'text-primary-800 font-bold' },
                      { label: 'Tăng ca', value: `${finalizedRec.tang_ca} giờ`, cardCls: 'bg-amber-50', labelCls: 'text-amber-700', valCls: 'text-amber-800 font-bold' },
                      { label: 'Trực tối', value: `${finalizedRec.truc_toi} buổi`, cardCls: 'bg-violet-50', labelCls: 'text-violet-700', valCls: 'text-violet-800 font-bold' },
                      { label: 'Làm thêm giờ', value: `${finalizedRec.lam_them_gio} giờ`, cardCls: 'bg-amber-50', labelCls: 'text-amber-700', valCls: 'text-amber-800 font-bold' },
                      { label: 'Live', value: `${finalizedRec.live} ca`, cardCls: 'bg-pink-50', labelCls: 'text-pink-700', valCls: 'text-pink-800 font-bold' },
                      { label: 'PC Gửi xe', value: `${formatNumber(finalizedRec.phu_cap_gui_xe)}đ`, cardCls: 'bg-emerald-50', labelCls: 'text-emerald-700', valCls: 'text-emerald-800 font-bold' },
                      { label: 'Tổng phạt', value: `${formatNumber(finalizedRec.tong_phat)}đ`, cardCls: 'bg-red-50', labelCls: 'text-red-700', valCls: 'text-red-800 font-bold' },
                    ].map((item) => (
                      <div key={item.label} className={`${item.cardCls} rounded-2xl p-3`}>
                        <p className={`text-xs font-medium ${item.labelCls}`}>{item.label}</p>
                        <p className={`text-lg mt-0.5 ${item.valCls}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Chọn phòng ban trước khi xuất chi tiết */}
      {showExportDeptModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4 max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Chọn phòng ban để xuất</h3>
              <button type="button" onClick={() => setShowExportDeptModal(false)}>
                <XMarkIcon className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <p className="text-xs text-gray-500">
              File xuất sẽ được sắp xếp ưu tiên theo Ngày → Phòng ban.
            </p>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={exportDeptIds.length === 0}
                onChange={() => setExportDeptIds([])}
              />
              Tất cả phòng ban
            </label>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {departments.map((d) => (
                <label
                  key={d.id}
                  className="flex items-center gap-2 text-sm text-gray-700 py-1 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={exportDeptIds.includes(d.id)}
                    onChange={() =>
                      setExportDeptIds((prev) =>
                        prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                      )
                    }
                  />
                  {d.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExportDeptModal(false)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExportDeptModal(false);
                  handleExportDetail(exportDeptIds);
                }}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700"
              >
                <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                Xuất file
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <EyeIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Xem trước dữ liệu Excel
                  </h2>
                  <p className="text-xs text-gray-500">
                    Tháng {selectedMonth}/{selectedYear} · {records.length} bản ghi đã chốt
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {[
                      'STT', 'Mã NV', 'Họ và Tên', 'Phòng Ban', 'Vị Trí',
                      'Bác Sĩ', 'Ngày BĐ Làm Việc', 'Ngày KT Thử Việc',
                      'ON/OFF', 'Ngày Nghỉ Việc', 'Hình Thức LV',
                      'Công Thử Việc', 'Công Chính Thức', 'Có Lễ',
                      'Công Thực Tế', 'Tổng Công', 'Nghỉ Phép', 'Nghỉ Không Phép',
                      'Làm Việc Online', 'Tổng Phạt', 'Tăng Ca',
                      'Làm Tối', 'Trực Tối', 'Làm Thêm Giờ', 'Live',
                      'Phụ Cấp Gửi Xe',
                    ].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-3 py-2 text-center font-semibold text-white bg-primary-700 border border-primary-800"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec, idx) => {
                    const rowCls = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                    return (
                      <tr key={rec.ma_nv} className={`${rowCls} hover:bg-primary-50 transition-colors`}>
                        <td className="px-3 py-1.5 text-center border border-gray-200">{rec.stt}</td>
                        <td className="px-3 py-1.5 font-mono border border-gray-200">{rec.ma_nv}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{rec.ho_va_ten}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{rec.phong_ban ?? '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{rec.vi_tri ?? '—'}</td>
                        <td className="px-3 py-1.5 text-center border border-gray-200">{rec.bac_si ?? '—'}</td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap border border-gray-200">{formatDate(rec.ngay_bat_dau_lam_viec)}</td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap border border-gray-200">{formatDate(rec.ngay_ket_thuc_thu_viec)}</td>
                        <td className="px-3 py-1.5 text-center border border-gray-200">{rec.on_off ?? '—'}</td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap border border-gray-200">{formatDate(rec.ngay_nghi_viec)}</td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap border border-gray-200">{rec.hinh_thuc_lam_viec ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.cong_thu_viec}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.cong_chinh_thuc}</td>
                        <td className="px-3 py-1.5 text-center border border-gray-200">{rec.co_le ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.cong_thuc_te}</td>
                        <td className="px-3 py-1.5 text-right font-semibold border border-gray-200">{rec.tong_cong}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.nghi_phep}</td>
                        <td className={`px-3 py-1.5 text-right border border-gray-200 ${(rec.nghi_khong_phep ?? 0) > 0 ? 'font-semibold text-indigo-800 bg-indigo-50' : ''}`}>{rec.nghi_khong_phep ?? 0}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.lam_viec_online ?? 0}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{formatNumber(rec.tong_phat)}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.tang_ca}</td>
                        <td className="px-3 py-1.5 text-center border border-gray-200">{rec.lam_toi ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.truc_toi}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.lam_them_gio}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{rec.live}</td>
                        <td className="px-3 py-1.5 text-right border border-gray-200">{formatNumber(rec.phu_cap_gui_xe)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <span className="text-xs text-gray-500">
                Hiển thị {records.length} bản ghi · Tháng {selectedMonth}/{selectedYear}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePreviewExport}
                  disabled={exporting}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowDownTrayIcon className="w-4 h-4 mr-1.5" />
                  {exporting ? 'Đang xuất...' : 'Xuất Excel'}
                </button>
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Violation Report Modal */}
      {showViolationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                  <ShieldExclamationIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Báo cáo vi phạm chấm công
                  </h2>
                  {violationReport && (
                    <p className="text-xs text-gray-500">
                      {violationReport.department_name} · Tháng {violationReport.month}/{violationReport.year} ·{' '}
                      {violationReport.total_violations} vi phạm / {violationReport.total_employees} nhân viên
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowViolationModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {loadingViolation ? (
                <div className="flex items-center justify-center h-40">
                  <ArrowPathIcon className="w-6 h-6 animate-spin text-amber-500" />
                  <span className="ml-2 text-sm text-gray-500">Đang tải dữ liệu...</span>
                </div>
              ) : violationReport && violationReport.data.length > 0 ? (
                <table className="min-w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {[
                        'Mã NV', 'Tên Nhân Viên', 'Phòng Ban', 'Chức Danh',
                        'Vị Trí', 'Bác Sĩ', 'Tổng Công', 'Số Lần VP',
                        'Số Lần Đi Muộn', 'Số Lần Về Sớm', 'Quên Chấm Công',
                      ].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-3 py-2 text-center font-semibold text-white bg-red-700 border border-red-800"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {violationReport.data.map((item, idx) => {
                      const rowCls = idx % 2 === 0 ? 'bg-white' : 'bg-red-50';
                      return (
                        <tr key={`${item.ma_nhan_vien}-${idx}`} className={`${rowCls} hover:bg-amber-50 transition-colors`}>
                          <td className="px-3 py-1.5 font-mono border border-gray-200">{item.ma_nhan_vien}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{item.ten_nhan_vien}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{item.phong_ban}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{item.chuc_danh}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{item.vi_tri}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">{item.bac_si}</td>
                          <td className="px-3 py-1.5 text-right border border-gray-200">{item.tong_cong}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-red-700 border border-gray-200">{item.so_lan_vi_pham}</td>
                          <td className="px-3 py-1.5 text-right border border-gray-200">{item.so_lan_di_muon}</td>
                          <td className="px-3 py-1.5 text-right border border-gray-200">{item.so_lan_ve_som}</td>
                          <td className="px-3 py-1.5 text-right border border-gray-200">{item.so_lan_quen_cham_cong}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center justify-center h-40">
                  <p className="text-sm text-gray-500">Không có dữ liệu vi phạm.</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <span className="text-xs text-gray-500">
                {violationReport
                  ? `${violationReport.total_violations} vi phạm · Tháng ${violationReport.month}/${violationReport.year}`
                  : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportViolation}
                  disabled={exportingViolation || !violationReport || violationReport.data.length === 0}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowDownTrayIcon className="w-4 h-4 mr-1.5" />
                  {exportingViolation ? 'Đang xuất...' : 'Tải Excel'}
                </button>
                <button
                  onClick={() => setShowViolationModal(false)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lock Confirm Modal */}
      {lockConfirmPeriod && (() => {
        const periodLabel = lockConfirmPeriod === 'FIRST_HALF' ? 'nửa đầu (1-15)' : 'nửa sau (16-cuối)';
        const willLock = !periodConfirmLocked;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className={`px-6 py-4 flex items-center gap-3 ${!willLock ? 'bg-emerald-50 border-b border-emerald-200' : 'bg-red-50 border-b border-red-200'}`}>
              {!willLock ? (
                <LockOpenIcon className="w-6 h-6 text-emerald-600" />
              ) : (
                <LockClosedIcon className="w-6 h-6 text-red-600" />
              )}
              <div>
                <h3 className={`text-base font-semibold ${!willLock ? 'text-emerald-900' : 'text-red-900'}`}>
                  {!willLock ? `Mở khóa ${periodLabel}` : `Khóa ${periodLabel}`}
                </h3>
                <p className="text-sm text-gray-600">
                  Tháng {selectedMonth}/{selectedYear}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="text-sm text-gray-700">
                {!willLock ? (
                  <p>
                    Mở khóa <strong>{periodLabel}</strong> tháng {selectedMonth}/{selectedYear} sẽ cho phép <strong>tạo đơn</strong> và <strong>phê duyệt</strong> trở lại cho các ngày trong khoảng này.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p>Khóa <strong>{periodLabel}</strong> tháng {selectedMonth}/{selectedYear} sẽ ảnh hưởng như sau:</p>
                    <ul className="text-xs space-y-1 ml-1">
                      <li className="flex items-start gap-1.5">
                        <span className="text-red-500 mt-0.5 font-bold">✕</span>
                        <span><strong>Nhân viên, Quản lý:</strong> Không thể tạo đơn / phê duyệt cho ngày thuộc {periodLabel}</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-amber-500 mt-0.5 font-bold">⚡</span>
                        <span><strong>Admin / HR:</strong> Vẫn bypass theo cấu hình hiện tại</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-blue-500 mt-0.5 font-bold">ℹ</span>
                        <span>Chốt tất cả / Chốt phòng ban chỉ cho phép khi <strong>cả 2 nửa</strong> đã khóa.</span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>

              {/* Đặt lịch tự động */}
              <div className="rounded-2xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <ClockIcon className="w-4 h-4 text-primary-500" />
                    Đặt lịch tự động
                  </div>
                  {lockStartAt && (
                    <button
                      type="button"
                      onClick={() => setLockStartAt('')}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                      Xóa lịch
                    </button>
                  )}
                </div>

                <div className="p-3 space-y-3">
                  {lockStartAt ? (
                    <div className="flex items-start gap-3 bg-primary-50 rounded-xl px-3 py-2.5">
                      <div className="flex-shrink-0 mt-0.5 h-7 w-7 rounded-full bg-primary-100 flex items-center justify-center">
                        <ClockIcon className="w-4 h-4 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0 text-xs">
                        <p className="font-medium text-primary-800 mb-1">Lịch đã đặt</p>
                        <p className="text-primary-700">
                          <span className="text-primary-500">Tự động khóa lúc:</span>{' '}
                          <strong>{new Date(lockStartAt).toLocaleString('vi-VN')}</strong>
                        </p>
                        <p className="text-amber-600 mt-0.5">
                          Mở khóa thủ công khi cần.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      Bắt đầu khóa
                    </label>
                    <input
                      type="datetime-local"
                      value={lockStartAt}
                      onChange={(e) => setLockStartAt(e.target.value)}
                      className="block w-full text-sm border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

                  {!lockStartAt && (
                    <p className="text-xs text-gray-400 italic">
                      Để trống nếu muốn khóa/mở thủ công.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Ghi chú (tùy chọn)
                </label>
                <textarea
                  value={lockNote}
                  onChange={(e) => setLockNote(e.target.value)}
                  placeholder={!willLock ? 'Lý do mở khóa...' : 'Lý do khóa...'}
                  rows={2}
                  className="block w-full text-sm border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {periodConfirmStatus?.locked_by && periodConfirmLocked && (
                <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-md px-3 py-2">
                  <ClockIcon className="w-4 h-4" />
                  <span>
                    Khóa bởi <strong>{periodConfirmStatus.locked_by}</strong>
                    {periodConfirmStatus.locked_at && (
                      <> lúc {new Date(periodConfirmStatus.locked_at).toLocaleString('vi-VN')}</>
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-2">
              <button
                onClick={() => { setLockConfirmPeriod(null); setLockNote(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleToggleLock}
                disabled={togglingLock}
                className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
                  !willLock
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {togglingLock ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin mr-1.5" />
                ) : !willLock ? (
                  <LockOpenIcon className="w-4 h-4 mr-1.5" />
                ) : (
                  <LockClosedIcon className="w-4 h-4 mr-1.5" />
                )}
                {togglingLock
                  ? 'Đang xử lý...'
                  : !willLock
                    ? 'Xác nhận mở khóa'
                    : 'Xác nhận khóa'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Khóa/Mở khóa riêng theo nhân viên */}
      {showEmployeeOverrideModal && (() => {
        const periodLabel = overridePeriod === 'FIRST_HALF' ? 'nửa đầu (1-15)' : 'nửa sau (16-cuối)';
        const filteredEmployees = overrideAllEmployees.filter((emp) => {
          if (!overrideEmployeeSearch.trim()) return true;
          const q = overrideEmployeeSearch.trim().toLowerCase();
          return (
            emp.employee_id.toLowerCase().includes(q) ||
            emp.full_name.toLowerCase().includes(q)
          );
        });
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 flex items-center gap-3 bg-amber-50 border-b border-amber-200 flex-shrink-0">
              <UserIcon className="w-6 h-6 text-amber-600" />
              <div>
                <h3 className="text-base font-semibold text-amber-900">
                  Khóa/Mở khóa tạo đơn giải trình theo nhân viên
                </h3>
                <p className="text-sm text-gray-600">
                  Tháng {selectedMonth}/{selectedYear} — độc lập với khóa chung 2 nửa tháng
                </p>
              </div>
              <button
                onClick={() => setShowEmployeeOverrideModal(false)}
                className="ml-auto text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4 overflow-y-auto">
              <p className="text-sm text-gray-600">
                Dùng khi 1 vài nhân viên bị sai lệch chấm công cần mở lại để giải trình dù nửa tháng
                đang khóa chung — hoặc ngược lại, cần khóa riêng 1 vài người dù nửa tháng đang mở.
              </p>

              {/* Chọn nửa tháng */}
              <div className="flex gap-2">
                {(['FIRST_HALF', 'SECOND_HALF'] as LockPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleOverridePeriodChange(p)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border ${
                      overridePeriod === p
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {p === 'FIRST_HALF' ? 'Nửa đầu (1-15)' : 'Nửa sau (16-cuối)'}
                  </button>
                ))}
              </div>

              {/* Trạng thái muốn set */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideIsUnlocked(true)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border ${
                    overrideIsUnlocked
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <LockOpenIcon className="w-4 h-4" />
                  Mở khóa riêng
                </button>
                <button
                  type="button"
                  onClick={() => setOverrideIsUnlocked(false)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border ${
                    !overrideIsUnlocked
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <LockClosedIcon className="w-4 h-4" />
                  Khóa riêng
                </button>
              </div>

              {/* Chọn nhân viên — searchable checklist */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Chọn nhân viên (theo mã NV hoặc tên)
                </label>
                <input
                  type="text"
                  value={overrideEmployeeSearch}
                  onChange={(e) => setOverrideEmployeeSearch(e.target.value)}
                  placeholder="Tìm theo mã NV hoặc tên..."
                  className="block w-full text-sm border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 mb-2"
                />
                <div className="border border-gray-200 rounded-md max-h-48 overflow-y-auto divide-y divide-gray-100">
                  {overrideEmployeesLoading ? (
                    <p className="text-sm text-gray-400 text-center py-4">Đang tải danh sách nhân viên...</p>
                  ) : filteredEmployees.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Không tìm thấy nhân viên</p>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <label
                        key={emp.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={overrideEmployeeIds.includes(emp.id)}
                          onChange={() =>
                            setOverrideEmployeeIds((prev) =>
                              prev.includes(emp.id)
                                ? prev.filter((id) => id !== emp.id)
                                : [...prev, emp.id]
                            )
                          }
                        />
                        <span className="font-medium text-gray-700">{emp.employee_id}</span>
                        <span className="text-gray-500">{emp.full_name}</span>
                      </label>
                    ))
                  )}
                </div>
                {overrideEmployeeIds.length > 0 && (
                  <p className="text-xs text-primary-600 mt-1">
                    Đã chọn {overrideEmployeeIds.length} nhân viên
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Ghi chú (tùy chọn)
                </label>
                <textarea
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="Lý do khóa/mở riêng..."
                  rows={2}
                  className="block w-full text-sm border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSubmitEmployeeOverride}
                  disabled={overrideSubmitting || overrideEmployeeIds.length === 0}
                  className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
                    overrideIsUnlocked ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {overrideSubmitting ? (
                    <ArrowPathIcon className="w-4 h-4 animate-spin mr-1.5" />
                  ) : overrideIsUnlocked ? (
                    <LockOpenIcon className="w-4 h-4 mr-1.5" />
                  ) : (
                    <LockClosedIcon className="w-4 h-4 mr-1.5" />
                  )}
                  {overrideSubmitting
                    ? 'Đang xử lý...'
                    : overrideIsUnlocked
                      ? `Mở khóa riêng ${overrideEmployeeIds.length || ''} NV`
                      : `Khóa riêng ${overrideEmployeeIds.length || ''} NV`}
                </button>
              </div>

              {/* Danh sách ngoại lệ hiện có */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-700 mb-2">
                  Ngoại lệ hiện có — {periodLabel}
                </p>
                {overrideListLoading ? (
                  <p className="text-sm text-gray-400 text-center py-3">Đang tải...</p>
                ) : overrideList.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">Chưa có ngoại lệ nào cho nửa tháng này</p>
                ) : (
                  <div className="space-y-1.5">
                    {overrideList.map((ov) => (
                      <div
                        key={ov.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-gray-50 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {ov.is_unlocked ? (
                            <LockOpenIcon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                          ) : (
                            <LockClosedIcon className="w-4 h-4 text-red-600 flex-shrink-0" />
                          )}
                          <span className="font-medium text-gray-700 flex-shrink-0">{ov.employee_code}</span>
                          <span className="text-gray-500 truncate">{ov.employee_name}</span>
                          {ov.note && (
                            <span className="text-gray-400 text-xs truncate hidden sm:inline">— {ov.note}</span>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteEmployeeOverride(ov)}
                          disabled={overrideDeletingId === ov.id}
                          className="flex-shrink-0 text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50"
                          title="Gỡ ngoại lệ — quay lại theo khóa chung"
                        >
                          {overrideDeletingId === ov.id ? '...' : 'Gỡ'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end flex-shrink-0">
              <button
                onClick={() => setShowEmployeeOverrideModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Attendance Anomaly Modal */}
      {showAttendanceAnomalyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
                  <ExclamationCircleIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Bất thường chấm công</h2>
                  <p className="text-xs text-gray-500">
                    Tháng {selectedMonth}/{selectedYear} · Tổng {totalAttendanceAnomalies} bất thường
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAttendanceAnomalyModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-6">
              <div className="rounded-xl border border-red-200 overflow-hidden">
                <div className="px-4 py-2 bg-red-50 text-red-800 text-sm font-semibold">
                  Danh sách bất thường ({attendanceAnomalies.length})
                </div>
                {attendanceAnomalies.length > 0 ? (
                  <div className="divide-y divide-red-100">
                    {attendanceAnomalies.map((item) => (
                      <div key={`anomaly-${item.emp.id}`} className="px-4 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.emp.full_name}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {item.emp.employee_id}
                            {item.emp.department?.name ? ` · ${item.emp.department.name}` : ''}
                            {item.emp.position?.title ? ` · ${item.emp.position.title}` : ''}
                            {item.emp.probation_end_date ? ` · KT thử việc: ${formatDate(item.emp.probation_end_date)}` : ''}
                            {` · Nghỉ phép đã duyệt: ${item.rec?.nghi_phep ?? 0} ngày`}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {item.reasons.map((reason) => (
                              <span
                                key={reason}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => handleOpenEmployeeCalendar(item.emp)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100"
                        >
                          <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                          Xem calendar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-gray-500">Không có dữ liệu.</div>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 overflow-hidden">
                <div className="px-4 py-2 bg-amber-50 text-amber-800 text-sm font-semibold">
                  Bất thường đơn nghỉ phép chưa duyệt ({pendingLeaveAnomalies.length})
                </div>
                {loadingPendingMonthlyLeave ? (
                  <div className="px-4 py-4 text-xs text-gray-500">Đang tải đơn nghỉ phép chờ duyệt...</div>
                ) : pendingLeaveAnomalies.length > 0 ? (
                  <div className="divide-y divide-amber-100">
                    {pendingLeaveAnomalies.map((item) => (
                      <div key={`pending-anomaly-${item.emp.id}`} className="px-4 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.emp.full_name}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {item.emp.employee_id}
                            {item.emp.department?.name ? ` · ${item.emp.department.name}` : ''}
                            {item.emp.position?.title ? ` · ${item.emp.position.title}` : ''}
                            {` · Đơn chờ duyệt: ${item.requests.length}`}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {item.reasons.map((reason) => (
                              <span
                                key={reason}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => handleOpenEmployeeCalendar(item.emp)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100"
                        >
                          <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                          Xem calendar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-gray-500">Không có dữ liệu.</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <span className="text-xs text-gray-500">
                Tổng cộng {totalAttendanceAnomalies} bất thường · Tháng {selectedMonth}/{selectedYear}
              </span>
              <button
                onClick={() => setShowAttendanceAnomalyModal(false)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily Pivot Preview Modal */}
      {showDailyPreviewModal && dailyPivotRecords.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[98vw] max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600">
                  <TableCellsIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Bảng công chi tiết
                  </h2>
                  <p className="text-xs text-gray-500">
                    Tháng {selectedMonth}/{selectedYear} · {dailyPivotRecords.length} nhân viên đã chốt
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDailyPreviewModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Pivot Table */}
            <div className="flex-1 overflow-auto">
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold text-white bg-primary-700 border border-primary-800">
                      STT
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold text-white bg-primary-700 border border-primary-800">
                      Mã NV
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-white bg-primary-700 border border-primary-800">
                      Họ và Tên
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-white bg-primary-700 border border-primary-800">
                      Phòng Ban
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-white bg-primary-700 border border-primary-800">
                      Vị Trí
                    </th>
                    {pivotDayHeaders.map((h) => (
                      <th
                        key={h.day}
                        className="whitespace-nowrap px-1.5 py-2 text-center font-semibold text-white bg-primary-700 border border-primary-800 min-w-[52px]"
                      >
                        {h.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-2 py-2 text-center font-bold text-white bg-primary-900 border border-primary-800">
                      Tổng
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dailyPivotRecords.map((rec, idx) => {
                    const rowCls = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                    return (
                      <tr key={rec.ma_nv} className={`${rowCls} hover:bg-primary-50/40 transition-colors`}>
                        <td className="px-2 py-1.5 text-center border border-gray-200">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-center border border-gray-200">
                          {rec.ma_nv}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200">
                          {rec.ho_va_ten}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200 text-gray-600">
                          {rec.phong_ban ?? '—'}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap border border-gray-200 text-gray-600">
                          {rec.vi_tri ?? '—'}
                        </td>
                        {(rec.daily_summary || []).map((d) => {
                          const creditStr = formatDailyCredit(d);
                          const cellCls =
                            d.day_type === 'P' ? 'bg-amber-50 text-amber-700 font-medium'
                            : d.day_type === 'OLW' ? 'bg-primary-50 text-primary-700 font-medium'
                            : d.day_type === 'L' ? 'bg-primary-50 text-primary-600 font-medium'
                            : d.day_type === 'KP' ? 'bg-rose-100 text-rose-700 font-bold'
                            : d.is_weekend && !creditStr ? 'bg-gray-100 text-gray-400'
                            : d.work_credit >= 1 ? 'text-emerald-700 font-medium'
                            : d.work_credit > 0 ? 'text-amber-600 font-medium'
                            : '';
                          return (
                            <td
                              key={d.date}
                              className={`px-1.5 py-1.5 text-center border border-gray-200 ${cellCls}`}
                              title={d.holiday_name || d.weekday_label}
                            >
                              {creditStr}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 text-center font-bold text-primary-700 border border-gray-200 bg-primary-50/50">
                          {rec.tong_cong}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <span className="text-xs text-gray-500">
                {dailyPivotRecords.length} nhân viên · Tháng {selectedMonth}/{selectedYear}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportDailyPivot}
                  disabled={exportingDaily}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowDownTrayIcon className="w-4 h-4 mr-1.5" />
                  {exportingDaily ? 'Đang xuất...' : 'Xuất Excel'}
                </button>
                <button
                  onClick={() => setShowDailyPreviewModal(false)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkFinalization;

