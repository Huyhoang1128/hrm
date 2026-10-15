import React, { useState, useEffect } from 'react';
import { sectionsAPI, departmentsAPI, Department } from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const SectionCreate: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
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
    loadDepartments();
  }, []);

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

      await sectionsAPI.create(sectionData);

      setSuccess('Tạo bộ phận thành công!');

      setTimeout(() => {
        navigate('/dashboard/sections');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to create section:', err);
      setError(err.response?.data?.message || err.message || 'Lỗi khi tạo bộ phận');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/dashboard/sections')}
          className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 mb-4"
        >
          ← Quay lại
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Thêm bộ phận mới</h1>
        <p className="text-gray-600 mt-2">Tạo bộ phận mới trực thuộc một phòng ban</p>
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
                Tên bộ phận *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Da liễu, Phẫu thuật..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mã bộ phận *
              </label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="DALIEU"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Mã bộ phận phải là duy nhất</p>
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
              <p className="text-xs text-gray-500 mt-1">Bộ phận phải thuộc về một phòng ban</p>
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
                placeholder="Mô tả về chức năng, nhiệm vụ của bộ phận..."
              />
            </div>

            {/* <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trưởng bộ phận
              </label>
              <select
                name="manager"
                value={formData.manager}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Chưa chỉ định</option>
                <option value="" disabled>Chức năng chọn nhân viên sẽ được thêm sau</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Có thể chỉ định sau khi tạo bộ phận</p>
            </div> */}
          </div>

          <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/dashboard/sections')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Đang tạo...' : 'Tạo bộ phận'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SectionCreate;
