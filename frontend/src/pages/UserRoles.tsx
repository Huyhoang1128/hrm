import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  UserIcon,
  ShieldCheckIcon,
  PlusIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { usersAPI, rolesAPI } from '../utils/api';

interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  isActive: boolean;
  roles?: Role[];
}

interface Role {
  id: string;
  name: string;
  description?: string;
  permissions?: Permission[];
}

interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
}

const UserRoles: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load user with roles
      const userData = await usersAPI.getByIdWithRoles(id!);
      setUser(userData);

      // Load available roles
      const rolesData = await rolesAPI.list();
      setAvailableRoles(rolesData || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Lỗi khi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRole = async () => {
    if (!selectedRoleId) return;

    try {
      setSaving(true);
      setError(null);

      await usersAPI.assignRole(id!, selectedRoleId);

      // Reload user data
      await loadData();

      setShowAssignModal(false);
      setSelectedRoleId('');
    } catch (err) {
      console.error('Failed to assign role:', err);
      setError('Lỗi khi gán vai trò');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    if (
      !window.confirm('Bạn có chắc chắn muốn xóa vai trò này khỏi người dùng?')
    ) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await usersAPI.removeRole(id!, roleId);

      // Reload user data
      await loadData();
    } catch (err) {
      console.error('Failed to remove role:', err);
      setError('Lỗi khi xóa vai trò');
    } finally {
      setSaving(false);
    }
  };

  const getRoleBadgeColor = (roleName: string) => {
    const colors: { [key: string]: string } = {
      ADMIN: 'bg-red-100 text-red-800',
      USER: 'bg-blue-100 text-blue-800',
      MODERATOR: 'bg-yellow-100 text-yellow-800',
      EDITOR: 'bg-green-100 text-green-800',
    };
    return colors[roleName] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="bg-white rounded-lg shadow p-6">
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

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Không tìm thấy người dùng
            </h2>
            <p className="text-gray-600 mb-6">
              Người dùng bạn đang tìm kiếm không tồn tại.
            </p>
            <button
              onClick={() => navigate('/dashboard/users')}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Quay lại danh sách
            </button>
          </div>
        </div>
      </div>
    );
  }

  const assignedRoleIds = user.roles?.map((role) => role.id) || [];
  const unassignedRoles = availableRoles.filter(
    (role) => !assignedRoleIds.includes(role.id)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(`/dashboard/users/${id}`)}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Quay lại
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Quản lý vai trò
                </h1>
                <p className="mt-2 text-gray-600">
                  Quản lý vai trò cho {user.username}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAssignModal(true)}
              disabled={unassignedRoles.length === 0}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Gán vai trò
            </button>
          </div>
        </div>

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

        {/* User Info */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <UserIcon className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.username}
                </h3>
                <p className="text-sm text-gray-600">{user.email}</p>
                <div className="flex items-center space-x-2 mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}
                  >
                    {user.role}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                  >
                    {user.isActive ? 'Hoạt động' : 'Không hoạt động'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Assigned Roles */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Vai trò đã gán
            </h3>

            {user.roles && user.roles.length > 0 ? (
              <div className="space-y-4">
                {user.roles.map((role) => (
                  <div
                    key={role.id}
                    className="border border-gray-200 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                        <div>
                          <h4 className="text-sm font-medium text-gray-900">
                            {role.name}
                          </h4>
                          {role.description && (
                            <p className="text-sm text-gray-600">
                              {role.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveRole(role.id)}
                        disabled={saving}
                        className="inline-flex items-center px-3 py-1 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
                      >
                        <XMarkIcon className="h-4 w-4 mr-1" />
                        Xóa
                      </button>
                    </div>

                    {/* Permissions */}
                    {role.permissions && role.permissions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <h5 className="text-xs font-medium text-gray-700 mb-2">
                          Quyền hạn:
                        </h5>
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.map((permission) => (
                            <span
                              key={permission.id}
                              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                            >
                              {permission.resource}:{permission.action}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <ShieldCheckIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Chưa có vai trò nào
                </h3>
                <p className="text-gray-600 mb-4">
                  Người dùng này chưa được gán vai trò nào. Hãy gán vai trò để
                  cấp quyền truy cập.
                </p>
                <button
                  onClick={() => setShowAssignModal(true)}
                  disabled={unassignedRoles.length === 0}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  Gán vai trò đầu tiên
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Assign Role Modal */}
        {showAssignModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-4 sm:mx-auto p-6 border w-full max-w-sm shadow-lg rounded-md bg-white">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Gán vai trò
                </h3>
                <button
                  onClick={() => {
                    setShowAssignModal(false);
                    setSelectedRoleId('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Chọn vai trò
                  </label>
                  <select
                    value={selectedRoleId}
                    onChange={(e) => setSelectedRoleId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Chọn vai trò...</option>
                    {unassignedRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>

                {error && <div className="text-sm text-red-600">{error}</div>}

                <div className="flex space-x-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAssignModal(false);
                      setSelectedRoleId('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleAssignRole}
                    disabled={!selectedRoleId || saving}
                    className="flex-1 px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Đang gán...
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon className="h-4 w-4 mr-2" />
                        Gán vai trò
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserRoles;
