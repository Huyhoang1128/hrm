import React, { useEffect, useState } from 'react';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../utils/api';

interface LivestreamAllowanceConfig {
  id: number;
  code: string;
  name: string;
  description: string;
  amount_per_session: number;
  apply_to_all: boolean;
  apply_to_departments: number[];
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
}

interface FormData {
  code: string;
  name: string;
  description: string;
  amount_per_session: number;
  apply_to_all: boolean;
  apply_to_departments: number[];
  effective_from: string;
  effective_to: string;
  is_active: boolean;
}

const INITIAL_FORM: FormData = {
  code: '',
  name: '',
  description: '',
  amount_per_session: 100000,
  apply_to_all: true,
  apply_to_departments: [],
  effective_from: new Date().toISOString().split('T')[0],
  effective_to: '',
  is_active: true,
};

const LIVESTREAM_ALLOWANCE_API = `${API_BASE_URL}/api/v1/hrm/attendance/livestream-allowance-config/`;

const getAuthHeaders = () => {
  const token = localStorage.getItem('accessToken');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
};

export default function LivestreamAllowanceConfigPage() {
  const [configs, setConfigs] = useState<LivestreamAllowanceConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Fetch configs
  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      const response = await fetch(LIVESTREAM_ALLOWANCE_API, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setConfigs(Array.isArray(data) ? data : data.results || []);
    } catch (err) {
      setError('Failed to load configurations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenForm = (config?: LivestreamAllowanceConfig) => {
    if (config) {
      setEditingId(config.id);
      setFormData({
        code: config.code,
        name: config.name,
        description: config.description,
        amount_per_session: config.amount_per_session,
        apply_to_all: config.apply_to_all,
        apply_to_departments: config.apply_to_departments || [],
        effective_from: config.effective_from,
        effective_to: config.effective_to || '',
        is_active: config.is_active,
      });
    } else {
      setEditingId(null);
      setFormData(INITIAL_FORM);
    }
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(INITIAL_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code || !formData.name) {
      setError('Vui lòng điền đầy đủ thông tin');
      return;
    }

    try {
      setLoading(true);
      const url = editingId
        ? `${LIVESTREAM_ALLOWANCE_API}${editingId}/`
        : LIVESTREAM_ALLOWANCE_API;

      const method = editingId ? 'PUT' : 'POST';
      
      // Prepare data: convert empty strings to null for optional date fields
      const submitData = {
        ...formData,
        effective_to: formData.effective_to.trim() === '' ? null : formData.effective_to,
      };

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(submitData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(JSON.stringify(errorData));
      }
      await loadConfigs();
      handleCloseForm();
    } catch (err) {
      setError(`Failed to ${editingId ? 'update' : 'create'} configuration: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setLoading(true);
      const response = await fetch(
        `${LIVESTREAM_ALLOWANCE_API}${id}/`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      );
      if (!response.ok) throw new Error('Failed to delete');
      await loadConfigs();
      setDeleteConfirm(null);
    } catch (err) {
      setError('Failed to delete configuration');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cấu hình Phụ cấp Livestream</h1>
          <p className="text-gray-600 mt-1">Quản lý số tiền phụ cấp cho mỗi phiên livestream</p>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <PlusIcon className="w-5 h-5" />
          Thêm cấu hình
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <ExclamationCircleIcon className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading && !showForm ? (
          <div className="p-8 text-center">Loading...</div>
        ) : configs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Chưa có cấu hình nào</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Mã</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Tên</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Số tiền/phiên
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Hiệu lực
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Trạng thái
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {configs.map((config) => (
                <tr key={config.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{config.code}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{config.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {config.amount_per_session.toLocaleString('vi-VN')} ₫
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {config.effective_from}
                    {config.effective_to && ` → ${config.effective_to}`}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        config.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {config.is_active ? 'Hoạt động' : 'Không hoạt động'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm space-x-2">
                    <button
                      onClick={() => handleOpenForm(config)}
                      className="inline-flex items-center gap-1 px-3 py-1 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <PencilIcon className="w-4 h-4" />
                      Sửa
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(config.id)}
                      className="inline-flex items-center gap-1 px-3 py-1 text-red-600 hover:bg-red-50 rounded"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Chỉnh sửa cấu hình' : 'Thêm cấu hình mới'}
              </h2>
              <button onClick={handleCloseForm} className="text-gray-500 hover:text-gray-700">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mã cấu hình</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên cấu hình</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Số tiền phụ cấp (VNĐ/phiên)
                </label>
                <input
                  type="number"
                  value={formData.amount_per_session}
                  onChange={(e) =>
                    setFormData({ ...formData, amount_per_session: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hiệu lực từ
                </label>
                <input
                  type="date"
                  value={formData.effective_from}
                  onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hiệu lực đến (không bắt buộc)
                </label>
                <input
                  type="date"
                  value={formData.effective_to}
                  onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <label className="ml-2 text-sm text-gray-700">Đang hoạt động</label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="p-6 space-y-4">
              <p className="text-gray-700">Bạn có chắc chắn muốn xóa cấu hình này?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? 'Đang xóa...' : 'Xóa'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
