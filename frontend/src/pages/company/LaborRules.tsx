import React, { useState, useEffect } from 'react';
import { ArrowLeftIcon, ScaleIcon, DocumentTextIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import companyDocumentAPI, { CompanyDocument } from '../../services/company-document.service';

const LaborRules: React.FC = () => {
  const navigate = useNavigate();
  const [rules, setRules] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    mandatory: 0,
    safety: 0,
    latestDate: ''
  });

  useEffect(() => {
    fetchLaborRules();
  }, []);

  const fetchLaborRules = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch labor rules (document_type = 'LABOR_RULE')
      const response = await companyDocumentAPI.getByType('LABOR_RULE', {
        page_size: 50
      });
      
      setRules(response.results);
      
      // Calculate stats
      const mandatory = response.results.filter(rule => 
        rule.title?.toLowerCase().includes('nội quy') || 
        rule.title?.toLowerCase().includes('bắt buộc') ||
        rule.description?.toLowerCase().includes('bắt buộc')
      ).length;
      
      const safety = response.results.filter(rule => 
        rule.title?.toLowerCase().includes('an toàn') || 
        rule.description?.toLowerCase().includes('an toàn')
      ).length;
      
      // Get latest document date
      const latestDate = response.results.length > 0 
        ? new Date(response.results[0].effective_from).toLocaleDateString('vi-VN')
        : '';
      
      setStats({
        total: response.count,
        mandatory,
        safety,
        latestDate
      });
      
    } catch (err: any) {
      console.error('Error fetching labor rules:', err);
      setError('Không thể tải danh sách nội quy. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (rule: CompanyDocument) => {
    try {
      // Record view first
      await companyDocumentAPI.recordView(rule.id);
      
      // For now, just download the document
      // In a real implementation, you might want to show a preview or detailed view
      const blob = await companyDocumentAPI.download(rule.id);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = rule.file_name || rule.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Error viewing document:', err);
      alert('Không thể xem chi tiết tài liệu. Vui lòng thử lại sau.');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  const getImportanceLevel = (rule: CompanyDocument) => {
    const title = rule.title?.toLowerCase() || '';
    const description = rule.description?.toLowerCase() || '';
    
    if (title.includes('bắt buộc') || title.includes('nội quy') || 
        description.includes('bắt buộc') || title.includes('an toàn')) {
      return 'Cao';
    } else if (title.includes('quy tắc') || title.includes('ứng xử') || 
               title.includes('trang phục')) {
      return 'Trung bình';
    }
    return 'Thấp';
  };

  const getCategory = (rule: CompanyDocument) => {
    const title = rule.title?.toLowerCase() || '';
    if (title.includes('nội quy')) return 'Nội quy';
    if (title.includes('thời gian')) return 'Thời gian';
    if (title.includes('ứng xử')) return 'Ứng xử';
    if (title.includes('trang phục')) return 'Trang phục';
    if (title.includes('kỷ luật')) return 'Kỷ luật';
    if (title.includes('an toàn')) return 'An toàn';
    return 'Quy định';
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
            <h1 className="text-2xl font-bold text-gray-900">Nội quy lao động</h1>
            <p className="mt-1 text-sm text-gray-600">
              Các quy định, nội quy và quy tắc làm việc trong công ty
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <ScaleIcon className="h-8 w-8 text-green-600" />
          <span className="text-sm font-medium text-gray-700">{stats.total} quy định</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải nội quy...</p>
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
                  onClick={fetchLaborRules}
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
          {/* Important Notice */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Lưu ý quan trọng</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>• Tất cả nhân viên bắt buộc phải tuân thủ nội quy lao động</p>
                  <p>• Vi phạm nội quy có thể dẫn đến các hình thức kỷ luật</p>
                  <p>• Cập nhật mới nhất có hiệu lực từ ngày {stats.latestDate || '01/01/2026'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Rules List */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Danh sách nội quy</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {rules.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Không có nội quy</h3>
                  <p className="mt-1 text-sm text-gray-500">Hiện tại không có nội quy lao động nào.</p>
                </div>
              ) : (
                rules.map((rule) => {
                  const importance = getImportanceLevel(rule);
                  const category = getCategory(rule);
                  
                  return (
                    <div key={rule.id} className="px-6 py-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                              importance === 'Cao' ? 'bg-red-100' : 
                              importance === 'Trung bình' ? 'bg-yellow-100' : 'bg-blue-100'
                            }`}>
                              <DocumentTextIcon className={`h-6 w-6 ${
                                importance === 'Cao' ? 'text-red-600' : 
                                importance === 'Trung bình' ? 'text-yellow-600' : 'text-blue-600'
                              }`} />
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h3 className="font-medium text-gray-900">{rule.title}</h3>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  importance === 'Cao' ? 'bg-red-100 text-red-800' : 
                                  importance === 'Trung bình' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                  {importance}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{rule.description}</p>
                              <div className="flex items-center space-x-4 mt-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                  {category}
                                </span>
                                <span className="text-sm text-gray-500">Hiệu lực: {formatDate(rule.effective_from)}</span>
                                <span className="text-sm text-gray-500">Trạng thái: Đang áp dụng</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <button 
                            onClick={() => handleViewDetails(rule)}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          >
                            <DocumentTextIcon className="h-4 w-4 mr-2" />
                            Xem chi tiết
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Categories Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Phân loại nội quy</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Nội quy bắt buộc</span>
                  <span className="text-sm font-medium text-gray-900">{stats.mandatory} quy định</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Quy tắc ứng xử</span>
                  <span className="text-sm font-medium text-gray-900">
                    {rules.filter(rule => 
                      rule.title?.toLowerCase().includes('ứng xử') || 
                      rule.title?.toLowerCase().includes('quy tắc')
                    ).length} quy định
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Quy định an toàn</span>
                  <span className="text-sm font-medium text-gray-900">{stats.safety} quy định</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Thông tin liên hệ</h3>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Phòng Nhân sự</p>
                    <p className="text-sm text-gray-500">Ext: 101</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Email hỗ trợ</p>
                    <p className="text-sm text-gray-500">hr@company.com</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LaborRules;
