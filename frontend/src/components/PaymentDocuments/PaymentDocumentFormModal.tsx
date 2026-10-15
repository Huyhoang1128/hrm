import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon,
  PlusIcon,
  TrashIcon,
  PaperClipIcon,
  CloudArrowUpIcon,
  ExclamationCircleIcon,
  DocumentTextIcon,
  ArrowUturnLeftIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { SelectBox } from '../LandingLayout/SelectBox';
import type { SelectOption } from '../LandingLayout/SelectBox';
import { departmentsAPI, employeesAPI } from '../../utils/api/hrm.api';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import paymentDocumentService, {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  COMPLETED_DATE_LABELS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DUE_DATE_LABELS,
  MAX_ATTACHMENT_SIZE,
  PAYEE_LABELS,
  STATUSES,
  digitsOnly,
  formatVND,
  parseApiErrors,
  statusLabel,
} from '../../services/paymentDocument.service';
import type {
  PaymentDocType,
  PaymentDocStatus,
  PaymentDocument,
  PaymentDocumentPayload,
  PaymentMethod,
} from '../../services/paymentDocument.service';
import { fmtDateTime, fmtFileSize, fmtMoney, todayISO } from './shared';

// ── Kiểu dữ liệu nội bộ ───────────────────────────────────────────────────
interface EmployeeOption {
  id: number;
  code: string;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
}

interface ItemRow {
  key: number;
  name: string;
  unit: string;
  /** chuỗi số thập phân, dấu chấm ("1.5") */
  quantity: string;
  /** chỉ chữ số ("150000") */
  unitPrice: string;
}

const KNOWN_FIELDS = new Set([
  'doc_type', 'doc_date', 'employee', 'requester_name', 'department', 'title', 'description',
  'amount', 'payee', 'payment_method', 'bank_account', 'items', 'due_date', 'status',
  'completed_date', 'settled_amount', 'note', 'attachments',
]);

const TYPE_ACTIVE_CLS: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'border-sky-500 bg-sky-50 text-sky-800 ring-1 ring-sky-500',
  PURCHASE_PROPOSAL: 'border-violet-500 bg-violet-50 text-violet-800 ring-1 ring-violet-500',
  EXPENSE_ADVANCE: 'border-orange-500 bg-orange-50 text-orange-800 ring-1 ring-orange-500',
};

const TYPE_HINT: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Mã DNTT',
  PURCHASE_PROPOSAL: 'Mã DXMH',
  EXPENSE_ADVANCE: 'Mã DNTU',
};

let rowKeySeq = 1;
const newRow = (partial?: Partial<ItemRow>): ItemRow => ({
  key: rowKeySeq++,
  name: '',
  unit: '',
  quantity: '',
  unitPrice: '',
  ...partial,
});

const sanitizeQuantity = (v: string): string => {
  const s = v.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot === -1) return s.slice(0, 12);
  return (s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')).slice(0, 12);
};

const rowTotal = (r: ItemRow): number => {
  const q = parseFloat(r.quantity);
  const p = Number(r.unitPrice || 0);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return Math.round(q * p);
};

const isRowFilled = (r: ItemRow) => !!(r.name.trim() || r.unit.trim() || r.quantity || r.unitPrice);

const fileExt = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

// ── Ô nhập liệu dùng chung ───────────────────────────────────────────────
const Field: React.FC<{
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ label, error, hint, className = '', children }) => (
  <div className={className}>
    <label className="block text-sm font-medium mb-1 text-gray-700">{label}</label>
    {children}
    {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    {error && (
      <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
        <ExclamationCircleIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>{error}</span>
      </p>
    )}
  </div>
);

const Req = () => <span className="text-red-500">*</span>;

const errCls = (bad?: unknown) => (bad ? ' border-red-400 focus:ring-red-300' : '');

const MoneyInput: React.FC<{
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}> = ({ value, onChange, disabled, invalid, placeholder = '0', ariaLabel }) => (
  <div className="relative">
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={formatVND(value)}
      onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, 15))}
      disabled={disabled}
      placeholder={placeholder}
      className={`input-field pr-7 text-right tabular-nums${errCls(invalid)}${
        disabled ? ' bg-gray-50 text-gray-700 cursor-not-allowed' : ''
      }`}
    />
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₫</span>
  </div>
);

// ── Chọn nhân viên (tìm qua API) ──────────────────────────────────────────
const EmployeePicker: React.FC<{
  value: EmployeeOption | null;
  onChange: (emp: EmployeeOption | null) => void;
  invalid?: boolean;
}> = ({ value, onChange, invalid }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<EmployeeOption[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await employeesAPI.list({ search: query.trim() || undefined, page_size: 20 });
        if (cancelled) return;
        setOptions(
          (res.results || []).map((e) => ({
            id: e.id,
            code: e.employee_id,
            name: e.full_name,
            departmentId: e.department?.id ?? null,
            departmentName: e.department?.name ?? null,
          }))
        );
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  if (value) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2 ${
          invalid ? 'border-red-400' : 'border-gray-200'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{value.name}</p>
          <p className="text-xs text-gray-500 truncate">
            <span className="font-mono">{value.code}</span>
            {value.departmentName ? ` · ${value.departmentName}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery('');
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          aria-label="Đổi người đề nghị"
          title="Đổi người đề nghị"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Tìm theo mã hoặc tên nhân viên..."
        autoComplete="off"
        className={`input-field pl-9${errCls(invalid)}`}
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {loading && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">Đang tìm...</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">Không tìm thấy nhân viên.</li>
          ) : (
            options.map((emp) => (
              <li
                key={emp.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(emp);
                  setOpen(false);
                  setQuery('');
                }}
                className="cursor-pointer px-3 py-2 hover:bg-primary-50"
              >
                <p className="text-sm text-gray-900">
                  <span className="font-mono text-xs text-primary-700 mr-2">{emp.code}</span>
                  {emp.name}
                </p>
                {emp.departmentName && <p className="text-xs text-gray-500">{emp.departmentName}</p>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

// ── Modal tạo / sửa phiếu ─────────────────────────────────────────────────
interface Props {
  /** null = tạo mới */
  initial: PaymentDocument | null;
  /** Loại phiếu chọn sẵn khi tạo mới (theo chip đang lọc) */
  defaultType?: PaymentDocType;
  onClose: () => void;
  onSaved: (doc: PaymentDocument, isNew: boolean) => void;
}

const PaymentDocumentFormModal: React.FC<Props> = ({ initial, defaultType, onClose, onSaved }) => {
  useLockBodyScroll(true);
  const isEdit = !!initial;

  const [docType, setDocType] = useState<PaymentDocType>(initial?.doc_type || defaultType || 'PAYMENT_REQUEST');
  const [docDate, setDocDate] = useState(initial?.doc_date || todayISO());
  const [requesterMode, setRequesterMode] = useState<'employee' | 'other'>(
    initial && !initial.employee && initial.requester_name ? 'other' : 'employee'
  );
  const [employee, setEmployee] = useState<EmployeeOption | null>(
    initial?.employee
      ? {
          id: initial.employee,
          code: initial.employee_code || '',
          name: initial.employee_name || initial.requester_display || '',
          departmentId: initial.department,
          departmentName: initial.department_name,
        }
      : null
  );
  const [requesterName, setRequesterName] = useState(initial?.requester_name || '');
  const [department, setDepartment] = useState<number | ''>(initial?.department ?? '');
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [amount, setAmount] = useState(initial ? digitsOnly(String(Math.round(Number(initial.amount) || 0))) : '');
  const [payee, setPayee] = useState(initial?.payee || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.payment_method || '');
  const [bankAccount, setBankAccount] = useState(initial?.bank_account || '');
  const [items, setItems] = useState<ItemRow[]>(() => {
    const src = initial?.items || [];
    if (src.length) {
      return src.map((it) =>
        newRow({
          name: it.name || '',
          unit: it.unit || '',
          quantity: it.quantity === null || it.quantity === undefined ? '' : String(Number(it.quantity)),
          unitPrice: digitsOnly(String(Math.round(Number(it.unit_price) || 0))),
        })
      );
    }
    return (initial?.doc_type || defaultType) === 'PURCHASE_PROPOSAL' && !initial ? [newRow()] : [];
  });
  const [dueDate, setDueDate] = useState(initial?.due_date || '');
  const [status, setStatus] = useState<PaymentDocStatus>(initial?.status || 'PENDING');
  const [completedDate, setCompletedDate] = useState(initial?.completed_date || '');
  const [settled, setSettled] = useState(
    initial?.settled_amount !== null && initial?.settled_amount !== undefined && initial.settled_amount !== ''
      ? digitsOnly(String(Math.round(Number(initial.settled_amount) || 0)))
      : ''
  );
  const [note, setNote] = useState(initial?.note || '');

  const existingFiles = initial?.attachments || [];
  const [removeIds, setRemoveIds] = useState<number[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [departmentOptions, setDepartmentOptions] = useState<SelectOption<number | ''>[]>([
    { value: '', label: '— Không chọn —' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    departmentsAPI
      .list({ page_size: 1000 })
      .then((res) => {
        const opts: SelectOption<number | ''>[] = (res.results || [])
          .map((d) => ({ value: d.id as number | '', label: d.name }))
          .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
        // Phiếu cũ có bộ phận không còn trong danh sách → vẫn hiện tên
        if (initial?.department && !opts.some((o) => o.value === initial.department)) {
          opts.unshift({ value: initial.department, label: initial.department_name || `#${initial.department}` });
        }
        setDepartmentOptions([{ value: '', label: '— Không chọn —' }, ...opts]);
      })
      .catch(() => {
        if (initial?.department) {
          setDepartmentOptions([
            { value: '', label: '— Không chọn —' },
            { value: initial.department, label: initial.department_name || `#${initial.department}` },
          ]);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPurchase = docType === 'PURCHASE_PROPOSAL';
  const isAdvance = docType === 'EXPENSE_ADVANCE';
  const filledItems = useMemo(() => items.filter(isRowFilled), [items]);
  const itemsMode = isPurchase && filledItems.length > 0;
  const itemsTotal = useMemo(() => filledItems.reduce((s, r) => s + rowTotal(r), 0), [filledItems]);
  const effectiveAmount = itemsMode ? String(itemsTotal) : amount;
  const amountNum = Number(effectiveAmount || 0);
  const settledNum = Number(settled || 0);
  const outstanding = Math.max(amountNum - settledNum, 0);

  const clearError = (...keys: string[]) =>
    setErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      return next;
    });

  const handleTypeChange = (t: PaymentDocType) => {
    if (t === docType) return;
    // Rời "Đề xuất mua hàng" đang có mặt hàng → giữ số tiền = tổng thành tiền
    if (itemsMode) setAmount(String(itemsTotal));
    if (t === 'PURCHASE_PROPOSAL' && items.length === 0) setItems([newRow()]);
    setDocType(t);
    clearError('doc_type', 'items', 'amount', 'settled_amount');
  };

  const handleStatusChange = (s: PaymentDocStatus) => {
    setStatus(s);
    if (s === 'COMPLETED' && !completedDate) setCompletedDate(todayISO());
    clearError('status', 'completed_date');
  };

  const handleEmployeeChange = (emp: EmployeeOption | null) => {
    setEmployee(emp);
    if (emp?.departmentId) {
      setDepartment(emp.departmentId);
      if (!departmentOptions.some((o) => o.value === emp.departmentId)) {
        setDepartmentOptions((prev) => [
          ...prev,
          { value: emp.departmentId as number, label: emp.departmentName || `#${emp.departmentId}` },
        ]);
      }
    }
    clearError('employee', 'requester_name', 'department');
  };

  const updateRow = (key: number, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    clearError('items', 'amount');
  };

  // ── File đính kèm ─────────────────────────────────────────────────────
  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const rejected: string[] = [];
    const accepted: File[] = [];
    incoming.forEach((f) => {
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(fileExt(f.name))) {
        rejected.push(`"${f.name}": định dạng không được hỗ trợ`);
      } else if (f.size > MAX_ATTACHMENT_SIZE) {
        rejected.push(`"${f.name}": vượt quá 20MB`);
      } else if (
        !newFiles.some((x) => x.name === f.name && x.size === f.size) &&
        !accepted.some((x) => x.name === f.name && x.size === f.size)
      ) {
        accepted.push(f);
      }
    });
    if (accepted.length) setNewFiles((prev) => [...prev, ...accepted]);
    if (rejected.length) {
      setErrors((prev) => ({ ...prev, attachments: `Không thêm được ${rejected.join('; ')}.` }));
    } else {
      clearError('attachments');
    }
  };

  // ── Kiểm tra trước khi gửi (giống BE) ─────────────────────────────────
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!docDate) e.doc_date = 'Vui lòng chọn ngày đề nghị.';
    if (requesterMode === 'employee' && !employee) e.employee = 'Vui lòng chọn nhân viên đề nghị.';
    if (requesterMode === 'other' && !requesterName.trim()) e.employee = 'Vui lòng nhập tên người đề nghị.';
    if (!title.trim()) e.title = 'Vui lòng nhập nội dung.';
    if (itemsMode) {
      const rowErrors: string[] = [];
      items.forEach((r, idx) => {
        if (!isRowFilled(r)) return;
        const n = idx + 1;
        if (!r.name.trim()) rowErrors.push(`Dòng ${n}: thiếu tên mặt hàng.`);
        const q = parseFloat(r.quantity);
        if (!Number.isFinite(q) || q <= 0) rowErrors.push(`Dòng ${n}: số lượng phải lớn hơn 0.`);
        if (r.unitPrice === '') rowErrors.push(`Dòng ${n}: chưa nhập đơn giá.`);
      });
      if (rowErrors.length) e.items = rowErrors.join(' ');
      else if (itemsTotal <= 0) e.amount = 'Tổng thành tiền phải lớn hơn 0.';
    } else if (!(amountNum > 0)) {
      e.amount = 'Số tiền phải lớn hơn 0.';
    }
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setGeneralError(null);
    if (Object.keys(e).length) {
      setErrors((prev) => ({ ...(prev.attachments ? { attachments: prev.attachments } : {}), ...e }));
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setErrors({});

    const payload: PaymentDocumentPayload = {
      doc_type: docType,
      doc_date: docDate,
      employee: requesterMode === 'employee' && employee ? employee.id : null,
      requester_name: requesterMode === 'other' ? requesterName.trim() : '',
      // Tạo mới mà để trống → không gửi để BE tự lấy bộ phận của nhân viên.
      department: !isEdit && department === '' ? undefined : department === '' ? null : department,
      title: title.trim(),
      description: description.trim(),
      amount: effectiveAmount,
      payee: payee.trim(),
      payment_method: paymentMethod,
      bank_account: bankAccount.trim(),
      items: isPurchase
        ? filledItems.map((r) => ({
            name: r.name.trim(),
            unit: r.unit.trim(),
            quantity: parseFloat(r.quantity),
            unit_price: Number(r.unitPrice || 0),
          }))
        : [],
      due_date: dueDate || null,
      status,
      completed_date: status === 'COMPLETED' ? completedDate || null : null,
      settled_amount: isAdvance && settled !== '' ? settled : null,
      note: note.trim(),
    };

    setSaving(true);
    try {
      const saved = initial
        ? await paymentDocumentService.update(initial.id, payload, newFiles, removeIds)
        : await paymentDocumentService.create(payload, newFiles);
      onSaved(saved, !initial);
    } catch (err) {
      const parsed = await parseApiErrors(err);
      const fieldErrs: Record<string, string> = {};
      const general: string[] = [];
      Object.entries(parsed).forEach(([k, v]) => {
        if (KNOWN_FIELDS.has(k)) fieldErrs[k === 'requester_name' ? 'employee' : k] = v;
        else general.push(v);
      });
      setErrors(fieldErrs);
      setGeneralError(
        general.length
          ? general.join(' ')
          : Object.keys(fieldErrs).length
            ? 'Vui lòng kiểm tra lại các trường được đánh dấu.'
            : 'Lưu phiếu thất bại.'
      );
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const statusOptions: SelectOption<PaymentDocStatus>[] = STATUSES.map((s) => ({
    value: s,
    label: statusLabel(docType, s),
  }));
  const methodOptions: SelectOption<PaymentMethod>[] = [
    { value: '', label: '— Chưa chọn —' },
    { value: 'CASH', label: 'Tiền mặt' },
    { value: 'TRANSFER', label: 'Chuyển khoản' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-form-title"
        className="flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
              <DocumentTextIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="pd-form-title" className="truncate text-base font-bold text-gray-900">
                {isEdit ? 'Sửa phiếu' : 'Thêm phiếu'}
              </h2>
              {isEdit && <p className="truncate font-mono text-xs text-gray-500">{initial!.code}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Đóng"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {generalError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{generalError}</span>
            </div>
          )}

          {/* Loại phiếu */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Loại phiếu <Req />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DOC_TYPES.map((t) => {
                const active = t === docType;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    aria-pressed={active}
                    className={`rounded-xl border px-2 py-2 text-left transition-colors sm:px-3 ${
                      active ? TYPE_ACTIVE_CLS[t] : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="block text-xs font-semibold leading-tight sm:text-sm">{DOC_TYPE_LABELS[t]}</span>
                    <span className="mt-0.5 hidden text-xs opacity-70 sm:block">{TYPE_HINT[t]}</span>
                  </button>
                );
              })}
            </div>
            {isEdit && initial!.doc_type !== docType && (
              <p className="mt-1 text-xs text-amber-700">
                Đổi loại phiếu sẽ giữ nguyên mã {initial!.code}.
              </p>
            )}
            {errors.doc_type && <p className="mt-1 text-xs text-red-600">{errors.doc_type}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={<>Ngày đề nghị <Req /></>} error={errors.doc_date}>
              <input
                type="date"
                value={docDate}
                onChange={(e) => {
                  setDocDate(e.target.value);
                  clearError('doc_date');
                }}
                className={`input-field${errCls(errors.doc_date)}`}
              />
            </Field>
            <div>
              <SelectBox
                label="Bộ phận"
                value={department}
                options={departmentOptions}
                onChange={(v) => {
                  setDepartment(v);
                  clearError('department');
                }}
                searchable
                portal
                placeholder="Tìm bộ phận..."
              />
              {errors.department ? (
                <p className="mt-1 text-xs text-red-600">{errors.department}</p>
              ) : (
                requesterMode === 'employee' && (
                  <p className="mt-1 text-xs text-gray-500">Tự lấy theo người đề nghị, có thể đổi.</p>
                )
              )}
            </div>
          </div>

          {/* Người đề nghị */}
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700">
                Người đề nghị <Req />
              </label>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium">
                {(
                  [
                    ['employee', 'Nhân viên'],
                    ['other', 'Người ngoài / khác'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setRequesterMode(mode);
                      clearError('employee', 'requester_name');
                    }}
                    className={`rounded-md px-2.5 py-1 transition-colors ${
                      requesterMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {requesterMode === 'employee' ? (
              <EmployeePicker value={employee} onChange={handleEmployeeChange} invalid={!!errors.employee} />
            ) : (
              <input
                type="text"
                value={requesterName}
                maxLength={255}
                onChange={(e) => {
                  setRequesterName(e.target.value);
                  clearError('employee', 'requester_name');
                }}
                placeholder="Họ tên người đề nghị (không có trên hệ thống)"
                className={`input-field${errCls(errors.employee)}`}
              />
            )}
            {errors.employee && (
              <p className="mt-1 flex items-start gap-1 text-xs text-red-600">
                <ExclamationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{errors.employee}</span>
              </p>
            )}
          </div>

          <Field label={<>Nội dung <Req /></>} error={errors.title}>
            <input
              type="text"
              value={title}
              maxLength={255}
              onChange={(e) => {
                setTitle(e.target.value);
                clearError('title');
              }}
              placeholder={
                isPurchase
                  ? 'VD: Mua văn phòng phẩm tháng 10'
                  : isAdvance
                    ? 'VD: Tạm ứng công tác phí Hà Nội'
                    : 'VD: Thanh toán tiền điện tháng 9'
              }
              className={`input-field${errCls(errors.title)}`}
            />
          </Field>

          <Field label="Chi tiết" error={errors.description}>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Diễn giải thêm (nếu có)"
              className="input-field"
            />
          </Field>

          {/* Danh sách mặt hàng — chỉ Đề xuất mua hàng */}
          {isPurchase && (
            <div className="rounded-2xl border border-gray-200 p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Danh sách mặt hàng</p>
                  <p className="text-xs text-gray-500">
                    Có mặt hàng thì Số tiền = tổng thành tiền. Để trống nếu chỉ nhập tổng.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setItems((prev) => [...prev, newRow()])}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary-300 bg-white px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
                >
                  <PlusIcon className="h-4 w-4" />
                  Thêm dòng
                </button>
              </div>

              {items.length > 0 && (
                <>
                  <div className="hidden gap-2 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid sm:grid-cols-12">
                    <span className="col-span-4">Tên hàng</span>
                    <span className="col-span-1">ĐVT</span>
                    <span className="col-span-2 text-right">Số lượng</span>
                    <span className="col-span-2 text-right">Đơn giá</span>
                    <span className="col-span-2 text-right">Thành tiền</span>
                    <span className="col-span-1" />
                  </div>
                  <div className="space-y-2">
                    {items.map((r, idx) => (
                      <div
                        key={r.key}
                        className="relative grid grid-cols-6 gap-2 rounded-xl border border-gray-100 bg-gray-50/60 p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
                      >
                        <div className="col-span-6 pr-8 sm:col-span-4 sm:pr-0">
                          <label className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">
                            {idx + 1}. Tên hàng
                          </label>
                          <input
                            type="text"
                            value={r.name}
                            onChange={(e) => updateRow(r.key, { name: e.target.value })}
                            placeholder="Tên hàng"
                            aria-label={`Tên hàng dòng ${idx + 1}`}
                            className="input-field"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <label className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">ĐVT</label>
                          <input
                            type="text"
                            value={r.unit}
                            onChange={(e) => updateRow(r.key, { unit: e.target.value })}
                            placeholder="Cái"
                            aria-label={`Đơn vị tính dòng ${idx + 1}`}
                            className="input-field !px-2"
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <label className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">Số lượng</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.quantity}
                            onChange={(e) => updateRow(r.key, { quantity: sanitizeQuantity(e.target.value) })}
                            placeholder="0"
                            aria-label={`Số lượng dòng ${idx + 1}`}
                            className="input-field text-right tabular-nums"
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-2">
                          <label className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">Đơn giá</label>
                          <MoneyInput
                            value={r.unitPrice}
                            onChange={(v) => updateRow(r.key, { unitPrice: v })}
                            ariaLabel={`Đơn giá dòng ${idx + 1}`}
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-2">
                          <label className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">Thành tiền</label>
                          <div className="flex h-[38px] items-center justify-end rounded-lg bg-gray-100 px-2.5 text-sm font-semibold tabular-nums text-gray-800">
                            {formatVND(rowTotal(r)) || '0'}
                          </div>
                        </div>
                        <div className="absolute right-1.5 top-1.5 sm:static sm:col-span-1 sm:flex sm:justify-center">
                          <button
                            type="button"
                            onClick={() => {
                              setItems((prev) => prev.filter((x) => x.key !== r.key));
                              clearError('items', 'amount');
                            }}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Xoá dòng ${idx + 1}`}
                            title="Xoá dòng"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {items.length === 0 && (
                <p className="rounded-xl bg-gray-50 px-3 py-3 text-center text-xs text-gray-500">
                  Chưa có mặt hàng — nhập Số tiền tổng bên dưới hoặc bấm "Thêm dòng".
                </p>
              )}
              {errors.items && (
                <p className="mt-2 flex items-start gap-1 text-xs text-red-600">
                  <ExclamationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{errors.items}</span>
                </p>
              )}
              {itemsMode && (
                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
                  <span className="text-gray-600">Tổng cộng ({filledItems.length} mặt hàng)</span>
                  <span className="font-bold tabular-nums text-gray-900">{fmtMoney(itemsTotal)}</span>
                </div>
              )}
            </div>
          )}

          {/* Số tiền / hoàn ứng */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  {isAdvance ? 'Số tiền tạm ứng' : 'Số tiền'} <Req />
                </>
              }
              error={errors.amount}
              hint={itemsMode ? 'Tự tính từ danh sách mặt hàng.' : undefined}
            >
              <MoneyInput
                value={effectiveAmount}
                onChange={(v) => {
                  setAmount(v);
                  clearError('amount');
                }}
                disabled={itemsMode}
                invalid={!!errors.amount}
                placeholder="VD: 1.500.000"
              />
            </Field>
            {isAdvance && (
              <Field label="Đã hoàn ứng" error={errors.settled_amount}>
                <MoneyInput
                  value={settled}
                  onChange={(v) => {
                    setSettled(v);
                    clearError('settled_amount');
                  }}
                  invalid={!!errors.settled_amount}
                  placeholder="0"
                />
              </Field>
            )}
          </div>
          {isAdvance && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2 text-sm">
              <span className="text-orange-800">Còn phải hoàn ứng</span>
              <span className="font-bold tabular-nums text-orange-900">{fmtMoney(outstanding)}</span>
              {settledNum > amountNum && amountNum > 0 && (
                <span className="w-full text-xs text-orange-700">
                  Số đã hoàn ứng lớn hơn số tạm ứng {fmtMoney(settledNum - amountNum)}.
                </span>
              )}
            </div>
          )}

          {/* Thanh toán */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={PAYEE_LABELS[docType]} error={errors.payee} className="sm:col-span-2">
              <input
                type="text"
                value={payee}
                maxLength={255}
                onChange={(e) => {
                  setPayee(e.target.value);
                  clearError('payee');
                }}
                placeholder={isPurchase ? 'Tên nhà cung cấp' : 'Họ tên / tên đơn vị nhận tiền'}
                className={`input-field${errCls(errors.payee)}`}
              />
            </Field>
            <div>
              <SelectBox
                label="Hình thức thanh toán"
                value={paymentMethod}
                options={methodOptions}
                onChange={(v) => {
                  setPaymentMethod(v);
                  clearError('payment_method');
                }}
                portal
              />
              {errors.payment_method && <p className="mt-1 text-xs text-red-600">{errors.payment_method}</p>}
            </div>
            <Field label="Số TK / ngân hàng" error={errors.bank_account}>
              <input
                type="text"
                value={bankAccount}
                maxLength={255}
                onChange={(e) => {
                  setBankAccount(e.target.value);
                  clearError('bank_account');
                }}
                placeholder={paymentMethod === 'CASH' ? 'Không cần khi trả tiền mặt' : 'VD: 0123456789 - Vietcombank'}
                className={`input-field${errCls(errors.bank_account)}`}
              />
            </Field>
          </div>

          {/* Hạn & trạng thái */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={DUE_DATE_LABELS[docType]} error={errors.due_date}>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  clearError('due_date');
                }}
                className={`input-field${errCls(errors.due_date)}`}
              />
            </Field>
            <div>
              <SelectBox
                label="Trạng thái"
                value={status}
                options={statusOptions}
                onChange={handleStatusChange}
                portal
              />
              {errors.status && <p className="mt-1 text-xs text-red-600">{errors.status}</p>}
            </div>
            {status === 'COMPLETED' && (
              <Field
                label={COMPLETED_DATE_LABELS[docType]}
                error={errors.completed_date}
                hint="Để trống sẽ lấy ngày hôm nay."
                className="sm:col-start-2"
              >
                <input
                  type="date"
                  value={completedDate}
                  onChange={(e) => {
                    setCompletedDate(e.target.value);
                    clearError('completed_date');
                  }}
                  className={`input-field${errCls(errors.completed_date)}`}
                />
              </Field>
            )}
          </div>

          <Field label="Ghi chú" error={errors.note}>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú nội bộ HCNS"
              className="input-field"
            />
          </Field>

          {/* File đính kèm */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">File đính kèm (bản scan phiếu đã ký)</label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors ${
                dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50/50'
              }`}
            >
              <CloudArrowUpIcon className="mb-1 h-7 w-7 text-gray-400" />
              <p className="text-sm text-gray-700">
                <span className="font-medium text-primary-700">Chọn file</span> hoặc kéo thả vào đây
              </p>
              <p className="mt-0.5 text-xs text-gray-500">PDF, ảnh, Word, Excel, ZIP… tối đa 20MB/file</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_ATTACHMENT_EXTENSIONS.map((x) => `.${x}`).join(',')}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {errors.attachments && (
              <p className="mt-1 flex items-start gap-1 text-xs text-red-600">
                <ExclamationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{errors.attachments}</span>
              </p>
            )}

            {(existingFiles.length > 0 || newFiles.length > 0) && (
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {existingFiles.map((f) => {
                  const removed = removeIds.includes(f.id);
                  return (
                    <li key={`old-${f.id}`} className="flex items-center gap-2 px-3 py-2">
                      <PaperClipIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        {f.file_url && !removed ? (
                          <a
                            href={f.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-sm text-primary-700 hover:underline"
                            title={f.file_name}
                          >
                            {f.file_name}
                          </a>
                        ) : (
                          <span
                            className={`block truncate text-sm ${removed ? 'text-gray-400 line-through' : 'text-gray-700'}`}
                            title={f.file_name}
                          >
                            {f.file_name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {removed ? 'Sẽ xoá khi lưu' : `Tải lên ${fmtDateTime(f.uploaded_at).slice(0, 10)}`}
                        </span>
                      </div>
                      {removed ? (
                        <button
                          type="button"
                          onClick={() => setRemoveIds((prev) => prev.filter((id) => id !== f.id))}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                        >
                          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                          Hoàn tác
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRemoveIds((prev) => [...prev, f.id])}
                          className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Xoá file ${f.file_name}`}
                          title="Xoá file"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
                {newFiles.map((f, i) => (
                  <li key={`new-${i}-${f.name}`} className="flex items-center gap-2 bg-emerald-50/50 px-3 py-2">
                    <PaperClipIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-800" title={f.name}>
                        {f.name}
                      </span>
                      <span className="text-xs text-emerald-700">Mới · {fmtFileSize(f.size)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Bỏ file ${f.name}`}
                      title="Bỏ file"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50 px-4 py-3 sm:px-6 sm:py-4">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary disabled:opacity-50">
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-60"
          >
            {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-b-transparent" />}
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu thay đổi' : 'Thêm phiếu'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PaymentDocumentFormModal;
