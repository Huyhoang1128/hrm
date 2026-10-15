import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  employeePermissionService,
  EmployeePermission,
  EmployeePermissionStats,
} from '../services/employee-permission.service';
import { employeesAPI } from '../utils/api';

const EmployeePermissionList: React.FC = () => {
  const navigate = useNavigate();
  const [permissions, setPermissions] = useState<EmployeePermission[]>([]);
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

  const fetchPermissions = async (
    search = '',
    department = 'all',
    permission = 'all'
  ) => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (department !== 'all') params.department_id = department;
      if (permission !== 'all') params[permission] = true;

      const response = await employeePermissionService.getEmployeePermissions(
        params
      );
      setPermissions(response.results);
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
    } catch (err) {
      console.error('Error fetching permission stats:', err);
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

  // Debounced search
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      fetchPermissions(searchTerm, departmentFilter, permissionFilter);
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

  const handleDelete = async (id: number) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa phân quyền này?')) {
      try {
        await employeePermissionService.deleteEmployeePermission(id);
        fetchPermissions();
        fetchStats();
      } catch (err: any) {
        alert('Xóa thất bại: ' + (err.message || 'Lỗi không xác định'));
      }
    }
  };

  const getBadge = (hasPermission: boolean) => {
    return hasPermission ? (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
        Có quyền
      </span>
    ) : (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
        Không có quyền
      </span>
    );
  };

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

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Quản lý phân quyền nhân viên
        </h1>
        <p className="text-gray-600 mt-2">
          Quản lý quyền hạn của nhân viên: phê duyệt công, tạo nhân viên,
          quản lý chấm công, quản lý tài sản, v.v.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 flex flex-col flex-1 min-h-0">
        {/* Statistics */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Thống kê phân quyền
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-medium text-blue-900 text-sm">
                Tổng số nhân viên
              </h3>
              <p className="text-2xl font-bold text-blue-700 mt-1">
                {stats.total}
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-medium text-green-900 text-sm">
                Có phân quyền
              </h3>
              <p className="text-2xl font-bold text-green-700 mt-1">
                {stats.employees_with_permissions}
              </p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <h3 className="font-medium text-yellow-900 text-sm">
                Chưa có phân quyền
              </h3>
              <p className="text-2xl font-bold text-yellow-700 mt-1">
                {stats.employees_without_permissions}
              </p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-medium text-purple-900 text-sm">
                Phòng ban có phân quyền
              </h3>
              <p className="text-2xl font-bold text-purple-700 mt-1">
                {stats.department_stats.length}
              </p>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="mb-6 bg-gray-50 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Tìm kiếm phân quyền
            </h3>
            {loading && (
              <div className="flex items-center text-sm text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Đang tìm kiếm...
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tìm kiếm theo mã, tên nhân viên
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Nhập mã NV, tên nhân viên..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  Tìm kiếm tự động khi bạn gõ
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phòng ban
                </label>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Tất cả phòng ban</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Loại quyền
                </label>
                <select
                  value={permissionFilter}
                  onChange={(e) => setPermissionFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {permissionOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          </div>
        </div>

        {/* Header + Add button */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Danh sách phân quyền
            </h2>
            <p className="text-gray-500 text-sm">
              Tổng số: {permissions.length} phân quyền
            </p>
          </div>
          <div className="flex space-x-2">
            <button
              className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 transition-colors"
              onClick={() => navigate('/dashboard/roles/create')}
            >
              + Thêm phân quyền
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Đang tải dữ liệu...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-600 mb-4">
              <svg
                className="w-12 h-12 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900">
              Đã xảy ra lỗi
            </p>
            <p className="text-gray-500 mt-1">{error}</p>
            <button
              onClick={() => fetchPermissions()}
              className="mt-4 bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 transition-colors"
            >
              Thử lại
            </button>
          </div>
        ) : permissions.length === 0 ? (
          <div className="border rounded-lg overflow-hidden flex-1">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mã NV
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Họ tên
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phòng ban
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phê duyệt công
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tạo nhân viên
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quản lý chấm công
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quản lý tài sản
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center">
                      <svg
                        className="w-12 h-12 text-gray-400 mb-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                      <p className="text-lg font-medium text-gray-900">
                        Chưa có phân quyền nào
                      </p>
                      <p className="text-gray-500 mt-1">
                        Bắt đầu bằng cách thêm phân quyền mới
                      </p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden flex-1">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mã NV
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Họ tên
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phòng ban
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phê duyệt công
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tạo nhân viên
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quản lý chấm công
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quản lý tài sản
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {permissions.map((perm) => {
                  // Handle case where employee might be just an ID or might not have nested structure
                  const employeeId = typeof perm.employee === 'object' ? perm.employee?.employee_id : 'N/A';
                  const employeeName = typeof perm.employee === 'object' ? perm.employee?.full_name : 'N/A';
                  const departmentName = typeof perm.employee === 'object' ? perm.employee?.department?.name : 'N/A';
                  
                  return (
                    <tr key={perm.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {employeeId || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {employeeName || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {departmentName || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getBadge(perm.can_approve_attendance)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getBadge(perm.can_create_employee)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getBadge(perm.can_manage_attendance)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getBadge(perm.can_manage_assets)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-1">
                          <button
                            onClick={() => navigate(`/dashboard/roles/${perm.id}`)}
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Xem"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => navigate(`/dashboard/roles/${perm.id}/edit`)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                            title="Sửa"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(perm.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="Xóa"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default EmployeePermissionList;
