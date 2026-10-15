import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { botPermissionsAPI } from '@/utils/api';
import { BotPermission } from '@/utils/api';

export default function BotPermissionEdit() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    permission: 'read' as 'read' | 'write' | 'admin',
    isActive: true,
    expiresAt: '',
  });

  // Permission data
  const [permission, setPermission] = useState<BotPermission | null>(null);

  useEffect(() => {
    if (id) {
      fetchPermission();
    }
  }, [id]);

  const fetchPermission = async () => {
    try {
      setLoading(true);
      const permission = await botPermissionsAPI.getById(id!);

      setPermission(permission);
      setFormData({
        permission: permission.permission,
        isActive: permission.isActive,
        expiresAt: permission.expiresAt || '',
      });
    } catch (error: any) {
      console.error('Failed to fetch permission:', error);
      setError('Failed to load permission details');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await botPermissionsAPI.update(id, {
        permission: formData.permission,
        isActive: formData.isActive,
        expiresAt: formData.expiresAt || undefined,
      });

      setSuccess('Permission updated successfully!');
      setTimeout(() => {
        navigate('/dashboard/bot-permissions');
      }, 1500);
    } catch (error: any) {
      console.error('Failed to update permission:', error);
      setError(error.response?.data?.message || 'Failed to update permission');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/bot-permissions');
  };

  const handleDelete = async () => {
    if (!id) return;

    if (
      !confirm(
        'Are you sure you want to delete this permission? This action cannot be undone.'
      )
    ) {
      return;
    }

    try {
      await botPermissionsAPI.delete(id);
      navigate('/dashboard/bot-permissions');
    } catch (error: any) {
      console.error('Failed to delete permission:', error);
      setError('Failed to delete permission');
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (!permission) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900">
            Permission not found
          </h2>
          <p className="text-gray-600 mt-2">
            The permission you're looking for doesn't exist.
          </p>
          <button
            onClick={handleCancel}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Permissions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-4 mb-4">
          <button
            onClick={handleCancel}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeftIcon className="h-5 w-5 mr-2" />
            Back to Permissions
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <UserGroupIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Edit Bot Permission
            </h1>
            <p className="text-gray-600">
              Update access permissions for users to specific chatbots
            </p>
          </div>
        </div>
      </div>

      {/* Success Message */}
      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4">
          <div className="text-sm text-green-600">{success}</div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-sm text-red-600">{error}</div>
        </div>
      )}

      {/* Permission Info */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-900 mb-2">
          Permission Details
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium text-gray-700">User:</span>
            <span className="ml-2 text-gray-900">
              {permission.user?.username || permission.userId}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-700">Chatbot:</span>
            <span className="ml-2 text-gray-900">
              {permission.chatbot?.name || permission.chatbotId}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-700">Assigned:</span>
            <span className="ml-2 text-gray-900">
              {new Date(permission.assignedAt).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-700">Assigned By:</span>
            <span className="ml-2 text-gray-900">
              {permission.assignedByUser?.username || permission.assignedBy}
            </span>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white shadow rounded-lg">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Permission Level */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Permission Level <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.permission}
              onChange={(e) =>
                setFormData({ ...formData, permission: e.target.value as any })
              }
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="read">
                Read - View conversations and messages only
              </option>
              <option value="write">
                Write - Chat and manage conversations
              </option>
              <option value="admin">
                Admin - Full bot management (settings, documents, etc.)
              </option>
            </select>
            <div className="mt-2 space-y-1">
              <div className="text-sm text-gray-600">
                <span className="font-medium text-blue-600">Read:</span> Can
                view conversations and messages
              </div>
              <div className="text-sm text-gray-600">
                <span className="font-medium text-yellow-600">Write:</span> Can
                chat and manage conversations
              </div>
              <div className="text-sm text-gray-600">
                <span className="font-medium text-red-600">Admin:</span> Full
                access to bot settings and documents
              </div>
            </div>
          </div>

          {/* Active Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <div className="flex items-center space-x-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isActive"
                  checked={formData.isActive === true}
                  onChange={() => setFormData({ ...formData, isActive: true })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700">Active</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="isActive"
                  checked={formData.isActive === false}
                  onChange={() => setFormData({ ...formData, isActive: false })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700">Inactive</span>
              </label>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Inactive permissions will be ignored and the user will lose access
            </p>
          </div>

          {/* Expiration Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Expiration Date (Optional)
            </label>
            <input
              type="datetime-local"
              value={formData.expiresAt}
              onChange={(e) =>
                setFormData({ ...formData, expiresAt: e.target.value })
              }
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Leave empty for permanent access. Set a date to automatically
              revoke access.
            </p>
          </div>

          {/* Form Actions */}
          <div className="flex justify-between pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Delete Permission
            </button>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
