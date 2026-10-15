import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { botPermissionsAPI, chatbotsAPI, usersAPI } from '@/utils/api';
import { Chatbot, User } from '@/utils/api';
import MultiSelect from '@/components/MultiSelect';

export default function BotPermissionCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    userId: '',
    chatbotIds: [] as string[],
    permission: 'read' as 'read' | 'write' | 'admin',
    expiresAt: '',
  });

  // Options
  const [users, setUsers] = useState<User[]>([]);
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [chatbotsLoading, setChatbotsLoading] = useState(false);
  const [chatbotsError, setChatbotsError] = useState('');

  useEffect(() => {
    fetchOptions();
  }, []);

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
      setError('Failed to load users and chatbots');
    }
  };

  const searchChatbots = async (searchTerm: string) => {
    try {
      setChatbotsLoading(true);
      setChatbotsError('');

      const response = await chatbotsAPI.list({
        search: searchTerm,
        limit: 50,
      });

      setChatbots(response.chatbots);
    } catch (error) {
      console.error('Failed to search chatbots:', error);
      setChatbotsError('Failed to search chatbots');
    } finally {
      setChatbotsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (formData.chatbotIds.length === 0) {
        setError('Please select at least one chatbot');
        return;
      }

      if (formData.chatbotIds.length === 1) {
        // Single permission creation
        await botPermissionsAPI.create({
          userId: formData.userId,
          chatbotId: formData.chatbotIds[0],
          permission: formData.permission,
          expiresAt: formData.expiresAt || undefined,
        });
        setSuccess('Bot permission created successfully!');
      } else {
        // Bulk permission creation
        const result = await botPermissionsAPI.createBulk({
          userId: formData.userId,
          chatbotIds: formData.chatbotIds,
          permission: formData.permission,
          expiresAt: formData.expiresAt || undefined,
        });

        const totalProcessed = result.created + result.updated;
        const message = `Successfully created ${totalProcessed} permissions (${result.created} new, ${result.updated} updated)`;
        if (result.failed > 0) {
          setError(
            `${message}. ${result.failed} failed: ${result.errors.join(', ')}`
          );
        } else {
          setSuccess(message);
        }
      }

      setTimeout(() => {
        navigate('/dashboard/bot-permissions');
      }, 1500);
    } catch (error: any) {
      console.error('Failed to create permission:', error);
      setError(error.response?.data?.message || 'Failed to create permission');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/bot-permissions');
  };

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
              Create Bot Permission
            </h1>
            <p className="text-gray-600">
              Assign access permissions for users to specific chatbots
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

      {/* Form */}
      <div className="bg-white shadow rounded-lg">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* User Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              User <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.userId}
              onChange={(e) =>
                setFormData({ ...formData, userId: e.target.value })
              }
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Select a user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username} ({user.email}) - {user.role}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-gray-500">
              Choose the user who will receive the permission
            </p>
          </div>

          {/* Chatbot Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Chatbots <span className="text-red-500">*</span>
            </label>
            <MultiSelect
              options={chatbots.map((chatbot) => ({
                value: chatbot.id,
                label: `${chatbot.name} - ${chatbot.description || 'No description'}`,
                ...chatbot,
              }))}
              value={formData.chatbotIds}
              onChange={(values) =>
                setFormData({ ...formData, chatbotIds: values })
              }
              placeholder="Select chatbots..."
              searchPlaceholder="Search chatbots..."
              className="w-full"
              maxDisplayItems={2}
              searchMode="api"
              loading={chatbotsLoading}
              onSearch={searchChatbots}
            />
            <p className="mt-1 text-sm text-gray-500">
              Choose one or more chatbots the user will have access to. You can
              select multiple bots to create permissions in bulk.
            </p>
            {formData.chatbotIds.length > 0 && (
              <div className="mt-2 text-sm text-blue-600">
                Selected {formData.chatbotIds.length} chatbot
                {formData.chatbotIds.length > 1 ? 's' : ''}
              </div>
            )}
            {chatbotsError && (
              <div className="mt-1 text-sm text-red-600">{chatbotsError}</div>
            )}
          </div>

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
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || formData.chatbotIds.length === 0}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Creating...'
                : formData.chatbotIds.length > 1
                  ? `Create ${formData.chatbotIds.length} Permissions`
                  : 'Create Permission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
