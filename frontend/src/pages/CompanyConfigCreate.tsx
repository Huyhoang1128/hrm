import React, { useState } from 'react';
import { companyConfigAPI, CompanyConfig } from '../utils/api';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  ClockIcon,
  CalendarDaysIcon,
  BriefcaseIcon,
} from '@heroicons/react/24/outline';

const CompanyConfigCreate: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<CompanyConfig>>({
    code: '',
    name: '',
    description: '',
    default_working_hours_per_day: 8,
    default_working_days_per_week: 5,
    overtime_multiplier_weekday: 1.5,
    overtime_multiplier_weekend: 2.0,
    overtime_multiplier_holiday: 3.0,
    late_threshold_minutes: 15,
    early_leave_threshold_minutes: 15,
    half_day_threshold_hours: 4,
    annual_leave_days_per_year: 12,
    sick_leave_days_per_year: 12,
    maternity_leave_days: 180,
    paternity_leave_days: 14,
    is_active: true,
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else if (type === 'number') {
      setFormData(prev => ({
        ...prev,
        [name]: value === '' ? '' : Number(value)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.code || !formData.name || !formData.effective_from) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc (Mã, Tên, Ngày hiệu lực)');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const configData: Partial<CompanyConfig> = {
        code: formData.code.trim(),
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        default_working_hours_per_day: Number(formData.default_working_hours_per_day) || 8,
        default_working_days_per_week: Number(formData.default_working_days_per_week) || 5,
        overtime_multiplier_weekday: Number(formData.overtime_multiplier_weekday) || 1.5,
        overtime_multiplier_weekend: Number(formData.overtime_multiplier_weekend) || 2.0,
        overtime_multiplier_holiday: Number(formData.overtime_multiplier_holiday) || 3.0,
        late_threshold_minutes: Number(formData.late_threshold_minutes) || 15,
        early_leave_threshold_minutes: Number(formData.early_leave_threshold_minutes) || 15,
        half_day_threshold_hours: Number(formData.half_day_threshold_hours) || 4,
        annual_leave_days_per_year: Number(formData.annual_leave_days_per_year) || 12,
        sick_leave_days_per_year: Number(formData.sick_leave_days_per_year) || 12,
        maternity_leave_days: Number(formData.maternity_leave_days) || 180,
        paternity_leave_days: Number(formData.paternity_leave_days) || 14,
        is_active: formData.is_active !== false,
        effective_from: formData.effective_from,
        effective_to: formData.effective_to || undefined,
      };

      await companyConfigAPI.createCompanyConfig(configData);

      setSuccess('Tạo cấu hình công ty thành công!');

      setTimeout(() => {
        navigate('/dashboard/company-configs');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to create company config:', err);
      setError(err.response?.data?.message || err.message || 'Lỗi khi tạo cấu hình công ty');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/dashboard/company-configs')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Quay lại
        </button>
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              Thêm cấu hình công ty mới
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Tạo cấu hình giờ làm việc, ngày nghỉ lễ và các chính sách công ty
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm font-medium text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-sm font-medium text-emerald-800">{success}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Thông tin cơ bản */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <BriefcaseIcon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Thông tin cơ bản</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Mã cấu hình <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleInputChange}
                className="input-field"
                placeholder="CONFIG_2024"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Tên cấu hình <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="input-field"
                placeholder="Cấu hình công ty 2024"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Mô tả
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="input-field resize-none"
                placeholder="Mô tả về cấu hình công ty..."
              />
            </div>
          </div>
        </div>

        {/* Giờ & Ngày làm việc */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <ClockIcon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Giờ & Ngày làm việc</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Giờ làm việc/ngày <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="default_working_hours_per_day"
                value={formData.default_working_hours_per_day}
                onChange={handleInputChange}
                min="1"
                max="24"
                step="0.5"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày làm việc/tuần <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="default_working_days_per_week"
                value={formData.default_working_days_per_week}
                onChange={handleInputChange}
                min="1"
                max="7"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngưỡng trễ (phút) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="late_threshold_minutes"
                value={formData.late_threshold_minutes}
                onChange={handleInputChange}
                min="0"
                max="240"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngưỡng về sớm (phút) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="early_leave_threshold_minutes"
                value={formData.early_leave_threshold_minutes}
                onChange={handleInputChange}
                min="0"
                max="240"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngưỡng nửa ngày (giờ) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="half_day_threshold_hours"
                value={formData.half_day_threshold_hours}
                onChange={handleInputChange}
                min="0"
                max="12"
                step="0.5"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>

        {/* Hệ số làm thêm giờ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <Cog6ToothIcon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Hệ số làm thêm giờ (OT)</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Hệ số OT ngày thường <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="overtime_multiplier_weekday"
                value={formData.overtime_multiplier_weekday}
                onChange={handleInputChange}
                min="1"
                max="10"
                step="0.1"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Hệ số OT cuối tuần <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="overtime_multiplier_weekend"
                value={formData.overtime_multiplier_weekend}
                onChange={handleInputChange}
                min="1"
                max="10"
                step="0.1"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Hệ số OT ngày lễ <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="overtime_multiplier_holiday"
                value={formData.overtime_multiplier_holiday}
                onChange={handleInputChange}
                min="1"
                max="10"
                step="0.1"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>

        {/* Chính sách nghỉ phép */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center">
              <CalendarDaysIcon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Chính sách nghỉ phép</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày nghỉ phép/năm <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="annual_leave_days_per_year"
                value={formData.annual_leave_days_per_year}
                onChange={handleInputChange}
                min="0"
                max="365"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày nghỉ ốm/năm <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="sick_leave_days_per_year"
                value={formData.sick_leave_days_per_year}
                onChange={handleInputChange}
                min="0"
                max="365"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày nghỉ thai sản <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="maternity_leave_days"
                value={formData.maternity_leave_days}
                onChange={handleInputChange}
                min="0"
                max="365"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày nghỉ thai sản chồng <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="paternity_leave_days"
                value={formData.paternity_leave_days}
                onChange={handleInputChange}
                min="0"
                max="365"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Số lần giải trình tối đa/tháng <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="max_explanation_count_per_month"
                value={formData.max_explanation_count_per_month}
                onChange={handleInputChange}
                min="0"
                max="100"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Số giờ bổ sung công tối đa/tháng <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="supplement_work_hours_per_month"
                value={formData.supplement_work_hours_per_month}
                onChange={handleInputChange}
                min="0"
                max="200"
                step="0.5"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>

        {/* Hiệu lực & Trạng thái */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-gray-100 text-gray-600 rounded-xl flex items-center justify-center">
              <CalendarDaysIcon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Hiệu lực & Trạng thái</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày hiệu lực từ <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="effective_from"
                value={formData.effective_from}
                onChange={handleInputChange}
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Ngày hiệu lực đến
              </label>
              <input
                type="date"
                name="effective_to"
                value={formData.effective_to}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  name="is_active"
                  id="is_active"
                  checked={formData.is_active !== false}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="text-sm font-semibold text-gray-700">Kích hoạt</span>
              </label>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate('/dashboard/company-configs')}
            className="btn-secondary"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary disabled:opacity-50"
          >
            {loading ? 'Đang tạo...' : 'Tạo cấu hình'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CompanyConfigCreate;
