import { managementApi } from '../utils/api';

export type FeedbackTopic = 'HRM_APP' | 'IT_SUPPORT' | 'WORK' | 'POLICY' | 'ENVIRONMENT' | 'MANAGEMENT' | 'CAREER' | 'OTHER';
export type FeedbackStatus = 'NEW' | 'IN_PROGRESS' | 'RESOLVED';
export type FeedbackAnswerField = 'difficulties' | 'support_needed' | 'career_sharing' | 'work_proposal' | 'other_sharing';

export const FEEDBACK_TOPIC_OPTIONS: { value: FeedbackTopic; label: string }[] = [
  { value: 'HRM_APP', label: 'Lỗi / góp ý về app HRM' },
  { value: 'IT_SUPPORT', label: 'Máy tính, thiết bị, mạng (IT)' },
  { value: 'WORK', label: 'Công việc & quy trình' },
  { value: 'POLICY', label: 'Chế độ, chính sách, lương thưởng' },
  { value: 'ENVIRONMENT', label: 'Môi trường làm việc & đồng nghiệp' },
  { value: 'MANAGEMENT', label: 'Quản lý & lãnh đạo' },
  { value: 'CAREER', label: 'Định hướng phát triển bản thân' },
  { value: 'OTHER', label: 'Khác' },
];

/** Vấn đề do bộ phận IT xử lý; còn lại do HCNS xử lý (khớp Feedback.IT_TOPICS ở backend). */
export const FEEDBACK_IT_TOPICS: FeedbackTopic[] = ['HRM_APP', 'IT_SUPPORT'];

/** Trạng thái "chưa xử lý xong" — tab "Tất cả" ẩn góp ý đã xử lý. */
export const FEEDBACK_OPEN_STATUSES = 'NEW,IN_PROGRESS';

/** Tên hiển thị của tính năng (tên cũ "Hòm thư góp ý"). */
export const FEEDBACK_FEATURE_NAME = 'Tiếp nhận - xử lý - Phản hồi IT/HC';

export const FEEDBACK_STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: 'NEW', label: 'Chờ tiếp nhận' },
  { value: 'IN_PROGRESS', label: 'Đang xử lý' },
  { value: 'RESOLVED', label: 'Đã xử lý' },
];

/** Các câu hỏi giữ nguyên nội dung form "LẮNG NGHE CHIA SẺ". */
export const FEEDBACK_QUESTIONS: { field: FeedbackAnswerField; question: string }[] = [
  { field: 'difficulties', question: 'Bạn có gặp khó khăn, bức xúc trong công việc cần được hỗ trợ và giải quyết không?' },
  { field: 'support_needed', question: 'Bạn cần hỗ trợ gì để hoàn thành tốt công việc trong thời gian tiếp theo?' },
  { field: 'career_sharing', question: 'Bạn có muốn chia sẻ gì với BLĐ về định hướng công việc, mong muốn phát triển của bản thân không?' },
  { field: 'work_proposal', question: 'Đề xuất trong công việc cá nhân của bạn?' },
  { field: 'other_sharing', question: 'Ngoài công việc ra, bạn có thể chia sẻ với chúng tôi bất cứ điều gì bạn muốn.' },
];

/** Giới hạn khớp backend (hrm/feedback_views.py). */
export const FEEDBACK_MAX_IMAGES = 5;
export const FEEDBACK_MAX_IMAGE_MB = 10;

export interface FeedbackAttachment {
  id: number;
  file_name: string;
  url: string | null;
}

/** Phần người gửi xem được về ý kiến của chính mình (không có ghi chú nội bộ). */
export interface FeedbackSenderItem {
  id: number;
  is_anonymous: boolean;
  topic: FeedbackTopic;
  topic_display: string;
  /** Bộ phận xử lý: IT (lỗi app, thiết bị) hoặc HCNS (còn lại). */
  handler_unit: 'IT' | 'HCNS';
  answers: { field: FeedbackAnswerField; question: string; answer: string }[];
  attachments: FeedbackAttachment[];
  status: FeedbackStatus;
  status_display: string;
  /** Phản hồi của người xử lý — người gửi xem được. */
  response_note: string;
  created_at: string;
  received_at: string | null;
  resolved_at: string | null;
}

export interface FeedbackItem extends FeedbackSenderItem {
  employee_code: string | null;
  employee_name: string | null;
  department_name: string | null;
  /** Ghi chú nội bộ — người gửi không thấy. */
  hr_note: string;
  handled_by_name: string | null;
  handled_at: string | null;
}

export type FeedbackStatusCounts = { total: number } & Record<FeedbackStatus, number>;

export type FeedbackSummary = {
  total: number;
  /** Số góp ý chưa xử lý xong (NEW + IN_PROGRESS). */
  open: number;
  /** Các vấn đề tài khoản này được xem (IT hoặc HCNS). */
  topics: FeedbackTopic[];
} & Record<FeedbackStatus, number>;

export interface FeedbackResolvedNotice {
  id: number;
  topic_display: string;
  is_anonymous: boolean;
  excerpt: string;
  created_at: string;
  resolved_at: string | null;
  response_note: string;
}

export interface FeedbackNotices {
  /** Tài khoản có quyền xử lý góp ý (HCNS/Admin). */
  can_handle: boolean;
  /** Số góp ý "Mới" thuộc phần mình xử lý. */
  pending_count: number;
  latest_pending_id: number | null;
  /** Góp ý của chính mình vừa được xử lý xong, chưa bấm "Đã hiểu". */
  resolved: FeedbackResolvedNotice[];
}

class FeedbackService {
  /** Mọi nhân sự đều gửi được. Gửi multipart để kèm ảnh. */
  async submit(
    data: { topic: FeedbackTopic; is_anonymous: boolean } & Partial<Record<FeedbackAnswerField, string>>,
    images: File[] = [],
  ): Promise<{ id: number }> {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => formData.append(key, String(value ?? '')));
    images.forEach((file) => formData.append('images', file));
    const response = await managementApi.post('/api-hrm/feedbacks/', formData);
    return response.data;
  }

  /** Chỉ HCNS/Admin. */
  async list(params: {
    page: number;
    page_size: number;
    topic?: string;
    status?: string;
    search?: string;
  }): Promise<{ count: number; results: FeedbackItem[] }> {
    const response = await managementApi.get('/api-hrm/feedbacks/', { params });
    return response.data;
  }

  async summary(): Promise<FeedbackSummary> {
    const response = await managementApi.get('/api-hrm/feedbacks/summary/');
    return response.data;
  }

  async update(
    id: number,
    data: { status?: FeedbackStatus; hr_note?: string; response_note?: string },
  ): Promise<FeedbackItem> {
    const response = await managementApi.patch(`/api-hrm/feedbacks/${id}/`, data);
    return response.data;
  }

  /** Mọi nhân sự — ý kiến chính mình đã gửi (kể cả ẩn danh) để tự theo dõi trạng thái. */
  async mine(params: { page: number; page_size: number; status?: string }): Promise<{
    count: number;
    next: string | null;
    results: FeedbackSenderItem[];
    counts: FeedbackStatusCounts;
  }> {
    const response = await managementApi.get('/api-hrm/feedbacks/mine/', { params });
    return response.data;
  }

  /** Mọi nhân sự — FE gọi định kỳ để hiện thông báo. */
  async notices(): Promise<FeedbackNotices> {
    const response = await managementApi.get('/api-hrm/feedbacks/notices/');
    return response.data;
  }

  async acknowledgeResolved(ids: number[]): Promise<{ updated: number }> {
    const response = await managementApi.post('/api-hrm/feedbacks/acknowledge-resolved/', { ids });
    return response.data;
  }
}

export const feedbackService = new FeedbackService();
export default feedbackService;
