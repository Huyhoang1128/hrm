import React, { useState, useEffect, Fragment, useCallback } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Asset, assetsAPI, employeesAPI } from '../../utils/api';
import { SelectBox, SelectOption } from '../../components/LandingLayout/SelectBox';

interface AssetBulkAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assets: Asset[];
}

type ResultItem = { asset: Asset; status: 'success' | 'error'; message?: string };

const MULTI_HOLDER_TYPES = ['MONITOR', 'OTHER'];

const ASSET_TYPE_OPTIONS: SelectOption<string>[] = [
  { value: 'all', label: 'Tất cả loại' },
  { value: 'LAPTOP', label: 'Laptop' },
  { value: 'DESKTOP', label: 'Máy tính bàn' },
  { value: 'MONITOR', label: 'Màn hình' },
  { value: 'PHONE', label: 'Điện thoại' },
  { value: 'TABLET', label: 'Máy tính bảng' },
  { value: 'PRINTER', label: 'Máy in' },
  { value: 'SCANNER', label: 'Máy quét' },
  { value: 'NETWORK', label: 'Thiết bị mạng' },
  { value: 'SERVER', label: 'Máy chủ' },
  { value: 'SIM', label: 'SIM / USB 4G' },
  { value: 'FURNITURE', label: 'Nội thất' },
  { value: 'VEHICLE', label: 'Phương tiện' },
  { value: 'OTHER', label: 'Khác' },
];

export default function AssetBulkAssignModal({ isOpen, onClose, onSuccess, assets }: AssetBulkAssignModalProps) {
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<SelectOption<string>[]>([]);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [filterType, setFilterType] = useState('all');
  const [formData, setFormData] = useState({
    employee_id: '',
    assigned_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const fetchEmployees = useCallback(async () => {
    try {
      // page_size 5000 = mức trần backend cho phép (hrm/pagination.py: max_page_size), khớp với
      // WorkFinalization.tsx — tránh cắt mất NV nếu công ty có > 500 nhân viên đang hoạt động.
      const data = await employeesAPI.list({ page_size: 5000, is_active: true });
      setEmployees(
        (data.results || []).map((emp) => ({
          value: String(emp.id),
          label: `${emp.full_name} (${emp.employee_id}) - ${emp.department?.name || ''}`,
        }))
      );
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        employee_id: '',
        assigned_date: new Date().toISOString().split('T')[0],
        notes: '',
      });
      setResults(null);
      setQuantities({});
      setFilterType('all');
      fetchEmployees();
    }
  }, [isOpen, fetchEmployees]);

  const assignableAssets = assets.filter((a) => {
    if (a.condition === 'BROKEN' || a.condition === 'POOR') return false;
    if (a.pending_assignment) return false;
    const isMulti = MULTI_HOLDER_TYPES.includes(a.asset_type) && (a.total_quantity ?? 1) > 1;
    if (isMulti) return (a.remaining_quantity ?? 0) > 0;
    return !a.assigned_to_name;
  });
  const blockedAssets = assets.filter((a) => !assignableAssets.includes(a));

  const visibleAssignable = filterType === 'all' ? assignableAssets : assignableAssets.filter((a) => a.asset_type === filterType);
  const visibleBlocked = filterType === 'all' ? blockedAssets : blockedAssets.filter((a) => a.asset_type === filterType);

  const getBlockReason = (a: Asset) => {
    const isMulti = MULTI_HOLDER_TYPES.includes(a.asset_type) && (a.total_quantity ?? 1) > 1;
    if (isMulti && (a.remaining_quantity ?? 0) === 0) return 'Hết số lượng khả dụng';
    if (a.assigned_to_name && !isMulti) return 'Đang sử dụng — cần thu hồi trước';
    if (a.pending_assignment) return 'Đang chờ xác nhận';
    return 'Tình trạng hỏng/kém';
  };

  const handleSubmit = async () => {
    if (!formData.employee_id || visibleAssignable.length === 0) return;
    setLoading(true);
    const settled = await Promise.allSettled(
      visibleAssignable.map((asset) =>
        assetsAPI.assign(asset.id, {
          employee_id: parseInt(formData.employee_id),
          assigned_date: formData.assigned_date,
          notes: formData.notes,
          ...(MULTI_HOLDER_TYPES.includes(asset.asset_type) && (asset.total_quantity ?? 1) > 1
            ? { quantity: quantities[asset.id] ?? 1 }
            : {}),
        })
      )
    );
    const resultItems: ResultItem[] = visibleAssignable.map((asset, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') return { asset, status: 'success' };
      const msg = r.reason?.response?.data?.error || 'Có lỗi xảy ra';
      return { asset, status: 'error', message: msg };
    });
    setResults(resultItems);
    setLoading(false);
    if (resultItems.some((r) => r.status === 'success')) onSuccess();
  };

  const isFormValid = formData.employee_id !== '' && visibleAssignable.length > 0;

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
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
              enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <DialogTitle as="h3" className="text-xl font-semibold leading-6 text-gray-900">
                    Bàn giao nhiều tài sản
                  </DialogTitle>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {!results ? (
                  <>
                    <div className="px-6 py-4 space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2 gap-3">
                          <p className="text-sm font-medium text-gray-700 whitespace-nowrap">
                            Tài sản được chọn{' '}
                            <span className="text-emerald-700">({visibleAssignable.length} khả dụng)</span>
                            {visibleBlocked.length > 0 && (
                              <span className="text-gray-400"> · {visibleBlocked.length} bị bỏ qua</span>
                            )}
                          </p>
                          <div className="w-44 flex-shrink-0">
                            <SelectBox
                              label=""
                              value={filterType}
                              options={ASSET_TYPE_OPTIONS}
                              onChange={setFilterType}
                              placeholder="Phân loại"
                            />
                          </div>
                        </div>
                        <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                          {visibleAssignable.map((a) => {
                            const isMulti = MULTI_HOLDER_TYPES.includes(a.asset_type) && (a.total_quantity ?? 1) > 1;
                            return (
                              <div key={a.id} className="px-3 py-2 flex items-center gap-2 bg-white">
                                <CheckCircleIcon className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                                <span className="text-xs font-mono text-primary-700 font-semibold">[{a.asset_code}]</span>
                                <span className="text-xs text-gray-800 truncate">{a.name}</span>
                                {isMulti ? (
                                  <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                                    <span className="text-[10px] text-gray-400">SL:</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={a.remaining_quantity ?? 1}
                                      value={quantities[a.id] ?? 1}
                                      onChange={(e) => {
                                        const n = Math.max(1, Math.min(parseInt(e.target.value) || 1, a.remaining_quantity ?? 1));
                                        setQuantities((prev) => ({ ...prev, [a.id]: n }));
                                      }}
                                      className="w-14 rounded border border-gray-300 text-xs px-1 py-0.5 focus:border-primary-500 focus:ring-primary-500"
                                    />
                                    <span className="text-[10px] text-gray-400">/ {a.remaining_quantity}</span>
                                  </div>
                                ) : (
                                  <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">{a.asset_type_display}</span>
                                )}
                              </div>
                            );
                          })}
                          {visibleBlocked.map((a) => (
                            <div key={a.id} className="px-3 py-2 flex items-center gap-2 bg-gray-50 opacity-60">
                              <XCircleIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                              <span className="text-xs font-mono text-gray-400">[{a.asset_code}]</span>
                              <span className="text-xs text-gray-400 truncate">{a.name}</span>
                              <span className="ml-auto text-[10px] text-amber-600 flex-shrink-0">{getBlockReason(a)}</span>
                            </div>
                          ))}
                          {visibleAssignable.length === 0 && visibleBlocked.length === 0 && (
                            <div className="px-3 py-4 text-center text-xs text-gray-400">Không có tài sản nào thuộc phân loại này</div>
                          )}
                        </div>
                      </div>

                      {assignableAssets.length === 0 ? (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                          Không có tài sản nào khả dụng để bàn giao. Vui lòng thu hồi tài sản đang sử dụng trước.
                        </div>
                      ) : (
                        <>
                          <SelectBox
                            label="Nhân viên nhận bàn giao"
                            value={formData.employee_id}
                            options={employees}
                            onChange={(val) => setFormData((p) => ({ ...p, employee_id: val }))}
                            placeholder="Tìm kiếm mã, tên nhân viên"
                            searchable={true}
                            maxResults={500}
                          />

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Ngày bàn giao</label>
                            <input
                              type="date"
                              value={formData.assigned_date}
                              onChange={(e) => setFormData((p) => ({ ...p, assigned_date: e.target.value }))}
                              className="input-field"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Ghi chú tình trạng lúc giao</label>
                            <textarea
                              rows={2}
                              value={formData.notes}
                              onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                              className="input-field"
                              placeholder="Ghi chú tình trạng lúc giao..."
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Modal Footer */}
                    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-row-reverse gap-3">
                      {visibleAssignable.length > 0 && (
                        <button
                          type="button"
                          disabled={loading || !isFormValid}
                          onClick={handleSubmit}
                          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? 'Đang gửi...' : `Bàn giao ${visibleAssignable.length} tài sản`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onClose}
                        className="btn-secondary"
                      >
                        Hủy
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="px-6 py-4 space-y-4">
                      <p className="text-sm text-gray-600">
                        Kết quả:{' '}
                        <span className="font-semibold text-emerald-700">{results.filter((r) => r.status === 'success').length} thành công</span>
                        {results.some((r) => r.status === 'error') && (
                          <span className="font-semibold text-red-600"> · {results.filter((r) => r.status === 'error').length} thất bại</span>
                        )}
                      </p>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                        {results.map(({ asset, status, message }) => (
                          <div key={asset.id} className={`px-3 py-2.5 flex items-start gap-2 ${status === 'success' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                            {status === 'success'
                              ? <CheckCircleIcon className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                              : <XCircleIcon className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                            }
                            <div>
                              <span className="text-xs font-mono text-gray-600">[{asset.asset_code}]</span>
                              <span className="text-xs text-gray-800 ml-1">{asset.name}</span>
                              {message && <p className="text-[11px] text-red-600 mt-0.5">{message}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end">
                      <button
                        type="button"
                        onClick={onClose}
                        className="btn-secondary"
                      >
                        Đóng
                      </button>
                    </div>
                  </>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
