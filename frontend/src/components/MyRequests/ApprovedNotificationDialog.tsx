import React from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import {
  GenericRequest,
  GenericRequestType,
} from '../../services/genericRequest.service';

interface Props {
  request: GenericRequest | null;
  onClose: () => void;
}

const MESSAGE_BY_TYPE: Record<GenericRequestType, string> = {
  RESIGNATION:
    'Đơn xin nghỉ việc của bạn đã được phê duyệt. Trước ngày kết thúc công việc, Bạn vui lòng đến phòng HCNS để hoàn tất thủ tục nghỉ việc.',
  SALARY_ADVANCE:
    'Đơn tạm ứng lương của bạn đã được phê duyệt. Số tiền sẽ được trừ vào lương tháng tương ứng. Vui lòng liên hệ phòng HCNS nếu cần thêm thông tin.',
  PROPOSAL:
    'Đơn đề xuất của bạn đã được phê duyệt. Vui lòng đến phòng HCNS để biết thêm chi tiết.',
  CONFIRMATION:
    'Đơn xác nhận của bạn đã được phê duyệt. Vui lòng đến phòng HCNS để biết thêm chi tiết.',
  COMPLAINT:
    'Đơn khiếu nại của bạn đã được phê duyệt. Vui lòng đến phòng HCNS để biết thêm chi tiết.',
  OTHER:
    'Đơn của bạn đã được phê duyệt. Vui lòng đến phòng HCNS để biết thêm chi tiết.',
};

const ApprovedNotificationDialog: React.FC<Props> = ({ request, onClose }) => {
  if (!request) return null;

  const message =
    MESSAGE_BY_TYPE[request.request_type] || MESSAGE_BY_TYPE.OTHER;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header với icon */}
        <div className="flex flex-col items-center pt-8 pb-4 px-6">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircleIcon className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 text-center">
            Đơn đã được phê duyệt
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {request.request_type_display}
          </p>
        </div>

        {/* Message body */}
        <div className="px-8 pb-2">
          <p className="text-center text-gray-700 leading-relaxed">
            {message}
          </p>
          {request.request_code && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-center">
              <span className="text-xs text-gray-500">Mã đơn</span>
              <p className="font-mono text-sm font-semibold text-gray-800 mt-0.5">
                {request.request_code}
              </p>
            </div>
          )}
        </div>

        {/* Footer button */}
        <div className="px-6 py-4 flex justify-center">
          <button
            onClick={onClose}
            className="px-8 py-2.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApprovedNotificationDialog;
