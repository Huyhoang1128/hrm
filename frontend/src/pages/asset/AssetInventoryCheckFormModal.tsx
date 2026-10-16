import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Asset, assetInventoryChecksAPI, employeesAPI } from '../../utils/api';
import { SelectBox, SelectOption } from '../../components/LandingLayout/SelectBox';
import FeedbackDialog from '../../components/FeedbackDialog';

interface AssetInventoryCheckFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: Asset;
}

const ASSET_CONDITIONS: SelectOption<string>[] = [
  { value: 'EXCELLENT', label: 'Rất tốt' },
  { value: 'GOOD', label: 'Tốt' },
  { value: 'FAIR', label: 'Khá' },
  { value: 'POOR', label: 'Kém' },
  { value: 'BROKEN', label: 'Hỏng' },
];

const INVENTORY_CHECK_RESULTS: SelectOption<string>[] = [
  { value: 'MATCH', label: 'Khớp' },
  { value: 'MISSING', label: 'Thiếu / không tìm thấy' },
  { value: 'DAMAGED', label: 'Hư hỏng' },
  { value: 'WRONG_HOLDER', label: 'Sai vị trí / người giữ' },
  { value: 'OTHER', label: 'Khác' },
];

export default function AssetInventoryCheckFormModal({ isOpen, onClose, onSuccess, asset }: AssetInventoryCheckFormModalProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [employees, setEmployees] = useState<SelectOption<string>[]>([]);
  const [formData, setFormData] = useState({
    check_date: new Date().toISOString().split('T')[0],
    checked_by: '',
    actual_condition: asset.condition || 'GOOD',
    result: 'MATCH',
    notes: '',
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        check_date: new Date().toISOString().split('T')[0],
        checked_by: '',
        actual_condition: asset.condition || 'GOOD',
        result: 'MATCH',
        notes: '',
      });
      employeesAPI.list({ page_size: 200, is_active: true })
        .then((data) => {
          const options = (data.results || []).map((emp) => ({
            value: String(emp.id),
            label: `${emp.full_name} (${emp.employee_id})`,
          }));
          setEmployees(options);
        })
        .catch((err) => console.error('Error fetching employees:', err));
    }
  }, [isOpen, asset]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await assetInventoryChecksAPI.create({
        asset_id: asset.id,
        check_date: formData.check_date,
        checked_by_id: formData.checked_by ? parseInt(formData.checked_by) : undefined,
        actual_condition: formData.actual_condition || undefined,
        result: formData.result as any,
        notes: formData.notes || undefined,
      } as any);
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error creating inventory check record:', error);
      setErrorMessage(error.response?.data?.error || error.message || 'Có lỗi xảy ra khi lưu bản ghi kiểm kê.');
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
                      Thêm bản ghi kiểm kê
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
                        <label htmlFor="check_date" className="block text-xs font-medium text-gray-600 mb-1">Ngày kiểm kê <span className="text-red-500">*</span></label>
                        <input type="date" name="check_date" id="check_date" value={formData.check_date}
                          onChange={(e) => handleSelectChange('check_date', e.target.value)} className="input-field" required />
                      </div>

                      <SelectBox
                        label="Người kiểm kê"
                        value={formData.checked_by}
                        options={employees}
                        onChange={(val) => handleSelectChange('checked_by', val)}
                        placeholder="-- Chọn người kiểm kê --"
                        searchable
                      />

                      <SelectBox
                        label="Tình trạng thực tế"
                        value={formData.actual_condition}
                        options={ASSET_CONDITIONS}
                        onChange={(val) => handleSelectChange('actual_condition', val)}
                      />

                      <SelectBox
                        label="Kết quả kiểm kê"
                        value={formData.result}
                        options={INVENTORY_CHECK_RESULTS}
                        onChange={(val) => handleSelectChange('result', val)}
                      />

                      <div>
                        <label htmlFor="notes" className="block text-xs font-medium text-gray-600 mb-1">Ghi chú</label>
                        <textarea name="notes" id="notes" rows={3} value={formData.notes} onChange={handleChange} className="input-field" />
                      </div>
                    </form>
                  </div>

                  <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                    <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
                    <button
                      type="button"
                      disabled={loading}
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
        title="Không thể lưu bản ghi kiểm kê"
        message={errorMessage || ''}
        onClose={() => setErrorMessage(null)}
      />
    </>
  );
}
