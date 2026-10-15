import React, { useEffect, useMemo, useState } from 'react';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import shiftRegistrationService, {
  CaBrief,
  ShiftOverviewDay,
  ShiftOverviewRow,
  ShiftScopeStatus, caLabels } from '../services/shiftRegistration.service';
import {
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';

const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

const toYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const getMonday = (d: Date): Date => {
  const x = new Date(d);
  const diff = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
};

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const fmtDM = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

const fmtTime = (t?: string | null): string => (t ? t.slice(0, 5) : '');

/** "Ca 1 (Sáng 07:30–12:00, Chiều 13:00–16:30)" — 1 ca luôn gồm 2 buổi. */
const caDisplayLabel = (caNumber: 1 | 2, ca: CaBrief | null): string => {
  if (!ca) return `Ca ${caNumber}`;
  const parts: string[] = [];
  if (ca.morning) parts.push(`Sáng ${fmtTime(ca.morning.start_time)}–${fmtTime(ca.morning.end_time)}`);
  if (ca.afternoon) parts.push(`Chiều ${fmtTime(ca.afternoon.start_time)}–${fmtTime(ca.afternoon.end_time)}`);
  return parts.length ? `Ca ${caNumber} (${parts.join(', ')})` : `Ca ${caNumber}`;
};

const extractError = (err: any, fallback: string): string => {
  const data = err?.response?.data;
  if (typeof data === 'string') return data;
  if (data?.error) return data.error;
  if (data?.detail) return data.detail;
  return fallback;
};

const DayBadge: React.FC<{
  registered: boolean;
  caChoice: 1 | 2 | null;
  morningCode: string | null;
  afternoonCode: string | null;
}> = ({ registered, caChoice, morningCode, afternoonCode }) => {
  if (!registered) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        Chưa đăng ký
      </span>
    );
  }
  if (!caChoice) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
        Nghỉ
      </span>
    );
  }
  const title = [morningCode && `Sáng: ${morningCode}`, afternoonCode && `Chiều: ${afternoonCode}`]
    .filter(Boolean)
    .join(' • ');
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200"
      title={title}
    >
      Ca {caChoice}
    </span>
  );
};

/**
 * Ô ngày cho nhóm requires_manager_approval=true (Điều dưỡng) — quản lý
 * trực tiếp (hoặc HR/Admin) đăng ký/duyệt/từ chối Ca 2 NGAY trong bảng,
 * không cần rời sang trang Phê duyệt. Thay hẳn DayBadge (chỉ xem) cho các
 * dòng thuộc nhóm này, theo yêu cầu HCNS 2026-09-17.
 *
 * Trạng thái hiển thị theo day.status:
 *   null       -> mặc định Ca 1, có nút "+ Ca 2" để đăng ký hộ (đồng thời tự
 *                 duyệt luôn vì chính quản lý trực tiếp là người bấm — không
 *                 bắt họ duyệt lại đơn của chính mình, nhưng vẫn ghi log 2
 *                 bước riêng ở backend để giữ audit trail).
 *   PENDING    -> nhân viên tự đăng ký, đang chờ — hiện nút Duyệt/Từ chối.
 *   APPROVED   -> hiện badge Ca 2 đã duyệt + nút "Huỷ" khi day.can_cancel
 *                 (nhân viên không làm ca đó nữa -> quay về ca mặc định;
 *                 backend cancel-ca2, thêm 2026-10-06).
 *   REJECTED / CANCELLED -> hiện badge bị từ chối / đã huỷ + cho đăng ký lại.
 *
 * Ngày ĐÃ QUA hạn (is_past_deadline) mà chưa có bản ghi nào vẫn hiện nút
 * "+ Ca 2" — bấm vào sẽ được backend trả lỗi rõ ràng (yêu cầu HCNS mở khoá
 * đặc biệt) nếu chưa có DeadlineExceptionGrant, đúng luồng "sửa sai Ca1/Ca2
 * hồi tố" (vd nhân viên đã lỡ làm Ca 2 nhưng quên đăng ký trước).
 */
const Ca2DayCell: React.FC<{
  day: ShiftOverviewDay;
  /** Tên ca PHẢI ĐĂNG KÝ của đúng nhân viên dòng này ("Ca 2" / "Ca 1"...). */
  regLabel: string;
  /** false => team đã ngừng ca phải đăng ký, không hiện nút đăng ký. */
  canRegister: boolean;
  busy: boolean;
  onRegister: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}> = ({ day, regLabel, canRegister, busy, onRegister, onApprove, onReject, onCancel }) => {
  const btnBase =
    'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed';

  if (day.status === 'PENDING') {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Chờ duyệt {regLabel}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onApprove}
            disabled={busy}
            className={`${btnBase} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
          >
            Duyệt
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className={`${btnBase} border-red-200 text-red-600 hover:bg-red-50`}
          >
            Từ chối
          </button>
        </div>
      </div>
    );
  }

  if (day.status === 'APPROVED') {
    return (
      <div className="flex flex-col items-center gap-1">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200"
          title={day.reviewed_by_name ? `Đã duyệt bởi ${day.reviewed_by_name}` : undefined}
        >
          {regLabel} ✓
        </span>
        {day.can_cancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className={`${btnBase} border-red-200 text-red-600 hover:bg-red-50`}
            title={`Nhân viên không làm ${regLabel} ngày này nữa — quay về ca mặc định`}
          >
            Huỷ
          </button>
        )}
      </div>
    );
  }

  // status === 'REJECTED' / 'CANCELLED' hoặc null (mặc định Ca 1, chưa có gì)
  return (
    <div className="flex flex-col items-center gap-1">
      {(day.status === 'REJECTED' || day.status === 'CANCELLED') && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500"
          title={day.status === 'CANCELLED' && day.reviewed_by_name ? `Huỷ bởi ${day.reviewed_by_name}` : undefined}
        >
          {regLabel} {day.status === 'CANCELLED' ? 'đã huỷ' : 'bị từ chối'}
        </span>
      )}
      {canRegister ? (
        <button
          onClick={onRegister}
          disabled={busy}
          className={`${btnBase} border-gray-200 text-gray-600 hover:bg-gray-50`}
          title={`Đăng ký + duyệt luôn ${regLabel} cho nhân viên vào ngày này`}
        >
          <PlusIcon className="h-3 w-3" /> {regLabel}
        </button>
      ) : (
        <span className="text-xs text-gray-400">-</span>
      )}
    </div>
  );
};

const ShiftRegistrationOverview: React.FC = () => {
  const [scope, setScope] = useState<ShiftScopeStatus | null>(null);
  const [loadingScope, setLoadingScope] = useState(true);
  const [weekMonday, setWeekMonday] = useState<Date>(() => addDays(getMonday(new Date()), 7));
  const [departmentId, setDepartmentId] = useState<number | 0>(0);
  const [rows, setRows] = useState<ShiftOverviewRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sửa hộ (chỉ HR/Admin) — dành cho nhóm đăng ký CẢ TUẦN (requires_manager_approval=false)
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [editSelections, setEditSelections] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Đăng ký/duyệt Ca 2 theo NGÀY (nhóm requires_manager_approval=true, vd
  // Điều dưỡng) — key busy theo `${employee_id}-${date}` để chỉ disable
  // đúng ô đang xử lý, không khoá cả bảng.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i)),
    [weekMonday]
  );

  // Ca 1/Ca 2 có thể khác nhau giữa các nhân viên (mỗi nhóm phòng ban/vị
  // trí/bác sĩ phụ trách có thể thuộc config riêng, giờ khác nhau) — PHẢI
  // lấy đúng ca_1/ca_2 của TỪNG DÒNG (row.ca_1/row.ca_2) khi sửa hộ, không
  // dùng chung ca_1/ca_2 của scope-status (đó là của người đang xem trang,
  // thường là HR/Admin — có thể null hoặc thuộc config khác hẳn).
  const getShiftOptionsForRow = (row: ShiftOverviewRow) => {
    const opts = [{ value: 0, label: 'Nghỉ' }];
    if (row.ca_1) opts.push({ value: 1, label: caDisplayLabel(1, row.ca_1) });
    if (row.ca_2) opts.push({ value: 2, label: caDisplayLabel(2, row.ca_2) });
    return opts;
  };

  const departmentOptions = useMemo(
    () => [
      { value: 0, label: 'Tất cả phòng ban' },
      ...(scope?.scope_departments || []).map((d) => ({ value: d.id, label: d.name })),
    ],
    [scope]
  );

  useEffect(() => {
    (async () => {
      try {
        const status = await shiftRegistrationService.getScopeStatus();
        setScope(status);
      } catch (err) {
        console.error('Lỗi kiểm tra quyền xem trang:', err);
        setScope({
          in_scope: false,
          ca_1: null,
          ca_2: null,
          requires_manager_approval: false,
          is_admin_or_hr: false,
          can_view_team_overview: false,
          scope_departments: [],
        });
      } finally {
        setLoadingScope(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (loadingScope || !scope?.can_view_team_overview) {
      if (!loadingScope) setLoadingRows(false);
      return;
    }
    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingScope, scope?.can_view_team_overview, weekMonday, departmentId]);

  const fetchOverview = async () => {
    setLoadingRows(true);
    setMessage(null);
    try {
      const data = await shiftRegistrationService.getTeamOverview({
        week_start_date: toYMD(weekMonday),
        ...(departmentId ? { department_id: departmentId } : {}),
      });
      setRows(data);
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Tải dữ liệu thất bại.') });
    } finally {
      setLoadingRows(false);
    }
  };

  const startEdit = (row: ShiftOverviewRow) => {
    const sel: Record<string, number> = {};
    weekDates.forEach((d) => {
      const ymd = toYMD(d);
      const day = row.days.find((x) => x.date === ymd);
      sel[ymd] = day?.ca_choice || 0;
    });
    setEditSelections(sel);
    setEditingEmployeeId(row.employee_id);
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingEmployeeId(null);
    setEditSelections({});
  };

  const saveEdit = async () => {
    if (!editingEmployeeId) return;
    setSaving(true);
    setMessage(null);
    try {
      const days = weekDates.map((d) => {
        const ymd = toYMD(d);
        const v = editSelections[ymd] || 0;
        return { date: ymd, ca: (v === 0 ? null : v) as 1 | 2 | null };
      });
      await shiftRegistrationService.save({
        employee_id: editingEmployeeId,
        week_start_date: toYMD(weekMonday),
        days,
      });
      setMessage({ type: 'success', text: 'Đã lưu đăng ký ca cho nhân viên.' });
      cancelEdit();
      fetchOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Lưu thất bại.') });
    } finally {
      setSaving(false);
    }
  };

  // ── Đăng ký/duyệt/từ chối Ca 2 theo ngày (nhóm requires_manager_approval) ──

  const handleRegisterCa2 = async (row: ShiftOverviewRow, dateStr: string) => {
    const key = `${row.employee_id}-${dateStr}`;
    setBusyKey(key);
    setMessage(null);
    try {
      const created = await shiftRegistrationService.registerCa2({
        employee_id: row.employee_id,
        date: dateStr,
      });
      // Chính quản lý trực tiếp là người bấm đăng ký hộ -> tự duyệt luôn
      // ngay sau đó, tránh bắt họ phải bấm thêm 1 lần "Duyệt" cho quyết
      // định của chính mình — backend vẫn ghi 2 bước riêng (register rồi
      // approve) nên vẫn giữ đủ audit trail (ai đăng ký, ai duyệt, lúc nào).
      await shiftRegistrationService.approveCa2(created.id);
      setMessage({ type: 'success', text: `Đã đăng ký và duyệt ${caLabels(row).reg} cho ${row.employee_name} ngày ${dateStr}.` });
      fetchOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, `Đăng ký ${caLabels(row).reg} thất bại.`) });
    } finally {
      setBusyKey(null);
    }
  };

  const handleApproveCa2 = async (row: ShiftOverviewRow, day: ShiftOverviewDay) => {
    if (!day.day_id) return;
    const key = `${row.employee_id}-${day.date}`;
    setBusyKey(key);
    setMessage(null);
    try {
      await shiftRegistrationService.approveCa2(day.day_id);
      setMessage({ type: 'success', text: `Đã duyệt ${caLabels(row).reg} cho ${row.employee_name} ngày ${day.date}.` });
      fetchOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Duyệt thất bại.') });
    } finally {
      setBusyKey(null);
    }
  };

  const handleRejectCa2 = async (row: ShiftOverviewRow, day: ShiftOverviewDay) => {
    if (!day.day_id) return;
    const key = `${row.employee_id}-${day.date}`;
    setBusyKey(key);
    setMessage(null);
    try {
      await shiftRegistrationService.rejectCa2(day.day_id);
      setMessage({ type: 'success', text: `Đã từ chối đăng ký ${caLabels(row).reg} của ${row.employee_name} ngày ${day.date}.` });
      fetchOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Từ chối thất bại.') });
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelCa2 = async (row: ShiftOverviewRow, day: ShiftOverviewDay) => {
    if (!day.day_id) return;
    const { def, reg } = caLabels(row);
    if (!window.confirm(`Huỷ ${reg} của ${row.employee_name} ngày ${day.date}? Ngày này sẽ quay về ${def} (mặc định).`)) return;
    const key = `${row.employee_id}-${day.date}`;
    setBusyKey(key);
    setMessage(null);
    try {
      await shiftRegistrationService.cancelCa2(day.day_id);
      setMessage({ type: 'success', text: `Đã huỷ ${reg} của ${row.employee_name} ngày ${day.date} — quay về ${def}.` });
      fetchOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Huỷ thất bại.') });
    } finally {
      setBusyKey(null);
    }
  };

  if (loadingScope) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        <p className="text-sm text-gray-500">Đang tải...</p>
      </div>
    );
  }

  if (!scope?.can_view_team_overview) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
        <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <p className="text-sm font-semibold text-gray-700">Bạn không có quyền truy cập trang này.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
            Quản lý đăng ký ca làm
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {scope.is_admin_or_hr
              ? 'Theo dõi việc đăng ký ca làm của toàn bộ nhân viên trong phạm vi áp dụng'
              : 'Theo dõi cấp dưới trực tiếp — nhóm cần duyệt ca theo ngày (vd Điều dưỡng, Sale BS Minh Trung) có thể đăng ký/duyệt ngay ở đây, nhóm khác chỉ xem'}
          </p>
        </div>
        {scope.is_admin_or_hr && departmentOptions.length > 1 && (
          <div className="w-56">
            <SelectBox<number>
              label=""
              value={departmentId}
              options={departmentOptions}
              onChange={(v) => setDepartmentId(v)}
              placeholder="Lọc theo phòng ban..."
              portal
            />
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button
            onClick={() => setWeekMonday((w) => addDays(w, -7))}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ChevronLeftIcon className="h-4 w-4" /> Tuần trước
          </button>
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <ClockIcon className="h-5 w-5 text-primary-600" />
            Tuần {fmtDM(weekDates[0])} – {fmtDM(weekDates[6])}
          </div>
          <button
            onClick={() => setWeekMonday((w) => addDays(w, 7))}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Tuần sau <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>

        {message && (
          <div
            className={`mx-5 mt-4 flex items-center gap-2 text-sm rounded-xl px-3 py-2 border ${
              message.type === 'success'
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-red-700 bg-red-50 border-red-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
            ) : (
              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
            )}
            {message.text}
          </div>
        )}

        {loadingRows ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            <p className="text-sm text-gray-500">Đang tải...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">
            Không có nhân viên nào thuộc phạm vi để hiển thị.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
                  <th className="px-4 py-3">Mã NV</th>
                  <th className="px-4 py-3">Họ tên</th>
                  <th className="px-4 py-3">Phòng ban</th>
                  {weekDates.map((d, idx) => (
                    <th key={idx} className="px-3 py-3 text-center whitespace-nowrap">
                      {DAY_LABELS[idx]}
                      <div className="text-[10px] font-normal text-gray-400">{fmtDM(d)}</div>
                    </th>
                  ))}
                  {scope.is_admin_or_hr && <th className="px-4 py-3 text-center">Sửa</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row) => {
                  const isEditing = editingEmployeeId === row.employee_id;
                  return (
                    <tr key={row.employee_id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                        {row.employee_code}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.employee_name}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {row.department_name || '-'}
                      </td>
                      {weekDates.map((d, idx) => {
                        const ymd = toYMD(d);
                        if (row.requires_manager_approval) {
                          // Nhóm Điều dưỡng: luôn hiện nút hành động theo
                          // ngày ngay trong ô, không cần bấm "Sửa" trước.
                          const day = row.days.find((x) => x.date === ymd);
                          if (!day) return <td key={idx} className="px-3 py-3 text-center">-</td>;
                          const key = `${row.employee_id}-${ymd}`;
                          return (
                            <td key={idx} className="px-2 py-2 text-center">
                              <Ca2DayCell
                                day={day}
                                regLabel={caLabels(row).reg}
                                canRegister={caLabels(row).canRegister}
                                busy={busyKey === key}
                                onRegister={() => handleRegisterCa2(row, ymd)}
                                onApprove={() => handleApproveCa2(row, day)}
                                onReject={() => handleRejectCa2(row, day)}
                                onCancel={() => handleCancelCa2(row, day)}
                              />
                            </td>
                          );
                        }
                        if (isEditing) {
                          return (
                            <td key={idx} className="px-2 py-2 min-w-[140px]">
                              <SelectBox<number>
                                label=""
                                value={editSelections[ymd] ?? 0}
                                options={getShiftOptionsForRow(row)}
                                onChange={(v) => setEditSelections((prev) => ({ ...prev, [ymd]: v }))}
                                placeholder="Chọn ca..."
                                portal
                              />
                            </td>
                          );
                        }
                        const day = row.days.find((x) => x.date === ymd);
                        return (
                          <td key={idx} className="px-3 py-3 text-center">
                            <DayBadge
                              registered={!!day?.registered}
                              caChoice={day?.ca_choice ?? null}
                              morningCode={day?.morning_shift_code || null}
                              afternoonCode={day?.afternoon_shift_code || null}
                            />
                          </td>
                        );
                      })}
                      {scope.is_admin_or_hr && (
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {row.requires_manager_approval ? (
                            // Nhóm Điều dưỡng: hành động đã nằm ngay trong
                            // từng ô ngày (Ca2DayCell) — nút "Sửa"/save() cũ
                            // không áp dụng được cho nhóm này (bị chặn 403).
                            <span className="text-xs text-gray-300">—</span>
                          ) : isEditing ? (
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={cancelEdit}
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                              >
                                Huỷ
                              </button>
                              <button
                                onClick={saveEdit}
                                disabled={saving}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                              >
                                {saving ? 'Đang lưu...' : 'Lưu'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(row)}
                              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                            >
                              <PencilSquareIcon className="h-3.5 w-3.5" /> Sửa
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftRegistrationOverview;
