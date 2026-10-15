import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  UserIcon,
  UserGroupIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ChevronRightIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import GrantTimingReport from './GrantTimingReport';
import violationReportService, {
  FinalizePreview,
  ViolationReport,
  ViolationRow,
} from '../services/violationReport.service';

// Đối soát vi phạm quanh đơn Nghỉ phép tháng (có lương) và Nghỉ không phép
// (không lương) — yêu cầu HCNS 2026-10-06. Backend: hrm/violation_report_views.py

const FAULT_LABEL: Record<string, string> = {
  EMPLOYEE: 'Lỗi nhân viên',
  MANAGER: 'Lỗi quản lý',
};

// Màu theo loại lỗi — viết đủ chuỗi class tĩnh, Tailwind không quét được
// chuỗi ghép động và dự án không có safelist.
const CODE_STYLE: Record<string, string> = {
  NO_REQUEST: 'bg-red-50 text-red-700 ring-red-200',
  LATE_CREATED: 'bg-amber-50 text-amber-700 ring-amber-200',
  NOT_APPROVED: 'bg-violet-50 text-violet-700 ring-violet-200',
  APPROVED_LATE: 'bg-blue-50 text-blue-700 ring-blue-200',
  HALF_DAY_ONLY: 'bg-orange-50 text-orange-700 ring-orange-200',
};

// Đơn không lương để màu khác cho dễ soi (chị Dung đề nghị).
const PAY_STYLE: Record<string, string> = {
  PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  UNPAID: 'bg-rose-50 text-rose-700 ring-rose-200',
};
const PAY_LABEL: Record<string, string> = { PAID: 'Có lương', UNPAID: 'Không lương' };

/** Tiền phạt — dạng "500.000 ₫". Dùng `₫` cho khớp phần "Phạt biên bản" sẵn có
 *  (DisciplinaryPenaltyManagement, SalaryData) thay vì tự đặt một kiểu riêng. */
const fmtMoney = (n?: number | null) =>
  !n ? '0 ₫' : `${n.toLocaleString('vi-VN')} ₫`;

/** Ngày dạng YYYY-MM-DD: tự dựng Date theo giờ địa phương. `new Date("2026-10-12")`
 *  bị parse thành UTC nên ở múi giờ âm sẽ lùi 1 ngày — weekdayOf() đã xử lý
 *  đúng từ đầu, fmtDate() thì chưa, dẫn tới ngày và thứ trong cùng 1 ô lệch nhau. */
const fmtDateOnly = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d)}/${p(m)}/${y}`;
};

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const fmtDateTime = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${fmtDate(s)}`;
};

/** Gợi ý lý do, chọn sẵn theo ĐÚNG loại lỗi hệ thống đang cảnh báo — HCNS bấm
 *  1 cái là xong, vẫn sửa lại được. Mục đích là để lý do ghi lại có nội dung
 *  thật, thay vì gõ vội "ok" cho qua (HCNS 2026-10-12). */
const REASON_HINTS: Record<string, { apply: string[]; waive: string[] }> = {
  LATE_CREATED: {
    apply: ['Tạo đơn muộn quá 3h làm việc', 'Tạo đơn sau hạn, không có lý do chính đáng', 'Đã nhắc nhưng vẫn tạo muộn'],
    waive: ['HCNS mở khoá muộn nên không kịp tạo', 'Nghỉ đột xuất, có xác nhận của quản lý', 'Lỗi hệ thống khi tạo đơn'],
  },
  NO_REQUEST: {
    apply: ['Nghỉ không khai báo', 'Không tạo đơn dù đã được nhắc'],
    waive: ['Đã báo quản lý, có người xác nhận', 'Dữ liệu chấm công sai', 'Đang trong diện nghỉ chế độ'],
  },
  NOT_APPROVED: {
    apply: ['Quản lý không duyệt đơn đúng hạn'],
    waive: ['Quản lý nghỉ/ốm không duyệt được', 'HCNS mở khoá muộn nên không kịp duyệt'],
  },
  APPROVED_LATE: {
    apply: ['Quản lý duyệt đơn quá hạn'],
    waive: ['Quản lý nghỉ/ốm không duyệt được', 'Nhân viên tạo đơn muộn nên không duyệt kịp', 'HCNS mở khoá muộn'],
  },
  HALF_DAY_ONLY: {
    apply: ['Nghỉ cả ngày nhưng chỉ tạo đơn nửa ngày', 'Nửa ngày còn lại không khai báo'],
    waive: ['Nửa còn lại là giờ công ty cho nghỉ', 'Có đi làm nửa còn lại, quên quẹt thẻ', 'Đã có đơn khác cho nửa còn lại'],
  },
};
const hintsFor = (code: string, action: 'apply' | 'waive' | 'clear') =>
  action === 'clear' ? ['Bấm nhầm', 'Xem xét lại, trả về tính tự động'] : (REASON_HINTS[code]?.[action] || []);

/** Dòng đưa vào hộp áp/gỡ phạt — nhận cả dòng vi phạm lẫn dòng từ tab mốc 3
 *  giờ, nên chỉ đòi những trường chung. */
type PenaltyRow = {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  event_date: string;
  violation_code: string;
  responsible_name?: string;
  manager_name?: string | null;
};

/** Mã lỗi tương ứng với BÊN bị phạt. HCNS chọn phạt nhân viên hay quản lý thì
 *  mã lỗi đổi theo, vì chính mã lỗi quyết định dòng thuộc nhóm nào. */
const codeForSide = (code: string, side: 'EMPLOYEE' | 'MANAGER') =>
  side === 'MANAGER'
    // Chỉ giữ "Duyệt đơn quá hạn" khi dòng gốc đúng là thế. Các dòng khác
    // (vd nghỉ không tạo đơn) mà quy cho quản lý thì phải là "Chưa duyệt đơn" —
    // ghi "duyệt quá hạn" cho một ngày không hề có đơn là vô nghĩa.
    ? code === 'APPROVED_LATE' ? 'APPROVED_LATE' : 'NOT_APPROVED'
    // Giữ nguyên mã lỗi của nhân viên khi nó đã mô tả đúng hành vi. Trước đây
    // mọi mã không phải NO_REQUEST đều bị ghi thành LATE_CREATED, nên áp phạt
    // một dòng "chỉ có đơn nửa ngày" lại lưu thành "tạo đơn quá hạn".
    : code === 'NO_REQUEST' || code === 'HALF_DAY_ONLY' ? code : 'LATE_CREATED';

const WEEKDAY = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** Thứ trong tuần của 1 ngày YYYY-MM-DD (dựng Date theo giờ địa phương để
 *  không bị lùi 1 ngày như khi để JS parse chuỗi date-only thành UTC). */
const weekdayOf = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAY[new Date(y, m - 1, d).getDay() === 0 ? 6 : new Date(y, m - 1, d).getDay() - 1];
};

/** 75 -> "1 giờ 15 phút"; dưới 1 phút -> "dưới 1 phút" (để không phạt oan). */
const fmtOverdue = (m?: number | null) => {
  if (m == null) return '—';
  if (m < 1) return 'dưới 1 phút';
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} ngày${h % 24 ? ` ${h % 24} giờ` : ''}`;
};

const LeaveViolationReport: React.FC = () => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<ViolationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<'ALL' | 'EMPLOYEE' | 'MANAGER'>('ALL');
  // Lọc theo LOẠI lỗi — bỏ trống = tất cả. Cho chọn nhiều loại cùng lúc vì
  // HCNS hay soi riêng 1-2 nhóm khi áp mức phạt khác nhau.
  const [codes, setCodes] = useState<string[]>([]);
  // Tìm theo tên / mã NV. Bảng có tới 321 dòng chia cho ~100 người nên không
  // có ô tìm thì HCNS phải cuộn tay để tra một người (HCNS 2026-10-12).
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  // null = để mặc định (ít nhóm thì mở sẵn, nhiều nhóm thì thu gọn).
  const [openKeys, setOpenKeys] = useState<Set<string> | null>(null);
  // Chốt tháng: đẩy dòng ra tiền sang biên bản phạt -> TRỪ LƯƠNG THẬT. Luôn
  // xem trước rồi mới cho bấm, vì nó đụng tiền của hàng chục người một lúc.
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizePrev, setFinalizePrev] = useState<FinalizePreview | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeDone, setFinalizeDone] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // HCNS tự áp phạt / gỡ phạt 1 dòng — luôn phải nhập lý do, backend cũng bắt.
  const [ovTarget, setOvTarget] = useState<{ row: PenaltyRow; action: 'apply' | 'waive' | 'clear' } | null>(null);
  const [ovSide, setOvSide] = useState<'EMPLOYEE' | 'MANAGER'>('EMPLOYEE');
  // Số dòng cảnh báo của tab con "Mở khoá sau 3h làm việc" — child báo lên để
  // tab cha hiện được TỔNG của 2 tab con.
  const [grantCount, setGrantCount] = useState(0);
  const [ovReason, setOvReason] = useState('');
  const [ovSaving, setOvSaving] = useState(false);
  // Hai tab: dòng RA TIỀN và dòng CHỈ CẢNH BÁO. HCNS chốt 2026-10-10:
  // "tạo đơn quá hạn thì làm 1 tab riêng để cho xem danh sách thôi".
  const [tab, setTab] = useState<'PENALTY' | 'WARN'>('PENALTY');
  // "Cảnh báo" chỉ là nhãn chung, bên dưới có 2 tab con (HCNS 2026-10-12).
  const [warnSub, setWarnSub] = useState<'LATE' | 'HALF' | 'GRANT'>('LATE');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await violationReportService.get({ year, month }));
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Không tải được báo cáo');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // Reset bộ lọc khi đổi tháng — trước đây bộ lọc đặt ở tháng 9 âm thầm giữ
  // nguyên sang tháng 10, nên bảng và các thẻ thống kê lệch nhau mãi.
  useEffect(() => {
    setSide('ALL');
    setCodes([]);
    setQ('');
    setDept('');
    setOpenKeys(null);
  }, [year, month]);

  // Tìm kiếm xong mà nhóm vẫn thu gọn thì coi như không tìm thấy gì. Trả về
  // mặc định để kết quả ít nhóm tự mở ra.
  useEffect(() => { setOpenKeys(null); }, [q, dept]);

  // Dữ liệu có đúng tháng đang chọn chưa. API trả year/month nhưng trước đây
  // frontend không đọc, nên khi đổi tháng các thẻ thống kê vẫn hiện số tháng cũ
  // bên cạnh dropdown tháng mới.
  const fresh = !!data && data.year === year && data.month === month;
  const s = fresh && !loading ? data!.summary : null;
  // `scope` và `can_manage_penalty` nằm ở CẤP GỐC của response, không trong
  // `summary` — đọc nhầm chỗ là nút áp/gỡ phạt không bao giờ hiện.
  const canManage = !!data?.can_manage_penalty;

  /** Dòng RA TIỀN vs dòng CHỈ CẢNH BÁO — chia theo lý do backend trả về,
   *  không tự suy từ loại lỗi ở frontend. */
  const WARN_REASONS = ['WARN_ONLY', 'HAD_BLOCKED_ATTEMPT'];
  /** Dòng chỉ cảnh báo của cả tháng, CHƯA chia tab con. */
  const warnAll = useMemo(
    () => (fresh ? data!.rows : []).filter((r) => WARN_REASONS.includes(r.penalty_reason)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, fresh],
  );
  const warnLate = useMemo(
    () => warnAll.filter((r) => r.violation_code !== 'HALF_DAY_ONLY'), [warnAll]);
  const warnHalf = useMemo(
    () => warnAll.filter((r) => r.violation_code === 'HALF_DAY_ONLY'), [warnAll]);

  const tabRows = useMemo(() => {
    const all = fresh ? data!.rows : [];
    if (tab !== 'WARN') return all.filter((r) => !WARN_REASONS.includes(r.penalty_reason));
    // Tab con "Mở khoá sau 3h" lấy dữ liệu từ GrantTimingReport nên bảng này rỗng.
    return warnSub === 'HALF' ? warnHalf : warnSub === 'LATE' ? warnLate : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, warnSub, fresh, warnLate, warnHalf]);

  /** Loại lỗi và bên chịu lỗi THỰC SỰ có trong tab đang xem — dùng để không
   *  render bộ lọc chết. Tab "Tạo đơn quá hạn" chỉ có lỗi nhân viên, nhưng
   *  trước đây vẫn hiện nút "Lỗi quản lý", thẻ "LỖI QUẢN LÝ" (luôn 0) và 4 chip
   *  không bao giờ có dòng; bấm vào là ra bảng rỗng (HCNS 2026-10-12). */
  const availCodes = useMemo(() => new Set<string>(tabRows.map((r) => r.violation_code)), [tabRows]);
  const availSides = useMemo(() => new Set(tabRows.map((r) => r.fault_side)), [tabRows]);

  const rows = useMemo(() => {
    let r = tabRows;
    if (side !== 'ALL') r = r.filter((x) => x.fault_side === side);
    if (codes.length) r = r.filter((x) => codes.includes(x.violation_code));
    if (dept) r = r.filter((x) => (x.responsible_department || '') === dept);
    if (q.trim()) {
      // Tìm cả NGƯỜI CHỊU PHẠT lẫn NGƯỜI NGHỈ — hai cái khác nhau ở dòng lỗi
      // quản lý, mà HCNS tra theo cái nào cũng phải ra.
      const k = q.trim().toLowerCase();
      r = r.filter((x) =>
        [x.responsible_name, x.responsible_code, x.employee_name, x.employee_code]
          .some((v) => (v || '').toLowerCase().includes(k)),
      );
    }
    // Ngày CŨ TRƯỚC. Quan trọng vì dòng "Nghỉ liền ngày trước, đã tính ở ngày
    // đầu đợt" chỉ đọc xuôi mới hiểu được — sắp ngược thì dòng được gộp lại
    // nằm TRÊN cái ngày mà nó gộp vào.
    return [...r].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
  }, [tabRows, side, codes, q, dept]);

  /** MỌI con số trên màn tính từ dòng ĐANG HIỂN THỊ. Trước đây các thẻ thống kê
   *  lấy thẳng từ summary (toàn công ty, không theo bộ lọc) trong khi bảng, tổng
   *  theo người và Excel đều theo bộ lọc — bật bộ lọc là con số tiền trên thẻ
   *  lệch hẳn với bảng bên dưới, mà đó đúng là số HCNS copy ra văn bản. */
  const agg = useMemo(() => ({
    total: rows.length,
    employee: rows.filter((r) => r.fault_side === 'EMPLOYEE').length,
    manager: rows.filter((r) => r.fault_side === 'MANAGER').length,
    money: rows.reduce((a, r) => a + (r.penalty_amount || 0), 0),
    paidRows: rows.filter((r) => (r.penalty_amount || 0) > 0).length,
  }), [rows]);

  // Bảng vi phạm hiện ở tab Phạt tiền, và ở tab con "Tạo đơn quá hạn" của
  // Cảnh báo. Tab con "Mở khoá sau 3h làm việc" dùng nguồn dữ liệu khác nên
  // ẩn hẳn bảng này — KHÔNG bọc chung một nhánh JSX như lần trước (bọc hụt
  // nên bảng phạt lọt sang tab mốc 3 giờ), mà gác từng khối riêng.
  const showViolationTable = tab === 'PENALTY' || warnSub === 'LATE' || warnSub === 'HALF';

  // Tab "Cảnh báo" chỉ dành cho HCNS/Admin (HCNS 2026-10-12). Chốt lại ở
  // đây phòng trường hợp state còn sót 'WARN' từ phiên trước.
  useEffect(() => {
    if (!canManage && tab !== 'PENALTY') setTab('PENALTY');
  }, [canManage, tab]);

  const isFiltered = side !== 'ALL' || codes.length > 0 || !!q.trim() || !!dept;
  const clearFilters = () => {
    setSide('ALL'); setCodes([]); setQ(''); setDept(''); setOpenKeys(null);
  };

  /** Danh sách phòng ban có mặt trong tab đang xem — không hardcode, và không
   *  gọi thêm API vì dòng nào cũng đã mang sẵn tên phòng. */
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    tabRows.forEach((r) => { if (r.responsible_department) set.add(r.responsible_department); });
    return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
  }, [tabRows]);

  /** Gom theo người chịu trách nhiệm để HCNS cộng tiền phạt theo đầu người. */
  const grouped = useMemo(() => {
    const m = new Map<string, { key: string; row: ViolationRow; items: ViolationRow[] }>();
    rows.forEach((r) => {
      const key = `${r.fault_side}:${r.responsible_id ?? 'none'}`;
      if (!m.has(key)) m.set(key, { key, row: r, items: [] });
      m.get(key)!.items.push(r);
    });
    // Trong từng người cũng xếp ngày cũ trước (xem lý do ở `rows`).
    m.forEach((g) =>
      g.items.sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')),
    );
    // Sắp theo TIỀN trước — đây là bảng tiền, người phải trả nhiều nhất nên ở
    // trên. Trước đây sắp theo số lỗi nên người 5 lỗi 0 đồng đứng trên người 3
    // lỗi 1,5 triệu. Có tiebreaker theo tên để thứ tự ổn định giữa các lần tải.
    const money = (g: { items: ViolationRow[] }) =>
      g.items.reduce((a, x) => a + (x.penalty_amount || 0), 0);
    return [...m.values()].sort(
      (a, b) =>
        money(b) - money(a) ||
        b.items.length - a.items.length ||
        (a.row.responsible_name || '').localeCompare(b.row.responsible_name || ''),
    );
  }, [rows]);

  /** Nhiều nhóm thì thu gọn sẵn: 321 dòng của ~100 người trải hết ra thì
   *  trang dài vài chục màn, không ai dùng được. Ít nhóm thì mở sẵn như cũ. */
  const AUTO_COLLAPSE_FROM = 12;
  const defaultOpen = grouped.length <= AUTO_COLLAPSE_FROM;
  const isOpen = (key: string) => (openKeys ? openKeys.has(key) : defaultOpen);
  const toggleGroup = (key: string) => {
    const base = openKeys ?? new Set(defaultOpen ? grouped.map((g) => g.key) : []);
    const next = new Set(base);
    if (next.has(key)) next.delete(key); else next.add(key);
    setOpenKeys(next);
  };

  const openFinalize = async () => {
    setFinalizeOpen(true);
    setFinalizePrev(null);
    setFinalizeDone(null);
    try {
      setFinalizePrev(await violationReportService.previewFinalize({ year, month }));
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Không xem trước được việc chốt tháng');
      setFinalizeOpen(false);
    }
  };

  const doFinalize = async () => {
    setFinalizeBusy(true);
    try {
      const r = await violationReportService.finalizeMonth({ year, month });
      setFinalizeDone(
        `Đã tạo ${r.created} biên bản phạt cho ${r.people} người, tổng ${fmtMoney(r.total_amount)}.` +
        (r.skipped_already_issued ? ` Bỏ qua ${r.skipped_already_issued} dòng đã chốt trước đó.` : ''),
      );
      await fetchData();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Không chốt được tháng');
      setFinalizeOpen(false);
    } finally {
      setFinalizeBusy(false);
    }
  };

  /** Mở hộp áp/gỡ phạt. `side` mặc định theo bên mà hệ thống đã quy lỗi. */
  const openOverride = (row: PenaltyRow, action: 'apply' | 'waive' | 'clear',
                        side: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE') => {
    setOvTarget({ row, action });
    setOvSide(side);
    setOvReason(hintsFor(codeForSide(row.violation_code, side), action)[0] || '');
  };

  const submitOverride = async () => {
    if (!ovTarget || !ovReason.trim()) return;
    setOvSaving(true);
    try {
      await violationReportService.setPenaltyOverride({
        employee_id: ovTarget.row.employee_id,
        event_date: ovTarget.row.event_date,
        violation_code: ovTarget.action === 'apply'
          ? codeForSide(ovTarget.row.violation_code, ovSide)
          : ovTarget.row.violation_code,
        action: ovTarget.action,
        reason: ovReason.trim(),
      });
      // Áp phạt xong thì dòng đó chuyển sang nhóm ra tiền -> nhảy luôn sang tab
      // Phạt tiền để HCNS thấy kết quả, khỏi phải tự đi tìm (HCNS
      // 2026-10-12). Gỡ phạt / bỏ quyết định thì giữ nguyên tab đang xem: dòng
      // bị gỡ vẫn nằm ở tab Phạt tiền với ghi chú "HCNS gỡ phạt", cố ý để còn
      // thấy được thứ vừa gỡ.
      if (ovTarget.action === 'apply') setTab('PENALTY');
      setOvTarget(null);
      setOvReason('');
      await fetchData();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Không lưu được quyết định.');
    } finally {
      setOvSaving(false);
    }
  };

  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();

      const sheet = wb.addWorksheet(`Vi pham T${month}-${year}`);
      sheet.columns = [
        { header: 'Người chịu trách nhiệm', key: 'resp', width: 26 },
        { header: 'Mã NV', key: 'code', width: 12 },
        { header: 'Phòng ban', key: 'dept', width: 24 },
        { header: 'Nhóm lỗi', key: 'side', width: 14 },
        { header: 'Nội dung lỗi', key: 'viol', width: 32 },
        { header: 'Loại đơn', key: 'type', width: 26 },
        { header: 'Kiểu nghỉ', key: 'style', width: 18 },
        { header: 'Có/Không lương', key: 'pay', width: 15 },
        { header: 'Ngày nghỉ', key: 'date', width: 12 },
        { header: 'Thứ', key: 'wd', width: 7 },
        { header: 'Nhân viên nghỉ', key: 'emp', width: 24 },
        { header: 'Mã đơn', key: 'req', width: 24 },
        { header: 'Hạn phải xong', key: 'dl', width: 18 },
        { header: 'Tạo lúc', key: 'created', width: 18 },
        { header: 'QLTT duyệt lúc', key: 'approved', width: 18 },
        { header: 'Trễ so với hạn', key: 'late', width: 18 },
        { header: 'HCNS đã mở khoá', key: 'grant', width: 16 },
        { header: 'Ghi chú', key: 'note', width: 40 },
        // Mức phạt hệ thống tự tính (500.000 đ/lần, chỉ từ ngày hiệu lực trở
        // đi) — HCNS không phải điền tay nữa. 0 đồng = ngoài diện áp dụng.
        { header: 'Mức phạt (đồng)', key: 'fine', width: 18 },
        // Ghi rõ dòng nào ra tiền và vì sao — để người đọc file không phải đoán.
        { header: 'Phạt / Cảnh báo', key: 'kind', width: 16 },
        { header: 'Lý do', key: 'why', width: 36 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getColumn('fine').numFmt = '#,##0';

      rows.forEach((r) => {
        sheet.addRow({
          resp: r.responsible_name,
          code: r.responsible_code,
          dept: r.responsible_department || '',
          side: FAULT_LABEL[r.fault_side],
          viol: data.violation_labels[r.violation_code] || r.violation_code,
          type: r.request_type_label,
          style: r.leave_style_label || '',
          pay: r.pay_category ? PAY_LABEL[r.pay_category] : '',
          date: fmtDateOnly(r.event_date),
          wd: weekdayOf(r.event_date),
          emp: r.employee_name,
          req: r.request_code || '',
          dl: r.deadline_unknown ? 'Không xác định' : fmtDateTime(r.deadline),
          created: fmtDateTime(r.created_at),
          approved: fmtDateTime(r.approved_at),
          late: fmtOverdue(r.overdue_minutes),
          grant: r.has_grant ? 'Có' : '',
          note: [r.detail, r.is_saturday ? '[Thứ 7 — cần rà lại]' : ''].filter(Boolean).join(' '),
          fine: r.penalty_amount || 0,
          kind: (r.penalty_amount || 0) > 0 ? 'PHẠT' : 'Cảnh báo',
          why: r.penalty_reason_label || '',
        });
      });

      // Dòng TỔNG CỘNG — trước đây cả workbook không có tổng nào, HCNS phải tự
      // cộng tay hoặc tin vào thẻ trên màn (mà thẻ đó lại không theo bộ lọc).
      const tRow = sheet.addRow({
        resp: `TỔNG CỘNG (${rows.length} dòng)`,
        fine: rows.reduce((a, r) => a + (r.penalty_amount || 0), 0),
      });
      tRow.font = { bold: true };

      // Sheet tổng hợp theo đầu người — thứ HCNS dùng để cộng tiền phạt
      const sum = wb.addWorksheet('Tong hop theo nguoi');
      sum.columns = [
        { header: 'Người chịu trách nhiệm', key: 'resp', width: 26 },
        { header: 'Mã NV', key: 'code', width: 12 },
        { header: 'Phòng ban', key: 'dept', width: 24 },
        { header: 'Nhóm lỗi', key: 'side', width: 14 },
        { header: 'Số lỗi', key: 'n', width: 10 },
        { header: 'Tổng tiền phạt (đồng)', key: 'fine', width: 22 },
      ];
      sum.getRow(1).font = { bold: true };
      sum.getColumn('fine').numFmt = '#,##0';
      sum.views = [{ state: 'frozen', ySplit: 1 }];
      grouped.forEach((g) => {
        sum.addRow({
          resp: g.row.responsible_name,
          code: g.row.responsible_code,
          dept: g.row.responsible_department || '',
          side: FAULT_LABEL[g.row.fault_side],
          n: g.items.length,
          fine: g.items.reduce((a, x) => a + (x.penalty_amount || 0), 0),
        });
      });

      const tRow2 = sum.addRow({
        resp: `TỔNG CỘNG (${grouped.length} người)`,
        n: rows.length,
        fine: rows.reduce((a, r) => a + (r.penalty_amount || 0), 0),
      });
      tRow2.font = { bold: true };

      const buffer = await wb.xlsx.writeBuffer();

      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // Ghi tab / bộ lọc / chế độ xem thử vào TÊN FILE — trước đây hai lần xuất
      // với nội dung khác hẳn nhau lại trùng tên, không ai biết file nào là gì.
      const parts = [
        'Doi_soat_vi_pham_don_tu',
        `T${month}_${year}`,
        tab === 'WARN' ? 'canh-bao' : 'phat-tien',
        isFiltered ? 'da-loc' : '',
      ].filter(Boolean);
      link.download = `${parts.join('_')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error:', e);
      setError('Không xuất được file Excel. Vui lòng thử lại.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Đối soát vi phạm đơn từ</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Đơn nghỉ phép tháng (có lương) và nghỉ không phép (không lương) — phân loại lỗi
            theo nhân viên và quản lý.
            {/* Nói rõ phạm vi đang xem, để không ai tưởng đây là số toàn công ty */}
            {data?.scope === 'SELF' && (
              <span className="block text-primary-700 font-semibold mt-0.5">
                Bạn đang xem lỗi của chính mình và lỗi của quản lý trên đơn của bạn.
              </span>
            )}
            {data?.scope === 'TEAM' && (
              <span className="block text-primary-700 font-semibold mt-0.5">
                Bạn đang xem lỗi của bản thân và của nhân viên thuộc quyền quản lý.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-[120px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Tháng</label>
            <SelectBox
              label=""
              value={String(month)}
              options={Array.from({ length: 12 }, (_, i) => ({
                value: String(i + 1), label: `Tháng ${i + 1}`,
              }))}
              onChange={(v) => setMonth(parseInt(v))}
            />
          </div>
          <div className="w-[100px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Năm</label>
            <SelectBox
              label=""
              value={String(year)}
              options={Array.from({ length: 5 }, (_, i) => ({
                value: String(2026 + i), label: String(2026 + i),
              }))}
              onChange={(v) => setYear(parseInt(v))}
            />
          </div>
          <button onClick={fetchData} disabled={loading}
            className="h-[42px] px-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:border-primary-300 disabled:opacity-50">
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          {canManage && tab === 'PENALTY' && s?.penalty_configured && (
            <button onClick={openFinalize}
              className="h-[42px] px-4 inline-flex items-center gap-1.5 rounded-lg border
                         border-rose-300 bg-white text-sm font-semibold text-rose-700
                         hover:bg-rose-50">
              <BanknotesIcon className="w-4 h-4" />
              Chốt tháng
            </button>
          )}
          <button onClick={handleExport} disabled={exporting || !rows.length}
            className="h-[42px] px-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
            <ArrowDownTrayIcon className="w-4 h-4" />
            {exporting ? 'Đang xuất...' : 'Xuất Excel'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {s && (
        <>
          {/* ── Luật tính phạt, nói thẳng ra thay vì để HCNS đoán ───────── */}
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              Loại nào ra tiền
            </p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div>
                <p className="font-semibold text-rose-700 mb-1">
                  Bị phạt {fmtMoney(s.penalty_amount_per_violation)}/lần
                </p>
                <ul className="list-disc list-inside text-gray-600 space-y-0.5">
                  <li>Nghỉ nhưng không tạo đơn nào — tính 1 lần cho mỗi <b>đợt nghỉ liền ngày</b></li>
                  <li>Quản lý chưa duyệt đơn / duyệt quá hạn — tính 1 lần cho <b>cả đơn</b> nhiều ngày</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-amber-700 mb-1">Chỉ cảnh báo, không mất tiền</p>
                <ul className="list-disc list-inside text-gray-600 space-y-0.5">
                  <li>Tạo đơn quá hạn (kể cả bị hệ thống chặn)</li>
                  <li>Đã bấm tạo đơn nhưng bị chặn, rồi hôm đó vẫn nghỉ</li>
                </ul>
                <p className="text-xs text-gray-500 mt-1">
                  Vì công ty cho khai báo muộn trong 3 giờ đầu với trường hợp đột xuất.
                </p>
              </div>
            </div>
          </div>

          {/* ── Hai tab ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-200">
            {(canManage
              ? ([['PENALTY', 'Phạt tiền'], ['WARN', 'Cảnh báo']] as const)
              : ([['PENALTY', 'Phạt tiền']] as const)
            ).map(([k, label]) => {
              // Tab "Cảnh báo" phải là TỔNG của 2 tab con (HCNS 2026-10-12):
              // dòng tạo đơn quá hạn + dòng mở khoá quá mốc 3 giờ.
              const base = (fresh ? data!.rows : []).filter((r) =>
                k === 'WARN'
                  ? WARN_REASONS.includes(r.penalty_reason)
                  : !WARN_REASONS.includes(r.penalty_reason),
              ).length;
              const n = k === 'WARN' ? base + grantCount : base;
              const on = tab === k;
              return (
                <button
                  key={k}
                  onClick={() => { setTab(k); clearFilters(); }}
                  aria-pressed={on}
                  className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 ${
                    on
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label} ({n})
                </button>
              );
            })}
          </div>

          {/* Tab con của "Cảnh báo" */}
          {tab === 'WARN' && (
            <div className="flex flex-wrap gap-2 mb-4">
              {([
                ['LATE', 'Tạo đơn quá hạn'],
                ['HALF', 'Chỉ có đơn nửa ngày'],
                ['GRANT', 'Mở khoá sau 3h làm việc'],
              ] as const).map(([k, label]) => {
                const on = warnSub === k;
                const n = k === 'LATE' ? warnLate.length
                        : k === 'HALF' ? warnHalf.length
                        : grantCount;
                return (
                  <button
                    key={k}
                    onClick={() => { setWarnSub(k); clearFilters(); }}
                    aria-pressed={on}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold ring-1 ${
                      on
                        ? 'bg-gray-900 text-white ring-gray-900'
                        : 'bg-white text-gray-600 ring-gray-200 hover:text-gray-900'
                    }`}
                  >
                    {label} ({n})
                  </button>
                );
              })}
            </div>
          )}

          {showViolationTable && (
          <>
          {/* Mọi con số dưới đây tính từ DÒNG ĐANG HIỂN THỊ (đã áp tab + bộ lọc),
              không lấy từ summary toàn công ty — xem chú thích ở biến `agg`. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            {[
              { label: isFiltered ? 'Số dòng (đã lọc)' : 'Số dòng', value: agg.total, cls: 'text-gray-900' },
              // Chỉ hiện thẻ của BÊN thực sự có lỗi trong tab này.
              ...(availSides.has('EMPLOYEE')
                ? [{ label: 'Lỗi nhân viên', value: agg.employee, cls: 'text-rose-600' }] : []),
              ...(availSides.has('MANAGER')
                ? [{ label: 'Lỗi quản lý', value: agg.manager, cls: 'text-violet-600' }] : []),
              { label: 'Số người liên quan', value: grouped.length, cls: 'text-gray-900' },
              {
                label: tab === 'WARN' ? 'Tiền phạt (tab này: 0)' : 'Tổng tiền phạt',
                value: s.penalty_configured ? fmtMoney(agg.money) : '—',
                cls: agg.money > 0 ? 'text-rose-600' : 'text-gray-400',
              },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{c.label}</p>
                <p className={`text-3xl font-black mt-1 ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Chưa cấu hình ngày hiệu lực -> toàn bộ cột tiền là 0, nói thẳng ra */}
          {!s.penalty_configured && (
            <div className="mb-4 rounded-lg bg-slate-100 border border-slate-300 px-4 py-3 text-sm text-slate-700 flex gap-2">
              <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>Chưa cấu hình ngày hiệu lực của thông báo phạt</b> — bảng dưới vẫn đối
                soát đầy đủ nhưng <b>mọi dòng đều 0 đồng</b>. Mức phạt chỉ áp từ ngày ban
                hành thông báo trở đi.
              </span>
            </div>
          )}
          {/* Chấm công nạp theo đợt Excel nên giữa tháng gần như rỗng, mà loại
              "Nghỉ không tạo đơn" lại quét đúng bảng đó. Câu ngắn gọn theo yêu
              cầu HCNS 2026-10-10 — chi tiết dài dòng không giúp gì thêm. */}
          {canManage && s.attendance_coverage?.looks_incomplete && (
            <div className="mb-4 rounded-lg bg-red-50 border-2 border-red-300 px-4 py-3 text-sm text-red-900 flex gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
              <span>
                <b>
                  Dữ liệu chấm công tháng {String(month).padStart(2, '0')} chưa đủ — mới có{' '}
                  {s.attendance_coverage.employees_with_data}/
                  {s.attendance_coverage.prev_employees_with_data} người.
                </b>{' '}
                Các dòng dưới chỉ là phần đã có dữ liệu; chạy lại sau khi nạp chấm công.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {availSides.size > 1 && (['ALL', 'EMPLOYEE', 'MANAGER'] as const).map((k) => (
              <button key={k} onClick={() => setSide(k)} aria-pressed={side === k}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                  side === k ? 'bg-primary-600 text-white border-transparent'
                             : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'}`}>
                {k === 'ALL' ? 'Tất cả' : FAULT_LABEL[k]}
              </button>
            ))}
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {/* Ô tìm: bảng có hàng trăm dòng của cả trăm người, không có ô
                  này thì tra một người phải cuộn tay. */}
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm tên hoặc mã nhân viên..."
                  className="pl-8 pr-7 py-1.5 w-56 rounded-lg border border-gray-200 text-sm
                             focus:outline-none focus:border-primary-400"
                />
                {q && (
                  <button onClick={() => setQ('')} aria-label="Xoá tìm kiếm"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
              {deptOptions.length > 1 && (
                <select
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="py-1.5 px-2 rounded-lg border border-gray-200 text-sm bg-white
                             max-w-[200px] focus:outline-none focus:border-primary-400"
                >
                  <option value="">Tất cả phòng ban</option>
                  {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {grouped.length > 1 && (
                <button
                  onClick={() => setOpenKeys(
                    grouped.every((g) => isOpen(g.key))
                      ? new Set<string>()
                      : new Set(grouped.map((g) => g.key)),
                  )}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-sm
                             font-medium text-gray-600 hover:border-primary-300"
                >
                  {grouped.every((g) => isOpen(g.key)) ? 'Thu gọn tất cả' : 'Mở tất cả'}
                </button>
              )}
              <span className="text-sm text-gray-400">{rows.length} dòng</span>
            </div>
          </div>

          {/* Lọc theo LOẠI lỗi — mỗi chip kèm số lượng để thấy ngay nhóm nào nhiều */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-20 shrink-0">
              Phân loại
            </span>
            {Object.entries(data?.violation_labels || {})
              .filter(([code]) => availCodes.has(code))
              .map(([code, label]) => {
              // Đếm trong phạm vi TAB đang xem (không phải toàn bộ tháng), để số
              // trên chip khớp với bảng bên dưới.
              const n = tabRows.filter(
                (x) => x.violation_code === code && (side === 'ALL' || x.fault_side === side),
              ).length;
              const on = codes.includes(code);
              return (
                <button
                  key={code}
                  aria-pressed={on}
                  disabled={!n && !on}
                  onClick={() =>
                    setCodes((prev) =>
                      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
                    )
                  }
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    on
                      ? 'bg-gray-900 text-white border-transparent'
                      : n
                      ? `${CODE_STYLE[code] || 'bg-gray-50 text-gray-600 ring-gray-200'} border-transparent ring-1 hover:opacity-80`
                      : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 font-bold ${on ? 'text-white' : ''}`}>{n}</span>
                </button>
              );
            })}
            {codes.length > 0 && (
              <button
                onClick={() => setCodes([])}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 bg-white border border-gray-200 hover:text-rose-600 hover:border-rose-200"
              >
                Bỏ lọc loại lỗi
              </button>
            )}
          </div>
          </>
          )}
        </>
      )}

      {showViolationTable ? (
      <>
      {loading ? (
        <div className="py-16 text-center text-gray-400">Đang tải...</div>
      ) : !grouped.length ? (
        <div className="py-16 text-center text-gray-400">
          {isFiltered ? (
            <>
              Bộ lọc đang ẩn hết các dòng.{' '}
              <button onClick={clearFilters} className="underline font-semibold text-primary-700">
                Xoá bộ lọc
              </button>{' '}
              để xem lại {tabRows.length} dòng của tab này.
            </>
          ) : tab === 'WARN' ? (
            `Tháng ${month}/${year} không có trường hợp tạo đơn quá hạn nào.`
          ) : (
            `Tháng ${month}/${year} không có vi phạm nào bị phạt tiền.`
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={isOpen(g.key)}
                className="w-full text-left px-4 py-3 bg-gray-50 border-b border-gray-200
                           flex flex-wrap items-center gap-2 hover:bg-gray-100"
              >
                <ChevronRightIcon
                  className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                    isOpen(g.key) ? 'rotate-90' : ''}`}
                />
                {g.row.fault_side === 'EMPLOYEE'
                  ? <UserIcon className="w-4 h-4 text-rose-500 shrink-0" />
                  : <UserGroupIcon className="w-4 h-4 text-violet-500 shrink-0" />}
                <span className="font-bold text-gray-900">{g.row.responsible_name}</span>
                {g.row.responsible_code && (
                  <span className="text-xs text-gray-400 font-mono">{g.row.responsible_code}</span>
                )}
                {g.row.responsible_department && (
                  <span className="text-xs text-gray-500">· {g.row.responsible_department}</span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${
                  g.row.fault_side === 'EMPLOYEE'
                    ? 'bg-rose-50 text-rose-700 ring-rose-200'
                    : 'bg-violet-50 text-violet-700 ring-violet-200'}`}>
                  {FAULT_LABEL[g.row.fault_side]}
                </span>
                <span className="ml-auto flex items-baseline gap-3">
                  <span className="text-sm font-bold text-gray-700">{g.items.length} lỗi</span>
                  {(() => {
                    // Cộng theo dòng ĐANG HIỂN THỊ, không dùng group.penalty_total
                    // của backend — bộ lọc loại lỗi/nhóm lỗi làm số dòng đổi,
                    // tổng tiền phải đổi theo kẻo lệch với bảng đang xem.
                    const t = g.items.reduce((a, x) => a + (x.penalty_amount || 0), 0);
                    return t > 0
                      ? <span className="text-sm font-black text-rose-600">{fmtMoney(t)}</span>
                      : null;
                  })()}
                </span>
              </button>
              {isOpen(g.key) && (
              <div className="scrollbar-x-visible">
                <table className="min-w-full text-sm">
                  <thead>
                    {/* nowrap cho mọi tiêu đề: thiếu nó thì "Nội dung lỗi"
                        bị bẻ thành 3 dòng khi bảng bị bóp. Bảng đã nằm trong
                        overflow-x-auto nên thà cuộn ngang còn hơn vỡ chữ. */}
                    <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 whitespace-nowrap">
                      <th scope="col" className="px-4 py-2">Ngày nghỉ</th>
                      <th scope="col" className="px-4 py-2">Nội dung lỗi</th>
                      <th scope="col" className="px-4 py-2">Loại đơn</th>
                      <th scope="col" className="px-4 py-2">Nhân viên nghỉ</th>
                      <th scope="col" className="px-4 py-2">Hạn</th>
                      <th scope="col" className="px-4 py-2">Trễ</th>
                      <th scope="col" className="px-4 py-2">Tạo lúc</th>
                      <th scope="col" className="px-4 py-2">QLTT duyệt</th>
                      <th scope="col" className="px-4 py-2 text-right">Mức phạt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r, i) => (
                      <tr key={`${r.employee_id}-${r.event_date}-${r.violation_code}-${i}`}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                        <td className="px-4 py-2 whitespace-nowrap">
                          {fmtDateOnly(r.event_date)}
                          {(() => {
                            const wd = weekdayOf(r.event_date);
                            // Thứ 7 là ngày làm bình thường ở mọi phòng ban
                            // (HCNS xác nhận 2026-10-08) nên để xám như
                            // ngày thường; chỉ Chủ nhật tô nổi vì tuỳ phòng ban.
                            const cls = wd === 'CN'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-gray-100 text-gray-500';
                            return (
                              <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`}>
                                {wd}
                              </span>
                            );
                          })()}
                          {/* Kiểu nghỉ nằm NGAY DƯỚI ngày (HCNS 2026-10-14:
                              "dưới ngày nghỉ có badge ghi là nửa ngày hay 1
                              ngày"). Đặt ở đây thay vì cột Loại đơn để bảng
                              hẹp lại cho màn nhỏ, mà vẫn giải thích được vì
                              sao cùng một ngày lại có nhiều mốc Hạn khác nhau:
                              1 ngày = 17h30 hôm trước, nửa ngày = giờ vào ca − 4h. */}
                          {r.leave_style_label && (
                            <div className="mt-1">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                r.leave_style_label.startsWith('Nửa ngày')
                                  ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                                  : 'bg-gray-100 text-gray-600'}`}>
                                {r.leave_style_label}
                              </span>
                            </div>
                          )}
                        </td>
                        {/* whitespace-nowrap là BẮT BUỘC: thiếu nó thì nhãn bị
                            ngắt dòng giữa chữ ("Chưa / duyệt / đơn" trên 3
                            dòng) vì cột này hẹp — mọi ô khác trong bảng đều đã
                            có. Hai chú thích phụ xuống hàng riêng dạng chữ nhỏ
                            thay vì thêm 2 pill nữa cho đỡ rối. */}
                        <td className="px-4 py-2 align-top whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${
                            CODE_STYLE[r.violation_code] || 'bg-gray-50 text-gray-600 ring-gray-200'}`}>
                            {data?.violation_labels[r.violation_code] || r.violation_code}
                          </span>
                          {(r.has_grant || r.deadline_recomputed) && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] leading-none">
                              {r.has_grant && (
                                <span className="font-semibold text-sky-700">đã mở khoá</span>
                              )}
                              {r.has_grant && r.deadline_recomputed && (
                                <span className="text-gray-300">·</span>
                              )}
                              {/* Đơn không có snapshot mốc hạn -> báo cáo tự
                                  tính lại. Nói rõ vì đây là SUY LUẬN, không
                                  phải mốc hệ thống ghi lúc tạo đơn. */}
                              {r.deadline_recomputed && (
                                <span
                                  className="text-gray-500 underline decoration-dotted underline-offset-2"
                                  title="Đơn này không lưu mốc hạn lúc tạo; hạn được tính lại theo luật có hiệu lực lúc đó"
                                >
                                  hạn tính lại
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap align-top">
                          {r.pay_category ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${PAY_STYLE[r.pay_category]}`}>
                              {r.request_type_label}
                            </span>
                          ) : (
                            <span className="text-gray-400">{r.request_type_label}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-700">{r.employee_name}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                          {r.deadline_unknown ? <span className="text-gray-300">không xác định</span> : fmtDateTime(r.deadline)}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {r.overdue_minutes == null ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <span className={r.overdue_minutes < 60 ? 'text-amber-600' : 'text-rose-600 font-semibold'}>
                              {fmtOverdue(r.overdue_minutes)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500">{fmtDateTime(r.created_at)}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500">{fmtDateTime(r.approved_at)}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-right">
                          {/* Quyết định tay của HCNS — hiện rõ ai bấm, vì sao */}
                          {r.override && (
                            <div className="text-[11px] text-indigo-700 mb-0.5">
                              {r.override.action === 'apply' ? 'HCNS áp phạt' : 'HCNS gỡ phạt'}
                              {r.override.by ? ` · ${r.override.by}` : ''}
                              <span className="block text-gray-500">{r.override.reason}</span>
                            </div>
                          )}
                          {r.penalty_amount > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              {/* Nhãn CHỮ, không chỉ dựa vào màu — bảng tiền này
                                  HCNS in ra giấy đen trắng. */}
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                                PHẠT
                              </span>
                              <span className="font-bold text-rose-600 tabular-nums">
                                {fmtMoney(r.penalty_amount)}
                              </span>
                            </span>
                          ) : (
                            // Lý do 0 đồng do BACKEND trả (penalty_reason_label).
                            // Trước đây frontend tự đoán với nhánh cuối là `else`
                            // nên mọi dòng cảnh báo đều bị ghi sai "trước ngày
                            // hiệu lực" — nói sai lý do trên màn tiền.
                            <span className="inline-flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 ring-1 ring-gray-300">
                                0 ₫
                              </span>
                              <span className="text-xs text-gray-600">
                                {r.penalty_reason_label || '—'}
                              </span>
                            </span>
                          )}
                          {/* Chỉ HCNS/Admin mới áp/gỡ được phạt — backend cũng
                              chặn (PenaltyOverrideView). Thiếu rào này thì nhân
                              viên thường vẫn thấy nút rồi bấm vào ăn 403. */}
                          {canManage && (
                          <div className="mt-1 flex justify-end gap-1.5">
                            {r.penalty_amount > 0 ? (
                              <button
                                onClick={() => openOverride(r, 'waive', r.fault_side === 'MANAGER' ? 'MANAGER' : 'EMPLOYEE')}
                                className="text-[11px] font-semibold text-gray-600 underline hover:text-rose-700"
                              >
                                Gỡ phạt
                              </button>
                            ) : (
                              <button
                                onClick={() => openOverride(r, 'apply', r.fault_side === 'MANAGER' ? 'MANAGER' : 'EMPLOYEE')}
                                className="text-[11px] font-semibold text-gray-600 underline hover:text-rose-700"
                              >
                                Áp phạt
                              </button>
                            )}
                            {r.override && (
                              <button
                                onClick={() => openOverride(r, 'clear', r.fault_side === 'MANAGER' ? 'MANAGER' : 'EMPLOYEE')}
                                className="text-[11px] font-semibold text-gray-500 underline hover:text-gray-800"
                              >
                                Bỏ quyết định
                              </button>
                            )}
                          </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          ))}
        </div>
      )}

      </>
      ) : null}

      {/* Tab con "Mở khoá sau 3h làm việc" — nguồn dữ liệu khác hẳn nên thay
          cả phần nội dung, không hiện kèm bảng vi phạm. */}
      {/* Nạp ngầm để tab "Cảnh báo" có số đếm ĐÚNG ngay từ lúc vào trang.
          Trước đây chỉ nạp khi đang ở tab Cảnh báo, nên lúc mới vào (đang ở tab
          Phạt tiền) số trên tab Cảnh báo thiếu hẳn phần mốc 3 giờ — đúng cái
          HCNS bảo phải là TỔNG của 2 tab con.
          Điều kiện là "không phải lúc đang hiện bản thật", để không mount 2 lần. */}
      {canManage && !(tab === 'WARN' && warnSub === 'GRANT') && s && (
        <div hidden>
          <GrantTimingReport embedded year={year} month={month} onCount={setGrantCount} />
        </div>
      )}

      {tab === 'WARN' && warnSub === 'GRANT' && s && (
        <GrantTimingReport
          embedded
          year={year}
          month={month}
          onCount={setGrantCount}
          onApplyPenalty={canManage ? (g) => openOverride(
            {
              employee_id: g.employee_id,
              employee_code: g.employee_code,
              employee_name: g.employee_name,
              event_date: g.event_date,
              // Mặc định quy về bên nào: dòng "quản lý duyệt sau mốc" thì quy
              // cho quản lý, còn lại quy cho nhân viên. HCNS đổi được trong hộp.
              violation_code: g.causes.includes('APPROVED_LATE') ? 'APPROVED_LATE' : 'LATE_CREATED',
              responsible_name: g.causes.includes('APPROVED_LATE')
                ? (g.manager_name || '(chưa gán quản lý)') : g.employee_name,
              manager_name: g.manager_name,
            },
            'apply',
            g.causes.includes('APPROVED_LATE') ? 'MANAGER' : 'EMPLOYEE',
          ) : undefined}
        />
      )}

      {/* Hộp nhập lý do — bắt buộc với CẢ 3 thao tác, kể cả "bỏ quyết định",
          vì đều đụng tới tiền của người khác (HCNS 2026-10-12). */}
      {ovTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5">
            <h3 className="text-lg font-bold text-gray-900">
              {ovTarget.action === 'apply' && 'Áp phạt dòng này'}
              {ovTarget.action === 'waive' && 'Gỡ phạt dòng này'}
              {ovTarget.action === 'clear' && 'Bỏ quyết định, trả về tính tự động'}
            </h3>
            <div className="mt-2 text-sm text-gray-600 space-y-0.5">
              <p>
                <b>{ovTarget.row.employee_name}</b>{' '}
                <span className="font-mono text-xs">{ovTarget.row.employee_code}</span>
              </p>
              <p>
                Ngày nghỉ {fmtDateOnly(ovTarget.row.event_date)} ·{' '}
                {data?.violation_labels[ovTarget.row.violation_code] || ovTarget.row.violation_code}
              </p>
              <p>
                {ovTarget.action === 'apply'
                  ? <>Mức phạt: <b className="text-rose-600">{fmtMoney(s?.penalty_amount_per_violation)}</b></>
                  : <>Người chịu trách nhiệm: <b>{ovTarget.row.responsible_name}</b></>}
              </p>
            </div>
            {/* Phạt ai — đổi bên thì mã lỗi và lý do gợi ý đổi theo, vẫn sửa
                tay được (HCNS 2026-10-12). */}
            {ovTarget.action === 'apply' && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-gray-700 mb-1">Phạt ai?</p>
                <div className="flex gap-2">
                  {([
                    ['EMPLOYEE', 'Nhân viên', ovTarget.row.employee_name],
                    ['MANAGER', 'Quản lý',
                      ovTarget.row.manager_name || ovTarget.row.responsible_name || '(chưa gán quản lý)'],
                  ] as const).map(([k, label, who]) => {
                    const on = ovSide === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setOvSide(k);
                          setOvReason(hintsFor(codeForSide(ovTarget.row.violation_code, k), 'apply')[0] || '');
                        }}
                        className={`flex-1 text-left px-3 py-2 rounded-lg ring-1 ${
                          on ? 'bg-rose-50 text-rose-800 ring-rose-300' : 'bg-white text-gray-600 ring-gray-200'
                        }`}
                      >
                        <span className="block text-sm font-bold">{label}</span>
                        <span className="block text-xs truncate">{who}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Sẽ ghi lỗi{' '}
                  <b>
                    {data?.violation_labels[codeForSide(ovTarget.row.violation_code, ovSide)]
                      || codeForSide(ovTarget.row.violation_code, ovSide)}
                  </b>
                </p>
              </div>
            )}

            <label htmlFor="ov-reason" className="block text-sm font-semibold text-gray-700 mt-4 mb-1">
              Lý do <span className="text-rose-600">*</span>
            </label>
            {hintsFor(codeForSide(ovTarget.row.violation_code, ovSide), ovTarget.action).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {hintsFor(codeForSide(ovTarget.row.violation_code, ovSide), ovTarget.action).map((h) => {
                  const on = ovReason.trim() === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setOvReason(h)}
                      aria-pressed={on}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${
                        on ? 'bg-gray-900 text-white ring-gray-900'
                           : 'bg-gray-50 text-gray-700 ring-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              id="ov-reason"
              rows={3}
              value={ovReason}
              onChange={(e) => setOvReason(e.target.value)}
              placeholder="Ví dụ: Nhân viên có xác nhận của trưởng phòng, nghỉ đột xuất do việc gia đình"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Lý do và người bấm được lưu lại để đối chiếu sau.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOvTarget(null)} className="btn-secondary text-sm">
                Huỷ
              </button>
              <button
                onClick={submitOverride}
                disabled={ovSaving || !ovReason.trim()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {ovSaving ? 'Đang lưu...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chốt tháng — thao tác TRỪ TIỀN THẬT nên bắt buộc xem số trước khi bấm */}
      {finalizeOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-5 shadow-xl">
            <h3 className="font-bold text-lg text-gray-900 mb-1">
              Chốt phạt tháng {String(month).padStart(2, '0')}/{year}
            </h3>

            {finalizeDone ? (
              <>
                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200
                              rounded-lg px-3 py-2 mt-3">{finalizeDone}</p>
                <div className="flex justify-end mt-4">
                  <button onClick={() => { setFinalizeOpen(false); setFinalizeDone(null); }}
                    className="btn-primary text-sm">Đóng</button>
                </div>
              </>
            ) : !finalizePrev ? (
              <p className="text-sm text-gray-500 mt-3">Đang tính...</p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Tạo biên bản phạt bên bảng lương cho các dòng đã ra tiền.
                </p>
                <dl className="mt-3 rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                  <div className="flex justify-between px-3 py-2">
                    <dt className="text-gray-500">Số biên bản sẽ tạo</dt>
                    <dd className="font-bold text-gray-900">{finalizePrev.to_create}</dd>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <dt className="text-gray-500">Số người bị phạt</dt>
                    <dd className="font-bold text-gray-900">{finalizePrev.people}</dd>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <dt className="text-gray-500">Tổng tiền</dt>
                    <dd className="font-black text-rose-600">{fmtMoney(finalizePrev.total_amount)}</dd>
                  </div>
                  {finalizePrev.already_issued > 0 && (
                    <div className="flex justify-between px-3 py-2">
                      <dt className="text-gray-500">Đã chốt trước đó (bỏ qua)</dt>
                      <dd className="font-semibold text-gray-600">{finalizePrev.already_issued}</dd>
                    </div>
                  )}
                </dl>
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200
                              rounded-lg px-3 py-2 mt-3">
                  <b>Tiền này bị TRỪ THẲNG vào lương tháng {String(month).padStart(2, '0')}/{year}</b>,
                  biên bản tạo ra ở trạng thái đã duyệt. Mỗi người nhận 1 thông báo.
                  Bấm lại lần nữa chỉ thêm phần còn thiếu, không tạo trùng.
                </p>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setFinalizeOpen(false)} className="btn-secondary text-sm">
                    Huỷ
                  </button>
                  <button
                    onClick={doFinalize}
                    disabled={finalizeBusy || finalizePrev.to_create === 0}
                    className="btn-primary text-sm disabled:opacity-50"
                  >
                    {finalizeBusy ? 'Đang chốt...'
                      : finalizePrev.to_create === 0 ? 'Không có gì để chốt'
                      : `Chốt ${finalizePrev.to_create} biên bản`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveViolationReport;
