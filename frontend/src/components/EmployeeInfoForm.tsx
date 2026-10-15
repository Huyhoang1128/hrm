import React, { useEffect, useState } from 'react';
import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../utils/api';

// ============================================
// TYPES
// ============================================

type EmployeeInfoFormData = {
  candidate_name: string;
  candidate_email: string;
  gender: 'M' | 'F' | 'O';
  direct_manager_id: string;
};

type ManagerOption = {
  id: string;
  full_name: string;
  employee_id: string;
};

type EmployeeInfoFormProps = {
  onboardingId: number | null;
  isCreatingNew: boolean;
  onSuccess: () => void;
  onCancel: () => void;
};

// ============================================
// MAIN COMPONENT
// ============================================

const EmployeeInfoForm: React.FC<EmployeeInfoFormProps> = ({
  onboardingId,
  isCreatingNew,
  onSuccess,
  onCancel,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(true);

  const [formData, setFormData] = useState<EmployeeInfoFormData>({
    candidate_name: '',
    candidate_email: '',
    gender: 'M',
    direct_manager_id: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof EmployeeInfoFormData, string>>>({});

  // Giữ các cấp bậc quản lý hiện có (bao gồm Leader), loại nhân viên thường và người đã nghỉ.
  useEffect(() => {
    const fetchManagers = async () => {
      setLoadingManagers(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api-hrm/employees/?page_size=1000`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        });
        const data = await res.json();
        const list: ManagerOption[] = (Array.isArray(data) ? data : data.results ?? [])
          .filter((e: any) => {
            const rank = String(e.rank ?? '').trim().toUpperCase();
            const isStaff = ['STAFF', 'NHÂN VIÊN', 'NHAN VIEN'].includes(rank);
            return Boolean(rank)
              && !isStaff
              && e.employment_status !== 'INACTIVE'
              && e.is_active !== false;
          })
          .map((e: any) => ({
            id: String(e.id),
            full_name: e.full_name,
            employee_id: e.employee_id,
          }));
        setManagers(list);
      } catch (err) {
        console.error('Error loading managers:', err);
      } finally {
        setLoadingManagers(false);
      }
    };
    fetchManagers();
  }, []);

  // ============================================
  // VALIDATION
  // ============================================

  const validate = (): boolean => {
    const errs: Partial<Record<keyof EmployeeInfoFormData, string>> = {};
    if (!formData.candidate_name.trim()) errs.candidate_name = 'Vui lòng nhập họ và tên';
    if (!formData.candidate_email.trim()) errs.candidate_email = 'Vui lòng nhập email';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.candidate_email))
      errs.candidate_email = 'Email không hợp lệ';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ============================================
  // SUBMIT
  // ============================================

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload: any = {
        candidate_name: formData.candidate_name,
        full_name: formData.candidate_name,
        gender: formData.gender,
        candidate_email: formData.candidate_email,
        start_date: new Date().toISOString().slice(0, 10),
      };
      if (formData.direct_manager_id) {
        payload.direct_manager_id = parseInt(formData.direct_manager_id);
      }

      const url = isCreatingNew
        ? `${API_BASE_URL}/api-hrm/onboardings/`
        : `${API_BASE_URL}/api-hrm/onboardings/${onboardingId}/submit-employee-info/`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const messages = Object.entries(errorData)
          .map(([f, v]) => `${f}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\n');
        alert(messages || 'Lưu thất bại. Vui lòng thử lại.');
        return;
      }

      onSuccess();
    } catch (err) {
      alert('Có lỗi xảy ra khi kết nối server. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {isCreatingNew ? 'Tạo quy trình onboarding' : 'Điền thông tin nhân sự'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Nhập thông tin cơ bản của nhân viên mới</p>
          </div>
          <button onClick={onCancel} disabled={submitting} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* Họ và tên */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Họ và tên <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.candidate_name ? 'border-red-400' : 'border-gray-300'}`}
              placeholder="Nguyễn Văn A"
              value={formData.candidate_name}
              onChange={(e) => setFormData({ ...formData, candidate_name: e.target.value })}
            />
            {errors.candidate_name && <p className="text-xs text-red-500 mt-1">{errors.candidate_name}</p>}
          </div>

          {/* Giới tính */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Giới tính <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'M' | 'F' | 'O' })}
            >
              <option value="M">Nam</option>
              <option value="F">Nữ</option>
              <option value="O">Khác</option>
            </select>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.candidate_email ? 'border-red-400' : 'border-gray-300'}`}
              placeholder="example@email.com"
              value={formData.candidate_email}
              onChange={(e) => setFormData({ ...formData, candidate_email: e.target.value })}
            />
            {errors.candidate_email && <p className="text-xs text-red-500 mt-1">{errors.candidate_email}</p>}
          </div>

          {/* Quản lý trực tiếp */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quản lý trực tiếp{' '}
              <span className="text-gray-400 text-xs font-normal">(không bắt buộc)</span>
            </label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
              value={formData.direct_manager_id}
              onChange={(e) => setFormData({ ...formData, direct_manager_id: e.target.value })}
              disabled={loadingManagers}
            >
              <option value="">
                {loadingManagers ? 'Đang tải...' : '-- Không có quản lý --'}
              </option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.employee_id})
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            {submitting && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
            {submitting ? 'Đang lưu...' : '✓ Lưu thông tin'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default EmployeeInfoForm;
