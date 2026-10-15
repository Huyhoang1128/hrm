import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  UserGroupIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { botPermissionsAPI, chatbotsAPI, usersAPI } from '@/utils/api';
import { BotPermission, Chatbot, User } from '@/utils/api';
import Pagination from '@/components/Pagination';

export default function BotPermissions() {
  const [permissions, setPermissions] = useState<BotPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Filter state
  const [filters, setFilters] = useState({
    search: '',
    userId: '',
    chatbotId: '',
    permission: '',
    isActive: '',
  });

  // Options
  const [users, setUsers] = useState<User[]>([]);
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);

  useEffect(() => {
    fetchPermissions();
    fetchOptions();
  }, [currentPage, itemsPerPage, filters]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);
      const params: any = {
        page: currentPage,
        limit: itemsPerPage,
      };

      // Apply filters
      if (filters.userId) params.userId = filters.userId;
      if (filters.chatbotId) params.chatbotId = filters.chatbotId;
      if (filters.permission) params.permission = filters.permission;
      if (filters.isActive !== '')
        params.isActive = filters.isActive === 'true';

      const response = await botPermissionsAPI.list(params);
      setPermissions(response.permissions);
      setTotalPages(response.totalPages);
      setTotalItems(response.total);
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
      setError('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  };

  const fetchOptions = async () => {
    try {
      const [usersResponse, chatbotsResponse] = await Promise.all([
        usersAPI.list(),
        chatbotsAPI.list(),
      ]);
      setUsers(usersResponse.users);
      setChatbots(chatbotsResponse.chatbots);
    } catch (error) {
      console.error('Failed to fetch options:', error);
    }
  };

  const handleDelete = async (permissionId: string) => {
    if (!confirm('Are you sure you want to delete this permission?')) {
      return;
    }

    try {
      await botPermissionsAPI.delete(permissionId);
      fetchPermissions();
    } catch (error) {
      console.error('Failed to delete permission:', error);
      setError('Failed to delete permission');
    }
  };

  const getPermissionBadge = (permission: string) => {
    const baseClasses =
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    switch (permission) {
      case 'read':
        return `${baseClasses} bg-blue-100 text-blue-800`;
      case 'write':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'admin':
        return `${baseClasses} bg-red-100 text-red-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  const getStatusBadge = (isActive: boolean) => {
    const baseClasses =
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    return isActive
      ? `${baseClasses} bg-green-100 text-green-800`
      : `${baseClasses} bg-gray-100 text-gray-800`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
            Bot Permissions
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage user access to chatbots and their conversations
          </p>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4">
          <Link
            to="/dashboard/bot-permissions/create"
            className="ml-3 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Permission
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              User
            </label>
            <select
              value={filters.userId}
              onChange={(e) =>
                setFilters({ ...filters, userId: e.target.value })
              }
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Users</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Chatbot
            </label>
            <select
              value={filters.chatbotId}
              onChange={(e) =>
                setFilters({ ...filters, chatbotId: e.target.value })
              }
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Chatbots</option>
              {chatbots.map((chatbot) => (
                <option key={chatbot.id} value={chatbot.id}>
                  {chatbot.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Permission
            </label>
            <select
              value={filters.permission}
              onChange={(e) =>
                setFilters({ ...filters, permission: e.target.value })
              }
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Permissions</option>
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Status
            </label>
            <select
              value={filters.isActive}
              onChange={(e) =>
                setFilters({ ...filters, isActive: e.target.value })
              }
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={() =>
                setFilters({
                  search: '',
                  userId: '',
                  chatbotId: '',
                  permission: '',
                  isActive: '',
                })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-sm text-red-600">{error}</div>
        </div>
      )}

      {/* Permissions Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Permissions ({totalItems})
              </h3>
            </div>
            <ul className="divide-y divide-gray-200">
              {permissions.length === 0 ? (
                <li className="px-6 py-4 text-center text-gray-500">
                  No permissions found
                </li>
              ) : (
                permissions.map((permission) => (
                  <li key={permission.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex-shrink-0">
                          <UserGroupIcon className="h-8 w-8 text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {permission.user?.username || permission.userId}
                            </p>
                            <span
                              className={getPermissionBadge(
                                permission.permission
                              )}
                            >
                              {permission.permission}
                            </span>
                            <span
                              className={getStatusBadge(permission.isActive)}
                            >
                              {permission.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <span>
                              Bot:{' '}
                              {permission.chatbot?.name || permission.chatbotId}
                            </span>
                            <span>
                              Assigned:{' '}
                              {new Date(
                                permission.assignedAt
                              ).toLocaleDateString()}
                            </span>
                            {permission.expiresAt && (
                              <span>
                                Expires:{' '}
                                {new Date(
                                  permission.expiresAt
                                ).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Link
                          to={`/dashboard/bot-permissions/${permission.id}/edit`}
                          className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDelete(permission.id)}
                          className="text-red-600 hover:text-red-900 text-sm font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          itemsPerPage={itemsPerPage}
          totalItems={totalItems}
          onItemsPerPageChange={setItemsPerPage}
        />
      )}
    </div>
  );
}
