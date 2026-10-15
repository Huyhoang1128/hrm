import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { attendanceRuleAPI, departmentsAPI } from '../utils/api';

const AttendanceRuleCreate: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<number[]>([]);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    rule_type: 'SHIFT_RULE',
    configuration: JSON.stringify({
      start_time: '08:30',
      end_time: '17:30',
      work_hours: 8,
      late_threshold_minutes: 15,
      early_leave_threshold_minutes: 15,
    }),
    apply_to_all: true,
    is_active: true,
    is_default: false,
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
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
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
      newErrors.code = 'Mã quy tắc là bắt buộc';
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Tên quy tắc là bắt buộc';
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
        rule_type: formData.rule_type,
        configuration: JSON.parse(formData.configuration),
        apply_to_all: formData.apply_to_all,
        is_active: formData.is_active,
        is_default: formData.is_default,
        effective_from: formData.effective_from,
        // Only include effective_to if it has a value
        ...(formData.effective_to && { effective_to: formData.effective_to }),
        apply_to_departments: selectedDepartments,
        apply_to_positions: [],
        apply_to_employees: [],
      };

      await attendanceRuleAPI.createAttendanceRuleConfig(submitData);
      alert('Tạo quy tắc chấm công thành công!');
      navigate('/dashboard/attendance-rules');
    } catch (error: any) {
      console.error('Error creating attendance rule:', error);
      const errorData = error.response?.data;
      if (errorData) {
        // Hiển thị lỗi chi tiết
        let errorMessage = 'Không thể tạo quy tắc chấm công: ';
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
        alert(`Không thể tạo quy tắc chấm công: ${error.message}`);
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
            onClick={() => navigate('/dashboard/attendance-rules')}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Quay lại
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Thêm quy tắc chấm công mới</h1>
            <p className="mt-1 text-sm text-gray-500">
              Tạo quy tắc chấm công mới theo ca làm việc
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                Mã quy tắc <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="code"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className={`mt-1 block w-full border ${errors.code ? 'border-red-300' : 'border-gray-300'} rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="VD: SHIFT_HC_01"
              />
              {errors.code && <p className="mt-1 text-sm text-red-600">{errors.code}</p>}
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Tên quy tắc <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className={`mt-1 block w-full border ${errors.name ? 'border-red-300' : 'border-gray-300'} rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="VD: Ca hành chính"
              />
              {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="rule_type" className="block text-sm font-medium text-gray-700">
                Loại quy tắc <span className="text-red-500">*</span>
              </label>
              <select
                id="rule_type"
                name="rule_type"
                value={formData.rule_type}
                onChange={handleInputChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              >
                <option value="SHIFT_RULE">Quy tắc ca làm việc</option>
                <option value="LATE_EARLY_RULE">Đi muộn/Về sớm</option>
                <option value="WORK_HOUR_CALCULATION">Tính giờ làm việc</option>
                <option value="OVERTIME_RULE">Làm thêm giờ</option>
                <option value="BREAK_TIME_RULE">Giờ nghỉ</option>
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
                placeholder="Mô tả chi tiết về quy tắc..."
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="configuration" className="block text-sm font-medium text-gray-700">
                Cấu hình (JSON)
              </label>
              <textarea
                id="configuration"
                name="configuration"
                value={formData.configuration}
                onChange={handleInputChange}
                rows={6}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono text-sm"
                placeholder='{"start_time": "08:30", "end_time": "17:30", "work_hours": 8}'
              />
              <p className="mt-1 text-sm text-gray-500">
                Nhập cấu hình dưới dạng JSON. Ví dụ cho ca hành chính.
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
                  Chọn các phòng ban mà quy tắc này sẽ áp dụng. Nếu không chọn phòng ban nào, quy tắc sẽ không áp dụng cho ai.
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

            <div className="flex items-center">
              <input
                id="is_default"
                name="is_default"
                type="checkbox"
                checked={formData.is_default}
                onChange={handleInputChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="is_default" className="ml-2 block text-sm text-gray-900">
                Làm mặc định
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => navigate('/dashboard/attendance-rules')}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Đang tạo...' : 'Tạo quy tắc'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AttendanceRuleCreate;
