import { useState, useEffect } from 'react';
import {
  UserGroupIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { botPermissionsAPI, chatbotsAPI, usersAPI } from '@/utils/api';
import { BotPermission, Chatbot, User } from '@/utils/api';

interface BotPermissionManagerProps {
  chatbotId?: string;
  userId?: string;
  onPermissionChange?: () => void;
}

export default function BotPermissionManager({
  chatbotId,
  userId,
  onPermissionChange,
}: BotPermissionManagerProps) {
  const [permissions, setPermissions] = useState<BotPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPermission, setEditingPermission] =
    useState<BotPermission | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    userId: '',
    chatbotId: chatbotId || '',
    permission: 'read' as 'read' | 'write' | 'admin',
    expiresAt: '',
  });

  // Options
  const [users, setUsers] = useState<User[]>([]);
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);

  useEffect(() => {
    fetchPermissions();
    fetchOptions();
  }, [chatbotId, userId]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (chatbotId) params.chatbotId = chatbotId;
      if (userId) params.userId = userId;

      const response = await botPermissionsAPI.list(params);
      setPermissions(response.permissions);
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await botPermissionsAPI.create({
        ...formData,
        expiresAt: formData.expiresAt || undefined,
      });
      setShowCreateModal(false);
      resetForm();
      fetchPermissions();
      onPermissionChange?.();
    } catch (error) {
      console.error('Failed to create permission:', error);
      setError('Failed to create permission');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPermission) return;

    try {
      await botPermissionsAPI.update(editingPermission.id, {
        permission: formData.permission,
        expiresAt: formData.expiresAt || undefined,
      });
      setEditingPermission(null);
      resetForm();
      fetchPermissions();
      onPermissionChange?.();
    } catch (error) {
      console.error('Failed to update permission:', error);
      setError('Failed to update permission');
    }
  };

  const handleDelete = async (permissionId: string) => {
    if (!confirm('Are you sure you want to delete this permission?')) {
      return;
    }

    try {
      await botPermissionsAPI.delete(permissionId);
      fetchPermissions();
      onPermissionChange?.();
    } catch (error) {
      console.error('Failed to delete permission:', error);
      setError('Failed to delete permission');
    }
  };

  const resetForm = () => {
    setFormData({
      userId: '',
      chatbotId: chatbotId || '',
      permission: 'read',
      expiresAt: '',
    });
  };

  const openEditModal = (permission: BotPermission) => {
    setEditingPermission(permission);
    setFormData({
      userId: permission.userId,
      chatbotId: permission.chatbotId,
      permission: permission.permission,
      expiresAt: permission.expiresAt || '',
    });
  };

  const getPermissionIcon = (permission: string) => {
    switch (permission) {
      case 'read':
        return <EyeIcon className="h-4 w-4 text-blue-500" />;
      case 'write':
        return <PencilSquareIcon className="h-4 w-4 text-yellow-500" />;
      case 'admin':
        return <ShieldCheckIcon className="h-4 w-4 text-red-500" />;
      default:
        return <EyeIcon className="h-4 w-4 text-gray-500" />;
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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Bot Permissions</h3>
          <p className="text-sm text-gray-500">
            Manage user access to chatbots
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Permission
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-sm text-red-600">{error}</div>
        </div>
      )}

      {/* Permissions List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
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
                      {getPermissionIcon(permission.permission)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {permission.user?.username || permission.userId}
                        </p>
                        <span
                          className={getPermissionBadge(permission.permission)}
                        >
                          {permission.permission}
                        </span>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>
                          Bot:{' '}
                          {permission.chatbot?.name || permission.chatbotId}
                        </span>
                        <span>
                          Assigned:{' '}
                          {new Date(permission.assignedAt).toLocaleDateString()}
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
                    <button
                      onClick={() => openEditModal(permission)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(permission.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Add Bot Permission
              </h3>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    User
                  </label>
                  <select
                    value={formData.userId}
                    onChange={(e) =>
                      setFormData({ ...formData, userId: e.target.value })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="">Select a user</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username} ({user.email})
                      </option>
                    ))}
                  </select>
                </div>

                {!chatbotId && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Chatbot
                    </label>
                    <select
                      value={formData.chatbotId}
                      onChange={(e) =>
                        setFormData({ ...formData, chatbotId: e.target.value })
                      }
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Select a chatbot</option>
                      {chatbots.map((chatbot) => (
                        <option key={chatbot.id} value={chatbot.id}>
                          {chatbot.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Permission Level
                  </label>
                  <select
                    value={formData.permission}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        permission: e.target.value as any,
                      })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="read">
                      Read - View conversations and messages
                    </option>
                    <option value="write">
                      Write - Chat and manage conversations
                    </option>
                    <option value="admin">Admin - Full bot management</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Expires At (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) =>
                      setFormData({ ...formData, expiresAt: e.target.value })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Add Permission
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingPermission && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Edit Bot Permission
              </h3>
              <form onSubmit={handleUpdate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    User
                  </label>
                  <div className="mt-1 text-sm text-gray-900">
                    {editingPermission.user?.username ||
                      editingPermission.userId}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Chatbot
                  </label>
                  <div className="mt-1 text-sm text-gray-900">
                    {editingPermission.chatbot?.name ||
                      editingPermission.chatbotId}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Permission Level
                  </label>
                  <select
                    value={formData.permission}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        permission: e.target.value as any,
                      })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="read">
                      Read - View conversations and messages
                    </option>
                    <option value="write">
                      Write - Chat and manage conversations
                    </option>
                    <option value="admin">Admin - Full bot management</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Expires At (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) =>
                      setFormData({ ...formData, expiresAt: e.target.value })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPermission(null);
                      resetForm();
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Update Permission
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
