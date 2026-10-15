import { SparklesIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';

export default function AIChat() {
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <SparklesIcon className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-gray-900">AI Assistant</h1>
          <p className="text-xs text-gray-400">Powered by AI HRM</p>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-gray-50">
        {/* Example assistant message (decorative) */}
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex-shrink-0 flex items-center justify-center">
            <SparklesIcon className="h-4 w-4 text-white" />
          </div>
          <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100 max-w-xl">
            <p className="text-sm text-gray-700">
              Xin chào! Tôi là AI Assistant của AI HRM. Tôi có thể giúp bạn quản lý nhân sự, trả lời câu hỏi về chính sách công ty và nhiều hơn nữa.
            </p>
          </div>
        </div>

        {/* Example user message (decorative) */}
        <div className="flex items-start gap-3 flex-row-reverse">
          <div className="h-8 w-8 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center">
            <span className="text-xs font-medium text-white">U</span>
          </div>
          <div className="bg-blue-600 rounded-2xl rounded-tr-sm px-4 py-3 max-w-xl">
            <p className="text-sm text-white">Cho tôi xem danh sách nhân viên nghỉ phép tuần này?</p>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="px-6 py-4 bg-white border-t border-gray-200">
        <div className="flex items-end gap-3">
          <div className="flex-1 min-h-[44px] max-h-32 rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 flex items-center">
            <span className="text-sm text-gray-400 select-none">Nhập tin nhắn...</span>
          </div>
          <button
            disabled
            className="h-11 w-11 rounded-xl bg-blue-600 flex items-center justify-center opacity-50 cursor-not-allowed"
          >
            <PaperAirplaneIcon className="h-5 w-5 text-white" />
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-gray-400">
          AI có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.
        </p>
      </div>

      {/* Coming Soon overlay */}
      <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center z-10">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 px-10 py-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <SparklesIcon className="h-8 w-8 text-white" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Coming Soon</h2>
            <p className="text-sm text-gray-500">
              Tính năng AI Assistant đang được phát triển và sẽ sớm ra mắt.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
            <SparklesIcon className="h-3.5 w-3.5" />
            Đang phát triển
          </span>
        </div>
      </div>
    </div>
  );
}
