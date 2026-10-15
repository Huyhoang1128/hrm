import { useState, useEffect } from 'react';
import { assetsAPI, Asset, AssetAssignmentHistory } from '../../utils/api';
import {
  ComputerDesktopIcon,
  EyeIcon,
  ShieldCheckIcon,
  ArrowPathRoundedSquareIcon,
  SparklesIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  UserIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';
import AssetDetailModal from './AssetDetailModal';
import FeedbackDialog, { FeedbackVariant } from '../../components/FeedbackDialog';
import { SelectBox } from '../../components/LandingLayout/SelectBox';

const getStatusColor = (status: string) => {
  switch (status) {
    case 'IN_USE':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'IDLE':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'UNDER_MAINTENANCE':
      return 'bg-primary-100 text-primary-800 border-primary-200';
    case 'DAMAGED':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    case 'RETIRED':
      return 'bg-slate-100 text-slate-800 border-slate-200';
    case 'LOST':
      return 'bg-black text-white border-black';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getConditionColor = (condition: string) => {
  switch (condition) {
    case 'EXCELLENT':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'GOOD':
      return 'bg-primary-100 text-primary-800 border-primary-200';
    case 'FAIR':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'POOR':
      return 'bg-amber-200 text-amber-900 border-amber-300';
    case 'BROKEN':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

// Màu badge type — không trùng với Status/Condition:
// Status blocked:    emerald(IN_USE), amber(IDLE), primary(MAINTENANCE), rose(DAMAGED), slate(RETIRED), black(LOST)
// Condition blocked: emerald(EXCELLENT), primary(GOOD), amber(FAIR), amber-dark(POOR), red(BROKEN)
const ASSET_TYPE_COLOR_MAP: Record<string, string> = {
  LAPTOP:    'bg-primary-100 text-primary-800 border-primary-200',
  DESKTOP:   'bg-pink-100 text-pink-800 border-pink-200',
  MONITOR:   'bg-violet-100 text-violet-800 border-violet-200',
  PHONE:     'bg-primary-50 text-primary-700 border-primary-200',
  TABLET:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  PRINTER:   'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
  SCANNER:   'bg-lime-100 text-lime-800 border-lime-200',
  NETWORK:   'bg-violet-100 text-violet-800 border-violet-200',
  SERVER:    'bg-amber-100 text-amber-800 border-amber-200',
  SIM:       'bg-stone-100 text-stone-700 border-stone-200',
  FURNITURE: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  VEHICLE:   'bg-neutral-100 text-neutral-700 border-neutral-200',
  OTHER:     'bg-gray-200 text-gray-600 border-gray-300',
};

function formatDate(dateStr?: string) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('vi-VN');
}

function isWarrantyExpiringSoon(expiryDate?: string): boolean {
  if (!expiryDate) return false;
  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysLeft > 0 && daysLeft <= 30;
}

function isWarrantyExpired(expiryDate?: string): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}

const STATUS_OPTIONS = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'IN_USE', label: 'Đang sử dụng' },
  { value: 'IDLE', label: 'Chờ bàn giao' },
  { value: 'UNDER_MAINTENANCE', label: 'Đang bảo trì' },
  { value: 'DAMAGED', label: 'Hư hỏng' },
  { value: 'RETIRED', label: 'Thanh lý' },
  { value: 'LOST', label: 'Mất' },
];

const CONDITION_OPTIONS = [
  { value: '', label: 'Tất cả tình trạng' },
  { value: 'EXCELLENT', label: 'Mới 100%' },
  { value: 'GOOD', label: 'Cũ (Chất lượng tốt)' },
  { value: 'FAIR', label: 'Cũ (Trầy xước / Cấn móp)' },
  { value: 'POOR', label: 'Cũ (Kém / Lỗi chức năng)' },
  { value: 'BROKEN', label: 'Hỏng (Không hoạt động)' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'Tất cả loại' },
  { value: 'LAPTOP', label: 'Laptop' },
  { value: 'DESKTOP', label: 'Desktop' },
  { value: 'MONITOR', label: 'Màn hình' },
  { value: 'PHONE', label: 'Điện thoại' },
  { value: 'TABLET', label: 'Máy tính bảng' },
  { value: 'PRINTER', label: 'Máy in' },
  { value: 'SCANNER', label: 'Máy scan' },
  { value: 'NETWORK', label: 'Thiết bị mạng' },
  { value: 'SERVER', label: 'Máy chủ' },
  { value: 'SIM', label: 'SIM' },
  { value: 'FURNITURE', label: 'Nội thất' },
  { value: 'VEHICLE', label: 'Phương tiện' },
  { value: 'OTHER', label: 'Khác' },
];

export default function AssignedAssetList() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterType, setFilterType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [pendingHandovers, setPendingHandovers] = useState<AssetAssignmentHistory[]>([]);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [rejectingHistory, setRejectingHistory] = useState<AssetAssignmentHistory | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [feedback, setFeedback] = useState<{ variant: FeedbackVariant; title: string; message?: string } | null>(null);
  const [returnNotices, setReturnNotices] = useState<AssetAssignmentHistory[]>([]);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [isBulkConfirming, setIsBulkConfirming] = useState(false);
  const [showBulkRejectDialog, setShowBulkRejectDialog] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [isBulkRejecting, setIsBulkRejecting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    fetchAssignedAssets();
    fetchPendingHandovers();
    checkRecentReturns();
  }, []);

  useEffect(() => {
    const anyOpen = showBulkRejectDialog || !!rejectingHistory || returnNotices.length > 0;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showBulkRejectDialog, rejectingHistory, returnNotices.length]);

  const checkRecentReturns = async () => {
    try {
      const data = await assetsAPI.recentReturns(7);
      const list = Array.isArray(data) ? data : [];
      setReturnNotices(list);
    } catch (err) {
      console.error('Error fetching recent returns:', err);
    }
  };

  const handleAcknowledgeAllReturns = async () => {
    const ids = returnNotices.map((h) => h.id);
    setIsAcknowledging(true);
    try {
      await assetsAPI.acknowledgeReturns(ids);
      setReturnNotices([]);
    } catch (err) {
      console.error('Failed to mark returns as seen:', err);
    } finally {
      setIsAcknowledging(false);
    }
  };

  const fetchAssignedAssets = async () => {
    try {
      setLoading(true);
      const data = await assetsAPI.assignedAssets();
      setAssets(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching assigned assets:', err);
      setError('Không thể tải danh sách tài sản. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingHandovers = async () => {
    try {
      const data = await assetsAPI.pendingHandovers();
      setPendingHandovers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching pending handovers:', err);
      setPendingHandovers([]);
    }
  };

  const handleConfirmHandover = async (history: AssetAssignmentHistory) => {
    setActionLoadingId(history.id);
    try {
      await assetsAPI.confirmHandover(history.asset);
      await Promise.all([fetchAssignedAssets(), fetchPendingHandovers()]);
      setFeedback({
        variant: 'success',
        title: 'Đã xác nhận nhận máy',
        message: `Tài sản [${history.asset_code}] ${history.asset_name} đã được ghi nhận vào danh sách thiết bị bạn đang sử dụng.`,
      });
    } catch (err: any) {
      console.error(err);
      setFeedback({
        variant: 'error',
        title: 'Không thể xác nhận',
        message: err.response?.data?.error || 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const openRejectDialog = (history: AssetAssignmentHistory) => {
    setRejectingHistory(history);
    setRejectionReason('');
  };

  const closeRejectDialog = () => {
    setRejectingHistory(null);
    setRejectionReason('');
  };

  const handleBulkConfirm = async () => {
    setIsBulkConfirming(true);
    const settled = await Promise.allSettled(
      pendingHandovers.map((h) => assetsAPI.confirmHandover(h.asset))
    );
    await Promise.all([fetchAssignedAssets(), fetchPendingHandovers()]);
    setIsBulkConfirming(false);
    const successCount = settled.filter((r) => r.status === 'fulfilled').length;
    const failCount = settled.length - successCount;
    setFeedback({
      variant: failCount === 0 ? 'success' : 'warning',
      title: failCount === 0 ? 'Đã xác nhận tất cả' : `${successCount} thành công, ${failCount} thất bại`,
      message: `Đã xác nhận nhận ${successCount} tài sản vào danh sách thiết bị của bạn.`,
    });
  };

  const handleBulkReject = async () => {
    setIsBulkRejecting(true);
    const settled = await Promise.allSettled(
      pendingHandovers.map((h) => assetsAPI.rejectHandover(h.asset, bulkRejectReason.trim()))
    );
    await Promise.all([fetchAssignedAssets(), fetchPendingHandovers()]);
    setIsBulkRejecting(false);
    setShowBulkRejectDialog(false);
    setBulkRejectReason('');
    const successCount = settled.filter((r) => r.status === 'fulfilled').length;
    setFeedback({
      variant: 'success',
      title: 'Đã từ chối tất cả',
      message: `Đã từ chối ${successCount} yêu cầu bàn giao.`,
    });
  };

  const handleRejectHandover = async () => {
    if (!rejectingHistory) return;
    const rejected = rejectingHistory;
    setActionLoadingId(rejected.id);
    try {
      await assetsAPI.rejectHandover(rejected.asset, rejectionReason.trim());
      await Promise.all([fetchAssignedAssets(), fetchPendingHandovers()]);
      closeRejectDialog();
      setFeedback({
        variant: 'success',
        title: 'Đã từ chối nhận máy',
        message: `Yêu cầu bàn giao tài sản [${rejected.asset_code}] ${rejected.asset_name} đã được ghi nhận là từ chối.`,
      });
    } catch (err: any) {
      console.error(err);
      setFeedback({
        variant: 'error',
        title: 'Không thể gửi từ chối',
        message: err.response?.data?.error || 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterStatus, filterCondition, filterType, dateFrom, dateTo]);

  const filteredAssets = assets.filter(asset => {
    const q = searchTerm.toLowerCase();
    const matchSearch =
      asset.asset_code.toLowerCase().includes(q) ||
      asset.name.toLowerCase().includes(q) ||
      (asset.brand?.toLowerCase() || '').includes(q) ||
      (asset.model?.toLowerCase() || '').includes(q);
    const matchStatus = !filterStatus || asset.status === filterStatus;
    const matchCondition = !filterCondition || asset.condition === filterCondition;
    const matchType = !filterType || asset.asset_type === filterType;
    const assetDate = asset.assigned_date ? asset.assigned_date.slice(0, 10) : '';
    const matchDateFrom = !dateFrom || assetDate >= dateFrom;
    const matchDateTo = !dateTo || assetDate <= dateTo;
    return matchSearch && matchStatus && matchCondition && matchType && matchDateFrom && matchDateTo;
  });

  const totalPages = Math.ceil(filteredAssets.length / PAGE_SIZE);
  const pagedAssets = filteredAssets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center mb-1">
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Thiết bị bàn giao</h1>
        </div>
        <p className="text-sm text-gray-900">Danh sách thiết bị, tài sản công ty đã bàn giao cho bạn sử dụng.</p>
      </div>

      {/* Sticky wrapper: Stats + Filters — chỉ sticky từ sm trở lên, tránh chiếm hết viewport trên mobile */}
      <div className="sm:sticky sm:top-16 z-20 -mx-6 px-6 py-4 bg-gray-50/95 backdrop-blur space-y-4">
        {/* Stats banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Tổng thiết bị</p>
            <p className="text-2xl font-bold text-gray-900">{assets.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Đang sử dụng</p>
            <p className="text-2xl font-bold text-emerald-600">{assets.filter(a => a.status === 'IN_USE').length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Bảo hành còn hạn</p>
            <p className="text-2xl font-bold text-primary-600">
              {assets.filter(a => a.warranty_expiry && !isWarrantyExpired(a.warranty_expiry)).length}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Sắp hết bảo hành</p>
            <p className="text-2xl font-bold text-amber-500">
              {assets.filter(a => isWarrantyExpiringSoon(a.warranty_expiry)).length}
            </p>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm</label>
              <input
                type="text"
                placeholder="Tìm theo mã, tên, hãng, model..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="input-field w-full"
              />
            </div>
            <div className="w-48">
              <SelectBox
                label="Trạng thái vận hành"
                value={filterStatus}
                options={STATUS_OPTIONS}
                onChange={setFilterStatus}
              />
            </div>
            <div className="w-48">
              <SelectBox
                label="Tình trạng vật lý"
                value={filterCondition}
                options={CONDITION_OPTIONS}
                onChange={setFilterCondition}
              />
            </div>
            <div className="w-40">
              <SelectBox
                label="Loại tài sản"
                value={filterType}
                options={TYPE_OPTIONS}
                onChange={setFilterType}
              />
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ngày nhận từ</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Đến ngày</label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => { const t = new Date().toISOString().slice(0, 10); setDateFrom(t); setDateTo(t); }}
                  className="px-3 py-2 rounded-lg border border-primary-200 bg-primary-50 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  Hôm nay
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setDateFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
                    setDateTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
                  }}
                  className="px-3 py-2 rounded-lg border border-primary-200 bg-primary-50 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  Tháng này
                </button>
                {(dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                    className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    Xóa lọc
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pending handovers section */}
      {pendingHandovers.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ClockIcon className="h-5 w-5 text-amber-600" />
            <h2 className="flex-1 text-base font-bold text-amber-900">
              Bàn giao chờ xác nhận
              <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                {pendingHandovers.length}
              </span>
            </h2>
            <button
              onClick={handleBulkConfirm}
              disabled={isBulkConfirming || isBulkRejecting}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-300 transition-all active:scale-95"
            >
              <CheckCircleIcon className="h-3.5 w-3.5" />
              {isBulkConfirming ? 'Đang xử lý...' : `Xác nhận tất cả (${pendingHandovers.length})`}
            </button>
            <button
              onClick={() => { setBulkRejectReason(''); setShowBulkRejectDialog(true); }}
              disabled={isBulkConfirming || isBulkRejecting}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-50 transition-all active:scale-95"
            >
              <XCircleIcon className="h-3.5 w-3.5" />
              Từ chối tất cả ({pendingHandovers.length})
            </button>
          </div>
          <p className="mb-3 text-xs italic text-amber-700">
            Bạn có {pendingHandovers.length} yêu cầu bàn giao tài sản đang chờ phản hồi. Hãy xác nhận khi bạn đã nhận máy vật lý, hoặc từ chối nếu có vấn đề.
          </p>
          <div className="space-y-3">
            {pendingHandovers.map((h) => {
              const isBusy = actionLoadingId === h.id;
              return (
                <div key={h.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">
                          {h.asset_name}
                        </span>
                        {h.asset_type_display && (
                          <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700 border border-primary-200 uppercase tracking-tight">
                            {h.asset_type_display}
                          </span>
                        )}
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200 uppercase tracking-tight">
                          Chờ xác nhận
                        </span>
                      </div>

                      {/* Asset detail — hiển thị rõ "đang được bàn giao cái gì" */}
                      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
                        {h.asset_brand && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-500">Thương hiệu:</span>
                            <span className="font-semibold text-gray-800">{h.asset_brand}</span>
                          </div>
                        )}
                        {h.asset_model && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-500">Model:</span>
                            <span className="font-semibold text-gray-800">{h.asset_model}</span>
                          </div>
                        )}
                        {h.asset_serial_number && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-500">Serial:</span>
                            <span className="font-mono text-[11px] font-semibold text-gray-800">{h.asset_serial_number}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500">Mã hệ thống:</span>
                          <span className="font-mono text-[11px] text-gray-700">{h.asset_code}</span>
                        </div>
                      </div>

                      {/* Specifications theo loại */}
                      {h.asset_specifications && Object.keys(h.asset_specifications).length > 0 && (
                        <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Thông số kỹ thuật</p>
                          <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-slate-700 sm:grid-cols-2">
                            {(h.asset_type === 'LAPTOP' || h.asset_type === 'DESKTOP') && (
                              <>
                                {h.asset_specifications.cpu && <div><span className="text-slate-500">CPU:</span> <span className="font-semibold">{h.asset_specifications.cpu}</span></div>}
                                {h.asset_specifications.ram && <div><span className="text-slate-500">RAM:</span> <span className="font-semibold">{h.asset_specifications.ram}</span></div>}
                                {h.asset_specifications.storage && <div><span className="text-slate-500">Ổ cứng:</span> <span className="font-semibold">{h.asset_specifications.storage}</span></div>}
                                {h.asset_specifications.vga && <div><span className="text-slate-500">VGA:</span> <span className="font-semibold">{h.asset_specifications.vga}</span></div>}
                                {h.asset_specifications.mainboard && <div><span className="text-slate-500">Main:</span> <span className="font-semibold">{h.asset_specifications.mainboard}</span></div>}
                                {h.asset_specifications.power_supply && <div><span className="text-slate-500">Nguồn:</span> <span className="font-semibold">{h.asset_specifications.power_supply}</span></div>}
                              </>
                            )}
                            {['MONITOR', 'OTHER'].includes(h.asset_type || '') && h.assigned_quantity != null && (
                              <div><span className="text-slate-500">Số lượng bàn giao:</span> <span className="font-semibold">{h.assigned_quantity}</span></div>
                            )}
                            {h.asset_type === 'SIM' && (
                              <>
                                {h.asset_specifications.phone_number && <div><span className="text-slate-500">SĐT:</span> <span className="font-mono font-semibold">{h.asset_specifications.phone_number}</span></div>}
                                {h.asset_specifications.network_provider && <div><span className="text-slate-500">Nhà mạng:</span> <span className="font-semibold">{h.asset_specifications.network_provider}</span></div>}
                                {h.asset_specifications.sim_type && <div><span className="text-slate-500">Loại SIM:</span> <span className="font-semibold">{h.asset_specifications.sim_type === 'PREPAID' ? 'Trả trước' : h.asset_specifications.sim_type === 'POSTPAID' ? 'Trả sau' : h.asset_specifications.sim_type}</span></div>}
                                {h.asset_specifications.sim_company_name && <div><span className="text-slate-500">Công ty:</span> <span className="font-semibold">{h.asset_specifications.sim_company_name}</span></div>}
                                {h.asset_specifications.cancellation_report_date && <div><span className="text-slate-500">Ngày báo huỷ:</span> <span className="font-semibold">{h.asset_specifications.cancellation_report_date}</span></div>}
                              </>
                            )}
                            {h.asset_type === 'OTHER' && h.asset_specifications.type_name && (
                              <div><span className="text-slate-500">Loại:</span> <span className="font-semibold">{h.asset_specifications.type_name}</span></div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-2">
                        <div className="flex items-center gap-1.5">
                          <UserIcon className="h-3.5 w-3.5 text-gray-400" />
                          <span className="text-gray-500">Người bàn giao:</span>
                          <span className="font-semibold text-gray-800">
                            {h.assigned_by_name || 'Chưa có thông tin'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CalendarIcon className="h-3.5 w-3.5 text-gray-400" />
                          <span className="text-gray-500">Ngày bàn giao:</span>
                          <span className="font-semibold text-gray-800">
                            {formatDate(h.assigned_date)}
                          </span>
                        </div>
                      </div>
                      {h.assignment_notes && (
                        <p className="mt-2 rounded border border-amber-100 bg-amber-50/50 px-2 py-1 text-xs italic text-amber-800">
                          📝 {h.assignment_notes}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-row gap-2 sm:flex-col">
                      <button
                        onClick={() => handleConfirmHandover(h)}
                        disabled={isBusy}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-300 transition-all active:scale-95"
                      >
                        <CheckCircleIcon className="h-4 w-4" />
                        {isBusy ? 'Đang xử lý...' : 'Xác nhận nhận máy'}
                      </button>
                      <button
                        onClick={() => openRejectDialog(h)}
                        disabled={isBusy}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-50 transition-all active:scale-95"
                      >
                        <XCircleIcon className="h-4 w-4" />
                        Từ chối
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 rounded-2xl text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="table-header text-center w-12">STT</th>
                <th className="table-header whitespace-nowrap">Mã thiết bị</th>
                <th className="table-header whitespace-nowrap">Model</th>
                <th className="table-header whitespace-nowrap">Loại tài sản</th>
                <th className="table-header whitespace-nowrap">Số lượng bàn giao</th>
                <th className="table-header whitespace-nowrap">Trạng thái vận hành</th>
                <th className="table-header whitespace-nowrap">Tình trạng vật lý</th>
                <th className="table-header whitespace-nowrap">Quản lý kho</th>
                <th className="table-header whitespace-nowrap">Ngày nhận</th>
                <th className="table-header whitespace-nowrap">Trạng thái bàn giao</th>
                <th className="table-header whitespace-nowrap">Ghi chú</th>
                <th className="table-header whitespace-nowrap">Thao tác</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
                      <p className="text-sm text-gray-500">Đang tải danh sách thiết bị bàn giao...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-6 py-16 text-center">
                    <ComputerDesktopIcon className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p className="text-gray-500 font-medium">Bạn chưa được bàn giao tài sản nào.</p>
                    <p className="text-sm text-gray-400 mt-1">Liên hệ phòng IT để được hỗ trợ.</p>
                  </td>
                </tr>
              ) : (
                pagedAssets.map((asset, index) => {
                  const isReturned = asset.status === 'IDLE' || asset.status === 'RETIRED';
                  const isUnderMaintenance = asset.status === 'UNDER_MAINTENANCE';

                  return (
                    <tr key={asset.id} className={`hover:bg-gray-50 transition-colors ${(isReturned || isUnderMaintenance) ? 'bg-gray-50/50 opacity-50 grayscale-[0.5]' : ''}`}>
                      <td className="table-cell text-center text-xs font-medium text-gray-500 w-12">
                        {(currentPage - 1) * PAGE_SIZE + index + 1}
                      </td>
                      {/* Tên tài sản */}
                      <td className="table-cell whitespace-nowrap">
                        <div className="text-sm font-bold text-primary-700 bg-primary-50 px-2 py-1 rounded inline-block">
                          {asset.name}
                        </div>
                      </td>
                      {/* Model */}
                      <td className="table-cell">
                        <div className="text-sm text-gray-900 font-medium">
                          {asset.model || '-'}
                        </div>
                      </td>
                      {/* Loại tài sản */}
                      <td className="table-cell whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ASSET_TYPE_COLOR_MAP[asset.asset_type] ?? 'bg-gray-100 text-gray-800 border-gray-200'} uppercase tracking-tight`}>
                          {asset.asset_type === 'OTHER' && (asset as any).other_type_name
                            ? `Khác (${(asset as any).other_type_name})`
                            : asset.asset_type_display}
                        </span>
                      </td>
                      {/* SL bàn giao */}
                      <td className="table-cell whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {asset.my_assigned_quantity ?? 1}
                        </span>
                      </td>
                      {/* Trạng thái vận hành */}
                      <td className="table-cell whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(asset.status)} uppercase tracking-tight`}>
                          {asset.status_display}
                        </span>
                      </td>
                      {/* Tình trạng vật lý */}
                      <td className="table-cell whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getConditionColor(asset.condition)} uppercase tracking-tight`}>
                          {asset.condition_display}
                        </span>
                      </td>
                      {/* Quản lý kho nội bộ */}
                      <td className="table-cell">
                        {asset.managed_by_name || asset.department_name ? (
                          <>
                            {asset.managed_by_name && (
                              <div className="text-sm font-medium text-gray-900">{asset.managed_by_name}</div>
                            )}
                            {asset.department_name && (
                              <div className="text-sm text-gray-400">{asset.department_name}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-sm text-gray-500">-</span>
                        )}
                      </td>
                      <td className="table-cell whitespace-nowrap text-sm text-gray-600">
                        {formatDate(asset.assigned_date)}
                      </td>
                      {/* Trạng thái bàn giao */}
                      <td className="table-cell whitespace-nowrap text-sm">
                        {isReturned ? (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-tight w-fit">
                              Đã thu hồi
                            </span>
                          </div>
                        ) : isUnderMaintenance ? (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-200 uppercase tracking-tight w-fit">
                              Đang bảo hành
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-tight w-fit">
                              Đang sử dụng
                            </span>
                          </div>
                        )}
                      </td>
                      {/* Ghi chú */}
                      <td className="table-cell">
                        <div className="flex flex-col gap-2 max-w-sm">
                          {asset.description && (
                            <div className="flex items-start space-x-1.5 opacity-80" title="Mô tả kỹ thuật/Lưu ý vật lý">
                              <span className="mt-0.5"><SparklesIcon className="h-3 w-3 text-slate-400" /></span>
                              <p className="text-[10px] text-gray-500 italic leading-relaxed line-clamp-2">
                                {asset.description}
                              </p>
                            </div>
                          )}
                          <div className="flex items-start space-x-1.5" title={isReturned ? (asset as any).return_notes : (asset as any).assignment_notes}>
                            <span className="mt-0.5">
                              {isReturned ? (
                                <ArrowPathRoundedSquareIcon className="h-3 w-3 text-amber-500" />
                              ) : (
                                <ShieldCheckIcon className="h-3 w-3 text-emerald-500" />
                              )}
                            </span>
                            <div className="text-xs">
                              {isReturned ? (
                                <span className="text-amber-600 line-clamp-2 font-medium">Thu hồi: {(asset as any).return_notes || '-'}</span>
                              ) : (
                                <span className="text-emerald-700 line-clamp-2 font-semibold">Bàn giao: {(asset as any).assignment_notes || '-'}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Thao tác */}
                      <td className="table-cell whitespace-nowrap">
                        <button
                          onClick={() => { setSelectedAsset(asset); setIsDetailModalOpen(true); }}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-primary-600 bg-primary-50 hover:bg-primary-100 hover:text-primary-700 transition-all font-bold text-[11px] uppercase tracking-wide shadow-sm hover:shadow active:scale-95"
                        >
                          <EyeIcon className="h-4 w-4" />
                          <span>Chi tiết</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-500">
            Hiển thị <span className="font-semibold text-gray-700">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredAssets.length)}</span> / <span className="font-semibold text-gray-700">{filteredAssets.length}</span> thiết bị
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Trước
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p as number)}
                    className={`w-9 h-9 text-sm font-semibold rounded-lg border transition-colors ${currentPage === p ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Sau
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <AssetDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => { setIsDetailModalOpen(false); setSelectedAsset(null); }}
        asset={selectedAsset}
        viewMode="employee"
      />

      {/* Feedback Dialog */}
      <FeedbackDialog
        open={!!feedback}
        variant={feedback?.variant}
        title={feedback?.title || ''}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />

      {/* Return-notice dialog — hiện khi manager đã thu hồi tài sản của current user */}
      {returnNotices.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-md transform rounded-2xl bg-white shadow-xl">
              <div className="px-6 py-4 border-b border-gray-100">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <ArrowPathRoundedSquareIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">
                      Thiết bị đã được thu hồi
                      {returnNotices.length > 1 && (
                        <span className="ml-2 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-700">
                          {returnNotices.length}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">Quản lý kho đã thu hồi các thiết bị sau</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="max-h-56 overflow-y-auto space-y-2">
                  {returnNotices.map((h) => (
                    <div key={h.id} className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2.5 text-sm">
                      <p className="font-semibold text-gray-900">
                        <span className="font-mono text-xs text-primary-700">[{h.asset_code}]</span>{' '}
                        {h.asset_name}
                      </p>
                      {h.returned_date && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Thu hồi ngày {new Date(h.returned_date).toLocaleDateString('vi-VN')}
                          {h.return_condition_display && ` · Tình trạng: ${h.return_condition_display}`}
                        </p>
                      )}
                      {h.return_notes && (
                        <p className="text-xs text-gray-500 italic mt-0.5">Ghi chú: {h.return_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end">
                <button
                  type="button"
                  onClick={handleAcknowledgeAllReturns}
                  disabled={isAcknowledging}
                  className="btn-primary"
                >
                  {isAcknowledging ? 'Đang lưu...' : 'Đã xem tất cả'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject reason dialog */}
      {rejectingHistory && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
              onClick={closeRejectDialog}
            />
            <div className="relative w-full max-w-md transform rounded-2xl bg-white shadow-xl">
              <div className="px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <XCircleIcon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-bold leading-6 text-gray-900">
                    Từ chối nhận máy
                  </h3>
                </div>
              </div>
              <div className="px-6 py-4 space-y-3">
                <div className="space-y-2 text-sm text-gray-600">
                  <p>
                    Bạn đang từ chối bàn giao tài sản{' '}
                    <span className="font-semibold text-gray-900">
                      [{rejectingHistory.asset_code}] {rejectingHistory.asset_name}
                    </span>.
                  </p>
                  <p className="text-xs italic text-gray-500">
                    Vui lòng cho biết lý do (không bắt buộc) để quản lý kho nắm thông tin.
                  </p>
                </div>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  placeholder="VD: Máy bị trầy xước nặng, thiếu phụ kiện..."
                  className="input-field w-full"
                />
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-col gap-2 sm:flex-row-reverse">
                <button
                  type="button"
                  disabled={actionLoadingId === rejectingHistory.id}
                  onClick={handleRejectHandover}
                  className="btn-danger sm:w-auto"
                >
                  {actionLoadingId === rejectingHistory.id ? 'Đang gửi...' : 'Xác nhận từ chối'}
                </button>
                <button
                  type="button"
                  onClick={closeRejectDialog}
                  className="btn-secondary sm:w-auto"
                >
                  Hủy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Reject Dialog */}
      {showBulkRejectDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
              onClick={() => setShowBulkRejectDialog(false)}
            />
            <div className="relative w-full max-w-md transform rounded-2xl bg-white shadow-xl">
              <div className="px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <XCircleIcon className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-gray-900">
                    Từ chối tất cả {pendingHandovers.length} bàn giao
                  </h3>
                </div>
              </div>
              <div className="px-6 py-4 space-y-2">
                <p className="text-sm text-gray-500">
                  Lý do từ chối (áp dụng cho tất cả, không bắt buộc)
                </p>
                <textarea
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  rows={3}
                  placeholder="VD: Chưa nhận máy vật lý, cần xác nhận lại..."
                  className="input-field w-full"
                />
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-col gap-2 sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleBulkReject}
                  disabled={isBulkRejecting}
                  className="btn-danger sm:w-auto"
                >
                  {isBulkRejecting ? 'Đang gửi...' : `Từ chối ${pendingHandovers.length} tài sản`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBulkRejectDialog(false)}
                  className="btn-secondary sm:w-auto"
                >
                  Hủy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
