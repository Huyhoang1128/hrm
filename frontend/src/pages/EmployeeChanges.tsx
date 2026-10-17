import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  BanknotesIcon,
  BuildingOffice2Icon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { employeesAPI, departmentsAPI, positionsAPI } from '../utils/api/hrm.api';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import type { SelectOption } from '../components/LandingLayout/SelectBox';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import { useDebounce } from '../hooks/useDebounce';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import {
  apiErrorMessage,
  employeeChangeService,
  type EmployeeChangeCreatePayload,
  type EmployeeChangeRecord,
  type EmployeeChangeStatus,
  type EmployeeChangeType,
  type EmployeeCurrentValues,
} from '../services/employeeChange.service';

// Trang "Điều chỉnh nhân sự": đổi phòng ban / chức vụ / lương / phụ cấp từ một ngày, luôn có
// nhật ký. Ngày áp dụng trong tương lai thì backend giữ ở "Chờ áp dụng" và tự cập nhật hồ sơ
// đúng ngày đó.

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

const formatMoney = (value?: string | number | null) =>
  value === null || value === undefined || value === '' ? '—' : `${Math.round(Number(value)).toLocaleString('vi-VN')} đ`;

/** "12.500.000" -> 12500000; rỗng -> null. */
const parseMoney = (text: string): number | null => {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : null;
};
const moneyInputValue = (value?: string | number | null) =>
  value === null || value === undefined || value === '' ? '' : Math.round(Number(value)).toLocaleString('de-DE');

const STATUS_STYLE: Record<EmployeeChangeStatus, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-800 ring-amber-200',
  APPLIED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  CANCELLED: 'bg-gray-100 text-gray-600 ring-gray-200',
};

const TYPE_OPTIONS: SelectOption<EmployeeChangeType | ''>[] = [
  { value: '', label: 'Tất cả loại' },
  { value: 'ORG', label: 'Phòng ban / chức vụ' },
  { value: 'SALARY', label: 'Lương / phụ cấp' },
];
const STATUS_OPTIONS: SelectOption<string>[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'SCHEDULED', label: 'Chờ áp dụng' },
  { value: 'APPLIED', label: 'Đã áp dụng' },
  { value: 'CANCELLED', label: 'Đã huỷ' },
];

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:bg-gray-50 disabled:text-gray-500';

/** Các dòng "cũ → mới" của một lần điều chỉnh. */
function changeLines(r: EmployeeChangeRecord): Array<{ label: string; from: string; to: string }> {
  const lines: Array<{ label: string; from: string; to: string }> = [];
  if (r.change_type === 'ORG') {
    if (r.changes_department) lines.push({ label: 'Phòng ban', from: r.old_department_name || '—', to: r.new_department_name || '—' });
    if (r.changes_position) lines.push({ label: 'Chức vụ', from: r.old_position_name || '—', to: r.new_position_name || '—' });
    return lines;
  }
  if (r.new_basic_salary !== null) lines.push({ label: 'Lương', from: formatMoney(r.old_basic_salary), to: formatMoney(r.new_basic_salary) });
  if (r.new_allowance !== null) lines.push({ label: 'Phụ cấp', from: formatMoney(r.old_allowance), to: formatMoney(r.new_allowance) });
  return lines;
}

const StatusBadge: React.FC<{ record: EmployeeChangeRecord }> = ({ record }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[record.status]}`}>
    {record.status === 'SCHEDULED' && <ClockIcon className="h-3.5 w-3.5" />}
    {record.status_display}
  </span>
);

const ChangeLines: React.FC<{ record: EmployeeChangeRecord }> = ({ record }) => {
  // Số tiền không xuống dòng giữa số và "đ"; tên phòng ban dài thì cho xuống dòng.
  const valueClass = record.change_type === 'SALARY' ? 'whitespace-nowrap' : '';
  return (
    <ul className="space-y-1">
      {changeLines(record).map((line) => (
        <li key={line.label} className="text-sm">
          <span className="text-gray-500">{line.label}: </span>
          <span className={`text-gray-500 line-through decoration-gray-300 ${valueClass}`}>{line.from}</span>
          <span className="mx-1 text-gray-400">→</span>
          <span className={`font-semibold text-gray-900 ${valueClass}`}>{line.to}</span>
        </li>
      ))}
    </ul>
  );
};

// ── Modal tạo điều chỉnh ─────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  initialEmployeeId: number | null;
  employees: SelectOption<number | ''>[];
  departments: SelectOption<number | ''>[];
  positions: SelectOption<number | ''>[];
  onClose: () => void;
  onCreated: (record: EmployeeChangeRecord) => void;
}

const CreateChangeModal: React.FC<CreateModalProps> = ({
  open, initialEmployeeId, employees, departments, positions, onClose, onCreated,
}) => {
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [current, setCurrent] = useState<EmployeeCurrentValues | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [changeType, setChangeType] = useState<EmployeeChangeType>('ORG');
  const [newDepartment, setNewDepartment] = useState<number | ''>('');
  const [newPosition, setNewPosition] = useState<number | ''>('');
  const [basicSalary, setBasicSalary] = useState('');
  const [allowance, setAllowance] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(initialEmployeeId ?? '');
    setChangeType('ORG');
    setEffectiveDate(todayISO());
    setNote('');
    setError('');
  }, [open, initialEmployeeId]);

  useEffect(() => {
    setCurrent(null);
    setNewDepartment('');
    setNewPosition('');
    if (!open || employeeId === '') return;
    let cancelled = false;
    setLoadingCurrent(true);
    employeeChangeService
      .current(employeeId)
      .then((data) => {
        if (cancelled) return;
        setCurrent(data);
        setBasicSalary(moneyInputValue(data.basic_salary));
        setAllowance(moneyInputValue(data.allowance));
      })
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Không tải được thông tin hiện tại của nhân viên.')))
      .finally(() => !cancelled && setLoadingCurrent(false));
    return () => {
      cancelled = true;
    };
  }, [open, employeeId]);

  const pendingSameType = current?.pending.find((p) => p.change_type === changeType) ?? null;
  const isFuture = effectiveDate > todayISO();
  const effectiveMonth = effectiveDate ? `${effectiveDate.slice(5, 7)}/${effectiveDate.slice(0, 4)}` : '';

  const buildPayload = (): EmployeeChangeCreatePayload | string => {
    if (employeeId === '' || !current) return 'Vui lòng chọn nhân viên.';
    if (!effectiveDate) return 'Vui lòng chọn ngày áp dụng.';
    const payload: EmployeeChangeCreatePayload = {
      employee: employeeId, change_type: changeType, effective_date: effectiveDate, note: note.trim(),
    };
    if (changeType === 'ORG') {
      if (newDepartment !== '' && newDepartment !== current.department_id) payload.department_id = newDepartment;
      if (newPosition !== '' && newPosition !== current.position_id) payload.position_id = newPosition;
      if (payload.department_id === undefined && payload.position_id === undefined) {
        return 'Chọn phòng ban mới hoặc chức vụ mới khác với hiện tại.';
      }
    } else {
      const same = (text: string, now: string | null) => parseMoney(text) === (now === null ? null : Math.round(Number(now)));
      if (basicSalary !== '' && !same(basicSalary, current.basic_salary)) payload.basic_salary = parseMoney(basicSalary) ?? 0;
      if (allowance !== '' && !same(allowance, current.allowance)) payload.allowance = parseMoney(allowance) ?? 0;
      if (payload.basic_salary === undefined && payload.allowance === undefined) {
        return 'Nhập lương hoặc phụ cấp mới khác với hiện tại.';
      }
    }
    return payload;
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (typeof payload === 'string') {
      setError(payload);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      onCreated(await employeeChangeService.create(payload));
    } catch (err) {
      setError(apiErrorMessage(err, 'Không lưu được điều chỉnh. Vui lòng thử lại.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const moneyField = (label: string, now: string | null, value: string, setValue: (v: string) => void) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">{label} hiện tại</label>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{formatMoney(now)}</div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">{label} mới</label>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const n = parseMoney(e.target.value);
            setValue(n === null ? '' : n.toLocaleString('de-DE'));
          }}
          placeholder="Giữ nguyên"
          className={inputClass}
        />
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[95vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
          <div>
            <h3 className="text-base font-bold text-gray-900">Tạo điều chỉnh nhân sự</h3>
            <p className="text-xs text-gray-500">Mọi thay đổi đều được lưu vào nhật ký điều chỉnh</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <SelectBox<number | ''>
            label="Nhân viên *"
            value={employeeId}
            options={employees}
            onChange={(v) => setEmployeeId(v)}
            placeholder="Tìm mã hoặc tên nhân viên..."
            searchable
          />

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
            {([
              ['ORG', 'Phòng ban / Chức vụ', BuildingOffice2Icon],
              ['SALARY', 'Lương / Phụ cấp', BanknotesIcon],
            ] as const).map(([type, label, Icon]) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setChangeType(type);
                  setError('');
                }}
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:text-sm ${
                  changeType === type ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {employeeId !== '' && loadingCurrent && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <ArrowPathIcon className="h-4 w-4 animate-spin" /> Đang tải thông tin hiện tại...
            </div>
          )}

          {pendingSameType && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Nhân viên đang có một điều chỉnh {pendingSameType.change_type_display.toLowerCase()} chờ áp dụng từ{' '}
                <strong>{formatDate(pendingSameType.effective_date)}</strong>. Huỷ điều chỉnh đó ở danh sách bên dưới trước
                khi tạo điều chỉnh mới.
              </span>
            </div>
          )}

          {current && changeType === 'ORG' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Phòng ban hiện tại</label>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{current.department_name || '—'}</div>
                </div>
                <SelectBox<number | ''>
                  label="Phòng ban mới"
                  value={newDepartment}
                  options={[{ value: '', label: 'Giữ nguyên' }, ...departments]}
                  onChange={(v) => setNewDepartment(v)}
                  searchable
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Chức vụ hiện tại</label>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{current.position_name || '—'}</div>
                </div>
                <SelectBox<number | ''>
                  label="Chức vụ mới"
                  value={newPosition}
                  options={[{ value: '', label: 'Giữ nguyên' }, ...positions]}
                  onChange={(v) => setNewPosition(v)}
                  searchable
                />
              </div>
            </div>
          )}

          {current && changeType === 'SALARY' && (
            <div className="space-y-3">
              {moneyField('Lương', current.basic_salary, basicSalary, setBasicSalary)}
              {moneyField('Phụ cấp', current.allowance, allowance, setAllowance)}
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Bảng lương lấy mức lương có hiệu lực vào ngày cuối tháng: lương mới được tính từ kỳ lương{' '}
                <strong>tháng {effectiveMonth}</strong>. Mức đóng BHXH quản lý ở trang BHXH (kỳ đóng).
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Ngày áp dụng *</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClass} />
              <p className={`mt-1 text-xs ${isFuture ? 'text-amber-700' : 'text-gray-500'}`}>
                {isFuture ? `Chờ áp dụng — hệ thống tự cập nhật hồ sơ vào ngày ${formatDate(effectiveDate)}.` : 'Áp dụng ngay khi lưu.'}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Lý do điều chỉnh, số quyết định..."
                className={inputClass}
              />
            </div>
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Huỷ
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !current || !!pendingSameType}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Đang lưu...' : isFuture ? 'Lưu & hẹn ngày áp dụng' : 'Lưu & áp dụng'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Trang chính ──────────────────────────────────────────────────────────────────

const EmployeeChanges: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const employeeParam = Number(searchParams.get('employee')) || null;

  const [records, setRecords] = useState<EmployeeChangeRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [changeType, setChangeType] = useState<EmployeeChangeType | ''>('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [employees, setEmployees] = useState<SelectOption<number | ''>[]>([]);
  const [departments, setDepartments] = useState<SelectOption<number | ''>[]>([]);
  const [positions, setPositions] = useState<SelectOption<number | ''>[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<EmployeeChangeRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const filteredEmployeeName = useMemo(
    () => (employeeParam ? employees.find((e) => e.value === employeeParam)?.label : undefined),
    [employeeParam, employees],
  );

  useEffect(() => {
    employeesAPI
      .list({ page_size: 1000, is_active: true, ordering: 'employee_id' })
      .then((res) => setEmployees(res.results.map((e) => ({ value: e.id, label: `${e.employee_id} - ${e.full_name}` }))))
      .catch(() => setEmployees([]));
    departmentsAPI
      .list({ page_size: 1000 })
      .then((res) => setDepartments(res.results.map((d) => ({ value: d.id, label: d.name }))))
      .catch(() => setDepartments([]));
    positionsAPI
      .list({ page_size: 1000 })
      .then((res) => setPositions(res.results.map((p) => ({ value: p.id, label: p.title }))))
      .catch(() => setPositions([]));
  }, []);

  // Mở từ trang nhân viên (?employee=<id>&create=1) thì mở sẵn form cho đúng người.
  useEffect(() => {
    if (employeeParam && searchParams.get('create') === '1') setCreateOpen(true);
  }, [employeeParam, searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await employeeChangeService.list({
        page,
        page_size: pageSize,
        employee: employeeParam ?? undefined,
        search: debouncedSearch.trim(),
        change_type: changeType,
        status,
        date_from: dateFrom,
        date_to: dateTo,
      });
      setRecords(data.results);
      setCount(data.count);
    } catch (err) {
      setError(apiErrorMessage(err, 'Không tải được nhật ký điều chỉnh.'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, employeeParam, debouncedSearch, changeType, status, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, changeType, status, dateFrom, dateTo, employeeParam]);

  const clearEmployeeFilter = () => {
    searchParams.delete('employee');
    searchParams.delete('create');
    setSearchParams(searchParams);
  };

  const handleCreated = (record: EmployeeChangeRecord) => {
    setCreateOpen(false);
    if (searchParams.get('create')) {
      searchParams.delete('create');
      setSearchParams(searchParams);
    }
    setSuccess(
      record.status === 'APPLIED'
        ? `Đã áp dụng điều chỉnh cho ${record.employee_name}.`
        : `Đã lưu điều chỉnh cho ${record.employee_name} — tự áp dụng vào ngày ${formatDate(record.effective_date)}.`,
    );
    load();
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await employeeChangeService.cancel(cancelTarget.id);
      setSuccess(`Đã huỷ điều chỉnh của ${cancelTarget.employee_name}.`);
      setCancelTarget(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Không huỷ được điều chỉnh.'));
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  };

  const actions = (r: EmployeeChangeRecord) =>
    r.status === 'SCHEDULED' ? (
      <button
        onClick={() => setCancelTarget(r)}
        className="whitespace-nowrap rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Huỷ điều chỉnh
      </button>
    ) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl">Điều chỉnh nhân sự</h1>
          <p className="mt-1 text-sm text-gray-600">
            Đổi phòng ban, chức vụ, lương, phụ cấp từ một ngày — lưu lại toàn bộ lịch sử để theo dõi quá trình làm việc.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          Tạo điều chỉnh
        </button>
      </div>

      {success && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-emerald-600 hover:text-emerald-800">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        {employeeParam && (
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-sm text-primary-800">
            <span className="truncate">Đang xem: {filteredEmployeeName || `nhân viên #${employeeParam}`}</span>
            <button onClick={clearEmployeeFilter} className="shrink-0 text-primary-500 hover:text-primary-700">
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Tìm nhân viên</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Mã hoặc tên nhân viên"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <SelectBox<EmployeeChangeType | ''> label="Loại" value={changeType} options={TYPE_OPTIONS} onChange={setChangeType} />
          <SelectBox<string> label="Trạng thái" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Áp dụng từ ngày</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Đến ngày</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
          </div>
          <div className="flex items-end lg:col-span-6 lg:justify-end">
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
            <ArrowPathIcon className="h-5 w-5 animate-spin" /> Đang tải nhật ký...
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-gray-500">
            <ArrowsRightLeftIcon className="h-10 w-10 text-gray-300" />
            Chưa có điều chỉnh nào khớp bộ lọc.
          </div>
        ) : (
          <>
            {/* Điện thoại: thẻ */}
            <div className="divide-y divide-gray-100 sm:hidden">
              {records.map((r) => (
                <div key={r.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/dashboard/employees/${r.employee}`} className="font-semibold text-gray-900 hover:text-primary-700">
                        {r.employee_name}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {r.employee_code} · {r.change_type_display}
                      </p>
                    </div>
                    <StatusBadge record={r} />
                  </div>
                  <ChangeLines record={r} />
                  <p className="text-xs text-gray-500">
                    Áp dụng: <strong className="text-gray-800">{formatDate(r.effective_date)}</strong>
                  </p>
                  {r.note && <p className="text-xs italic text-gray-600">“{r.note}”</p>}
                  {r.apply_error && <p className="text-xs text-red-600">Lỗi khi áp dụng: {r.apply_error}</p>}
                  <p className="text-xs text-gray-400">
                    Tạo bởi {r.created_by_name || '—'} · {formatDateTime(r.created_at)}
                  </p>
                  {actions(r)}
                </div>
              ))}
            </div>

            {/* Từ sm trở lên: bảng */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Ngày áp dụng', 'Nhân viên', 'Nội dung điều chỉnh', 'Trạng thái', 'Người thực hiện'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-gray-50/60">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{formatDate(r.effective_date)}</td>
                      <td className="min-w-[10rem] px-4 py-3">
                        <Link to={`/dashboard/employees/${r.employee}`} className="font-semibold text-gray-900 hover:text-primary-700">
                          {r.employee_name}
                        </Link>
                        <p className="text-xs text-gray-500">{r.employee_code}</p>
                      </td>
                      <td className="min-w-[18rem] px-4 py-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{r.change_type_display}</p>
                        <ChangeLines record={r} />
                        {r.change_type === 'SALARY' && (
                          <p className="mt-1 text-xs text-gray-400">Tính lương từ kỳ {formatDate(r.effective_date).slice(3)}</p>
                        )}
                        {r.note && <p className="mt-1.5 text-xs italic text-gray-600">Ghi chú: {r.note}</p>}
                      </td>
                      <td className="min-w-[9rem] px-4 py-3">
                        <StatusBadge record={r} />
                        {r.status === 'APPLIED' && r.applied_at && <p className="mt-1 text-xs text-gray-400">{formatDateTime(r.applied_at)}</p>}
                        {r.status === 'CANCELLED' && (
                          <p className="mt-1 text-xs text-gray-400">
                            {r.cancelled_by_name} · {formatDateTime(r.cancelled_at)}
                          </p>
                        )}
                        {r.apply_error && <p className="mt-1 max-w-[14rem] text-xs text-red-600">Lỗi: {r.apply_error}</p>}
                        {r.status === 'SCHEDULED' && <div className="mt-2">{actions(r)}</div>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                        <p>{r.created_by_name || '—'}</p>
                        <p className="text-gray-400">{formatDateTime(r.created_at)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {count > 0 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination
              currentPage={page}
              totalPages={Math.max(1, Math.ceil(count / pageSize))}
              totalItems={count}
              itemsPerPage={pageSize}
              onPageChange={setPage}
              onItemsPerPageChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      <CreateChangeModal
        open={createOpen}
        initialEmployeeId={employeeParam}
        employees={employees}
        departments={departments}
        positions={positions}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        variant="warning"
        title="Huỷ điều chỉnh?"
        message={
          cancelTarget
            ? `Huỷ điều chỉnh ${cancelTarget.change_type_display.toLowerCase()} của ${cancelTarget.employee_name} (áp dụng ${formatDate(cancelTarget.effective_date)}). Hồ sơ nhân viên sẽ giữ nguyên như hiện tại.`
            : ''
        }
        confirmLabel="Huỷ điều chỉnh"
        cancelLabel="Đóng"
        loading={cancelling}
        onConfirm={handleCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
};

export default EmployeeChanges;
