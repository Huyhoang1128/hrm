import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ChatBubbleLeftRightIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  GlobeAltIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from '@heroicons/react/24/outline';
import { conversationsAPI, chatbotsAPI } from '@/utils/api';
import Pagination from '@/components/Pagination';
import ContextSummaryTableCell from '@/components/ContextSummaryTableCell';
import { useDebounce } from '@/hooks/useDebounce';

import { Conversation, Chatbot } from '@/utils/api';

export default function ConversationList() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChatbotId, setSelectedChatbotId] = useState('');
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);

  // Bulk selection state
  const [selectedConversations, setSelectedConversations] = useState<
    Set<string>
  >(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [togglingAutoReply, setTogglingAutoReply] = useState<string | null>(null);

  // Debounced search term
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const getImageUrl = (image: string) => {
    return `${import.meta.env.VITE_MANAGEMENT_API_URL}/${image}`;
  };

  useEffect(() => {
    fetchConversations();
  }, [currentPage, itemsPerPage, debouncedSearchTerm, selectedChatbotId]);

  useEffect(() => {
    fetchChatbots();
  }, []);

  // Reset selection when data changes
  useEffect(() => {
    setSelectedConversations(new Set());
    setSelectAll(false);
  }, [conversations]);

  const fetchChatbots = async () => {
    try {
      const response = await chatbotsAPI.list();
      if (response.chatbots && Array.isArray(response.chatbots)) {
        setChatbots(response.chatbots);
      }
    } catch (error) {
      console.error('Failed to fetch chatbots:', error);
    }
  };

  const fetchConversations = async () => {
    try {
      // Show loading more indicator if we have existing data
      if (conversations.length > 0) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const response = await conversationsAPI.list({
        page: currentPage,
        limit: itemsPerPage,
        search: debouncedSearchTerm || undefined,
        chatbotId: selectedChatbotId || undefined,
      });

      setConversations(response.conversations);
      setTotalPages(response.totalPages);
      setTotalItems(response.total);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      setError('Failed to load conversations');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleDelete = async (conversationId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa trò chuyện này?')) {
      return;
    }

    try {
      await conversationsAPI.delete(conversationId);
      await fetchConversations(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      setError('Failed to delete conversation');
    }
  };

  const handleToggleAutoReply = async (conversationId: string) => {
    try {
      setTogglingAutoReply(conversationId);
      await conversationsAPI.toggleAutoReply(conversationId);
      await fetchConversations(); // Refresh the list
    } catch (error) {
      console.error('Failed to toggle auto-reply:', error);
      setError('Failed to toggle auto-reply');
    } finally {
      setTogglingAutoReply(null);
    }
  };

  const handleSelectConversation = (
    conversationId: string,
    checked: boolean
  ) => {
    const newSelected = new Set(selectedConversations);
    if (checked) {
      newSelected.add(conversationId);
    } else {
      newSelected.delete(conversationId);
    }
    setSelectedConversations(newSelected);
    setSelectAll(newSelected.size === conversations.length);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedConversations(new Set(conversations.map((c) => c.id)));
      setSelectAll(true);
    } else {
      setSelectedConversations(new Set());
      setSelectAll(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedConversations.size === 0) {
      return;
    }

    const count = selectedConversations.size;
    if (
      !confirm(
        `Bạn có chắc chắn muốn xóa ${count} trò chuyện${count > 1 ? 's' : ''}? Hành động này không thể hoàn tác.`
      )
    ) {
      return;
    }

    try {
      setBulkDeleting(true);
      const conversationIds = Array.from(selectedConversations);
      const result = await conversationsAPI.bulkDelete(conversationIds);

      if (result.deletedCount > 0) {
        setSelectedConversations(new Set());
        setSelectAll(false);
        await fetchConversations(); // Refresh the list
      }

      if (result.failedCount > 0) {
        setError(
          `Lỗi khi xóa ${result.failedCount} trò chuyện${result.failedCount > 1 ? 's' : ''}`
        );
      }
    } catch (error) {
      console.error('Failed to bulk delete conversations:', error);
      setError('Lỗi khi xóa trò chuyện');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1); // Reset to first page when changing items per page
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1); // Reset to first page when searching
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    setSelectedChatbotId('');
    setCurrentPage(1);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString();
    } else if (diffInHours < 168) {
      // 7 days
      return date.toLocaleDateString();
    } else {
      return date.toLocaleDateString();
    }
  };

  const getFacebookPageName = (conversation: Conversation) => {
    // Check if conversation has platform metadata with Facebook page info
    if (conversation.platform === 'facebook' && conversation.platformMetadata) {
      const metadata = conversation.platformMetadata as any;
      if (metadata.pageName) {
        return metadata.pageName;
      }
      if (metadata.pageId && conversation.chatbot?.facebookPages) {
        const page = conversation.chatbot.facebookPages.find(
          (p) => p.id === metadata.pageId
        );
        if (page) {
          return page.name;
        }
      }
    }

    // Fallback: check if chatbot has Facebook pages
    if (
      conversation.chatbot?.facebookPages &&
      conversation.chatbot.facebookPages.length > 0
    ) {
      return conversation.chatbot.facebookPages[0].name;
    }

    return null;
  };

  if (loading && conversations.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Trò chuyện</h1>
            <p className="mt-1 text-sm text-gray-500">
              Quản lý trò chuyện của bạn
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Link
              to="/dashboard/conversations/create"
              className="btn-primary flex items-center space-x-2"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Tạo trò chuyện</span>
            </Link>
          </div>
        </div>

        <div className="card p-4">
          <div className="animate-pulse space-y-4">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1">
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
              <div className="flex-1 lg:flex-none">
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
              <div className="flex gap-2">
                <div className="h-10 w-20 bg-gray-200 rounded"></div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                    Tiêu đề
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-64">
                    Ngữ cảnh
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Trợ lý AI
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                    Fanpage Facebook
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Ngày tạo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Ngày cập nhật
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                    Hành động
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {[...Array(5)].map((_, index) => (
                  <tr key={index} className="border-b border-gray-200">
                    <td className="px-6 py-4">
                      <div className="h-4 w-4 bg-gray-200 rounded animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-32 animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-48 animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-24 animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-28 animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trò chuyện</h1>
          <p className="mt-1 text-sm text-gray-500">
            Quản lý trò chuyện của bạn
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            to="/dashboard/conversations/create"
            className="btn-primary flex items-center space-x-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Tạo trò chuyện</span>
          </Link>
        </div>
      </div>

      {/* Search and Filter Section */}
      <div className="card p-4 shadow-none rounded-none">
        <form
          onSubmit={handleSearch}
          className="flex flex-col lg:flex-row gap-4"
        >
          <div className="flex-1">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Tìm kiếm trò chuyện..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            {searchTerm !== debouncedSearchTerm && (
              <p className="mt-1 text-xs text-gray-500">Đang tìm kiếm...</p>
            )}
          </div>

          <div className="flex-1 lg:flex-none">
            <select
              value={selectedChatbotId}
              onChange={(e) => setSelectedChatbotId(e.target.value)}
              className="w-full lg:w-64 px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Tất cả trợ lý AI</option>
              {chatbots.map((chatbot) => (
                <option key={chatbot.id} value={chatbot.id}>
                  {chatbot.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              Tìm kiếm
            </button>
            {(searchTerm || selectedChatbotId) && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Xóa
              </button>
            )}
          </div>
        </form>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200 shadow-none rounded-none">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Bulk Actions Toolbar */}
      {selectedConversations.size > 0 && (
        <div className="card p-4 bg-blue-50 border border-blue-200 shadow-none rounded-none">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-blue-900">
                {selectedConversations.size} cuộc trò chuyện
                {selectedConversations.size > 1 ? 's' : ''} đã được chọn
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {bulkDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <TrashIcon className="h-4 w-4" />
                    <span>Xóa đã cuộc trò chuyện chọn</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {conversations.length === 0 ? (
        <div className="text-center py-12">
          <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            No conversations found
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm || selectedChatbotId
              ? 'Try adjusting your search criteria.'
              : 'Start a new conversation to begin chatting.'}
          </p>
          <div className="mt-6">
            <Link to="/dashboard/conversations/create" className="btn-primary">
              Create Conversation
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="card shadow-none rounded-none">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                      Tiêu đề
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-64">
                      Ngữ cảnh
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      Trợ lý AI
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                      Fanpage Facebook
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      Ngày tạo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      Ngày cập nhật
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Hành động
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loadingMore ? (
                    <>
                      {[...Array(5)].map((_, index) => (
                        <tr key={index} className="border-b border-gray-200">
                          <td className="px-6 py-4">
                            <div className="h-4 w-4 bg-gray-200 rounded animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-32 animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-48 animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-24 animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-28 animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div>
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    conversations.map((conversation) => {
                      const facebookPageName =
                        getFacebookPageName(conversation);
                      return (
                        <tr key={conversation.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={selectedConversations.has(
                                conversation.id
                              )}
                              onChange={(e) =>
                                handleSelectConversation(
                                  conversation.id,
                                  e.target.checked
                                )
                              }
                              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                            />
                          </td>
                          <td className="px-6 py-4 w-48">
                            <div className="flex items-start space-x-3">
                              {/* User Avatar */}
                              {conversation.userProfile?.profilePicPath && (
                                <img
                                  src={getImageUrl(
                                    conversation.userProfile.profilePicPath
                                  )}
                                  alt={
                                    conversation.userProfile.fullName || 'User'
                                  }
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                  }}
                                />
                              )}
                              {conversation.userProfile &&
                                !conversation.userProfile.profilePicPath && (
                                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs font-medium text-primary-600">
                                      {conversation.userProfile.fullName?.charAt(
                                        0
                                      ) ||
                                        conversation.userProfile.externalId.charAt(
                                          0
                                        )}
                                    </span>
                                  </div>
                                )}

                              <div className="flex-1 min-w-0">
                                <Link
                                  to={`/dashboard/conversations/${conversation.id}`}
                                  className="text-primary-600 hover:text-primary-900 font-medium truncate block"
                                >
                                  {conversation.title ||
                                    'Untitled Conversation'}
                                </Link>
                                {conversation.userProfile && (
                                  <div className="text-xs text-gray-600 mt-1">
                                    {conversation.userProfile.fullName && (
                                      <span className="font-medium">
                                        {conversation.userProfile.fullName}
                                      </span>
                                    )}
                                    {conversation.platform === 'facebook' && (
                                      <span className="ml-1 text-gray-400">
                                        • Facebook
                                      </span>
                                    )}
                                  </div>
                                )}
                                {conversation.lastMessage && (
                                  <div className="text-xs text-gray-500 mt-1 truncate">
                                    <span
                                      className={`inline-block w-2 h-2 rounded-full mr-1 ${
                                        conversation.lastMessage.role === 'USER'
                                          ? 'bg-blue-400'
                                          : 'bg-green-400'
                                      }`}
                                    ></span>
                                    {conversation.lastMessage.content.length >
                                    50
                                      ? `${conversation.lastMessage.content.substring(0, 50)}...`
                                      : conversation.lastMessage.content}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <ContextSummaryTableCell
                            contextSummary={conversation.contextSummary}
                            maxWidth="w-64"
                            showIcon={true}
                          />
                          <td className="px-6 py-4 w-32 text-sm text-gray-500 truncate">
                            {conversation.chatbot?.name ||
                              conversation.chatbotId ||
                              'No chatbot'}
                          </td>
                          <td className="px-6 py-4 w-40 text-sm text-gray-500">
                            {facebookPageName ? (
                              <div className="flex items-center space-x-1">
                                <GlobeAltIcon className="h-4 w-4 text-blue-500" />
                                <span
                                  className="truncate"
                                  title={facebookPageName}
                                >
                                  {facebookPageName}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 w-32 text-sm text-gray-500">
                            {formatDate(conversation.createdAt)}
                          </td>
                          <td className="px-6 py-4 w-32 text-sm text-gray-500">
                            {formatDate(conversation.updatedAt)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <Link
                                to={`/dashboard/conversations/${conversation.id}`}
                                className="text-primary-600 hover:text-primary-900 p-1"
                                title="View conversation"
                              >
                                <EyeIcon className="h-4 w-4" />
                              </Link>
                              <button
                                onClick={() => handleToggleAutoReply(conversation.id)}
                                disabled={togglingAutoReply === conversation.id}
                                className={`p-1 ${conversation.autoReply ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'}`}
                                title={conversation.autoReply ? "Auto-reply đang bật. Nhấn để tắt" : "Auto-reply đang tắt. Nhấn để bật"}
                              >
                                {togglingAutoReply === conversation.id ? (
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                                ) : conversation.autoReply ? (
                                  <SpeakerXMarkIcon className="h-4 w-4" />
                                ) : (
                                  <SpeakerWaveIcon className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                onClick={() => handleDelete(conversation.id)}
                                className="text-red-600 hover:text-red-900 p-1"
                                title="Delete conversation"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
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
              onPageChange={handlePageChange}
              onItemsPerPageChange={handleItemsPerPageChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
