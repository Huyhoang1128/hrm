import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusIcon,
  ChatBubbleLeftRightIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  PlayIcon,
  StopIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { chatbotsAPI } from '@/utils/api';
import Pagination from '@/components/Pagination';

interface Chatbot {
  id: string;
  name: string;
  instructions: string;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function ChatbotList() {
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination and search states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalChatbots, setTotalChatbots] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [limit] = useState(20);

  useEffect(() => {
    fetchChatbots();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const timeoutId = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(timeoutId);
    } else {
      fetchChatbots();
    }
  }, [searchTerm]);

  useEffect(() => {
    if (currentPage > 1) {
      fetchChatbots();
    }
  }, [currentPage]);

  const fetchChatbots = async (page: number = 1, search: string = '') => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setIsSearching(true);
      }

      const response = await chatbotsAPI.list({
        page,
        limit,
        ...(search && { search }),
      });

      // Handle different response formats
      let chatbotsData: any[] = [];
      let total = 0;
      let totalPages = 1;

      if (response.chatbots && Array.isArray(response.chatbots)) {
        // Convert snake_case to camelCase for chatbot objects
        chatbotsData = response.chatbots.map((chatbot: any) => {
          // Get values from snake_case or camelCase fields
          const avatarUrl = chatbot.avatar_url !== undefined ? chatbot.avatar_url : chatbot.avatarUrl;
          const isActive = chatbot.is_active !== undefined ? chatbot.is_active : chatbot.isActive;
          const createdAt = chatbot.created_at !== undefined ? chatbot.created_at : chatbot.createdAt;
          const updatedAt = chatbot.updated_at !== undefined ? chatbot.updated_at : chatbot.updatedAt;
          
          return {
            id: chatbot.id,
            name: chatbot.name,
            instructions: chatbot.instructions,
            avatarUrl: avatarUrl !== null ? avatarUrl : undefined,
            isActive: Boolean(isActive),
            createdAt: createdAt || '',
            updatedAt: updatedAt || '',
          };
        });
        total = response.total || chatbotsData.length;
        totalPages = response.totalPages || 1;
      } else {
        console.warn('Unexpected response format:', response);
        chatbotsData = [];
      }

      setChatbots(chatbotsData);
      setTotalChatbots(total);
      setTotalPages(totalPages);
    } catch (error) {
      console.error('Failed to fetch chatbots:', error);
      setError('Failed to load chatbots');
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchChatbots(1, searchTerm);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleToggleStatus = async (
    chatbotId: string,
    currentStatus: string
  ) => {
    try {
      if (currentStatus === 'active') {
        await chatbotsAPI.toggleStatus(chatbotId, false);
      } else {
        await chatbotsAPI.toggleStatus(chatbotId, true);
      }
      await fetchChatbots(currentPage, searchTerm); // Refresh list
    } catch (error) {
      console.error('Failed to toggle status:', error);
      setError('Failed to update status');
    }
  };

  const handleDelete = async (chatbotId: string, chatbotName: string) => {
    if (!confirm(`Are you sure you want to delete "${chatbotName}"?`)) {
      return;
    }

    try {
      await chatbotsAPI.delete(chatbotId);
      await fetchChatbots(currentPage, searchTerm); // Refresh list
    } catch (error) {
      console.error('Failed to delete chatbot:', error);
      setError('Failed to delete chatbot');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
          <h1 className="text-2xl font-bold text-gray-900">
            Trợ lý AI
            {totalChatbots > 0 && (
              <span className="text-sm text-gray-500 ml-2">
                ({totalChatbots} trợ lý AI)
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Quản lý trợ lý AI của bạn
          </p>
        </div>
        <div className="mt-4 sm:mt-0">
          <Link
            to="/dashboard/chatbots/create"
            className="btn-primary inline-flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Tạo trợ lý AI
          </Link>
        </div>
      </div>

      {/* Search Box */}
      <div className="max-w-md">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Tìm kiếm trợ lý AI..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10"
          />
        </div>
      </div>

      {isSearching && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          <span className="ml-2 text-sm text-gray-500">Đang tìm kiếm...</span>
        </div>
      )}

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Chatbots Table */}
      <div className="card overflow-hidden shadow-none rounded-none">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Trợ lý AI</th>
                <th className="table-header">Trạng thái</th>
                <th className="table-header">Ngày tạo</th>
                <th className="table-header">Ngày cập nhật</th>
                <th className="table-header">Hành động</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {chatbots.map((chatbot) => (
                <tr key={chatbot.id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        {chatbot.avatarUrl ? (
                          <img
                            className="h-10 w-10 rounded-full"
                            src={chatbot.avatarUrl}
                            alt={chatbot.name}
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <ChatBubbleLeftRightIcon className="h-6 w-6 text-primary-600" />
                          </div>
                        )}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {chatbot.name}
                        </div>
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {chatbot.instructions}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        chatbot.isActive ? 'active' : 'inactive'
                      )}`}
                    >
                      {chatbot.isActive ? 'Đang hoạt động' : 'Không hoạt động'}
                    </span>
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {chatbot.createdAt ? new Date(chatbot.createdAt).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {chatbot.updatedAt ? new Date(chatbot.updatedAt).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="table-cell">
                    <div className="flex space-x-2">
                      <Link
                        to={`/dashboard/chatbots/${chatbot.id}`}
                        className="text-primary-600 hover:text-primary-900"
                        title="View"
                      >
                        <EyeIcon className="h-5 w-5" />
                      </Link>
                      <Link
                        to={`/dashboard/chatbots/${chatbot.id}/edit`}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </Link>
                      <button
                        onClick={() =>
                          handleToggleStatus(
                            chatbot.id,
                            chatbot.isActive ? 'inactive' : 'active'
                          )
                        }
                        className={`${
                          chatbot.isActive
                            ? 'text-yellow-600 hover:text-yellow-900'
                            : 'text-green-600 hover:text-green-900'
                        }`}
                        title={chatbot.isActive ? 'Tắt' : 'Bật'}
                      >
                        {chatbot.isActive ? (
                          <StopIcon className="h-5 w-5" />
                        ) : (
                          <PlayIcon className="h-5 w-5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(chatbot.id, chatbot.name)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete"
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

      {/* Pagination Controls */}
      <div className="card p-4 shadow-none rounded-none">
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalChatbots}
          itemsPerPage={limit}
          onPageChange={handlePageChange}
        />
      </div>

      {chatbots.length === 0 && !isSearching && (
        <div className="text-center py-12">
          <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {searchTerm
              ? `Không tìm thấy trợ lý AI nào với từ khóa "${searchTerm}"`
              : 'Không có trợ lý AI'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm
              ? 'Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc để xem tất cả trợ lý AI.'
              : 'Bắt đầu bằng cách tạo trợ lý AI.'}
          </p>
          {!searchTerm && (
            <div className="mt-6">
              <Link
                to="/dashboard/chatbots/create"
                className="btn-primary inline-flex items-center"
              >
                <PlusIcon className="h-5 w-5 mr-2" />
                Tạo trợ lý AI
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
