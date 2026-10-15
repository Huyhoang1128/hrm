import React from 'react';

/**
 * Khối "PHÊ DUYỆT CHỐT CÔNG NHÂN SỰ THÁNG" (hiện ở cả 3 tab) của trang Phê duyệt — tách nguyên khối ra khỏi
 * src/pages/Approvals.tsx (2026-09-23, yêu cầu HCNS "tách nhỏ trang phê duyệt
 * cho dễ nhìn, đừng bỏ gì cả"): JSX giữ NGUYÊN VĂN, state/hàm của trang cha
 * nhận qua props nên hành vi không đổi.
 */
interface AttendanceFinalizationPanelProps {
  loading: boolean;
  showAttendanceFinalizationPanel: boolean;
  isAdmin: boolean;
  isHR: boolean;
  isManagement: boolean;
  visibleAllWfApprovals: any[];
  displayedAllWfApprovals: any[];
  isAttendanceFinalizationExpanded: boolean;
  setIsAttendanceFinalizationExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  PREVIEW_ROWS: number;
  handleViewAttendanceWfDetails: any;
}

const AttendanceFinalizationPanel: React.FC<AttendanceFinalizationPanelProps> = ({
  loading, showAttendanceFinalizationPanel, isAdmin, isHR, isManagement, visibleAllWfApprovals, displayedAllWfApprovals, isAttendanceFinalizationExpanded, setIsAttendanceFinalizationExpanded, PREVIEW_ROWS, handleViewAttendanceWfDetails,
}) => {
  return (
    <>
        {!loading && showAttendanceFinalizationPanel && (
          <div className="mt-8 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 bg-white p-3 sm:p-5 rounded-lg shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
                <div className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-teal-100">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h1 className="text-lg sm:text-xl font-semibold text-gray-800">PHÊ DUYỆT CHỐT CÔNG NHÂN SỰ THÁNG</h1>
                  <p className="text-xs text-gray-400 mt-0.5">Danh sách các phòng ban theo trạng thái phê duyệt</p>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-gray-100 mt-1 sm:mt-0 justify-end">
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-400">Số phòng ban</div>
                  <div className="text-3xl font-semibold text-teal-600 leading-none mt-1">{visibleAllWfApprovals.length}</div>
                </div>
              </div>
            </div>

            {visibleAllWfApprovals.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-lg px-6 py-10 text-center text-sm text-gray-400 shadow-sm">
                Không có dữ liệu phê duyệt chốt công cho trạng thái này.
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-teal-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-10">STT</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Phòng ban</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tháng/Năm</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Trạng thái</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Người gửi</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Người duyệt</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Thời gian duyệt</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ghi chú</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-50">
                      {displayedAllWfApprovals.map((item, index) => {
                        const statusColors: Record<string, string> = {
                          PENDING: 'bg-amber-100 text-amber-700',
                          APPROVED: 'bg-emerald-100 text-emerald-700',
                          REJECTED: 'bg-red-100 text-red-700',
                        };
                        const statusLabels: Record<string, string> = {
                          PENDING: 'Chờ duyệt',
                          APPROVED: 'Đã duyệt',
                          REJECTED: 'Từ chối',
                        };
                        return (
                          <tr key={`attn-fin-${item.id}`} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-400 text-sm">{index + 1}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{item.department_name || item.department_code}</div>
                              <div className="text-xs text-gray-400 font-mono">{item.department_code}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{item.month}/{item.year}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[item.status] || 'bg-gray-100 text-gray-600'}`}>
                                {statusLabels[item.status] || item.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.sent_by_name || '—'}</td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.approved_by_name || '—'}</td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {item.approved_at ? new Date(item.approved_at).toLocaleDateString('vi-VN') : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{item.note || '—'}</td>
                            <td className="px-4 py-3 text-right">
                              {item.status === 'PENDING' && (isAdmin || isHR || isManagement) && (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleViewAttendanceWfDetails(item)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors"
                                  >
                                    Chi tiết
                                  </button>
                                </div>
                              )}
                              {item.status === 'APPROVED' && (
                                <button
                                  onClick={() => handleViewAttendanceWfDetails(item)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                                >
                                  Xem chi tiết
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {visibleAllWfApprovals.length > PREVIEW_ROWS && (
                  <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60 flex justify-center">
                    <button
                      onClick={() => setIsAttendanceFinalizationExpanded((prev) => !prev)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md border border-teal-200 text-teal-700 bg-white hover:bg-teal-50 transition-colors"
                    >
                      {isAttendanceFinalizationExpanded
                        ? 'Thu gọn'
                        : `Xem thêm ${visibleAllWfApprovals.length - PREVIEW_ROWS} dòng`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
    </>
  );
};

export default AttendanceFinalizationPanel;
