import { useState, useEffect } from 'react';
import { Chatbot, Document } from '../utils/api';
import { chatbotsAPI } from '../utils/api';
import DocumentUploadComponent from '../components/DocumentUpload';

export default function DocumentUpload() {
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [selectedChatbotId, setSelectedChatbotId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadChatbots();
  }, []);

  const loadChatbots = async () => {
    try {
      setLoading(true);
      const data = await chatbotsAPI.list({ limit: 100 });
      setChatbots(data.chatbots);
      
      // Auto-select first chatbot if available
      if (data.chatbots.length > 0) {
        setSelectedChatbotId(data.chatbots[0].id);
      }
    } catch (err) {
      setError('Không thể tải danh sách chatbot');
      console.error('Error loading chatbots:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSuccess = (document: Document) => {
    console.log('Upload successful:', document);
    // Show success message or redirect
    alert(`Tài liệu "${document.name}" đã được tải lên thành công cho chatbot ${chatbots.find(c => c.id === selectedChatbotId)?.name}`);
  };

  const handleUploadError = (error: string) => {
    console.error('Upload error:', error);
    alert(`Lỗi khi tải lên: ${error}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Lỗi</h2>
        <p className="text-gray-600">{error}</p>
        <button
          onClick={loadChatbots}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tải lên tài liệu</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tải lên tài liệu mới và chọn chatbot để gán tài liệu
        </p>
      </div>

      {/* Chatbot Selection */}
      <div className="card p-6">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="chatbot-select"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Chọn chatbot
            </label>
            <select
              id="chatbot-select"
              value={selectedChatbotId}
              onChange={(e) => setSelectedChatbotId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">-- Chọn chatbot --</option>
              {chatbots.map((chatbot) => (
                <option key={chatbot.id} value={chatbot.id}>
                  {chatbot.name} {!chatbot.isActive && '(Không hoạt động)'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-gray-500">
              Tài liệu sẽ được gán cho chatbot đã chọn
            </p>
          </div>

          {selectedChatbotId && (
            <div className="bg-blue-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-blue-900 mb-2">
                Thông tin chatbot đã chọn
              </h3>
              {(() => {
                const selectedChatbot = chatbots.find(c => c.id === selectedChatbotId);
                return selectedChatbot ? (
                  <div className="text-sm text-blue-800">
                    <p><strong>Tên:</strong> {selectedChatbot.name}</p>
                    <p><strong>Mô tả:</strong> {selectedChatbot.description || 'Không có mô tả'}</p>
                    <p><strong>Trạng thái:</strong> {selectedChatbot.isActive ? 'Hoạt động' : 'Không hoạt động'}</p>
                  </div>
                ) : null;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Document Upload Component */}
      {selectedChatbotId ? (
        <div className="card p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            Tải lên tài liệu cho chatbot đã chọn
          </h2>
          <DocumentUploadComponent
            chatbotId={selectedChatbotId}
            onUploadSuccess={handleUploadSuccess}
            onUploadError={handleUploadError}
          />
        </div>
      ) : (
        <div className="card p-6 text-center">
          <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Vui lòng chọn chatbot
          </h3>
          <p className="text-sm text-gray-500">
            Chọn một chatbot từ danh sách trên để bắt đầu tải lên tài liệu
          </p>
        </div>
      )}

      {/* Upload Tips */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-3">
          Hướng dẫn tải lên
        </h3>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start">
            <span className="text-blue-500 mr-2">•</span>
            <span>Chọn chatbot mà bạn muốn gán tài liệu trước khi tải lên</span>
          </li>
          <li className="flex items-start">
            <span className="text-blue-500 mr-2">•</span>
            <span>Định dạng tệp được hỗ trợ: PDF, TXT, MD, DOC, DOCX, CSV, XLS, XLSX, JSON</span>
          </li>
          <li className="flex items-start">
            <span className="text-blue-500 mr-2">•</span>
            <span>Kích thước tệp tối đa: 10MB</span>
          </li>
          <li className="flex items-start">
            <span className="text-blue-500 mr-2">•</span>
            <span>Tài liệu sẽ được xử lý tự động và có sẵn cho chatbot sau khi upload</span>
          </li>
          <li className="flex items-start">
            <span className="text-blue-500 mr-2">•</span>
            <span>Bạn có thể tải lên nhiều tài liệu cho cùng một chatbot</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
