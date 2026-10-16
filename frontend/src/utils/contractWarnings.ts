// Cảnh báo mâu thuẫn ngày tháng / loại hợp đồng trên form sửa nhân viên.
// Form có 6 trường ngày (vào làm, hết thử việc, lên chính thức, bắt đầu HĐ, kết thúc
// HĐ, nghỉ việc) nên rất dễ lệch nhau mà không ai nhận ra. Những lệch đó không vô
// hại: loại HĐ còn là thử việc sau khi đã hết thử việc thì bảng lương vẫn tính theo
// chế độ thử việc; đã có ngày nghỉ mà trạng thái chưa đổi thì mọi báo cáo "đang làm
// việc" đều sai. Cảnh báo chỉ để rà soát, KHÔNG chặn lưu.

const PROBATION_TYPES = ['PROBATION'];
const OFFICIAL_TYPES = ['ONE_YEAR', 'TWO_YEAR', 'INDEFINITE'];
const NOT_WORKING_STATUSES = ['INACTIVE', 'PAUSED', 'SUSPENDED'];

/** "dd/mm/yyyy" -> Date (00:00) hoặc null */
const parseDisplayDate = (v: string): Date | null => {
  const m = (v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  return isNaN(d.getTime()) ? null : d;
};
const today0 = () => new Date(new Date().toDateString());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();

export interface ContractWarning {
  level: 'error' | 'warn';
  text: string;
}

export const buildContractWarnings = (f: any, today: Date = today0()): ContractWarning[] => {
  const w: ContractWarning[] = [];
  const ct = f.contract_type || '';
  const status = f.employment_status || '';
  const start = parseDisplayDate(f.start_date);
  const probEnd = parseDisplayDate(f.probation_end_date);
  const official = parseDisplayDate(f.official_start_date);
  const cStart = parseDisplayDate(f.contract_start_date);
  const cEnd = parseDisplayDate(f.contract_end_date);
  const quit = parseDisplayDate(f.end_date);
  const T = today;
  const isProbType = PROBATION_TYPES.includes(ct);
  const isOfficialType = OFFICIAL_TYPES.includes(ct);
  const notWorking = NOT_WORKING_STATUSES.includes(status);
  // Đã nghỉ việc rồi thì cảnh báo về loại HĐ không còn ý nghĩa — việc cần làm là
  // sửa trạng thái, nên bỏ bớt để cảnh báo đó nổi lên.
  const hasQuit = !!(quit && quit <= T);

  // ── Ảnh hưởng thẳng tới lương / báo cáo ──
  if (isProbType && probEnd && probEnd < T && !notWorking && !hasQuit) {
    w.push({ level: 'error', text:
      `Loại hợp đồng vẫn là thử việc nhưng đã hết hạn thử việc từ ${f.probation_end_date}. ` +
      `Bảng lương sẽ vẫn tính theo chế độ thử việc — hãy chọn đúng loại hợp đồng đã ký.` });
  }
  if (quit && quit <= T && status !== 'INACTIVE') {
    w.push({ level: 'error', text:
      `Đã có ngày nghỉ việc ${f.end_date} nhưng trạng thái chưa phải "Đã nghỉ". ` +
      `Báo cáo nhân sự và bảng lương sẽ vẫn tính người này là đang làm việc.` });
  }
  if (status === 'INACTIVE' && !quit) {
    w.push({ level: 'error', text:
      `Trạng thái là "Đã nghỉ" nhưng chưa điền Ngày nghỉ việc. ` +
      `Thiếu ngày này thì không chốt được kỳ lương cuối và không tính được thâm niên.` });
  }

  // ── Ngày tháng mâu thuẫn ──
  if (start && probEnd && probEnd <= start) {
    w.push({ level: 'error', text:
      `Ngày kết thúc thử việc (${f.probation_end_date}) không sau Ngày vào làm (${f.start_date}).` });
  }
  if (probEnd && probEnd < T && !official && !notWorking && !hasQuit) {
    w.push({ level: 'warn', text:
      `Đã hết thử việc từ ${f.probation_end_date} nhưng chưa có Ngày lên chính thức.` });
  }
  if (official && start && sameDay(official, start) && probEnd && probEnd > start) {
    w.push({ level: 'warn', text:
      `Ngày lên chính thức đang trùng Ngày vào làm (${f.start_date}) trong khi thử việc kéo dài ` +
      `tới ${f.probation_end_date} — nhiều khả năng là giá trị mặc định chưa được sửa.` });
  }
  if (official && probEnd && start && official > start && !sameDay(official, addDays(probEnd, 1))) {
    w.push({ level: 'warn', text:
      `Ngày lên chính thức (${f.official_start_date}) không phải ngày liền sau Ngày hết thử việc ` +
      `(${f.probation_end_date}). Kiểm tra lại nếu không có thoả thuận riêng.` });
  }
  if (cStart && start && cStart < start) {
    w.push({ level: 'error', text:
      `Ngày bắt đầu hợp đồng (${f.contract_start_date}) trước Ngày vào làm (${f.start_date}).` });
  }
  if (cStart && cEnd && cEnd <= cStart) {
    w.push({ level: 'error', text:
      `Ngày kết thúc hợp đồng (${f.contract_end_date}) không sau Ngày bắt đầu (${f.contract_start_date}).` });
  }
  if (isOfficialType && !cStart) {
    w.push({ level: 'warn', text: `Đã là hợp đồng chính thức nhưng chưa có Ngày bắt đầu hợp đồng.` });
  }
  if (cEnd && cEnd < T && !notWorking && !hasQuit) {
    w.push({ level: 'error', text:
      `Hợp đồng đã hết hạn từ ${f.contract_end_date} mà nhân viên vẫn đang làm việc — cần ký phụ lục hoặc hợp đồng mới.` });
  }
  return w;
};
