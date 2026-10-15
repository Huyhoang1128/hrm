import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../../utils/api';

interface ChangePasswordModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

// ✅ MOVE THIS OUTSIDE - Fix focus loss bug
const PasswordInput = ({ 
  label, 
  name, 
  value, 
  onChange, 
  error, 
  show, 
  onToggleShow 
}: { 
  label: string; 
  name: string; 
  value: string; 
  onChange: (val: string) => void; 
  error?: string; 
  show: boolean; 
  onToggleShow: () => void;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label} <span className="text-red-500">*</span>
    </label>
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          error ? 'border-red-400' : 'border-gray-300'
        }`}
        placeholder="••••••••"
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
      >
        {show ? (
          <EyeSlashIcon className="h-5 w-5" />
        ) : (
          <EyeIcon className="h-5 w-5" />
        )}
      </button>
    </div>
    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
  </div>
);

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ onClose, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [form, setForm] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  });
  
  const [errors, setErrors] = useState<{
    old_password?: string;
    new_password?: string;
    confirm_password?: string;
    general?: string;
  }>({});

  const validate = (): boolean => {
    const errs: typeof errors = {};
    
    if (!form.old_password.trim()) {
      errs.old_password = 'Vui lòng nhập mật khẩu hiện tại';
    }
    
    if (!form.new_password.trim()) {
      errs.new_password = 'Vui lòng nhập mật khẩu mới';
    } else if (form.new_password.length < 8) {
      errs.new_password = 'Mật khẩu mới phải có ít nhất 8 ký tự';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.new_password)) {
      errs.new_password = 'Mật khẩu phải chứa chữ hoa, chữ thường và số';
    }
    
    if (!form.confirm_password.trim()) {
      errs.confirm_password = 'Vui lòng xác nhận mật khẩu mới';
    } else if (form.new_password !== form.confirm_password) {
      errs.confirm_password = 'Mật khẩu xác nhận không khớp';
    }
    
    if (form.old_password && form.new_password && form.old_password === form.new_password) {
      errs.new_password = 'Mật khẩu mới phải khác mật khẩu hiện tại';
    }
    
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    setSubmitting(true);
    setErrors({});

    try {
      const currentToken = localStorage.getItem('accessToken');
      if (!currentToken) {
        setErrors({ general: 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.' });
        return;
      }

      const res = await fetch(`${API_BASE_URL}/api-hrm/change-password/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          old_password: form.old_password,
          new_password: form.new_password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.old_password) {
          setErrors({ old_password: data.old_password[0] || 'Mật khẩu hiện tại không đúng' });
        } else if (data.new_password) {
          setErrors({ new_password: data.new_password[0] || 'Mật khẩu mới không hợp lệ' });
        } else if (data.error) {
          setErrors({ general: data.error });
        } else if (data.detail) {
          setErrors({ general: data.detail });
        } else {
          setErrors({ general: `Đổi mật khẩu thất bại (${res.status})` });
        }
        return;
      }

      onSuccess();
    } catch {
      setErrors({ general: 'Có lỗi xảy ra. Vui lòng thử lại.' });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Đổi mật khẩu</h2>
            <p className="text-xs text-gray-500 mt-0.5">Cập nhật mật khẩu đăng nhập của bạn</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          
          {/* General error */}
          {errors.general && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errors.general}
            </div>
          )}

          {/* Info banner */}
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-xs text-primary-700">
            <p className="font-medium mb-1">📌 Yêu cầu mật khẩu:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Tối thiểu 8 ký tự</li>
              <li>Có chữ hoa, chữ thường và số</li>
              <li>Khác mật khẩu hiện tại</li>
            </ul>
          </div>

          <PasswordInput
            label="Mật khẩu hiện tại"
            name="old_password"
            value={form.old_password}
            onChange={(val) => setForm({ ...form, old_password: val })}
            error={errors.old_password}
            show={showOldPassword}
            onToggleShow={() => setShowOldPassword(!showOldPassword)}
          />

          <PasswordInput
            label="Mật khẩu mới"
            name="new_password"
            value={form.new_password}
            onChange={(val) => setForm({ ...form, new_password: val })}
            error={errors.new_password}
            show={showNewPassword}
            onToggleShow={() => setShowNewPassword(!showNewPassword)}
          />

          <PasswordInput
            label="Xác nhận mật khẩu mới"
            name="confirm_password"
            value={form.confirm_password}
            onChange={(val) => setForm({ ...form, confirm_password: val })}
            error={errors.confirm_password}
            show={showConfirmPassword}
            onToggleShow={() => setShowConfirmPassword(!showConfirmPassword)}
          />

          {/* Footer */}
          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-secondary disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary disabled:opacity-50"
            >
              {submitting ? 'Đang xử lý...' : 'Đổi mật khẩu'}
            </button>
          </div>
        </form>

      </div>
    </div>,
    document.body
  );
};

export default ChangePasswordModal;