import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PlusIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PencilSquareIcon,
  TrashIcon,
  PaperClipIcon,
  XMarkIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import Pagination from '../Pagination';
import ConfirmDialog from '../ConfirmDialog';
import { SelectBox } from '../LandingLayout/SelectBox';
import type { SelectOption } from '../LandingLayout/SelectBox';
import { useDebounce } from '../../hooks/useDebounce';
import paymentDocumentService, {
  COMPLETED_LABELS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  parseApiErrors,
} from '../../services/paymentDocument.service';
import type {
  PaymentDocType,
  PaymentDocStatus,
  PaymentDocument,
  PaymentDocumentFilters,
  PaymentDocumentSummary,
} from '../../services/paymentDocument.service';
import PaymentDocumentFormModal from './PaymentDocumentFormModal';
import PaymentDocumentDetailModal from './PaymentDocumentDetailModal';
import { StatusBadge, TypeBadge, fmtDate, fmtDateTime, fmtMoney } from './shared';

type ReviewedFilter = '' | 'true' | 'false';

const TYPE_DOT: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'bg-sky-500',
  PURCHASE_PROPOSAL: 'bg-violet-500',
  EXPENSE_ADVANCE: 'bg-orange-500',
};

const TYPE_CARD_BORDER: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'border-l-sky-500',
  PURCHASE_PROPOSAL: 'border-l-violet-500',
  EXPENSE_ADVANCE: 'border-l-orange-500',
};

const MONTH_OPTIONS: SelectOption<number>[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Tháng ${i + 1}` })),
  { value: 0, label: 'Cả năm' },
];

const errorText = async (err: unknown) => Object.values(await parseApiErrors(err)).join(' ');

// ── Nút bật/tắt "Đã rà soát" ──────────────────────────────────────────────
const ReviewToggle: React.FC<{ doc: PaymentDocument; busy: boolean; compact?: boolean; onToggle: () => void }> = ({
  doc,
  busy,
  compact = false,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={busy}
    aria-pressed={doc.reviewed}
    title={
      doc.reviewed
        ? `Rà soát bởi ${doc.reviewed_by_name || '—'} lúc ${fmtDateTime(doc.reviewed_at)} — bấm để bỏ`
        : 'Bấm để đánh dấu đã rà soát'
    }
    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
      doc.reviewed
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        : 'border-dashed border-gray-300 bg-white text-gray-500 hover:border-emerald-400 hover:text-emerald-700'
    }`}
  >
    {busy ? (
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-b-transparent" />
    ) : doc.reviewed ? (
      <CheckCircleSolidIcon className="h-4 w-4" />
    ) : (
      <CheckCircleIcon className="h-4 w-4" />
    )}
    {compact ? (doc.reviewed ? 'Đã' : 'Chưa') : doc.reviewed ? 'Đã rà soát' : 'Chưa rà soát'}
  </button>
);

const PaymentDocumentsTab: React.FC = () => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // ── Bộ lọc ──────────────────────────────────────────────────────────────
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth); // 0 = cả năm
  const [docType, setDocType] = useState<PaymentDocType | ''>('');
  const [status, setStatus] = useState<PaymentDocStatus | ''>('');
  const [reviewed, setReviewed] = useState<ReviewedFilter>('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ── Dữ liệu ─────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<PaymentDocument[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PaymentDocumentSummary | null>(null);
  const [unreviewedInFilter, setUnreviewedInFilter] = useState(0);

  // ── Thao tác ────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [formTarget, setFormTarget] = useState<PaymentDocument | null | undefined>(undefined);
  const [detailDoc, setDetailDoc] = useState<PaymentDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmReviewAll, setConfirmReviewAll] = useState(false);

  const monthParam = month > 0 ? `${year}-${String(month).padStart(2, '0')}` : '';
  const periodLabel = month > 0 ? `tháng ${month}/${year}` : `năm ${year}`;

  /** Bộ lọc cho thẻ tổng hợp + số đếm chip: mọi thứ trừ loại phiếu */
  const baseFilters = useMemo<PaymentDocumentFilters>(
    () => ({
      month: monthParam || undefined,
      year: monthParam ? undefined : year,
      status,
      reviewed: reviewed === '' ? '' : reviewed === 'true',
      search: debouncedSearch,
    }),
    [monthParam, year, status, reviewed, debouncedSearch]
  );
  const listFilters = useMemo<PaymentDocumentFilters>(() => ({ ...baseFilters, doc_type: docType }), [baseFilters, docType]);

  const listReq = useRef(0);
  const fetchList = useCallback(async () => {
    const reqId = ++listReq.current;
    setLoading(true);
    try {
      const [data, unrev] = await Promise.all([
        paymentDocumentService.list(listFilters, page, pageSize),
        reviewed === '' ? paymentDocumentService.list({ ...listFilters, reviewed: false }, 1, 1) : Promise.resolve(null),
      ]);
      if (reqId !== listReq.current) return;
      setDocs(data.results || []);
      setCount(data.count || 0);
      setUnreviewedInFilter(reviewed === 'false' ? data.count || 0 : unrev ? unrev.count || 0 : 0);
      setLoadError(null);
    } catch (err) {
      if (reqId !== listReq.current) return;
      setLoadError(await errorText(err));
      setDocs([]);
      setCount(0);
    } finally {
      if (reqId === listReq.current) setLoading(false);
    }
  }, [listFilters, page, pageSize, reviewed]);

  const summaryReq = useRef(0);
  const fetchSummary = useCallback(async () => {
    const reqId = ++summaryReq.current;
    try {
      const data = await paymentDocumentService.summary(baseFilters);
      if (reqId === summaryReq.current) setSummary(data);
    } catch {
      if (reqId === summaryReq.current) setSummary(null);
    }
  }, [baseFilters]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    setSelected(new Set());
  }, [listFilters, page, pageSize]);

  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const refreshAll = () => {
    fetchList();
    fetchSummary();
  };

  // ── Đổi bộ lọc ──────────────────────────────────────────────────────────
  const shiftPeriod = (delta: number) => {
    if (month === 0) {
      setYear((y) => y + delta);
    } else {
      const idx = year * 12 + (month - 1) + delta;
      setYear(Math.floor(idx / 12));
      setMonth((idx % 12) + 1);
    }
    setPage(1);
  };

  const hasFilter =
    docType !== '' || status !== '' || reviewed !== '' || search !== '' || month !== currentMonth || year !== currentYear;

  const resetFilters = () => {
    setDocType('');
    setStatus('');
    setReviewed('');
    setSearch('');
    setMonth(currentMonth);
    setYear(currentYear);
    setPage(1);
  };

  const yearOptions = useMemo<SelectOption<number>[]>(() => {
    const ys = Array.from({ length: 7 }, (_, i) => currentYear + 1 - i);
    if (!ys.includes(year)) ys.push(year);
    return ys.sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }));
  }, [currentYear, year]);

  const statusOptions: SelectOption<PaymentDocStatus | ''>[] = [
    { value: '', label: 'Tất cả trạng thái' },
    { value: 'PENDING', label: 'Chờ xử lý' },
    { value: 'COMPLETED', label: docType ? COMPLETED_LABELS[docType] : 'Hoàn tất (đã TT / mua / hoàn ứng)' },
    { value: 'CANCELLED', label: 'Huỷ' },
  ];

  // ── Rà soát ─────────────────────────────────────────────────────────────
  const toggleReview = async (doc: PaymentDocument) => {
    if (busyIds.has(doc.id)) return;
    setBusyIds((prev) => new Set(prev).add(doc.id));
    try {
      const updated = await paymentDocumentService.review(doc.id, !doc.reviewed);
      setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setDetailDoc((prev) => (prev && prev.id === updated.id ? updated : prev));
      if (reviewed !== '') {
        // Phiếu không còn khớp bộ lọc "Chưa/Đã rà soát" → tải lại danh sách
        fetchList();
      } else {
        setUnreviewedInFilter((n) => Math.max(0, n + (updated.reviewed ? -1 : 1)));
      }
      fetchSummary();
    } catch (err) {
      setNotice({ kind: 'error', text: `Không cập nhật được rà soát: ${await errorText(err)}` });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const reviewedNotice = (n: number, value: boolean) =>
    value
      ? n > 0
        ? `Đã đánh dấu rà soát ${n} phiếu.`
        : 'Các phiếu đã chọn đều đã được rà soát trước đó.'
      : `Đã bỏ rà soát ${n} phiếu.`;

  const bulkReview = async (ids: number[], value: boolean) => {
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const res = await paymentDocumentService.reviewBulk(ids, value);
      setNotice({ kind: 'success', text: reviewedNotice(res?.updated ?? 0, value) });
      setSelected(new Set());
      refreshAll();
    } catch (err) {
      setNotice({ kind: 'error', text: `Không cập nhật được rà soát: ${await errorText(err)}` });
    } finally {
      setBulkBusy(false);
    }
  };

  /** Đánh dấu đã rà soát mọi phiếu (mọi trang) khớp bộ lọc hiện tại. */
  const reviewAllInFilter = async () => {
    setBulkBusy(true);
    try {
      const ids = await paymentDocumentService.listAllIds({ ...listFilters, reviewed: false });
      if (ids.length) {
        const res = await paymentDocumentService.reviewBulk(ids, true);
        setNotice({ kind: 'success', text: reviewedNotice(res?.updated ?? 0, true) });
      } else {
        setNotice({ kind: 'success', text: 'Không còn phiếu nào chưa rà soát theo bộ lọc hiện tại.' });
      }
      setSelected(new Set());
      refreshAll();
    } catch (err) {
      setNotice({ kind: 'error', text: `Không cập nhật được rà soát: ${await errorText(err)}` });
    } finally {
      setBulkBusy(false);
      setConfirmReviewAll(false);
    }
  };

  // ── Xuất Excel / xoá / lưu ──────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await paymentDocumentService.exportExcel(listFilters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setNotice({ kind: 'error', text: `Xuất Excel thất bại: ${await errorText(err)}` });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await paymentDocumentService.remove(deleteTarget.id);
      setNotice({ kind: 'success', text: `Đã xoá phiếu ${deleteTarget.code}.` });
      setDeleteTarget(null);
      if (docs.length === 1 && page > 1) setPage(page - 1);
      else fetchList();
      fetchSummary();
    } catch (err) {
      setDeleteTarget(null);
      setNotice({ kind: 'error', text: `Xoá phiếu thất bại: ${await errorText(err)}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleSaved = (doc: PaymentDocument, isNew: boolean) => {
    setFormTarget(undefined);
    const inPeriod = monthParam ? doc.doc_date.startsWith(monthParam) : doc.doc_date.startsWith(String(year));
    setNotice({
      kind: 'success',
      text: `${isNew ? 'Đã thêm' : 'Đã lưu'} phiếu ${doc.code}.${
        inPeriod ? '' : ` Ngày đề nghị ${fmtDate(doc.doc_date)} nằm ngoài ${periodLabel} đang xem.`
      }`,
    });
    refreshAll();
  };

  // ── Chọn nhiều ──────────────────────────────────────────────────────────
  const pageIds = docs.map((d) => d.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));
  const toggleSelectAll = () =>
    setSelected(allOnPageSelected ? new Set() : new Set(pageIds));
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const typeSummary = (t: PaymentDocType) => summary?.by_type.find((b) => b.doc_type === t);
  const advanceSummary = typeSummary('EXPENSE_ADVANCE');
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  const checkboxCls = 'h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer';

  const iconBtn = 'rounded-lg border bg-white p-1.5 transition-colors';
  const renderIconActions = (doc: PaymentDocument) => (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setDetailDoc(doc)}
        className={`${iconBtn} border-gray-300 text-gray-600 hover:bg-gray-50`}
        title="Xem"
        aria-label={`Xem phiếu ${doc.code}`}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setFormTarget(doc)}
        className={`${iconBtn} border-primary-200 text-primary-700 hover:bg-primary-50`}
        title="Sửa"
        aria-label={`Sửa phiếu ${doc.code}`}
      >
        <PencilSquareIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setDeleteTarget(doc)}
        className={`${iconBtn} border-red-200 text-red-600 hover:bg-red-50`}
        title="Xoá"
        aria-label={`Xoá phiếu ${doc.code}`}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );

  const renderActions = (doc: PaymentDocument) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setDetailDoc(doc)}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <EyeIcon className="h-3.5 w-3.5" />
        Xem
      </button>
      <button
        type="button"
        onClick={() => setFormTarget(doc)}
        className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-white px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
      >
        <PencilSquareIcon className="h-3.5 w-3.5" />
        Sửa
      </button>
      <button
        type="button"
        onClick={() => setDeleteTarget(doc)}
        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        <TrashIcon className="h-3.5 w-3.5" />
        Xoá
      </button>
    </div>
  );

  const requesterOf = (doc: PaymentDocument) => doc.employee_name || doc.requester_display || doc.requester_name || '—';

  const emptyText = `Chưa có phiếu nào trong ${periodLabel}${
    docType || status || reviewed || debouncedSearch ? ' khớp với bộ lọc' : ''
  }.`;

  return (
    <div className="space-y-5">
      {/* Tiêu đề + nút chính */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Thanh toán & mua hàng</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Lưu phiếu đề nghị thanh toán, đề xuất mua hàng, đề nghị tạm ứng (kèm bản scan) và rà soát hằng tháng.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || count === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          >
            {exporting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-b-transparent" />
            ) : (
              <ArrowDownTrayIcon className="h-4 w-4" />
            )}
            {exporting ? 'Đang xuất...' : 'Xuất Excel'}
          </button>
          <button type="button" onClick={() => setFormTarget(null)} className="btn-primary flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />
            Thêm phiếu
          </button>
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'border-red-100 bg-red-50 text-red-700'
              : 'border-emerald-100 bg-emerald-50 text-emerald-800'
          }`}
        >
          <span className="flex items-start gap-2">
            {notice.kind === 'error' ? (
              <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Đóng thông báo"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bộ lọc */}
      <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-sm font-medium text-gray-700">Kỳ (theo ngày đề nghị)</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftPeriod(-1)}
                className="shrink-0 rounded-lg border border-gray-300 bg-white p-2 text-gray-600 shadow-sm hover:bg-gray-50"
                aria-label={month ? 'Tháng trước' : 'Năm trước'}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
                <SelectBox
                  label=""
                  value={month}
                  options={MONTH_OPTIONS}
                  onChange={(v) => {
                    setMonth(Number(v));
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-28 shrink-0 sm:w-24">
                <SelectBox
                  label=""
                  value={year}
                  options={yearOptions}
                  onChange={(v) => {
                    setYear(Number(v));
                    setPage(1);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => shiftPeriod(1)}
                className="shrink-0 rounded-lg border border-gray-300 bg-white p-2 text-gray-600 shadow-sm hover:bg-gray-50"
                aria-label={month ? 'Tháng sau' : 'Năm sau'}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="w-full sm:w-56">
            <SelectBox
              label="Trạng thái"
              value={status}
              options={statusOptions}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            />
          </div>

          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-sm font-medium text-gray-700">Rà soát</label>
            <div className="grid grid-cols-3 rounded-lg border border-gray-300 bg-white p-0.5 text-sm shadow-sm sm:inline-grid">
              {(
                [
                  ['', 'Tất cả'],
                  ['false', 'Chưa rà soát'],
                  ['true', 'Đã rà soát'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val || 'all'}
                  type="button"
                  aria-pressed={reviewed === val}
                  onClick={() => {
                    setReviewed(val);
                    setPage(1);
                  }}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                    reviewed === val ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-sm font-medium text-gray-700">Tìm kiếm</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Mã phiếu, nội dung, người đề nghị..."
                className="input-field w-full pl-9 sm:w-64"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {hasFilter && (
              <button type="button" onClick={resetFilters} className="btn-secondary">
                Xoá bộ lọc
              </button>
            )}
            <button
              type="button"
              onClick={refreshAll}
              disabled={loading}
              className="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
          </div>
        </div>

        {/* Chip loại phiếu */}
        <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-3">
          <button
            type="button"
            aria-pressed={docType === ''}
            onClick={() => {
              setDocType('');
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              docType === ''
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Tất cả loại
            <span
              className={`rounded-full px-1.5 text-xs font-semibold ${
                docType === '' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {summary?.total_count ?? '…'}
            </span>
          </button>
          {DOC_TYPES.map((t) => {
            const active = docType === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setDocType(active ? '' : t);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${TYPE_DOT[t]}`} />
                {DOC_TYPE_LABELS[t]}
                <span
                  className={`rounded-full px-1.5 text-xs font-semibold ${
                    active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {typeSummary(t)?.count ?? '…'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thẻ tổng hợp */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-gray-100 border-l-4 border-l-primary-500 bg-white p-3 shadow-sm sm:p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Tổng tiền {periodLabel}</p>
          <p className="mt-1 break-words text-base font-extrabold tabular-nums text-primary-700 sm:text-lg">
            {summary ? fmtMoney(summary.total_amount) : '…'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary ? `${summary.total_count} phiếu · không tính phiếu huỷ` : ' '}
          </p>
        </div>
        {DOC_TYPES.map((t) => {
          const s = typeSummary(t);
          const active = docType === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setDocType(active ? '' : t);
                setPage(1);
              }}
              className={`rounded-2xl border border-l-4 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md sm:p-4 ${
                TYPE_CARD_BORDER[t]
              } ${active ? 'border-primary-300 ring-2 ring-primary-200' : 'border-gray-100'}`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{DOC_TYPE_LABELS[t]}</p>
              <p className="mt-1 break-words text-base font-extrabold tabular-nums text-gray-900 sm:text-lg">
                {s ? fmtMoney(s.amount) : '…'}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {s ? `${s.count} phiếu${s.pending ? ` · ${s.pending} chờ xử lý` : ''}` : ' '}
              </p>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setReviewed(reviewed === 'false' ? '' : 'false');
            setPage(1);
          }}
          className={`rounded-2xl border border-l-4 border-l-amber-500 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md sm:p-4 ${
            reviewed === 'false' ? 'border-primary-300 ring-2 ring-primary-200' : 'border-gray-100'
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Chưa rà soát</p>
          <p
            className={`mt-1 text-lg font-extrabold tabular-nums sm:text-xl ${
              summary && summary.unreviewed_count > 0 ? 'text-amber-600' : 'text-gray-900'
            }`}
          >
            {summary ? summary.unreviewed_count : '…'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary ? `Đã rà soát ${summary.reviewed_count}/${summary.total_count}` : ' '}
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            setDocType(docType === 'EXPENSE_ADVANCE' ? '' : 'EXPENSE_ADVANCE');
            setPage(1);
          }}
          className="rounded-2xl border border-gray-100 border-l-4 border-l-red-400 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md sm:p-4"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Tạm ứng chưa hoàn</p>
          <p
            className={`mt-1 break-words text-base font-extrabold tabular-nums sm:text-lg ${
              Number(advanceSummary?.outstanding || 0) > 0 ? 'text-red-600' : 'text-gray-900'
            }`}
          >
            {advanceSummary ? fmtMoney(advanceSummary.outstanding || 0) : '…'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {advanceSummary ? `${advanceSummary.pending} phiếu chờ hoàn ứng` : ' '}
          </p>
        </button>
      </div>

      {/* Thanh công cụ danh sách */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 sm:hidden">
            <input
              type="checkbox"
              className={checkboxCls}
              checked={allOnPageSelected}
              ref={(el) => {
                if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
              }}
              onChange={toggleSelectAll}
              disabled={docs.length === 0}
            />
            Chọn trang
          </label>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{count}</span> phiếu
            {unreviewedInFilter > 0 && (
              <span className="text-amber-700"> · {unreviewedInFilter} chưa rà soát</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmReviewAll(true)}
          disabled={bulkBusy || unreviewedInFilter === 0 || loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          title="Đánh dấu đã rà soát mọi phiếu khớp bộ lọc hiện tại (mọi trang)"
        >
          <CheckCircleIcon className="h-4 w-4" />
          Rà soát tất cả theo bộ lọc
          {unreviewedInFilter > 0 && ` (${unreviewedInFilter})`}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2">
          <span className="text-sm font-medium text-primary-800">Đã chọn {selected.size} phiếu</span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkReview(Array.from(selected), true)}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <CheckCircleIcon className="h-4 w-4" />
              Đánh dấu đã rà soát
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkReview(Array.from(selected), false)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Bỏ rà soát
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-white"
            >
              Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {loadError ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-10 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-500">
            <ExclamationCircleIcon className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-gray-900">Không tải được danh sách phiếu</p>
          <p className="mt-1 text-xs text-gray-500">{loadError}</p>
          <button type="button" onClick={refreshAll} className="btn-primary mt-4">
            Thử lại
          </button>
        </div>
      ) : (
        <>
          {/* Điện thoại: dạng thẻ */}
          <div className="space-y-3 sm:hidden">
            {loading && docs.length === 0 ? (
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-10 text-center text-gray-500 shadow-sm">
                Đang tải...
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-10 text-center text-sm text-gray-500 shadow-sm">
                {emptyText}
              </div>
            ) : (
              docs.map((doc) => (
                <div
                  key={doc.id}
                  className={`rounded-2xl border bg-white p-4 shadow-sm ${
                    selected.has(doc.id) ? 'border-primary-300 ring-1 ring-primary-200' : 'border-gray-100'
                  } ${loading ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className={`${checkboxCls} mt-1 shrink-0`}
                      checked={selected.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      aria-label={`Chọn phiếu ${doc.code}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-500">{doc.code}</span>
                        <StatusBadge type={doc.doc_type} status={doc.status} label={doc.status_display} />
                      </div>
                      <p className="mt-1 break-words font-semibold text-gray-900">{doc.title}</p>
                      <p className="mt-0.5 break-words text-xs text-gray-500">
                        {requesterOf(doc)}
                        {doc.department_name ? ` · ${doc.department_name}` : ''}
                      </p>
                      <TypeBadge type={doc.doc_type} className="mt-1.5" />
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-gray-500">Số tiền</dt>
                      <dd className="font-semibold tabular-nums text-gray-900">{fmtMoney(doc.amount)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Ngày đề nghị</dt>
                      <dd className="text-gray-800">{fmtDate(doc.doc_date)}</dd>
                    </div>
                    {doc.doc_type === 'EXPENSE_ADVANCE' && doc.outstanding_amount !== null && (
                      <div className="col-span-2">
                        <dt className="text-xs text-gray-500">Còn phải hoàn ứng</dt>
                        <dd
                          className={`tabular-nums ${
                            Number(doc.outstanding_amount) > 0 ? 'font-semibold text-orange-700' : 'text-gray-800'
                          }`}
                        >
                          {fmtMoney(doc.outstanding_amount)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                    <ReviewToggle doc={doc} busy={busyIds.has(doc.id)} onToggle={() => toggleReview(doc)} />
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${
                        doc.attachments?.length ? 'text-gray-600' : 'text-amber-600'
                      }`}
                      title={doc.attachments?.length ? `${doc.attachments.length} file đính kèm` : 'Chưa có file scan'}
                    >
                      <PaperClipIcon className="h-4 w-4" />
                      {doc.attachments?.length || 0}
                    </span>
                  </div>
                  <div className="mt-2 [&_button]:px-3 [&_button]:py-1.5">{renderActions(doc)}</div>
                </div>
              ))
            )}
          </div>

          {/* Máy tính: dạng bảng */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm sm:block">
            <div className="w-full overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header !px-3 w-10">
                      <input
                        type="checkbox"
                        className={checkboxCls}
                        checked={allOnPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                        }}
                        onChange={toggleSelectAll}
                        disabled={docs.length === 0}
                        aria-label="Chọn tất cả phiếu trên trang"
                      />
                    </th>
                    {['Mã phiếu', 'Loại', 'Ngày đề nghị', 'Người đề nghị', 'Nội dung'].map((h) => (
                      <th key={h} className="table-header !px-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                    <th className="table-header !px-3 whitespace-nowrap !text-right">Số tiền</th>
                    {['Trạng thái', 'Rà soát', 'File', 'Thao tác'].map((h) => (
                      <th key={h} className="table-header !px-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y divide-gray-100 bg-white ${loading && docs.length > 0 ? 'opacity-60' : ''}`}>
                  {loading && docs.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                        Đang tải...
                      </td>
                    </tr>
                  ) : docs.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-500">
                            <DocumentTextIcon className="h-6 w-6" />
                          </div>
                          <p className="text-sm text-gray-500">{emptyText}</p>
                          <button
                            type="button"
                            onClick={() => setFormTarget(null)}
                            className="btn-primary flex items-center gap-1.5"
                          >
                            <PlusIcon className="h-4 w-4" />
                            Thêm phiếu
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    docs.map((doc) => (
                      <tr
                        key={doc.id}
                        className={`transition-colors hover:bg-gray-50 ${selected.has(doc.id) ? 'bg-primary-50/50' : ''}`}
                      >
                        <td className="table-cell !px-3">
                          <input
                            type="checkbox"
                            className={checkboxCls}
                            checked={selected.has(doc.id)}
                            onChange={() => toggleSelect(doc.id)}
                            aria-label={`Chọn phiếu ${doc.code}`}
                          />
                        </td>
                        <td className="table-cell !px-3">
                          <button
                            type="button"
                            onClick={() => setDetailDoc(doc)}
                            className="font-mono text-xs text-primary-700 hover:underline"
                          >
                            {doc.code}
                          </button>
                        </td>
                        <td className="table-cell !px-3">
                          <TypeBadge type={doc.doc_type} short />
                        </td>
                        <td className="table-cell !px-3 text-gray-600">{fmtDate(doc.doc_date)}</td>
                        <td className="table-cell !px-3">
                          <div className="max-w-[160px] truncate font-medium text-gray-900" title={requesterOf(doc)}>
                            {requesterOf(doc)}
                          </div>
                          <div
                            className="max-w-[160px] truncate text-xs text-gray-500"
                            title={doc.department_name || undefined}
                          >
                            {doc.employee_code ? <span className="font-mono">{doc.employee_code}</span> : null}
                            {doc.employee_code && doc.department_name ? ' · ' : ''}
                            {doc.department_name || (!doc.employee_code ? '—' : '')}
                          </div>
                        </td>
                        <td className="table-cell !px-3">
                          <div className="max-w-[220px] truncate text-gray-900" title={doc.title}>
                            {doc.title}
                          </div>
                          {doc.payee && (
                            <div className="max-w-[220px] truncate text-xs text-gray-500" title={doc.payee}>
                              → {doc.payee}
                            </div>
                          )}
                        </td>
                        <td className="table-cell !px-3 text-right">
                          <div className="font-semibold tabular-nums text-gray-900">{fmtMoney(doc.amount)}</div>
                          {doc.doc_type === 'EXPENSE_ADVANCE' && Number(doc.outstanding_amount || 0) > 0 && (
                            <div className="text-xs tabular-nums text-orange-700">
                              Còn {fmtMoney(doc.outstanding_amount)}
                            </div>
                          )}
                        </td>
                        <td className="table-cell !px-3">
                          <StatusBadge type={doc.doc_type} status={doc.status} label={doc.status_display} />
                          {doc.status === 'COMPLETED' && doc.completed_date && (
                            <div className="mt-0.5 text-xs text-gray-500">{fmtDate(doc.completed_date)}</div>
                          )}
                        </td>
                        <td className="table-cell !px-3">
                          <ReviewToggle doc={doc} busy={busyIds.has(doc.id)} compact onToggle={() => toggleReview(doc)} />
                        </td>
                        <td className="table-cell !px-3">
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${
                              doc.attachments?.length ? 'text-gray-600' : 'text-amber-600'
                            }`}
                            title={doc.attachments?.length ? `${doc.attachments.length} file đính kèm` : 'Chưa có file scan'}
                          >
                            <PaperClipIcon className="h-4 w-4" />
                            {doc.attachments?.length || 0}
                          </span>
                        </td>
                        <td className="table-cell !px-3">{renderIconActions(doc)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={count}
              itemsPerPage={pageSize}
              onPageChange={(p: number) => setPage(p)}
              onItemsPerPageChange={(size: number) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </>
      )}

      {formTarget !== undefined && (
        <PaymentDocumentFormModal
          initial={formTarget}
          defaultType={docType || undefined}
          onClose={() => setFormTarget(undefined)}
          onSaved={handleSaved}
        />
      )}

      {detailDoc && (
        <PaymentDocumentDetailModal
          doc={detailDoc}
          reviewBusy={busyIds.has(detailDoc.id)}
          onClose={() => setDetailDoc(null)}
          onEdit={() => {
            const d = detailDoc;
            setDetailDoc(null);
            setFormTarget(d);
          }}
          onToggleReview={() => toggleReview(detailDoc)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        variant="danger"
        title="Xoá phiếu"
        message={
          deleteTarget
            ? `Xoá phiếu ${deleteTarget.code} — "${deleteTarget.title}"?\nPhiếu sẽ không còn hiện trong danh sách và báo cáo.`
            : ''
        }
        confirmLabel="Xoá"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={confirmReviewAll}
        variant="info"
        title="Rà soát tất cả theo bộ lọc"
        message={`Đánh dấu "Đã rà soát" cho ${unreviewedInFilter} phiếu chưa rà soát trong ${periodLabel}${
          docType ? ` (${DOC_TYPE_LABELS[docType]})` : ''
        }${status || debouncedSearch ? ' khớp bộ lọc hiện tại' : ''}, ở mọi trang?`}
        confirmLabel="Đánh dấu đã rà soát"
        loading={bulkBusy}
        onConfirm={reviewAllInFilter}
        onClose={() => setConfirmReviewAll(false)}
      />
    </div>
  );
};

export default PaymentDocumentsTab;
