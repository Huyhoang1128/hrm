import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bars3Icon,
  BellIcon,
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  ArrowDownTrayIcon,
  DevicePhoneMobileIcon,
  ChatBubbleBottomCenterTextIcon,
  InboxIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceAppDownloadAPI, hrmAPI, type AttendanceAppDownloadConfig } from '@/utils/api';
import { useNotificationDrawer } from '@/contexts/NotificationDrawerContext';
import { useFeedbackNotice } from '@/contexts/FeedbackNoticeContext';
import { internalChatAPI } from '@/utils/api';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '@/config/brand';
import FeedbackBoxModal from '@/components/FeedbackBoxModal';
import { FEEDBACK_FEATURE_NAME } from '@/services/feedback.service';

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

interface HeaderProps {
  /** Mở menu trượt (chỉ hiện nút trên điện thoại/tablet, < lg). */
  onOpenMobileNav: () => void;
}

export default function Header({ onOpenMobileNav }: HeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [appDownloadConfig, setAppDownloadConfig] = useState<AttendanceAppDownloadConfig | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const bellListRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { unreadIds, markRead, openDrawer } = useNotificationDrawer();
  const {
    can_handle: feedbackCanHandle,
    pending_count: feedbackPendingCount,
    boxTab: feedbackBoxTab,
    openBox: openFeedbackBox,
    closeBox: closeFeedbackBox,
  } = useFeedbackNotice();
  const navigate = useNavigate();

  const refreshChatUnread = useCallback(() => {
    internalChatAPI.unreadCount().then(setChatUnreadCount).catch(() => {});
  }, []);

  useEffect(() => {
    attendanceAppDownloadAPI.getConfig().then(setAppDownloadConfig).catch(() => setAppDownloadConfig(null));
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    refreshChatUnread();
    const timer = window.setInterval(refreshChatUnread, 10000);
    window.addEventListener('focus', refreshChatUnread);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshChatUnread);
    };
  }, [refreshChatUnread]);

  const fetchPage = useCallback(async (pageNum: number, replace: boolean) => {
    try {
      if (!replace) setLoadingMore(true);
      const res = await hrmAPI.getCompanyAnnouncements({ is_current: true, home_feed: true, page: pageNum, page_size: 20 });
      const results = res.results || [];
      if (replace) setAnnouncements(results);
      else setAnnouncements(prev => [...prev, ...results]);
      setHasMore(!!res.next);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchPage(1, true); }, [fetchPage]);

  useEffect(() => {
    if (page === 1) return;
    fetchPage(page, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // IntersectionObserver trong dropdown list
  useEffect(() => {
    if (!bellOpen) return;
    const sentinel = sentinelRef.current;
    const container = bellListRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          setPage(prev => prev + 1);
        }
      },
      { root: container, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [bellOpen, hasMore, loadingMore]);

  // Đóng dropdown khi click ngoài
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    setUserMenuOpen(false);
  };

  return (
    <>
      {/* Dưới lg: 1 thanh duy nhất màu thương hiệu (menu + logo + chuông + tài khoản) —
          trước đây có 2 thanh chồng nhau (thanh logo + thanh tìm kiếm) chiếm ~128px
          đầu màn hình điện thoại, mà ô tìm kiếm ở đây chưa có chức năng. */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-x-3 border-b border-primary-800/60 bg-primary-900 px-3 shadow-sm sm:gap-x-6 sm:px-6 lg:h-16 lg:border-gray-100 lg:bg-white">
        <button
          type="button"
          className="-ml-1 p-1.5 text-primary-200 hover:text-white transition-colors lg:hidden"
          onClick={onOpenMobileNav}
        >
          <span className="sr-only">Mở menu</span>
          <Bars3Icon className="h-6 w-6" aria-hidden="true" />
        </button>
        <img
          src={BRAND.logoUrl}
          alt={BRAND.appName}
          className="h-8 w-auto max-w-[110px] object-contain brightness-[400] lg:hidden"
        />
        <div className="flex flex-1 items-center justify-end gap-x-4 lg:justify-start lg:gap-x-6">
          <form className="relative hidden flex-1 items-center lg:flex" action="#" method="GET">
            <label htmlFor="search-field" className="sr-only">
              Tìm kiếm
            </label>
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-0 h-5 w-5 text-gray-400"
              aria-hidden="true"
            />
            <input
              id="search-field"
              className="block w-full border-0 py-2 pl-8 pr-0 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm bg-transparent"
              placeholder="Tìm kiếm..."
              type="search"
              name="search"
            />
          </form>
          <div className="flex items-center gap-x-4 lg:gap-x-6">
            <button
              type="button"
              onClick={() => openFeedbackBox('send')}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
              title={`${FEEDBACK_FEATURE_NAME} — gửi và theo dõi ý kiến`}
            >
              <ChatBubbleBottomCenterTextIcon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Phản hồi IT/HC</span>
            </button>

            {feedbackCanHandle && (
              <button
                type="button"
                onClick={() => navigate('/dashboard/feedbacks')}
                className="relative p-1.5 text-gray-500 transition-colors hover:text-primary-600"
                title={feedbackPendingCount > 0 ? `${FEEDBACK_FEATURE_NAME}: ${feedbackPendingCount} ý kiến chờ tiếp nhận` : FEEDBACK_FEATURE_NAME}
              >
                <span className="sr-only">{FEEDBACK_FEATURE_NAME}</span>
                <InboxIcon className="h-6 w-6" aria-hidden="true" />
                {feedbackPendingCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {feedbackPendingCount > 99 ? '99+' : feedbackPendingCount}
                  </span>
                )}
              </button>
            )}

            <div className="relative" ref={downloadMenuRef}>
              <button
                type="button"
                onClick={() => setDownloadMenuOpen((open) => !open)}
                className="p-1.5 text-gray-500 transition-colors hover:text-primary-600"
                title="Tải ứng dụng chấm công"
                aria-expanded={downloadMenuOpen}
              >
                <span className="sr-only">Tải ứng dụng chấm công</span>
                <ArrowDownTrayIcon className="h-6 w-6" aria-hidden="true" />
              </button>

              {downloadMenuOpen && (
                <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200">
                  <div className="border-b border-gray-100 bg-primary-50 px-4 py-3">
                    <p className="text-sm font-semibold text-primary-900">
                      {appDownloadConfig?.name || 'Ứng dụng chấm công'}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">Chọn phiên bản phù hợp với thiết bị</p>
                  </div>
                  <div className="p-2">
                    {appDownloadConfig?.ios_url && (
                      <a
                        href={appDownloadConfig.ios_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setDownloadMenuOpen(false)}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-primary-50 hover:text-primary-700"
                      >
                        <DevicePhoneMobileIcon className="h-5 w-5" />
                        Tải ứng dụng cho iOS
                      </a>
                    )}
                    {appDownloadConfig?.android_url && (
                      <a
                        href={appDownloadConfig.android_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setDownloadMenuOpen(false)}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-primary-50 hover:text-primary-700"
                      >
                        <DevicePhoneMobileIcon className="h-5 w-5" />
                        Tải ứng dụng cho Android
                      </a>
                    )}
                    {!appDownloadConfig?.ios_url && !appDownloadConfig?.android_url && (
                      <p className="px-3 py-4 text-center text-sm text-gray-500">Link tải ứng dụng chưa được cấu hình.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate('/dashboard/chat')}
              className="relative p-1.5 text-gray-500 transition-colors hover:text-primary-600"
              title="Mở Chat"
            >
              <span className="sr-only">Mở Chat</span>
              <ChatBubbleLeftRightIcon className="h-6 w-6" aria-hidden="true" />
              {chatUnreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </button>

            {/* Bell + Notification Dropdown */}
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                onClick={() => setBellOpen((o) => !o)}
                className="p-1.5 text-primary-100 hover:text-white lg:text-gray-500 lg:hover:text-primary-600 transition-colors relative"
              >
                <span className="sr-only">Xem thông báo</span>
                <BellIcon className="h-6 w-6" aria-hidden="true" />
                {unreadIds.size > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold ring-2 ring-primary-900 lg:ring-white">
                    {unreadIds.size > 9 ? '9+' : unreadIds.size}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="fixed inset-x-3 top-14 z-30 mt-2 origin-top-right rounded-xl bg-white shadow-xl ring-1 ring-gray-200 overflow-hidden sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:w-80">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-primary-100 bg-primary-50">
                    <span className="text-sm font-semibold text-primary-900">Thông báo</span>
                    {unreadIds.size > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
                        {unreadIds.size} mới
                      </span>
                    )}
                  </div>

                  {/* List */}
                  <div ref={bellListRef} className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                    {announcements.length === 0 ? (
                      <p className="px-4 py-6 text-sm text-gray-400 text-center">Không có thông báo nào.</p>
                    ) : (
                      announcements.map((ann) => {
                        const isUnread = unreadIds.has(ann.id);
                        return (
                          <div
                            key={ann.id}
                            onClick={() => { markRead(ann.id); setBellOpen(false); openDrawer(ann); }}
                            className={`flex gap-2 px-4 py-3 cursor-pointer transition-colors border-l-4 ${PRIORITY_BORDER[ann.priority] || 'border-gray-200'} ${isUnread ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                          >
                            {isUnread && (
                              <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-blue-500" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 flex-wrap mb-0.5">
                                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${TYPE_BADGE[ann.announcement_type] || 'bg-gray-100 text-gray-600'}`}>
                                  {ann.announcement_type_display || ann.announcement_type}
                                </span>
                                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${PRIORITY_BADGE[ann.priority] || 'bg-gray-100 text-gray-600'}`}>
                                  {ann.priority_display || ann.priority}
                                </span>
                              </div>
                              <p className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{ann.title}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {ann.effective_from ? new Date(ann.effective_from).toLocaleDateString('vi-VN') : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    {/* Infinite scroll sentinel */}
                    <div ref={sentinelRef} className="py-2 flex justify-center">
                      {loadingMore && (
                        <div className="animate-spin h-4 w-4 border-2 border-primary-600 border-t-transparent rounded-full" />
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-gray-100">
                    <button
                      onClick={() => { setBellOpen(false); openDrawer(); }}
                      className="w-full px-4 py-2.5 text-sm font-semibold text-primary-600 hover:bg-primary-50 transition-colors text-center tracking-tight"
                    >
                      Xem tất cả thông báo →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-200" />

            {/* Profile dropdown */}
            <div className="relative">
              <button
                type="button"
                className="flex items-center p-1.5"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
              >
                <span className="sr-only">Mở menu người dùng</span>
                {user?.hrm_user?.avatar_url ? (
                  <img
                    src={user.hrm_user.avatar_url}
                    alt="Avatar"
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <UserCircleIcon
                    className="h-8 w-8 text-primary-200 lg:text-gray-400"
                    aria-hidden="true"
                  />
                )}
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2.5 w-56 max-w-[calc(100vw-1.5rem)] origin-top-right rounded-lg bg-white py-1 shadow-lg ring-1 ring-gray-900/5">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="font-medium text-sm text-gray-900 break-words">
                        {user?.firstName} {user?.lastName}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 break-all">{user?.email}</div>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={handleLogout}
                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <ArrowRightOnRectangleIcon className="h-4 w-4 mr-3 text-red-500" />
                        Đăng xuất
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {feedbackBoxTab && <FeedbackBoxModal initialTab={feedbackBoxTab} onClose={closeFeedbackBox} />}
    </>
  );
}
