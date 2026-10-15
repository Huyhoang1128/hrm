import React from 'react';
import {
  DOC_TYPE_BADGE,
  DOC_TYPE_LABELS,
  STATUS_BADGE,
  formatVND,
  statusLabel,
} from '../../services/paymentDocument.service';
import type { PaymentDocType, PaymentDocStatus } from '../../services/paymentDocument.service';

/** YYYY-MM-DD → DD/MM/YYYY */
export const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

/** ISO datetime → "DD/MM/YYYY HH:mm" (giờ máy) */
export const fmtDateTime = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Số tiền hiển thị: "1.500.000 ₫" */
export const fmtMoney = (v: string | number | null | undefined): string => {
  const s = formatVND(v);
  return s ? `${s} ₫` : '0 ₫';
};

export const todayISO = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const fmtFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const DOC_TYPE_SHORT: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Thanh toán',
  PURCHASE_PROPOSAL: 'Mua hàng',
  EXPENSE_ADVANCE: 'Tạm ứng',
};

export const TypeBadge: React.FC<{ type: PaymentDocType; short?: boolean; className?: string }> = ({
  type,
  short = false,
  className = '',
}) => (
  <span
    title={DOC_TYPE_LABELS[type]}
    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${DOC_TYPE_BADGE[type]} ${className}`}
  >
    {short ? DOC_TYPE_SHORT[type] : DOC_TYPE_LABELS[type]}
  </span>
);

export const StatusBadge: React.FC<{
  type: PaymentDocType;
  status: PaymentDocStatus;
  label?: string;
  className?: string;
}> = ({ type, status, label, className = '' }) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${STATUS_BADGE[status]} ${className}`}
  >
    {label || statusLabel(type, status)}
  </span>
);
