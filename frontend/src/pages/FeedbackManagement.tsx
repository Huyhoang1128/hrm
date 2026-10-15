import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChatBubbleBottomCenterTextIcon,
  MagnifyingGlassIcon,
  EyeSlashIcon,
  XMarkIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import Pagination from '../components/Pagination';
import { useDebounce } from '../hooks/useDebounce';
import { useFeedbackNotice } from '../contexts/FeedbackNoticeContext';
import {
  FEEDBACK_STATUS_STYLE,
  FeedbackStatusBadge as StatusBadge,
  FeedbackStatusTimeline,
  formatFeedbackTime as formatDateTime,
} from '../components/feedback/FeedbackStatus';
import feedbackService, {
  FEEDBACK_FEATURE_NAME,
  FEEDBACK_IT_TOPICS,
  FEEDBACK_OPEN_STATUSES,
  FEEDBACK_STATUS_OPTIONS,
  FEEDBACK_TOPIC_OPTIONS,
  FeedbackItem,
  FeedbackStatus,
  FeedbackSummary,
} from '../services/feedback.service';

const Sender = ({ fb }: { fb: FeedbackItem }) =>
  fb.is_anonymous || !fb.employee_name ? (
    <span className="inline-flex items-center gap-1 font-medium text-gray-500">
      <EyeSlashIcon className="h-4 w-4" /> Ẩn danh
    </span>
  ) : (
    <span>
      <span className="font-medium text-gray-800">{fb.employee_name}</span>
      <span className="text-gray-400"> · {fb.employee_code}{fb.department_name ? ` · ${fb.department_name}` : ''}</span>
    </span>
  );

function FeedbackDetailModal({
  feedback,
  onClose,
  onSaved,
}: {
  feedback: FeedbackItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus>(feedback.status);
  const [hrNote, setHrNote] = useState(feedback.hr_note);
  const [responseNote, setResponseNote] = useState(feedback.response_note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await feedbackService.update(feedback.id, { status, hr_note: hrNote, response_note: responseNote });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Cập nhật thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const answered = feedback.answers.filter((a) => a.answer.trim());

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900">Ý kiến #{feedback.id}</h2>
              <StatusBadge status={feedback.status} label={feedback.status_display} />
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                {feedback.topic_display}
              </span>
            </div>
            <div className="text-sm mt-1"><Sender fb={feedback} /></div>
            <div className="text-xs text-gray-400 mt-0.5">Gửi lúc {formatDateTime(feedback.created_at)}</div>
          </div>
          <button onClick={onClose} disabled={saving} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <FeedbackStatusTimeline item={feedback} />
          {answered.map((a) => (
            <div key={a.field}>
              <div className="text-xs font-semibold text-gray-500">{a.question}</div>
              <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap">{a.answer}</p>
            </div>
          ))}

          {feedback.attachments.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500">Ảnh đính kèm ({feedback.attachments.length})</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {feedback.attachments.map((att) =>
                  att.url ? (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${att.file_name} — bấm để xem ảnh gốc`}
                      className="block h-24 w-24 rounded-lg overflow-hidden border border-gray-200 hover:ring-2 hover:ring-primary-400"
                    >
                      <img src={att.url} alt={att.file_name} className="h-full w-full object-cover" />
                    </a>
                  ) : (
                    <div key={att.id} className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gray-200 text-[10px] text-gray-400 text-center p-1">
                      Không tải được ảnh
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="text-sm font-semibold text-gray-900">Trạng thái xử lý</div>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatus(o.value)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    status === o.value ? FEEDBACK_STATUS_STYLE[o.value].chipActive : FEEDBACK_STATUS_STYLE[o.value].chip
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {status === 'RESOLVED' && feedback.status !== 'RESOLVED' && (
              <p className="text-xs text-emerald-700">
                Sau khi lưu, người gửi sẽ nhận được thông báo ý kiến đã được xử lý xong, kèm phản hồi bên dưới.
              </p>
            )}
            <div>
              <label className="text-xs font-semibold text-blue-700">Phản hồi cho người gửi (người gửi xem được)</label>
              <textarea
                value={responseNote}
                onChange={(e) => setResponseNote(e.target.value)}
                rows={3}
                placeholder="VD: Đã tiếp nhận, IT sẽ kiểm tra máy trong hôm nay..."
                className="mt-1 w-full border border-blue-200 bg-blue-50/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">Ghi chú nội bộ (người gửi không thấy)</label>
              <textarea
                value={hrNote}
                onChange={(e) => setHrNote(e.target.value)}
                rows={2}
                placeholder="Ghi chú hướng xử lý, người phụ trách..."
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
              />
            </div>
            {feedback.handled_by_name && feedback.handled_at && (
              <div className="text-xs text-gray-400">
                Cập nhật gần nhất: {feedback.handled_by_name} · {formatDateTime(feedback.handled_at)}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 space-y-3">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-between items-center">
            <button type="button" onClick={onClose} disabled={saving} className="btn-secondary disabled:opacity-50">Đóng</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const FeedbackManagement = () => {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);

  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [topicFilter, setTopicFilter] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const fetchSeq = useRef(0);
  const { refresh: refreshNotices } = useFeedbackNotice();

  const fetchSummary = () => {
    feedbackService.summary().then(setSummary).catch(() => {});
  };

  const fetchItems = async () => {
    const reqId = ++fetchSeq.current;
    setLoading(true);
    try {
      const data = await feedbackService.list({
        page: currentPage,
        page_size: itemsPerPage,
        // Tab "Tất cả" ẩn góp ý đã xử lý xong — xem ở tab "Đã xử lý".
        status: statusFilter || FEEDBACK_OPEN_STATUSES,
        topic: topicFilter || undefined,
        search: debouncedSearch.trim() || undefined,
      });
      if (reqId !== fetchSeq.current) return;
      setItems(data.results || []);
      setTotalCount(data.count || 0);
    } catch (err: any) {
      if (reqId !== fetchSeq.current) return;
      if (err?.response?.status === 403) setForbidden(true);
      console.error('Lỗi tải danh sách ý kiến IT/HC:', err);
    } finally {
      if (reqId === fetchSeq.current) setLoading(false);
    }
  };

  useEffect(() => { fetchSummary(); }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, topicFilter]);

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemsPerPage, debouncedSearch, statusFilter, topicFilter]);

  const handleSaved = () => {
    setSelected(null);
    fetchItems();
    fetchSummary();
    refreshNotices();
  };

  if (forbidden) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">Bạn không có quyền xem trang {FEEDBACK_FEATURE_NAME}.</div>
    );
  }

  const tabs: { value: FeedbackStatus | ''; label: string; count?: number }[] = [
    { value: '', label: 'Tất cả', count: summary?.open },
    ...FEEDBACK_STATUS_OPTIONS.map((o) => ({ ...o, count: summary?.[o.value] })),
  ];
  const topicOptions = summary?.topics
    ? FEEDBACK_TOPIC_OPTIONS.filter((o) => summary.topics.includes(o.value))
    : FEEDBACK_TOPIC_OPTIONS;
  const isItScope = !!summary?.topics?.length && summary.topics.every((t) => FEEDBACK_IT_TOPICS.includes(t));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600">
          <ChatBubbleBottomCenterTextIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{FEEDBACK_FEATURE_NAME}</h1>
          <p className="text-sm text-gray-500">
            {summary
              ? isItScope
                ? 'Ý kiến về IT, lỗi app HRM do bộ phận IT tiếp nhận và xử lý'
                : 'Lắng nghe chia sẻ, khó khăn và đề xuất của nhân sự (ý kiến IT/app do bộ phận IT xử lý riêng)'
              : 'Lắng nghe chia sẻ, khó khăn và đề xuất của nhân sự'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-5 pt-4 border-b border-gray-100 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="flex gap-1 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.value || 'ALL'}
                  onClick={() => setStatusFilter(t.value)}
                  className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    statusFilter === t.value
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`ml-1.5 inline-flex px-1.5 rounded-full text-xs ${
                      t.value === 'NEW' && t.count > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pb-3 sm:pb-2">
              <div className="relative">
                <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm nội dung, tên/mã NV..."
                  className="text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 w-52 focus:outline-none focus:ring-1 focus:ring-primary-400"
                />
              </div>
              <select
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-400"
              >
                <option value="">Tất cả vấn đề</option>
                {topicOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          {statusFilter === '' && (
            <p className="-mt-1 pb-3 text-xs text-gray-400">
              Ý kiến đã xử lý xong được ẩn khỏi tab này — xem lại ở tab “Đã xử lý”.
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">
            {debouncedSearch.trim() || topicFilter || statusFilter ? 'Không tìm thấy ý kiến phù hợp.' : 'Không còn ý kiến nào cần xử lý.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((fb) => {
              const firstAnswer = fb.answers.find((a) => a.answer.trim());
              return (
                <li
                  key={fb.id}
                  onClick={() => setSelected(fb)}
                  className={`px-5 py-4 cursor-pointer border-l-4 ${FEEDBACK_STATUS_STYLE[fb.status].border} hover:bg-gray-50/60 transition-colors`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <StatusBadge status={fb.status} label={fb.status_display} />
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                        {fb.topic_display}
                      </span>
                      <Sender fb={fb} />
                      {fb.attachments.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <PhotoIcon className="h-4 w-4" /> {fb.attachments.length} ảnh
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(fb.created_at)}</span>
                  </div>
                  {firstAnswer && (
                    <div className="mt-2">
                      <div className="text-xs text-gray-400 truncate">{firstAnswer.question}</div>
                      <p className="text-sm text-gray-700 line-clamp-2 whitespace-pre-wrap">{firstAnswer.answer}</p>
                    </div>
                  )}
                  {fb.response_note && (
                    <p className="mt-1.5 text-xs text-blue-700 truncate">
                      <span className="font-medium">Đã phản hồi người gửi:</span> {fb.response_note}
                    </p>
                  )}
                  {fb.hr_note && (
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      <span className="font-medium">Ghi chú nội bộ:</span> {fb.hr_note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && totalCount > 0 && (
          <div className="px-5 py-4 border-t border-gray-100">
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(totalCount / itemsPerPage) || 1}
              totalItems={totalCount}
              itemsPerPage={itemsPerPage}
              onPageChange={(page: number) => setCurrentPage(page)}
              onItemsPerPageChange={(size: number) => { setItemsPerPage(size); setCurrentPage(1); }}
            />
          </div>
        )}
      </div>

      {selected && (
        <FeedbackDetailModal feedback={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />
      )}
    </div>
  );
};

export default FeedbackManagement;
