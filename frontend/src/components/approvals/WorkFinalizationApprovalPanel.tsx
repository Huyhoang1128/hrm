import React from 'react';

/**
 * Khối "PHÊ DUYỆT: BẢNG DATA NHÂN SỰ TEAM" (bảng công tháng chờ duyệt) của
 * trang Phê duyệt — tách nguyên khối ra khỏi src/pages/Approvals.tsx
 * (2026-09-23, yêu cầu HCNS "tách nhỏ trang phê duyệt cho dễ nhìn, đừng bỏ
 * gì cả"): JSX bên dưới giữ NGUYÊN VĂN, mọi state/hàm của trang cha nhận
 * qua props nên hành vi không đổi.
 *
 * Kiểu `any` cho props là cố ý: các giá trị này vốn đã là `any` ở trang cha
 * (dữ liệu đơn từ backend không có type chung), khai báo chặt hơn ở đây sẽ
 * phải đổi cả trang cha — việc đó để dành cho lần dọn type riêng.
 */
interface WorkFinalizationApprovalPanelProps {
  activeTab: any;
  loading: any;
  showWorkFinalizationPanel: any;
  visibleWorkFinalizationApprovals: any[];
  displayedWorkFinalizationApprovals: any[];
  isWorkFinalizationExpanded: boolean;
  setIsWorkFinalizationExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  PREVIEW_ROWS: any;
  canApproveRequest: any;
  openApproveModal: any;
  openRejectModal: any;
  handleViewDetails: any;
  handleViewOnlineWorkDetails: any;
  handleViewWfDetails: any;
  getWfApprovalProgress: any;
  isWfPartiallyApproved: any;
  getEmpField: any;
  getWfSiDeduction: any;
  getDoctorTeamDisplay: any;
  formatWfAllowance: any;
  formatRankDisplay: any;
  formatProbationRateDisplay: any;
  formatDateTime: any;
  getDayOfWeek: any;
  renderExpandableWorkNote: any;
}

const WorkFinalizationApprovalPanel: React.FC<WorkFinalizationApprovalPanelProps> = ({
  activeTab,
  loading,
  showWorkFinalizationPanel,
  visibleWorkFinalizationApprovals,
  displayedWorkFinalizationApprovals,
  isWorkFinalizationExpanded,
  setIsWorkFinalizationExpanded,
  PREVIEW_ROWS,
  canApproveRequest,
  openApproveModal,
  openRejectModal,
  handleViewDetails,
  handleViewOnlineWorkDetails,
  handleViewWfDetails,
  getWfApprovalProgress,
  isWfPartiallyApproved,
  getEmpField,
  getWfSiDeduction,
  getDoctorTeamDisplay,
  formatWfAllowance,
  formatRankDisplay,
  formatProbationRateDisplay,
  formatDateTime,
  getDayOfWeek,
  renderExpandableWorkNote,
}) => {
  return (
    <>
        {/* Từ 2026-09-23 component này nằm trong tab riêng của trang Phê
            duyệt nên KHÔNG tự lọc theo activeTab nữa — trang cha quyết
            định có render hay không. */}
        {!loading && showWorkFinalizationPanel && (
          <div className="mt-4 sm:mt-8 mb-4 sm:mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 sm:mb-6 bg-white p-3 sm:p-4 md:p-5 rounded-lg shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
                <div className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 bg-gradient-to-br from-primary-500 to-violet-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary-100">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h1 className="text-lg sm:text-xl lg:text-2xl font-semibold text-gray-800">PHÊ DUYỆT: BẢNG DATA NHÂN SỰ TEAM </h1>
                  <div className="flex items-center gap-1.5 sm:gap-2 mt-1 sm:mt-0.5">
                    <span className="flex h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-rose-500 animate-ping"></span>
                    <p className="text-xs sm:text-sm text-gray-400 font-bold">Ưu tiên xử lý các đơn này</p>
                  </div>
                </div>
              </div>

              {(() => {
                const count = visibleWorkFinalizationApprovals.length;
                return (
                  <div className="flex items-center gap-3 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-gray-100 mt-1 sm:mt-0 justify-end">
                    <div className="text-right">
                      <div className="text-xs font-semibold text-gray-400">Số lượng phòng</div>
                      <div className="text-3xl font-semibold text-primary-600 leading-none mt-1">{count}</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-lg shadow-slate-200/40">
              {/* Desktop Table View */}
              <div className="hidden lg:block overflow-x-auto [&_table]:border-collapse [&_table]:text-[11px] [&_th]:!px-3 [&_th]:!py-2 [&_th]:!text-[10px] [&_th]:!font-bold [&_th]:!text-primary-700 [&_th]:!bg-primary-50 [&_th]:!border [&_th]:!border-primary-100 [&_td]:!px-3 [&_td]:!py-2 [&_td]:!text-xs [&_td]:!border [&_td]:!border-gray-100 [&_tbody_tr:nth-child(even)]:!bg-slate-50/40">
                <table className="w-full table-fixed divide-y divide-gray-100">
                  <thead className="bg-primary-50">
                    <tr>
                      <th className="w-20 px-6 py-5 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest border-r border-gray-100/50">STT</th>
                      {/* <th className="px-6 py-5 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Phòng Ban</th> */}
                      {/* <th className="px-6 py-5 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Họ và Tên</th> */}
                      <th className="w-[36%] px-6 py-5 text-left text-xs font-semibold text-gray-400 uppercase tracking-widest">Phòng/Ban</th>
                     
                      <th className="w-[28%] px-6 py-5 text-center text-xs font-semibold text-gray-400 uppercase tracking-widest bg-primary-50/30">Hành động</th>
                      <th className="w-[30%] px-6 py-5 text-center text-xs font-semibold text-gray-400 uppercase tracking-widest bg-primary-50/30">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {(() => {
                      if (visibleWorkFinalizationApprovals.length === 0) {
                        return (
                          <tr>
                            <td colSpan={4} className="px-6 py-20 text-center bg-gray-50/20">
                              <div className="flex flex-col items-center max-w-sm mx-auto">
                                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 mb-6 shadow-sm">
                                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <h4 className="text-lg font-semibold text-gray-800">Hoàn thành tuyệt vời!</h4>
                                <p className="text-gray-400 text-base mt-2 font-medium">Bạn đã xử lý hết tất cả các đơn thuộc quyền hạn của mình.</p>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return displayedWorkFinalizationApprovals.map((item, index) => (
                        <tr key={`manager-row-${item.id}`} className="hover:bg-primary-50/20 transition-all duration-300 group cursor-pointer" onClick={() => {
                          if (item._itemType === 'WORK_FINALIZATION') {
                            handleViewWfDetails(item);
                            return;
                          }
                          (item._itemType === 'ONLINE_WORK' || item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME') ? handleViewOnlineWorkDetails(item) : handleViewDetails(item);
                        }}>
                          <td className="px-6 py-5 whitespace-nowrap text-base font-semibold text-gray-300 border-r border-gray-50">
                            {(index + 1).toString().padStart(2, '0')}
                          </td>
                          {/* <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'employee_code')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'employee_name')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'department_name')}</td> */}
                          {/* <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{item.unit || item.team || item.section || '-'}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{formatRankDisplay(item.rank || item.level)}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'position')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getDoctorTeamDisplay(item)}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'work_form')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{item.resignation_date || item.leave_date || '-'}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'probation_months')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'start_date')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{item.probation_end_date || item.probation_end || '-'}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{formatProbationRateDisplay(item.probation_rate || item.probation_ratio || '-')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{formatWfAllowance(getEmpField(item,'basic_salary'))}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'allowance')}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{item.sales_percent || item.sales_ratio || '-'}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{item.profit_percent || item.profit_ratio || '-'}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getWfSiDeduction(item)}</td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm text-gray-700">{getEmpField(item,'employee_status')}</td> */}
                          {/* <td className="px-6 py-5 text-sm text-gray-700 align-top">
                            {renderExpandableWorkNote(
                              getEmpField(item,'employment_status_notes'),
                              `main-list-${item.id || item.employee_id || index}`,
                              { maxWidthClass: 'max-w-[280px]' }
                            )}
                          </td> */}
                          {/* <td className="px-6 py-5 whitespace-nowrap">
                            <span className="px-2.5 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold border border-gray-200 group-hover:bg-white group-hover:shadow-sm transition-all duration-300">
                              {item.department_code}
                            </span>
                          </td> */}
                          <td className="px-6 py-5 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-semibold shadow-md shadow-primary-100">
                                {item.department_name?.charAt(0)}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-base font-semibold text-gray-800 group-hover:text-primary-600 transition-colors">{item.department_name || item.department_code}</span>
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-tight">Chốt công tháng {item.month}/{item.year}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-base font-semibold text-gray-800`}>
                                  Xem chi tiết ↗
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-400 italic">Người gửi: {item.sent_by_name} ({item.sent_by_role || 'Admin'})</span>
                              </div>
                            </div>
                          </td>
                          {/* <td className="px-6 py-5 whitespace-nowrap">
                            <div className="text-base font-semibold text-gray-700">
                              {formatDateTime(item.created_at)}
                            </div>
                          </td> */}
                          <td className="px-6 py-5 text-center bg-primary-50/5 group-hover:bg-primary-50/10 transition-all border-l border-gray-50" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center min-h-[50px]">
                              {/* PHẦN HIỂN THỊ DÀNH CHO QUẢN LÝ (KHI CÓ QUYỀN DUYỆT) */}
                              {item.status === 'PENDING' && canApproveRequest(item) ? (
                                <div className="flex flex-col items-center gap-2">
                                  {isWfPartiallyApproved(item) && (
                                    <span className="inline-flex items-center px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold uppercase tracking-wider">
                                      Đã duyệt {getWfApprovalProgress(item).approved}/{getWfApprovalProgress(item).total}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => openApproveModal(item)}
                                    className="group h-10 px-6 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-lg shadow-emerald-100 transition-all hover:scale-[1.02] active:scale-95 whitespace-nowrap uppercase tracking-widest flex items-center gap-2"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                    PHÊ DUYỆT
                                  </button>
                                  <button
                                    onClick={() => openRejectModal(item)}
                                    className="h-10 px-6 bg-white hover:bg-rose-50 text-rose-500 text-xs font-semibold rounded-lg border border-gray-200 hover:border-rose-200 transition-all uppercase tracking-widest flex items-center gap-2"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                                    TỪ CHỐI
                                  </button>
                                  </div>
                                </div>
                              ) : (
                                /* PHẦN HIỂN THỊ DÀNH CHO ADMIN (HOẶC KHI ĐÃ DUYỆT XONG) */
                                <div className="flex flex-col items-center">
                                  {item.status === 'APPROVED' ? (
                                    <div className="flex items-center gap-3 px-5 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg shadow-sm">
                                      <div className="w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm shadow-emerald-100">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>
                                      </div>
                                      <span className="text-emerald-700 font-semibold text-xs uppercase tracking-widest">QL PHỤ TRÁCH ĐÃ PHÊ DUYỆT</span>
                                    </div>
                                  ) : item.status === 'REJECTED' ? (
                                    <div className="flex items-center gap-3 px-5 py-2.5 bg-rose-50 border border-rose-100 rounded-lg shadow-sm">
                                      <div className="w-7 h-7 bg-rose-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm shadow-rose-100">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M6 18L18 6M6 6l12 12" /></svg>
                                      </div>
                                      <span className="text-rose-700 font-semibold text-xs uppercase tracking-widest">QL PHỤ TRÁCH ĐÃ TỪ CHỐI</span>
                                    </div>
                                  ) : isWfPartiallyApproved(item) ? (
                                    <div className="flex items-center gap-3 px-5 py-2.5 bg-violet-50 border border-violet-100 rounded-lg shadow-sm">
                                      <div className="w-7 h-7 bg-violet-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm shadow-violet-100">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>
                                      </div>
                                      <span className="text-violet-700 font-semibold text-xs uppercase tracking-widest">
                                        Đã duyệt {getWfApprovalProgress(item).approved}/{getWfApprovalProgress(item).total}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-3 px-5 py-2.5 bg-amber-50 border border-amber-100 rounded-lg shadow-sm">
                                      <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-white shrink-0 animate-pulse shadow-sm shadow-amber-100">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                      </div>
                                      <span className="text-amber-700 font-semibold text-xs uppercase tracking-widest">ĐANG CHỜ QL PHỤ TRÁCH DUYỆT</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View for Manager Table */}
              <div className="lg:hidden divide-y divide-gray-100">
                {visibleWorkFinalizationApprovals.length === 0 ? (
                  <div className="px-6 py-16 text-center bg-gray-50/20">
                    <div className="flex flex-col items-center max-w-sm mx-auto">
                      <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <h4 className="text-base font-semibold text-gray-800 uppercase tracking-tight">Tất cả đã xử lý!</h4>
                    </div>
                  </div>
                ) : (
                  displayedWorkFinalizationApprovals.map((item) => (
                    <div
                      key={`manager-card-${item.id}`}
                      onClick={() => {
                        if (item._itemType === 'WORK_FINALIZATION') {
                          handleViewWfDetails(item);
                          return;
                        }
                        (item._itemType === 'ONLINE_WORK' || item._itemType === 'REGISTRATION' || item._itemType === 'OVERTIME') ? handleViewOnlineWorkDetails(item) : handleViewDetails(item);
                      }}
                      className="p-4 sm:p-5 bg-white active:bg-gray-50 transition-all border-b border-gray-50"
                    >
                      {/* flex-wrap + nowrap: tên phòng dài thì khối thời gian tự xuống hàng
                          (căn phải) thay vì bị ép thành nhiều dòng. */}
                      <div className="flex flex-wrap justify-between items-start gap-x-3 gap-y-2 mb-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 shrink-0 rounded-lg bg-primary-600 flex items-center justify-center text-white font-semibold shadow-lg shadow-primary-100">
                            {item.department_name?.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-semibold text-gray-800 uppercase tracking-tight">{item.department_name || item.department_code}</h4>
                            <p className="text-xs font-bold text-primary-500 uppercase tracking-[0.1em] whitespace-nowrap">Chốt công : {item.month}/{item.year}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-auto">
                          <div className="text-xs font-bold text-gray-300 uppercase tracking-widest whitespace-nowrap">Thời gian gửi</div>
                          <div className="text-xs font-semibold text-gray-500 whitespace-nowrap">
                            {/* toLocaleString('vi-VN') ra "17:14:08 9/10/2026" — giờ đứng trước, ngày ở cuối */}
                            {getDayOfWeek(item.created_at)}, {formatDateTime(item.created_at).split(' ').pop()}
                          </div>
                        </div>
                      </div>

                      <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-100 mb-4">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Trạng thái hiện tại:</span>
                          {item.status === 'APPROVED' ? (
                            <span className="text-xs font-semibold text-emerald-600 uppercase whitespace-nowrap">Đã phê duyệt</span>
                          ) : item.status === 'REJECTED' ? (
                            <span className="text-xs font-semibold text-rose-600 uppercase whitespace-nowrap">Đã từ chối</span>
                          ) : isWfPartiallyApproved(item) ? (
                            <span className="text-xs font-semibold text-violet-600 uppercase whitespace-nowrap">
                              Đã duyệt {getWfApprovalProgress(item).approved}/{getWfApprovalProgress(item).total}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-600 uppercase animate-pulse whitespace-nowrap">Đang chờ xử lý</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1 italic font-medium">Người gửi: {item.sent_by_name}</p>
                      </div>

                      {item.status === 'PENDING' && canApproveRequest(item) && (
                        <div className="flex gap-3 mt-2" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => openApproveModal(item)}
                            className="flex-1 py-3.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold uppercase tracking-widest shadow-lg shadow-emerald-100 active:scale-95 transition-all flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            PHÊ DUYỆT
                          </button>
                          <button
                            onClick={() => openRejectModal(item)}
                            className="flex-1 py-3.5 bg-white border border-rose-100 text-rose-500 rounded-lg text-xs font-semibold uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                            TỪ CHỐI
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3 mt-3 text-sm text-gray-700">
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Mã nhân viên</span>
                          <span className="font-medium">{getEmpField(item,'employee_code')}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Vị trí</span>
                          <span className="font-medium">{getEmpField(item,'position')}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Ngày bắt đầu</span>
                          <span className="font-medium">{getEmpField(item,'start_date')}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Thời gian thử việc (tháng)</span>
                          <span className="font-medium">{getEmpField(item,'probation_months')}</span>
                        </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-400">Team Bác sĩ</span>
                            <span className="font-medium">{getDoctorTeamDisplay(item)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-400">Lương cơ bản</span>
                            <span className="font-medium">{formatWfAllowance(getEmpField(item,'basic_salary'))}</span>
                          </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Phụ cấp</span>
                          <span className="font-medium">{getEmpField(item,'allowance')}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Tình trạng</span>
                          <span className="font-medium">{getEmpField(item,'employee_status')}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-400">Ghi chú công việc</span>
                          <div className="font-medium">
                            {renderExpandableWorkNote(
                              getEmpField(item,'employment_status_notes'),
                              `main-card-${item.id || item.employee_id || 'unknown'}`,
                              {
                                maxWidthClass: 'max-w-full',
                                previewLength: 80,
                                buttonClass: 'ml-1 inline text-primary-600 hover:text-primary-700 text-[11px] font-semibold'
                              }
                            )}
                          </div>
                        </div>
                      </div>

                      <button className="w-full mt-3 py-3 bg-gray-900 text-white rounded-lg text-xs font-semibold uppercase tracking-wide">
                        XEM CHI TIẾT BẢNG CÔNG
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {visibleWorkFinalizationApprovals.length > PREVIEW_ROWS && (
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60 flex justify-center">
                <button
                  onClick={() => setIsWorkFinalizationExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md border border-primary-200 text-primary-700 bg-white hover:bg-primary-50 transition-colors"
                >
                  {isWorkFinalizationExpanded
                    ? 'Thu gọn'
                    : `Xem thêm ${visibleWorkFinalizationApprovals.length - PREVIEW_ROWS} dòng`}
                </button>
              </div>
            )}

          </div>
        )}
    </>
  );
};

export default WorkFinalizationApprovalPanel;
