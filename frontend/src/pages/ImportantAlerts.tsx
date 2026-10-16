import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  apiErrorMessage,
  importantAlertsService,
  type ContractAlert,
  type ImportantAlerts as ImportantAlertsData,
  type InsuranceAlert,
} from '../services/importantAlerts.service';

type Tab = 'contracts' | 'insurance';
type ContractFilter = 'ALL' | ContractAlert['status'];
type InsuranceFilter = 'ALL' | InsuranceAlert['status'];
type Tone = 'red' | 'amber' | 'yellow';

const fmtDate = (value?: string | null) => {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

// Bỏ dấu để gõ "nguyen" vẫn ra "Nguyễn".
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

const toneOf = (overdue: boolean, days: number): Tone =>
  overdue || days < 0 ? 'red' : days <= 5 ? 'amber' : 'yellow';

const TONE_BADGE: Record<Tone, string> = {
  red: 'bg-red-100 text-red-700 ring-red-200',
  amber: 'bg-orange-100 text-orange-700 ring-orange-200',
  yellow: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
};
const TONE_DOT: Record<Tone, string> = { red: 'bg-red-500', amber: 'bg-orange-500', yellow: 'bg-yellow-400' };
const TONE_EDGE: Record<Tone, string> = { red: 'border-l-red-500', amber: 'border-l-orange-400', yellow: 'border-l-yellow-400' };

const daysText = (days: number, todayText: string) =>
  days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? todayText : `Còn ${days} ngày`;

const byUrgency = <T extends { days_left: number; full_name: string }>(a: T, b: T) =>
  a.days_left - b.days_left || a.full_name.localeCompare(b.full_name, 'vi');

function StatusBadge({ tone, label, title }: { tone: Tone; label: string; title: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE_BADGE[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  );
}

const contractBadge = (c: ContractAlert) => (
  <StatusBadge
    tone={toneOf(c.status === 'EXPIRED', c.days_left)}
    label={daysText(c.days_left, 'Hết hạn hôm nay')}
    title={c.status === 'EXPIRED' ? 'Đã quá hạn, chưa có hợp đồng mới' : 'Sắp hết hạn'}
  />
);

const insuranceBadge = (i: InsuranceAlert) => (
  <StatusBadge
    tone={toneOf(i.status === 'OVERDUE', i.days_left)}
    label={daysText(i.days_left, 'Đến hạn hôm nay')}
    title={i.status === 'OVERDUE' ? 'Quá hạn, chưa có hồ sơ BHXH' : 'Sắp đến hạn đóng BHXH'}
  />
);

const EmployeeLink = ({ id, name, className = '' }: { id: number; name: string; className?: string }) => (
  <Link to={`/dashboard/employees/${id}`} className={`font-semibold text-gray-900 hover:text-primary-600 hover:underline ${className}`}>
    {name || '—'}
  </Link>
);

// ── Thẻ thống kê ─────────────────────────────────────────────────────────
function StatCard({
  label,
  hint,
  value,
  tone,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  value: number;
  tone: 'red' | 'amber';
  icon: typeof DocumentTextIcon;
  active: boolean;
  onClick: () => void;
}) {
  const zero = value === 0;
  const edge = zero ? 'border-l-gray-200' : tone === 'red' ? 'border-l-red-500' : 'border-l-orange-400';
  const num = zero ? 'text-gray-300' : tone === 'red' ? 'text-red-600' : 'text-orange-600';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-2xl border border-l-4 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md sm:p-4 ${edge} ${
        active ? 'border-primary-200 ring-2 ring-primary-200' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-gray-500">{label}</p>
        <Icon className="hidden h-4 w-4 shrink-0 text-gray-300 sm:block" />
      </div>
      <p className={`mt-1 text-2xl font-extrabold ${num}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-gray-400">{hint}</p>
    </button>
  );
}

// ── Bộ lọc nhanh ──────────────────────────────────────────────────────────
function FilterPills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; count: number }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium sm:px-3 transition-colors ${
              active
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-primary-300 hover:text-primary-700'
            }`}
          >
            {o.label}
            <span className={`rounded-full px-1.5 text-[11px] font-semibold ${active ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
              {o.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MobileField({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className="break-words font-medium text-gray-700">{children || '—'}</dd>
    </div>
  );
}

const TH = ({ children }: { children: ReactNode }) => (
  <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{children}</th>
);
const TD = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <td className={`px-3 py-3 text-sm leading-snug text-gray-700 ${className}`}>{children}</td>
);

// ── Bảng / thẻ ────────────────────────────────────────────────────────────
function ContractList({ rows }: { rows: ContractAlert[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-gray-100 sm:block">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <TH>Mã NV</TH>
              <TH>Họ tên</TH>
              <TH>Phòng ban</TH>
              <TH>Vị trí</TH>
              <TH>Loại HĐ</TH>
              <TH>Ngày hết hạn HĐ</TH>
              <TH>Trạng thái</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((c) => (
              <tr key={`${c.id}-${c.contract_end_date}`} className="transition-colors hover:bg-gray-50">
                <TD className="whitespace-nowrap font-semibold text-gray-900">{c.employee_code || '—'}</TD>
                <TD className="min-w-[9rem]"><EmployeeLink id={c.id} name={c.full_name} /></TD>
                <TD className="min-w-[7rem] max-w-[13rem]">{c.department || '—'}</TD>
                <TD className="min-w-[7rem] max-w-[13rem]">{c.position || '—'}</TD>
                <TD className="min-w-[7rem] max-w-[12rem]">{c.contract_type_display || '—'}</TD>
                <TD className="whitespace-nowrap font-medium text-gray-900">{fmtDate(c.contract_end_date)}</TD>
                <TD className="whitespace-nowrap">{contractBadge(c)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2.5 sm:hidden">
        {rows.map((c) => (
          <li
            key={`${c.id}-${c.contract_end_date}`}
            className={`rounded-xl border border-l-4 border-gray-100 bg-white p-3 shadow-sm ${TONE_EDGE[toneOf(c.status === 'EXPIRED', c.days_left)]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <EmployeeLink id={c.id} name={c.full_name} className="block break-words text-sm leading-snug" />
                <p className="text-xs text-gray-500">{c.employee_code || '—'}</p>
              </div>
              <div className="shrink-0">{contractBadge(c)}</div>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <MobileField label="Phòng ban">{c.department}</MobileField>
              <MobileField label="Vị trí">{c.position}</MobileField>
              <MobileField label="Loại HĐ">{c.contract_type_display}</MobileField>
              <MobileField label="Ngày hết hạn HĐ">{fmtDate(c.contract_end_date)}</MobileField>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function InsuranceList({ rows }: { rows: InsuranceAlert[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-gray-100 sm:block">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <TH>Mã NV</TH>
              <TH>Họ tên</TH>
              <TH>Pháp nhân</TH>
              <TH>Phòng ban</TH>
              <TH>Vị trí</TH>
              <TH>Loại HĐ</TH>
              <TH>Ngày đóng BHXH</TH>
              <TH>Trạng thái</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((i) => (
              <tr key={`${i.id}-${i.due_date}`} className="transition-colors hover:bg-gray-50">
                <TD className="whitespace-nowrap font-semibold text-gray-900">{i.employee_code || '—'}</TD>
                <TD className="min-w-[9rem]"><EmployeeLink id={i.id} name={i.full_name} /></TD>
                <TD className="whitespace-nowrap">
                  <span title={i.legal_entity_name || undefined}>{i.legal_entity || '—'}</span>
                </TD>
                <TD className="min-w-[7rem] max-w-[13rem]">{i.department || '—'}</TD>
                <TD className="min-w-[7rem] max-w-[13rem]">{i.position || '—'}</TD>
                <TD className="min-w-[7rem] max-w-[12rem]">{i.contract_type_display || '—'}</TD>
                <TD className="whitespace-nowrap">
                  <p className="font-semibold text-gray-900">{fmtDate(i.due_date)}</p>
                  <p className="text-xs text-gray-400">Vào làm {fmtDate(i.start_date)}</p>
                </TD>
                <TD className="whitespace-nowrap">{insuranceBadge(i)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2.5 sm:hidden">
        {rows.map((i) => (
          <li
            key={`${i.id}-${i.due_date}`}
            className={`rounded-xl border border-l-4 border-gray-100 bg-white p-3 shadow-sm ${TONE_EDGE[toneOf(i.status === 'OVERDUE', i.days_left)]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <EmployeeLink id={i.id} name={i.full_name} className="block break-words text-sm leading-snug" />
                <p className="text-xs text-gray-500">{i.employee_code || '—'}</p>
              </div>
              <div className="shrink-0">{insuranceBadge(i)}</div>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <MobileField label="Pháp nhân">{i.legal_entity}</MobileField>
              <MobileField label="Phòng ban">{i.department}</MobileField>
              <MobileField label="Vị trí">{i.position}</MobileField>
              <MobileField label="Ngày vào làm">{fmtDate(i.start_date)}</MobileField>
              <MobileField label="Ngày đóng BHXH">{fmtDate(i.due_date)}</MobileField>
              <MobileField label="Loại HĐ" wide>{i.contract_type_display}</MobileField>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Trạng thái tải / rỗng / lỗi ───────────────────────────────────────────
function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Đang tải">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="h-[92px] rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="h-2.5 w-2/3 rounded bg-gray-200" />
            <div className="mt-3 h-6 w-10 rounded bg-gray-200" />
            <div className="mt-2 h-2 w-1/2 rounded bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="h-9 w-full rounded-xl bg-gray-100 sm:w-80" />
        <div className="h-8 w-2/3 rounded-full bg-gray-100" />
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <div key={k} className="flex items-center gap-3 rounded-xl border border-gray-50 p-3">
            <div className="h-3 w-16 rounded bg-gray-200" />
            <div className="h-3 flex-1 rounded bg-gray-100" />
            <div className="h-5 w-20 rounded-full bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyBox({ icon: Icon, tone, title, text, action }: {
  icon: typeof CheckCircleIcon;
  tone: 'emerald' | 'gray' | 'red';
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  const iconCls = { emerald: 'bg-emerald-50 text-emerald-500', gray: 'bg-gray-100 text-gray-400', red: 'bg-red-100 text-red-500' }[tone];
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${iconCls}`}>
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-bold text-gray-900">{title}</p>
      {text && <p className="mt-1 max-w-md text-xs text-gray-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Trang ─────────────────────────────────────────────────────────────────
export default function ImportantAlerts() {
  const [data, setData] = useState<ImportantAlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [contractFilter, setContractFilter] = useState<ContractFilter>('ALL');
  const [insuranceFilter, setInsuranceFilter] = useState<InsuranceFilter>('ALL');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await importantAlertsService.get());
    } catch (err) {
      setError(apiErrorMessage(err, 'Không tải được danh sách cảnh báo. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const contracts = useMemo(() => [...(data?.contracts ?? [])].sort(byUrgency), [data]);
  const insurance = useMemo(() => [...(data?.insurance ?? [])].sort(byUrgency), [data]);
  const counts = data?.counts;

  const tabParam = searchParams.get('tab');
  const tab: Tab =
    tabParam === 'insurance' || tabParam === 'contracts'
      ? tabParam
      : contracts.length === 0 && insurance.length > 0
        ? 'insurance'
        : 'contracts';

  const goTo = (next: Tab, filter?: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
    if (next === 'contracts' && filter) setContractFilter(filter as ContractFilter);
    if (next === 'insurance' && filter) setInsuranceFilter(filter as InsuranceFilter);
  };

  const q = norm(search);
  const matches = (r: { employee_code: string; full_name: string }) =>
    !q || norm(r.employee_code || '').includes(q) || norm(r.full_name || '').includes(q);

  const contractRows = contracts.filter((c) => (contractFilter === 'ALL' || c.status === contractFilter) && matches(c));
  const insuranceRows = insurance.filter((i) => (insuranceFilter === 'ALL' || i.status === insuranceFilter) && matches(i));
  const rows = tab === 'contracts' ? contractRows : insuranceRows;
  const tabTotal = tab === 'contracts' ? contracts.length : insurance.length;
  const filtered = tab === 'contracts' ? contractFilter !== 'ALL' : insuranceFilter !== 'ALL';

  const r = data?.rules;
  const rulesText = r
    ? `Hợp đồng hết hạn trong ${r.contract_alert_days} ngày tới hoặc đã quá hạn chưa gia hạn · BHXH bắt đầu đóng sau ${r.insurance_probation_months} tháng làm việc, báo trước ${r.insurance_alert_days} ngày`
    : 'Hợp đồng lao động sắp hết hạn / quá hạn chưa gia hạn và nhân viên đến hạn đóng BHXH bắt buộc.';

  const clearFilters = () => {
    setSearch('');
    if (tab === 'contracts') setContractFilter('ALL');
    else setInsuranceFilter('ALL');
  };

  const statCards = counts && (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="HĐ sắp hết hạn"
        hint={`Trong ${r?.contract_alert_days ?? ''} ngày tới`}
        value={counts.contracts_expiring}
        tone="amber"
        icon={DocumentTextIcon}
        active={tab === 'contracts' && contractFilter === 'EXPIRING'}
        onClick={() => goTo('contracts', 'EXPIRING')}
      />
      <StatCard
        label="HĐ đã quá hạn"
        hint="Chưa có hợp đồng mới"
        value={counts.contracts_expired}
        tone="red"
        icon={DocumentTextIcon}
        active={tab === 'contracts' && contractFilter === 'EXPIRED'}
        onClick={() => goTo('contracts', 'EXPIRED')}
      />
      <StatCard
        label="BHXH sắp đến hạn"
        hint={`Trong ${r?.insurance_alert_days ?? ''} ngày tới`}
        value={counts.insurance_upcoming}
        tone="amber"
        icon={ShieldCheckIcon}
        active={tab === 'insurance' && insuranceFilter === 'UPCOMING'}
        onClick={() => goTo('insurance', 'UPCOMING')}
      />
      <StatCard
        label="BHXH quá hạn"
        hint="Chưa có hồ sơ BHXH"
        value={counts.insurance_overdue}
        tone="red"
        icon={ShieldCheckIcon}
        active={tab === 'insurance' && insuranceFilter === 'OVERDUE'}
        onClick={() => goTo('insurance', 'OVERDUE')}
      />
    </div>
  );

  const tabs: Array<{ key: Tab; short: string; long: string; icon: typeof DocumentTextIcon; total: number; urgent: number }> = [
    { key: 'contracts', short: 'Hợp đồng', long: 'Hợp đồng lao động', icon: DocumentTextIcon, total: contracts.length, urgent: counts?.contracts_expired ?? 0 },
    { key: 'insurance', short: 'BHXH', long: 'Đóng BHXH bắt buộc', icon: ShieldCheckIcon, total: insurance.length, urgent: counts?.insurance_overdue ?? 0 },
  ];

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl">Cảnh báo quan trọng</h1>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-primary-300 hover:text-primary-700 disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-500">{rulesText}</p>
        {data?.today && <p className="mt-0.5 text-xs text-gray-400">Số liệu tính đến ngày {fmtDate(data.today)}</p>}
      </div>

      {/* Lỗi khi làm mới nhưng vẫn còn dữ liệu cũ */}
      {error && data && (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{error}</p>
          <button type="button" onClick={load} className="shrink-0 font-semibold underline">Thử lại</button>
        </div>
      )}

      {!data && loading ? (
        <Skeleton />
      ) : !data ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
          <EmptyBox
            icon={ExclamationCircleIcon}
            tone="red"
            title="Không tải được cảnh báo"
            text={error}
            action={<button type="button" onClick={load} className="btn-primary">Thử lại</button>}
          />
        </div>
      ) : (
        <>
          {statCards}

          {counts?.total === 0 && contracts.length === 0 && insurance.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <EmptyBox
                icon={CheckCircleIcon}
                tone="emerald"
                title="Không có cảnh báo nào"
                text="Không có hợp đồng lao động sắp hết hạn hay quá hạn, cũng không có nhân viên nào đến hạn đóng BHXH. Mọi thứ đang ổn."
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:p-5">
              {/* Tabs */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 sm:inline-grid">
                {tabs.map((t) => {
                  const active = t.key === tab;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => goTo(t.key)}
                      aria-pressed={active}
                      className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold sm:gap-2 sm:px-3 transition-colors ${
                        active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <t.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate sm:hidden">{t.short}</span>
                      <span className="hidden truncate sm:inline">{t.long}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                          t.urgent > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {t.total}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Bộ lọc */}
              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                {tab === 'contracts' ? (
                  <FilterPills<ContractFilter>
                    value={contractFilter}
                    onChange={setContractFilter}
                    options={[
                      { value: 'ALL', label: 'Tất cả', count: contracts.length },
                      { value: 'EXPIRING', label: 'Sắp hết hạn', count: contracts.filter((c) => c.status === 'EXPIRING').length },
                      { value: 'EXPIRED', label: 'Đã quá hạn', count: contracts.filter((c) => c.status === 'EXPIRED').length },
                    ]}
                  />
                ) : (
                  <FilterPills<InsuranceFilter>
                    value={insuranceFilter}
                    onChange={setInsuranceFilter}
                    options={[
                      { value: 'ALL', label: 'Tất cả', count: insurance.length },
                      { value: 'UPCOMING', label: 'Sắp đến hạn', count: insurance.filter((i) => i.status === 'UPCOMING').length },
                      { value: 'OVERDUE', label: 'Quá hạn chưa có hồ sơ BHXH', count: insurance.filter((i) => i.status === 'OVERDUE').length },
                    ]}
                  />
                )}
                <div className="relative w-full lg:w-72">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm theo mã NV hoặc họ tên..."
                    aria-label="Tìm theo mã NV hoặc họ tên"
                    className="input-field pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label="Xoá tìm kiếm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {tab === 'insurance' && r && (
                <p className="mt-2 text-xs text-gray-400">
                  Ngày đóng BHXH = ngày vào làm + {r.insurance_probation_months} tháng. Người quá hạn được theo dõi thêm tối đa{' '}
                  {r.insurance_overdue_days} ngày nếu vẫn chưa có hồ sơ BHXH.
                </p>
              )}

              {/* Danh sách */}
              <div className="mt-4">
                {tabTotal === 0 ? (
                  <EmptyBox
                    icon={CheckCircleIcon}
                    tone="emerald"
                    title={tab === 'contracts' ? 'Không có hợp đồng nào cần xử lý' : 'Không có nhân viên nào đến hạn đóng BHXH'}
                    text={
                      tab === 'contracts'
                        ? `Không có hợp đồng hết hạn trong ${r?.contract_alert_days ?? ''} ngày tới hoặc quá hạn chưa gia hạn.`
                        : `Không có nhân viên đến hạn đóng BHXH trong ${r?.insurance_alert_days ?? ''} ngày tới hoặc quá hạn chưa có hồ sơ.`
                    }
                  />
                ) : rows.length === 0 ? (
                  <EmptyBox
                    icon={MagnifyingGlassIcon}
                    tone="gray"
                    title="Không tìm thấy nhân viên phù hợp"
                    text={search ? `Không có kết quả cho "${search}".` : 'Không có nhân viên nào khớp bộ lọc đang chọn.'}
                    action={
                      (search || filtered) && (
                        <button type="button" onClick={clearFilters} className="btn-secondary text-sm">Xoá bộ lọc</button>
                      )
                    }
                  />
                ) : (
                  <>
                    <p className="mb-2 text-xs text-gray-400">
                      Hiển thị {rows.length}/{tabTotal} nhân viên · sắp xếp theo mức độ khẩn
                    </p>
                    {tab === 'contracts' ? <ContractList rows={contractRows} /> : <InsuranceList rows={insuranceRows} />}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
