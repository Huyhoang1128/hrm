import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { employeesAPI, Employee, managementApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../utils/dateUtils';
import { employmentStatusLabel } from '../constants/employmentStatus';
import { WORK_LOCATION_OPTIONS } from '../constants/onboarding';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  ArrowsRightLeftIcon,
  XMarkIcon,
  LinkIcon,
  ArrowTopRightOnSquareIcon,
  UserIcon,
  BriefcaseIcon,
  IdentificationIcon,
  AcademicCapIcon,
  BanknotesIcon,
  DocumentTextIcon,
  DocumentCheckIcon,
  ShieldCheckIcon,
  PhoneIcon,
  PaperClipIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import DependentSection from './DependentSection';
import PdfFrame from '../components/Common/PdfFrame';

// ============================================
// CONSTANTS
// ============================================

const PROBATION_RATE_LABELS: Record<string, string> = {
  OPTION_1: 'Tháng đầu 85%, tháng sau 85%',
  OPTION_2: 'Tháng đầu 85%, tháng sau 100%',
  OPTION_3: 'Tháng đầu 100%, tháng sau 100%',
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  PROBATION: 'Hợp đồng thử việc',
  PROBATION_1M: 'Thử việc 1 tháng',
  PROBATION_2M: 'Thử việc 2 tháng',
  INTERN: 'Hợp đồng thực tập sinh',
  COLLABORATOR: 'Hợp đồng cộng tác viên',
  SIX_MONTH: 'Hợp đồng lao động 6 tháng',
  ONE_YEAR: 'Hợp đồng lao động 12 tháng',
  TWO_YEAR: 'Hợp đồng lao động 24 tháng',
  THREE_YEAR: 'Hợp đồng lao động 36 tháng',
  INDEFINITE: 'Hợp đồng vô thời hạn',
  SERVICE: 'Hợp đồng dịch vụ',
};

const MARITAL_STATUS_LABELS: Record<string, string> = {
  SINGLE: 'Độc thân',
  MARRIED: 'Đã kết hôn',
  DIVORCED: 'Ly hôn',
  WIDOWED: 'Góa',
};

const WORK_FORM_LABELS: Record<string, string> = {
  FULL_TIME: 'Toàn thời gian',
  PART_TIME: 'Bán thời gian',
  CONTRACT: 'Hợp đồng',
  INTERN: 'Thực tập',
  COLLABORATOR: 'Cộng tác viên',
};

const EDUCATION_LEVEL_LABELS: Record<string, string> = {
  HIGH_SCHOOL: 'Trung học phổ thông',
  ASSOCIATE: 'Cao đẳng',
  BACHELOR: 'Đại học',
  MASTER: 'Thạc sĩ',
  DOCTORATE: 'Tiến sĩ',
  OTHER: 'Khác',
};

const FILE_STATUS_LABELS: Record<string, string> = {
  COMPLETE: 'Nộp đủ',
  NEED_SUPPLEMENT: 'Cần bổ sung hồ sơ',
  NOT_SUBMITTED: 'Chưa nộp',
  PENDING_REVIEW: 'Chờ rà soát',
};

const RANK_LABELS: Record<string, string> = {
  CHAIRMAN: 'Chủ tịch',
  DIRECTOR: 'Giám đốc',
  DEPUTY_DIRECTOR: 'Phó Giám đốc',
  LEADER: 'Leader',
  SUPERVISOR: 'Quản lý',
  MANAGER: 'Trưởng phòng',
  MANAGER_TRAINEE: 'Trưởng phòng tập sự',
  DEPUTY_MANAGER: 'Phó phòng',
  STAFF: 'Nhân viên',
  INTERN: 'Thực tập sinh',
};

const CCCD_ISSUE_PLACE_LABELS: Record<string, string> = {
  POLICE_ADMIN: 'Cục cảnh sát Quản lý hành chính về Trật tự xã hội',
  MINISTRY_PUBLIC_SECURITY: 'Bộ Công An',
};

const SOCIAL_INSURANCE_STATUS_LABELS: Record<string, string> = {
  PARTICIPATING: 'Đang tham gia',
  NOT_PARTICIPATING: 'Không tham gia',
  SUSPENDED: 'Tạm dừng',
};

const getStatusBadge = (status: string) => {
  const config: Record<string, { label: string; color: string }> = {
    ACTIVE: { label: 'Đang làm việc', color: 'bg-emerald-100 text-emerald-600' },
    SUSPENDED: { label: 'Tạm dừng', color: 'bg-amber-100 text-amber-600' },
    INACTIVE: { label: 'Đã nghỉ', color: 'bg-red-100 text-red-600' },
    PROBATION: { label: 'Thử việc', color: 'bg-amber-100 text-amber-600' },
  };
  const c = config[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${c.color}`}>
      {c.label}
    </span>
  );
};


const safeDisplay = (value: any, fallback = 'Chưa có dữ liệu'): string => {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (!str || str === 'NULL' || str === 'null' || str === 'None' || str === 'undefined') return fallback;
  return str;
};

const InfoField: React.FC<{ label: string; value?: any; highlight?: boolean; full?: boolean }> = ({ label, value, highlight, full }) => {
  const display = safeDisplay(value);
  const isEmpty = display === 'Chưa có dữ liệu';
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-xs text-gray-400">{label}</label>
      <p className={`text-sm ${isEmpty ? 'text-gray-400 italic font-normal' : highlight ? 'font-semibold text-primary-600' : 'font-medium text-gray-900'}`}>
        {display}
      </p>
    </div>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

const EmployeeShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<string | null>(null);

  type ContractHistoryItem = {
    id: number;
    contract_type: string;
    contract_type_display: string;
    template_name: string | null;
    status: string;
    status_display: string;
    start_date: string | null;
    end_date: string | null;
    contract_number: string | null;
    company_unit_name: string | null;
    created_at: string;
  };
  const [contractHistory, setContractHistory] = useState<ContractHistoryItem[]>([]);
  const [deletingContractId, setDeletingContractId] = useState<number | null>(null);
  const isSuperUser =
    user?.is_supperuser === true ||
    user?.is_superuser === true ||
    user?.is_super_admin === true;
  const isAdmin = isSuperUser || user?.role?.toUpperCase() === 'ADMIN';
  const isHR = user?.is_staff === true || user?.role?.toUpperCase() === 'HR';
  const canManageEmployee = isAdmin || isHR;
  const [selfUpdateLink, setSelfUpdateLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [selfUpdateLinkError, setSelfUpdateLinkError] = useState<string | null>(null);
  const [generatingSelfUpdateLink, setGeneratingSelfUpdateLink] = useState(false);
  const [selfUpdateLinkCopied, setSelfUpdateLinkCopied] = useState(false);

  useEffect(() => {
    if (id) loadEmployee(Number(id));
  }, [id, location.key]);

  const loadEmployee = async (employeeId: number) => {
    try {
      setLoading(true);
      const data = await employeesAPI.getById(employeeId);
      setEmployee(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải thông tin nhân viên');
    } finally {
      setLoading(false);
    }
    await loadContractHistory(employeeId);
  };

  const loadContractHistory = async (employeeId: number) => {
    // Lịch sử HĐ — fetch song song, không chặn loading
    try {
      const res = await managementApi.get('/api-hrm/employee-contracts/', {
        params: { employee_id: employeeId, page_size: 100 },
      });
      const list: ContractHistoryItem[] = Array.isArray(res.data)
        ? res.data
        : res.data.results || [];
      // Sắp xếp: HĐ mới nhất lên đầu (theo start_date desc, fallback created_at desc)
      list.sort((a, b) => {
        const sa = a.start_date || a.created_at || '';
        const sb = b.start_date || b.created_at || '';
        return sb.localeCompare(sa);
      });
      setContractHistory(list);
    } catch {
      setContractHistory([]);
    }
  };

  const handleDeleteContract = async (contract: ContractHistoryItem) => {
    const label = contract.template_name || contract.contract_type_display || contract.contract_type;
    const periodLabel = contract.start_date
      ? `${formatDate(contract.start_date)}${contract.end_date ? ' → ' + formatDate(contract.end_date) : ''}`
      : '';
    const msg = `Xoá hợp đồng "${label}"${periodLabel ? ' (' + periodLabel + ')' : ''}?\n\nHĐ sẽ bị xoá vĩnh viễn khỏi hệ thống.`;
    if (!window.confirm(msg)) return;

    setDeletingContractId(contract.id);
    try {
      await managementApi.delete(`/api-hrm/employee-contracts/${contract.id}/`);
      // Optimistic update + refetch employee để cập nhật current_contract nếu HĐ vừa xoá là HĐ hiện tại
      setContractHistory((prev) => prev.filter((c) => c.id !== contract.id));
      if (employee?.id) {
        try {
          const data = await employeesAPI.getById(employee.id);
          setEmployee(data);
        } catch {}
      }
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || 'Không xoá được hợp đồng');
    } finally {
      setDeletingContractId(null);
    }
  };

  // ============================================
  // LOADING / ERROR
  // ============================================


  const handleGenerateSelfUpdateLink = async () => {
    if (!employee) return;
    setGeneratingSelfUpdateLink(true);
    setSelfUpdateLinkError(null);
    setSelfUpdateLinkCopied(false);
    try {
      const data = await employeesAPI.generateSelfUpdateLink(employee.id);
      setSelfUpdateLink({ url: data.employee_form_url, expiresAt: data.expires_at });
    } catch (err: any) {
      setSelfUpdateLinkError(err?.response?.data?.message || err?.response?.data?.detail || 'Không tạo được link. Vui lòng thử lại.');
    } finally {
      setGeneratingSelfUpdateLink(false);
    }
  };

  const handleCopySelfUpdateLink = async () => {
    if (!selfUpdateLink) return;
    try {
      await navigator.clipboard.writeText(selfUpdateLink.url);
      setSelfUpdateLinkCopied(true);
    } catch {
      window.prompt('Copy link này và gửi cho nhân viên:', selfUpdateLink.url);
    }
  };
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <ArrowPathIcon className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
        <span className="text-lg text-gray-600">Đang tải thông tin nhân viên...</span>
      </div>
    </div>
  );

  if (error || !employee) return (
    <div className="p-6">
      <button onClick={() => navigate('/dashboard/employees')}
        className="flex items-center text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeftIcon className="w-5 h-5 mr-2" /> Quay lại danh sách
      </button>
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
        <div className="flex items-center">
          <ExclamationTriangleIcon className="w-8 h-8 text-red-600 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-red-900">Lỗi tải dữ liệu</h3>
            <p className="text-red-700 mt-1">{error || 'Không tìm thấy nhân viên'}</p>
            <button onClick={() => id && loadEmployee(Number(id))}
              className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-medium">
              Thử lại
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const emp = employee as any;
  const extraInfo: Record<string, any> = (() => {
    try {
      return typeof emp.extra_info === 'string'
        ? JSON.parse(emp.extra_info || '{}')
        : (emp.extra_info || {});
    } catch { return {}; }
  })();

  const genderLabel = employee.gender === 'M' ? 'Nam' : employee.gender === 'F' ? 'Nữ' : employee.gender === 'O' ? 'Khác' : null;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="mb-6">
        <button onClick={() => navigate('/dashboard/employees')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors">
          <ArrowLeftIcon className="w-5 h-5 mr-2" /> Quay lại danh sách
        </button>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">{employee.full_name}</h1>
            <p className="text-sm text-gray-400 mt-1">
              {employee.position?.title || 'N/A'} — {employee.department?.name || 'N/A'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(employee.employment_status)}
            {canManageEmployee && (
              <button
                onClick={handleGenerateSelfUpdateLink}
                disabled={generatingSelfUpdateLink}
                title="Tạo link để nhân viên tự kiểm tra và cập nhật thông tin cá nhân"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors disabled:opacity-60"
              >
                {generatingSelfUpdateLink ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                Link tự cập nhật hồ sơ
              </button>
            )}
            {canManageEmployee && (
              <button
                onClick={() => navigate(`/dashboard/employee-changes?employee=${employee.id}`)}
                title="Đổi phòng ban / chức vụ / lương từ một ngày, xem lịch sử điều chỉnh"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors"
              >
                <ArrowsRightLeftIcon className="w-4 h-4" />
                Điều chỉnh nhân sự
              </button>
            )}
            {canManageEmployee && (
              <button
                onClick={() => navigate(`/dashboard/employees/${employee.id}/edit`)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
              >
                <PencilIcon className="w-4 h-4" />
                Sửa thông tin
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6">

        {/* ── Thông tin nhân viên ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <UserIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Thông tin nhân viên</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Mã nhân viên" value={employee.employee_id} highlight />
            <InfoField label="Họ và tên" value={employee.full_name} />
            <InfoField label="Email cá nhân" value={employee.personal_email} />
            <InfoField label="Số điện thoại" value={employee.phone_number} />
            <InfoField label="Giới tính" value={genderLabel} />
            <InfoField label="Ngày sinh" value={employee.date_of_birth ? formatDate(employee.date_of_birth) : null} />
            <InfoField label="Dân tộc" value={emp.ethnicity} />
            <InfoField label="Quốc tịch" value={emp.nationality} />
            <InfoField label="Tình trạng hôn nhân" value={emp.marital_status ? (MARITAL_STATUS_LABELS[emp.marital_status] || emp.marital_status) : null} />
            <InfoField label="Ngày bắt đầu làm việc" value={emp.start_date ? formatDate(emp.start_date) : null} />
            <InfoField label="Ngày nghỉ việc" value={emp.end_date ? formatDate(emp.end_date) : null} />
            <InfoField label="Ngày lên chính thức" value={emp.official_start_date ? formatDate(emp.official_start_date) : null} />
            <InfoField label="Lý do nghỉ việc" value={emp.termination_reason} full />
          </div>
        </div>

        {/* ── Thông tin công việc ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <BriefcaseIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Thông tin công việc</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Phòng ban" value={employee.department?.name} />
            <InfoField label="Vị trí" value={employee.position?.title} />
            <InfoField label="Cấp bậc" value={emp.rank ? (RANK_LABELS[emp.rank] ?? emp.rank) : undefined} />
            <InfoField label="Bộ phận" value={emp.section} />
            <InfoField label="Quản lý trực tiếp" value={employee.manager_name} />
            <InfoField label="Quản lý cấp 2" value={emp.manager_level_2_name} />
            <InfoField label="Team Bác sĩ" value={emp.doctor_team} />
            <InfoField label="Hình thức làm việc" value={emp.work_form ? (WORK_FORM_LABELS[emp.work_form] || emp.work_form) : null} />
            <InfoField label="Địa điểm làm việc" value={emp.work_location ? (WORK_LOCATION_OPTIONS.find(o => o.value === emp.work_location)?.label || emp.work_location) : null} />
            <InfoField label="Vùng/Miền" value={emp.region} />
            <InfoField label="Khối" value={emp.block} />
            <InfoField label="Đơn vị" value={emp.company_unit?.name} />
            <InfoField label="Trạng thái" value={employmentStatusLabel(emp.employment_status) || 'Đang làm việc'} />
            <InfoField label="Ghi chú công việc" value={emp.employment_status_notes} full />
          </div>
        </div>

        {/* ── Giấy tờ tùy thân & địa chỉ ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center">
              <IdentificationIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Giấy tờ tùy thân & địa chỉ</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <InfoField label="Số CCCD" value={emp.cccd_number} />
            <InfoField label="Số CMND cũ" value={emp.old_id_number || extraInfo.old_id_number} />
            <InfoField label="Ngày cấp CCCD" value={emp.cccd_issue_date ? formatDate(emp.cccd_issue_date) : null} />
            <InfoField label="Nơi cấp CCCD" value={emp.cccd_issue_place ? (CCCD_ISSUE_PLACE_LABELS[emp.cccd_issue_place] || emp.cccd_issue_place) : null} />
            <InfoField label="Nơi đăng ký khai sinh" value={emp.birth_place} />
            <InfoField label="Mã số thuế" value={emp.tax_code} />
            <InfoField label="Mã hộ gia đình" value={emp.household_code} />
            <InfoField label="Địa chỉ thường trú" value={emp.permanent_residence} full />
            <InfoField label="Địa chỉ hiện tại" value={emp.current_address} full />
          </div>
        </div>

        {isAdmin && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                <DocumentCheckIcon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Bảo hiểm xã hội</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Mã số BHXH" value={emp.social_insurance_number} />
              <InfoField
                label="Trạng thái tham gia BHXH"
                value={
                  emp.social_insurance_participation_status
                    ? (SOCIAL_INSURANCE_STATUS_LABELS[emp.social_insurance_participation_status] || emp.social_insurance_participation_status)
                    : null
                }
              />
              <InfoField
                label="Mức đóng BHXH"
                value={
                  emp.social_insurance_contribution_level != null
                    ? `${Number(emp.social_insurance_contribution_level).toLocaleString('vi-VN')} đ`
                    : null
                }
              />
              <InfoField
                label="Ngày bắt đầu đóng BHXH"
                value={emp.social_insurance_start_date ? formatDate(emp.social_insurance_start_date) : null}
              />
              <InfoField
                label="Ngày kết thúc đóng BHXH"
                value={emp.social_insurance_end_date ? formatDate(emp.social_insurance_end_date) : null}
              />
            </div>
          </div>
        )}

        {/* ── Trình độ học vấn ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <AcademicCapIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Trình độ học vấn</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Trình độ" value={emp.education_level ? (EDUCATION_LEVEL_LABELS[emp.education_level] || emp.education_level) : null} />
          </div>
        </div>

        {/* ── Thông tin tài chính & ngân hàng ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <BanknotesIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Thông tin tài chính & ngân hàng</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Ngân hàng" value={employee.bank_name} />
            <InfoField label="Số tài khoản" value={employee.bank_account} />
            <InfoField label="Chủ tài khoản" value={emp.bank_account_holder} />
            <InfoField label="Chi nhánh" value={emp.bank_branch} />
          </div>
        </div>

        {/* ── Lương & Hợp đồng ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <DocumentTextIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Lương & Hợp đồng</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Lương cơ bản" value={emp.basic_salary != null ? `${Number(emp.basic_salary).toLocaleString('vi-VN')} đ` : null} highlight />
            <InfoField label="Phụ cấp" value={emp.allowance != null ? `${Number(emp.allowance).toLocaleString('vi-VN')} đ` : null} />
            <InfoField label="Tỷ lệ % doanh số hưởng" value={emp.revenue_percentage} />
            <InfoField label="Tỷ lệ % lợi nhuận hưởng" value={emp.profit_percentage} />
            {(() => {
              // Ưu tiên current_contract (latest SIGNED) — fallback các field cũ trên Employee
              const cc = emp.current_contract;
              const ctype = cc?.contract_type ?? emp.contract_type;
              const ctypeDisplay = cc?.contract_type_display
                ?? emp.contract_type_display
                ?? (ctype ? CONTRACT_TYPE_LABELS[ctype] || ctype : null);
              const startDate = cc?.start_date ?? emp.contract_start_date;
              const endDate = cc?.end_date ?? emp.contract_end_date;
              return (
                <>
                  <InfoField
                    label="Loại hợp đồng"
                    value={ctype ? ctypeDisplay : null}
                    full
                  />
                  <InfoField
                    label="Ngày bắt đầu hợp đồng"
                    value={startDate ? formatDate(startDate) : null}
                  />
                  <InfoField
                    label="Ngày kết thúc hợp đồng"
                    value={endDate ? formatDate(endDate) : null}
                  />
                </>
              );
            })()}
            <InfoField label="Thời gian thử việc" value={emp.probation_months != null ? `${emp.probation_months} tháng` : null} />
            <InfoField label="Tỉ lệ thử việc" value={emp.probation_rate ? (PROBATION_RATE_LABELS[emp.probation_rate] || emp.probation_rate) : null} />
            <InfoField label="Ngày kết thúc thử việc" value={emp.probation_end_date ? formatDate(emp.probation_end_date) : null} />
          </div>
        </div>

        {/* ── Lịch sử hợp đồng ── */}
        {contractHistory.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                <DocumentTextIcon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">
                Lịch sử hợp đồng <span className="text-gray-400 font-normal">({contractHistory.length})</span>
              </h3>
            </div>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              {contractHistory.map((c) => {
                const isActive = c.status === 'SIGNED' && (!c.end_date || new Date(c.end_date) >= new Date(new Date().toDateString()));
                const statusColor =
                  c.status === 'SIGNED' ? (isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')
                  : c.status === 'EXPIRED' ? 'bg-red-100 text-red-700'
                  : c.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500'
                  : c.status === 'PENDING_SIGN' ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500';
                const label = isActive ? 'Đang hiệu lực' : c.status_display;
                const isDeleting = deletingContractId === c.id;
                return (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {c.template_name || c.contract_type_display || CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {c.start_date ? formatDate(c.start_date) : '—'}
                        {c.end_date ? ` → ${formatDate(c.end_date)}` : ' → Không xác định'}
                        {c.contract_number ? ` · ${c.contract_number}` : ''}
                        {c.company_unit_name ? ` · ${c.company_unit_name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor}`}>
                        {label}
                      </span>
                      {canManageEmployee && (
                        <button
                          type="button"
                          onClick={() => handleDeleteContract(c)}
                          disabled={isDeleting}
                          title="Xoá hợp đồng khỏi hệ thống"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {isDeleting ? (
                            <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <TrashIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Trạng thái hồ sơ ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <DocumentCheckIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Trạng thái hồ sơ</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Trạng thái hồ sơ" value={emp.file_status_display || (emp.file_status ? FILE_STATUS_LABELS[emp.file_status] || emp.file_status : null)} />
            <InfoField label="Sơ yếu lý lịch" value={emp.doc_resume === true ? 'Đã có' : (emp.doc_resume === false ? 'Chưa có' : null)} />
            <InfoField label="Căn cước công dân" value={emp.doc_cccd === true ? 'Đã có' : (emp.doc_cccd === false ? 'Chưa có' : null)} />
            <InfoField label="Bằng cấp" value={emp.doc_degree === true ? 'Đã có' : (emp.doc_degree === false ? 'Chưa có' : null)} />
            <InfoField label="Giấy khám sức khỏe" value={emp.doc_health === true ? 'Đã có' : (emp.doc_health === false ? 'Chưa có' : null)} />
            <InfoField label="Ghi chú hồ sơ" value={emp.file_review_notes} full />
          </div>
        </div>

        {/* ── Thông tin tài khoản hệ thống ── */}
        {employee.user && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                <ShieldCheckIcon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Thông tin tài khoản hệ thống</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400">Tên đăng nhập</label>
                <p className="text-sm font-medium text-gray-900">{employee.user.username || 'Chưa có tài khoản'}</p>
              </div>
              <div>
                <label className="text-xs text-gray-400">Email</label>
                <p className="text-sm font-medium text-gray-900">{employee.user.email || 'Chưa cập nhật'}</p>
              </div>
              <div>
                <label className="text-xs text-gray-400">Nhân viên HR</label>
                <p className="text-sm font-medium text-gray-900">{employee.is_hr ? 'Có' : 'Không'}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Thông tin người liên hệ khẩn cấp ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
              <PhoneIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Thông tin người liên hệ khẩn cấp</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Họ và tên" value={emp.emergency_contact_name} />
            <InfoField label="Mối quan hệ" value={emp.emergency_contact_relationship} />
            <InfoField label="Số điện thoại" value={emp.emergency_contact_phone} />
            <InfoField label="Ngày sinh" value={emp.emergency_contact_dob ? formatDate(emp.emergency_contact_dob) : null} />
            <InfoField label="Nghề nghiệp" value={emp.emergency_contact_occupation} />
            <InfoField label="Địa chỉ" value={emp.emergency_contact_address} full />
          </div>
        </div>

        {/* ── Người phụ thuộc (giảm trừ gia cảnh) ── */}
        <DependentSection employeeId={employee.id} canManage={canManageEmployee} />

        {/* ── Hồ sơ đính kèm ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <PaperClipIcon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-gray-900">Hồ sơ đính kèm</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(() => {
              const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);
              const cccdUrl = emp.citizen_id_file_url || null;
              const cccdLink = emp.link_cccd || null;
              const fileCards: { key: string; label: string; url: string | null; linkUrl?: string | null }[] = [
                { key: 'diploma_file', label: 'Bằng cấp', url: emp.diploma_file_url || null },
                { key: 'citizen_id_file', label: 'CCCD/CMT', url: cccdUrl, linkUrl: cccdLink },
                { key: 'vneid_screenshot', label: 'Ảnh chụp VNeID', url: emp.vneid_screenshot_url || (emp.vneid_screenshot ? String(emp.vneid_screenshot) : null) },
              ];
              return fileCards.map(f => (
                <div key={f.key} className="border border-gray-100 rounded-2xl overflow-hidden">
                  {f.url ? (
                    isPdf(f.url) ? (
                      <button
                        onClick={() => setPreviewPdf(f.url)}
                        className="h-40 bg-red-50 flex flex-col items-center justify-center hover:bg-red-100 transition-colors w-full"
                      >
                        <span className="text-3xl mb-1">📄</span>
                        <span className="text-xs text-red-600 font-medium">PDF</span>
                      </button>
                    ) : (
                      <div
                        className="h-40 bg-gray-100 flex items-center justify-center cursor-pointer hover:opacity-90"
                        onClick={() => setPreviewImage(f.url)}
                      >
                        <img src={f.url} alt={f.label} className="object-cover w-full h-full" />
                      </div>
                    )
                  ) : f.linkUrl ? (
                    <a
                      href={f.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-40 bg-gray-50 flex flex-col items-center justify-center gap-2 text-primary-600 hover:text-primary-800 transition-colors"
                    >
                      <span className="text-3xl">🔗</span>
                      <span className="text-xs font-medium">Mở link</span>
                    </a>
                  ) : (
                    <div className="h-40 bg-gray-50 flex flex-col items-center justify-center">
                      <span className="text-3xl mb-1">🖼️</span>
                      <span className="text-xs text-gray-400 italic">Chưa có dữ liệu</span>
                    </div>
                  )}
                  <div className="p-2 bg-white flex items-center justify-between">
                    <label className="text-xs text-gray-600 font-medium truncate">{f.label}</label>
                    {f.url && (
                      <button
                        onClick={() => isPdf(f.url!) ? setPreviewPdf(f.url) : setPreviewImage(f.url)}
                        className="p-1 rounded text-gray-500 hover:bg-gray-100"
                        title="Xem file"
                      >
                        <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                      </button>
                    )}
                    {!f.url && f.linkUrl && (
                      <a
                        href={f.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded text-gray-500 hover:bg-gray-100"
                        title="Mở link"
                      >
                        <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>
              ));
            })()}

            {/* Facebook link */}
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <div className="h-40 bg-primary-50 flex flex-col items-center justify-center">
                <span className="text-3xl mb-1">👤</span>
                {extraInfo.facebook_link || emp.facebook_link ? (
                  <span className="text-xs text-primary-600 font-medium px-2 text-center truncate w-full">
                    Facebook
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 italic">Chưa có dữ liệu</span>
                )}
              </div>
              <div className="p-2 bg-white flex items-center justify-between">
                <label className="text-xs text-gray-600 font-medium">Link Facebook</label>
                {(extraInfo.facebook_link || emp.facebook_link) && (
                  <a
                    href={extraInfo.facebook_link || emp.facebook_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded text-gray-500 hover:bg-gray-100"
                    title="Mở Facebook"
                  >
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-sm text-gray-500">
          <div>
            Ngày tạo: {formatDate(employee.created_at)}
            {employee.updated_at !== employee.created_at && (
              <span className="ml-4">
                Cập nhật lần cuối: {formatDate(employee.updated_at)}
              </span>
            )}
          </div>
          {canManageEmployee && (
            <button
              onClick={() => navigate(`/dashboard/employees/${employee.id}/edit`)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
            >
              <PencilIcon className="w-4 h-4" />
              Sửa thông tin
            </button>
          )}
        </div>

      </div>

      {(selfUpdateLink || selfUpdateLinkError) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setSelfUpdateLink(null); setSelfUpdateLinkError(null); }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">Link tự cập nhật hồ sơ</h3>
              <button
                onClick={() => { setSelfUpdateLink(null); setSelfUpdateLinkError(null); }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-gray-700">
              {selfUpdateLinkError ? (
                <p className="text-red-600">{selfUpdateLinkError}</p>
              ) : selfUpdateLink && (
                <>
                  <p>
                    Gửi link này cho <strong>{employee.full_name}</strong>. Nhân viên mở link để kiểm tra và cập nhật
                    thông tin cá nhân (CCCD, địa chỉ, liên hệ khẩn cấp, tài khoản ngân hàng...). Lương, phòng ban, vị trí
                    và các thông tin công việc khác không đổi được qua link này.
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={selfUpdateLink.url}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-xs"
                    />
                    <button
                      onClick={handleCopySelfUpdateLink}
                      className="px-3 py-2 text-xs font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700"
                    >
                      {selfUpdateLinkCopied ? 'Đã copy' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Hết hạn: {new Date(selfUpdateLink.expiresAt).toLocaleString('vi-VN')}. Tạo link mới sẽ làm link cũ hết hiệu lực.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF preview dialog */}
      {previewPdf && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewPdf(null)}
        >
          <div
            className="relative w-full max-w-4xl h-[90vh] bg-white rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <PdfFrame src={previewPdf} className="w-full h-full" title="PDF Preview" />
            <button
              onClick={() => setPreviewPdf(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/90 hover:bg-white text-gray-800"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      {/* Image preview */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/90 hover:bg-white text-gray-800"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
};

export default EmployeeShow;