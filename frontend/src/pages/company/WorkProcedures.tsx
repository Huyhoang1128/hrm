import React, { useState, useEffect } from 'react';
import { ArrowLeftIcon, CogIcon, DocumentTextIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import companyDocumentAPI, { CompanyDocument } from '../../services/company-document.service';

const WorkProcedures: React.FC = () => {
  const navigate = useNavigate();
  const [procedures, setProcedures] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    totalSteps: 0,
    active: 0,
    departments: 0
  });

  useEffect(() => {
    fetchWorkProcedures();
  }, []);

  const fetchWorkProcedures = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch work procedures (document_type = 'WORK_PROCEDURE')
      const response = await companyDocumentAPI.getByType('WORK_PROCEDURE', {
        page_size: 50
      });
      
      setProcedures(response.results);
      
      // Calculate stats
      const totalSteps = response.results.reduce((sum, proc) => {
        // Try to extract steps from description or use default
        const desc = proc.description?.toLowerCase() || '';
        const stepsMatch = desc.match(/(\d+)\s*bước/) || 
                          proc.title?.toLowerCase().match(/(\d+)\s*bước/);
        return sum + (stepsMatch ? parseInt(stepsMatch[1]) : 5);
      }, 0);
      
      const departments = new Set(
        response.results.map(proc => getDepartment(proc))
      ).size;
      
      setStats({
        total: response.count,
        totalSteps,
        active: response.results.length, // All are active for now
        departments
      });
      
    } catch (err: any) {
      console.error('Error fetching work procedures:', err);
      setError('Không thể tải danh sách quy trình làm việc. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (procedure: CompanyDocument) => {
    try {
      // Record view first
      await companyDocumentAPI.recordView(procedure.id);
      
      // For now, just download the document
      // In a real implementation, you might want to show a preview or detailed view
      const blob = await companyDocumentAPI.download(procedure.id);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = procedure.file_name || procedure.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Error viewing procedure:', err);
      alert('Không thể xem chi tiết quy trình. Vui lòng thử lại sau.');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  const getDepartment = (procedure: CompanyDocument) => {
    const title = procedure.title?.toLowerCase() || '';
    const description = procedure.description?.toLowerCase() || '';
    
    if (title.includes('tuyển dụng') || title.includes('nhân sự') || description.includes('nhân sự')) {
      return 'Nhân sự';
    } else if (title.includes('mua sắm') || description.includes('mua sắm')) {
      return 'Mua sắm';
    } else if (title.includes('khiếu nại') || description.includes('khiếu nại') || title.includes('khách hàng')) {
      return 'Chăm sóc khách hàng';
    } else if (title.includes('dự án') || description.includes('dự án') || title.includes('phê duyệt')) {
      return 'Quản lý dự án';
    } else if (title.includes('đào tạo') || description.includes('đào tạo')) {
      return 'Đào tạo';
    } else if (title.includes('tài chính') || description.includes('tài chính') || title.includes('kế toán')) {
      return 'Kế toán';
    } else if (title.includes('an toàn') || description.includes('an toàn')) {
      return 'An toàn lao động';
    } else if (title.includes('chất lượng') || description.includes('chất lượng')) {
      return 'Quản lý chất lượng';
    }
    return 'Chung';
  };

  const getStepsCount = (procedure: CompanyDocument) => {
    const desc = procedure.description?.toLowerCase() || '';
    const title = procedure.title?.toLowerCase() || '';
    
    const stepsMatch = desc.match(/(\d+)\s*bước/) || 
                      title.match(/(\d+)\s*bước/) ||
                      desc.match(/bước\s*(\d+)/);
    
    return stepsMatch ? parseInt(stepsMatch[1]) : 5;
  };

  const getVersion = (procedure: CompanyDocument) => {
    // Extract version from description or use default
    const desc = procedure.description?.toLowerCase() || '';
    const versionMatch = desc.match(/phiên bản\s*(\d+\.\d+)/) ||
                        desc.match(/version\s*(\d+\.\d+)/);
    
    return versionMatch ? versionMatch[1] : '1.0';
  };

  // Get department counts for the overview
  const getDepartmentCounts = () => {
    const counts: Record<string, number> = {};
    procedures.forEach(proc => {
      const dept = getDepartment(proc);
      counts[dept] = (counts[dept] || 0) + 1;
    });
    
    return Object.entries(counts).map(([name, count]) => {
      // Assign colors based on department
      const colorMap: Record<string, { bg: string, text: string }> = {
        'Nhân sự': { bg: 'bg-blue-100', text: 'text-blue-800' },
        'Mua sắm': { bg: 'bg-green-100', text: 'text-green-800' },
        'Chăm sóc khách hàng': { bg: 'bg-purple-100', text: 'text-purple-800' },
        'Quản lý dự án': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
        'Đào tạo': { bg: 'bg-red-100', text: 'text-red-800' },
        'Kế toán': { bg: 'bg-indigo-100', text: 'text-indigo-800' },
        'An toàn lao động': { bg: 'bg-orange-100', text: 'text-orange-800' },
        'Quản lý chất lượng': { bg: 'bg-teal-100', text: 'text-teal-800' },
        'Chung': { bg: 'bg-gray-100', text: 'text-gray-800' }
      };
      
      const colors = colorMap[name] || { bg: 'bg-gray-100', text: 'text-gray-800' };
      
      return {
        name,
        count,
        color: colors.bg,
        textColor: colors.text
      };
    });
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
            <h1 className="text-2xl font-bold text-gray-900">Quy trình làm việc</h1>
            <p className="mt-1 text-sm text-gray-600">
              Các quy trình làm việc chuẩn của các bộ phận trong công ty
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <CogIcon className="h-8 w-8 text-purple-600" />
          <span className="text-sm font-medium text-gray-700">{stats.total} quy trình</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải quy trình làm việc...</p>
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
                  onClick={fetchWorkProcedures}
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-700">Tổng quy trình</p>
                  <p className="text-2xl font-bold text-purple-900 mt-1">{stats.total}</p>
                </div>
                <div className="h-10 w-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <CogIcon className="h-5 w-5 text-purple-600" />
                </div>
              </div>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-700">Tổng bước công việc</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">{stats.totalSteps}</p>
                </div>
                <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-700">Đang áp dụng</p>
                  <p className="text-2xl font-bold text-green-900 mt-1">{stats.active}</p>
                </div>
                <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircleIcon className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-yellow-700">Bộ phận</p>
                  <p className="text-2xl font-bold text-yellow-900 mt-1">{stats.departments}</p>
                </div>
                <div className="h-10 w-10 bg-yellow-100 rounded-full flex items-center justify-center">
                  <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Procedures List */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Danh sách quy trình</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {procedures.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Không có quy trình</h3>
                  <p className="mt-1 text-sm text-gray-500">Hiện tại không có quy trình làm việc nào.</p>
                </div>
              ) : (
                procedures.map((procedure) => {
                  const department = getDepartment(procedure);
                  const steps = getStepsCount(procedure);
                  const version = getVersion(procedure);
                  
                  return (
                    <div key={procedure.id} className="px-6 py-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <div className="h-10 w-10 bg-purple-100 rounded-lg flex items-center justify-center">
                              <DocumentTextIcon className="h-6 w-6 text-purple-600" />
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h3 className="font-medium text-gray-900">{procedure.title}</h3>
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  Đang áp dụng
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{procedure.description}</p>
                              <div className="flex items-center space-x-4 mt-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  {department}
                                </span>
                                <span className="text-sm text-gray-500">{steps} bước</span>
                                <span className="text-sm text-gray-500">Phiên bản: {version}</span>
                                <span className="text-sm text-gray-500">Cập nhật: {formatDate(procedure.effective_from)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <button 
                            onClick={() => handleViewDetails(procedure)}
                            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
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

          {/* Departments Overview */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Quy trình theo bộ phận</h3>
            <div className="space-y-4">
              {getDepartmentCounts().map((dept) => (
                <div key={dept.name} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`h-8 w-8 ${dept.color} rounded-full flex items-center justify-center`}>
                      <span className={`text-xs font-medium ${dept.textColor}`}>{dept.count}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">{dept.name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="h-2 w-32 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full ${dept.color.replace('100', '500')} rounded-full`} style={{ width: '100%' }}></div>
                    </div>
                    <span className="text-xs text-gray-500">{dept.count} quy trình</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Process Flow Example */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Ví dụ về quy trình làm việc</h3>
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-blue-800">1</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Đề xuất</p>
                  <p className="text-sm text-gray-600">Nhân viên đề xuất công việc/dự án</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-green-800">2</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Phê duyệt</p>
                  <p className="text-sm text-gray-600">Quản lý trực tiếp phê duyệt đề xuất</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="h-10 w-10 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-yellow-800">3</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Thực hiện</p>
                  <p className="text-sm text-gray-600">Nhân viên thực hiện công việc đã được phê duyệt</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="h-10 w-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-purple-800">4</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Báo cáo</p>
                  <p className="text-sm text-gray-600">Báo cáo kết quả và đánh giá hiệu quả</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkProcedures;
