import React, { useEffect, useState } from 'react';
import {
  LockClosedIcon,
  LockOpenIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { salaryService, type SalaryFinalizeState } from '../services/salary.service';

interface PayrollFinalizeBarProps {
  year: number;
  month: number;
  isFinalized: boolean;
  finalizedAt: string | null;
  /** Đang xem bản tính lại từ dữ liệu hiện tại (tháng đã chốt) */
  liveMode: boolean;
  onToggleLiveMode: () => void;
  /** Gọi sau khi chốt / chốt lại / bỏ chốt để tải lại bảng lương */
  onChanged: () => void;
}

const formatDateTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const apiError = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;

/**
 * Chốt lương tháng: chốt xong bảng lương / phiếu lương đọc đúng bản đã chốt, dữ liệu lương
 * của tháng bị khoá (sửa thì bỏ chốt trước), và chỉ gửi được phiếu lương khi đã chốt và dữ
 * liệu chưa đổi sau khi chốt.
 */
const PayrollFinalizeBar: React.FC<PayrollFinalizeBarProps> = ({
  year, month, isFinalized, finalizedAt, liveMode, onToggleLiveMode, onChanged,
}) => {
  const [busy, setBusy] = useState<null | 'finalize' | 'unfinalize' | 'check'>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, setState] = useState<SalaryFinalizeState | null>(null);
  const period = `${String(month).padStart(2, '0')}/${year}`;

  useEffect(() => {
    setMessage(null);
    setState(null);
  }, [year, month, isFinalized, finalizedAt]);

  const handleFinalize = async () => {
    const text = isFinalized
      ? `Chốt lại lương tháng ${period}? Bản đã chốt sẽ được thay bằng số tính từ dữ liệu hiện tại.`
      : `Chốt lương tháng ${period} cho cả công ty? Sau khi chốt, dữ liệu lương của tháng (hoa hồng, phạt, tạm ứng, phụ cấp, dữ liệu lương tháng) bị khoá.`;
    if (!window.confirm(text)) return;
    setBusy('finalize');
    setMessage(null);
    try {
      const res = await salaryService.finalizeSalaryMonth({ year, month });
      setMessage({
        ok: true,
        text: `Đã chốt lương tháng ${period} cho ${res.total} nhân viên`
          + (res.removed ? ` (bỏ ${res.removed} người không còn trong bảng lương)` : '') + '.',
      });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Chốt lương thất bại.') });
    } finally {
      setBusy(null);
    }
  };

  const handleUnfinalize = async () => {
    if (!window.confirm(`Bỏ chốt lương tháng ${period}? Dữ liệu lương của tháng sẽ sửa được và bảng lương tính lại từ dữ liệu hiện tại.`)) return;
    setBusy('unfinalize');
    setMessage(null);
    try {
      await salaryService.unfinalizeSalaryMonth({ year, month });
      setMessage({ ok: true, text: `Đã bỏ chốt lương tháng ${period}.` });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Bỏ chốt thất bại.') });
    } finally {
      setBusy(null);
    }
  };

  const handleCheck = async () => {
    setBusy('check');
    setMessage(null);
    try {
      setState(await salaryService.getSalaryFinalizeState({ year, month }));
    } catch (err) {
      setMessage({ ok: false, text: apiError(err, 'Không kiểm tra được thay đổi.') });
    } finally {
      setBusy(null);
    }
  };

  const buttonClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50';

  return (
    <div
      className={`mt-3 rounded-lg border px-4 py-3 text-sm ${
        isFinalized ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          {isFinalized ? (
            <LockClosedIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <LockOpenIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <div>
            {isFinalized ? (
              <span className="font-medium">
                Đã chốt lương tháng {period}
                {finalizedAt ? ` lúc ${formatDateTime(finalizedAt)}` : ''}
              </span>
            ) : (
              <span className="font-medium">Bảng lương tháng {period} chưa chốt</span>
            )}
            <p className="mt-0.5 text-xs opacity-80">
              {isFinalized
                ? liveMode
                  ? 'Đang xem bản TÍNH LẠI từ dữ liệu hiện tại để đối chiếu — chưa phải số đã chốt.'
                  : 'Đang xem bản đã chốt. Dữ liệu lương của tháng bị khoá; cần sửa thì bỏ chốt trước.'
                : 'Chốt lương để khoá số liệu của tháng. Chỉ gửi được phiếu lương sau khi đã chốt.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isFinalized && (
            <>
              <button
                type="button"
                onClick={onToggleLiveMode}
                disabled={busy !== null}
                className={`${buttonClass} border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100`}
              >
                {liveMode ? 'Quay lại bản đã chốt' : 'Xem bản tính lại'}
              </button>
              <button
                type="button"
                onClick={handleCheck}
                disabled={busy !== null}
                className={`${buttonClass} border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100`}
              >
                {busy === 'check' ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : null}
                Kiểm tra thay đổi
              </button>
              <button
                type="button"
                onClick={handleUnfinalize}
                disabled={busy !== null}
                className={`${buttonClass} border-red-200 bg-white text-red-600 hover:bg-red-50`}
              >
                <LockOpenIcon className="h-3.5 w-3.5" />
                {busy === 'unfinalize' ? 'Đang bỏ chốt...' : 'Bỏ chốt'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleFinalize}
            disabled={busy !== null}
            className={`${buttonClass} border-primary-600 bg-primary-600 text-white hover:bg-primary-700`}
          >
            <LockClosedIcon className="h-3.5 w-3.5" />
            {busy === 'finalize' ? 'Đang chốt...' : isFinalized ? 'Chốt lại' : `Chốt lương tháng ${period}`}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mt-2 flex items-center gap-1.5 text-xs ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {message.ok ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationCircleIcon className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {state && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs text-gray-700">
          {state.is_stale ? (
            <>
              <p className="font-semibold text-amber-700">
                {state.changed_count} nhân viên có dữ liệu khác bản đã chốt — chốt lại trước khi gửi phiếu lương.
              </p>
              <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
                {state.changed.map((c) => (
                  <li key={`${c.employee_code}-${c.reason}`}>
                    <span className="font-mono text-gray-500">{c.employee_code}</span> {c.ho_va_ten} — {c.reason}
                    {c.fields?.length ? <span className="text-gray-400"> ({c.fields.join(', ')})</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-emerald-700">Dữ liệu hiện tại khớp bản đã chốt{state.finalized_by ? ` (người chốt: ${state.finalized_by})` : ''}.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default PayrollFinalizeBar;
