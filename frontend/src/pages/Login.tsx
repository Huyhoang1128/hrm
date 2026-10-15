import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/utils/api';
import FeedbackDialog from '@/components/FeedbackDialog';
import { BRAND } from '@/config/brand';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const, delay: i * 0.1 },
  }),
};

export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, loading, login } = useAuth();

  const [formData, setFormData] = useState({ username: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({ username: '', password: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [serverError, setServerError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  const validate = () => {
    const errors = { username: '', password: '' };
    if (!formData.username.trim()) {
      errors.username = 'Vui lòng nhập tên đăng nhập';
    }
    if (!formData.password) {
      errors.password = 'Vui lòng nhập mật khẩu';
    } else if (formData.password.length < 6) {
      errors.password = 'Mật khẩu phải có ít nhất 6 ký tự';
    }
    return errors;
  };

  const handleChange = (field: 'username' | 'password', value: string) => {
    setFormData({ ...formData, [field]: value });
    if (fieldErrors[field]) {
      setFieldErrors({ ...fieldErrors, [field]: '' });
    }
    if (serverError) setServerError('');
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotId.trim()) return;
    setForgotLoading(true);
    setForgotResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api-hrm/forgot-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: forgotId.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowForgot(false);
        setForgotId('');
        setForgotSuccess(true);
      } else {
        setForgotResult({ ok: false, msg: data.error || 'Có lỗi xảy ra. Vui lòng thử lại.' });
      }
    } catch {
      setForgotResult({ ok: false, msg: 'Không thể kết nối máy chủ. Vui lòng thử lại.' });
    } finally {
      setForgotLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validate();
    if (errors.username || errors.password) {
      setFieldErrors(errors);
      return;
    }
    setIsLoggingIn(true);
    setServerError('');
    try {
      await login(formData.username, formData.password);
      navigate('/home');
    } catch (err: any) {
      setServerError(err.response?.data?.message || 'Tên đăng nhập hoặc mật khẩu không đúng');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-primary-900 px-4 overflow-hidden">
      {/* Dot grid background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)`,
            backgroundSize: '36px 36px',
          }}
        />
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-primary-500 opacity-20 blur-3xl" />
        <div className="absolute top-1/2 right-1/3 w-72 h-72 rounded-full bg-primary-400 opacity-15 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full bg-primary-700 opacity-25 blur-3xl" />
      </div>

      {/* Logo + branding */}
      <motion.div initial="hidden" animate="visible" className="relative z-10 flex flex-col items-center mb-8">
        <motion.div custom={0} variants={fadeUp} className="mb-5">
          <img
            src={BRAND.logoUrl}
            alt={BRAND.appName}
            className="h-16 w-auto max-w-[220px] rounded-xl shadow-xl object-contain"
          />
        </motion.div>
        <motion.p custom={1} variants={fadeUp} className="text-primary-300 text-base mt-1.5">
          Hệ thống Quản lý Nhân sự
        </motion.p>
      </motion.div>

      {/* Card — glassmorphism */}
      <motion.div
        custom={2} variants={fadeUp} initial="hidden" animate="visible"
        className="relative z-10 w-full max-w-sm bg-white/[0.08] backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl p-8"
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Tên đăng nhập */}
          <div>
            <label className="block text-sm font-medium text-primary-200 mb-1.5">
              Tên đăng nhập
            </label>
            <input
              type="text"
              placeholder="Nhập tên đăng nhập"
              autoComplete="username"
              className={`block w-full px-3.5 py-2.5 bg-white/90 border rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition ${
                fieldErrors.username
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-white/30 focus:ring-primary-400'
              }`}
              value={formData.username}
              onChange={(e) => handleChange('username', e.target.value)}
            />
            {fieldErrors.username && (
              <p className="mt-1 text-xs text-red-300">{fieldErrors.username}</p>
            )}
          </div>

          {/* Mật khẩu */}
          <div>
            <label className="block text-sm font-medium text-primary-200 mb-1.5">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Nhập mật khẩu"
                autoComplete="current-password"
                className={`block w-full px-3.5 py-2.5 pr-10 bg-white/90 border rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition ${
                  fieldErrors.password
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-white/30 focus:ring-primary-400'
                }`}
                value={formData.password}
                onChange={(e) => handleChange('password', e.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword
                  ? <EyeSlashIcon className="h-4 w-4 text-primary-400" />
                  : <EyeIcon className="h-4 w-4 text-primary-400" />
                }
              </button>
            </div>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-300">{fieldErrors.password}</p>
            )}
          </div>

          {/* Server error */}
          {serverError && (
            <div className="text-red-300 text-sm bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 active:bg-primary-700 disabled:opacity-60 text-white text-base font-bold rounded-xl transition-colors mt-1 shadow-lg shadow-primary-900/40"
          >
            {isLoggingIn ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => { setShowForgot(true); setForgotResult(null); setForgotId(''); }}
              className="text-sm text-primary-300 hover:text-white transition-colors"
            >
              Quên mật khẩu?
            </button>
          </div>
        </form>
      </motion.div>

      {/* Forgot password dialog */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowForgot(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4"
          >
            {/* Header */}
            <div className="text-center">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary-100 flex items-center justify-center">
                <EyeSlashIcon className="h-6 w-6 text-primary-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Quên mật khẩu</h2>
              <p className="text-sm text-gray-500 mt-1">Nhập mã nhân viên để nhận mật khẩu mới qua email</p>
            </div>

            {/* Form */}
            <form onSubmit={handleForgot} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mã nhân viên</label>
                <input
                  type="text"
                  placeholder="VD: AC123... hoặc HM123..."
                  value={forgotId}
                  autoFocus
                  onChange={e => { setForgotId(e.target.value); setForgotResult(null); }}
                  className="block w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {forgotResult && (
                <div className="px-3 py-2.5 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
                  {forgotResult.msg}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForgot(false); setForgotResult(null); }}
                  className="flex-1 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading || !forgotId.trim()}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 rounded-xl transition-colors"
                >
                  {forgotLoading ? 'Đang gửi...' : 'Gửi mật khẩu mới'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <FeedbackDialog
        open={forgotSuccess}
        variant="success"
        title="Gửi mật khẩu thành công"
        message="Mật khẩu mới đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư."
        okLabel="Đóng"
        onClose={() => setForgotSuccess(false)}
      />
    </div>
  );
}
