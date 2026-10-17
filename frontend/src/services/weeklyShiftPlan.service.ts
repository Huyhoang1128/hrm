import { managementApi } from '../utils/api';

export type WeeklyShiftPlanStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ShiftBrief {
  id: number;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  shift_type: string;
}

export interface WeeklyShiftPlanDay {
  date: string;
  shift: number | null;
  shift_2: number | null;
  shift_detail: ShiftBrief | null;
  shift_2_detail: ShiftBrief | null;
}

export interface WeeklyShiftPlan {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  week_start_date: string;
  week_end_date: string;
  status: WeeklyShiftPlanStatus;
  status_display: string;
  source: 'MANUAL' | 'HR' | 'UPLOAD';
  source_display: string;
  submitted_at: string | null;
  direct_manager_approved: boolean;
  direct_manager_approved_at: string | null;
  direct_manager_approved_by_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  rejected_at: string | null;
  rejected_by_name: string | null;
  reject_reason: string;
  days: WeeklyShiftPlanDay[];
  /** Chỉ có ở pending-approvals */
  can_approve_now?: boolean;
}

export interface PlanDayInput {
  date: string;
  shift: number | null;
  shift_2?: number | null;
}

export interface UploadResult {
  total_rows: number;
  imported_days: number;
  created_plans: number;
  updated_plans: number;
  failed: Array<{ row: number; error: string }>;
  warnings: Array<{ row: number; warning: string }>;
}

const BASE = '/api-hrm/weekly-shift-plans/';

const listOf = <T,>(data: T[] | { results?: T[] }): T[] => (Array.isArray(data) ? data : data.results ?? []);

const download = async (url: string, params: Record<string, unknown>, fallbackName: string) => {
  const response = await managementApi.get(url, { params, responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] || '');
  const match = disposition.match(/filename="?([^";]+)"?/);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(response.data);
  link.download = match ? match[1] : fallbackName;
  link.click();
  URL.revokeObjectURL(link.href);
};

export const weeklyShiftPlanService = {
  async list(params: Record<string, string | number | undefined>): Promise<WeeklyShiftPlan[]> {
    const response = await managementApi.get(BASE, { params: { page_size: 500, ...params } });
    return listOf(response.data);
  },
  async create(data: { week_start_date: string; days: PlanDayInput[]; employee_id?: number }): Promise<WeeklyShiftPlan> {
    return (await managementApi.post(BASE, data)).data;
  },
  async update(id: number, days: PlanDayInput[]): Promise<WeeklyShiftPlan> {
    return (await managementApi.patch(`${BASE}${id}/`, { days })).data;
  },
  async remove(id: number): Promise<void> {
    await managementApi.delete(`${BASE}${id}/`);
  },
  async submit(id: number): Promise<WeeklyShiftPlan> {
    return (await managementApi.post(`${BASE}${id}/submit/`)).data;
  },
  async approve(id: number): Promise<WeeklyShiftPlan> {
    return (await managementApi.post(`${BASE}${id}/approve/`)).data;
  },
  async bulkApprove(ids: number[]): Promise<{ success_count: number; error_count: number; errors: Array<{ id: number; error: string }> }> {
    return (await managementApi.post(`${BASE}bulk-approve/`, { ids })).data;
  },
  async reject(id: number, reject_reason: string): Promise<WeeklyShiftPlan> {
    return (await managementApi.post(`${BASE}${id}/reject/`, { reject_reason })).data;
  },
  async pendingApprovals(params: Record<string, string | number | undefined> = {}): Promise<WeeklyShiftPlan[]> {
    return listOf((await managementApi.get(`${BASE}pending-approvals/`, { params })).data);
  },
  async lockStatus(): Promise<{ is_locked: boolean; note: string }> {
    return (await managementApi.get(`${BASE}lock-status/`)).data;
  },
  async toggleLock(is_locked: boolean, note = ''): Promise<{ is_locked: boolean; note: string }> {
    return (await managementApi.post(`${BASE}lock-toggle/`, { is_locked, note })).data;
  },
  async allowedShifts(): Promise<ShiftBrief[]> {
    return (await managementApi.get(`${BASE}allowed-shifts/`)).data;
  },
  async upload(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file);
    return (await managementApi.post(`${BASE}upload/`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  downloadTemplate: () => download(`${BASE}upload-template/`, {}, 'mau-ke-hoach-ca.xlsx'),
  exportMonthly: (year: number, month: number, department_id?: number) =>
    download(`${BASE}export-monthly/`, { year, month, department_id }, `ke-hoach-ca-${month}-${year}.xlsx`),
};

export const apiError = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === 'object' && typeof (data as { detail?: unknown }).detail === 'string') {
    return (data as { detail: string }).detail;
  }
  return fallback;
};

/** Thứ Hai của tuần chứa `d` (giờ máy), dạng YYYY-MM-DD. */
export const mondayOf = (d: Date): string => {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`;
};

export const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const formatDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export const WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

export const STATUS_STYLE: Record<WeeklyShiftPlanStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
};

/** "Chờ quản lý trực tiếp" / "Chờ HCNS" cho kế hoạch đang chờ duyệt. */
export const pendingStepLabel = (plan: WeeklyShiftPlan) =>
  plan.status !== 'PENDING' ? '' : plan.direct_manager_approved ? 'Chờ HCNS duyệt' : 'Chờ quản lý trực tiếp duyệt';

export const dayLabel = (day?: WeeklyShiftPlanDay) => {
  if (!day) return '—';
  const codes = [day.shift_detail?.code, day.shift_2_detail?.code].filter(Boolean);
  return codes.length ? codes.join(' + ') : 'Nghỉ';
};
