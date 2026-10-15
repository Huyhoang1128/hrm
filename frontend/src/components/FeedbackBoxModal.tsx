import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon,
  ChatBubbleBottomCenterTextIcon,
  CheckCircleIcon,
  EyeSlashIcon,
  LockClosedIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import MyFeedbackList from '@/components/feedback/MyFeedbackList';
import feedbackService, {
  FEEDBACK_FEATURE_NAME,
  FEEDBACK_IT_TOPICS,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_MB,
  FEEDBACK_QUESTIONS,
  FEEDBACK_TOPIC_OPTIONS,
  FeedbackAnswerField,
  FeedbackTopic,
} from '@/services/feedback.service';
import { BRAND } from '@/config/brand';

export type FeedbackBoxTab = 'send' | 'mine';

interface FeedbackBoxModalProps {
  onClose: () => void;
  initialTab?: FeedbackBoxTab;
}

const MAX_LENGTH = 5000;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type PickedImage = { file: File; preview: string };

const emptyAnswers = (): Record<FeedbackAnswerField, string> => ({
  difficulties: '',
  support_needed: '',
  career_sharing: '',
  work_proposal: '',
  other_sharing: '',
});

export default function FeedbackBoxModal({ onClose, initialTab = 'send' }: FeedbackBoxModalProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<FeedbackBoxTab>(initialTab);
  const [topic, setTopic] = useState<FeedbackTopic | ''>('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => () => imagesRef.current.forEach((img) => URL.revokeObjectURL(img.preview)), []);

  const addImages = (files: File[]) => {
    if (!files.length) return;
    const valid: PickedImage[] = [];
    let problem = '';
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        problem = `"${file.name}" không phải ảnh JPG, PNG, WEBP hoặc GIF.`;
      } else if (file.size > FEEDBACK_MAX_IMAGE_MB * 1024 * 1024) {
        problem = `"${file.name}" vượt quá ${FEEDBACK_MAX_IMAGE_MB}MB.`;
      } else {
        valid.push({ file, preview: URL.createObjectURL(file) });
      }
    }
    const room = FEEDBACK_MAX_IMAGES - imagesRef.current.length;
    if (valid.length > room) {
      valid.slice(room).forEach((img) => URL.revokeObjectURL(img.preview));
      problem = `Chỉ được đính kèm tối đa ${FEEDBACK_MAX_IMAGES} ảnh.`;
    }
    setImages((prev) => [...prev, ...valid.slice(0, Math.max(room, 0))]);
    setError(problem);
  };

  const removeImage = (index: number) => {
    URL.revokeObjectURL(images[index].preview);
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Dán ảnh chụp màn hình (Ctrl+V) ở bất kỳ đâu trong modal.
  const handlePaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  };

  const senderName = user?.hrm_user?.full_name || user?.employee_profile?.full_name || `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  const senderDept = user?.hrm_user?.department || user?.employee_profile?.department || '';

  const handleSubmit = async () => {
    if (!topic) {
      setError('Vui lòng chọn vấn đề bạn muốn phản ánh.');
      return;
    }
    if (!Object.values(answers).some((v) => v.trim()) && images.length === 0) {
      setError('Vui lòng chia sẻ ít nhất 1 nội dung trước khi gửi.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await feedbackService.submit({ topic, is_anonymous: isAnonymous, ...answers }, images.map((img) => img.file));
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Gửi ý kiến thất bại. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendAnother = () => {
    setTopic('');
    setAnswers(emptyAnswers());
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
    setSubmitted(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl flex flex-col max-h-[90vh]" onPaste={submitted || tab === 'mine' ? undefined : handlePaste}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-4 border-b border-gray-100">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-primary-50 text-primary-600">
                <ChatBubbleBottomCenterTextIcon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{FEEDBACK_FEATURE_NAME}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Những khó khăn, áp lực và đề xuất của bạn giúp {BRAND.companyName} ngày càng phát triển.
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-1">
              {([['send', 'Gửi ý kiến'], ['mine', 'Ý kiến của tôi']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  disabled={submitting}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    tab === value ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {tab === 'mine' ? (
          <>
            <div className="px-6 py-5 overflow-y-auto">
              <MyFeedbackList />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
            </div>
          </>
        ) : submitted ? (
          <div className="px-6 py-10 flex flex-col items-center text-center">
            <div className="p-3 rounded-full bg-emerald-100 mb-4">
              <CheckCircleIcon className="w-10 h-10 text-emerald-600" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Cảm ơn bạn đã chia sẻ!</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md">
              Ý kiến của bạn đã được gửi tới {topic && FEEDBACK_IT_TOPICS.includes(topic) ? 'bộ phận IT' : 'HCNS'} và sẽ được bảo mật,
              xem xét giải quyết thấu đáo. Bạn có thể theo dõi tiến độ xử lý ở tab “Ý kiến của tôi”.
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <button onClick={handleSendAnother} className="btn-secondary">Gửi ý kiến khác</button>
              <button onClick={() => { handleSendAnother(); setTab('mine'); }} className="btn-secondary">Theo dõi ý kiến</button>
              <button onClick={onClose} className="btn-primary">Đóng</button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div className="flex items-start gap-2 bg-primary-50 border border-primary-100 rounded-lg p-3 text-xs text-primary-700">
                <LockClosedIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Mọi chia sẻ đều được bảo mật: ý kiến về IT/lỗi app chỉ bộ phận IT xem, các vấn đề khác chỉ HCNS/Ban lãnh đạo xem.
                  Bạn có thể trả lời những câu mình muốn, không bắt buộc tất cả.
                </span>
              </div>

              {/* Người gửi */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3">
                <div className="text-sm">
                  {isAnonymous ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                      <EyeSlashIcon className="w-4 h-4" /> Gửi ẩn danh — tên và phòng ban của bạn sẽ được ẩn với người xử lý
                    </span>
                  ) : (
                    <>
                      <div className="text-xs text-gray-500">Gửi với tên</div>
                      <div className="font-medium text-gray-900">
                        {senderName || 'Tài khoản của bạn'}
                        {senderDept && <span className="font-normal text-gray-500"> · {senderDept}</span>}
                      </div>
                    </>
                  )}
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  Gửi ẩn danh
                </label>
              </div>

              {/* Vấn đề phản ánh */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Vấn đề bạn muốn phản ánh <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {FEEDBACK_TOPIC_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { setTopic(o.value); setError(''); }}
                      className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                        topic === o.value
                          ? 'border-primary-500 bg-primary-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:bg-primary-50/50 hover:text-primary-700'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {FEEDBACK_QUESTIONS.map((q) => (
                <div key={q.field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{q.question}</label>
                  <textarea
                    value={answers[q.field]}
                    onChange={(e) => { setAnswers((prev) => ({ ...prev, [q.field]: e.target.value })); setError(''); }}
                    maxLength={MAX_LENGTH}
                    rows={3}
                    placeholder="Câu trả lời của bạn"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
                  />
                </div>
              ))}

              {/* Ảnh đính kèm */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Ảnh đính kèm <span className="font-normal text-gray-400">(không bắt buộc)</span>
                </label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">
                  VD: ảnh chụp màn hình khi app bị lỗi để bộ phận IT nắm rõ và xử lý nhanh hơn. Tối đa {FEEDBACK_MAX_IMAGES} ảnh, mỗi ảnh ≤ {FEEDBACK_MAX_IMAGE_MB}MB.
                </p>
                <div className="flex flex-wrap gap-2">
                  {images.map((img, i) => (
                    <div key={img.preview} className="relative h-20 w-20 rounded-lg overflow-hidden border border-gray-200 group">
                      <img src={img.preview} alt={img.file.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                        title="Xoá ảnh"
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {images.length < FEEDBACK_MAX_IMAGES && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(Array.from(e.dataTransfer.files)); }}
                      className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 text-xs transition-colors ${
                        images.length ? 'h-20 w-20' : 'h-20 flex-1 min-w-[12rem]'
                      } ${dragOver ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-500 hover:border-primary-300 hover:text-primary-600'}`}
                    >
                      <PhotoIcon className="h-6 w-6" />
                      {images.length ? 'Thêm' : 'Chọn ảnh, kéo thả hoặc dán (Ctrl+V)'}
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  multiple
                  className="hidden"
                  onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ''; }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 space-y-3">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
              )}
              <div className="flex justify-between items-center">
                <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary disabled:opacity-50">
                  Hủy
                </button>
                <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">
                  {submitting ? 'Đang gửi...' : 'Gửi ý kiến'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
