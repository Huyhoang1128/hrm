import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { positionsAPI, employeesAPI, companyUnitsAPI, managementApi } from '../utils/api';
import {
  ArrowPathIcon,
  LinkIcon,
  EnvelopeIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  XMarkIcon,
  UserPlusIcon,
  UsersIcon,
  XCircleIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';
import onboardingService from '../services/onboarding.service';
import { useAuth } from '../contexts/AuthContext';
import Pagination from '../components/Pagination';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import { useDebounce } from '../hooks/useDebounce';
import FeedbackDialog, { FeedbackVariant } from '../components/FeedbackDialog';

// ============================================
// TYPES
// ============================================

type TokenStatus = 'not_generated' | 'active' | 'expired' | 'completed';

type OnboardingItem = {
  id: number;
  onboarding_code?: string | null;
  employee_id?: string | null;        // ✅ thêm mã nhân viên
  candidate_name: string;
  candidate_email?: string | null;
  position?: { id: number; title: string; code: string } | null;
  department?: { id: number; name: string; code: string } | null;
  department_name?: string | null;
  start_date: string;
  status?: string | null;
  progress_percentage?: number | string | null;
  full_name?: string | null;
  position_title?: string | null;
  token_status?: TokenStatus | null;
  token_expires_at?: string | null;
  employee_form_url?: string | null;
  employee_info_completed?: boolean;
  task1_status?: string; // PENDING, IN_PROGRESS, COMPLETED
};

// ── Bỏ candidate_phone, thêm direct_manager_id ──
type CreateOnboardingForm = {
  candidate_name: string;
  gender: 'M' | 'F' | 'O';
  candidate_email: string;
  direct_manager_id: string;
  company_unit: string;
};

type EmployeeOption = {
  id: number;
  full_name: string;
  employee_id: string;
};

type ApiResponse<T> = { results?: T[]; count?: number } | T[];

const getProgressPercentage = (value?: number | string | null): number => {
  if (value == null) return 0;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const getStatusBadge = (status?: string | null) => {
  const map: Record<string, { label: string; color: string }> = {
    DRAFT: { label: 'Nháp', color: 'bg-gray-100 text-gray-700' },
    PENDING: { label: 'Chờ xử lý', color: 'bg-amber-100 text-amber-600' },
    IN_PROGRESS: { label: 'Đang thực hiện', color: 'bg-primary-100 text-primary-600' },
    COMPLETED: { label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-600' },
    CANCELLED: { label: 'Đã hủy', color: 'bg-red-100 text-red-700' },
  };
  if (!status) return null;
  const cfg = map[status] ?? map.DRAFT;
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
};


// ============================================
// CREATE ONBOARDING MODAL
// ============================================

type CreateModalProps = {
  onClose: () => void;
  onSuccess: () => void;
  initial?: Partial<CreateOnboardingForm>;
};

const CreateOnboardingModal: React.FC<CreateModalProps> = ({ onClose, onSuccess, initial }) => {
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [companyUnits, setCompanyUnits] = useState<Array<{ id: number; name: string; prefix_code?: string; code: string }>>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [feedback, setFeedback] = useState<{ open: boolean; variant: FeedbackVariant; title: string; message?: string; onCloseCb?: () => void }>({ open: false, variant: 'info', title: '' });
  const showFeedback = (variant: FeedbackVariant, title: string, message?: string, onCloseCb?: () => void) =>
    setFeedback({ open: true, variant, title, message, onCloseCb });
  const closeFeedback = () => {
    const cb = feedback.onCloseCb;
    setFeedback(f => ({ ...f, open: false, onCloseCb: undefined }));
    cb?.();
  };

  const [form, setForm] = useState<CreateOnboardingForm>({
    candidate_name: initial?.candidate_name ?? '',
    gender: initial?.gender ?? 'M',
    candidate_email: initial?.candidate_email ?? '',
    direct_manager_id: initial?.direct_manager_id ?? '',
    company_unit: initial?.company_unit ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CreateOnboardingForm, string>>>({});

  useEffect(() => {
    const fetchManagers = async () => {
      setLoadingEmployees(true);
      try {
        const posData = await positionsAPI.list({ is_management: true, page_size: 100 });
        const managementPositions = posData.results ?? [];
        if (managementPositions.length === 0) {
          setEmployees([]);
          setLoadingEmployees(false);
          return;
        }
        const empRequests = managementPositions.map((pos) =>
          employeesAPI.list({ position: pos.id, page_size: 1000 })
        );
        const empResults = await Promise.all(empRequests);
        const seenIds = new Set<number>();
        const list: EmployeeOption[] = [];
        for (const result of empResults) {
          for (const e of result.results ?? []) {
            if (!seenIds.has(e.id)) {
              seenIds.add(e.id);
              list.push({ id: e.id, full_name: e.full_name, employee_id: e.employee_id });
            }
          }
        }
        setEmployees(list);
      } catch (err) {
        console.error('Failed to load managers:', err);
      } finally {
        setLoadingEmployees(false);
      }
    };
    const fetchUnits = async () => {
      setLoadingUnits(true);
      try {
        const res = await companyUnitsAPI.list({ page_size: 100, active_only: true });
        setCompanyUnits(res.results ?? []);
      } catch (err) {
        console.error('Failed to load company units:', err);
      } finally {
        setLoadingUnits(false);
      }
    };

    fetchManagers();
    fetchUnits();
  }, []);

  const validate = (): boolean => {
    const errs: Partial<Record<keyof CreateOnboardingForm, string>> = {};
    if (!form.candidate_name.trim()) errs.candidate_name = 'Vui lòng nhập họ và tên';
    else if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(form.candidate_name.trim())) errs.candidate_name = 'Họ tên không được chứa số hoặc ký tự đặc biệt';
    else if (form.candidate_name.trim().length > 50) errs.candidate_name = 'Họ tên tối đa 50 ký tự';
    if (!form.candidate_email.trim()) errs.candidate_email = 'Vui lòng nhập email';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.candidate_email))
      errs.candidate_email = 'Email không hợp lệ';
    if (!form.company_unit) errs.company_unit = 'Vui lòng chọn đơn vị làm việc';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload: any = {
        candidate_name: form.candidate_name,
        full_name: form.candidate_name,
        gender: form.gender,
        candidate_email: form.candidate_email,
        start_date: new Date().toISOString().slice(0, 10),
      };
      if (form.direct_manager_id) {
        payload.direct_manager_id = parseInt(form.direct_manager_id);
      }
      if (form.company_unit) {
        payload.company_unit = parseInt(form.company_unit);
      }
      await onboardingService.create(payload);
      showFeedback('success', 'Tạo quy trình thành công', undefined, onSuccess);
    } catch (e: any) {
      console.error(e);
      const errData = e.response?.data || {};
      let msg = 'Tạo quy trình thất bại. Vui lòng thử lại.';
      if (errData.non_field_errors) {
        msg = Array.isArray(errData.non_field_errors)
          ? errData.non_field_errors[0]
          : errData.non_field_errors;
      } else if (typeof errData === 'string') {
        msg = errData;
      } else if (errData.detail) {
        msg = errData.detail;
      }
      showFeedback('error', 'Tạo quy trình thất bại', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const field = (
    key: keyof CreateOnboardingForm,
    label: string,
    required: boolean,
    input: React.ReactNode
  ) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {input}
      {errors[key] && <p className="text-xs text-red-500 mt-1">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-100 rounded-xl flex items-center justify-center">
              <UserPlusIcon className="w-4 h-4 text-primary-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Tạo quy trình onboarding</h2>
              <p className="text-xs text-gray-500">Nhân viên sẽ tự điền thông tin chi tiết qua link riêng</p>
            </div>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-3 text-xs text-primary-700">
            <p className="font-medium mb-1">📋 Quy trình 2 bước:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>HR điền thông tin cơ bản bên dưới → Tạo quy trình</li>
              <li>Tạo link → Gửi cho nhân viên tự điền thông tin chi tiết</li>
            </ol>
          </div>

          {field('candidate_name', 'Họ và tên', true,
            <input
              type="text"
              maxLength={50}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${errors.candidate_name ? 'border-red-400' : 'border-gray-200'}`}
              placeholder="Nguyễn Văn A"
              value={form.candidate_name}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, candidate_name: v });
                if (v && !/^[a-zA-ZÀ-ỹ\s]+$/.test(v)) setErrors(prev => ({ ...prev, candidate_name: 'Không được chứa số hoặc ký tự đặc biệt' }));
                else if (v.length > 50) setErrors(prev => ({ ...prev, candidate_name: 'Tối đa 50 ký tự' }));
                else setErrors(prev => { const { candidate_name, ...rest } = prev; return rest; });
              }}
            />
          )}

          {field('gender', 'Giới tính', true,
            <SelectBox
              label=""
              value={form.gender}
              options={[
                { value: 'M', label: 'Nam' },
                { value: 'F', label: 'Nữ' },
                { value: 'O', label: 'Khác' },
              ]}
              onChange={(v) => setForm({ ...form, gender: v as 'M' | 'F' | 'O' })}
            />
          )}

          {field('candidate_email', 'Email', true,
            <input
              type="email"
              maxLength={100}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${errors.candidate_email ? 'border-red-400' : 'border-gray-200'}`}
              placeholder="example@email.com"
              value={form.candidate_email}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, candidate_email: v });
                if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) setErrors(prev => ({ ...prev, candidate_email: 'Email không hợp lệ' }));
                else setErrors(prev => { const { candidate_email, ...rest } = prev; return rest; });
              }}
            />
          )}

          {field('company_unit', 'Đơn vị làm việc', true,
            <SelectBox
              label=""
              value={form.company_unit}
              options={companyUnits.map((u) => ({
                value: String(u.id),
                label: `${u.name} (${u.prefix_code || u.code || 'N/A'})`
              }))}
              onChange={(v) => setForm({ ...form, company_unit: v })}
              searchable
              placeholder={loadingUnits ? 'Đang tải...' : 'Chọn đơn vị làm việc'}
            />
          )}

          {field('direct_manager_id', 'Quản lý trực tiếp', false,
            <SelectBox
              label=""
              value={form.direct_manager_id}
              options={employees.map((e) => ({ value: String(e.id), label: `${e.full_name} (${e.employee_id})` }))}
              onChange={(v) => setForm({ ...form, direct_manager_id: v })}
              searchable
              placeholder={loadingEmployees ? 'Đang tải...' : 'Chọn quản lý trực tiếp'}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary"
          >
            Hủy
          </button>
          {(() => {
            const nameValid = form.candidate_name.trim().length > 0 && /^[a-zA-ZÀ-ỹ\s]+$/.test(form.candidate_name.trim()) && form.candidate_name.trim().length <= 50;
            const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.candidate_email.trim());
            const unitValid = !!form.company_unit;
            const isFormValid = nameValid && emailValid && unitValid && Object.keys(errors).length === 0;
            return (
              <button
                onClick={handleSubmit}
                disabled={submitting || !isFormValid}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                {submitting ? 'Đang tạo...' : 'Tạo quy trình'}
              </button>
            );
          })()}
        </div>
      </div>
      <FeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        message={feedback.message}
        onClose={closeFeedback}
      />
    </div>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHR =
    user?.employee_profile?.is_hr === true ||
    user?.hrm_user?.is_hr === true ||
    (user as any)?.is_super_admin === true ||
    (user as any)?.role === 'admin';

  const [onboardings, setOnboardings] = useState<OnboardingItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [tokenLoading, setTokenLoading] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInitial, setCreateInitial] = useState<Partial<CreateOnboardingForm> | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();

  // Tự mở modal Tạo quy trình khi điều hướng từ tab Phỏng vấn
  useEffect(() => {
    if (searchParams.get('openCreate') === '1') {
      const genderRaw = searchParams.get('gender') || '';
      const gender: 'M' | 'F' | 'O' =
        genderRaw === 'F' ? 'F' : genderRaw === 'O' ? 'O' : 'M';
      setCreateInitial({
        candidate_name: searchParams.get('name') || '',
        gender,
        candidate_email: searchParams.get('email') || '',
        direct_manager_id: searchParams.get('manager') || '',
      });
      setShowCreateModal(true);
      const next = new URLSearchParams(searchParams);
      ['openCreate', 'name', 'gender', 'email', 'manager'].forEach((k) => next.delete(k));
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [feedback, setFeedback] = useState<{ open: boolean; variant: FeedbackVariant; title: string; message?: string }>({ open: false, variant: 'info', title: '' });
  const showFeedback = (variant: FeedbackVariant, title: string, message?: string) =>
    setFeedback({ open: true, variant, title, message });

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<number>(0);
  const [filterPosition, setFilterPosition] = useState<number | ''>('');
  type PositionOption = { id: number; title: string };
  const [positionOptions, setPositionOptions] = useState<PositionOption[]>([]);

  // Lấy danh sách tất cả vị trí (không chỉ vị trí quản lý) cho bộ lọc
  useEffect(() => {
    (async () => {
      try {
        const res = await positionsAPI.list({ page_size: 500 });
        const list: PositionOption[] = (res.results ?? []).map((p: any) => ({
          id: p.id,
          title: p.title,
        }));
        list.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
        setPositionOptions(list);
      } catch {
        setPositionOptions([]);
      }
    })();
  }, []);
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [filterSearch, setFilterSearch] = useState<string>('');
  const debouncedSearch = useDebounce(filterSearch, 400);

  // ✅ Pagination — dùng cùng pattern với EmployeeList
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Thống kê phân loại onboarding (tổng / nghỉ sớm / pass thử việc / theo vị trí)
  type StatsByPosition = { position: string; count: number };
  type OnboardingStats = {
    total: number;
    quit_within_3_days: number;
    quit_within_7_days: number;
    passed_probation: number;
    by_position: StatsByPosition[];
  };
  const [stats, setStats] = useState<OnboardingStats | null>(null);

  const fetchStats = async () => {
    try {
      const params: Record<string, any> = {};
      if (filterStatus) params.status = filterStatus;
      if (filterMonth > 0) {
        params.month = filterMonth;
        params.year = filterYear;
      }
      if (filterPosition) params.position = filterPosition;
      const res = await managementApi.get('/api-hrm/onboarding-processes/stats/', { params });
      setStats(res.data);
    } catch {
      setStats(null);
    }
  };

  const fetchOnboardings = async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof onboardingService.list>[0] = {
        page: currentPage,
        page_size: itemsPerPage,
      };
      if (filterStatus) params.status = filterStatus;
      if (filterMonth > 0) {
        params.month = filterMonth;
        params.year = filterYear;
      }
      if (filterPosition) (params as any).position = filterPosition;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const data = await onboardingService.list(params);
      const items = Array.isArray(data) ? data : data.results ?? [];
      setTotalCount(Array.isArray(data) ? items.length : (data.count ?? items.length));
      setOnboardings(
        items.map((item) => ({
          ...item,
          full_name: item.candidate_name || item.full_name || 'N/A',
          position_title: item.position_name || item.position_title || 'N/A',
          department_name: item.department_name || 'N/A',
          progress_percentage: getProgressPercentage(item.progress_percentage),
        }))
      );
    } catch (e) {
      console.error(e);
      showFeedback('error', 'Không thể tải danh sách', 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
    // Đồng bộ stats khi list refresh (create / delete / sync)
    fetchStats();
  };

  useEffect(() => {
    fetchOnboardings();
  }, [filterStatus, filterMonth, filterYear, filterPosition, debouncedSearch, currentPage, itemsPerPage]);

  const isWaitingEmployeeFill = (item: OnboardingItem) => item.token_status === 'active';

  const handleDelete = async (item: OnboardingItem) => {
    if (!isWaitingEmployeeFill(item)) {
      showFeedback('warning', 'Không thể xoá', 'Chỉ được xoá onboarding khi đang ở trạng thái Chờ nhân viên điền.');
      return;
    }
    if (!confirm('Bạn chắc chắn muốn xoá quy trình này?')) return;
    setDeletingId(item.id);
    try {
      await onboardingService.delete(item.id);
      showFeedback('success', 'Xoá thành công');
      await fetchOnboardings();
    } catch (e) {
      console.error(e);
      showFeedback('error', 'Xoá thất bại', 'Vui lòng thử lại.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleGenerateToken = async (item: OnboardingItem) => {
    setTokenLoading(item.id);
    try {
      const tokenResult = await onboardingService.generateToken(item.id);
      const { employee_form_url } = tokenResult.data;
      setOnboardings(prev =>
        prev.map(o =>
          o.id === item.id
            ? { ...o, token_status: 'active', employee_form_url }
            : o
        )
      );
      showFeedback('success', 'Tạo link thành công', 'Bạn có thể copy hoặc gửi email cho nhân viên.');
    } catch (e: any) {
      console.error(e);
      const msg = e.response?.data?.message || 'Tạo link thất bại. Vui lòng thử lại.';
      showFeedback('error', 'Tạo link thất bại', msg);
    } finally {
      setTokenLoading(null);
    }
  };

  const handleSyncLegacyTasks = async () => {
    if (!confirm('Bạn có chắc muốn quét & tự động tạo 4 bước Task mặc định cho toàn bộ hồ sơ cũ? Thao tác này sẽ đồng bộ hóa kiến trúc dữ liệu lịch sử ngay lập tức.')) {
      return;
    }
    setSyncLoading(true);
    try {
      const res = await onboardingService.syncLegacyTasks();
      showFeedback('success', 'Đồng bộ thành công', res.message);
      await fetchOnboardings();
    } catch (e: any) {
      console.error(e);
      const msg = e.response?.data?.message || 'Có lỗi xảy ra khi đồng bộ dữ liệu.';
      showFeedback('error', 'Lỗi đồng bộ', msg);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSendEmail = async (item: OnboardingItem) => {
    if (!item.candidate_email) {
      showFeedback('warning', 'Chưa có email', 'Ứng viên chưa có email. Vui lòng cập nhật thông tin trước.');
      return;
    }
    setTokenLoading(item.id);
    try {
      await onboardingService.sendEmployeeEmail(item.id);
      showFeedback('success', 'Gửi email thành công', `Đã gửi email đến ${item.candidate_email}`);
    } catch (e) {
      console.error(e);
      showFeedback('error', 'Gửi email thất bại', 'Kiểm tra cấu hình email hoặc thử lại.');
    } finally {
      setTokenLoading(null);
    }
  };

  const handleResendWelcomeEmail = async (item: OnboardingItem) => {
    if (!item.candidate_email) {
      showFeedback('warning', 'Chưa có email', 'Ứng viên chưa có email. Vui lòng cập nhật thông tin trước.');
      return;
    }
    if (!confirm(`Gửi lại email chào mừng đến ${item.candidate_email}?`)) return;
    setTokenLoading(item.id);
    try {
      await onboardingService.resendWelcomeEmail(item.id);
      showFeedback('success', 'Gửi email thành công', `Đã gửi lại email chào mừng đến ${item.candidate_email}`);
    } catch (e: any) {
      console.error(e);
      showFeedback('error', 'Gửi email thất bại', e.message || 'Vui lòng kiểm tra log hoặc thử lại.');
    } finally {
      setTokenLoading(null);
    }
  };

  const handleCopyLink = async (item: OnboardingItem) => {
    const url = item.employee_form_url;
    if (!url) { showFeedback('warning', 'Chưa có link', 'Hãy tạo link trước.'); return; }
    try {
      await navigator.clipboard.writeText(url);
      showFeedback('success', 'Đã copy link vào clipboard!');
    } catch {
      prompt('Copy link này và gửi cho nhân viên:', url);
    }
  };

  const renderTokenActions = (item: OnboardingItem) => {
    const isLoading = tokenLoading === item.id;
    const resendEmailButton = item.candidate_email ? (
      <button
        onClick={() => handleResendWelcomeEmail(item)}
        disabled={isLoading}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 disabled:opacity-50"
        title="Gửi lại email chào mừng với thông tin đăng nhập"
      >
        {isLoading ? (
          <ArrowPathIcon className="w-3 h-3 animate-spin" />
        ) : (
          <EnvelopeIcon className="w-3 h-3" />
        )}
        Gửi lại email
      </button>
    ) : null;

    // 1. Đã điền thông tin (task hoàn thành hoặc token đã được dùng)
    if (item.task1_status === 'COMPLETED' || item.token_status === 'completed') {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-600">
            <CheckCircleIcon className="w-3 h-3" /> Đã điền thông tin
          </span>
          {resendEmailButton}
        </div>
      );
    }

    // 2. Chờ nhân viên điền (link còn hạn)
    if (item.token_status === 'active') {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-600">
            <ClockIcon className="w-3 h-3" /> Chờ nhân viên điền
          </span>
          {resendEmailButton}
          <button
            onClick={() => handleCopyLink(item)}
            disabled={isLoading}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
          >
            <ClipboardDocumentIcon className="w-3 h-3" /> Copy link
          </button>
        </div>
      );
    }

    const generateButton = (
      <button
        onClick={() => handleGenerateToken(item)}
        disabled={isLoading}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-primary-50 text-primary-600 border border-primary-200 hover:bg-primary-100 disabled:opacity-50"
      >
        {isLoading ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <LinkIcon className="w-3 h-3" />}
        {item.token_status === 'expired' ? 'Tạo lại link' : 'Tạo link'}
      </button>
    );

    // 3. Link hết hạn
    if (item.token_status === 'expired') {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <ExclamationCircleIcon className="w-3 h-3" /> Link hết hạn
          </span>
          {generateButton}
        </div>
      );
    }

    // 4. Chưa gửi link
    return (
      <div className="flex flex-col gap-1.5">
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
          Chưa gửi link
        </span>
        {generateButton}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Onboard nhân sự</h1>
            <p className="text-sm text-gray-900 mt-0.5">Quản lý quy trình tuyển dụng và onboarding nhân viên mới.</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start gap-3 bg-primary-50 border border-primary-100 rounded-2xl p-4">
          <div className="w-8 h-8 bg-primary-600 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">HR</span>
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Luồng HR</p>
            <p className="text-gray-500 text-xs mt-0.5">
              Điền thông tin cơ bản → Tạo quy trình → Tạo link → Gửi email cho nhân viên
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <div className="w-8 h-8 bg-emerald-600 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">NV</span>
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Luồng Nhân viên mới</p>
            <p className="text-gray-500 text-xs mt-0.5">
              Nhận link → Không cần đăng nhập → Tự điền đầy đủ thông tin cá nhân
            </p>
          </div>
        </div>
      </div>

      {/* ── Thống kê phân loại onboarding ── */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <UsersIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Tổng số onboarding</p>
              <p className="text-xl font-bold text-gray-900">{stats.total}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <XCircleIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Nghỉ trong 3 ngày</p>
              <p className="text-xl font-bold text-red-600">{stats.quit_within_3_days}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <XCircleIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Nghỉ trong 7 ngày</p>
              <p className="text-xl font-bold text-amber-600">{stats.quit_within_7_days}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <TrophyIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Pass thử việc</p>
              <p className="text-xl font-bold text-emerald-600">{stats.passed_probation}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Breakdown theo vị trí tuyển dụng ── */}
      {stats && stats.by_position.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Phân loại theo vị trí tuyển dụng
          </p>
          <div className="flex flex-wrap gap-2">
            {stats.by_position.map((p) => (
              <span
                key={p.position}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-sm"
              >
                <span className="text-gray-700">{p.position}</span>
                <span className="font-bold text-indigo-700">{p.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {/* Table header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Quy trình onboarding</h2>
            <p className="text-xs text-gray-700">
              Tổng: {totalCount} ứng viên đang trong quá trình onboarding
            </p>
          </div>
          {isHR && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <UserPlusIcon className="w-4 h-4" />
              Tạo quy trình mới
            </button>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="w-44">
            <SelectBox
              label="Trạng thái"
              value={filterStatus}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                { value: 'DRAFT', label: 'Nháp' },
                { value: 'IN_PROGRESS', label: 'Đang thực hiện' },
                { value: 'COMPLETED', label: 'Hoàn thành' },
              ]}
              onChange={(v) => { setFilterStatus(v); setCurrentPage(1); }}
            />
          </div>
          <div className="w-40">
            <SelectBox
              label="Tháng"
              value={filterMonth}
              options={[
                { value: 0, label: 'Tất cả tháng' },
                ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Tháng ${i + 1}` })),
              ]}
              onChange={(v) => { setFilterMonth(v); setCurrentPage(1); }}
            />
          </div>
          {filterMonth > 0 && (
            <div className="w-32">
              <SelectBox
                label="Năm"
                value={filterYear}
                options={Array.from({ length: 5 }, (_, i) => {
                  const y = new Date().getFullYear() - i;
                  return { value: y, label: String(y) };
                })}
                onChange={(v) => { setFilterYear(v); setCurrentPage(1); }}
              />
            </div>
          )}
          <div className="w-56">
            <SelectBox
              label="Vị trí tuyển dụng"
              value={filterPosition}
              searchable
              options={[
                { value: '', label: 'Tất cả vị trí' },
                ...positionOptions.map((p) => ({ value: p.id, label: p.title })),
              ]}
              onChange={(v) => {
                setFilterPosition(v === '' ? '' : Number(v));
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="relative">
            <label className="block text-sm font-medium mb-1 text-gray-700">Tìm kiếm</label>
            <div className="relative">
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => { setFilterSearch(e.target.value); }}
                placeholder="Tìm tên hoặc mã NV..."
                className="input-field pl-8 w-52"
              />
              <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {(filterStatus !== '' || filterMonth > 0 || filterPosition !== '' || filterSearch !== '') && (
            <button
              onClick={() => {
                setFilterStatus('');
                setFilterMonth(0);
                setFilterPosition('');
                setFilterSearch('');
                setCurrentPage(1);
              }}
              className="btn-secondary"
            >
              Xóa bộ lọc
            </button>
          )}

          {isHR && (
            <button
              onClick={handleSyncLegacyTasks}
              disabled={syncLoading}
              className="ml-auto px-3 py-2 text-sm bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-700 rounded-xl flex items-center gap-1.5 disabled:opacity-50 font-medium transition-all active:scale-95"
              title="Tự động bổ sung 4 task mặc định cho người cũ và khóa Task 1 nếu đã duyệt."
            >
              <ArrowPathIcon className={`w-4 h-4 ${syncLoading ? 'animate-spin' : ''}`} />
              {syncLoading ? 'Đang xử lý...' : 'Đồng bộ người cũ'}
            </button>
          )}

          <button
            onClick={() => fetchOnboardings()}
            disabled={loading}
            className={`${isHR ? 'ml-0' : 'ml-auto'} btn-secondary flex items-center gap-1.5 disabled:opacity-50`}
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>

        {/* Table */}
        <div className="border border-gray-100 rounded-2xl overflow-x-auto w-full">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {/* ✅ Đổi "Mã onboarding" → "Mã NV" */}
                {['Mã NV', 'Ứng viên', 'Vị trí', 'Phòng ban', 'Ngày bắt đầu', 'Trạng thái', 'Tiến độ', 'Link nhân viên', 'Thao tác'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
                      <p className="text-sm text-gray-500">Đang tải danh sách onboarding...</p>
                    </div>
                  </td>
                </tr>
              ) : onboardings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                    Chưa có ứng viên nào{filterStatus || filterMonth > 0 || filterSearch ? ' khớp với bộ lọc' : ''}.
                  </td>
                </tr>
              ) : (
                onboardings.map((item) => {
                  const progress = getProgressPercentage(item.progress_percentage);
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      {/* ✅ Hiển thị employee_id hoặc onboarding_code */}
                      <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">
                        <span className="font-medium">
                          {item.employee_id || item.onboarding_code || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">
                        <div className="font-medium">{item.full_name || item.candidate_name}</div>
                        {item.candidate_email && (
                          <div className="text-xs text-gray-600">{item.candidate_email}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">
                        {item.position_title || item.position?.title || 'N/A'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">
                        {item.department_name || item.department?.name || 'N/A'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">
                        {item.start_date}
                      </td>
                      <td className="px-4 py-4 text-sm whitespace-nowrap">
                        {getStatusBadge(item.status)}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900">
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-primary-500 h-2 rounded-full transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600 shrink-0">{Math.round(progress)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm">
                        {renderTokenActions(item)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigate(`/dashboard/onboarding/${item.id}`)}
                            className="px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50"
                          >
                            Xem chi tiết
                          </button>
                          {isHR && isWaitingEmployeeFill(item) && (
                            <button
                              onClick={() => handleDelete(item)}
                              disabled={deletingId === item.id}
                              className="px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingId === item.id ? 'Đang xoá...' : 'Xoá'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ✅ Pagination — dùng component Pagination giống EmployeeList */}
        <div className="mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(totalCount / itemsPerPage)}
            totalItems={totalCount}
            itemsPerPage={itemsPerPage}
            onPageChange={(page: number) => setCurrentPage(page)}
            onItemsPerPageChange={(size: number) => { setItemsPerPage(size); setCurrentPage(1); }}
          />
        </div>

        {/* Onboarding steps info */}
        <div className="bg-gray-50 p-5 rounded-2xl">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Các bước onboarding tiêu chuẩn</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { num: 1, title: 'Đào tạo', desc: 'Đào tạo nội quy, hội nhập nhân sự' },
              { num: 2, title: 'Ký hợp đồng', desc: 'Chuẩn bị và ký kết hợp đồng lao động' },
              { num: 3, title: 'Tiếp nhận hồ sơ', desc: 'Kiểm tra và xác nhận hồ sơ ứng viên' },
              { num: 4, title: 'Bàn giao công việc', desc: 'Bàn giao thiết bị và công việc chính thức' },
            ].map((step) => (
              <div key={step.num} className="bg-white p-4 rounded-2xl border border-gray-100">
                <div className="flex items-center mb-2">
                  <div className="w-8 h-8 bg-primary-100 rounded-xl flex items-center justify-center mr-3">
                    <span className="text-primary-600 font-bold text-sm">{step.num}</span>
                  </div>
                  <h4 className="font-medium text-gray-900 text-sm">{step.title}</h4>
                </div>
                <p className="text-gray-400 text-xs">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <FeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback(f => ({ ...f, open: false }))}
      />

      {/* Modal tạo quy trình mới */}
      {showCreateModal && (
        <CreateOnboardingModal
          onClose={() => {
            setShowCreateModal(false);
            setCreateInitial(undefined);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setCreateInitial(undefined);
            fetchOnboardings();
          }}
          initial={createInitial}
        />
      )}
    </div>
  );
};

export default Onboarding;
