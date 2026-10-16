import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  MagnifyingGlassIcon,
  BuildingOfficeIcon,
  UserIcon,
  PencilIcon,
  XMarkIcon,
  CheckIcon,
  ArrowPathIcon,
  CurrencyDollarIcon,
  TableCellsIcon,
  ExclamationCircleIcon,
  FunnelIcon,
  EyeIcon,
  PrinterIcon,
  EnvelopeIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { employeesAPI } from '../utils/api';
import type { Department, Employee } from '../utils/api';
import { salaryService, SalaryFormulaUpdateData, SalaryRecord, PenaltyRecord, CommissionRecord, type BulkSalaryConfigRecord, type PayslipEmailBatchStatus, type DepartmentPayslipRecipientsResponse, type CompanyPayslipRecipientsResponse, type MonthlySalaryInputRecord } from '../services/salary.service';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { BRAND } from '@/config/brand';

const TABS = [
  { key: 'config', label: 'Cấu hình tính lương', icon: CurrencyDollarIcon },
  { key: 'view', label: 'Bảng lương', icon: TableCellsIcon },
];

function getStandardWorkDays(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays++;
  }
  return Math.max(daysInMonth - sundays - 1, 1);
}

const getStandardWorkDaysFromRecord = (record: SalaryRecord): number => {
  const backendStandardDays = toNumber((record as unknown as Record<string, unknown>)['cong_chuan'], 0);
  if (backendStandardDays > 0) return backendStandardDays;
  return getStandardWorkDays(record.year, record.month);
};

type SalaryTabKey = 'config' | 'view';

// ─── Tax Tooltip Component ───────────────────────────────────────────────────

// Registry toàn cục: chỉ 1 tooltip mở tại 1 thời điểm
let _closeActiveTaxTooltip: (() => void) | null = null;

interface TaxTooltipProps {
  taxDetail: TaxCalculationDetail;
}

const TaxTooltip: React.FC<TaxTooltipProps> = ({ taxDetail }) => {
  const [showDetail, setShowDetail] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    setShowDetail(false);
    if (_closeActiveTaxTooltip === close) _closeActiveTaxTooltip = null;
  }, []);

  React.useEffect(() => () => { if (_closeActiveTaxTooltip === close) _closeActiveTaxTooltip = null; }, [close]);

  // Đóng khi scroll để tránh nhầm lẫn tooltip thuộc row nào
  React.useEffect(() => {
    if (!showDetail) return;
    const handleScroll = () => close();
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
  }, [showDetail, close]);

  const handleOpen = () => {
    if (_closeActiveTaxTooltip && _closeActiveTaxTooltip !== close) _closeActiveTaxTooltip();
    if (!showDetail) {
      _closeActiveTaxTooltip = close;
      setPopupStyle({ visibility: 'hidden' });
      setShowDetail(true);
    } else {
      close();
    }
  };

  React.useLayoutEffect(() => {
    if (!showDetail || !popupRef.current || !btnRef.current) return;
    const btn = btnRef.current.getBoundingClientRect();
    const popH = popupRef.current.offsetHeight;
    const POPUP_W = 384;
    const MARGIN = 8;
    const left = Math.max(MARGIN, Math.min(btn.right - POPUP_W, window.innerWidth - POPUP_W - MARGIN));
    const spaceBelow = window.innerHeight - btn.bottom - MARGIN;
    const spaceAbove = btn.top - MARGIN;
    const top = spaceBelow >= popH ? btn.bottom + MARGIN
              : spaceAbove >= popH ? btn.top - popH - MARGIN
              : MARGIN;
    setPopupStyle({
      position: 'fixed', top, left, width: POPUP_W,
      maxHeight: `calc(100vh - ${top + MARGIN}px)`,
      visibility: 'visible',
    });
  }, [showDetail]);

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors"
        title="Xem chi tiết tính thuế"
      >
        <QuestionMarkCircleIcon className="h-4 w-4" />
      </button>
      {showDetail && createPortal(
        <>
          {/* Backdrop trong suốt để click ngoài đóng */}
          <div className="fixed inset-0 z-[99998]" onClick={close} />
          <div
            ref={popupRef}
            style={popupStyle}
            className="z-[99999] bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col overflow-hidden"
          >
            <div className="flex-shrink-0 flex items-center justify-between border-b px-4 py-3">
              <h4 className="font-semibold text-gray-900">Chi tiết tính thuế TNCN</h4>
              <button onClick={close} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              <div className="space-y-2 text-sm">
                <p className="text-xs text-indigo-700 bg-indigo-50 rounded px-2 py-1">
                  {taxDetail.taxMode === 'flat_10'
                    ? 'Công thức: Thuế TNCN = 10% × Tổng thu nhập chịu thuế trong tháng'
                    : 'Công thức: Thuế TNCN = Σ(Thu nhập trong từng bậc × Thuế suất bậc đó)'}
                </p>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tổng thu nhập không tính phụ cấp ăn trưa:</span>
                  <span className="font-semibold">{formatCurrency(taxDetail.grossIncome)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Trừ BHXH + BHYT + BHTN:</span>
                  <span className="font-semibold text-red-600">-{formatCurrency(taxDetail.insuranceDeduction)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Trừ giảm trừ bản thân:</span>
                  <span className="font-semibold text-red-600">-{formatCurrency(taxDetail.personalDeduction)}</span>
                </div>
                {taxDetail.dependentDeduction > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Trừ giảm trừ người phụ thuộc:</span>
                    <span className="font-semibold text-red-600">-{formatCurrency(taxDetail.dependentDeduction)}</span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold text-blue-700">Thu nhập tính thuế:</span>
                  <span className="font-bold text-blue-800">{formatCurrency(taxDetail.taxableIncome)}</span>
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="font-semibold text-gray-900 text-xs mb-2">
                  {taxDetail.taxMode === 'flat_10' ? 'Chi tiết tính thuế 10%:' : 'Áp dụng bảng thuế lũy tiến:'}
                </p>
                {taxDetail.taxMode === 'flat_10' ? (
                  <div className="text-xs rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-gray-700 flex items-center justify-between">
                    <span>10% × {formatCurrency(taxDetail.taxableIncome)}</span>
                    <span className="font-bold text-indigo-600">{formatCurrency(taxDetail.totalTax)}</span>
                  </div>
                ) : taxDetail.breakdown.length > 0 ? (
                  <div className="space-y-2 text-xs">
                    {taxDetail.breakdown.map((item) => (
                      <div key={item.bracketNumber} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-gray-700">
                        <div className="font-medium text-gray-800">
                          Bậc {item.bracketNumber}: {formatCurrency(item.fromAmount)} đến{' '}
                          {item.toAmount === Number.POSITIVE_INFINITY ? 'trở lên' : formatCurrency(item.toAmount)} · thuế suất {item.rate}%
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <div className="text-gray-600">Thu nhập chịu thuế trong bậc</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(item.taxableAmount)}</div>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <div className="text-gray-600">{formatCurrency(item.taxableAmount)} × {item.rate}%</div>
                          <div className="font-bold text-indigo-600">{formatCurrency(item.taxAmount)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Thu nhập tính thuế không vượt ngưỡng chịu thuế, nên thuế TNCN = 0đ.</p>
                )}
              </div>
            </div>
            <div className="flex-shrink-0 border-t flex justify-between bg-indigo-50 px-4 py-3 rounded-b-lg">
              <span className="font-bold text-indigo-900">Tổng thuế TNCN:</span>
              <span className="font-bold text-indigo-900">{formatCurrency(taxDetail.totalTax)}</span>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};

// ─── Payslip Detail Modal ────────────────────────────────────────────────────

interface PayslipDetailModalProps {
  record: SalaryRecord;
  onClose: () => void;
  employee?: Employee;
  penalties?: PenaltyRecord[];
  commissions?: CommissionRecord[];
  onEmailQueued?: (employeeId: number) => void;
}

const getSalesCommissionAmount = (record: SalaryRecord, commissions?: CommissionRecord[]) => {
  const fromMonthlyInput = (record as unknown as Record<string, number | null>)['luong_doanh_so_input'];
  if (fromMonthlyInput !== null && fromMonthlyInput !== undefined) {
    return toNumber(fromMonthlyInput, 0);
  }
  const commissionTotal = commissions?.reduce((sum, item) => {
    return item.employee === record.employee_id ? sum + toNumber(item.amount) : sum;
  }, 0) ?? 0;
  if (commissionTotal > 0) return commissionTotal;
  return (record as unknown as Record<string, number>)['luong_doanh_so'] ?? 0;
};

const getMonthlyInputIncomeBreakdown = (record: SalaryRecord, commissions?: CommissionRecord[]) => {
  const asNumberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const luongOtInput = asNumberOrNull((record as unknown as Record<string, unknown>)['luong_ot_input']);
  const banSanPhamInput = asNumberOrNull((record as unknown as Record<string, unknown>)['ban_san_pham_input']);
  const phuMoInput = asNumberOrNull((record as unknown as Record<string, unknown>)['phu_mo_input']);
  const trucCaInput = asNumberOrNull((record as unknown as Record<string, unknown>)['truc_ca_input']);
  const thuongInput = asNumberOrNull((record as unknown as Record<string, unknown>)['thuong_input']);

  const luongDoanhSo = getSalesCommissionAmount(record, commissions);
  const luongOt = luongOtInput ?? (record.luong_tang_ca ?? 0);
  const banSanPham = banSanPhamInput ?? 0;
  const phuMo = phuMoInput ?? 0;
  const trucCa = trucCaInput ?? (record.truc_toi ?? 0);
  const thuong = thuongInput ?? ((record as unknown as Record<string, number>)['thuong'] ?? 0);
  const thuNhapKhac = (record as unknown as Record<string, number>)['thu_nhap_khac'] ?? 0;

  return {
    luongDoanhSo,
    luongOt,
    banSanPham,
    phuMo,
    trucCa,
    thuong,
    thuNhapKhac,
  };
};

const PayslipDetailModal: React.FC<PayslipDetailModalProps> = ({ record, onClose, employee, penalties, commissions, onEmailQueued }) => {
  useLockBodyScroll(true);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailAddr, setEmailAddr] = useState(employee?.personal_email ?? '');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const stdDays = getStandardWorkDaysFromRecord(record);
  const payslipComputation = calculatePayslipNetPayable(record, employee, commissions);
  const payrollTax = payslipComputation.payrollTax;
  const nptCount = payrollTax.dependentCount;
  const mucLuongDongBH = payrollTax.insuranceSalaryBase;
  const workdayBreakdown = getWorkdaySalaryBreakdown(record, employee);

  // Section III
  const luongNgayCongThucTe = workdayBreakdown.tongLuongNgayCong;
  const luongCongThuViec = workdayBreakdown.luongCongThuViec;
  const luongCongChinhThuc = workdayBreakdown.luongCongChinhThuc;
  const congThuViec = workdayBreakdown.congThuViec;
  const congChinhThuc = workdayBreakdown.congChinhThuc;
  const probationRatePercent = workdayBreakdown.probationRatePercent;
  const hasProbationDays = workdayBreakdown.hasProbationDays;
  const incomeBreakdown = getMonthlyInputIncomeBreakdown(record, commissions);
  const luongDoanhSo = incomeBreakdown.luongDoanhSo;
  const luongOt = incomeBreakdown.luongOt;
  const banSanPham = incomeBreakdown.banSanPham;
  const phuMo = incomeBreakdown.phuMo;
  const trucCa = incomeBreakdown.trucCa;
  const thuNhapKhac = incomeBreakdown.thuNhapKhac;
  const thuong = incomeBreakdown.thuong;
  const tongLuongIII = luongNgayCongThucTe + luongDoanhSo + luongOt + banSanPham + phuMo + trucCa + thuNhapKhac;

  // Deductions: use saved payroll config if available, otherwise calculate from standard rates
  const savedAdjustments = employee ? (employee.salary_adjustments as Record<string, unknown> | undefined) : undefined;
  const savedConfig = savedAdjustments?.payroll_config as Record<string, unknown> | undefined;

  // Parking allowance: recalculate from policy if configured, else use stored value
  const savedParkingPolicyRaw = savedConfig?.parkingAllowancePolicy as Record<string, unknown> | undefined;
  const parkingPolicy: ParkingAllowancePolicy | null = savedParkingPolicyRaw
    ? {
        mode: savedParkingPolicyRaw.mode === 'daily' ? 'daily' : savedParkingPolicyRaw.mode === 'monthly' ? 'monthly' : 'none',
        daily_rate: toNumber(savedParkingPolicyRaw.daily_rate, 5000),
        monthly_rate: toNumber(savedParkingPolicyRaw.monthly_rate, 0),
      }
    : null;
  const phuCapGuiXe = parkingPolicy ? calculateParkingAllowance(parkingPolicy, record.ngay_cong) : (record.phu_cap_gui_xe ?? 0);

  // Lunch allowance: recalculate from policy + actual work days
  const savedLunchPolicyRaw = (savedConfig?.lunchAllowancePolicy as Record<string, unknown> | undefined);
  const lunchPolicy: LunchAllowancePolicy | null = savedLunchPolicyRaw
    ? {
        mode: savedLunchPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'fixed',
        fixed_amount: toNumber(savedLunchPolicyRaw.fixed_amount),
        amount_per_work_day: toNumber(savedLunchPolicyRaw.amount_per_work_day),
        monthly_cap: toNumber(savedLunchPolicyRaw.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP),
      }
    : null;
  const phuCapAnTrua = toNumber(
    (record as unknown as Record<string, unknown>)['phu_cap_an_trua'],
    lunchPolicy ? calculateLunchAllowance(lunchPolicy, record.tong_cong ?? 0, stdDays) : 0,
  );

  // Responsibility allowance: recalculate from policy
  const savedRespPolicyRaw = savedConfig?.responsibilityAllowancePolicy as Record<string, unknown> | undefined;
  const respPolicy: ResponsibilityAllowancePolicy | null = savedRespPolicyRaw
    ? {
        mode: savedRespPolicyRaw.mode === 'fixed' ? 'fixed' : savedRespPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'none',
        monthly_max: toNumber(savedRespPolicyRaw.monthly_max),
      }
    : null;
  const phuCapTrachNhiem = respPolicy ? calculateResponsibilityAllowance(respPolicy, record.tong_cong ?? 0, stdDays) : 0;
  const phuCapLivestream = toNumber((record as unknown as Record<string, number>)['phu_cap_livestream'], 0);
  const soPhienLivestream = Math.max(toNumber((record as unknown as Record<string, number>)['so_phien_livestream'], 0), 0);

  const phuCapKhacFromRecord = (record as unknown as Record<string, number>)['phu_cap_khac'] ?? 0;
  const phuCapKhacRemainder = Math.max(
    phuCapKhacFromRecord,
    Math.max((record.phu_cap ?? 0) - phuCapGuiXe - phuCapAnTrua - phuCapTrachNhiem - phuCapLivestream, 0),
  );
  const tongPhuCapIV = phuCapGuiXe + phuCapAnTrua + phuCapTrachNhiem + phuCapLivestream + phuCapKhacRemainder;
  const tongThuNhapVI = tongLuongIII + tongPhuCapIV + thuong;

  const bhxh = payrollTax.socialInsurance;
  const bhyt = payrollTax.healthInsurance;
  const bhtn = payrollTax.unemploymentInsurance;
  const tongBH = payrollTax.insuranceTotal;
  const congDoan = toNumber((record as unknown as Record<string, number>)['cong_doan'], 
    (savedConfig?.deductions as Record<string, number> | undefined)?.unionFee ?? 0);
  const phatDiMuon = record.tong_phat ?? 0;
  const phatBienBan = record.tong_phat_bienban ?? 0;
  const tongGiamTruVII = tongBH + congDoan + phatDiMuon + phatBienBan;
  const dieuChinhVIII = (record as unknown as Record<string, number>)['dieu_chinh'] ?? 0;
  const tamUng = record.tam_ung ?? 0;
  const taxDetail = payrollTax.taxDetail;
  const thue = payrollTax.taxAmount;
  const contractStatusText = record.contract_status === 'THU_VIEC' ? 'Thử việc' : 'Chính thức';
  const luongThucLinh = payslipComputation.luongThucLinh;
  const conPhaiTT = payslipComputation.conPhaiThanhToan;

  const fmt = (v: number) => v ? Math.round(v).toLocaleString('vi-VN') : '—';

  const monthLabel = `Tháng ${String(record.month).padStart(2, '0')}.${record.year}`;

  const handlePrint = () => {
    window.print();
  };

  const buildEmailBody = () => {
    const fmtN = (v: number) => v ? Math.round(v).toLocaleString('vi-VN') + ' đ' : '—';
    const lines = [
      `Kính gửi ${record.ho_va_ten},`,
      '',
      `Phòng nhân sự trân trọng gửi phiếu lương ${monthLabel} của bạn.`,
      '',
      '════════════════════════════════════════',
      '  THÔNG TIN NHÂN VIÊN',
      '────────────────────────────────────────',
      `  Mã nhân viên      : ${record.ma_nv}`,
      `  Họ và tên         : ${record.ho_va_ten}`,
      `  Phòng ban          : ${record.phong_ban ?? '—'}`,
      `  Chức vụ            : ${record.vi_tri ?? '—'}`,
      `  HĐ lao động        : ${contractStatusText}`,
      '────────────────────────────────────────',
      '  THÔNG TIN CÔNG',
      '────────────────────────────────────────',
      `  Công chuẩn         : ${stdDays} công`,
      `  Ngày công thực tế  : ${record.tong_cong}`,
      ...(hasProbationDays ? [`  Công TV / CT       : ${congThuViec} / ${congChinhThuc}`] : []),
      `  Giờ tăng ca        : ${record.so_gio_tang_ca ?? record.tang_ca ?? 0}`,
      '────────────────────────────────────────',
      '  CÁC KHOẢN THU NHẬP',
      '────────────────────────────────────────',
      `  Lương ngày công    : ${fmtN(luongNgayCongThucTe)}`,
      ...(hasProbationDays ? [`  └─ Lương công TV (${probationRatePercent}%) : ${fmtN(luongCongThuViec)}`] : []),
      ...(hasProbationDays ? [`  └─ Lương công CT    : ${fmtN(luongCongChinhThuc)}`] : []),
      ...(luongDoanhSo ? [`  Lương doanh số     : ${fmtN(luongDoanhSo)}`] : []),
      ...(luongOt ? [`  Lương OT            : ${fmtN(luongOt)}`] : []),
      ...(banSanPham ? [`  Bán sản phẩm        : ${fmtN(banSanPham)}`] : []),
      ...(phuMo ? [`  Phụ mổ              : ${fmtN(phuMo)}`] : []),
      ...(trucCa ? [`  Trực ca             : ${fmtN(trucCa)}`] : []),
      ...(thuNhapKhac ? [`  Thu nhập khác      : ${fmtN(thuNhapKhac)}`] : []),
      ...(thuong ? [`  Thưởng             : ${fmtN(thuong)}`] : []),
      '────────────────────────────────────────',
      '  CÁC KHOẢN PHỤ CẤP',
      '────────────────────────────────────────',
      ...(phuCapGuiXe ? [`  Phụ cấp gửi xe     : ${fmtN(phuCapGuiXe)}`] : []),
      ...(phuCapAnTrua ? [`  Phụ cấp ăn trưa    : ${fmtN(phuCapAnTrua)}`] : []),
      ...(phuCapTrachNhiem ? [`  Phụ cấp trách nhiệm: ${fmtN(phuCapTrachNhiem)}`] : []),
      ...(phuCapLivestream ? [`  Phụ cấp livestream (${soPhienLivestream} phiên): ${fmtN(phuCapLivestream)}`] : []),
      ...(phuCapKhacRemainder ? [`  Phụ cấp khác       : ${fmtN(phuCapKhacRemainder)}`] : []),
      `  Tổng thu nhập      : ${fmtN(tongThuNhapVI)}`,
      '────────────────────────────────────────',
      '  CÁC KHOẢN KHẤU TRỪ',
      '────────────────────────────────────────',
      `  BHXH               : -${fmtN(bhxh)}`,
      `  BHYT               : -${fmtN(bhyt)}`,
      `  BHTN               : -${fmtN(bhtn)}`,
      ...(congDoan ? [`  Công đoàn          : -${fmtN(congDoan)}`] : []),
      ...(phatDiMuon ? [`  Phạt đi muộn       : -${fmtN(phatDiMuon)}`] : []),
      ...(phatBienBan ? [`  Phạt (biên bản)    : -${fmtN(phatBienBan)}`] : []),
      ...(thue ? [`  Thuế TNCN          : -${fmtN(thue)}`] : []),
      ...(tamUng ? [`  Tạm ứng            : -${fmtN(tamUng)}`] : []),
      '════════════════════════════════════════',
      `  LƯƠNG THỰC LĨNH    : ${fmtN(luongThucLinh)}`,
      `  CÒN PHẢI TT        : ${fmtN(conPhaiTT)}`,
      '════════════════════════════════════════',
      '',
      'Nếu có thắc mắc về bảng lương, vui lòng liên hệ phòng Nhân sự.',
      '',
      'Trân trọng,',
      'Phòng Nhân sự',
    ];
    return lines.join('\n');
  };

    const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

    const defaultEmailSubject = `[Phiếu lương] ${monthLabel} - ${record.ho_va_ten}`;
    const defaultEmailBody = buildEmailBody();

    const buildEmailPreviewHtml = (subject: string, body: string) => {
    const logoUrl = new URL(BRAND.logoUrl, window.location.origin).href;
    const bannerUrl = '';
    const safeSubject = escapeHtml(subject);
    const safeBody = escapeHtml(body).replace(/\n/g, '<br>');

    return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; margin: 0; padding: 0; background-color: #f8fafc;">
  <table style="width: 100%; border-collapse: collapse;" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding: 20px 12px;">
        <table style="width: 100%; max-width: 640px; border-collapse: collapse; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.06);" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="padding: 0;">
              ${bannerUrl ? `<img src="${bannerUrl}" alt="Banner" style="width: 100%; max-width: 640px; display: block;">` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 24px;">
              <p style="margin: 0 0 12px;">Kính gửi Anh/Chị,</p>
              <p style="margin: 0 0 12px;">Phòng Hành chính Nhân sự gửi Anh/Chị phiếu lương với thông tin chi tiết như bên dưới.</p>

              <p style="color: #1a73e8; font-weight: 700; margin: 16px 0 8px;">${safeSubject}</p>
              <div style="background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; line-height: 1.65; color: #111827;">
                ${safeBody}
              </div>

              <p style="margin: 16px 0 0;">Nếu cần hỗ trợ thêm, Anh/Chị vui lòng phản hồi email này hoặc liên hệ Phòng HCNS.</p>
              <p style="margin: 12px 0 0;">Trân trọng!</p>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <table style="border-collapse: collapse;" role="presentation">
                <tr>
                  <td style="width: 80px; vertical-align: middle; padding-right: 16px;">
                  </td>
                  <td style="vertical-align: middle; color: #666; font-size: 13px; line-height: 1.5;">
                  Trân trọng!
                  ${BRAND.hrDepartmentLabel}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  </body>
  </html>`;
    };

    const previewSubject = emailSubject || defaultEmailSubject;
    const previewBody = emailBody || defaultEmailBody;
    const emailPreviewHtml = buildEmailPreviewHtml(previewSubject, previewBody);

  const handleOpenEmailModal = () => {
    setEmailAddr(employee?.personal_email ?? '');
    setEmailSubject(defaultEmailSubject);
    setEmailBody(defaultEmailBody);
    setEmailResult(null);
    setEmailModalOpen(true);
  };

  const handleConfirmSendEmail = async () => {
    if (!emailAddr.trim()) return;
    if (!emailSubject.trim() || !emailBody.trim()) {
      setEmailResult({ ok: false, msg: 'Tiêu đề và nội dung email không được để trống.' });
      return;
    }
    setEmailSending(true);
    setEmailResult(null);
    try {
      await salaryService.sendPayslipEmail(
        {
          email: emailAddr.trim(),
          subject: emailSubject.trim(),
          body: emailBody.trim(),
          employee_id: record.employee_id,
          year: record.year,
          month: record.month,
          recipient_name: record.ho_va_ten,
        },
        { timeoutMs: 180000 }
      );
      onEmailQueued?.(record.employee_id);
      setEmailModalOpen(false);
      setEmailResult({ ok: true, msg: `Đã xếp hàng gửi phiếu lương đến ${emailAddr.trim()}.` });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Gửi email thất bại.';
      setEmailResult({ ok: false, msg });
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — sticky */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-indigo-50 rounded-t-xl print:hidden">
          <div>
            <h2 className="text-base font-bold text-indigo-800 uppercase tracking-wide">
              Phiếu thanh toán lương {monthLabel}
            </h2>
            <p className="text-sm text-indigo-600 mt-0.5">{record.ho_va_ten} · {record.ma_nv}</p>
            <p className="text-xs text-indigo-500 mt-0.5">Trạng thái hợp đồng: {contractStatusText}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenEmailModal}
              className="p-2 rounded-lg text-gray-500 hover:bg-blue-100 hover:text-blue-700 transition-colors"
              title="Gửi phiếu lương qua email"
            >
              <EnvelopeIcon className="h-5 w-5" />
            </button>
            <button
              onClick={handlePrint}
              className="p-2 rounded-lg text-gray-500 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
              title="In phiếu lương"
            >
              <PrinterIcon className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-red-100 hover:text-red-600 transition-colors"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Payslip body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-600 w-10">STT</th>
                <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">DANH MỤC</th>
                <th className="border border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600 w-36">TIỀN LƯƠNG</th>
              </tr>
            </thead>
            <tbody>
              {/* Section I */}
              <tr className="bg-indigo-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-indigo-700">I</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-indigo-700" colSpan={2}>THÔNG TIN NHÂN VIÊN</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">1</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Mã nhân viên</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-mono text-gray-800">{record.ma_nv}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">2</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Họ và tên</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{record.ho_va_ten}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">3</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Phòng ban</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{record.phong_ban ?? '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">4</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Chức vụ</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{record.vi_tri ?? '—'}</td>
              </tr>

              {/* Section II */}
              <tr className="bg-indigo-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-indigo-700">II</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-indigo-700" colSpan={2}>THÔNG TIN TÍNH LƯƠNG</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">5</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Công chuẩn tính lương</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{stdDays} công</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">6</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Lương cơ bản</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-medium text-gray-800">{fmt(record.luong_co_ban)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">7</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Ngày công thực tế</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{record.tong_cong}</td>
              </tr>
              {hasProbationDays && (
                <tr>
                  <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">7a</td>
                  <td className="border border-gray-300 px-3 py-2 text-gray-700">Công thử việc / công chính thức</td>
                  <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{congThuViec} / {congChinhThuc}</td>
                </tr>
              )}
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">8</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Số giờ tăng ca</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{record.so_gio_tang_ca ?? record.tang_ca ?? 0}</td>
              </tr>

              {/* Section III */}
              <tr className="bg-blue-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-blue-700">III</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-blue-700" colSpan={2}>CÁC KHOẢN LƯƠNG TRONG THÁNG</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">9</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Lương ngày công thực tế</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{fmt(luongNgayCongThucTe)}</td>
              </tr>
              {hasProbationDays && (
                <>
                  <tr>
                    <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">9a</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-700">Lương công thử việc ({probationRatePercent}%)</td>
                    <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{fmt(luongCongThuViec)}</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">9b</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-700">Lương công chính thức</td>
                    <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{fmt(luongCongChinhThuc)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">10</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Lương doanh số</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{luongDoanhSo ? fmt(luongDoanhSo) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">11</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Lương OT</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{luongOt ? fmt(luongOt) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">12</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Bán sản phẩm</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{banSanPham ? fmt(banSanPham) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">13</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Phụ mổ</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{phuMo ? fmt(phuMo) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">13a</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Trực ca</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{trucCa ? fmt(trucCa) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">13b</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Thu nhập khác</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{thuNhapKhac ? fmt(thuNhapKhac) : '—'}</td>
              </tr>

              {/* Section IV */}
              <tr className="bg-green-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-green-700">IV</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-green-700" colSpan={2}>CÁC KHOẢN PHỤ CẤP</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">14</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">
                  {parkingPolicy?.mode === 'daily'
                    ? `Phụ cấp gửi xe (${Math.ceil(record.ngay_cong)} ngày × ${parkingPolicy.daily_rate.toLocaleString('vi-VN')}đ)`
                    : parkingPolicy?.mode === 'monthly'
                    ? 'Phụ cấp gửi xe (vé tháng)'
                    : 'Phụ cấp gửi xe'}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{phuCapGuiXe ? fmt(phuCapGuiXe) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">15</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">
                  {lunchPolicy?.mode === 'actual_working_day'
                    ? `Phụ cấp ăn trưa (${record.tong_cong ?? 0}/${stdDays} công × ${Math.round(Math.min(toNumber(lunchPolicy.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP), MAX_LUNCH_ALLOWANCE_CAP) / stdDays).toLocaleString('vi-VN')}đ)`
                    : 'Phụ cấp ăn trưa'}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{phuCapAnTrua ? fmt(phuCapAnTrua) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-400">*</td>
                <td className="border border-gray-300 px-3 py-2 text-xs text-gray-500" colSpan={2}>
                  Ghi chú: Phụ cấp ăn trưa được cộng vào tổng thu nhập (VI) nhưng không dùng để tính thuế TNCN.
                </td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">16</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">
                  {respPolicy?.mode === 'actual_working_day'
                    ? `Phụ cấp trách nhiệm (${record.tong_cong ?? 0}/${stdDays} công × ${Math.round(respPolicy.monthly_max / stdDays).toLocaleString('vi-VN')}đ)`
                    : 'Phụ cấp trách nhiệm / chức vụ'}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{phuCapTrachNhiem ? fmt(phuCapTrachNhiem) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">17</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">
                  Phụ cấp livestream {soPhienLivestream > 0 ? `(${soPhienLivestream} phiên)` : ''}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{phuCapLivestream ? fmt(phuCapLivestream) : '—'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">17a</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Phụ cấp khác</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{phuCapKhacRemainder ? fmt(phuCapKhacRemainder) : '—'}</td>
              </tr>

              {/* Section V */}
              <tr className="bg-yellow-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-yellow-700">V</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-yellow-700">THƯỞNG</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-medium text-yellow-700">{thuong ? fmt(thuong) : '—'}</td>
              </tr>

              {/* Section VI */}
              <tr className="bg-indigo-100">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-indigo-800">VI</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-indigo-800">TỔNG THU NHẬP (III+IV+V)</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-bold text-indigo-800">{fmt(tongThuNhapVI)}</td>
              </tr>

              {/* Section VII */}
              <tr className="bg-red-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-red-700">VII</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-red-700" colSpan={2}>CÁC KHOẢN GIẢM TRỪ</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">18</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Mức lương đóng BH</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">{fmt(mucLuongDongBH)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">19</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">BHXH (10.5%)</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-red-600">{fmt(tongBH)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">20</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Công đoàn</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-red-600">{fmt(congDoan)}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">21</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">Phạt đi muộn + phạt biên bản</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-red-600">{(phatDiMuon + phatBienBan) > 0 ? fmt(phatDiMuon + phatBienBan) : '—'}</td>
              </tr>
              <tr className="bg-red-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-semibold text-red-700" colSpan={2}>
                  <span className="text-xs">Tổng giảm trừ (VII)</span>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right font-semibold text-red-700">{fmt(tongGiamTruVII)}</td>
              </tr>

              {/* Section VIII */}
              <tr className="bg-gray-50">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-gray-700">VIII</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-gray-700">ĐIỀU CHỈNH LƯƠNG</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-500">{dieuChinhVIII ? fmt(dieuChinhVIII) : '—'}</td>
              </tr>

              {/* Section IX */}
              <tr className="bg-indigo-100">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-indigo-800">IX</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-indigo-800">LƯƠNG THỰC LĨNH (VI − VII + VIII)</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-bold text-indigo-800">{fmt(luongThucLinh)}</td>
              </tr>

              {/* Section X */}
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">X</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">TẠM ỨNG LƯƠNG</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-red-600">{tamUng ? fmt(tamUng) : '—'}</td>
              </tr>

              {/* Section XI */}
              <tr>
                <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">XI</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-700">
                  THUẾ TNCN{' '}
                  <span className="text-xs text-gray-500">
                    {taxDetail.taxMode === 'flat_10' ? '(10% trên thu nhập tháng)' : `(NPT: ${nptCount} người)`}
                  </span>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right text-gray-500 flex items-center justify-end gap-2">
                  {thue ? fmt(thue) : '—'}
                  <TaxTooltip taxDetail={taxDetail} />
                </td>
              </tr>
              {/* Section XII */}
              <tr className="bg-green-100">
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-green-800">XII</td>
                <td className="border border-gray-300 px-3 py-2 font-bold text-green-800">CÒN PHẢI THANH TOÁN (IX − X − XI)</td>
                <td className="border border-gray-300 px-3 py-2 text-right font-bold text-lg text-green-800">{fmt(conPhaiTT)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Email confirmation overlay ── */}
        {emailModalOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-xl p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[calc(90vh-2rem)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-blue-50 rounded-t-xl">
                <div className="flex items-center gap-2 text-blue-800 font-semibold text-sm">
                  <EnvelopeIcon className="h-5 w-5" />
                  Gửi phiếu lương qua email
                </div>
                <button onClick={() => setEmailModalOpen(false)} className="p-1 rounded text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="px-5 py-4 flex-1 overflow-y-auto min-h-0 flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Địa chỉ email người nhận</label>
                  <input
                    type="email"
                    value={emailAddr}
                    onChange={(e) => setEmailAddr(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="example@email.com"
                  />
                  {!employee?.personal_email && (
                    <p className="text-xs text-amber-600 mt-1">Nhân viên này chưa có email cá nhân trong hồ sơ.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tiêu đề</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nội dung email (text)</label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={10}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nội dung preview (HTML)</label>
                  <div className="w-full border border-gray-200 rounded-lg overflow-hidden bg-white">
                    <iframe
                      title="Xem trước email phiếu lương"
                      srcDoc={emailPreviewHtml}
                      className="w-full h-64"
                      sandbox=""
                    />
                  </div>
                </div>
                {emailResult && (
                  <p className={`text-sm font-medium ${emailResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {emailResult.msg}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <button
                  onClick={() => setEmailModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={handleConfirmSendEmail}
                  disabled={emailSending || !emailAddr.trim() || !emailSubject.trim() || !emailBody.trim() || !!emailResult?.ok}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {emailSending ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <EnvelopeIcon className="h-4 w-4" />}
                  {emailSending ? 'Đang gửi…' : 'Xác nhận gửi'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface SalaryManagementProps {
  defaultTab?: SalaryTabKey;
  lockTab?: boolean;
}

interface ParsedSalaryConfigRow {
  employee_code: string;
  effective_date: string;
  basic_salary?: number;
  salary_factor?: number;
  lunch_mode?: string;
  lunch_amount?: number;
  parking_mode?: string;
  parking_rate?: number;
  responsibility_mode?: string;
  responsibility_amount?: number;
  region?: string;
  insurance_mode?: string;
  insurance_override?: number;
  dependent_count?: number;
  union_fee?: number;
  rowIndex: number;
  parseError?: string;
}

interface SalaryConfigurationValues {
  effectiveDate: string;
  baseProfile: {
    jobTitle: string;
    level: string;
    department: string;
    contractType: string;
    workLocation: string;
  };
  baseSalary: {
    payType: 'monthly' | 'hourly' | 'daily';
    amount: number;
    factor: number;
    regionalMinimum: number;
  };
  allowances: {
    lunch: number;
    transport: number;
    phone: number;
    housing: number;
    responsibility: number;
    hazardous: number;
  };
  lunchAllowancePolicy: LunchAllowancePolicy;
  parkingAllowancePolicy: ParkingAllowancePolicy;
  responsibilityAllowancePolicy: ResponsibilityAllowancePolicy;
  variablePay: {
    salesCommission: number;
    kpiBonus: number;
    quarterlyBonus: number;
    projectBonus: number;
    innovationBonus: number;
  };
  timeAttendance: {
    workingDays: number;
    workingHours: number;
    overtimeHours: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    lateEarlyCount: number;
  };
  taxPolicy: {
    region: 'I' | 'II' | 'III' | 'IV';
    dependentCount: number;
    insuranceSalaryMode: 'official' | 'custom';
    insuranceSalaryOverride: number;
  };
  deductions: {
    pit: number;
    socialInsurance: number;
    healthInsurance: number;
    unemploymentInsurance: number;
    unionFee: number;
    advancePenaltyCompensation: number;
  };
  employerContributions: {
    socialInsurance: number;
    healthInsurance: number;
    unemploymentInsurance: number;
    supplementalInsurance: number;
  };
  adjustments: {
    retroactiveCollect: number;
    retroactivePay: number;
    priorPeriodCorrection: number;
    irregularRewardPenalty: number;
  };
}

interface SalaryConfigEvent {
  type: string;
  effective_date: string;
  changed_at: string;
  payload: SalaryConfigurationValues;
}

interface PayrollOutput {
  grossIncome: number;
  pit: number;
  socialInsurance: number;
  healthInsurance: number;
  unemploymentInsurance: number;
  attendancePenalty: number;
  taxableIncome: number;
  insuranceSalaryBase: number;
  personalDeduction: number;
  dependentDeduction: number;
  regionalMinimum: number;
  baseSalaryReference: number;
  totalDeductions: number;
  netSalary: number;
}

interface LunchAllowancePolicy {
  mode: 'fixed' | 'actual_working_day';
  fixed_amount: number;
  amount_per_work_day: number;
  monthly_cap: number;
}

interface ParkingAllowancePolicy {
  mode: 'none' | 'daily' | 'monthly';
  daily_rate: number;
  monthly_rate: number;
}

interface ResponsibilityAllowancePolicy {
  mode: 'none' | 'fixed' | 'actual_working_day';
  monthly_max: number;
}

const MAX_LUNCH_ALLOWANCE_CAP = 500000;
const BASE_SALARY_EFFECTIVE_2024_07_01 = 2340000;
const BASE_SALARY_BEFORE_2024_07_01 = 1800000;
const PERSONAL_DEDUCTION_2026 = 15500000;
const PERSONAL_DEDUCTION_LEGACY = 11000000;
const DEPENDENT_DEDUCTION_2026 = 6200000;
const DEPENDENT_DEDUCTION_LEGACY = 4400000;

const REGIONAL_MINIMUM_2026: Record<'I' | 'II' | 'III' | 'IV', number> = {
  I: 5310000,
  II: 4730000,
  III: 4140000,
  IV: 3700000,
};

const REGIONAL_MINIMUM_2024: Record<'I' | 'II' | 'III' | 'IV', number> = {
  I: 4960000,
  II: 4410000,
  III: 3860000,
  IV: 3450000,
};

const EMPLOYEE_SOCIAL_INSURANCE_RATE = 0.08;
const EMPLOYEE_HEALTH_INSURANCE_RATE = 0.015;
const EMPLOYEE_UNEMPLOYMENT_INSURANCE_RATE = 0.01;

const PIT_BRACKETS_2026 = [
  { limit: 10000000, rate: 0.05 },
  { limit: 30000000, rate: 0.1 },
  { limit: 60000000, rate: 0.2 },
  { limit: 100000000, rate: 0.3 },
  { limit: Number.POSITIVE_INFINITY, rate: 0.35 },
];

const PIT_BRACKETS_LEGACY = [
  { limit: 5000000, rate: 0.05 },
  { limit: 10000000, rate: 0.1 },
  { limit: 18000000, rate: 0.15 },
  { limit: 32000000, rate: 0.2 },
  { limit: 52000000, rate: 0.25 },
  { limit: 80000000, rate: 0.3 },
  { limit: Number.POSITIVE_INFINITY, rate: 0.35 },
];

const DEFAULT_SALARY_CONFIG: SalaryConfigurationValues = {
  effectiveDate: new Date().toISOString().slice(0, 10),
  baseProfile: {
    jobTitle: '',
    level: '',
    department: '',
    contractType: 'FULL_TIME',
    workLocation: '',
  },
  baseSalary: {
    payType: 'monthly',
    amount: 0,
    factor: 1,
    regionalMinimum: 0,
  },
  allowances: {
    lunch: 0,
    transport: 0,
    phone: 0,
    housing: 0,
    responsibility: 0,
    hazardous: 0,
  },
  lunchAllowancePolicy: {
    mode: 'fixed',
    fixed_amount: 0,
    amount_per_work_day: 0,
    monthly_cap: MAX_LUNCH_ALLOWANCE_CAP,
  },
  parkingAllowancePolicy: {
    mode: 'none',
    daily_rate: 5000,
    monthly_rate: 0,
  },
  responsibilityAllowancePolicy: {
    mode: 'none',
    monthly_max: 0,
  },
  variablePay: {
    salesCommission: 0,
    kpiBonus: 0,
    quarterlyBonus: 0,
    projectBonus: 0,
    innovationBonus: 0,
  },
  timeAttendance: {
    workingDays: 26,
    workingHours: 208,
    overtimeHours: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    lateEarlyCount: 0,
  },
  taxPolicy: {
    region: 'I',
    dependentCount: 0,
    insuranceSalaryMode: 'official',
    insuranceSalaryOverride: 0,
  },
  deductions: {
    pit: 0,
    socialInsurance: 0,
    healthInsurance: 0,
    unemploymentInsurance: 0,
    unionFee: 0,
    advancePenaltyCompensation: 0,
  },
  employerContributions: {
    socialInsurance: 0,
    healthInsurance: 0,
    unemploymentInsurance: 0,
    supplementalInsurance: 0,
  },
  adjustments: {
    retroactiveCollect: 0,
    retroactivePay: 0,
    priorPeriodCorrection: 0,
    irregularRewardPenalty: 0,
  },
};

const toNumber = (value: unknown, fallback: unknown = 0): number => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const parsedFallback = Number(fallback);
  return Number.isFinite(parsedFallback) ? parsedFallback : 0;
};

const parseDate = (dateText: string) => {
  const date = new Date(dateText);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const getTaxYear = (effectiveDate: string) => parseDate(effectiveDate).getFullYear();

const getBaseSalaryByEffectiveDate = (effectiveDate: string) => {
  const effective = parseDate(effectiveDate);
  const policyDate = new Date('2024-07-01');
  return effective >= policyDate ? BASE_SALARY_EFFECTIVE_2024_07_01 : BASE_SALARY_BEFORE_2024_07_01;
};

const getRegionalMinimumByEffectiveDate = (effectiveDate: string, region: 'I' | 'II' | 'III' | 'IV') => {
  const effective = parseDate(effectiveDate);
  const policyDate = new Date('2026-01-01');
  if (effective >= policyDate) {
    return REGIONAL_MINIMUM_2026[region];
  }
  return REGIONAL_MINIMUM_2024[region];
};

const inferRegionByMinimum = (regionalMinimum: number): 'I' | 'II' | 'III' | 'IV' => {
  const regions: Array<'I' | 'II' | 'III' | 'IV'> = ['I', 'II', 'III', 'IV'];
  if (regions.some((region) => REGIONAL_MINIMUM_2026[region] === regionalMinimum)) {
    return regions.find((region) => REGIONAL_MINIMUM_2026[region] === regionalMinimum) || 'I';
  }
  if (regions.some((region) => REGIONAL_MINIMUM_2024[region] === regionalMinimum)) {
    return regions.find((region) => REGIONAL_MINIMUM_2024[region] === regionalMinimum) || 'I';
  }
  return 'I';
};

const calculateProgressiveTax = (taxableIncome: number, brackets: Array<{ limit: number; rate: number }>) => {
  let remaining = Math.max(taxableIncome, 0);
  let previousLimit = 0;
  let totalTax = 0;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const bracketRange = bracket.limit - previousLimit;
    const taxableAtThisBracket = Math.min(remaining, bracketRange);
    totalTax += taxableAtThisBracket * bracket.rate;
    remaining -= taxableAtThisBracket;
    previousLimit = bracket.limit;
  }

  return Math.max(totalTax, 0);
};

interface TaxBracketBreakdown {
  bracketNumber: number;
  fromAmount: number;
  toAmount: number;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

interface TaxCalculationDetail {
  taxMode: 'progressive' | 'flat_10';
  grossIncome: number;
  insuranceDeduction: number;
  personalDeduction: number;
  dependentDeduction: number;
  taxableIncome: number;
  totalTax: number;
  breakdown: TaxBracketBreakdown[];
}

interface PayrollTaxComputation {
  taxDetail: TaxCalculationDetail;
  taxAmount: number;
  dependentCount: number;
  insuranceSalaryBase: number;
  socialInsurance: number;
  healthInsurance: number;
  unemploymentInsurance: number;
  insuranceTotal: number;
}

const calculateTaxBreakdown = (
  grossIncome: number,
  insuranceDeduction: number,
  personalDeduction: number,
  dependentDeduction: number,
  brackets: Array<{ limit: number; rate: number }>,
  dependentCount: number = 0
): TaxCalculationDetail => {
  const taxableIncome = Math.max(
    grossIncome - insuranceDeduction - personalDeduction - dependentDeduction,
    0
  );

  let remaining = taxableIncome;
  let previousLimit = 0;
  let totalTax = 0;
  const breakdown: TaxBracketBreakdown[] = [];

  brackets.forEach((bracket, index) => {
    if (remaining <= 0) return;
    const bracketRange = bracket.limit - previousLimit;
    const taxableAtThisBracket = Math.min(remaining, bracketRange);
    const taxAmount = taxableAtThisBracket * bracket.rate;
    
    breakdown.push({
      bracketNumber: index + 1,
      fromAmount: previousLimit,
      toAmount: bracket.limit,
      rate: bracket.rate * 100,
      taxableAmount: taxableAtThisBracket,
      taxAmount: Math.round(taxAmount),
    });

    totalTax += taxAmount;
    remaining -= taxableAtThisBracket;
    previousLimit = bracket.limit;
  });

  return {
    taxMode: 'progressive',
    grossIncome,
    insuranceDeduction: Math.round(insuranceDeduction),
    personalDeduction: Math.round(personalDeduction),
    dependentDeduction: Math.round(dependentDeduction),
    taxableIncome: Math.round(taxableIncome),
    totalTax: Math.round(totalTax),
    breakdown,
  };
};

const calculateBreakdownFromTaxableIncome = (
  taxableIncome: number,
  brackets: Array<{ limit: number; rate: number }>,
): { breakdown: TaxBracketBreakdown[]; totalTax: number } => {
  let remaining = Math.max(taxableIncome, 0);
  let previousLimit = 0;
  let totalTax = 0;
  const breakdown: TaxBracketBreakdown[] = [];

  brackets.forEach((bracket, index) => {
    if (remaining <= 0) return;
    const bracketRange = bracket.limit - previousLimit;
    const taxableAtThisBracket = Math.min(remaining, bracketRange);
    const taxAmount = taxableAtThisBracket * bracket.rate;

    breakdown.push({
      bracketNumber: index + 1,
      fromAmount: previousLimit,
      toAmount: bracket.limit,
      rate: bracket.rate * 100,
      taxableAmount: taxableAtThisBracket,
      taxAmount: Math.round(taxAmount),
    });

    totalTax += taxAmount;
    remaining -= taxableAtThisBracket;
    previousLimit = bracket.limit;
  });

  return {
    breakdown,
    totalTax: Math.round(totalTax),
  };
};

const getProbationRatePercent = (record: SalaryRecord, employee?: Employee) => {
  const fromRecord = toNumber((record as unknown as Record<string, number>)['probation_rate_percent'], 0);
  if (fromRecord > 0) return fromRecord;

  const rateCode = String(employee?.probation_rate ?? '').toUpperCase();
  if (rateCode === 'OPTION_3') return 100;
  if (rateCode === 'OPTION_1' || rateCode === 'OPTION_2') return 85;
  return 85;
};

interface WorkdaySalaryBreakdown {
  congThuViec: number;
  congChinhThuc: number;
  probationRatePercent: number;
  luongCongThuViec: number;
  luongCongChinhThuc: number;
  tongLuongNgayCong: number;
  hasProbationDays: boolean;
}

const getWorkdaySalaryBreakdown = (record: SalaryRecord, employee?: Employee): WorkdaySalaryBreakdown => {
  const stdDays = getStandardWorkDaysFromRecord(record);
  const luongCoBan = record.luong_co_ban ?? 0;
  const daySalary = stdDays > 0 ? (luongCoBan / stdDays) : 0;

  const tongCong = toNumber(record.tong_cong, 0);
  const congThuViec = Math.max(toNumber((record as unknown as Record<string, number>)['cong_thu_viec'], 0), 0);
  const congChinhThucRaw = Math.max(toNumber(record.cong_chinh_thuc, 0), 0);
  const hasSplitDays = congThuViec > 0 || congChinhThucRaw > 0;
  const congChinhThuc = hasSplitDays ? congChinhThucRaw : Math.max(tongCong, 0);
  const probationRatePercent = getProbationRatePercent(record, employee);

  const luongCongThuViecFallback = Math.round(daySalary * congThuViec * (probationRatePercent / 100));
  const luongCongChinhThucFallback = Math.round(daySalary * congChinhThuc);
  const tongLuongFallback = Math.round(daySalary * Math.max(tongCong, 0));

  const luongCongThuViec = Math.round(toNumber(
    (record as unknown as Record<string, number>)['luong_ngay_cong_thu_viec'],
    luongCongThuViecFallback,
  ));
  const luongCongChinhThuc = Math.round(toNumber(
    (record as unknown as Record<string, number>)['luong_ngay_cong_chinh_thuc'],
    luongCongChinhThucFallback,
  ));
  const tongLuongNgayCong = Math.round(toNumber(
    (record as unknown as Record<string, number>)['luong_ngay_cong'],
    congThuViec > 0 ? (luongCongThuViec + luongCongChinhThuc) : tongLuongFallback,
  ));

  return {
    congThuViec,
    congChinhThuc,
    probationRatePercent,
    luongCongThuViec,
    luongCongChinhThuc,
    tongLuongNgayCong,
    hasProbationDays: congThuViec > 0,
  };
};

const getGrossIncomeForTaxFromRecord = (record: SalaryRecord, employee?: Employee, commissions?: CommissionRecord[]) => {
  const workdayBreakdown = getWorkdaySalaryBreakdown(record, employee);
  const luongNgayCongThucTe = workdayBreakdown.tongLuongNgayCong;
  const incomeBreakdown = getMonthlyInputIncomeBreakdown(record, commissions);
  const luongDoanhSo = incomeBreakdown.luongDoanhSo;
  const luongOt = incomeBreakdown.luongOt;
  const banSanPham = incomeBreakdown.banSanPham;
  const phuMo = incomeBreakdown.phuMo;
  const trucCa = incomeBreakdown.trucCa;
  const thuNhapKhac = incomeBreakdown.thuNhapKhac;
  const thuong = incomeBreakdown.thuong;
  const phuCapAnTrua = toNumber((record as unknown as Record<string, number>)['phu_cap_an_trua'], 0);
  const taxableAllowance = Math.max((record.phu_cap ?? 0) - phuCapAnTrua, 0);
  return luongNgayCongThucTe + taxableAllowance + luongDoanhSo + luongOt + banSanPham + phuMo + trucCa + thuNhapKhac + thuong;
};

const calculatePayrollTaxFromRecord = (record: SalaryRecord, employee?: Employee, commissions?: CommissionRecord[]): PayrollTaxComputation => {
  const savedAdjustments = employee ? (employee.salary_adjustments as Record<string, unknown> | undefined) : undefined;
  const savedOutput = savedAdjustments?.payroll_output_preview as Record<string, number> | undefined;
  const savedConfig = savedAdjustments?.payroll_config as Record<string, unknown> | undefined;
  const savedTaxPolicy = savedConfig?.taxPolicy as Record<string, unknown> | undefined;
  const mucLuongDongBHFromEmployee = Math.max(toNumber(employee?.social_insurance_contribution_level), 0);

  const mucLuongDongBH = (record as unknown as Record<string, number>)['muc_luong_dong_bh']
    ?? savedOutput?.insuranceSalaryBase
    ?? (mucLuongDongBHFromEmployee || (record.luong_co_ban ?? 0));

  const socialInsurance = Math.round(savedOutput?.socialInsurance ?? mucLuongDongBH * EMPLOYEE_SOCIAL_INSURANCE_RATE);
  const healthInsurance = Math.round(savedOutput?.healthInsurance ?? mucLuongDongBH * EMPLOYEE_HEALTH_INSURANCE_RATE);
  const unemploymentInsurance = Math.round(savedOutput?.unemploymentInsurance ?? mucLuongDongBH * EMPLOYEE_UNEMPLOYMENT_INSURANCE_RATE);
  const insuranceTotal = socialInsurance + healthInsurance + unemploymentInsurance;

  const taxYear = new Date(`${record.year}-${String(record.month).padStart(2, '0')}-01`).getFullYear();
  const brackets = taxYear >= 2026 ? PIT_BRACKETS_2026 : PIT_BRACKETS_LEGACY;
  const personalDeduction = toNumber(
    record.giam_tru_ban_than,
    taxYear >= 2026 ? PERSONAL_DEDUCTION_2026 : PERSONAL_DEDUCTION_LEGACY,
  );
  const dependentCount = Math.max(
    toNumber(record.so_nguoi_phu_thuoc, toNumber(savedTaxPolicy?.dependentCount, 0)),
    0,
  );
  const dependentDeduction = toNumber(
    record.giam_tru_nguoi_phu_thuoc,
    dependentCount * (taxYear >= 2026 ? DEPENDENT_DEDUCTION_2026 : DEPENDENT_DEDUCTION_LEGACY),
  );
  const insuranceForTax = toNumber(record.bao_hiem_bat_buoc, insuranceTotal);
  const grossIncomeForTax = toNumber(record.tong_thu_nhap_chiu_thue, getGrossIncomeForTaxFromRecord(record, employee, commissions));
  const taxMethod = String((record as unknown as Record<string, unknown>)['tax_method'] ?? '').toUpperCase();

  if (taxMethod === 'FLAT_10_PROBATION' || taxMethod === 'FLAT_10_NON_OFFICIAL') {
    const flatTaxAmount = record.thue_tncn != null
      ? Math.max(toNumber(record.thue_tncn), 0)
      : Math.round(Math.max(grossIncomeForTax, 0) * 0.1);
    const flatTaxDetail: TaxCalculationDetail = {
      taxMode: 'flat_10',
      grossIncome: Math.round(grossIncomeForTax),
      insuranceDeduction: Math.round(insuranceForTax),
      personalDeduction: 0,
      dependentDeduction: 0,
      taxableIncome: Math.round(Math.max(grossIncomeForTax, 0)),
      totalTax: Math.round(flatTaxAmount),
      breakdown: [],
    };
    return {
      taxDetail: flatTaxDetail,
      taxAmount: flatTaxDetail.totalTax,
      dependentCount,
      insuranceSalaryBase: Math.round(mucLuongDongBH),
      socialInsurance,
      healthInsurance,
      unemploymentInsurance,
      insuranceTotal,
    };
  }

  const taxDetail = calculateTaxBreakdown(
    grossIncomeForTax,
    insuranceForTax,
    personalDeduction,
    dependentDeduction,
    brackets,
    dependentCount,
  );
  const backendTaxAmount = record.thue_tncn != null ? Math.max(toNumber(record.thue_tncn), 0) : null;
  const backendTaxableIncome = record.thu_nhap_tinh_thue != null ? Math.max(toNumber(record.thu_nhap_tinh_thue), 0) : null;
  const backendBreakdown = backendTaxableIncome != null
    ? calculateBreakdownFromTaxableIncome(backendTaxableIncome, brackets)
    : null;
  const effectiveTaxDetail: TaxCalculationDetail = backendTaxAmount != null
    ? {
        ...taxDetail,
        taxMode: 'progressive',
        taxableIncome: backendTaxableIncome ?? taxDetail.taxableIncome,
        totalTax: backendTaxAmount,
        breakdown: backendBreakdown?.breakdown ?? taxDetail.breakdown,
      }
    : taxDetail;

  return {
    taxDetail: effectiveTaxDetail,
    taxAmount: effectiveTaxDetail.totalTax,
    dependentCount,
    insuranceSalaryBase: Math.round(mucLuongDongBH),
    socialInsurance,
    healthInsurance,
    unemploymentInsurance,
    insuranceTotal,
  };
};

const calculatePayslipNetPayable = (record: SalaryRecord, employee?: Employee, commissions?: CommissionRecord[]) => {
  const stdDays = getStandardWorkDaysFromRecord(record);
  const workdayBreakdown = getWorkdaySalaryBreakdown(record, employee);
  const luongNgayCongThucTe = workdayBreakdown.tongLuongNgayCong;
  const incomeBreakdown = getMonthlyInputIncomeBreakdown(record, commissions);
  const luongDoanhSo = incomeBreakdown.luongDoanhSo;
  const luongOt = incomeBreakdown.luongOt;
  const banSanPham = incomeBreakdown.banSanPham;
  const phuMo = incomeBreakdown.phuMo;
  const trucCa = incomeBreakdown.trucCa;
  const thuNhapKhac = incomeBreakdown.thuNhapKhac;
  const thuong = incomeBreakdown.thuong;
  const tongLuongIII = luongNgayCongThucTe + luongDoanhSo + luongOt + banSanPham + phuMo + trucCa + thuNhapKhac;

  const payrollTax = calculatePayrollTaxFromRecord(record, employee, commissions);
  const savedAdjustments = employee ? (employee.salary_adjustments as Record<string, unknown> | undefined) : undefined;
  const savedConfig = savedAdjustments?.payroll_config as Record<string, unknown> | undefined;

  const savedParkingPolicyRaw = savedConfig?.parkingAllowancePolicy as Record<string, unknown> | undefined;
  const parkingPolicy: ParkingAllowancePolicy | null = savedParkingPolicyRaw
    ? {
        mode: savedParkingPolicyRaw.mode === 'daily' ? 'daily' : savedParkingPolicyRaw.mode === 'monthly' ? 'monthly' : 'none',
        daily_rate: toNumber(savedParkingPolicyRaw.daily_rate, 5000),
        monthly_rate: toNumber(savedParkingPolicyRaw.monthly_rate, 0),
      }
    : null;
  const phuCapGuiXe = parkingPolicy ? calculateParkingAllowance(parkingPolicy, record.ngay_cong) : (record.phu_cap_gui_xe ?? 0);

  const savedLunchPolicyRaw = (savedConfig?.lunchAllowancePolicy as Record<string, unknown> | undefined);
  const lunchPolicy: LunchAllowancePolicy | null = savedLunchPolicyRaw
    ? {
        mode: savedLunchPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'fixed',
        fixed_amount: toNumber(savedLunchPolicyRaw.fixed_amount),
        amount_per_work_day: toNumber(savedLunchPolicyRaw.amount_per_work_day),
        monthly_cap: toNumber(savedLunchPolicyRaw.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP),
      }
    : null;
  const phuCapAnTrua = toNumber(
    (record as unknown as Record<string, unknown>)['phu_cap_an_trua'],
    lunchPolicy ? calculateLunchAllowance(lunchPolicy, record.tong_cong ?? 0, stdDays) : 0,
  );

  const savedRespPolicyRaw = savedConfig?.responsibilityAllowancePolicy as Record<string, unknown> | undefined;
  const respPolicy: ResponsibilityAllowancePolicy | null = savedRespPolicyRaw
    ? {
        mode: savedRespPolicyRaw.mode === 'fixed' ? 'fixed' : savedRespPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'none',
        monthly_max: toNumber(savedRespPolicyRaw.monthly_max),
      }
    : null;
  const phuCapTrachNhiem = respPolicy ? calculateResponsibilityAllowance(respPolicy, record.tong_cong ?? 0, stdDays) : 0;
  const phuCapLivestream = toNumber((record as unknown as Record<string, number>)['phu_cap_livestream'], 0);

  const phuCapKhacFromRecord = (record as unknown as Record<string, number>)['phu_cap_khac'] ?? 0;
  const phuCapKhacRemainder = Math.max(
    phuCapKhacFromRecord,
    Math.max((record.phu_cap ?? 0) - phuCapGuiXe - phuCapAnTrua - phuCapTrachNhiem - phuCapLivestream, 0),
  );
  const tongPhuCapIV = phuCapGuiXe + phuCapAnTrua + phuCapTrachNhiem + phuCapLivestream + phuCapKhacRemainder;
  const tongThuNhapVI = tongLuongIII + tongPhuCapIV + thuong;

  const congDoan = toNumber((record as unknown as Record<string, number>)['cong_doan'],
    (savedConfig?.deductions as Record<string, number> | undefined)?.unionFee ?? 0);

  const tongGiamTruVII = payrollTax.insuranceTotal + congDoan + (record.tong_phat ?? 0) + (record.tong_phat_bienban ?? 0);
  const dieuChinhVIII = (record as unknown as Record<string, number>)['dieu_chinh'] ?? 0;
  const tamUng = record.tam_ung ?? 0;
  const luongThucLinh = tongThuNhapVI - tongGiamTruVII + dieuChinhVIII;
  const conPhaiThanhToan = luongThucLinh - tamUng - payrollTax.taxAmount;

  return {
    luongThucLinh,
    conPhaiThanhToan,
    payrollTax,
  };
};

const asRecord = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
};

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  return Math.round(value).toLocaleString('vi-VN') + 'đ';
};

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('vi-VN');
};

const calculateLunchAllowance = (policy: LunchAllowancePolicy, actualWorkDays: number, standardWorkDays: number) => {
  const cap = Math.min(Math.max(toNumber(policy.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP), 0), MAX_LUNCH_ALLOWANCE_CAP);
  if (policy.mode === 'actual_working_day') {
    const ratePerDay = standardWorkDays > 0 ? cap / standardWorkDays : 0;
    return Math.min(Math.max(actualWorkDays, 0) * ratePerDay, cap);
  }
  return Math.min(Math.max(toNumber(policy.fixed_amount), 0), cap);
};

const calculateResponsibilityAllowance = (policy: ResponsibilityAllowancePolicy, actualWorkDays: number, standardWorkDays: number): number => {
  const max = Math.max(policy.monthly_max, 0);
  if (policy.mode === 'fixed') return max;
  if (policy.mode === 'actual_working_day') {
    const rate = standardWorkDays > 0 ? max / standardWorkDays : 0;
    return Math.min(Math.max(actualWorkDays, 0) * rate, max);
  }
  return 0;
};

const calculateParkingAllowance = (policy: ParkingAllowancePolicy, actualWorkDays: number): number => {
  if (policy.mode === 'daily') return Math.ceil(Math.max(actualWorkDays, 0)) * Math.max(policy.daily_rate, 0);
  if (policy.mode === 'monthly') return Math.max(policy.monthly_rate, 0);
  return 0;
};

const calculateActualWorkDays = (timeAttendance: SalaryConfigurationValues['timeAttendance']) => {
  return Math.max(timeAttendance.workingDays - timeAttendance.unpaidLeaveDays, 0);
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  PROBATION: 'Hợp đồng thử việc',
  INTERN: 'Hợp đồng thực tập sinh',
  COLLABORATOR: 'Hợp đồng cộng tác viên',
  ONE_YEAR: 'Hợp đồng lao động 12 tháng',
  TWO_YEAR: 'Hợp đồng lao động 24 tháng',
  INDEFINITE: 'Hợp đồng vô thời hạn',
  SERVICE: 'Hợp đồng dịch vụ',
  CONFIDENTIALITY: 'Thoả thuận bảo mật',
  COMPANY_RULES: 'Cam kết đọc hiểu nội quy công ty',
  NURSING_COMMITMENT: 'Cam kết của CBNV Điều dưỡng',
};

const WORK_LOCATION_LABELS: Record<string, string> = {
  VP_HA_NOI: 'Văn phòng Hà Nội',
  VP_HCM: 'Văn phòng TP. Hồ Chí Minh',
};

const parseEmployeeSalaryConfig = (employee: Employee): SalaryConfigurationValues => {
  const adjustments = asRecord(employee.salary_adjustments);
  const savedConfig = asRecord(adjustments.payroll_config);
  const savedLunchPolicy = asRecord(savedConfig.lunchAllowancePolicy);

  const lunchPolicy: LunchAllowancePolicy = {
    mode: savedLunchPolicy.mode === 'actual_working_day' ? 'actual_working_day' : 'fixed',
    fixed_amount: toNumber(savedLunchPolicy.fixed_amount, toNumber(savedConfig.allowances?.lunch)),
    amount_per_work_day: toNumber(savedLunchPolicy.amount_per_work_day),
    monthly_cap: Math.min(
      Math.max(toNumber(savedLunchPolicy.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP), 0),
      MAX_LUNCH_ALLOWANCE_CAP
    ),
  };

  const taxPolicyConfig = asRecord(savedConfig.taxPolicy);
  const inferredRegion = inferRegionByMinimum(toNumber(savedConfig.baseSalary?.regionalMinimum));
  const insuranceContributionFromEmployee = Math.max(
    toNumber(employee.social_insurance_contribution_level),
    0,
  );

  return {
    effectiveDate:
      (savedConfig.effectiveDate as string | undefined) ||
      employee.official_start_date ||
      employee.start_date ||
      DEFAULT_SALARY_CONFIG.effectiveDate,
    baseProfile: {
      jobTitle:
        (savedConfig.baseProfile?.jobTitle as string | undefined) ||
        employee.position?.title ||
        '',
      level:
        (savedConfig.baseProfile?.level as string | undefined) ||
        employee.rank ||
        '',
      department:
        (savedConfig.baseProfile?.department as string | undefined) ||
        employee.department?.name ||
        '',
      contractType:
        (savedConfig.baseProfile?.contractType as string | undefined) ||
        employee.contract_type_display ||
        (employee.contract_type ? CONTRACT_TYPE_LABELS[employee.contract_type] : undefined) ||
        employee.contract_type ||
        DEFAULT_SALARY_CONFIG.baseProfile.contractType,
      workLocation:
        (savedConfig.baseProfile?.workLocation as string | undefined) ||
        (employee.work_location ? WORK_LOCATION_LABELS[employee.work_location] ?? employee.work_location : '') ||
        '',
    },
    baseSalary: {
      payType:
        (savedConfig.baseSalary?.payType as 'monthly' | 'hourly' | 'daily' | undefined) ||
        DEFAULT_SALARY_CONFIG.baseSalary.payType,
      amount:
        toNumber(savedConfig.baseSalary?.amount, employee.basic_salary ?? DEFAULT_SALARY_CONFIG.baseSalary.amount),
      factor: toNumber(savedConfig.baseSalary?.factor, DEFAULT_SALARY_CONFIG.baseSalary.factor),
      regionalMinimum: toNumber(
        savedConfig.baseSalary?.regionalMinimum,
        getRegionalMinimumByEffectiveDate(
          (savedConfig.effectiveDate as string | undefined) ||
            employee.official_start_date ||
            employee.start_date ||
            DEFAULT_SALARY_CONFIG.effectiveDate,
          inferredRegion
        )
      ),
    },
    allowances: {
      lunch: toNumber(savedConfig.allowances?.lunch),
      transport: toNumber(savedConfig.allowances?.transport),
      phone: toNumber(savedConfig.allowances?.phone),
      housing: toNumber(savedConfig.allowances?.housing),
      responsibility: toNumber(savedConfig.allowances?.responsibility, employee.allowance ?? 0),
      hazardous: toNumber(savedConfig.allowances?.hazardous),
    },
    lunchAllowancePolicy: lunchPolicy,
    parkingAllowancePolicy: (() => {
      const p = asRecord(savedConfig.parkingAllowancePolicy);
      const mode = p.mode as string | undefined;
      return {
        mode: (mode === 'daily' || mode === 'monthly' ? mode : 'none') as ParkingAllowancePolicy['mode'],
        daily_rate: toNumber(p.daily_rate, 5000),
        monthly_rate: toNumber(p.monthly_rate, 0),
      };
    })(),
    responsibilityAllowancePolicy: (() => {
      const p = asRecord(savedConfig.responsibilityAllowancePolicy);
      const mode = p.mode as string | undefined;
      return {
        mode: (mode === 'fixed' || mode === 'actual_working_day' ? mode : 'none') as ResponsibilityAllowancePolicy['mode'],
        monthly_max: toNumber(p.monthly_max, toNumber(savedConfig.allowances?.responsibility, 0)),
      };
    })(),
    variablePay: {
      salesCommission: toNumber(savedConfig.variablePay?.salesCommission),
      kpiBonus: toNumber(savedConfig.variablePay?.kpiBonus),
      quarterlyBonus: toNumber(savedConfig.variablePay?.quarterlyBonus),
      projectBonus: toNumber(savedConfig.variablePay?.projectBonus),
      innovationBonus: toNumber(savedConfig.variablePay?.innovationBonus),
    },
    timeAttendance: {
      workingDays: toNumber(savedConfig.timeAttendance?.workingDays, DEFAULT_SALARY_CONFIG.timeAttendance.workingDays),
      workingHours: toNumber(savedConfig.timeAttendance?.workingHours, DEFAULT_SALARY_CONFIG.timeAttendance.workingHours),
      overtimeHours: toNumber(savedConfig.timeAttendance?.overtimeHours),
      paidLeaveDays: toNumber(savedConfig.timeAttendance?.paidLeaveDays),
      unpaidLeaveDays: toNumber(savedConfig.timeAttendance?.unpaidLeaveDays),
      lateEarlyCount: toNumber(savedConfig.timeAttendance?.lateEarlyCount),
    },
    taxPolicy: {
      region:
        taxPolicyConfig.region === 'I' ||
        taxPolicyConfig.region === 'II' ||
        taxPolicyConfig.region === 'III' ||
        taxPolicyConfig.region === 'IV'
          ? taxPolicyConfig.region
          : inferredRegion,
      dependentCount: Math.max(toNumber(taxPolicyConfig.dependentCount), 0),
      insuranceSalaryMode:
        insuranceContributionFromEmployee > 0
          ? 'custom'
          : (taxPolicyConfig.insuranceSalaryMode === 'custom' ? 'custom' : 'official'),
      insuranceSalaryOverride:
        insuranceContributionFromEmployee > 0
          ? insuranceContributionFromEmployee
          : Math.max(toNumber(taxPolicyConfig.insuranceSalaryOverride), 0),
    },
    deductions: {
      pit: toNumber(savedConfig.deductions?.pit),
      socialInsurance: toNumber(savedConfig.deductions?.socialInsurance),
      healthInsurance: toNumber(savedConfig.deductions?.healthInsurance),
      unemploymentInsurance: toNumber(savedConfig.deductions?.unemploymentInsurance),
      unionFee: toNumber(savedConfig.deductions?.unionFee),
      advancePenaltyCompensation: toNumber(savedConfig.deductions?.advancePenaltyCompensation),
    },
    employerContributions: {
      socialInsurance: toNumber(savedConfig.employerContributions?.socialInsurance),
      healthInsurance: toNumber(savedConfig.employerContributions?.healthInsurance),
      unemploymentInsurance: toNumber(savedConfig.employerContributions?.unemploymentInsurance),
      supplementalInsurance: toNumber(savedConfig.employerContributions?.supplementalInsurance),
    },
    adjustments: {
      retroactiveCollect: toNumber(savedConfig.adjustments?.retroactiveCollect),
      retroactivePay: toNumber(savedConfig.adjustments?.retroactivePay),
      priorPeriodCorrection: toNumber(savedConfig.adjustments?.priorPeriodCorrection),
      irregularRewardPenalty: toNumber(savedConfig.adjustments?.irregularRewardPenalty),
    },
  };
};

const calculatePayrollOutput = (config: SalaryConfigurationValues, employee?: Employee): PayrollOutput => {
  const actualWorkDays = calculateActualWorkDays(config.timeAttendance);
  const lunchAllowance = calculateLunchAllowance(config.lunchAllowancePolicy, actualWorkDays, config.timeAttendance.workingDays);
  const parkingAllowance = calculateParkingAllowance(config.parkingAllowancePolicy, actualWorkDays);
  const responsibilityAllowance = calculateResponsibilityAllowance(config.responsibilityAllowancePolicy, actualWorkDays, config.timeAttendance.workingDays);
  const allowanceTotal =
    config.allowances.transport +
    config.allowances.phone +
    config.allowances.housing +
    config.allowances.hazardous +
    lunchAllowance +
    parkingAllowance +
    responsibilityAllowance;
  const variableTotal = Object.values(config.variablePay).reduce((sum, value) => sum + value, 0);
  const adjustmentTotal =
    config.adjustments.retroactivePay +
    config.adjustments.priorPeriodCorrection +
    config.adjustments.irregularRewardPenalty -
    config.adjustments.retroactiveCollect;

  const attendancePenalty =
    config.timeAttendance.unpaidLeaveDays * 200000 + config.timeAttendance.lateEarlyCount * 50000;

  const baseSalaryReference = getBaseSalaryByEffectiveDate(config.effectiveDate);
  const regionalMinimum = getRegionalMinimumByEffectiveDate(config.effectiveDate, config.taxPolicy.region);
  const taxYear = getTaxYear(config.effectiveDate);
  const personalDeduction = taxYear >= 2026 ? PERSONAL_DEDUCTION_2026 : PERSONAL_DEDUCTION_LEGACY;
  const dependentDeductionPerPerson = taxYear >= 2026 ? DEPENDENT_DEDUCTION_2026 : DEPENDENT_DEDUCTION_LEGACY;
  const dependentDeduction = Math.max(config.taxPolicy.dependentCount, 0) * dependentDeductionPerPerson;
  const insuranceSalaryRaw = employee?.social_insurance_contribution_level != null
    ? Math.max(toNumber(employee.social_insurance_contribution_level), 0)
    : (
      config.taxPolicy.insuranceSalaryMode === 'custom'
        ? Math.max(config.taxPolicy.insuranceSalaryOverride, 0)
        : Math.max(config.baseSalary.amount * config.baseSalary.factor, 0)
    );
  const socialInsuranceSalaryCap = 20 * baseSalaryReference;
  const unemploymentInsuranceSalaryCap = 20 * regionalMinimum;
  const insuranceSalaryForSocialAndHealth = Math.min(insuranceSalaryRaw, socialInsuranceSalaryCap);
  const insuranceSalaryForUnemployment = Math.min(insuranceSalaryRaw, unemploymentInsuranceSalaryCap);

  const socialInsurance = insuranceSalaryForSocialAndHealth * EMPLOYEE_SOCIAL_INSURANCE_RATE;
  const healthInsurance = insuranceSalaryForSocialAndHealth * EMPLOYEE_HEALTH_INSURANCE_RATE;
  const unemploymentInsurance = insuranceSalaryForUnemployment * EMPLOYEE_UNEMPLOYMENT_INSURANCE_RATE;

  const grossIncome = config.baseSalary.amount * config.baseSalary.factor + allowanceTotal + variableTotal + adjustmentTotal;
  const taxableIncome = Math.max(
    grossIncome - socialInsurance - healthInsurance - unemploymentInsurance - personalDeduction - dependentDeduction,
    0
  );
  const pit = calculateProgressiveTax(taxableIncome, taxYear >= 2026 ? PIT_BRACKETS_2026 : PIT_BRACKETS_LEGACY);

  const configuredDeductions =
    config.deductions.unionFee + config.deductions.advancePenaltyCompensation;
  const totalDeductions =
    pit + socialInsurance + healthInsurance + unemploymentInsurance + configuredDeductions + attendancePenalty;
  const netSalary = Math.max(grossIncome - totalDeductions, 0);

  return {
    grossIncome,
    pit,
    socialInsurance,
    healthInsurance,
    unemploymentInsurance,
    attendancePenalty,
    taxableIncome,
    insuranceSalaryBase: insuranceSalaryRaw,
    personalDeduction,
    dependentDeduction,
    regionalMinimum,
    baseSalaryReference,
    totalDeductions,
    netSalary,
  };
};

const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ label, value, onChange, disabled }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
        disabled
          ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
          : 'border-gray-300'
      }`}
    />
  </div>
);

const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
}> = ({ label, value, onChange }) => {
  const [focused, setFocused] = React.useState(false);
  const [rawInput, setRawInput] = React.useState('');

  const displayValue = focused
    ? rawInput
    : value === 0
    ? ''
    : value.toLocaleString('vi-VN');

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={displayValue}
        placeholder="0"
        onFocus={() => {
          setRawInput(value === 0 ? '' : String(value));
          setFocused(true);
        }}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^0-9]/g, '');
          setRawInput(raw);
          onChange(raw === '' ? 0 : Number(raw));
        }}
        onBlur={() => setFocused(false)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
};

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50/40">
    <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
    {children}
  </div>
);

interface EditModalProps {
  employee: Employee;
  onClose: () => void;
  onSave: (id: number, data: SalaryFormulaUpdateData) => Promise<void>;
  saving: boolean;
}

const EditSalaryModal: React.FC<EditModalProps> = ({ employee, onClose, onSave, saving }) => {
  useLockBodyScroll(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [config, setConfig] = useState<SalaryConfigurationValues>(() => parseEmployeeSalaryConfig(employee));

  useEffect(() => {
    setValidationError(null);
    setConfig(parseEmployeeSalaryConfig(employee));
  }, [employee]);

  const payrollOutput = useMemo(() => calculatePayrollOutput(config, employee), [config, employee]);

  const updateGroup = <T extends keyof SalaryConfigurationValues>(group: T, value: SalaryConfigurationValues[T]) => {
    setConfig((previous) => ({ ...previous, [group]: value }));
  };

  const lunchPreview = useMemo(
    () => calculateLunchAllowance(
      config.lunchAllowancePolicy,
      calculateActualWorkDays(config.timeAttendance),
      config.timeAttendance.workingDays,
    ),
    [config.lunchAllowancePolicy, config.timeAttendance]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError(null);

    if (config.lunchAllowancePolicy.monthly_cap > MAX_LUNCH_ALLOWANCE_CAP) {
      setValidationError('Trần phụ cấp ăn trưa không được vượt quá 500.000đ/tháng.');
      return;
    }

    const fixedAllowanceWithoutLunch =
      config.allowances.transport +
      config.allowances.phone +
      config.allowances.housing +
      config.allowances.hazardous;

    const persistedAllowance =
      config.lunchAllowancePolicy.mode === 'actual_working_day'
        ? fixedAllowanceWithoutLunch
        : fixedAllowanceWithoutLunch + lunchPreview;

    const existingAdjustments = asRecord(employee.salary_adjustments);
    const salaryEvents = Array.isArray(existingAdjustments.salary_events)
      ? (existingAdjustments.salary_events as SalaryConfigEvent[])
      : [];

    const nextEvent: SalaryConfigEvent = {
      type: 'salary_config_updated',
      effective_date: config.effectiveDate,
      changed_at: new Date().toISOString(),
      payload: {
        ...config,
        allowances: {
          ...config.allowances,
          lunch: config.lunchAllowancePolicy.mode === 'fixed' ? lunchPreview : 0,
        },
      },
    };

    const normalizedConfig: SalaryConfigurationValues = {
      ...config,
      baseSalary: {
        ...config.baseSalary,
        regionalMinimum: payrollOutput.regionalMinimum,
      },
      allowances: {
        ...config.allowances,
        lunch: config.lunchAllowancePolicy.mode === 'fixed' ? lunchPreview : 0,
      },
      deductions: {
        ...config.deductions,
        pit: payrollOutput.pit,
        socialInsurance: payrollOutput.socialInsurance,
        healthInsurance: payrollOutput.healthInsurance,
        unemploymentInsurance: payrollOutput.unemploymentInsurance,
      },
      lunchAllowancePolicy: {
        ...config.lunchAllowancePolicy,
        monthly_cap: Math.min(config.lunchAllowancePolicy.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP),
      },
    };

    const data: SalaryFormulaUpdateData = {
      basic_salary: config.baseSalary.amount,
      allowance: persistedAllowance,
      salary_notes: `Hiệu lực từ ${config.effectiveDate}`,
      allowance_notes:
        config.lunchAllowancePolicy.mode === 'actual_working_day'
          ? `Phụ cấp trưa: theo ngày công thực tế, tối đa ${Math.min(config.lunchAllowancePolicy.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP).toLocaleString('vi-VN')}đ/tháng (${config.timeAttendance.workingDays} công chuẩn)`
          : `Phụ cấp trưa cố định: ${lunchPreview.toLocaleString('vi-VN')}đ/tháng`,
      salary_adjustments: {
        ...existingAdjustments,
        payroll_config: normalizedConfig,
        payroll_output_preview: payrollOutput,
        salary_events: [...salaryEvents, nextEvent],
      },
    };

    await onSave(employee.id, data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Cấu hình tính lương theo nhân viên</h2>
            <p className="text-sm text-gray-500">{employee.full_name} · {employee.employee_id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 overflow-y-auto max-h-[calc(90vh-72px)] space-y-4">
          {validationError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {validationError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày hiệu lực</label>
              <input
                type="date"
                value={config.effectiveDate}
                onChange={(event) => setConfig((prev) => ({ ...prev, effectiveDate: event.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <SelectBox
              label="Loại trả lương"
              value={config.baseSalary.payType}
              options={[
                { value: 'monthly', label: 'Theo tháng' },
                { value: 'hourly', label: 'Theo giờ' },
                { value: 'daily', label: 'Theo ngày' },
              ]}
              onChange={(value) =>
                updateGroup('baseSalary', {
                  ...config.baseSalary,
                  payType: value as SalaryConfigurationValues['baseSalary']['payType'],
                })
              }
            />
            <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm">
              <p className="text-indigo-700">Net preview</p>
              <p className="text-lg font-semibold text-indigo-800">{formatCurrency(payrollOutput.netSalary)}</p>
            </div>
          </div>

          <SectionCard title="1. Thông tin nền tảng (Base Profile)">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <TextField
                label="Vị trí công việc"
                value={config.baseProfile.jobTitle}
                onChange={(value) => updateGroup('baseProfile', { ...config.baseProfile, jobTitle: value })}
                disabled
              />
              <TextField
                label="Cấp bậc"
                value={config.baseProfile.level}
                onChange={(value) => updateGroup('baseProfile', { ...config.baseProfile, level: value })}
                disabled
              />
              <TextField
                label="Phòng ban"
                value={config.baseProfile.department}
                onChange={(value) => updateGroup('baseProfile', { ...config.baseProfile, department: value })}
                disabled
              />
              <TextField
                label="Loại hợp đồng"
                value={config.baseProfile.contractType}
                onChange={(value) => updateGroup('baseProfile', { ...config.baseProfile, contractType: value })}
                disabled
              />
              <TextField
                label="Địa điểm làm việc"
                value={config.baseProfile.workLocation}
                onChange={(value) => updateGroup('baseProfile', { ...config.baseProfile, workLocation: value })}
                disabled
              />
            </div>
          </SectionCard>

          <SectionCard title="2. Lương cơ bản (Base Salary)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NumberField
                label="Lương cơ bản"
                value={config.baseSalary.amount}
                onChange={(value) =>
                  updateGroup('baseSalary', {
                    ...config.baseSalary,
                    amount: value,
                  })
                }
              />
              <NumberField
                label="Hệ số lương"
                value={config.baseSalary.factor}
                onChange={(value) =>
                  updateGroup('baseSalary', {
                    ...config.baseSalary,
                    factor: value,
                  })
                }
                step="0.1"
              />
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">Mức lương tối thiểu vùng ({config.taxPolicy.region})</p>
                <p className="text-base font-semibold text-gray-900">{formatCurrency(payrollOutput.regionalMinimum)}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Tự động theo vùng lương và ngày hiệu lực (NĐ 293/2025/NĐ-CP, áp dụng từ 01/01/2026).
            </p>
          </SectionCard>

          <SectionCard title="3. Thu nhập bổ sung (Allowances & Earnings)">
            <div className="space-y-4">

              {/* Phụ cấp cố định — 4 cột */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberField
                  label="Phụ cấp đi lại / xăng xe"
                  value={config.allowances.transport}
                  onChange={(value) => updateGroup('allowances', { ...config.allowances, transport: value })}
                />
                <NumberField
                  label="Phụ cấp điện thoại"
                  value={config.allowances.phone}
                  onChange={(value) => updateGroup('allowances', { ...config.allowances, phone: value })}
                />
                <NumberField
                  label="Phụ cấp nhà ở"
                  value={config.allowances.housing}
                  onChange={(value) => updateGroup('allowances', { ...config.allowances, housing: value })}
                />
                <NumberField
                  label="Phụ cấp độc hại / nguy hiểm"
                  value={config.allowances.hazardous}
                  onChange={(value) => updateGroup('allowances', { ...config.allowances, hazardous: value })}
                />
              </div>

              {/* Phụ cấp ăn trưa */}
              <div className="rounded-lg border border-amber-200 bg-amber-50">
                <div className="px-4 py-3 space-y-3">
                  <p className="text-sm font-semibold text-amber-800">Phụ cấp ăn trưa</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <SelectBox
                      label="Cơ chế chi trả"
                      value={config.lunchAllowancePolicy.mode}
                      options={[
                        { value: 'fixed', label: 'Cố định theo tháng' },
                        { value: 'actual_working_day', label: 'Theo ngày công thực tế' },
                      ]}
                      onChange={(value) =>
                        updateGroup('lunchAllowancePolicy', {
                          ...config.lunchAllowancePolicy,
                          mode: value as LunchAllowancePolicy['mode'],
                        })
                      }
                    />
                    {config.lunchAllowancePolicy.mode === 'actual_working_day' ? (
                      <>
                        <NumberField
                          label="Mức tối đa/tháng"
                          value={config.lunchAllowancePolicy.monthly_cap}
                          onChange={(value) =>
                            updateGroup('lunchAllowancePolicy', {
                              ...config.lunchAllowancePolicy,
                              monthly_cap: Math.min(Math.max(value, 0), MAX_LUNCH_ALLOWANCE_CAP),
                            })
                          }
                        />
                        <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
                          <p className="text-xs text-gray-500">Mức/ngày công</p>
                          <p className="text-sm font-semibold text-amber-700">
                            {config.timeAttendance.workingDays > 0
                              ? formatCurrency(Math.round(Math.min(config.lunchAllowancePolicy.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP) / config.timeAttendance.workingDays))
                              : '—'}
                          </p>
                          <p className="text-xs text-gray-400">{config.timeAttendance.workingDays} công chuẩn</p>
                        </div>
                        <div className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2">
                          <p className="text-xs text-gray-500">Tạm tính</p>
                          <p className="text-sm font-bold text-amber-800">{formatCurrency(lunchPreview)}</p>
                          <p className="text-xs text-gray-500">{formatNumber(calculateActualWorkDays(config.timeAttendance))} ngày công</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <NumberField
                          label="Mức cố định/tháng"
                          value={config.lunchAllowancePolicy.fixed_amount}
                          onChange={(value) =>
                            updateGroup('lunchAllowancePolicy', {
                              ...config.lunchAllowancePolicy,
                              fixed_amount: value,
                            })
                          }
                        />
                        <NumberField
                          label="Trần/tháng (tối đa 500.000)"
                          value={config.lunchAllowancePolicy.monthly_cap}
                          onChange={(value) =>
                            updateGroup('lunchAllowancePolicy', {
                              ...config.lunchAllowancePolicy,
                              monthly_cap: Math.min(Math.max(value, 0), MAX_LUNCH_ALLOWANCE_CAP),
                            })
                          }
                        />
                        <div className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2">
                          <p className="text-xs text-gray-500">Tạm tính</p>
                          <p className="text-sm font-bold text-amber-800">{formatCurrency(lunchPreview)}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Phụ cấp gửi xe */}
              <div className="rounded-lg border border-blue-200 bg-blue-50">
                <div className="px-4 py-3 space-y-3">
                  <p className="text-sm font-semibold text-blue-800">Phụ cấp gửi xe</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <SelectBox
                      label="Hình thức"
                      value={config.parkingAllowancePolicy.mode}
                      options={[
                        { value: 'none', label: 'Không có' },
                        { value: 'daily', label: 'Vé ngày' },
                        { value: 'monthly', label: 'Vé tháng' },
                      ]}
                      onChange={(value) =>
                        updateGroup('parkingAllowancePolicy', {
                          ...config.parkingAllowancePolicy,
                          mode: value as ParkingAllowancePolicy['mode'],
                        })
                      }
                    />
                    {config.parkingAllowancePolicy.mode === 'daily' && (
                      <>
                        <NumberField
                          label="Giá vé/ngày"
                          value={config.parkingAllowancePolicy.daily_rate}
                          onChange={(value) =>
                            updateGroup('parkingAllowancePolicy', { ...config.parkingAllowancePolicy, daily_rate: value })
                          }
                        />
                        <div className="rounded-md border border-blue-300 bg-blue-100 px-3 py-2">
                          <p className="text-xs text-gray-500">Tạm tính</p>
                          <p className="text-sm font-bold text-blue-800">
                            {formatCurrency(calculateParkingAllowance(config.parkingAllowancePolicy, calculateActualWorkDays(config.timeAttendance)))}
                          </p>
                          <p className="text-xs text-gray-500">
                            {Math.ceil(calculateActualWorkDays(config.timeAttendance))} ngày × {config.parkingAllowancePolicy.daily_rate.toLocaleString('vi-VN')}đ
                          </p>
                        </div>
                      </>
                    )}
                    {config.parkingAllowancePolicy.mode === 'monthly' && (
                      <>
                        <NumberField
                          label="Giá vé tháng"
                          value={config.parkingAllowancePolicy.monthly_rate}
                          onChange={(value) =>
                            updateGroup('parkingAllowancePolicy', { ...config.parkingAllowancePolicy, monthly_rate: value })
                          }
                        />
                        <div className="rounded-md border border-blue-300 bg-blue-100 px-3 py-2">
                          <p className="text-xs text-gray-500">Cố định/tháng</p>
                          <p className="text-sm font-bold text-blue-800">{formatCurrency(config.parkingAllowancePolicy.monthly_rate)}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Phụ cấp trách nhiệm */}
              <div className="rounded-lg border border-purple-200 bg-purple-50">
                <div className="px-4 py-3 space-y-3">
                  <p className="text-sm font-semibold text-purple-800">Phụ cấp trách nhiệm / chức vụ</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <SelectBox
                      label="Cơ chế chi trả"
                      value={config.responsibilityAllowancePolicy.mode}
                      options={[
                        { value: 'none', label: 'Không có' },
                        { value: 'fixed', label: 'Cố định theo tháng' },
                        { value: 'actual_working_day', label: 'Theo ngày công thực tế' },
                      ]}
                      onChange={(value) =>
                        updateGroup('responsibilityAllowancePolicy', {
                          ...config.responsibilityAllowancePolicy,
                          mode: value as ResponsibilityAllowancePolicy['mode'],
                        })
                      }
                    />
                    {config.responsibilityAllowancePolicy.mode !== 'none' && (
                      <>
                        <NumberField
                          label={config.responsibilityAllowancePolicy.mode === 'fixed' ? 'Mức cố định/tháng' : 'Mức tối đa/tháng'}
                          value={config.responsibilityAllowancePolicy.monthly_max}
                          onChange={(value) =>
                            updateGroup('responsibilityAllowancePolicy', { ...config.responsibilityAllowancePolicy, monthly_max: value })
                          }
                        />
                        {config.responsibilityAllowancePolicy.mode === 'actual_working_day' && (
                          <div className="rounded-md border border-purple-200 bg-white px-3 py-2">
                            <p className="text-xs text-gray-500">Mức/ngày công</p>
                            <p className="text-sm font-semibold text-purple-700">
                              {config.timeAttendance.workingDays > 0
                                ? formatCurrency(Math.round(config.responsibilityAllowancePolicy.monthly_max / config.timeAttendance.workingDays))
                                : '—'}
                            </p>
                            <p className="text-xs text-gray-400">{config.timeAttendance.workingDays} công chuẩn</p>
                          </div>
                        )}
                        <div className="rounded-md border border-purple-300 bg-purple-100 px-3 py-2">
                          <p className="text-xs text-gray-500">Tạm tính</p>
                          <p className="text-sm font-bold text-purple-800">
                            {formatCurrency(calculateResponsibilityAllowance(
                              config.responsibilityAllowancePolicy,
                              calculateActualWorkDays(config.timeAttendance),
                              config.timeAttendance.workingDays,
                            ))}
                          </p>
                          {config.responsibilityAllowancePolicy.mode === 'actual_working_day' && (
                            <p className="text-xs text-gray-500">{formatNumber(calculateActualWorkDays(config.timeAttendance))} ngày công</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </SectionCard>

          <SectionCard title="4. Lương hiệu suất & hoa hồng (Variable Pay)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NumberField
                label="Hoa hồng bán hàng"
                value={config.variablePay.salesCommission}
                onChange={(value) => updateGroup('variablePay', { ...config.variablePay, salesCommission: value })}
              />
              <NumberField
                label="Thưởng KPI / OKR"
                value={config.variablePay.kpiBonus}
                onChange={(value) => updateGroup('variablePay', { ...config.variablePay, kpiBonus: value })}
              />
              <NumberField
                label="Bonus theo quý / năm"
                value={config.variablePay.quarterlyBonus}
                onChange={(value) => updateGroup('variablePay', { ...config.variablePay, quarterlyBonus: value })}
              />
              <NumberField
                label="Thưởng dự án"
                value={config.variablePay.projectBonus}
                onChange={(value) => updateGroup('variablePay', { ...config.variablePay, projectBonus: value })}
              />
              <NumberField
                label="Thưởng sáng kiến"
                value={config.variablePay.innovationBonus}
                onChange={(value) => updateGroup('variablePay', { ...config.variablePay, innovationBonus: value })}
              />
            </div>
          </SectionCard>

          <SectionCard title="5. Thời gian làm việc (Time & Attendance)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NumberField
                label="Số ngày công thực tế"
                value={config.timeAttendance.workingDays}
                onChange={(value) => updateGroup('timeAttendance', { ...config.timeAttendance, workingDays: value })}
                step="1"
              />
              <NumberField
                label="Số giờ làm việc"
                value={config.timeAttendance.workingHours}
                onChange={(value) => updateGroup('timeAttendance', { ...config.timeAttendance, workingHours: value })}
                step="1"
              />
              <NumberField
                label="Giờ tăng ca"
                value={config.timeAttendance.overtimeHours}
                onChange={(value) => updateGroup('timeAttendance', { ...config.timeAttendance, overtimeHours: value })}
                step="1"
              />
              <NumberField
                label="Nghỉ phép có lương"
                value={config.timeAttendance.paidLeaveDays}
                onChange={(value) => updateGroup('timeAttendance', { ...config.timeAttendance, paidLeaveDays: value })}
                step="1"
              />
              <NumberField
                label="Nghỉ không lương"
                value={config.timeAttendance.unpaidLeaveDays}
                onChange={(value) => updateGroup('timeAttendance', { ...config.timeAttendance, unpaidLeaveDays: value })}
                step="1"
              />
              <NumberField
                label="Đi muộn / về sớm"
                value={config.timeAttendance.lateEarlyCount}
                onChange={(value) => updateGroup('timeAttendance', { ...config.timeAttendance, lateEarlyCount: value })}
                step="1"
              />
            </div>
          </SectionCard>

          <SectionCard title="6. Khấu trừ (Deductions)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <SelectBox
                label="Vùng lương tối thiểu"
                value={config.taxPolicy.region}
                options={[
                  { value: 'I', label: 'Vùng I' },
                  { value: 'II', label: 'Vùng II' },
                  { value: 'III', label: 'Vùng III' },
                  { value: 'IV', label: 'Vùng IV' },
                ]}
                onChange={(value) =>
                  updateGroup('taxPolicy', {
                    ...config.taxPolicy,
                    region: value as SalaryConfigurationValues['taxPolicy']['region'],
                  })
                }
              />
              <SelectBox
                label="Mức lương đóng bảo hiểm"
                value={config.taxPolicy.insuranceSalaryMode}
                options={[
                  { value: 'official', label: 'Trên lương chính thức' },
                  { value: 'custom', label: 'Khác' },
                ]}
                onChange={(value) =>
                  updateGroup('taxPolicy', {
                    ...config.taxPolicy,
                    insuranceSalaryMode: value as SalaryConfigurationValues['taxPolicy']['insuranceSalaryMode'],
                  })
                }
              />
              {config.taxPolicy.insuranceSalaryMode === 'custom' ? (
                <NumberField
                  label="Mức lương đóng BH tùy chỉnh"
                  value={config.taxPolicy.insuranceSalaryOverride}
                  onChange={(value) =>
                    updateGroup('taxPolicy', {
                      ...config.taxPolicy,
                      insuranceSalaryOverride: value,
                    })
                  }
                />
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">Mức lương đóng BH</p>
                  <p className="text-base font-semibold text-gray-900">{formatCurrency(payrollOutput.insuranceSalaryBase)}</p>
                </div>
              )}

              <NumberField
                label="Số người phụ thuộc"
                value={config.taxPolicy.dependentCount}
                onChange={(value) =>
                  updateGroup('taxPolicy', {
                    ...config.taxPolicy,
                    dependentCount: Math.max(Math.floor(value), 0),
                  })
                }
                step="1"
              />

              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">Giảm trừ bản thân</p>
                <p className="text-base font-semibold text-gray-900">{formatCurrency(payrollOutput.personalDeduction)}</p>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">Giảm trừ người phụ thuộc</p>
                <p className="text-base font-semibold text-gray-900">{formatCurrency(payrollOutput.dependentDeduction)}</p>
              </div>

              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-xs text-blue-700">Thu nhập tính thuế</p>
                <p className="text-base font-semibold text-blue-800">{formatCurrency(payrollOutput.taxableIncome)}</p>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs text-red-700">Thuế TNCN tự tính</p>
                <p className="text-base font-semibold text-red-800">{formatCurrency(payrollOutput.pit)}</p>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">BHXH / BHYT / BHTN</p>
                <p className="text-sm font-semibold text-gray-900">
                  {formatCurrency(payrollOutput.socialInsurance)} / {formatCurrency(payrollOutput.healthInsurance)} / {formatCurrency(payrollOutput.unemploymentInsurance)}
                </p>
              </div>

              <NumberField
                label="Công đoàn phí"
                value={config.deductions.unionFee}
                onChange={(value) => updateGroup('deductions', { ...config.deductions, unionFee: value })}
              />
              <NumberField
                label="Tạm ứng / phạt / bồi thường"
                value={config.deductions.advancePenaltyCompensation}
                onChange={(value) =>
                  updateGroup('deductions', {
                    ...config.deductions,
                    advancePenaltyCompensation: value,
                  })
                }
              />
            </div>
            <p className="text-xs text-gray-500">
              Áp dụng tự động: lương cơ sở 2.340.000đ (từ 01/07/2024), lương tối thiểu vùng mới (từ 01/01/2026),
              giảm trừ gia cảnh 15.500.000đ + 6.200.000đ/người phụ thuộc, biểu thuế lũy tiến 5 bậc cho kỳ thuế 2026.
            </p>
          </SectionCard>

          <SectionCard title="7. Đóng góp từ công ty (Employer Contributions)">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <NumberField
                label="BHXH công ty đóng"
                value={config.employerContributions.socialInsurance}
                onChange={(value) =>
                  updateGroup('employerContributions', {
                    ...config.employerContributions,
                    socialInsurance: value,
                  })
                }
              />
              <NumberField
                label="BHYT công ty đóng"
                value={config.employerContributions.healthInsurance}
                onChange={(value) =>
                  updateGroup('employerContributions', {
                    ...config.employerContributions,
                    healthInsurance: value,
                  })
                }
              />
              <NumberField
                label="BHTN công ty đóng"
                value={config.employerContributions.unemploymentInsurance}
                onChange={(value) =>
                  updateGroup('employerContributions', {
                    ...config.employerContributions,
                    unemploymentInsurance: value,
                  })
                }
              />
              <NumberField
                label="Bảo hiểm bổ sung"
                value={config.employerContributions.supplementalInsurance}
                onChange={(value) =>
                  updateGroup('employerContributions', {
                    ...config.employerContributions,
                    supplementalInsurance: value,
                  })
                }
              />
            </div>
          </SectionCard>

          <SectionCard title="8. Điều chỉnh (Adjustments)">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <NumberField
                label="Truy thu lương"
                value={config.adjustments.retroactiveCollect}
                onChange={(value) => updateGroup('adjustments', { ...config.adjustments, retroactiveCollect: value })}
              />
              <NumberField
                label="Truy lĩnh lương"
                value={config.adjustments.retroactivePay}
                onChange={(value) => updateGroup('adjustments', { ...config.adjustments, retroactivePay: value })}
              />
              <NumberField
                label="Điều chỉnh sai sót kỳ trước"
                value={config.adjustments.priorPeriodCorrection}
                onChange={(value) =>
                  updateGroup('adjustments', {
                    ...config.adjustments,
                    priorPeriodCorrection: value,
                  })
                }
              />
              <NumberField
                label="Thưởng/phạt bất thường"
                value={config.adjustments.irregularRewardPenalty}
                onChange={(value) =>
                  updateGroup('adjustments', {
                    ...config.adjustments,
                    irregularRewardPenalty: value,
                  })
                }
              />
            </div>
          </SectionCard>

          <SectionCard title="9. Tổng hợp lương (Payroll Output)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <p className="text-xs text-gray-500">Tổng thu nhập (Gross Income)</p>
                <p className="text-base font-semibold text-gray-900">{formatCurrency(payrollOutput.grossIncome)}</p>
              </div>
              <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <p className="text-xs text-gray-500">Tổng khấu trừ</p>
                <p className="text-base font-semibold text-red-600">{formatCurrency(payrollOutput.totalDeductions)}</p>
              </div>
              <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
                <p className="text-xs text-indigo-600">Lương thực nhận (Net Salary)</p>
                <p className="text-base font-semibold text-indigo-700">{formatCurrency(payrollOutput.netSalary)}</p>
              </div>
            </div>
          </SectionCard>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
              Lưu cấu hình
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Salary Config Import helpers ────────────────────────────────────────────

function extractScCellNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && 'result' in (raw as object))
    return extractScCellNumber((raw as { result: unknown }).result);
  if (typeof raw === 'string') {
    let s = raw.replace(/\s/g, '');
    // 60.000.000 hoặc 60.000.000,50  →  dấu chấm là phân cách hàng nghìn
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    // 60,000,000 hoặc 60,000,000.50  →  dấu phẩy là phân cách hàng nghìn
    } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      s = s.replace(/,/g, '');
    // 60000000 hoặc 60000.5  →  không có phân cách, giữ nguyên
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function extractScCellString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && 'result' in (raw as object))
    return extractScCellString((raw as { result: unknown }).result);
  return String(raw).trim();
}

/** Chuẩn hoá ngày hiệu lực về YYYY-MM-DD.
 *  Nhận: Date object, "2026-01-15", "15/01/2026", "15-01-2026", "2026/01/15" */
function normalizeEffectiveDate(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  // ExcelJS trả về Date object khi cell được format kiểu Date
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof raw === 'object' && 'result' in (raw as object)) {
    return normalizeEffectiveDate((raw as { result: unknown }).result);
  }

  const s = String(raw).trim();
  if (!s) return '';

  // YYYY-MM-DD hoặc YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY hoặc DD-MM-YYYY (định dạng Việt Nam phổ biến)
  const vnMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (vnMatch) {
    const [, d, m, y] = vnMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return s; // trả về nguyên bản để validate báo lỗi
}

const SC_LUNCH_MODE_MAP: Record<string, string> = {
  'Cố định theo tháng': 'fixed',
  'Theo ngày công thực tế': 'actual_working_day',
};
const SC_PARKING_MODE_MAP: Record<string, string> = {
  'Không có': 'none', 'Vé ngày': 'daily', 'Vé tháng': 'monthly',
};
const SC_RESP_MODE_MAP: Record<string, string> = {
  'Không có': 'none', 'Cố định theo tháng': 'fixed', 'Theo ngày công thực tế': 'actual_working_day',
};
const SC_INS_MODE_MAP: Record<string, string> = {
  'Theo lương chính thức': 'official', 'Tùy chỉnh': 'custom',
};

async function downloadSalaryConfigTemplate() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cấu Hình Lương');
  ws.columns = [
    { header: 'Mã nhân viên',               key: 'a', width: 18 },
    { header: 'Ngày hiệu lực (YYYY-MM-DD)',  key: 'b', width: 22 },
    { header: 'Lương cơ bản',               key: 'c', width: 18 },
    { header: 'Hệ số lương',                key: 'd', width: 14 },
    { header: 'PC Ăn trưa - Chế độ',        key: 'e', width: 26 },
    { header: 'PC Ăn trưa - Mức/tháng',     key: 'f', width: 22 },
    { header: 'PC Gửi xe - Chế độ',         key: 'g', width: 22 },
    { header: 'PC Gửi xe - Giá vé',         key: 'h', width: 18 },
    { header: 'PC Trách nhiệm - Chế độ',    key: 'i', width: 26 },
    { header: 'PC Trách nhiệm - Mức/tháng', key: 'j', width: 26 },
    { header: 'Vùng lương tối thiểu',        key: 'k', width: 20 },
    { header: 'Chế độ đóng bảo hiểm',       key: 'l', width: 26 },
    { header: 'Mức lương đóng BH tùy chỉnh', key: 'm', width: 28 },
    { header: 'Số người phụ thuộc',          key: 'n', width: 20 },
    { header: 'Phí công đoàn',              key: 'o', width: 16 },
  ];
  ws.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.getRow(1).height = 36;
  for (let r = 2; r <= 500; r++) {
    ws.getCell(`E${r}`).dataValidation = { type: 'list', formulae: ['"Cố định theo tháng,Theo ngày công thực tế"'], showErrorMessage: true };
    ws.getCell(`G${r}`).dataValidation = { type: 'list', formulae: ['"Không có,Vé ngày,Vé tháng"'], showErrorMessage: true };
    ws.getCell(`I${r}`).dataValidation = { type: 'list', formulae: ['"Không có,Cố định theo tháng,Theo ngày công thực tế"'], showErrorMessage: true };
    ws.getCell(`K${r}`).dataValidation = { type: 'list', formulae: ['"I,II,III,IV"'], showErrorMessage: true };
    ws.getCell(`L${r}`).dataValidation = { type: 'list', formulae: ['"Theo lương chính thức,Tùy chỉnh"'], showErrorMessage: true };
  }
  const exRow = ws.addRow(['NV001', '2026-01-01', 8000000, 1, 'Theo ngày công thực tế', 500000, 'Vé ngày', 20000, 'Cố định theo tháng', 1000000, 'I', 'Theo lương chính thức', 0, 0, 10000]);
  exRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.font = { color: { argb: 'FF9CA3AF' }, italic: true };
  });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = 'template_cau_hinh_luong.xlsx'; a.click();
  URL.revokeObjectURL(url);
}

async function parseSalaryConfigExcel(file: File): Promise<{ rows: ParsedSalaryConfigRow[]; error: string | null }> {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return { rows: [], error: 'File không có sheet nào.' };
    const rows: ParsedSalaryConfigRow[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const code = row.getCell(1).value != null ? String(row.getCell(1).value).trim() : '';
      if (!code) return;
      const effectiveDate = normalizeEffectiveDate(row.getCell(2).value);
      const errors: string[] = [];
      if (!effectiveDate) {
        errors.push('Thiếu ngày hiệu lực');
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        errors.push(`Ngày hiệu lực không hợp lệ: "${effectiveDate}" (dùng YYYY-MM-DD hoặc DD/MM/YYYY)`);
      }
      const lunchRaw   = extractScCellString(row.getCell(5).value);
      const parkRaw    = extractScCellString(row.getCell(7).value);
      const respRaw    = extractScCellString(row.getCell(9).value);
      const regionRaw  = extractScCellString(row.getCell(11).value);
      const insRaw     = extractScCellString(row.getCell(12).value);
      if (lunchRaw  && !SC_LUNCH_MODE_MAP[lunchRaw])   errors.push(`PC ăn trưa: "${lunchRaw}" không hợp lệ`);
      if (parkRaw   && !SC_PARKING_MODE_MAP[parkRaw])  errors.push(`PC gửi xe: "${parkRaw}" không hợp lệ`);
      if (respRaw   && !SC_RESP_MODE_MAP[respRaw])     errors.push(`PC TN: "${respRaw}" không hợp lệ`);
      if (regionRaw && !['I','II','III','IV'].includes(regionRaw)) errors.push(`Vùng: "${regionRaw}" không hợp lệ`);
      if (insRaw    && !SC_INS_MODE_MAP[insRaw])       errors.push(`BH: "${insRaw}" không hợp lệ`);
      const parsed: ParsedSalaryConfigRow = {
        employee_code: code, effective_date: effectiveDate, rowIndex: idx,
        parseError: errors.length ? errors.join('; ') : undefined,
      };
      const bs = extractScCellNumber(row.getCell(3).value); if (bs > 0) parsed.basic_salary = bs;
      const sf = extractScCellNumber(row.getCell(4).value); if (sf > 0) parsed.salary_factor = sf;
      if (lunchRaw)  { parsed.lunch_mode = SC_LUNCH_MODE_MAP[lunchRaw] ?? lunchRaw; }
      const la = extractScCellNumber(row.getCell(6).value);  if (la > 0) parsed.lunch_amount = la;
      if (parkRaw)   { parsed.parking_mode = SC_PARKING_MODE_MAP[parkRaw] ?? parkRaw; }
      const pr = extractScCellNumber(row.getCell(8).value);  if (pr > 0) parsed.parking_rate = pr;
      if (respRaw)   { parsed.responsibility_mode = SC_RESP_MODE_MAP[respRaw] ?? respRaw; }
      const ra = extractScCellNumber(row.getCell(10).value); if (ra > 0) parsed.responsibility_amount = ra;
      if (regionRaw) parsed.region = regionRaw;
      if (insRaw)    parsed.insurance_mode = SC_INS_MODE_MAP[insRaw] ?? insRaw;
      const io = extractScCellNumber(row.getCell(13).value); if (io > 0) parsed.insurance_override = io;
      const dc = row.getCell(14).value; if (dc != null) parsed.dependent_count = extractScCellNumber(dc);
      const uf = row.getCell(15).value; if (uf != null) parsed.union_fee = extractScCellNumber(uf);
      rows.push(parsed);
    });
    if (!rows.length) return { rows: [], error: 'File không có dữ liệu.' };
    return { rows, error: null };
  } catch {
    return { rows: [], error: 'Không thể đọc file.' };
  }
}

const SalaryManagement: React.FC<SalaryManagementProps> = ({
  defaultTab = 'config',
  lockTab = false,
}) => {
  const now = new Date();
  const defaultPayrollDate = new Date(now);
  if (now.getDate() <= 15) {
    defaultPayrollDate.setMonth(defaultPayrollDate.getMonth() - 1);
  }
  const [activeTab, setActiveTab] = useState<SalaryTabKey>(defaultTab);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [searchEmployee, setSearchEmployee] = useState('');
  const [deptFilterConfig, setDeptFilterConfig] = useState<string>('');
  const [configPage, setConfigPage] = useState(1);
  const [configTotal, setConfigTotal] = useState(0);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingEmployeeConfig, setLoadingEmployeeConfig] = useState<number | null>(null);

  const SALARY_PAGE_SIZE = 20;
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
  const [salaryCommissions, setSalaryCommissions] = useState<CommissionRecord[]>([]);
  const [salaryPage, setSalaryPage] = useState(1);
  const [payslipRecord, setPayslipRecord] = useState<SalaryRecord | null>(null);
  const [payslipEmployee, setPayslipEmployee] = useState<Employee | null>(null);
  const [payslipPenalties, setPayslipPenalties] = useState<PenaltyRecord[]>([]);
  const [payslipCommissions, setPayslipCommissions] = useState<CommissionRecord[]>([]);
  const [loadingSalary, setLoadingSalary] = useState(false);
  const [salaryError, setSalaryError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(defaultPayrollDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(defaultPayrollDate.getMonth() + 1);
  const [deptFilterView, setDeptFilterView] = useState<string>('');
  const [legalEntityFilterView, setLegalEntityFilterView] = useState<string>('');
  // '' = tất cả | working = đang làm việc | left = đã nghỉ
  const [employmentFilterView, setEmploymentFilterView] = useState<'' | 'working' | 'left'>('');
  // Người đã nghỉ giữa tháng vẫn còn lương phải trả; giữ lại để cảnh báo khi lọc.
  const [leftPayable, setLeftPayable] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 });
  const [searchSalary, setSearchSalary] = useState('');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [legalEntities, setLegalEntities] = useState<Array<{ value: string; label: string }>>([]);

  // ── Tổng lương công ty ──
  const [showTotalSalaryModal, setShowTotalSalaryModal] = useState(false);
  const [totalSalaryData, setTotalSalaryData] = useState<{
    year: number;
    month: number;
    department_id: number | null;
    legal_entity?: string | null;
    total_luong_thuc_linh: number;
    total_con_phai_thanh_toan: number;
    total_thue_tncn: number;
    total_net_salary: number;
    employee_count: number;
  } | null>(null);
  const [totalSalaryScope, setTotalSalaryScope] = useState<'company' | 'legal_entity'>('company');
  const [loadingTotalSalary, setLoadingTotalSalary] = useState(false);
  const [totalSalaryError, setTotalSalaryError] = useState<string | null>(null);
  const [exportingPayroll, setExportingPayroll] = useState(false);
  const [showPayrollPreviewModal, setShowPayrollPreviewModal] = useState(false);
  const [sendingDeptPayslipEmail, setSendingDeptPayslipEmail] = useState(false);
  const [deptPayslipEmailResult, setDeptPayslipEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showDeptPayslipConfirm, setShowDeptPayslipConfirm] = useState(false);
  const [deptPayslipBatchId, setDeptPayslipBatchId] = useState<string | null>(null);
  const [deptPayslipBatch, setDeptPayslipBatch] = useState<PayslipEmailBatchStatus | null>(null);
  const [pollingBatch, setPollingBatch] = useState(false);
  const [loadingRecipientsPreview, setLoadingRecipientsPreview] = useState(false);
  const [deptRecipientsPreview, setDeptRecipientsPreview] = useState<DepartmentPayslipRecipientsResponse | null>(null);
  const [deptRecipientsPreviewError, setDeptRecipientsPreviewError] = useState<string | null>(null);
  const [selectedRecipientPreview, setSelectedRecipientPreview] = useState<DepartmentPayslipRecipientsResponse['recipients'][number] | null>(null);
  const [emailStatusFromQueueMap, setEmailStatusFromQueueMap] = useState<Record<number, 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED'>>({});
  // ── Company payslip email send ──
  const [sendingCompanyPayslipEmail, setSendingCompanyPayslipEmail] = useState(false);
  const [companyPayslipEmailResult, setCompanyPayslipEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCompanyPayslipConfirm, setShowCompanyPayslipConfirm] = useState(false);
  const [companyPayslipBatchId, setCompanyPayslipBatchId] = useState<string | null>(null);
  const [companyPayslipBatch, setCompanyPayslipBatch] = useState<PayslipEmailBatchStatus | null>(null);
  const [pollingCompanyBatch, setPollingCompanyBatch] = useState(false);
  const [loadingCompanyRecipientsPreview, setLoadingCompanyRecipientsPreview] = useState(false);
  const [companyRecipientsPreview, setCompanyRecipientsPreview] = useState<CompanyPayslipRecipientsResponse | null>(null);
  const [companyRecipientsPreviewError, setCompanyRecipientsPreviewError] = useState<string | null>(null);
  const [selectedCompanyRecipientPreview, setSelectedCompanyRecipientPreview] = useState<CompanyPayslipRecipientsResponse['recipients'][number] | null>(null);
  useLockBodyScroll(showTotalSalaryModal || showPayrollPreviewModal);

  // ── Import cấu hình lương dialog ──
  const [showImportDialog, setShowImportDialog]   = useState(false);
  const [scFile,           setScFile]             = useState<File | null>(null);
  const [scParsedRows,     setScParsedRows]       = useState<ParsedSalaryConfigRow[] | null>(null);
  const [scParsing,        setScParsing]          = useState(false);
  const [scParseError,     setScParseError]       = useState<string | null>(null);
  const [scImporting,      setScImporting]        = useState(false);
  const [scImportMsg,      setScImportMsg]        = useState<{ ok: string | null; err: string | null; errors: { employee_code: string; error: string }[]; failedRows: ParsedSalaryConfigRow[] }>({ ok: null, err: null, errors: [], failedRows: [] });
  const scFileRef = React.useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 20;

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    Promise.allSettled([
      salaryService.listSalaryDepartments(),
      salaryService.listSalaryLegalEntities(),
    ]).then(([departmentsRes, legalEntitiesRes]) => {
      if (departmentsRes.status === 'fulfilled') {
        setDepartments(departmentsRes.value as Department[]);
      }
      if (legalEntitiesRes.status === 'fulfilled') {
        const raw = legalEntitiesRes.value ?? [];
        const unique = new Map<string, { value: string; label: string }>();
        raw.forEach((item) => {
          const normalized = (item.value ?? '').trim();
          if (!normalized) return;
          const key = normalized.toLowerCase();
          if (!unique.has(key)) {
            unique.set(key, { value: normalized, label: normalized });
          }
        });
        setLegalEntities(Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, 'vi')));
      }
    });
  }, []);

  // ── Import config handlers ─────────────────────────────────────────────────

  const handleScFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.xlsx$/i)) { setScParseError('Chỉ chấp nhận file .xlsx'); return; }
    setScFile(f); setScParseError(null); setScParsedRows(null); setScImportMsg({ ok: null, err: null, errors: [], failedRows: [] }); setScParsing(true);
    const { rows, error } = await parseSalaryConfigExcel(f);
    setScParsing(false);
    if (error) { setScParseError(error); return; }
    setScParsedRows(rows);
  };

  const handleScImport = async () => {
    if (!scParsedRows) return;
    const valid = scParsedRows.filter((r) => !r.parseError);
    if (!valid.length) return;
    setScImporting(true);
    try {
      const records: BulkSalaryConfigRecord[] = valid.map((r) => {
        const rec: BulkSalaryConfigRecord = { employee_code: r.employee_code, effective_date: r.effective_date };
        if (r.basic_salary         !== undefined) rec.basic_salary         = r.basic_salary;
        if (r.salary_factor        !== undefined) rec.salary_factor        = r.salary_factor;
        if (r.lunch_mode           !== undefined) rec.lunch_mode           = r.lunch_mode;
        if (r.lunch_amount         !== undefined) rec.lunch_amount         = r.lunch_amount;
        if (r.parking_mode         !== undefined) rec.parking_mode         = r.parking_mode;
        if (r.parking_rate         !== undefined) rec.parking_rate         = r.parking_rate;
        if (r.responsibility_mode  !== undefined) rec.responsibility_mode  = r.responsibility_mode;
        if (r.responsibility_amount !== undefined) rec.responsibility_amount = r.responsibility_amount;
        if (r.region               !== undefined) rec.region               = r.region;
        if (r.insurance_mode       !== undefined) rec.insurance_mode       = r.insurance_mode;
        if (r.insurance_override   !== undefined) rec.insurance_override   = r.insurance_override;
        if (r.dependent_count      !== undefined) rec.dependent_count      = r.dependent_count;
        if (r.union_fee            !== undefined) rec.union_fee            = r.union_fee;
        return rec;
      });
      const res = await salaryService.bulkImportSalaryConfig(records);
      const ok  = res.success.length > 0 ? `Cập nhật thành công ${res.success.length} nhân viên.` : null;
      const err = res.errors.length   > 0 ? `${res.errors.length} dòng lỗi — xem chi tiết bên dưới.` : null;
      // Map error codes → original parsed row để có thể export lại
      const errorCodeSet = new Set(res.errors.map((e) => e.employee_code));
      const failedRows = (scParsedRows ?? []).filter((r) => errorCodeSet.has(r.employee_code));
      setScImportMsg({ ok, err, errors: res.errors, failedRows });
      setScParsedRows(null); setScFile(null);
      if (scFileRef.current) scFileRef.current.value = '';
      if (res.success.length > 0) loadEmployees();
    } catch {
      setScImportMsg({ ok: null, err: 'Lỗi kết nối máy chủ.', errors: [], failedRows: [] });
    } finally {
      setScImporting(false);
    }
  };

  const handleExportErrors = async () => {
    const { errors, failedRows } = scImportMsg;
    if (!errors.length) return;

    const LUNCH_R: Record<string, string> = { fixed: 'Cố định theo tháng', actual_working_day: 'Theo ngày công thực tế' };
    const PARK_R: Record<string, string>  = { none: 'Không có', daily: 'Vé ngày', monthly: 'Vé tháng' };
    const RESP_R: Record<string, string>  = { none: 'Không có', fixed: 'Cố định theo tháng', actual_working_day: 'Theo ngày công thực tế' };
    const INS_R: Record<string, string>   = { official: 'Theo lương chính thức', custom: 'Tùy chỉnh' };

    const errorMap = new Map(errors.map((e) => [e.employee_code, e.error]));
    const rowMap   = new Map(failedRows.map((r) => [r.employee_code, r]));

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cấu Hình Lương');

    const COLS = [
      { header: 'Mã nhân viên',                key: 'a', width: 18 },
      { header: 'Ngày hiệu lực (YYYY-MM-DD)',   key: 'b', width: 22 },
      { header: 'Lương cơ bản',                key: 'c', width: 18 },
      { header: 'Hệ số lương',                 key: 'd', width: 14 },
      { header: 'PC Ăn trưa - Chế độ',         key: 'e', width: 26 },
      { header: 'PC Ăn trưa - Mức/tháng',      key: 'f', width: 22 },
      { header: 'PC Gửi xe - Chế độ',          key: 'g', width: 22 },
      { header: 'PC Gửi xe - Giá vé',          key: 'h', width: 18 },
      { header: 'PC Trách nhiệm - Chế độ',     key: 'i', width: 26 },
      { header: 'PC Trách nhiệm - Mức/tháng',  key: 'j', width: 26 },
      { header: 'Vùng lương tối thiểu',         key: 'k', width: 20 },
      { header: 'Chế độ đóng bảo hiểm',        key: 'l', width: 26 },
      { header: 'Mức lương đóng BH tùy chỉnh', key: 'm', width: 28 },
      { header: 'Số người phụ thuộc',           key: 'n', width: 20 },
      { header: 'Phí công đoàn',               key: 'o', width: 16 },
      { header: 'Lý do lỗi',                   key: 'p', width: 44 },
    ];
    ws.columns = COLS;

    const borderStyle = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
    const allBorders = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };

    // Header row — giống template gốc (xanh tím), cột "Lý do lỗi" cũng xanh
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
      cell.font      = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border    = allBorders;
    });
    ws.getRow(1).height = 36;

    // Data rows — không tô màu, chỉ có border
    errors.forEach((e, idx) => {
      const orig   = rowMap.get(e.employee_code);
      const rowIdx = idx + 2;
      const values = [
        e.employee_code,
        orig?.effective_date        ?? '',
        orig?.basic_salary          ?? '',
        orig?.salary_factor         ?? '',
        orig?.lunch_mode            ? (LUNCH_R[orig.lunch_mode]            ?? orig.lunch_mode)            : '',
        orig?.lunch_amount          ?? '',
        orig?.parking_mode          ? (PARK_R[orig.parking_mode]           ?? orig.parking_mode)          : '',
        orig?.parking_rate          ?? '',
        orig?.responsibility_mode   ? (RESP_R[orig.responsibility_mode]    ?? orig.responsibility_mode)   : '',
        orig?.responsibility_amount ?? '',
        orig?.region                ?? '',
        orig?.insurance_mode        ? (INS_R[orig.insurance_mode]          ?? orig.insurance_mode)        : '',
        orig?.insurance_override    ?? '',
        orig?.dependent_count       ?? '',
        orig?.union_fee             ?? '',
        errorMap.get(e.employee_code) ?? '',
      ];
      const exRow = ws.getRow(rowIdx);
      values.forEach((v, ci) => {
        const cell    = exRow.getCell(ci + 1);
        cell.value    = v as any;
        cell.border   = allBorders;
        cell.alignment = { vertical: 'middle' };
      });
      exRow.commit();
    });

    // Data validation sau khi ghi data (tránh offset)
    for (let r = 2; r <= errors.length + 1; r++) {
      ws.getCell(`E${r}`).dataValidation = { type: 'list', formulae: ['"Cố định theo tháng,Theo ngày công thực tế"'], showErrorMessage: true };
      ws.getCell(`G${r}`).dataValidation = { type: 'list', formulae: ['"Không có,Vé ngày,Vé tháng"'], showErrorMessage: true };
      ws.getCell(`I${r}`).dataValidation = { type: 'list', formulae: ['"Không có,Cố định theo tháng,Theo ngày công thực tế"'], showErrorMessage: true };
      ws.getCell(`K${r}`).dataValidation = { type: 'list', formulae: ['"I,II,III,IV"'], showErrorMessage: true };
      ws.getCell(`L${r}`).dataValidation = { type: 'list', formulae: ['"Theo lương chính thức,Tùy chỉnh"'], showErrorMessage: true };
    }

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = 'cau_hinh_luong_loi.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  const payrollDetailRows = useMemo(() => {
    return salaryRecords.map((record) => {
      const employee = employees.find((e) => e.id === record.employee_id);
      const recordCommissions = salaryCommissions.filter((item) => item.employee === record.employee_id);
      const payslipComputation = calculatePayslipNetPayable(record, employee, recordCommissions);
      const payrollTax = payslipComputation.payrollTax;

      const stdDays = getStandardWorkDaysFromRecord(record);
      const workdayBreakdown = getWorkdaySalaryBreakdown(record, employee);
      const luongCoBan = record.luong_co_ban ?? 0;
      const luongNgayCongThucTe = workdayBreakdown.tongLuongNgayCong;
      const incomeBreakdown = getMonthlyInputIncomeBreakdown(record, recordCommissions);
      const luongDoanhSo = incomeBreakdown.luongDoanhSo;
      const luongOt = incomeBreakdown.luongOt;
      const banSanPham = incomeBreakdown.banSanPham;
      const phuMo = incomeBreakdown.phuMo;
      const trucCa = incomeBreakdown.trucCa;
      const thuNhapKhac = incomeBreakdown.thuNhapKhac;
      const thuong = incomeBreakdown.thuong;
      const tongLuongIII = luongNgayCongThucTe + luongDoanhSo + luongOt + banSanPham + phuMo + trucCa + thuNhapKhac;

      const savedAdjustments = employee ? (employee.salary_adjustments as Record<string, unknown> | undefined) : undefined;
      const savedConfig = savedAdjustments?.payroll_config as Record<string, unknown> | undefined;

      const savedParkingPolicyRaw = savedConfig?.parkingAllowancePolicy as Record<string, unknown> | undefined;
      const parkingPolicy: ParkingAllowancePolicy | null = savedParkingPolicyRaw
        ? {
            mode: savedParkingPolicyRaw.mode === 'daily' ? 'daily' : savedParkingPolicyRaw.mode === 'monthly' ? 'monthly' : 'none',
            daily_rate: toNumber(savedParkingPolicyRaw.daily_rate, 5000),
            monthly_rate: toNumber(savedParkingPolicyRaw.monthly_rate, 0),
          }
        : null;
      const phuCapGuiXe = parkingPolicy ? calculateParkingAllowance(parkingPolicy, record.ngay_cong) : (record.phu_cap_gui_xe ?? 0);

      const savedLunchPolicyRaw = (savedConfig?.lunchAllowancePolicy as Record<string, unknown> | undefined);
      const lunchPolicy: LunchAllowancePolicy | null = savedLunchPolicyRaw
        ? {
            mode: savedLunchPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'fixed',
            fixed_amount: toNumber(savedLunchPolicyRaw.fixed_amount),
            amount_per_work_day: toNumber(savedLunchPolicyRaw.amount_per_work_day),
            monthly_cap: toNumber(savedLunchPolicyRaw.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP),
          }
        : null;
      const phuCapAnTrua = toNumber(
        (record as unknown as Record<string, unknown>)['phu_cap_an_trua'],
        lunchPolicy ? calculateLunchAllowance(lunchPolicy, record.tong_cong ?? 0, stdDays) : 0,
      );

      const savedRespPolicyRaw = savedConfig?.responsibilityAllowancePolicy as Record<string, unknown> | undefined;
      const respPolicy: ResponsibilityAllowancePolicy | null = savedRespPolicyRaw
        ? {
            mode: savedRespPolicyRaw.mode === 'fixed' ? 'fixed' : savedRespPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'none',
            monthly_max: toNumber(savedRespPolicyRaw.monthly_max),
          }
        : null;
      const phuCapTrachNhiem = respPolicy ? calculateResponsibilityAllowance(respPolicy, record.tong_cong ?? 0, stdDays) : 0;
      const phuCapLivestream = toNumber((record as unknown as Record<string, number>)['phu_cap_livestream'], 0);

      const phuCapKhacFromRecord = (record as unknown as Record<string, number>)['phu_cap_khac'] ?? 0;
      const phuCapKhacRemainder = Math.max(
        phuCapKhacFromRecord,
        Math.max((record.phu_cap ?? 0) - phuCapGuiXe - phuCapAnTrua - phuCapTrachNhiem - phuCapLivestream, 0),
      );
      const tongPhuCapIV = phuCapGuiXe + phuCapAnTrua + phuCapTrachNhiem + phuCapLivestream + phuCapKhacRemainder;
      const tongThuNhapVI = tongLuongIII + tongPhuCapIV + thuong;

      const bhxh = payrollTax.socialInsurance;
      const bhyt = payrollTax.healthInsurance;
      const bhtn = payrollTax.unemploymentInsurance;
      const tongBH = payrollTax.insuranceTotal;
      const congDoan = toNumber((record as unknown as Record<string, number>)['cong_doan'],
        (savedConfig?.deductions as Record<string, number> | undefined)?.unionFee ?? 0);
      const tongPhat = record.tong_phat ?? 0;
      const tongPhatBienBan = record.tong_phat_bienban ?? 0;
      const tongGiamTruVII = tongBH + congDoan + tongPhat + tongPhatBienBan;
      const dieuChinhVIII = (record as unknown as Record<string, number>)['dieu_chinh'] ?? 0;
      const tamUng = record.tam_ung ?? 0;
      const thue = payrollTax.taxAmount;

      return {
        ma_nv: record.ma_nv,
        ho_va_ten: record.ho_va_ten,
        phong_ban: record.phong_ban ?? '',
        year: record.year,
        month: record.month,
        luong_co_ban: Math.round(luongCoBan),
        cong_chuan: stdDays,
        tong_cong: Math.round(record.tong_cong ?? 0),
        luong_ngay_cong: Math.round(luongNgayCongThucTe),
        luong_doanh_so: Math.round(luongDoanhSo),
        luong_ot: Math.round(luongOt),
        ban_san_pham: Math.round(banSanPham),
        phu_mo: Math.round(phuMo),
        truc_ca: Math.round(trucCa),
        thu_nhap_khac: Math.round(thuNhapKhac),
        tong_luong_iii: Math.round(tongLuongIII),
        phu_cap_gui_xe: Math.round(phuCapGuiXe),
        phu_cap_an_trua: Math.round(phuCapAnTrua),
        phu_cap_trach_nhiem: Math.round(phuCapTrachNhiem),
        phu_cap_livestream: Math.round(phuCapLivestream),
        phu_cap_khac: Math.round(phuCapKhacRemainder),
        tong_phu_cap_iv: Math.round(tongPhuCapIV),
        thuong: Math.round(thuong),
        tong_thu_nhap_vi: Math.round(tongThuNhapVI),
        bhxh: Math.round(bhxh),
        bhyt: Math.round(bhyt),
        bhtn: Math.round(bhtn),
        tong_bh: Math.round(tongBH),
        cong_doan: Math.round(congDoan),
        tong_phat: Math.round(tongPhat),
        tong_phat_bienban: Math.round(tongPhatBienBan),
        tong_giam_tru_vii: Math.round(tongGiamTruVII),
        dieu_chinh: Math.round(dieuChinhVIII),
        thue_tncn: Math.round(thue),
        tam_ung: Math.round(tamUng),
        luong_thuc_linh: Math.round(payslipComputation.luongThucLinh),
        con_phai_thanh_toan: Math.round(payslipComputation.conPhaiThanhToan),
      };
    });
  }, [salaryRecords, employees, salaryCommissions]);

  const handleExportPayrollExcel = async () => {
    if (!salaryRecords.length || exportingPayroll) return;

    setExportingPayroll(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Bang Luong Chi Tiet');

      ws.columns = [
        { header: 'Mã NV', key: 'ma_nv', width: 14 },
        { header: 'Họ và tên', key: 'ho_va_ten', width: 24 },
        { header: 'Phòng ban', key: 'phong_ban', width: 18 },
        { header: 'Năm', key: 'year', width: 8 },
        { header: 'Tháng', key: 'month', width: 8 },
        { header: 'Lương cơ bản', key: 'luong_co_ban', width: 16 },
        { header: 'Công chuẩn', key: 'cong_chuan', width: 12 },
        { header: 'Tổng công', key: 'tong_cong', width: 12 },
        { header: 'Lương ngày công thực tế', key: 'luong_ngay_cong', width: 20 },
        { header: 'Lương doanh số', key: 'luong_doanh_so', width: 16 },
        { header: 'Lương OT', key: 'luong_ot', width: 14 },
        { header: 'Bán sản phẩm', key: 'ban_san_pham', width: 14 },
        { header: 'Phụ mổ', key: 'phu_mo', width: 14 },
        { header: 'Trực ca', key: 'truc_ca', width: 14 },
        { header: 'Thu nhập khác', key: 'thu_nhap_khac', width: 14 },
        { header: 'Tổng khoản lương (III)', key: 'tong_luong_iii', width: 18 },
        { header: 'PC gửi xe', key: 'phu_cap_gui_xe', width: 14 },
        { header: 'PC ăn trưa', key: 'phu_cap_an_trua', width: 14 },
        { header: 'PC trách nhiệm', key: 'phu_cap_trach_nhiem', width: 16 },
        { header: 'PC livestream', key: 'phu_cap_livestream', width: 16 },
        { header: 'PC khác', key: 'phu_cap_khac', width: 14 },
        { header: 'Tổng phụ cấp (IV)', key: 'tong_phu_cap_iv', width: 16 },
        { header: 'Thưởng', key: 'thuong', width: 12 },
        { header: 'Tổng thu nhập (VI)', key: 'tong_thu_nhap_vi', width: 18 },
        { header: 'BHXH', key: 'bhxh', width: 12 },
        { header: 'BHYT', key: 'bhyt', width: 12 },
        { header: 'BHTN', key: 'bhtn', width: 12 },
        { header: 'Tổng BH', key: 'tong_bh', width: 12 },
        { header: 'Công đoàn', key: 'cong_doan', width: 12 },
        { header: 'Phạt đi muộn', key: 'tong_phat', width: 14 },
        { header: 'Phạt biên bản', key: 'tong_phat_bienban', width: 14 },
        { header: 'Tổng giảm trừ (VII)', key: 'tong_giam_tru_vii', width: 18 },
        { header: 'Điều chỉnh (VIII)', key: 'dieu_chinh', width: 16 },
        { header: 'Thuế TNCN (X)', key: 'thue_tncn', width: 14 },
        { header: 'Tạm ứng (XI)', key: 'tam_ung', width: 14 },
        { header: 'Lương thực lĩnh (IX)', key: 'luong_thuc_linh', width: 18 },
        { header: 'Còn phải thanh toán (XII)', key: 'con_phai_thanh_toan', width: 22 },
      ];

      ws.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      ws.getRow(1).height = 30;

      const totals = {
        luong_co_ban: 0,
        luong_ngay_cong: 0,
        luong_doanh_so: 0,
        luong_ot: 0,
        ban_san_pham: 0,
        phu_mo: 0,
        truc_ca: 0,
        thu_nhap_khac: 0,
        tong_luong_iii: 0,
        phu_cap_gui_xe: 0,
        phu_cap_an_trua: 0,
        phu_cap_trach_nhiem: 0,
        phu_cap_livestream: 0,
        phu_cap_khac: 0,
        tong_phu_cap_iv: 0,
        thuong: 0,
        tong_thu_nhap_vi: 0,
        bhxh: 0,
        bhyt: 0,
        bhtn: 0,
        tong_bh: 0,
        cong_doan: 0,
        tong_phat: 0,
        tong_phat_bienban: 0,
        tong_giam_tru_vii: 0,
        dieu_chinh: 0,
        thue_tncn: 0,
        tam_ung: 0,
        luong_thuc_linh: 0,
        con_phai_thanh_toan: 0,
      };

      salaryRecords.forEach((record) => {
        const employee = employees.find((e) => e.id === record.employee_id);
        const recordCommissions = salaryCommissions.filter((item) => item.employee === record.employee_id);
        const payslipComputation = calculatePayslipNetPayable(record, employee, recordCommissions);
        const payrollTax = payslipComputation.payrollTax;

        const stdDays = getStandardWorkDaysFromRecord(record);
        const workdayBreakdown = getWorkdaySalaryBreakdown(record, employee);
        const luongCoBan = record.luong_co_ban ?? 0;
        const luongNgayCongThucTe = workdayBreakdown.tongLuongNgayCong;
        const incomeBreakdown = getMonthlyInputIncomeBreakdown(record, recordCommissions);
        const luongDoanhSo = incomeBreakdown.luongDoanhSo;
        const luongOt = incomeBreakdown.luongOt;
        const banSanPham = incomeBreakdown.banSanPham;
        const phuMo = incomeBreakdown.phuMo;
        const trucCa = incomeBreakdown.trucCa;
        const thuNhapKhac = incomeBreakdown.thuNhapKhac;
        const thuong = incomeBreakdown.thuong;
        const tongLuongIII = luongNgayCongThucTe + luongDoanhSo + luongOt + banSanPham + phuMo + trucCa + thuNhapKhac;

        const savedAdjustments = employee ? (employee.salary_adjustments as Record<string, unknown> | undefined) : undefined;
        const savedConfig = savedAdjustments?.payroll_config as Record<string, unknown> | undefined;

        const savedParkingPolicyRaw = savedConfig?.parkingAllowancePolicy as Record<string, unknown> | undefined;
        const parkingPolicy: ParkingAllowancePolicy | null = savedParkingPolicyRaw
          ? {
              mode: savedParkingPolicyRaw.mode === 'daily' ? 'daily' : savedParkingPolicyRaw.mode === 'monthly' ? 'monthly' : 'none',
              daily_rate: toNumber(savedParkingPolicyRaw.daily_rate, 5000),
              monthly_rate: toNumber(savedParkingPolicyRaw.monthly_rate, 0),
            }
          : null;
        const phuCapGuiXe = parkingPolicy ? calculateParkingAllowance(parkingPolicy, record.ngay_cong) : (record.phu_cap_gui_xe ?? 0);

        const savedLunchPolicyRaw = (savedConfig?.lunchAllowancePolicy as Record<string, unknown> | undefined);
        const lunchPolicy: LunchAllowancePolicy | null = savedLunchPolicyRaw
          ? {
              mode: savedLunchPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'fixed',
              fixed_amount: toNumber(savedLunchPolicyRaw.fixed_amount),
              amount_per_work_day: toNumber(savedLunchPolicyRaw.amount_per_work_day),
              monthly_cap: toNumber(savedLunchPolicyRaw.monthly_cap, MAX_LUNCH_ALLOWANCE_CAP),
            }
          : null;
        const phuCapAnTrua = toNumber(
          (record as unknown as Record<string, unknown>)['phu_cap_an_trua'],
          lunchPolicy ? calculateLunchAllowance(lunchPolicy, record.tong_cong ?? 0, stdDays) : 0,
        );

        const savedRespPolicyRaw = savedConfig?.responsibilityAllowancePolicy as Record<string, unknown> | undefined;
        const respPolicy: ResponsibilityAllowancePolicy | null = savedRespPolicyRaw
          ? {
              mode: savedRespPolicyRaw.mode === 'fixed' ? 'fixed' : savedRespPolicyRaw.mode === 'actual_working_day' ? 'actual_working_day' : 'none',
              monthly_max: toNumber(savedRespPolicyRaw.monthly_max),
            }
          : null;
        const phuCapTrachNhiem = respPolicy ? calculateResponsibilityAllowance(respPolicy, record.tong_cong ?? 0, stdDays) : 0;
        const phuCapLivestream = toNumber((record as unknown as Record<string, number>)['phu_cap_livestream'], 0);

        const phuCapKhacFromRecord = (record as unknown as Record<string, number>)['phu_cap_khac'] ?? 0;
        const phuCapKhacRemainder = Math.max(
          phuCapKhacFromRecord,
          Math.max((record.phu_cap ?? 0) - phuCapGuiXe - phuCapAnTrua - phuCapTrachNhiem - phuCapLivestream, 0),
        );
        const tongPhuCapIV = phuCapGuiXe + phuCapAnTrua + phuCapTrachNhiem + phuCapLivestream + phuCapKhacRemainder;
        const tongThuNhapVI = tongLuongIII + tongPhuCapIV + thuong;

        const bhxh = payrollTax.socialInsurance;
        const bhyt = payrollTax.healthInsurance;
        const bhtn = payrollTax.unemploymentInsurance;
        const tongBH = payrollTax.insuranceTotal;
        const congDoan = toNumber((record as unknown as Record<string, number>)['cong_doan'],
          (savedConfig?.deductions as Record<string, number> | undefined)?.unionFee ?? 0);
        const tongPhat = record.tong_phat ?? 0;
        const tongPhatBienBan = record.tong_phat_bienban ?? 0;
        const tongGiamTruVII = tongBH + congDoan + tongPhat + tongPhatBienBan;
        const dieuChinhVIII = (record as unknown as Record<string, number>)['dieu_chinh'] ?? 0;
        const tamUng = record.tam_ung ?? 0;
        const thue = payrollTax.taxAmount;

        const rowData = {
          ma_nv: record.ma_nv,
          ho_va_ten: record.ho_va_ten,
          phong_ban: record.phong_ban ?? '',
          year: record.year,
          month: record.month,
          luong_co_ban: Math.round(luongCoBan),
          cong_chuan: stdDays,
          tong_cong: record.tong_cong ?? 0,
          luong_ngay_cong: Math.round(luongNgayCongThucTe),
          luong_doanh_so: Math.round(luongDoanhSo),
          luong_ot: Math.round(luongOt),
          ban_san_pham: Math.round(banSanPham),
          phu_mo: Math.round(phuMo),
          truc_ca: Math.round(trucCa),
          thu_nhap_khac: Math.round(thuNhapKhac),
          tong_luong_iii: Math.round(tongLuongIII),
          phu_cap_gui_xe: Math.round(phuCapGuiXe),
          phu_cap_an_trua: Math.round(phuCapAnTrua),
          phu_cap_trach_nhiem: Math.round(phuCapTrachNhiem),
          phu_cap_livestream: Math.round(phuCapLivestream),
          phu_cap_khac: Math.round(phuCapKhacRemainder),
          tong_phu_cap_iv: Math.round(tongPhuCapIV),
          thuong: Math.round(thuong),
          tong_thu_nhap_vi: Math.round(tongThuNhapVI),
          bhxh: Math.round(bhxh),
          bhyt: Math.round(bhyt),
          bhtn: Math.round(bhtn),
          tong_bh: Math.round(tongBH),
          cong_doan: Math.round(congDoan),
          tong_phat: Math.round(tongPhat),
          tong_phat_bienban: Math.round(tongPhatBienBan),
          tong_giam_tru_vii: Math.round(tongGiamTruVII),
          dieu_chinh: Math.round(dieuChinhVIII),
          thue_tncn: Math.round(thue),
          tam_ung: Math.round(tamUng),
          luong_thuc_linh: Math.round(payslipComputation.luongThucLinh),
          con_phai_thanh_toan: Math.round(payslipComputation.conPhaiThanhToan),
        };

        ws.addRow(rowData);

        totals.luong_co_ban += rowData.luong_co_ban;
        totals.luong_ngay_cong += rowData.luong_ngay_cong;
        totals.luong_doanh_so += rowData.luong_doanh_so;
        totals.luong_ot += rowData.luong_ot;
        totals.ban_san_pham += rowData.ban_san_pham;
        totals.phu_mo += rowData.phu_mo;
        totals.truc_ca += rowData.truc_ca;
        totals.thu_nhap_khac += rowData.thu_nhap_khac;
        totals.tong_luong_iii += rowData.tong_luong_iii;
        totals.phu_cap_gui_xe += rowData.phu_cap_gui_xe;
        totals.phu_cap_an_trua += rowData.phu_cap_an_trua;
        totals.phu_cap_trach_nhiem += rowData.phu_cap_trach_nhiem;
        totals.phu_cap_livestream += rowData.phu_cap_livestream;
        totals.phu_cap_khac += rowData.phu_cap_khac;
        totals.tong_phu_cap_iv += rowData.tong_phu_cap_iv;
        totals.thuong += rowData.thuong;
        totals.tong_thu_nhap_vi += rowData.tong_thu_nhap_vi;
        totals.bhxh += rowData.bhxh;
        totals.bhyt += rowData.bhyt;
        totals.bhtn += rowData.bhtn;
        totals.tong_bh += rowData.tong_bh;
        totals.cong_doan += rowData.cong_doan;
        totals.tong_phat += rowData.tong_phat;
        totals.tong_phat_bienban += rowData.tong_phat_bienban;
        totals.tong_giam_tru_vii += rowData.tong_giam_tru_vii;
        totals.dieu_chinh += rowData.dieu_chinh;
        totals.thue_tncn += rowData.thue_tncn;
        totals.tam_ung += rowData.tam_ung;
        totals.luong_thuc_linh += rowData.luong_thuc_linh;
        totals.con_phai_thanh_toan += rowData.con_phai_thanh_toan;
      });

      const totalRow = ws.addRow({
        ma_nv: 'TỔNG CỘNG',
        ho_va_ten: `Số nhân viên: ${salaryRecords.length}`,
        luong_co_ban: totals.luong_co_ban,
        luong_ngay_cong: totals.luong_ngay_cong,
        luong_doanh_so: totals.luong_doanh_so,
        luong_ot: totals.luong_ot,
        ban_san_pham: totals.ban_san_pham,
        phu_mo: totals.phu_mo,
        truc_ca: totals.truc_ca,
        thu_nhap_khac: totals.thu_nhap_khac,
        tong_luong_iii: totals.tong_luong_iii,
        phu_cap_gui_xe: totals.phu_cap_gui_xe,
        phu_cap_an_trua: totals.phu_cap_an_trua,
        phu_cap_trach_nhiem: totals.phu_cap_trach_nhiem,
        phu_cap_livestream: totals.phu_cap_livestream,
        phu_cap_khac: totals.phu_cap_khac,
        tong_phu_cap_iv: totals.tong_phu_cap_iv,
        thuong: totals.thuong,
        tong_thu_nhap_vi: totals.tong_thu_nhap_vi,
        bhxh: totals.bhxh,
        bhyt: totals.bhyt,
        bhtn: totals.bhtn,
        tong_bh: totals.tong_bh,
        cong_doan: totals.cong_doan,
        tong_phat: totals.tong_phat,
        tong_phat_bienban: totals.tong_phat_bienban,
        tong_giam_tru_vii: totals.tong_giam_tru_vii,
        dieu_chinh: totals.dieu_chinh,
        thue_tncn: totals.thue_tncn,
        tam_ung: totals.tam_ung,
        luong_thuc_linh: totals.luong_thuc_linh,
        con_phai_thanh_toan: totals.con_phai_thanh_toan,
      });

      totalRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      });

      const monthText = String(selectedMonth).padStart(2, '0');
      const fileName = `bang_luong_chi_tiet_${selectedYear}_${monthText}.xlsx`;
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setSalaryError('Không thể xuất file Excel bảng lương. Vui lòng thử lại.');
    } finally {
      setExportingPayroll(false);
    }
  };

  const handleCloseImportDialog = () => {
    setShowImportDialog(false);
    setScParsedRows(null); setScFile(null); setScParseError(null);
    setScImportMsg({ ok: null, err: null, errors: [], failedRows: [] });
    if (scFileRef.current) scFileRef.current.value = '';
  };

  const loadEmployees = useCallback(
    async (page = 1) => {
      setLoadingEmployees(true);
      try {
        const params: Record<string, unknown> = {
          page,
          page_size: PAGE_SIZE,
          ordering: 'full_name',
        };
        if (searchEmployee) params.search = searchEmployee;
        if (deptFilterConfig) params.department = parseInt(deptFilterConfig, 10);

        const res = await employeesAPI.list(params);
        setEmployees(res.results);
        setConfigTotal(res.count);
        setConfigPage(page);
      } catch {
        setEmployees([]);
      } finally {
        setLoadingEmployees(false);
      }
    },
    [searchEmployee, deptFilterConfig]
  );

  useEffect(() => {
    if (activeTab === 'config') {
      loadEmployees(1);
    }
  }, [activeTab, loadEmployees]);

  const loadSalary = useCallback(async () => {
    setLoadingSalary(true);
    setSalaryError(null);
    setDeptPayslipEmailResult(null);
    setDeptPayslipBatch(null);
    setDeptPayslipBatchId(null);
    setPollingBatch(false);
    setDeptRecipientsPreview(null);
    setDeptRecipientsPreviewError(null);
    setEmailStatusFromQueueMap({});
    try {
      const [salaryRes, commissionRes, monthlyInputRes, emailStatusRes] = await Promise.allSettled([
        salaryService.getSalaryByDepartment({
          year: selectedYear,
          month: selectedMonth,
          department_id: deptFilterView ? parseInt(deptFilterView, 10) : undefined,
          legal_entity: legalEntityFilterView || undefined,
          employment_filter: employmentFilterView || undefined,
        }),
        salaryService.listCommissions({ year: selectedYear, month: selectedMonth }),
        salaryService.listMonthlyInputs({ year: selectedYear, month: selectedMonth }),
        salaryService.getDepartmentPayslipEmailStatuses({
          year: selectedYear,
          month: selectedMonth,
          department_id: deptFilterView ? parseInt(deptFilterView, 10) : undefined,
          legal_entity: legalEntityFilterView || undefined,
        }),
      ]);

      if (salaryRes.status !== 'fulfilled') throw salaryRes.reason;

      const res = salaryRes.value;

      const monthlyInputs = monthlyInputRes.status === 'fulfilled' ? monthlyInputRes.value : [];
      const monthlyInputMap = new Map<number, MonthlySalaryInputRecord>();
      monthlyInputs.forEach((item) => {
        monthlyInputMap.set(item.employee, item);
      });

      const mergedResults = (res.results ?? []).map((record) => {
        const monthlyInput = monthlyInputMap.get(record.employee_id);
        if (!monthlyInput) return record;
        return {
          ...record,
          luong_doanh_so_input: monthlyInput.luong_doanh_so,
          luong_ot_input: monthlyInput.luong_ot,
          ban_san_pham_input: monthlyInput.ban_san_pham,
          phu_mo_input: monthlyInput.phu_mo,
          truc_ca_input: monthlyInput.truc_ca,
          thuong_input: monthlyInput.thuong,
        } as SalaryRecord;
      });

      setSalaryRecords(mergedResults);
      setLeftPayable({ count: res.left_payable_count ?? 0, amount: res.left_payable_amount ?? 0 });
      setSalaryCommissions(commissionRes.status === 'fulfilled' ? commissionRes.value : []);

      if (emailStatusRes.status === 'fulfilled') {
        const nextMap: Record<number, 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED'> = {};
        (emailStatusRes.value.statuses ?? []).forEach((item) => {
          if (item.status) {
            nextMap[item.employee_id] = item.status;
          }
        });
        setEmailStatusFromQueueMap(nextMap);
      }

      setSalaryPage(1);
    } catch (error: unknown) {
      const normalizedError = error as { response?: { status?: number } };
      if (normalizedError?.response?.status === 404) {
        setSalaryError('Chưa có dữ liệu bảng lương cho tháng này.');
      } else {
        setSalaryError('Không thể tải dữ liệu bảng lương. Vui lòng thử lại.');
      }
      setSalaryRecords([]);
      setSalaryCommissions([]);
      setEmailStatusFromQueueMap({});
    } finally {
      setLoadingSalary(false);
    }
  }, [selectedYear, selectedMonth, deptFilterView, legalEntityFilterView, employmentFilterView]);

  useEffect(() => {
    setSalaryPage(1);
  }, [searchSalary]);

  useEffect(() => {
    if (activeTab === 'view') {
      loadSalary();
    }
  }, [activeTab, loadSalary]);

  const handleSave = async (id: number, data: SalaryFormulaUpdateData) => {
    setSaving(true);
    setSaveError(null);
    const employeeName = editEmployee?.full_name ?? 'nhân viên';
    try {
      await salaryService.updateSalaryFormula(id, data);
      setSaveSuccess(`Đã cập nhật cấu hình lương cho ${employeeName}`);
      setEditEmployee(null);
      loadEmployees(configPage);
    } catch {
      setSaveError('Không thể cập nhật. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  // ── Tính toán tổng lương từ chính dữ liệu export (đảm bảo khớp Excel) ──
  const loadTotalSalary = useCallback(async () => {
    setLoadingTotalSalary(true);
    setTotalSalaryError(null);
    setTotalSalaryData(null);
    try {
      const totalLuongThucLinh = payrollDetailRows.reduce((sum, row) => sum + (row.luong_thuc_linh ?? 0), 0);
      const totalConPhaiThanhToan = payrollDetailRows.reduce((sum, row) => sum + (row.con_phai_thanh_toan ?? 0), 0);
      const totalThueTncn = payrollDetailRows.reduce((sum, row) => sum + (row.thue_tncn ?? 0), 0);

      setTotalSalaryData({
        year: selectedYear,
        month: selectedMonth,
        department_id: deptFilterView ? parseInt(deptFilterView, 10) : null,
        legal_entity: legalEntityFilterView || null,
        total_luong_thuc_linh: Math.round(totalLuongThucLinh),
        total_con_phai_thanh_toan: Math.round(totalConPhaiThanhToan),
        total_thue_tncn: Math.round(totalThueTncn),
        total_net_salary: Math.round(totalConPhaiThanhToan),
        employee_count: payrollDetailRows.length,
      });
    } catch {
      setTotalSalaryError('Không thể tải dữ liệu tổng lương. Vui lòng thử lại.');
    } finally {
      setLoadingTotalSalary(false);
    }
  }, [selectedYear, selectedMonth, deptFilterView, legalEntityFilterView, payrollDetailRows]);

  const openTotalSalaryModal = async (scope: 'company' | 'legal_entity') => {
    _closeActiveTaxTooltip?.();
    setTotalSalaryScope(scope);
    setTotalSalaryData(null);
    setTotalSalaryError(null);
    await loadTotalSalary();
    setShowTotalSalaryModal(true);
  };

  const handleSendCompanyPayslips = () => {
    setCompanyPayslipEmailResult(null);
    setCompanyPayslipBatch(null);
    setCompanyPayslipBatchId(null);
    setCompanyRecipientsPreview(null);
    setCompanyRecipientsPreviewError(null);
    setSelectedCompanyRecipientPreview(null);
    setShowCompanyPayslipConfirm(true);
    setLoadingCompanyRecipientsPreview(true);
    salaryService.getCompanyPayslipRecipients({
      year: selectedYear,
      month: selectedMonth,
      ...(legalEntityFilterView ? { legal_entity: legalEntityFilterView } : {}),
    })
      .then((preview) => setCompanyRecipientsPreview(preview))
      .catch((error: unknown) => {
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setCompanyRecipientsPreviewError(detail ?? 'Không thể tải danh sách email người nhận để xác nhận.');
      })
      .finally(() => setLoadingCompanyRecipientsPreview(false));
  };

  const handleConfirmSendCompanyPayslips = async () => {
    setShowCompanyPayslipConfirm(false);
    setSendingCompanyPayslipEmail(true);
    setCompanyPayslipEmailResult(null);
    setCompanyPayslipBatch(null);
    try {
      const response = await salaryService.sendCompanyPayslipEmails({
        year: selectedYear,
        month: selectedMonth,
        ...(legalEntityFilterView ? { legal_entity: legalEntityFilterView } : {}),
      });
      setCompanyPayslipBatchId(response.batch_id);
      setCompanyPayslipEmailResult({
        ok: true,
        msg: `Đã xếp hàng ${response.queued}/${response.total} email. Thiếu email: ${response.skipped_no_email}. Email sẽ được gửi trong vài phút.`,
      });
      setPollingCompanyBatch(true);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCompanyPayslipEmailResult({ ok: false, msg: detail ?? 'Không thể tạo hàng đợi gửi email bảng lương.' });
    } finally {
      setSendingCompanyPayslipEmail(false);
    }
  };

  const handleSendDepartmentPayslips = () => {
    if (!deptFilterView) {
      setDeptPayslipEmailResult({ ok: false, msg: 'Vui lòng chọn phòng ban trước khi gửi email bảng lương.' });
      return;
    }
    setDeptPayslipEmailResult(null);
    setDeptPayslipBatch(null);
    setDeptPayslipBatchId(null);
    setDeptRecipientsPreview(null);
    setDeptRecipientsPreviewError(null);
    setSelectedRecipientPreview(null);
    const departmentId = parseInt(deptFilterView, 10);

    setShowDeptPayslipConfirm(true);
    setLoadingRecipientsPreview(true);
    salaryService.getDepartmentPayslipRecipients({
      year: selectedYear,
      month: selectedMonth,
      department_id: departmentId,
    })
      .then((preview) => setDeptRecipientsPreview(preview))
      .catch((error: unknown) => {
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setDeptRecipientsPreviewError(detail ?? 'Không thể tải danh sách email người nhận để xác nhận.');
      })
      .finally(() => setLoadingRecipientsPreview(false));
  };

  const handleConfirmSendDeptPayslips = async () => {
    setShowDeptPayslipConfirm(false);
    const departmentId = parseInt(deptFilterView, 10);
    setSendingDeptPayslipEmail(true);
    setDeptPayslipEmailResult(null);
    setDeptPayslipBatch(null);
    try {
      const response = await salaryService.sendDepartmentPayslipEmails({
        year: selectedYear,
        month: selectedMonth,
        department_id: departmentId,
      });
      setDeptPayslipBatchId(response.batch_id);
      setDeptPayslipEmailResult({
        ok: true,
        msg: `Đã xếp hàng ${response.queued}/${response.total} email. Thiếu email: ${response.skipped_no_email}. Email sẽ được gửi trong vài phút.`,
      });
      // Start polling batch status
      setPollingBatch(true);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setDeptPayslipEmailResult({ ok: false, msg: detail ?? 'Không thể tạo hàng đợi gửi email bảng lương.' });
    } finally {
      setSendingDeptPayslipEmail(false);
    }
  };

  // Poll batch status every 15 seconds
  React.useEffect(() => {
    if (!pollingBatch || !deptPayslipBatchId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const batch = await salaryService.getPayslipEmailBatchStatus(deptPayslipBatchId);
        if (!cancelled) {
          setDeptPayslipBatch(batch);
          if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
            setPollingBatch(false);
          }
        }
      } catch {
        // silently ignore polling errors
      }
    };
    poll();
    const timer = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pollingBatch, deptPayslipBatchId]);

  // Poll company batch status every 15 seconds
  React.useEffect(() => {
    if (!pollingCompanyBatch || !companyPayslipBatchId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const batch = await salaryService.getPayslipEmailBatchStatus(companyPayslipBatchId);
        if (!cancelled) {
          setCompanyPayslipBatch(batch);
          if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
            setPollingCompanyBatch(false);
          }
        }
      } catch {
        // silently ignore polling errors
      }
    };
    poll();
    const timer = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pollingCompanyBatch, companyPayslipBatchId]);

  const previewRecipients = deptRecipientsPreview?.recipients ?? [];
  const previewRecipientsWithEmail = previewRecipients.filter((item) => item.has_email);
  const companyPreviewRecipients = companyRecipientsPreview?.recipients ?? [];
  const companyPreviewRecipientsWithEmail = companyPreviewRecipients.filter((item) => item.has_email);
  const payslipEmailStatusMap = useMemo(() => {
    const map = new Map<number, 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED'>();
    if (!deptPayslipBatch?.emails) return map;
    deptPayslipBatch.emails.forEach((item) => {
      map.set(item.employee_id, item.status);
    });
    return map;
  }, [deptPayslipBatch]);

  const getPayslipEmailStatusView = (employeeId: number) => {
    const status = payslipEmailStatusMap.get(employeeId) ?? emailStatusFromQueueMap[employeeId];
    if (status === 'SENT') return { label: 'Đã gửi', className: 'bg-green-100 text-green-700' };
    if (status === 'FAILED') return { label: 'Lỗi gửi', className: 'bg-red-100 text-red-700' };
    if (status === 'PROCESSING') return { label: 'Đang gửi', className: 'bg-blue-100 text-blue-700' };
    if (status === 'PENDING') return { label: 'Chờ gửi', className: 'bg-amber-100 text-amber-700' };
    return { label: 'Chưa gửi', className: 'bg-gray-100 text-gray-600' };
  };

  const handleOpenConfig = async (employee: Employee) => {
    setSaveError(null);
    setLoadingEmployeeConfig(employee.id);
    try {
      const freshEmployee = await salaryService.getEmployeeSalaryConfig(employee.id);
      setEditEmployee(freshEmployee);
    } catch {
      setEditEmployee(employee);
    } finally {
      setLoadingEmployeeConfig(null);
    }
  };

  const totalConfigPages = Math.ceil(configTotal / PAGE_SIZE);
  const normalizeStr = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filteredSalaryRecords = searchSalary
    ? salaryRecords.filter((r) => {
        const q = normalizeStr(searchSalary);
        return normalizeStr(r.ma_nv ?? '').includes(q) || normalizeStr(r.ho_va_ten ?? '').includes(q);
      })
    : salaryRecords;
  const totalSalaryPages = Math.ceil(filteredSalaryRecords.length / SALARY_PAGE_SIZE);
  const pagedSalaryRecords = filteredSalaryRecords.slice((salaryPage - 1) * SALARY_PAGE_SIZE, salaryPage * SALARY_PAGE_SIZE);
  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  const title = activeTab === 'view' ? 'Bảng lương' : 'Cấu hình tính lương cho từng người';
  const description =
    activeTab === 'view'
      ? 'Theo dõi bảng lương theo tháng/năm và phòng ban.'
      : 'Thiết kế theo cơ chế event có ngày hiệu lực và nhóm cấu hình đầy đủ cho từng nhân viên.';

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-gray-900 mt-0.5 text-sm">{description}</p>
      </div>

      {!lockTab && (
        <div className="flex border-b border-gray-200">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as SalaryTabKey)}
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
      )}

      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          <CheckIcon className="h-4 w-4 flex-shrink-0" />
          {saveSuccess}
          <button className="ml-auto" onClick={() => setSaveSuccess(null)}>
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {saveError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
          {saveError}
          <button className="ml-auto" onClick={() => setSaveError(null)}>
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div>
        {activeTab === 'config' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <div className="flex-1 relative min-w-48">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên hoặc mã nhân viên..."
                    value={searchEmployee}
                    onChange={(event) => setSearchEmployee(event.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <FunnelIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <SelectBox
                    label=""
                    value={deptFilterConfig}
                    options={[
                      { value: '', label: 'Tất cả phòng ban' },
                      ...departments.map((d) => ({ value: String(d.id), label: d.name })),
                    ]}
                    onChange={(value) => setDeptFilterConfig(value)}
                  />
                </div>
                <button
                  onClick={() => { setShowImportDialog(true); setScImportMsg({ ok: null, err: null, errors: [], failedRows: [] }); }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors whitespace-nowrap"
                >
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  Nhập cấu hình lương
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {loadingEmployees ? (
                <div className="flex items-center justify-center py-16">
                  <ArrowPathIcon className="h-6 w-6 text-primary-400 animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">Đang tải...</span>
                </div>
              ) : employees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <UserIcon className="h-10 w-10 mb-2" />
                  <p className="text-sm">Không tìm thấy nhân viên nào.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Nhân viên
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Hồ sơ nền tảng
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Ngày hiệu lực
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Gross preview
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Net preview
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Thao tác
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {employees.map((employee) => {
                        const employeeConfig = parseEmployeeSalaryConfig(employee);
                        const output = calculatePayrollOutput(employeeConfig, employee);

                        return (
                          <tr key={employee.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-semibold text-gray-700">
                                    {employee.full_name?.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{employee.full_name}</p>
                                  <p className="text-xs text-gray-500 font-mono">{employee.employee_id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-sm text-gray-700 flex items-center gap-1">
                                <BuildingOfficeIcon className="h-3.5 w-3.5 text-gray-400" />
                                {employeeConfig.baseProfile.department || employee.department?.name || '—'}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {employeeConfig.baseProfile.jobTitle || employee.position?.title || '—'}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">{employeeConfig.effectiveDate || '—'}</td>
                            <td className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                              {formatCurrency(output.grossIncome)}
                            </td>
                            <td className="px-4 py-3 text-right text-sm font-semibold text-indigo-700">
                              {formatCurrency(output.netSalary)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => handleOpenConfig(employee)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                              >
                                {loadingEmployeeConfig === employee.id ? (
                                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <PencilIcon className="h-3.5 w-3.5" />
                                )}
                                {loadingEmployeeConfig === employee.id ? 'Đang tải...' : 'Cấu hình'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {totalConfigPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                  <p className="text-sm text-gray-500">
                    Trang {configPage} / {totalConfigPages} · {configTotal} nhân viên
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadEmployees(configPage - 1)}
                      disabled={configPage === 1}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
                    >
                      Trước
                    </button>
                    <button
                      onClick={() => loadEmployees(configPage + 1)}
                      disabled={configPage === totalConfigPages}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
                    >
                      Sau
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'view' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Tháng:</label>
                  <div className="w-32">
                    <SelectBox<number>
                      label=""
                      value={selectedMonth}
                      options={monthOptions.map((month) => ({ value: month, label: `Tháng ${month}` }))}
                      onChange={setSelectedMonth}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Năm:</label>
                  <div className="w-24">
                    <SelectBox<number>
                      label=""
                      value={selectedYear}
                      options={yearOptions.map((year) => ({ value: year, label: String(year) }))}
                      onChange={setSelectedYear}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <FunnelIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div className="w-48">
                    <SelectBox<string>
                      label=""
                      value={deptFilterView}
                      options={[
                        { value: '', label: 'Tất cả phòng ban' },
                        ...departments.map((department) => ({
                          value: String(department.id),
                          label: department.name,
                        })),
                      ]}
                      onChange={setDeptFilterView}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <FunnelIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div className="w-56">
                    <SelectBox<string>
                      label=""
                      value={legalEntityFilterView}
                      options={[
                        { value: '', label: 'Tất cả pháp nhân' },
                        ...legalEntities.map((entity) => ({
                          value: entity.value,
                          label: entity.label,
                        })),
                      ]}
                      onChange={setLegalEntityFilterView}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <FunnelIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <div className="w-44">
                    <SelectBox<string>
                      label=""
                      value={employmentFilterView}
                      options={[
                        { value: '', label: 'Tất cả nhân sự' },
                        { value: 'working', label: 'Đang làm việc' },
                        { value: 'left', label: 'Đã nghỉ' },
                      ]}
                      onChange={(v) => setEmploymentFilterView(v as '' | 'working' | 'left')}
                    />
                  </div>
                </div>
                <div className="flex-1 relative min-w-48">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên hoặc mã nhân viên..."
                    value={searchSalary}
                    onChange={(event) => setSearchSalary(event.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <button
                  onClick={loadSalary}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  Tải dữ liệu
                </button>
                <button
                  onClick={() => openTotalSalaryModal('company')}
                  disabled={salaryRecords.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <CurrencyDollarIcon className="h-4 w-4" />
                  Tổng lương công ty
                </button>
                <button
                  onClick={() => openTotalSalaryModal('legal_entity')}
                  disabled={salaryRecords.length === 0 || !legalEntityFilterView}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <CurrencyDollarIcon className="h-4 w-4" />
                  Tổng lương pháp nhân
                </button>
                <button
                  onClick={handleExportPayrollExcel}
                  disabled={salaryRecords.length === 0 || exportingPayroll || loadingSalary}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {exportingPayroll ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownTrayIcon className="h-4 w-4" />
                  )}
                  {exportingPayroll ? 'Đang xuất Excel...' : 'Xuất Excel bảng lương'}
                </button>
                <button
                  onClick={() => { _closeActiveTaxTooltip?.(); setShowPayrollPreviewModal(true); }}
                  disabled={salaryRecords.length === 0 || loadingSalary}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <EyeIcon className="h-4 w-4" />
                  Xem trước
                </button>
              </div>

              {/* Người đã nghỉ giữa tháng vẫn còn lương phải trả cho những ngày đã làm.
                  Cảnh báo để HR không vô tình ẩn mất khoản phải thanh toán. */}
              {employmentFilterView === 'working' && leftPayable.count > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <ExclamationCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium">
                      Đang ẩn {leftPayable.count} người đã nghỉ nhưng vẫn còn phải thanh toán{' '}
                      {formatCurrency(leftPayable.amount)}
                    </span>
                    <div className="mt-1 text-amber-700">
                      Họ đã đi làm một phần tháng này nên vẫn có lương. Chọn{' '}
                      <button
                        type="button"
                        onClick={() => setEmploymentFilterView('left')}
                        className="underline underline-offset-2 font-medium"
                      >
                        Đã nghỉ
                      </button>{' '}
                      để xem, hoặc{' '}
                      <button
                        type="button"
                        onClick={() => setEmploymentFilterView('')}
                        className="underline underline-offset-2 font-medium"
                      >
                        Tất cả nhân sự
                      </button>{' '}
                      trước khi xuất bảng lương hoặc gửi phiếu lương.
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {loadingSalary ? (
                <div className="flex items-center justify-center py-16">
                  <ArrowPathIcon className="h-6 w-6 text-primary-400 animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">Đang tải bảng lương...</span>
                </div>
              ) : salaryError ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <ExclamationCircleIcon className="h-10 w-10 mb-2 text-amber-400" />
                  <p className="text-sm text-gray-500">{salaryError}</p>
                </div>
              ) : salaryRecords.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <TableCellsIcon className="h-10 w-10 mb-2" />
                  <p className="text-sm">Không có dữ liệu bảng lương.</p>
                  <p className="text-xs mt-1">Chọn tháng/năm và nhấn &quot;Tải dữ liệu&quot; để xem.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
                          Nhân viên
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Phòng ban
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Lương CB
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Phụ cấp
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          PC ăn trưa
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          PC livestream
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Tổng công
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Lương OT
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Tổng phạt
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-red-600 uppercase tracking-wider bg-red-50">
                          Thuế TNCN
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-900 uppercase tracking-wider bg-indigo-50">
                          Thực lĩnh
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Trạng thái email
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Chi tiết
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {pagedSalaryRecords.map((record) => {
                        const employee = employees.find((e) => e.id === record.employee_id);
                        const recordCommissions = salaryCommissions.filter((item) => item.employee === record.employee_id);
                        const incomeBreakdown = getMonthlyInputIncomeBreakdown(record, recordCommissions);
                        const payslipComputation = calculatePayslipNetPayable(record, employee, recordCommissions);
                        const recordTaxComputation = payslipComputation.payrollTax;
                        const recordTax = recordTaxComputation.taxAmount;
                        const recordNetPayable = payslipComputation.conPhaiThanhToan;

                        return (
                        <tr key={record.employee_id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 sticky left-0 bg-white">
                            <p className="font-medium text-gray-900">{record.ho_va_ten}</p>
                            <p className="text-xs text-gray-500 font-mono">{record.ma_nv}</p>
                          </td>
                          <td className="px-3 py-3 text-gray-600">{record.phong_ban ?? '—'}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{formatCurrency(record.luong_co_ban)}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{formatCurrency(record.phu_cap)}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{formatCurrency((record as unknown as Record<string, number>)['phu_cap_an_trua'] ?? 0)}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{formatCurrency((record as unknown as Record<string, number>)['phu_cap_livestream'] ?? 0)}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{formatNumber(record.tong_cong)}</td>
                          <td className="px-3 py-3 text-right text-blue-600">{formatCurrency(incomeBreakdown.luongOt)}</td>
                          <td className="px-3 py-3 text-right text-red-600">{formatCurrency((record.tong_phat ?? 0) + (record.tong_phat_bienban ?? 0))}</td>
                          <td className="px-3 py-3 font-semibold text-red-700 bg-red-50">
                            <div className="flex items-center justify-end gap-1.5">
                              {formatCurrency(recordTax)}
                              <TaxTooltip taxDetail={recordTaxComputation.taxDetail} />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-indigo-700 bg-indigo-50">
                            {formatCurrency(recordNetPayable)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {(() => {
                              const statusView = getPayslipEmailStatusView(record.employee_id);
                              return (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusView.className}`}>
                                  {statusView.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={async () => {
                                _closeActiveTaxTooltip?.();
                                setPayslipRecord(record);
                                setPayslipCommissions(salaryCommissions.filter((item) => item.employee === record.employee_id));
                                setPayslipPenalties([]);

                                // Lấy thông tin nhân viên đầy đủ (có personal_email) nếu chưa có trong danh sách hiện tại
                                let resolvedEmployee = employee ?? null;
                                if (!resolvedEmployee) {
                                  try {
                                    resolvedEmployee = await salaryService.getEmployeeSalaryConfig(record.employee_id);
                                  } catch {
                                    resolvedEmployee = null;
                                  }
                                }
                                setPayslipEmployee(resolvedEmployee);

                                try {
                                  const allPenalties = await salaryService.listPenalties({ year: record.year, month: record.month, status: 'APPROVED' });
                                  setPayslipPenalties(
                                    allPenalties.filter((p) => p.employee === record.employee_id)
                                  );
                                } catch {
                                  setPayslipPenalties([]);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 hover:text-indigo-800 transition-colors"
                              title="Xem phiếu lương chi tiết"
                            >
                              <EyeIcon className="h-3.5 w-3.5" />
                              Xem
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!loadingSalary && !salaryError && salaryRecords.length > 0 && (
                <div className="flex flex-col gap-2 px-4 py-3 border-t border-gray-200">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <p className="text-sm text-gray-500">
                      Trang {salaryPage} / {totalSalaryPages} · {filteredSalaryRecords.length} nhân viên
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {totalSalaryPages > 1 && (
                        <>
                          <button
                            onClick={() => setSalaryPage((p) => p - 1)}
                            disabled={salaryPage === 1}
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
                          >
                            Trước
                          </button>
                          <button
                            onClick={() => setSalaryPage((p) => p + 1)}
                            disabled={salaryPage === totalSalaryPages}
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
                          >
                            Sau
                          </button>
                        </>
                      )}
                      <button
                        onClick={handleSendDepartmentPayslips}
                        disabled={sendingDeptPayslipEmail || !deptFilterView}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title={deptFilterView ? 'Gửi email phiếu lương cho toàn bộ phòng ban đã chọn' : 'Vui lòng chọn phòng ban trước'}
                      >
                        {sendingDeptPayslipEmail ? (
                          <ArrowPathIcon className="h-4 w-4 animate-spin" />
                        ) : (
                          <EnvelopeIcon className="h-4 w-4" />
                        )}
                        {sendingDeptPayslipEmail ? 'Đang xếp hàng...' : 'Gửi email phòng ban'}
                      </button>
                      <button
                        onClick={handleSendCompanyPayslips}
                        disabled={sendingCompanyPayslipEmail}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Gửi email phiếu lương cho toàn bộ nhân sự công ty"
                      >
                        {sendingCompanyPayslipEmail ? (
                          <ArrowPathIcon className="h-4 w-4 animate-spin" />
                        ) : (
                          <EnvelopeIcon className="h-4 w-4" />
                        )}
                        {sendingCompanyPayslipEmail ? 'Đang xếp hàng...' : 'Gửi email toàn công ty'}
                      </button>
                    </div>
                  </div>

                  {/* Result banner */}
                  {deptPayslipEmailResult && (
                    <p className={`text-sm ${deptPayslipEmailResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                      {deptPayslipEmailResult.msg}
                    </p>
                  )}

                  {/* Company result banner */}
                  {companyPayslipEmailResult && (
                    <p className={`text-sm ${companyPayslipEmailResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                      {companyPayslipEmailResult.msg}
                    </p>
                  )}

                  {/* Batch status report */}
                  {deptPayslipBatch && (
                    <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                      {/* Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-700">Báo cáo gửi email phiếu lương</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            deptPayslipBatch.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                            deptPayslipBatch.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {pollingBatch && <ArrowPathIcon className="h-3 w-3 animate-spin" />}
                            {deptPayslipBatch.status === 'COMPLETED' ? 'Hoàn thành' :
                             deptPayslipBatch.status === 'FAILED' ? 'Thất bại' :
                             deptPayslipBatch.status === 'PROCESSING' ? 'Đang gửi' : 'Chờ gửi'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span className="text-green-600 font-medium">✓ {deptPayslipBatch.sent} đã gửi</span>
                          <span className="text-yellow-600 font-medium">⏳ {deptPayslipBatch.pending} chờ</span>
                          {deptPayslipBatch.failed > 0 && <span className="text-red-600 font-medium">✗ {deptPayslipBatch.failed} lỗi</span>}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1.5 bg-gray-100">
                        <div
                          className="h-full bg-green-500 transition-all duration-500"
                          style={{ width: `${deptPayslipBatch.progress_pct}%` }}
                        />
                      </div>

                      {/* Per-email table */}
                      <div className="max-h-60 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-gray-50">
                            <tr>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Nhân viên</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Email</th>
                              <th className="text-center px-3 py-2 text-gray-500 font-medium">Trạng thái</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Thời gian</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {deptPayslipBatch.emails.map((item) => (
                              <tr key={item.employee_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                  <div className="font-medium text-gray-800">{item.employee_name}</div>
                                  <div className="text-gray-400">{item.employee_code}</div>
                                </td>
                                <td className="px-3 py-2 text-gray-600">{item.email}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                    item.status === 'SENT' ? 'bg-green-100 text-green-700' :
                                    item.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                                    item.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    {item.status === 'SENT' ? '✓ Đã gửi' :
                                     item.status === 'FAILED' ? '✗ Lỗi' :
                                     item.status === 'PROCESSING' ? '↻ Đang gửi' : '⏳ Chờ'}
                                  </span>
                                  {item.error_message && (
                                    <div className="text-red-500 text-xs mt-0.5 max-w-28 truncate" title={item.error_message}>{item.error_message}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-400">
                                  {item.processed_at ? new Date(item.processed_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editEmployee && createPortal(
        <EditSalaryModal
          employee={editEmployee}
          onClose={() => setEditEmployee(null)}
          onSave={handleSave}
          saving={saving}
        />,
        document.body,
      )}

      {payslipRecord && createPortal(
        <PayslipDetailModal
          record={payslipRecord}
          employee={payslipEmployee ?? undefined}
          penalties={payslipPenalties}
          commissions={payslipCommissions}
          onEmailQueued={(employeeId) => {
            setEmailStatusFromQueueMap((prev) => ({
              ...prev,
              [employeeId]: 'PENDING',
            }));
          }}
          onClose={() => { setPayslipRecord(null); setPayslipEmployee(null); setPayslipPenalties([]); setPayslipCommissions([]); }}
        />,
        document.body,
      )}

      {/* Confirm modal: gửi email toàn công ty */}
      {showCompanyPayslipConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Xác nhận gửi email phiếu lương – Toàn công ty</h3>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <p className="text-sm text-gray-600">
                Hệ thống sẽ xếp hàng gửi email phiếu lương{' '}
                <strong>Tháng {String(selectedMonth).padStart(2, '0')}/{selectedYear}</strong> cho toàn bộ nhân sự công ty
                {legalEntityFilterView ? <> (pháp nhân: <strong>{legalEntityFilterView}</strong>)</> : ''}.
              </p>

              {loadingCompanyRecipientsPreview && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  Đang tải danh sách người nhận...
                </div>
              )}

              {companyRecipientsPreviewError && (
                <div className="text-sm text-red-600">{companyRecipientsPreviewError}</div>
              )}

              {!loadingCompanyRecipientsPreview && !companyRecipientsPreviewError && companyRecipientsPreview && (
                <>
                  <div className="text-sm text-gray-600">
                    Dự kiến gửi <strong>{companyRecipientsPreview.can_send}</strong> email / tổng <strong>{companyRecipientsPreview.total}</strong> nhân sự.
                    {companyRecipientsPreview.no_email_count > 0 && (
                      <span className="text-amber-600"> Có {companyRecipientsPreview.no_email_count} người chưa có email.</span>
                    )}
                  </div>

                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Mã NV</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Họ tên</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Email nhận</th>
                          <th className="px-3 py-2 text-center text-gray-500 font-medium">Trạng thái</th>
                          <th className="px-3 py-2 text-center text-gray-500 font-medium">Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {companyPreviewRecipients.map((item) => (
                          <tr key={item.employee_id}>
                            <td className="px-3 py-2 text-gray-700">{item.employee_code || '—'}</td>
                            <td className="px-3 py-2 text-gray-700">{item.employee_name || '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{item.email || '—'}</td>
                            <td className="px-3 py-2 text-center">
                              {item.has_email ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">Sẽ gửi</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">Thiếu email</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => setSelectedCompanyRecipientPreview(item)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100"
                                title="Xem chi tiết email dự kiến gửi"
                              >
                                <EyeIcon className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  {selectedCompanyRecipientPreview && (
                    <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-purple-900">Chi tiết email dự kiến gửi</p>
                        <button
                          type="button"
                          onClick={() => setSelectedCompanyRecipientPreview(null)}
                          className="text-purple-700 hover:text-purple-900"
                          title="Đóng chi tiết"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-purple-900">
                        <p><strong>Nhân viên:</strong> {selectedCompanyRecipientPreview.employee_name}</p>
                        <p><strong>Mã NV:</strong> {selectedCompanyRecipientPreview.employee_code || '—'}</p>
                        <p className="md:col-span-2"><strong>Email nhận:</strong> {selectedCompanyRecipientPreview.email || '—'}</p>
                        <p className="md:col-span-2"><strong>Tiêu đề sẽ gửi:</strong> {selectedCompanyRecipientPreview.preview_subject}</p>
                        <p className="md:col-span-2 text-purple-800">
                          <strong>Ghi chú:</strong> {selectedCompanyRecipientPreview.has_email ? 'Email này đủ điều kiện để đưa vào hàng đợi gửi.' : 'Email trống nên sẽ bị bỏ qua khi gửi.'}
                        </p>
                        <div className="md:col-span-2">
                          <p className="font-semibold mb-1">Nội dung sẽ gửi:</p>
                          <pre className="text-xs bg-white border border-purple-200 rounded-md p-3 max-h-64 overflow-auto whitespace-pre-wrap text-gray-800">
{selectedCompanyRecipientPreview.preview_body}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-6 py-4 flex justify-end gap-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowCompanyPayslipConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleConfirmSendCompanyPayslips}
                disabled={loadingCompanyRecipientsPreview || !!companyRecipientsPreviewError || companyPreviewRecipientsWithEmail.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <EnvelopeIcon className="h-4 w-4" />
                Xác nhận gửi
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Confirm modal: gửi email phòng ban */}
      {showDeptPayslipConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Xác nhận gửi email phiếu lương</h3>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <p className="text-sm text-gray-600">
                Hệ thống sẽ xếp hàng gửi email phiếu lương{' '}
                <strong>Tháng {String(selectedMonth).padStart(2, '0')}/{selectedYear}</strong> cho toàn bộ nhân sự phòng ban{' '}
                <strong>{departments.find((d) => d.id === parseInt(deptFilterView, 10))?.name ?? ''}</strong>.
              </p>

              {loadingRecipientsPreview && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  Đang tải danh sách người nhận...
                </div>
              )}

              {deptRecipientsPreviewError && (
                <div className="text-sm text-red-600">{deptRecipientsPreviewError}</div>
              )}

              {!loadingRecipientsPreview && !deptRecipientsPreviewError && deptRecipientsPreview && (
                <>
                  <div className="text-sm text-gray-600">
                    Dự kiến gửi <strong>{deptRecipientsPreview.can_send}</strong> email / tổng <strong>{deptRecipientsPreview.total}</strong> nhân sự.
                    {deptRecipientsPreview.no_email_count > 0 && (
                      <span className="text-amber-600"> Có {deptRecipientsPreview.no_email_count} người chưa có email.</span>
                    )}
                  </div>

                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Mã NV</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Họ tên</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Email nhận</th>
                          <th className="px-3 py-2 text-center text-gray-500 font-medium">Trạng thái</th>
                          <th className="px-3 py-2 text-center text-gray-500 font-medium">Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {previewRecipients.map((item) => (
                          <tr key={item.employee_id}>
                            <td className="px-3 py-2 text-gray-700">{item.employee_code || '—'}</td>
                            <td className="px-3 py-2 text-gray-700">{item.employee_name || '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{item.email || '—'}</td>
                            <td className="px-3 py-2 text-center">
                              {item.has_email ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">Sẽ gửi</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">Thiếu email</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => setSelectedRecipientPreview(item)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100"
                                title="Xem chi tiết email dự kiến gửi"
                              >
                                <EyeIcon className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  {selectedRecipientPreview && (
                    <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-blue-900">Chi tiết email dự kiến gửi</p>
                        <button
                          type="button"
                          onClick={() => setSelectedRecipientPreview(null)}
                          className="text-blue-700 hover:text-blue-900"
                          title="Đóng chi tiết"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-blue-900">
                        <p><strong>Nhân viên:</strong> {selectedRecipientPreview.employee_name}</p>
                        <p><strong>Mã NV:</strong> {selectedRecipientPreview.employee_code || '—'}</p>
                        <p className="md:col-span-2"><strong>Email nhận:</strong> {selectedRecipientPreview.email || '—'}</p>
                        <p className="md:col-span-2"><strong>Tiêu đề sẽ gửi:</strong> {selectedRecipientPreview.preview_subject}</p>
                        <p className="md:col-span-2 text-blue-800">
                          <strong>Ghi chú:</strong> {selectedRecipientPreview.has_email ? 'Email này đủ điều kiện để đưa vào hàng đợi gửi.' : 'Email trống nên sẽ bị bỏ qua khi gửi.'}
                        </p>
                        <div className="md:col-span-2">
                          <p className="font-semibold mb-1">Nội dung sẽ gửi:</p>
                          <pre className="text-xs bg-white border border-blue-200 rounded-md p-3 max-h-64 overflow-auto whitespace-pre-wrap text-gray-800">
{selectedRecipientPreview.preview_body}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-6 py-4 flex justify-end gap-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowDeptPayslipConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleConfirmSendDeptPayslips}
                disabled={loadingRecipientsPreview || !!deptRecipientsPreviewError || previewRecipientsWithEmail.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <EnvelopeIcon className="h-4 w-4" />
                Xác nhận gửi
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Import cấu hình lương dialog ── */}
      {showImportDialog && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={handleCloseImportDialog}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Nhập cấu hình lương</h2>
                <p className="text-sm text-gray-500 mt-0.5">Cập nhật hàng loạt cấu hình tính lương từ file Excel</p>
              </div>
              <button onClick={handleCloseImportDialog} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
                <XMarkIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Toast messages */}
              {scImportMsg.ok && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                  <CheckIcon className="h-4 w-4 flex-shrink-0" />{scImportMsg.ok}
                  <button className="ml-auto" onClick={() => setScImportMsg((m) => ({ ...m, ok: null }))}><XMarkIcon className="h-4 w-4" /></button>
                </div>
              )}
              {scImportMsg.err && (
                <div className="bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm overflow-hidden">
                  <div className="flex items-center gap-2 p-3">
                    <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
                    {scImportMsg.err}
                    <button className="ml-auto" onClick={() => setScImportMsg((m) => ({ ...m, err: null, errors: [] }))}><XMarkIcon className="h-4 w-4" /></button>
                  </div>
                  {scImportMsg.errors.length > 0 && (
                    <div className="border-t border-red-200">
                      <div className="flex items-center justify-between px-3 py-2 bg-red-100">
                        <span className="text-xs font-medium text-red-700">{scImportMsg.errors.length} dòng không import được</span>
                        <button
                          onClick={handleExportErrors}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                        >
                          <ArrowDownTrayIcon className="h-3 w-3" />
                          Tải file lỗi để sửa
                        </button>
                      </div>
                      <div className="max-h-48 overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="bg-red-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-red-700 w-32">Mã nhân viên</th>
                              <th className="px-3 py-2 text-left font-medium text-red-700">Lý do lỗi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-100">
                            {scImportMsg.errors.map((e, i) => (
                              <tr key={i} className="bg-white">
                                <td className="px-3 py-1.5 font-mono font-medium text-red-700">{e.employee_code}</td>
                                <td className="px-3 py-1.5 text-red-600">{e.error}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Company Batch status report */}
                  {companyPayslipBatch && (
                    <div className="mt-3 border border-purple-200 rounded-lg overflow-hidden">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2 bg-purple-50 border-b border-purple-200">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-purple-800">Báo cáo gửi email – Toàn công ty</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            companyPayslipBatch.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                            companyPayslipBatch.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {pollingCompanyBatch && <ArrowPathIcon className="h-3 w-3 animate-spin" />}
                            {companyPayslipBatch.status === 'COMPLETED' ? 'Hoàn thành' :
                             companyPayslipBatch.status === 'FAILED' ? 'Thất bại' :
                             companyPayslipBatch.status === 'PROCESSING' ? 'Đang gửi' : 'Chờ gửi'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span className="text-green-600 font-medium">✓ {companyPayslipBatch.sent} đã gửi</span>
                          <span className="text-yellow-600 font-medium">⏳ {companyPayslipBatch.pending} chờ</span>
                          {companyPayslipBatch.failed > 0 && <span className="text-red-600 font-medium">✗ {companyPayslipBatch.failed} lỗi</span>}
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100">
                        <div
                          className="h-full bg-green-500 transition-all duration-500"
                          style={{ width: `${companyPayslipBatch.progress_pct}%` }}
                        />
                      </div>
                      <div className="max-h-60 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-gray-50">
                            <tr>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Nhân viên</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Email</th>
                              <th className="text-center px-3 py-2 text-gray-500 font-medium">Trạng thái</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Thời gian</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {companyPayslipBatch.emails.map((item) => (
                              <tr key={item.employee_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                  <div className="font-medium text-gray-800">{item.employee_name}</div>
                                  <div className="text-gray-400">{item.employee_code}</div>
                                </td>
                                <td className="px-3 py-2 text-gray-600">{item.email}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                    item.status === 'SENT' ? 'bg-green-100 text-green-700' :
                                    item.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                                    item.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    {item.status === 'SENT' ? '✓ Đã gửi' :
                                     item.status === 'FAILED' ? '✗ Lỗi' :
                                     item.status === 'PROCESSING' ? '↻ Đang gửi' : '⏳ Chờ'}
                                  </span>
                                  {item.error_message && (
                                    <div className="text-red-500 text-xs mt-0.5 max-w-28 truncate" title={item.error_message}>{item.error_message}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-400">
                                  {item.processed_at ? new Date(item.processed_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Action bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={downloadSalaryConfigTemplate}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />Tải file mẫu
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 cursor-pointer transition-colors">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  {scFile ? scFile.name : 'Chọn file Excel (.xlsx)'}
                  <input ref={scFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleScFileChange} />
                </label>
                {scParsing && (
                  <span className="flex items-center gap-1.5 text-sm text-gray-500">
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />Đang đọc file...
                  </span>
                )}
              </div>

              {scParseError && (
                <p className="flex items-center gap-1 text-sm text-red-600">
                  <ExclamationCircleIcon className="h-4 w-4" />{scParseError}
                </p>
              )}

              {/* Preview table */}
              {scParsedRows && !scParsing && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">
                      Xem trước — {scParsedRows.length} dòng
                      {scParsedRows.filter((r) => r.parseError).length > 0 && (
                        <span className="text-red-500"> · {scParsedRows.filter((r) => r.parseError).length} lỗi</span>
                      )}
                      {scParsedRows.filter((r) => !r.parseError).length > 0 && (
                        <span className="text-green-600"> · {scParsedRows.filter((r) => !r.parseError).length} hợp lệ</span>
                      )}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">#</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mã NV</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ngày HL</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Lương CB</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Hệ số</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">PC Ăn trưa</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">PC Gửi xe</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">PC Trách nhiệm</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vùng</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">BH</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Người PT</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">CĐ</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {scParsedRows.map((row, i) => (
                          <tr key={row.rowIndex} className={row.parseError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-2 font-mono font-medium text-gray-800">{row.employee_code}</td>
                            <td className="px-3 py-2 text-gray-700">{row.effective_date || '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{row.basic_salary ? row.basic_salary.toLocaleString('vi-VN') : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{row.salary_factor ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-700 text-xs">
                              {row.lunch_mode
                                ? `${row.lunch_mode === 'fixed' ? 'Cố định' : 'Thực tế'}${row.lunch_amount ? ' / ' + row.lunch_amount.toLocaleString('vi-VN') : ''}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 text-xs">
                              {row.parking_mode
                                ? `${row.parking_mode === 'none' ? 'Không' : row.parking_mode === 'daily' ? 'Ngày' : 'Tháng'}${row.parking_rate ? ' / ' + row.parking_rate.toLocaleString('vi-VN') : ''}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 text-xs">
                              {row.responsibility_mode
                                ? `${row.responsibility_mode === 'none' ? 'Không' : row.responsibility_mode === 'fixed' ? 'Cố định' : 'Thực tế'}${row.responsibility_amount ? ' / ' + row.responsibility_amount.toLocaleString('vi-VN') : ''}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-700">{row.region ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-700 text-xs">
                              {row.insurance_mode === 'official' ? 'Chính thức' : row.insurance_mode === 'custom' ? 'Tùy chỉnh' : '—'}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700">{row.dependent_count ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">
                              {row.union_fee != null ? row.union_fee.toLocaleString('vi-VN') : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {row.parseError
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><ExclamationCircleIcon className="h-3.5 w-3.5" />{row.parseError}</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckIcon className="h-3.5 w-3.5" />Hợp lệ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Info note khi chưa có file */}
              {!scParsedRows && !scParsing && !scParseError && (
                <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-4 text-sm text-indigo-700">
                  <p className="font-medium mb-1">Hướng dẫn</p>
                  <ul className="list-disc list-inside space-y-1 text-indigo-600">
                    <li>Tải file mẫu, điền thông tin — dropdown đã có danh sách chọn sẵn</li>
                    <li>Chỉ cần điền các cột muốn cập nhật; cột bỏ trống giữ nguyên cấu hình cũ</li>
                    <li><strong>Mã nhân viên</strong> và <strong>Ngày hiệu lực</strong> là bắt buộc</li>
                    <li>PC Gửi xe — Giá vé: nhập giá vé ngày (Vé ngày) hoặc giá vé tháng (Vé tháng)</li>
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={handleCloseImportDialog} className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                Đóng
              </button>
              {scParsedRows && scParsedRows.filter((r) => !r.parseError).length > 0 && (
                <button
                  onClick={handleScImport}
                  disabled={scImporting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {scImporting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                  {scImporting ? 'Đang cập nhật...' : `Xác nhận import (${scParsedRows.filter((r) => !r.parseError).length} dòng)`}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showPayrollPreviewModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowPayrollPreviewModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Xem trước bảng lương chi tiết</h2>
                <p className="text-sm text-gray-500 mt-0.5">Tháng {String(selectedMonth).padStart(2, '0')}.{selectedYear} · {payrollDetailRows.length} nhân viên</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportPayrollExcel}
                  disabled={exportingPayroll || payrollDetailRows.length === 0}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50"
                >
                  {exportingPayroll ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ArrowDownTrayIcon className="h-4 w-4" />}
                  {exportingPayroll ? 'Đang tải...' : 'Tải Excel'}
                </button>
                <button onClick={() => setShowPayrollPreviewModal(false)} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
                  <XMarkIcon className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 z-20 bg-gray-50 min-w-[120px]">Mã NV</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky left-[120px] z-20 bg-gray-50 min-w-[220px]">Họ tên</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky left-[340px] z-20 bg-gray-50 min-w-[180px]">Phòng ban</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Năm</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tháng</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Lương CB</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Công chuẩn</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tổng công</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Lương ngày công</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Lương doanh số</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Lương OT</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Bán sản phẩm</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Phụ mổ</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Trực ca</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Thu nhập khác</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tổng lương III</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">PC gửi xe</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">PC ăn trưa</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">PC trách nhiệm</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">PC livestream</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">PC khác</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tổng phụ cấp IV</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Thưởng</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tổng thu nhập VI</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">BHXH</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">BHYT</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">BHTN</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tổng BH</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Công đoàn</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Phạt đi muộn</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Phạt biên bản</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tổng giảm trừ VII</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Điều chỉnh VIII</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Thuế TNCN X</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tạm ứng XI</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Thực lĩnh IX</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-indigo-700 uppercase bg-indigo-50">Còn phải TT XII</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {payrollDetailRows.map((row, idx) => (
                    <tr key={row.ma_nv} className={`group ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-100'} hover:!bg-indigo-100`}>
                      <td className={`px-3 py-2 font-mono text-gray-700 sticky left-0 z-10 group-hover:!bg-indigo-100 min-w-[120px] ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-100'}`}>{row.ma_nv}</td>
                      <td className={`px-3 py-2 text-gray-900 sticky left-[120px] z-10 group-hover:!bg-indigo-100 min-w-[220px] ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-100'}`}>{row.ho_va_ten}</td>
                      <td className={`px-3 py-2 text-gray-700 sticky left-[340px] z-10 group-hover:!bg-indigo-100 min-w-[180px] ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-100'}`}>{row.phong_ban || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{row.year}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{row.month}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.luong_co_ban)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatNumber(row.cong_chuan)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatNumber(row.tong_cong)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.luong_ngay_cong)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.luong_doanh_so)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency((row as unknown as Record<string, number>)['luong_ot'])}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency((row as unknown as Record<string, number>)['ban_san_pham'])}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency((row as unknown as Record<string, number>)['phu_mo'])}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency((row as unknown as Record<string, number>)['truc_ca'])}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.thu_nhap_khac)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tong_luong_iii)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.phu_cap_gui_xe)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.phu_cap_an_trua)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.phu_cap_trach_nhiem)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.phu_cap_livestream)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.phu_cap_khac)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tong_phu_cap_iv)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.thuong)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tong_thu_nhap_vi)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.bhxh)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.bhyt)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.bhtn)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tong_bh)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.cong_doan)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tong_phat)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tong_phat_bienban)}</td>
                      <td className="px-3 py-2 text-right text-red-700">{formatCurrency(row.tong_giam_tru_vii)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.dieu_chinh)}</td>
                      <td className="px-3 py-2 text-right text-red-700">{formatCurrency(row.thue_tncn)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.tam_ung)}</td>
                      <td className="px-3 py-2 text-right text-gray-800 font-medium">{formatCurrency(row.luong_thuc_linh)}</td>
                      <td className="px-3 py-2 text-right text-indigo-700 font-semibold bg-indigo-50">{formatCurrency(row.con_phai_thanh_toan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal tổng lương công ty ── */}
      {showTotalSalaryModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowTotalSalaryModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {totalSalaryScope === 'legal_entity' ? 'Báo cáo tổng lương pháp nhân' : 'Báo cáo tổng lương công ty'}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Tháng {String(selectedMonth).padStart(2, '0')}.{selectedYear}
                  {deptFilterView && departments.find(d => String(d.id) === deptFilterView) && (
                    <> · {departments.find(d => String(d.id) === deptFilterView)?.name}</>
                  )}
                  {legalEntityFilterView && (
                    <> · {legalEntityFilterView}</>
                  )}
                </p>
              </div>
              <button 
                onClick={() => setShowTotalSalaryModal(false)} 
                className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-4">
              {loadingTotalSalary ? (
                <div className="flex items-center justify-center py-12">
                  <ArrowPathIcon className="h-6 w-6 text-primary-400 animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">Đang tính toán...</span>
                </div>
              ) : totalSalaryError ? (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                  <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
                  {totalSalaryError}
                </div>
              ) : totalSalaryData ? (
                <>
                  {(() => {
                    const totalTransferToEmployees = totalSalaryData.total_con_phai_thanh_toan ?? totalSalaryData.total_net_salary ?? 0;
                    const totalTaxTncn = totalSalaryData.total_thue_tncn ?? 0;
                    const totalMustPay = totalTransferToEmployees + totalTaxTncn;
                    return (
                      <>
                        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-6 text-center">
                          <p className="text-sm text-indigo-600 font-medium mb-2">TỔNG PHẢI CHUYỂN CHO NHÂN VIÊN</p>
                          <p className="text-4xl font-bold text-indigo-900">{formatCurrency(totalTransferToEmployees)}</p>
                          <p className="text-sm text-indigo-500 mt-2">= Tổng số tiền công ty chuyển vào tài khoản nhân viên</p>
                        </div>

                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-6 text-center">
                          <p className="text-sm text-amber-700 font-medium mb-2">TỔNG THUẾ TNCN PHẢI NỘP</p>
                          <p className="text-3xl font-bold text-amber-900">{formatCurrency(totalTaxTncn)}</p>
                          <p className="text-sm text-amber-600 mt-2">= Tổng trường Thuế thu nhập cá nhân</p>
                        </div>

                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-6 text-center">
                          <p className="text-sm text-emerald-700 font-medium mb-2">TỔNG PHẢI CHI TRẢ (NHÂN VIÊN + CƠ QUAN THUẾ)</p>
                          <p className="text-4xl font-bold text-emerald-900">{formatCurrency(totalMustPay)}</p>
                          <p className="text-sm text-emerald-600 mt-2">= Tổng chuyển nhân viên + tổng thuế TNCN phải nộp</p>
                        </div>
                      </>
                    );
                  })()}

                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
                    <p>Số lượng nhân viên: <span className="font-semibold text-gray-900">{totalSalaryData.employee_count}</span></p>
                  </div>
                </>
              ) : null}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button 
                onClick={() => setShowTotalSalaryModal(false)} 
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default SalaryManagement;
