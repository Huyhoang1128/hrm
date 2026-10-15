import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircleIcon, EyeSlashIcon, InboxIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { useFeedbackNotice } from '@/contexts/FeedbackNoticeContext';
import { BRAND } from '@/config/brand';

const FEEDBACK_PAGE = '/dashboard/feedbacks';

const readStoredId = (key: string): number => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};

const writeStoredId = (key: string, id: number) => {
  try {
    localStorage.setItem(key, String(id));
  } catch {
    // Trình duyệt chặn localStorage: popup có thể hiện lại sau khi tải lại trang.
  }
};

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');

/**
 * Popup thông báo "Tiếp nhận - xử lý - Phản hồi IT/HC":
 *  - HCNS/Admin: có ý kiến mới (id mới hơn lần báo trước) thuộc phần mình xử lý.
 *  - Nhân sự: ý kiến của mình đã được đánh dấu "Đã xử lý" (kèm phản hồi).
 */
export default function FeedbackNotices() {
  const { user } = useAuth();
  const { can_handle, pending_count, latest_pending_id, resolved, acknowledgeResolved, openBox } = useFeedbackNotice();
  const navigate = useNavigate();
  const location = useLocation();

  const storageKey = `feedback_last_notified_id:${user?.username || user?.id || ''}`;
  const [lastNotifiedId, setLastNotifiedId] = useState(() => readStoredId(storageKey));
  useEffect(() => setLastNotifiedId(readStoredId(storageKey)), [storageKey]);

  const markNotified = useCallback(() => {
    if (!latest_pending_id) return;
    setLastNotifiedId(latest_pending_id);
    writeStoredId(storageKey, latest_pending_id);
  }, [latest_pending_id, storageKey]);

  const onFeedbackPage = location.pathname.startsWith(FEEDBACK_PAGE);
  const hasUnnotified = can_handle && pending_count > 0 && !!latest_pending_id && latest_pending_id > lastNotifiedId;

  // Đang mở trang quản lý ý kiến thì coi như đã thấy, không cần popup.
  useEffect(() => {
    if (onFeedbackPage && hasUnnotified) markNotified();
  }, [onFeedbackPage, hasUnnotified, markNotified]);

  return (
    <>
      {hasUnnotified && !onFeedbackPage && (
        <div className="fixed right-4 top-20 z-40 w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white shadow-xl ring-1 ring-gray-200">
          <div className="flex items-start gap-3 p-4">
            <div className="rounded-lg bg-red-50 p-2 text-red-600">
              <InboxIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Có ý kiến mới cần tiếp nhận</p>
              <p className="mt-0.5 text-sm text-gray-500">
                Đang có <span className="font-semibold text-red-600">{pending_count}</span> ý kiến chờ bạn tiếp nhận và xử lý.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => { markNotified(); navigate(FEEDBACK_PAGE); }}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  Xem ngay
                </button>
                <button type="button" onClick={markNotified} className="btn-secondary px-3 py-1.5 text-sm">
                  Để sau
                </button>
              </div>
            </div>
            <button type="button" onClick={markNotified} className="text-gray-400 hover:text-gray-600" title="Đóng">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {resolved.length > 0 &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex flex-col items-center px-6 pb-4 pt-8">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircleIcon className="h-10 w-10 text-emerald-600" />
                </div>
                <h2 className="text-center text-lg font-bold text-gray-900">
                  {resolved.length > 1 ? `${resolved.length} ý kiến của bạn đã được xử lý xong` : 'Ý kiến của bạn đã được xử lý xong'}
                </h2>
                <p className="mt-1 text-center text-sm text-gray-500">Cảm ơn bạn đã chia sẻ cùng {BRAND.companyName}.</p>
              </div>
              <ul className="space-y-2 overflow-y-auto px-6 pb-2">
                {resolved.map((r) => (
                  <li key={r.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">{r.topic_display}</span>
                      {r.is_anonymous && (
                        <span className="inline-flex items-center gap-1 text-gray-500">
                          <EyeSlashIcon className="h-3.5 w-3.5" /> Ẩn danh
                        </span>
                      )}
                      <span className="text-gray-400">· Gửi ngày {formatDate(r.created_at)}</span>
                    </div>
                    {r.excerpt && <p className="mt-1.5 line-clamp-3 text-sm text-gray-700">“{r.excerpt}”</p>}
                    {r.response_note && (
                      <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-blue-100 bg-blue-50 px-2 py-1.5 text-sm text-blue-900">
                        <span className="font-semibold">Phản hồi:</span> {r.response_note}
                      </p>
                    )}
                    {r.resolved_at && <p className="mt-1 text-xs text-emerald-700">Đã xử lý xong ngày {formatDate(r.resolved_at)}</p>}
                  </li>
                ))}
              </ul>
              <div className="flex justify-center gap-3 px-6 py-4">
                <button
                  type="button"
                  onClick={() => { acknowledgeResolved(resolved.map((r) => r.id)); openBox('mine'); }}
                  className="btn-secondary"
                >
                  Xem ý kiến của tôi
                </button>
                <button
                  type="button"
                  onClick={() => acknowledgeResolved(resolved.map((r) => r.id))}
                  className="rounded-lg bg-emerald-600 px-8 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
