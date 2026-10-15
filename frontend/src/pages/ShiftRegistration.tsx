import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import shiftRegistrationService, {
  CaBrief,
  ShiftRegistration as ShiftRegistrationType,
  ShiftScopeStatus,
} from '../services/shiftRegistration.service';
import {
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';

const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

const toYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const getMonday = (d: Date): Date => {
  const x = new Date(d);
  const diff = (x.getDay() + 6) % 7; // số ngày kể từ Thứ 2
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
  if (Array.isArray(data) && data.length) return String(data[0]);
  if (data && typeof data === 'object') {
    const firstKey = Object.keys(data)[0];
    const v = data[firstKey];
    if (Array.isArray(v)) return `${firstKey}: ${v[0]}`;
    if (typeof v === 'string') return v;
  }
  return fallback;
};

const ShiftRegistration: React.FC = () => {
  const { user } = useAuth();
  const employeeId: number | undefined = (user as any)?.employee_profile?.id;

  const [scope, setScope] = useState<ShiftScopeStatus | null>(null);
  const [loadingScope, setLoadingScope] = useState(true);
  const [weekMonday, setWeekMonday] = useState<Date>(() => addDays(getMonday(new Date()), 7));
  const [existingReg, setExistingReg] = useState<ShiftRegistrationType | null>(null);
  const [selections, setSelections] = useState<Record<string, number>>({}); // dateYMD -> 0=Nghỉ, 1=Ca1, 2=Ca2
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Đơn đổi ca (đổi Ca 1 <-> Ca 2 cho 1 ngày cụ thể trong tương lai — luôn đổi cả sáng+chiều)
  const [swapDate, setSwapDate] = useState<string | null>(null);
  const [swapReason, setSwapReason] = useState('');
  const [submittingSwap, setSubmittingSwap] = useState(false);
  const [swappedDates, setSwappedDates] = useState<Set<string>>(new Set());

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i)),
    [weekMonday]
  );

  const shiftOptions = useMemo(() => {
    const opts = [{ value: 0, label: 'Nghỉ' }];
    if (scope?.ca_1) opts.push({ value: 1, label: caDisplayLabel(1, scope.ca_1) });
    if (scope?.ca_2) opts.push({ value: 2, label: caDisplayLabel(2, scope.ca_2) });
    return opts;
  }, [scope]);

  // Hạn đăng ký: hết Thứ 7 (23:59:59) tuần liền trước
  const deadline = useMemo(() => {
    if (existingReg?.registration_deadline) return new Date(existingReg.registration_deadline);
    const sat = addDays(weekMonday, -2);
    sat.setHours(23, 59, 59, 999);
    return sat;
  }, [existingReg, weekMonday]);

  const pastDeadline = new Date() > deadline;
  const canEdit = !!scope?.in_scope && !pastDeadline;

  // Kiểm tra phạm vi áp dụng 1 lần
  useEffect(() => {
    (async () => {
      try {
        const status = await shiftRegistrationService.getScopeStatus();
        setScope(status);
      } catch (err) {
        console.error('Lỗi kiểm tra phạm vi đăng ký ca làm:', err);
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

  // Load đăng ký của tuần đang chọn (chỉ khi đã xác định thuộc phạm vi)
  useEffect(() => {
    if (loadingScope) return;
    if (!scope?.in_scope) {
      setLoadingWeek(false);
      return;
    }
    fetchWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingScope, scope?.in_scope, weekMonday]);

  const fetchWeek = async () => {
    setLoadingWeek(true);
    setMessage(null);
    try {
      const regs = await shiftRegistrationService.list({ week_start_date: toYMD(weekMonday) });
      const reg = regs.find((r) => r.employee === employeeId) || regs[0] || null;
      setExistingReg(reg);

      const sel: Record<string, number> = {};
      weekDates.forEach((d) => {
        sel[toYMD(d)] = 0;
      });
      if (reg) {
        reg.days.forEach((day) => {
          sel[day.date] = day.ca_choice ?? 0;
        });
      }
      setSelections(sel);
    } catch (err) {
      console.error('Lỗi tải đăng ký tuần:', err);
    } finally {
      setLoadingWeek(false);
    }
  };

  const buildDays = () =>
    weekDates.map((d) => {
      const ymd = toYMD(d);
      const v = selections[ymd] || 0;
      return { date: ymd, ca: (v === 0 ? null : v) as 1 | 2 | null };
    });

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const reg = await shiftRegistrationService.save({
        week_start_date: toYMD(weekMonday),
        days: buildDays(),
      });
      setExistingReg(reg);
      setMessage({ type: 'success', text: 'Đã lưu đăng ký ca làm cho tuần này.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Lưu đăng ký thất bại.') });
    } finally {
      setSaving(false);
    }
  };

  // Chỉ có đúng 2 lựa chọn (Ca 1/Ca 2) nên "ca còn lại" luôn xác định được.
  const otherCa = (caChoice: number): 1 | 2 | null => {
    if (caChoice === 1) return 2;
    if (caChoice === 2) return 1;
    return null;
  };

  const shiftLabel = (caChoice: number | null): string => {
    if (!caChoice) return 'Nghỉ';
    if (caChoice === 1) return caDisplayLabel(1, scope?.ca_1 || null);
    if (caChoice === 2) return caDisplayLabel(2, scope?.ca_2 || null);
    return '';
  };

  // TẮT tính năng đổi ca (2026-09-23, yêu cầu HCNS): tra dữ liệu thật thì toàn
  // hệ thống có ĐÚNG 0 đơn đổi ca từ trước tới nay, nên ẩn nút đi cho đỡ rối và
  // tránh có người lỡ tạo đơn mà không ai để ý duyệt (chip lọc loại đơn này ở
  // trang Phê duyệt cũng đã bỏ). Toàn bộ code tạo/duyệt vẫn còn nguyên —
  // đổi cờ này về true là dùng lại được ngay.
  const SHIFT_SWAP_ENABLED = false;

  // Chỉ cho phép tạo đơn đổi ca cho ngày TRONG TƯƠNG LAI (đã đăng ký Ca 1/Ca 2)
  // — khớp rule backend: làm đơn trước ngày đổi ca, trong/sau ngày sẽ không được.
  const canSwap = (ymd: string, caChoice: number): boolean => {
    if (!SHIFT_SWAP_ENABLED) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(`${ymd}T00:00:00`);
    return d > today && otherCa(caChoice) !== null && !swappedDates.has(ymd);
  };

  const handleSubmitSwap = async () => {
    if (!swapDate || !employeeId) return;
    const currentCa = selections[swapDate];
    const toCa = otherCa(currentCa);
    if (!toCa) return;
    if (!swapReason.trim()) {
      setMessage({ type: 'error', text: 'Vui lòng nhập lý do đổi ca.' });
      return;
    }
    setSubmittingSwap(true);
    setMessage(null);
    try {
      await shiftRegistrationService.createShiftChangeRequest({
        employee_id: employeeId,
        attendance_date: swapDate,
        to_ca: toCa,
        reason: swapReason.trim(),
      });
      setSwappedDates((prev) => new Set(prev).add(swapDate));
      setSwapDate(null);
      setSwapReason('');
      setMessage({
        type: 'success',
        text: 'Đã gửi đơn đổi ca, chờ quản lý trực tiếp và HR duyệt (xem ở trang Đơn từ & Phê duyệt).',
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Tạo đơn đổi ca thất bại.') });
    } finally {
      setSubmittingSwap(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Đăng ký ca làm</h1>
          <p className="mt-1 text-sm text-gray-500">
            Chọn ca làm cho từng ngày trong tuần — có hiệu lực ngay khi lưu (không cần duyệt). Mỗi
            ca gồm cả buổi sáng và buổi chiều.
          </p>
        </div>
      </div>

      {loadingScope ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          <p className="text-sm text-gray-500">Đang tải...</p>
        </div>
      ) : !scope?.in_scope ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-amber-500 mb-3" />
          <p className="text-sm font-semibold text-gray-700">
            Bạn không thuộc phạm vi áp dụng tính năng Đăng ký ca làm
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Tính năng này chỉ áp dụng cho một số phòng ban/vị trí nhất định. Liên hệ HR nếu bạn cho
            rằng đây là nhầm lẫn.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          {/* Week navigator */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <button
              onClick={() => setWeekMonday((w) => addDays(w, -7))}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <ChevronLeftIcon className="h-4 w-4" /> Tuần trước
            </button>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-sm font-bold text-gray-900">
                <ClockIcon className="h-5 w-5 text-primary-600" />
                Tuần {fmtDM(weekDates[0])} – {fmtDM(weekDates[6])}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Hạn đăng ký: {deadline.toLocaleString('vi-VN')} (hết Thứ 7 tuần trước)
              </p>
            </div>
            <button
              onClick={() => setWeekMonday((w) => addDays(w, 7))}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Tuần sau <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>

          {loadingWeek ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <p className="text-sm text-gray-500">Đang tải...</p>
            </div>
          ) : (
            <>
              {!canEdit && pastDeadline && (
                <div className="mx-5 mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Đã quá hạn đăng ký cho tuần này (hạn: hết Thứ 7 tuần trước). Nếu cần thay đổi ca
                  cho 1 ngày cụ thể, liên hệ quản lý trực tiếp hoặc HCNS
                  — đơn sẽ cần quản lý trực tiếp và HR duyệt.
                </div>
              )}
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

              {/* Lưới ngày */}
              <div className="p-5 space-y-3">
                {weekDates.map((d, idx) => {
                  const ymd = toYMD(d);
                  const currentCa = selections[ymd] ?? 0;
                  const eligibleForSwap = canSwap(ymd, currentCa);
                  const alreadySwapped = swappedDates.has(ymd);
                  return (
                    <div key={ymd} className="border border-gray-100 rounded-xl px-4 py-3">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="sm:w-40 flex-shrink-0">
                          <p className="text-sm font-semibold text-gray-900">{DAY_LABELS[idx]}</p>
                          <p className="text-xs text-gray-400">{fmtDM(d)}</p>
                        </div>
                        <div className="flex-1">
                          {canEdit ? (
                            <SelectBox<number>
                              label=""
                              value={currentCa}
                              options={shiftOptions}
                              onChange={(v) => setSelections((prev) => ({ ...prev, [ymd]: v }))}
                              placeholder="Chọn ca..."
                              portal
                            />
                          ) : (
                            <span className="text-sm text-gray-700">{shiftLabel(currentCa)}</span>
                          )}
                        </div>
                        {(eligibleForSwap || alreadySwapped) && (
                          <button
                            onClick={() => {
                              setSwapDate(swapDate === ymd ? null : ymd);
                              setSwapReason('');
                            }}
                            disabled={alreadySwapped}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                            title="Tạo đơn đổi ca cho ngày này (cần QLTT + HR duyệt)"
                          >
                            <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
                            {alreadySwapped ? 'Đã gửi đơn đổi ca' : 'Đổi ca'}
                          </button>
                        )}
                      </div>

                      {swapDate === ymd && (
                        <div className="mt-3 pt-3 border-t border-dashed border-gray-200 space-y-2">
                          <p className="text-xs text-gray-600">
                            Đổi từ <b>{shiftLabel(currentCa)}</b> sang{' '}
                            <b>{shiftLabel(otherCa(currentCa))}</b> cho ngày {fmtDM(d)} (đổi cả
                            buổi sáng và chiều).
                          </p>
                          <textarea
                            value={swapReason}
                            onChange={(e) => setSwapReason(e.target.value)}
                            rows={2}
                            placeholder="Lý do đổi ca..."
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setSwapDate(null)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                            >
                              Huỷ
                            </button>
                            <button
                              onClick={handleSubmitSwap}
                              disabled={submittingSwap}
                              className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                            >
                              {submittingSwap ? 'Đang gửi...' : 'Gửi đơn đổi ca'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer actions */}
              {canEdit && (
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu đăng ký'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ShiftRegistration;
