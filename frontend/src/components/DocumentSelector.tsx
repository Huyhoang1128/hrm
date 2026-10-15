import { useState, useEffect } from 'react';
import {
  DocumentIcon,
  DocumentTextIcon,
  DocumentMagnifyingGlassIcon,
  XMarkIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { documentsAPI } from '@/utils/api';

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
  user: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  documentDomains?: any[];
}

interface BotDocument {
  id: string;
  botId: string;
  name: string;
  file_key: string;
  document_type: string;
  mime_type: string;
  created_at: string;
}

interface DocumentSelectorProps {
  botId: string;
  onDocumentsChange?: (documents: BotDocument[]) => void;
}

export default function DocumentSelector({
  botId,
  onDocumentsChange,
}: DocumentSelectorProps) {
  const [availableDocuments, setAvailableDocuments] = useState<Document[]>([]);
  const [attachedDocuments, setAttachedDocuments] = useState<BotDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination and search states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [allDocumentsLoaded, setAllDocumentsLoaded] = useState(false);

  useEffect(() => {
    fetchData();
  }, [botId]);

  useEffect(() => {
    if (searchTerm) {
      const timeoutId = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(timeoutId);
    } else {
      fetchData();
    }
  }, [searchTerm]);

  useEffect(() => {
    if (currentPage > 1) {
      loadMoreDocuments();
    }
  }, [currentPage]);

  const fetchData = async (page: number = 1, search: string = '') => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setIsSearching(true);
      }

      // Fetch available documents with pagination
      const documentsResponse = await documentsAPI.list({
        page,
        limit: 20,
        processingStatus: 'processed',
        ...(search && { search }),
      });

      let documentsData: any[] = [];
      let total = 0;
      let totalPages = 1;

      if (Array.isArray(documentsResponse)) {
        documentsData = documentsResponse;
      } else if (
        documentsResponse.documents &&
        Array.isArray(documentsResponse.documents)
      ) {
        documentsData = documentsResponse.documents;
        total = documentsResponse.total || documentsData.length;
        totalPages = documentsResponse.totalPages || 1;
      }

      if (page === 1) {
        setAvailableDocuments(documentsData);
        setAllDocumentsLoaded(documentsData.length === 0);
      } else {
        setAvailableDocuments((prev) => [...prev, ...documentsData]);
        setAllDocumentsLoaded(documentsData.length < 20);
      }

      setTotalDocuments(total);
      setTotalPages(totalPages);

      // Fetch attached documents
      const botDocumentsResponse = await documentsAPI.list({
        chatbotId: botId,
      });
      let botDocumentsData: any[] = [];

      if (
        botDocumentsResponse.documents &&
        Array.isArray(botDocumentsResponse.documents)
      ) {
        botDocumentsData = botDocumentsResponse.documents;
      }

      setAttachedDocuments(botDocumentsData);

      if (onDocumentsChange) {
        onDocumentsChange(botDocumentsData);
      }
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
    fetchData(1, searchTerm);
  };

  const loadMoreDocuments = () => {
    if (!allDocumentsLoaded && !isSearching) {
      fetchData(currentPage, searchTerm);
    }
  };

  const handleLoadMore = () => {
    setCurrentPage((prev) => prev + 1);
  };

  const handleAttachDocument = async (documentId: string) => {
    try {
      await documentsAPI.attachToChatbot(documentId, botId);
      // Refresh data with current search and page
      await fetchData(currentPage, searchTerm);
    } catch (error) {
      console.error('Failed to attach document:', error);
      setError('Failed to attach document');
    }
  };

  const handleDetachDocument = async (documentId: string) => {
    try {
      await documentsAPI.detachFromChatbot(documentId);
      // Refresh data with current search and page
      await fetchData(currentPage, searchTerm);
    } catch (error) {
      console.error('Failed to detach document:', error);
      setError('Failed to detach document');
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType.toLowerCase()) {
      case 'pdf':
        return <DocumentIcon className="h-5 w-5 text-red-500" />;
      case 'docx':
        return <DocumentTextIcon className="h-5 w-5 text-blue-500" />;
      case 'txt':
        return (
          <DocumentMagnifyingGlassIcon className="h-5 w-5 text-gray-500" />
        );
      case 'xlsx':
        return <DocumentIcon className="h-5 w-5 text-green-500" />;
      default:
        return <DocumentIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isDocumentAttached = (documentId: string) => {
    return attachedDocuments.some((doc) => doc.id === documentId);
  };

  const getAvailableDocuments = () => {
    return availableDocuments.filter((doc) => !isDocumentAttached(doc.id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Attached Documents */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Attached Documents ({attachedDocuments.length})
        </h3>
        {attachedDocuments.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">No documents attached</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {attachedDocuments.map((doc) => (
              <div
                key={doc.id}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getFileIcon(doc.document_type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate text-ellipsis overflow-hidden">
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        Attached {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDetachDocument(doc.id)}
                    className="text-red-600 hover:text-red-900 p-1"
                    title="Tách tài liệu"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available Documents */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">
            Available Documents ({getAvailableDocuments().length})
            {totalDocuments > 0 && (
              <span className="text-sm text-gray-500 ml-2">
                of {totalDocuments} total
              </span>
            )}
          </h3>
        </div>

        {/* Search Box */}
        <div className="mb-4">
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

        {getAvailableDocuments().length === 0 && !isSearching ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">
              {availableDocuments.length === 0
                ? searchTerm
                  ? `Không tìm thấy tài liệu nào với từ khóa "${searchTerm}"`
                  : 'Không có tài liệu'
                : 'Tất cả tài liệu đã được đính kèm'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {getAvailableDocuments().map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      {getFileIcon(doc.document_type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate text-ellipsis overflow-hidden">
                          {doc.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(doc.file_size)} •{' '}
                          {doc.document_type.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAttachDocument(doc.id)}
                      className="text-primary-600 hover:text-primary-900 p-1"
                      title="Attach document"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Load More Button */}
            {!allDocumentsLoaded && !searchTerm && (
              <div className="mt-6 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isSearching}
                  className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSearching ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
                      Đang tải...
                    </div>
                  ) : (
                    <div className="flex items-center justify-center">
                      <ChevronRightIcon className="h-4 w-4 mr-2" />
                      Tải thêm tài liệu
                    </div>
                  )}
                </button>
              </div>
            )}

            {/* Pagination Info */}
            {totalPages > 1 && !searchTerm && (
              <div className="mt-4 text-center text-sm text-gray-500">
                Trang {currentPage} / {totalPages} • Hiển thị{' '}
                {getAvailableDocuments().length} / {totalDocuments} tài liệu
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
