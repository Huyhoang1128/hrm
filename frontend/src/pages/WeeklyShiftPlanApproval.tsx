import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  addDays,
  apiError,
  dayLabel,
  formatDate,
  pendingStepLabel,
  STATUS_STYLE,
  weeklyShiftPlanService,
  WEEKDAY_LABELS,
  type UploadResult,
  type WeeklyShiftPlan,
  type WeeklyShiftPlanStatus,
} from '../services/weeklyShiftPlan.service';

const TABS: Array<{ key: WeeklyShiftPlanStatus; label: string }> = [
  { key: 'PENDING', label: 'Chờ duyệt' },
  { key: 'APPROVED', label: 'Đã duyệt' },
  { key: 'REJECTED', label: 'Từ chối' },
];

/** Duyệt kế hoạch ca tuần (quản lý trực tiếp / HCNS / Admin) + nhập / xuất Excel (HCNS / Admin). */
const WeeklyShiftPlanApproval: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.is_superuser === true || user?.is_supperuser === true || user?.role?.toUpperCase() === 'ADMIN';
  const isHR = user?.is_staff === true || user?.role?.toUpperCase() === 'HR';
  const canManageAll = isAdmin || isHR;

  const now = new Date();
  const [tab, setTab] = useState<WeeklyShiftPlanStatus>('PENDING');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState('');
  const [plans, setPlans] = useState<WeeklyShiftPlan[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WeeklyShiftPlan | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected([]);
    try {
      const params = { year, month, search: search.trim() || undefined };
      setPlans(
        tab === 'PENDING'
          ? await weeklyShiftPlanService.pendingApprovals(params)
          : await weeklyShiftPlanService.list({ ...params, status: tab }),
      );
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Không tải được danh sách kế hoạch ca.') });
    } finally {
      setLoading(false);
    }
  }, [tab, year, month, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [load]);

  const approvable = useMemo(() => plans.filter((p) => p.can_approve_now), [plans]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Thao tác thất bại.') });
    } finally {
      setBusy(false);
    }
  };

  const bulkApprove = () =>
    act(async () => {
      const res = await weeklyShiftPlanService.bulkApprove(selected);
      if (res.error_count) throw { response: { data: { detail: `Duyệt được ${res.success_count}, lỗi ${res.error_count}: ${res.errors[0]?.error}` } } };
    }, `Đã duyệt ${selected.length} kế hoạch.`);

  const handleUpload = async (file: File) => {
    setBusy(true);
    setMessage(null);
    setUploadResult(null);
    try {
      const result = await weeklyShiftPlanService.upload(file);
      setUploadResult(result);
      await load();
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Nhập file thất bại.') });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl">Duyệt kế hoạch ca</h1>
          <p className="mt-1 text-sm text-gray-600">Quản lý trực tiếp duyệt trước, sau đó HCNS duyệt.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard/weekly-shift-plan"
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Lập kế hoạch ca
          </Link>
          {canManageAll && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void handleUpload(e.target.files[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <ArrowUpTrayIcon className="h-4 w-4" /> Nhập Excel
              </button>
              <button
                type="button"
                onClick={() => void weeklyShiftPlanService.downloadTemplate()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                File mẫu
              </button>
              <button
                type="button"
                onClick={() => void weeklyShiftPlanService.exportMonthly(year, month)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> Xuất ca tháng {month}/{year}
              </button>
            </>
          )}
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-1.5 text-sm ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {message.ok ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationCircleIcon className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {uploadResult && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p className="font-semibold text-gray-800">
            Đã nhập {uploadResult.imported_days} ngày ({uploadResult.created_plans} kế hoạch mới, {uploadResult.updated_plans} cập nhật) từ{' '}
            {uploadResult.total_rows} dòng.
          </p>
          {uploadResult.failed.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-600">
              {uploadResult.failed.slice(0, 50).map((f) => (
                <li key={`f-${f.row}`}>Dòng {f.row}: {f.error}</li>
              ))}
            </ul>
          )}
          {uploadResult.warnings.length > 0 && (
            <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-xs text-amber-700">
              {uploadResult.warnings.slice(0, 20).map((w) => (
                <li key={`w-${w.row}`}>Dòng {w.row}: {w.warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs font-medium text-gray-600">
              Tháng
              <input
                type="month"
                value={`${year}-${String(month).padStart(2, '0')}`}
                onChange={(e) => {
                  const [y, m] = e.target.value.split('-').map(Number);
                  if (y && m) {
                    setYear(y);
                    setMonth(m);
                  }
                }}
                className="input-field"
              />
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mã hoặc tên nhân viên" className="input-field pl-9" />
            </div>
            {tab === 'PENDING' && (
              <button
                type="button"
                onClick={() => void bulkApprove()}
                disabled={busy || selected.length === 0}
                className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Duyệt {selected.length || ''} đã chọn
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
            <ArrowPathIcon className="h-5 w-5 animate-spin" /> Đang tải...
          </div>
        ) : plans.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Không có kế hoạch nào.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {tab === 'PENDING' && (
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={approvable.length > 0 && selected.length === approvable.length}
                        onChange={(e) => setSelected(e.target.checked ? approvable.map((p) => p.id) : [])}
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Nhân viên</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Tuần</th>
                  {WEEKDAY_LABELS.map((d) => (
                    <th key={d} className="px-2 py-2 text-left text-xs font-semibold uppercase text-gray-500">{d}</th>
                  ))}
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Trạng thái</th>
                  {tab === 'PENDING' && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {plans.map((p) => (
                  <tr key={p.id} className="align-top">
                    {tab === 'PENDING' && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={!p.can_approve_now}
                          checked={selected.includes(p.id)}
                          onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{p.employee_name}</p>
                      <p className="text-xs text-gray-500">{p.employee_code}{p.department_name ? ` · ${p.department_name}` : ''}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatDate(p.week_start_date)}</td>
                    {WEEKDAY_LABELS.map((_, i) => {
                      const day = p.days.find((d) => d.date === addDays(p.week_start_date, i));
                      return (
                        <td key={i} className="whitespace-nowrap px-2 py-2 text-xs text-gray-700">{dayLabel(day)}</td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}>{p.status_display}</span>
                      {pendingStepLabel(p) && <p className="mt-1 text-xs text-amber-700">{pendingStepLabel(p)}</p>}
                      {p.status === 'REJECTED' && <p className="mt-1 max-w-[12rem] text-xs text-red-600">{p.reject_reason}</p>}
                      {p.source === 'UPLOAD' && <p className="mt-1 text-xs text-gray-400">Nhập từ Excel</p>}
                    </td>
                    {tab === 'PENDING' && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={busy || !p.can_approve_now}
                          onClick={() => void act(() => weeklyShiftPlanService.approve(p.id), `Đã duyệt kế hoạch của ${p.employee_name}.`)}
                          className="mr-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                          title={p.can_approve_now ? '' : 'Chờ quản lý trực tiếp duyệt trước'}
                        >
                          Duyệt
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejectTarget(p);
                            setRejectReason('');
                          }}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Từ chối
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!rejectTarget}
        variant="warning"
        title="Từ chối kế hoạch ca?"
        message={rejectTarget ? `${rejectTarget.employee_name} — tuần ${formatDate(rejectTarget.week_start_date)}` : ''}
        confirmLabel="Từ chối"
        cancelLabel="Đóng"
        loading={busy}
        onConfirm={() => {
          if (!rejectTarget) return;
          const target = rejectTarget;
          setRejectTarget(null);
          void act(() => weeklyShiftPlanService.reject(target.id, rejectReason), `Đã từ chối kế hoạch của ${target.employee_name}.`);
        }}
        onClose={() => setRejectTarget(null)}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
          placeholder="Lý do từ chối (bắt buộc)"
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </ConfirmDialog>
    </div>
  );
};

export default WeeklyShiftPlanApproval;
