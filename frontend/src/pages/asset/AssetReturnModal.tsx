import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Asset, assetsAPI } from '../../utils/api';
import { SelectBox } from '../../components/LandingLayout/SelectBox';
import FeedbackDialog from '../../components/FeedbackDialog';

interface AssetReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: Asset;
  historyId?: number;
  holderName?: string;
  holderQuantity?: number;
}

const ASSET_CONDITIONS = [
  { value: 'EXCELLENT', label: 'Mới 100%' },
  { value: 'GOOD', label: 'Cũ (Chất lượng tốt)' },
  { value: 'FAIR', label: 'Cũ (Trầy xước / Cấn móp)' },
  { value: 'POOR', label: 'Cũ (Kém / Lỗi chức năng)' },
  { value: 'BROKEN', label: 'Hỏng (Không hoạt động)' },
];

export default function AssetReturnModal({ isOpen, onClose, onSuccess, asset, historyId, holderName, holderQuantity }: AssetReturnModalProps) {
  const [loading, setLoading] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [returnedFromName, setReturnedFromName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const showQtyInput = !!(holderQuantity && holderQuantity > 1);
  const [returnQty, setReturnQty] = useState(holderQuantity ?? 1);
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    return_date: new Date().toISOString().split('T')[0],
    condition: 'GOOD',
    notes: '',
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        return_date: new Date().toISOString().split('T')[0],
        condition: asset.condition || 'GOOD',
        notes: '',
      });
      setReturnQty(holderQuantity ?? 1);
      setQtyError(null);
    }
  }, [isOpen, asset, holderQuantity]);

  const handleChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    try {
      await assetsAPI.returnAsset(asset.id, {
        return_date: formData.return_date,
        condition: formData.condition,
        notes: formData.notes,
        ...(historyId ? { history_id: historyId } : {}),
        ...(showQtyInput ? { return_quantity: returnQty } : {}),
      });
      setReturnedFromName(holderName || asset.assigned_to_name || '');
      setShowSuccessDialog(true);
    } catch (error: any) {
      console.error('Error returning asset:', error);
      setErrorMessage(error.response?.data?.error || 'Có lỗi xảy ra khi thu hồi tài sản. Vui lòng kiểm tra lại.');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSuccess = () => {
    setShowSuccessDialog(false);
    onSuccess();
    onClose();
  };

  return (
    <>
    <Transition show={isOpen && !showSuccessDialog} as={Fragment}>
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
              <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <DialogTitle as="h3" className="text-base font-bold text-gray-900">
                    {holderName ? `Thu hồi từ ${holderName}` : 'Thu hồi tài sản về kho'}
                  </DialogTitle>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4">
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl">
                    <p className="text-sm text-amber-800">
                      <strong>Tài sản đang thu hồi:</strong> [{asset.asset_code}] {asset.name}
                    </p>
                  </div>
                  {holderName && holderQuantity != null && (
                    <div className="bg-primary-50 p-3 rounded-xl border border-primary-100">
                      <p className="text-sm text-primary-800">
                        <strong>{holderName}</strong> đang giữ <strong>{holderQuantity}</strong>
                      </p>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {showQtyInput && (
                      <div>
                        <label htmlFor="return_qty" className="block text-xs font-medium text-gray-600 mb-1">
                          Số lượng thu hồi
                        </label>
                        <input
                          type="number"
                          id="return_qty"
                          min={1}
                          max={holderQuantity}
                          value={returnQty}
                          onChange={(e) => {
                            const n = parseInt(e.target.value) || 0;
                            setReturnQty(n);
                            if (n > (holderQuantity ?? 1)) {
                              setQtyError(`Tối đa ${holderQuantity} màn hình`);
                            } else if (n < 1) {
                              setQtyError('Số lượng tối thiểu là 1');
                            } else {
                              setQtyError(null);
                            }
                          }}
                          className={`input-field ${qtyError ? 'border-red-400 focus:ring-red-500' : ''}`}
                          required
                        />
                        {qtyError ? (
                          <p className="mt-1 text-xs text-red-600">{qtyError}</p>
                        ) : (
                          <p className="mt-1 text-xs text-gray-500">
                            {holderName} đang giữ {holderQuantity} màn hình
                          </p>
                        )}
                      </div>
                    )}
                    <div>
                      <label htmlFor="return_date" className="block text-xs font-medium text-gray-600 mb-1">Ngày thu hồi</label>
                      <input
                        type="date"
                        name="return_date"
                        id="return_date"
                        value={formData.return_date}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                      />
                    </div>

                    <SelectBox
                      label="Tình trạng lúc thu hồi"
                      value={formData.condition}
                      options={ASSET_CONDITIONS}
                      onChange={(val) => handleChange('condition', val)}
                    />

                    <div>
                      <label htmlFor="notes" className="block text-xs font-medium text-gray-600 mb-1">Ghi chú (Lý do mất, hỏng, v.v)</label>
                      <textarea
                        name="notes"
                        id="notes"
                        rows={3}
                        value={formData.notes}
                        onChange={handleInputChange}
                        className="input-field"
                      />
                    </div>
                  </form>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                  <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
                  <button
                    type="button"
                    disabled={loading || !!qtyError}
                    onClick={handleSubmit as any}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${loading || qtyError ? 'bg-amber-400' : 'bg-amber-600 hover:bg-amber-700'}`}
                  >
                    {loading ? 'Đang lưu...' : 'Xác nhận Thu Hồi'}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>

    {/* Error feedback dialog */}
    <FeedbackDialog
      open={!!errorMessage}
      variant="error"
      title="Không thể thu hồi tài sản"
      message={errorMessage || ''}
      onClose={() => setErrorMessage(null)}
    />

    {/* Success dialog sau khi thu hồi thành công */}
    <Transition show={showSuccessDialog} as={Fragment}>
        <Dialog as="div" className="relative z-[60]" onClose={handleCloseSuccess}>
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
                <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white p-6 text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 sm:mx-0 sm:h-10 sm:w-10">
                      <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
                    </div>
                    <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                      <DialogTitle as="h3" className="text-base font-bold leading-6 text-gray-900">
                        Tài sản đã được thu hồi
                      </DialogTitle>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <p>
                          Tài sản <span className="font-semibold text-gray-900">[{asset.asset_code}] {asset.name}</span>
                          {returnedFromName ? (
                            <> đã được thu hồi từ <span className="font-semibold text-gray-900">{returnedFromName}</span>{holderQuantity != null && <> (<strong>{holderQuantity}</strong>)</>} về kho.</>
                          ) : (
                            <> đã được thu hồi về kho.</>
                          )}
                        </p>
                        <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800">
                          Trạng thái hiện tại: <strong>Sẵn dùng (Trong kho)</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 sm:flex sm:flex-row-reverse">
                    <button
                      type="button"
                      className="inline-flex w-full justify-center rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition-all active:scale-95 sm:w-auto"
                      onClick={handleCloseSuccess}
                    >
                      OK
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
