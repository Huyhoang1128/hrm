import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { chatbotsAPI, mediaAPI } from '@/utils/api';
import DocumentSelector from '@/components/DocumentSelector';
import MediaUploader from '@/components/MediaUploader';

import { Chatbot } from '@/utils/api';

export default function ChatbotEdit() {
  const { id } = useParams<{ id: string }>();
  const [chatbot, setChatbot] = useState<Chatbot | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    instructions: '',
    avatarUrl: '',
    isActive: false,
    goal: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [mediaChanges, setMediaChanges] = useState<{
    toUpload: File[];
    toDelete: string[];
  }>({ toUpload: [], toDelete: [] });

  const handleMediaChanges = (changes: {
    toUpload: File[];
    toDelete: string[];
  }) => {
    setMediaChanges(changes);
  };

  useEffect(() => {
    if (id) {
      fetchChatbot();
    }
  }, [id]);

  const fetchChatbot = async () => {
    try {
      const response = await chatbotsAPI.getById(id!);

      // Handle different response formats
      let chatbotData: Chatbot;
      chatbotData = response;

      setChatbot(chatbotData);
      setFormData({
        name: chatbotData.name,
        instructions: chatbotData.instructions || '',
        avatarUrl: chatbotData.avatarUrl || '',
        isActive: chatbotData.isActive,
        goal: chatbotData.goal || '',
      });
    } catch (error) {
      console.error('Failed to fetch chatbot:', error);
      setError('Failed to load chatbot');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      const updateData = {
        name: formData.name,
        instructions: formData.instructions,
        avatarUrl: formData.avatarUrl,
        isActive: formData.isActive,
        goal: formData.goal || undefined,
      };

      await chatbotsAPI.update(id!, updateData);

      // Handle media changes
      if (
        mediaChanges.toUpload.length > 0 ||
        mediaChanges.toDelete.length > 0
      ) {
        try {
          // Upload new files
          if (mediaChanges.toUpload.length > 0) {
            await Promise.all(
              mediaChanges.toUpload.map((file) =>
                mediaAPI.upload(file, id!, ['chatbot-media'], '', true)
              )
            );
          }

          // Delete marked media
          if (mediaChanges.toDelete.length > 0) {
            await Promise.all(
              mediaChanges.toDelete.map((mediaId) => mediaAPI.delete(mediaId))
            );
          }
        } catch (err) {
          console.error('Failed to process media changes:', err);
          // Don't throw error here, chatbot update was successful
        }
      }

      // Show success message and reload page
      setSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update chatbot');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!chatbot) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900">
          Trợ lý AI không tồn tại
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Trợ lý AI bạn đang tìm kiếm không tồn tại.
        </p>
        <div className="mt-6">
          <Link to="/dashboard/chatbots" className="btn-primary">
            Quay lại danh sách trợ lý AI
          </Link>
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-bold text-gray-900">
            Chỉnh sửa trợ lý AI
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Cập nhật cài đặt trợ lý AI
          </p>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {success && (
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
                Cập nhật thành công!
              </h3>
              <p className="mt-1 text-sm text-green-700">
                Trợ lý AI đã được cập nhật. Trang sẽ tự động tải lại...
              </p>
            </div>
          </div>
        </div>
      )}

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
              placeholder="Enter chatbot instructions and behavior..."
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
              placeholder="Enter the goal for this chatbot (e.g., 'Collect customer information and schedule appointment')"
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

          {id && (
            <MediaUploader
              chatbotId={id}
              maxFiles={10}
              onMediaChanges={handleMediaChanges}
            />
          )}

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
              Hủy bỏ
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>

      {/* Document Selector */}
      <div className="card">
        <div className="p-4">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            Quản lý tài liệu
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Đính kèm hoặc bỏ đính kèm tài liệu để cung cấp kiến thức cho trợ lý
            AI này. Trợ lý AI sẽ sử dụng các tài liệu này để trả lời câu hỏi
            chính xác hơn.
          </p>
          <DocumentSelector botId={id!} />
        </div>
      </div>
    </div>
  );
}
