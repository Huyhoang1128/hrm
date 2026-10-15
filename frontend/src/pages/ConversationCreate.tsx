import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { conversationsAPI, chatbotsAPI } from '@/utils/api';

interface Chatbot {
  id: string;
  name: string;
  instructions: string;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function ConversationCreate() {
  const [formData, setFormData] = useState({
    title: '',
    botId: '',
  });
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingBots, setFetchingBots] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchChatbots();
  }, []);

  const fetchChatbots = async () => {
    try {
      setFetchingBots(true);
      const response = await chatbotsAPI.list();

      // Handle different response formats
      let chatbotsData: any[] = [];

      if (response.chatbots && Array.isArray(response.chatbots)) {
        chatbotsData = response.chatbots;
      } else {
        chatbotsData = [];
      }

      // Filter only active chatbots
      const activeChatbots = chatbotsData.filter((bot) => bot.isActive);
      setChatbots(activeChatbots);
    } catch (error) {
      console.error('Failed to fetch chatbots:', error);
      setError('Failed to load chatbots');
    } finally {
      setFetchingBots(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await conversationsAPI.create({
        title: formData.title || undefined,
        chatbotId: formData.botId || undefined,
      });

      // Get the created conversation ID
      let conversationId: string;
      if (response.id) {
        conversationId = response.id;
      } else {
        throw new Error('Failed to get conversation ID from response');
      }

      // Redirect to conversation detail
      navigate(`/dashboard/conversations/${conversationId}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create conversation');
    } finally {
      setLoading(false);
    }
  };

  if (fetchingBots) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link to="/dashboard/conversations" className="text-gray-500 hover:text-gray-700">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tạo trò chuyện</h1>
          <p className="mt-1 text-sm text-gray-500">
            Bắt đầu một trò chuyện mới với trợ lý AI
          </p>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-6 p-4">
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700"
            >
              Tiêu đề trò chuyện
            </label>
            <input
              type="text"
              id="title"
              name="title"
              className="input-field mt-1"
              placeholder="Nhập tiêu đề trò chuyện (tùy chọn)"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
            />
            <p className="mt-1 text-sm text-gray-500">
              Tùy chọn: Cho trò chuyện của bạn một tiêu đề. Nếu để trống, tiêu
              đề sẽ được tự động tạo.
            </p>
          </div>

          <div>
            <label
              htmlFor="bot_id"
              className="block text-sm font-medium text-gray-700"
            >
              Chọn trợ lý AI *
            </label>
            <select
              id="botId"
              name="botId"
              required
              className="input-field mt-1"
              value={formData.botId}
              onChange={(e) =>
                setFormData({ ...formData, botId: e.target.value })
              }
            >
              <option value="">Chọn trợ lý AI...</option>
              {chatbots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-gray-500">
              Chọn trợ lý AI bạn muốn trò chuyện.
            </p>
          </div>

          {chatbots.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
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
                    Không có trợ lý AI hoạt động
                  </h3>
                  <div className="mt-2 text-sm text-yellow-700">
                    <p>
                      Bạn cần tạo và kích hoạt trợ lý AI trước khi bắt đầu trò
                      chuyện.
                    </p>
                  </div>
                  <div className="mt-4">
                    <div className="-mx-2 -my-1.5 flex">
                      <Link
                        to="/dashboard/chatbots/create"
                        className="bg-yellow-50 px-2 py-1.5 rounded-md text-sm font-medium text-yellow-800 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-yellow-50 focus:ring-yellow-600"
                      >
                        Tạo trợ lý AI
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <Link to="/dashboard/conversations" className="btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || chatbots.length === 0}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Đang tạo...' : 'Bắt đầu trò chuyện'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
