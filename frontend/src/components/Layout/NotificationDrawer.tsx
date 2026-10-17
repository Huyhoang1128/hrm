import { useState, useEffect, useCallback, useRef } from 'react';
import { XMarkIcon, ArrowLeftIcon, PaperClipIcon, CalendarDaysIcon, UserIcon } from '@heroicons/react/24/outline';
import { hrmAPI } from '@/utils/api';
import { SelectBox } from '@/components/LandingLayout/SelectBox';
import FilePreviewModal from '@/components/Common/FilePreviewModal';
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll';

// ── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_BORDER: Record<string, string> = {
  URGENT: 'border-red-500',
  HIGH: 'border-orange-400',
  MEDIUM: 'border-blue-400',
  LOW: 'border-gray-300',
};

const PRIORITY_BADGE: Record<string, string> = {
  URGENT: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-600',
};

const TYPE_BADGE: Record<string, string> = {
  ANNOUNCEMENT: 'bg-indigo-100 text-indigo-700',
  DECISION: 'bg-purple-100 text-purple-700',
  NOTICE: 'bg-teal-100 text-teal-700',
  CIRCULAR: 'bg-cyan-100 text-cyan-700',
  DIRECTIVE: 'bg-amber-100 text-amber-700',
  OTHER: 'bg-gray-100 text-gray-600',
};

const TYPE_OPTIONS = [
  { value: '', label: 'Tất cả loại' },
  { value: 'ANNOUNCEMENT', label: 'Thông báo' },
  { value: 'DECISION', label: 'Quyết định' },
  { value: 'NOTICE', label: 'Thông tri' },
  { value: 'CIRCULAR', label: 'Thông tư' },
  { value: 'DIRECTIVE', label: 'Chỉ thị' },
  { value: 'OTHER', label: 'Khác' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'Tất cả mức độ' },
  { value: 'URGENT', label: 'Khẩn cấp' },
  { value: 'HIGH', label: 'Cao' },
  { value: 'MEDIUM', label: 'Bình thường' },
  { value: 'LOW', label: 'Thấp' },
];

// ── Props ────────────────────────────────────────────────────────────────────

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  initialItem?: any | null;
  unreadIds?: Set<number>;
  onMarkRead?: (id: number) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function NotificationDrawer({ open, onClose, initialItem, unreadIds, onMarkRead }: NotificationDrawerProps) {
  useLockBodyScroll(open);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [detailItem, setDetailItem] = useState<any | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{ file_name: string; file_url: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (pageNum: number, replace: boolean) => {
    try {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);
      const params: any = { is_current: true, home_feed: true, page: pageNum, page_size: 20 };
      if (search) params.search = search;
      if (filterType) params.announcement_type = filterType;
      if (filterPriority) params.priority = filterPriority;
      const res = await hrmAPI.getCompanyAnnouncements(params);
      const results = res.results || [];
      if (replace) setAnnouncements(results);
      else setAnnouncements(prev => [...prev, ...results]);
      setHasMore(!!res.next);
    } catch {
      if (replace) setAnnouncements([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, filterType, filterPriority]);

  // Filter thay đổi hoặc drawer mở → reset về page 1
  useEffect(() => {
    if (!open) return;
    setPage(1);
    const t = setTimeout(() => fetchPage(1, true), 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, filterType, filterPriority]);

  // Page > 1 → load thêm (append)
  useEffect(() => {
    if (page === 1) return;
    fetchPage(page, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // IntersectionObserver trong list drawer
  useEffect(() => {
    if (!open) return;
    const sentinel = sentinelRef.current;
    const container = listRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
          setPage(prev => prev + 1);
        }
      },
      { root: container, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, hasMore, loadingMore, loading]);

  // Set detail item khi mở với item cụ thể, reset khi đóng
  useEffect(() => {
    if (open) {
      setDetailItem(initialItem ?? null);
      if (initialItem) onMarkRead?.(initialItem.id);
    } else {
      setDetailItem(null);
      setSearch('');
      setFilterType('');
      setFilterPriority('');
    }
  }, [open, initialItem]);

  const formatDate = (d: string | null) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('vi-VN');
  };



  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-gray-900/50 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[750px] max-w-full bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          {detailItem ? (
            <button
              onClick={() => setDetailItem(null)}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Quay lại
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900">Thông báo</h2>
              {announcements.length > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
                  {announcements.length}
                </span>
              )}
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {detailItem ? (
          /* ── Detail View ── */
          <div className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className={`border-l-4 ${PRIORITY_BORDER[detailItem.priority] || 'border-gray-300'} px-5 pt-5 pb-4 bg-white border-b border-gray-100`}>
              {/* Badges */}
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[detailItem.announcement_type] || 'bg-gray-100 text-gray-600'}`}>
                  {detailItem.announcement_type_display || detailItem.announcement_type}
                </span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[detailItem.priority] || 'bg-gray-100 text-gray-600'}`}>
                  {detailItem.priority_display || detailItem.priority}
                </span>
                {detailItem.is_current && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Đang hiệu lực
                  </span>
                )}
                {!detailItem.is_active && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                    Không hoạt động
                  </span>
                )}
              </div>

              {/* Title */}
              <h3 className="text-lg font-bold text-gray-900 leading-snug">{detailItem.title}</h3>

              {/* Compact meta row */}
              <div className="flex items-center gap-4 mt-2.5 text-xs text-gray-400 flex-wrap">
                {detailItem.effective_from && (
                  <span className="flex items-center gap-1">
                    <CalendarDaysIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {formatDate(detailItem.effective_from)}
                    {detailItem.effective_to ? ` – ${formatDate(detailItem.effective_to)}` : ''}
                  </span>
                )}
                {detailItem.created_by_name && (
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {detailItem.created_by_name}
                  </span>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="px-5 py-5">
              <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{detailItem.content}</p>
            </div>

            {/* Attachments */}
            {detailItem.attachments && detailItem.attachments.length > 0 && (
              <div className="px-5 pb-5 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
                {detailItem.attachments.map((att: any) => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => setAttachmentPreview(att)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors max-w-full text-left [overflow-wrap:anywhere]"
                  >
                    <PaperClipIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
                    {att.file_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── List View ── */
          <>
            {/* Filters */}
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 space-y-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm kiếm thông báo..."
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <SelectBox<string>
                    label=""
                    value={filterType}
                    options={TYPE_OPTIONS}
                    onChange={setFilterType}
                  />
                </div>
                <div className="flex-1">
                  <SelectBox<string>
                    label=""
                    value={filterPriority}
                    options={PRIORITY_OPTIONS}
                    onChange={setFilterPriority}
                  />
                </div>
              </div>
            </div>

            {/* List */}
            <div ref={listRef} className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" />
                </div>
              ) : announcements.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">Không có thông báo nào.</p>
              ) : (
                <>
                  {announcements.map((ann) => {
                    const isUnread = unreadIds?.has(ann.id) ?? false;
                    return (
                      <div
                        key={ann.id}
                        onClick={() => { onMarkRead?.(ann.id); setDetailItem(ann); }}
                        className={`px-4 py-3 cursor-pointer transition-colors border-l-4 ${PRIORITY_BORDER[ann.priority] || 'border-gray-200'} ${isUnread ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                      >
                        <div className="flex items-start gap-2">
                          {isUnread && (
                            <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-blue-500" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${TYPE_BADGE[ann.announcement_type] || 'bg-gray-100 text-gray-600'}`}>
                                {ann.announcement_type_display || ann.announcement_type}
                              </span>
                              <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${PRIORITY_BADGE[ann.priority] || 'bg-gray-100 text-gray-600'}`}>
                                {ann.priority_display || ann.priority}
                              </span>
                            </div>
                            <p className={`text-sm line-clamp-2 ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{ann.title}</p>
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-xs text-gray-400">{formatDate(ann.effective_from)}</p>
                              {ann.attachments?.length > 0 && <PaperClipIcon className="h-3.5 w-3.5 text-gray-400" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Infinite scroll sentinel */}
                  <div ref={sentinelRef} className="py-3 flex justify-center">
                    {loadingMore && (
                      <div className="animate-spin h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full" />
                    )}
                  </div>
                  {!hasMore && (
                    <p className="text-center text-xs text-gray-400 py-3">Đã hiển thị tất cả</p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <FilePreviewModal
        open={!!attachmentPreview}
        file_name={attachmentPreview?.file_name ?? ''}
        file_url={attachmentPreview?.file_url ?? ''}
        onClose={() => setAttachmentPreview(null)}
      />
    </>
  );
}
