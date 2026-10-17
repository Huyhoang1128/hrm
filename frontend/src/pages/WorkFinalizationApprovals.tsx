import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  EyeIcon,
  PaperAirplaneIcon,
  XCircleIcon,
  ClockIcon,
  BoltIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { departmentsAPI, Department } from '../utils/api';
import {
  workFinalizationApprovalService,
  DepartmentWorkFinalizationApproval,
  ApprovalStatus,
  ApprovalListParams,
  SendAllApprovalsResponse,
} from '../services/workFinalizationApproval.service';
import {
  workFinalizationAccountingService,
  type WorkFinalizationAccountingExportRow,
} from '../services/workFinalizationAccounting.service';
import {
  workFinalizationService,
  type WorkFinalizationRecord,
} from '../services/workFinalization.service';
import { approvalService } from '../services/approval.service';
import { employeesAPI } from '../utils/api';
import { PROBATION_RATE_OPTIONS, WORK_FORM_OPTIONS } from '../constants/onboarding';

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};

const STATUS_COLORS: Record<ApprovalStatus, string> = {
  PENDING:  'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const isPartiallyApproved = (approval: DepartmentWorkFinalizationApproval) =>
  approval.status === 'PENDING' &&
  Number(approval.approved_employees || 0) > 0 &&
  Number(approval.total_employees || 0) > 0;

const getApprovalStatusLabel = (approval: DepartmentWorkFinalizationApproval) =>
  isPartiallyApproved(approval)
    ? `Đã duyệt ${approval.approved_employees}/${approval.total_employees}`
    : STATUS_LABELS[approval.status];

const getApprovalStatusColor = (approval: DepartmentWorkFinalizationApproval) =>
  isPartiallyApproved(approval)
    ? 'bg-violet-100 text-violet-700'
    : STATUS_COLORS[approval.status];

const WORK_FORM_LABELS: Record<string, string> = {
  ...Object.fromEntries(WORK_FORM_OPTIONS.map((option) => [option.value, option.label])),
  FULL_TIME: 'Toàn thời gian',
  PART_TIME: 'Bán thời gian',
  CONTRACT: 'Hợp đồng',
  INTERN: 'Thực tập',
  COLLABORATOR: 'Cộng tác viên',
  CTV: 'Cộng tác viên',
  'CT TV': 'Cộng tác viên',
  CTTV: 'Cộng tác viên',
};

const RANK_LABELS: Record<string, string> = {
  CHAIRMAN: 'Chủ tịch',
  DIRECTOR: 'Giám đốc',
  DEPUTY_DIRECTOR: 'Phó Giám đốc',
  LEADER: 'Leader',
  SUPERVISOR: 'Quản lý',
  MANAGER: 'Trưởng phòng',
  MANAGER_TRAINEE: 'Trưởng phòng tập sự',
  DEPUTY_MANAGER: 'Phó phòng',
  STAFF: 'Nhân viên',
  INTERN: 'Thực tập sinh',
};

const formatRankDisplay = (value: any) => {
  if (value === undefined || value === null || value === '') return value;
  const text = String(value).trim();
  return RANK_LABELS[text.toUpperCase()] || text;
};

const WorkFinalizationApprovals: React.FC = () => {
  const { user } = useAuth();
  const [currentEmployee, setCurrentEmployee] = useState<any>(null);

  const userRole = user?.role ? user.role.toUpperCase() : 'USER';
  const isAdmin = (user as any)?.is_supperuser || (user as any)?.is_superuser || userRole === 'ADMIN';
  const isHR =
    (user as any)?.employee_profile?.is_hr ||
    userRole === 'HR' ||
    (user as any)?.hrm_user?.department_code === 'HCNS';
  const isHROrAdmin = isAdmin || isHR;
  const isDepartmentManager =
    currentEmployee?.department?.manager_id === currentEmployee?.id;
  const isManager =
    !!(user as any)?.is_manager ||
    currentEmployee?.is_manager === true ||
    currentEmployee?.position?.is_management === true ||
    isDepartmentManager;

  const managerDeptCode: string | null =
    (user as any)?.employee_profile?.department_code ||
    (user as any)?.hrm_user?.department_code ||
    (user as any)?.department_code ||
    currentEmployee?.department?.code ||
    null;

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterDepartmentId, setFilterDepartmentId] = useState<string>('');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [approvals, setApprovals] = useState<DepartmentWorkFinalizationApproval[]>([]);
  const [approvedDepartmentCount, setApprovedDepartmentCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [sendingDept, setSendingDept] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendAllResult, setSendAllResult] = useState<SendAllApprovalsResponse | null>(null);
  const [accountingExportRows, setAccountingExportRows] = useState<WorkFinalizationAccountingExportRow[]>([]);
  const [accountingExportLoading, setAccountingExportLoading] = useState(false);
  const [accountingExportGenerating, setAccountingExportGenerating] = useState(false);
  const [selectedExportDepartment, setSelectedExportDepartment] = useState<string | null>(null);

  const [actionTarget, setActionTarget] = useState<DepartmentWorkFinalizationApproval | null>(null);
  const [actionType, setActionType] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [actionNote, setActionNote] = useState('');
  const [actionProcessing, setActionProcessing] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showQuickApproveModal, setShowQuickApproveModal] = useState(false);
  const [quickApproveLoading, setQuickApproveLoading] = useState(false);
  const [quickApproveProcessing, setQuickApproveProcessing] = useState(false);
  const [quickApproveTarget, setQuickApproveTarget] = useState<DepartmentWorkFinalizationApproval | null>(null);
  const [quickApproveEmployees, setQuickApproveEmployees] = useState<any[]>([]);
  const [quickApproveNote, setQuickApproveNote] = useState('');
  const [detailApproval, setDetailApproval] = useState<any>(null);
  const [detailEmployees, setDetailEmployees] = useState<any[]>([]);
  const [detailEmployeeDetails, setDetailEmployeeDetails] = useState<Record<number, any>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [employeeActionTarget, setEmployeeActionTarget] = useState<any>(null);
  const [employeeActionType, setEmployeeActionType] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [employeeActionNote, setEmployeeActionNote] = useState('');
  const [employeeActionProcessing, setEmployeeActionProcessing] = useState(false);
  const [showEmployeeActionModal, setShowEmployeeActionModal] = useState(false);
  const [sendConfirmTarget, setSendConfirmTarget] = useState<{
    deptId: number;
    deptCode: string;
    deptName: string;
    approval?: DepartmentWorkFinalizationApproval;
  } | null>(null);
  const [sendPreviewEmployees, setSendPreviewEmployees] = useState<WorkFinalizationRecord[]>([]);
  const [sendPreviewEmployeeDetails, setSendPreviewEmployeeDetails] = useState<Record<number, any>>({});
  const [sendPreviewLoading, setSendPreviewLoading] = useState(false);
  const [previewEmployeeActionTarget, setPreviewEmployeeActionTarget] = useState<any>(null);
  const [previewEmployeeActionType, setPreviewEmployeeActionType] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [previewEmployeeActionNote, setPreviewEmployeeActionNote] = useState('');
  const [previewEmployeeActionProcessing, setPreviewEmployeeActionProcessing] = useState(false);
  const [showPreviewEmployeeActionModal, setShowPreviewEmployeeActionModal] = useState(false);
  const [showAccountingExportModal, setShowAccountingExportModal] = useState(false);
  const [accountingPreviewRows, setAccountingPreviewRows] = useState<any[]>([]);
  const [accountingPreviewLoading, setAccountingPreviewLoading] = useState(false);
  const exportableAccountingRows = accountingExportRows.filter((row) => row.decision !== 'REJECTED');
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  useEffect(() => {
    const fetchEmployee = async () => {
      try {
        const emp = await approvalService.getCurrentEmployee();
        setCurrentEmployee(emp);
      } catch (e) {
        console.error('Error fetching employee in WorkFinalization:', e);
      }
    };
    fetchEmployee();
  }, []);

  useEffect(() => {
    console.log('👤 [ROLE CHECK] WorkFinalizationApprovals:', {
      userRole,
      isAdmin,
      isHR,
      isManager,
      isDepartmentManager,
      managerDeptCode,
      username: user?.username,
    });
  }, [userRole, isAdmin, isHR, isManager, isDepartmentManager, managerDeptCode, user?.username]);

  useEffect(() => {
    departmentsAPI.list({ page_size: 200 }).then((res) => {
      if (!isHROrAdmin && isManager && managerDeptCode) {
        setDepartments(res.results.filter((d) => d.code === managerDeptCode));
      } else {
        setDepartments(res.results);
      }
    }).catch(() => {});
  }, [isHROrAdmin, isManager, managerDeptCode]);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ApprovalListParams = { year: selectedYear, month: selectedMonth };
      if (filterStatus) params.status = filterStatus as ApprovalStatus;
      const [res, approvedRes] = await Promise.all([
        workFinalizationApprovalService.list(params),
        filterStatus === 'APPROVED'
          ? Promise.resolve(null)
          : workFinalizationApprovalService.list({
              year: selectedYear,
              month: selectedMonth,
              status: 'APPROVED',
            }),
      ]);
      setApprovals(res.results);
      const approvedApprovals = approvedRes?.results ?? res.results;
      setApprovedDepartmentCount(
        new Set(approvedApprovals.map((approval) => approval.department_code)).size
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể tải dữ liệu phê duyệt. Vui lòng thử lại.');
      setApprovals([]);
      setApprovedDepartmentCount(0);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, filterStatus]);

  const loadAccountingExports = useCallback(async () => {
    if (!isAdmin) return;
    setAccountingExportLoading(true);
    try {
      const res = await workFinalizationAccountingService.list({ year: selectedYear, month: selectedMonth });
      setAccountingExportRows(res.results);
    } catch (err) {
      console.error('Failed to load accounting exports', err);
      setAccountingExportRows([]);
    } finally {
      setAccountingExportLoading(false);
    }
  }, [isAdmin, selectedYear, selectedMonth]);

  useEffect(() => { loadApprovals(); }, [loadApprovals]);
  useEffect(() => { loadAccountingExports(); }, [loadAccountingExports]);

  const handleSendOne = async (deptCode: string) => {
    setSendingDept(deptCode);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await workFinalizationApprovalService.send({
        department_code: deptCode,
        year: selectedYear,
        month: selectedMonth,
      });
      setSuccessMsg(
        `${res.created ? 'Đã gửi yêu cầu' : 'Đã cập nhật yêu cầu'} phê duyệt cho phòng ban "${deptCode}"`
      );
      await loadApprovals();
    } catch (err: any) {
      setError(err?.response?.data?.error || `Lỗi khi gửi yêu cầu phê duyệt cho "${deptCode}"`);
    } finally {
      setSendingDept(null);
    }
  };

  const openSendConfirmModal = (
    deptId: number,
    deptCode: string,
    deptName: string,
    approval?: DepartmentWorkFinalizationApproval
  ) => {
    setError(null);
    setSuccessMsg(null);
    setSendConfirmTarget({ deptId, deptCode, deptName, approval });
  };

  useEffect(() => {
    if (!sendConfirmTarget) {
      setSendPreviewEmployees([]);
      setSendPreviewEmployeeDetails({});
      return;
    }

    const currentSendTarget = sendConfirmTarget;

    const loadPreviewEmployees = async () => {
      setSendPreviewLoading(true);
      try {
        const res = await workFinalizationService.list({
          year: selectedYear,
          month: selectedMonth,
          department_id: currentSendTarget.deptId,
        });
        const rows = res.results || [];

        const detailEntries = await Promise.all(
          rows.map(async (row) => {
            const employeeId = Number(row.employee_id);
            if (!Number.isFinite(employeeId) || employeeId <= 0) return [employeeId, null] as const;
            try {
              const detail = await employeesAPI.getById(employeeId);
              return [employeeId, detail] as const;
            } catch {
              return [employeeId, null] as const;
            }
          })
        );

        const detailMap = detailEntries.reduce((acc, [employeeId, detail]) => {
          if (employeeId && detail) acc[employeeId] = detail;
          return acc;
        }, {} as Record<number, any>);

        const filteredActiveRows = rows.filter((row) => {
          const employeeId = Number(row.employee_id);
          const detail = Number.isFinite(employeeId) ? detailMap[employeeId] : null;
          return shouldIncludeEmployeeForApprovalMonth(row, detail, selectedMonth, selectedYear);
        });

        if (sendConfirmTarget?.deptId === currentSendTarget.deptId &&
            sendConfirmTarget.deptCode === currentSendTarget.deptCode &&
            sendConfirmTarget.deptName === currentSendTarget.deptName) {
          setSendPreviewEmployees(filteredActiveRows);
          setSendPreviewEmployeeDetails(detailMap);
        }
      } catch {
        setSendPreviewEmployees([]);
        setSendPreviewEmployeeDetails({});
      } finally {
        setSendPreviewLoading(false);
      }
    };

    loadPreviewEmployees();
  }, [sendConfirmTarget, selectedYear, selectedMonth]);

  const pickFirstAvailable = (...values: any[]) => {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  };

  const normalizeStatusText = (value: any) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();

  const isInactiveEmployee = (row: any, detail: any) => {
    const activeCandidates = [detail?.is_active, row?.is_active, row?.snapshot?.is_active];
    for (const candidate of activeCandidates) {
      if (candidate === false || candidate === 0 || candidate === '0' || candidate === 'false' || candidate === 'False') {
        return true;
      }
    }

    const statusCandidates = [
      detail?.employment_status,
      detail?.status,
      row?.employment_status,
      row?.status,
      row?.tinh_trang,
      row?.on_off,
      row?.snapshot?.employee_status,
      row?.snapshot?.tinh_trang,
      row?.snapshot?.status,
    ];

    return statusCandidates.some((candidate) => {
      const status = normalizeStatusText(candidate);
      if (!status) return false;
      return /(INACTIVE|DEACTIVE|DEACTIVATED|OFF|TERMINATED|RESIGNED|DA NGHI|NGHI VIEC)/.test(status);
    });
  };

  const parseDateValue = (value: any): Date | null => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const resignedInApprovalMonth = (row: any, detail: any, month: number, year: number): boolean => {
    const resignationDate = pickFirstAvailable(
      row?.ngay_nghi_viec,
      row?.resignation_date,
      row?.leave_date,
      row?.end_date,
      row?.snapshot?.ngay_nghi_viec,
      row?.snapshot?.resignation_date,
      row?.snapshot?.leave_date,
      row?.snapshot?.end_date,
      detail?.ngay_nghi_viec,
      detail?.resignation_date,
      detail?.leave_date,
      detail?.end_date,
    );

    const date = parseDateValue(resignationDate);
    if (!date) return false;
    return date.getMonth() + 1 === month && date.getFullYear() === year;
  };

  const startedOnOrBeforeApprovalMonth = (row: any, detail: any, month: number, year: number): boolean => {
    const startDateValue = pickFirstAvailable(
      row?.ngay_bat_dau_lam_viec,
      row?.start_date,
      row?.joined_at,
      row?.date_start,
      row?.snapshot?.ngay_bat_dau_lam_viec,
      row?.snapshot?.start_date,
      row?.snapshot?.joined_at,
      row?.snapshot?.date_start,
      detail?.ngay_bat_dau_lam_viec,
      detail?.start_date,
      detail?.joined_at,
      detail?.date_start,
    );

    const startDate = parseDateValue(startDateValue);
    if (!startDate) return true;

    const startMonthIndex = startDate.getFullYear() * 12 + (startDate.getMonth() + 1);
    const approvalMonthIndex = year * 12 + month;
    return startMonthIndex <= approvalMonthIndex;
  };

  const shouldIncludeEmployeeForApprovalMonth = (row: any, detail: any, month: number, year: number): boolean => {
    if (!startedOnOrBeforeApprovalMonth(row, detail, month, year)) return false;
    if (!isInactiveEmployee(row, detail)) return true;
    return resignedInApprovalMonth(row, detail, month, year);
  };

  const formatPreviewDate = (value: any) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('vi-VN');
  };

  const formatPreviewDateTime = (value: any) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('vi-VN');
  };

  const formatPreviewValue = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    return value;
  };

  const formatAmountWithCommas = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString('en-US');
    }

    const text = String(value).trim();
    if (!text) return '-';

    if (/^-?\d+$/.test(text)) {
      return Number(text).toLocaleString('en-US');
    }

    if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
      return Number(text.replace(/\./g, '')).toLocaleString('en-US');
    }

    if (/^-?\d{1,3}(,\d{3})+$/.test(text)) {
      return text;
    }

    if (/^-?\d+(\.\d+)?$/.test(text)) {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : text;
    }

    return text;
  };

  const formatProbationRateDisplay = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    const str = String(value).trim();
    if (!str) return '-';

    const normalized = str.toUpperCase();
    const mapped = PROBATION_RATE_OPTIONS.find((option) => option.value === normalized);
    if (mapped) return mapped.label;

    return str;
  };

  const formatWorkFormDisplay = (value: any) => {
    if (value === undefined || value === null || value === '') return '-';

    const raw = String(value).trim();
    if (!raw) return '-';

    if (WORK_FORM_LABELS[raw]) return WORK_FORM_LABELS[raw];

    const normalized = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    if (WORK_FORM_LABELS[normalized]) return WORK_FORM_LABELS[normalized];
    if (normalized === 'FULL TIME') return 'Toàn thời gian';
    if (normalized === 'PART TIME') return 'Bán thời gian';
    if (normalized === 'HOP DONG') return 'Hợp đồng';
    if (normalized === 'THUC TAP') return 'Thực tập';
    if (normalized === 'CONG TAC VIEN' || normalized === 'CTV' || normalized === 'CT TV' || normalized === 'CTTV') {
      return 'Cộng tác viên';
    }

    return raw;
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

  const getPreviewDetail = (employeeId: number) => sendPreviewEmployeeDetails[employeeId] || {};

  const activeSendPreviewEmployees = sendPreviewEmployees.filter((emp) => {
    const detail = getPreviewDetail(emp.employee_id);
    return shouldIncludeEmployeeForApprovalMonth(emp, detail, selectedMonth, selectedYear);
  });

  const mapEmployeeToExcelLikeRow = useCallback((params: {
    row: any;
    index: number;
    employeeDetail?: any;
    departmentNameOverride?: any;
    sentAtOverride?: any;
    decisionLabelOverride?: any;
    decisionNoteOverride?: any;
    decidedAtOverride?: any;
  }) => {
    const {
      row,
      index,
      employeeDetail,
      departmentNameOverride,
      sentAtOverride,
      decisionLabelOverride,
      decisionNoteOverride,
      decidedAtOverride,
    } = params;

    const s = row?.snapshot || row || {};
    const detail = employeeDetail || {};
    const detailExtra = detail.extra_info || {};
    const salaryAdjustments = detail.salary_adjustments || {};

    const section = pickFirstAvailable(
      s.bo_phan,
      s.section,
      row?.bo_phan,
      detail.section,
      detail.block,
      detail.bo_phan,
    );
    const rank = formatRankDisplay(
      pickFirstAvailable(
        s.rank_display,
        s.rank,
        s.cap_bac,
        row?.rank_display,
        row?.rank,
        row?.cap_bac,
        detail.rank_display,
        detail.rank,
        detail.management_level,
      )
    );
    const position = pickFirstAvailable(
      s.vi_tri,
      s.position,
      row?.vi_tri,
      row?.position,
      detail.position?.title,
      detail.position,
      detail.vi_tri,
    );
    const doctorTeam = pickFirstAvailable(
      s.doctor_team,
      s.team_doctor,
      s.bac_si_team,
      s.bac_si_chinh,
      s.main_doctor,
      row?.doctor_team,
      row?.team_doctor,
      row?.bac_si_team,
      detail.doctor_team,
      detailExtra.doctor_team,
      detail.bac_si_team,
      detailExtra.bac_si_team,
      detail.bac_si_chinh,
      detailExtra.bac_si_chinh,
    );
    const workForm = pickFirstAvailable(
      s.work_form_display,
      s.work_form,
      s.work_type,
      row?.work_form_display,
      row?.work_form,
      row?.work_type,
      detail.work_form_display,
      detail.work_form,
      detail.work_type,
      s.hinh_thuc_lam_viec,
      row?.hinh_thuc_lam_viec,
    );
    const endDate = pickFirstAvailable(
      detail.end_date,
      detail.ngay_nghi_viec,
      s.resignation_date,
      s.leave_date,
      s.end_date,
      s.ngay_nghi_viec,
      row?.resignation_date,
      row?.leave_date,
      row?.end_date,
      row?.ngay_nghi_viec,
    );
    const probationMonths = pickFirstAvailable(s.probation_months, s.thoi_gian_thu_viec, row?.probation_months, row?.thoi_gian_thu_viec, detail.probation_months);
    const startDate = pickFirstAvailable(
      s.ngay_bat_dau_lam_viec,
      s.start_date,
      row?.ngay_bat_dau_lam_viec,
      row?.start_date,
      detail.start_date,
      detail.ngay_bat_dau_lam_viec,
    );
    const probationEndDate = pickFirstAvailable(
      detail.probation_end_date,
      detail.probation_end,
      s.ngay_ket_thuc_thu_viec,
      s.probation_end_date,
      s.probation_end,
      row?.ngay_ket_thuc_thu_viec,
      row?.probation_end_date,
      row?.probation_end,
    );
    const probationRate = pickFirstAvailable(
      s.probation_rate,
      s.probation_ratio,
      s.ti_le_huong_thu_viec,
      row?.probation_rate,
      row?.probation_ratio,
      row?.ti_le_huong_thu_viec,
      detail.probation_rate_display,
      detail.probation_rate,
    );
    const basicSalary = pickFirstAvailable(
      s.basic_salary,
      s.luong_co_ban,
      row?.basic_salary,
      row?.luong_co_ban,
      detail.basic_salary,
      detail.salary?.basic_salary,
      detail.base_salary,
    );
    const allowance = pickFirstAvailable(s.allowance, s.phu_cap, row?.allowance, row?.phu_cap, detail.allowance);
    const salesPercent = pickFirstAvailable(
      s.revenue_percentage,
      s.sales_percent,
      s.sales_ratio,
      s.ty_le_doanh_so_huong,
      row?.revenue_percentage,
      row?.sales_percent,
      row?.sales_ratio,
      row?.ty_le_doanh_so_huong,
      detail.revenue_percentage,
      detail.sales_percent,
      detail.ty_le_doanh_so_huong,
      salaryAdjustments.sales_percent,
      salaryAdjustments.ty_le_doanh_so_huong,
    );
    const profitPercent = pickFirstAvailable(
      s.profit_percentage,
      s.profit_percent,
      s.profit_ratio,
      s.ty_le_loi_nhuan_huong,
      row?.profit_percentage,
      row?.profit_percent,
      row?.profit_ratio,
      row?.ty_le_loi_nhuan_huong,
      detail.profit_percentage,
      detail.profit_percent,
      detail.ty_le_loi_nhuan_huong,
      salaryAdjustments.profit_percent,
      salaryAdjustments.ty_le_loi_nhuan_huong,
    );
    const siDeduction = pickFirstAvailable(
      s.si_deduction,
      s.bhxh,
      s.bhxh_deduction,
      s.khau_tru_bhxh,
      row?.si_deduction,
      row?.bhxh,
      row?.bhxh_deduction,
      row?.khau_tru_bhxh,
      detail.insurance_participation,
      detail.khau_tru_bhxh,
      salaryAdjustments.khau_tru_bhxh,
      salaryAdjustments.bhxh,
    );
    const employeeStatus = pickFirstAvailable(
      s.employee_status,
      s.tinh_trang,
      s.contract_status,
      row?.employee_status,
      row?.tinh_trang,
      row?.contract_status,
      detail.employment_status,
      detail.contract_status,
      detail.status,
    );
    // Prioritize employee's social_insurance_contribution_level field over salary_adjustments config
    const insuranceSalaryBase = pickFirstAvailable(
      detail.social_insurance_contribution_level,
      salaryAdjustments?.payroll_config?.taxPolicy?.insuranceSalaryOverride,
      salaryAdjustments?.payroll_config?.tax_policy?.insuranceSalaryOverride,
      salaryAdjustments?.payroll_config?.taxPolicy?.insurance_salary_override,
      salaryAdjustments?.payroll_config?.tax_policy?.insurance_salary_override,
      salaryAdjustments?.insuranceSalaryOverride,
      salaryAdjustments?.insurance_salary_override,
    );
    const insuranceBaseNumber = toNumberOrUndefined(insuranceSalaryBase);
    const computedSiDeduction =
      insuranceBaseNumber !== undefined &&
      insuranceBaseNumber > 0 &&
      isOfficialForInsuranceDeduction({
        contractStatus: pickFirstAvailable(s.contract_status, row?.contract_status, detail.contract_status),
        employeeStatus,
        workForm,
      })
        ? Number((insuranceBaseNumber * 0.105).toFixed(2))
        : undefined;
    const employmentStatusNotes = pickFirstAvailable(
      s.employment_status_notes,
      s.ghi_chu_cong_viec,
      s.ghi_chu_trang_thai,
      row?.employment_status_notes,
      row?.ghi_chu_cong_viec,
      row?.ghi_chu_trang_thai,
      detail.employment_status_notes,
      detail.ghi_chu_trang_thai,
    );
    const giamTruKhac = pickFirstAvailable(
      s.giam_tru_khac,
      s.disciplinary_penalty,
      row?.giam_tru_khac,
      row?.disciplinary_penalty,
    );

    const sentAtRaw = pickFirstAvailable(
      sentAtOverride,
      row?.exported_at,
      row?.sent_at,
      row?.submitted_at,
      row?.created_at,
      s.thoi_gian_gui,
      s.submitted_at,
      s.created_at,
    );
    const decidedAtRaw = pickFirstAvailable(
      decidedAtOverride,
      row?.decided_at,
      row?.individual_decided_at,
    );

    return {
      id: row?.id ?? `${row?.employee_id || 'emp'}-${index}`,
      employee_id: row?.employee_id,
      source: row,
      stt: index + 1,
      employee_code: formatPreviewValue(pickFirstAvailable(row?.employee_code, row?.ma_nv, s.ma_nv, detail.employee_code, detail.employee_id, row?.employee_id)),
      employee_name: formatPreviewValue(pickFirstAvailable(row?.employee_name, row?.ho_va_ten, s.ho_va_ten, detail.full_name, detail.name)),
      department_name: formatPreviewValue(pickFirstAvailable(departmentNameOverride, row?.department_name, row?.phong_ban, s.phong_ban, detail.department_name, detail.department?.name, detail.phong_ban)),
      section: formatPreviewValue(section),
      rank: formatPreviewValue(formatRankDisplay(rank)),
      position: formatPreviewValue(position),
      doctor_team: formatPreviewValue(doctorTeam),
      work_form: formatWorkFormDisplay(workForm),
      end_date: endDate,
      probation_months: formatPreviewValue(probationMonths),
      start_date: startDate,
      probation_end_date: probationEndDate,
      probation_rate: formatProbationRateDisplay(probationRate),
      basic_salary: basicSalary,
      allowance,
      sales_percent: formatPreviewValue(salesPercent),
      profit_percent: formatPreviewValue(profitPercent),
      si_deduction: formatPreviewValue(computedSiDeduction ?? siDeduction),
      giam_tru_khac: formatPreviewValue(giamTruKhac),
      employee_status: formatPreviewValue(employeeStatus),
      employment_status_notes: formatPreviewValue(employmentStatusNotes),
      sent_at: sentAtRaw ? formatPreviewDateTime(sentAtRaw) : '-',
      decision: pickFirstAvailable(row?.decision, row?.individual_decision),
      decision_label: formatPreviewValue(
        pickFirstAvailable(
          decisionLabelOverride,
          row?.decision_label,
          row?.individual_decision_label,
          row?.decision,
          row?.individual_decision,
        )
      ),
      decision_note: formatPreviewValue(pickFirstAvailable(decisionNoteOverride, row?.decision_note, row?.individual_decision_note)),
      decided_at: decidedAtRaw ? formatPreviewDateTime(decidedAtRaw) : '-',
    };
  }, [formatProbationRateDisplay]);

  const sendPreviewPreparedRows = useMemo(() => {
    return activeSendPreviewEmployees.map((emp, index) => {
      const detail = getPreviewDetail(emp.employee_id);
      const sentAt = (sendConfirmTarget?.approval as any)?.sent_at || new Date();
      return mapEmployeeToExcelLikeRow({
        row: emp,
        index,
        employeeDetail: detail,
        departmentNameOverride: pickFirstAvailable(emp.phong_ban, detail?.department_name, detail?.department?.name, detail?.phong_ban),
        sentAtOverride: sentAt,
        decisionLabelOverride: (emp as any)?.individual_decision_label || 'Chưa quyết định',
        decisionNoteOverride: (emp as any)?.individual_decision_note,
        decidedAtOverride: (emp as any)?.individual_decided_at,
      });
    });
  }, [activeSendPreviewEmployees, getPreviewDetail, mapEmployeeToExcelLikeRow, sendConfirmTarget]);

  const detailPreparedRows = useMemo(() => {
    return detailEmployees.map((emp, index) => {
      const detail = detailEmployeeDetails[Number(emp.employee_id)] || {};
      return mapEmployeeToExcelLikeRow({
        row: emp,
        index,
        employeeDetail: detail,
        sentAtOverride: (detailApproval as any)?.sent_at,
      });
    });
  }, [detailApproval, detailEmployeeDetails, detailEmployees, mapEmployeeToExcelLikeRow]);

  const quickApprovedEmployees = useMemo(
    () => quickApproveEmployees.filter((e) => String(e?.individual_decision || '').toUpperCase() === 'APPROVED'),
    [quickApproveEmployees]
  );

  const quickRejectedEmployees = useMemo(
    () => quickApproveEmployees.filter((e) => String(e?.individual_decision || '').toUpperCase() === 'REJECTED'),
    [quickApproveEmployees]
  );

  const quickUndecidedEmployees = useMemo(
    () => quickApproveEmployees.filter((e) => !String(e?.individual_decision || '').trim()),
    [quickApproveEmployees]
  );

  const quickInvalidDecisionEmployees = useMemo(
    () => quickApproveEmployees.filter((e) => {
      const decision = String(e?.individual_decision || '').trim();
      if (!decision) return false;
      return (e?.individual_decision_from_approval_manager ?? e?.individual_decision_from_direct_manager) !== true;
    }),
    [quickApproveEmployees]
  );

  const handleSendAll = async () => {
    if (!window.confirm(
      `Bạn có chắc muốn gửi yêu cầu phê duyệt cho tất cả phòng ban tháng ${selectedMonth}/${selectedYear}?`
    )) return;
    setSendingAll(true);
    setError(null);
    setSuccessMsg(null);
    setSendAllResult(null);
    try {
      const res = await workFinalizationApprovalService.sendAll({ year: selectedYear, month: selectedMonth });
      setSendAllResult(res);
      setSuccessMsg(
        `Đã gửi yêu cầu phê duyệt cho ${res.total_processed} phòng ban tháng ${selectedMonth}/${selectedYear}` +
          (res.total_errors > 0 ? ` (${res.total_errors} lỗi)` : '')
      );
      await loadApprovals();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Lỗi khi gửi yêu cầu phê duyệt. Vui lòng thử lại.');
    } finally {
      setSendingAll(false);
    }
  };

  const openActionModal = (approval: DepartmentWorkFinalizationApproval, type: 'APPROVE' | 'REJECT') => {
    setActionTarget(approval);
    setActionType(type);
    setActionNote('');
    setShowActionModal(true);
  };

  const handleAction = async () => {
    if (!actionTarget) return;
    if (actionType === 'REJECT' && !actionNote.trim()) {
      setError('Vui lòng nhập lý do từ chối');
      return;
    }
    setActionProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (actionType === 'APPROVE') {
        await workFinalizationApprovalService.approve(actionTarget.id, { note: actionNote.trim() || undefined });
        setSuccessMsg(
          `Đã duyệt chốt công phòng ban "${actionTarget.department_name || actionTarget.department_code}" tháng ${selectedMonth}/${selectedYear}`
        );
      } else {
        await workFinalizationApprovalService.reject(actionTarget.id, { note: actionNote.trim() || undefined });
        setSuccessMsg(
          `Đã từ chối chốt công phòng ban "${actionTarget.department_name || actionTarget.department_code}" tháng ${selectedMonth}/${selectedYear}`
        );
      }
      setShowActionModal(false);
      await loadApprovals();
    } catch (err: any) {
      setError(err?.response?.data?.error ||
        `Lỗi khi ${actionType === 'APPROVE' ? 'phê duyệt' : 'từ chối'}. Vui lòng thử lại.`);
    } finally {
      setActionProcessing(false);
    }
  };

  const getDeptApproval = (deptCode: string): DepartmentWorkFinalizationApproval | undefined =>
    approvals.find((a) => a.department_code === deptCode);

  // Danh sách phòng ban thực sự hiển thị trong bảng — áp dụng cả 2 filter
  // "Phòng ban" và "Trạng thái". `approvals` đã được lọc theo status ngay từ
  // API (xem loadApprovals), nên khi filterStatus có giá trị, phòng ban nào
  // không còn approval khớp status đó (getDeptApproval trả undefined) sẽ bị
  // ẩn khỏi bảng thay vì hiển thị nhầm thành "Chưa gửi".
  const visibleDepartments = useMemo(() => {
    let list = departments;
    if (filterDepartmentId) {
      list = list.filter((d) => String(d.id) === filterDepartmentId);
    }
    if (filterStatus) {
      list = list.filter((d) => getDeptApproval(d.code)?.status === filterStatus);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments, filterDepartmentId, filterStatus, approvals]);

  const loadApprovalDetail = useCallback(async (approvalId: number) => {
    setDetailLoading(true);
    try {
      const res = await workFinalizationApprovalService.get(approvalId);
      const employees = res.employees || [];
      const detailEntries = await Promise.all(
        employees.map(async (row: any) => {
          const employeeId = Number(row.employee_id);
          if (!Number.isFinite(employeeId) || employeeId <= 0) return [employeeId, null] as const;
          try {
            const detail = await employeesAPI.getById(employeeId);
            return [employeeId, detail] as const;
          } catch {
            return [employeeId, null] as const;
          }
        })
      );
      const detailMap = detailEntries.reduce((acc, [employeeId, detail]) => {
        if (employeeId && detail) acc[employeeId] = detail;
        return acc;
      }, {} as Record<number, any>);

      setDetailApproval(res);
      setDetailEmployees(employees);
      setDetailEmployeeDetails(detailMap);
      setShowDetailModal(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể tải chi tiết bảng chốt công');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openEmployeeActionModal = (employee: any, type: 'APPROVED' | 'REJECTED') => {
    setEmployeeActionTarget(employee);
    setEmployeeActionType(type);
    setEmployeeActionNote(type === 'REJECTED' ? (employee.individual_decision_note || '') : '');
    setShowEmployeeActionModal(true);
  };

  const handleEmployeeDecision = async () => {
    if (!detailApproval?.id || !employeeActionTarget?.employee_id) return;
    if (employeeActionType === 'REJECTED' && !employeeActionNote.trim()) {
      setError('Vui lòng nhập lý do từ chối cho nhân sự này');
      return;
    }

    setEmployeeActionProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await workFinalizationApprovalService.decideEmployee(detailApproval.id, employeeActionTarget.employee_id, {
        action: employeeActionType,
        note: employeeActionNote.trim() || undefined,
      });
      setSuccessMsg(`Đã cập nhật quyết định cho ${employeeActionTarget.employee_name || employeeActionTarget.ho_va_ten || 'nhân sự'}`);
      setShowEmployeeActionModal(false);
      const res = await workFinalizationApprovalService.get(detailApproval.id);
      setDetailApproval(res);
      setDetailEmployees(res.employees || []);
      await loadAccountingExports();
      await loadApprovals();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể cập nhật quyết định theo nhân sự');
    } finally {
      setEmployeeActionProcessing(false);
    }
  };

  const openPreviewEmployeeActionModal = (employee: any, type: 'APPROVED' | 'REJECTED') => {
    setPreviewEmployeeActionTarget(employee);
    setPreviewEmployeeActionType(type);
    setPreviewEmployeeActionNote(type === 'REJECTED' ? (employee.individual_decision_note || '') : '');
    setShowPreviewEmployeeActionModal(true);
  };

  const handlePreviewEmployeeDecision = async () => {
    if (!sendConfirmTarget?.approval?.id || !previewEmployeeActionTarget?.employee_id) return;
    if (previewEmployeeActionType === 'REJECTED' && !previewEmployeeActionNote.trim()) {
      setError('Vui lòng nhập lý do từ chối cho nhân sự này');
      return;
    }

    setPreviewEmployeeActionProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await workFinalizationApprovalService.decideEmployee(sendConfirmTarget.approval.id, previewEmployeeActionTarget.employee_id, {
        action: previewEmployeeActionType,
        note: previewEmployeeActionNote.trim() || undefined,
      });
      setSuccessMsg(`Đã cập nhật quyết định cho ${previewEmployeeActionTarget.employee_name || previewEmployeeActionTarget.ho_va_ten || 'nhân sự'}`);
      setShowPreviewEmployeeActionModal(false);
      
      // Reload the preview data to show updated status
      if (sendConfirmTarget) {
        const res = await workFinalizationService.list({
          year: selectedYear,
          month: selectedMonth,
          department_id: sendConfirmTarget.deptId,
        });
        const rows = res.results || [];
        setSendPreviewEmployees(rows);
      }
      
      await loadApprovals();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể cập nhật quyết định theo nhân sự');
    } finally {
      setPreviewEmployeeActionProcessing(false);
    }
  };

  const handleGenerateAccountingExport = async (deptCode?: string) => {
    if (!isAdmin) return;
    const label = deptCode ? `phòng ban ${deptCode}` : `tháng ${selectedMonth}/${selectedYear}`;
    if (!window.confirm(`Tạo bảng chuẩn xuất kế toán cho ${label}?`)) return;
    setAccountingExportGenerating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await workFinalizationAccountingService.generate({
        year: selectedYear,
        month: selectedMonth,
        ...(deptCode ? { department_code: deptCode } : {}),
      });
      setAccountingExportRows(res.results);
      setSelectedExportDepartment(deptCode || null);
      setSuccessMsg(
        `Đã tạo ${res.total_exported} dòng dữ liệu chuẩn cho kế toán ${label}` +
          (res.skipped_departments.length > 0 ? ` (${res.skipped_departments.length} phòng ban chưa đủ quyết định)` : '')
      );
      await loadAccountingExports();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể tạo dữ liệu xuất kế toán. Vui lòng kiểm tra các quyết định của nhân sự.');
    } finally {
      setAccountingExportGenerating(false);
    }
  };

  const openQuickApproveModal = async (approval: DepartmentWorkFinalizationApproval) => {
    setError(null);
    setSuccessMsg(null);
    setQuickApproveTarget(approval);
    setQuickApproveEmployees([]);
    setQuickApproveNote('');
    setShowQuickApproveModal(true);
    setQuickApproveLoading(true);
    try {
      const detail = await workFinalizationApprovalService.get(approval.id);
      setQuickApproveEmployees(detail.employees || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể tải danh sách quyết định hiện có để duyệt nhanh');
      setShowQuickApproveModal(false);
      setQuickApproveTarget(null);
    } finally {
      setQuickApproveLoading(false);
    }
  };

  const handleQuickApproveAndGenerate = async () => {
    if (!quickApproveTarget) return;

    if (quickUndecidedEmployees.length > 0) {
      setError('Vẫn còn nhân sự chưa có quyết định, vui lòng hoàn tất quyết định trước khi duyệt nhanh.');
      return;
    }

    if (quickInvalidDecisionEmployees.length > 0) {
      setError('Có quyết định không phải từ quản lý phụ trách. Admin chỉ duyệt lại khi đúng quản lý phụ trách đã quyết định.');
      return;
    }

    setQuickApproveProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await workFinalizationApprovalService.approve(quickApproveTarget.id, {
        note: quickApproveNote.trim() || undefined,
        require_direct_manager_decisions: true,
      });

      const exportRes = await workFinalizationAccountingService.generate({
        year: selectedYear,
        month: selectedMonth,
        department_code: quickApproveTarget.department_code,
      });

      setShowQuickApproveModal(false);
      setQuickApproveTarget(null);
      setQuickApproveEmployees([]);

      setSuccessMsg(
        `Đã duyệt nhanh phòng ban "${quickApproveTarget.department_name || quickApproveTarget.department_code}" và lưu bảng chuẩn ${exportRes.total_exported} dòng.`
      );

      await loadApprovals();
      await loadAccountingExports();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể duyệt nhanh và lưu bảng chuẩn. Vui lòng thử lại.');
    } finally {
      setQuickApproveProcessing(false);
    }
  };

  const buildAccountingExportPreparedRows = useCallback(async (rows: WorkFinalizationAccountingExportRow[]) => {
    const employeeDetailMap: Record<number, any> = {};
    const employeeIds = Array.from(new Set(rows.map((r) => Number(r.employee_id)).filter((id) => Number.isFinite(id) && id > 0)));
    await Promise.all(
      employeeIds.map(async (employeeId) => {
        try {
          const detail = await employeesAPI.getById(employeeId);
          employeeDetailMap[employeeId] = detail;
        } catch {
          employeeDetailMap[employeeId] = null;
        }
      })
    );

    return rows.map((row, index) =>
      mapEmployeeToExcelLikeRow({
        row,
        index,
        employeeDetail: employeeDetailMap[row.employee_id] || {},
        departmentNameOverride: pickFirstAvailable(row.department_name, row.department_code),
        sentAtOverride: pickFirstAvailable(row.exported_at, row.snapshot?.thoi_gian_gui, row.snapshot?.submitted_at, row.snapshot?.created_at),
        decisionLabelOverride: row.decision_label || row.decision,
        decisionNoteOverride: row.decision_note,
        decidedAtOverride: row.decided_at,
      })
    );
  }, [mapEmployeeToExcelLikeRow]);

  const openAccountingExportPreview = useCallback(async () => {
    if (!exportableAccountingRows.length) return;
    setAccountingPreviewLoading(true);
    setShowAccountingExportModal(true);
    try {
      const preparedRows = await buildAccountingExportPreparedRows(exportableAccountingRows);
      setAccountingPreviewRows(preparedRows);
    } catch {
      setAccountingPreviewRows([]);
      setError('Không thể tải dữ liệu xem trước xuất Excel');
    } finally {
      setAccountingPreviewLoading(false);
    }
  }, [buildAccountingExportPreparedRows, exportableAccountingRows]);

  const downloadAccountingExcel = async (deptCode?: string) => {
    const rowsToExport = (deptCode
      ? accountingExportRows.filter(r => r.department_code === deptCode)
      : accountingExportRows
    ).filter(r => r.decision !== 'REJECTED');
    
    if (!rowsToExport.length) {
      setError('Không có dữ liệu đã duyệt để tải xuống');
      return;
    }

    const formatExcelValue = (value: any) => {
      if (value === undefined || value === null || value === '') return '-';
      return value;
    };
    const preparedRows = await buildAccountingExportPreparedRows(rowsToExport);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Chot cong ke toan');

    sheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Mã NV', key: 'employee_code', width: 16 },
      { header: 'Họ và tên', key: 'employee_name', width: 24 },
      { header: 'Phòng/Ban', key: 'department_name', width: 20 },
      { header: 'Bộ phận', key: 'section', width: 18 },
      { header: 'Cấp bậc', key: 'rank', width: 14 },
      { header: 'Vị trí', key: 'position', width: 18 },
      { header: 'Team Bác sĩ', key: 'doctor_team', width: 20 },
      { header: 'Hình thức làm việc', key: 'work_form', width: 18 },
      { header: 'Ngày nghỉ việc', key: 'end_date', width: 14 },
      { header: 'Thời gian thử việc (tháng)', key: 'probation_months', width: 20 },
      { header: 'Ngày bắt đầu làm việc', key: 'start_date', width: 18 },
      { header: 'Ngày kết thúc thử việc', key: 'probation_end_date', width: 18 },
      { header: 'Tỉ lệ hưởng thử việc', key: 'probation_rate', width: 18 },
      { header: 'Lương cơ bản', key: 'basic_salary', width: 18 },
      { header: 'Phụ cấp', key: 'allowance', width: 14 },
      { header: 'Tỷ lệ % doanh số hưởng', key: 'sales_percent', width: 18 },
      { header: 'Tỷ lệ % lợi nhuận hưởng', key: 'profit_percent', width: 18 },
      { header: 'Khấu trừ BHXH', key: 'si_deduction', width: 14 },
      { header: 'Giảm trừ khác', key: 'giam_tru_khac', width: 14 },
      { header: 'Tình trạng', key: 'employee_status', width: 16 },
      { header: 'Ghi chú công việc', key: 'employment_status_notes', width: 22 },
      { header: 'Thời gian gửi', key: 'sent_at', width: 20 },
      { header: 'Quyết định', key: 'decision_label', width: 14 },
      { header: 'Lý do / Ghi chú', key: 'decision_note', width: 24 },
      { header: 'Thời gian quyết định', key: 'decided_at', width: 20 },
    ];

    preparedRows.forEach((row) => {
      sheet.addRow({
        stt: row.stt,
        employee_code: formatExcelValue(row.employee_code),
        employee_name: formatExcelValue(row.employee_name),
        department_name: formatExcelValue(row.department_name),
        section: formatExcelValue(row.section),
        rank: formatExcelValue(row.rank),
        position: formatExcelValue(row.position),
        doctor_team: formatExcelValue(row.doctor_team),
        work_form: formatExcelValue(row.work_form),
        end_date: formatExcelValue(formatPreviewDate(row.end_date)),
        probation_months: formatExcelValue(row.probation_months),
        start_date: formatExcelValue(formatPreviewDate(row.start_date)),
        probation_end_date: formatExcelValue(formatPreviewDate(row.probation_end_date)),
        probation_rate: formatExcelValue(row.probation_rate),
        basic_salary: formatExcelValue(row.basic_salary),
        allowance: formatExcelValue(row.allowance),
        sales_percent: formatExcelValue(row.sales_percent),
        profit_percent: formatExcelValue(row.profit_percent),
        si_deduction: formatExcelValue(row.si_deduction),
        giam_tru_khac: formatExcelValue(row.giam_tru_khac),
        employee_status: formatExcelValue(row.employee_status),
        employment_status_notes: formatExcelValue(row.employment_status_notes),
        sent_at: formatExcelValue(row.sent_at),
        decision_label: formatExcelValue(row.decision_label),
        decision_note: formatExcelValue(row.decision_note),
        decided_at: formatExcelValue(row.decided_at),
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).cellCount ? sheet.getRow(1).getCell(sheet.getRow(1).cellCount).address : 'A1' };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const fileName = deptCode 
      ? `chot-cong-ke-toan-${deptCode}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.xlsx`
      : `chot-cong-ke-toan-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.xlsx`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Phê duyệt chốt công</h1>
        <p className="mt-2 text-gray-500">Chức năng này chỉ dành cho ADMIN.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Phê duyệt Data nhân sự</h1>
            <p className="text-sm text-gray-900 mt-0.5">Quản lý bảng tính công hàng tháng và xuất báo cáo tính lương.</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={handleSendAll}
            disabled={sendingAll || departments.length === 0}
            className="btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
            {sendingAll ? 'Đang gửi...' : `Gửi phê duyệt tất cả (Tháng ${selectedMonth}/${selectedYear})`}
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-3 p-4 text-sm text-red-700 bg-red-50 rounded-2xl border border-red-200">
          <ExclamationCircleIcon className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 text-sm text-emerald-700 bg-emerald-50 rounded-2xl border border-emerald-200">
          <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Send-all result summary */}
      {sendAllResult && (
        <div className="bg-white rounded-2xl border border-primary-100 shadow-sm p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <BoltIcon className="w-4 h-4 text-primary-500" />
              Kết quả gửi phê duyệt — Tháng {sendAllResult.month}/{sendAllResult.year}
            </span>
            <button onClick={() => setSendAllResult(null)} className="text-xs text-gray-400 hover:text-gray-600 self-start sm:self-auto">
              Đóng
            </button>
          </div>
          <div className="flex gap-4 text-sm mb-3">
            <span className="text-emerald-700 font-medium">✓ Đã xử lý: {sendAllResult.total_processed}</span>
            {sendAllResult.total_errors > 0 && (
              <span className="text-red-600 font-medium">✗ Lỗi: {sendAllResult.total_errors}</span>
            )}
          </div>
          {sendAllResult.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-red-700 mb-1">Chi tiết lỗi:</p>
              <ul className="space-y-1">
                {sendAllResult.errors.map((e) => (
                  <li key={e.department_code} className="text-xs text-red-600 bg-red-50 rounded-xl px-2 py-1">
                    <span className="font-mono">{e.department_code}</span>: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Accounting export panel */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Bảng chuẩn xuất kế toán</h2>
            <p className="text-sm text-gray-500">
              Dữ liệu đã chốt theo tháng {selectedMonth}/{selectedYear}, có thể lưu bảng chuẩn và xuất cho kế toán.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadAccountingExports}
              disabled={accountingExportLoading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-4 h-4 ${accountingExportLoading ? 'animate-spin' : ''}`} />
              Làm mới bảng
            </button>
            <button
              onClick={() => handleGenerateAccountingExport()}
              disabled={accountingExportGenerating}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <PaperAirplaneIcon className={`w-4 h-4 ${accountingExportGenerating ? 'animate-pulse' : ''}`} />
              {accountingExportGenerating ? 'Đang tạo...' : 'Lưu bảng chuẩn'}
            </button>
            <button
              onClick={() => downloadAccountingExcel()}
              disabled={exportableAccountingRows.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Xuất Excel ({exportableAccountingRows.length} dòng)
            </button>
            {selectedExportDepartment && accountingExportRows.length > 0 && (
              <button
                onClick={() => downloadAccountingExcel(selectedExportDepartment)}
                disabled={accountingExportRows.filter(r => r.department_code === selectedExportDepartment && r.decision !== 'REJECTED').length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Xuất {selectedExportDepartment} ({accountingExportRows.filter(r => r.department_code === selectedExportDepartment && r.decision !== 'REJECTED').length})
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-xs text-gray-400 uppercase font-semibold">Tổng dòng</div>
            <div className="text-xl font-bold text-gray-900">{accountingExportRows.length}</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
            <div className="text-xs text-emerald-600 uppercase font-semibold">Đã duyệt</div>
            <div className="text-xl font-bold text-emerald-700">{accountingExportRows.filter(r => r.decision === 'APPROVED').length}</div>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
            <div className="text-xs text-rose-600 uppercase font-semibold">Từ chối</div>
            <div className="text-xl font-bold text-rose-700">{accountingExportRows.filter(r => r.decision === 'REJECTED').length}</div>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
            <div className="text-xs text-amber-600 uppercase font-semibold">Phòng ban đã duyệt</div>
            <div className="text-xl font-bold text-amber-700">{approvedDepartmentCount}</div>
          </div>
        </div>

        <div className="flex justify-center pt-2">
          <button
            onClick={openAccountingExportPreview}
            disabled={exportableAccountingRows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 font-medium"
          >
            <EyeIcon className="w-4 h-4" />
            Xem trước xuất Excel ({exportableAccountingRows.length} dòng)
          </button>
        </div>
      </div>

      {/* Manager: pending-approval card */}
      {isManager && managerDeptCode && (() => {
        const myApproval = getDeptApproval(managerDeptCode);
        if (!myApproval || myApproval.status !== 'PENDING') return null;
        return (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <ClockIcon className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Yêu cầu phê duyệt chốt công đang chờ xử lý
                </p>
                <p className="text-sm text-amber-800 mt-0.5">
                  Phòng ban <span className="font-medium">{myApproval.department_name || myApproval.department_code}</span>{' '}
                  — Tháng {myApproval.month}/{myApproval.year}
                  {myApproval.sent_by_name && (
                    <> · Gửi bởi <span className="font-medium">{myApproval.sent_by_name}</span></>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => openActionModal(myApproval, 'APPROVE')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
              >
                <CheckCircleIcon className="w-4 h-4" />
                Duyệt
              </button>
              <button
                onClick={() => openActionModal(myApproval, 'REJECT')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
              >
                <XCircleIcon className="w-4 h-4" />
                Từ chối
              </button>
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <FunnelIcon className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-bold text-gray-900">Bộ lọc</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
          <SelectBox<number>
            label="Tháng"
            value={selectedMonth}
            options={months.map((m) => ({ value: m, label: `Tháng ${m}` }))}
            onChange={setSelectedMonth}
          />
          <SelectBox<number>
            label="Năm"
            value={selectedYear}
            options={years.map((y) => ({ value: y, label: String(y) }))}
            onChange={setSelectedYear}
          />
          <SelectBox<string>
            label="Phòng ban"
            value={filterDepartmentId}
            options={[
              { value: '', label: 'Tất cả phòng ban' },
              ...departments.map((d) => ({ value: String(d.id), label: d.name })),
            ]}
            onChange={setFilterDepartmentId}
          />
          <SelectBox<string>
            label="Trạng thái"
            value={filterStatus}
            options={[
              { value: '', label: 'Tất cả' },
              { value: 'PENDING', label: 'Chờ duyệt' },
              { value: 'APPROVED', label: 'Đã duyệt' },
              { value: 'REJECTED', label: 'Từ chối' },
            ]}
            onChange={setFilterStatus}
          />
          <div>
            <button
              onClick={loadApprovals}
              className="btn-secondary flex items-center gap-1.5 w-full justify-center"
            >
              <ArrowPathIcon className="w-4 h-4" />
              Làm mới
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-gray-900">Danh sách phê duyệt theo phòng ban</span>
          <span className="text-xs text-gray-400 whitespace-nowrap">{visibleDepartments.length} bản ghi</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : departments.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">Không có phòng ban nào</div>
        ) : visibleDepartments.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">Không có phòng ban nào khớp với bộ lọc</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Phòng ban', 'Trạng thái', 'Người gửi', 'Người duyệt', 'Thời gian duyệt', 'Ghi chú', 'Thao tác'].map((h, i) => (
                    <th
                      key={h}
                      className={`table-header ${i === 6 ? 'text-right' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {visibleDepartments.map((dept) => {
                  const approval = getDeptApproval(dept.code);
                  const isMyDept = isManager && dept.code === managerDeptCode;
                  return (
                    <tr
                      key={dept.id}
                      className={`hover:bg-gray-50 transition-colors ${isMyDept && approval?.status === 'PENDING' ? 'bg-amber-50' : ''}`}
                    >
                      {/* Mobile: cho tên phòng xuống dòng để cột Trạng thái lộ ra
                          ngay trong khung, không phải vuốt ngang mới thấy. */}
                      <td className="table-cell whitespace-normal min-w-[9rem] sm:whitespace-nowrap sm:min-w-0">
                        <div className="font-medium text-gray-900">
                          {dept.name}
                          {isMyDept && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                              Phòng của bạn
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{dept.code}</div>
                      </td>
                      <td className="table-cell">
                        {approval ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getApprovalStatusColor(approval)}`}>
                            {approval.status === 'PENDING' && !isPartiallyApproved(approval) && <ClockIcon className="w-3 h-3" />}
                            {approval.status === 'APPROVED' && <CheckCircleIcon className="w-3 h-3" />}
                            {approval.status === 'REJECTED' && <XCircleIcon className="w-3 h-3" />}
                            {isPartiallyApproved(approval) && <CheckCircleIcon className="w-3 h-3" />}
                            {getApprovalStatusLabel(approval)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Chưa gửi</span>
                        )}
                      </td>
                      <td className="table-cell text-gray-500">{approval?.sent_by_name ?? '—'}</td>
                      <td className="table-cell text-gray-500">{approval?.approved_by_name ?? '—'}</td>
                      <td className="table-cell text-gray-500 whitespace-nowrap">
                        {approval?.approved_at ? new Date(approval.approved_at).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="px-6 py-4 text-gray-500 max-w-xs truncate">{approval?.note ?? '—'}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {isAdmin && approval && approval.status === 'APPROVED' && (
                            <button
                              onClick={() => loadApprovalDetail(approval.id)}
                              disabled={detailLoading}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                              <EyeIcon className="w-3 h-3" />
                              Chi tiết nhân sự
                            </button>
                          )}
                          {isAdmin && approval && approval.status === 'APPROVED' && (
                            <button
                              onClick={() => handleGenerateAccountingExport(dept.code)}
                              disabled={accountingExportGenerating}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                            >
                              <ArrowDownTrayIcon className="w-3 h-3" />
                              Lưu bảng chuẩn
                            </button>
                          )}
                          {isHROrAdmin && (
                            <button
                              onClick={() => openSendConfirmModal(dept.id, dept.code, dept.name, approval)}
                              disabled={sendingDept === dept.code}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                                approval
                                  ? 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
                                  : 'border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100'
                              }`}
                            >
                              <PaperAirplaneIcon className="w-3 h-3" />
                              {sendingDept === dept.code
                                ? 'Đang xử lý...'
                                : isAdmin
                                  ? (approval ? 'Xem lại & gửi lại' : 'Xem & gửi phê duyệt')
                                  : (approval ? 'Chốt lại' : 'Chốt công')}
                            </button>
                          )}
                          {approval && approval.status === 'PENDING' && (isHROrAdmin || (isManager && isMyDept)) && (
                            <>
                              {isAdmin && (
                                <button
                                  onClick={() => openQuickApproveModal(approval)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors"
                                >
                                  <BoltIcon className="w-3 h-3" />
                                  Duyệt nhanh
                                </button>
                              )}
                              <button
                                onClick={() => openActionModal(approval, 'APPROVE')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                              >
                                <CheckCircleIcon className="w-3 h-3" />
                                Duyệt
                              </button>
                              <button
                                onClick={() => openActionModal(approval, 'REJECT')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
                              >
                                <XCircleIcon className="w-3 h-3" />
                                Từ chối
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approve / Reject modal */}
      {showActionModal && actionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                actionType === 'APPROVE' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
              }`}>
                {actionType === 'APPROVE'
                  ? <CheckCircleIcon className="h-5 w-5" />
                  : <XCircleIcon className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">
                  {actionType === 'APPROVE' ? 'Phê duyệt' : 'Từ chối'} chốt công
                </h2>
                <p className="text-xs text-gray-400">
                  {actionTarget.department_name || actionTarget.department_code} — Tháng {actionTarget.month}/{actionTarget.year}
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Ghi chú{' '}
                {actionType === 'REJECT' && <span className="text-gray-400">(tuỳ chọn)</span>}
              </label>
              <textarea
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                rows={3}
                placeholder={actionType === 'APPROVE' ? 'Nhận xét (tuỳ chọn)...' : 'Lý do từ chối (tuỳ chọn)...'}
                className="input-field"
              />
              {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-xl p-3">
                  <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => { setShowActionModal(false); setError(null); }}
                disabled={actionProcessing}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleAction}
                disabled={actionProcessing}
                className={`px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                  actionType === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {actionProcessing
                  ? 'Đang xử lý...'
                  : actionType === 'APPROVE'
                    ? 'Xác nhận duyệt'
                    : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin quick-approve modal */}
      {showQuickApproveModal && quickApproveTarget && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 bg-primary-50">
              <h3 className="text-base font-semibold text-primary-900">Duyệt nhanh theo quyết định hiện có</h3>
              <p className="text-xs text-primary-700 mt-1">
                {quickApproveTarget.department_name || quickApproveTarget.department_code} — Tháng {quickApproveTarget.month}/{quickApproveTarget.year}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/40">
              {quickApproveLoading ? (
                <div className="text-sm text-gray-500">Đang tải danh sách quyết định...</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                      <div className="text-xs uppercase text-emerald-600 font-semibold">Đã duyệt</div>
                      <div className="text-xl font-bold text-emerald-700">{quickApprovedEmployees.length}</div>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                      <div className="text-xs uppercase text-red-600 font-semibold">Từ chối</div>
                      <div className="text-xl font-bold text-red-700">{quickRejectedEmployees.length}</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <div className="text-xs uppercase text-amber-600 font-semibold">Chưa quyết định</div>
                      <div className="text-xl font-bold text-amber-700">{quickUndecidedEmployees.length}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b border-gray-100">
                      Danh sách quyết định hiện có
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-white border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Mã NV</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Họ và tên</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Quyết định</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Người quyết định</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Nguồn quyết định</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Ghi chú</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quickApproveEmployees.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Không có dữ liệu nhân sự</td>
                            </tr>
                          ) : (
                            quickApproveEmployees.map((employee: any) => {
                              const decision = String(employee?.individual_decision || '').toUpperCase();
                              const decisionLabel = decision === 'APPROVED' ? 'Duyệt' : decision === 'REJECTED' ? 'Từ chối' : 'Chưa quyết định';
                              const decisionClass = decision === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-700'
                                : decision === 'REJECTED'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700';
                              const isApprovalManagerDecision = (employee?.individual_decision_from_approval_manager ?? employee?.individual_decision_from_direct_manager) === true;
                              const sourceLabel = !decision
                                ? 'Chưa quyết định'
                                : isApprovalManagerDecision
                                  ? 'Quản lý phụ trách'
                                  : 'Không hợp lệ';
                              const sourceClass = !decision
                                ? 'bg-amber-100 text-amber-700'
                                : isApprovalManagerDecision
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-red-100 text-red-700';

                              return (
                                <tr key={`quick-approve-${employee.employee_id}`} className="border-b border-gray-50 last:border-b-0">
                                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{employee.employee_code || employee.ma_nv || '-'}</td>
                                  <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{employee.employee_name || employee.ho_va_ten || '-'}</td>
                                  <td className="px-4 py-2">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${decisionClass}`}>{decisionLabel}</span>
                                  </td>
                                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{employee.individual_decided_by_name || '-'}</td>
                                  <td className="px-4 py-2">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${sourceClass}`}>{sourceLabel}</span>
                                  </td>
                                  <td className="px-4 py-2 text-gray-600">{employee.individual_decision_note || '-'}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Ghi chú duyệt phòng ban (tuỳ chọn)</label>
                    <textarea
                      value={quickApproveNote}
                      onChange={(e) => setQuickApproveNote(e.target.value)}
                      rows={3}
                      placeholder="Nhận xét khi duyệt nhanh..."
                      className="input-field"
                    />
                  </div>

                  {quickUndecidedEmployees.length > 0 && (
                    <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                      Còn {quickUndecidedEmployees.length} nhân sự chưa có quyết định. Vui lòng quyết định đủ trước khi duyệt nhanh.
                    </div>
                  )}

                  {quickInvalidDecisionEmployees.length > 0 && (
                    <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">
                      Có {quickInvalidDecisionEmployees.length} quyết định không phải do quản lý phụ trách xử lý. Admin chỉ duyệt lại khi quyết định do đúng quản lý phụ trách đưa ra.
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowQuickApproveModal(false);
                  setQuickApproveTarget(null);
                  setQuickApproveEmployees([]);
                }}
                disabled={quickApproveProcessing}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleQuickApproveAndGenerate}
                disabled={
                  quickApproveProcessing ||
                  quickApproveLoading ||
                  quickUndecidedEmployees.length > 0 ||
                  quickInvalidDecisionEmployees.length > 0
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <BoltIcon className="w-4 h-4" />
                {quickApproveProcessing ? 'Đang lưu...' : 'Xác nhận duyệt nhanh & lưu bảng chuẩn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal: employee decisions */}
      {showDetailModal && detailApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[98vw] max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Duyệt theo từng nhân sự</h2>
                <p className="text-sm text-gray-500">
                  {detailApproval.department_name || detailApproval.department_code} — Tháng {detailApproval.month}/{detailApproval.year}
                </p>
              </div>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircleIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50/40">
              <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="text-xs uppercase text-gray-400 font-semibold">Tổng nhân sự</div>
                  <div className="text-xl font-bold text-gray-900">{detailEmployees.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="text-xs uppercase text-emerald-500 font-semibold">Đã duyệt</div>
                  <div className="text-xl font-bold text-emerald-700">{detailEmployees.filter((e) => e.individual_decision === 'APPROVED').length}</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="text-xs uppercase text-red-500 font-semibold">Từ chối</div>
                  <div className="text-xl font-bold text-red-700">{detailEmployees.filter((e) => e.individual_decision === 'REJECTED').length}</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="text-xs uppercase text-amber-500 font-semibold">Chưa quyết định</div>
                  <div className="text-xl font-bold text-amber-700">{detailEmployees.filter((e) => !e.individual_decision).length}</div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-[3200px] divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {[
                          'STT',
                          'Mã NV',
                          'Họ và tên',
                          'Phòng/Ban',
                          'Bộ phận',
                          'Cấp bậc',
                          'Vị trí',
                          'Team Bác sĩ',
                          'Hình thức làm việc',
                          'Ngày nghỉ việc',
                          'Thời gian thử việc (tháng)',
                          'Ngày bắt đầu làm việc',
                          'Ngày kết thúc thử việc',
                          'Tỉ lệ hưởng thử việc',
                          'Lương cơ bản',
                          'Phụ cấp',
                          'Tỷ lệ % doanh số hưởng',
                          'Tỷ lệ % lợi nhuận hưởng',
                          'Khấu trừ BHXH',
                          'Giảm trừ khác',
                          'Tình trạng',
                          'Ghi chú công việc',
                          'Thời gian gửi',
                          'Quyết định',
                          'Lý do / Ghi chú',
                          'Thời gian quyết định',
                          'Thao tác',
                        ].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                      {detailPreparedRows.length === 0 ? (
                        <tr>
                          <td colSpan={26} className="px-4 py-10 text-center text-gray-400">Không có dữ liệu nhân sự</td>
                        </tr>
                      ) : detailPreparedRows.map((row) => {
                        const decision = String(row.decision || '').toUpperCase();
                        const decisionClass = decision === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : decision === 'REJECTED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600';
                        const sourceEmp = row.source || {};

                        return (
                        <tr key={row.id} className="hover:bg-gray-50/70 align-top">
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.stt}</td>
                          <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{row.employee_code}</td>
                          <td className="px-4 py-3 text-gray-900">
                            <div className="font-medium">{row.employee_name}</div>
                            {(sourceEmp.individual_decision_note || sourceEmp.individual_decided_by_name) && (
                              <div className="text-xs text-gray-400 mt-1">
                                {sourceEmp.individual_decision_note ? `Ghi chú: ${sourceEmp.individual_decision_note}` : ''}
                                {sourceEmp.individual_decided_by_name ? ` · Bởi ${sourceEmp.individual_decided_by_name}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.department_name}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.section}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.rank}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.position}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.doctor_team}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.work_form}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.end_date)}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.probation_months}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.start_date)}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.probation_end_date)}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.probation_rate}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.basic_salary)}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.allowance)}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.sales_percent}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.profit_percent}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.si_deduction}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.giam_tru_khac)}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.employee_status}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.employment_status_notes}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.sent_at}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${decisionClass}`}>
                              {row.decision_label === '-' ? 'Chưa quyết định' : row.decision_label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{row.decision_note}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.decided_at}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openEmployeeActionModal(sourceEmp, 'APPROVED')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                              >
                                Duyệt
                              </button>
                              <button
                                onClick={() => openEmployeeActionModal(sourceEmp, 'REJECTED')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                              >
                                Từ chối
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setShowDetailModal(false)} className="btn-secondary">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Employee decision modal */}
      {showEmployeeActionModal && employeeActionTarget && detailApproval && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className={`px-6 py-4 border-b ${employeeActionType === 'APPROVED' ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <h3 className={`font-semibold ${employeeActionType === 'APPROVED' ? 'text-emerald-800' : 'text-red-800'}`}>
                {employeeActionType === 'APPROVED' ? 'Duyệt' : 'Từ chối'} nhân sự
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {employeeActionTarget.employee_name || employeeActionTarget.ho_va_ten || '-'} — {employeeActionTarget.employee_code || employeeActionTarget.ma_nv || '-'}
              </p>
            </div>
            <div className="p-6">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Ghi chú {employeeActionType === 'REJECTED' && <span className="text-gray-400">(bắt buộc)</span>}
              </label>
              <textarea
                value={employeeActionNote}
                onChange={(e) => setEmployeeActionNote(e.target.value)}
                rows={4}
                placeholder={employeeActionType === 'APPROVED' ? 'Ghi chú (tuỳ chọn)...' : 'Lý do từ chối...'}
                className="input-field"
              />
              {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-xl p-3">
                  <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowEmployeeActionModal(false)}
                disabled={employeeActionProcessing}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleEmployeeDecision}
                disabled={employeeActionProcessing}
                className={`px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 ${employeeActionType === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {employeeActionProcessing ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview employee decision modal */}
      {showPreviewEmployeeActionModal && previewEmployeeActionTarget && sendConfirmTarget?.approval && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className={`px-6 py-4 border-b ${previewEmployeeActionType === 'APPROVED' ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <h3 className={`font-semibold ${previewEmployeeActionType === 'APPROVED' ? 'text-emerald-800' : 'text-red-800'}`}>
                {previewEmployeeActionType === 'APPROVED' ? 'Duyệt' : 'Từ chối'} nhân sự
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {previewEmployeeActionTarget.employee_name || previewEmployeeActionTarget.ho_va_ten || '-'} — {previewEmployeeActionTarget.employee_code || previewEmployeeActionTarget.ma_nv || '-'}
              </p>
            </div>
            <div className="p-6">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Ghi chú {previewEmployeeActionType === 'REJECTED' && <span className="text-gray-400">(bắt buộc)</span>}
              </label>
              <textarea
                value={previewEmployeeActionNote}
                onChange={(e) => setPreviewEmployeeActionNote(e.target.value)}
                rows={4}
                placeholder={previewEmployeeActionType === 'APPROVED' ? 'Ghi chú (tuỳ chọn)...' : 'Lý do từ chối...'}
                className="input-field"
              />
              {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-xl p-3">
                  <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowPreviewEmployeeActionModal(false)}
                disabled={previewEmployeeActionProcessing}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={handlePreviewEmployeeDecision}
                disabled={previewEmployeeActionProcessing}
                className={`px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 ${previewEmployeeActionType === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {previewEmployeeActionProcessing ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send confirm modal: review before send */}
      {sendConfirmTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[98vw] max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 bg-primary-50">
              <h3 className="font-semibold text-primary-900">Kiểm tra trước khi gửi phê duyệt</h3>
              <p className="text-xs text-primary-700 mt-1">
                {sendConfirmTarget.deptName} ({sendConfirmTarget.deptCode}) — Tháng {selectedMonth}/{selectedYear}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
                <p>
                  Trạng thái hiện tại:{' '}
                  <span className="font-medium">
                    {sendConfirmTarget.approval ? STATUS_LABELS[sendConfirmTarget.approval.status] : 'Chưa gửi'}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  Danh sách dưới đây là nhân sự đã có dữ liệu tính lương/chốt công của tháng này và sẽ được đưa vào phê duyệt.
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600">
                  Danh sách nhân sự tính lương tháng {selectedMonth}/{selectedYear} ({sendPreviewPreparedRows.length})
                </div>
                {sendPreviewLoading ? (
                  <div className="px-4 py-8 text-sm text-gray-500 text-center">Đang tải danh sách nhân sự...</div>
                ) : sendPreviewPreparedRows.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-amber-700 bg-amber-50 text-center">
                    Chưa có nhân sự nào có dữ liệu tính lương/chốt công cho phòng ban này trong tháng đã chọn.
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-[3200px] text-xs border-separate border-spacing-0">
                      <thead className="bg-white sticky top-0 z-10 border-b border-gray-100">
                        <tr>
                          {[
                            'STT',
                            'Mã NV',
                            'Họ và Tên',
                            'Phòng/Ban',
                            'Bộ phận',
                            'Cấp bậc',
                            'Vị trí',
                            'Team Bác sĩ',
                            'Hình thức làm việc',
                            'Ngày nghỉ việc',
                            'Thời gian thử việc (tháng)',
                            'Ngày bắt đầu làm việc',
                            'Ngày kết thúc thử việc',
                            'Tỉ lệ hưởng thử việc',
                            'Lương cơ bản',
                            'Phụ cấp',
                            'Tỷ lệ % doanh số hưởng',
                            'Tỷ lệ % lợi nhuận hưởng',
                            'Khấu trừ BHXH',
                            'Giảm trừ khác',
                            'Tình trạng',
                            'Ghi chú công việc',
                            'Thời gian gửi',
                            'Quyết định',
                            'Lý do / Ghi chú',
                            'Thời gian quyết định',
                            'Hành động',
                          ].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap border-b border-gray-100">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {sendPreviewPreparedRows.map((row) => {
                          const sourceEmp = row.source || {};
                          return (
                            <tr key={row.id} className="border-b border-gray-50 last:border-b-0 align-top hover:bg-gray-50/60">
                              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.stt}</td>
                              <td className="px-3 py-2 text-gray-900 whitespace-nowrap font-medium">{row.employee_code}</td>
                              <td className="px-3 py-2 text-gray-900 whitespace-nowrap font-medium">
                                {row.employee_name}
                              </td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.department_name}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.section}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.rank}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.position}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.doctor_team}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.work_form}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.end_date)}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.probation_months}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.start_date)}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.probation_end_date)}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.probation_rate}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.basic_salary)}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.allowance)}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.sales_percent}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.profit_percent}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.si_deduction}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.giam_tru_khac)}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.employee_status}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.employment_status_notes}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.sent_at}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.decision_label === '-' ? 'Chưa quyết định' : row.decision_label}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.decision_note}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.decided_at}</td>
                              <td className="px-3 py-2 text-gray-700">
                                <div className="flex items-center gap-1.5 flex-nowrap">
                                  {sendConfirmTarget?.approval ? (
                                    <>
                                      <button
                                        onClick={() => openPreviewEmployeeActionModal(sourceEmp, 'APPROVED')}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                                      >
                                        <CheckCircleIcon className="w-3.5 h-3.5" />
                                        Duyệt
                                      </button>
                                      <button
                                        onClick={() => openPreviewEmployeeActionModal(sourceEmp, 'REJECTED')}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                                      >
                                        <XCircleIcon className="w-3.5 h-3.5" />
                                        Từ chối
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-xs text-gray-400 italic">Gửi phê duyệt trước</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setSendConfirmTarget(null)}
                disabled={sendingDept === sendConfirmTarget.deptCode}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={async () => {
                  await handleSendOne(sendConfirmTarget.deptCode);
                  setSendConfirmTarget(null);
                }}
                disabled={sendingDept === sendConfirmTarget.deptCode || sendPreviewLoading || sendPreviewPreparedRows.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                {sendingDept === sendConfirmTarget.deptCode ? 'Đang gửi...' : 'Xác nhận gửi phê duyệt'}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* Accounting export data modal */}
        {showAccountingExportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-[98vw] max-h-[90vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Xem trước xuất Excel</h2>
                  <p className="text-sm text-gray-500">
                    Tháng {selectedMonth}/{selectedYear} — {accountingPreviewRows.length} dòng đã duyệt
                  </p>
                </div>
                <button
                  onClick={() => setShowAccountingExportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircleIcon className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 bg-gray-50/40">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                  <div className="bg-white rounded-xl border border-gray-100 p-3">
                    <div className="text-xs uppercase text-gray-400 font-semibold">Tổng dòng</div>
                    <div className="text-xl font-bold text-gray-900">{accountingPreviewRows.length}</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 p-3">
                    <div className="text-xs uppercase text-emerald-500 font-semibold">Đã duyệt</div>
                    <div className="text-xl font-bold text-emerald-700">{accountingPreviewRows.length}</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 p-3">
                    <div className="text-xs uppercase text-red-500 font-semibold">Từ chối</div>
                    <div className="text-xl font-bold text-red-700">0</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 p-3">
                    <div className="text-xs uppercase text-amber-500 font-semibold">Phòng ban</div>
                    <div className="text-xl font-bold text-amber-700">{new Set(exportableAccountingRows.map(r => r.department_code)).size}</div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-[3000px] divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          {[
                            'STT',
                            'Mã NV',
                            'Họ và tên',
                            'Phòng/Ban',
                            'Bộ phận',
                            'Cấp bậc',
                            'Vị trí',
                            'Team Bác sĩ',
                            'Hình thức làm việc',
                            'Ngày nghỉ việc',
                            'Thời gian thử việc (tháng)',
                            'Ngày bắt đầu làm việc',
                            'Ngày kết thúc thử việc',
                            'Tỉ lệ hưởng thử việc',
                            'Lương cơ bản',
                            'Phụ cấp',
                            'Tỷ lệ % doanh số hưởng',
                            'Tỷ lệ % lợi nhuận hưởng',
                            'Khấu trừ BHXH',
                            'Tình trạng',
                            'Ghi chú công việc',
                            'Thời gian gửi',
                            'Quyết định',
                            'Lý do / Ghi chú',
                            'Thời gian quyết định',
                          ].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 bg-white">
                        {accountingPreviewLoading ? (
                          <tr>
                            <td colSpan={25} className="px-4 py-10 text-center text-gray-400">Đang tải dữ liệu xem trước...</td>
                          </tr>
                        ) : accountingPreviewRows.length === 0 ? (
                          <tr>
                            <td colSpan={25} className="px-4 py-10 text-center text-gray-400">Chưa có dữ liệu đã duyệt để xuất Excel</td>
                          </tr>
                        ) : accountingPreviewRows.map((row) => {
                          return (
                            <tr key={row.id} className="hover:bg-gray-50/60">
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.stt}</td>
                              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{row.employee_code || '-'}</td>
                              <td className="px-4 py-3 text-gray-900">{row.employee_name}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.department_name || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.section || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.rank || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.position || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.doctor_team || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.work_form}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.end_date)}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.probation_months || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.start_date)}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPreviewDate(row.probation_end_date)}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.probation_rate || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.basic_salary)}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatAmountWithCommas(row.allowance)}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.sales_percent || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.profit_percent || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.si_deduction || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.employee_status || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.employment_status_notes || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.sent_at || '-'}</td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                  {row.decision_label || row.decision}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-700">{row.decision_note || '-'}</td>
                              <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.decided_at || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                <button onClick={() => setShowAccountingExportModal(false)} className="btn-secondary">Đóng</button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default WorkFinalizationApprovals;
