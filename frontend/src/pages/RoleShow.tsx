import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  CalendarIcon,
  UserGroupIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { rolesAPI, Role, Permission } from '../utils/api';

const RoleShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadRole();
    }
  }, [id]);

  const loadRole = async () => {
    try {
      setLoading(true);
      setError(null);

      const roleData = await rolesAPI.getById(id!);
      setRole(roleData);
    } catch (err) {
      console.error('Failed to load role:', err);
      setError('Lỗi khi tải thông tin vai trò');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (
      !role ||
      !window.confirm(`Bạn có chắc chắn muốn xóa vai trò "${role.name}"?`)
    ) {
      return;
    }

    try {
      await rolesAPI.delete(role.id);
      navigate('/dashboard/roles');
    } catch (err) {
      console.error('Failed to delete role:', err);
      setError('Lỗi khi xóa vai trò');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRoleDisplayName = (roleName: string) => {
    const roleMap: { [key: string]: string } = {
      'Super Admin': 'Siêu quản trị',
      Admin: 'Quản trị viên',
      Manager: 'Quản lý',
      User: 'Người dùng',
    };
    return roleMap[roleName] || roleName;
  };

  const getPermissionDisplayName = (permission: Permission) => {
    const resourceMap: { [key: string]: string } = {
      user: 'Người dùng',
      role: 'Vai trò',
      chatbot: 'Chatbot',
      document: 'Tài liệu',
      conversation: 'Cuộc hội thoại',
      apikey: 'API Key',
      facebook: 'Facebook',
      dashboard: 'Dashboard',
      analytics: 'Phân tích',
      system: 'Hệ thống',
    };

    const actionMap: { [key: string]: string } = {
      read: 'Xem',
      create: 'Tạo',
      update: 'Cập nhật',
      delete: 'Xóa',
      manage: 'Quản lý',
    };

    const resource = resourceMap[permission.resource] || permission.resource;
    const action = actionMap[permission.action] || permission.action;

    return `${action} ${resource}`;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="space-y-4">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !role) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-red-800">Lỗi</h3>
                <p className="text-sm text-red-700 mt-1">
                  {error || 'Không tìm thấy vai trò'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const permissions = role.rolePermissions?.map((rp) => rp.permission) || [];
  const groupedPermissions = groupPermissionsByResource(permissions);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/dashboard/roles')}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Quay lại
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Chi tiết vai trò
                </h1>
                <p className="mt-2 text-gray-600">
                  Thông tin chi tiết và quyền hạn của vai trò
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {!role.isSystem && (
                <>
                  <button
                    onClick={() => navigate(`/dashboard/roles/${role.id}/edit`)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <PencilIcon className="h-4 w-4 mr-2" />
                    Chỉnh sửa
                  </button>
                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center px-4 py-2 border border-red-300 rounded-lg text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                  >
                    <TrashIcon className="h-4 w-4 mr-2" />
                    Xóa
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Role Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Thông tin cơ bản
              </h3>
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                    <ShieldCheckIcon className="h-8 w-8 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-xl font-semibold text-gray-900">
                      {getRoleDisplayName(role.name)}
                    </h4>
                    <div className="flex items-center space-x-2 mt-1">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          role.isSystem
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {role.isSystem ? (
                          <>
                            <CheckCircleIcon className="h-3 w-3 mr-1" />
                            Hệ thống
                          </>
                        ) : (
                          <>
                            <XCircleIcon className="h-3 w-3 mr-1" />
                            Tùy chỉnh
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {role.description && (
                  <div>
                    <p className="text-sm font-medium text-gray-900 mb-1">
                      Mô tả
                    </p>
                    <p className="text-sm text-gray-600">{role.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center space-x-3">
                    <CalendarIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Ngày tạo
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(role.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <UserGroupIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Số quyền
                      </p>
                      <p className="text-sm text-gray-600">
                        {permissions.length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Permissions */}
            {permissions.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Quyền hạn
                </h3>
                <div className="space-y-6">
                  {Object.entries(groupedPermissions).map(
                    ([resource, resourcePermissions]) => (
                      <div
                        key={resource}
                        className="border-b border-gray-200 pb-4 last:border-b-0"
                      >
                        <h4 className="text-sm font-semibold text-gray-900 mb-3 capitalize">
                          {resource === 'user'
                            ? 'Người dùng'
                            : resource === 'role'
                              ? 'Vai trò'
                              : resource === 'chatbot'
                                ? 'Chatbot'
                                : resource === 'document'
                                  ? 'Tài liệu'
                                  : resource === 'conversation'
                                    ? 'Cuộc hội thoại'
                                    : resource === 'apikey'
                                      ? 'API Key'
                                      : resource === 'facebook'
                                        ? 'Facebook'
                                        : resource === 'dashboard'
                                          ? 'Dashboard'
                                          : resource === 'analytics'
                                            ? 'Phân tích'
                                            : resource === 'system'
                                              ? 'Hệ thống'
                                              : resource}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {resourcePermissions.map((permission) => (
                            <div
                              key={permission.id}
                              className="flex items-center space-x-2 p-2 bg-gray-50 rounded"
                            >
                              <ShieldCheckIcon className="h-4 w-4 text-green-500" />
                              <span className="text-sm text-gray-700">
                                {getPermissionDisplayName(permission)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Statistics */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Thống kê
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Tổng số quyền
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {permissions.length}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Số nhóm quyền
                  </p>
                  <p className="text-2xl font-bold text-green-600">
                    {Object.keys(groupedPermissions).length}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Loại vai trò
                  </p>
                  <p className="text-2xl font-bold text-purple-600">
                    {role.isSystem ? 'Hệ thống' : 'Tùy chỉnh'}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Thao tác nhanh
              </h3>
              <div className="space-y-3">
                {!role.isSystem && (
                  <button
                    onClick={() => navigate(`/dashboard/roles/${role.id}/edit`)}
                    className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <PencilIcon className="h-4 w-4 mr-2" />
                    Chỉnh sửa vai trò
                  </button>
                )}
                <button
                  onClick={() => navigate('/dashboard/roles')}
                  className="w-full flex items-center justify-center px-4 py-2 border border-blue-300 rounded-lg text-sm font-medium text-blue-700 bg-white hover:bg-blue-50"
                >
                  <ShieldCheckIcon className="h-4 w-4 mr-2" />
                  Xem tất cả vai trò
                </button>
              </div>
            </div>

            {/* Warning for System Role */}
            {role.isSystem && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex">
                  <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400 mr-3" />
                  <div>
                    <h3 className="text-sm font-medium text-yellow-800">
                      Vai trò hệ thống
                    </h3>
                    <p className="text-sm text-yellow-700 mt-1">
                      Vai trò này được tạo bởi hệ thống và không thể chỉnh sửa
                      hoặc xóa.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoleShow;
