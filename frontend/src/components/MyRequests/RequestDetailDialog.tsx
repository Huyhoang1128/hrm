import React from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon,
  DocumentMagnifyingGlassIcon,
  CheckIcon,
  XCircleIcon,
  ClockIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { GenericRequest, GenericRequestStatus } from '../../services/genericRequest.service';

interface Props {
  request: GenericRequest | null;
  onClose: () => void;
  /** Hiển thị nút "Xem trước PDF" cho RESIGNATION; null = ẩn */
  onPreviewPdf?: ((req: GenericRequest) => void) | null;
}

const STATUS_LABELS: Record<GenericRequestStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_MANAGER: 'Chờ Quản lý duyệt',
  PENDING_ADMIN: 'Chờ HCNS duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

const STATUS_COLORS: Record<GenericRequestStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING_MANAGER: 'bg-yellow-100 text-yellow-800',
  PENDING_ADMIN: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-200 text-gray-600',
};

const formatDate = (s: string | null | undefined) => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('vi-VN');
  } catch {
    return s;
  }
};

const formatDateOnly = (s: string | null | undefined) => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('vi-VN');
  } catch {
    return s;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Approval workflow timeline (4 step: Tạo đơn → Gửi duyệt → Quản lý → Admin)
// ─────────────────────────────────────────────────────────────────────────────

type StepState = 'done' | 'current' | 'pending' | 'rejected' | 'cancelled';

interface TimelineStep {
  key: string;
  title: string;
  description?: string | null;
  by?: string | null;
  at?: string | null;
  state: StepState;
  icon: React.ReactNode;
}

const STATE_STYLES: Record<StepState, { circle: string; line: string; text: string; iconColor: string }> = {
  done: {
    circle: 'bg-green-500 border-green-500',
    line: 'bg-green-400',
    text: 'text-green-700',
    iconColor: 'text-white',
  },
  current: {
    circle: 'bg-yellow-100 border-yellow-500 animate-pulse',
    line: 'bg-gray-300',
    text: 'text-yellow-800',
    iconColor: 'text-yellow-600',
  },
  pending: {
    circle: 'bg-white border-gray-300',
    line: 'bg-gray-200',
    text: 'text-gray-500',
    iconColor: 'text-gray-400',
  },
  rejected: {
    circle: 'bg-red-500 border-red-500',
    line: 'bg-gray-300',
    text: 'text-red-700',
    iconColor: 'text-white',
  },
  cancelled: {
    circle: 'bg-gray-400 border-gray-400',
    line: 'bg-gray-300',
    text: 'text-gray-600',
    iconColor: 'text-white',
  },
};

const ApprovalTimeline: React.FC<{ request: GenericRequest }> = ({ request }) => {
  const status = request.status;
  const isCancelled = status === 'CANCELLED';
  const isRejected = status === 'REJECTED';

  // Step 1: Tạo đơn (luôn done — vì record đã tồn tại)
  const step1: TimelineStep = {
    key: 'created',
    title: 'Tạo đơn',
    description: 'Đơn được khởi tạo',
    by: request.employee_name,
    at: request.created_at,
    state: 'done',
    icon: <PencilSquareIcon className="w-4 h-4" />,
  };

  // Step 2: Gửi duyệt (done nếu submitted_at có giá trị, current nếu DRAFT, cancelled nếu huỷ ở DRAFT)
  let step2State: StepState;
  if (request.submitted_at) {
    step2State = 'done';
  } else if (status === 'DRAFT') {
    step2State = 'current';
  } else if (isCancelled && !request.submitted_at) {
    step2State = 'cancelled';
  } else {
    step2State = 'pending';
  }
  const step2: TimelineStep = {
    key: 'submitted',
    title: 'Gửi duyệt',
    description: status === 'DRAFT' ? 'Chờ nhân viên gửi đơn' : 'Đã gửi để Quản lý xét duyệt',
    by: request.submitted_at ? request.employee_name : null,
    at: request.submitted_at,
    state: step2State,
    icon: <PaperAirplaneIcon className="w-4 h-4" />,
  };

  // Step 3: Quản lý duyệt
  let step3State: StepState;
  if (request.manager_approved_at) {
    step3State = 'done';
  } else if (isRejected && request.rejected_level === 'MANAGER') {
    step3State = 'rejected';
  } else if (isCancelled && status === 'CANCELLED' && request.submitted_at) {
    step3State = 'cancelled';
  } else if (status === 'PENDING_MANAGER') {
    step3State = 'current';
  } else {
    step3State = 'pending';
  }
  const step3: TimelineStep = {
    key: 'manager',
    title: 'Quản lý phê duyệt',
    description:
      step3State === 'rejected'
        ? 'Quản lý đã từ chối đơn'
        : step3State === 'done'
        ? 'Quản lý đã duyệt, chuyển Admin xử lý'
        : step3State === 'current'
        ? 'Đang chờ Quản lý trực tiếp xét duyệt'
        : 'Chưa đến bước này',
    by: request.manager_approved_by_name,
    at: request.manager_approved_at,
    state: step3State,
    icon:
      step3State === 'rejected' ? (
        <XCircleIcon className="w-4 h-4" />
      ) : step3State === 'done' ? (
        <CheckIcon className="w-4 h-4" />
      ) : (
        <ClockIcon className="w-4 h-4" />
      ),
  };

  // Step 4: Admin duyệt
  let step4State: StepState;
  if (status === 'APPROVED') {
    step4State = 'done';
  } else if (isRejected && request.rejected_level === 'ADMIN') {
    step4State = 'rejected';
  } else if (isCancelled && request.manager_approved_at) {
    step4State = 'cancelled';
  } else if (status === 'PENDING_ADMIN') {
    step4State = 'current';
  } else {
    step4State = 'pending';
  }
  const step4: TimelineStep = {
    key: 'admin',
    title: 'HCNS phê duyệt cuối',
    description:
      step4State === 'rejected'
        ? 'HCNS đã từ chối đơn'
        : step4State === 'done'
        ? 'HCNS đã duyệt — đơn có hiệu lực'
        : step4State === 'current'
        ? 'Đang chờ HCNS xét duyệt cuối'
        : 'Chưa đến bước này',
    by: request.admin_approved_by_name,
    at: request.admin_approved_at || request.approved_at,
    state: step4State,
    icon:
      step4State === 'rejected' ? (
        <XCircleIcon className="w-4 h-4" />
      ) : step4State === 'done' ? (
        <CheckIcon className="w-4 h-4" />
      ) : (
        <ClockIcon className="w-4 h-4" />
      ),
  };

  const steps: TimelineStep[] = [step1, step2, step3, step4];

  return (
    <ol className="relative">
      {steps.map((step, idx) => {
        const styles = STATE_STYLES[step.state];
        const isLast = idx === steps.length - 1;
        return (
          <li key={step.key} className="relative pl-10 pb-5 last:pb-0">
            {/* Vertical connector line */}
            {!isLast && (
              <span
                aria-hidden
                className={`absolute left-[14px] top-7 -ml-px h-full w-0.5 ${styles.line}`}
              />
            )}
            {/* Circle icon */}
            <span
              className={`absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border-2 ${styles.circle}`}
            >
              <span className={styles.iconColor}>{step.icon}</span>
            </span>
            {/* Content */}
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${styles.text}`}>{step.title}</p>
              {step.description && (
                <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
              )}
              {(step.by || step.at) && (
                <p className="text-xs text-gray-600 mt-1">
                  {step.by && <span className="font-medium">{step.by}</span>}
                  {step.by && step.at && <span className="text-gray-400"> • </span>}
                  {step.at && <span>{formatDate(step.at)}</span>}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const RequestDetailDialog: React.FC<Props> = ({ request, onClose, onPreviewPdf }) => {
  if (!request) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Chi tiết đơn</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-gray-500 font-medium">Mã đơn</dt>
              <dd className="text-gray-900 mt-1 font-mono">{request.request_code || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Loại đơn</dt>
              <dd className="text-gray-900 mt-1">{request.request_type_display}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500 font-medium">Tiêu đề</dt>
              <dd className="text-gray-900 mt-1">{request.title}</dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Trạng thái</dt>
              <dd className="mt-1">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[request.status]}`}>
                  {STATUS_LABELS[request.status]}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Ngày nghỉ dự kiến</dt>
              <dd className="text-gray-900 mt-1">{formatDateOnly(request.expected_date)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Người làm đơn</dt>
              <dd className="text-gray-900 mt-1">
                {request.employee_name}
                {request.employee_code && (
                  <span className="text-gray-500"> ({request.employee_code})</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Phòng ban</dt>
              <dd className="text-gray-900 mt-1">{request.employee_department || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Chức vụ</dt>
              <dd className="text-gray-900 mt-1">{request.employee_position || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Đơn vị</dt>
              <dd className="text-gray-900 mt-1">
                {request.extra_data?.company_unit_name || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Ngày tạo</dt>
              <dd className="text-gray-900 mt-1">{formatDate(request.created_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 font-medium">Ngày gửi duyệt</dt>
              <dd className="text-gray-900 mt-1">{formatDate(request.submitted_at)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500 font-medium">Lý do</dt>
              <dd className="text-gray-900 mt-1 whitespace-pre-wrap">
                {request.reason || <span className="text-gray-400 italic">Không có</span>}
              </dd>
            </div>

            {request.request_type === 'RESIGNATION' && (
              <>
                {request.extra_data?.handover_to && (
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500 font-medium">Người tiếp nhận bàn giao</dt>
                    <dd className="text-gray-900 mt-1">{request.extra_data.handover_to}</dd>
                  </div>
                )}
                {request.extra_data?.feedback && (
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500 font-medium">Góp ý / Phản hồi</dt>
                    <dd className="text-gray-900 mt-1 whitespace-pre-wrap">
                      {request.extra_data.feedback}
                    </dd>
                  </div>
                )}
              </>
            )}

          </dl>

          {/* Workflow Timeline */}
          <div className="mt-6 pt-4 border-t">
            <h4 className="text-sm font-semibold text-gray-700 mb-4">Quy trình phê duyệt</h4>
            <ApprovalTimeline request={request} />
            {request.approval_note && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded text-sm">
                <span className="font-medium text-blue-900">Ghi chú phê duyệt:</span>{' '}
                <span className="text-blue-800">{request.approval_note}</span>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-2 bg-gray-50">
          {onPreviewPdf && request.request_type === 'RESIGNATION' && (
            <button
              onClick={() => onPreviewPdf(request)}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 inline-flex items-center gap-1.5"
            >
              <DocumentMagnifyingGlassIcon className="w-4 h-4" />
              Xem trước PDF
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RequestDetailDialog;
