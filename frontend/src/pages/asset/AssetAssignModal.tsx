import React, { useState, useEffect, Fragment, useCallback, useMemo } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon, UserIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Asset, assetsAPI, employeesAPI } from '../../utils/api';
import { SelectBox, SelectOption } from '../../components/LandingLayout/SelectBox';
import FeedbackDialog, { FeedbackVariant } from '../../components/FeedbackDialog';
interface AssetAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: Asset;
  onRequestReturn?: () => void;
}

const QUICK_STATUS_TAGS = [
  'Mới 100%',
  'Bình thường',
  'Trầy xước nhẹ',
  'Móp méo vỏ',
  'Màn hình ố/đốm',
  'Bàn phím kẹt',
  'Thiếu phụ kiện',
  'Hỏng hóc nhẹ',
  'Đã vệ sinh sạch'
];

export default function AssetAssignModal({ isOpen, onClose, onSuccess, asset, onRequestReturn }: AssetAssignModalProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showManagerConfirm, setShowManagerConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: FeedbackVariant; title: string; message?: string; closeOnDismiss?: boolean } | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    assigned_to_name?: string;
    assigned_date?: string;
    assigned_by_name?: string;
    assignment_notes?: string;
  } | null>(null);
  const [employees, setEmployees] = useState<SelectOption<string>[]>([]);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const MULTI_HOLDER_TYPES = ['MONITOR', 'OTHER'];
  const hasQuantity = MULTI_HOLDER_TYPES.includes(asset.asset_type);
  const isMultiHolder = hasQuantity && (asset.total_quantity ?? 1) > 1;
  const totalQty = asset.total_quantity ?? 1;
  const remainingQty = asset.remaining_quantity ?? totalQty;
  const [formData, setFormData] = useState({
    employee_id: '',
    assigned_date: new Date().toISOString().split('T')[0],
    notes: '',
    quantity: 1,
  });

  const fetchEmployees = useCallback(async () => {
    try {
      // Get all active employees since an asset can be assigned to anyone, not just in the same department.
      // page_size 5000 = mức trần backend cho phép (hrm/pagination.py: max_page_size), khớp với
      // WorkFinalization.tsx — tránh cắt mất NV nếu công ty có > 500 nhân viên đang hoạt động.
      const data = await employeesAPI.list({ page_size: 5000, is_active: true });
      const options = (data.results || []).map((emp) => ({
        value: String(emp.id),
        label: `${emp.full_name} (${emp.employee_id}) - ${emp.department?.name || 'Loading...'}`,
      }));
      setEmployees(options);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const defaultQty = hasQuantity ? Math.max(1, remainingQty) : 1;
      setFormData({
        employee_id: '',
        assigned_date: new Date().toISOString().split('T')[0],
        notes: '',
        quantity: defaultQty,
      });
      setQuantityError(null);
      fetchEmployees();
    }
  }, [isOpen, asset, fetchEmployees]);

  const handleEmployeeChange = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, employee_id: val }));
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleTagClick = useCallback((tag: string) => {
    setFormData((prev) => {
      const currentNotes = prev.notes.trim();
      if (!currentNotes) return { ...prev, notes: tag };
      if (currentNotes.includes(tag)) return prev; // Avoid duplicates
      return { ...prev, notes: `${currentNotes}, ${tag}` };
    });
  }, []);

  const selectedEmployeeLabel = useMemo(() => {
    const match = employees.find((e) => e.value === formData.employee_id);
    return match?.label || '';
  }, [employees, formData.employee_id]);

  const handleSubmit = async (
    e: React.FormEvent | null,
    opts: { isForced?: boolean; skipDialog?: boolean; overridePending?: boolean } = {},
  ) => {
    if (e) e.preventDefault();
    const { isForced = false, skipDialog = false, overridePending = false } = opts;
    const selectedId = parseInt(formData.employee_id);
    const currentId = asset.assigned_to;
    // Một số response (list endpoint) chỉ trả assigned_to_name, không có ID.
    // Dùng tên làm fallback để detect "đang có người giữ".
    const hasCurrentHolder = !!asset.assigned_to_name || !!currentId;

    // Nếu chọn đúng người đang giữ → không làm gì, đóng modal
    if (currentId && selectedId === currentId && !isMultiHolder) {
      onClose();
      return;
    }

    // Multi-holder (MONITOR qty>1): bỏ forced transfer dialog, validate quantity inline.
    if (isMultiHolder) {
      if (!formData.quantity || formData.quantity < 1) {
        setQuantityError(`Vui lòng nhập số lượng (còn lại ${remainingQty} màn hình)`);
        return;
      }
      if (formData.quantity > remainingQty) {
        setQuantityError(`Chỉ còn ${remainingQty} màn hình khả dụng`);
        return;
      }
      setQuantityError(null);
    } else if (hasCurrentHolder && !isForced && !overridePending) {
      // Non-multi-holder: giữ forced transfer dialog
      setShowConfirmDialog(true);
      return;
    }

    // Proactive pending check: nếu asset đang có pending assignment → hiện conflict dialog ngay,
    // không cần round-trip API để discover.
    if (!overridePending && asset.pending_assignment) {
      setShowConfirmDialog(false);
      setShowManagerConfirm(false);
      setPendingConflict({
        assigned_to_name: asset.pending_assignment.assigned_to_name,
        assigned_date: asset.pending_assignment.assigned_date,
        assigned_by_name: asset.pending_assignment.assigned_by_name,
        assignment_notes: asset.pending_assignment.assignment_notes,
      });
      return;
    }

    // Nếu chưa qua bước manager confirm dialog (và không phải từ force/override flow) → hiện dialog
    if (!skipDialog && !isForced && !overridePending) {
      setShowManagerConfirm(true);
      return;
    }

    setLoading(true);
    try {
      await assetsAPI.assign(asset.id, {
        employee_id: parseInt(formData.employee_id),
        assigned_date: formData.assigned_date,
        notes: formData.notes,
        force: isForced,
        override_pending: overridePending,
        ...(hasQuantity ? { quantity: formData.quantity } : {}),
      });
      setShowConfirmDialog(false);
      setShowManagerConfirm(false);
      setPendingConflict(null);
      setFeedback({
        variant: 'success',
        title: 'Đã gửi yêu cầu bàn giao',
        message: `Đang chờ ${selectedEmployeeLabel || 'nhân viên'} xác nhận trong ứng dụng. Tài sản chỉ chuyển sang "Đang sử dụng" sau khi nhân viên xác nhận.`,
        closeOnDismiss: true,
      });
    } catch (error: any) {
      console.error('Error assigning asset:', error);
      const existingPending = error.response?.data?.existing_pending;
      if (existingPending) {
        setShowConfirmDialog(false);
        setShowManagerConfirm(false);
        setPendingConflict({
          assigned_to_name: existingPending.assigned_to_name,
          assigned_date: existingPending.assigned_date,
          assigned_by_name: existingPending.assigned_by_name,
          assignment_notes: existingPending.assignment_notes,
        });
      } else {
        const data = error.response?.data || {};
        const errorCode = data.error_code as string | undefined;
        const serverError = data.error || 'Có lỗi xảy ra khi bàn giao tài sản.';
        if (errorCode === 'QUANTITY_OVER_LIMIT') {
          setShowConfirmDialog(false);
          setShowManagerConfirm(false);
          setFeedback({
            variant: 'warning',
            title: 'Không đủ số lượng trong kho',
            message: `Tài sản chỉ còn ${data.remaining_quantity ?? '?'} màn hình khả dụng. Bạn yêu cầu ${data.requested_quantity ?? formData.quantity}. Vui lòng giảm số lượng bàn giao.`,
          });
        } else if (errorCode === 'QUANTITY_MISSING') {
          setShowConfirmDialog(false);
          setShowManagerConfirm(false);
          setQuantityError(`Vui lòng nhập số lượng (còn lại ${data.remaining_quantity ?? remainingQty} màn hình)`);
        } else if (errorCode === 'NOT_MULTI_HOLDER_TYPE') {
          setFeedback({
            variant: 'error',
            title: 'Loại tài sản không hỗ trợ',
            message: 'Chỉ Màn hình mới có thể bàn giao nhiều đơn vị cùng lúc.',
          });
        } else {
          setFeedback({
            variant: 'error',
            title: 'Không thể bàn giao',
            message: serverError,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFeedbackClose = () => {
    const shouldCloseModal = feedback?.closeOnDismiss;
    setFeedback(null);
    if (shouldCloseModal) {
      onSuccess();
      onClose();
    }
  };

  const isUnusable = asset.condition === 'BROKEN' || asset.condition === 'POOR';
  const isFormValid = formData.employee_id.trim() !== '' && !isUnusable && !quantityError;

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </TransitionChild>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <DialogTitle as="h3" className="text-base font-semibold leading-6 text-gray-900">
                    Bàn giao tài sản thiết bị
                  </DialogTitle>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-500 transition-colors"
                    onClick={onClose}
                  >
                    <span className="sr-only">Đóng</span>
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="px-6 py-4">
                  {/* Asset Info Block */}
                  <div className={`mb-4 p-4 rounded-xl border ${asset.assigned_to_name ? 'bg-amber-50 border-amber-200' : 'bg-primary-50 border-primary-100'}`}>
                    <div className="flex justify-between items-start">
                      <p className={`text-sm ${asset.assigned_to_name ? 'text-amber-800' : 'text-primary-800'}`}>
                        <strong>Tài sản:</strong> [{asset.asset_code}] {asset.name}
                      </p>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold border uppercase tracking-tight ${
                        asset.condition === 'EXCELLENT' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                        asset.condition === 'GOOD' ? 'bg-primary-100 text-primary-700 border-primary-200' :
                        asset.condition === 'FAIR' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                        'bg-red-100 text-red-700 border-red-200'
                      }`}>
                        {asset.condition_display}
                      </span>
                    </div>
                    {asset.assigned_to_name && (
                      <div className="mt-3 bg-white/60 backdrop-blur-sm rounded-lg p-2.5 border border-amber-200">
                        <p className="text-xs text-amber-700 flex items-center gap-2 font-semibold">
                          <UserIcon className="h-4 w-4 text-amber-500" />
                          Đang được sử dụng bởi: <span className="text-amber-900">{asset.assigned_to_name}</span>
                        </p>
                      </div>
                    )}
                    {isUnusable && (
                      <div className="mt-3 bg-rose-50 border-rose-200 border rounded-lg p-3">
                        <p className="text-xs text-rose-700 font-bold flex items-center gap-2 uppercase tracking-wide">
                          <svg className="h-4 w-4 text-rose-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                          Không thể bàn giao: Tình trạng thiết bị hỏng hoặc kém ({asset.condition_display})
                        </p>
                        <p className="text-[10px] text-rose-600 mt-1 italic">Vui lòng điều chỉnh tình trạng vật lý sang Tốt hoặc Bình thường trước khi thực hiện bàn giao.</p>
                      </div>
                    )}
                  </div>

                  <form id="assign-form" onSubmit={handleSubmit} className="space-y-4">
                    <SelectBox
                      label="Nhân viên nhận bàn giao"
                      value={formData.employee_id}
                      options={employees}
                      onChange={handleEmployeeChange}
                      placeholder="Tìm kiếm mã, tên nhân viên"
                      searchable={true}
                      maxResults={500}
                    />

                    <div>
                      <label htmlFor="assigned_date" className="block text-xs font-medium text-gray-600 mb-1">Ngày bàn giao</label>
                      <input
                        type="date"
                        name="assigned_date"
                        id="assigned_date"
                        value={formData.assigned_date}
                        onChange={handleChange}
                        className="input-field"
                        required
                      />
                    </div>

                    {hasQuantity && (
                      <div>
                        <label htmlFor="quantity" className="block text-xs font-medium text-gray-600 mb-1">
                          Số lượng bàn giao
                        </label>
                        <input
                          type="number"
                          name="quantity"
                          id="quantity"
                          min={1}
                          max={remainingQty}
                          value={formData.quantity}
                          onChange={(e) => {
                            const n = parseInt(e.target.value) || 0;
                            setFormData((prev) => ({ ...prev, quantity: n }));
                            if (n > remainingQty) {
                              setQuantityError(`Chỉ còn ${remainingQty} màn hình khả dụng`);
                            } else if (n < 1) {
                              setQuantityError('Số lượng tối thiểu là 1');
                            } else {
                              setQuantityError(null);
                            }
                          }}
                          className={`input-field ${quantityError ? 'border-red-400 focus:ring-red-500' : ''}`}
                          required
                        />
                        {quantityError ? (
                          <p className="mt-1 text-xs text-red-600">{quantityError}</p>
                        ) : (
                          <p className="mt-1 text-xs text-gray-500">
                            Còn lại {remainingQty} màn hình có thể bàn giao
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <div className="flex justify-between items-end mb-1">
                        <label htmlFor="notes" className="block text-xs font-medium text-gray-600">Ghi chú tình trạng lúc giao</label>
                        <span className="text-[10px] text-gray-400">Chọn nhanh bên dưới</span>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-2">
                        {QUICK_STATUS_TAGS.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => handleTagClick(tag)}
                            className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10 hover:bg-primary-50 hover:text-primary-700 hover:ring-primary-700/30 transition-all active:scale-95"
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>

                      <textarea
                        name="notes"
                        id="notes"
                        rows={3}
                        value={formData.notes}
                        onChange={handleChange}
                        className="input-field"
                        placeholder="Mô tả cụ thể tình trạng (VD: Chuột móp, màn trầy...)"
                      />
                    </div>
                  </form>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-row-reverse gap-3">
                  <button
                    type="submit"
                    form="assign-form"
                    disabled={loading || !isFormValid}
                    className={`btn-primary ${(!isFormValid || loading) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {loading ? 'Đang lưu...' : 'Xác nhận Bàn Giao'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={onClose}
                  >
                    Hủy
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>

      {/* Confirmation Dialog for Forced Transfer - Senior UX Style */}
      <Transition show={showConfirmDialog} as={Fragment}>
        <Dialog as="div" className="relative z-[60]" onClose={() => setShowConfirmDialog(false)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" />
          </TransitionChild>

          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white p-6 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 sm:mx-0 sm:h-10 sm:w-10">
                      <svg className="h-6 w-6 text-rose-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                      <DialogTitle as="h3" className="text-base font-bold leading-6 text-gray-900 uppercase">
                        Cần thu hồi trước khi bàn giao
                      </DialogTitle>
                      <div className="mt-3 bg-rose-50 p-3 rounded-xl border border-rose-100">
                        <p className="text-sm text-gray-600">
                          Tài sản này đang được sử dụng bởi <span className="text-rose-800 font-bold underline">{asset.assigned_to_name}</span>.
                        </p>
                      </div>
                      <p className="text-sm text-gray-500 mt-3 leading-relaxed">
                        Bạn cần <strong>thu hồi tài sản</strong> từ người đang giữ trước, sau đó mới có thể bàn giao cho người khác. Thao tác này đảm bảo lịch sử bàn giao được ghi nhận đầy đủ.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col sm:flex-row-reverse gap-3">
                    <button
                      type="button"
                      className="btn-danger w-full justify-center"
                      onClick={() => { onRequestReturn?.(); onClose(); }}
                    >
                      Thu hồi ngay
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full justify-center"
                      onClick={() => setShowConfirmDialog(false)}
                    >
                      Hủy thao tác
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Pending conflict dialog — asset đã có PENDING cho người khác */}
      <Transition show={!!pendingConflict} as={Fragment}>
        <Dialog as="div" className="relative z-[65]" onClose={() => setPendingConflict(null)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" />
          </TransitionChild>

          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white p-6 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 sm:mx-0 sm:h-10 sm:w-10">
                      <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="mt-3 flex-1 text-center sm:ml-4 sm:mt-0 sm:text-left">
                      <DialogTitle as="h3" className="text-base font-bold leading-6 text-gray-900">
                        Đã có yêu cầu bàn giao chờ xác nhận
                      </DialogTitle>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <p>
                          Tài sản <span className="font-semibold text-gray-900">[{asset.asset_code}] {asset.name}</span> đang có một yêu cầu bàn giao:
                        </p>
                        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 space-y-1">
                          <p className="text-sm font-semibold text-amber-900">
                            Nhận máy: {pendingConflict?.assigned_to_name || '—'}
                          </p>
                          {pendingConflict?.assigned_date && (
                            <p className="text-xs text-amber-800">
                              Ngày bàn giao: {new Date(pendingConflict.assigned_date).toLocaleDateString('vi-VN')}
                            </p>
                          )}
                          {pendingConflict?.assigned_by_name && (
                            <p className="text-xs text-amber-800">
                              Người gửi: {pendingConflict.assigned_by_name}
                            </p>
                          )}
                          {pendingConflict?.assignment_notes && (
                            <p className="text-xs italic text-amber-800">
                              Ghi chú: {pendingConflict.assignment_notes}
                            </p>
                          )}
                        </div>
                        <p className="text-xs italic text-gray-500">
                          Bạn có muốn <strong>hủy yêu cầu trên</strong> và tạo yêu cầu bàn giao mới cho <span className="font-semibold text-gray-900">{selectedEmployeeLabel || 'nhân viên đã chọn'}</span>?
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col sm:flex-row-reverse gap-3">
                    <button
                      type="button"
                      disabled={loading}
                      className={`inline-flex w-full justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-amber-700 transition-all active:scale-95 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => handleSubmit(null, { overridePending: true })}
                    >
                      {loading ? 'Đang xử lý...' : 'Hủy yêu cầu cũ & tạo mới'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full justify-center"
                      onClick={() => setPendingConflict(null)}
                    >
                      Hủy thao tác
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Feedback dialog (success / error) */}
      <FeedbackDialog
        open={!!feedback}
        variant={feedback?.variant}
        title={feedback?.title || ''}
        message={feedback?.message}
        onClose={handleFeedbackClose}
      />

      {/* Manager confirm dialog — normal path (no existing assignee) */}
      <Transition show={showManagerConfirm} as={Fragment}>
        <Dialog as="div" className="relative z-[60]" onClose={() => setShowManagerConfirm(false)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" />
          </TransitionChild>

          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white p-6 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 sm:mx-0 sm:h-10 sm:w-10">
                      <InformationCircleIcon className="h-6 w-6 text-primary-600" />
                    </div>
                    <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                      <DialogTitle as="h3" className="text-base font-bold leading-6 text-gray-900">
                        Xác nhận gửi yêu cầu bàn giao
                      </DialogTitle>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <p>
                          Tài sản <span className="font-semibold text-gray-900">[{asset.asset_code}] {asset.name}</span> sẽ được gửi yêu cầu bàn giao đến:
                        </p>
                        <p className="rounded-xl bg-primary-50 border border-primary-100 px-3 py-2 font-semibold text-primary-800">
                          {selectedEmployeeLabel || 'Nhân viên đã chọn'}
                        </p>
                        <p className="text-xs italic text-gray-500">
                          Nhân viên sẽ cần vào ứng dụng để <strong>xác nhận</strong> hoặc <strong>từ chối</strong>. Asset chỉ thực sự chuyển sang "Đang sử dụng" sau khi nhân viên xác nhận.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col sm:flex-row-reverse gap-3">
                    <button
                      type="button"
                      disabled={loading}
                      className={`btn-primary w-full justify-center ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => handleSubmit(null, { skipDialog: true })}
                    >
                      {loading ? 'Đang xử lý...' : 'Xác nhận gửi'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full justify-center"
                      onClick={() => setShowManagerConfirm(false)}
                    >
                      Hủy
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </Transition>
  );
}
