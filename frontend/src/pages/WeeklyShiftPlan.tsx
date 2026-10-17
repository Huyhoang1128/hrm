import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockClosedIcon,
  LockOpenIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { employeesAPI } from '../utils/api';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import {
  addDays,
  apiError,
  formatDate,
  mondayOf,
  pendingStepLabel,
  STATUS_STYLE,
  weeklyShiftPlanService,
  WEEKDAY_LABELS,
  type PlanDayInput,
  type ShiftBrief,
  type WeeklyShiftPlan as Plan,
} from '../services/weeklyShiftPlan.service';

interface DayRow {
  shift: number | '';
  shift_2: number | '';
  /** Ca online cộng thêm (không chấm công) */
  extra: number | '';
}

const emptyWeek = (): DayRow[] => Array.from({ length: 7 }, () => ({ shift: '', shift_2: '', extra: '' }));

/**
 * Kế hoạch ca theo tuần: chọn ca cho từng ngày (để trống = nghỉ), lưu nháp, gửi duyệt —
 * quản lý trực tiếp duyệt rồi HCNS duyệt. Đã duyệt thì chấm công tính theo ca trong kế hoạch.
 */
const WeeklyShiftPlan: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.is_superuser === true || user?.is_supperuser === true || user?.role?.toUpperCase() === 'ADMIN';
  const isHR = user?.is_staff === true || user?.role?.toUpperCase() === 'HR';
  const canManageAll = isAdmin || isHR;
  const canApprove = canManageAll || user?.is_manager === true || user?.employee_permission?.can_approve_attendance === true;

  const [week, setWeek] = useState(() => addDays(mondayOf(new Date()), 7));
  const [meId, setMeId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [employees, setEmployees] = useState<Array<{ value: number | ''; label: string }>>([]);
  const [shifts, setShifts] = useState<ShiftBrief[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rows, setRows] = useState<DayRow[]>(emptyWeek());
  const [lock, setLock] = useState<{ is_locked: boolean; note: string }>({ is_locked: false, note: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const editable = !plan || plan.status === 'DRAFT' || plan.status === 'REJECTED';
  const disabled = !editable || lock.is_locked || busy;

  useEffect(() => {
    employeesAPI.me().then((me) => {
      setMeId(me.id);
      setEmployeeId(me.id);
    }).catch(() => setMeId(null));
    weeklyShiftPlanService.allowedShifts().then(setShifts).catch(() => setShifts([]));
    weeklyShiftPlanService.lockStatus().then(setLock).catch(() => undefined);
    if (canManageAll) {
      employeesAPI.list({ page_size: 1000, is_active: true, ordering: 'employee_id' })
        .then((res) => setEmployees(res.results.map((e) => ({ value: e.id, label: `${e.employee_id} - ${e.full_name}` }))))
        .catch(() => setEmployees([]));
    }
  }, [canManageAll]);

  const load = useCallback(async () => {
    if (employeeId === '') return;
    setLoading(true);
    setMessage(null);
    try {
      const [found] = await weeklyShiftPlanService.list({ week_start_date: week, employee: employeeId });
      setPlan(found ?? null);
      const next = emptyWeek();
      found?.days.forEach((d) => {
        const index = dates.indexOf(d.date);
        if (index >= 0) next[index] = { shift: d.shift ?? '', shift_2: d.shift_2 ?? '', extra: d.extra_shift ?? '' };
      });
      setRows(next);
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Không tải được kế hoạch ca.') });
    } finally {
      setLoading(false);
    }
  }, [employeeId, week, dates]);

  useEffect(() => {
    void load();
  }, [load]);

  const payload = (): PlanDayInput[] =>
    rows.map((r, i) => ({
      date: dates[i],
      shift: r.shift === '' ? null : r.shift,
      shift_2: r.shift_2 === '' ? null : r.shift_2,
      extra_shift: r.extra === '' ? null : r.extra,
    }));

  const run = async (fn: () => Promise<Plan | void>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      if (result) setPlan(result);
      await load();
      setMessage({ ok: true, text: ok });
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Thao tác thất bại.') });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(
      () =>
        plan
          ? weeklyShiftPlanService.update(plan.id, payload())
          : weeklyShiftPlanService.create({
              week_start_date: week,
              days: payload(),
              employee_id: employeeId !== '' && employeeId !== meId ? employeeId : undefined,
            }),
      'Đã lưu nháp.',
    );

  const submit = () =>
    run(async () => {
      const saved = plan
        ? await weeklyShiftPlanService.update(plan.id, payload())
        : await weeklyShiftPlanService.create({
            week_start_date: week,
            days: payload(),
            employee_id: employeeId !== '' && employeeId !== meId ? employeeId : undefined,
          });
      return weeklyShiftPlanService.submit(saved.id);
    }, 'Đã gửi duyệt.');

  const remove = () => {
    if (!plan || !window.confirm('Xoá kế hoạch ca của tuần này?')) return;
    void run(() => weeklyShiftPlanService.remove(plan.id), 'Đã xoá kế hoạch.');
  };

  const toggleLock = async () => {
    try {
      setLock(await weeklyShiftPlanService.toggleLock(!lock.is_locked));
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Không đổi được trạng thái khoá.') });
    }
  };

  const shiftLabel = (s: ShiftBrief) => `${s.code} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
  const shiftOptions = [
    { value: '' as const, label: 'Nghỉ / không chọn' },
    ...shifts.filter((s) => !s.no_attendance_required).map((s) => ({ value: s.id, label: shiftLabel(s) })),
  ];
  // Ca online cộng thêm: không chấm công, được số công cố định của ca (mặc định 0,5)
  const onlineOptions = [
    { value: '' as const, label: 'Không có ca online' },
    ...shifts
      .filter((s) => s.no_attendance_required)
      .map((s) => ({ value: s.id, label: `${shiftLabel(s)} · +${s.fixed_workday != null ? Number(s.fixed_workday) : 0.5} công` })),
  ];
  const hasOnline = onlineOptions.length > 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl">Kế hoạch ca tuần</h1>
          <p className="mt-1 text-sm text-gray-600">
            Chọn ca cho từng ngày rồi gửi duyệt (quản lý trực tiếp → HCNS). Đã duyệt thì chấm công tính theo ca trong kế hoạch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <Link
              to="/dashboard/weekly-shift-plan/approval"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Duyệt kế hoạch ca
            </Link>
          )}
          {canManageAll && (
            <button
              type="button"
              onClick={toggleLock}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {lock.is_locked ? <LockOpenIcon className="h-4 w-4" /> : <LockClosedIcon className="h-4 w-4" />}
              {lock.is_locked ? 'Mở khoá kế hoạch' : 'Khoá kế hoạch'}
            </button>
          )}
        </div>
      </div>

      {lock.is_locked && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <LockClosedIcon className="h-4 w-4" />
          Kế hoạch ca đang bị khoá — không tạo / sửa / gửi được.{lock.note ? ` ${lock.note}` : ''}
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setWeek(addDays(week, -7))} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold text-gray-800">
              Tuần {formatDate(week)} – {formatDate(addDays(week, 6))}
            </div>
            <button type="button" onClick={() => setWeek(addDays(week, 7))} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          {canManageAll && (
            <div className="sm:w-80">
              <SelectBox<number | ''> label="Nhân viên" value={employeeId} options={employees} onChange={setEmployeeId} searchable />
            </div>
          )}
        </div>

        {plan && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[plan.status]}`}>{plan.status_display}</span>
            {pendingStepLabel(plan) && <span className="text-xs text-amber-700">{pendingStepLabel(plan)}</span>}
            {plan.status === 'APPROVED' && plan.approved_by_name && (
              <span className="text-xs text-gray-500">Duyệt bởi {plan.approved_by_name}</span>
            )}
            {plan.status === 'REJECTED' && (
              <span className="text-xs text-red-600">
                Từ chối{plan.rejected_by_name ? ` bởi ${plan.rejected_by_name}` : ''}: {plan.reject_reason}
              </span>
            )}
          </div>
        )}

        {message && (
          <div className={`flex items-center gap-1.5 text-sm ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>
            {message.ok ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationCircleIcon className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <ArrowPathIcon className="h-5 w-5 animate-spin" /> Đang tải...
          </div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {dates.map((date, i) => (
              <div
                key={date}
                className={`grid grid-cols-1 gap-2 px-3 py-3 sm:items-center ${hasOnline ? 'sm:grid-cols-[9rem_1fr_1fr_1fr]' : 'sm:grid-cols-[9rem_1fr_1fr]'}`}
              >
                <div className="text-sm font-medium text-gray-800">
                  {WEEKDAY_LABELS[i]} <span className="text-gray-400">{formatDate(date)}</span>
                </div>
                <SelectBox<number | ''>
                  label=""
                  value={rows[i].shift}
                  options={shiftOptions}
                  onChange={(v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, shift: v, shift_2: v === '' ? '' : r.shift_2 } : r)))}
                  disabled={disabled}
                  searchable
                />
                <SelectBox<number | ''>
                  label=""
                  value={rows[i].shift_2}
                  options={[{ value: '' as const, label: 'Không có ca thứ 2' }, ...shiftOptions.slice(1)]}
                  onChange={(v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, shift_2: v } : r)))}
                  disabled={disabled || rows[i].shift === ''}
                  searchable
                />
                {hasOnline && (
                  <SelectBox<number | ''>
                    label=""
                    value={rows[i].extra}
                    options={onlineOptions}
                    onChange={(v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, extra: v } : r)))}
                    disabled={disabled}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {plan && editable && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Xoá
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={disabled || employeeId === ''}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Lưu nháp
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={disabled || employeeId === ''}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? 'Đang gửi...' : 'Gửi duyệt'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WeeklyShiftPlan;
