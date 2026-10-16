import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  BellAlertIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import {
  importantAlertsService,
  type ContractAlert,
  type ImportantAlerts,
  type InsuranceAlert,
} from '../services/importantAlerts.service';

const PAGE_PATH = '/dashboard/important-alerts';
const SEEN_PREFIX = 'important_alerts_seen:';
const MAX_ROWS = 8;

// Layout mount lại mỗi lần đổi route (và StrictMode chạy effect 2 lần) → giữ 1 request / user
// cho cả lần tải trang; lỗi cũng được giữ nên không gọi lại cho tới khi tải lại trang.
const requests = new Map<string, Promise<ImportantAlerts>>();
const seenInMemory = new Set<string>();

const isSeen = (key: string) => {
  if (seenInMemory.has(key)) return true;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const markSeen = (key: string) => {
  seenInMemory.add(key);
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* sessionStorage bị chặn — đã nhớ trong bộ nhớ */
  }
};

const fmtDate = (value?: string | null) => {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

type Tone = 'red' | 'amber' | 'yellow';

const toneOf = (overdue: boolean, days: number): Tone =>
  overdue || days < 0 ? 'red' : days <= 5 ? 'amber' : 'yellow';

const TONE_BADGE: Record<Tone, string> = {
  red: 'bg-red-100 text-red-700 ring-red-200',
  amber: 'bg-orange-100 text-orange-700 ring-orange-200',
  yellow: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
};

const daysText = (days: number, todayText: string) =>
  days < 0 ? `Quá ${-days} ngày` : days === 0 ? todayText : `Còn ${days} ngày`;

function DaysBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${TONE_BADGE[tone]}`}>
      {children}
    </span>
  );
}

function AlertRow({
  name,
  code,
  department,
  dateLabel,
  tone,
  badge,
}: {
  name: string;
  code: string;
  department: string;
  dateLabel: string;
  tone: Tone;
  badge: string;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-gray-900" title={name}>{name}</p>
        <p className="truncate text-xs text-gray-500">
          {[code, department].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <DaysBadge tone={tone}>{badge}</DaysBadge>
        <span className="text-[11px] text-gray-400">{dateLabel}</span>
      </div>
    </li>
  );
}

function Section({
  icon: Icon,
  title,
  total,
  children,
  onMore,
}: {
  icon: typeof DocumentTextIcon;
  title: string;
  total: number;
  children: ReactNode;
  onMore: () => void;
}) {
  const hidden = total - MAX_ROWS;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{total}</span>
      </div>
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white">
        {children}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="mt-1.5 px-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
        >
          +{hidden} người khác
        </button>
      )}
    </section>
  );
}

const byUrgency = <T extends { days_left: number; full_name: string }>(a: T, b: T) =>
  a.days_left - b.days_left || a.full_name.localeCompare(b.full_name, 'vi');

function ImportantAlertsModal({ data, onClose, onViewAll }: { data: ImportantAlerts; onClose: () => void; onViewAll: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLockBodyScroll(true);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const contracts = [...(data.contracts ?? [])].sort(byUrgency);
  const insurance = [...(data.insurance ?? [])].sort(byUrgency);
  const { counts } = data;

  const chips: Array<{ label: string; value: number; tone: 'red' | 'amber' }> = [
    { label: 'HĐ sắp hết hạn', value: counts.contracts_expiring, tone: 'amber' },
    { label: 'HĐ đã quá hạn', value: counts.contracts_expired, tone: 'red' },
    { label: 'BHXH sắp đến hạn', value: counts.insurance_upcoming, tone: 'amber' },
    { label: 'BHXH quá hạn', value: counts.insurance_overdue, tone: 'red' },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3 sm:p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="important-alerts-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-red-100">
            <BellAlertIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="important-alerts-title" className="text-base font-bold text-gray-900 sm:text-lg">
              Cảnh báo quan trọng
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
              {counts.total} cảnh báo cần xử lý{' '}
              <span className="whitespace-nowrap">· ngày {fmtDate(data.today)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gray-50/60 px-4 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {chips.map((c) => {
              const active = c.value > 0;
              const color = !active
                ? 'bg-white text-gray-400 ring-gray-100'
                : c.tone === 'red'
                  ? 'bg-red-50 text-red-700 ring-red-100'
                  : 'bg-orange-50 text-orange-700 ring-orange-100';
              return (
                <div key={c.label} className={`rounded-xl px-3 py-2 ring-1 ring-inset ${color}`}>
                  <p className="text-lg font-extrabold leading-tight">{c.value}</p>
                  <p className="text-[11px] font-medium leading-tight opacity-90">{c.label}</p>
                </div>
              );
            })}
          </div>

          {contracts.length > 0 && (
            <Section icon={DocumentTextIcon} title="Hợp đồng lao động" total={contracts.length} onMore={onViewAll}>
              {contracts.slice(0, MAX_ROWS).map((c: ContractAlert) => (
                <AlertRow
                  key={`c-${c.id}-${c.contract_end_date}`}
                  name={c.full_name}
                  code={c.employee_code}
                  department={c.department}
                  dateLabel={`Hết hạn ${fmtDate(c.contract_end_date)}`}
                  tone={toneOf(c.status === 'EXPIRED', c.days_left)}
                  badge={daysText(c.days_left, 'Hết hạn hôm nay')}
                />
              ))}
            </Section>
          )}

          {insurance.length > 0 && (
            <Section icon={ShieldCheckIcon} title="Đóng BHXH bắt buộc" total={insurance.length} onMore={onViewAll}>
              {insurance.slice(0, MAX_ROWS).map((i: InsuranceAlert) => (
                <AlertRow
                  key={`i-${i.id}-${i.due_date}`}
                  name={i.full_name}
                  code={i.employee_code}
                  department={i.department}
                  dateLabel={`Ngày đóng BHXH ${fmtDate(i.due_date)}`}
                  tone={toneOf(i.status === 'OVERDUE', i.days_left)}
                  badge={daysText(i.days_left, 'Đến hạn hôm nay')}
                />
              ))}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 sm:flex-none">
            Đóng
          </button>
          <button
            type="button"
            onClick={onViewAll}
            className="btn-primary flex flex-1 items-center justify-center gap-1.5 sm:flex-none"
          >
            Xem tất cả
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Hiện popup "Cảnh báo quan trọng" (HĐ sắp/đã hết hạn, BHXH đến hạn đóng) cho Admin/HR
 * một lần mỗi phiên trình duyệt. Gắn trong Layout; không có cảnh báo hoặc lỗi API thì không hiện gì.
 */
export default function ImportantAlertsGate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const [data, setData] = useState<ImportantAlerts | null>(null);

  const role = (user?.role || '').toUpperCase();
  const allowed = !!user && (role === 'ADMIN' || role === 'HR' || !!user.is_super_admin
    || (user as any).is_hr === true || (user as any).employee_profile?.is_hr === true);
  const userKey = user ? String(user.id ?? user.username ?? '') : '';

  useEffect(() => {
    if (!allowed || !userKey) return;
    const key = SEEN_PREFIX + userKey;
    if (isSeen(key)) return;

    let alive = true;
    let req = requests.get(userKey);
    if (!req) {
      req = importantAlertsService.get();
      requests.set(userKey, req);
    }
    req
      .then((res) => {
        if (!alive || isSeen(key)) return;
        markSeen(key);
        // Đang đứng sẵn ở trang cảnh báo thì không cần popup.
        if (!res?.counts?.total || pathRef.current.startsWith(PAGE_PATH)) return;
        setData(res);
      })
      .catch(() => {
        /* 403 / lỗi mạng: im lặng, không hiện popup */
      });
    return () => {
      alive = false;
    };
  }, [allowed, userKey]);

  if (!data || !allowed) return null;

  return (
    <ImportantAlertsModal
      data={data}
      onClose={() => setData(null)}
      onViewAll={() => {
        setData(null);
        navigate(PAGE_PATH);
      }}
    />
  );
}
