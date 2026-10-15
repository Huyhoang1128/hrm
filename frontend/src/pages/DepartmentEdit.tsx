import React, { useState, useEffect } from 'react';
import { departmentsAPI, Department } from '../utils/api';
import { useNavigate, useParams } from 'react-router-dom';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const DepartmentEdit: React.FC = () => {
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
    parent_department: '',
    manager: '',
  });

  useEffect(() => {
    if (id) {
      loadDepartment();
      loadDepartments();
    }
  }, [id]);

  const loadDepartment = async () => {
    try {
      setLoadingData(true);
      const department = await departmentsAPI.getById(Number(id));
      setFormData({
        name: department.name || '',
        code: department.code || '',
        description: department.description || '',
        parent_department: department.parent_department?.toString() || '',
        manager: department.manager?.toString() || '',
      });
    } catch (err) {
      console.error('Failed to load department:', err);
      setError('Không thể tải thông tin phòng ban');
    } finally {
      setLoadingData(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      // Filter out current department from parent options to avoid circular reference
      const filteredDepartments = response.results?.filter(dept => dept.id !== Number(id)) || [];
      setDepartments(filteredDepartments);
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.code) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc (Tên và Mã phòng ban)');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const departmentData: any = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        ...(formData.description && { description: formData.description.trim() }),
        ...(formData.parent_department && { parent_department: Number(formData.parent_department) }),
        ...(formData.manager && { manager: Number(formData.manager) }),
      };

      await departmentsAPI.update(Number(id), departmentData);
      
      setSuccess('Cập nhật phòng ban thành công!');
      
      setTimeout(() => {
        navigate('/dashboard/departments');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to update department:', err);
      setError(err.response?.data?.message || err.message || 'Lỗi khi cập nhật phòng ban');
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Đang tải thông tin phòng ban...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/dashboard/departments')}
          className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 mb-4"
        >
          ← Quay lại
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Chỉnh sửa phòng ban</h1>
        <p className="text-gray-600 mt-2">Cập nhật thông tin phòng ban</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-700">{success}</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tên phòng ban *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Phòng Kinh doanh"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mã phòng ban *
              </label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="KD"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Mã phòng ban phải là duy nhất</p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mô tả
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Mô tả về chức năng, nhiệm vụ của phòng ban..."
              />
            </div>

            <div>
              <SelectBox<string>
                label="Phòng ban cha"
                value={formData.parent_department}
                options={[
                  { value: '', label: 'Không có (phòng ban cấp cao nhất)' },
                  ...departments.map((dept) => ({ value: String(dept.id), label: `${dept.code} - ${dept.name}` })),
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, parent_department: v }))}
              />
              <p className="text-xs text-gray-500 mt-1">Chọn phòng ban cấp trên nếu có</p>
            </div>

            <div>
              <SelectBox<string>
                label="Trưởng phòng"
                value={formData.manager}
                options={[
                  { value: '', label: 'Chưa chỉ định' },
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, manager: v }))}
              />
              <p className="text-xs text-gray-500 mt-1">Có thể chỉ định sau khi cập nhật phòng ban</p>
            </div>
          </div>

          <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/dashboard/departments')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Đang cập nhật...' : 'Cập nhật phòng ban'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DepartmentEdit;
