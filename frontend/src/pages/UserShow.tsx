import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  UserIcon,
  EnvelopeIcon,
  PhoneIcon,
  CalendarIcon,
  ShieldCheckIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { usersAPI, User, Permission } from '../utils/api';

const UserShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadUser();
    }
  }, [id]);

  const loadUser = async () => {
    try {
      setLoading(true);
      setError(null);

      const userData = await usersAPI.getByIdWithRoles(id!);
      setUser(userData);
    } catch (err) {
      console.error('Failed to load user:', err);
      setError('Lỗi khi tải thông tin người dùng');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !window.confirm('Bạn có chắc chắn muốn xóa người dùng này?')) {
      return;
    }

    try {
      await usersAPI.delete(user.id);
      navigate('/dashboard/users');
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError('Lỗi khi xóa người dùng');
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

  if (error || !user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-red-800">Lỗi</h3>
                <p className="text-sm text-red-700 mt-1">
                  {error || 'Không tìm thấy người dùng'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/dashboard/users')}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Quay lại
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Chi tiết người dùng
                </h1>
                <p className="mt-2 text-gray-600">
                  Thông tin chi tiết và quyền hạn của người dùng
                </p>
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-3">
              <button
                onClick={() => navigate(`/dashboard/users/${user.id}/edit`)}
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
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* User Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Thông tin cơ bản
              </h3>
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="h-16 w-16 rounded-full bg-gray-300 flex items-center justify-center">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.username}
                        className="h-16 w-16 rounded-full object-cover"
                      />
                    ) : (
                      <UserIcon className="h-8 w-8 text-gray-600" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-xl font-semibold text-gray-900">
                      {user.firstName && user.lastName
                        ? `${user.firstName} ${user.lastName}`
                        : user.username}
                    </h4>
                    <p className="text-gray-600">@{user.username}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center space-x-3">
                    <EnvelopeIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Email</p>
                      <p className="text-sm text-gray-600">{user.email}</p>
                    </div>
                  </div>

                  {user.phone && (
                    <div className="flex items-center space-x-3">
                      <PhoneIcon className="h-5 w-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          Số điện thoại
                        </p>
                        <p className="text-sm text-gray-600">{user.phone}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center space-x-3">
                    <CalendarIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Ngày tạo
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(user.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <ClockIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Đăng nhập cuối
                      </p>
                      <p className="text-sm text-gray-600">
                        {user.lastLoginAt
                          ? formatDate(user.lastLoginAt)
                          : 'Chưa đăng nhập'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      user.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {user.isActive ? (
                      <>
                        <CheckCircleIcon className="h-3 w-3 mr-1" />
                        Hoạt động
                      </>
                    ) : (
                      <>
                        <XCircleIcon className="h-3 w-3 mr-1" />
                        Không hoạt động
                      </>
                    )}
                  </span>

                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {getRoleDisplayName(user.role)}
                  </span>

                  {user.emailVerified && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Email đã xác thực
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Roles */}
            {user.userRoles && user.userRoles.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Vai trò
                </h3>
                <div className="space-y-3">
                  {user.userRoles.map((userRole) => (
                    <div
                      key={userRole.roleId}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <h4 className="font-medium text-gray-900">
                          {getRoleDisplayName(userRole.role.name)}
                        </h4>
                        {userRole.role.description && (
                          <p className="text-sm text-gray-600">
                            {userRole.role.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          Được gán vào {formatDate(userRole.assignedAt)}
                        </p>
                      </div>
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {userRole.role.isSystem ? 'Hệ thống' : 'Tùy chỉnh'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Permissions */}
            {user.permissions && user.permissions.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Quyền hạn
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {user.permissions.map((permission) => (
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
                    Số lần đăng nhập
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {user.loginCount}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Số vai trò
                  </p>
                  <p className="text-2xl font-bold text-green-600">
                    {user.userRoles ? user.userRoles.length : 0}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Số quyền</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {user.permissions ? user.permissions.length : 0}
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
                <button
                  onClick={() => navigate(`/dashboard/users/${user.id}/edit`)}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <PencilIcon className="h-4 w-4 mr-2" />
                  Chỉnh sửa thông tin
                </button>
                <button
                  onClick={() => navigate(`/dashboard/users/${user.id}/roles`)}
                  className="w-full flex items-center justify-center px-4 py-2 border border-blue-300 rounded-lg text-sm font-medium text-blue-700 bg-white hover:bg-blue-50"
                >
                  <ShieldCheckIcon className="h-4 w-4 mr-2" />
                  Quản lý vai trò
                </button>
                <button
                  onClick={() => navigate(`/dashboard/users/${user.id}/activity`)}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <ClockIcon className="h-4 w-4 mr-2" />
                  Xem hoạt động
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserShow;
