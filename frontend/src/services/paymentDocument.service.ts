import { managementApi } from '../utils/api/client';

/**
 * Phiếu "Đề nghị thanh toán" / "Đề xuất mua hàng" / "Đề nghị tạm ứng" (chi phí).
 * HCNS tự nhập bản giấy đã ký (scan đính kèm) để lưu trữ và rà soát hằng
 * tháng — KHÔNG có quy trình duyệt. API chỉ cho Admin/HCNS (403 nếu khác).
 */

export type PaymentDocType = 'PAYMENT_REQUEST' | 'PURCHASE_PROPOSAL' | 'EXPENSE_ADVANCE';
export type PaymentDocStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';
export type PaymentMethod = '' | 'CASH' | 'TRANSFER';

export interface PaymentDocumentItem {
  name: string;
  unit: string;
  quantity: number | string;
  unit_price: number | string;
  total?: number | string;
}

export interface PaymentDocumentAttachment {
  id: number;
  file_name: string;
  file_url: string | null;
  uploaded_at: string;
}

export interface PaymentDocument {
  id: number;
  code: string;
  doc_type: PaymentDocType;
  doc_type_display: string;
  doc_date: string;
  employee: number | null;
  employee_code: string | null;
  employee_name: string | null;
  requester_name: string;
  requester_display: string | null;
  department: number | null;
  department_name: string | null;
  title: string;
  description: string;
  amount: string;
  payee: string;
  payment_method: PaymentMethod;
  payment_method_display: string;
  bank_account: string;
  items: PaymentDocumentItem[];
  due_date: string | null;
  status: PaymentDocStatus;
  status_display: string;
  completed_date: string | null;
  settled_amount: string | null;
  outstanding_amount: string | null;
  note: string;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  attachments: PaymentDocumentAttachment[];
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentDocumentFilters {
  /** YYYY-MM theo ngày đề nghị */
  month?: string;
  year?: number;
  date_from?: string;
  date_to?: string;
  doc_type?: PaymentDocType | PaymentDocType[] | '';
  status?: PaymentDocStatus | PaymentDocStatus[] | '';
  department?: number | '';
  employee?: number | '';
  reviewed?: boolean | '';
  search?: string;
}

export interface PaymentDocumentTypeSummary {
  doc_type: PaymentDocType;
  label: string;
  count: number;
  amount: string;
  pending: number;
  completed: number;
  cancelled: number;
  completed_label: string;
  /** Chỉ có với EXPENSE_ADVANCE */
  outstanding?: string;
}

export interface PaymentDocumentSummary {
  total_count: number;
  total_amount: string;
  reviewed_count: number;
  unreviewed_count: number;
  by_type: PaymentDocumentTypeSummary[];
}

export interface PaymentDocumentPayload {
  doc_type: PaymentDocType;
  doc_date: string;
  employee: number | null;
  requester_name: string;
  /** undefined = không gửi (BE tự lấy bộ phận của nhân viên khi tạo mới) */
  department?: number | null;
  title: string;
  description: string;
  amount: string;
  payee: string;
  payment_method: PaymentMethod;
  bank_account: string;
  items: { name: string; unit: string; quantity: number; unit_price: number }[];
  due_date: string | null;
  status: PaymentDocStatus;
  completed_date: string | null;
  settled_amount: string | null;
  note: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Nhãn hiển thị ─────────────────────────────────────────────────────────
export const DOC_TYPES: PaymentDocType[] = ['PAYMENT_REQUEST', 'PURCHASE_PROPOSAL', 'EXPENSE_ADVANCE'];

export const DOC_TYPE_LABELS: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Đề nghị thanh toán',
  PURCHASE_PROPOSAL: 'Đề xuất mua hàng',
  EXPENSE_ADVANCE: 'Đề nghị tạm ứng',
};

export const DOC_TYPE_BADGE: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  PURCHASE_PROPOSAL: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  EXPENSE_ADVANCE: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
};

export const COMPLETED_LABELS: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Đã thanh toán',
  PURCHASE_PROPOSAL: 'Đã mua hàng',
  EXPENSE_ADVANCE: 'Đã hoàn ứng',
};

export const STATUSES: PaymentDocStatus[] = ['PENDING', 'COMPLETED', 'CANCELLED'];

export const statusLabel = (docType: PaymentDocType | '' | undefined, status: PaymentDocStatus): string => {
  if (status === 'PENDING') return 'Chờ xử lý';
  if (status === 'CANCELLED') return 'Huỷ';
  return docType ? COMPLETED_LABELS[docType] : 'Hoàn tất';
};

export const STATUS_BADGE: Record<PaymentDocStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-gray-200 text-gray-600',
};

export const DUE_DATE_LABELS: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Hạn thanh toán',
  PURCHASE_PROPOSAL: 'Ngày cần hàng',
  EXPENSE_ADVANCE: 'Hạn hoàn ứng',
};

export const COMPLETED_DATE_LABELS: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Ngày thanh toán',
  PURCHASE_PROPOSAL: 'Ngày mua hàng',
  EXPENSE_ADVANCE: 'Ngày hoàn ứng',
};

export const PAYEE_LABELS: Record<PaymentDocType, string> = {
  PAYMENT_REQUEST: 'Người / đơn vị nhận tiền',
  PURCHASE_PROPOSAL: 'Nhà cung cấp',
  EXPENSE_ADVANCE: 'Người / đơn vị nhận tiền',
};

export const PAYMENT_METHOD_LABELS: Record<Exclude<PaymentMethod, ''>, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
};

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip', 'rar',
];
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

// ── Tiện ích số tiền ──────────────────────────────────────────────────────
/** "1500000" | 1500000 → "1.500.000" (rỗng nếu không có) */
export const formatVND = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('vi-VN');
};

/** Chuỗi người dùng gõ ("1.500.000") → "1500000" (chỉ giữ chữ số) */
export const digitsOnly = (display: string): string => display.replace(/\D/g, '').replace(/^0+(?=\d)/, '');

// ── Bộ lọc → query params ─────────────────────────────────────────────────
const toParams = (filters: PaymentDocumentFilters): Record<string, string | number> => {
  const params: Record<string, string | number> = {};
  if (filters.month) params.month = filters.month;
  else if (filters.year) params.year = filters.year;
  if (filters.date_from) params.date_from = filters.date_from;
  if (filters.date_to) params.date_to = filters.date_to;
  if (filters.doc_type && (!Array.isArray(filters.doc_type) || filters.doc_type.length)) {
    params.doc_type = Array.isArray(filters.doc_type) ? filters.doc_type.join(',') : filters.doc_type;
  }
  if (filters.status && (!Array.isArray(filters.status) || filters.status.length)) {
    params.status = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
  }
  if (filters.department) params.department = filters.department;
  if (filters.employee) params.employee = filters.employee;
  if (filters.reviewed === true || filters.reviewed === false) params.reviewed = String(filters.reviewed);
  if (filters.search && filters.search.trim()) params.search = filters.search.trim();
  return params;
};

const buildFormData = (
  payload: PaymentDocumentPayload,
  files: File[],
  removeAttachmentIds: number[] = []
): FormData => {
  const fd = new FormData();
  fd.append('doc_type', payload.doc_type);
  fd.append('doc_date', payload.doc_date);
  fd.append('employee', payload.employee ? String(payload.employee) : '');
  fd.append('requester_name', payload.requester_name);
  if (payload.department !== undefined) {
    fd.append('department', payload.department ? String(payload.department) : '');
  }
  fd.append('title', payload.title);
  fd.append('description', payload.description);
  fd.append('amount', payload.amount);
  fd.append('payee', payload.payee);
  fd.append('payment_method', payload.payment_method);
  fd.append('bank_account', payload.bank_account);
  fd.append('items', JSON.stringify(payload.items));
  fd.append('due_date', payload.due_date || '');
  fd.append('status', payload.status);
  fd.append('completed_date', payload.completed_date || '');
  fd.append('settled_amount', payload.settled_amount ?? '');
  fd.append('note', payload.note);
  files.forEach((f) => fd.append('attachments', f));
  if (removeAttachmentIds.length) {
    fd.append('remove_attachment_ids', removeAttachmentIds.join(','));
  }
  return fd;
};

/** Lấy tên file từ Content-Disposition (hỗ trợ filename*=UTF-8''...) */
const filenameFromDisposition = (header: string | undefined): string | null => {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* ignore */
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
};

class PaymentDocumentService {
  private base = '/api-hrm/payment-documents/';

  async list(
    filters: PaymentDocumentFilters,
    page = 1,
    pageSize = 20
  ): Promise<PaginatedResponse<PaymentDocument>> {
    const res = await managementApi.get(this.base, {
      params: { ...toParams(filters), page, page_size: pageSize },
    });
    return res.data;
  }

  /** ID của mọi phiếu khớp bộ lọc (dùng cho "rà soát tất cả theo bộ lọc"). */
  async listAllIds(filters: PaymentDocumentFilters): Promise<number[]> {
    const ids: number[] = [];
    const pageSize = 1000;
    for (let page = 1; page <= 50; page += 1) {
      const data = await this.list(filters, page, pageSize);
      (data.results || []).forEach((d) => ids.push(d.id));
      if (!data.next || !data.results?.length) break;
    }
    return ids;
  }

  async get(id: number): Promise<PaymentDocument> {
    const res = await managementApi.get(`${this.base}${id}/`);
    return res.data;
  }

  async create(payload: PaymentDocumentPayload, files: File[]): Promise<PaymentDocument> {
    const res = await managementApi.post(this.base, buildFormData(payload, files), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  }

  async update(
    id: number,
    payload: PaymentDocumentPayload,
    files: File[],
    removeAttachmentIds: number[]
  ): Promise<PaymentDocument> {
    const res = await managementApi.patch(
      `${this.base}${id}/`,
      buildFormData(payload, files, removeAttachmentIds),
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return res.data;
  }

  async remove(id: number): Promise<void> {
    await managementApi.delete(`${this.base}${id}/`);
  }

  async review(id: number, reviewed: boolean): Promise<PaymentDocument> {
    const res = await managementApi.post(`${this.base}${id}/review/`, { reviewed });
    return res.data;
  }

  async reviewBulk(ids: number[], reviewed: boolean): Promise<{ updated: number }> {
    const res = await managementApi.post(`${this.base}review-bulk/`, { ids, reviewed });
    return res.data;
  }

  async summary(filters: PaymentDocumentFilters): Promise<PaymentDocumentSummary> {
    const res = await managementApi.get(`${this.base}summary/`, { params: toParams(filters) });
    return res.data;
  }

  async exportExcel(filters: PaymentDocumentFilters): Promise<{ blob: Blob; filename: string }> {
    const res = await managementApi.get(`${this.base}export-excel/`, {
      params: toParams(filters),
      responseType: 'blob',
    });
    const fallback = `phieu-thanh-toan-${filters.month || filters.year || new Date().toISOString().slice(0, 7)}.xlsx`;
    const filename = filenameFromDisposition(res.headers?.['content-disposition']) || fallback;
    return { blob: res.data, filename };
  }
}

/** Gom lỗi DRF ({field: [msg]} | {field: msg} | {detail}) thành {field: msg}. */
export const parseApiErrors = async (err: any): Promise<Record<string, string>> => {
  let data = err?.response?.data;
  // Lỗi của request responseType=blob trả về Blob → đọc lại thành JSON
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      data = null;
    }
  }
  const out: Record<string, string> = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    Object.entries(data).forEach(([key, value]) => {
      const flat = (v: unknown): string =>
        Array.isArray(v)
          ? v.map(flat).filter(Boolean).join(' ')
          : v && typeof v === 'object'
            ? Object.values(v as Record<string, unknown>).map(flat).join(' ')
            : String(v ?? '');
      const msg = flat(value).trim();
      if (msg) out[key] = msg;
    });
  } else if (Array.isArray(data)) {
    out.detail = data.map(String).join(' ');
  }
  if (!Object.keys(out).length) {
    const status = err?.response?.status;
    out.detail =
      status === 403
        ? 'Chỉ Admin hoặc HCNS được quản lý phiếu thanh toán.'
        : status === 413
          ? 'File đính kèm quá lớn.'
          : err?.message || 'Có lỗi xảy ra, vui lòng thử lại.';
  }
  return out;
};

export default new PaymentDocumentService();
