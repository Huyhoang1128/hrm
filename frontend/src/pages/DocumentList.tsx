import { useState, useEffect } from 'react';
import {
  PlusIcon,
  DocumentTextIcon,
  DocumentIcon,
  DocumentMagnifyingGlassIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { documentsAPI, chatbotsAPI } from '@/utils/api';
import Pagination from '@/components/Pagination';

interface Document {
  id: string;
  name: string;
  file_key: string;
  file_url?: string;
  file_size: number;
  document_type: string;
  mime_type: string;
  status: string;
  chatbot?: string;
  chatbot_name?: string;
  user: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  documentDomains?: any[];
}

const allowedExtensions = ['.txt', '.docx', '.pdf', '.xlsx', '.csv'];

export default function DocumentList() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<Record<string, string>>({});
  const [chatbots, setChatbots] = useState<any[]>([]);
  const [selectedChatbotId, setSelectedChatbotId] = useState<string>('');
  const [loadingChatbots, setLoadingChatbots] = useState(false);

  // Pagination and search states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [limit] = useState(20);

  useEffect(() => {
    fetchDocuments();
    loadChatbots();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const timeoutId = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(timeoutId);
    } else {
      fetchDocuments();
    }
  }, [searchTerm]);

  useEffect(() => {
    if (currentPage > 1) {
      fetchDocuments();
    }
  }, [currentPage]);

  const loadChatbots = async () => {
    try {
      setLoadingChatbots(true);
      const response = await chatbotsAPI.list({ limit: 100 });
      setChatbots(response.chatbots);
      
      // Auto-select first chatbot if available
      if (response.chatbots.length > 0) {
        setSelectedChatbotId(response.chatbots[0].id);
      }
    } catch (error) {
      console.error('Failed to load chatbots:', error);
    } finally {
      setLoadingChatbots(false);
    }
  };

  const fetchDocuments = async (page: number = 1, search: string = '') => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setIsSearching(true);
      }

      const response = await documentsAPI.list({
        page,
        limit,
        ...(search && { search }),
      });

      // Handle different response formats
      let documentsData: any[] = [];
      let total = 0;
      let totalPages = 1;

      if (response.documents && Array.isArray(response.documents)) {
        documentsData = response.documents;
        total = response.total || documentsData.length;
        totalPages = response.totalPages || 1;
      } else {
        console.warn('Unexpected response format:', response);
        documentsData = [];
      }

      setDocuments(documentsData);
      setTotalDocuments(total);
      setTotalPages(totalPages);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      setError('Failed to load documents');
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchDocuments(1, searchTerm);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Kiểm tra loại file
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const isCSVByExtension = fileExtension === '.csv';
    
    // Also check MIME type for CSV files since macOS may report CSV as text/plain
    const isCSVByType = file.type.includes('csv') || file.type.includes('comma-separated-values');
    const isCSV = isCSVByExtension || isCSVByType;
    
    if (!allowedExtensions.includes(fileExtension) && !isCSV) {
      setError('Chỉ chấp nhận file: .txt, .docx, .pdf, .xlsx, .csv');
      return;
    }

    // Kiểm tra kích thước file (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File quá lớn. Kích thước tối đa: 10MB');
      return;
    }

    setSelectedFile(file);
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    // Validate chatbot selection
    if (!selectedChatbotId) {
      setError('Vui lòng chọn một chatbot để tải lên tài liệu');
      return;
    }

    try {
      setUploading(true);
      setError('');

      await documentsAPI.upload(selectedFile, selectedChatbotId);
      setSelectedFile(null);
      setShowUploadModal(false);
      await fetchDocuments(currentPage, searchTerm); // Refresh the list
    } catch (error: any) {
      console.error('Upload failed:', error);
      setError(error.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      await documentsAPI.delete(documentId);
      await fetchDocuments(currentPage, searchTerm); // Refresh the list
    } catch (error) {
      console.error('Failed to delete document:', error);
      setError('Failed to delete document');
    }
  };

  const handleDownload = async (documentId: string) => {
    try {
      setDownloadingId(documentId);
      await documentsAPI.download(documentId);
    } catch (error) {
      console.error('Failed to download document:', error);
      setError('Failed to download document');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleIndex = async (documentId: string, document: any) => {
    if (!confirm('Are you sure you want to index this document? This will process the document for chatbot use.')) {
      return;
    }

    try {
      setIndexingId(documentId);
      setIndexingStatus(prev => ({ ...prev, [documentId]: 'Indexing...' }));
      
      // Get chatbot ID from document or use first available chatbot
      let chatbotId = document.chatbot;
      
      if (!chatbotId) {
        // Try to get user's chatbots
        try {
          const chatbotsResponse = await chatbotsAPI.list({ limit: 1 });
          if (chatbotsResponse.chatbots.length > 0) {
            chatbotId = chatbotsResponse.chatbots[0].id;
          } else {
            throw new Error('No chatbots found. Please create a chatbot first.');
          }
        } catch (error) {
          throw new Error('Unable to find a chatbot for indexing. Please ensure you have at least one chatbot.');
        }
      }
      
      // Call the indexing API
      const result = await documentsAPI.index(documentId, chatbotId);
      
      setIndexingStatus(prev => ({ ...prev, [documentId]: 'Indexing queued successfully!' }));
      
      // Show success message
      alert('Document indexing command sent successfully! The document will be processed asynchronously.');
      
      // Refresh data after a short delay to show updated status
      setTimeout(() => {
        fetchDocuments(currentPage, searchTerm);
      }, 2000);
      
    } catch (error: any) {
      console.error('Failed to index document:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to index document';
      setIndexingStatus(prev => ({ ...prev, [documentId]: `Error: ${errorMessage}` }));
      setError(`Failed to index document: ${errorMessage}`);
    } finally {
      setIndexingId(null);
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType?.toLowerCase()) {
      case 'pdf':
        return <DocumentIcon className="h-6 w-6 text-red-500" />;
      case 'docx':
        return <DocumentTextIcon className="h-6 w-6 text-blue-500" />;
      case 'txt':
        return (
          <DocumentMagnifyingGlassIcon className="h-6 w-6 text-gray-500" />
        );
      case 'xlsx':
        return <DocumentIcon className="h-6 w-6 text-green-500" />;
      default:
        return <DocumentIcon className="h-6 w-6 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'uploaded':
        return 'bg-blue-100 text-blue-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Tài liệu
            {totalDocuments > 0 && (
              <span className="text-sm text-gray-500 ml-2">
                ({totalDocuments} tài liệu)
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Quản lý tài liệu đã tải lên
          </p>
        </div>
        <div className="mt-4 sm:mt-0">
          <button
            onClick={() => setShowUploadModal(true)}
            className="btn-primary inline-flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Tải lên tài liệu
          </button>
        </div>
      </div>

      {/* Search Box */}
      <div className="max-w-md">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Tìm kiếm tài liệu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10"
          />
        </div>
      </div>

      {isSearching && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          <span className="ml-2 text-sm text-gray-500">Đang tìm kiếm...</span>
        </div>
      )}

      {/* Documents Table */}
      <div className="card overflow-hidden shadow-none rounded-none">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Tên tài liệu</th>
                <th className="table-header">Loại</th>
                <th className="table-header">Kích thước</th>
                <th className="table-header">Chatbot</th>
                <th className="table-header">Trạng thái</th>
                <th className="table-header">Ngày tải lên</th>
                <th className="table-header">Hành động</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {documents.map((document) => (
                <tr key={document.id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <div className="flex items-center">
                      {getFileIcon(document.mime_type)}
                      <div className="ml-3">
                        <div className="font-medium text-gray-900">
                          {document.name}
                        </div>
                        {document.metadata?.error_message && (
                          <div className="text-sm text-red-500">
                            {document.metadata.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                        {document.document_type?.toUpperCase()}
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {formatFileSize(document.file_size)}
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {document.chatbot_name || 'Không có'}
                  </td>
                  <td className="table-cell">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        document.status?.toLowerCase()
                      )}`}
                    >
                      {document.status?.toLowerCase() === 'processed'
                        ? 'Đã hoàn thành'
                        : document.status?.toLowerCase() ===
                            'processing'
                          ? 'Đang xử lý'
                          : document.status?.toLowerCase() ===
                              'uploaded'
                            ? 'Chờ xử lý'
                            : 'Thất bại'}
                    </span>
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {new Date(document.created_at).toLocaleDateString()}
                  </td>
                  <td className="table-cell">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleDownload(document.id)}
                        className="text-primary-600 hover:text-primary-900"
                        title="Tải xuống tài liệu"
                        disabled={downloadingId === document.id}
                      >
                        {downloadingId === document.id ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
                        ) : (
                          <ArrowDownTrayIcon className="h-5 w-5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleIndex(document.id, document)}
                        className="text-green-600 hover:text-green-900"
                        title="Index document for chatbot"
                        disabled={indexingId === document.id}
                      >
                        {indexingId === document.id ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                        ) : (
                          <ArrowPathIcon className="h-5 w-5" />
                        )}
                      </button>
                      <button
                        className="text-red-600 hover:text-red-900"
                        onClick={() => handleDelete(document.id)}
                        title="Xóa tài liệu"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                    {indexingStatus[document.id] && (
                      <div className="mt-1 text-xs text-gray-500">
                        {indexingStatus[document.id]}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      <div className="card p-4 shadow-none rounded-none">
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalDocuments}
          itemsPerPage={limit}
          onPageChange={handlePageChange}
        />
      </div>

      {documents.length === 0 && !isSearching && (
        <div className="text-center py-12">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {searchTerm
              ? `Không tìm thấy tài liệu nào với từ khóa "${searchTerm}"`
              : 'Không có tài liệu'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm
              ? 'Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc để xem tất cả tài liệu.'
              : 'Bắt đầu bằng cách tải lên tài liệu.'}
          </p>
          {!searchTerm && (
            <div className="mt-6">
              <button
                onClick={() => setShowUploadModal(true)}
                className="btn-primary inline-flex items-center"
              >
                <PlusIcon className="h-5 w-5 mr-2" />
                Tải lên tài liệu
              </button>
            </div>
          )}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-primary-100 sm:mx-0 sm:h-10 sm:w-10">
                    <DocumentIcon className="h-6 w-6 text-primary-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                      Tải lên tài liệu
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Định dạng được hỗ trợ: TXT, DOCX, PDF, XLSX, CSV (Max 10MB)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {/* Chatbot Selector */}
                  <div>
                    <label
                      htmlFor="chatbot-select"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Chọn chatbot
                    </label>
                    {loadingChatbots ? (
                      <div className="flex items-center justify-center py-2">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
                        <span className="ml-2 text-sm text-gray-500">Đang tải danh sách chatbot...</span>
                      </div>
                    ) : (
                      <>
                        <select
                          id="chatbot-select"
                          value={selectedChatbotId}
                          onChange={(e) => setSelectedChatbotId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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

                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                    <div className="space-y-1 text-center">
                      <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
                      <div className="flex text-sm text-gray-600">
                        <label
                          htmlFor="file-upload"
                          className="relative cursor-pointer bg-white rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500"
                        >
                          <span>Tải lên tài liệu</span>
                          <input
                            id="file-upload"
                            name="file-upload"
                            type="file"
                            className="sr-only"
                            accept=".txt,.docx,.pdf,.xlsx,.csv"
                            onChange={handleFileSelect}
                          />
                        </label>
                        <p className="pl-1">hoặc kéo và thả</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        TXT, DOCX, PDF, XLSX, CSV tối đa 10MB
                      </p>
                    </div>
                  </div>

                  {selectedFile && (
                    <div className="p-3 bg-gray-50 rounded-md">
                      <div className="flex items-center">
                        {getFileIcon(selectedFile.name.split('.').pop() || '')}
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">
                            {selectedFile.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatFileSize(selectedFile.size)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="text-sm text-red-600">{error}</div>
                  )}

                  {uploading && (
                    <div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                      <p className="mt-2 text-sm text-gray-600">
                        Đang tải lên... {uploadProgress}%
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 gap-2 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  disabled={uploading || !selectedFile}
                  onClick={handleUpload}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? 'Đang tải lên...' : 'Tải lên'}
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    setShowUploadModal(false);
                    setSelectedFile(null);
                    setError('');
                    setUploadProgress(0);
                    // Reset to first chatbot if available
                    if (chatbots.length > 0) {
                      setSelectedChatbotId(chatbots[0].id);
                    }
                  }}
                  className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Hủy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
