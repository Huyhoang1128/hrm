import React, { useState, useEffect } from 'react';
import { ArrowLeftIcon, DocumentTextIcon, ArrowDownTrayIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import companyDocumentAPI, { CompanyDocument } from '../../services/company-document.service';

const TrainingDocuments: React.FC = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    totalDownloads: 0,
    latestDate: ''
  });

  useEffect(() => {
    fetchTrainingDocuments();
  }, []);

  const fetchTrainingDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch training documents (document_type = 'TRAINING')
      const response = await companyDocumentAPI.getByType('TRAINING', {
        page_size: 50
      });
      
      setDocuments(response.results);
      
      // Calculate stats
      const totalDownloads = response.results.reduce((sum, doc) => {
        // For now, we'll use a placeholder for downloads count
        // In a real implementation, this would come from the backend
        return sum + 0; // Replace with actual download count when available
      }, 0);
      
      // Get latest document date
      const latestDate = response.results.length > 0 
        ? new Date(response.results[0].effective_from).toLocaleDateString('vi-VN')
        : '';
      
      setStats({
        total: response.count,
        totalDownloads,
        latestDate
      });
      
    } catch (err: any) {
      console.error('Error fetching training documents:', err);
      setError('Không thể tải danh sách tài liệu. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (doc: CompanyDocument) => {
    try {
      // Record view first
      await companyDocumentAPI.recordView(doc.id);
      
      // Download the file
      const blob = await companyDocumentAPI.download(doc.id);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.file_name || doc.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      // Refresh the list to update download count
      fetchTrainingDocuments();
      
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Không thể tải xuống tài liệu. Vui lòng thử lại sau.');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tài liệu đào tạo hội nhập</h1>
            <p className="mt-1 text-sm text-gray-600">
              Các tài liệu hướng dẫn, đào tạo và hội nhập cho nhân viên
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <DocumentTextIcon className="h-8 w-8 text-blue-600" />
          <span className="text-sm font-medium text-gray-700">{stats.total} tài liệu</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải tài liệu...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <InformationCircleIcon className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Lỗi tải dữ liệu</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>{error}</p>
                <button
                  onClick={fetchTrainingDocuments}
                  className="mt-2 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Thử lại
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-700">Tổng số tài liệu</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">{stats.total}</p>
                </div>
                <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <DocumentTextIcon className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-700">Tổng lượt tải</p>
                  <p className="text-2xl font-bold text-green-900 mt-1">
                    {stats.totalDownloads}
                  </p>
                </div>
                <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                  <ArrowDownTrayIcon className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-700">Tài liệu mới nhất</p>
                  <p className="text-lg font-bold text-purple-900 mt-1">{stats.latestDate}</p>
                </div>
                <div className="h-10 w-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Documents List */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Danh sách tài liệu</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {documents.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Không có tài liệu</h3>
                  <p className="mt-1 text-sm text-gray-500">Hiện tại không có tài liệu đào tạo nào.</p>
                </div>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <DocumentTextIcon className="h-6 w-6 text-blue-600" />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">{doc.title}</h3>
                            <p className="text-sm text-gray-600 mt-1">{doc.description}</p>
                            <div className="flex items-center space-x-4 mt-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {companyDocumentAPI.getDocumentTypeDisplay(doc.document_type)}
                              </span>
                              <span className="text-sm text-gray-500">{companyDocumentAPI.formatFileSize(doc.file_size)}</span>
                              <span className="text-sm text-gray-500">Hiệu lực: {formatDate(doc.effective_from)}</span>
                              {doc.effective_to && (
                                <span className="text-sm text-gray-500">Hết hạn: {formatDate(doc.effective_to)}</span>
                              )}
                              {doc.department_name && (
                                <span className="text-sm text-gray-500">Phòng ban: {doc.department_name}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <button 
                          onClick={() => handleDownload(doc)}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                        >
                          <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                          Tải xuống
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Additional Information */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">Thông tin quan trọng</h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>• Tất cả nhân viên mới cần hoàn thành khóa đào tạo hội nhập trong vòng 2 tuần đầu tiên</p>
                  <p>• Các tài liệu được cập nhật định kỳ hàng quý</p>
                  <p>• Liên hệ Phòng Nhân sự nếu cần hỗ trợ thêm</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingDocuments;
