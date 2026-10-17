import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  DocumentTextIcon,
  UserGroupIcon,
  BriefcaseIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import { attendanceRuleAPI, LeavePolicyConfig } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const LeavePolicyList: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<LeavePolicyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState<string>('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<string>('all');
  const [isCurrentFilter, setIsCurrentFilter] = useState<string>('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [policyToDelete, setPolicyToDelete] = useState<LeavePolicyConfig | null>(null);

  const loadPolicies = async (page = 1) => {
    try {
      setLoading(true);
      const params: any = {
        page,
        page_size: 50,
        ordering: '-effective_from',
      };

      if (searchTerm) {
        params.search = searchTerm;
      }

      if (isActiveFilter !== 'all') {
        params.is_active = isActiveFilter === 'active';
      }

      if (leaveTypeFilter !== 'all') {
        params.leave_type = leaveTypeFilter;
      }

      if (isCurrentFilter !== 'all') {
        params.is_current = isCurrentFilter;
      }

      const response = await attendanceRuleAPI.listLeavePolicyConfigs(params);
      setPolicies(response.results);
      setTotalPages(Math.ceil(response.count / 20));
      setCurrentPage(page);
    } catch (error) {
      console.error('Error loading leave policies:', error);
      alert('Không thể tải danh sách chính sách nghỉ phép');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
  }, [searchTerm, isActiveFilter, leaveTypeFilter, isCurrentFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadPolicies(1);
  };

  const handleDeleteClick = (policy: LeavePolicyConfig) => {
    setPolicyToDelete(policy);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!policyToDelete) return;

    try {
      await attendanceRuleAPI.deleteLeavePolicyConfig(policyToDelete.id);
      alert('Đã xóa chính sách nghỉ phép thành công');
      loadPolicies(currentPage);
    } catch (error) {
      console.error('Error deleting leave policy:', error);
      alert('Không thể xóa chính sách nghỉ phép');
    } finally {
      setShowDeleteModal(false);
      setPolicyToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  const getStatusBadge = (policy: LeavePolicyConfig) => {
    if (!policy.is_active) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <XCircleIcon className="w-3 h-3 mr-1" />
          Không hoạt động
        </span>
      );
    }

    if (policy.is_current) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircleIcon className="w-3 h-3 mr-1" />
          Đang áp dụng
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        <ClockIcon className="w-3 h-3 mr-1" />
        Chưa áp dụng
      </span>
    );
  };

  const getEffectiveDateRange = (policy: LeavePolicyConfig) => {
    const from = formatDate(policy.effective_from);
    const to = policy.effective_to ? formatDate(policy.effective_to) : 'Không giới hạn';
    return `${from} - ${to}`;
  };

  const getLeaveTypeBadge = (policy: LeavePolicyConfig) => {
    const colors: Record<string, string> = {
      'ANNUAL_LEAVE': 'bg-blue-100 text-blue-800',
      'SICK_LEAVE': 'bg-green-100 text-green-800',
      'MATERNITY_LEAVE': 'bg-pink-100 text-pink-800',
      'PATERNITY_LEAVE': 'bg-purple-100 text-purple-800',
      'UNPAID_LEAVE': 'bg-gray-100 text-gray-800',
      'COMPASSIONATE_LEAVE': 'bg-red-100 text-red-800',
      'STUDY_LEAVE': 'bg-indigo-100 text-indigo-800',
      'OTHER': 'bg-yellow-100 text-yellow-800',
    };

    const defaultColor = 'bg-gray-100 text-gray-800';
    const colorClass = colors[policy.leave_type] || defaultColor;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        <CalendarDaysIcon className="w-3 h-3 mr-1" />
        {policy.leave_type_display}
      </span>
    );
  };

  const getScopeBadge = (policy: LeavePolicyConfig) => {
    if (policy.apply_to_all) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
          <UserGroupIcon className="w-3 h-3 mr-1" />
          Tất cả
        </span>
      );
    }

    const scopes = [];
    if (policy.apply_to_departments && policy.apply_to_departments.length > 0) {
      scopes.push('Phòng ban');
    }
    if (policy.apply_to_positions && policy.apply_to_positions.length > 0) {
      scopes.push('Vị trí');
    }
    if (policy.apply_to_employees && policy.apply_to_employees.length > 0) {
      scopes.push('Nhân viên');
    }

    if (scopes.length === 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <InformationCircleIcon className="w-3 h-3 mr-1" />
          Chưa cấu hình
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        <BriefcaseIcon className="w-3 h-3 mr-1" />
        {scopes.join(', ')}
      </span>
    );
  };

  const getPolicyDetails = (policy: LeavePolicyConfig) => {
    const details = [];
    
    if (policy.max_days_per_year > 0) {
      details.push(`${policy.max_days_per_year} ngày/năm`);
    }
    
    if (policy.max_consecutive_days > 0) {
      details.push(`Tối đa ${policy.max_consecutive_days} ngày liên tiếp`);
    }
    
    if (policy.advance_notice_days > 0) {
      details.push(`Báo trước ${policy.advance_notice_days} ngày`);
    }
    
    if (policy.emergency_notice_hours > 0) {
      details.push(`Cấp bách: ${policy.emergency_notice_hours} giờ`);
    }

    return details.length > 0 ? details.join(', ') : 'Không có chi tiết';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col items-start space-y-3 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Quay lại
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Chính sách nghỉ phép</h1>
            <p className="mt-1 text-sm text-gray-500">
              Quản lý các chính sách nghỉ phép, thời gian báo trước và quy trình xin nghỉ
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Link
            to="/dashboard/leave-policies/create"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Thêm chính sách mới
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Search */}
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700">
                Tìm kiếm
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  type="text"
                  id="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-3 pr-10 py-2 sm:text-sm border-gray-300 rounded-md"
                  placeholder="Tìm theo mã, tên, mô tả..."
                />
              </div>
            </div>

            {/* Leave Type */}
            <div>
              <SelectBox<string>
                label="Loại nghỉ phép"
                value={leaveTypeFilter}
                options={[
                  { value: 'all', label: 'Tất cả loại' },
                  { value: 'ANNUAL_LEAVE', label: 'Nghỉ phép năm' },
                  { value: 'SICK_LEAVE', label: 'Nghỉ ốm' },
                  { value: 'MATERNITY_LEAVE', label: 'Nghỉ thai sản' },
                  { value: 'PATERNITY_LEAVE', label: 'Nghỉ thai sản chồng' },
                  { value: 'UNPAID_LEAVE', label: 'Nghỉ không lương' },
                  { value: 'COMPASSIONATE_LEAVE', label: 'Nghỉ việc riêng' },
                  { value: 'STUDY_LEAVE', label: 'Nghỉ học tập' },
                  { value: 'OTHER', label: 'Khác' },
                ]}
                onChange={setLeaveTypeFilter}
              />
            </div>

            {/* Active Status */}
            <div>
              <SelectBox<string>
                label="Trạng thái"
                value={isActiveFilter}
                options={[
                  { value: 'all', label: 'Tất cả trạng thái' },
                  { value: 'active', label: 'Đang hoạt động' },
                  { value: 'inactive', label: 'Không hoạt động' },
                ]}
                onChange={setIsActiveFilter}
              />
            </div>

            {/* Current Status */}
            <div>
              <SelectBox<string>
                label="Áp dụng hiện tại"
                value={isCurrentFilter}
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'true', label: 'Đang áp dụng' },
                  { value: 'false', label: 'Không áp dụng' },
                ]}
                onChange={setIsCurrentFilter}
              />
            </div>

            {/* Search Button */}
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Tìm kiếm
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-4 sm:p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DocumentTextIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-3 sm:ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 sm:truncate">Tổng chính sách</dt>
                  <dd className="text-lg font-medium text-gray-900">{policies.length}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-4 sm:p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CheckCircleIcon className="h-6 w-6 text-green-400" />
              </div>
              <div className="ml-3 sm:ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 sm:truncate">Đang hoạt động</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {policies.filter(p => p.is_active).length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-4 sm:p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ClockIcon className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="ml-3 sm:ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 sm:truncate">Đang áp dụng</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {policies.filter(p => p.is_current).length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-4 sm:p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CalendarDaysIcon className="h-6 w-6 text-blue-400" />
              </div>
              <div className="ml-3 sm:ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 sm:truncate">Nghỉ phép năm</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {policies.filter(p => p.leave_type === 'ANNUAL_LEAVE').length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Policies Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
          </div>
        ) : policies.length === 0 ? (
          <div className="text-center py-12">
            <InformationCircleIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Không có chính sách nào</h3>
            <p className="mt-1 text-sm text-gray-500">
              Bắt đầu bằng cách tạo một chính sách nghỉ phép mới.
            </p>
            <div className="mt-6">
              <Link
                to="/dashboard/leave-policies/create"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <PlusIcon className="w-4 h-4 mr-2" />
                Thêm chính sách mới
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tên chính sách
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mã
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Loại nghỉ phép
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Chi tiết
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phạm vi áp dụng
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thời gian áp dụng
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Trạng thái
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {policies.map((policy) => (
                  <tr key={policy.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{policy.name}</div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">
                            {policy.description || 'Không có mô tả'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-mono">{policy.code}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getLeaveTypeBadge(policy)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {getPolicyDetails(policy)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {policy.requires_approval && (
                          <span className="inline-flex items-center mr-2">
                            <ClipboardDocumentCheckIcon className="w-3 h-3 mr-1" />
                            Cần phê duyệt
                          </span>
                        )}
                        {policy.requires_medical_certificate && (
                          <span className="inline-flex items-center mr-2">
                            <DocumentTextIcon className="w-3 h-3 mr-1" />
                            Cần giấy tờ
                          </span>
                        )}
                        {policy.allow_half_day && (
                          <span className="inline-flex items-center">
                            <ClockIcon className="w-3 h-3 mr-1" />
                            Cho phép nửa ngày
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getScopeBadge(policy)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div className="flex items-center">
                          <CalendarIcon className="w-4 h-4 mr-1 text-gray-400" />
                          {getEffectiveDateRange(policy)}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(policy)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <Link
                          to={`/dashboard/leave-policies/${policy.id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Xem/Chỉnh sửa"
                        >
                          <EyeIcon className="w-4 h-4" />
                        </Link>
                        <Link
                          to={`/dashboard/leave-policies/${policy.id}/edit`}
                          className="text-yellow-600 hover:text-yellow-900"
                          title="Chỉnh sửa"
                        >
                          <PencilIcon className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => handleDeleteClick(policy)}
                          className="text-red-600 hover:text-red-900"
                          title="Xóa"
                          disabled={policy.is_current}
                        >
                          <TrashIcon className={`w-4 h-4 ${policy.is_current ? 'opacity-50 cursor-not-allowed' : ''}`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => loadPolicies(currentPage - 1)}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Trang trước
              </button>
              <button
                onClick={() => loadPolicies(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Trang sau
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Hiển thị <span className="font-medium">{(currentPage - 1) * 20 + 1}</span> đến{' '}
                  <span className="font-medium">{Math.min(currentPage * 20, policies.length + (currentPage - 1) * 20)}</span> trong{' '}
                  <span className="font-medium">{policies.length + (currentPage - 1) * 20}</span> kết quả
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => loadPolicies(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="sr-only">Trang trước</span>
                    &larr;
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => loadPolicies(pageNum)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          currentPage === pageNum
                            ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => loadPolicies(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="sr-only">Trang sau</span>
                    &rarr;
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && policyToDelete && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div className="sm:flex sm:items-start">
                <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                  <TrashIcon className="h-6 w-6 text-red-600" />
                </div>
                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Xóa chính sách nghỉ phép</h3>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500">
                      Bạn có chắc chắn muốn xóa chính sách "{policyToDelete.name}" ({policyToDelete.code})?
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      Hành động này không thể hoàn tác. Tất cả dữ liệu liên quan đến chính sách này sẽ bị xóa vĩnh viễn.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Xóa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setPolicyToDelete(null);
                  }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
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
};

export default LeavePolicyList;
