import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
} from '@heroicons/react/24/outline';
import { companyConfigAPI, CompanyConfig } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import ConfirmDialog from '../components/ConfirmDialog';

const formatDate = (d: Date | string) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const CompanyConfigList: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Xác định tab hiện tại từ URL
  const getCurrentTab = () => {
    if (location.pathname.includes('/dashboard/attendance-rules')) return 'attendance-rules';
    if (location.pathname.includes('/dashboard/leave-policies')) return 'leave-policies';
    return 'company-configs';
  };

  const [currentTab, setCurrentTab] = useState(getCurrentTab());
  const [configs, setConfigs] = useState<CompanyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState<string>('all');
  const [isCurrentFilter, setIsCurrentFilter] = useState<string>('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<CompanyConfig | null>(null);

  const loadConfigs = async (page = 1) => {
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

      if (isCurrentFilter !== 'all') {
        params.is_current = isCurrentFilter;
      }

      const response = await companyConfigAPI.listCompanyConfigs(params);
      setConfigs(response.results);
      setTotalPages(Math.ceil(response.count / 20));
      setCurrentPage(page);
    } catch (error) {
      console.error('Error loading company configs:', error);
      alert('Không thể tải danh sách cấu hình công ty');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentTab(getCurrentTab());
  }, [location.pathname]);

  useEffect(() => {
    if (currentTab === 'company-configs') {
      loadConfigs();
    }
  }, [searchTerm, isActiveFilter, isCurrentFilter, currentTab]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadConfigs(1);
  };

  const handleDeleteClick = (config: CompanyConfig) => {
    setConfigToDelete(config);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!configToDelete) return;

    try {
      await companyConfigAPI.deleteCompanyConfig(configToDelete.id);
      alert('Đã xóa cấu hình công ty thành công');
      loadConfigs(currentPage);
    } catch (error) {
      console.error('Error deleting company config:', error);
      alert('Không thể xóa cấu hình công ty');
    } finally {
      setShowDeleteModal(false);
      setConfigToDelete(null);
    }
  };

  const getStatusBadge = (config: CompanyConfig) => {
    if (!config.is_active) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <XCircleIcon className="w-3 h-3 mr-1" />
          Không hoạt động
        </span>
      );
    }

    if (config.is_current) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
          <CheckCircleIcon className="w-3 h-3 mr-1" />
          Đang áp dụng
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
        <ClockIcon className="w-3 h-3 mr-1" />
        Chưa áp dụng
      </span>
    );
  };

  const getEffectiveDateRange = (config: CompanyConfig) => {
    const from = formatDate(config.effective_from);
    const to = config.effective_to ? formatDate(config.effective_to) : 'Không giới hạn';
    return `${from} - ${to}`;
  };

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab);
    if (tab === 'attendance-rules') {
      navigate('/dashboard/attendance-rules');
    } else if (tab === 'leave-policies') {
      navigate('/dashboard/leave-policies');
    } else {
      navigate('/dashboard/company-configs');
    }
  };

  const renderTabContent = () => {
    if (currentTab === 'attendance-rules') {
      return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center py-12">
          <InformationCircleIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-bold text-gray-900">Quản lý quy tắc chấm công</h3>
          <p className="mt-1 text-sm text-gray-500">
            Chuyển đến trang quản lý quy tắc chấm công để xem và quản lý các quy tắc.
          </p>
          <div className="mt-6">
            <Link
              to="/dashboard/attendance-rules"
              className="btn-primary inline-flex items-center gap-2"
            >
              <EyeIcon className="w-4 h-4" />
              Xem quy tắc chấm công
            </Link>
          </div>
        </div>
      );
    }

    if (currentTab === 'leave-policies') {
      return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center py-12">
          <InformationCircleIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-bold text-gray-900">Quản lý chính sách nghỉ phép</h3>
          <p className="mt-1 text-sm text-gray-500">
            Chuyển đến trang quản lý chính sách nghỉ phép để xem và quản lý các chính sách.
          </p>
          <div className="mt-6">
            <Link
              to="/dashboard/leave-policies"
              className="btn-primary inline-flex items-center gap-2"
            >
              <EyeIcon className="w-4 h-4" />
              Xem chính sách nghỉ phép
            </Link>
          </div>
        </div>
      );
    }

    // Tab company-configs
    return (
      <>
        {/* Filters */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div>
                <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                  Tìm kiếm
                </label>
                <input
                  type="text"
                  id="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field w-full"
                  placeholder="Tìm theo tên, mã, mô tả..."
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
                <button type="submit" className="btn-primary">
                  Tìm kiếm
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <InformationCircleIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Tổng cấu hình</p>
                <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{configs.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircleIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đang hoạt động</p>
                <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {configs.filter(c => c.is_active).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <ClockIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đang áp dụng</p>
                <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {configs.filter(c => c.is_current).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Giờ làm/ngày</p>
                <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {configs[0]?.default_working_hours_per_day || 0}h
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Configs Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
            </div>
          ) : configs.length === 0 ? (
            <div className="text-center py-12">
              <InformationCircleIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-bold text-gray-900">Không có cấu hình nào</h3>
              <p className="mt-1 text-sm text-gray-500">
                Bắt đầu bằng cách tạo một cấu hình công ty mới.
              </p>
              <div className="mt-6">
                <Link
                  to="/dashboard/company-configs/create"
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  Thêm cấu hình mới
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Tên cấu hình
                    </th>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Mã
                    </th>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Thời gian áp dụng
                    </th>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Giờ làm việc
                    </th>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Trạng thái
                    </th>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Ngày tạo
                    </th>
                    <th scope="col" className="table-header px-6 py-3 text-left">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {configs.map((config) => (
                    <tr key={config.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{config.name}</div>
                          <div className="text-xs text-gray-400 truncate max-w-xs">
                            {config.description || 'Không có mô tả'}
                          </div>
                        </div>
                      </td>
                      <td className="table-cell px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900 font-mono">{config.code}</span>
                      </td>
                      <td className="table-cell px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm text-gray-700">
                          <CalendarIcon className="w-4 h-4 text-gray-400" />
                          {getEffectiveDateRange(config)}
                        </div>
                      </td>
                      <td className="table-cell px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm text-gray-700">
                          <ClockIcon className="w-4 h-4 text-gray-400" />
                          {config.default_working_hours_per_day}h/ngày
                        </div>
                        <div className="text-xs text-gray-400">
                          {config.default_working_days_per_week} ngày/tuần
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(config)}
                      </td>
                      <td className="table-cell px-6 py-4 whitespace-nowrap">
                        {formatDate(config.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/dashboard/company-configs/${config.id}/edit`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
                            title="Xem/Chỉnh sửa"
                          >
                            <EyeIcon className="w-3.5 h-3.5" />
                            Xem
                          </Link>
                          <Link
                            to={`/dashboard/company-configs/${config.id}/edit`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
                            title="Chỉnh sửa"
                          >
                            <PencilIcon className="w-3.5 h-3.5" />
                            Sửa
                          </Link>
                          <button
                            onClick={() => handleDeleteClick(config)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Xóa"
                            disabled={config.is_current}
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                            Xóa
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
            <div className="px-6 py-4 flex items-center justify-between border-t border-gray-100 bg-gray-50">
              <div className="flex sm:hidden gap-2">
                <button
                  onClick={() => loadConfigs(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Trang trước
                </button>
                <button
                  onClick={() => loadConfigs(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Trang sau
                </button>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">
                  Hiển thị{' '}
                  <span className="font-medium text-gray-900">{(currentPage - 1) * 20 + 1}</span>{' '}
                  đến{' '}
                  <span className="font-medium text-gray-900">
                    {Math.min(currentPage * 20, configs.length + (currentPage - 1) * 20)}
                  </span>{' '}
                  trong{' '}
                  <span className="font-medium text-gray-900">
                    {configs.length + (currentPage - 1) * 20}
                  </span>{' '}
                  kết quả
                </p>
                <nav className="inline-flex gap-1" aria-label="Phân trang">
                  <button
                    onClick={() => loadConfigs(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
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
                        onClick={() => loadConfigs(pageNum)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          currentPage === pageNum
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => loadConfigs(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    &rarr;
                  </button>
                </nav>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Cấu hình công ty</h1>
          <p className="mt-1 text-sm text-gray-900">
            Quản lý cấu hình giờ làm việc, ngày nghỉ lễ và các chính sách công ty
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Tabs */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleTabChange('company-configs')}
              className={`inline-flex items-center justify-center px-2 sm:px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                currentTab === 'company-configs'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Cấu hình công ty
            </button>
            <button
              onClick={() => handleTabChange('attendance-rules')}
              className={`inline-flex items-center justify-center px-2 sm:px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                currentTab === 'attendance-rules'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Quy tắc chấm công
            </button>
            <button
              onClick={() => handleTabChange('leave-policies')}
              className={`inline-flex items-center justify-center px-2 sm:px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                currentTab === 'leave-policies'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Chính sách nghỉ phép
            </button>
          </div>

          {currentTab === 'company-configs' && (
            <Link
              to="/dashboard/company-configs/create"
              className="btn-primary inline-flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4" />
              Thêm cấu hình mới
            </Link>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {renderTabContent()}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteModal && !!configToDelete}
        title="Xóa cấu hình công ty"
        message={
          configToDelete
            ? `Bạn có chắc chắn muốn xóa cấu hình "${configToDelete.name}" (${configToDelete.code})? Hành động này không thể hoàn tác.`
            : ''
        }
        onConfirm={handleDeleteConfirm}
        onClose={() => {
          setShowDeleteModal(false);
          setConfigToDelete(null);
        }}
      />
    </div>
  );
};

export default CompanyConfigList;
