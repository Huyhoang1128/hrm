import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  UserIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  DocumentIcon,
  CogIcon,
  ExclamationTriangleIcon,
  CalendarIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { usersAPI } from '../utils/api';

interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Activity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  metadata?: any;
}

interface ActivityStats {
  totalConversations: number;
  totalMessages: number;
  totalDocuments: number;
  lastActivity: string;
  chatbotsCreated: number;
  apiKeysCreated: number;
}

const UserActivity: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('7d'); // 7d, 30d, 90d, all

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id, selectedPeriod]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load user data
      const userData = await usersAPI.getById(id!);
      setUser(userData);

      // Load user activities
      const activitiesData = await usersAPI.getActivities(id!, {
        period: selectedPeriod,
      });
      setActivities(activitiesData.activities || []);

      // Load user stats
      const statsData = await usersAPI.getActivityStats(id!);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Lỗi khi tải dữ liệu hoạt động');
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type: string) => {
    const icons: { [key: string]: any } = {
      conversation_created: ChatBubbleLeftRightIcon,
      message_sent: ChatBubbleLeftRightIcon,
      document_uploaded: DocumentIcon,
      chatbot_created: CogIcon,
      api_key_created: CogIcon,
      login: EyeIcon,
      profile_updated: PencilIcon,
      user_deleted: TrashIcon,
      user_created: PlusIcon,
    };
    return icons[type] || ClockIcon;
  };

  const getActivityColor = (type: string) => {
    const colors: { [key: string]: string } = {
      conversation_created: 'text-blue-600 bg-blue-100',
      message_sent: 'text-green-600 bg-green-100',
      document_uploaded: 'text-purple-600 bg-purple-100',
      chatbot_created: 'text-indigo-600 bg-indigo-100',
      api_key_created: 'text-yellow-600 bg-yellow-100',
      login: 'text-gray-600 bg-gray-100',
      profile_updated: 'text-orange-600 bg-orange-100',
      user_deleted: 'text-red-600 bg-red-100',
      user_created: 'text-emerald-600 bg-emerald-100',
    };
    return colors[type] || 'text-gray-600 bg-gray-100';
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) {
      return 'Vừa xong';
    } else if (diffInHours < 24) {
      return `${diffInHours} giờ trước`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      if (diffInDays < 7) {
        return `${diffInDays} ngày trước`;
      } else {
        return date.toLocaleDateString('vi-VN');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-lg shadow p-6">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="space-y-4">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Không tìm thấy người dùng
            </h2>
            <p className="text-gray-600 mb-6">
              Người dùng bạn đang tìm kiếm không tồn tại.
            </p>
            <button
              onClick={() => navigate('/dashboard/users')}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Quay lại danh sách
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(`/dashboard/users/${id}`)}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Quay lại
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Hoạt động người dùng
                </h1>
                <p className="mt-2 text-gray-600">
                  Xem hoạt động của {user.username}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="7d">7 ngày qua</option>
                <option value="30d">30 ngày qua</option>
                <option value="90d">90 ngày qua</option>
                <option value="all">Tất cả</option>
              </select>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-red-800">Lỗi</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* User Info */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <UserIcon className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.username}
                </h3>
                <p className="text-sm text-gray-600">{user.email}</p>
                <div className="flex items-center space-x-2 mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      user.role === 'ADMIN'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {user.role}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      user.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {user.isActive ? 'Hoạt động' : 'Không hoạt động'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Activity Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ChatBubbleLeftRightIcon className="h-8 w-8 text-blue-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">
                    Cuộc hội thoại
                  </p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stats.totalConversations}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DocumentIcon className="h-8 w-8 text-green-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Tin nhắn</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stats.totalMessages}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DocumentIcon className="h-8 w-8 text-purple-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Tài liệu</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stats.totalDocuments}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CogIcon className="h-8 w-8 text-indigo-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Chatbot</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stats.chatbotsCreated}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Activity Timeline */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-gray-900">
                Lịch sử hoạt động
              </h3>
              {stats?.lastActivity && (
                <div className="flex items-center text-sm text-gray-500">
                  <CalendarIcon className="h-4 w-4 mr-1" />
                  Hoạt động cuối: {formatTimestamp(stats.lastActivity)}
                </div>
              )}
            </div>

            {activities.length > 0 ? (
              <div className="flow-root">
                <ul className="-mb-8">
                  {activities.map((activity, activityIdx) => {
                    const Icon = getActivityIcon(activity.type);
                    const iconColor = getActivityColor(activity.type);

                    return (
                      <li key={activity.id}>
                        <div className="relative pb-8">
                          {activityIdx !== activities.length - 1 ? (
                            <span
                              className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                              aria-hidden="true"
                            />
                          ) : null}
                          <div className="relative flex space-x-3">
                            <div>
                              <span
                                className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${iconColor}`}
                              >
                                <Icon className="h-5 w-5" aria-hidden="true" />
                              </span>
                            </div>
                            <div className="min-w-0 flex-1 pt-1.5 flex justify-between space-x-4">
                              <div>
                                <p className="text-sm text-gray-500">
                                  {activity.description}
                                </p>
                              </div>
                              <div className="text-right text-sm whitespace-nowrap text-gray-500">
                                <time dateTime={activity.timestamp}>
                                  {formatTimestamp(activity.timestamp)}
                                </time>
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="text-center py-8">
                <ClockIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Chưa có hoạt động
                </h3>
                <p className="text-gray-600">
                  Người dùng này chưa có hoạt động nào trong khoảng thời gian đã
                  chọn.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserActivity;
