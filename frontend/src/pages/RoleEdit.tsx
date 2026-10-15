import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { rolesAPI, permissionsAPI, Permission, Role } from '../utils/api';

// Interface for updating role with permissions
interface UpdateRoleData {
  name?: string;
  description?: string;
  isSystem?: boolean;
  permissions?: string[];
}

const RoleEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isSystem: false,
    permissions: [] as string[],
  });

  // Validation state
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const loadData = async () => {
    try {
      setInitialLoading(true);
      setError(null);

      // Load role data and permissions in parallel
      const [roleData, permissionsData] = await Promise.all([
        rolesAPI.getById(id!),
        permissionsAPI.list(),
      ]);

      setRole(roleData);
      setPermissions(permissionsData);

      // Populate form with role data
      setFormData({
        name: roleData.name,
        description: roleData.description || '',
        isSystem: roleData.isSystem,
        permissions:
          roleData.rolePermissions?.map((rp) => rp.permission.id) || [],
      });
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Lỗi khi tải dữ liệu');
    } finally {
      setInitialLoading(false);
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = 'Tên vai trò là bắt buộc';
    } else if (formData.name.length < 2) {
      newErrors.name = 'Tên vai trò phải có ít nhất 2 ký tự';
    } else if (formData.name.length > 100) {
      newErrors.name = 'Tên vai trò không được vượt quá 100 ký tự';
    }

    // Description validation
    if (formData.description && formData.description.length > 500) {
      newErrors.description = 'Mô tả không được vượt quá 500 ký tự';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  const handlePermissionChange = (permissionId: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      permissions: checked
        ? [...prev.permissions, permissionId]
        : prev.permissions.filter((id) => id !== permissionId),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const updateData: UpdateRoleData = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        isSystem: formData.isSystem,
        permissions: formData.permissions,
      };

      await rolesAPI.update(id!, updateData);

      setSuccess('Cập nhật vai trò thành công!');

      // Redirect to role list after 2 seconds
      setTimeout(() => {
        navigate('/dashboard/roles');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to update role:', err);
      setError(
        err.response?.data?.message ||
          'Lỗi khi cập nhật vai trò. Vui lòng thử lại.'
      );
    } finally {
      setLoading(false);
    }
  };

  const groupPermissionsByResource = (permissions: Permission[]) => {
    const grouped: { [key: string]: Permission[] } = {};

    permissions.forEach((permission) => {
      if (!grouped[permission.resource]) {
        grouped[permission.resource] = [];
      }
      grouped[permission.resource].push(permission);
    });

    return grouped;
  };

  const getResourceDisplayName = (resource: string) => {
    const resourceMap: { [key: string]: string } = {
      user: 'Quản lý người dùng',
      chatbot: 'Quản lý chatbot',
      conversation: 'Quản lý cuộc trò chuyện',
      document: 'Quản lý tài liệu',
      bot_permission: 'Quản lý quyền bot',
      role: 'Quản lý vai trò',
      permission: 'Quản lý quyền hạn',
      dashboard: 'Bảng điều khiển',
      media: 'Quản lý media',
      facebook: 'Tích hợp Facebook',
      api_key: 'Quản lý API key',
      domain: 'Quản lý domain',
    };
    return resourceMap[resource] || resource;
  };

  const getActionDisplayName = (action: string) => {
    const actionMap: { [key: string]: string } = {
      create: 'Tạo',
      read: 'Xem',
      update: 'Sửa',
      delete: 'Xóa',
      list: 'Danh sách',
      assign_role: 'Gán vai trò',
      remove_role: 'Gỡ vai trò',
      send_message: 'Gửi tin nhắn',
      toggle_status: 'Bật/tắt',
      bulk_delete: 'Xóa hàng loạt',
      add_message: 'Thêm tin nhắn',
      upload: 'Tải lên',
      process: 'Xử lý',
      assign: 'Gán',
      revoke: 'Thu hồi',
      assign_permission: 'Gán quyền',
      remove_permission: 'Gỡ quyền',
      statistics: 'Thống kê',
      connect: 'Kết nối',
      disconnect: 'Ngắt kết nối',
      manage_pages: 'Quản lý trang',
      assign_document: 'Gán tài liệu',
      remove_document: 'Gỡ tài liệu',
    };
    return actionMap[action] || action;
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Không tìm thấy vai trò
          </h2>
          <p className="text-gray-600 mb-4">
            Vai trò bạn đang tìm kiếm không tồn tại hoặc đã bị xóa.
          </p>
          <button
            onClick={() => navigate('/dashboard/roles')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Quay lại danh sách
          </button>
        </div>
      </div>
    );
  }

  const groupedPermissions = groupPermissionsByResource(permissions);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/dashboard/roles')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Quay lại
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Chỉnh sửa vai trò
              </h1>
              <p className="mt-2 text-gray-600">
                Cập nhật thông tin và quyền hạn cho vai trò "{role.name}"
              </p>
            </div>
          </div>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex">
              <CheckCircleIcon className="h-5 w-5 text-green-400 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-green-800">
                  Thành công
                </h3>
                <p className="text-sm text-green-700 mt-1">{success}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-red-800">Lỗi</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Information */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">
                Thông tin cơ bản
              </h2>
            </div>
            <div className="px-6 py-4 space-y-6">
              {/* Role Name */}
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Tên vai trò *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm ${
                    errors.name ? 'border-red-300' : ''
                  }`}
                  placeholder="Nhập tên vai trò"
                  disabled={role.isSystem}
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                )}
                {role.isSystem && (
                  <p className="mt-1 text-sm text-gray-500">
                    Không thể chỉnh sửa tên vai trò hệ thống
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-gray-700"
                >
                  Mô tả
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleInputChange}
                  className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm ${
                    errors.description ? 'border-red-300' : ''
                  }`}
                  placeholder="Nhập mô tả vai trò"
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.description}
                  </p>
                )}
              </div>

              {/* System Role */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isSystem"
                  name="isSystem"
                  checked={formData.isSystem}
                  onChange={handleInputChange}
                  disabled={role.isSystem}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label
                  htmlFor="isSystem"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Vai trò hệ thống
                </label>
                {role.isSystem && (
                  <p className="ml-2 text-sm text-gray-500">
                    (Không thể thay đổi)
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Permissions */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center">
                <ShieldCheckIcon className="h-5 w-5 text-gray-400 mr-2" />
                <h2 className="text-lg font-medium text-gray-900">Quyền hạn</h2>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Chọn các quyền hạn cho vai trò này
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="space-y-6">
                {Object.entries(groupedPermissions).map(
                  ([resource, resourcePermissions]) => (
                    <div key={resource}>
                      <h3 className="text-sm font-medium text-gray-900 mb-3">
                        {getResourceDisplayName(resource)}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {resourcePermissions.map((permission) => (
                          <label
                            key={permission.id}
                            className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.permissions.includes(
                                permission.id
                              )}
                              onChange={(e) =>
                                handlePermissionChange(
                                  permission.id,
                                  e.target.checked
                                )
                              }
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">
                                {getActionDisplayName(permission.action)}
                              </div>
                              {permission.description && (
                                <div className="text-xs text-gray-500">
                                  {permission.description}
                                </div>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => navigate('/dashboard/roles')}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Đang cập nhật...
                </>
              ) : (
                'Cập nhật vai trò'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RoleEdit;
