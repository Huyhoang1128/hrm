import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeftIcon,
  CheckIcon,
  XMarkIcon,
  TrashIcon,
  ClockIcon,
  BuildingOfficeIcon,
  BriefcaseIcon,
  UserIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import {
  companyConfigAPI,
  type ShiftConfig,
  employeesAPI,
  departmentsAPI,
  positionsAPI,
} from '../utils/api';

const SEARCH_RESULTS_LIMIT = 10;
const MAX_SHIFTS_LOAD = 200;

type ConfigMode = 'landing' | 'individual' | 'position' | 'department';

const APPLY_SCOPE_STYLES: Record<string, string> = {
  CA_NHAN: 'bg-primary-100 text-primary-700',
  VI_TRI: 'bg-violet-100 text-violet-700',
  PHONG_BAN: 'bg-emerald-100 text-emerald-700',
  DEFAULT: 'bg-amber-100 text-amber-700',
};

const getApplyScopeToken = (scope: ShiftConfig['apply_scope']) =>
  String(scope ?? '').trim().toUpperCase();

const resolveApplyScopeLabel = (shift: ShiftConfig) => {
  if (shift.apply_scope_display?.trim()) return shift.apply_scope_display;

  const scopeToken = getApplyScopeToken(shift.apply_scope);
  if (scopeToken === 'CA_NHAN') return 'Cá nhân';
  if (scopeToken === 'VI_TRI') return 'Vị trí';
  if (scopeToken === 'PHONG_BAN') return 'Phòng ban';
  if (scopeToken === 'DEFAULT') return 'Mặc định';

  if (shift.is_default) return 'Mặc định';
  if (shift.apply_to_employees && shift.apply_to_employees.length > 0) return 'Cá nhân';
  if (shift.apply_to_positions && shift.apply_to_positions.length > 0) return 'Vị trí';
  if (shift.apply_to_departments && shift.apply_to_departments.length > 0) return 'Phòng ban';
  return null;
};

const resolveApplyScopeStyle = (shift: ShiftConfig) => {
  if (shift.apply_scope && APPLY_SCOPE_STYLES[shift.apply_scope]) {
    return APPLY_SCOPE_STYLES[shift.apply_scope];
  }

  if (shift.is_default) return APPLY_SCOPE_STYLES.DEFAULT;
  if (shift.apply_to_employees && shift.apply_to_employees.length > 0) return APPLY_SCOPE_STYLES.CA_NHAN;
  if (shift.apply_to_positions && shift.apply_to_positions.length > 0) return APPLY_SCOPE_STYLES.VI_TRI;
  if (shift.apply_to_departments && shift.apply_to_departments.length > 0) return APPLY_SCOPE_STYLES.PHONG_BAN;
  return 'bg-gray-100 text-gray-600';
};

const resolveEmployeeEffectiveScope = (shift: ShiftConfig, employeeId?: number | null) => {
  if (employeeId && shift.apply_to_employees?.includes(employeeId)) {
    return {
      label: 'Cá nhân',
      style: APPLY_SCOPE_STYLES.CA_NHAN,
    };
  }

  return {
    label: resolveApplyScopeLabel(shift),
    style: resolveApplyScopeStyle(shift),
  };
};

const isPersonalScopeShift = (shift: ShiftConfig) => {
  const scopeToken = getApplyScopeToken(shift.apply_scope);
  if (scopeToken === 'CA_NHAN') return true;
  if (scopeToken) return false;
  return Boolean(shift.apply_to_employees && shift.apply_to_employees.length > 0);
};

const ShiftConfiguration: React.FC = () => {
  const [mode, setMode] = useState<ConfigMode>('landing');
  // Thực thể được chọn sẵn khi bấm thẳng từ 1 dòng trong bảng "Tổng quan" —
  // để khỏi phải gõ tìm lại (vd bấm vào phòng ban "Kinh doanh 01" trong
  // bảng thì nhảy thẳng vào chế độ "Phòng ban" với "Kinh doanh 01" đã chọn).
  const [preselected, setPreselected] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const goToMode = (m: ConfigMode, entity?: any) => {
    setError(null);
    setSuccessMessage(null);
    setPreselected(entity ?? null);
    setMode(m);
  };

  const goBack = () => {
    setMode('landing');
    setPreselected(null);
    setError(null);
    setSuccessMessage(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        {mode !== 'landing' && (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Quay lại
          </button>
        )}
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Cấu hình ca làm</h1>
            <p className="text-sm text-gray-900 mt-0.5">Gán ca làm theo cá nhân, vị trí hoặc phòng ban.</p>
          </div>
        </div>
      </div>

      {/* Priority Rules Banner */}
      <div className="rounded-2xl bg-primary-50 border border-primary-200 p-4">
        <div className="flex items-start gap-3">
          <InformationCircleIcon className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-primary-800 mb-1">Quy chế ưu tiên ca làm</p>
            <div className="flex flex-wrap items-center gap-1 text-sm text-primary-700">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-600 text-white text-xs font-medium">
                Cá nhân
              </span>
              <ChevronRightIcon className="h-3 w-3" />
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-500 text-white text-xs font-medium">
                Vị trí
              </span>
              <ChevronRightIcon className="h-3 w-3" />
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-400 text-white text-xs font-medium">
                Phòng ban
              </span>
              <ChevronRightIcon className="h-3 w-3" />
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-300 text-white text-xs font-medium">
                Toàn công ty
              </span>
            </div>
            <p className="mt-1 text-xs text-primary-600">
              Ca làm gán trực tiếp cho cá nhân có độ ưu tiên cao nhất. Nếu không có, hệ thống áp
              dụng ca của vị trí → phòng ban → toàn công ty.
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-200 p-4 flex items-start gap-3">
          <XMarkIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Lỗi</p>
            <p className="mt-0.5 text-sm text-red-700">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {successMessage && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
          <CheckIcon className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
        </div>
      )}

      {/* Views */}
      {mode === 'landing' && <LandingView onSelect={goToMode} />}
      {mode === 'individual' && (
        <IndividualMode initialEmployee={preselected} setError={setError} showSuccess={showSuccess} />
      )}
      {mode === 'position' && (
        <EntityMode type="position" initialEntity={preselected} setError={setError} showSuccess={showSuccess} />
      )}
      {mode === 'department' && (
        <EntityMode type="department" initialEntity={preselected} setError={setError} showSuccess={showSuccess} />
      )}
    </div>
  );
};

// ─── Landing View ─────────────────────────────────────────────────────────────
// Thiết kế lại: 3 lối vào thao tác luôn hiện NGAY ĐẦU trang (không phải cuộn
// xuống mới thấy), khối "Tổng quan" bên dưới chỉ để TRA CỨU — mỗi dòng trong
// bảng bấm được để nhảy thẳng vào đúng chế độ sửa với đối tượng đã chọn sẵn.

const ENTRY_CARDS: {
  mode: ConfigMode;
  label: string;
  desc: string;
  icon: typeof UserIcon;
  color: string;
}[] = [
  { mode: 'individual', label: 'Cá nhân', desc: 'Gán ca làm cho từng nhân viên (ưu tiên cao nhất)', icon: UserIcon, color: 'primary' },
  { mode: 'position', label: 'Vị trí', desc: 'Áp dụng ca cho toàn bộ nhân viên ở một vị trí', icon: BriefcaseIcon, color: 'violet' },
  { mode: 'department', label: 'Phòng ban', desc: 'Áp dụng ca cho toàn bộ nhân viên trong phòng ban', icon: BuildingOfficeIcon, color: 'emerald' },
];

const ENTRY_CARD_STYLES: Record<string, { iconBg: string; iconBgHover: string; iconText: string; border: string }> = {
  primary: { iconBg: 'bg-primary-100', iconBgHover: 'group-hover:bg-primary-600', iconText: 'text-primary-600', border: 'hover:border-primary-300' },
  violet: { iconBg: 'bg-violet-100', iconBgHover: 'group-hover:bg-violet-600', iconText: 'text-violet-600', border: 'hover:border-violet-300' },
  emerald: { iconBg: 'bg-emerald-100', iconBgHover: 'group-hover:bg-emerald-600', iconText: 'text-emerald-600', border: 'hover:border-emerald-300' },
};

const LandingView: React.FC<{ onSelect: (mode: ConfigMode, entity?: any) => void }> = ({ onSelect }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {ENTRY_CARDS.map(({ mode, label, desc, icon: Icon, color }) => {
        const s = ENTRY_CARD_STYLES[color];
        return (
          <button
            key={mode}
            onClick={() => onSelect(mode)}
            className={`group flex flex-col items-center p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow transition-all text-center ${s.border}`}
          >
            <div className={`mb-4 h-14 w-14 flex items-center justify-center rounded-2xl ${s.iconBg} ${s.iconBgHover} transition-colors`}>
              <Icon className={`h-7 w-7 ${s.iconText} group-hover:text-white transition-colors`} />
            </div>
            <p className="font-semibold text-gray-900 mb-1">{label}</p>
            <p className="text-xs text-gray-400">{desc}</p>
          </button>
        );
      })}
    </div>

    <OverviewSection onPick={onSelect} />
  </div>
);

// ─── Overview Section ─────────────────────────────────────────────────────────
// Trả lời trực tiếp câu hỏi "phòng nào đang được phân ca nào" — mỗi bảng bên
// dưới có ô tìm nhanh + cuộn RIÊNG bên trong (chiều cao cố định) để cả trang
// không bị kéo dài vô hạn khi công ty có nhiều phòng ban/vị trí. Bấm vào 1
// dòng bất kỳ để nhảy thẳng vào chế độ sửa của đối tượng đó.

const ShiftBadge: React.FC<{ shift: ShiftConfig }> = ({ shift }) => (
  <span
    key={shift.id}
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
    title={`${shift.start_time} – ${shift.end_time}`}
  >
    {shift.name}
    <span className="text-gray-400 font-normal">{shift.start_time}–{shift.end_time}</span>
  </span>
);

type OverviewRow = { id: number; name: string; code?: string; shifts: ShiftConfig[]; raw: any };

const OverviewTable: React.FC<{
  title: string;
  icon: typeof BuildingOfficeIcon;
  iconColor: string;
  rows: OverviewRow[];
  countLabel: string;
  emptyLabel: string;
  searchPlaceholder: string;
  onPickRow: (raw: any) => void;
}> = ({ title, icon: Icon, iconColor, rows, countLabel, emptyLabel, searchPlaceholder, onPickRow }) => {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
          <span className="font-normal text-gray-400">({countLabel})</span>
        </span>
        {collapsed ? <ChevronDownIcon className="h-4 w-4 text-gray-400" /> : <ChevronUpIcon className="h-4 w-4 text-gray-400" />}
      </button>

      {!collapsed && (
        rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400 italic">{emptyLabel}</p>
        ) : (
          <div className="p-3">
            <div className="relative mb-2">
              <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="input-field pl-9 text-sm py-1.5"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-sm text-gray-400 italic">Không tìm thấy kết quả.</td>
                    </tr>
                  ) : (
                    filtered.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onPickRow(row.raw)}
                        className="cursor-pointer hover:bg-primary-50/60 transition-colors"
                      >
                        <td className="py-2 pl-3 pr-3 font-medium text-gray-800 whitespace-nowrap">
                          {row.name}
                          {row.code && <span className="ml-1.5 text-xs text-gray-400 font-mono">{row.code}</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1.5 justify-end sm:justify-start">
                            {row.shifts.map((s) => <ShiftBadge key={s.id} shift={s} />)}
                          </div>
                        </td>
                        <td className="py-2 pr-3 w-6 text-gray-300">
                          <ChevronRightIcon className="h-4 w-4" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
};

const OverviewSection: React.FC<{ onPick: (mode: ConfigMode, entity: any) => void }> = ({ onPick }) => {
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [employeesById, setEmployeesById] = useState<Map<number, any>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [shiftRes, deptRes, posRes] = await Promise.all([
          companyConfigAPI.listShiftConfigs({ page_size: MAX_SHIFTS_LOAD, is_current: 'all' }),
          departmentsAPI.list({ page_size: 500 }),
          positionsAPI.list({ page_size: 500 }),
        ]);
        if (cancelled) return;
        // is_current: 'all' cố ý lấy cả ca đã tắt/hết hạn để trang "Cá nhân/
        // Vị trí/Phòng ban" bên dưới vẫn hiển thị & xoá được gán cũ — nhưng
        // khối "Tổng quan" này chỉ nên hiện ca THỰC SỰ đang áp dụng (is_active),
        // không thì hiện nhầm ca đã tắt như đang có hiệu lực.
        const shiftList = (shiftRes.results || []).filter((s) => s.is_active);
        setShifts(shiftList);
        setDepartments(deptRes.results || []);
        setPositions(posRes.results || []);

        // Chỉ tra tên nhân viên cho đúng những ID thực sự xuất hiện trong
        // apply_to_employees (không tải cả công ty) — page_size lớn để chắc
        // chắn lấy đủ nếu công ty có nhiều nhân viên được gán ca riêng.
        const employeeIds = new Set<number>();
        shiftList.forEach((s) => (s.apply_to_employees || []).forEach((id) => employeeIds.add(id)));
        if (employeeIds.size > 0) {
          const empRes = await employeesAPI.list({ page_size: 5000, is_active: true });
          if (cancelled) return;
          const map = new Map<number, any>();
          (empRes.results || []).forEach((e: any) => {
            if (employeeIds.has(e.id)) map.set(e.id, e);
          });
          setEmployeesById(map);
        } else {
          setEmployeesById(new Map());
        }
      } catch {
        if (!cancelled) {
          setShifts([]);
          setDepartments([]);
          setPositions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const defaultShifts = shifts.filter((s) => s.is_default);

  const departmentRows: OverviewRow[] = departments
    .map((d) => ({ id: d.id, name: d.name, code: d.code, shifts: shifts.filter((s) => s.apply_to_departments?.includes(d.id)), raw: d }))
    .filter((r) => r.shifts.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const positionRows: OverviewRow[] = positions
    .map((p) => ({ id: p.id, name: p.title, code: p.code, shifts: shifts.filter((s) => s.apply_to_positions?.includes(p.id)), raw: p }))
    .filter((r) => r.shifts.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const individualRows: OverviewRow[] = [];
  employeesById.forEach((emp, id) => {
    individualRows.push({
      id,
      name: emp.full_name,
      code: emp.employee_id,
      shifts: shifts.filter((s) => s.apply_to_employees?.includes(id)),
      raw: emp,
    });
  });
  individualRows.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <InformationCircleIcon className="h-5 w-5 text-primary-600" />
        <h2 className="text-sm font-bold text-gray-900">Tổng quan phân ca hiện tại</h2>
      </div>

      <div className="p-5 space-y-4">
        {/* Ca mặc định công ty */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Ca mặc định công ty (áp dụng khi không có gì khác ghi đè)
          </p>
          {defaultShifts.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Chưa đặt ca mặc định.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {defaultShifts.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                >
                  <StarIcon className="h-3.5 w-3.5" />
                  {s.name} · {s.start_time}–{s.end_time}
                </span>
              ))}
            </div>
          )}
        </div>

        <OverviewTable
          title="Theo phòng ban"
          icon={BuildingOfficeIcon}
          iconColor="text-emerald-500"
          rows={departmentRows}
          countLabel={`${departmentRows.length}/${departments.length} có ca riêng`}
          emptyLabel="Chưa có phòng ban nào được gán ca riêng — tất cả đang dùng ca mặc định công ty (hoặc ca theo vị trí/cá nhân nếu có)."
          searchPlaceholder="Tìm phòng ban..."
          onPickRow={(dept) => onPick('department', dept)}
        />

        <OverviewTable
          title="Theo vị trí"
          icon={BriefcaseIcon}
          iconColor="text-violet-500"
          rows={positionRows}
          countLabel={`${positionRows.length}/${positions.length} có ca riêng`}
          emptyLabel="Chưa có vị trí nào được gán ca riêng."
          searchPlaceholder="Tìm vị trí..."
          onPickRow={(pos) => onPick('position', pos)}
        />

        <OverviewTable
          title="Theo cá nhân (ưu tiên cao nhất)"
          icon={UserIcon}
          iconColor="text-primary-500"
          rows={individualRows}
          countLabel={`${individualRows.length} người có ca riêng`}
          emptyLabel="Chưa có nhân viên nào được gán ca riêng."
          searchPlaceholder="Tìm theo tên hoặc mã nhân viên..."
          onPickRow={(emp) => onPick('individual', emp)}
        />
      </div>
    </div>
  );
};

// ─── Shift Card ───────────────────────────────────────────────────────────────

const ShiftCard: React.FC<{
  shift: ShiftConfig;
  highlight?: boolean;
  action?: React.ReactNode;
  scopeOverride?: {
    label: string | null;
    style: string;
  };
}> = ({ shift, highlight, action, scopeOverride }) => (
  (() => {
    const applyScopeLabel = scopeOverride?.label ?? resolveApplyScopeLabel(shift);
    const applyScopeStyle = scopeOverride?.style ?? resolveApplyScopeStyle(shift);

    return (
      <div className={`flex items-center justify-between p-4 rounded-2xl border ${
        highlight ? 'bg-primary-50 border-primary-200' : 'bg-white border-gray-100'
      }`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-gray-100">
            <ClockIcon className="h-5 w-5 text-gray-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900 text-sm truncate">{shift.name}</p>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600">
                {shift.code}
              </span>
              {applyScopeLabel && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${applyScopeStyle}`}>
                  {applyScopeLabel}
                </span>
              )}
              {highlight && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700 font-medium">
                  Phù hợp
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {shift.start_time} – {shift.end_time} · {shift.total_hours}h
              {shift.shift_type_display ? ` · ${shift.shift_type_display}` : ''}
              {shift.fixed_workday != null && shift.fixed_workday !== '' ? ` · ${Number(shift.fixed_workday)} công cố định` : ''}
              {shift.no_attendance_required ? ' · Ca online, không chấm công' : ''}
            </p>
          </div>
        </div>
        {action && <div className="ml-3 flex-shrink-0">{action}</div>}
      </div>
    );
  })()
);

// ─── Individual Mode ──────────────────────────────────────────────────────────

const IndividualMode: React.FC<{
  initialEmployee?: any | null;
  setError: (e: string | null) => void;
  showSuccess: (m: string) => void;
}> = ({ initialEmployee, setError, showSuccess }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [currentShifts, setCurrentShifts] = useState<ShiftConfig[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [allShifts, setAllShifts] = useState<ShiftConfig[]>([]);
  const [loadingAllShifts, setLoadingAllShifts] = useState(false);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [assigning, setAssigning] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setShowDropdown(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await employeesAPI.list({ search: query.trim(), page_size: SEARCH_RESULTS_LIMIT });
        setResults(res.results || []);
        setShowDropdown(true);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    setLoadingAllShifts(true);
    companyConfigAPI
      .listShiftConfigs({ page_size: MAX_SHIFTS_LOAD, is_current: 'all' })
      // Chỉ cho gán MỚI ca đang thực sự hoạt động — ca đã tắt (is_active=false)
      // gán vào cũng không bao giờ có hiệu lực (bị lọc ở resolution engine).
      .then((res) => setAllShifts((res.results || []).filter((s) => s.is_active)))
      .catch(() => setAllShifts([]))
      .finally(() => setLoadingAllShifts(false));
  }, []);

  const selectEmployee = async (emp: any) => {
    setSelectedEmployee(emp);
    setQuery(emp.full_name);
    setShowDropdown(false);
    setError(null);
    setLoadingShifts(true);
    try {
      const res: any = await companyConfigAPI.getEmployeeShiftConfigs(emp.id);
      setCurrentShifts(Array.isArray(res) ? res : res?.results ?? []);
    } catch { setCurrentShifts([]); }
    finally { setLoadingShifts(false); }
  };

  // Bấm thẳng từ bảng "Tổng quan" ở trang landing thì nạp sẵn nhân viên đó
  // luôn, khỏi phải gõ tìm lại.
  useEffect(() => {
    if (initialEmployee) selectEmployee(initialEmployee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignShift = async (shift: ShiftConfig) => {
    if (!selectedEmployee) return;
    setAssigning(shift.id);
    setError(null);
    try {
      await companyConfigAPI.assignShiftConfig(shift.id, { employee_ids: [selectedEmployee.id] });
      showSuccess(`Đã gán ca "${shift.name}" cho ${selectedEmployee.full_name}`);
      const res: any = await companyConfigAPI.getEmployeeShiftConfigs(selectedEmployee.id);
      setCurrentShifts(Array.isArray(res) ? res : res?.results ?? []);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Lỗi khi gán ca làm');
    } finally { setAssigning(null); }
  };

  const removeShift = async (shift: ShiftConfig) => {
    if (!selectedEmployee) return;
    setRemoving(shift.id);
    setError(null);
    try {
      await companyConfigAPI.removeEmployeeFromShift(shift.id, selectedEmployee.id);
      showSuccess(`Đã xóa ca "${shift.name}" khỏi ${selectedEmployee.full_name}`);
      // Refetch thay vì tự filter khỏi state cục bộ: ca có thể vẫn còn áp dụng
      // cho nhân viên này qua phòng ban/vị trí (không chỉ gán riêng), nên xoá
      // xong ca có thể vẫn còn trong danh sách — filter cứng sẽ làm ca biến
      // mất tạm thời rồi "quay lại" gây hiểu lầm là xoá không ăn khi F5 lại.
      const res: any = await companyConfigAPI.getEmployeeShiftConfigs(selectedEmployee.id);
      setCurrentShifts(Array.isArray(res) ? res : res?.results ?? []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Lỗi khi xóa ca làm');
    } finally { setRemoving(null); }
  };

  // Chỉ cho xoá khi ca ĐANG áp dụng cho ĐÚNG nhân viên này qua gán riêng
  // (apply_to_employees) — không dựa vào apply_scope tĩnh của ca (thuộc tính
  // chung của ca, không phải quan hệ theo từng nhân viên). Một ca "Cá nhân"
  // vẫn có thể được gán thêm cho phòng ban/vị trí của nhân viên đó; nếu vậy,
  // xoá gán riêng xong ca vẫn hiện (đúng), và không nên tiếp tục hiện nút xoá
  // vì bấm lại sẽ không có tác dụng gì (không còn gán riêng để xoá nữa).
  const canRemoveDirectShift = (shift: ShiftConfig) => {
    return Boolean(selectedEmployee && shift.apply_to_employees?.includes(selectedEmployee.id));
  };

  const assignedIds = new Set(currentShifts.map((s) => s.id));
  const filteredShifts = allShifts.filter((s) => {
    if (assignedIds.has(s.id)) return false;
    if (!isPersonalScopeShift(s)) return false;
    if (filterStart && s.start_time !== filterStart) return false;
    if (filterEnd && s.end_time !== filterEnd) return false;
    return true;
  });
  const isMatch = (s: ShiftConfig) =>
    Boolean(filterStart || filterEnd) &&
    (!filterStart || s.start_time === filterStart) &&
    (!filterEnd || s.end_time === filterEnd);
  const sortedShifts = [...filteredShifts].sort((a, b) => isMatch(b) ? 1 : isMatch(a) ? -1 : 0);

  return (
    <div className="space-y-6">
      {/* Employee Search */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
            <UserIcon className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-bold text-gray-900">Tìm nhân viên</h2>
        </div>
        <div className="relative" ref={dropdownRef}>
          <MagnifyingGlassIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400 pointer-events-none" />
          {searching && (
            <div className="absolute right-3 top-3 h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selectedEmployee && e.target.value !== selectedEmployee.full_name) {
                setSelectedEmployee(null);
                setCurrentShifts([]);
              }
            }}
            placeholder="Nhập mã hoặc tên nhân viên..."
            className="input-field pl-10 pr-10"
          />
          {showDropdown && results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-2xl border border-gray-100 shadow-lg max-h-60 overflow-y-auto">
              {results.map((emp) => (
                <button
                  key={emp.id}
                  onMouseDown={() => selectEmployee(emp)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-100 last:border-0"
                >
                  <div className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-xl bg-primary-100 text-primary-700 font-semibold text-sm">
                    {emp.full_name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{emp.full_name}</p>
                    <p className="text-xs text-gray-400 font-mono">{emp.employee_id}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {showDropdown && !searching && results.length === 0 && query.trim() && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-2xl border border-gray-100 shadow-lg p-4 text-center text-sm text-gray-400">
              Không tìm thấy nhân viên
            </div>
          )}
        </div>

        {selectedEmployee && (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-gray-700 text-white font-semibold text-sm">
              {selectedEmployee.full_name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedEmployee.full_name}</p>
              <p className="text-xs text-gray-400 font-mono">{selectedEmployee.employee_id}</p>
            </div>
          </div>
        )}
      </div>

      {/* Current Shifts */}
      {selectedEmployee && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-gray-100 text-gray-500 rounded-xl flex items-center justify-center">
              <ClockIcon className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-bold text-gray-900">Ca làm hiện tại</h2>
          </div>
          {loadingShifts ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : currentShifts.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Chưa có ca làm nào được gán trực tiếp.</p>
          ) : (
            <div className="space-y-3">
              {currentShifts.map((shift) => (
                <ShiftCard
                  key={shift.id}
                  shift={shift}
                  scopeOverride={resolveEmployeeEffectiveScope(shift, selectedEmployee?.id)}
                  action={
                    canRemoveDirectShift(shift) ? (
                      <button
                        onClick={() => removeShift(shift)}
                        disabled={removing === shift.id}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {removing === shift.id ? (
                          <div className="h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <TrashIcon className="h-4 w-4" />
                        )}
                      </button>
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assign New Shift */}
      {selectedEmployee && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <CheckIcon className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-bold text-gray-900">Gán ca làm mới</h2>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Giờ check-in (tùy chọn)
              </label>
              <input
                type="time"
                value={filterStart}
                onChange={(e) => setFilterStart(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Giờ check-out (tùy chọn)
              </label>
              <input
                type="time"
                value={filterEnd}
                onChange={(e) => setFilterEnd(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
          {(filterStart || filterEnd) && (
            <button
              onClick={() => { setFilterStart(''); setFilterEnd(''); }}
              className="mb-4 text-xs text-primary-600 hover:underline"
            >
              Xóa bộ lọc
            </button>
          )}

          {loadingAllShifts ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : sortedShifts.length === 0 ? (
            <div className="text-center py-6">
              <InformationCircleIcon className="mx-auto h-10 w-10 text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">
                {filterStart || filterEnd ? 'Không có ca phù hợp với giờ đã chọn.' : 'Tất cả ca làm đã được gán.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {sortedShifts.map((shift) => (
                <ShiftCard
                  key={shift.id}
                  shift={shift}
                  highlight={isMatch(shift)}
                  action={
                    <button
                      onClick={() => assignShift(shift)}
                      disabled={assigning === shift.id}
                      className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50 text-xs px-3 py-1.5"
                    >
                      {assigning === shift.id ? (
                        <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckIcon className="h-3.5 w-3.5" />
                      )}
                      Gán
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Entity Mode (Position / Department) ─────────────────────────────────────

const EntityMode: React.FC<{
  type: 'position' | 'department';
  initialEntity?: any | null;
  setError: (e: string | null) => void;
  showSuccess: (m: string) => void;
}> = ({ type, initialEntity, setError, showSuccess }) => {
  const isPosition = type === 'position';
  const label = isPosition ? 'vị trí' : 'phòng ban';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [allShifts, setAllShifts] = useState<ShiftConfig[]>([]);
  const [loadingAllShifts, setLoadingAllShifts] = useState(false);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [assigning, setAssigning] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setShowDropdown(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const api = isPosition ? positionsAPI : departmentsAPI;
        const res = await api.list({ search: query.trim(), page_size: SEARCH_RESULTS_LIMIT });
        setResults(res.results || []);
        setShowDropdown(true);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isPosition]);

  useEffect(() => {
    setLoadingAllShifts(true);
    companyConfigAPI
      .listShiftConfigs({ page_size: MAX_SHIFTS_LOAD, is_current: 'all' })
      // Chỉ cho gán MỚI ca đang thực sự hoạt động — ca đã tắt (is_active=false)
      // gán vào cũng không bao giờ có hiệu lực (bị lọc ở resolution engine).
      .then((res) => setAllShifts((res.results || []).filter((s) => s.is_active)))
      .catch(() => setAllShifts([]))
      .finally(() => setLoadingAllShifts(false));
  }, []);

  const selectEntity = (entity: any) => {
    setSelectedEntity(entity);
    setQuery(entity.title || entity.name);
    setShowDropdown(false);
    setError(null);
  };

  // Bấm thẳng từ bảng "Tổng quan" ở trang landing thì nạp sẵn phòng ban/vị
  // trí đó luôn, khỏi phải gõ tìm lại.
  useEffect(() => {
    if (initialEntity) selectEntity(initialEntity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignShift = async (shift: ShiftConfig) => {
    if (!selectedEntity) return;
    setAssigning(shift.id);
    setError(null);
    try {
      const payload = isPosition
        ? { position_ids: [selectedEntity.id] }
        : { department_ids: [selectedEntity.id] };
      await companyConfigAPI.assignShiftConfig(shift.id, payload);
      showSuccess(`Đã gán ca "${shift.name}" cho ${label} "${selectedEntity.title || selectedEntity.name}"`);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Lỗi khi gán ca làm');
    } finally { setAssigning(null); }
  };

  const filteredShifts = allShifts.filter((s) => {
    if (filterStart && s.start_time !== filterStart) return false;
    if (filterEnd && s.end_time !== filterEnd) return false;
    return true;
  });
  const isMatch = (s: ShiftConfig) =>
    Boolean(filterStart || filterEnd) &&
    (!filterStart || s.start_time === filterStart) &&
    (!filterEnd || s.end_time === filterEnd);
  const sortedShifts = [...filteredShifts].sort((a, b) => isMatch(b) ? 1 : isMatch(a) ? -1 : 0);

  const IconComp = isPosition ? BriefcaseIcon : BuildingOfficeIcon;
  const iconCls = isPosition ? 'bg-violet-100 text-violet-600' : 'bg-emerald-100 text-emerald-600';
  const avatarCls = isPosition
    ? 'h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-xl bg-violet-100 text-violet-700 font-semibold text-sm'
    : 'h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 font-semibold text-sm';

  return (
    <div className="space-y-6">
      {/* Entity Search */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${iconCls}`}>
            <IconComp className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-bold text-gray-900">Tìm {label}</h2>
        </div>
        <div className="relative" ref={dropdownRef}>
          <MagnifyingGlassIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400 pointer-events-none" />
          {searching && (
            <div className="absolute right-3 top-3 h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (selectedEntity) setSelectedEntity(null); }}
            placeholder={`Nhập mã hoặc tên ${label}...`}
            className="input-field pl-10 pr-10"
          />
          {showDropdown && results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-2xl border border-gray-100 shadow-lg max-h-60 overflow-y-auto">
              {results.map((item) => (
                <button
                  key={item.id}
                  onMouseDown={() => selectEntity(item)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-100 last:border-0"
                >
                  <div className={avatarCls}>
                    {(item.title || item.name)?.charAt(0) || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.title || item.name}</p>
                    {item.code && <p className="text-xs text-gray-400 font-mono">{item.code}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {showDropdown && !searching && results.length === 0 && query.trim() && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-2xl border border-gray-100 shadow-lg p-4 text-center text-sm text-gray-400">
              Không tìm thấy {label}
            </div>
          )}
        </div>

        {selectedEntity && (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-gray-700 text-white font-semibold text-sm">
              {(selectedEntity.title || selectedEntity.name)?.charAt(0) || '?'}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedEntity.title || selectedEntity.name}</p>
              {selectedEntity.code && <p className="text-xs text-gray-400 font-mono">{selectedEntity.code}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Assign Shift */}
      {selectedEntity && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <CheckIcon className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-bold text-gray-900">Chọn ca làm để gán</h2>
          </div>

          <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
            Tất cả nhân viên thuộc {label} này sẽ áp dụng ca được chọn (nếu không có ca riêng cá nhân).
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Giờ check-in (tùy chọn)
              </label>
              <input
                type="time"
                value={filterStart}
                onChange={(e) => setFilterStart(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Giờ check-out (tùy chọn)
              </label>
              <input
                type="time"
                value={filterEnd}
                onChange={(e) => setFilterEnd(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
          {(filterStart || filterEnd) && (
            <button
              onClick={() => { setFilterStart(''); setFilterEnd(''); }}
              className="mb-4 text-xs text-primary-600 hover:underline"
            >
              Xóa bộ lọc
            </button>
          )}

          {loadingAllShifts ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : sortedShifts.length === 0 ? (
            <div className="text-center py-6">
              <InformationCircleIcon className="mx-auto h-10 w-10 text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">Không có ca nào phù hợp với bộ lọc.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {sortedShifts.map((shift) => (
                <ShiftCard
                  key={shift.id}
                  shift={shift}
                  highlight={isMatch(shift)}
                  action={
                    <button
                      onClick={() => assignShift(shift)}
                      disabled={assigning === shift.id}
                      className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50 text-xs px-3 py-1.5"
                    >
                      {assigning === shift.id ? (
                        <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckIcon className="h-3.5 w-3.5" />
                      )}
                      Gán
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShiftConfiguration;
