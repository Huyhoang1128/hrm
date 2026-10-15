import React, { useState, useEffect } from 'react';
import { positionsAPI, departmentsAPI, Position, Department } from '../utils/api';
import { useNavigate } from 'react-router-dom';

const PositionCreate: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    code: '',
    description: '',
    department_ids: [] as number[],
    level: '1',
    parent_position: '',
    is_management: 'false',
  });

  useEffect(() => {
    loadDepartments();
    loadPositions();
  }, []);

  const loadDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results || []);
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  const loadPositions = async () => {
    try {
      const response = await positionsAPI.list();
      setPositions(response.results || []);
    } catch (err) {
      console.error('Failed to load positions:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleDepartmentToggle = (departmentId: number) => {
    setFormData((prev) => ({
      ...prev,
      department_ids: prev.department_ids.includes(departmentId)
        ? prev.department_ids.filter((id) => id !== departmentId)
        : [...prev.department_ids, departmentId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title || !formData.code) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc (Chức danh và Mã vị trí)');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const positionData: any = {
        title: formData.title.trim(),
        code: formData.code.trim(),
        level: Number(formData.level),
        is_management: formData.is_management === 'true',
        ...(formData.description && { description: formData.description.trim() }),
        ...(formData.department_ids.length > 0 && { department_ids: formData.department_ids }),
        ...(formData.parent_position && { parent_position: Number(formData.parent_position) }),
      };

      await positionsAPI.create(positionData);
      
      setSuccess('Tạo vị trí thành công!');
      
      setTimeout(() => {
        navigate('/dashboard/positions');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to create position:', err);
      setError(err.response?.data?.message || err.message || 'Lỗi khi tạo vị trí');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/dashboard/positions')}
          className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 mb-4"
        >
          ← Quay lại
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Thêm vị trí mới</h1>
        <p className="text-gray-600 mt-2">Tạo vị trí công việc mới trong tổ chức</p>
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
                Chức danh *
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Trưởng phòng Kinh doanh"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mã vị trí *
              </label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="TPKD"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Mã vị trí phải là duy nhất</p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mô tả công việc
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Mô tả về nhiệm vụ, trách nhiệm của vị trí này..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phòng ban
              </label>
              <div className="w-full border border-gray-300 rounded-lg p-3 max-h-[180px] overflow-y-auto space-y-2">
                {departments.map((dept) => (
                  <label key={dept.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.department_ids.includes(dept.id)}
                      onChange={() => handleDepartmentToggle(dept.id)}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span>{dept.code} - {dept.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">Tick để chọn một hoặc nhiều phòng ban</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cấp bậc
              </label>
              <select
                name="level"
                value={formData.level}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1">Cấp 1 (Thấp nhất)</option>
                <option value="2">Cấp 2</option>
                <option value="3">Cấp 3</option>
                <option value="4">Cấp 4</option>
                <option value="5">Cấp 5</option>
                <option value="6">Cấp 6</option>
                <option value="7">Cấp 7</option>
                <option value="8">Cấp 8</option>
                <option value="9">Cấp 9</option>
                <option value="10">Cấp 10 (Cao nhất)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Cấp bậc càng cao thì vị trí càng quan trọng</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Vị trí cấp trên
              </label>
              <select
                name="parent_position"
                value={formData.parent_position}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Không có (vị trí cao nhất)</option>
                {positions.map((pos) => (
                  <option key={pos.id} value={pos.id}>
                    {pos.code} - {pos.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Loại vị trí
              </label>
              <select
                name="is_management"
                value={formData.is_management}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="false">Vị trí nhân viên</option>
                <option value="true">Vị trí quản lý</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Vị trí quản lý có thể quản lý nhân viên khác</p>
            </div>
          </div>

          <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/dashboard/positions')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Đang tạo...' : 'Tạo vị trí'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PositionCreate;
