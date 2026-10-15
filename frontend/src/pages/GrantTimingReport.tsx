import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LockOpenIcon,
} from '@heroicons/react/24/outline';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import grantTimingReportService, {
  GrantTimingCause,
  GrantTimingReport as Report,
  GrantTimingRow,
} from '../services/grantTimingReport.service';

/** Màu theo nguyên nhân — map tĩnh, KHÔNG dựng class Tailwind động
 *  (class động không được compile, từng làm mất màu cả trang). */
const CAUSE_STYLE: Record<GrantTimingCause, string> = {
  HCNS_UNLOCK_LATE: 'bg-amber-50 text-amber-700 ring-amber-200',
  CREATED_LATE: 'bg-rose-50 text-rose-700 ring-rose-200',
  APPROVED_LATE: 'bg-violet-50 text-violet-700 ring-violet-200',
  NO_REQUEST_YET: 'bg-slate-100 text-slate-600 ring-slate-300',
};

const CAUSE_ORDER: GrantTimingCause[] = [
  'HCNS_UNLOCK_LATE', 'CREATED_LATE', 'APPROVED_LATE', 'NO_REQUEST_YET',
];

const WEEKDAY = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** Dựng Date theo giờ địa phương — `new Date("2026-10-12")` bị parse thành UTC
 *  nên ở múi giờ âm sẽ lùi 1 ngày, làm thứ lệch với ngày hiển thị bên cạnh. */
const weekdayOf = (iso?: string | null) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAY[(new Date(y, m - 1, d).getDay() + 6) % 7];
};

const p2 = (n: number) => String(n).padStart(2, '0');
const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${p2(d)}/${p2(m)}/${y}`;
};
const fmtDateTime = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  // Có cả năm: báo cáo đối soát mà mốc giờ mơ hồ qua ranh giới năm thì không
  // đối chiếu được (trang kia đã có năm, trang này trước đó thiếu).
  return `${p2(d.getHours())}:${p2(d.getMinutes())} ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
/** Trễ bao lâu — phút/giờ/ngày, để phân biệt trễ 10 phút với trễ 2 tuần. */
const fmtOverdue = (m?: number | null) => {
  if (m == null) return '—';
  if (m < 1) return 'dưới 1 phút';
  if (m < 60) return `${m} phút`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h${p2(m % 60)}`;
  return `${Math.floor(m / 1440)} ngày`;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }));

interface Props {
  /** Nhúng làm tab trong trang Đối soát — bỏ tiêu đề, padding, và DÙNG CHUNG
   *  tháng/năm của trang cha thay vì tự có bộ chọn riêng (có 2 bộ chọn tháng
   *  trên cùng màn, lại lệch nhau, là khó dùng). */
  embedded?: boolean;
  year?: number;
  month?: number;
  /** Báo số dòng cảnh báo lên trang cha, để tab con và tab "Cảnh báo" hiện
   *  được số đếm (tab cha = tổng của 2 tab con). */
  onCount?: (n: number) => void;
  /** Trang cha mở hộp áp phạt — gom về một chỗ để chỉ có MỘT hộp nhập lý do. */
  onApplyPenalty?: (row: GrantTimingRow) => void;
}

export default function GrantTimingReport({
  embedded = false, year: yearProp, month: monthProp, onCount, onApplyPenalty,
}: Props) {
  const today = new Date();
  const [yearState, setYear] = useState(today.getFullYear());
  const [monthState, setMonth] = useState(today.getMonth() + 1);
  const year = yearProp ?? yearState;
  const month = monthProp ?? monthState;
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cause, setCause] = useState<GrantTimingCause | 'ALL'>('ALL');

  const fetchData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await grantTimingReportService.get({ year, month });
      setData(d);
      onCount?.(d.summary.late_rows);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Không tải được báo cáo');
      setData(null);
      onCount?.(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [year, month]);

  const rows = useMemo(
    () => (!data ? [] : cause === 'ALL' ? data.rows : data.rows.filter((r) => r.causes.includes(cause))),
    [data, cause],
  );
  const s = data?.summary;

  return (
    <div className={embedded ? '' : 'p-4 sm:p-6 max-w-[1500px] mx-auto'}>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="mr-auto">
          {!embedded && (
            <h1 className="text-2xl font-extrabold text-gray-900">Mở khoá nhưng vẫn quá mốc 3 giờ</h1>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            Trường hợp đột xuất phải tạo và duyệt trong 3 giờ đầu của ngày làm việc kế tiếp.
            Trang này chỉ <b>cảnh báo</b>, không sinh tiền phạt.
          </p>
        </div>
        {!embedded && (
          <>
            <div className="w-32">
              <SelectBox
                label="Tháng"
                value={String(month)}
                options={MONTHS}
                onChange={(v) => setMonth(Number(v))}
              />
            </div>
            <div className="w-28">
              <SelectBox
                label="Năm"
                value={String(year)}
                options={[0, 1, 2, 3, 4].map((i) => ({ value: String(2026 + i), label: String(2026 + i) }))}
                onChange={(v) => setYear(Number(v))}
              />
            </div>
            <button onClick={fetchData} disabled={loading} className="btn-secondary flex items-center gap-2">
              <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
          </>
        )}
      </div>

      {err && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800 mb-4">
          {err}
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Lần mở khoá đã rà', value: s.grants_checked, cls: 'text-gray-900' },
              { label: 'Có cảnh báo', value: s.late_rows, cls: 'text-rose-600' },
              { label: 'Đúng mốc 3 giờ', value: s.on_time_rows, cls: 'text-emerald-600' },
              { label: 'HCNS mở khoá muộn', value: s.by_cause.HCNS_UNLOCK_LATE || 0, cls: 'text-amber-600' },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{c.label}</p>
                <p className={`text-3xl font-black mt-1 ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Điểm quan trọng nhất: phần lớn các ca trễ là do HCNS mở khoá muộn,
              không phải nhân viên chậm — nói thẳng ra để không phạt oan. */}
          {(s.by_cause.HCNS_UNLOCK_LATE || 0) > 0 && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex gap-2">
              <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>{s.by_cause.HCNS_UNLOCK_LATE}/{s.late_rows} dòng là do HCNS mở khoá sau mốc 3 giờ</b>{' '}
                — những ca này nhân viên không còn cách nào kịp, <b>không nên quy lỗi cho họ</b>.
                Với các dòng đó hệ thống cũng không tính thêm lỗi tạo/duyệt muộn nữa.
              </span>
            </div>
          )}

          {s.fallback_rows > 0 && (
            <div className="mb-4 rounded-lg bg-slate-100 border border-slate-300 px-4 py-3 text-sm text-slate-700 flex gap-2">
              <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>{s.fallback_rows} dòng dùng mốc dự phòng 10h00</b> vì không tra được giờ vào ca
                của ngày làm việc kế tiếp — nên rà tay trước khi kết luận.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={() => setCause('ALL')}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold ring-1 ${
                cause === 'ALL' ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-600 ring-gray-200'
              }`}
            >
              Tất cả ({data?.rows.length || 0})
            </button>
            {CAUSE_ORDER.map((c) => {
              const n = s.by_cause[c] || 0;
              return (
                <button
                  key={c}
                  onClick={() => setCause(c)}
                  disabled={n === 0 && cause !== c}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold ring-1 disabled:opacity-40 ${
                    cause === c ? 'bg-gray-900 text-white ring-gray-900' : CAUSE_STYLE[c]
                  }`}
                >
                  {data?.cause_labels[c] || c} ({n})
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
              <ClockIcon className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
              <p className="font-semibold text-gray-700">Không có trường hợp nào vượt mốc 3 giờ</p>
              <p className="text-sm text-gray-500 mt-1">
                {s.grants_checked > 0
                  ? `Đã rà ${s.grants_checked} lần mở khoá trong tháng.`
                  : 'Tháng này chưa có lần mở khoá nào cho đơn nghỉ.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="scrollbar-x-visible">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      <th className="px-4 py-2">Ngày nghỉ</th>
                      <th className="px-4 py-2">Nhân viên</th>
                      <th className="px-4 py-2">Loại đơn</th>
                      <th className="px-4 py-2">Hạn 3 giờ</th>
                      <th className="px-4 py-2">HCNS mở khoá</th>
                      <th className="px-4 py-2">Tạo đơn</th>
                      <th className="px-4 py-2">QLTT duyệt</th>
                      <th className="px-4 py-2">Trễ</th>
                      <th className="px-4 py-2">Nguyên nhân</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.employee_id}-${r.event_date}-${r.request_type}-${i}`}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 align-top"
                      >
                        <td className="px-4 py-2 whitespace-nowrap">
                          {fmtDate(r.event_date)}
                          <span className={`ml-1.5 text-xs font-semibold ${
                            weekdayOf(r.event_date) === 'CN' ? 'text-rose-500' : 'text-gray-400'
                          }`}>
                            {weekdayOf(r.event_date)}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <p className="font-semibold text-gray-900">{r.employee_name}</p>
                          <p className="text-xs text-gray-500 font-mono">{r.employee_code}</p>
                          {r.department_name && (
                            <p className="text-xs text-gray-400">{r.department_name}</p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{r.request_type_label}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {fmtDateTime(r.deadline_3h)}
                          {r.deadline_is_fallback && (
                            <span className="ml-1.5 text-xs text-amber-600 font-semibold">(dự phòng)</span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <LockOpenIcon className="w-3.5 h-3.5 text-gray-400" />
                            {fmtDateTime(r.granted_at)}
                          </span>
                          {r.granted_by_name && (
                            <p className="text-xs text-gray-400">{r.granted_by_name}</p>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500">{fmtDateTime(r.created_at)}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500">{fmtDateTime(r.approved_at)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {(() => {
                            // Hiện đúng mốc trễ ứng với nguyên nhân chính của dòng.
                            const m = r.causes.includes('HCNS_UNLOCK_LATE')
                              ? r.hcns_unlock_overdue_minutes
                              : r.created_overdue_minutes ?? r.approved_overdue_minutes;
                            return m == null ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <span className={m < 60 ? 'text-amber-600' : 'text-rose-600 font-semibold'}>
                                {fmtOverdue(m)}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {r.causes.map((c) => (
                              <span
                                key={c}
                                className={`px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${CAUSE_STYLE[c]}`}
                              >
                                {data?.cause_labels[c] || c}
                              </span>
                            ))}
                          </div>
                          {r.grant_note && (
                            <p className="text-xs text-gray-400 mt-1">Ghi chú mở khoá: {r.grant_note}</p>
                          )}
                        </td>
                        {onApplyPenalty && (
                          <td className="px-4 py-2 whitespace-nowrap text-right">
                            <button
                              onClick={() => onApplyPenalty(r)}
                              className="text-[11px] font-semibold text-gray-600 underline hover:text-rose-700"
                            >
                              Áp phạt
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!s && !err && !loading && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-500">
          <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Chưa có dữ liệu
        </div>
      )}
    </div>
  );
}
