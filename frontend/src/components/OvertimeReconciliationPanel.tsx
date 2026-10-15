import React, { useEffect, useState, useCallback } from 'react';
import overtimeReconciliationService, {
  ACTIONABLE_TABS,
  AUTO_FIX_ELIGIBLE_STATUSES,
  HR_DECISION_LABEL,
  OT_RECONCILIATION_TABS,
  OvertimeReconciliationRow,
  OvertimeReconciliationTab,
} from '../services/overtimeReconciliation.service';
import { approvalService } from '../services/approval.service';
import ConfirmDialog from './ConfirmDialog';
import { toDisplayDate } from '../utils/dateUtils';

// Đối chiếu tăng ca (chỉ HR/admin) — theo yêu cầu HCNS 2026-09-18: "còn front
// end đối xoát thì để trong Đơn từ & Phê duyệt. Dưới phê duyệt làm thêm 1
// option là đối chiếu tăng ca" + "lọc ra theo các trường hợp thành nhiều tab"
// + "làm cái endpoint duyệt, từ chối, sửa auto, sửa tay ... trên màn đó luôn"
// + (đợt sau) "sửa lại cho đơn giản hơn, focus vào việc duyệt và chưa duyệt
// hơn" — chỉ còn 2 tab (Chưa duyệt/Đã duyệt), tháng 8 trở về trước ẩn hẳn
// (đã đối soát/xử lý thủ công từ trước, xem policy_note của backend).
//
// 2026-09-22 (họp với Sếp): trường hợp OT thực tế NHIỀU hơn đăng ký ("excess")
// giờ do QLTT trực tiếp tự vào sửa (hạn 10h sáng ngày kế tiếp), không còn là
// việc riêng của HR — panel này giờ dùng chung cho cả HR/Admin lẫn quản lý
// trực tiếp (isHRAdmin=false), chỉ khác nhau ở các nút được phép bấm.

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ok: { label: 'Khớp', className: 'bg-emerald-100 text-emerald-700' },
  // 'shortfall' giữ lại để hiển thị đúng các bản ghi cũ trước 2026-09-22
  // (từ nay hệ thống tự áp dụng ngay, xem 'auto_corrected_shortfall').
  shortfall: { label: 'Về sớm', className: 'bg-amber-100 text-amber-700' },
  auto_corrected_shortfall: { label: 'Đã tự sửa (về sớm)', className: 'bg-teal-100 text-teal-700' },
  excess: { label: 'OT nhiều hơn đăng ký', className: 'bg-indigo-100 text-indigo-700' },
  missing_checkin_note: { label: 'Ghi nhầm check-in', className: 'bg-sky-100 text-sky-700' },
  scope_mismatch: { label: 'Sai phạm vi', className: 'bg-orange-100 text-orange-700' },
  multi_segment_reason: { label: 'Nhiều khung giờ', className: 'bg-purple-100 text-purple-700' },
  no_attendance_data: { label: 'Thiếu dữ liệu', className: 'bg-rose-100 text-rose-700' },
  needs_manual_review: { label: 'Cần xem tay', className: 'bg-rose-100 text-rose-700' },
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function formatTime(t?: string | null): string {
  if (!t) return '—';
  return t.slice(0, 5);
}

// Hiển thị hạn sửa đơn 'excess' (ISO datetime từ backend) dạng dd/mm/yyyy HH:mm.
function formatDeadline(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isDeadlinePassed(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

const extractError = (err: any, fallback: string): string =>
  err?.response?.data?.error || fallback;

type PendingConfirm =
  | { type: 'auto_fix'; row: OvertimeReconciliationRow }
  | { type: 'reject'; row: OvertimeReconciliationRow; note: string };

interface OvertimeReconciliationPanelProps {
  // true = HR/Admin (toàn quyền: Duyệt/Từ chối/Sửa auto/Sửa tay mọi trạng thái).
  // false = quản lý trực tiếp: chỉ thấy "Sửa tay" cho đơn 'excess' (trong hạn)
  // + "Từ chối" (backend tự chặn nếu không phải QLTT của nhân viên đó).
  isHRAdmin?: boolean;
}

const OvertimeReconciliationPanel: React.FC<OvertimeReconciliationPanelProps> = ({ isHRAdmin = true }) => {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [tab, setTab] = useState<OvertimeReconciliationTab>('pending');
  const [rows, setRows] = useState<OvertimeReconciliationRow[]>([]);
  const [summary, setSummary] = useState<Record<OvertimeReconciliationTab, number> | null>(null);
  const [policyNote, setPolicyNote] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [manualFixId, setManualFixId] = useState<number | null>(null);
  const [manualCheckIn, setManualCheckIn] = useState('');
  const [manualCheckOut, setManualCheckOut] = useState('');
  const [rowMessage, setRowMessage] = useState<{ id: number; type: 'success' | 'error'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await overtimeReconciliationService.getReconciliation({
        month,
        year,
        tab,
        page_size: 200,
      });
      setRows(data.results || []);
      setSummary(data.summary || null);
      setPolicyNote(data.policy_note || null);
      setCount(data.count || 0);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không tải được dữ liệu đối chiếu tăng ca.');
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [month, year, tab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sau khi 1 hành động thành công: đơn không còn thuộc tab đang xem nữa
  // (đã chuyển sang "Đã duyệt" hoặc biến mất nếu Từ chối) -> tải lại cả
  // trang hiện tại để summary/tab luôn khớp với dữ liệu server.
  const refreshAfterAction = () => {
    setManualFixId(null);
    setConfirmState(null);
    fetchData();
  };

  const years = [today.getFullYear(), today.getFullYear() - 1];
  const isActionableTab = ACTIONABLE_TABS.includes(tab);

  const handleAccept = async (row: OvertimeReconciliationRow) => {
    setBusyId(row.event_id);
    setRowMessage(null);
    try {
      await overtimeReconciliationService.reconciliationAction(row.event_id, { action: 'accept' });
      refreshAfterAction();
    } catch (err: any) {
      setRowMessage({ id: row.event_id, type: 'error', text: extractError(err, 'Duyệt thất bại.') });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!confirmState || confirmState.type !== 'reject') return;
    const { row, note } = confirmState;
    setConfirmLoading(true);
    try {
      await approvalService.rejectRegistrationRequest(row.event_id, note || undefined);
      refreshAfterAction();
    } catch (err: any) {
      setRowMessage({ id: row.event_id, type: 'error', text: extractError(err, 'Từ chối thất bại.') });
      setConfirmState(null);
    } finally {
      setConfirmLoading(false);
    }
  };

  const confirmAutoFix = async () => {
    if (!confirmState || confirmState.type !== 'auto_fix') return;
    const { row } = confirmState;
    setConfirmLoading(true);
    try {
      await overtimeReconciliationService.reconciliationAction(row.event_id, { action: 'auto_fix' });
      refreshAfterAction();
    } catch (err: any) {
      setRowMessage({ id: row.event_id, type: 'error', text: extractError(err, 'Sửa auto thất bại.') });
      setConfirmState(null);
    } finally {
      setConfirmLoading(false);
    }
  };

  const openManualFix = (row: OvertimeReconciliationRow) => {
    setManualFixId(row.event_id);
    setManualCheckIn((row.registered_check_in || '').slice(0, 5));
    setManualCheckOut((row.reconciliation?.actual_checkout || row.reconciliation?.actual_checkin || '').slice(0, 5));
    setRowMessage(null);
  };

  const submitManualFix = async (row: OvertimeReconciliationRow) => {
    if (!manualCheckOut) {
      setRowMessage({ id: row.event_id, type: 'error', text: 'Vui lòng nhập giờ ra.' });
      return;
    }
    setBusyId(row.event_id);
    setRowMessage(null);
    try {
      await overtimeReconciliationService.reconciliationAction(row.event_id, {
        action: 'manual_fix',
        check_out: manualCheckOut,
        check_in: manualCheckIn || undefined,
      });
      refreshAfterAction();
    } catch (err: any) {
      setRowMessage({ id: row.event_id, type: 'error', text: extractError(err, 'Sửa tay thất bại.') });
    } finally {
      setBusyId(null);
    }
  };

  const autoFixSuggestedTime = (row: OvertimeReconciliationRow) =>
    formatTime(row.reconciliation?.actual_checkout || row.reconciliation?.actual_checkin);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Đối chiếu tăng ca Tại Viện/VP</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            So khớp giờ đăng ký tăng ca với giờ chấm công thực tế sau khi upload dữ liệu chấm công.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>Tháng {m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={fetchData}
            className="border border-gray-300 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-50 text-sm"
          >
            {loading ? 'Đang tải...' : 'Làm mới'}
          </button>
        </div>
      </div>

      {policyNote && (
        <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-600">
          {policyNote}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        {OT_RECONCILIATION_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border ${
              tab === t.key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
            {summary && (
              <span
                className={`min-w-[20px] h-[20px] inline-flex items-center justify-center px-1.5 rounded-full text-xs font-bold ${
                  tab === t.key ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {summary[t.key] ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Đang tải dữ liệu...</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">
          Không có đơn nào ở tab này cho tháng {month}/{year}.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-100 rounded-xl">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-semibold">Ngày</th>
                <th className="text-left px-4 py-2.5 font-semibold">Nhân viên</th>
                <th className="text-left px-4 py-2.5 font-semibold">Đăng ký OT</th>
                <th className="text-left px-4 py-2.5 font-semibold">Chấm công thực tế</th>
                <th className="text-left px-4 py-2.5 font-semibold">Trạng thái</th>
                <th className="text-left px-4 py-2.5 font-semibold">Ghi chú</th>
                {isActionableTab && <th className="text-left px-4 py-2.5 font-semibold">Xử lý</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const badge = r.reconciliation ? STATUS_BADGE[r.reconciliation.status] : null;
                const isExcess = r.reconciliation?.status === 'excess';
                const excessDeadlinePassed = isExcess && isDeadlinePassed(r.reconciliation?.manager_fix_deadline);
                // QLTT trực tiếp chỉ được "Sửa tay" cho đúng đơn 'excess' còn hạn;
                // HR/Admin thì như cũ (sửa tay được mọi đơn đang chờ xử lý).
                const canManualFix = isHRAdmin || (isExcess && !excessDeadlinePassed);
                const canAutoFix = isHRAdmin && !!r.reconciliation && AUTO_FIX_ELIGIBLE_STATUSES.includes(r.reconciliation.status);
                const hrDecision = r.reconciliation?.hr_decision;
                const isBusy = busyId === r.event_id;
                const isEditingManual = manualFixId === r.event_id;
                return (
                  <React.Fragment key={r.event_id}>
                    <tr className="align-top hover:bg-gray-50/60">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">{toDisplayDate(r.date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{r.employee_name}</div>
                        <div className="text-xs text-gray-400">{r.employee_code}{r.department_name ? ` · ${r.department_name}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                        {formatTime(r.registered_check_in)} - {formatTime(r.registered_check_out)}
                        {r.overtime_hours != null && (
                          <span className="text-xs text-gray-400 ml-1">({r.overtime_hours}h)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                        {formatTime(r.reconciliation?.actual_checkin)} - {formatTime(r.reconciliation?.actual_checkout)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.status === 'REJECTED' ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                            Từ chối
                          </span>
                        ) : badge ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Chưa đối soát</span>
                        )}
                        {hrDecision && (
                          <div className="mt-1 text-[11px] text-indigo-600 font-medium">
                            {HR_DECISION_LABEL[hrDecision] || hrDecision}
                            {r.reconciliation?.hr_decided_by_name ? ` · ${r.reconciliation.hr_decided_by_name}` : ''}
                          </div>
                        )}
                        {r.status === 'REJECTED' && r.rejected_by_name && (
                          <div className="mt-1 text-[11px] text-red-500 font-medium">
                            {r.rejected_by_name}{r.rejected_at ? ` · ${toDisplayDate(r.rejected_at.slice(0, 10))}` : ''}
                          </div>
                        )}
                        {isExcess && (
                          <div className={`mt-1 text-[11px] font-medium ${excessDeadlinePassed ? 'text-rose-500' : 'text-indigo-500'}`}>
                            Hạn QLTT sửa: {formatDeadline(r.reconciliation?.manager_fix_deadline)}
                            {excessDeadlinePassed ? ' (đã quá hạn — giữ nguyên đơn OT gốc)' : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[320px]">
                        {r.status === 'REJECTED'
                          ? (r.rejection_note || r.reconciliation?.message || '—')
                          : (r.reconciliation?.message || '—')}
                        {r.reconciliation?.hr_note && (
                          <div className="mt-1 text-xs text-indigo-500 italic">HR: {r.reconciliation.hr_note}</div>
                        )}
                      </td>
                      {isActionableTab && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1.5">
                            {isHRAdmin && (
                              <button
                                disabled={isBusy}
                                onClick={() => handleAccept(r)}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                              >
                                Duyệt
                              </button>
                            )}
                            <button
                              disabled={isBusy}
                              onClick={() => setConfirmState({ type: 'reject', row: r, note: '' })}
                              className="px-2.5 py-1 rounded-md text-xs font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                            >
                              Từ chối
                            </button>
                            {isHRAdmin && (
                              <button
                                disabled={isBusy || !canAutoFix}
                                title={!canAutoFix ? 'Chỉ áp dụng được cho đơn có giờ ra thực tế rõ ràng' : ''}
                                onClick={() => setConfirmState({ type: 'auto_fix', row: r })}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-40"
                              >
                                Sửa auto
                              </button>
                            )}
                            {canManualFix && (
                              <button
                                disabled={isBusy}
                                onClick={() => (isEditingManual ? setManualFixId(null) : openManualFix(r))}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                              >
                                Sửa tay
                              </button>
                            )}
                          </div>
                          {rowMessage && rowMessage.id === r.event_id && (
                            <div className={`mt-1.5 text-xs ${rowMessage.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
                              {rowMessage.text}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {isEditingManual && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={isActionableTab ? 7 : 6} className="px-4 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Giờ vào</label>
                              <input
                                type="time"
                                value={manualCheckIn}
                                onChange={(e) => setManualCheckIn(e.target.value)}
                                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Giờ ra (bắt buộc)</label>
                              <input
                                type="time"
                                value={manualCheckOut}
                                onChange={(e) => setManualCheckOut(e.target.value)}
                                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                              />
                            </div>
                            <button
                              disabled={isBusy}
                              onClick={() => submitManualFix(r)}
                              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {isBusy ? 'Đang lưu...' : 'Lưu giờ đã sửa'}
                            </button>
                            <button
                              onClick={() => setManualFixId(null)}
                              className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-100"
                            >
                              Huỷ
                            </button>
                            {rowMessage && rowMessage.id === r.event_id && (
                              <span className={`text-xs ${rowMessage.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
                                {rowMessage.text}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {count > rows.length && (
            <div className="px-4 py-2.5 text-xs text-gray-400 border-t border-gray-100">
              Hiển thị {rows.length}/{count} đơn.
            </div>
          )}
        </div>
      )}

      {/* Modal Sửa auto — thay cho window.confirm() cũ */}
      <ConfirmDialog
        open={!!confirmState && confirmState.type === 'auto_fix'}
        variant="info"
        title="Tự động sửa giờ ra"
        message={
          confirmState?.type === 'auto_fix'
            ? `Nhân viên: ${confirmState.row.employee_name}\n`
              + `Ngày: ${toDisplayDate(confirmState.row.date)}\n\n`
              + `Giờ vào (giữ nguyên): ${formatTime(confirmState.row.registered_check_in)}\n`
              + `Giờ ra: ${formatTime(confirmState.row.registered_check_out)} → ${autoFixSuggestedTime(confirmState.row)}\n\n`
              + `Số giờ tăng ca sẽ được tính lại theo giờ ra mới.`
            : undefined
        }
        confirmLabel="Áp dụng"
        cancelLabel="Huỷ"
        loading={confirmLoading}
        onConfirm={confirmAutoFix}
        onClose={() => setConfirmState(null)}
      />

      {/* Modal Từ chối */}
      <ConfirmDialog
        open={!!confirmState && confirmState.type === 'reject'}
        variant="danger"
        title="Từ chối đơn tăng ca"
        message={
          confirmState?.type === 'reject'
            ? `Nhân viên: ${confirmState.row.employee_name}\nNgày: ${toDisplayDate(confirmState.row.date)}\n\n`
              + `Đơn tăng ca này sẽ chuyển sang trạng thái Từ chối.`
            : undefined
        }
        confirmLabel="Từ chối"
        cancelLabel="Huỷ"
        loading={confirmLoading}
        onConfirm={confirmReject}
        onClose={() => setConfirmState(null)}
      >
        {confirmState?.type === 'reject' && (
          <textarea
            rows={2}
            value={confirmState.note}
            onChange={(e) => setConfirmState({ ...confirmState, note: e.target.value })}
            placeholder="Lý do từ chối (không bắt buộc)..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-400 resize-none"
          />
        )}
      </ConfirmDialog>
    </div>
  );
};

export default OvertimeReconciliationPanel;
