import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { attendanceRuleAPI, departmentsAPI } from '../utils/api';

const LeavePolicyCreate: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<number[]>([]);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    leave_type: 'ANNUAL',
    max_days_per_year: 12,
    max_consecutive_days: 5,
    advance_notice_rules: [
      { max_days: 1, advance_hours: 4, advance_days: null, description: 'Nghỉ dưới 1 ngày: báo trước 4 giờ làm việc' },
      { max_days: 3, advance_hours: null, advance_days: 1, description: 'Nghỉ từ 1-3 ngày: báo trước 1 ngày làm việc' },
      { max_days: 7, advance_hours: null, advance_days: 5, description: 'Nghỉ từ 4-7 ngày: báo trước 5 ngày làm việc' },
      { max_days: null, advance_hours: null, advance_days: 10, description: 'Nghỉ từ 8 ngày trở lên: báo trước 10 ngày làm việc' }
    ],
    emergency_notice_hours: 2,
    requires_approval: true,
    requires_medical_certificate: false,
    apply_to_all: true,
    is_active: true,
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : 
              type === 'number' ? parseFloat(value) : value
    }));
  };

  const handleDepartmentChange = (departmentId: number) => {
    setSelectedDepartments(prev => {
      if (prev.includes(departmentId)) {
        return prev.filter(id => id !== departmentId);
      } else {
        return [...prev, departmentId];
      }
    });
  };

  const handleApplyToAllChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setFormData(prev => ({
      ...prev,
      apply_to_all: checked
    }));
    if (checked) {
      setSelectedDepartments([]);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.code.trim()) {
      newErrors.code = 'Mã chính sách là bắt buộc';
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Tên chính sách là bắt buộc';
    }

    if (!formData.effective_from) {
      newErrors.effective_from = 'Ngày có hiệu lực là bắt buộc';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      
      // Prepare data for API
      const submitData: any = {
        code: formData.code,
        name: formData.name,
        description: formData.description,
        leave_type: formData.leave_type,
        max_days_per_year: formData.max_days_per_year,
        max_consecutive_days: formData.max_consecutive_days,
        advance_notice_rules: formData.advance_notice_rules,
        emergency_notice_hours: formData.emergency_notice_hours,
        requires_approval: formData.requires_approval,
        requires_medical_certificate: formData.requires_medical_certificate,
        apply_to_all: formData.apply_to_all,
        is_active: formData.is_active,
        effective_from: formData.effective_from,
        // Only include effective_to if it has a value
        ...(formData.effective_to && { effective_to: formData.effective_to }),
        apply_to_departments: selectedDepartments,
        apply_to_positions: [],
        apply_to_employees: [],
      };

      await attendanceRuleAPI.createLeavePolicyConfig(submitData);
      alert('Tạo chính sách nghỉ phép thành công!');
      navigate('/dashboard/leave-policies');
    } catch (error: any) {
      console.error('Error creating leave policy:', error);
      const errorData = error.response?.data;
      if (errorData) {
        // Hiển thị lỗi chi tiết
        let errorMessage = 'Không thể tạo chính sách nghỉ phép: ';
        if (typeof errorData === 'object') {
          // Xử lý lỗi validation từ Django
          const errors = Object.entries(errorData)
            .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
            .join('; ');
          errorMessage += errors;
        } else {
          errorMessage += errorData.detail || error.message;
        }
        alert(errorMessage);
      } else {
        alert(`Không thể tạo chính sách nghỉ phép: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/dashboard/leave-policies')}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Quay lại
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Thêm chính sách nghỉ phép mới</h1>
            <p className="mt-1 text-sm text-gray-500">
              Tạo chính sách nghỉ phép mới theo quy định công ty
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                Mã chính sách <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="code"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className={`mt-1 block w-full border ${errors.code ? 'border-red-300' : 'border-gray-300'} rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="VD: ANNUAL_LEAVE_01"
              />
              {errors.code && <p className="mt-1 text-sm text-red-600">{errors.code}</p>}
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Tên chính sách <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className={`mt-1 block w-full border ${errors.name ? 'border-red-300' : 'border-gray-300'} rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="VD: Nghỉ phép năm"
              />
              {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="leave_type" className="block text-sm font-medium text-gray-700">
                Loại nghỉ phép <span className="text-red-500">*</span>
              </label>
              <select
                id="leave_type"
                name="leave_type"
                value={formData.leave_type}
                onChange={handleInputChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              >
                <option value="ANNUAL">Nghỉ phép năm</option>
                <option value="SICK">Nghỉ ốm</option>
                <option value="MATERNITY">Nghỉ thai sản</option>
                <option value="PATERNITY">Nghỉ thai sản chồng</option>
                <option value="UNPAID">Nghỉ không lương</option>
                <option value="COMPASSIONATE">Nghỉ việc riêng</option>
                <option value="STUDY">Nghỉ học tập</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Mô tả
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Mô tả chi tiết về chính sách nghỉ phép..."
              />
            </div>

            <div>
              <label htmlFor="max_days_per_year" className="block text-sm font-medium text-gray-700">
                Số ngày tối đa/năm
              </label>
              <input
                type="number"
                id="max_days_per_year"
                name="max_days_per_year"
                value={formData.max_days_per_year}
                onChange={handleInputChange}
                min="0"
                max="365"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="max_consecutive_days" className="block text-sm font-medium text-gray-700">
                Số ngày liên tiếp tối đa
              </label>
              <input
                type="number"
                id="max_consecutive_days"
                name="max_consecutive_days"
                value={formData.max_consecutive_days}
                onChange={handleInputChange}
                min="0"
                max="365"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="advance_notice_rules" className="block text-sm font-medium text-gray-700">
                Quy định báo trước (JSON)
              </label>
              <textarea
                id="advance_notice_rules"
                name="advance_notice_rules"
                value={JSON.stringify(formData.advance_notice_rules, null, 2)}
                onChange={(e) => {
                  try {
                    const value = JSON.parse(e.target.value);
                    setFormData(prev => ({
                      ...prev,
                      advance_notice_rules: value
                    }));
                  } catch (error) {
                    // Keep current value if invalid JSON
                  }
                }}
                rows={6}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono text-sm"
                placeholder='[{"max_days": 1, "advance_hours": 4, "advance_days": null, "description": "Nghỉ dưới 1 ngày: báo trước 4 giờ làm việc"}, ...]'
              />
              <p className="mt-1 text-sm text-gray-500">
                Định dạng JSON mảng các quy tắc báo trước. Mỗi quy tắc gồm: max_days (số ngày tối đa), advance_hours (số giờ báo trước), advance_days (số ngày báo trước), description (mô tả).
              </p>
            </div>

            <div>
              <label htmlFor="emergency_notice_hours" className="block text-sm font-medium text-gray-700">
                Số giờ báo trước (khẩn cấp)
              </label>
              <input
                type="number"
                id="emergency_notice_hours"
                name="emergency_notice_hours"
                value={formData.emergency_notice_hours}
                onChange={handleInputChange}
                min="0"
                max="168"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
              <p className="mt-1 text-sm text-gray-500">
                Số giờ báo trước tối thiểu cho trường hợp khẩn cấp (ốm đau, việc gia đình cấp bách)
              </p>
            </div>

            <div>
              <label htmlFor="effective_from" className="block text-sm font-medium text-gray-700">
                Ngày có hiệu lực <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="effective_from"
                name="effective_from"
                value={formData.effective_from}
                onChange={handleInputChange}
                className={`mt-1 block w-full border ${errors.effective_from ? 'border-red-300' : 'border-gray-300'} rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
              />
              {errors.effective_from && <p className="mt-1 text-sm text-red-600">{errors.effective_from}</p>}
            </div>

            <div>
              <label htmlFor="effective_to" className="block text-sm font-medium text-gray-700">
                Ngày kết thúc (tùy chọn)
              </label>
              <input
                type="date"
                id="effective_to"
                name="effective_to"
                value={formData.effective_to}
                onChange={handleInputChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>

            <div className="flex items-center">
              <input
                id="requires_approval"
                name="requires_approval"
                type="checkbox"
                checked={formData.requires_approval}
                onChange={handleInputChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="requires_approval" className="ml-2 block text-sm text-gray-900">
                Yêu cầu phê duyệt
              </label>
            </div>

            <div className="flex items-center">
              <input
                id="requires_medical_certificate"
                name="requires_medical_certificate"
                type="checkbox"
                checked={formData.requires_medical_certificate}
                onChange={handleInputChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="requires_medical_certificate" className="ml-2 block text-sm text-gray-900">
                Yêu cầu giấy khám bệnh
              </label>
            </div>

            <div className="flex items-center">
              <input
                id="apply_to_all"
                name="apply_to_all"
                type="checkbox"
                checked={formData.apply_to_all}
                onChange={handleApplyToAllChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="apply_to_all" className="ml-2 block text-sm text-gray-900">
                Áp dụng cho tất cả nhân viên
              </label>
            </div>

            {!formData.apply_to_all && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Chọn phòng ban áp dụng
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-300 rounded-md">
                  {departments.map((dept) => (
                    <div key={dept.id} className="flex items-center">
                      <input
                        id={`dept-${dept.id}`}
                        type="checkbox"
                        checked={selectedDepartments.includes(dept.id)}
                        onChange={() => handleDepartmentChange(dept.id)}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                      />
                      <label htmlFor={`dept-${dept.id}`} className="ml-2 block text-sm text-gray-900">
                        {dept.name} ({dept.code})
                      </label>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Chọn các phòng ban mà chính sách này sẽ áp dụng. Nếu không chọn phòng ban nào, chính sách sẽ không áp dụng cho ai.
                </p>
              </div>
            )}

            <div className="flex items-center">
              <input
                id="is_active"
                name="is_active"
                type="checkbox"
                checked={formData.is_active}
                onChange={handleInputChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                Kích hoạt ngay
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => navigate('/dashboard/leave-policies')}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Đang tạo...' : 'Tạo chính sách'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LeavePolicyCreate;
