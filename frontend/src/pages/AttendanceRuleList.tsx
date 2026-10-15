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
  CogIcon,
  DocumentTextIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
  BriefcaseIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import { attendanceRuleAPI, AttendanceRuleConfig } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const AttendanceRuleList: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rules, setRules] = useState<AttendanceRuleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState<string>('all');
  const [ruleTypeFilter, setRuleTypeFilter] = useState<string>('all');
  const [isCurrentFilter, setIsCurrentFilter] = useState<string>('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<AttendanceRuleConfig | null>(null);

  const loadRules = async (page = 1) => {
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

      if (ruleTypeFilter !== 'all') {
        params.rule_type = ruleTypeFilter;
      }

      if (isCurrentFilter !== 'all') {
        params.is_current = isCurrentFilter;
      }

      const response = await attendanceRuleAPI.listAttendanceRuleConfigs(params);
      setRules(response.results);
      setTotalPages(Math.ceil(response.count / 20));
      setCurrentPage(page);
    } catch (error) {
      console.error('Error loading attendance rules:', error);
      alert('Không thể tải danh sách quy tắc chấm công');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, [searchTerm, isActiveFilter, ruleTypeFilter, isCurrentFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadRules(1);
  };

  const handleDeleteClick = (rule: AttendanceRuleConfig) => {
    setRuleToDelete(rule);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!ruleToDelete) return;

    try {
      await attendanceRuleAPI.deleteAttendanceRuleConfig(ruleToDelete.id);
      alert('Đã xóa quy tắc chấm công thành công');
      loadRules(currentPage);
    } catch (error) {
      console.error('Error deleting attendance rule:', error);
      alert('Không thể xóa quy tắc chấm công');
    } finally {
      setShowDeleteModal(false);
      setRuleToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  const getStatusBadge = (rule: AttendanceRuleConfig) => {
    if (!rule.is_active) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <XCircleIcon className="w-3 h-3 mr-1" />
          Không hoạt động
        </span>
      );
    }

    if (rule.is_current) {
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

  const getEffectiveDateRange = (rule: AttendanceRuleConfig) => {
    const from = formatDate(rule.effective_from);
    const to = rule.effective_to ? formatDate(rule.effective_to) : 'Không giới hạn';
    return `${from} - ${to}`;
  };

  const getRuleTypeBadge = (rule: AttendanceRuleConfig) => {
    const colors: Record<string, string> = {
      'SHIFT_RULE': 'bg-blue-100 text-blue-800',
      'LATE_EARLY_RULE': 'bg-orange-100 text-orange-800',
      'WORK_HOUR_CALCULATION': 'bg-purple-100 text-purple-800',
      'OVERTIME_RULE': 'bg-red-100 text-red-800',
      'BREAK_TIME_RULE': 'bg-teal-100 text-teal-800',
    };

    const defaultColor = 'bg-gray-100 text-gray-800';
    const colorClass = colors[rule.rule_type] || defaultColor;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        <CogIcon className="w-3 h-3 mr-1" />
        {rule.rule_type_display}
      </span>
    );
  };

  const getScopeBadge = (rule: AttendanceRuleConfig) => {
    if (rule.apply_to_all) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
          <UserGroupIcon className="w-3 h-3 mr-1" />
          Tất cả
        </span>
      );
    }

    const scopes = [];
    if (rule.apply_to_departments && rule.apply_to_departments.length > 0) {
      scopes.push('Phòng ban');
    }
    if (rule.apply_to_positions && rule.apply_to_positions.length > 0) {
      scopes.push('Vị trí');
    }
    if (rule.apply_to_employees && rule.apply_to_employees.length > 0) {
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

  const getConfigurationPreview = (rule: AttendanceRuleConfig) => {
    if (!rule.configuration) return 'Không có cấu hình';

    try {
      const config = typeof rule.configuration === 'string' 
        ? JSON.parse(rule.configuration) 
        : rule.configuration;

      if (rule.rule_type === 'SHIFT_RULE') {
        return `${config.start_time || 'N/A'} - ${config.end_time || 'N/A'} (${config.work_hours || 0}h)`;
      }

      return JSON.stringify(config).substring(0, 50) + '...';
    } catch (error) {
      return 'Cấu hình không hợp lệ';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Quay lại
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quy tắc chấm công</h1>
            <p className="mt-1 text-sm text-gray-500">
              Quản lý các quy tắc chấm công theo ca làm việc, đi muộn/về sớm, làm thêm giờ
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Link
            to="/dashboard/attendance-rules/create"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Thêm quy tắc mới
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

            {/* Rule Type */}
            <div>
              <SelectBox<string>
                label="Loại quy tắc"
                value={ruleTypeFilter}
                options={[
                  { value: 'all', label: 'Tất cả loại' },
                  { value: 'SHIFT_RULE', label: 'Quy tắc ca làm việc' },
                  { value: 'LATE_EARLY_RULE', label: 'Đi muộn/Về sớm' },
                  { value: 'WORK_HOUR_CALCULATION', label: 'Tính giờ làm việc' },
                  { value: 'OVERTIME_RULE', label: 'Làm thêm giờ' },
                  { value: 'BREAK_TIME_RULE', label: 'Giờ nghỉ' },
                ]}
                onChange={setRuleTypeFilter}
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CogIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Tổng quy tắc</dt>
                  <dd className="text-lg font-medium text-gray-900">{rules.length}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CheckCircleIcon className="h-6 w-6 text-green-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Đang hoạt động</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {rules.filter(r => r.is_active).length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ClockIcon className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Đang áp dụng</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {rules.filter(r => r.is_current).length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DocumentTextIcon className="h-6 w-6 text-blue-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Quy tắc ca làm</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {rules.filter(r => r.rule_type === 'SHIFT_RULE').length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12">
            <InformationCircleIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Không có quy tắc nào</h3>
            <p className="mt-1 text-sm text-gray-500">
              Bắt đầu bằng cách tạo một quy tắc chấm công mới.
            </p>
            <div className="mt-6">
              <Link
                to="/dashboard/attendance-rules/create"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <PlusIcon className="w-4 h-4 mr-2" />
                Thêm quy tắc mới
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tên quy tắc
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mã
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Loại quy tắc
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cấu hình
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
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{rule.name}</div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">
                            {rule.description || 'Không có mô tả'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-mono">{rule.code}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getRuleTypeBadge(rule)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {getConfigurationPreview(rule)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getScopeBadge(rule)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div className="flex items-center">
                          <CalendarIcon className="w-4 h-4 mr-1 text-gray-400" />
                          {getEffectiveDateRange(rule)}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(rule)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <Link
                          to={`/dashboard/attendance-rules/${rule.id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Xem/Chỉnh sửa"
                        >
                          <EyeIcon className="w-4 h-4" />
                        </Link>
                        <Link
                          to={`/dashboard/attendance-rules/${rule.id}/edit`}
                          className="text-yellow-600 hover:text-yellow-900"
                          title="Chỉnh sửa"
                        >
                          <PencilIcon className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => handleDeleteClick(rule)}
                          className="text-red-600 hover:text-red-900"
                          title="Xóa"
                          disabled={rule.is_current}
                        >
                          <TrashIcon className={`w-4 h-4 ${rule.is_current ? 'opacity-50 cursor-not-allowed' : ''}`} />
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
                onClick={() => loadRules(currentPage - 1)}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Trang trước
              </button>
              <button
                onClick={() => loadRules(currentPage + 1)}
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
                  <span className="font-medium">{Math.min(currentPage * 20, rules.length + (currentPage - 1) * 20)}</span> trong{' '}
                  <span className="font-medium">{rules.length + (currentPage - 1) * 20}</span> kết quả
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => loadRules(currentPage - 1)}
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
                        onClick={() => loadRules(pageNum)}
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
                    onClick={() => loadRules(currentPage + 1)}
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
      {showDeleteModal && ruleToDelete && (
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
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Xóa quy tắc chấm công</h3>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500">
                      Bạn có chắc chắn muốn xóa quy tắc "{ruleToDelete.name}" ({ruleToDelete.code})?
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      Hành động này không thể hoàn tác. Tất cả dữ liệu liên quan đến quy tắc này sẽ bị xóa vĩnh viễn.
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
                    setRuleToDelete(null);
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

export default AttendanceRuleList;
