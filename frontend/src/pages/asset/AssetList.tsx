import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { assetsAPI, positionsAPI } from '../../utils/api';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  ComputerDesktopIcon,
  UserIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  ArrowPathRoundedSquareIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentArrowDownIcon,
} from '@heroicons/react/24/outline';
import AssetCreateModal from './AssetCreateModal';
import AssetEditModal from './AssetEditModal';
import AssetDetailModal from './AssetDetailModal';
import AssetAssignModal from './AssetAssignModal';
import AssetReturnModal from './AssetReturnModal';
import AssetBulkAssignModal from './AssetBulkAssignModal';
import AssetBulkReturnModal from './AssetBulkReturnModal';
import { Asset, AssetStats } from '../../utils/api';
import { SelectBox, SelectOption, MultiSelectBox } from '../../components/LandingLayout/SelectBox';
import FeedbackDialog, { FeedbackVariant } from '../../components/FeedbackDialog';
import Pagination from '../../components/Pagination';
import { assetTypeOptionsFrom, isMultiHolderType } from './assetTypes';

// Màu badge loại tài sản — chỉ dùng màu semantic được phép trong design system
const ASSET_TYPE_COLOR_MAP: Record<string, string> = {
  LAPTOP:    'bg-primary-100 text-primary-800 border-primary-200',
  DESKTOP:   'bg-pink-100 text-pink-800 border-pink-200',
  MONITOR:   'bg-violet-100 text-violet-800 border-violet-200',
  PHONE:     'bg-primary-100 text-primary-700 border-primary-200',
  TABLET:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  PRINTER:   'bg-pink-100 text-pink-700 border-pink-200',
  SCANNER:   'bg-amber-100 text-amber-800 border-amber-200',
  NETWORK:   'bg-violet-100 text-violet-700 border-violet-200',
  SERVER:    'bg-amber-100 text-amber-700 border-amber-200',
  SIM:       'bg-emerald-100 text-emerald-800 border-emerald-200',
  FURNITURE: 'bg-gray-100 text-gray-700 border-gray-200',
  VEHICLE:   'bg-gray-100 text-gray-700 border-gray-200',
  OTHER:     'bg-gray-100 text-gray-600 border-gray-200',
};

const ASSET_STATUS_OPTIONS: SelectOption<string>[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'NEW', label: 'Sẵn dùng (Mới 100%) / SIM chưa kích hoạt' },
  { value: 'IN_USE', label: 'Đang sử dụng' },
  { value: 'IDLE', label: 'Sẵn dùng (Trong kho)' },
  { value: 'UNDER_MAINTENANCE', label: 'Đang sửa chữa / SIM tạm khóa' },
  { value: 'DAMAGED', label: 'Lỗi / Chờ thanh lý' },
  { value: 'RETIRED', label: 'Đã thanh lý' },
  { value: 'TERMINATED', label: 'Đã cắt (SIM)' },
  { value: 'LOST', label: 'Bị mất' },
];

const ASSET_CONDITION_OPTIONS: SelectOption<string>[] = [
  { value: 'all', label: 'Tất cả tình trạng' },
  { value: 'EXCELLENT', label: 'Mới 100%' },
  { value: 'GOOD', label: 'Cũ (Chất lượng tốt)' },
  { value: 'FAIR', label: 'Cũ (Trầy xước / Cấn móp)' },
  { value: 'POOR', label: 'Cũ (Kém / Lỗi chức năng)' },
  { value: 'BROKEN', label: 'Hỏng (Không hoạt động)' },
];

const HANDOVER_STATUS_OPTIONS: SelectOption<string>[] = [
  { value: 'all', label: 'Tất cả trạng thái bàn giao' },
  { value: 'PENDING', label: 'Chờ người nhận xác nhận' },
];

// Format helpers chuẩn design system
const formatNumber = (n: number) =>
  n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const formatDate = (d: Date | string | undefined) => {
  if (!d) return 'N/A';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return 'N/A';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

export default function AssetList() {
  useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [handoverFilter, setHandoverFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [conditionFilter, setConditionFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [positions, setPositions] = useState<SelectOption<string>[]>([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnHolder, setReturnHolder] = useState<{ historyId?: number; holderName?: string; holderQuantity?: number } | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ variant: FeedbackVariant; title: React.ReactNode; message?: React.ReactNode } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<number>>(new Set());
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [isBulkReturnModalOpen, setIsBulkReturnModalOpen] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Deep-link mở thẳng 1 tài sản (VD quét mã QR dán trên tài sản → /dashboard/assets/:assetId)
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);


  useEffect(() => {
    const anyOpen = isDeleteDialogOpen || isBulkDeleteDialogOpen;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isDeleteDialogOpen, isBulkDeleteDialogOpen]);

  useEffect(() => {
    fetchStats();
    positionsAPI.list({ page_size: 100 }).then((data) => {
      setPositions(
        (data.results || []).map((pos) => ({ value: String(pos.id), label: pos.title }))
      );
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [handoverFilter]);

  // Nếu vào bằng deep-link /dashboard/assets/:assetId (quét mã QR) — tự fetch
  // đúng tài sản đó (có thể không nằm trong trang đầu của danh sách phân trang)
  // và mở modal chi tiết luôn.
  useEffect(() => {
    if (!assetId) return;
    const id = Number(assetId);
    if (!Number.isFinite(id)) {
      setDeepLinkError('Mã tài sản không hợp lệ.');
      return;
    }
    setDeepLinkError(null);
    assetsAPI.getById(id)
      .then((asset) => {
        setSelectedAsset(asset);
        setIsDetailModalOpen(true);
      })
      .catch(() => {
        setDeepLinkError('Không tìm thấy tài sản này hoặc bạn không có quyền xem.');
      });
  }, [assetId]);

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const data = await assetsAPI.list({
        pending_handover: handoverFilter === 'PENDING' || undefined,
      });
      setAssets(data.results || []);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching assets:', err);
      setError('Không thể tải danh sách tài sản. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await assetsAPI.stats();
      setStats(data);
    } catch (err: any) {
      console.error('Error fetching asset stats:', err);
    }
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    const selectedAssets = filteredAssets.filter((a) => selectedAssetIds.has(a.id));
    const assignedAssets = selectedAssets.filter((a) => !!a.assigned_to_name);
    const today = new Date().toISOString().slice(0, 10);
    // Giai đoạn 1: thu hồi các tài sản đang bàn giao
    if (assignedAssets.length > 0) {
      await Promise.allSettled(
        assignedAssets.map((a) =>
          assetsAPI.returnAsset(a.id, {
            return_date: today,
            condition: a.condition,
            notes: 'Tự động thu hồi trước khi xóa',
          })
        )
      );
    }
    // Giai đoạn 2: xóa tất cả
    const ids = selectedAssets.map((a) => a.id);
    const settled = await Promise.allSettled(ids.map((id) => assetsAPI.delete(id)));
    setAssets((prev) => prev.filter((a) => !ids.includes(a.id) || settled[ids.indexOf(a.id)]?.status === 'rejected'));
    fetchStats();
    setIsBulkDeleting(false);
    setIsBulkDeleteDialogOpen(false);
    setSelectedAssetIds(new Set());
    const successCount = settled.filter((r) => r.status === 'fulfilled').length;
    const failCount = settled.length - successCount;
    setFeedback({
      variant: failCount === 0 ? 'success' : 'warning',
      title: failCount === 0 ? 'Đã xóa thành công' : `${successCount} thành công, ${failCount} thất bại`,
      message: assignedAssets.length > 0
        ? `Đã thu hồi ${assignedAssets.length} tài sản, sau đó xóa ${successCount} tài sản.`
        : `Đã xóa ${successCount} tài sản.`,
    });
  };

  const confirmDelete = (id: number) => {
    setAssetToDelete(id);
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (assetToDelete === null) return;

    try {
      await assetsAPI.delete(assetToDelete);
      setAssets(assets.filter(asset => asset.id !== assetToDelete));
      fetchStats();
      setIsDeleteDialogOpen(false);
      setAssetToDelete(null);
    } catch (err: any) {
      console.error('Error deleting asset:', err);
      setFeedback({ variant: 'error', title: 'Không thể xóa tài sản', message: 'Đã có lỗi xảy ra. Vui lòng thử lại sau.' });
    }
  };

  const filteredAssets = assets.filter(asset => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term ||
      asset.asset_code.toLowerCase().includes(term) ||
      asset.name.toLowerCase().includes(term) ||
      asset.brand.toLowerCase().includes(term) ||
      asset.model.toLowerCase().includes(term) ||
      (asset.managed_by_name || '').toLowerCase().includes(term) ||
      (asset.assigned_to_name || '').toLowerCase().includes(term);

    const matchesStatus = statusFilter === 'all' || asset.status === statusFilter;
    const matchesHandover = handoverFilter === 'all' ||
      (handoverFilter === 'PENDING' && Boolean(asset.pending_assignment));
    const matchesType = typeFilter.length === 0 || typeFilter.includes(asset.asset_type);
    const matchesCondition = conditionFilter === 'all' || asset.condition === conditionFilter;
    const assetDate = asset.created_at ? asset.created_at.slice(0, 10) : '';
    const matchesDateFrom = !dateFrom || assetDate >= dateFrom;
    const matchesDateTo = !dateTo || assetDate <= dateTo;
    const matchesLocation = !locationFilter || String((asset.specifications as any)?.position_id ?? '') === locationFilter;

    return matchesSearch && matchesStatus && matchesHandover && matchesType && matchesCondition && matchesDateFrom && matchesDateTo && matchesLocation;
  }).sort((a, b) => a.asset_code.localeCompare(b.asset_code, 'vi', { numeric: true, sensitivity: 'base' }));

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / itemsPerPage));
  const clampedPage = Math.min(currentPage, totalPages);
  const paginatedAssets = filteredAssets.slice(
    (clampedPage - 1) * itemsPerPage,
    clampedPage * itemsPerPage,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, handoverFilter, typeFilter, conditionFilter, dateFrom, dateTo, locationFilter, itemsPerPage]);

  const handleEditClick = (asset: Asset) => {
    setEditingAsset(asset);
    setIsEditModalOpen(true);
  };

  const handleDetailClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsDetailModalOpen(true);
  };

  const handleAssignClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsAssignModalOpen(true);
  };

  const handleReturnClick = (asset: Asset) => {
    setSelectedAsset(asset);
    // MONITOR single-holder: pass holder info cho ReturnModal
    const holders = asset.holders || [];
    if (isMultiHolderType(asset.asset_type) && holders.length === 1) {
      const h = holders[0];
      setReturnHolder({ historyId: h.history_id, holderName: h.name, holderQuantity: h.assigned_quantity });
    } else {
      setReturnHolder(null);
    }
    setIsReturnModalOpen(true);
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const blob = await assetsAPI.exportExcel({
        search: searchTerm || undefined,
        asset_type: typeFilter.length > 0 ? typeFilter.join(',') : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        condition: conditionFilter !== 'all' ? conditionFilter : undefined,
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tai-san-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Export error:', err);
      const msg = err.response?.data?.error || err.message || 'Đã có lỗi xảy ra khi tạo file Excel.';
      setFeedback({
        variant: 'error',
        title: 'Xuất Excel thất bại',
        message: `${msg}\n\nVui lòng thử lại hoặc liên hệ quản trị viên.`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const blob = await assetsAPI.exportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mau-import-tai-san.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Download template error:', err);
      const msg = err.response?.data?.error || err.message || 'Đã có lỗi xảy ra khi tải file mẫu.';
      setFeedback({
        variant: 'error',
        title: 'Tải file mẫu thất bại',
        message: `${msg}\n\nVui lòng thử lại hoặc liên hệ quản trị viên.`,
      });
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const result = await assetsAPI.bulkImportExcel(file);

      await Promise.all([fetchAssets(), fetchStats()]);

      const { created, updated, failed_count, failed } = result;
      const total = created + updated;
      const failedLines = failed
        .slice(0, 5)
        .map((f: any) => `  Dòng ${f.row}: ${f.messages.join('; ')}`)
        .join('\n');
      const moreCount = failed.length > 5 ? failed.length - 5 : 0;

      if (failed_count === 0 && total > 0) {
        setFeedback({
          variant: 'success',
          title: 'Import hoàn tất',
          message: (
            <div className="space-y-2">
              <p><span className="font-semibold text-emerald-600">{total} tài sản</span> đã được xử lý thành công.</p>
              <div className="flex gap-4 text-xs bg-emerald-50 rounded-xl px-3 py-2 border border-emerald-100">
                <span>Tạo mới: <strong className="text-emerald-700">{created}</strong></span>
                <span>Cập nhật: <strong className="text-emerald-700">{updated}</strong></span>
              </div>
            </div>
          ),
        });
      } else if (total > 0 && failed_count > 0) {
        setFeedback({
          variant: 'warning',
          title: (
            <>Import <span className="text-emerald-600">{total} thành công</span>, <span className="text-red-600">{failed_count} lỗi</span></>
          ),
          message: (
            <div className="space-y-3">
              <div className="flex gap-4 text-xs bg-emerald-50 rounded-xl px-3 py-2 border border-emerald-100">
                <span>Tạo mới: <strong className="text-emerald-700">{created}</strong></span>
                <span>Cập nhật: <strong className="text-emerald-700">{updated}</strong></span>
              </div>
              <div className="bg-red-50 rounded-xl px-3 py-2 border border-red-100">
                <p className="text-xs font-semibold text-red-700 mb-1">{failed_count} dòng không import được:</p>
                <div className="text-xs text-red-600 whitespace-pre-line">{failedLines}</div>
                {moreCount > 0 && <p className="text-xs text-red-400 mt-1 italic">...và {moreCount} lỗi khác</p>}
              </div>
              <p className="text-xs text-gray-500 italic">Vui lòng kiểm tra lại các dòng lỗi trong file Excel.</p>
            </div>
          ),
        });
      } else if (failed_count > 0) {
        setFeedback({
          variant: 'error',
          title: 'Import không thành công',
          message: (
            <div className="space-y-3">
              <p>Không có dòng nào được import. <span className="font-semibold text-red-600">{failed_count} dòng lỗi</span>:</p>
              <div className="bg-red-50 rounded-xl px-3 py-2 border border-red-100">
                <div className="text-xs text-red-600 whitespace-pre-line">{failedLines}</div>
                {moreCount > 0 && <p className="text-xs text-red-400 mt-1 italic">...và {moreCount} lỗi khác</p>}
              </div>
              <p className="text-xs text-gray-500 italic">Vui lòng kiểm tra lại file và thử import lại.</p>
            </div>
          ),
        });
      } else {
        setFeedback({
          variant: 'info',
          title: 'Không có dữ liệu',
          message: 'File Excel không chứa dòng dữ liệu nào để import.',
        });
      }
    } catch (err: any) {
      console.error('Import error:', err);
      const msg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        'Không thể upload file Excel.';
      setFeedback({
        variant: 'error',
        title: 'Lỗi tải file',
        message: `${msg}\n\nVui lòng kiểm tra kết nối mạng và đảm bảo file đúng định dạng .xlsx`,
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IN_USE':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'IDLE':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'UNDER_MAINTENANCE':
        // Cũng dùng cho SIM "Tạm khóa"
        return 'bg-primary-100 text-primary-800 border border-primary-200';
      case 'DAMAGED':
        return 'bg-red-100 text-red-800 border border-red-200';
      case 'RETIRED':
        return 'bg-gray-100 text-gray-800 border border-gray-200';
      case 'TERMINATED':
        // SIM "Đã cắt" — màu rose để phân biệt với RETIRED
        return 'bg-rose-100 text-rose-800 border border-rose-200';
      case 'LOST':
        return 'bg-gray-200 text-gray-800 border border-gray-300';
      case 'NEW':
        return 'bg-violet-100 text-violet-800 border border-violet-200';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'EXCELLENT':
        return 'bg-violet-100 text-violet-800 border-violet-200';
      case 'GOOD':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'FAIR':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'POOR':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'BROKEN':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };


  if (loading && assets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải danh sách tài sản...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {deepLinkError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
          <span>{deepLinkError}</span>
          <button
            onClick={() => { setDeepLinkError(null); navigate('/dashboard/assets'); }}
            className="text-red-600 hover:text-red-800 font-medium text-xs"
          >
            Về danh sách tài sản
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý tài sản</h1>
          <p className="mt-1 text-sm text-gray-900">
            Quản lý tất cả tài sản công ty, theo dõi trạng thái và người sử dụng
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={handleDownloadTemplate}
            disabled={isDownloadingTemplate}
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isDownloadingTemplate ? (
              <>
                <svg className="animate-spin h-4 w-4 text-primary-600" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
                Đang tải...
              </>
            ) : (
              <>
                <DocumentArrowDownIcon className="h-4 w-4" />
                Tải file mẫu
              </>
            )}
          </button>
          <button
            onClick={handleImportClick}
            disabled={isImporting}
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-primary-600" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
                Đang import...
              </>
            ) : (
              <>
                <ArrowUpTrayIcon className="h-4 w-4" />
                Nhập Excel
              </>
            )}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-primary-600" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
                Đang xuất...
              </>
            ) : (
              <>
                <ArrowDownTrayIcon className="h-4 w-4" />
                Xuất Excel
              </>
            )}
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            Thêm tài sản mới
          </button>
        </div>
      </div>

      {/* Stats + Filters — KHÔNG sticky: khối này cao (thống kê + 2 hàng filter), ghim lại
          thì cuộn xuống nó che mất phần bảng. Bảng có khung cuộn riêng + tiêu đề cột cố định. */}
      <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 py-4 space-y-4">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-3 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-5">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <ComputerDesktopIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Tổng số tài sản</p>
                  <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{formatNumber(stats.total)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-5">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <UserIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đang sử dụng</p>
                  <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{formatNumber(stats.in_use)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-5">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="h-9 w-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <ShieldCheckIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Hết hạn bảo hành</p>
                  <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{formatNumber(stats.expired_warranty)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700">
                Tìm kiếm
              </label>
              <input
                type="text"
                id="search"
                className="input-field mt-1 w-full"
                placeholder="Nhập từ khóa tìm kiếm..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-400">
                Tìm theo: mã tài sản, tên, thương hiệu, model, người quản lý kho, người sử dụng
              </p>
            </div>

            <SelectBox
              label="Trạng thái vận hành"
              value={statusFilter}
              options={ASSET_STATUS_OPTIONS}
              onChange={(val) => setStatusFilter(val)}
            />

            <SelectBox
              label="Trạng thái bàn giao"
              value={handoverFilter}
              options={HANDOVER_STATUS_OPTIONS}
              onChange={setHandoverFilter}
            />

            <SelectBox
              label="Tình trạng vật lý"
              value={conditionFilter}
              options={ASSET_CONDITION_OPTIONS}
              onChange={(val) => setConditionFilter(val)}
            />

            <MultiSelectBox
              label="Loại tài sản"
              value={typeFilter}
              options={assetTypeOptionsFrom(assets)}
              onChange={(val) => setTypeFilter(val)}
              allLabel="Tất cả loại"
            />

            <SelectBox
              label="Vị trí"
              value={locationFilter}
              options={[{ value: '', label: 'Tất cả vị trí' }, ...positions]}
              onChange={setLocationFilter}
              placeholder="Chọn vị trí"
              searchable={true}
            />
          </div>

          {/* Lọc ngày tạo */}
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-gray-100 mt-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Ngày tạo từ</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input-field mt-1 block"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Đến ngày</label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="input-field mt-1 block"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  setDateFrom(today);
                  setDateTo(today);
                }}
                className="px-3 py-[7px] rounded-xl border border-primary-200 bg-primary-50 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
              >
                Hôm nay
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
                  setDateFrom(first);
                  setDateTo(last);
                }}
                className="px-3 py-[7px] rounded-xl border border-primary-200 bg-primary-50 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
              >
                Tháng này
              </button>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="px-3 py-[7px] rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Xóa lọc
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">{error}</h3>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action toolbar */}
      {selectedAssetIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-primary-50 border border-primary-200 rounded-2xl">
          <span className="text-sm font-medium text-primary-800">Đã chọn {selectedAssetIds.size} tài sản</span>
          <button
            onClick={() => setIsBulkAssignModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-all"
          >
            <UserPlusIcon className="h-3.5 w-3.5" />
            Bàn giao nhiều
          </button>
          <button
            onClick={() => setIsBulkReturnModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-all"
          >
            <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5" />
            Thu hồi nhiều
          </button>
          <button
            onClick={() => setIsBulkDeleteDialogOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-all"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Xóa nhanh ({selectedAssetIds.size})
          </button>
          <button
            onClick={() => setSelectedAssetIds(new Set())}
            className="text-xs text-primary-600 hover:text-primary-800 underline ml-auto"
          >
            Bỏ chọn tất cả
          </button>
        </div>
      )}

      {/* Assets Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="min-w-full divide-y divide-gray-100 whitespace-nowrap sm:whitespace-normal">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th scope="col" className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    checked={filteredAssets.length > 0 && filteredAssets.every((a) => selectedAssetIds.has(a.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAssetIds(new Set(filteredAssets.map((a) => a.id)));
                      } else {
                        setSelectedAssetIds(new Set());
                      }
                    }}
                  />
                </th>
                <th
                  scope="col"
                  className="table-header px-3 py-3 text-center sticky left-0 z-20 bg-gray-50"
                  style={{ width: 48, minWidth: 48, maxWidth: 48 }}
                >
                  STT
                </th>
                <th
                  scope="col"
                  className="table-header px-6 py-3 text-left sticky left-[48px] z-20 bg-gray-50"
                  style={{ width: 176, minWidth: 176, maxWidth: 176 }}
                >
                  Mã thiết bị
                </th>
                <th
                  scope="col"
                  className="table-header px-6 py-3 text-left sticky left-[224px] z-20 bg-gray-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                  style={{ width: 176, minWidth: 176, maxWidth: 176 }}
                >
                  Model
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Loại tài sản
                </th>
                <th scope="col" className="table-header px-4 py-3 text-center">
                  Số lượng
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Trạng thái vận hành
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Tình trạng vật lý
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Quản lý kho
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Người sử dụng
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left whitespace-nowrap">
                  Trạng thái bàn giao
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Thông tin mua
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Nhà cung cấp
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left whitespace-nowrap">
                  Ngày tạo
                </th>
                <th scope="col" className="table-header px-6 py-3 text-left">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <ComputerDesktopIcon className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">
                        Không có tài sản nào
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {searchTerm || statusFilter !== 'all' || typeFilter.length > 0
                          ? 'Không tìm thấy tài sản phù hợp với bộ lọc.'
                          : 'Bắt đầu bằng cách thêm tài sản mới.'
                        }
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedAssets.map((asset, index) => {
                  const isSelected = selectedAssetIds.has(asset.id);
                  const stickyBg = isSelected ? 'bg-primary-50' : 'bg-white group-hover:bg-gray-50';
                  return (
                  <tr key={asset.id} className={`group hover:bg-gray-50 transition-colors ${isSelected ? 'bg-primary-50' : ''}`}>
                    <td className="w-10 px-3 py-4 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        checked={isSelected}
                        onChange={(e) => {
                          setSelectedAssetIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(asset.id);
                            else next.delete(asset.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td
                      className={`table-cell px-3 py-4 text-center text-gray-400 sticky left-0 z-10 ${stickyBg}`}
                      style={{ width: 48, minWidth: 48, maxWidth: 48 }}
                    >
                      {(clampedPage - 1) * itemsPerPage + index + 1}
                    </td>
                    <td
                      className={`px-6 py-4 sticky left-[48px] z-10 ${stickyBg}`}
                      style={{ width: 176, minWidth: 176, maxWidth: 176 }}
                    >
                      <div className="text-sm font-bold text-primary-700 bg-primary-50 px-2 py-1 rounded-lg inline-block truncate max-w-full">
                        {asset.name}
                      </div>
                    </td>
                    <td
                      className={`px-6 py-4 sticky left-[224px] z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] ${stickyBg}`}
                      style={{ width: 176, minWidth: 176, maxWidth: 176 }}
                    >
                      <div className="table-cell font-medium truncate max-w-full">
                        {asset.model || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ASSET_TYPE_COLOR_MAP[asset.asset_type] ?? 'bg-gray-100 text-gray-800 border-gray-200'} uppercase tracking-tight`}>
                        {asset.asset_type === 'OTHER' && (asset.specifications as any)?.type_name
                          ? `Khác (${(asset.specifications as any).type_name})`
                          : asset.asset_type_display}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center whitespace-nowrap">
                      <span className="table-cell font-medium">
                        {asset.specifications?.quantity || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(asset.status)} uppercase tracking-tight`}>
                        {asset.status_display}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getConditionColor(asset.condition)} uppercase tracking-tight`}>
                        {asset.condition_display}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {asset.managed_by_name || asset.department_name ? (
                        <>
                          {asset.managed_by_name && (
                            <div className="text-sm font-medium text-gray-900">{asset.managed_by_name}</div>
                          )}
                          {asset.department_name && (
                            <div className="text-xs text-gray-400">{asset.department_name}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const isMulti = isMultiHolderType(asset.asset_type) && (asset.total_quantity ?? 1) > 1;
                        const holders = asset.holders || [];
                        if (isMulti) {
                          const total = asset.total_quantity ?? 1;
                          const assignedTotal = asset.assigned_quantity_total ?? 0;
                          if (holders.length === 0) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm text-gray-400">Chưa bàn giao</span>
                                <span className="text-[11px] text-gray-400">0/{total}</span>
                              </div>
                            );
                          }
                          const mergedHolders = Object.values(
                            holders.reduce((acc, h) => {
                              if (acc[h.employee_id]) {
                                acc[h.employee_id] = { ...acc[h.employee_id], assigned_quantity: acc[h.employee_id].assigned_quantity + h.assigned_quantity };
                              } else {
                                acc[h.employee_id] = { ...h };
                              }
                              return acc;
                            }, {} as Record<number, (typeof holders)[0]>)
                          );
                          const shown = mergedHolders.slice(0, 2);
                          const extra = mergedHolders.length - shown.length;
                          return (
                            <div className="flex flex-col gap-1">
                              {shown.map((h) => (
                                <div
                                  key={h.employee_id}
                                  className="text-xs font-medium text-emerald-700 bg-emerald-50 inline-flex rounded-full px-2 py-0.5 w-fit"
                                >
                                  {h.name} ({h.assigned_quantity})
                                </div>
                              ))}
                              {extra > 0 && (
                                <div className="text-[11px] text-gray-600 bg-gray-100 inline-flex rounded-full px-2 py-0.5 w-fit">
                                  +{extra} người
                                </div>
                              )}
                              <span className="text-[11px] text-gray-400">{assignedTotal}/{total}</span>
                            </div>
                          );
                        }
                        if (asset.assigned_to_name) {
                          return (
                            <div className="flex flex-col">
                              <div className="text-sm font-medium text-emerald-700 bg-emerald-50 inline-flex rounded-full px-2 py-0.5 w-fit">
                                {asset.assigned_to_name}
                              </div>
                              {asset.assigned_to_department_name && (
                                <div className="text-xs text-gray-400 mt-0.5">
                                  {asset.assigned_to_department_name}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return <span className="text-sm text-gray-400">Chưa bàn giao</span>;
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {asset.pending_assignment ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-tight text-amber-800">
                            Chờ xác nhận
                          </span>
                          {asset.pending_assignment.assigned_to_name && (
                            <span className="text-xs text-gray-500">
                              {asset.pending_assignment.assigned_to_name}
                            </span>
                          )}
                        </div>
                      ) : asset.assigned_to_name || (asset.holders?.length ?? 0) > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-tight text-emerald-800">
                          Đã xác nhận
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-tight text-gray-600">
                          Chưa bàn giao
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {formatDate(asset.purchase_date)}
                      </div>
                      {asset.warranty_expiry && (
                        <div className="text-xs text-gray-400 mt-1">
                          BH: {formatDate(asset.warranty_expiry)}
                        </div>
                      )}
                      {asset.current_value != null && (
                        <div className="text-xs text-emerald-600 mt-1">
                          Giá trị hiện tại: {Number(asset.current_value).toLocaleString('vi-VN')} đ
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[200px] truncate" title={asset.supplier || ''}>
                      {asset.supplier || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(asset.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5 min-w-[80px]">
                        {/* Row 1: Chi tiết + Sửa */}
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleDetailClick(asset)}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 transition-colors font-semibold text-xs whitespace-nowrap"
                            title="Xem chi tiết"
                          >
                            <EyeIcon className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="hidden xl:inline">Chi tiết</span>
                          </button>
                          <button
                            onClick={() => handleEditClick(asset)}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 transition-colors font-semibold text-xs whitespace-nowrap"
                            title="Chỉnh sửa thông tin"
                          >
                            <PencilIcon className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="hidden xl:inline">Sửa</span>
                          </button>
                        </div>
                        {/* Row 2: Bàn giao + Thu hồi + Xóa */}
                        <div className="flex gap-1.5">
                          {(() => {
                            const isMulti = isMultiHolderType(asset.asset_type) && (asset.total_quantity ?? 1) > 1;
                            const canAssignMore = isMulti && (asset.remaining_quantity ?? 0) > 0;
                            const showAssign = !asset.assigned_to_name || canAssignMore;
                            const hasHolders = (asset.holders?.length ?? 0) > 0;
                            const showReturn = !!asset.assigned_to_name || hasHolders;
                            const multiNeedsPicker = isMulti && (asset.holders?.length ?? 0) > 1;
                            return (
                              <>
                                {showAssign && (
                                  <button
                                    onClick={() => handleAssignClick(asset)}
                                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 transition-colors font-semibold text-xs whitespace-nowrap"
                                    title="Bàn giao người dùng"
                                  >
                                    <UserPlusIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span className="hidden xl:inline">Bàn giao</span>
                                  </button>
                                )}
                                {showReturn && (
                                  <button
                                    onClick={() => {
                                      if (multiNeedsPicker) {
                                        handleDetailClick(asset);
                                      } else {
                                        handleReturnClick(asset);
                                      }
                                    }}
                                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors font-semibold text-xs whitespace-nowrap"
                                    title={multiNeedsPicker ? 'Chọn người cần thu hồi trong Chi tiết' : 'Thu hồi về kho'}
                                  >
                                    <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span className="hidden xl:inline">Thu hồi</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => confirmDelete(asset.id)}
                                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors font-semibold text-xs whitespace-nowrap"
                                  title="Xóa tài sản"
                                >
                                  <TrashIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                  <span className="hidden xl:inline">Xóa</span>
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filteredAssets.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <Pagination
              currentPage={clampedPage}
              totalPages={totalPages}
              totalItems={filteredAssets.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={setItemsPerPage}
            />
          </div>
        )}
      </div>

      <AssetCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          fetchAssets();
          fetchStats();
        }}
      />

      <AssetEditModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingAsset(null);
        }}
        onSuccess={() => {
          fetchAssets();
          fetchStats();
        }}
        asset={editingAsset}
      />

      <AssetDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedAsset(null);
          // Vào bằng deep-link QR thì đóng modal xong quay lại danh sách bình
          // thường, tránh mở lại modal cũ khi component re-render với :assetId cũ.
          if (assetId) navigate('/dashboard/assets');
        }}
        asset={selectedAsset}
        viewMode="manager"
        onAfterReturn={() => {
          fetchAssets();
          fetchStats();
        }}
      />

      {selectedAsset && (
        <AssetAssignModal
          isOpen={isAssignModalOpen}
          onClose={() => {
            setIsAssignModalOpen(false);
            setSelectedAsset(null);
          }}
          onSuccess={() => {
            fetchAssets();
            fetchStats();
          }}
          asset={selectedAsset}
          onRequestReturn={() => {
            setIsAssignModalOpen(false);
            handleReturnClick(selectedAsset);
          }}
        />
      )}

      {selectedAsset && (
        <AssetReturnModal
          isOpen={isReturnModalOpen}
          onClose={() => {
            setIsReturnModalOpen(false);
            setSelectedAsset(null);
            setReturnHolder(null);
          }}
          onSuccess={() => {
            fetchAssets();
            fetchStats();
          }}
          asset={selectedAsset}
          historyId={returnHolder?.historyId}
          holderName={returnHolder?.holderName}
          holderQuantity={returnHolder?.holderQuantity}
        />
      )}

      <AssetBulkAssignModal
        isOpen={isBulkAssignModalOpen}
        onClose={() => setIsBulkAssignModalOpen(false)}
        onSuccess={() => {
          fetchAssets();
          fetchStats();
          setSelectedAssetIds(new Set());
        }}
        assets={filteredAssets.filter((a) => selectedAssetIds.has(a.id))}
      />

      <AssetBulkReturnModal
        isOpen={isBulkReturnModalOpen}
        onClose={() => setIsBulkReturnModalOpen(false)}
        onSuccess={() => {
          fetchAssets();
          fetchStats();
          setSelectedAssetIds(new Set());
        }}
        assets={filteredAssets.filter((a) => selectedAssetIds.has(a.id))}
      />

      {/* Bulk Delete Confirmation Dialog */}
      {isBulkDeleteDialogOpen && (() => {
        const selectedAssets = filteredAssets.filter((a) => selectedAssetIds.has(a.id));
        const assignedAssets = selectedAssets.filter((a) => !!a.assigned_to_name);
        return (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onClick={() => setIsBulkDeleteDialogOpen(false)} />
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <div className="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                <div className="bg-white px-6 pt-6 pb-4">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                      <TrashIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
                    </div>
                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                      <h3 className="text-lg leading-6 font-bold text-gray-900">
                        Xóa {selectedAssets.length} tài sản đã chọn?
                      </h3>

                      {assignedAssets.length > 0 && (
                        <div className="mt-3 space-y-3">
                          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
                            <p className="text-sm font-semibold text-amber-800">
                              Bước 1 — Thu hồi {assignedAssets.length} tài sản đang bàn giao
                            </p>
                            <p className="text-xs text-amber-700 mt-0.5">Hệ thống sẽ tự động thu hồi trước khi xóa.</p>
                            <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                              {assignedAssets.map((a) => (
                                <div key={a.id} className="flex items-center gap-1.5 text-xs text-amber-900">
                                  <span className="font-mono font-semibold">[{a.asset_code}]</span>
                                  <span className="truncate">{a.name}</span>
                                  <span className="ml-auto flex-shrink-0 text-amber-600">→ {a.assigned_to_name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-red-50 border border-red-200 p-3">
                            <p className="text-sm font-semibold text-red-800">
                              Bước 2 — Xóa tất cả {selectedAssets.length} tài sản
                            </p>
                            <p className="text-xs text-red-700 mt-0.5">Hành động này không thể hoàn tác.</p>
                          </div>
                        </div>
                      )}

                      {assignedAssets.length === 0 && (
                        <div className="mt-2">
                          <p className="text-sm text-gray-500">
                            Hành động này không thể hoàn tác. Tất cả dữ liệu liên quan sẽ bị xóa vĩnh viễn.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-row-reverse flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={isBulkDeleting}
                    onClick={handleBulkDelete}
                    className="btn-danger inline-flex justify-center disabled:opacity-50"
                  >
                    {isBulkDeleting
                      ? 'Đang xử lý...'
                      : assignedAssets.length > 0
                        ? `Thu hồi & Xóa (${selectedAssets.length} tài sản)`
                        : `Xóa ${selectedAssets.length} tài sản`
                    }
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBulkDeleteDialogOpen(false)}
                    className="btn-secondary inline-flex justify-center"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Dialog */}
      {isDeleteDialogOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" aria-hidden="true" onClick={() => setIsDeleteDialogOpen(false)}></div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-6 pt-6 pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-bold text-gray-900" id="modal-title">
                      Xác nhận xóa tài sản
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Bạn có chắc chắn muốn xóa tài sản này không? Hành động này không thể hoàn tác.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-row-reverse flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-danger inline-flex justify-center"
                  onClick={handleDelete}
                >
                  Xóa
                </button>
                <button
                  type="button"
                  className="btn-secondary inline-flex justify-center"
                  onClick={() => setIsDeleteDialogOpen(false)}
                >
                  Hủy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Dialog */}
      <FeedbackDialog
        open={!!feedback}
        variant={feedback?.variant}
        title={feedback?.title || ''}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />
    </div>
  );
}
