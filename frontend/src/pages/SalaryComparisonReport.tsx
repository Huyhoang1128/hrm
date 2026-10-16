import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowsUpDownIcon,
  BuildingOfficeIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ScaleIcon,
} from '@heroicons/react/24/outline';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import type { SelectOption } from '../components/LandingLayout/SelectBox';
import { apiErrorMessage, salaryService } from '../services/salary.service';
import type {
  SalaryComparisonReport as ComparisonReport,
  SalaryComparisonRow,
  SalaryMetricKey,
} from '../services/salary.service';

// ── Kiểu & hằng số ──────────────────────────────────────────────

interface Filters {
  monthA: string; // YYYY-MM
  monthB: string; // YYYY-MM
  department: string; // id dạng chuỗi, '' = tất cả
  legalEntity: string; // mã pháp nhân, '' = tất cả
  employee: string;
}

type Trend = 'up' | 'down' | 'same';
type TrendFilter = 'all' | Trend;
type SortValue = 'abs:desc' | 'diff:desc' | 'diff:asc' | 'name:asc' | 'name:desc' | 'code:asc' | 'code:desc';

interface ViewRow {
  row: SalaryComparisonRow;
  a: number | null;
  b: number | null;
  diff: number;
  pct: number | null;
  trend: Trend;
  department: string;
  legalEntity: string;
  /** Phòng ban / pháp nhân tháng A khi khác tháng B — '' nếu không đổi. */
  departmentFrom: string;
  legalEntityFrom: string;
}

const METRIC_FALLBACK: SelectOption<SalaryMetricKey>[] = [
  { value: 'tong_thu_nhap', label: 'Tổng thu nhập' },
  { value: 'luong_thuc_linh', label: 'Lương thực lĩnh' },
  { value: 'con_phai_thanh_toan', label: 'Còn phải thanh toán' },
];

const SORT_OPTIONS: SelectOption<SortValue>[] = [
  { value: 'abs:desc', label: 'Biến động lớn nhất' },
  { value: 'diff:desc', label: 'Tăng nhiều nhất' },
  { value: 'diff:asc', label: 'Giảm nhiều nhất' },
  { value: 'name:asc', label: 'Họ tên A → Z' },
  { value: 'name:desc', label: 'Họ tên Z → A' },
  { value: 'code:asc', label: 'Mã NV tăng dần' },
  { value: 'code:desc', label: 'Mã NV giảm dần' },
];

const TREND_CHIPS: Array<{ value: TrendFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'up', label: 'Tăng' },
  { value: 'down', label: 'Giảm' },
  { value: 'same', label: 'Không đổi' },
];

const TREND_TEXT: Record<Trend, string> = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  same: 'text-gray-400',
};

// ── Tiện ích ────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');
const toPeriod = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const shiftMonth = (base: Date, delta: number) => new Date(base.getFullYear(), base.getMonth() + delta, 1);
/** '2026-08' → 'T08/2026' */
const periodLabel = (period: string) => {
  const [year, month] = period.split('-');
  return `T${month}/${year}`;
};
const monthLabel = (m: { year: number; month: number }) => `T${pad2(m.month)}/${m.year}`;

const buildMonthOptions = (): SelectOption<string>[] => {
  const now = new Date();
  return Array.from({ length: 48 }, (_, i) => {
    const d = shiftMonth(now, -i);
    return { value: toPeriod(d), label: `${pad2(d.getMonth() + 1)}/${d.getFullYear()}` };
  });
};

const defaultFilters = (): Filters => {
  const now = new Date();
  return {
    monthA: toPeriod(shiftMonth(now, -2)),
    monthB: toPeriod(shiftMonth(now, -1)),
    department: '',
    legalEntity: '',
    employee: '',
  };
};

const sameFilters = (x: Filters, y: Filters) =>
  x.monthA === y.monthA && x.monthB === y.monthB && x.department === y.department
  && x.legalEntity === y.legalEntity && x.employee.trim() === y.employee.trim();

const fmtMoney = (v: number) => `${Math.round(v).toLocaleString('vi-VN')} đ`;
const fmtSigned = (v: number) => {
  const r = Math.round(v);
  if (r === 0) return '0 đ';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('vi-VN')} đ`;
};
const fmtPct = (p: number | null) => {
  if (p === null || !Number.isFinite(p)) return '';
  const sign = p > 0 ? '+' : p < 0 ? '−' : '';
  return `${sign}${Math.abs(p).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};
const trendOf = (v: number): Trend => {
  const r = Math.round(v);
  return r > 0 ? 'up' : r < 0 ? 'down' : 'same';
};
const norm = (s: string) => s.trim().toLowerCase();

const sortRows = (rows: ViewRow[], sort: SortValue) => {
  const [key, dir] = sort.split(':') as [string, 'asc' | 'desc'];
  const sign = dir === 'asc' ? 1 : -1;
  const byCode = (x: ViewRow, y: ViewRow) =>
    x.row.employee_code.localeCompare(y.row.employee_code, 'vi', { numeric: true });
  return [...rows].sort((x, y) => {
    let cmp = 0;
    if (key === 'abs') cmp = Math.abs(x.diff) - Math.abs(y.diff);
    else if (key === 'diff') cmp = x.diff - y.diff;
    else if (key === 'name') cmp = x.row.full_name.localeCompare(y.row.full_name, 'vi');
    else cmp = byCode(x, y);
    return cmp * sign || byCode(x, y);
  });
};

const rowNotes = (r: ViewRow, labelA: string, labelB: string) =>
  [
    !r.row.in_month_a && `Không có lương ${labelA}`,
    !r.row.in_month_b && `Không có lương ${labelB}`,
    r.departmentFrom && `Phòng ban từ: ${r.departmentFrom}`,
    r.legalEntityFrom && `Pháp nhân từ: ${r.legalEntityFrom}`,
  ].filter(Boolean) as string[];

// ── Xuất Excel (đúng các dòng / cột đang hiển thị + dòng tổng) ──

async function exportComparisonExcel(opts: {
  rows: ViewRow[];
  labelA: string;
  labelB: string;
  metricLabel: string;
  filterText: string;
  totals: { a: number; b: number; diff: number; pct: number | null };
}) {
  const { rows, labelA, labelB, metricLabel, filterText, totals } = opts;
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Biến động lương');

  ws.columns = [
    { key: 'code', width: 12 },
    { key: 'name', width: 28 },
    { key: 'department', width: 26 },
    { key: 'entity', width: 24 },
    { key: 'a', width: 20 },
    { key: 'b', width: 20 },
    { key: 'diff', width: 18 },
    { key: 'pct', width: 14 },
    { key: 'note', width: 46 },
  ];

  const infoLines = [
    'BÁO CÁO BIẾN ĐỘNG LƯƠNG',
    `Chỉ số: ${metricLabel} · ${labelA} so với ${labelB} · Chênh lệch = ${labelB} − ${labelA}`,
    filterText,
  ];
  infoLines.forEach((text, idx) => {
    const rowNo = idx + 1;
    ws.mergeCells(`A${rowNo}:I${rowNo}`);
    const cell = ws.getCell(`A${rowNo}`);
    cell.value = text;
    cell.font = idx === 0 ? { bold: true, size: 14 } : { size: 10, color: { argb: 'FF4B5563' } };
  });

  const HEADER_ROW = 5;
  const border = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
  const allBorders = { top: border, left: border, bottom: border, right: border };
  const header = ws.getRow(HEADER_ROW);
  header.values = [
    'Mã NV', 'Họ tên', 'Phòng ban', 'Pháp nhân',
    `${metricLabel} ${labelA}`, `${metricLabel} ${labelB}`,
    'Chênh lệch (VND)', 'Chênh lệch (%)', 'Ghi chú',
  ];
  header.height = 34;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = allBorders;
  });

  const TREND_ARGB: Record<Trend, string> = { up: 'FF059669', down: 'FFDC2626', same: 'FF6B7280' };
  const COL_COUNT = 9;
  const styleRow = (excelRow: ReturnType<typeof ws.addRow>, trend: Trend, bold = false) => {
    for (let col = 1; col <= COL_COUNT; col++) {
      const cell = excelRow.getCell(col);
      cell.border = allBorders;
      cell.alignment = { vertical: 'middle', wrapText: col === COL_COUNT };
      if (col >= 5 && col <= 6) cell.numFmt = '#,##0';
      if (col === 7) cell.numFmt = '+#,##0;-#,##0;0';
      if (col === 8) cell.numFmt = '+0.0%;-0.0%;0.0%';
      const colored = col === 7 || col === 8;
      cell.font = { bold: bold || colored, ...(colored ? { color: { argb: TREND_ARGB[trend] } } : {}) };
    }
  };

  rows.forEach((r) => {
    const excelRow = ws.addRow({
      code: r.row.employee_code,
      name: r.row.full_name,
      department: r.department,
      entity: r.legalEntity,
      a: r.a === null ? null : Math.round(r.a),
      b: r.b === null ? null : Math.round(r.b),
      diff: Math.round(r.diff),
      pct: r.pct === null ? null : r.pct / 100,
      note: rowNotes(r, labelA, labelB).join('; '),
    });
    styleRow(excelRow, r.trend);
  });

  const totalRow = ws.addRow({
    code: 'TỔNG CỘNG',
    name: `${rows.length} nhân viên`,
    a: Math.round(totals.a),
    b: Math.round(totals.b),
    diff: Math.round(totals.diff),
    pct: totals.pct === null ? null : totals.pct / 100,
  });
  styleRow(totalRow, trendOf(totals.diff), true);
  for (let col = 1; col <= COL_COUNT; col++) {
    totalRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  }

  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `bien-dong-luong_${labelA.replace('/', '-')}_${labelB.replace('/', '-')}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Thành phần nhỏ ──────────────────────────────────────────────

function MissingBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
      Không có lương {label}
    </span>
  );
}

function FromNote({ text, label }: { text: string; label: string }) {
  if (!text) return null;
  return (
    <span className="block text-[11px] text-amber-700" title={`${label}: ${text}`}>
      Từ: {text}
    </span>
  );
}

function SummaryCard({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 bg-white rounded-2xl border border-gray-100 border-l-4 ${accent} shadow-sm p-4`}>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{title}</p>
      {children}
    </div>
  );
}

function SortHeader({
  label, active, dir, onClick, align = 'left',
}: { label: ReactNode; active: boolean; dir?: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right' }) {
  const Icon = !active ? ArrowsUpDownIcon : dir === 'asc' ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-800 ${
        active ? 'text-primary-700' : ''
      } ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? '' : 'text-gray-300'}`} />
    </button>
  );
}

// ── Trang ───────────────────────────────────────────────────────

export default function SalaryComparisonReport() {
  const monthOptions = useMemo(buildMonthOptions, []);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters | null>(null);
  const [pending, setPending] = useState<Filters | null>(null);
  const [metric, setMetric] = useState<SalaryMetricKey>('tong_thu_nhap');
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string }>>([]);
  const [legalEntities, setLegalEntities] = useState<Array<{ value: string; label: string }>>([]);
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all');
  const [sort, setSort] = useState<SortValue>('abs:desc');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const sameMonth = filters.monthA === filters.monthB;

  useEffect(() => {
    Promise.allSettled([salaryService.listSalaryDepartments(), salaryService.listSalaryLegalEntities()])
      .then(([deptRes, entityRes]) => {
        if (deptRes.status === 'fulfilled') {
          setDepartments((deptRes.value ?? []).map((d) => ({ id: d.id, name: d.name })));
        }
        if (entityRes.status === 'fulfilled') {
          const unique = new Map<string, { value: string; label: string }>();
          (entityRes.value ?? []).forEach((item) => {
            const value = (item.value ?? '').trim();
            if (value && !unique.has(norm(value))) unique.set(norm(value), { value, label: (item.label ?? '').trim() || value });
          });
          setLegalEntities([...unique.values()].sort((x, y) => x.label.localeCompare(y.label, 'vi')));
        }
      });
  }, []);

  const runReport = useCallback(async (f: Filters) => {
    if (f.monthA === f.monthB) return;
    const id = ++requestRef.current;
    setPending(f);
    setLoading(true);
    setError(null);
    setExportError(null);
    try {
      const data = await salaryService.salaryComparison({
        month_a: f.monthA,
        month_b: f.monthB,
        department: f.department ? Number(f.department) : '',
        legal_entity: f.legalEntity,
        employee: f.employee.trim(),
      });
      if (id !== requestRef.current) return;
      setReport(data);
      setApplied(f);
      setTrendFilter('all');
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(apiErrorMessage(err, 'Không tải được báo cáo biến động lương. Vui lòng thử lại.'));
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, []);

  // Chạy một lần với tháng mặc định khi mở trang (ref chặn StrictMode gọi 2 lần —
  // tháng chưa chốt tính khá nặng).
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void runReport(defaultFilters());
  }, [runReport]);

  // Đếm giây chờ — tháng chưa chốt phải tính lại nên có thể mất vài giây.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (sameMonth || loading) return;
    void runReport(filters);
  };

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // ── Options cho dropdown ──
  const departmentOptions = useMemo<SelectOption<string>[]>(
    () => [{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))],
    [departments],
  );
  const legalEntityOptions = useMemo<SelectOption<string>[]>(
    () => [{ value: '', label: 'Tất cả pháp nhân' }, ...legalEntities],
    [legalEntities],
  );
  const metricOptions = useMemo<SelectOption<SalaryMetricKey>[]>(
    () => (report?.metrics?.length ? report.metrics.map((m) => ({ value: m.key, label: m.label })) : METRIC_FALLBACK),
    [report],
  );
  const metricLabel = metricOptions.find((m) => m.value === metric)?.label ?? '';

  // Pháp nhân tháng A là text thô trong bảng lương (có thể là mã hoặc tên) — quy về mã
  // trước khi so để không báo "chuyển pháp nhân" nhầm.
  const entityIndex = useMemo(() => {
    const byText = new Map<string, string>();
    const nameByCode = new Map<string, string>();
    legalEntities.forEach((e) => {
      byText.set(norm(e.value), norm(e.value));
      byText.set(norm(e.label), norm(e.value));
      nameByCode.set(norm(e.value), e.label);
    });
    return { byText, nameByCode };
  }, [legalEntities]);

  const labelA = report ? monthLabel(report.month_a) : '';
  const labelB = report ? monthLabel(report.month_b) : '';

  const viewRows = useMemo<ViewRow[]>(() => {
    if (!report) return [];
    const entityKey = (text: string) => entityIndex.byText.get(norm(text)) ?? norm(text);
    return report.rows.map((row) => {
      const a = row.in_month_a && row.month_a ? row.month_a[metric] : null;
      const b = row.in_month_b && row.month_b ? row.month_b[metric] : null;
      const diff = row.diff?.[metric] ?? (b ?? 0) - (a ?? 0);
      const pct = row.diff_percent?.[metric] ?? null;
      const department = row.department || row.department_a || '';
      const departmentFrom =
        row.department_a && row.department && norm(row.department_a) !== norm(row.department) ? row.department_a : '';
      const legalEntity = row.legal_entity_name || row.legal_entity || row.legal_entity_a || '';
      const currentKeys = [row.legal_entity, row.legal_entity_name].filter(Boolean).map(entityKey);
      const fromKey = row.legal_entity_a ? entityKey(row.legal_entity_a) : '';
      const legalEntityFrom =
        fromKey && currentKeys.length && !currentKeys.includes(fromKey)
          ? entityIndex.nameByCode.get(fromKey) ?? row.legal_entity_a
          : '';
      return { row, a, b, diff, pct, trend: trendOf(diff), department, legalEntity, departmentFrom, legalEntityFrom };
    });
  }, [report, metric, entityIndex]);

  const trendCounts = useMemo(() => {
    const counts: Record<TrendFilter, number> = { all: viewRows.length, up: 0, down: 0, same: 0 };
    viewRows.forEach((r) => { counts[r.trend] += 1; });
    return counts;
  }, [viewRows]);

  const visibleRows = useMemo(
    () => sortRows(trendFilter === 'all' ? viewRows : viewRows.filter((r) => r.trend === trendFilter), sort),
    [viewRows, trendFilter, sort],
  );

  const visibleTotals = useMemo(() => {
    const a = visibleRows.reduce((s, r) => s + (r.a ?? 0), 0);
    const b = visibleRows.reduce((s, r) => s + (r.b ?? 0), 0);
    const diff = visibleRows.reduce((s, r) => s + r.diff, 0);
    return { a, b, diff, pct: a ? (diff / a) * 100 : null };
  }, [visibleRows]);

  const summary = useMemo(() => {
    if (!report) return null;
    const a = report.totals?.month_a?.[metric] ?? viewRows.reduce((s, r) => s + (r.a ?? 0), 0);
    const b = report.totals?.month_b?.[metric] ?? viewRows.reduce((s, r) => s + (r.b ?? 0), 0);
    const diff = report.totals?.diff?.[metric] ?? b - a;
    return {
      a, b, diff,
      pct: a ? (diff / a) * 100 : null,
      countA: report.rows.filter((r) => r.in_month_a).length,
      countB: report.rows.filter((r) => r.in_month_b).length,
      employees: report.totals?.employee_count ?? report.rows.length,
    };
  }, [report, metric, viewRows]);

  const [sortKey, sortDir] = sort.split(':') as [string, 'asc' | 'desc'];
  const toggleSort = (key: 'name' | 'code') =>
    setSort((prev) => (prev === `${key}:asc` ? `${key}:desc` : `${key}:asc`));
  const cycleDiffSort = () =>
    setSort((prev) => (prev === 'abs:desc' ? 'diff:desc' : prev === 'diff:desc' ? 'diff:asc' : 'abs:desc'));

  const handleExport = async () => {
    if (!report || !applied || !visibleRows.length || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const deptName = departments.find((d) => String(d.id) === applied.department)?.name;
      const entityName = legalEntities.find((e) => e.value === applied.legalEntity)?.label ?? applied.legalEntity;
      const filterText = [
        `Phòng ban: ${applied.department ? deptName ?? applied.department : 'Tất cả'}`,
        `Pháp nhân: ${applied.legalEntity ? entityName : 'Tất cả'}`,
        applied.employee.trim() && `Nhân viên: ${applied.employee.trim()}`,
        `Nhóm: ${TREND_CHIPS.find((c) => c.value === trendFilter)?.label ?? 'Tất cả'}`,
        `Sắp xếp: ${SORT_OPTIONS.find((o) => o.value === sort)?.label ?? ''}`,
      ].filter(Boolean).join(' · ');
      await exportComparisonExcel({
        rows: visibleRows,
        labelA,
        labelB,
        metricLabel,
        filterText,
        totals: visibleTotals,
      });
    } catch (err) {
      setExportError(apiErrorMessage(err, 'Không xuất được file Excel. Vui lòng thử lại.'));
    } finally {
      setExporting(false);
    }
  };

  const filtersChanged = !!applied && !loading && !sameMonth && !sameFilters(filters, applied);
  const loadingFilters = pending ?? filters;

  // ── Render ──
  return (
    <div className="space-y-6 min-w-0">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Báo cáo biến động lương</h1>
        <p className="text-sm text-gray-500 mt-0.5">So sánh lương từng nhân viên giữa hai tháng.</p>
      </div>

      {/* Bộ lọc */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-start">
          <div className="col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <SelectBox<string>
                label="Tháng A"
                value={filters.monthA}
                options={monthOptions}
                onChange={(v) => setFilter('monthA', v)}
              />
              <SelectBox<string>
                label="Tháng B"
                value={filters.monthB}
                options={monthOptions}
                onChange={(v) => setFilter('monthB', v)}
              />
            </div>
            {sameMonth ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                <ExclamationCircleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                Tháng A và tháng B phải khác nhau.
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                Chênh lệch = {periodLabel(filters.monthB)} − {periodLabel(filters.monthA)}
              </p>
            )}
          </div>
          <div className="col-span-2 lg:col-span-1">
            <SelectBox<string>
              label="Phòng ban"
              value={filters.department}
              options={departmentOptions}
              onChange={(v) => setFilter('department', v)}
            />
          </div>
          <div className="col-span-2 lg:col-span-1">
            <SelectBox<string>
              label="Pháp nhân"
              value={filters.legalEntity}
              options={legalEntityOptions}
              onChange={(v) => setFilter('legalEntity', v)}
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="salary-comparison-employee" className="block text-sm font-medium mb-1 text-gray-700">
              Nhân viên
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                id="salary-comparison-employee"
                type="text"
                value={filters.employee}
                onChange={(e) => setFilter('employee', e.target.value)}
                placeholder="Mã hoặc tên nhân viên"
                className="input-field pl-9"
              />
            </div>
          </div>
          <div className="col-span-2 lg:col-span-1">
            <SelectBox<SalaryMetricKey>
              label="Chỉ số so sánh"
              value={metric}
              options={metricOptions}
              onChange={setMetric}
            />
          </div>
          <div className="col-span-2 lg:col-span-1 lg:pt-6">
            <button
              type="submit"
              disabled={sameMonth || loading}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ChartBarIcon className="h-4 w-4" />}
              {loading ? 'Đang tính...' : 'Xem báo cáo'}
            </button>
          </div>
        </div>
        {filtersChanged && (
          <p className="mt-3 text-xs text-amber-700">
            Bộ lọc đã thay đổi — bấm “Xem báo cáo” để cập nhật kết quả.
          </p>
        )}
      </form>

      {/* Kết quả */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-14 text-center" aria-live="polite">
          <div className="inline-block animate-spin rounded-full h-9 w-9 border-b-2 border-primary-600" />
          <p className="mt-4 text-sm font-semibold text-gray-900">
            Đang tính báo cáo {periodLabel(loadingFilters.monthA)} → {periodLabel(loadingFilters.monthB)}…
          </p>
          <p className="mt-1 text-xs text-gray-500 max-w-md mx-auto">
            Tháng chưa chốt lương phải tính lại từ dữ liệu hiện tại nên có thể mất vài giây. Vui lòng không đóng trang.
          </p>
          {elapsed >= 2 && <p className="mt-2 text-xs text-gray-400">Đã chờ {elapsed} giây</p>}
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
          <div className="h-12 w-12 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ExclamationCircleIcon className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-gray-900">Không tải được báo cáo</p>
          <p className="text-xs text-gray-500 mt-1 break-words">{error}</p>
          <button
            type="button"
            onClick={() => void runReport(pending ?? filters)}
            className="btn-primary mt-4 inline-flex items-center gap-2"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Thử lại
          </button>
        </div>
      ) : report && summary ? (
        <>
          {/* Kỳ so sánh + trạng thái chốt */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900">
                So sánh {labelA} → {labelB}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Chỉ số: {metricLabel}</p>
            </div>
          </div>

          {report.rows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
              <div className="h-12 w-12 bg-primary-100 text-primary-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ScaleIcon className="h-6 w-6" />
              </div>
              <p className="text-sm font-bold text-gray-900">Không có dữ liệu lương</p>
              <p className="text-xs text-gray-500 mt-1">
                Không có nhân viên nào có lương ở {labelA} hoặc {labelB} khớp bộ lọc đã chọn.
              </p>
            </div>
          ) : (
            <>
              {/* Thẻ tổng hợp */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SummaryCard title={`Tổng ${labelA}`} accent="border-l-gray-400">
                  <p className="text-[15px] sm:text-xl font-extrabold text-gray-900 mt-1 break-words tabular-nums">
                    {fmtMoney(summary.a)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{summary.countA} người có lương</p>
                </SummaryCard>
                <SummaryCard title={`Tổng ${labelB}`} accent="border-l-primary-500">
                  <p className="text-[15px] sm:text-xl font-extrabold text-primary-600 mt-1 break-words tabular-nums">
                    {fmtMoney(summary.b)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{summary.countB} người có lương</p>
                </SummaryCard>
                <SummaryCard
                  title="Chênh lệch"
                  accent={
                    trendOf(summary.diff) === 'up'
                      ? 'border-l-emerald-500'
                      : trendOf(summary.diff) === 'down'
                        ? 'border-l-red-500'
                        : 'border-l-gray-300'
                  }
                >
                  <p className={`text-[15px] sm:text-xl font-extrabold mt-1 break-words tabular-nums ${TREND_TEXT[trendOf(summary.diff)]}`}>
                    {fmtSigned(summary.diff)}
                  </p>
                  <p className={`text-xs mt-0.5 ${summary.pct === null ? 'text-gray-400' : TREND_TEXT[trendOf(summary.diff)]}`}>
                    {summary.pct === null ? `${labelA} chưa có lương` : `${fmtPct(summary.pct)} so với ${labelA}`}
                  </p>
                </SummaryCard>
                <SummaryCard title="Nhân viên" accent="border-l-blue-500">
                  <p className="text-[15px] sm:text-xl font-extrabold text-gray-900 mt-1">{summary.employees}</p>
                  <p className="text-xs mt-0.5 flex flex-wrap gap-x-2">
                    <span className="text-emerald-600">{trendCounts.up} tăng</span>
                    <span className="text-red-600">{trendCounts.down} giảm</span>
                    <span className="text-gray-500">{trendCounts.same} không đổi</span>
                  </p>
                </SummaryCard>
              </div>

              {/* Danh sách */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm min-w-0 overflow-hidden">
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-2">
                      {TREND_CHIPS.map((chip) => {
                        const active = trendFilter === chip.value;
                        return (
                          <button
                            key={chip.value}
                            type="button"
                            onClick={() => setTrendFilter(chip.value)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                              active
                                ? 'bg-primary-600 border-primary-600 text-white'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {chip.label}
                            <span className={`rounded-full px-1.5 text-xs ${active ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                              {trendCounts[chip.value]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 sm:w-52 sm:flex-none">
                        <SelectBox<SortValue> label="" value={sort} options={SORT_OPTIONS} onChange={setSort} />
                      </div>
                      <button
                        type="button"
                        onClick={handleExport}
                        disabled={exporting || visibleRows.length === 0}
                        title="Xuất Excel đúng các dòng đang hiển thị"
                        aria-label="Xuất Excel"
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-white border border-emerald-300 rounded-xl hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {exporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ArrowDownTrayIcon className="h-4 w-4" />}
                        {exporting ? (
                          'Đang xuất...'
                        ) : (
                          <>
                            {/* Điện thoại hẹp: rút gọn để ô sắp xếp không bị cắt chữ. */}
                            <span className="sm:hidden">Excel</span>
                            <span className="hidden sm:inline">Xuất Excel</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {exportError && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600">
                      <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
                      {exportError}
                    </p>
                  )}
                </div>

                {visibleRows.length === 0 ? (
                  <div className="px-4 pb-10 pt-2 text-center text-sm text-gray-500">
                    Không có nhân viên nào ở nhóm “{TREND_CHIPS.find((c) => c.value === trendFilter)?.label}”.
                  </div>
                ) : (
                  <>
                    {/* Bảng (≥ sm) */}
                    <div className="hidden sm:block overflow-x-auto border-t border-gray-100">
                      <table className="min-w-full divide-y divide-gray-100">
                        <thead className="bg-gray-50 text-xs font-semibold text-gray-500">
                          <tr>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-left whitespace-nowrap">
                              <SortHeader label="Mã NV" active={sortKey === 'code'} dir={sortDir} onClick={() => toggleSort('code')} />
                            </th>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-left whitespace-nowrap">
                              <SortHeader label="Họ tên" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} />
                            </th>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-left uppercase tracking-wider whitespace-nowrap">Phòng ban</th>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-left uppercase tracking-wider whitespace-nowrap">Pháp nhân</th>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap">
                              <div className="uppercase tracking-wider">{labelA}</div>
                              <div className="font-normal text-[11px] text-gray-400">{metricLabel}</div>
                            </th>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap">
                              <div className="uppercase tracking-wider">{labelB}</div>
                              <div className="font-normal text-[11px] text-gray-400">{metricLabel}</div>
                            </th>
                            <th className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap">
                              <SortHeader
                                label="Chênh lệch"
                                align="right"
                                active={sortKey === 'abs' || sortKey === 'diff'}
                                dir={sortKey === 'diff' ? sortDir : 'desc'}
                                onClick={cycleDiffSort}
                              />
                              <div className="font-normal text-[11px] text-gray-400">
                                {sortKey === 'abs' ? 'lớn nhất (±)' : sortKey === 'diff' ? (sortDir === 'desc' ? 'tăng nhiều nhất' : 'giảm nhiều nhất') : 'VND · %'}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100 text-sm">
                          {visibleRows.map((r) => (
                            <tr key={r.row.employee_code} className="hover:bg-gray-50 transition-colors align-top">
                              <td className="px-3 py-3 first:pl-5 last:pr-5 whitespace-nowrap font-semibold text-gray-900">{r.row.employee_code}</td>
                              <td className="px-3 py-3 first:pl-5 last:pr-5 min-w-[10rem]">
                                <div className="font-medium text-gray-900">{r.row.full_name || '—'}</div>
                                {(!r.row.in_month_a || !r.row.in_month_b) && (
                                  <div className="mt-1">
                                    <MissingBadge label={r.row.in_month_a ? labelB : labelA} />
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 first:pl-5 last:pr-5 min-w-[8rem] text-gray-700">
                                {r.department || <span className="text-gray-300">—</span>}
                                <FromNote text={r.departmentFrom} label={`Phòng ban ${labelA}`} />
                              </td>
                              <td className="px-3 py-3 first:pl-5 last:pr-5 min-w-[8rem] text-gray-700">
                                {r.legalEntity || <span className="text-gray-300">—</span>}
                                <FromNote text={r.legalEntityFrom} label={`Pháp nhân ${labelA}`} />
                              </td>
                              <td className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap tabular-nums text-gray-700">
                                {r.a === null ? <span className="text-gray-300">—</span> : fmtMoney(r.a)}
                              </td>
                              <td className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap tabular-nums text-gray-900">
                                {r.b === null ? <span className="text-gray-300">—</span> : fmtMoney(r.b)}
                              </td>
                              <td className={`px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap tabular-nums ${TREND_TEXT[r.trend]}`}>
                                <div className="font-semibold">{fmtSigned(r.diff)}</div>
                                {r.pct !== null && r.trend !== 'same' && <div className="text-xs">{fmtPct(r.pct)}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 text-sm font-semibold border-t border-gray-200">
                          <tr>
                            <td colSpan={4} className="px-3 py-3 first:pl-5 last:pr-5 text-gray-900">
                              Tổng cộng <span className="font-normal text-gray-500">({visibleRows.length} nhân viên)</span>
                            </td>
                            <td className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap tabular-nums text-gray-900">{fmtMoney(visibleTotals.a)}</td>
                            <td className="px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap tabular-nums text-gray-900">{fmtMoney(visibleTotals.b)}</td>
                            <td className={`px-3 py-3 first:pl-5 last:pr-5 text-right whitespace-nowrap tabular-nums ${TREND_TEXT[trendOf(visibleTotals.diff)]}`}>
                              <div>{fmtSigned(visibleTotals.diff)}</div>
                              {visibleTotals.pct !== null && <div className="text-xs font-normal">{fmtPct(visibleTotals.pct)}</div>}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Thẻ (điện thoại) */}
                    <div className="sm:hidden space-y-3 px-4 pb-4">
                      {visibleRows.map((r) => (
                        <div
                          key={r.row.employee_code}
                          className={`rounded-xl border border-gray-100 border-l-4 p-3 ${
                            r.trend === 'up' ? 'border-l-emerald-400' : r.trend === 'down' ? 'border-l-red-400' : 'border-l-gray-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 break-words">{r.row.full_name || '—'}</p>
                              <p className="text-xs text-gray-500">{r.row.employee_code}</p>
                            </div>
                            <div className={`text-right shrink-0 tabular-nums ${TREND_TEXT[r.trend]}`}>
                              <p className="text-sm font-bold">{fmtSigned(r.diff)}</p>
                              {r.pct !== null && r.trend !== 'same' && <p className="text-xs">{fmtPct(r.pct)}</p>}
                            </div>
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-gray-600">
                            <div className="flex items-start gap-1.5">
                              <BuildingOfficeIcon className="h-3.5 w-3.5 mt-px flex-shrink-0 text-gray-400" />
                              <div className="min-w-0 break-words">
                                {r.department || '—'}
                                <FromNote text={r.departmentFrom} label={`Phòng ban ${labelA}`} />
                              </div>
                            </div>
                            <div className="flex items-start gap-1.5">
                              <ScaleIcon className="h-3.5 w-3.5 mt-px flex-shrink-0 text-gray-400" />
                              <div className="min-w-0 break-words">
                                {r.legalEntity || '—'}
                                <FromNote text={r.legalEntityFrom} label={`Pháp nhân ${labelA}`} />
                              </div>
                            </div>
                          </div>
                          <div className="mt-2.5 grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 min-w-0">
                              <p className="text-[11px] text-gray-500">{labelA}</p>
                              <p className="text-sm font-medium text-gray-700 tabular-nums break-words">
                                {r.a === null ? '—' : fmtMoney(r.a)}
                              </p>
                            </div>
                            <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 min-w-0">
                              <p className="text-[11px] text-gray-500">{labelB}</p>
                              <p className="text-sm font-semibold text-gray-900 tabular-nums break-words">
                                {r.b === null ? '—' : fmtMoney(r.b)}
                              </p>
                            </div>
                          </div>
                          {(!r.row.in_month_a || !r.row.in_month_b) && (
                            <div className="mt-2">
                              <MissingBadge label={r.row.in_month_a ? labelB : labelA} />
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Tổng cộng */}
                      <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-bold text-gray-900">
                            Tổng cộng <span className="font-normal text-gray-500">({visibleRows.length} nhân viên)</span>
                          </p>
                          <div className={`text-right shrink-0 tabular-nums ${TREND_TEXT[trendOf(visibleTotals.diff)]}`}>
                            <p className="text-sm font-bold">{fmtSigned(visibleTotals.diff)}</p>
                            {visibleTotals.pct !== null && <p className="text-xs">{fmtPct(visibleTotals.pct)}</p>}
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm tabular-nums">
                          <div className="min-w-0">
                            <p className="text-[11px] text-gray-500">{labelA}</p>
                            <p className="font-semibold text-gray-700 break-words">{fmtMoney(visibleTotals.a)}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] text-gray-500">{labelB}</p>
                            <p className="font-semibold text-gray-900 break-words">{fmtMoney(visibleTotals.b)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
