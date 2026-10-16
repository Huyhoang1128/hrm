import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Asset, assetMaintenanceAPI } from '../../utils/api';
import FeedbackDialog from '../../components/FeedbackDialog';

interface AssetMaintenanceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: Asset;
}

const MAINTENANCE_TYPE_SUGGESTIONS = ['Bảo trì định kỳ', 'Sửa chữa', 'Bảo hành', 'Vệ sinh', 'Nâng cấp'];

export default function AssetMaintenanceFormModal({ isOpen, onClose, onSuccess, asset }: AssetMaintenanceFormModalProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    maintenance_date: new Date().toISOString().split('T')[0],
    maintenance_type: '',
    description: '',
    cost: '',
    performed_by: '',
    result: '',
    next_maintenance_date: '',
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        maintenance_date: new Date().toISOString().split('T')[0],
        maintenance_type: '',
        description: '',
        cost: '',
        performed_by: '',
        result: '',
        next_maintenance_date: '',
      });
    }
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isFormValid = () => formData.maintenance_date !== '' && formData.maintenance_type.trim() !== '' && formData.description.trim() !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid()) return;
    setLoading(true);
    try {
      await assetMaintenanceAPI.create({
        asset_id: asset.id,
        maintenance_date: formData.maintenance_date,
        maintenance_type: formData.maintenance_type,
        description: formData.description,
        cost: formData.cost ? parseFloat(formData.cost) : undefined,
        performed_by: formData.performed_by || undefined,
        result: formData.result || undefined,
        next_maintenance_date: formData.next_maintenance_date || undefined,
      } as any);
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error creating maintenance record:', error);
      setErrorMessage(error.response?.data?.error || error.message || 'Có lỗi xảy ra khi lưu bản ghi bảo trì.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Transition show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-[60]" onClose={onClose}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
            leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </TransitionChild>

          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <DialogTitle as="h3" className="text-base font-bold text-gray-900">
                      Thêm bản ghi bảo trì / bảo hành
                    </DialogTitle>
                    <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors" onClick={onClose}>
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="px-6 py-5 space-y-4">
                    <div className="bg-primary-50 border border-primary-200 p-3 rounded-2xl">
                      <p className="text-sm text-primary-800">
                        <strong>Tài sản:</strong> [{asset.asset_code}] {asset.name}
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div>
                        <label htmlFor="maintenance_date" className="block text-xs font-medium text-gray-600 mb-1">Ngày bảo trì <span className="text-red-500">*</span></label>
                        <input type="date" name="maintenance_date" id="maintenance_date" value={formData.maintenance_date} onChange={handleChange} className="input-field" required />
                      </div>

                      <div>
                        <label htmlFor="maintenance_type" className="block text-xs font-medium text-gray-600 mb-1">Loại bảo trì <span className="text-red-500">*</span></label>
                        <input type="text" name="maintenance_type" id="maintenance_type" list="maintenance-type-suggestions" value={formData.maintenance_type} onChange={handleChange}
                          className="input-field" placeholder="VD: Bảo trì định kỳ" required />
                        <datalist id="maintenance-type-suggestions">
                          {MAINTENANCE_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
                        </datalist>
                      </div>

                      <div>
                        <label htmlFor="description" className="block text-xs font-medium text-gray-600 mb-1">Mô tả công việc <span className="text-red-500">*</span></label>
                        <textarea name="description" id="description" rows={3} value={formData.description} onChange={handleChange} className="input-field" required />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="cost" className="block text-xs font-medium text-gray-600 mb-1">Chi phí</label>
                          <input type="number" name="cost" id="cost" min="0" step="1000" value={formData.cost} onChange={handleChange} className="input-field" placeholder="VNĐ" />
                        </div>
                        <div>
                          <label htmlFor="performed_by" className="block text-xs font-medium text-gray-600 mb-1">Người thực hiện</label>
                          <input type="text" name="performed_by" id="performed_by" value={formData.performed_by} onChange={handleChange} className="input-field" placeholder="Tên đơn vị/người" />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="result" className="block text-xs font-medium text-gray-600 mb-1">Kết quả</label>
                        <textarea name="result" id="result" rows={2} value={formData.result} onChange={handleChange} className="input-field" />
                      </div>

                      <div>
                        <label htmlFor="next_maintenance_date" className="block text-xs font-medium text-gray-600 mb-1">Ngày bảo trì tiếp theo</label>
                        <input type="date" name="next_maintenance_date" id="next_maintenance_date" value={formData.next_maintenance_date} onChange={handleChange} className="input-field" />
                      </div>
                    </form>
                  </div>

                  <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                    <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
                    <button
                      type="button"
                      disabled={loading || !isFormValid()}
                      onClick={handleSubmit as any}
                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Đang lưu...' : 'Lưu bản ghi'}
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>

      <FeedbackDialog
        open={!!errorMessage}
        variant="error"
        title="Không thể lưu bản ghi bảo trì"
        message={errorMessage || ''}
        onClose={() => setErrorMessage(null)}
      />
    </>
  );
}
