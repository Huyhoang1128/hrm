import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheckIcon,
  UsersIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
  EyeIcon,
  PencilSquareIcon,
  TrashIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import {
  employeePermissionService,
  EmployeePermission,
  EmployeePermissionStats,
} from '../services/employee-permission.service';
import { employeesAPI } from '../utils/api';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import Pagination from '../components/Pagination';

const PAGE_SIZE = 20;

const RoleList: React.FC = () => {
  const navigate = useNavigate();
  const [permissions, setPermissions] = useState<EmployeePermission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<EmployeePermissionStats>({
    total: 0,
    employees_with_permissions: 0,
    employees_without_permissions: 0,
    permission_stats: {},
    department_stats: [],
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [permissionFilter, setPermissionFilter] = useState<string>('all');
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchPermissions = async (
    search = '',
    department = 'all',
    permission = 'all',
    pageNumber = 1
  ) => {
    try {
      setLoading(true);
      const params: any = { page: pageNumber, page_size: PAGE_SIZE };
      if (search) params.search = search;
      if (department !== 'all') params.department_id = department;
      if (permission !== 'all') params[permission] = true;

      const response = await employeePermissionService.getEmployeePermissions(
        params
      );
      setPermissions(response.results);
      setTotal(response.count);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách phân quyền');
      console.error('Error fetching permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const statsData = await employeePermissionService.getPermissionStats();
      setStats(statsData);
    } catch (err: any) {
      console.error('Error fetching permission stats:', err);
      setStats({
        total: 0,
        employees_with_permissions: 0,
        employees_without_permissions: 0,
        permission_stats: {},
        department_stats: [],
      });
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await employeesAPI.list({ page_size: 100 });
      const deptSet = new Set();
      const deptList: any[] = [];

      response.results.forEach((employee: any) => {
        if (employee.department && !deptSet.has(employee.department.id)) {
          deptSet.add(employee.department.id);
          deptList.push(employee.department);
        }
      });

      setDepartments(deptList);
    } catch (err) {
      console.error('Error fetching departments:', err);
    }
  };

  useEffect(() => {
    fetchPermissions();
    fetchStats();
    fetchDepartments();
  }, []);

  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      setPage(1);
      fetchPermissions(searchTerm, departmentFilter, permissionFilter, 1);
    }, 300);
    setSearchTimeout(timeout);

    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTerm, departmentFilter, permissionFilter]);

  const handleReset = () => {
    setSearchTerm('');
    setDepartmentFilter('all');
    setPermissionFilter('all');
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    fetchPermissions(searchTerm, departmentFilter, permissionFilter, nextPage);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa phân quyền này?')) {
      try {
        await employeePermissionService.deleteEmployeePermission(id);
        fetchPermissions(searchTerm, departmentFilter, permissionFilter, page);
        fetchStats();
      } catch (err: any) {
        alert('Xóa thất bại: ' + (err.message || 'Lỗi không xác định'));
      }
    }
  };

  const getBadge = (hasPermission: boolean) => (
    hasPermission ? (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-600">Có quyền</span>
    ) : (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">Không có</span>
    )
  );

  const permissionOptions = [
    { value: 'all', label: 'Tất cả quyền' },
    { value: 'can_approve_attendance', label: 'Phê duyệt công' },
    { value: 'can_create_employee', label: 'Tạo nhân viên' },
    { value: 'can_manage_attendance', label: 'Quản lý chấm công' },
    { value: 'can_manage_assets', label: 'Quản lý tài sản' },
    { value: 'can_approve_leave', label: 'Phê duyệt nghỉ phép' },
    { value: 'can_approve_overtime', label: 'Phê duyệt OT' },
    { value: 'can_view_all_employees', label: 'Xem tất cả NV' },
    { value: 'can_manage_departments', label: 'Quản lý phòng ban' },
    { value: 'can_manage_positions', label: 'Quản lý chức vụ' },
    { value: 'can_manage_company_config', label: 'Quản lý cấu hình' },
    { value: 'can_manage_attendance_rules', label: 'Quản lý quy tắc công' },
    { value: 'can_manage_leave_policies', label: 'Quản lý chính sách nghỉ' },
    { value: 'can_view_reports', label: 'Xem báo cáo' },
    { value: 'can_export_reports', label: 'Xuất báo cáo' },
    { value: 'can_manage_disciplinary_penalties', label: 'Quản lý phạt biên bản' },
  ];

  const tableHeaders = [
    'Nhân viên', 'Phòng ban / Chức vụ', 'Quyền đã cấp', 'Trạng thái', 'Thao tác',
  ];

  const getPermissionChips = (summary?: string) => {
    if (!summary || summary === 'Không có quyền đặc biệt') return [];
    return summary.split(',').map((s) => s.trim()).filter(Boolean);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
            Quản lý phân quyền nhân viên
          </h1>
          <p className="text-sm text-gray-900 mt-0.5">
            Quản lý quyền hạn: phê duyệt công, tạo nhân viên, chấm công, tài sản, v.v.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-6">
        {/* Statistics */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <ShieldCheckIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Thống kê phân quyền</h2>
              <p className="text-xs text-gray-400">Tổng quan trạng thái phân quyền</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-primary-500 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                  <UsersIcon className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Tổng nhân viên</p>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.total}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-emerald-500 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                  <ShieldCheckIcon className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Có phân quyền</p>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.employees_with_permissions}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-amber-500 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-9 w-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
                  <UserGroupIcon className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Chưa phân quyền</p>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.employees_without_permissions}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-violet-500 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-9 w-9 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center">
                  <BuildingOfficeIcon className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Phòng ban</p>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.department_stats.length}</p>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm phân quyền</h3>
            {loading && (
              <div className="flex items-center text-xs text-gray-500 gap-1.5">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                Đang tìm kiếm...
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tìm kiếm theo mã, tên nhân viên
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field"
                placeholder="Nhập mã NV, tên nhân viên..."
              />
            </div>
            <div>
              <SelectBox<string>
                label="Phòng ban"
                value={departmentFilter}
                options={[
                  { value: 'all', label: 'Tất cả phòng ban' },
                  ...departments.map((dept) => ({ value: String(dept.id), label: dept.name })),
                ]}
                onChange={setDepartmentFilter}
              />
            </div>
            <div>
              <SelectBox<string>
                label="Loại quyền"
                value={permissionFilter}
                options={permissionOptions}
                onChange={setPermissionFilter}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleReset}
                className="btn-secondary w-full"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          </div>
        </div>

        {/* Header + Add button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách phân quyền</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tổng số: {total} phân quyền</p>
          </div>
          <button
            className="btn-primary"
            onClick={() => navigate('/dashboard/roles/create')}
          >
            + Thêm phân quyền
          </button>
        </div>

        {/* Content — bố cục theo phong cách trang Quản lý BHXH */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {error ? (
            <div className="p-8 text-center">
              <div className="mx-auto h-10 w-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mb-3">
                <ExclamationCircleIcon className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-gray-900">Không tải được dữ liệu</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
              <button
                onClick={() => fetchPermissions(searchTerm, departmentFilter, permissionFilter, page)}
                className="btn-primary mt-4"
              >
                Thử lại
              </button>
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mb-2"></div>
              <p>Đang tải danh sách...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      {tableHeaders.map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {permissions.length === 0 ? (
                      <tr>
                        <td colSpan={tableHeaders.length} className="px-4 py-10 text-center text-sm text-gray-500">
                          <div className="flex flex-col items-center gap-2">
                            <ShieldCheckIcon className="w-8 h-8 text-gray-300" />
                            Chưa có phân quyền nào
                          </div>
                        </td>
                      </tr>
                    ) : (
                      permissions.map((perm: any) => {
                        const employeeCode = perm.employee_code || perm.employee?.employee_id || '-';
                        const employeeName = perm.employee_name || perm.employee?.full_name || '-';
                        const departmentName = perm.department_name || perm.employee?.department?.name;
                        const positionTitle = perm.position_title || perm.employee?.position?.title;
                        const chips = getPermissionChips(perm.permission_summary);
                        const visibleChips = chips.slice(0, 3);
                        const extraCount = chips.length - visibleChips.length;

                        return (
                          <tr key={perm.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 flex-shrink-0 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-bold">
                                  {employeeName !== '-' ? employeeName.charAt(0).toUpperCase() : '?'}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{employeeName}</p>
                                  <p className="text-xs text-gray-500">{employeeCode}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {departmentName || '—'}
                              {positionTitle && <p className="text-xs text-gray-500 mt-0.5">{positionTitle}</p>}
                            </td>
                            <td className="px-4 py-3 max-w-xs">
                              {visibleChips.length === 0 ? (
                                <span className="text-xs text-gray-400">Chưa có quyền nào</span>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {visibleChips.map((chip) => (
                                    <span
                                      key={chip}
                                      className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-primary-50 text-primary-700"
                                    >
                                      {chip}
                                    </span>
                                  ))}
                                  {extraCount > 0 && (
                                    <span
                                      title={chips.slice(3).join(', ')}
                                      className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-100 text-gray-500"
                                    >
                                      +{extraCount}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {getBadge(perm.has_any_permission)}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => navigate(`/dashboard/employee-permissions/${perm.id}`)}
                                  className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                  title="Xem"
                                >
                                  <EyeIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => navigate(`/dashboard/employee-permissions/${perm.id}/edit`)}
                                  className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                  title="Sửa"
                                >
                                  <PencilSquareIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(perm.id)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Xóa"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="p-4 border-t border-gray-100">
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalItems={total}
                    itemsPerPage={PAGE_SIZE}
                    onPageChange={handlePageChange}
                    showItemsPerPage={false}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RoleList;
