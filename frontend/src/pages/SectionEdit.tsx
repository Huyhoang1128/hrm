import React, { useState, useEffect } from 'react';
import { sectionsAPI, departmentsAPI, Department } from '../utils/api';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const SectionEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    department: '',
    manager: '',
  });

  useEffect(() => {
    if (id) {
      loadSection();
      loadDepartments();
    }
  }, [id]);

  const loadSection = async () => {
    try {
      setLoadingData(true);
      const section = await sectionsAPI.getById(Number(id));
      setFormData({
        name: section.name || '',
        code: section.code || '',
        description: section.description || '',
        department: section.parent_department?.toString() || '',
        manager: section.manager?.toString() || '',
      });
    } catch (err) {
      console.error('Failed to load section:', err);
      setError('Không thể tải thông tin bộ phận');
    } finally {
      setLoadingData(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results || []);
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.code || !formData.department) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc (Tên, Mã bộ phận và Phòng ban)');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const sectionData: any = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        parent_department: Number(formData.department),
        description: formData.description.trim(),
        ...(formData.manager && { manager: Number(formData.manager) }),
      };

      await sectionsAPI.update(Number(id), sectionData);
      setSuccess('Cập nhật bộ phận thành công!');

      setTimeout(() => {
        navigate('/dashboard/sections');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to update section:', err);
      setError(err.response?.data?.message || err.message || 'Lỗi khi cập nhật bộ phận');
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-sm text-gray-500">Đang tải thông tin bộ phận...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <button
          onClick={() => navigate('/dashboard/sections')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Quay lại danh sách bộ phận
        </button>
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Chỉnh sửa bộ phận</h1>
            <p className="text-sm text-gray-900 mt-0.5">Cập nhật thông tin bộ phận</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-sm text-emerald-700">{success}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tên bộ phận *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="input-field"
                placeholder="Da liễu, Phẫu thuật..."
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Mã bộ phận *
              </label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className="input-field"
                placeholder="DALIEU"
                required
              />
              <p className="text-xs text-gray-400 mt-1">Mã bộ phận phải là duy nhất</p>
            </div>

            <div className="md:col-span-2">
              <SelectBox<string>
                label="Phòng ban *"
                value={formData.department}
                placeholder="-- Chọn phòng ban --"
                searchable
                options={departments.map((dept) => ({
                  value: String(dept.id),
                  label: dept.name,
                }))}
                onChange={(val) => setFormData((prev) => ({ ...prev, department: val }))}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Mô tả
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="input-field"
                placeholder="Mô tả về chức năng, nhiệm vụ của bộ phận..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-5 border-t border-gray-100">
            <button
              type="button"
              onClick={() => navigate('/dashboard/sections')}
              className="btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Đang cập nhật...' : 'Cập nhật bộ phận'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SectionEdit;
