import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  CalendarIcon,
  UserIcon,
  CpuChipIcon,
  PlayIcon,
  PauseIcon,
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { conversationsAPI, Conversation } from '@/utils/api';
import ContextSummary from '@/components/ContextSummary';

export default function ConversationShow() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [togglingAutoReply, setTogglingAutoReply] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      fetchConversation();
    }
  }, [id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getImageUrl = (image: string) => {
    return `${import.meta.env.VITE_MANAGEMENT_API_URL}/${image}`;
  };

  const handleToggleAutoReply = async () => {
    if (!conversation || togglingAutoReply) return;

    try {
      setTogglingAutoReply(true);
      const updatedConversation = await conversationsAPI.toggleAutoReply(
        conversation.id
      );
      setConversation(updatedConversation);
    } catch (err) {
      console.error('Failed to toggle auto reply:', err);
      setError('Lỗi khi bật/tắt tự động trả lời');
    } finally {
      setTogglingAutoReply(false);
    }
  };

  const fetchConversation = async () => {
    try {
      setLoading(true);
      setError('');

      console.log('[DEBUG] Fetching conversation:', id);
      const conversationResponse = await conversationsAPI.getById(id!);

      let conversationData: Conversation;
      conversationData = conversationResponse;
      setConversation(conversationData);
      console.log('[DEBUG] Conversation data:', conversationData);

      // ALWAYS fetch messages separately for most up-to-date data
      try {
        console.log('[DEBUG] Fetching messages for conversation:', id);
        const messagesResponse = await conversationsAPI.getMessages(id!);
        console.log('[DEBUG] Messages response:', messagesResponse);

        let messagesData: any[] = [];

        if (Array.isArray(messagesResponse)) {
          messagesData = messagesResponse as any[];
        }

        console.log('[DEBUG] Messages data count:', messagesData.length);
        console.log('[DEBUG] Messages data sample:', messagesData.slice(0, 3));

        // Process messages to handle segments from database
        const processedMessages: any[] = messagesData.map((msg: any) => {
          console.log('[DEBUG] Processing message:', {
            id: msg.id,
            role: msg.role,
            content: msg.content?.substring(0, 50),
          });

          return {
            id: msg.id,
            content: msg.content,
            role: msg.role,
            timestamp: msg.createdAt || msg.created_at || msg.timestamp,
            image: msg.image,
          };
        });

        console.log(
          '[DEBUG] Processed messages count:',
          processedMessages.length
        );
        console.log(
          '[DEBUG] User messages count:',
          processedMessages.filter((m) => m.role === 'USER').length
        );
        console.log(
          '[DEBUG] Assistant messages count:',
          processedMessages.filter((m) => m.role === 'ASSISTANT').length
        );

        setMessages(processedMessages);
      } catch (messagesError) {
        console.error('[ERROR] Messages API failed:', messagesError);
        setMessages([]);
        setError('Lỗi khi tải tin nhắn');
      }
    } catch (error) {
      console.error('Failed to fetch conversation:', error);
      setError('Lỗi khi tải trò chuyện');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return 'Today';
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto">
          {/* Header Skeleton */}
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center space-x-4">
              <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
              <div className="space-y-2">
                <div className="h-6 w-48 bg-gray-200 rounded animate-pulse"></div>
                <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Messages Skeleton */}
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="flex space-x-3">
                <div className="h-8 w-8 bg-gray-200 rounded-full animate-pulse"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
                  <div className="h-16 w-3/4 bg-gray-200 rounded-lg animate-pulse"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Trò chuyện không tồn tại
          </h3>
          <p className="text-gray-500 mb-6">
            Trò chuyện bạn đang tìm kiếm không tồn tại.
          </p>
          <Link
            to="/dashboard/conversations"
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Quay lại trò chuyện
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto">
        {/* Enhanced Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link
                to="/dashboard/conversations"
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to conversations"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </Link>

              <div className="flex-1">
                {/* User Profile Section */}
                {conversation.userProfile && (
                  <div className="flex items-center space-x-3 mb-3">
                    {/* User Avatar */}
                    {conversation.userProfile.profilePicPath && (
                      <img
                        src={getImageUrl(
                          conversation.userProfile.profilePicPath
                        )}
                        alt={conversation.userProfile.fullName || 'User'}
                        className="w-12 h-12 rounded-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    )}
                    {conversation.userProfile &&
                      !conversation.userProfile.profilePicPath && (
                        <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                          <span className="text-lg font-medium text-primary-600">
                            {conversation.userProfile.fullName?.charAt(0) ||
                              conversation.userProfile.externalId.charAt(0)}
                          </span>
                        </div>
                      )}

                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {conversation.userProfile.fullName ||
                          `User ${conversation.userProfile.externalId}`}
                      </h2>
                      <div className="flex items-center space-x-2 text-sm text-gray-500">
                        <span>
                          {conversation.userProfile.platform === 'facebook'
                            ? 'Facebook'
                            : conversation.userProfile.platform}
                        </span>
                        {conversation.userProfile.firstName &&
                          conversation.userProfile.lastName && (
                            <>
                              <span>•</span>
                              <span>
                                {conversation.userProfile.firstName}{' '}
                                {conversation.userProfile.lastName}
                              </span>
                            </>
                          )}
                      </div>
                    </div>
                  </div>
                )}

                <h1 className="text-xl font-semibold text-gray-900 mb-1">
                  {conversation.title || 'Untitled Conversation'}
                </h1>

                <div className="flex items-center space-x-6 text-sm text-gray-500">
                  <div className="flex items-center space-x-1">
                    <CalendarIcon className="h-4 w-4" />
                    <span>{formatDate(conversation.createdAt)}</span>
                  </div>

                  {conversation.chatbot && (
                    <div className="flex items-center space-x-1">
                      <CpuChipIcon className="h-4 w-4" />
                      <span>{conversation.chatbot.name}</span>
                    </div>
                  )}

                  <div className="flex items-center space-x-1">
                    <ChatBubbleLeftRightIcon className="h-4 w-4" />
                    <span>{messages.length} tin nhắn</span>
                  </div>
                </div>
              </div>

              {/* Auto Reply Toggle */}
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">
                    Tự động trả lời:
                  </span>
                  <button
                    onClick={handleToggleAutoReply}
                    disabled={togglingAutoReply}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      conversation?.autoReply
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    } ${togglingAutoReply ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {togglingAutoReply ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>
                    ) : conversation?.autoReply ? (
                      <>
                        <PauseIcon className="h-4 w-4" />
                        <span>Tắt</span>
                      </>
                    ) : (
                      <>
                        <PlayIcon className="h-4 w-4" />
                        <span>Bật</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Context Summary Section */}
        {conversation?.contextSummary && (
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <ContextSummary
              contextSummary={conversation.contextSummary}
              variant="card"
              showHeader={true}
              maxLength={200}
            />
          </div>
        )}

        {/* Messages Container */}
        <div className="bg-white">
          {error ? (
            <div className="p-6 text-center">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-600 mb-3">{error}</p>
                <button
                  onClick={fetchConversation}
                  className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded hover:bg-red-200 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-12 text-center">
              <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Trò chuyện này không có tin nhắn
              </h3>
              <p className="text-gray-500">Trò chuyện này không có tin nhắn.</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {messages.map((message, index) => {
                const isUser = message.role === 'USER';
                const showDate =
                  index === 0 ||
                  formatDate(message.timestamp) !==
                    formatDate(messages[index - 1]?.timestamp);

                return (
                  <div key={message.id}>
                    {/* Date Separator */}
                    {showDate && (
                      <div className="flex items-center justify-center my-6">
                        <div className="bg-gray-100 px-3 py-1 rounded-full">
                          <span className="text-xs text-gray-500 font-medium">
                            {formatDate(message.timestamp)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Message */}
                    <div
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
                    >
                      <div
                        className={`flex items-start space-x-3 max-w-2xl ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
                      >
                        {/* Avatar */}
                        <div
                          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                            isUser
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {isUser ? (
                            <UserIcon className="h-4 w-4" />
                          ) : (
                            <CpuChipIcon className="h-4 w-4" />
                          )}
                        </div>

                        {/* Message Content */}
                        <div
                          className={`flex-1 ${isUser ? 'text-right' : 'text-left'}`}
                        >
                          {message.image ? (
                            <div className="w-[200px] h-auto rounded-2xl overflow-hidden">
                              <img
                                src={getImageUrl(message.image)}
                                alt="img"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div
                              className={`inline-block px-4 py-3 rounded-2xl overflow-hidden ${
                                isUser
                                  ? 'bg-primary-600 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              } ${(message as any).order !== undefined ? 'split-message' : ''} `}
                            >
                              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                                {message.content}
                              </div>

                              <div
                                className={`text-xs mt-2 flex items-center justify-between ${
                                  isUser ? 'text-primary-100' : 'text-gray-500'
                                }`}
                              >
                                <span>{formatTime(message.timestamp)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
