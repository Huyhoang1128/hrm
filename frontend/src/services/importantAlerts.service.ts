import { managementApi } from '../utils/api';

// Cảnh báo quan trọng (backend: hrm/important_alerts.py) — chỉ Admin/HCNS.

export interface AlertEmployeeInfo {
  id: number;
  employee_code: string;
  full_name: string;
  department: string;
  position: string;
  /** Pháp nhân = đơn vị làm việc của nhân viên (mã + tên); '' nếu chưa gán. */
  legal_entity: string;
  legal_entity_name: string;
  contract_type: string;
  contract_type_display: string;
}

export interface ContractAlert extends AlertEmployeeInfo {
  contract_end_date: string;
  /** Âm = đã quá hạn bấy nhiêu ngày. */
  days_left: number;
  status: 'EXPIRING' | 'EXPIRED';
}

export interface InsuranceAlert extends AlertEmployeeInfo {
  start_date: string;
  due_date: string;
  days_left: number;
  status: 'UPCOMING' | 'OVERDUE';
}

export interface ImportantAlerts {
  today: string;
  rules: {
    contract_alert_days: number;
    insurance_probation_months: number;
    insurance_alert_days: number;
    insurance_overdue_days: number;
  };
  contracts: ContractAlert[];
  insurance: InsuranceAlert[];
  counts: {
    contracts_expiring: number;
    contracts_expired: number;
    insurance_upcoming: number;
    insurance_overdue: number;
    total: number;
  };
}

export function apiErrorMessage(err: unknown, fallback = 'Đã có lỗi xảy ra. Vui lòng thử lại.'): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    const parts: string[] = [];
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value)) parts.push(...value.map(String));
      else if (value && typeof value === 'object') parts.push(...Object.values(value).map(String));
      else if (value) parts.push(String(value));
    }
    if (parts.length) return parts.join(' ');
  }
  return fallback;
}

export const importantAlertsService = {
  async get(): Promise<ImportantAlerts> {
    const res = await managementApi.get<ImportantAlerts>('/api-hrm/important-alerts/');
    return res.data;
  },
};
