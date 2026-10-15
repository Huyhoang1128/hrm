import React, { useState, useEffect } from 'react';
import { ArrowLeftIcon, DocumentDuplicateIcon, PrinterIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import companyDocumentAPI, { CompanyDocument } from '../../services/company-document.service';

const InternalForms: React.FC = () => {
  const navigate = useNavigate();
  const [forms, setForms] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    hrForms: 0,
    adminForms: 0,
    latestDate: ''
  });

  useEffect(() => {
    fetchInternalForms();
  }, []);

  const fetchInternalForms = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch internal forms (document_type = 'INTERNAL_FORM')
      const response = await companyDocumentAPI.getByType('INTERNAL_FORM', {
        page_size: 50
      });
      
      setForms(response.results);
      
      // Calculate stats
      const hrForms = response.results.filter(form => 
        form.title?.toLowerCase().includes('nhân sự') || 
        form.title?.toLowerCase().includes('nghỉ phép') ||
        form.description?.toLowerCase().includes('nhân sự')
      ).length;
      
      const adminForms = response.results.filter(form => 
        form.title?.toLowerCase().includes('hành chính') || 
        form.title?.toLowerCase().includes('công tác') ||
        form.description?.toLowerCase().includes('hành chính')
      ).length;
      
      // Get latest document date
      const latestDate = response.results.length > 0 
        ? new Date(response.results[0].effective_from).toLocaleDateString('vi-VN')
        : '';
      
      setStats({
        total: response.count,
        hrForms,
        adminForms,
        latestDate
      });
      
    } catch (err: any) {
      console.error('Error fetching internal forms:', err);
      setError('Không thể tải danh sách mẫu giấy tờ. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async (form: CompanyDocument) => {
    try {
      // Record view first
      await companyDocumentAPI.recordView(form.id);
      
      // Download the file
      const blob = await companyDocumentAPI.download(form.id);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = form.file_name || form.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Error printing form:', err);
      alert('Không thể in mẫu giấy tờ. Vui lòng thử lại sau.');
    }
  };

  const handleDownload = async (form: CompanyDocument) => {
    try {
      // Record view first
      await companyDocumentAPI.recordView(form.id);
      
      // Download the file
      const blob = await companyDocumentAPI.download(form.id);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = form.file_name || form.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Error downloading form:', err);
      alert('Không thể tải xuống mẫu giấy tờ. Vui lòng thử lại sau.');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  const getCategory = (form: CompanyDocument) => {
    const title = form.title?.toLowerCase() || '';
    const description = form.description?.toLowerCase() || '';
    
    if (title.includes('nhân sự') || description.includes('nhân sự') || title.includes('nghỉ phép')) {
      return 'Nhân sự';
    } else if (title.includes('hành chính') || description.includes('hành chính') || title.includes('công tác')) {
      return 'Hành chính';
    } else if (title.includes('mua sắm') || description.includes('mua sắm')) {
      return 'Mua sắm';
    } else if (title.includes('báo cáo') || description.includes('báo cáo')) {
      return 'Báo cáo';
    } else if (title.includes('đào tạo') || description.includes('đào tạo')) {
      return 'Đào tạo';
    } else if (title.includes('ý tưởng') || description.includes('ý tưởng') || title.includes('sáng kiến')) {
      return 'Sáng kiến';
    }
    return 'Khác';
  };

  const getFormCode = (form: CompanyDocument) => {
    // Generate a simple form code based on category and ID
    const category = getCategory(form);
    const categoryCode = category === 'Nhân sự' ? 'HR' : 
                        category === 'Hành chính' ? 'ADMIN' :
                        category === 'Mua sắm' ? 'PUR' :
                        category === 'Báo cáo' ? 'REPORT' :
                        category === 'Đào tạo' ? 'TRAIN' :
                        category === 'Sáng kiến' ? 'IDEA' : 'FORM';
    
    return `${categoryCode}-FORM-${form.id.toString().padStart(3, '0')}`;
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
            <h1 className="text-2xl font-bold text-gray-900">Mẫu giấy tờ nội bộ</h1>
            <p className="mt-1 text-sm text-gray-600">
              Các mẫu đơn, biểu mẫu và giấy tờ sử dụng nội bộ công ty
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <DocumentDuplicateIcon className="h-8 w-8 text-yellow-600" />
          <span className="text-sm font-medium text-gray-700">{stats.total} mẫu</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải mẫu giấy tờ...</p>
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
                  onClick={fetchInternalForms}
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
          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button className="flex flex-col items-center justify-center p-6 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
              <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <PrinterIcon className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="font-medium text-gray-900 text-center">In mẫu nhanh</h3>
              <p className="text-sm text-gray-500 text-center mt-2">In trực tiếp các mẫu đơn thông dụng</p>
            </button>

            <button className="flex flex-col items-center justify-center p-6 bg-green-50 rounded-lg hover:bg-green-100 transition-colors">
              <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 text-center">Tải mẫu Word</h3>
              <p className="text-sm text-gray-500 text-center mt-2">Tải về để chỉnh sửa và điền thông tin</p>
            </button>

            <button className="flex flex-col items-center justify-center p-6 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">
              <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 text-center">Gửi trực tuyến</h3>
              <p className="text-sm text-gray-500 text-center mt-2">Điền và gửi trực tiếp qua hệ thống</p>
            </button>
          </div>

          {/* Forms List */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900">Danh sách mẫu giấy tờ</h2>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">Sắp xếp theo:</span>
                  <select className="border border-gray-300 rounded-md px-3 py-1 text-sm">
                    <option>Phổ biến nhất</option>
                    <option>Mới nhất</option>
                    <option>Theo danh mục</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="divide-y divide-gray-200">
              {forms.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <DocumentDuplicateIcon className="h-12 w-12 text-gray-400 mx-auto" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Không có mẫu giấy tờ</h3>
                  <p className="mt-1 text-sm text-gray-500">Hiện tại không có mẫu giấy tờ nội bộ nào.</p>
                </div>
              ) : (
                forms.map((form) => {
                  const category = getCategory(form);
                  const formCode = getFormCode(form);
                  
                  return (
                    <div key={form.id} className="px-6 py-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <div className="h-10 w-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                              <DocumentDuplicateIcon className="h-6 w-6 text-yellow-600" />
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h3 className="font-medium text-gray-900">{form.title}</h3>
                                <span className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-800 rounded">
                                  {formCode}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{form.description}</p>
                              <div className="flex items-center space-x-4 mt-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  {category}
                                </span>
                                <span className="text-sm text-gray-500">Phiên bản: 1.0</span>
                                <span className="text-sm text-gray-500">Cập nhật: {formatDate(form.effective_from)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="ml-4 flex-shrink-0 flex space-x-2">
                          <button 
                            onClick={() => handlePrint(form)}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          >
                            <PrinterIcon className="h-4 w-4 mr-2" />
                            In
                          </button>
                          <button 
                            onClick={() => handleDownload(form)}
                            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          >
                            <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Tải
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Categories */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Danh mục mẫu giấy tờ</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border border-gray-200 rounded-lg p-4 text-center hover:bg-gray-50">
                <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">Nhân sự</p>
                <p className="text-xs text-gray-500">{stats.hrForms} mẫu</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-4 text-center hover:bg-gray-50">
                <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">Hành chính</p>
                <p className="text-xs text-gray-500">{stats.adminForms} mẫu</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-4 text-center hover:bg-gray-50">
                <div className="h-10 w-10 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">Mua sắm</p>
                <p className="text-xs text-gray-500">
                  {forms.filter(form => getCategory(form) === 'Mua sắm').length} mẫu
                </p>
              </div>
              <div className="border border-gray-200 rounded-lg p-4 text-center hover:bg-gray-50">
                <div className="h-10 w-10 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">Đào tạo</p>
                <p className="text-xs text-gray-500">
                  {forms.filter(form => getCategory(form) === 'Đào tạo').length} mẫu
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InternalForms;
