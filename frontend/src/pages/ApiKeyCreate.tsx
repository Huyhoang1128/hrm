import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeSlashIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { apiKeysAPI, chatbotsAPI, Chatbot } from '@/utils/api';

export default function ApiKeyCreate() {
  const [formData, setFormData] = useState({
    name: '',
    chatbot: '',
  });
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingChatbots, setLoadingChatbots] = useState(true);
  const [error, setError] = useState('');
  const [showBotDropdown, setShowBotDropdown] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const navigate = useNavigate();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch chatbots on component mount
  useEffect(() => {
    fetchChatbots();
  }, []);

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowBotDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchChatbots = async () => {
    try {
      setLoadingChatbots(true);
      const response = await chatbotsAPI.list({ isActive: true });
      setChatbots(response.chatbots);
    } catch (err: any) {
      console.error('Failed to fetch chatbots:', err);
      setError('Không thể tải trợ lý AI');
    } finally {
      setLoadingChatbots(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!formData.chatbot) {
      setError('Vui lòng chọn trợ lý AI');
      setLoading(false);
      return;
    }

    try {
      const newApiKey = await apiKeysAPI.create({
        name: formData.name,
        chatbot: formData.chatbot,
      });

      // Show the created API key
      if (newApiKey.key) {
        setCreatedApiKey(newApiKey.key);
      } else {
        // Redirect to API keys list if no key returned
        navigate('/dashboard/api-keys');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tạo API key');
    } finally {
      setLoading(false);
    }
  };

  const selectedBot = chatbots.find((bot) => bot.id === formData.chatbot);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
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

  // If API key was created, show success screen
  if (createdApiKey) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Link to="/dashboard/api-keys" className="text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              API Key đã được tạo
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              API key của bạn đã được tạo thành công
            </p>
          </div>
        </div>

        <div className="card p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckIcon className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              API Key đã được tạo thành công!
            </h2>
            <p className="text-sm text-gray-600">
              Vui lòng sao chép API key của bạn. Nó sẽ không được hiển thị lại.
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your API Key
                </label>
                <div className="flex items-center space-x-2">
                  <code className="flex-1 text-sm bg-white px-3 py-2 rounded border font-mono">
                    {showKey ? createdApiKey : maskApiKey(createdApiKey)}
                  </code>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="text-gray-400 hover:text-gray-600 p-1"
                    title={showKey ? 'Hide' : 'Show'}
                  >
                    {showKey ? (
                      <EyeSlashIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => copyToClipboard(createdApiKey)}
                    className={`${
                      copySuccess
                        ? 'text-green-600'
                        : 'text-gray-400 hover:text-gray-600'
                    } p-1 transition-colors`}
                    title={
                      copySuccess ? 'Đã sao chép!' : 'Sao chép vào clipboard'
                    }
                  >
                    {copySuccess ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <ClipboardDocumentIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-yellow-900 mb-2">
              ⚠️ Lưu ý quan trọng về bảo mật
            </h3>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• Sao chép và lưu trữ API key trong một vị trí an toàn</li>
              <li>• API key này sẽ không được hiển thị lại</li>
              <li>• Giữ API key này bí mật và không chia sẻ công khai</li>
              <li>
                • Bạn có thể hủy API key này bất cứ lúc nào từ trang API Keys
              </li>
            </ul>
          </div>

          <div className="flex justify-end space-x-3">
            <Link to="/dashboard/api-keys" className="btn-secondary">
              Quay lại trang API Keys
            </Link>
            <Link to="/dashboard/api-keys/create" className="btn-primary">
              Tạo API Key khác
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link to="/dashboard/api-keys" className="text-gray-500 hover:text-gray-700">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tạo API Key</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tạo mới một API key cho truy cập ngoài với một trợ lý AI cụ thể
          </p>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="card p-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              Tên API Key *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              className="input-field mt-1"
              placeholder="Enter API key name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
            />
            <p className="mt-1 text-sm text-gray-500">
              Cho API key của bạn một tên mô tả để dễ dàng nhận biết.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Chọn trợ lý AI *
            </label>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowBotDropdown(!showBotDropdown)}
                className={`w-full flex items-center justify-between px-3 py-2 border rounded-md shadow-sm text-left ${
                  selectedBot
                    ? 'border-gray-300 bg-white text-gray-900'
                    : 'border-gray-300 bg-white text-gray-500'
                } focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500`}
                disabled={loadingChatbots}
              >
                {loadingChatbots ? (
                  <span className="text-gray-500">Đang tải trợ lý AI...</span>
                ) : selectedBot ? (
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                      <span className="text-sm font-medium text-primary-600">
                        {selectedBot.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {selectedBot.name}
                      </div>
                      {selectedBot.description && (
                        <div className="text-xs text-gray-500">
                          {selectedBot.description}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <span>Chọn trợ lý AI</span>
                )}
                <ChevronDownIcon className="h-5 w-5 text-gray-400" />
              </button>

              {showBotDropdown && !loadingChatbots && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                  {chatbots.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      Không tìm thấy trợ lý AI nào đang hoạt động
                    </div>
                  ) : (
                    chatbots.map((bot) => (
                      <button
                        key={bot.id}
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, chatbot: bot.id });
                          setShowBotDropdown(false);
                        }}
                        className="w-full flex items-center space-x-3 px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                      >
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-primary-600">
                            {bot.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {bot.name}
                          </div>
                          {bot.description && (
                            <div className="text-xs text-gray-500 truncate">
                              {bot.description}
                            </div>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Chọn trợ lý AI mà API key này sẽ có quyền truy cập.
            </p>
          </div>


          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-2">
              Lưu ý quan trọng về bảo mật
            </h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>
                • API keys cung cấp quyền truy cập cho trợ lý AI được chọn
              </li>
              <li>• Giữ API keys của bạn an toàn và không chia sẻ chúng</li>
              <li>• Bạn có thể hủy API keys bất cứ lúc nào</li>
              <li>• API keys chỉ được hiển thị một lần khi được tạo</li>
            </ul>
          </div>

          <div className="flex justify-end space-x-3">
            <Link to="/dashboard/api-keys" className="btn-secondary">
              Hủy
            </Link>
            <button
              type="submit"
              disabled={loading || !formData.chatbot}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Đang tạo...' : 'Tạo API Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
