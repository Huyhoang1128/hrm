import { useEffect, useRef, useState } from 'react';
import { ChatBubbleLeftEllipsisIcon, ChevronDownIcon, ChevronUpIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import feedbackService, {
  FEEDBACK_STATUS_OPTIONS,
  FeedbackSenderItem,
  FeedbackStatus,
  FeedbackStatusCounts,
} from '@/services/feedback.service';
import { FEEDBACK_STATUS_STYLE, FeedbackStatusBadge, FeedbackStatusTimeline, formatFeedbackTime } from './FeedbackStatus';

const PAGE_SIZE = 10;

/** Người gửi tự theo dõi các ý kiến mình đã gửi: lọc theo trạng thái, xem phản hồi và tiến trình xử lý. */
export default function MyFeedbackList() {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [items, setItems] = useState<FeedbackSenderItem[]>([]);
  const [counts, setCounts] = useState<FeedbackStatusCounts | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const fetchSeq = useRef(0);

  const load = async (pageNum: number) => {
    const reqId = ++fetchSeq.current;
    setLoading(true);
    setError('');
    try {
      const data = await feedbackService.mine({ page: pageNum, page_size: PAGE_SIZE, status: statusFilter || undefined });
      if (reqId !== fetchSeq.current) return;
      setItems((prev) => (pageNum === 1 ? data.results : [...prev, ...data.results]));
      setCounts(data.counts);
      setHasMore(!!data.next);
      setPage(pageNum);
    } catch {
      if (reqId === fetchSeq.current) setError('Không tải được danh sách ý kiến. Vui lòng thử lại.');
    } finally {
      if (reqId === fetchSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const chips: { value: FeedbackStatus | ''; label: string; count?: number }[] = [
    { value: '', label: 'Tất cả', count: counts?.total },
    ...FEEDBACK_STATUS_OPTIONS.map((o) => ({ ...o, count: counts?.[o.value] })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = statusFilter === c.value;
          const style = c.value
            ? (active ? FEEDBACK_STATUS_STYLE[c.value].chipActive : FEEDBACK_STATUS_STYLE[c.value].chip)
            : (active ? 'border-gray-700 bg-gray-700 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50');
          return (
            <button
              key={c.value || 'ALL'}
              type="button"
              onClick={() => setStatusFilter(c.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${style}`}
            >
              {c.label}{c.count !== undefined ? ` (${c.count})` : ''}
            </button>
          );
        })}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-400">
          {statusFilter ? 'Không có ý kiến nào ở trạng thái này.' : 'Bạn chưa gửi ý kiến nào.'}
        </div>
      )}

      <ul className="space-y-3">
        {items.map((fb) => {
          const answered = fb.answers.filter((a) => a.answer.trim());
          const expanded = expandedId === fb.id;
          return (
            <li key={fb.id} className={`rounded-xl border border-gray-200 border-l-4 ${FEEDBACK_STATUS_STYLE[fb.status].border} bg-white p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <FeedbackStatusBadge status={fb.status} label={fb.status_display} />
                  <span className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">{fb.topic_display}</span>
                  <span className="text-gray-500">Gửi tới {fb.handler_unit}</span>
                  {fb.is_anonymous && (
                    <span className="inline-flex items-center gap-1 text-gray-500">
                      <EyeSlashIcon className="h-3.5 w-3.5" /> Ẩn danh
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">#{fb.id} · {formatFeedbackTime(fb.created_at)}</span>
              </div>

              {answered[0] && !expanded && (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-gray-700">{answered[0].answer}</p>
              )}

              {fb.response_note ? (
                <div className="mt-3 flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                  <ChatBubbleLeftEllipsisIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
                  <div>
                    <div className="text-xs font-semibold text-blue-700">Phản hồi từ {fb.handler_unit}</div>
                    <p className="whitespace-pre-wrap">{fb.response_note}</p>
                  </div>
                </div>
              ) : fb.status === 'NEW' ? (
                <p className="mt-3 text-xs text-red-600">Đang chờ {fb.handler_unit} tiếp nhận.</p>
              ) : null}

              <div className="mt-3">
                <FeedbackStatusTimeline item={fb} />
              </div>

              {expanded && (
                <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                  {answered.map((a) => (
                    <div key={a.field}>
                      <div className="text-xs font-semibold text-gray-500">{a.question}</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{a.answer}</p>
                    </div>
                  ))}
                  {fb.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {fb.attachments.map((att) =>
                        att.url ? (
                          <a
                            key={att.id}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={att.file_name}
                            className="block h-16 w-16 overflow-hidden rounded-lg border border-gray-200 hover:ring-2 hover:ring-primary-400"
                          >
                            <img src={att.url} alt={att.file_name} className="h-full w-full object-cover" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
              )}

              {(answered.length > 0 || fb.attachments.length > 0) && (
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : fb.id)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                  {expanded ? <>Thu gọn <ChevronUpIcon className="h-3.5 w-3.5" /></> : <>Xem nội dung đã gửi <ChevronDownIcon className="h-3.5 w-3.5" /></>}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      )}
      {!loading && hasMore && (
        <div className="flex justify-center">
          <button type="button" onClick={() => load(page + 1)} className="btn-secondary px-4 py-1.5 text-sm">
            Xem thêm
          </button>
        </div>
      )}
    </div>
  );
}
