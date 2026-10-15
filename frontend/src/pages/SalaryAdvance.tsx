import React, { useEffect, useMemo, useState } from 'react';
import {
  PlusIcon,
  ArrowPathIcon,
  BanknotesIcon,
  CheckIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  LockOpenIcon,
} from '@heroicons/react/24/outline';
import genericRequestService, {
  GenericRequest,
  GenericRequestStatus,
  SalaryAdvanceApprovalLockState,
  SalaryAdvanceCreationLockState,
} from '../services/genericRequest.service';
import { approvalService } from '../services/approval.service';
import salaryService, { AdvanceRecord } from '../services/salary.service';
import { useAuth } from '../contexts/AuthContext';
import Pagination from '../components/Pagination';
import { BRAND } from '@/config/brand';

// ============================================================================
// CONSTS
// ============================================================================
// Khung tạo đơn: 00:00 ngày 1 -> 15:30 ngày 3 hàng tháng (khớp BE,
// GenericRequestSerializer.is_salary_advance_creation_window_open). Chỉ dùng
// khi chưa lấy được window_open từ server.
const CREATE_LAST_DAY = 3;
const CREATE_CUTOFF_MINUTES = 15 * 60 + 30;
const CREATE_WINDOW_LABEL = 'từ ngày 1 đến 15h30 ngày 3';
const isInCreationWindow = (d: Date) =>
  d.getDate() < CREATE_LAST_DAY ||
  (d.getDate() === CREATE_LAST_DAY && d.getHours() * 60 + d.getMinutes() <= CREATE_CUTOFF_MINUTES);
const MAX_AMOUNT = 5_000_000;
const PAGE_SIZE = 20;

const STATUS_LABELS: Record<GenericRequestStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_MANAGER: 'Chờ Quản lý duyệt',
  PENDING_ADMIN: 'Chờ HCNS duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

const STATUS_BADGE: Record<GenericRequestStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 ring-gray-200',
  PENDING_MANAGER: 'bg-amber-50 text-amber-700 ring-amber-200',
  PENDING_ADMIN: 'bg-blue-50 text-blue-700 ring-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

// ============================================================================
// UTILS
// ============================================================================
const formatCurrency = (val: number | string | null | undefined): string => {
  const n = typeof val === 'string' ? Number(val) : (val ?? 0);
  if (!Number.isFinite(n)) return '0đ';
  return `${n.toLocaleString('vi-VN')}đ`;
};

// Number → Vietnamese words (đủ dùng cho số ≤ 999_999_999)
const VN_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const readThree = (n: number, full: boolean): string => {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  const parts: string[] = [];
  if (h > 0 || full) parts.push(`${VN_DIGITS[h]} trăm`);
  if (t > 1) {
    parts.push(`${VN_DIGITS[t]} mươi`);
    if (o === 1) parts.push('mốt');
    else if (o === 5) parts.push('lăm');
    else if (o > 0) parts.push(VN_DIGITS[o]);
  } else if (t === 1) {
    parts.push('mười');
    if (o === 5) parts.push('lăm');
    else if (o > 0) parts.push(VN_DIGITS[o]);
  } else if (t === 0 && o > 0) {
    if (h > 0 || full) parts.push('lẻ');
    parts.push(VN_DIGITS[o]);
  }
  return parts.join(' ');
};
const amountToWords = (num: number): string => {
  if (!num || num <= 0) return '';
  const groups: number[] = [];
  let n = Math.floor(num);
  while (n > 0) { groups.unshift(n % 1000); n = Math.floor(n / 1000); }
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const total = groups.length;
  const out: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    out.push(readThree(g, out.length > 0));
    const u = units[total - 1 - i] || '';
    if (u) out.push(u);
  });
  const r = out.join(' ').replace(/\s+/g, ' ').trim();
  return r ? `${r.charAt(0).toUpperCase()}${r.slice(1)} đồng` : '';
};

// ============================================================================
// TYPES
// ============================================================================
type Tab = 'mine' | 'approvals' | 'approved';

interface CurrentEmployee {
  id: number;
  employee_id: string;
  full_name: string;
  basic_salary?: number | string | null;
  department?: { name?: string } | null;
  department_name?: string;
  manager?: { full_name?: string; employee_id?: string } | null;
  manager_name?: string;
  is_manager?: boolean;
  is_hr?: boolean;
  permissions?: { can_view_salary_advance?: boolean } | null;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const SalaryAdvance: React.FC = () => {
  const { user } = useAuth();
  const userRole = (user?.role || '').toUpperCase();
  const isAdmin =
    userRole === 'ADMIN' || !!user?.is_super_admin || !!(user as any)?.is_superuser;

  const [me, setMe] = useState<CurrentEmployee | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const isManager = !!me?.is_manager;
  // HR role có thể là staff role 'HR' (từ Django backend) hoặc có cờ is_hr trên Employee
  const isHR = userRole === 'HR' || !!me?.is_hr;
  // Tabs có hiển thị hay không (phụ thuộc role)
  const showApprovalsTab = isManager || isAdmin;
  const showApprovedTab = isAdmin || isHR || isManager;

  const [tab, setTab] = useState<Tab>('mine');

  const [lockState, setLockState] = useState<SalaryAdvanceApprovalLockState | null>(null);
  const [togglingLock, setTogglingLock] = useState(false);
  const [creationLockState, setCreationLockState] = useState<SalaryAdvanceCreationLockState | null>(null);
  const [togglingCreationLock, setTogglingCreationLock] = useState(false);

  const fetchMe = async () => {
    setLoadingMe(true);
    try {
      const data = await approvalService.getCurrentEmployee();
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setLoadingMe(false);
    }
  };

  const fetchLockState = async () => {
    try {
      const data = await genericRequestService.getApprovalLock();
      setLockState(data);
    } catch {
      setLockState(null);
    }
  };

  const fetchCreationLockState = async () => {
    try {
      const data = await genericRequestService.getCreationLock();
      setCreationLockState(data);
    } catch {
      setCreationLockState(null);
    }
  };

  useEffect(() => {
    fetchMe();
    fetchLockState();
    fetchCreationLockState();
  }, []);

  const handleToggleLock = async () => {
    if (!lockState) return;
    const nextLocked = !lockState.is_locked;
    const confirmMsg = nextLocked
      ? 'Khoá lại rule duyệt tạm ứng lương? Quản lý trực tiếp/HCNS sẽ chỉ duyệt được trong 3 ngày đầu tháng.'
      : 'Mở khoá duyệt tạm ứng lương? Quản lý trực tiếp/HCNS sẽ duyệt được bất kỳ lúc nào, không giới hạn 3 ngày đầu tháng.';
    if (!window.confirm(confirmMsg)) return;
    setTogglingLock(true);
    try {
      const data = await genericRequestService.setApprovalLock(nextLocked);
      setLockState(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Cập nhật thất bại');
    } finally {
      setTogglingLock(false);
    }
  };

  const handleToggleCreationLock = async () => {
    if (!creationLockState) return;
    const nextLocked = !creationLockState.is_locked;
    const confirmMsg = nextLocked
      ? 'Khoá lại rule tạo đơn tạm ứng lương? Nhân viên sẽ chỉ tạo được đơn trong 3 ngày đầu tháng.'
      : 'Mở khoá tạo đơn tạm ứng lương? Nhân viên sẽ tạo được đơn bất kỳ lúc nào trong tháng này, không giới hạn 3 ngày đầu tháng. Lưu ý: sang tháng sau sẽ tự động khoá lại.';
    if (!window.confirm(confirmMsg)) return;
    setTogglingCreationLock(true);
    try {
      const data = await genericRequestService.setCreationLock(nextLocked);
      setCreationLockState(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Cập nhật thất bại');
    } finally {
      setTogglingCreationLock(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <BanknotesIcon className="w-6 h-6 text-primary-600" />
            Tạm ứng lương
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Đăng ký tạm ứng lương {CREATE_WINDOW_LABEL} hàng tháng. Quản lý trực tiếp duyệt → HCNS duyệt cuối.
          </p>
        </div>
        {isAdmin && (lockState || creationLockState) && (
          <div className="flex flex-wrap items-center gap-2">
            {creationLockState && (
              <button
                type="button"
                onClick={handleToggleCreationLock}
                disabled={togglingCreationLock}
                title={
                  creationLockState.is_locked
                    ? 'Đang khoá: NV chỉ tạo được đơn trong 3 ngày đầu tháng. Bấm để mở khoá (chỉ áp dụng cho tháng này, tự khoá lại vào tháng sau).'
                    : 'Đang mở khoá: NV tạo được đơn bất kỳ lúc nào trong tháng này. Bấm để khoá lại.'
                }
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg shadow-sm ring-1 transition-all disabled:opacity-60 ${
                  creationLockState.is_locked
                    ? 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                    : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100'
                }`}
              >
                {creationLockState.is_locked ? (
                  <LockClosedIcon className="w-4 h-4" />
                ) : (
                  <LockOpenIcon className="w-4 h-4" />
                )}
                {togglingCreationLock
                  ? 'Đang cập nhật...'
                  : creationLockState.is_locked
                  ? 'Khoá tạo đơn (đúng khung ngày 1 - 15h30 ngày 3)'
                  : 'Đã mở khoá tạo đơn'}
              </button>
            )}
            {lockState && (
              <button
                type="button"
                onClick={handleToggleLock}
                disabled={togglingLock}
                title={
                  lockState.is_locked
                    ? 'Đang khoá: chỉ duyệt được trong 3 ngày đầu tháng. Bấm để mở khoá.'
                    : 'Đang mở khoá: duyệt được bất kỳ lúc nào. Bấm để khoá lại.'
                }
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg shadow-sm ring-1 transition-all disabled:opacity-60 ${
                  lockState.is_locked
                    ? 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                    : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100'
                }`}
              >
                {lockState.is_locked ? (
                  <LockClosedIcon className="w-4 h-4" />
                ) : (
                  <LockOpenIcon className="w-4 h-4" />
                )}
                {togglingLock
                  ? 'Đang cập nhật...'
                  : lockState.is_locked
                  ? 'Khoá duyệt (đúng khung 1-3)'
                  : 'Đã mở khoá duyệt'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
            Đơn của tôi
          </TabButton>
          {showApprovalsTab && (
            <TabButton active={tab === 'approvals'} onClick={() => setTab('approvals')}>
              Duyệt cấp dưới
            </TabButton>
          )}
          {showApprovedTab && (
            <TabButton active={tab === 'approved'} onClick={() => setTab('approved')}>
              Đã duyệt
            </TabButton>
          )}
        </nav>
      </div>

      {/* Content */}
      {tab === 'mine' && (
        <MineTab me={me} loadingMe={loadingMe} creationLockState={creationLockState} />
      )}
      {tab === 'approvals' && showApprovalsTab && (
        <ApprovalsTab isAdmin={isAdmin} isManager={isManager} lockState={lockState} />
      )}
      {tab === 'approved' && showApprovedTab && <ApprovedTab isAdmin={isAdmin} />}
    </div>
  );
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`py-3 px-1 border-b-2 text-sm font-semibold transition-colors whitespace-nowrap ${
      active
        ? 'border-primary-600 text-primary-700'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`}
  >
    {children}
  </button>
);

const ReadOnlyField: React.FC<{ label: string; value: string; multiline?: boolean }> = ({
  label,
  value,
  multiline,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <div
      className={`w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 ${
        multiline ? 'min-h-[44px] whitespace-pre-wrap' : ''
      }`}
    >
      {value}
    </div>
  </div>
);

// ─── TAB 1: ĐƠN CỦA TÔI ────────────────────────────────────────────────────
const MineTab: React.FC<{
  me: CurrentEmployee | null;
  loadingMe: boolean;
  creationLockState: SalaryAdvanceCreationLockState | null;
}> = ({ me, loadingMe, creationLockState }) => {
  const [items, setItems] = useState<GenericRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<GenericRequest | null>(null);
  // Ẩn lương theo pattern Profile.tsx — NV bấm icon để xem
  const [showSalary, setShowSalary] = useState(false);

  const today = useMemo(() => new Date(), []);
  const isInWindow = creationLockState?.window_open ?? isInCreationWindow(today);
  // Admin có thể mở khoá tạo đơn ngoài khung (chỉ có hiệu lực trong
  // tháng lúc mở — BE tự tính lại is_locked hiệu lực, tự khoá lại khi sang
  // tháng mới, xem SalaryAdvanceCreationLock.is_effectively_locked()).
  const creationUnlocked = !!creationLockState && !creationLockState.is_locked;
  const canCreate = isInWindow || creationUnlocked;
  const amountInWords = useMemo(() => amountToWords(Number(amount) || 0), [amount]);

  const departmentName = me?.department?.name || me?.department_name || '—';
  const managerName = me?.manager?.full_name || me?.manager_name || '—';
  const basicSalary = Number(me?.basic_salary || 0);
  const maxByPercent = Math.floor(basicSalary * 0.8);
  const effectiveCap = Math.min(MAX_AMOUNT, maxByPercent > 0 ? maxByPercent : MAX_AMOUNT);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await genericRequestService.list({
        owner: 'me',
        request_type: 'SALARY_ADVANCE',
        page,
        page_size: PAGE_SIZE,
      });
      setItems(res.results);
      setTotalItems(res.count);
      setTotalPages(Math.max(1, Math.ceil(res.count / PAGE_SIZE)));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Không tải được danh sách');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleSubmit = async () => {
    setFormError(null);
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      setFormError('Vui lòng nhập số tiền hợp lệ.');
      return;
    }
    if (amountNum > MAX_AMOUNT) {
      setFormError(`Số tiền tối đa ${formatCurrency(MAX_AMOUNT)}.`);
      return;
    }
    if (maxByPercent > 0 && amountNum > maxByPercent) {
      setFormError(`Không vượt quá 80% lương cơ bản (${formatCurrency(maxByPercent)}).`);
      return;
    }
    setSubmitting(true);
    try {
      const created = await genericRequestService.create({
        request_type: 'SALARY_ADVANCE',
        title: `Tạm ứng lương ${formatCurrency(amountNum)}`,
        reason: 'Đơn tạm ứng lương theo quy định công ty.',
        extra_data: {
          amount: amountNum,
          amount_in_words: amountInWords,
          requester_name: me?.full_name || '',
          employee_code: me?.employee_id || '',
          department_name: departmentName,
          manager_name: managerName,
          basic_salary_snapshot: basicSalary,
        },
      });
      try {
        await genericRequestService.submit(created.id);
      } catch {
        /* submit fail vẫn coi như tạo OK */
      }
      setShowForm(false);
      setAmount('');
      await fetchData();
    } catch (e: any) {
      const data = e?.response?.data;
      let msg = 'Gửi đơn thất bại.';
      if (typeof data === 'string') msg = data;
      else if (data?.detail) msg = data.detail;
      else if (data && typeof data === 'object') {
        const parts: string[] = [];
        for (const [k, v] of Object.entries(data)) {
          const text = Array.isArray(v) ? v.join('; ') : String(v);
          parts.push(k === 'non_field_errors' ? text : `${k}: ${text}`);
        }
        if (parts.length) msg = parts.join(' | ');
      } else if (e?.message) msg = e.message;
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Bảng thông tin cá nhân + lương */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoStat label="Họ và tên" value={me?.full_name || '—'} />
        <InfoStat label="Mã nhân viên" value={me?.employee_id || '—'} />
        <InfoStat label="Bộ phận" value={departmentName} />
        <InfoStat label="Quản lý trực tiếp" value={managerName} />
        {/* <MaskedSalaryStat
          label="Lương cơ bản"
          value={basicSalary > 0 ? formatCurrency(basicSalary) : '—'}
          masked={!showSalary}
          onToggle={() => setShowSalary((v) => !v)}
          highlight="primary"
        /> */}
        <MaskedSalaryStat
          label="Có thể ứng tối đa"
          value={effectiveCap > 0 ? formatCurrency(effectiveCap) : formatCurrency(MAX_AMOUNT)}
          masked={!showSalary}
          onToggle={() => setShowSalary((v) => !v)}
          hint={basicSalary > 0 ? '≤ 80% lương cơ bản và ≤ 5.000.000đ' : '≤ 5.000.000đ'}
          highlight="emerald"
        />
      </div>

      {/* Banner window */}
      <div
        className={`rounded-2xl border p-4 ${
          canCreate
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        <p className="font-medium">
          {isInWindow
            ? `✅ Đang trong khoảng nhận đơn tạm ứng lương (${CREATE_WINDOW_LABEL} hàng tháng).`
            : creationUnlocked
            ? `✅ Admin đã mở khoá tạo đơn ngoài khung ${CREATE_WINDOW_LABEL} cho tháng này — bạn vẫn tạo được đơn hôm nay (ngày ${today.getDate()}).`
            : `⚠ Chỉ nhận đơn tạm ứng lương ${CREATE_WINDOW_LABEL} hàng tháng. Hôm nay là ngày ${today.getDate()}.`}
        </p>
        <p className="text-sm mt-1 opacity-80">
          Điều kiện: nhân viên chính thức, không có đơn xin nghỉ việc.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={fetchData}
          className="btn-secondary flex items-center gap-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Tải lại
        </button>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setAmount('');
            setShowForm(true);
          }}
          disabled={!canCreate}
          className="btn-primary flex items-center gap-2 disabled:bg-gray-300 disabled:hover:bg-gray-300 disabled:cursor-not-allowed"
        >
          <PlusIcon className="w-4 h-4" />
          Tạo đơn tạm ứng
        </button>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Đơn tạm ứng lương</h2>
            {loadingMe && (
              <div className="text-sm text-gray-500">Đang tải thông tin nhân viên...</div>
            )}
            <div className="space-y-3">
              <ReadOnlyField label="Họ và tên người đề nghị" value={me?.full_name || '—'} />
              <ReadOnlyField label="Mã nhân viên" value={me?.employee_id || '—'} />
              <ReadOnlyField label="Bộ phận công tác" value={departmentName} />
              <ReadOnlyField label="Tên quản lý trực tiếp" value={managerName} />
            </div>
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Số tiền tạm ứng (không quá {formatCurrency(MAX_AMOUNT)}){' '}
                  <span className="text-rose-600">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={MAX_AMOUNT}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="VD: 3000000"
                  className="input-field"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Không vượt quá 80% lương cơ bản
                  {basicSalary > 0 && ` (${formatCurrency(maxByPercent)})`}.
                </p>
              </div>
              <ReadOnlyField
                label="Số tiền (viết bằng chữ)"
                value={amountInWords || '—'}
                multiline
              />
            </div>
            {formError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(null); }}
                disabled={submitting}
                className="btn-secondary disabled:opacity-60"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || loadingMe}
                className="btn-primary disabled:opacity-60"
              >
                {submitting ? 'Đang gửi...' : 'Gửi đơn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500">Đang tải...</div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Chưa có đơn tạm ứng lương nào.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => {
              const amt = (item.extra_data as any)?.amount;
              return (
                <li
                  key={item.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 truncate">
                        {item.title || item.request_code}
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ring-1 ${STATUS_BADGE[item.status]}`}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Mã: {item.request_code || '—'} · Tạo:{' '}
                      {new Date(item.created_at).toLocaleDateString('vi-VN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="text-lg font-semibold text-emerald-700 whitespace-nowrap">
                      {formatCurrency(amt)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setDetailRequest(item)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all"
                    >
                      <EyeIcon className="w-3.5 h-3.5" />
                      Chi tiết
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      {detailRequest && (
        <DetailModal request={detailRequest} onClose={() => setDetailRequest(null)} />
      )}
    </div>
  );
};

const MaskedSalaryStat: React.FC<{
  label: string;
  value: string;
  masked: boolean;
  onToggle: () => void;
  hint?: string;
  highlight?: 'primary' | 'emerald';
}> = ({ label, value, masked, onToggle, hint, highlight }) => {
  const color =
    highlight === 'primary'
      ? 'text-primary-700'
      : highlight === 'emerald'
      ? 'text-emerald-700'
      : 'text-gray-900';
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <div className="flex items-center gap-2 mt-0.5">
        <p className={`text-base font-semibold ${color}`}>
          {masked ? '*******' : value}
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          title={masked ? 'Hiện lương' : 'Ẩn lương'}
        >
          {masked ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
};

const InfoStat: React.FC<{
  label: string;
  value: string;
  hint?: string;
  highlight?: 'primary' | 'emerald';
}> = ({ label, value, hint, highlight }) => {
  const color =
    highlight === 'primary'
      ? 'text-primary-700'
      : highlight === 'emerald'
      ? 'text-emerald-700'
      : 'text-gray-900';
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${color} mt-0.5`}>{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
};

// ─── TAB 2: DUYỆT CẤP DƯỚI ─────────────────────────────────────────────────
const ApprovalsTab: React.FC<{
  isAdmin: boolean;
  isManager: boolean;
  lockState: SalaryAdvanceApprovalLockState | null;
}> = ({ isAdmin, isManager, lockState }) => {
  const [items, setItems] = useState<GenericRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [actionId, setActionId] = useState<number | null>(null);
  const [detailRequest, setDetailRequest] = useState<GenericRequest | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  // Người dùng có thể giữ CẢ HAI vai cùng lúc (HCNS/Admin đồng thời là quản lý
  // trực tiếp của vài người). Trước 2026-10-01 chỗ này chọn MỘT TRONG HAI hàng
  // đợi (isAdmin ? PENDING_ADMIN : PENDING_MANAGER) nên đơn của cấp dưới một
  // Admin không bao giờ hiện với ai: chính Admin đó là quản lý trực tiếp nhưng
  // chỉ thấy hàng đợi HCNS, còn người khác thì không có quyền. Thực tế 01/10:
  // 2 đơn kẹt vĩnh viễn ở PENDING_MANAGER.
  const queues: Array<{ status: GenericRequestStatus; owner?: 'subordinates' }> = [
    ...(isManager ? [{ status: 'PENDING_MANAGER' as GenericRequestStatus, owner: 'subordinates' as const }] : []),
    ...(isAdmin ? [{ status: 'PENDING_ADMIN' as GenericRequestStatus }] : []),
  ];

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(queues.map((q) =>
        genericRequestService.list({
          owner: q.owner,
          request_type: 'SALARY_ADVANCE',
          status: q.status,
          page,
          page_size: PAGE_SIZE,
        })
      ));
      // Bước QLTT lên trước: đó mới là việc chưa ai làm.
      const merged = results.flatMap((r) => r.results);
      const count = results.reduce((sum, r) => sum + r.count, 0);
      setItems(merged);
      setTotalItems(count);
      setTotalPages(Math.max(1, Math.ceil(count / PAGE_SIZE)));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Không tải được danh sách');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, isAdmin]);

  /**
   * Gọi ĐÚNG bước duyệt theo TRẠNG THÁI của đơn, không theo vai của người bấm.
   * Trước đây dùng `isAdmin ? adminApprove : managerApprove` — khi danh sách
   * gộp cả 2 hàng đợi, một Admin bấm duyệt đơn đang ở PENDING_MANAGER sẽ gọi
   * nhầm adminApprove và nhảy cóc qua bước quản lý trực tiếp.
   */
  const approveByStage = (item: GenericRequest) =>
    item.status === 'PENDING_MANAGER'
      ? genericRequestService.managerApprove(item.id)
      : genericRequestService.adminApprove(item.id);

  const handleApprove = async (item: GenericRequest) => {
    if (!window.confirm(`Duyệt đơn ${item.request_code} của ${item.employee_name}?`)) return;
    setActionId(item.id);
    try {
      await approveByStage(item);
      await fetchData();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Duyệt thất bại');
    } finally {
      setActionId(null);
    }
  };

  const handleApproveAll = async () => {
    if (totalItems === 0) return;
    if (!window.confirm(
      `Duyệt ${totalItems} đơn tạm ứng lương đang chờ?\n\n` +
      `Hành động này không thể hoàn tác — hệ thống sẽ duyệt tuần tự từng đơn.`
    )) return;

    setBulkProgress({ current: 0, total: totalItems });
    setError(null);

    try {
      // Fetch tất cả đơn pending (bỏ qua pagination client — dùng page_size lớn).
      // Lấy CẢ HAI hàng đợi giống fetchData, không thì "Duyệt tất cả" bỏ sót
      // đúng nhóm đơn đang chờ chính mình duyệt ở bước quản lý trực tiếp.
      const allPages = await Promise.all(queues.map((q) =>
        genericRequestService.list({
          owner: q.owner,
          request_type: 'SALARY_ADVANCE',
          status: q.status,
          page: 1,
          page_size: Math.max(totalItems, 500),
        })
      ));
      const all = { results: allPages.flatMap((r) => r.results) };

      let success = 0;
      const failed: { id: number; code: string; error: string }[] = [];

      // Sequential: BE admin_approve có side-effect ghi SalaryAdvance (get_or_create
      // + cộng dồn amount) — chạy tuần tự để tránh race trên cùng employee+month.
      for (let i = 0; i < all.results.length; i++) {
        const item = all.results[i];
        try {
          await approveByStage(item);
          success++;
        } catch (e: any) {
          failed.push({
            id: item.id,
            code: item.request_code || `#${item.id}`,
            error: e?.response?.data?.error || e?.message || 'Lỗi',
          });
        }
        setBulkProgress({ current: i + 1, total: all.results.length });
      }

      const summary = failed.length
        ? `Duyệt ${success}/${all.results.length} đơn. Lỗi ${failed.length} đơn:\n\n` +
          failed.slice(0, 10).map(f => `• ${f.code}: ${f.error}`).join('\n') +
          (failed.length > 10 ? `\n... và ${failed.length - 10} đơn khác` : '')
        : `Duyệt thành công tất cả ${success} đơn.`;
      alert(summary);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Không tải được danh sách để duyệt');
    } finally {
      setBulkProgress(null);
      await fetchData();
    }
  };

  const handleReject = async (item: GenericRequest) => {
    const note = window.prompt('Lý do từ chối (bắt buộc):');
    if (!note || !note.trim()) return;
    setActionId(item.id);
    try {
      await genericRequestService.reject(item.id, note.trim());
      await fetchData();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Từ chối thất bại');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-4">
      {lockState && !lockState.is_locked && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 p-3 text-sm flex items-center gap-2">
          <LockOpenIcon className="w-4 h-4 flex-shrink-0" />
          <span>
            Admin đã <strong>mở khoá</strong> — có thể duyệt đơn tạm ứng lương bất kỳ ngày nào trong tháng, không giới hạn 3 ngày đầu tháng.
          </span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-500">
          {isAdmin && isManager
            ? 'Đơn chờ bạn duyệt — gồm cả bước quản lý trực tiếp (cấp dưới của bạn) lẫn bước HCNS duyệt cuối. Nhãn trên từng dòng cho biết đơn đang ở bước nào.'
            : isAdmin
            ? 'Danh sách đơn chờ HCNS duyệt cuối (đã qua quản lý trực tiếp).'
            : 'Danh sách đơn chờ bạn duyệt (cấp 1).'}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleApproveAll}
            disabled={loading || totalItems === 0 || bulkProgress !== null}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-md shadow-sm hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <CheckIcon className="w-4 h-4" />
            {bulkProgress
              ? `Đang duyệt ${bulkProgress.current}/${bulkProgress.total}...`
              : `Duyệt tất cả (${totalItems})`}
          </button>
          <button
            type="button"
            onClick={fetchData}
            disabled={bulkProgress !== null}
            className="btn-secondary flex items-center gap-2 disabled:opacity-60"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Tải lại
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500">Đang tải...</div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Không có đơn nào chờ duyệt.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => {
              const amt = (item.extra_data as any)?.amount;
              return (
                <li
                  key={item.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 truncate">
                        {item.employee_name}{' '}
                        <span className="text-gray-400 font-normal">({item.employee_code})</span>
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ring-1 ${STATUS_BADGE[item.status]}`}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Mã: {item.request_code} · Phòng ban: {item.employee_department || '—'} ·
                      Tạo: {new Date(item.created_at).toLocaleDateString('vi-VN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="text-lg font-semibold text-emerald-700 whitespace-nowrap">
                      {formatCurrency(amt)}
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setDetailRequest(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all"
                      >
                        <EyeIcon className="w-3.5 h-3.5" />
                        Chi tiết
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(item)}
                        disabled={actionId === item.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-all"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                        Duyệt
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(item)}
                        disabled={actionId === item.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700 disabled:opacity-60 transition-all"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                        Từ chối
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      {detailRequest && (
        <DetailModal request={detailRequest} onClose={() => setDetailRequest(null)} />
      )}
    </div>
  );
};

// ─── TAB 3: ĐÃ DUYỆT ───────────────────────────────────────────────────────
const ApprovedTab: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState<AdvanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await salaryService.listAdvances({ year, month });
      setRecords(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Không tải được dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const totalAmount = useMemo(
    () => records.reduce((s, r) => s + Number(r.amount || 0), 0),
    [records]
  );

  const handleExport = async () => {
    if (!records.length) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`Tạm ứng T${month}-${year}`);
      ws.columns = [
        { header: 'STT',                     key: 'stt',             width: 6 },
        { header: 'MÃ NHÂN VIÊN',            key: 'employee_code',   width: 16 },
        { header: 'HỌ VÀ TÊN',               key: 'employee_name',   width: 28 },
        { header: 'PHÒNG BAN',               key: 'department_name', width: 26 },
        { header: 'NGÀY VÀO LÀM VIỆC',       key: 'start_date',      width: 18 },
        { header: 'SỐ TIỀN TẠM ỨNG (VNĐ)',   key: 'amount',          width: 20 },
        ...(isAdmin
          ? [{ header: 'LƯƠNG CỨNG (VNĐ)', key: 'basic_salary', width: 18 }]
          : []),
        { header: 'VÙNG MIỀN',               key: 'region',          width: 16 },
        { header: 'GHI CHÚ',                 key: 'notes',           width: 30 },
        { header: 'SỐ TÀI KHOẢN',            key: 'bank_account',    width: 20 },
        { header: 'NGÂN HÀNG',               key: 'bank_name',       width: 24 },
      ];

      // Merge row 1 làm tiêu đề "DANH SÁCH NHÂN SỰ <CÔNG TY> TẠM ỨNG LƯƠNG THÁNG M/YYYY"
      ws.insertRow(1, []);
      ws.mergeCells(1, 1, 1, ws.columns.length);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = `DANH SÁCH NHÂN SỰ ${BRAND.companyName.toLocaleUpperCase('vi-VN')} TẠM ỨNG LƯƠNG THÁNG ${String(month).padStart(2, '0')}/${year}`;
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getRow(1).height = 28;

      // Row 2 = header
      ws.getRow(2).eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' },
          bottom: { style: 'thin' }, right: { style: 'thin' },
        };
      });
      ws.getRow(2).height = 40;

      const fmtDate = (d?: string | null) => {
        if (!d) return '';
        try { return new Date(d).toLocaleDateString('vi-VN'); } catch { return ''; }
      };

      records.forEach((r, i) => {
        const amt = Number(r.amount);
        const row = ws.addRow({
          stt: i + 1,
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          department_name: r.department_name || '',
          start_date: fmtDate(r.start_date),
          amount: amt,
          ...(isAdmin
            ? { basic_salary: r.basic_salary != null ? Number(r.basic_salary) : null }
            : {}),
          region: r.region || '',
          notes: r.notes || '',
          bank_account: r.bank_account || '',
          bank_name: r.bank_name || '',
        });
        row.getCell('amount').numFmt = '#,##0';
        if (isAdmin) row.getCell('basic_salary').numFmt = '#,##0';
        row.alignment = { vertical: 'middle', wrapText: true };
      });

      const totalBasic = isAdmin
        ? records.reduce(
            (s, r) => s + (r.basic_salary != null ? Number(r.basic_salary) : 0), 0
          )
        : null;
      const sumRow = ws.addRow({
        stt: '',
        employee_code: '',
        employee_name: 'TỔNG',
        department_name: '',
        start_date: '',
        amount: totalAmount,
        ...(isAdmin ? { basic_salary: totalBasic } : {}),
        region: '',
        notes: `${records.length} bản ghi`,
        bank_account: '',
        bank_name: '',
      });
      sumRow.font = { bold: true };
      sumRow.getCell('amount').numFmt = '#,##0';
      if (isAdmin) sumRow.getCell('basic_salary').numFmt = '#,##0';

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `tam_ung_luong_T${month}_${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Xuất Excel thất bại: ' + (e?.message || 'lỗi không xác định'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Tháng</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="input-field w-28"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                Tháng {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Năm</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="input-field w-28"
          >
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={fetchData}
          className="btn-secondary flex items-center gap-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Tải lại
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={!records.length || exporting}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors ml-auto"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
          {exporting ? 'Đang xuất...' : 'Xuất Excel'}
        </button>
      </div>

      {/* Summary */}
      {records.length > 0 && (
        <div className="card p-4 flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-gray-500">Số bản ghi</p>
            <p className="text-lg font-semibold text-gray-900">{records.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Tổng tiền tạm ứng</p>
            <p className="text-lg font-semibold text-emerald-700">{formatCurrency(totalAmount)}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500">Đang tải...</div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">{error}</div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Không có dữ liệu tạm ứng tháng {month}/{year}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold text-gray-700">STT</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Mã nhân viên</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Họ và tên</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Phòng ban</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Ngày vào làm việc</th>
                  <th className="px-3 py-2 font-semibold text-gray-700 text-right">Số tiền tạm ứng (VNĐ)</th>
                  {isAdmin && (
                    <th className="px-3 py-2 font-semibold text-gray-700 text-right">Lương cứng (VNĐ)</th>
                  )}
                  <th className="px-3 py-2 font-semibold text-gray-700">Vùng miền</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Ghi chú</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Số tài khoản</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Ngân hàng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r, i) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">{i + 1}</td>
                    <td className="px-3 py-2 text-gray-600">{r.employee_code}</td>
                    <td className="px-3 py-2 text-gray-900 font-medium">{r.employee_name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.department_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.start_date ? new Date(r.start_date).toLocaleDateString('vi-VN') : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                      {formatCurrency(r.amount)}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right text-gray-700">
                        {r.basic_salary != null ? formatCurrency(Number(r.basic_salary)) : '—'}
                      </td>
                    )}
                    <td className="px-3 py-2 text-gray-600">{r.region || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-xs truncate" title={r.notes}>
                      {r.notes || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 font-mono text-xs">{r.bank_account || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.bank_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── DETAIL MODAL (dùng chung cho 3 tab) ───────────────────────────────────
const formatDateTime = (d: string | null | undefined): string => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

const DetailModal: React.FC<{ request: GenericRequest; onClose: () => void }> = ({
  request,
  onClose,
}) => {
  const extra = (request.extra_data || {}) as any;
  const amount = Number(extra.amount || 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Chi tiết đơn tạm ứng lương
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{request.request_code}</p>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full ring-1 ${STATUS_BADGE[request.status]} flex-shrink-0`}
          >
            {STATUS_LABELS[request.status]}
          </span>
        </div>

        {/* Thông tin nhân sự */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Thông tin nhân sự</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReadOnlyField
              label="Họ và tên người đề nghị"
              value={extra.requester_name || request.employee_name || '—'}
            />
            <ReadOnlyField
              label="Mã nhân viên"
              value={extra.employee_code || request.employee_code || '—'}
            />
            <ReadOnlyField
              label="Bộ phận công tác"
              value={extra.department_name || request.employee_department || '—'}
            />
            <ReadOnlyField
              label="Quản lý trực tiếp"
              value={extra.manager_name || '—'}
            />
          </div>
        </div>

        {/* Số tiền */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Số tiền tạm ứng</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReadOnlyField label="Số tiền" value={formatCurrency(amount)} />
            <ReadOnlyField
              label="Số tiền (viết bằng chữ)"
              value={extra.amount_in_words || amountToWords(amount) || '—'}
              multiline
            />
            {extra.basic_salary_snapshot != null && (
              <ReadOnlyField
                label="Lương cơ bản (tại thời điểm tạo)"
                value={formatCurrency(Number(extra.basic_salary_snapshot))}
              />
            )}
          </div>
        </div>

        {/* Workflow */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Quy trình duyệt</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-400 mt-1 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-800">Tạo đơn</p>
                <p className="text-xs text-gray-500">{formatDateTime(request.created_at)}</p>
              </div>
            </li>
            {request.submitted_at && (
              <li className="flex items-start gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-400 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-800">Gửi duyệt</p>
                  <p className="text-xs text-gray-500">{formatDateTime(request.submitted_at)}</p>
                </div>
              </li>
            )}
            {request.manager_approved_at && (
              <li className="flex items-start gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-800">
                    Quản lý duyệt
                    {request.manager_approved_by_name && (
                      <span className="font-normal text-gray-600">
                        {' '}— {request.manager_approved_by_name}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDateTime(request.manager_approved_at)}
                  </p>
                </div>
              </li>
            )}
            {request.admin_approved_at && (
              <li className="flex items-start gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-600 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-800">
                    HCNS duyệt cuối
                    {request.admin_approved_by_name && (
                      <span className="font-normal text-gray-600">
                        {' '}— {request.admin_approved_by_name}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDateTime(request.admin_approved_at)}
                  </p>
                </div>
              </li>
            )}
            {request.rejected_at && (
              <li className="flex items-start gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500 mt-1 flex-shrink-0" />
                <div>
                  <p className="font-medium text-rose-700">
                    Từ chối
                    {request.rejected_level && (
                      <span className="text-xs font-normal">
                        {' '}({request.rejected_level === 'MANAGER' ? 'Quản lý' : 'HCNS'})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{formatDateTime(request.rejected_at)}</p>
                  {request.approval_note && (
                    <p className="text-xs text-rose-700 mt-1">
                      Lý do: {request.approval_note}
                    </p>
                  )}
                </div>
              </li>
            )}
          </ul>
        </div>

        {request.reason && request.reason !== 'Đơn tạm ứng lương theo quy định công ty.' && (
          <ReadOnlyField label="Lý do" value={request.reason} multiline />
        )}

        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default SalaryAdvance;
