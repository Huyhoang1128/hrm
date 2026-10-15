import { useState, useEffect, Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Asset, assetsAPI } from '../../utils/api';
import { SelectBox, SelectOption } from '../../components/LandingLayout/SelectBox';

interface AssetBulkReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assets: Asset[];
}

type ResultItem = { asset: Asset; status: 'success' | 'error'; message?: string };

const ASSET_CONDITIONS = [
  { value: 'EXCELLENT', label: 'Mới 100%' },
  { value: 'GOOD', label: 'Cũ (Chất lượng tốt)' },
  { value: 'FAIR', label: 'Cũ (Trầy xước / Cấn móp)' },
  { value: 'POOR', label: 'Cũ (Kém / Lỗi chức năng)' },
  { value: 'BROKEN', label: 'Hỏng (Không hoạt động)' },
];

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

const isMultiType = (a: Asset) =>
  MULTI_HOLDER_TYPES.includes(a.asset_type) && (a.total_quantity ?? 1) > 1;

const uniqueHolderCount = (a: Asset): number =>
  new Set((a.holders ?? []).map((h) => h.employee_id)).size;

function canBulkReturn(asset: Asset): boolean {
  if (isMultiType(asset) && uniqueHolderCount(asset) > 1) return false;
  return !!asset.assigned_to_name;
}

function getHolderDisplay(asset: Asset): string {
  return asset.assigned_to_name || '';
}

function getBlockReason(asset: Asset): string {
  if (isMultiType(asset) && uniqueHolderCount(asset) > 1)
    return 'Nhiều người giữ — thu hồi từng người trong Chi tiết';
  if (!asset.assigned_to_name)
    return asset.pending_assignment ? 'Chờ xác nhận — chưa nhận máy' : 'Chưa bàn giao';
  return '';
}

export default function AssetBulkReturnModal({ isOpen, onClose, onSuccess, assets }: AssetBulkReturnModalProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [filterType, setFilterType] = useState('all');
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [formData, setFormData] = useState({
    return_date: new Date().toISOString().split('T')[0],
    condition: 'GOOD',
    notes: '',
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        return_date: new Date().toISOString().split('T')[0],
        condition: 'GOOD',
        notes: '',
      });
      setResults(null);
      setFilterType('all');
      setReturnQuantities({});
    }
  }, [isOpen]);

  const returnableAssets = assets.filter(canBulkReturn);
  const blockedAssets = assets.filter((a) => !canBulkReturn(a));

  const visibleReturnable = filterType === 'all' ? returnableAssets : returnableAssets.filter((a) => a.asset_type === filterType);
  const visibleBlocked = filterType === 'all' ? blockedAssets : blockedAssets.filter((a) => a.asset_type === filterType);

  const handleSubmit = async () => {
    if (visibleReturnable.length === 0) return;
    setLoading(true);
    const settled = await Promise.allSettled(
      visibleReturnable.map((asset) => {
        const singleHolder = isMultiType(asset) && (asset.holders?.length ?? 0) === 1 ? asset.holders![0] : null;
        const holderQty = singleHolder?.assigned_quantity ?? 1;
        const returnQty = returnQuantities[asset.id] ?? holderQty;
        return assetsAPI.returnAsset(asset.id, {
          return_date: formData.return_date,
          condition: formData.condition,
          notes: formData.notes,
          ...(singleHolder ? { history_id: singleHolder.history_id, return_quantity: returnQty } : {}),
        });
      })
    );
    const resultItems: ResultItem[] = visibleReturnable.map((asset, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') return { asset, status: 'success' };
      const msg = r.reason?.response?.data?.error || 'Có lỗi xảy ra';
      return { asset, status: 'error', message: msg };
    });
    setResults(resultItems);
    setLoading(false);
    if (resultItems.some((r) => r.status === 'success')) onSuccess();
  };

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
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <DialogTitle as="h3" className="text-xl font-semibold leading-6 text-gray-900">
                    Thu hồi nhiều tài sản
                  </DialogTitle>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-500 transition-colors"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {!results ? (
                  <>
                    {/* Body */}
                    <div className="px-6 py-4 space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2 gap-3">
                          <p className="text-sm font-medium text-gray-700 whitespace-nowrap">
                            Tài sản được chọn{' '}
                            <span className="text-amber-700">({visibleReturnable.length} khả dụng)</span>
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
                          {visibleReturnable.map((a) => {
                            const singleHolder = isMultiType(a) && (a.holders?.length ?? 0) === 1 ? a.holders![0] : null;
                            const holderQty = singleHolder?.assigned_quantity ?? 1;
                            const showQty = !!singleHolder && holderQty >= 1;
                            return (
                              <div key={a.id} className="px-3 py-2 flex items-center gap-2 bg-white">
                                <CheckCircleIcon className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                <span className="text-xs font-mono text-primary-700 font-semibold">[{a.asset_code}]</span>
                                <span className="text-xs text-gray-800 truncate">{a.name}</span>
                                {showQty ? (
                                  <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                                    <span className="text-[10px] text-gray-400">SL:</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={holderQty}
                                      value={returnQuantities[a.id] ?? holderQty}
                                      onChange={(e) => {
                                        const n = Math.max(1, Math.min(parseInt(e.target.value) || 1, holderQty));
                                        setReturnQuantities((prev) => ({ ...prev, [a.id]: n }));
                                      }}
                                      className="w-14 rounded border border-gray-300 text-xs px-1 py-0.5 focus:border-primary-500 focus:ring-primary-500"
                                    />
                                    <span className="text-[10px] text-gray-400">/ {holderQty}</span>
                                  </div>
                                ) : (
                                  <span className="ml-auto text-[10px] text-emerald-700 flex-shrink-0">{getHolderDisplay(a)}</span>
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
                          {visibleReturnable.length === 0 && visibleBlocked.length === 0 && (
                            <div className="px-3 py-4 text-center text-xs text-gray-400">Không có tài sản nào thuộc phân loại này</div>
                          )}
                        </div>
                      </div>

                      {returnableAssets.length === 0 ? (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                          Không có tài sản nào có thể thu hồi. Các tài sản chưa bàn giao hoặc cần thu hồi từng người trong Chi tiết.
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Ngày thu hồi</label>
                            <input
                              type="date"
                              value={formData.return_date}
                              onChange={(e) => setFormData((p) => ({ ...p, return_date: e.target.value }))}
                              className="input-field"
                            />
                          </div>

                          <SelectBox
                            label="Tình trạng lúc thu hồi"
                            value={formData.condition}
                            options={ASSET_CONDITIONS}
                            onChange={(val) => setFormData((p) => ({ ...p, condition: val }))}
                          />

                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Ghi chú</label>
                            <textarea
                              rows={2}
                              value={formData.notes}
                              onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                              className="input-field"
                              placeholder="Lý do thu hồi, tình trạng thiết bị..."
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-row-reverse gap-3">
                      {visibleReturnable.length > 0 && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={handleSubmit}
                          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? 'Đang thu hồi...' : `Thu hồi ${visibleReturnable.length} tài sản`}
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
                    {/* Body — results */}
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

                    {/* Footer — results */}
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
