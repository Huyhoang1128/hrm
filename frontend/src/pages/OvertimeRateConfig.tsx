import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  BuildingOfficeIcon,
  BriefcaseIcon,
  UserIcon,
  AdjustmentsHorizontalIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { departmentsAPI, employeesAPI, positionsAPI } from '../utils/api';
import { Department, Position, Employee } from '../utils/api/types';
import salaryService, { OvertimeRateConfig, OvertimeRateLevel } from '../services/salary.service';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type TabKey = OvertimeRateLevel;

interface Tab {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { key: 'department', label: 'Phòng ban / Bộ phận', icon: BuildingOfficeIcon },
  { key: 'position',   label: 'Vị trí',              icon: BriefcaseIcon },
  { key: 'employee',   label: 'Cá nhân',             icon: UserIcon },
  { key: 'all',        label: 'Mặc định',            icon: AdjustmentsHorizontalIcon },
];

const EMPTY_FORM = {
  department_ids:    [] as number[],
  position_ids:      [] as number[],
  employee_ids:      [] as number[],
  apply_to_all:      false,
  calc_method:       'FIXED' as 'FIXED' | 'FROM_BASIC',
  rate_per_hour:     0,
  multiplier:        1,
  use_kpi:           false,
  kpi_multiplier:    null as number | null,
  kpi_rate_per_hour: null as number | null,
  kpi_threshold:     100,
  effective_from:    '',
  effective_to:      '' as string,
  is_active:         true,
  notes:             '',
};

type FormState = typeof EMPTY_FORM;

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50/40">
    <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined) {
  if (!v) return '—';
  return Number(v).toLocaleString('vi-VN') + ' ₫';
}

function formatThousands(v: number | null | undefined): string {
  if (!v) return '';
  return Math.round(v).toLocaleString('vi-VN');
}

function formatMultiplier(v: number | string | null | undefined): string {
  const n = parseFloat(String(v ?? 1));
  if (isNaN(n)) return '1.0';
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}


function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function toggleId<T extends number>(arr: T[], id: T): T[] {
  return arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────

const OvertimeRateConfigPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('department');
  const [rows, setRows]           = useState<OvertimeRateConfig[]>([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState('');

  // master data
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions,   setPositions]   = useState<Position[]>([]);
  const [employees,   setEmployees]   = useState<Employee[]>([]);

  // feedback banners
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  // confirm delete
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  // modal
  const [showModal,  setShowModal]  = useState(false);
  const [editTarget, setEditTarget] = useState<OvertimeRateConfig | null>(null);
  const [form,       setForm]       = useState<FormState>({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);
  const [modalError, setModalError] = useState('');
  const [empSearch,  setEmpSearch]  = useState('');

  // display state cho các trường tiền tệ (format 20.000) và hệ số nhân
  const [rateDisplay,       setRateDisplay]       = useState('');
  const [kpiRateDisplay,    setKpiRateDisplay]    = useState('');
  const [multiplierDisplay, setMultiplierDisplay] = useState('1');
  const [kpiMultiplierDisplay, setKpiMultiplierDisplay] = useState('');

  // ── load master data once ──────────────────────────────────
  useEffect(() => {
    departmentsAPI.list({ page_size: 500 }).then(r => setDepartments(r.results));
    positionsAPI.list({ page_size: 500 }).then(r => setPositions(r.results));
    employeesAPI.list({ page_size: 1000, is_active: true }).then(r => setEmployees(r.results));
  }, []);

  // ── fetch rows ────────────────────────────────────────────
  const fetchRows = useCallback(async (tab: TabKey) => {
    setLoading(true);
    try {
      const data = await salaryService.listOvertimeRates(tab);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(activeTab); }, [activeTab, fetchRows]);

  // ── filtered rows ─────────────────────────────────────────
  const filteredRows = rows.filter(row => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      row.department_names.some(n => n.toLowerCase().includes(q)) ||
      row.position_names.some(n => n.toLowerCase().includes(q)) ||
      row.employee_names.some(e => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q))
    );
  });

  // ── open modal ────────────────────────────────────────────
  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, apply_to_all: activeTab === 'all' });
    setRateDisplay('');
    setKpiRateDisplay('');
    setMultiplierDisplay('1.0');
    setKpiMultiplierDisplay('');
    setEmpSearch('');
    setModalError('');
    setShowModal(true);
  }

  function openEdit(row: OvertimeRateConfig) {
    setEditTarget(row);
    setForm({
      department_ids:    row.department_ids,
      position_ids:      row.position_ids,
      employee_ids:      row.employee_ids,
      apply_to_all:      row.apply_to_all,
      calc_method:       row.calc_method ?? 'FIXED',
      rate_per_hour:     row.rate_per_hour,
      multiplier:        row.multiplier ?? 1,
      use_kpi:           row.use_kpi,
      kpi_multiplier:    row.kpi_multiplier,
      kpi_rate_per_hour: row.kpi_rate_per_hour,
      kpi_threshold:     row.kpi_threshold,
      effective_from:    row.effective_from,
      effective_to:      row.effective_to ?? '',
      is_active:         row.is_active,
      notes:             row.notes,
    });
    setRateDisplay(formatThousands(row.rate_per_hour));
    setKpiRateDisplay(formatThousands(row.kpi_rate_per_hour ?? 0));
    setMultiplierDisplay(formatMultiplier(row.multiplier ?? 1));
    setKpiMultiplierDisplay(row.kpi_multiplier != null ? formatMultiplier(row.kpi_multiplier) : '');
    setEmpSearch('');
    setModalError('');
    setShowModal(true);
  }

  // ── save ──────────────────────────────────────────────────
  async function handleSave() {
    if (!form.effective_from) { setModalError('Vui lòng nhập ngày hiệu lực từ.'); return; }
    if (form.calc_method === 'FIXED' && !form.rate_per_hour) {
      setModalError('Vui lòng nhập đơn giá / giờ.'); return;
    }

    const payload = {
      department_ids:    form.department_ids,
      department_names:  [],
      position_ids:      form.position_ids,
      position_names:    [],
      employee_ids:      form.employee_ids,
      employee_names:    [],
      apply_to_all:      form.apply_to_all,
      calc_method:       form.calc_method,
      rate_per_hour:     form.calc_method === 'FIXED' ? form.rate_per_hour : 0,
      multiplier:        form.multiplier,
      use_kpi:           form.use_kpi,
      kpi_multiplier:    form.use_kpi ? form.kpi_multiplier : null,
      kpi_rate_per_hour: form.use_kpi ? form.kpi_rate_per_hour : null,
      kpi_threshold:     form.use_kpi ? form.kpi_threshold : 100,
      effective_from:    form.effective_from,
      effective_to:      form.effective_to || null,
      is_active:         form.is_active,
      notes:             form.notes,
    };

    setSaving(true);
    setModalError('');
    try {
      if (editTarget) {
        await salaryService.updateOvertimeRate(editTarget.id, payload);
        setSuccessMsg('Đã cập nhật cấu hình tăng ca.');
      } else {
        await salaryService.createOvertimeRate(payload);
        setSuccessMsg('Đã thêm cấu hình tăng ca.');
      }
      setShowModal(false);
      fetchRows(activeTab);
    } catch (e: any) {
      setModalError(e?.response?.data?.detail ?? JSON.stringify(e?.response?.data) ?? 'Lỗi lưu dữ liệu.');
    } finally {
      setSaving(false);
    }
  }

  // ── delete ────────────────────────────────────────────────
  async function handleDelete() {
    if (deleteTarget === null) return;
    try {
      await salaryService.deleteOvertimeRate(deleteTarget);
      setSuccessMsg('Đã xoá cấu hình.');
      fetchRows(activeTab);
    } catch {
      setErrorMsg('Không thể xoá. Vui lòng thử lại.');
    } finally {
      setDeleteTarget(null);
    }
  }

  // ── render target badges ──────────────────────────────────
  function renderTarget(row: OvertimeRateConfig) {
    if (row.apply_to_all) return <span className="text-gray-500 italic text-sm">Tất cả nhân viên</span>;
    const parts: React.ReactNode[] = [
      ...row.department_names.map((n, i) => (
        <span key={`d${i}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700">{n}</span>
      )),
      ...row.position_names.map((n, i) => (
        <span key={`p${i}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700">{n}</span>
      )),
      ...row.employee_names.map((e, i) => (
        <span key={`e${i}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">{e.name}</span>
      )),
    ];
    return parts.length ? <div className="flex flex-wrap gap-1">{parts}</div> : <span className="text-gray-400 text-sm">—</span>;
  }

  // ── render effective rate preview ────────────────────────
  function renderRate(row: OvertimeRateConfig) {
    if (row.calc_method === 'FROM_BASIC') {
      const mul = row.multiplier && row.multiplier !== 1 ? ` × ${row.multiplier}` : '';
      return <span className="text-sm text-primary-700 font-medium">LC ÷ công ÷ 7.5h{mul}</span>;
    }
    const effective = row.rate_per_hour * (row.multiplier || 1);
    return (
      <div>
        <p className="text-sm font-medium text-gray-900">{fmtMoney(effective)}</p>
        {row.multiplier && row.multiplier !== 1 && (
          <p className="text-xs text-gray-400">{fmtMoney(row.rate_per_hour)} × {row.multiplier}</p>
        )}
      </div>
    );
  }

  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase();
    return !q || e.full_name.toLowerCase().includes(q) || e.employee_id.toLowerCase().includes(q);
  });

  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Xoá cấu hình tăng ca"
        message="Bạn có chắc muốn xoá cấu hình này không?"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Cấu hình tăng ca</h1>
        <p className="text-gray-900 mt-0.5 text-sm">Thiết lập đơn giá tăng ca theo phòng ban, vị trí và cá nhân với thời gian hiệu lực linh hoạt.</p>
      </div>

      {/* Banners */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-sm">
          <CheckIcon className="h-4 w-4 flex-shrink-0" />
          {successMsg}
          <button className="ml-auto" onClick={() => setSuccessMsg(null)}><XMarkIcon className="h-4 w-4" /></button>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-sm">
          <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
          {errorMsg}
          <button className="ml-auto" onClick={() => setErrorMsg(null)}><XMarkIcon className="h-4 w-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        <div className="flex flex-col sm:flex-row gap-3 justify-between">
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm theo tên phòng ban, vị trí, nhân viên..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />
            Thêm cấu hình
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <ArrowPathIcon className="h-6 w-6 text-primary-400 animate-spin" />
            <span className="ml-2 text-sm text-gray-500">Đang tải...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <AdjustmentsHorizontalIcon className="h-10 w-10 mb-2" />
            <p className="text-sm">Chưa có cấu hình nào{search ? ' phù hợp' : ''}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header text-left">Áp dụng cho</th>
                  <th className="table-header text-left">Cách tính</th>
                  <th className="table-header text-right">Đơn giá / h</th>
                  <th className="table-header text-center">KPI</th>
                  <th className="table-header text-center">Hiệu lực</th>
                  <th className="table-header text-center">Trạng thái</th>
                  <th className="table-header text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filteredRows.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 max-w-xs">{renderTarget(row)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        row.calc_method === 'FROM_BASIC'
                          ? 'bg-blue-100 text-primary-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {row.calc_method === 'FROM_BASIC' ? 'Từ LC' : 'Cố định'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{renderRate(row)}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">
                      {row.use_kpi ? (
                        <div>
                          <p className="font-medium text-primary-700">
                            {row.kpi_multiplier ? `×${row.kpi_multiplier}` : fmtMoney(row.kpi_rate_per_hour)}
                          </p>
                          <p className="text-xs text-gray-400">≥ {row.kpi_threshold}%</p>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">
                      <p>{fmtDate(row.effective_from)}</p>
                      <p className="text-xs text-gray-400">→ {row.effective_to ? fmtDate(row.effective_to) : '∞'}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {row.is_active ? 'Đang áp dụng' : 'Tắt'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(row)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-xl transition-colors"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                          Sửa
                        </button>
                        <button
                          onClick={() => setDeleteTarget(row.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Xoá
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 text-sm text-gray-500">
            {filteredRows.length} / {rows.length} cấu hình
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="shrink-0 flex items-center gap-4 px-6 py-4 border-b border-gray-100">
              <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                <AdjustmentsHorizontalIcon className="h-5 w-5 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-gray-900 leading-tight">
                  {editTarget ? 'Sửa cấu hình tăng ca' : 'Thêm cấu hình tăng ca'}
                </h2>
                <p className="text-xs text-primary-500 mt-0.5">{TABS.find(t => t.key === activeTab)?.label}</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="grid grid-cols-1 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 min-h-full">

                {/* ── Cột trái: Áp dụng cho ── */}
                <div className="col-span-full sm:col-span-2 p-5 flex flex-col gap-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Áp dụng cho</p>

                  {activeTab === 'all' ? (
                    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <AdjustmentsHorizontalIcon className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Cấu hình mặc định</p>
                        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                          Áp dụng cho tất cả nhân viên chưa có cấu hình cá nhân, vị trí, hoặc phòng ban.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Search */}
                      <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder={
                            activeTab === 'department' ? 'Tìm phòng ban...' :
                            activeTab === 'position'   ? 'Tìm vị trí...' :
                            'Tìm tên hoặc mã NV...'
                          }
                          value={empSearch}
                          onChange={e => setEmpSearch(e.target.value)}
                          className="input-field pl-9"
                        />
                      </div>

                      {/* Selected badge */}
                      {(activeTab === 'department' ? form.department_ids.length :
                        activeTab === 'position'   ? form.position_ids.length :
                        form.employee_ids.length) > 0 && (
                        <p className="text-xs text-primary-600 font-medium">
                          Đã chọn:{' '}
                          {activeTab === 'department' ? form.department_ids.length :
                           activeTab === 'position'   ? form.position_ids.length :
                           form.employee_ids.length}
                        </p>
                      )}

                      {/* List */}
                      <div className="border border-gray-100 rounded-xl overflow-y-auto max-h-[300px] divide-y divide-gray-50 bg-white flex-1">
                        {activeTab === 'department' && departments
                          .filter(d => !empSearch || d.name.toLowerCase().includes(empSearch.toLowerCase()))
                          .map(d => (
                            <label key={d.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-primary-50 cursor-pointer text-sm transition-colors">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                                checked={form.department_ids.includes(d.id)}
                                onChange={() => setForm(f => ({ ...f, department_ids: toggleId(f.department_ids, d.id) }))}
                              />
                              <span className="font-medium text-gray-800 truncate">{d.name}</span>
                              {d.is_section && <span className="text-[10px] text-gray-400 shrink-0">(Bộ phận)</span>}
                            </label>
                          ))
                        }
                        {activeTab === 'position' && positions
                          .filter(p => !empSearch || p.title.toLowerCase().includes(empSearch.toLowerCase()))
                          .map(p => (
                            <label key={p.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-primary-50 cursor-pointer text-sm transition-colors">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                                checked={form.position_ids.includes(p.id)}
                                onChange={() => setForm(f => ({ ...f, position_ids: toggleId(f.position_ids, p.id) }))}
                              />
                              <span className="text-gray-800 truncate">{p.title}</span>
                            </label>
                          ))
                        }
                        {activeTab === 'employee' && filteredEmps.map(e => (
                          <label key={e.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-primary-50 cursor-pointer text-sm transition-colors">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                              checked={form.employee_ids.includes(e.id)}
                              onChange={() => setForm(f => ({ ...f, employee_ids: toggleId(f.employee_ids, e.id) }))}
                            />
                            <span className="font-mono text-[11px] text-gray-400 w-14 shrink-0">{e.employee_id}</span>
                            <span className="font-medium text-gray-800 truncate">{e.full_name}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* ── Cột phải: Cấu hình ── */}
                <div className="col-span-full sm:col-span-3 p-5 space-y-4">

                  {/* Đơn giá tăng ca */}
                  <div className="rounded-xl border border-gray-100 p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Đơn giá tăng ca</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['FIXED', 'FROM_BASIC'] as const).map(method => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, calc_method: method }))}
                          className={`px-3 py-2.5 text-sm rounded-lg border-2 transition-colors text-left ${
                            form.calc_method === method
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <span className="block font-medium text-sm">
                            {method === 'FIXED' ? 'Cố định' : 'Từ lương cơ bản'}
                          </span>
                          <span className="text-xs opacity-60">
                            {method === 'FIXED' ? 'Nhập đơn giá trực tiếp' : 'LC ÷ công chuẩn ÷ 7.5h'}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        {form.calc_method === 'FIXED' ? (
                          <>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Đơn giá / giờ <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={rateDisplay}
                              onChange={e => {
                                const raw = e.target.value.replace(/\./g, '').replace(/[^\d]/g, '');
                                setRateDisplay(raw);
                                setForm(f => ({ ...f, rate_per_hour: Number(raw) || 0 }));
                              }}
                              onFocus={e => {
                                const raw = String(form.rate_per_hour || '');
                                setRateDisplay(raw === '0' ? '' : raw);
                                setTimeout(() => e.target.select(), 0);
                              }}
                              onBlur={() => setRateDisplay(formatThousands(form.rate_per_hour))}
                              className="input-field"
                              placeholder="VD: 20.000"
                            />
                          </>
                        ) : (
                          <div className="flex items-center h-full bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
                            <p className="text-xs text-primary-700 leading-relaxed">
                              <span className="font-semibold block">LC ÷ công chuẩn ÷ 7.5h</span>
                              Tự động theo lương cơ bản từng nhân viên
                            </p>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Hệ số nhân <span className="text-gray-400 font-normal">(mặc định 1)</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={multiplierDisplay}
                          onChange={e => {
                            const raw = e.target.value.replace(/[^\d.]/g, '');
                            setMultiplierDisplay(raw);
                            const n = parseFloat(raw);
                            if (!isNaN(n)) setForm(f => ({ ...f, multiplier: n }));
                          }}
                          onFocus={e => setTimeout(() => e.target.select(), 0)}
                          onBlur={() => {
                            const n = parseFloat(multiplierDisplay) || 1;
                            setForm(f => ({ ...f, multiplier: n }));
                            setMultiplierDisplay(formatMultiplier(n));
                          }}
                          className="input-field"
                          placeholder="VD: 1.5"
                        />
                        {form.calc_method === 'FIXED' && form.multiplier !== 1 && form.rate_per_hour > 0 && (
                          <p className="text-xs text-primary-600 mt-1">= {(form.rate_per_hour * form.multiplier).toLocaleString('vi-VN')}đ/h</p>
                        )}
                        {form.calc_method === 'FROM_BASIC' && form.multiplier !== 1 && (
                          <p className="text-xs text-primary-600 mt-1">= LC ÷ công ÷ 7.5h × {form.multiplier}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* KPI */}
                  <div className="rounded-xl border border-gray-100 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Hệ số KPI</p>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, use_kpi: !f.use_kpi }))}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.use_kpi ? 'bg-primary-500' : 'bg-gray-200'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.use_kpi ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {!form.use_kpi && (
                      <p className="text-xs text-gray-400">Bật để áp dụng hệ số khác khi nhân viên đạt KPI.</p>
                    )}
                    {form.use_kpi && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Hệ số × khi đạt KPI</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={kpiMultiplierDisplay}
                              onChange={e => {
                                const raw = e.target.value.replace(/[^\d.]/g, '');
                                setKpiMultiplierDisplay(raw);
                                const n = parseFloat(raw);
                                setForm(f => ({ ...f, kpi_multiplier: !isNaN(n) ? n : null }));
                              }}
                              onFocus={e => setTimeout(() => e.target.select(), 0)}
                              onBlur={() => {
                                const n = parseFloat(kpiMultiplierDisplay);
                                if (!isNaN(n)) {
                                  setForm(f => ({ ...f, kpi_multiplier: n }));
                                  setKpiMultiplierDisplay(formatMultiplier(n));
                                } else {
                                  setKpiMultiplierDisplay('');
                                }
                              }}
                              className="input-field"
                              placeholder="VD: 1.5"
                            />
                            <p className="text-[10px] text-gray-400 mt-0.5">= đơn giá × hệ số</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Ngưỡng KPI (%)</label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={form.kpi_threshold}
                              onChange={e => setForm(f => ({ ...f, kpi_threshold: Number(e.target.value) }))}
                              className="input-field"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Đơn giá cố định / giờ khi đạt KPI
                            <span className="text-gray-400 font-normal ml-1">(nếu không dùng hệ số ×)</span>
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={kpiRateDisplay}
                            onChange={e => {
                              const raw = e.target.value.replace(/\./g, '').replace(/[^\d]/g, '');
                              setKpiRateDisplay(raw);
                              setForm(f => ({ ...f, kpi_rate_per_hour: raw ? Number(raw) : null }));
                            }}
                            onFocus={e => {
                              const raw = form.kpi_rate_per_hour ? String(form.kpi_rate_per_hour) : '';
                              setKpiRateDisplay(raw);
                              setTimeout(() => e.target.select(), 0);
                            }}
                            onBlur={() => setKpiRateDisplay(formatThousands(form.kpi_rate_per_hour ?? 0))}
                            className="input-field"
                            placeholder="VD: 30.000"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Thời gian hiệu lực */}
                  <div className="rounded-xl border border-gray-100 p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Thời gian hiệu lực</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Từ ngày <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          value={form.effective_from}
                          onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
                          className="input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Đến ngày <span className="text-gray-400 font-normal">(trống = vô hạn)</span>
                        </label>
                        <input
                          type="date"
                          value={form.effective_to}
                          onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))}
                          className="input-field"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="is_active"
                        type="checkbox"
                        checked={form.is_active}
                        onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                      />
                      <span className="text-sm text-gray-700">Đang áp dụng</span>
                    </label>
                  </div>

                  {/* Ghi chú */}
                  <div className="rounded-xl border border-gray-100 p-4 space-y-2">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Ghi chú</p>
                    <textarea
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      rows={2}
                      placeholder="Ghi chú thêm về cấu hình này..."
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
                    />
                  </div>

                  {/* Error */}
                  {modalError && (
                    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                      <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
                      {modalError}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* ── Footer ── */}
            <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary"
              >
                Huỷ
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving
                  ? <><ArrowPathIcon className="h-4 w-4 animate-spin" />Đang lưu...</>
                  : <><CheckIcon className="h-4 w-4" />Lưu cấu hình</>
                }
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default OvertimeRateConfigPage;
