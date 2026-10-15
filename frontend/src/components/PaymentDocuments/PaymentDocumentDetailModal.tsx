import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon,
  PencilSquareIcon,
  PaperClipIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import {
  COMPLETED_DATE_LABELS,
  DUE_DATE_LABELS,
  PAYEE_LABELS,
  formatVND,
} from '../../services/paymentDocument.service';
import type { PaymentDocument } from '../../services/paymentDocument.service';
import { StatusBadge, TypeBadge, fmtDate, fmtDateTime, fmtMoney } from './shared';

interface Props {
  doc: PaymentDocument;
  reviewBusy?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleReview: () => void;
}

const Item: React.FC<{ label: string; full?: boolean; children: React.ReactNode }> = ({ label, full, children }) => (
  <div className={full ? 'sm:col-span-2' : ''}>
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd className="mt-0.5 text-sm text-gray-900 break-words">{children}</dd>
  </div>
);

const Empty = () => <span className="text-gray-400">—</span>;

const PaymentDocumentDetailModal: React.FC<Props> = ({ doc, reviewBusy, onClose, onEdit, onToggleReview }) => {
  useLockBodyScroll(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isPurchase = doc.doc_type === 'PURCHASE_PROPOSAL';
  const isAdvance = doc.doc_type === 'EXPENSE_ADVANCE';
  const items = doc.items || [];
  const requester = doc.employee_name || doc.requester_display || doc.requester_name;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-detail-title"
        className="flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
              <DocumentTextIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="pd-detail-title" className="font-mono text-sm font-bold text-gray-900 break-all">
                {doc.code}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={doc.doc_type} />
                <StatusBadge type={doc.doc_type} status={doc.status} label={doc.status_display} />
                {doc.reviewed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    Đã rà soát
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Đóng"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          <div>
            <p className="text-base font-semibold text-gray-900 break-words">{doc.title}</p>
            {doc.description && (
              <p className="mt-1 whitespace-pre-line text-sm text-gray-600 break-words">{doc.description}</p>
            )}
          </div>

          <div className="rounded-2xl bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">{isAdvance ? 'Số tiền tạm ứng' : 'Số tiền'}</p>
            <p className="text-xl font-extrabold tabular-nums text-gray-900">{fmtMoney(doc.amount)}</p>
            {isAdvance && (
              <div className="mt-2 grid grid-cols-2 gap-3 border-t border-gray-200 pt-2">
                <div>
                  <p className="text-xs text-gray-500">Đã hoàn ứng</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-800">{fmtMoney(doc.settled_amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Còn phải hoàn ứng</p>
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      Number(doc.outstanding_amount || 0) > 0 ? 'text-orange-700' : 'text-gray-800'
                    }`}
                  >
                    {doc.outstanding_amount === null ? '—' : fmtMoney(doc.outstanding_amount)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="Ngày đề nghị">{fmtDate(doc.doc_date)}</Item>
            <Item label="Người đề nghị">
              {requester || <Empty />}
              {doc.employee_code && <span className="ml-1 font-mono text-xs text-gray-500">({doc.employee_code})</span>}
            </Item>
            <Item label="Bộ phận">{doc.department_name || <Empty />}</Item>
            <Item label={PAYEE_LABELS[doc.doc_type]}>{doc.payee || <Empty />}</Item>
            <Item label="Hình thức thanh toán">{doc.payment_method_display || <Empty />}</Item>
            <Item label="Số TK / ngân hàng">{doc.bank_account || <Empty />}</Item>
            <Item label={DUE_DATE_LABELS[doc.doc_type]}>{doc.due_date ? fmtDate(doc.due_date) : <Empty />}</Item>
            {doc.status === 'COMPLETED' && (
              <Item label={COMPLETED_DATE_LABELS[doc.doc_type]}>
                {doc.completed_date ? fmtDate(doc.completed_date) : <Empty />}
              </Item>
            )}
            {doc.note && (
              <Item label="Ghi chú" full>
                <span className="whitespace-pre-line">{doc.note}</span>
              </Item>
            )}
          </dl>

          {isPurchase && items.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">Danh sách mặt hàng</p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">Tên hàng</th>
                      <th className="px-3 py-2 text-left font-semibold">ĐVT</th>
                      <th className="px-3 py-2 text-right font-semibold">SL</th>
                      <th className="px-3 py-2 text-right font-semibold">Đơn giá</th>
                      <th className="px-3 py-2 text-right font-semibold">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                        <td className="min-w-[140px] px-3 py-2 text-gray-900">{it.name}</td>
                        <td className="px-3 py-2 text-gray-600">{it.unit || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {Number(it.quantity).toLocaleString('vi-VN')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatVND(it.unit_price) || '0'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                          {formatVND(it.total ?? Number(it.quantity) * Number(it.unit_price)) || '0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-right text-sm font-medium text-gray-600">
                        Tổng cộng
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-gray-900">
                        {formatVND(doc.amount) || '0'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-semibold text-gray-900">File đính kèm ({doc.attachments?.length || 0})</p>
            {doc.attachments?.length ? (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {doc.attachments.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                    <PaperClipIcon className="h-4 w-4 shrink-0 text-gray-400" />
                    {f.file_url ? (
                      <a
                        href={f.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 flex-1 items-center gap-1 text-sm text-primary-700 hover:underline"
                        title={f.file_name}
                      >
                        <span className="truncate">{f.file_name}</span>
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-500" title={f.file_name}>
                        {f.file_name} (không mở được)
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-gray-400">{fmtDateTime(f.uploaded_at).slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Chưa đính kèm bản scan phiếu.
              </p>
            )}
          </div>

          <div className="space-y-1 rounded-xl border border-gray-100 px-3 py-2 text-xs text-gray-500">
            <p>
              Tạo bởi <span className="font-medium text-gray-700">{doc.created_by_name || '—'}</span> lúc{' '}
              {fmtDateTime(doc.created_at)}
            </p>
            {doc.updated_at && doc.updated_at !== doc.created_at && (
              <p>
                Sửa lần cuối bởi <span className="font-medium text-gray-700">{doc.updated_by_name || '—'}</span> lúc{' '}
                {fmtDateTime(doc.updated_at)}
              </p>
            )}
            <p>
              {doc.reviewed ? (
                <>
                  Rà soát bởi <span className="font-medium text-emerald-700">{doc.reviewed_by_name || '—'}</span> lúc{' '}
                  {fmtDateTime(doc.reviewed_at)}
                </>
              ) : (
                <span className="text-amber-700">Chưa rà soát</span>
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50 px-4 py-3 sm:px-6 sm:py-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            Đóng
          </button>
          <button
            type="button"
            onClick={onToggleReview}
            disabled={reviewBusy}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
              doc.reviewed
                ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            <CheckCircleIcon className="h-4 w-4" />
            {doc.reviewed ? 'Bỏ rà soát' : 'Đánh dấu đã rà soát'}
          </button>
          <button type="button" onClick={onEdit} className="btn-primary flex items-center gap-1.5">
            <PencilSquareIcon className="h-4 w-4" />
            Sửa
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PaymentDocumentDetailModal;
