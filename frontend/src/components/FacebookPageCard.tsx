import React, { useMemo, useState } from 'react';
import {
  EyeIcon,
  UsersIcon,
  GlobeAltIcon,
  CalendarIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { FacebookPage } from '../utils/api';

interface FacebookPageCardProps {
  page: FacebookPage;
  onConnectBot?: (pageId: string) => void;
  onViewDetails?: (pageId: string) => void;
  onDisconnectBot?: (pageId: string) => void;
}

const FacebookPageCard: React.FC<FacebookPageCardProps> = ({
  page,
  onConnectBot,
  onViewDetails,
  onDisconnectBot,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const getPermissionBadgeColor = (permission: string) => {
    const colors: { [key: string]: string } = {
      pages_read_engagement: 'bg-blue-100 text-blue-800',
      pages_manage_posts: 'bg-green-100 text-green-800',
      pages_show_list: 'bg-purple-100 text-purple-800',
      pages_manage_metadata: 'bg-yellow-100 text-yellow-800',
      pages_manage_instant_articles: 'bg-indigo-100 text-indigo-800',
      pages_manage_ads: 'bg-orange-100 text-orange-800',
      pages_manage_events: 'bg-pink-100 text-pink-800',
    };
    return colors[permission] || 'bg-gray-100 text-gray-800';
  };

  const formatPermissionName = (permission: string) => {
    return permission
      .replace(/_/g, ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const permissions = useMemo(() => page.permissions ?? [], [page]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {/* Page Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
            {page.picture?.data?.url ? (
              <img
                src={page.picture.data.url}
                alt={page.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
            ) : (
              <GlobeAltIcon className="h-6 w-6 text-gray-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate">
              {page.name}
            </h3>
            <p className="text-sm text-gray-500">{page.category}</p>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            {showDetails ? (
              <ChevronUpIcon className="h-5 w-5" />
            ) : (
              <ChevronDownIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Page Details */}
      <div className="p-6">
        <div className="space-y-4">
          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Trạng thái</span>
            <div className="flex items-center space-x-1">
              <div
                className={`w-2 h-2 rounded-full ${page.isActive ? 'bg-green-500' : 'bg-red-500'}`}
              ></div>
              <span
                className={`text-sm font-medium ${page.isActive ? 'text-green-600' : 'text-red-600'}`}
              >
                {page.isActive ? 'Hoạt động' : 'Không hoạt động'}
              </span>
            </div>
          </div>

          {/* Bot Connection Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Bot</span>
            <div className="flex items-center space-x-1">
              <div
                className={`w-2 h-2 rounded-full ${page.botId ? 'bg-green-500' : 'bg-gray-400'}`}
              ></div>
              <span
                className={`text-sm font-medium ${page.botId ? 'text-green-600' : 'text-gray-600'}`}
              >
                {page.botId ? 'Đã kết nối' : 'Không kết nối'}
              </span>
            </div>
          </div>

          {/* Permissions Preview */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Quyền</h4>
            <div className="flex flex-wrap gap-1">
              {permissions.slice(0, 3).map((permission) => (
                <span
                  key={permission}
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getPermissionBadgeColor(permission)}`}
                >
                  {formatPermissionName(permission)}
                </span>
              ))}
              {permissions.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  +{permissions.length - 3} more
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={() => onViewDetails?.(page.id)}
              className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <EyeIcon className="h-4 w-4 mr-1" />
              Xem chi tiết
            </button>
            {page.botId ? (
              <>
                <button
                  onClick={() => onConnectBot?.(page.id)}
                  className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-green-300 rounded-md text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  <UsersIcon className="h-4 w-4 mr-1" />
                  Thay đổi trợ lý AI
                </button>
                <button
                  onClick={() => onDisconnectBot?.(page.id)}
                  className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  <XCircleIcon className="h-4 w-4 mr-1" />
                  Huỷ kết nối
                </button>
              </>
            ) : (
              <button
                onClick={() => onConnectBot?.(page.id)}
                className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <UsersIcon className="h-4 w-4 mr-1" />
                Kết nối trợ lý AI
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {showDetails && (
        <div className="border-t border-gray-100 p-6 bg-gray-50">
          <div className="space-y-4">
            {/* Page ID */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-1">
                ID trang
              </h4>
              <p className="text-sm text-gray-600 font-mono">{page.id}</p>
            </div>

            {/* All Permissions */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2">
                Tất cả quyền
              </h4>
              <div className="flex flex-wrap gap-1">
                {permissions.map((permission) => (
                  <span
                    key={permission}
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getPermissionBadgeColor(permission)}`}
                  >
                    {formatPermissionName(permission)}
                  </span>
                ))}
              </div>
            </div>

            {/* Tasks */}
            {page.tasks && page.tasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">
                  Nhiệm vụ
                </h4>
                <div className="flex flex-wrap gap-1">
                  {page.tasks.map((task) => (
                    <span
                      key={task}
                      className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800"
                    >
                      {task}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Category List */}
            {page.categoryList && page.categoryList.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">
                  Danh mục
                </h4>
                <div className="flex flex-wrap gap-1">
                  {page.categoryList.map((category) => (
                    <span
                      key={category.id}
                      className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                    >
                      {category.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Connection Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-1">
                  Đã kết nối
                </h4>
                <div className="flex items-center space-x-1">
                  {page.isActive ? (
                    <CheckCircleIcon className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircleIcon className="h-4 w-4 text-red-500" />
                  )}
                  <span className="text-sm text-gray-600">
                    {page.isActive ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-1">
                  Trợ lý AI đã kết nối
                </h4>
                <div className="flex items-center space-x-1">
                  {page.botId ? (
                    <CheckCircleIcon className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircleIcon className="h-4 w-4 text-gray-400" />
                  )}
                  <span className="text-sm text-gray-600">
                    {page.botId ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-1">
                Cập nhật gần nhất
              </h4>
              <div className="flex items-center space-x-1">
                <CalendarIcon className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {new Date(page.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacebookPageCard;
