/**
 * AttendanceWfDetailModal
 * Modal PHÊ DUYỆT: BẢNG TỔNG CÔNG NHÂN SỰ TEAM
 *
 * Chỉ hiển thị dữ liệu CÔNG – không có lương, % hoa hồng, ghi chú công việc.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Inline helpers (pure functions, no external deps)
// ---------------------------------------------------------------------------

const getWfValue = (emp: any, keys: string[], fallback: any = '-') => {
  for (const key of keys) {
    const val = emp?.[key];
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return fallback;
};

const formatWfDate = (value: any): string => {
  if (!value || value === '-') return '-';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  } catch {
    return String(value);
  }
};

const formatDateTime = (dateString: string): string => {
  if (!dateString) return '-';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return dateString;
  }
};

const formatRankDisplay = (value: any): string => {
  if (!value || value === '-') return '-';
  return String(value);
};

const formatWorkNumber = (value: any, decimals = 1): string => {
  const num = parseFloat(value);
  if (isNaN(num)) return '-';
  return num === 0 ? '-' : num.toFixed(decimals);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttendanceWfDetailModalProps {
  approval: any;
  employees: any[];
  expandedEmployees: Record<string, boolean>;
  setExpandedEmployees: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  employeeActionLoadingId: number | null;
  bulkApproveLoading: boolean;
  printLoading: boolean;
  onClose: () => void;
  onEmployeeDecision: (emp: any, decision: 'APPROVED' | 'REJECTED') => void;
  onApproveRemaining: () => void;
  onPrint: () => void;
  onApprove: (approval: any) => void;
  onReject: (approval: any) => void;
  onViewCalendar: (employee: { id: number; name: string; month: number; year: number }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AttendanceWfDetailModal: React.FC<AttendanceWfDetailModalProps> = ({
  approval,
  employees,
  expandedEmployees,
  setExpandedEmployees,
  employeeActionLoadingId,
  bulkApproveLoading,
  printLoading,
  onClose,
  onEmployeeDecision,
  onApproveRemaining,
  onPrint,
  onApprove,
  onReject,
  onViewCalendar,
}) => {
  const canDecide =
    approval?.status !== 'REJECTED' &&
    !!(approval?.can_decide_employees ?? approval?.can_approve);

  return (
    <div className="fixed inset-0 bg-gray-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white rounded-t-3xl sm:rounded-lg shadow-lg max-w-[98vw] w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-white flex items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white shrink-0">
              {/* Clock / attendance icon */}
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M12 8v4l3 3M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-xl font-semibold text-gray-800 uppercase tracking-tight line-clamp-2">
                PHÊ DUYỆT: BẢNG TỔNG CÔNG NHÂN SỰ TEAM {approval.department_name || approval.department_code}
              </h3>
              <p className="text-xs text-gray-400 font-bold">
                Tháng {approval.month}/{approval.year} • {employees.length} nhân sự
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100 font-semibold text-xl"
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-gray-50/30">
          <div className="bg-white border border-gray-200 rounded-lg sm:rounded-3xl overflow-hidden shadow-sm">

            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto [&_table]:border-collapse [&_table]:text-[11px] [&_th]:!px-2.5 [&_th]:!py-2 [&_th]:!text-[10px] [&_th]:!font-bold [&_th]:!text-primary-700 [&_th]:!bg-primary-50 [&_th]:!border [&_th]:!border-primary-100 [&_td]:!px-2.5 [&_td]:!py-2 [&_td]:!text-xs [&_td]:!border [&_td]:!border-gray-100 [&_tbody_tr:nth-child(even)]:!bg-slate-50/35">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-primary-50">
                  <tr>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">STT</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Mã NV</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Họ và Tên</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Phòng/Ban</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Bộ phận</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Cấp bậc</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Vị trí</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Hình thức LV</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Ngày nghỉ việc</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Ngày bắt đầu</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Kết thúc thử việc</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Tỉ lệ thử việc</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Đã chốt</th>
                    {/* Attendance columns */}
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Tổng công</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Công TT</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Tăng ca</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Thêm giờ</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Trực tối</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Live</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 uppercase tracking-widest whitespace-nowrap">Nghỉ phép</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-rose-700 bg-rose-50 uppercase tracking-widest whitespace-nowrap">Tổng phạt</th>
                    <th className="px-5 py-4 text-center text-xs font-semibold text-rose-700 bg-rose-50 uppercase tracking-widest whitespace-nowrap">Giảm trừ khác</th>
                    {/* Meta */}
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Tình trạng</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Thời gian gửi</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Quyết định</th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={26} className="px-6 py-10 text-center text-gray-400 italic">
                        Không tìm thấy dữ liệu nhân viên
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp: any, index: number) => (
                      <tr
                        key={`attwf-emp-${emp.employee_id}`}
                        className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-primary-50/40 group transition-colors`}
                      >
                        <td className="px-5 py-4 text-sm text-gray-700">{index + 1}</td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['ma_nv', 'employee_code', 'code'])}
                        </td>
                        <td className="px-5 py-4 text-sm font-semibold text-gray-800 tracking-tight group-hover:text-primary-600 whitespace-nowrap">
                          {getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'])}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['phong_ban', 'department_name'])}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['bo_phan', 'unit', 'team', 'section'])}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {formatRankDisplay(getWfValue(emp, ['cap_bac', 'rank', 'level'], '-'))}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['vi_tri', 'position', 'position_name'])}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['hinh_thuc_lam_viec', 'work_type', 'working_type'])}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {formatWfDate(getWfValue(emp, ['ngay_nghi_viec', 'resignation_date', 'leave_date', 'end_date'], ''))}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {formatWfDate(getWfValue(emp, ['ngay_bat_dau_lam_viec', 'start_date'], ''))}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {formatWfDate(getWfValue(emp, ['ngay_ket_thuc_thu_viec', 'probation_end_date', 'probation_end'], ''))}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['ti_le_huong_thu_viec', 'probation_rate_display', 'probation_rate', 'probation_ratio'], '-')}
                        </td>
                        {/* Chốt công */}
                        <td className="px-5 py-4 text-center">
                          {emp.finalized ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">✓ Đã chốt</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Chưa chốt</span>
                          )}
                        </td>
                        {/* Attendance numbers */}
                        <td className="px-5 py-4 text-sm text-center font-semibold text-emerald-700">
                          {formatWorkNumber(getWfValue(emp, ['tong_cong'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-gray-700">
                          {formatWorkNumber(getWfValue(emp, ['cong_thuc_te'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-gray-700">
                          {formatWorkNumber(getWfValue(emp, ['tang_ca'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-gray-700">
                          {formatWorkNumber(getWfValue(emp, ['lam_them_gio'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-gray-700">
                          {formatWorkNumber(getWfValue(emp, ['truc_toi'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-gray-700">
                          {getWfValue(emp, ['live'], null) != null && getWfValue(emp, ['live'], null) !== '-'
                            ? String(emp.live ?? '-')
                            : '-'}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-gray-700">
                          {formatWorkNumber(getWfValue(emp, ['nghi_phep_thang'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-rose-600 font-semibold">
                          {formatWorkNumber(getWfValue(emp, ['tong_phat'], null))}
                        </td>
                        <td className="px-5 py-4 text-sm text-center text-rose-600">
                          {formatWorkNumber(getWfValue(emp, ['giam_tru_khac'], null))}
                        </td>
                        {/* Meta */}
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {getWfValue(emp, ['tinh_trang', 'employee_status', 'status'])}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">
                          {formatDateTime(getWfValue(emp, ['thoi_gian_gui', 'submitted_at', 'created_at'], approval?.created_at || ''))}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">
                          {emp.individual_decision === 'APPROVED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">Đã duyệt</span>
                          ) : emp.individual_decision === 'REJECTED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-100">Đã từ chối</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Chưa quyết định</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-sm whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {canDecide && (
                              <>
                                <button
                                  onClick={() => onEmployeeDecision(emp, 'APPROVED')}
                                  disabled={employeeActionLoadingId === emp.employee_id}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
                                >
                                  {employeeActionLoadingId === emp.employee_id ? '...' : 'Duyệt'}
                                </button>
                                <button
                                  onClick={() => onEmployeeDecision(emp, 'REJECTED')}
                                  disabled={employeeActionLoadingId === emp.employee_id}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Từ chối
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => {
                                const empId = emp.employee_id || (typeof emp.employee === 'object' ? emp.employee?.id : emp.employee);
                                const empName = getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'], 'Nhân viên');
                                if (empId) {
                                  onViewCalendar({ id: Number(empId), name: String(empName), month: approval.month, year: approval.year });
                                }
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100"
                            >
                              Lịch
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile / Tablet Cards */}
            <div className="lg:hidden">
              {employees.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-400 italic">
                  Không tìm thấy dữ liệu nhân viên
                </div>
              ) : (
                <>
                  {/* Expand controls */}
                  {(() => {
                    const expandedCount = employees.filter((_emp: any, idx: number) => {
                      const key = String(_emp.employee_id || `idx-${idx}`);
                      return !!expandedEmployees[key];
                    }).length;
                    const allExpanded = expandedCount > 0 && expandedCount === employees.length;
                    return (
                      <div className="sticky top-0 z-10 px-3 py-2 bg-white/95 backdrop-blur border-b border-gray-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          Đang mở {expandedCount}/{employees.length}
                        </span>
                        <button
                          onClick={() => {
                            if (allExpanded) { setExpandedEmployees({}); return; }
                            const next: Record<string, boolean> = {};
                            employees.forEach((_emp: any, idx: number) => {
                              next[String(_emp.employee_id || `idx-${idx}`)] = true;
                            });
                            setExpandedEmployees(next);
                          }}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-primary-200 text-primary-700 bg-primary-50"
                        >
                          {allExpanded ? 'Thu gọn tất cả' : 'Mở tất cả'}
                        </button>
                      </div>
                    );
                  })()}

                  <div className="divide-y divide-gray-100">
                    {employees.map((emp: any, index: number) => {
                      const employeeKey = String(emp.employee_id || `idx-${index}`);
                      const isExpanded = !!expandedEmployees[employeeKey];

                      return (
                        <div key={`attwf-emp-mobile-${employeeKey}`} className={`p-3 sm:p-6 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                          {/* Row header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-800 tracking-tight truncate">
                                  {getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'])}
                                </span>
                              </div>
                              <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter mt-1 block">
                                STT {index + 1} • {getWfValue(emp, ['ma_nv', 'employee_code', 'code'])}
                              </span>
                              {/* Decision badge */}
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {emp.individual_decision === 'APPROVED' ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">Đã duyệt</span>
                                ) : emp.individual_decision === 'REJECTED' ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-100">Đã từ chối</span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Chưa quyết định</span>
                                )}
                                {emp.finalized ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">✓ Đã chốt</span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Chưa chốt</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => setExpandedEmployees((prev) => ({ ...prev, [employeeKey]: !prev[employeeKey] }))}
                              className="shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 text-gray-600 bg-white"
                            >
                              {isExpanded ? 'Thu gọn' : 'Xem thêm'}
                            </button>
                          </div>

                          {/* Attendance quick stats */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {emp.tong_cong != null && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                Tổng công: {formatWorkNumber(emp.tong_cong)}
                              </span>
                            )}
                            {emp.tong_phat != null && parseFloat(emp.tong_phat) > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-100">
                                Phạt: {formatWorkNumber(emp.tong_phat)}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 text-[11px] font-semibold text-gray-500">
                            Gửi lúc: {formatDateTime(getWfValue(emp, ['thoi_gian_gui', 'submitted_at', 'created_at'], approval?.created_at || ''))}
                          </div>

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {/* Basic info */}
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Phòng/Ban</span><div className="text-xs font-semibold text-gray-800">{getWfValue(emp, ['phong_ban', 'department_name'])}</div></div>
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Bộ phận</span><div className="text-xs font-semibold text-gray-800">{getWfValue(emp, ['bo_phan', 'unit', 'team', 'section'])}</div></div>
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Cấp bậc</span><div className="text-xs font-semibold text-gray-800">{formatRankDisplay(getWfValue(emp, ['cap_bac', 'rank', 'level'], '-'))}</div></div>
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Vị trí</span><div className="text-xs font-semibold text-gray-800">{getWfValue(emp, ['vi_tri', 'position', 'position_name'])}</div></div>
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Hình thức LV</span><div className="text-xs font-semibold text-gray-800">{getWfValue(emp, ['hinh_thuc_lam_viec', 'work_type', 'working_type'])}</div></div>
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100"><span className="text-xs text-gray-400">Ngày nghỉ việc</span><div className="text-xs font-semibold text-gray-800">{formatWfDate(getWfValue(emp, ['ngay_nghi_viec', 'resignation_date', 'leave_date', 'end_date'], ''))}</div></div>
                              {/* Attendance cols */}
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Tổng công</span><div className="text-sm font-bold text-emerald-700">{formatWorkNumber(emp.tong_cong)}</div></div>
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Công thực tế</span><div className="text-xs font-semibold text-emerald-700">{formatWorkNumber(emp.cong_thuc_te)}</div></div>
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Tăng ca</span><div className="text-xs font-semibold text-emerald-700">{formatWorkNumber(emp.tang_ca)}</div></div>
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Làm thêm giờ</span><div className="text-xs font-semibold text-emerald-700">{formatWorkNumber(emp.lam_them_gio)}</div></div>
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Trực tối</span><div className="text-xs font-semibold text-emerald-700">{formatWorkNumber(emp.truc_toi)}</div></div>
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Live</span><div className="text-xs font-semibold text-emerald-700">{emp.live ?? '-'}</div></div>
                              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100"><span className="text-xs text-emerald-600">Nghỉ phép tháng</span><div className="text-xs font-semibold text-emerald-700">{formatWorkNumber(emp.nghi_phep_thang)}</div></div>
                              {(parseFloat(emp.tong_phat) > 0 || parseFloat(emp.giam_tru_khac) > 0) && (
                                <>
                                  <div className="bg-rose-50 p-2.5 rounded-lg border border-rose-100"><span className="text-xs text-rose-600">Tổng phạt</span><div className="text-xs font-semibold text-rose-700">{formatWorkNumber(emp.tong_phat)}</div></div>
                                  <div className="bg-rose-50 p-2.5 rounded-lg border border-rose-100"><span className="text-xs text-rose-600">Giảm trừ khác</span><div className="text-xs font-semibold text-rose-700">{formatWorkNumber(emp.giam_tru_khac)}</div></div>
                                </>
                              )}
                              <div className="bg-gray-900 p-2.5 rounded-lg border border-gray-900 col-span-2"><span className="text-xs text-gray-300">Tình trạng</span><div className="text-xs font-semibold text-white">{getWfValue(emp, ['tinh_trang', 'employee_status', 'status'])}</div></div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className={`mt-3 ${isExpanded ? 'pt-3 border-t border-gray-100' : ''}`}>
                            <div className="w-full flex flex-col sm:flex-row sm:justify-end sm:items-center gap-2">
                              {canDecide && (
                                <>
                                  <button
                                    onClick={() => onEmployeeDecision(emp, 'APPROVED')}
                                    disabled={employeeActionLoadingId === emp.employee_id}
                                    className="w-full sm:w-auto px-2.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
                                  >
                                    {employeeActionLoadingId === emp.employee_id ? 'Đang xử lý...' : 'Duyệt'}
                                  </button>
                                  <button
                                    onClick={() => onEmployeeDecision(emp, 'REJECTED')}
                                    disabled={employeeActionLoadingId === emp.employee_id}
                                    className="w-full sm:w-auto px-2.5 py-2 text-xs font-semibold rounded-lg border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 disabled:opacity-60"
                                  >
                                    Từ chối
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => {
                                  const empId = emp.employee_id;
                                  const empName = getWfValue(emp, ['ho_va_ten', 'employee_name', 'full_name', 'name'], 'Nhân viên');
                                  if (empId) onViewCalendar({ id: Number(empId), name: String(empName), month: approval.month, year: approval.year });
                                }}
                                className="w-full sm:w-auto px-2.5 py-2 text-xs font-semibold rounded-lg border border-primary-200 text-primary-700 bg-primary-50"
                              >
                                Xem lịch công
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

          </div>
        </div>

        {/* ── Mobile Quick Action ─────────────────────────────────────────────── */}
        {canDecide && (
          <div className="sm:hidden px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-100">
            <button
              onClick={onApproveRemaining}
              disabled={bulkApproveLoading}
              className="w-full h-12 px-5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xl shadow-emerald-100 uppercase tracking-widest disabled:opacity-60"
            >
              {bulkApproveLoading ? 'Đang duyệt...' : 'Duyệt toàn bộ NV trực tiếp'}
            </button>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 bg-white border-t border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest italic leading-tight">
              Dữ liệu công đã được đối soát tự động
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <button
              onClick={onPrint}
              disabled={printLoading}
              className="w-full sm:w-auto h-12 px-6 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg uppercase tracking-widest disabled:opacity-60"
            >
              {printLoading ? 'Đang tạo bản in...' : 'In phiếu ký'}
            </button>

            {approval.status === 'APPROVED' && (
              <span className="w-full sm:w-auto text-center px-4 py-3 bg-emerald-50 text-emerald-600 text-xs font-semibold rounded-lg border border-emerald-100 uppercase tracking-widest">
                Bảng công đã được phê duyệt
              </span>
            )}
            {approval.status === 'REJECTED' && (
              <span className="w-full sm:w-auto text-center px-4 py-3 bg-rose-50 text-rose-600 text-xs font-semibold rounded-lg border border-rose-100 uppercase tracking-widest">
                Bảng công đã bị từ chối
              </span>
            )}
            {approval.status === 'PENDING' && approval.can_approve && (
              <>
                <button
                  onClick={() => onApprove(approval)}
                  className="w-full sm:w-auto h-12 px-8 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-xl shadow-emerald-100 uppercase tracking-widest"
                >
                  Duyệt bảng công này
                </button>
                <button
                  onClick={() => onReject(approval)}
                  className="w-full sm:w-auto h-12 px-8 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold rounded-lg border border-rose-200 uppercase tracking-widest"
                >
                  Từ chối bảng công này
                </button>
              </>
            )}
            {canDecide && (
              <button
                onClick={onApproveRemaining}
                disabled={bulkApproveLoading}
                className="hidden sm:block w-full sm:w-auto h-12 px-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xl shadow-emerald-100 uppercase tracking-widest disabled:opacity-60"
              >
                {bulkApproveLoading ? 'Đang duyệt...' : 'Duyệt toàn bộ NV trực tiếp'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default AttendanceWfDetailModal;
