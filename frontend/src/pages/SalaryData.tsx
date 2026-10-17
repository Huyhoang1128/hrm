import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
  ExclamationCircleIcon,
  UserIcon,
  PencilIcon,
  TrashIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import {
  salaryService,
  type CommissionRecord,
  type BulkImportCommissionRecord,
  type PenaltyRecord,
  type BulkImportPenaltyRecord,
  type OtherAllowanceRecord,
  type BulkImportOtherAllowanceRecord,
  type ParkingAllowanceOverrideRecord,
  type BulkImportParkingAllowanceRecord,
  type LunchAllowanceOverrideRecord,
  type BulkImportLunchAllowanceRecord,
  type SalaryAdjustmentRecord,
  type BulkImportSalaryAdjustmentRecord,
  type MonthlySalaryInputRecord,
  type BulkImportMonthlySalaryInputRecord,
} from '../services/salary.service';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import Pagination from '../components/Pagination';
import MissingWorkdayPenaltyTab from '../components/MissingWorkdayPenaltyTab';
import { employeesAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedCommissionRow {
  employee_code: string;
  amount: number;
  rowIndex: number;
  parseError?: string;
}

interface ParsedPenaltyRow {
  employee_code: string;
  amount: number;
  reason: string;
  rowIndex: number;
  parseError?: string;
}

interface ParsedOtherAllowanceRow {
  employee_code: string;
  amount: number;
  description: string;
  rowIndex: number;
  parseError?: string;
}

interface ParsedParkingAllowanceRow {
  employee_code: string;
  amount: number;
  notes: string;
  rowIndex: number;
  parseError?: string;
}

interface ParsedLunchAllowanceRow {
  employee_code: string;
  amount: number;
  notes: string;
  rowIndex: number;
  parseError?: string;
}

interface ParsedSalaryAdjustmentRow {
  employee_code: string;
  amount: number;
  notes: string;
  rowIndex: number;
  parseError?: string;
}

interface ParsedMonthlyInputRow {
  employee_code: string;
  luong_doanh_so: number | null;
  luong_ot: number | null;
  ban_san_pham: number | null;
  phu_mo: number | null;
  truc_ca: number | null;
  thuong: number | null;
  rowIndex: number;
  parseError?: string;
}

type TabKey = 'commission' | 'penalty' | 'other_allowance' | 'parking_allowance' | 'lunch_allowance' | 'salary_adjustment' | 'monthly_input' | 'missing_workday_penalty';

interface AddFormState {
  open: boolean;
  creating: boolean;
  employeeSearch: string;
  employeeId: string;
  employeeLabel: string;
  showEmployeeDropdown: boolean;
  amount: string;
  reason: string;
  description: string;
  notes: string;
}

const INITIAL_ADD_FORM_STATE: AddFormState = {
  open: false,
  creating: false,
  employeeSearch: '',
  employeeId: '',
  employeeLabel: '',
  showEmployeeDropdown: false,
  amount: '',
  reason: '',
  description: '',
  notes: '',
};

const TABS: { key: TabKey; label: string; icon: React.ElementType; hrAllowed?: boolean }[] = [
  { key: 'commission',      label: 'Hoa Hồng',      icon: CurrencyDollarIcon },
  { key: 'penalty',         label: 'Phạt Biên Bản', icon: ExclamationCircleIcon },
  { key: 'other_allowance', label: 'Phụ Cấp Khác',  icon: CurrencyDollarIcon },
  { key: 'parking_allowance', label: 'Phụ Cấp Gửi Xe', icon: CurrencyDollarIcon, hrAllowed: true },
  { key: 'lunch_allowance',   label: 'Phụ Cấp Ăn Trưa', icon: CurrencyDollarIcon, hrAllowed: true },
  { key: 'salary_adjustment', label: 'Điều Chỉnh Lương', icon: CurrencyDollarIcon },
  { key: 'monthly_input', label: 'Dữ Liệu Lương Tháng', icon: CurrencyDollarIcon },
  { key: 'missing_workday_penalty', label: 'Phạt Thiếu Công', icon: ExclamationCircleIcon },
];

// ─── Constants ───────────────────────────────────────────────────────────────

const now = new Date();
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS  = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_PAGE_SIZE = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCellNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && 'result' in (raw as object))
    return extractCellNumber((raw as { result: unknown }).result);
  if (typeof raw === 'string') {
    let s = raw.replace(/\s/g, '').trim();
    if (/^\d{1,3}(\.\d{3})+(,\d*)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function extractCellString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && 'result' in (raw as object))
    return extractCellString((raw as { result: unknown }).result);
  return String(raw).trim();
}

function extractOptionalCellNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = extractCellNumber(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

const fmtMoney = (v: number | string) => {
  const n = Number(v);
  return n ? n.toLocaleString('vi-VN') + ' ₫' : '—';
};

const fmtNullableMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('vi-VN') + ' ₫';
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();

// ─── Component ───────────────────────────────────────────────────────────────

const SalaryData: React.FC = () => {
  const { user } = useAuth();
  const userRole = user?.role ? user.role.toUpperCase() : 'USER';
  const isAdmin = (user as any)?.is_supperuser || (user as any)?.is_superuser || userRole === 'ADMIN';
  const isHR =
    (user as any)?.employee_profile?.is_hr ||
    userRole === 'HR' ||
    (user as any)?.hrm_user?.department_code === 'HCNS';

  const [activeTab, setActiveTab] = useState<TabKey>('commission');
  const defaultMonth = now.getDate() >= 15 ? now.getMonth() + 1 : now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear  = now.getDate() < 15 && now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedYear,  setSelectedYear]  = useState(defaultYear);
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const employeeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [addForms, setAddForms] = useState<Record<TabKey, AddFormState>>({
    commission: { ...INITIAL_ADD_FORM_STATE },
    penalty: { ...INITIAL_ADD_FORM_STATE },
    other_allowance: { ...INITIAL_ADD_FORM_STATE },
    parking_allowance: { ...INITIAL_ADD_FORM_STATE },
    lunch_allowance: { ...INITIAL_ADD_FORM_STATE },
    salary_adjustment: { ...INITIAL_ADD_FORM_STATE },
    monthly_input: { ...INITIAL_ADD_FORM_STATE },
    missing_workday_penalty: { ...INITIAL_ADD_FORM_STATE },
  });

  // ── Commission state ──
  const [commissionRecords,  setCommissionRecords]  = useState<CommissionRecord[]>([]);
  const [loadingCommission,  setLoadingCommission]  = useState(false);
  const [commissionLoaded,   setCommissionLoaded]   = useState(false);
  const [cParsedRows,        setCParsedRows]        = useState<ParsedCommissionRow[] | null>(null);
  const [cFile,              setCFile]              = useState<File | null>(null);
  const [cParsing,           setCParsing]           = useState(false);
  const [cParseError,        setCParseError]        = useState<string | null>(null);
  const [cImporting,         setCImporting]         = useState(false);
  const [cSearch,            setCSearch]            = useState('');
  const [cEditingId,         setCEditingId]         = useState<number | null>(null);
  const [cEditAmount,        setCEditAmount]        = useState('');
  const [cSaving,            setCSaving]            = useState(false);
  const [cDeletingId,        setCDeletingId]        = useState<number | null>(null);
  const [cDeleting,          setCDeleting]          = useState(false);
  const cFileRef = useRef<HTMLInputElement>(null);

  // ── OtherAllowance state ──
  const [oRecords,    setORecords]    = useState<OtherAllowanceRecord[]>([]);
  const [loadingO,    setLoadingO]    = useState(false);
  const [oLoaded,     setOLoaded]     = useState(false);
  const [oParsedRows, setOParsedRows] = useState<ParsedOtherAllowanceRow[] | null>(null);
  const [oFile,       setOFile]       = useState<File | null>(null);
  const [oParsing,    setOParsing]    = useState(false);
  const [oParseError, setOParseError] = useState<string | null>(null);
  const [oImporting,  setOImporting]  = useState(false);
  const [oSearch,     setOSearch]     = useState('');
  const [oEditingId,  setOEditingId]  = useState<number | null>(null);
  const [oEditValues, setOEditValues] = useState({ amount: '', description: '' });
  const [oSaving,     setOSaving]     = useState(false);
  const [oDeletingId, setODeletingId] = useState<number | null>(null);
  const [oDeleting,   setODeleting]   = useState(false);
  const oFileRef = useRef<HTMLInputElement>(null);

  // ── ParkingAllowanceOverride state ──
  const [paRecords,    setPaRecords]    = useState<ParkingAllowanceOverrideRecord[]>([]);
  const [loadingPa,    setLoadingPa]    = useState(false);
  const [paLoaded,     setPaLoaded]     = useState(false);
  const [paParsedRows, setPaParsedRows] = useState<ParsedParkingAllowanceRow[] | null>(null);
  const [paFile,       setPaFile]       = useState<File | null>(null);
  const [paParsing,    setPaParsing]    = useState(false);
  const [paParseError, setPaParseError] = useState<string | null>(null);
  const [paImporting,  setPaImporting]  = useState(false);
  const [paSearch,     setPaSearch]     = useState('');
  const [paEditingId,  setPaEditingId]  = useState<number | null>(null);
  const [paEditValues, setPaEditValues] = useState({ amount: '', notes: '' });
  const [paSaving,     setPaSaving]     = useState(false);
  const [paDeletingId, setPaDeletingId] = useState<number | null>(null);
  const [paDeleting,   setPaDeleting]   = useState(false);
  const [paFillingZero, setPaFillingZero] = useState(false);
  const paFileRef = useRef<HTMLInputElement>(null);

  // ── LunchAllowanceOverride state ──
  const [laRecords,    setLaRecords]    = useState<LunchAllowanceOverrideRecord[]>([]);
  const [loadingLa,    setLoadingLa]    = useState(false);
  const [laLoaded,     setLaLoaded]     = useState(false);
  const [laParsedRows, setLaParsedRows] = useState<ParsedLunchAllowanceRow[] | null>(null);
  const [laFile,       setLaFile]       = useState<File | null>(null);
  const [laParsing,    setLaParsing]    = useState(false);
  const [laParseError, setLaParseError] = useState<string | null>(null);
  const [laImporting,  setLaImporting]  = useState(false);
  const [laSearch,     setLaSearch]     = useState('');
  const [laEditingId,  setLaEditingId]  = useState<number | null>(null);
  const [laEditValues, setLaEditValues] = useState({ amount: '', notes: '' });
  const [laSaving,     setLaSaving]     = useState(false);
  const [laDeletingId, setLaDeletingId] = useState<number | null>(null);
  const [laDeleting,   setLaDeleting]   = useState(false);
  const [laSyncing,    setLaSyncing]    = useState(false);
  const laFileRef = useRef<HTMLInputElement>(null);

  // ── SalaryAdjustment state ──
  const [sRecords,    setSRecords]    = useState<SalaryAdjustmentRecord[]>([]);
  const [loadingS,    setLoadingS]    = useState(false);
  const [sLoaded,     setSLoaded]     = useState(false);
  const [sParsedRows, setSParsedRows] = useState<ParsedSalaryAdjustmentRow[] | null>(null);
  const [sFile,       setSFile]       = useState<File | null>(null);
  const [sParsing,    setSParsing]    = useState(false);
  const [sParseError, setSParseError] = useState<string | null>(null);
  const [sImporting,  setSImporting]  = useState(false);
  const [sSearch,     setSSearch]     = useState('');
  const sFileRef = useRef<HTMLInputElement>(null);

  // ── MonthlyInput state ──
  const [mRecords,    setMRecords]    = useState<MonthlySalaryInputRecord[]>([]);
  const [loadingM,    setLoadingM]    = useState(false);
  const [mLoaded,     setMLoaded]     = useState(false);
  const [mParsedRows, setMParsedRows] = useState<ParsedMonthlyInputRow[] | null>(null);
  const [mFile,       setMFile]       = useState<File | null>(null);
  const [mParsing,    setMParsing]    = useState(false);
  const [mParseError, setMParseError] = useState<string | null>(null);
  const [mImporting,  setMImporting]  = useState(false);
  const [mSearch,     setMSearch]     = useState('');
  const [mDeletingId, setMDeletingId] = useState<number | null>(null);
  const [mDeleting,   setMDeleting]   = useState(false);
  const mFileRef = useRef<HTMLInputElement>(null);

  // ── Penalty state ──
  const [penaltyRecords,  setPenaltyRecords]  = useState<PenaltyRecord[]>([]);
  const [loadingPenalty,  setLoadingPenalty]  = useState(false);
  const [penaltyLoaded,   setPenaltyLoaded]   = useState(false);
  const [pParsedRows,     setPParsedRows]     = useState<ParsedPenaltyRow[] | null>(null);
  const [pFile,           setPFile]           = useState<File | null>(null);
  const [pParsing,        setPParsing]        = useState(false);
  const [pParseError,     setPParseError]     = useState<string | null>(null);
  const [pImporting,      setPImporting]      = useState(false);
  const [pSearch,         setPSearch]         = useState('');
  const [pEditingId,      setPEditingId]      = useState<number | null>(null);
  const [pEditValues,     setPEditValues]     = useState({ amount: '', reason: '' });
  const [pSaving,         setPSaving]         = useState(false);
  const [pDeletingId,     setPDeletingId]     = useState<number | null>(null);
  const [pDeleting,       setPDeleting]       = useState(false);
  const pFileRef = useRef<HTMLInputElement>(null);

  // ── Per-tab import errors (detailed) ──
  const [cImportErr, setCImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedCommissionRow[] } | null>(null);
  const [pImportErr, setPImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedPenaltyRow[] } | null>(null);
  const [oImportErr, setOImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedOtherAllowanceRow[] } | null>(null);
  const [paImportErr, setPaImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedParkingAllowanceRow[] } | null>(null);
  const [laImportErr, setLaImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedLunchAllowanceRow[] } | null>(null);
  const [sImportErr, setSImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedSalaryAdjustmentRow[] } | null>(null);
  const [mImportErr, setMImportErr] = useState<{ errors: {employee_code:string;error:string}[]; failedRows: ParsedMonthlyInputRow[] } | null>(null);

  // ── Phân trang từng tab (cắt phía client trên danh sách đã lọc) ──
  const [pages, setPages] = useState<Record<TabKey, { page: number; size: number }>>(
    () => Object.fromEntries(TABS.map((tab) => [tab.key, { page: 1, size: DEFAULT_PAGE_SIZE }])) as Record<TabKey, { page: number; size: number }>,
  );
  const setPage = useCallback((tab: TabKey, page: number) => {
    setPages((prev) => ({ ...prev, [tab]: { ...prev[tab], page } }));
  }, []);

  // ── Shared toasts ──
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  // ─── Load functions ────────────────────────────────────────────────────────

  const loadCommissions = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingCommission(true);
    setCommissionLoaded(false);
    try {
      const data = await salaryService.listCommissions({ year, month });
      setCommissionRecords(data);
      setCommissionLoaded(true);
    } catch {
      setErrorMsg('Không thể tải danh sách hoa hồng.');
    } finally {
      setLoadingCommission(false);
    }
  }, [selectedMonth, selectedYear]);

  const loadPenalties = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingPenalty(true);
    setPenaltyLoaded(false);
    try {
      const data = await salaryService.listPenalties({ year, month, status: 'APPROVED' });
      setPenaltyRecords(data);
      setPenaltyLoaded(true);
    } catch {
      setErrorMsg('Không thể tải danh sách phạt biên bản.');
    } finally {
      setLoadingPenalty(false);
    }
  }, [selectedMonth, selectedYear]);

  const loadOtherAllowances = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingO(true);
    setOLoaded(false);
    try {
      const data = await salaryService.listOtherAllowances({ year, month });
      setORecords(data);
      setOLoaded(true);
    } catch {
      setErrorMsg('Không thể tải danh sách phụ cấp khác.');
    } finally {
      setLoadingO(false);
    }
  }, [selectedMonth, selectedYear]);

  const loadParkingAllowances = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingPa(true);
    setPaLoaded(false);
    try {
      const data = await salaryService.listParkingAllowanceOverrides({ year, month });
      setPaRecords(data);
      setPaLoaded(true);
    } catch {
      setErrorMsg('Không thể tải danh sách phụ cấp gửi xe.');
    } finally {
      setLoadingPa(false);
    }
  }, [selectedMonth, selectedYear]);

  const loadLunchAllowances = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingLa(true);
    setLaLoaded(false);
    try {
      const data = await salaryService.listLunchAllowanceOverrides({ year, month });
      setLaRecords(data);
      setLaLoaded(true);
    } catch {
      setErrorMsg('Không thể tải danh sách phụ cấp ăn trưa.');
    } finally {
      setLoadingLa(false);
    }
  }, [selectedMonth, selectedYear]);

  const loadSalaryAdjustments = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingS(true);
    setSLoaded(false);
    try {
      const data = await salaryService.listSalaryAdjustments({ year, month });
      setSRecords(data);
      setSLoaded(true);
    } catch {
      setErrorMsg('Không thể tải danh sách điều chỉnh lương.');
    } finally {
      setLoadingS(false);
    }
  }, [selectedMonth, selectedYear]);

  const loadMonthlyInputs = useCallback(async (month = selectedMonth, year = selectedYear) => {
    setLoadingM(true);
    setMLoaded(false);
    try {
      const data = await salaryService.listMonthlyInputs({ year, month });
      setMRecords(data);
      setMLoaded(true);
    } catch {
      setErrorMsg('Không thể tải dữ liệu lương tháng.');
    } finally {
      setLoadingM(false);
    }
  }, [selectedMonth, selectedYear]);

  const setAddForm = useCallback((tab: TabKey, patch: Partial<AddFormState>) => {
    setAddForms((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        ...patch,
      },
    }));
  }, []);

  const resetAddForm = useCallback((tab: TabKey) => {
    setAddForms((prev) => ({
      ...prev,
      [tab]: {
        ...INITIAL_ADD_FORM_STATE,
      },
    }));
  }, []);

  const activeAddForm = addForms[activeTab];

  const filteredEmployees = useMemo(() => {
    const keyword = normalizeText(activeAddForm.employeeSearch || '');
    if (!keyword) return employees;

    return employees.filter((employee) => {
      const fullName = normalizeText(String(employee.full_name || ''));
      const employeeCode = normalizeText(String(employee.employee_id || ''));
      return fullName.includes(keyword) || employeeCode.includes(keyword);
    });
  }, [employees, activeAddForm.employeeSearch]);

  const loadEmployees = useCallback(async (searchKeyword = '') => {
    setEmployeeLoading(true);
    try {
      const keyword = searchKeyword.trim();
      const response = await employeesAPI.list({
        page_size: keyword ? 50 : 200,
        is_active: true,
        search: keyword || undefined,
      });
      setEmployees(response.results || []);
    } catch {
      setEmployees([]);
    } finally {
      setEmployeeLoading(false);
    }
  }, []);

  const handleAddEmployeeSearchChange = (tab: TabKey, value: string) => {
    setAddForm(tab, {
      employeeSearch: value,
      employeeId: '',
      employeeLabel: '',
      showEmployeeDropdown: true,
    });
  };

  const handleSelectAddEmployee = (tab: TabKey, employee: any) => {
    const label = `${employee.employee_id} - ${employee.full_name}`;
    setAddForm(tab, {
      employeeId: String(employee.id),
      employeeLabel: label,
      employeeSearch: label,
      showEmployeeDropdown: false,
    });
  };

  // Auto-load khi đổi tab / tháng / năm
  useEffect(() => {
    if (activeTab === 'parking_allowance') {
      loadParkingAllowances(selectedMonth, selectedYear);
      return;
    }
    if (activeTab === 'lunch_allowance') {
      loadLunchAllowances(selectedMonth, selectedYear);
      return;
    }
    // Các tab còn lại chỉ dành cho Admin — không gọi API cho HR để tránh 403.
    if (!isAdmin) return;
    if (activeTab === 'commission') loadCommissions(selectedMonth, selectedYear);
    else if (activeTab === 'penalty') loadPenalties(selectedMonth, selectedYear);
    else if (activeTab === 'other_allowance') loadOtherAllowances(selectedMonth, selectedYear);
    else if (activeTab === 'salary_adjustment') loadSalaryAdjustments(selectedMonth, selectedYear);
    else if (activeTab === 'monthly_input') loadMonthlyInputs(selectedMonth, selectedYear);
    // 'missing_workday_penalty': danh sách không theo tháng, tab tự tải
  }, [activeTab, selectedMonth, selectedYear, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // HR (không phải Admin) chỉ được dùng các tab phụ cấp gửi xe / ăn trưa — ép về tab
  // đầu tiên được phép khi thông tin user đã sẵn sàng, tránh mặc định vào 'commission' rồi bị 403.
  useEffect(() => {
    if (!isAdmin && isHR && !TABS.some((tab) => tab.key === activeTab && tab.hrAllowed)) {
      setActiveTab('parking_allowance');
    }
  }, [isAdmin, isHR]); // eslint-disable-line react-hooks/exhaustive-deps

  // Về trang 1 khi đổi kỳ hoặc đổi từ khoá tìm kiếm của tab
  useEffect(() => {
    setPages((prev) => Object.fromEntries(
      Object.entries(prev).map(([tab, state]) => [tab, { ...state, page: 1 }]),
    ) as Record<TabKey, { page: number; size: number }>);
  }, [selectedMonth, selectedYear]);
  useEffect(() => { setPage('commission', 1); }, [cSearch, setPage]);
  useEffect(() => { setPage('penalty', 1); }, [pSearch, setPage]);
  useEffect(() => { setPage('other_allowance', 1); }, [oSearch, setPage]);
  useEffect(() => { setPage('parking_allowance', 1); }, [paSearch, setPage]);
  useEffect(() => { setPage('lunch_allowance', 1); }, [laSearch, setPage]);
  useEffect(() => { setPage('salary_adjustment', 1); }, [sSearch, setPage]);
  useEffect(() => { setPage('monthly_input', 1); }, [mSearch, setPage]);

  useEffect(() => {
    if (!activeAddForm.open) return;
    const timer = window.setTimeout(() => {
      loadEmployees(activeAddForm.employeeSearch);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeAddForm.open, activeAddForm.employeeSearch, loadEmployees]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(event.target as Node)) {
        setAddForm(activeTab, { showEmployeeDropdown: false });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeTab, setAddForm]);

  // ─── Month/Year handlers ───────────────────────────────────────────────────

  const clearImportState = () => {
    setCParsedRows(null); setCFile(null); setCImportErr(null); if (cFileRef.current) cFileRef.current.value = '';
    setPParsedRows(null); setPFile(null); setPImportErr(null); if (pFileRef.current) pFileRef.current.value = '';
    setOParsedRows(null); setOFile(null); setOImportErr(null); if (oFileRef.current) oFileRef.current.value = '';
    setPaParsedRows(null); setPaFile(null); setPaImportErr(null); if (paFileRef.current) paFileRef.current.value = '';
    setLaParsedRows(null); setLaFile(null); setLaImportErr(null); if (laFileRef.current) laFileRef.current.value = '';
    setSParsedRows(null); setSFile(null); setSImportErr(null); if (sFileRef.current) sFileRef.current.value = '';
    setMParsedRows(null); setMFile(null); setMImportErr(null); if (mFileRef.current) mFileRef.current.value = '';
  };

  const handleMonthChange = (v: number) => { setSelectedMonth(v); clearImportState(); };
  const handleYearChange  = (v: number) => { setSelectedYear(v);  clearImportState(); };

  // ─── Commission: template ──────────────────────────────────────────────────

  const handleDownloadCommissionTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hoa Hồng');
    ws.columns = [
      { header: 'Mã nhân viên',   key: 'employee_code',    width: 20 },
      { header: 'Lương hoa hồng', key: 'commission_amount', width: 22 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', commission_amount: 5000000 });
    ws.addRow({ employee_code: 'NV002', commission_amount: 3000000 });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_hoa_hong_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Commission: parse Excel ───────────────────────────────────────────────

  const handleCommissionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setCParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setCFile(f); setCParseError(null); setCParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setCParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setCParseError('File không có sheet nào.'); return; }
      const rows: ParsedCommissionRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const amount = extractCellNumber(row.getCell(2).value);
        rows.push({ employee_code: code, amount, rowIndex: idx, parseError: amount < 0 ? 'Số tiền không hợp lệ' : undefined });
      });
      if (!rows.length) { setCParseError('File không có dữ liệu.'); return; }
      setCParsedRows(rows);
    } catch { setCParseError('Không thể đọc file.'); }
    finally { setCParsing(false); }
  };

  // ─── Commission: import ────────────────────────────────────────────────────

  const handleCommissionImport = async () => {
    if (!cParsedRows) return;
    const valid = cParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setCImporting(true);
    try {
      const records: BulkImportCommissionRecord[] = valid.map((r) => ({ employee_code: r.employee_code, commission_amount: r.amount }));
      const res = await salaryService.bulkImportCommissions({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} hoa hồng.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (cParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setCImportErr({ errors: res.errors, failedRows });
      }
      setCParsedRows(null); setCFile(null); if (cFileRef.current) cFileRef.current.value = '';
      await loadCommissions();
    } catch { setErrorMsg('Lỗi kết nối máy chủ.'); }
    finally { setCImporting(false); }
  };

  // ─── Commission: edit/delete ───────────────────────────────────────────────

  const startCEdit = (rec: CommissionRecord) => { setCEditingId(rec.id); setCEditAmount(String(Number(rec.amount))); setCDeletingId(null); };
  const cancelCEdit = () => setCEditingId(null);

  const handleCSave = async (id: number) => {
    const amount = parseFloat(cEditAmount.replace(/,/g, '')) || 0;
    setCSaving(true);
    try {
      const updated = await salaryService.updateCommission(id, { amount });
      setCommissionRecords((prev) => prev.map((r) => r.id === id ? { ...r, ...updated } : r));
      setCEditingId(null); setSuccessMsg('Đã cập nhật hoa hồng.');
    } catch { setErrorMsg('Không thể cập nhật.'); }
    finally { setCSaving(false); }
  };

  const handleCDelete = async (id: number) => {
    setCDeleting(true);
    try {
      await salaryService.deleteCommission(id);
      setCommissionRecords((prev) => prev.filter((r) => r.id !== id));
      setCDeletingId(null); setSuccessMsg('Đã xoá hoa hồng.');
    } catch { setErrorMsg('Không thể xoá.'); }
    finally { setCDeleting(false); }
  };

  const handleCreateCommission = async () => {
    const form = addForms.commission;
    const parsedAmount = Number(form.amount.replace(/,/g, ''));

    setSuccessMsg(null);
    setErrorMsg(null);
    if (!form.employeeId) {
      setErrorMsg('Vui lòng chọn nhân sự trước khi thêm hoa hồng.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Số tiền hoa hồng phải lớn hơn 0.');
      return;
    }

    setAddForm('commission', { creating: true });
    try {
      await salaryService.createCommission({
        employee: Number(form.employeeId),
        year: selectedYear,
        month: selectedMonth,
        amount: parsedAmount,
        notes: form.notes || undefined,
      });
      setSuccessMsg('Đã thêm hoa hồng cho nhân sự.');
      resetAddForm('commission');
      await loadCommissions();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setErrorMsg(apiMessage || 'Không thể thêm hoa hồng.');
    } finally {
      setAddForm('commission', { creating: false });
    }
  };

  // ─── Penalty: template ─────────────────────────────────────────────────────

  const handleDownloadPenaltyTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Phạt Biên Bản');
    ws.columns = [
      { header: 'Mã nhân viên',  key: 'employee_code', width: 20 },
      { header: 'Số tiền phạt',  key: 'amount',        width: 20 },
      { header: 'Lý do vi phạm', key: 'reason',        width: 40 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD93D1A' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', amount: 500000, reason: 'Đi muộn 3 lần' });
    ws.addRow({ employee_code: 'NV002', amount: 200000, reason: 'Không đeo đồng phục' });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_phat_bien_ban_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Penalty: parse Excel ──────────────────────────────────────────────────

  const handlePenaltyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setPParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setPFile(f); setPParseError(null); setPParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setPParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setPParseError('File không có sheet nào.'); return; }
      const rows: ParsedPenaltyRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const amount = extractCellNumber(row.getCell(2).value);
        const reason = extractCellString(row.getCell(3).value);
        rows.push({ employee_code: code, amount, reason, rowIndex: idx, parseError: amount < 0 ? 'Số tiền không hợp lệ' : undefined });
      });
      if (!rows.length) { setPParseError('File không có dữ liệu.'); return; }
      setPParsedRows(rows);
    } catch { setPParseError('Không thể đọc file.'); }
    finally { setPParsing(false); }
  };

  // ─── Penalty: import ───────────────────────────────────────────────────────

  const handlePenaltyImport = async () => {
    if (!pParsedRows) return;
    const valid = pParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setPImporting(true);
    try {
      const records: BulkImportPenaltyRecord[] = valid.map((r) => ({ employee_code: r.employee_code, amount: r.amount, reason: r.reason }));
      const res = await salaryService.bulkImportPenalties({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} bản ghi phạt.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (pParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setPImportErr({ errors: res.errors, failedRows });
      }
      setPParsedRows(null); setPFile(null); if (pFileRef.current) pFileRef.current.value = '';
      await loadPenalties();
    } catch { setErrorMsg('Lỗi kết nối máy chủ.'); }
    finally { setPImporting(false); }
  };

  // ─── Penalty: edit/delete ──────────────────────────────────────────────────

  const startPEdit = (rec: PenaltyRecord) => { setPEditingId(rec.id); setPEditValues({ amount: String(Number(rec.amount)), reason: rec.reason }); setPDeletingId(null); };
  const cancelPEdit = () => setPEditingId(null);

  const handlePSave = async (id: number) => {
    const amount = parseFloat(pEditValues.amount.replace(/,/g, '')) || 0;
    setPSaving(true);
    try {
      const updated = await salaryService.updatePenalty(id, { amount, reason: pEditValues.reason });
      setPenaltyRecords((prev) => prev.map((r) => r.id === id ? { ...r, ...updated } : r));
      setPEditingId(null); setSuccessMsg('Đã cập nhật phạt biên bản.');
    } catch { setErrorMsg('Không thể cập nhật.'); }
    finally { setPSaving(false); }
  };

  const handlePDelete = async (id: number) => {
    setPDeleting(true);
    try {
      await salaryService.deletePenalty(id);
      setPenaltyRecords((prev) => prev.filter((r) => r.id !== id));
      setPDeletingId(null); setSuccessMsg('Đã xoá phạt biên bản.');
    } catch { setErrorMsg('Không thể xoá.'); }
    finally { setPDeleting(false); }
  };

  const handleCreatePenalty = async () => {
    const form = addForms.penalty;
    const parsedAmount = Number(form.amount.replace(/,/g, ''));

    setSuccessMsg(null);
    setErrorMsg(null);
    if (!form.employeeId) {
      setErrorMsg('Vui lòng chọn nhân sự trước khi thêm phạt biên bản.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Số tiền phạt phải lớn hơn 0.');
      return;
    }

    setAddForm('penalty', { creating: true });
    try {
      await salaryService.createPenalty({
        employee: Number(form.employeeId),
        year: selectedYear,
        month: selectedMonth,
        amount: parsedAmount,
        reason: form.reason || '',
        notes: form.notes || undefined,
      });
      setSuccessMsg('Đã thêm phạt biên bản cho nhân sự.');
      resetAddForm('penalty');
      await loadPenalties();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setErrorMsg(apiMessage || 'Không thể thêm phạt biên bản.');
    } finally {
      setAddForm('penalty', { creating: false });
    }
  };


  // ─── OtherAllowance: template ──────────────────────────────────────────────

  const handleDownloadOtherAllowanceTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Phụ Cấp Khác');
    ws.columns = [
      { header: 'Mã nhân viên',   key: 'employee_code', width: 20 },
      { header: 'Số tiền phụ cấp', key: 'amount',       width: 22 },
      { header: 'Mô tả phụ cấp',  key: 'description',   width: 30 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', amount: 200000, description: 'Phụ cấp điện thoại' });
    ws.addRow({ employee_code: 'NV002', amount: 500000, description: 'Phụ cấp xăng xe' });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_phu_cap_khac_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── OtherAllowance: parse Excel ──────────────────────────────────────────

  const handleOtherAllowanceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setOParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setOFile(f); setOParseError(null); setOParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setOParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setOParseError('File không có sheet nào.'); return; }
      const rows: ParsedOtherAllowanceRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const amount = extractCellNumber(row.getCell(2).value);
        const description = extractCellString(row.getCell(3).value);
        rows.push({ employee_code: code, amount, description, rowIndex: idx, parseError: amount < 0 ? 'Số tiền không hợp lệ' : undefined });
      });
      if (!rows.length) { setOParseError('File không có dữ liệu.'); return; }
      setOParsedRows(rows);
    } catch { setOParseError('Không thể đọc file.'); }
    finally { setOParsing(false); }
  };

  // ─── OtherAllowance: import ────────────────────────────────────────────────

  const handleOtherAllowanceImport = async () => {
    if (!oParsedRows) return;
    const valid = oParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setOImporting(true);
    try {
      const records: BulkImportOtherAllowanceRecord[] = valid.map((r) => ({ employee_code: r.employee_code, amount: r.amount, description: r.description }));
      const res = await salaryService.bulkImportOtherAllowances({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} phụ cấp.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (oParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setOImportErr({ errors: res.errors, failedRows });
      }
      setOParsedRows(null); setOFile(null); if (oFileRef.current) oFileRef.current.value = '';
      await loadOtherAllowances();
    } catch { setErrorMsg('Lỗi kết nối máy chủ.'); }
    finally { setOImporting(false); }
  };

  // ─── OtherAllowance: edit/delete ───────────────────────────────────────────

  const startOEdit = (rec: OtherAllowanceRecord) => { setOEditingId(rec.id); setOEditValues({ amount: String(Number(rec.amount)), description: rec.description }); setODeletingId(null); };
  const cancelOEdit = () => setOEditingId(null);

  const handleOSave = async (id: number) => {
    const amount = parseFloat(oEditValues.amount.replace(/,/g, '')) || 0;
    setOSaving(true);
    try {
      const updated = await salaryService.updateOtherAllowance(id, { amount, description: oEditValues.description });
      setORecords((prev) => prev.map((r) => r.id === id ? { ...r, ...updated } : r));
      setOEditingId(null); setSuccessMsg('Đã cập nhật phụ cấp.');
    } catch { setErrorMsg('Không thể cập nhật.'); }
    finally { setOSaving(false); }
  };

  const handleODelete = async (id: number) => {
    setODeleting(true);
    try {
      await salaryService.deleteOtherAllowance(id);
      setORecords((prev) => prev.filter((r) => r.id !== id));
      setODeletingId(null); setSuccessMsg('Đã xoá phụ cấp.');
    } catch { setErrorMsg('Không thể xoá.'); }
    finally { setODeleting(false); }
  };

  const handleCreateOtherAllowance = async () => {
    const form = addForms.other_allowance;
    const parsedAmount = Number(form.amount.replace(/,/g, ''));

    setSuccessMsg(null);
    setErrorMsg(null);
    if (!form.employeeId) {
      setErrorMsg('Vui lòng chọn nhân sự trước khi thêm phụ cấp.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Số tiền phụ cấp phải lớn hơn 0.');
      return;
    }

    setAddForm('other_allowance', { creating: true });
    try {
      await salaryService.createOtherAllowance({
        employee: Number(form.employeeId),
        year: selectedYear,
        month: selectedMonth,
        amount: parsedAmount,
        description: form.description || '',
        notes: form.notes || undefined,
      });
      setSuccessMsg('Đã thêm phụ cấp cho nhân sự.');
      resetAddForm('other_allowance');
      await loadOtherAllowances();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setErrorMsg(apiMessage || 'Không thể thêm phụ cấp.');
    } finally {
      setAddForm('other_allowance', { creating: false });
    }
  };

  // ─── ParkingAllowanceOverride: template ───────────────────────────────────

  const handleDownloadParkingAllowanceTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Phụ Cấp Gửi Xe');
    ws.columns = [
      { header: 'Mã nhân viên',              key: 'employee_code', width: 20 },
      { header: 'Số tiền phụ cấp gửi xe',    key: 'amount',        width: 24 },
      { header: 'Ghi chú',                    key: 'notes',         width: 30 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', amount: 150000, notes: '' });
    ws.addRow({ employee_code: 'NV002', amount: 200000, notes: 'Đã tính theo số ngày công thực tế' });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_phu_cap_gui_xe_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── ParkingAllowanceOverride: parse Excel ────────────────────────────────

  const handleParkingAllowanceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setPaParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setPaFile(f); setPaParseError(null); setPaParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setPaParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setPaParseError('File không có sheet nào.'); return; }
      const rows: ParsedParkingAllowanceRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const amount = extractCellNumber(row.getCell(2).value);
        const notes = extractCellString(row.getCell(3).value);
        rows.push({ employee_code: code, amount, notes, rowIndex: idx, parseError: amount < 0 ? 'Số tiền không hợp lệ' : undefined });
      });
      if (!rows.length) { setPaParseError('File không có dữ liệu.'); return; }
      setPaParsedRows(rows);
    } catch { setPaParseError('Không thể đọc file.'); }
    finally { setPaParsing(false); }
  };

  // ─── ParkingAllowanceOverride: import ─────────────────────────────────────

  const handleParkingAllowanceImport = async () => {
    if (!paParsedRows) return;
    const valid = paParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setPaImporting(true);
    try {
      const records: BulkImportParkingAllowanceRecord[] = valid.map((r) => ({ employee_code: r.employee_code, amount: r.amount, notes: r.notes }));
      const res = await salaryService.bulkImportParkingAllowanceOverrides({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} phụ cấp gửi xe.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (paParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setPaImportErr({ errors: res.errors, failedRows });
      }
      setPaParsedRows(null); setPaFile(null); if (paFileRef.current) paFileRef.current.value = '';
      await loadParkingAllowances();
    } catch { setErrorMsg('Lỗi kết nối máy chủ.'); }
    finally { setPaImporting(false); }
  };

  // ─── ParkingAllowanceOverride: edit/delete ────────────────────────────────

  const startPaEdit = (rec: ParkingAllowanceOverrideRecord) => { setPaEditingId(rec.id); setPaEditValues({ amount: String(Number(rec.amount)), notes: rec.notes }); setPaDeletingId(null); };
  const cancelPaEdit = () => setPaEditingId(null);

  const handlePaSave = async (id: number) => {
    const amount = parseFloat(paEditValues.amount.replace(/,/g, '')) || 0;
    setPaSaving(true);
    try {
      const updated = await salaryService.updateParkingAllowanceOverride(id, { amount, notes: paEditValues.notes });
      setPaRecords((prev) => prev.map((r) => r.id === id ? { ...r, ...updated } : r));
      setPaEditingId(null); setSuccessMsg('Đã cập nhật phụ cấp gửi xe.');
    } catch { setErrorMsg('Không thể cập nhật.'); }
    finally { setPaSaving(false); }
  };

  const handlePaDelete = async (id: number) => {
    setPaDeleting(true);
    try {
      await salaryService.deleteParkingAllowanceOverride(id);
      setPaRecords((prev) => prev.filter((r) => r.id !== id));
      setPaDeletingId(null); setSuccessMsg('Đã xoá phụ cấp gửi xe.');
    } catch { setErrorMsg('Không thể xoá.'); }
    finally { setPaDeleting(false); }
  };

  const handleCreateParkingAllowance = async () => {
    const form = addForms.parking_allowance;
    const parsedAmount = Number(form.amount.replace(/,/g, ''));

    setSuccessMsg(null);
    setErrorMsg(null);
    if (!form.employeeId) {
      setErrorMsg('Vui lòng chọn nhân sự trước khi thêm phụ cấp gửi xe.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Số tiền phụ cấp gửi xe phải lớn hơn 0.');
      return;
    }

    setAddForm('parking_allowance', { creating: true });
    try {
      await salaryService.createParkingAllowanceOverride({
        employee: Number(form.employeeId),
        year: selectedYear,
        month: selectedMonth,
        amount: parsedAmount,
        notes: form.notes || undefined,
      });
      setSuccessMsg('Đã thêm phụ cấp gửi xe cho nhân sự.');
      resetAddForm('parking_allowance');
      await loadParkingAllowances();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setErrorMsg(apiMessage || 'Không thể thêm phụ cấp gửi xe.');
    } finally {
      setAddForm('parking_allowance', { creating: false });
    }
  };

  // ─── ParkingAllowanceOverride: đặt 0 cho người còn lại ────────────────────

  const handlePaFillRemainingZero = async () => {
    const confirmed = window.confirm(
      `Đặt phụ cấp gửi xe = 0 cho TẤT CẢ nhân viên đang hoạt động chưa có trong danh sách tháng ${selectedMonth}/${selectedYear}?\n` +
      'Không ảnh hưởng tới các bản ghi đã có (kể cả > 0).',
    );
    if (!confirmed) return;
    setPaFillingZero(true); setSuccessMsg(null); setErrorMsg(null);
    try {
      const res = await salaryService.fillRemainingParkingAllowanceZero({ year: selectedYear, month: selectedMonth });
      setSuccessMsg(`Đã đặt 0 cho ${res.created_count} nhân viên còn lại.${res.errors.length ? ` (${res.errors.length} lỗi)` : ''}`);
      await loadParkingAllowances();
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể đặt 0 cho người còn lại.');
    } finally {
      setPaFillingZero(false);
    }
  };

  // ─── LunchAllowanceOverride: template ───────────────────────────────────

  const handleDownloadLunchAllowanceTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Phụ Cấp Ăn Trưa');
    ws.columns = [
      { header: 'Mã nhân viên',              key: 'employee_code', width: 20 },
      { header: 'Số tiền phụ cấp ăn trưa',    key: 'amount',        width: 24 },
      { header: 'Ghi chú',                    key: 'notes',         width: 30 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', amount: 300000, notes: '' });
    ws.addRow({ employee_code: 'NV002', amount: 450000, notes: 'Đã tính theo số ngày công thực tế' });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_phu_cap_an_trua_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── LunchAllowanceOverride: parse Excel ────────────────────────────────

  const handleLunchAllowanceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setLaParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setLaFile(f); setLaParseError(null); setLaParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setLaParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setLaParseError('File không có sheet nào.'); return; }
      const rows: ParsedLunchAllowanceRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const amount = extractCellNumber(row.getCell(2).value);
        const notes = extractCellString(row.getCell(3).value);
        rows.push({ employee_code: code, amount, notes, rowIndex: idx, parseError: amount < 0 ? 'Số tiền không hợp lệ' : undefined });
      });
      if (!rows.length) { setLaParseError('File không có dữ liệu.'); return; }
      setLaParsedRows(rows);
    } catch { setLaParseError('Không thể đọc file.'); }
    finally { setLaParsing(false); }
  };

  // ─── LunchAllowanceOverride: import ─────────────────────────────────────

  const handleLunchAllowanceImport = async () => {
    if (!laParsedRows) return;
    const valid = laParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setLaImporting(true);
    try {
      const records: BulkImportLunchAllowanceRecord[] = valid.map((r) => ({ employee_code: r.employee_code, amount: r.amount, notes: r.notes }));
      const res = await salaryService.bulkImportLunchAllowanceOverrides({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} phụ cấp ăn trưa.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (laParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setLaImportErr({ errors: res.errors, failedRows });
      }
      setLaParsedRows(null); setLaFile(null); if (laFileRef.current) laFileRef.current.value = '';
      await loadLunchAllowances();
    } catch { setErrorMsg('Lỗi kết nối máy chủ.'); }
    finally { setLaImporting(false); }
  };

  // ─── LunchAllowanceOverride: edit/delete ────────────────────────────────

  const startLaEdit = (rec: LunchAllowanceOverrideRecord) => { setLaEditingId(rec.id); setLaEditValues({ amount: String(Number(rec.amount)), notes: rec.notes }); setLaDeletingId(null); };
  const cancelLaEdit = () => setLaEditingId(null);

  const handleLaSave = async (id: number) => {
    const amount = parseFloat(laEditValues.amount.replace(/,/g, '')) || 0;
    setLaSaving(true);
    try {
      const updated = await salaryService.updateLunchAllowanceOverride(id, { amount, notes: laEditValues.notes });
      setLaRecords((prev) => prev.map((r) => r.id === id ? { ...r, ...updated } : r));
      setLaEditingId(null); setSuccessMsg('Đã cập nhật phụ cấp ăn trưa.');
    } catch { setErrorMsg('Không thể cập nhật.'); }
    finally { setLaSaving(false); }
  };

  const handleLaDelete = async (id: number) => {
    setLaDeleting(true);
    try {
      await salaryService.deleteLunchAllowanceOverride(id);
      setLaRecords((prev) => prev.filter((r) => r.id !== id));
      setLaDeletingId(null); setSuccessMsg('Đã xoá phụ cấp ăn trưa.');
    } catch { setErrorMsg('Không thể xoá.'); }
    finally { setLaDeleting(false); }
  };

  const handleCreateLunchAllowance = async () => {
    const form = addForms.lunch_allowance;
    const parsedAmount = Number(form.amount.replace(/,/g, ''));

    setSuccessMsg(null);
    setErrorMsg(null);
    if (!form.employeeId) {
      setErrorMsg('Vui lòng chọn nhân sự trước khi thêm phụ cấp ăn trưa.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Số tiền phụ cấp ăn trưa phải lớn hơn 0.');
      return;
    }

    setAddForm('lunch_allowance', { creating: true });
    try {
      await salaryService.createLunchAllowanceOverride({
        employee: Number(form.employeeId),
        year: selectedYear,
        month: selectedMonth,
        amount: parsedAmount,
        notes: form.notes || undefined,
      });
      setSuccessMsg('Đã thêm phụ cấp ăn trưa cho nhân sự.');
      resetAddForm('lunch_allowance');
      await loadLunchAllowances();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setErrorMsg(apiMessage || 'Không thể thêm phụ cấp ăn trưa.');
    } finally {
      setAddForm('lunch_allowance', { creating: false });
    }
  };

  // ─── LunchAllowanceOverride: đồng bộ giá trị đang tính tự động ───────────

  const handleLaSyncCurrent = async () => {
    const confirmed = window.confirm(
      `Tạo bản ghi phụ cấp ăn trưa theo giá trị đang tính tự động cho các nhân viên chưa có trong danh sách tháng ${selectedMonth}/${selectedYear}?\n` +
      'Không ảnh hưởng tới các bản ghi đã có.',
    );
    if (!confirmed) return;
    setLaSyncing(true); setSuccessMsg(null); setErrorMsg(null);
    try {
      const res = await salaryService.syncCurrentLunchAllowances({ year: selectedYear, month: selectedMonth });
      setSuccessMsg(`Đã đồng bộ ${res.created_count} nhân viên (bỏ qua ${res.skipped_existing_count} đã có).${res.errors.length ? ` (${res.errors.length} lỗi)` : ''}`);
      await loadLunchAllowances();
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể đồng bộ phụ cấp ăn trưa.');
    } finally {
      setLaSyncing(false);
    }
  };

  // ─── SalaryAdjustment: template ───────────────────────────────────────────

  const handleDownloadSalaryAdjustmentTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Điều Chỉnh Lương');
    ws.columns = [
      { header: 'Mã nhân viên',      key: 'employee_code', width: 20 },
      { header: 'Số tiền điều chỉnh', key: 'amount',       width: 22 },
      { header: 'Ghi chú',           key: 'notes',         width: 30 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', amount: 500000, notes: 'Thưởng thêm' });
    ws.addRow({ employee_code: 'NV002', amount: -300000, notes: 'Điều chỉnh giảm' });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_dieu_chinh_luong_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── SalaryAdjustment: parse Excel ───────────────────────────────────────

  const handleSalaryAdjustmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setSParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setSFile(f); setSParseError(null); setSParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setSParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setSParseError('File không có sheet nào.'); return; }
      const rows: ParsedSalaryAdjustmentRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const amount = extractCellNumber(row.getCell(2).value);
        const notes = extractCellString(row.getCell(3).value);
        rows.push({ employee_code: code, amount, notes, rowIndex: idx });
      });
      if (!rows.length) { setSParseError('File không có dữ liệu.'); return; }
      setSParsedRows(rows);
    } catch { setSParseError('Không thể đọc file.'); }
    finally { setSParsing(false); }
  };

  // ─── SalaryAdjustment: import ────────────────────────────────────────────

  const handleSalaryAdjustmentImport = async () => {
    if (!sParsedRows) return;
    const valid = sParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setSImporting(true);
    try {
      const records: BulkImportSalaryAdjustmentRecord[] = valid.map((r) => ({
        employee_code: r.employee_code,
        amount: r.amount,
        notes: r.notes,
      }));
      const res = await salaryService.bulkImportSalaryAdjustments({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} điều chỉnh lương.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (sParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setSImportErr({ errors: res.errors, failedRows });
      }
      setSParsedRows(null); setSFile(null); if (sFileRef.current) sFileRef.current.value = '';
      await loadSalaryAdjustments();
    } catch { setErrorMsg('Lỗi kết nối máy chủ.'); }
    finally { setSImporting(false); }
  };

  const handleCreateSalaryAdjustment = async () => {
    const form = addForms.salary_adjustment;
    const parsedAmount = Number(form.amount.replace(/,/g, ''));

    setSuccessMsg(null);
    setErrorMsg(null);
    if (!form.employeeId) {
      setErrorMsg('Vui lòng chọn nhân sự trước khi thêm điều chỉnh lương.');
      return;
    }
    if (!Number.isFinite(parsedAmount)) {
      setErrorMsg('Số tiền điều chỉnh không hợp lệ.');
      return;
    }

    setAddForm('salary_adjustment', { creating: true });
    try {
      await salaryService.createSalaryAdjustment({
        employee: Number(form.employeeId),
        year: selectedYear,
        month: selectedMonth,
        amount: parsedAmount,
        notes: form.notes || undefined,
      });
      setSuccessMsg('Đã thêm điều chỉnh lương cho nhân sự.');
      resetAddForm('salary_adjustment');
      await loadSalaryAdjustments();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setErrorMsg(apiMessage || 'Không thể thêm điều chỉnh lương.');
    } finally {
      setAddForm('salary_adjustment', { creating: false });
    }
  };

  // ─── MonthlyInput: template ──────────────────────────────────────────────

  const handleDownloadMonthlyInputTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dữ Liệu Lương Tháng');
    ws.columns = [
      { header: 'Mã Nhân Viên', key: 'employee_code', width: 20 },
      { header: 'Lương doanh số', key: 'luong_doanh_so', width: 18 },
      { header: 'Lương OT', key: 'luong_ot', width: 16 },
      { header: 'Bán sản phẩm', key: 'ban_san_pham', width: 18 },
      { header: 'Phụ mổ', key: 'phu_mo', width: 14 },
      { header: 'Trực Ca', key: 'truc_ca', width: 14 },
      { header: 'Thưởng', key: 'thuong', width: 16 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 28;
    ws.addRow({ employee_code: 'NV001', luong_doanh_so: 5000000, luong_ot: 800000, ban_san_pham: 1200000, phu_mo: 0, truc_ca: 350000, thuong: 1000000 });
    ws.addRow({ employee_code: 'NV002', luong_doanh_so: -500000, luong_ot: 400000, ban_san_pham: '', phu_mo: 250000, truc_ca: 0, thuong: '' });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `template_du_lieu_luong_thang_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── MonthlyInput: parse Excel ───────────────────────────────────────────

  const handleMonthlyInputFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setMParseError('Chỉ chấp nhận file Excel (.xlsx)'); return; }
    setMFile(f); setMParseError(null); setMParsedRows(null); setSuccessMsg(null); setErrorMsg(null); setMParsing(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { setMParseError('File không có sheet nào.'); return; }
      const rows: ParsedMonthlyInputRow[] = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
        if (!code) return;
        const luongDoanhSo = extractOptionalCellNumber(row.getCell(2).value);
        const luongOt = extractOptionalCellNumber(row.getCell(3).value);
        const banSanPham = extractOptionalCellNumber(row.getCell(4).value);
        const phuMo = extractOptionalCellNumber(row.getCell(5).value);
        const trucCa = extractOptionalCellNumber(row.getCell(6).value);
        const thuong = extractOptionalCellNumber(row.getCell(7).value);

        rows.push({
          employee_code: code,
          luong_doanh_so: luongDoanhSo,
          luong_ot: luongOt,
          ban_san_pham: banSanPham,
          phu_mo: phuMo,
          truc_ca: trucCa,
          thuong,
          rowIndex: idx,
        });
      });
      if (!rows.length) { setMParseError('File không có dữ liệu.'); return; }
      setMParsedRows(rows);
    } catch {
      setMParseError('Không thể đọc file.');
    } finally {
      setMParsing(false);
    }
  };

  // ─── MonthlyInput: import ────────────────────────────────────────────────

  const handleMonthlyInputImport = async () => {
    if (!mParsedRows) return;
    const valid = mParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setMImporting(true);
    try {
      const records: BulkImportMonthlySalaryInputRecord[] = valid.map((r) => ({
        employee_code: r.employee_code,
        luong_doanh_so: r.luong_doanh_so,
        luong_ot: r.luong_ot,
        ban_san_pham: r.ban_san_pham,
        phu_mo: r.phu_mo,
        truc_ca: r.truc_ca,
        thuong: r.thuong,
      }));
      const res = await salaryService.bulkImportMonthlyInputs({ year: selectedYear, month: selectedMonth, records });
      if (res.success.length > 0) setSuccessMsg(`Import thành công ${res.success.length} dữ liệu lương tháng.`);
      if (res.errors.length > 0) {
        const errorCodes = new Set(res.errors.map((e) => e.employee_code));
        const failedRows = (mParsedRows ?? []).filter((r) => errorCodes.has(r.employee_code));
        setMImportErr({ errors: res.errors, failedRows });
      }
      setMParsedRows(null); setMFile(null); if (mFileRef.current) mFileRef.current.value = '';
      await loadMonthlyInputs();
    } catch {
      setErrorMsg('Lỗi kết nối máy chủ.');
    } finally {
      setMImporting(false);
    }
  };

  const handleMDelete = async (id: number) => {
    setMDeleting(true);
    try {
      await salaryService.deleteMonthlyInput(id);
      setMRecords((prev) => prev.filter((r) => r.id !== id));
      setMDeletingId(null);
      setSuccessMsg('Đã xoá dữ liệu lương tháng.');
    } catch {
      setErrorMsg('Không thể xoá.');
    } finally {
      setMDeleting(false);
    }
  };

  // ─── Export error helpers ─────────────────────────────────────────────────

  const buildErrorExcel = async (
    sheetName: string,
    headerColor: string,
    cols: { header: string; key: string; width: number }[],
    dataRows: (string | number)[][],
  ) => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);
    ws.columns = cols;
    const borderStyle = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
    const allBorders = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
      cell.font      = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border    = allBorders;
    });
    ws.getRow(1).height = 28;
    dataRows.forEach((values, idx) => {
      const exRow = ws.getRow(idx + 2);
      values.forEach((v, ci) => {
        const cell = exRow.getCell(ci + 1);
        cell.value    = v as any;
        cell.border   = allBorders;
        cell.alignment = { vertical: 'middle' };
      });
      exRow.commit();
    });
    return wb;
  };

  const handleExportCommissionErrors = async () => {
    if (!cImportErr?.errors.length) return;
    const rowMap = new Map(cImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã nhân viên',   key: 'a', width: 20 },
      { header: 'Lương hoa hồng', key: 'b', width: 22 },
      { header: 'Lý do lỗi',      key: 'c', width: 44 },
    ];
    const dataRows = cImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [e.employee_code, orig?.amount ?? '', e.error];
    });
    const wb = await buildErrorExcel('Hoa Hồng', 'FF4F46E5', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `hoa_hong_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPenaltyErrors = async () => {
    if (!pImportErr?.errors.length) return;
    const rowMap = new Map(pImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã nhân viên',  key: 'a', width: 20 },
      { header: 'Số tiền phạt',  key: 'b', width: 20 },
      { header: 'Lý do vi phạm', key: 'c', width: 40 },
      { header: 'Lý do lỗi',     key: 'd', width: 44 },
    ];
    const dataRows = pImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [e.employee_code, orig?.amount ?? '', orig?.reason ?? '', e.error];
    });
    const wb = await buildErrorExcel('Phạt Biên Bản', 'FFD93D1A', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `phat_bien_ban_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportOtherAllowanceErrors = async () => {
    if (!oImportErr?.errors.length) return;
    const rowMap = new Map(oImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã nhân viên',    key: 'a', width: 20 },
      { header: 'Số tiền phụ cấp', key: 'b', width: 22 },
      { header: 'Mô tả phụ cấp',   key: 'c', width: 30 },
      { header: 'Lý do lỗi',        key: 'd', width: 44 },
    ];
    const dataRows = oImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [e.employee_code, orig?.amount ?? '', orig?.description ?? '', e.error];
    });
    const wb = await buildErrorExcel('Phụ Cấp Khác', 'FF7C3AED', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `phu_cap_khac_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportParkingAllowanceErrors = async () => {
    if (!paImportErr?.errors.length) return;
    const rowMap = new Map(paImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã nhân viên',           key: 'a', width: 20 },
      { header: 'Số tiền phụ cấp gửi xe', key: 'b', width: 24 },
      { header: 'Ghi chú',                key: 'c', width: 30 },
      { header: 'Lý do lỗi',              key: 'd', width: 44 },
    ];
    const dataRows = paImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [e.employee_code, orig?.amount ?? '', orig?.notes ?? '', e.error];
    });
    const wb = await buildErrorExcel('Phụ Cấp Gửi Xe', 'FFD97706', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `phu_cap_gui_xe_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLunchAllowanceErrors = async () => {
    if (!laImportErr?.errors.length) return;
    const rowMap = new Map(laImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã nhân viên',           key: 'a', width: 20 },
      { header: 'Số tiền phụ cấp ăn trưa', key: 'b', width: 24 },
      { header: 'Ghi chú',                key: 'c', width: 30 },
      { header: 'Lý do lỗi',              key: 'd', width: 44 },
    ];
    const dataRows = laImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [e.employee_code, orig?.amount ?? '', orig?.notes ?? '', e.error];
    });
    const wb = await buildErrorExcel('Phụ Cấp Ăn Trưa', 'FFEA580C', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `phu_cap_an_trua_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSalaryAdjustmentErrors = async () => {
    if (!sImportErr?.errors.length) return;
    const rowMap = new Map(sImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã nhân viên',       key: 'a', width: 20 },
      { header: 'Số tiền điều chỉnh', key: 'b', width: 22 },
      { header: 'Ghi chú',            key: 'c', width: 30 },
      { header: 'Lý do lỗi',          key: 'd', width: 44 },
    ];
    const dataRows = sImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [e.employee_code, orig?.amount ?? '', orig?.notes ?? '', e.error];
    });
    const wb = await buildErrorExcel('Điều Chỉnh Lương', 'FF2563EB', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `dieu_chinh_luong_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMonthlyInputErrors = async () => {
    if (!mImportErr?.errors.length) return;
    const rowMap = new Map(mImportErr.failedRows.map((r) => [r.employee_code, r]));
    const cols = [
      { header: 'Mã Nhân Viên', key: 'a', width: 20 },
      { header: 'Lương doanh số', key: 'b', width: 18 },
      { header: 'Lương OT', key: 'c', width: 16 },
      { header: 'Bán sản phẩm', key: 'd', width: 18 },
      { header: 'Phụ mổ', key: 'e', width: 14 },
      { header: 'Trực Ca', key: 'f', width: 14 },
      { header: 'Thưởng', key: 'g', width: 16 },
      { header: 'Lý do lỗi', key: 'h', width: 44 },
    ];
    const dataRows = mImportErr.errors.map((e) => {
      const orig = rowMap.get(e.employee_code);
      return [
        e.employee_code,
        orig?.luong_doanh_so ?? '',
        orig?.luong_ot ?? '',
        orig?.ban_san_pham ?? '',
        orig?.phu_mo ?? '',
        orig?.truc_ca ?? '',
        orig?.thuong ?? '',
        e.error,
      ];
    });
    const wb = await buildErrorExcel('Dữ Liệu Lương Tháng', 'FF0F766E', cols, dataRows);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `du_lieu_luong_thang_loi_T${selectedMonth}_${selectedYear}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const filteredCommissions = commissionRecords.filter((r) =>
    !cSearch || r.employee_code.toLowerCase().includes(cSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(cSearch.toLowerCase())
  );
  const filteredPenalties = penaltyRecords.filter((r) =>
    !pSearch || r.employee_code.toLowerCase().includes(pSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(pSearch.toLowerCase())
  );
  const filteredOtherAllowances = oRecords.filter((r) =>
    !oSearch || r.employee_code.toLowerCase().includes(oSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(oSearch.toLowerCase())
  );
  const filteredParkingAllowances = paRecords.filter((r) =>
    !paSearch || r.employee_code.toLowerCase().includes(paSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(paSearch.toLowerCase())
  );
  const filteredLunchAllowances = laRecords.filter((r) =>
    !laSearch || r.employee_code.toLowerCase().includes(laSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(laSearch.toLowerCase())
  );
  const filteredSalaryAdjustments = sRecords.filter((r) =>
    !sSearch || r.employee_code.toLowerCase().includes(sSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(sSearch.toLowerCase())
  );
  const filteredMonthlyInputs = mRecords.filter((r) =>
    !mSearch || r.employee_code.toLowerCase().includes(mSearch.toLowerCase()) || r.employee_name.toLowerCase().includes(mSearch.toLowerCase())
  );

  const pageView = <T,>(tab: TabKey, rows: T[]) => {
    const { size } = pages[tab];
    const totalPages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(pages[tab].page, totalPages);
    return { rows: rows.slice((page - 1) * size, page * size), offset: (page - 1) * size, page, size, totalPages, totalItems: rows.length };
  };
  const sumAmount = (rows: { amount: number | string }[]) => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const commissionPage = pageView('commission', filteredCommissions);
  const penaltyPage = pageView('penalty', filteredPenalties);
  const otherAllowancePage = pageView('other_allowance', filteredOtherAllowances);
  const parkingAllowancePage = pageView('parking_allowance', filteredParkingAllowances);
  const lunchAllowancePage = pageView('lunch_allowance', filteredLunchAllowances);
  const salaryAdjustmentPage = pageView('salary_adjustment', filteredSalaryAdjustments);
  const monthlyInputPage = pageView('monthly_input', filteredMonthlyInputs);

  // ─── Render helpers ────────────────────────────────────────────────────────

  /** Dòng tổng (trên toàn bộ danh sách đã lọc, không chỉ trang hiện tại) + phân trang. */
  const renderListFooter = (tab: TabKey, view: ReturnType<typeof pageView>, totalAmount?: number) => {
    if (view.totalItems === 0) return null;
    return (
      <div className="border-t border-gray-100">
        {totalAmount !== undefined && (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <span className="text-sm font-medium text-gray-600">Tổng số tiền ({view.totalItems} dòng)</span>
            <span className="text-base font-semibold text-gray-900">{fmtMoney(totalAmount)}</span>
          </div>
        )}
        <Pagination
          className="px-4 py-3"
          currentPage={view.page}
          totalPages={view.totalPages}
          totalItems={view.totalItems}
          itemsPerPage={view.size}
          onPageChange={(page) => setPage(tab, page)}
          onItemsPerPageChange={(size) => setPages((prev) => ({ ...prev, [tab]: { page: 1, size } }))}
        />
      </div>
    );
  };

  const renderLoading = (color = 'primary') => (
    <div className="flex items-center justify-center py-16">
      <ArrowPathIcon className={`h-6 w-6 text-${color}-400 animate-spin`} />
      <span className="ml-2 text-sm text-gray-500">Đang tải...</span>
    </div>
  );

  const renderEmpty = (msg: string) => (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <UserIcon className="h-10 w-10 mb-2" />
      <p className="text-sm">{msg}</p>
    </div>
  );

  const renderAvatar = (name: string, colorClass: string) => (
    <div className={`h-8 w-8 rounded-full ${colorClass} flex items-center justify-center flex-shrink-0`}>
      <span className="text-xs font-semibold">{name?.charAt(0).toUpperCase()}</span>
    </div>
  );

  const renderImportErrors = (
    errState: { errors: {employee_code:string;error:string}[]; failedRows: unknown[] } | null,
    onExport: () => void,
    onClear: () => void,
  ) => {
    if (!errState?.errors.length) return null;
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl text-red-800 text-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-red-100">
          <span className="flex items-center gap-1.5 text-xs font-medium text-red-700">
            <ExclamationCircleIcon className="h-4 w-4" />
            {errState.errors.length} dòng không import được
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onExport}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors"
            >
              <ArrowDownTrayIcon className="h-3 w-3" />
              Tải file lỗi để sửa
            </button>
            <button onClick={onClear} className="p-1 hover:bg-red-200 rounded-xl transition-colors">
              <XMarkIcon className="h-3.5 w-3.5 text-red-500" />
            </button>
          </div>
        </div>
        <div className="max-h-40 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-red-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-red-700 w-32">Mã nhân viên</th>
                <th className="px-3 py-2 text-left font-medium text-red-700">Lý do lỗi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-red-100 bg-white">
              {errState.errors.map((e, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 font-mono font-medium text-red-700">{e.employee_code}</td>
                  <td className="px-3 py-1.5 text-red-600">{e.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderAddEmployeePicker = (tab: TabKey) => {
    const form = addForms[tab];
    const isActiveTab = activeTab === tab;
    return (
      <div className="md:col-span-2" ref={isActiveTab ? employeeDropdownRef : undefined}>
        <label className="block text-sm text-gray-700 mb-1">Nhân sự (gõ tên hoặc mã để tìm)</label>
        <div className="relative">
          <input
            type="text"
            value={form.employeeSearch}
            onFocus={() => setAddForm(tab, { showEmployeeDropdown: true })}
            onChange={(e) => handleAddEmployeeSearchChange(tab, e.target.value)}
            placeholder="Nhập họ tên hoặc mã nhân sự"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />

          {isActiveTab && form.showEmployeeDropdown && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {employeeLoading ? (
                <div className="px-3 py-2 text-sm text-gray-500">Đang tìm nhân sự...</div>
              ) : filteredEmployees.length > 0 ? (
                filteredEmployees.map((employee) => {
                  const optionLabel = `${employee.employee_id} - ${employee.full_name}`;
                  const isSelected = String(employee.id) === form.employeeId;
                  return (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => handleSelectAddEmployee(tab, employee)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${isSelected ? 'bg-primary-50 text-primary-700' : 'text-gray-700'}`}
                    >
                      {optionLabel}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-2 text-sm text-amber-600">Không tìm thấy nhân sự phù hợp.</div>
              )}
            </div>
          )}
        </div>

        {!form.employeeId ? (
          <p className="text-xs text-gray-500 mt-1">Chọn 1 nhân sự từ danh sách dropdown để thêm dữ liệu.</p>
        ) : (
          <p className="text-xs text-green-600 mt-1">Đã chọn: {form.employeeLabel || form.employeeSearch}</p>
        )}
      </div>
    );
  };

  const renderAddForm = (tab: TabKey) => {
    const form = addForms[tab];
    if (!form.open) return null;

    if (tab === 'commission') {
      return (
        <div className="bg-primary-50 border border-primary-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {renderAddEmployeePicker(tab)}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Số tiền hoa hồng</label>
            <input
              type="text"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setAddForm(tab, { amount: e.target.value })}
              placeholder="Ví dụ: 1500000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setAddForm(tab, { notes: e.target.value })}
              placeholder="Nhập ghi chú (nếu có)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resetAddForm(tab)}
              className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-white"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleCreateCommission}
              disabled={form.creating}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60"
            >
              {form.creating ? 'Đang thêm...' : 'Thêm hoa hồng'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'penalty') {
      return (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {renderAddEmployeePicker(tab)}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Số tiền phạt</label>
            <input
              type="text"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setAddForm(tab, { amount: e.target.value })}
              placeholder="Ví dụ: 300000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Lý do vi phạm</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setAddForm(tab, { reason: e.target.value })}
              placeholder="Nhập lý do vi phạm"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setAddForm(tab, { notes: e.target.value })}
              placeholder="Nhập ghi chú (nếu có)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resetAddForm(tab)}
              className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-white"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleCreatePenalty}
              disabled={form.creating}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60"
            >
              {form.creating ? 'Đang thêm...' : 'Thêm phạt biên bản'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'other_allowance') {
      return (
        <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {renderAddEmployeePicker(tab)}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Số tiền phụ cấp</label>
            <input
              type="text"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setAddForm(tab, { amount: e.target.value })}
              placeholder="Ví dụ: 500000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Mô tả phụ cấp</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setAddForm(tab, { description: e.target.value })}
              placeholder="Nhập mô tả"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setAddForm(tab, { notes: e.target.value })}
              placeholder="Nhập ghi chú (nếu có)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resetAddForm(tab)}
              className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-white"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleCreateOtherAllowance}
              disabled={form.creating}
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-60"
            >
              {form.creating ? 'Đang thêm...' : 'Thêm phụ cấp'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'parking_allowance') {
      return (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {renderAddEmployeePicker(tab)}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Số tiền phụ cấp gửi xe</label>
            <input
              type="text"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setAddForm(tab, { amount: e.target.value })}
              placeholder="Ví dụ: 150000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setAddForm(tab, { notes: e.target.value })}
              placeholder="Nhập ghi chú (nếu có)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resetAddForm(tab)}
              className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-white"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleCreateParkingAllowance}
              disabled={form.creating}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 disabled:opacity-60"
            >
              {form.creating ? 'Đang thêm...' : 'Thêm phụ cấp gửi xe'}
            </button>
          </div>
        </div>
      );
    }

    if (tab === 'lunch_allowance') {
      return (
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {renderAddEmployeePicker(tab)}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Số tiền phụ cấp ăn trưa</label>
            <input
              type="text"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setAddForm(tab, { amount: e.target.value })}
              placeholder="Ví dụ: 300000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setAddForm(tab, { notes: e.target.value })}
              placeholder="Nhập ghi chú (nếu có)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resetAddForm(tab)}
              className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-white"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleCreateLunchAllowance}
              disabled={form.creating}
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 disabled:opacity-60"
            >
              {form.creating ? 'Đang thêm...' : 'Thêm phụ cấp ăn trưa'}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {renderAddEmployeePicker(tab)}
        <div>
          <label className="block text-sm text-gray-700 mb-1">Số tiền điều chỉnh</label>
          <input
            type="text"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setAddForm(tab, { amount: e.target.value })}
            placeholder="Ví dụ: 300000 hoặc -200000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
          <input
            type="text"
            value={form.notes}
            onChange={(e) => setAddForm(tab, { notes: e.target.value })}
            placeholder="Nhập ghi chú điều chỉnh"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>
        <div className="md:col-span-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resetAddForm(tab)}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-white"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleCreateSalaryAdjustment}
            disabled={form.creating}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-60"
          >
            {form.creating ? 'Đang thêm...' : 'Thêm điều chỉnh lương'}
          </button>
        </div>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Dữ liệu</h1>
        <p className="text-gray-900 mt-0.5 text-sm">Quản lý hoa hồng, phạt, phụ cấp và dữ liệu lương theo tháng/năm.</p>
      </div>

      {/* Toasts */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-sm">
          <CheckIcon className="h-4 w-4 flex-shrink-0" />{successMsg}
          <button className="ml-auto" onClick={() => setSuccessMsg(null)}><XMarkIcon className="h-4 w-4" /></button>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-sm">
          <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />{errorMsg}
          <button className="ml-auto" onClick={() => setErrorMsg(null)}><XMarkIcon className="h-4 w-4" /></button>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end flex-wrap">
          <div className="sm:w-32">
            <SelectBox<number> label="Tháng" value={selectedMonth} options={MONTHS.map((m) => ({ value: m, label: `Tháng ${m}` }))} onChange={handleMonthChange} />
          </div>
          <div className="sm:w-24">
            <SelectBox<number> label="Năm" value={selectedYear} options={YEARS.map((y) => ({ value: y, label: String(y) }))} onChange={handleYearChange} />
          </div>
          <button
            onClick={() => activeTab === 'commission' ? loadCommissions() : activeTab === 'penalty' ? loadPenalties() : activeTab === 'other_allowance' ? loadOtherAllowances() : activeTab === 'parking_allowance' ? loadParkingAllowances() : activeTab === 'lunch_allowance' ? loadLunchAllowances() : activeTab === 'salary_adjustment' ? loadSalaryAdjustments() : activeTab === 'monthly_input' ? loadMonthlyInputs() : undefined}
            disabled={loadingCommission || loadingPenalty || loadingO || loadingPa || loadingLa || loadingS || loadingM}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            <ArrowPathIcon className={`h-4 w-4 ${(loadingCommission || loadingPenalty || loadingO || loadingPa || loadingLa || loadingS || loadingM) ? 'animate-spin' : ''}`} />
            Tải dữ liệu
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="border-b border-gray-100">
          <nav className="flex -mb-px overflow-x-auto">
            {TABS.filter((tab) => isAdmin || (isHR && tab.hrAllowed)).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setSuccessMsg(null); setErrorMsg(null); }}
                  className={`flex items-center gap-2 px-4 sm:px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    active
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 space-y-4">

          {/* ═══ TAB HOA HỒNG ═══ */}
          {activeTab === 'commission' && (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => setAddForm('commission', { open: !addForms.commission.open, showEmployeeDropdown: false })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
                >
                  {addForms.commission.open ? 'Đóng thêm nhanh' : 'Thêm hoa hồng'}
                </button>
                <button onClick={handleDownloadCommissionTemplate} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-primary-300 text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {cFile ? cFile.name : 'Chọn file Excel'}
                  <input ref={cFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleCommissionFileChange} />
                </label>
                {cParsedRows && cParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handleCommissionImport} disabled={cImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors">
                    {cImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {cImporting ? 'Đang import...' : `Xác nhận import (${cParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {commissionLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input type="text" placeholder="Tìm nhân viên..." value={cSearch} onChange={(e) => setCSearch(e.target.value)}
                      className="input-field w-full pl-9" />
                  </div>
                )}
              </div>
              {renderAddForm('commission')}
              {cParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{cParseError}</p>}
              {renderImportErrors(cImportErr, handleExportCommissionErrors, () => setCImportErr(null))}

              {/* Preview */}
              {cParsedRows && !cParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {cParsedRows.length} dòng
                      {cParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {cParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Lương hoa hồng</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {cParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="table-cell text-right text-gray-700">{row.amount > 0 ? row.amount.toLocaleString('vi-VN') + ' ₫' : '—'}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Commission list */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách hoa hồng — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredCommissions.length} nhân viên</span>
                  </p>
                </div>
                {loadingCommission ? renderLoading('primary') :
                 filteredCommissions.length === 0 ? renderEmpty(commissionRecords.length === 0 ? 'Chưa có dữ liệu hoa hồng tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Lương hoa hồng</th>
                          <th className="table-header text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {commissionPage.rows.map((rec, i) => {
                          const isEditing  = cEditingId  === rec.id;
                          const isDeleting = cDeletingId === rec.id;
                          return (
                            <tr key={rec.id} className={isDeleting ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}>
                              <td className="table-cell text-gray-400 text-xs">{commissionPage.offset + i + 1}</td>
                              <td className="table-cell">
                                <div className="flex items-center gap-3">
                                  {renderAvatar(rec.employee_name, 'bg-primary-50 text-primary-700')}
                                  <div><p className="font-medium text-gray-900">{rec.employee_name}</p><p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p></div>
                                </div>
                              </td>
                              <td className="table-cell text-right">
                                {isEditing ? (
                                  <input type="text" value={cEditAmount} onChange={(e) => setCEditAmount(e.target.value)}
                                    className="input-field w-36 text-right" placeholder="0" />
                                ) : (
                                  <span className="font-medium text-gray-700">{fmtMoney(rec.amount)}</span>
                                )}
                              </td>
                              <td className="table-cell text-center">
                                {isDeleting ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-red-600">Xác nhận xoá?</span>
                                    <button onClick={() => handleCDelete(rec.id)} disabled={cDeleting} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60">
                                      {cDeleting ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Xoá
                                    </button>
                                    <button onClick={() => setCDeletingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : isEditing ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => handleCSave(rec.id)} disabled={cSaving} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60">
                                      {cSaving ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Lưu
                                    </button>
                                    <button onClick={cancelCEdit} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => startCEdit(rec)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-xl hover:bg-primary-100 transition-colors">
                                      <PencilIcon className="h-3.5 w-3.5" />Sửa
                                    </button>
                                    <button onClick={() => { setCDeletingId(rec.id); setCEditingId(null); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                                      <TrashIcon className="h-3.5 w-3.5" />Xoá
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('commission', commissionPage, sumAmount(filteredCommissions))}
              </div>
            </>
          )}

          {/* ═══ TAB PHỤ CẤP KHÁC ═══ */}
          {activeTab === 'other_allowance' && (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => setAddForm('other_allowance', { open: !addForms.other_allowance.open, showEmployeeDropdown: false })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors"
                >
                  {addForms.other_allowance.open ? 'Đóng thêm nhanh' : 'Thêm phụ cấp'}
                </button>
                <button onClick={handleDownloadOtherAllowanceTemplate} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-violet-300 text-violet-700 bg-violet-50 rounded-xl hover:bg-violet-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {oFile ? oFile.name : 'Chọn file Excel'}
                  <input ref={oFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleOtherAllowanceFileChange} />
                </label>
                {oParsedRows && oParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handleOtherAllowanceImport} disabled={oImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors">
                    {oImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {oImporting ? 'Đang import...' : `Xác nhận import (${oParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {oLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input type="text" placeholder="Tìm nhân viên..." value={oSearch} onChange={(e) => setOSearch(e.target.value)}
                      className="input-field w-full pl-9" />
                  </div>
                )}
              </div>
              {renderAddForm('other_allowance')}
              {oParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{oParseError}</p>}
              {renderImportErrors(oImportErr, handleExportOtherAllowanceErrors, () => setOImportErr(null))}

              {/* Preview */}
              {oParsedRows && !oParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {oParsedRows.length} dòng
                      {oParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {oParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Số tiền</th>
                          <th className="table-header">Mô tả phụ cấp</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {oParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="table-cell text-right text-violet-700 font-medium">{row.amount > 0 ? row.amount.toLocaleString('vi-VN') + ' ₫' : '—'}</td>
                            <td className="table-cell text-gray-600 max-w-xs truncate">{row.description || '—'}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* OtherAllowance list */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách phụ cấp khác — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredOtherAllowances.length} nhân viên</span>
                  </p>
                </div>
                {loadingO ? renderLoading('primary') :
                 filteredOtherAllowances.length === 0 ? renderEmpty(oRecords.length === 0 ? 'Chưa có dữ liệu phụ cấp tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Số tiền</th>
                          <th className="table-header">Mô tả phụ cấp</th>
                          <th className="table-header text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {otherAllowancePage.rows.map((rec, i) => {
                          const isEditing  = oEditingId  === rec.id;
                          const isDeleting = oDeletingId === rec.id;
                          return (
                            <tr key={rec.id} className={isDeleting ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}>
                              <td className="table-cell text-gray-400 text-xs">{otherAllowancePage.offset + i + 1}</td>
                              <td className="table-cell">
                                <div className="flex items-center gap-3">
                                  {renderAvatar(rec.employee_name, 'bg-violet-50 text-violet-700')}
                                  <div><p className="font-medium text-gray-900">{rec.employee_name}</p><p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p></div>
                                </div>
                              </td>
                              <td className="table-cell text-right">
                                {isEditing ? (
                                  <input type="text" value={oEditValues.amount} onChange={(e) => setOEditValues((v) => ({ ...v, amount: e.target.value }))}
                                    className="input-field w-36 text-right" placeholder="0" />
                                ) : (
                                  <span className="font-medium text-violet-700">{fmtMoney(rec.amount)}</span>
                                )}
                              </td>
                              <td className="table-cell">
                                {isEditing ? (
                                  <input type="text" value={oEditValues.description} onChange={(e) => setOEditValues((v) => ({ ...v, description: e.target.value }))}
                                    className="input-field w-full" placeholder="Mô tả phụ cấp..." />
                                ) : (
                                  <span className="text-gray-700">{rec.description || '—'}</span>
                                )}
                              </td>
                              <td className="table-cell text-center">
                                {isDeleting ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-red-600">Xác nhận xoá?</span>
                                    <button onClick={() => handleODelete(rec.id)} disabled={oDeleting} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60">
                                      {oDeleting ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Xoá
                                    </button>
                                    <button onClick={() => setODeletingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : isEditing ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => handleOSave(rec.id)} disabled={oSaving} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-60">
                                      {oSaving ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Lưu
                                    </button>
                                    <button onClick={cancelOEdit} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => startOEdit(rec)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-xl hover:bg-violet-100 transition-colors">
                                      <PencilIcon className="h-3.5 w-3.5" />Sửa
                                    </button>
                                    <button onClick={() => { setODeletingId(rec.id); setOEditingId(null); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                                      <TrashIcon className="h-3.5 w-3.5" />Xoá
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('other_allowance', otherAllowancePage, sumAmount(filteredOtherAllowances))}
              </div>
            </>
          )}

          {/* ═══ TAB PHỤ CẤP GỬI XE ═══ */}
          {activeTab === 'parking_allowance' && (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => setAddForm('parking_allowance', { open: !addForms.parking_allowance.open, showEmployeeDropdown: false })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 transition-colors"
                >
                  {addForms.parking_allowance.open ? 'Đóng thêm nhanh' : 'Thêm phụ cấp gửi xe'}
                </button>
                <button onClick={handleDownloadParkingAllowanceTemplate} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-amber-300 text-amber-700 bg-amber-50 rounded-xl hover:bg-amber-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {paFile ? paFile.name : 'Chọn file Excel'}
                  <input ref={paFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleParkingAllowanceFileChange} />
                </label>
                {paParsedRows && paParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handleParkingAllowanceImport} disabled={paImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 disabled:opacity-60 transition-colors">
                    {paImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {paImporting ? 'Đang import...' : `Xác nhận import (${paParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {paLoaded && (
                  <button
                    onClick={handlePaFillRemainingZero}
                    disabled={paFillingZero}
                    title="Đặt phụ cấp gửi xe = 0 cho những nhân viên chưa có trong danh sách tháng này"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-60 transition-colors"
                  >
                    {paFillingZero ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {paFillingZero ? 'Đang xử lý...' : 'Đặt 0 cho người còn lại'}
                  </button>
                )}
                {paLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input type="text" placeholder="Tìm nhân viên..." value={paSearch} onChange={(e) => setPaSearch(e.target.value)}
                      className="input-field w-full pl-9" />
                  </div>
                )}
              </div>
              {renderAddForm('parking_allowance')}
              {paParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{paParseError}</p>}
              {renderImportErrors(paImportErr, handleExportParkingAllowanceErrors, () => setPaImportErr(null))}

              {/* Preview */}
              {paParsedRows && !paParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {paParsedRows.length} dòng
                      {paParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {paParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Số tiền</th>
                          <th className="table-header">Ghi chú</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {paParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="table-cell text-right text-amber-700 font-medium">{row.amount > 0 ? row.amount.toLocaleString('vi-VN') + ' ₫' : '—'}</td>
                            <td className="table-cell text-gray-600 max-w-xs truncate">{row.notes || '—'}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ParkingAllowanceOverride list */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách phụ cấp gửi xe — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredParkingAllowances.length} nhân viên</span>
                  </p>
                </div>
                {loadingPa ? renderLoading('primary') :
                 filteredParkingAllowances.length === 0 ? renderEmpty(paRecords.length === 0 ? 'Chưa có dữ liệu phụ cấp gửi xe tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Số tiền</th>
                          <th className="table-header">Ghi chú</th>
                          <th className="table-header text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {parkingAllowancePage.rows.map((rec, i) => {
                          const isEditing  = paEditingId  === rec.id;
                          const isDeleting = paDeletingId === rec.id;
                          return (
                            <tr key={rec.id} className={isDeleting ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}>
                              <td className="table-cell text-gray-400 text-xs">{parkingAllowancePage.offset + i + 1}</td>
                              <td className="table-cell">
                                <div className="flex items-center gap-3">
                                  {renderAvatar(rec.employee_name, 'bg-amber-50 text-amber-700')}
                                  <div><p className="font-medium text-gray-900">{rec.employee_name}</p><p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p></div>
                                </div>
                              </td>
                              <td className="table-cell text-right">
                                {isEditing ? (
                                  <input type="text" value={paEditValues.amount} onChange={(e) => setPaEditValues((v) => ({ ...v, amount: e.target.value }))}
                                    className="input-field w-36 text-right" placeholder="0" />
                                ) : (
                                  <span className="font-medium text-amber-700">{fmtMoney(rec.amount)}</span>
                                )}
                              </td>
                              <td className="table-cell">
                                {isEditing ? (
                                  <input type="text" value={paEditValues.notes} onChange={(e) => setPaEditValues((v) => ({ ...v, notes: e.target.value }))}
                                    className="input-field w-full" placeholder="Ghi chú..." />
                                ) : (
                                  <span className="text-gray-700">{rec.notes || '—'}</span>
                                )}
                              </td>
                              <td className="table-cell text-center">
                                {isDeleting ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-red-600">Xác nhận xoá?</span>
                                    <button onClick={() => handlePaDelete(rec.id)} disabled={paDeleting} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60">
                                      {paDeleting ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Xoá
                                    </button>
                                    <button onClick={() => setPaDeletingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : isEditing ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => handlePaSave(rec.id)} disabled={paSaving} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 disabled:opacity-60">
                                      {paSaving ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Lưu
                                    </button>
                                    <button onClick={cancelPaEdit} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => startPaEdit(rec)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors">
                                      <PencilIcon className="h-3.5 w-3.5" />Sửa
                                    </button>
                                    <button onClick={() => { setPaDeletingId(rec.id); setPaEditingId(null); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                                      <TrashIcon className="h-3.5 w-3.5" />Xoá
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('parking_allowance', parkingAllowancePage, sumAmount(filteredParkingAllowances))}
              </div>
            </>
          )}

          {/* ═══ TAB PHỤ CẤP ĂN TRƯA ═══ */}
          {activeTab === 'lunch_allowance' && (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => setAddForm('lunch_allowance', { open: !addForms.lunch_allowance.open, showEmployeeDropdown: false })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 transition-colors"
                >
                  {addForms.lunch_allowance.open ? 'Đóng thêm nhanh' : 'Thêm phụ cấp ăn trưa'}
                </button>
                <button onClick={handleDownloadLunchAllowanceTemplate} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-orange-300 text-orange-700 bg-orange-50 rounded-xl hover:bg-orange-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {laFile ? laFile.name : 'Chọn file Excel'}
                  <input ref={laFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleLunchAllowanceFileChange} />
                </label>
                {laParsedRows && laParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handleLunchAllowanceImport} disabled={laImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 disabled:opacity-60 transition-colors">
                    {laImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {laImporting ? 'Đang import...' : `Xác nhận import (${laParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {laLoaded && (
                  <button
                    onClick={handleLaSyncCurrent}
                    disabled={laSyncing}
                    title="Tạo bản ghi theo giá trị đang tính tự động cho những nhân viên chưa có trong danh sách tháng này"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-60 transition-colors"
                  >
                    <ArrowPathIcon className={`h-4 w-4 ${laSyncing ? 'animate-spin' : ''}`} />
                    {laSyncing ? 'Đang xử lý...' : 'Đồng bộ dữ liệu hiện tại'}
                  </button>
                )}
                {laLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input type="text" placeholder="Tìm nhân viên..." value={laSearch} onChange={(e) => setLaSearch(e.target.value)}
                      className="input-field w-full pl-9" />
                  </div>
                )}
              </div>
              {renderAddForm('lunch_allowance')}
              {laParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{laParseError}</p>}
              {renderImportErrors(laImportErr, handleExportLunchAllowanceErrors, () => setLaImportErr(null))}

              {/* Preview */}
              {laParsedRows && !laParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {laParsedRows.length} dòng
                      {laParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {laParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Số tiền</th>
                          <th className="table-header">Ghi chú</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {laParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="table-cell text-right text-orange-700 font-medium">{row.amount > 0 ? row.amount.toLocaleString('vi-VN') + ' ₫' : '—'}</td>
                            <td className="table-cell text-gray-600 max-w-xs truncate">{row.notes || '—'}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* LunchAllowanceOverride list */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách phụ cấp ăn trưa — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredLunchAllowances.length} nhân viên</span>
                  </p>
                </div>
                {loadingLa ? renderLoading('primary') :
                 filteredLunchAllowances.length === 0 ? renderEmpty(laRecords.length === 0 ? 'Chưa có dữ liệu phụ cấp ăn trưa tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Số tiền</th>
                          <th className="table-header">Ghi chú</th>
                          <th className="table-header text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {lunchAllowancePage.rows.map((rec, i) => {
                          const isEditing  = laEditingId  === rec.id;
                          const isDeleting = laDeletingId === rec.id;
                          return (
                            <tr key={rec.id} className={isDeleting ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}>
                              <td className="table-cell text-gray-400 text-xs">{lunchAllowancePage.offset + i + 1}</td>
                              <td className="table-cell">
                                <div className="flex items-center gap-3">
                                  {renderAvatar(rec.employee_name, 'bg-orange-50 text-orange-700')}
                                  <div><p className="font-medium text-gray-900">{rec.employee_name}</p><p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p></div>
                                </div>
                              </td>
                              <td className="table-cell text-right">
                                {isEditing ? (
                                  <input type="text" value={laEditValues.amount} onChange={(e) => setLaEditValues((v) => ({ ...v, amount: e.target.value }))}
                                    className="input-field w-36 text-right" placeholder="0" />
                                ) : (
                                  <span className="font-medium text-orange-700">{fmtMoney(rec.amount)}</span>
                                )}
                              </td>
                              <td className="table-cell">
                                {isEditing ? (
                                  <input type="text" value={laEditValues.notes} onChange={(e) => setLaEditValues((v) => ({ ...v, notes: e.target.value }))}
                                    className="input-field w-full" placeholder="Ghi chú..." />
                                ) : (
                                  <span className="text-gray-700">{rec.notes || '—'}</span>
                                )}
                              </td>
                              <td className="table-cell text-center">
                                {isDeleting ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-red-600">Xác nhận xoá?</span>
                                    <button onClick={() => handleLaDelete(rec.id)} disabled={laDeleting} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60">
                                      {laDeleting ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Xoá
                                    </button>
                                    <button onClick={() => setLaDeletingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : isEditing ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => handleLaSave(rec.id)} disabled={laSaving} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 disabled:opacity-60">
                                      {laSaving ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Lưu
                                    </button>
                                    <button onClick={cancelLaEdit} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => startLaEdit(rec)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 transition-colors">
                                      <PencilIcon className="h-3.5 w-3.5" />Sửa
                                    </button>
                                    <button onClick={() => { setLaDeletingId(rec.id); setLaEditingId(null); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                                      <TrashIcon className="h-3.5 w-3.5" />Xoá
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('lunch_allowance', lunchAllowancePage, sumAmount(filteredLunchAllowances))}
              </div>
            </>
          )}

          {/* ═══ TAB ĐIỀU CHỈNH LƯƠNG ═══ */}
          {activeTab === 'salary_adjustment' && (
            <>
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => setAddForm('salary_adjustment', { open: !addForms.salary_adjustment.open, showEmployeeDropdown: false })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
                >
                  {addForms.salary_adjustment.open ? 'Đóng thêm nhanh' : 'Thêm điều chỉnh lương'}
                </button>
                <button onClick={handleDownloadSalaryAdjustmentTemplate} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-blue-300 text-blue-700 bg-blue-50 rounded-xl hover:bg-blue-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {sFile ? sFile.name : 'Chọn file Excel'}
                  <input ref={sFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleSalaryAdjustmentFileChange} />
                </label>
                {sParsedRows && sParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handleSalaryAdjustmentImport} disabled={sImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors">
                    {sImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {sImporting ? 'Đang import...' : `Xác nhận import (${sParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {sLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input type="text" placeholder="Tìm nhân viên..." value={sSearch} onChange={(e) => setSSearch(e.target.value)}
                      className="input-field w-full pl-9" />
                  </div>
                )}
              </div>
              {renderAddForm('salary_adjustment')}
              {sParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{sParseError}</p>}
              {renderImportErrors(sImportErr, handleExportSalaryAdjustmentErrors, () => setSImportErr(null))}

              {sParsedRows && !sParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {sParsedRows.length} dòng
                      {sParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {sParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Số tiền điều chỉnh</th>
                          <th className="table-header">Ghi chú</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {sParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className={`table-cell text-right font-medium ${row.amount >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {row.amount !== 0 ? row.amount.toLocaleString('vi-VN') + ' ₫' : '0 ₫'}
                            </td>
                            <td className="table-cell text-gray-600 max-w-xs truncate">{row.notes || '—'}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách điều chỉnh lương — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredSalaryAdjustments.length} nhân viên</span>
                  </p>
                </div>
                {loadingS ? renderLoading('primary') :
                 filteredSalaryAdjustments.length === 0 ? renderEmpty(sRecords.length === 0 ? 'Chưa có dữ liệu điều chỉnh lương tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Số tiền điều chỉnh</th>
                          <th className="table-header">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {salaryAdjustmentPage.rows.map((rec, i) => (
                          <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                            <td className="table-cell text-gray-400 text-xs">{salaryAdjustmentPage.offset + i + 1}</td>
                            <td className="table-cell">
                              <div className="flex items-center gap-3">
                                {renderAvatar(rec.employee_name, 'bg-blue-50 text-blue-700')}
                                <div><p className="font-medium text-gray-900">{rec.employee_name}</p><p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p></div>
                              </div>
                            </td>
                            <td className={`table-cell text-right font-medium ${Number(rec.amount) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtMoney(rec.amount)}</td>
                            <td className="table-cell text-gray-700">{rec.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('salary_adjustment', salaryAdjustmentPage, sumAmount(filteredSalaryAdjustments))}
              </div>
            </>
          )}

          {/* ═══ TAB DỮ LIỆU LƯƠNG THÁNG ═══ */}
          {activeTab === 'monthly_input' && (
            <>
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={handleDownloadMonthlyInputTemplate}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-teal-300 text-teal-700 bg-teal-50 rounded-xl hover:bg-teal-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {mFile ? mFile.name : 'Chọn file Excel'}
                  <input ref={mFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleMonthlyInputFileChange} />
                </label>
                {mParsedRows && mParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handleMonthlyInputImport} disabled={mImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors">
                    {mImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {mImporting ? 'Đang import...' : `Xác nhận import (${mParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {mLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Tìm nhân viên..."
                      value={mSearch}
                      onChange={(e) => setMSearch(e.target.value)}
                      className="input-field w-full pl-9"
                    />
                  </div>
                )}
              </div>

              {mParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{mParseError}</p>}
              {renderImportErrors(mImportErr, handleExportMonthlyInputErrors, () => setMImportErr(null))}

              {mParsedRows && !mParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {mParsedRows.length} dòng
                      {mParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {mParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Lương doanh số</th>
                          <th className="table-header text-right">Lương OT</th>
                          <th className="table-header text-right">Bán sản phẩm</th>
                          <th className="table-header text-right">Phụ mổ</th>
                          <th className="table-header text-right">Trực Ca</th>
                          <th className="table-header text-right">Thưởng</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {mParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="table-cell text-right text-gray-700">{fmtNullableMoney(row.luong_doanh_so)}</td>
                            <td className="table-cell text-right text-gray-700">{fmtNullableMoney(row.luong_ot)}</td>
                            <td className="table-cell text-right text-gray-700">{fmtNullableMoney(row.ban_san_pham)}</td>
                            <td className="table-cell text-right text-gray-700">{fmtNullableMoney(row.phu_mo)}</td>
                            <td className="table-cell text-right text-gray-700">{fmtNullableMoney(row.truc_ca)}</td>
                            <td className="table-cell text-right text-gray-700">{fmtNullableMoney(row.thuong)}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách dữ liệu lương tháng — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredMonthlyInputs.length} nhân viên</span>
                  </p>
                </div>
                {loadingM ? renderLoading('primary') :
                 filteredMonthlyInputs.length === 0 ? renderEmpty(mRecords.length === 0 ? 'Chưa có dữ liệu lương tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Lương doanh số</th>
                          <th className="table-header text-right">Lương OT</th>
                          <th className="table-header text-right">Bán sản phẩm</th>
                          <th className="table-header text-right">Phụ mổ</th>
                          <th className="table-header text-right">Trực Ca</th>
                          <th className="table-header text-right">Thưởng</th>
                          <th className="table-header text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {monthlyInputPage.rows.map((rec, i) => {
                          const isDeleting = mDeletingId === rec.id;
                          return (
                            <tr key={rec.id} className={isDeleting ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}>
                              <td className="table-cell text-gray-400 text-xs">{monthlyInputPage.offset + i + 1}</td>
                              <td className="table-cell">
                                <div className="flex items-center gap-3">
                                  {renderAvatar(rec.employee_name, 'bg-teal-50 text-teal-700')}
                                  <div>
                                    <p className="font-medium text-gray-900">{rec.employee_name}</p>
                                    <p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="table-cell text-right text-gray-700">{fmtNullableMoney(rec.luong_doanh_so)}</td>
                              <td className="table-cell text-right text-gray-700">{fmtNullableMoney(rec.luong_ot)}</td>
                              <td className="table-cell text-right text-gray-700">{fmtNullableMoney(rec.ban_san_pham)}</td>
                              <td className="table-cell text-right text-gray-700">{fmtNullableMoney(rec.phu_mo)}</td>
                              <td className="table-cell text-right text-gray-700">{fmtNullableMoney(rec.truc_ca)}</td>
                              <td className="table-cell text-right text-gray-700">{fmtNullableMoney(rec.thuong)}</td>
                              <td className="table-cell text-center">
                                {isDeleting ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-red-600">Xác nhận xoá?</span>
                                    <button onClick={() => handleMDelete(rec.id)} disabled={mDeleting} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60">
                                      {mDeleting ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Xoá
                                    </button>
                                    <button onClick={() => setMDeletingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => setMDeletingId(rec.id)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                                    <TrashIcon className="h-3.5 w-3.5" />Xoá
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('monthly_input', monthlyInputPage)}
              </div>
            </>
          )}

          {/* ═══ TAB PHẠT THIẾU CÔNG ═══ */}
          {activeTab === 'missing_workday_penalty' && <MissingWorkdayPenaltyTab />}

          {/* ═══ TAB PHẠT BIÊN BẢN ═══ */}
          {activeTab === 'penalty' && (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => setAddForm('penalty', { open: !addForms.penalty.open, showEmployeeDropdown: false })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors"
                >
                  {addForms.penalty.open ? 'Đóng thêm nhanh' : 'Thêm phạt biên bản'}
                </button>
                <button onClick={handleDownloadPenaltyTemplate} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-red-300 text-red-700 bg-red-50 rounded-xl hover:bg-red-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {pFile ? pFile.name : 'Chọn file Excel'}
                  <input ref={pFileRef} type="file" accept=".xlsx" className="hidden" onChange={handlePenaltyFileChange} />
                </label>
                {pParsedRows && pParsedRows.filter((r) => !r.parseError).length > 0 && (
                  <button onClick={handlePenaltyImport} disabled={pImporting} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60 transition-colors">
                    {pImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                    {pImporting ? 'Đang import...' : `Xác nhận import (${pParsedRows.filter((r) => !r.parseError).length})`}
                  </button>
                )}
                {penaltyLoaded && (
                  <div className="flex-1 relative min-w-48">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input type="text" placeholder="Tìm nhân viên..." value={pSearch} onChange={(e) => setPSearch(e.target.value)}
                      className="input-field w-full pl-9" />
                  </div>
                )}
              </div>
              {renderAddForm('penalty')}
              {pParseError && <p className="flex items-center gap-1 text-sm text-red-600"><ExclamationCircleIcon className="h-4 w-4" />{pParseError}</p>}
              {renderImportErrors(pImportErr, handleExportPenaltyErrors, () => setPImportErr(null))}

              {/* Preview */}
              {pParsedRows && !pParsing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Xem trước — {pParsedRows.length} dòng
                      {pParsedRows.filter((r) => r.parseError).length > 0 && <span className="text-red-500"> · {pParsedRows.filter((r) => r.parseError).length} lỗi</span>}
                    </span>
                    <span className="text-gray-500">Tháng {selectedMonth}/{selectedYear}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Mã NV</th>
                          <th className="table-header text-right">Số tiền phạt</th>
                          <th className="table-header">Lý do</th>
                          <th className="table-header">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {pParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                            <td className="table-cell font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="table-cell text-right text-red-600 font-medium">{row.amount > 0 ? row.amount.toLocaleString('vi-VN') + ' ₫' : '—'}</td>
                            <td className="table-cell text-gray-600 max-w-xs truncate">{row.reason || '—'}</td>
                            <td className="table-cell">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Penalty list */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    Danh sách phạt biên bản — Tháng {selectedMonth}/{selectedYear}
                    <span className="ml-2 font-normal text-gray-500">{filteredPenalties.length} bản ghi</span>
                  </p>
                </div>
                {loadingPenalty ? renderLoading('red') :
                 filteredPenalties.length === 0 ? renderEmpty(penaltyRecords.length === 0 ? 'Chưa có bản ghi phạt nào tháng này.' : 'Không tìm thấy nhân viên.') : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="table-header w-10">#</th>
                          <th className="table-header">Nhân viên</th>
                          <th className="table-header text-right">Số tiền phạt</th>
                          <th className="table-header">Lý do vi phạm</th>
                          <th className="table-header text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {penaltyPage.rows.map((rec, i) => {
                          const isEditing  = pEditingId  === rec.id;
                          const isDeleting = pDeletingId === rec.id;
                          return (
                            <tr key={rec.id} className={isDeleting ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}>
                              <td className="table-cell text-gray-400 text-xs">{penaltyPage.offset + i + 1}</td>
                              <td className="table-cell">
                                <div className="flex items-center gap-3">
                                  {renderAvatar(rec.employee_name, 'bg-red-50 text-red-700')}
                                  <div><p className="font-medium text-gray-900">{rec.employee_name}</p><p className="text-xs text-gray-500 font-mono">{rec.employee_code}</p></div>
                                </div>
                              </td>
                              <td className="table-cell text-right">
                                {isEditing ? (
                                  <input type="text" value={pEditValues.amount} onChange={(e) => setPEditValues((v) => ({ ...v, amount: e.target.value }))}
                                    className="input-field w-36 text-right" placeholder="0" />
                                ) : (
                                  <span className="font-medium text-red-600">{fmtMoney(rec.amount)}</span>
                                )}
                              </td>
                              <td className="table-cell">
                                {isEditing ? (
                                  <input type="text" value={pEditValues.reason} onChange={(e) => setPEditValues((v) => ({ ...v, reason: e.target.value }))}
                                    className="input-field w-full" placeholder="Lý do vi phạm..." />
                                ) : (
                                  <span className="text-gray-700">{rec.reason || '—'}</span>
                                )}
                              </td>
                              <td className="table-cell text-center">
                                {isDeleting ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-red-600">Xác nhận xoá?</span>
                                    <button onClick={() => handlePDelete(rec.id)} disabled={pDeleting} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-60">
                                      {pDeleting ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Xoá
                                    </button>
                                    <button onClick={() => setPDeletingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : isEditing ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => handlePSave(rec.id)} disabled={pSaving} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60">
                                      {pSaving ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}Lưu
                                    </button>
                                    <button onClick={cancelPEdit} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50">
                                      <XMarkIcon className="h-3 w-3" />Huỷ
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button onClick={() => startPEdit(rec)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-xl hover:bg-primary-100 transition-colors">
                                      <PencilIcon className="h-3.5 w-3.5" />Sửa
                                    </button>
                                    <button onClick={() => { setPDeletingId(rec.id); setPEditingId(null); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                                      <TrashIcon className="h-3.5 w-3.5" />Xoá
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {renderListFooter('penalty', penaltyPage, sumAmount(filteredPenalties))}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default SalaryData;
