import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusIcon,
  KeyIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  CpuChipIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { apiKeysAPI, ApiKey } from '@/utils/api';
import Pagination from '@/components/Pagination';

export default function ApiKeyList() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');

  const [copySuccess, setCopySuccess] = useState<{ [key: string]: boolean }>(
    {}
  );
  const [showCopyMessage, setShowCopyMessage] = useState(false);
  const [regeneratedApiKey, setRegeneratedApiKey] = useState<{
    id: string;
    key: string;
    name: string;
  } | null>(null);
  const [showRegeneratedKey, setShowRegeneratedKey] = useState(false);

  useEffect(() => {
    fetchApiKeys();
  }, [currentPage, itemsPerPage, searchTerm]);

  const fetchApiKeys = async () => {
    try {
      setLoading(true);
      const response = await apiKeysAPI.list({
        page: currentPage,
        limit: itemsPerPage,
      });
      setApiKeys(response.api_keys || []);
      setTotalPages(response.totalPages || 1);
      setTotalItems(response.total || 0);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (apiKeyId: string, keyName: string) => {
    if (!confirm(`Are you sure you want to delete "${keyName}"?`)) {
      return;
    }

    try {
      await apiKeysAPI.delete(apiKeyId);
      await fetchApiKeys(); // Refresh list
    } catch (error) {
      console.error('Failed to delete API key:', error);
      setError('Failed to delete API key');
    }
  };

  const copyToClipboard = async (keyId: string) => {
    try {
      // Regenerate API key to get the new value
      const regeneratedApiKey = await apiKeysAPI.regenerate(keyId);

      if (regeneratedApiKey.key) {
        // Show the regenerated API key in a modal
        setRegeneratedApiKey({
          id: keyId,
          key: regeneratedApiKey.key,
          name: regeneratedApiKey.name,
        });
        setShowRegeneratedKey(true);

        // Also copy to clipboard
        await navigator.clipboard.writeText(regeneratedApiKey.key);
        setCopySuccess((prev) => ({ ...prev, [keyId]: true }));
        setTimeout(() => {
          setCopySuccess((prev) => ({ ...prev, [keyId]: false }));
        }, 2000);
      } else {
        setShowCopyMessage(true);
        setTimeout(() => {
          setShowCopyMessage(false);
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      setShowCopyMessage(true);
      setTimeout(() => {
        setShowCopyMessage(false);
      }, 3000);
    }
  };

  const copyRegeneratedKey = async () => {
    if (regeneratedApiKey) {
      try {
        await navigator.clipboard.writeText(regeneratedApiKey.key);
        setCopySuccess((prev) => ({ ...prev, [regeneratedApiKey.id]: true }));
        setTimeout(() => {
          setCopySuccess((prev) => ({
            ...prev,
            [regeneratedApiKey.id]: false,
          }));
        }, 2000);
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
      }
    }
  };

  const closeRegeneratedKeyModal = () => {
    setShowRegeneratedKey(false);
    setRegeneratedApiKey(null);
    setShowRegeneratedKey(false);
  };

  const handleToggleStatus = async (apiKeyId: string, keyName: string) => {
    if (!confirm(`Are you sure you want to toggle status of "${keyName}"?`)) {
      return;
    }

    try {
      await apiKeysAPI.toggleStatus(apiKeyId);
      await fetchApiKeys(); // Refresh list
    } catch (error) {
      console.error('Failed to toggle API key status:', error);
      setError('Failed to toggle API key status');
    }
  };

  const maskApiKey = (key: string) => {
    if (!key || key.length <= 8) return '*'.repeat(key?.length || 0);
    return (
      key.substring(0, 4) +
      '*'.repeat(key.length - 8) +
      key.substring(key.length - 4)
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-yellow-100 text-yellow-800';
      case 'revoked':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'inactive':
        return 'Inactive';
      case 'revoked':
        return 'Revoked';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Quản lý API keys cho truy cập ngoài với trợ lý AI ({totalItems}{' '}
            keys)
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Search */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Tìm kiếm API key..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1); // Reset to first page when searching
              }}
              className="block w-full sm:w-64 pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>
          <Link
            to="/dashboard/api-keys/create"
            className="btn-primary inline-flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Tạo API Key
          </Link>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Copy Success Toast */}
      {Object.values(copySuccess).some(Boolean) && (
        <div className="fixed top-4 right-4 z-50 bg-green-50 border border-green-200 rounded-lg p-4 shadow-lg">
          <div className="flex items-center">
            <CheckIcon className="h-5 w-5 text-green-600 mr-2" />
            <p className="text-sm text-green-800">
              API key mới đã được tạo và đã được sao chép vào clipboard!
            </p>
          </div>
        </div>
      )}

      {/* Copy Message Toast */}
      {showCopyMessage && (
        <div className="fixed top-4 right-4 z-50 bg-blue-50 border border-blue-200 rounded-lg p-4 shadow-lg max-w-sm">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <ClipboardDocumentIcon className="h-5 w-5 text-blue-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-800">
                <strong>API Key đã được tạo lại:</strong> Một API key mới đã
                được tạo. API key cũ không còn hợp lệ. Vui lòng cập nhật các ứng
                dụng sử dụng API key cũ.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Regenerated API Key Modal */}
      {showRegeneratedKey && regeneratedApiKey && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={closeRegeneratedKeyModal}
            ></div>

            {/* Modal panel */}
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-green-100 sm:mx-0 sm:h-10 sm:w-10">
                    <CheckIcon className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                      API Key đã được tạo lại thành công
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Tên API Key
                        </label>
                        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                          {regeneratedApiKey.name}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          API Key mới
                        </label>
                        <div className="flex items-center space-x-2">
                          <code className="flex-1 text-sm bg-gray-100 px-3 py-2 rounded border font-mono break-all">
                            {showRegeneratedKey
                              ? regeneratedApiKey.key
                              : '••••••••••••••••'}
                          </code>
                          <button
                            onClick={copyRegeneratedKey}
                            className={`${
                              copySuccess[regeneratedApiKey.id]
                                ? 'text-green-600'
                                : 'text-gray-400 hover:text-gray-600'
                            } p-1 transition-colors`}
                            title={
                              copySuccess[regeneratedApiKey.id]
                                ? 'Copied!'
                                : 'Copy to clipboard'
                            }
                          >
                            {copySuccess[regeneratedApiKey.id] ? (
                              <CheckIcon className="h-4 w-4" />
                            ) : (
                              <ClipboardDocumentIcon className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <div className="flex">
                          <div className="flex-shrink-0">
                            <svg
                              className="h-5 w-5 text-yellow-400"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                          <div className="ml-3">
                            <h3 className="text-sm font-medium text-yellow-800">
                              Lưu ý quan trọng về bảo mật
                            </h3>
                            <div className="mt-2 text-sm text-yellow-700">
                              <ul className="list-disc list-inside space-y-1">
                                <li>API key cũ không còn hợp lệ</li>
                                <li>
                                  Sao chép và lưu trữ API key mới một cách an
                                  toàn
                                </li>
                                <li>
                                  Cập nhật các ứng dụng sử dụng API key cũ
                                </li>
                                <li>API key này sẽ không được hiển thị lại</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={closeRegeneratedKeyModal}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Got it, thanks!
                </button>
                <button
                  type="button"
                  onClick={copyRegeneratedKey}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Copy Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Table */}
      <div className="card overflow-hidden shadow-none rounded-none">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Tên</th>
                <th className="table-header">Trợ lý AI</th>
                <th className="table-header">API Key</th>
                <th className="table-header">Trạng thái</th>
                <th className="table-header">Tạo</th>
                <th className="table-header">Sử dụng gần nhất</th>
                <th className="table-header">Hành động</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {apiKeys.map((apiKey) => (
                <tr key={apiKey.id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <div className="flex items-center">
                      <KeyIcon className="h-5 w-5 text-gray-400 mr-2" />
                      <div className="text-sm font-medium text-gray-900">
                        {apiKey.name}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center">
                      <CpuChipIcon className="h-4 w-4 text-gray-400 mr-2" />
                      <div className="text-sm text-gray-900">
                        {apiKey.chatbot_name || 'Không có chatbot'}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center space-x-2">
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono">
                        {apiKey.key
                          ? maskApiKey(apiKey.key)
                          : '••••••••••••••••'}
                      </code>
                      <button
                        onClick={() => copyToClipboard(apiKey.id)}
                        className={`${
                          copySuccess[apiKey.id]
                            ? 'text-green-600'
                            : 'text-gray-400 hover:text-gray-600'
                        } transition-colors`}
                        title={
                          copySuccess[apiKey.id]
                            ? 'Đã sao chép!'
                            : 'Tạo lại và sao chép API key'
                        }
                      >
                        {copySuccess[apiKey.id] ? (
                          <CheckIcon className="h-4 w-4" />
                        ) : (
                          <ClipboardDocumentIcon className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="table-cell">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        apiKey.status
                      )}`}
                    >
                      {getStatusText(apiKey.status)}
                    </span>
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {new Date(apiKey.created_at).toLocaleDateString()}
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {apiKey.last_used_at
                      ? new Date(apiKey.last_used_at).toLocaleDateString()
                      : 'Không sử dụng'}
                  </td>
                  <td className="table-cell">
                    <div className="flex space-x-2">
                      {apiKey.status !== 'revoked' && (
                        <button
                          onClick={() => handleToggleStatus(apiKey.id, apiKey.name)}
                          className={`${
                            apiKey.status === 'active'
                              ? 'text-orange-600 hover:text-orange-900'
                              : 'text-green-600 hover:text-green-900'
                          } transition-colors`}
                          title={apiKey.status === 'active' ? 'Deactivate' : 'Activate'}
                        >
                          {apiKey.status === 'active' ? (
                            <XMarkIcon className="h-5 w-5" />
                          ) : (
                            <CheckIcon className="h-5 w-5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(apiKey.id, apiKey.name)}
                        className="text-red-600 hover:text-red-900"
                        title="Xóa"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="card p-4 shadow-none rounded-none">
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={setItemsPerPage}
        />
      </div>

      {apiKeys.length === 0 && !loading && (
        <div className="text-center py-12">
          <KeyIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            Không có API keys
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Bắt đầu bằng cách tạo một API key cho trợ lý AI của bạn.
          </p>
          <div className="mt-6">
            <Link
              to="/dashboard/api-keys/create"
              className="btn-primary inline-flex items-center"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              Tạo API Key
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
