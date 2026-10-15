import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Chatbot } from '../utils/api';
import { documentsAPI, chatbotsAPI } from '../utils/api';

interface DocumentUploadProps {
  chatbotId?: string;
  onUploadSuccess?: (document: Document) => void;
  onUploadError?: (error: string) => void;
  showChatbotSelector?: boolean;
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({
  chatbotId: propChatbotId,
  onUploadSuccess,
  onUploadError,
  showChatbotSelector = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [description, setDescription] = useState('');
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [selectedChatbotId, setSelectedChatbotId] = useState<string>(propChatbotId || '');
  const [loadingChatbots, setLoadingChatbots] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showChatbotSelector && !propChatbotId) {
      loadChatbots();
    }
  }, [showChatbotSelector, propChatbotId]);

  const loadChatbots = async () => {
    try {
      setLoadingChatbots(true);
      const data = await chatbotsAPI.list({ limit: 100 });
      setChatbots(data.chatbots);
      
      // Auto-select first chatbot if available
      if (data.chatbots.length > 0 && !selectedChatbotId) {
        setSelectedChatbotId(data.chatbots[0].id);
      }
    } catch (err) {
      console.error('Error loading chatbots:', err);
      onUploadError?.('Không thể tải danh sách chatbot');
    } finally {
      setLoadingChatbots(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'application/csv',
      'text/comma-separated-values',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    // Also check file extension for CSV files since macOS may report CSV as text/plain
    const fileExtension = file.name.toLowerCase().split('.').pop();
    const isCSVByExtension = fileExtension === 'csv';
    const isCSVByType = file.type.includes('csv') || file.type.includes('comma-separated-values');
    const isCSV = isCSVByExtension || isCSVByType;
    
    // Allow CSV files even if MIME type is text/plain
    if (!allowedTypes.includes(file.type) && !isCSV) {
      console.log('File validation failed:', {
        name: file.name,
        type: file.type,
        extension: fileExtension,
        isCSVByExtension,
        isCSVByType,
        allowedTypes
      });
      onUploadError?.(
        'Định dạng tệp không hợp lệ. Vui lòng tải lên tệp PDF, TXT, MD, DOC, DOCX, CSV, XLS, XLSX, hoặc JSON.'
      );
      return;
    }
    
    console.log('File validation passed:', {
      name: file.name,
      type: file.type,
      extension: fileExtension,
      isCSV
    });

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      onUploadError?.(
        'Kích thước tệp quá lớn. Vui lòng tải lên tệp nhỏ hơn 10MB.'
      );
      return;
    }

    // Determine which chatbot ID to use
    const chatbotIdToUse = propChatbotId || selectedChatbotId;
    if (!chatbotIdToUse) {
      onUploadError?.('Vui lòng chọn một chatbot để tải lên tài liệu');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // Prepare metadata
      const metadata: Record<string, any> = {};
      if (description) {
        metadata.description = description;
      }

      const document = await documentsAPI.upload(file, chatbotIdToUse, metadata);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Reset form
      setDescription('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      onUploadSuccess?.(document);

      // Reset progress after a delay
      setTimeout(() => {
        setUploadProgress(0);
        setIsUploading(false);
      }, 1000);
    } catch (error) {
      console.error('Upload failed:', error);
      onUploadError?.('Failed to upload document. Please try again.');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Chatbot Selector */}
      {showChatbotSelector && !propChatbotId && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <label
            htmlFor="chatbot-select"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Chọn chatbot
          </label>
          {loadingChatbots ? (
            <div className="flex items-center justify-center py-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
              <span className="ml-2 text-sm text-gray-500">Đang tải danh sách chatbot...</span>
            </div>
          ) : (
            <>
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
              {selectedChatbotId && (
                <div className="mt-2 text-sm text-gray-600">
                  <p>Tài liệu sẽ được gán cho: <strong>{chatbots.find(c => c.id === selectedChatbotId)?.name}</strong></p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${isUploading ? 'pointer-events-none opacity-75' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Đang tải lên...
              </h3>
              <p className="text-sm text-gray-500">
                Vui lòng chờ trong khi chúng tôi xử lý tài liệu của bạn
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-500">
              {uploadProgress}% hoàn thành
            </p>
          </div>
        ) : (
          <>
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
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Tải lên tài liệu
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Kéo và thả tệp của bạn vào đây, hoặc{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-blue-500 hover:text-blue-600 font-medium"
              >
                tải lên từ máy tính
              </button>
            </p>
            <p className="text-xs text-gray-400">
              Định dạng tệp được hỗ trợ: PDF, TXT, MD, DOC, DOCX, CSV, XLS,
              XLSX, JSON (Max 10MB)
            </p>
          </>
        )}
      </div>

      {/* Description Input */}
      {!isUploading && (
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Mô tả (tùy chọn)
          </label>
          <input
            type="text"
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Nhập mô tả cho tài liệu này..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        accept=".pdf,.txt,.md,.doc,.docx,.csv,.xlsx,.xls,.json,text/csv,application/csv,text/comma-separated-values"
        className="hidden"
      />

      {/* Upload Tips */}
      {!isUploading && (
        <div className="mt-6 bg-blue-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-900 mb-2">
            Mẹo tải lên:
          </h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Đảm bảo tài liệu của bạn rõ ràng và được định dạng tốt</li>
            <li>
              • Để đạt kết quả tốt nhất, sử dụng tài liệu dựa trên văn bản
            </li>
            <li>• Tài liệu lớn có thể mất thời gian hơn để xử lý</li>
            <li>• Bạn có thể tải lên nhiều tài liệu để đào tạo đầy đủ</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default DocumentUpload;
