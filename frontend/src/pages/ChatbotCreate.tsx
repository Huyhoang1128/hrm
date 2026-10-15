import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeftIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { chatbotsAPI } from '@/utils/api';

export default function ChatbotCreate() {
  const [formData, setFormData] = useState({
    name: '',
    instructions: '',
    avatar_url: '',
    isActive: true,
    goal: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdBotId, setCreatedBotId] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await chatbotsAPI.create({
        name: formData.name,
        instructions: formData.instructions,
        avatarUrl: formData.avatar_url,
        isActive: formData.isActive,
        goal: formData.goal || undefined,
      });

      // Get the created bot ID
      let botId: string;
      if (response.id) {
        botId = response.id;
      } else {
        throw new Error('Failed to get bot ID from response');
      }

      setCreatedBotId(botId);

      // Media is already associated with chatbot during upload
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create chatbot');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = () => {
    navigate('/dashboard/chatbots');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link
          to="/dashboard/chatbots"
          className="text-gray-500 hover:text-gray-700"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tạo trợ lý AI</h1>
          <p className="mt-1 text-sm text-gray-500">Tạo trợ lý AI mới</p>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {!createdBotId ? (
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-6 p-4">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700"
              >
                Tên trợ lý AI *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="input-field mt-1"
                placeholder="Enter chatbot name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>

            <div>
              <label
                htmlFor="instructions"
                className="block text-sm font-medium text-gray-700"
              >
                Hướng dẫn trợ lý AI *
              </label>
              <textarea
                id="instructions"
                name="instructions"
                required
                rows={6}
                className="input-field mt-1"
                placeholder="Nhập hướng dẫn và hành vi của trợ lý AI..."
                value={formData.instructions}
                onChange={(e) =>
                  setFormData({ ...formData, instructions: e.target.value })
                }
              />
              <p className="mt-1 text-sm text-gray-500">
                Mô tả cách trợ lý AI này nên hành xử và trả lời người dùng.
              </p>
            </div>

            <div>
              <label
                htmlFor="avatar_url"
                className="block text-sm font-medium text-gray-700"
              >
                Avatar URL
              </label>
              <input
                type="url"
                id="avatar_url"
                name="avatar_url"
                className="input-field mt-1"
                placeholder="https://example.com/avatar.jpg"
                value={formData.avatar_url}
                onChange={(e) =>
                  setFormData({ ...formData, avatar_url: e.target.value })
                }
              />
              <p className="mt-1 text-sm text-gray-500">
                Tùy chọn: URL ảnh đại diện của trợ lý AI.
              </p>
            </div>

            <div>
              <label
                htmlFor="goal"
                className="block text-sm font-medium text-gray-700"
              >
                Mục tiêu (Tùy chọn)
              </label>
              <textarea
                id="goal"
                name="goal"
                rows={3}
                className="input-field mt-1"
                placeholder="Nhập mục tiêu cho trợ lý AI (ví dụ: 'Thu thập thông tin khách hàng và lên lịch hẹn')..."
                value={formData.goal}
                onChange={(e) =>
                  setFormData({ ...formData, goal: e.target.value })
                }
              />
              <p className="mt-1 text-sm text-gray-500">
                Định nghĩa mục tiêu mà trợ lý AI này cần đạt được. Khi mục tiêu
                được hoàn thành, tự động trả lời sẽ bị vô hiệu hóa.
              </p>
            </div>

            {/* Media Uploader - Disabled until chatbot is created */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Media Library
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">
                  Media upload will be available after creating the chatbot
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="isActive"
                className="block text-sm font-medium text-gray-700"
              >
                Trạng thái
              </label>
              <select
                id="isActive"
                name="isActive"
                className="input-field mt-1"
                value={formData.isActive ? 'active' : 'inactive'}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    isActive: e.target.value === 'active',
                  })
                }
              >
                <option value="active">Hoạt động</option>
                <option value="inactive">Không hoạt động</option>
              </select>
            </div>

            <div className="flex justify-end space-x-3">
              <Link to="/dashboard/chatbots" className="btn-secondary">
                Huỷ bỏ
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Đang tạo...' : 'Tạo trợ lý AI'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Success Message */}
          <div className="card p-4 bg-green-50 border border-green-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-green-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-green-800">
                  Trợ lý AI đã được tạo thành công!
                </h3>
                <p className="mt-1 text-sm text-green-700">
                  Trợ lý AI của bạn đã sẵn sàng sử dụng. Bạn có thể tải lên tài
                  liệu và bắt đầu trò chuyện.
                </p>
              </div>
            </div>
          </div>

          {/* Next Steps */}
          <div className="card">
            <div className="p-4">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                Các bước tiếp theo
              </h2>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-semibold text-sm">
                        1
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">
                      Tải lên tài liệu
                    </h3>
                    <p className="text-sm text-gray-500">
                      Thêm tài liệu kiến thức để giúp trợ lý AI trả lời câu hỏi
                      chính xác hơn.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-semibold text-sm">
                        2
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">
                      Thử nghiệm trò chuyện
                    </h3>
                    <p className="text-sm text-gray-500">
                      Bắt đầu trò chuyện để kiểm tra cách trả lời và hành vi của
                      trợ lý AI.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-semibold text-sm">
                        3
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">
                      Tùy chỉnh cài đặt
                    </h3>
                    <p className="text-sm text-gray-500">
                      Tùy chỉnh hành vi và bộ ngoại hình của trợ lý AI để phù
                      hợp với nhu cầu của bạn.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex space-x-3">
                <Link
                  to={`/dashboard/chatbots/${createdBotId}`}
                  className="btn-primary"
                >
                  Xem trợ lý AI
                </Link>
                <button onClick={handleFinish} className="btn-secondary">
                  Quay lại danh sách trợ lý AI
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
