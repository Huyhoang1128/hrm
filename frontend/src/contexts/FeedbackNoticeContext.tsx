import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import feedbackService, { FeedbackNotices } from '@/services/feedback.service';
import type { FeedbackBoxTab } from '@/components/FeedbackBoxModal';

const POLL_INTERVAL_MS = 60_000;

const EMPTY_NOTICES: FeedbackNotices = { can_handle: false, pending_count: 0, latest_pending_id: null, resolved: [] };

interface FeedbackNoticeContextType extends FeedbackNotices {
  refresh: () => void;
  acknowledgeResolved: (ids: number[]) => Promise<void>;
  /** Tab đang mở của modal gửi/theo dõi ý kiến (null = đóng). */
  boxTab: FeedbackBoxTab | null;
  openBox: (tab?: FeedbackBoxTab) => void;
  closeBox: () => void;
}

const FeedbackNoticeContext = createContext<FeedbackNoticeContextType | null>(null);

/**
 * Thông báo "Tiếp nhận - xử lý - Phản hồi IT/HC", dùng chung cho Header/Sidebar/popup:
 *  - HCNS/Admin: số ý kiến "Chờ tiếp nhận" thuộc phần mình xử lý (IT hoặc HCNS).
 *  - Nhân sự: ý kiến của mình vừa được đánh dấu "Đã xử lý", chưa bấm "Đã hiểu".
 * Kèm trạng thái mở modal để popup mở thẳng được tab "Ý kiến của tôi".
 */
export function FeedbackNoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<FeedbackNotices>(EMPTY_NOTICES);
  const [boxTab, setBoxTab] = useState<FeedbackBoxTab | null>(null);

  const refresh = useCallback(() => {
    feedbackService.notices().then(setNotices).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const acknowledgeResolved = useCallback(async (ids: number[]) => {
    setNotices((prev) => ({ ...prev, resolved: prev.resolved.filter((r) => !ids.includes(r.id)) }));
    try {
      await feedbackService.acknowledgeResolved(ids);
    } catch {
      refresh();
    }
  }, [refresh]);

  const openBox = useCallback((tab: FeedbackBoxTab = 'send') => setBoxTab(tab), []);
  const closeBox = useCallback(() => {
    setBoxTab(null);
    refresh();
  }, [refresh]);

  return (
    <FeedbackNoticeContext.Provider value={{ ...notices, refresh, acknowledgeResolved, boxTab, openBox, closeBox }}>
      {children}
    </FeedbackNoticeContext.Provider>
  );
}

export function useFeedbackNotice() {
  const ctx = useContext(FeedbackNoticeContext);
  if (!ctx) throw new Error('useFeedbackNotice must be used within FeedbackNoticeProvider');
  return ctx;
}
