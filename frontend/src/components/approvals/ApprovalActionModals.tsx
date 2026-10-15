import React from 'react';

/**
 * 5 modal thao tác của trang Phê duyệt — tách nguyên khối ra khỏi
 * src/pages/Approvals.tsx (2026-09-23, yêu cầu HCNS "tách nhỏ trang phê duyệt
 * cho dễ nhìn, đừng bỏ gì cả"): JSX bên dưới được giữ NGUYÊN VĂN, chỉ thay
 * việc đọc state/hàm của component cha bằng props.
 *
 *   1. Duyệt/Từ chối 1 đơn (kèm ghi chú)
 *   2. Xác nhận huỷ đơn
 *   3. Thông báo lỗi
 *   4. Xác nhận duyệt hàng loạt
 *   5. Kết quả duyệt hàng loạt
 */
interface ApprovalActionModalsProps {
  // 1. Duyệt/Từ chối
  actionModalOpen: boolean;
  setActionModalOpen: (open: boolean) => void;
  actionType: 'APPROVE' | 'REJECT' | 'DELETE' | null;
  targetItem: any;
  approvalNote: string;
  setApprovalNote: (note: string) => void;
  isProcessing: boolean;
  confirmAction: () => void;
  // 2. Xoá/huỷ đơn
  deleteModalOpen: boolean;
  setDeleteModalOpen: (open: boolean) => void;
  confirmDelete: () => void;
  currentEmployee: any;
  // 3. Lỗi
  errorModalOpen: boolean;
  setErrorModalOpen: (open: boolean) => void;
  errorMessage: string;
  // 4 + 5. Duyệt hàng loạt
  bulkConfirmModal: any;
  setBulkConfirmModal: (value: any) => void;
  executeBulkApprove: () => void;
  bulkActionResult: any;
  setBulkActionResult: (value: any) => void;
  // Hàm format dùng chung, giữ nguyên của trang cha để không lệch hiển thị
  formatDate: (dateString: string) => string;
  getRequestTypeLabel: (req: any) => string;
}

const ApprovalActionModals: React.FC<ApprovalActionModalsProps> = ({
  actionModalOpen, setActionModalOpen, actionType, targetItem,
  approvalNote, setApprovalNote, isProcessing, confirmAction,
  deleteModalOpen, setDeleteModalOpen, confirmDelete, currentEmployee,
  errorModalOpen, setErrorModalOpen, errorMessage,
  bulkConfirmModal, setBulkConfirmModal, executeBulkApprove,
  bulkActionResult, setBulkActionResult,
  formatDate, getRequestTypeLabel,
}) => {
  return (
    <>
      {/* 1. Modal Duyệt/Từ chối với Ghi chú */}
      {actionModalOpen && targetItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100] transition-all">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full overflow-hidden">
            {/* Header */}
            <div className={`px-6 py-4 flex items-center gap-3 border-b ${actionType === 'APPROVE' ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <div className={`p-2 rounded-full ${actionType === 'APPROVE' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                {actionType === 'APPROVE' ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                )}
              </div>
              <h3 className={`text-lg font-bold ${actionType === 'APPROVE' ? 'text-emerald-800' : 'text-red-800'}`}>
                {actionType === 'APPROVE' ? 'Phê duyệt yêu cầu' : 'Từ chối yêu cầu'}
              </h3>
            </div>

            {/* Content */}
            <div className="p-6">
              {targetItem._groupedIds?.length > 1 && (
                <div className="mb-4 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-lg text-sm text-violet-700">
                  Đây là đơn nghỉ không phép nhiều ngày liên tiếp — hành động này sẽ áp dụng cho
                  cả <strong>{targetItem._groupedIds.length} ngày</strong>, từ{' '}
                  <strong>{formatDate(targetItem.start_date)}</strong> đến{' '}
                  <strong>{formatDate(targetItem.end_date)}</strong>.
                </div>
              )}
              <div className="mb-4">
                <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-2">Nội dung ghi chú:</p>
                <textarea
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all h-24 text-base font-medium"
                  placeholder="Nhập ghi chú phản hồi..."
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  disabled={isProcessing}
                  onClick={() => setActionModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-100 transition-all text-base"
                >
                  Hủy
                </button>
                <button
                  disabled={isProcessing}
                  onClick={confirmAction}
                  className={`flex-1 px-4 py-2.5 text-white font-bold rounded-lg shadow-lg transition-all text-base flex items-center justify-center gap-2 ${actionType === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50' : 'bg-red-600 hover:bg-red-700 shadow-red-200/50'}`}
                >
                  {isProcessing ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : actionType === 'APPROVE' ? 'Xác nhận Duyệt' : 'Xác nhận Từ chối'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal Xác nhận Xóa */}
      {deleteModalOpen && targetItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Xác nhận huỷ đơn?</h3>
              <p className="text-base text-gray-500 leading-relaxed">
                {targetItem.employee_id === currentEmployee?.id ? (
                  <>
                    Bạn có chắc chắn muốn huỷ đơn <span className="font-bold text-gray-800">{getRequestTypeLabel(targetItem)}</span> của mình?
                  </>
                ) : (
                  <>
                    Bạn đang chuẩn bị huỷ đơn <span className="font-bold text-gray-800">{getRequestTypeLabel(targetItem)}</span> của <br />
                    <span className="font-bold text-gray-800">{targetItem.employee_name}</span>.
                  </>
                )}
                {targetItem._groupedIds?.length > 1 && (
                  <>
                    <br />
                    (Đơn nghỉ không phép nhiều ngày — sẽ huỷ cả <span className="font-bold text-gray-800">{targetItem._groupedIds.length} ngày</span>, từ {formatDate(targetItem.start_date)} đến {formatDate(targetItem.end_date)})
                  </>
                )}
                <br />
                Hành động này <span className="text-red-600 font-bold underline">không thể hoàn tác</span>.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex flex-col sm:flex-row gap-3">
              <button
                disabled={isProcessing}
                onClick={() => setDeleteModalOpen(false)}
                className="flex-1 w-full sm:w-auto px-4 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-100 transition-all text-base order-last sm:order-first"
              >
                Hủy
              </button>
              <button
                disabled={isProcessing}
                onClick={confirmDelete}
                className="flex-1 w-full sm:w-auto px-4 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all text-base flex items-center justify-center gap-2 shadow-lg shadow-red-200/50 disabled:bg-gray-400 disabled:shadow-none"
              >
                {isProcessing ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : 'Đồng ý huỷ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal Thông báo Lỗi */}
      {errorModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[110]">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Thông báo</h3>
              <p className="text-base text-gray-500 leading-relaxed whitespace-pre-line">
                {errorMessage}
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex gap-3">
              <button
                onClick={() => setErrorModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all text-base shadow-lg shadow-red-200"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal Xác nhận Duyệt hàng loạt (Smart) */}
      {bulkConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[110]">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="bg-emerald-600 px-6 py-4 flex items-center gap-3 flex-shrink-0">
              <div className="p-2 bg-white/20 rounded-lg text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              </div>
              <h3 className="text-lg font-bold text-white">Xác nhận duyệt nhanh</h3>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-gray-600 mb-2 leading-relaxed">
                Bạn đang thực hiện duyệt nhanh cho <span className="font-semibold text-gray-900">{(bulkConfirmModal as any).name}</span>.
              </p>

              <div className="flex gap-2 mb-6">
                <div className="flex-1 bg-emerald-50 border border-emerald-100 p-2 rounded-lg text-center">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-tighter">Sẽ phê duyệt</div>
                  <div className="text-lg font-semibold text-emerald-700">{(bulkConfirmModal as any).approvalItems.length}</div>
                </div>
                <div className="flex-1 bg-rose-50 border border-rose-100 p-2 rounded-lg text-center">
                  <div className="text-xs font-bold text-rose-600 uppercase tracking-tighter">Sẽ từ chối</div>
                  <div className="text-lg font-semibold text-rose-700">{(bulkConfirmModal as any).rejectionItems.length}</div>
                </div>
              </div>

              {/* Phân loại chi tiết trước khi duyệt */}
              {(bulkConfirmModal as any).approvalItems && (bulkConfirmModal as any).rejectionItems && (
                <div className="space-y-6 mb-6">
                  {/* Sẽ được phê duyệt */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      Danh sách phê duyệt
                      <span className="h-[1px] flex-1 bg-gray-100"></span>
                    </p>
                    <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                      {(bulkConfirmModal as any).approvalItems.length > 0 ? (bulkConfirmModal as any).approvalItems.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center p-2.5 bg-gray-50/50 rounded-lg border border-gray-100/50">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className="text-xs font-semibold text-gray-800 leading-none">{item.employee_name}</span>
                              <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 text-[8px] font-semibold rounded border border-primary-100 uppercase tracking-tighter">
                                {item.employee_position || item.position_name || 'NV'}
                              </span>
                              <span className="h-0.5 w-0.5 rounded-full bg-gray-200"></span>
                              <span className="text-xs font-semibold text-gray-400 uppercase leading-none">{getRequestTypeLabel(item)}</span>
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-semibold rounded uppercase">Duyệt</span>
                              {item.is_penalty && (
                                <span className="text-amber-600 font-semibold ml-1 uppercase text-[8px]">
                                  (Bị trừ công)
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-bold text-gray-400 italic">{formatDate(item.attendance_date || item.registration_date || item.work_date || item.start_date)}</span>
                            {(item.reason || item.notes || item.explanation) && (
                              <span className="text-xs text-gray-500 truncate max-w-[220px]" title={item.reason || item.notes || item.explanation}>
                                Lý do: {item.reason || item.notes || item.explanation}
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            {item.penalty_amount > 0 && (
                              <div className="text-xs font-semibold text-emerald-600">{(item.penalty_amount).toLocaleString('vi-VN')} VNĐ</div>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="text-center py-4 text-xs font-bold text-gray-300 uppercase italic">Trống</div>
                      )}
                    </div>
                  </div>

                  {/* Sẽ bị từ chối tự động */}
                  {(bulkConfirmModal as any).rejectionItems.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-rose-400 uppercase tracking-widest flex items-center gap-2">
                        Từ chối (Hết hạn mức)
                        <span className="h-[1px] flex-1 bg-rose-100"></span>
                      </p>
                      <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {(bulkConfirmModal as any).rejectionItems.map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 bg-rose-50/30 rounded-lg border border-rose-100/50 grayscale-[0.5]">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                <span className="text-xs font-semibold text-rose-800/80 leading-none">{item.employee_name}</span>
                                <span className="px-1.5 py-0.5 bg-rose-50 text-rose-800/60 text-[8px] font-semibold rounded border border-rose-100 uppercase tracking-tighter">
                                  {item.employee_position || item.position_name || 'NV'}
                                </span>
                                <span className="h-0.5 w-0.5 rounded-full bg-rose-100"></span>
                                <span className="text-xs font-semibold text-rose-800/50 uppercase leading-none">{getRequestTypeLabel(item)}</span>
                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[8px] font-semibold rounded uppercase">Hết lượt</span>
                              </div>
                              <span className="text-xs font-bold text-rose-400 italic">{formatDate(item.attendance_date || item.registration_date || item.work_date || item.start_date)}</span>
                              {(item.reason || item.notes || item.explanation) && (
                                <span className="text-xs text-rose-400/70 truncate max-w-[220px]" title={item.reason || item.notes || item.explanation}>
                                  Lý do: {item.reason || item.notes || item.explanation}
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              {item.penalty_amount > 0 && (
                                <div className="text-xs font-semibold text-rose-400 line-through">{(item.penalty_amount).toLocaleString('vi-VN')} VNĐ</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}


              <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded-r-lg mb-2">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-amber-700 font-medium leading-relaxed">
                      Hệ thống sẽ tự động ưu tiên duyệt các đơn quan trọng (Quên công, Phạt cao) trong hạn mức còn lại.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex-shrink-0">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setBulkConfirmModal(null)}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={executeBulkApprove}
                  className="flex-1 py-2.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 shadow-lg shadow-emerald-200/50 transition-all font-semibold"
                >
                  Đồng ý duyệt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Modal Kết quả Duyệt hàng loạt */}
      {bulkActionResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[120]">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className={`px-6 py-4 flex items-center gap-3 flex-shrink-0 ${bulkActionResult.backendErrors?.length > 0 ? 'bg-amber-600' : 'bg-emerald-600'}`}>
              <div className="p-2 bg-white/20 rounded-lg text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h3 className="text-lg font-bold text-white">
                {bulkActionResult.backendErrors?.length > 0 ? 'Xử lý xong — có đơn KHÔNG duyệt được' : 'Xử lý hoàn tất!'}
              </h3>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-gray-600 mb-2 leading-relaxed">
                Kết quả duyệt nhanh tại <span className="font-semibold text-gray-900">{bulkActionResult.groupName}</span>.
              </p>

              {/* Lỗi THẬT từ backend (vd quá hạn duyệt) — trước đây bị nuốt mất,
                  chỉ hiện số lượng lỗi chung chung khiến QLTT tưởng đã duyệt hết
                  (case thực tế 2026-09-24: 4 đơn Nghỉ không phép Sale viện quá
                  hạn duyệt bị chặn âm thầm). Hiện rõ TỪNG đơn + lý do cụ thể. */}
              {bulkActionResult.backendErrors?.length > 0 && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                    {bulkActionResult.backendErrors.length} đơn chưa duyệt được — cần xử lý riêng
                  </p>
                  <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                    {bulkActionResult.backendErrors.map((e: { id: number; label: string; error: string }, idx: number) => (
                      <div key={idx} className="text-xs bg-white/70 rounded-md border border-amber-100 p-2">
                        <div className="font-semibold text-amber-900">{e.label}</div>
                        <div className="text-amber-700">{e.error}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mb-6">
                <div className="flex-1 bg-emerald-50 border border-emerald-100 p-2 rounded-lg text-center">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-tighter">Đã phê duyệt</div>
                  <div className="text-lg font-semibold text-emerald-700">{bulkActionResult.approvalItems.length}</div>
                </div>
                <div className="flex-1 bg-rose-50 border border-rose-100 p-2 rounded-lg text-center">
                  <div className="text-xs font-bold text-rose-600 uppercase tracking-tighter">Đã từ chối</div>
                  <div className="text-lg font-semibold text-rose-700">{bulkActionResult.rejectionItems.length}</div>
                </div>
              </div>

              {(bulkActionResult.approvalItems.length > 0 || bulkActionResult.rejectionItems.length > 0) && (
                <div className="space-y-6 mb-6">
                  {/* Đã được phê duyệt */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      Danh sách phê duyệt
                      <span className="h-[1px] flex-1 bg-gray-100"></span>
                    </p>
                    <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                      {bulkActionResult.approvalItems.length > 0 ? bulkActionResult.approvalItems.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center p-2.5 bg-gray-50/50 rounded-lg border border-gray-100/50">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className="text-xs font-semibold text-gray-800 leading-none">{item.employee_name}</span>
                              <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 text-[8px] font-semibold rounded border border-primary-100 uppercase tracking-tighter">
                                {item.employee_position || item.position_name || 'NV'}
                              </span>
                              <span className="h-0.5 w-0.5 rounded-full bg-gray-200"></span>
                              <span className="text-xs font-semibold text-gray-400 uppercase leading-none">{getRequestTypeLabel(item)}</span>
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-semibold rounded uppercase">Đã duyệt</span>
                              {item.is_penalty && (
                                <span className="text-amber-600 font-semibold ml-1 uppercase text-[8px]">
                                  (Bị trừ công)
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-bold text-gray-400 italic">{formatDate(item.attendance_date || item.registration_date || item.work_date || item.start_date)}</span>
                            {(item.reason || item.notes || item.explanation) && (
                              <span className="text-xs text-gray-500 truncate max-w-[220px]" title={item.reason || item.notes || item.explanation}>
                                Lý do: {item.reason || item.notes || item.explanation}
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            {item.penalty_amount > 0 && (
                              <div className="text-xs font-semibold text-emerald-600">{(item.penalty_amount).toLocaleString('vi-VN')} VNĐ</div>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="text-center py-4 text-xs font-bold text-gray-300 uppercase italic">Trống</div>
                      )}
                    </div>
                  </div>

                  {/* Đã bị từ chối */}
                  {bulkActionResult.rejectionItems.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-rose-400 uppercase tracking-widest flex items-center gap-2">
                        Từ chối (Hết hạn mức)
                        <span className="h-[1px] flex-1 bg-rose-100"></span>
                      </p>
                      <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {bulkActionResult.rejectionItems.map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 bg-rose-50/30 rounded-lg border border-rose-100/50 grayscale-[0.5]">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                <span className="text-xs font-semibold text-rose-800/80 leading-none">{item.employee_name}</span>
                                <span className="px-1.5 py-0.5 bg-rose-50 text-rose-800/60 text-[8px] font-semibold rounded border border-rose-100 uppercase tracking-tighter">
                                  {item.employee_position || item.position_name || 'NV'}
                                </span>
                                <span className="h-0.5 w-0.5 rounded-full bg-rose-100"></span>
                                <span className="text-xs font-semibold text-rose-800/50 uppercase leading-none">{getRequestTypeLabel(item)}</span>
                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[8px] font-semibold rounded uppercase">Hết lượt</span>
                              </div>
                              <span className="text-xs font-bold text-rose-400 italic">{formatDate(item.attendance_date || item.registration_date || item.work_date || item.start_date)}</span>
                              {(item.reason || item.notes || item.explanation) && (
                                <span className="text-xs text-rose-400/70 truncate max-w-[220px]" title={item.reason || item.notes || item.explanation}>
                                  Lý do: {item.reason || item.notes || item.explanation}
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              {item.penalty_amount > 0 && (
                                <div className="text-xs font-semibold text-rose-400 line-through">{(item.penalty_amount).toLocaleString('vi-VN')} VNĐ</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 pb-6 flex-shrink-0">
              <button
                onClick={() => setBulkActionResult(null)}
                className="w-full py-3 bg-gray-900 text-white font-bold rounded-lg hover:bg-black transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ApprovalActionModals;
