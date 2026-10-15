import { CheckIcon } from '@heroicons/react/24/outline';
import { FeedbackSenderItem, FeedbackStatus } from '@/services/feedback.service';

/** Màu theo trạng thái — dùng chung cho người gửi và người xử lý để nhìn là biết đang ở bước nào. */
export const FEEDBACK_STATUS_STYLE: Record<FeedbackStatus, { badge: string; border: string; chip: string; chipActive: string }> = {
  NEW: {
    badge: 'bg-red-50 text-red-600 border-red-200',
    border: 'border-l-red-400',
    chip: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    chipActive: 'border-red-600 bg-red-600 text-white',
  },
  IN_PROGRESS: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    border: 'border-l-amber-400',
    chip: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    chipActive: 'border-amber-500 bg-amber-500 text-white',
  },
  RESOLVED: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    border: 'border-l-emerald-400',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    chipActive: 'border-emerald-600 bg-emerald-600 text-white',
  },
};

export const formatFeedbackTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

export const FeedbackStatusBadge = ({ status, label }: { status: FeedbackStatus; label: string }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-medium ${FEEDBACK_STATUS_STYLE[status].badge}`}>{label}</span>
);

/** 3 bước Đã gửi → Tiếp nhận → Đã xử lý, kèm thời điểm của từng bước. */
export function FeedbackStatusTimeline({ item }: { item: Pick<FeedbackSenderItem, 'created_at' | 'received_at' | 'resolved_at' | 'handler_unit'> }) {
  const steps = [
    { label: 'Đã gửi', at: item.created_at },
    { label: `${item.handler_unit} tiếp nhận`, at: item.received_at },
    { label: 'Đã xử lý', at: item.resolved_at },
  ];
  return (
    <ol className="flex items-start">
      {steps.map((step, i) => {
        const done = !!step.at;
        return (
          <li key={step.label} className="flex-1 min-w-0">
            <div className="flex items-center">
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white text-gray-400'
                }`}
              >
                {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
              </span>
              {i < steps.length - 1 && <span className={`mx-1 h-0.5 flex-1 ${steps[i + 1].at ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
            </div>
            <div className={`mt-1 pr-2 text-[11px] font-medium ${done ? 'text-gray-700' : 'text-gray-400'}`}>{step.label}</div>
            {done && <div className="pr-2 text-[10px] text-gray-400">{formatFeedbackTime(step.at)}</div>}
          </li>
        );
      })}
    </ol>
  );
}
