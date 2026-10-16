import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  employeesAPI,
  departmentsAPI,
  sectionsAPI,
  positionsAPI,
  companyUnitsAPI,
} from '../utils/api';
import { SelectBox } from '@/components/LandingLayout/SelectBox';
import { WORK_LOCATION_OPTIONS } from '../constants/onboarding';
import onboardingService from '../services/onboarding.service';
import { toDisplayDate, toApiDate } from '../utils/dateUtils';
import DateInput from '../components/DateInput';
import {
  UserIcon,
  BriefcaseIcon,
  IdentificationIcon,
  BanknotesIcon,
  DocumentTextIcon,
  DocumentCheckIcon,
  PhoneIcon,
  PaperClipIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { buildContractWarnings } from '../utils/contractWarnings';

// ============================================
// CONSTANTS
// ============================================

const GENDER_OPTIONS = [
  { label: 'Nam', value: 'M' },
  { label: 'Nữ', value: 'F' },
  { label: 'Khác', value: 'O' },
];

const EMPLOYMENT_STATUS_OPTIONS = [
  { label: 'Đang làm việc', value: 'ACTIVE' },
  { label: 'Tạm dừng', value: 'SUSPENDED' },
  { label: 'Đã nghỉ', value: 'INACTIVE' },
];

const MARITAL_STATUS_OPTIONS = [
  { label: 'Độc thân', value: 'SINGLE' },
  { label: 'Đã kết hôn', value: 'MARRIED' },
  { label: 'Ly hôn', value: 'DIVORCED' },
  { label: 'Góa', value: 'WIDOWED' },
];

const WORK_FORM_OPTIONS = [
  { label: 'Toàn thời gian', value: 'FULL_TIME' },
  { label: 'Bán thời gian', value: 'PART_TIME' },
  { label: 'Hợp đồng', value: 'CONTRACT' },
  { label: 'Thực tập', value: 'INTERN' },
  { label: 'Cộng tác viên', value: 'COLLABORATOR' },
];

const REGION_OPTIONS = [
  { label: 'Miền Bắc', value: 'Miền Bắc' },
  { label: 'Miền Nam', value: 'Miền Nam' },
];

const BLOCK_OPTIONS = [
  { label: 'Khối Back office', value: 'Khối Back office' },
  { label: 'Khối Marketing', value: 'Khối Marketing' },
  { label: 'Khối Kinh doanh', value: 'Khối Kinh doanh' },
];

const CONTRACT_TYPE_OPTIONS = [
  { label: 'Hợp đồng thử việc', value: 'PROBATION' },
  { label: 'Hợp đồng thực tập sinh', value: 'INTERN' },
  { label: 'Hợp đồng cộng tác viên', value: 'COLLABORATOR' },
  { label: 'Hợp đồng lao động 12 tháng', value: 'ONE_YEAR' },
  { label: 'Hợp đồng lao động 24 tháng', value: 'TWO_YEAR' },
  { label: 'Hợp đồng vô thời hạn', value: 'INDEFINITE' },
  { label: 'Hợp đồng dịch vụ', value: 'SERVICE' },
];

const PROBATION_RATE_OPTIONS = [
  { label: 'Tháng đầu 85%, tháng sau 85%', value: 'OPTION_1' },
  { label: 'Tháng đầu 85%, tháng sau 100%', value: 'OPTION_2' },
  { label: 'Tháng đầu 100%, tháng sau 100%', value: 'OPTION_3' },
];


const CCCD_ISSUE_PLACE_OPTIONS = [
  { label: 'Cục cảnh sát Quản lý hành chính về Trật tự xã hội', value: 'POLICE_ADMIN' },
  { label: 'Bộ Công An', value: 'MINISTRY_PUBLIC_SECURITY' },
];

const FILE_STATUS_OPTIONS = [
  { label: 'Nộp đủ', value: 'COMPLETE' },
  { label: 'Cần bổ sung hồ sơ', value: 'NEED_SUPPLEMENT' },
  { label: 'Chưa nộp', value: 'NOT_SUBMITTED' },
  { label: 'Chờ rà soát', value: 'PENDING_REVIEW' },
];

const RANK_OPTIONS = [
  { label: 'Chủ tịch', value: 'CHAIRMAN' },
  { label: 'Giám đốc', value: 'DIRECTOR' },
  { label: 'Phó Giám đốc', value: 'DEPUTY_DIRECTOR' },
  { label: 'Leader', value: 'LEADER' },
  { label: 'Quản lý', value: 'SUPERVISOR' },
  { label: 'Trưởng phòng', value: 'MANAGER' },
  { label: 'Trưởng phòng tập sự', value: 'MANAGER_TRAINEE' },
  { label: 'Phó phòng', value: 'DEPUTY_MANAGER' },
  { label: 'Nhân viên', value: 'STAFF' },
  { label: 'Thực tập sinh', value: 'INTERN' },
];

const EDUCATION_LEVEL_OPTIONS = [
  { label: 'Trung học phổ thông', value: 'HIGH_SCHOOL' },
  { label: 'Cao đẳng', value: 'ASSOCIATE' },
  { label: 'Đại học', value: 'BACHELOR' },
  { label: 'Thạc sĩ', value: 'MASTER' },
  { label: 'Tiến sĩ', value: 'DOCTORATE' },
  { label: 'Khác', value: 'OTHER' },
];

const SOCIAL_INSURANCE_STATUS_OPTIONS = [
  { label: 'Đang tham gia', value: 'PARTICIPATING' },
  { label: 'Không tham gia', value: 'NOT_PARTICIPATING' },
  { label: 'Tạm dừng', value: 'SUSPENDED' },
];

// ============================================
// ============================================
// HELPER COMPONENTS
// ============================================

const SectionTitle: React.FC<{ icon: React.ReactNode; iconBg?: string; title: string }> = ({
  icon, iconBg = 'bg-primary-100 text-primary-600', title,
}) => (
  <div className="flex items-center gap-2 mb-4">
    <div className={`h-9 w-9 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
      {icon}
    </div>
    <h3 className="text-sm font-bold text-gray-900">{title}</h3>
  </div>
);

interface FieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {children}
  </div>
);

const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all";
const textareaClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-none";

// ============================================
// MAIN COMPONENT
// ============================================

const EmployeeEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperUser =
    user?.is_supperuser === true ||
    user?.is_superuser === true ||
    user?.is_super_admin === true;
  const isAdmin = isSuperUser || user?.role?.toUpperCase() === 'ADMIN';
  const isHR = user?.is_staff === true || user?.role?.toUpperCase() === 'HR';
  const canManageEmployee = isAdmin || isHR;
  const [loading, setLoading] = useState(false);
  const [loadingEmployee, setLoadingEmployee] = useState(true);
  const [originalExtraInfo, setOriginalExtraInfo] = useState<Record<string, any>>({});
  const [vneidFile, setVneidFile] = useState<File | null>(null);
  const [vneidCurrentUrl, setVneidCurrentUrl] = useState<string | null>(null);
  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [diplomaCurrentUrl, setDiplomaCurrentUrl] = useState<string | null>(null);
  const [citizenIdFile, setCitizenIdFile] = useState<File | null>(null);
  const [citizenIdCurrentUrl, setCitizenIdCurrentUrl] = useState<string | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [companyUnits, setCompanyUnits] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState<any>({
    // Thông tin cơ bản
    employee_id: '',
    full_name: '',
    gender: 'M',
    date_of_birth: '',
    phone_number: '',
    personal_email: '',
    ethnicity: '',
    nationality: '',
    marital_status: '',
    facebook_link: '',

    // Thông tin công việc
    employment_status: 'ACTIVE',
    start_date: '',
    end_date: '',
    position_id: undefined,
    department_id: undefined,
    manager_id: undefined,
    manager_level_2_id: undefined,
    rank: '',
    section: '',
    doctor_team: '',
    work_form: '',
    official_start_date: '',
    work_location: '',
    region: '',
    block: '',
    company_unit_id: undefined,
    is_hr: false,
    education_level: '',
    termination_reason: '',
    employment_status_notes: '',

    // Giấy tờ tùy thân
    cccd_number: '',
    cccd_issue_date: '',
    cccd_issue_place: '',
    old_id_number: '',
    birth_place: '',
    social_insurance_number: '',
    social_insurance_participation_status: '',
    social_insurance_contribution_level: '',
    social_insurance_start_date: '',
    social_insurance_end_date: '',
    tax_code: '',
    household_code: '',
    link_cccd: '',
    permanent_residence: '',
    current_address: '',

    // Ngân hàng
    bank_name: '',
    bank_account: '',
    bank_account_holder: '',
    bank_branch: '',

    // Lương & Hợp đồng
    basic_salary: '',
    allowance: '',
    contract_type: '',
    probation_months: '',
    probation_end_date: '',
    probation_rate: '',
    contract_start_date: '',
    contract_end_date: '',
    revenue_percentage: '',
    profit_percentage: '',

    // Hồ sơ
    file_status: '',
    file_review_notes: '',

    // Người liên hệ khẩn cấp
    emergency_contact_name: '',
    emergency_contact_relationship: '',
    emergency_contact_phone: '',
    emergency_contact_dob: '',
    emergency_contact_occupation: '',
    emergency_contact_address: '',

    // Checklist hồ sơ
    doc_resume: false,
    doc_cccd: false,
    doc_degree: false,
    doc_health: false,
  });

  useEffect(() => {
    if (!canManageEmployee) {
      navigate('/dashboard/employees');
      return;
    }
    if (id) {
      loadEmployee(parseInt(id));
      loadDepartments();
      loadSections();
      loadPositions();
      loadEmployees();
      loadCompanyUnits();
    }
  }, [id, canManageEmployee]);

  const loadEmployee = async (employeeId: number) => {
    try {
      setLoadingEmployee(true);
      const emp = await employeesAPI.getById(employeeId);
      const e = emp as any;
      // Parse extra_info 1 lần — fallback cho các field có thể được lưu ở extra_info
      const ei: Record<string, any> = (() => {
        try {
          return typeof e.extra_info === 'string'
            ? JSON.parse(e.extra_info || '{}')
            : (e.extra_info || {});
        } catch { return {}; }
      })();
      setOriginalExtraInfo(ei);
      setFormData({
        employee_id: e.employee_id || '',
        full_name: e.full_name || '',
        gender: e.gender || 'M',
        date_of_birth: toDisplayDate(e.date_of_birth || ''),
        phone_number: e.phone_number || '',
        personal_email: e.personal_email || '',
        ethnicity: e.ethnicity || '',
        nationality: e.nationality || '',
        marital_status: e.marital_status || '',
        facebook_link: e.facebook_link || ei.facebook_link || '',

        employment_status: e.employment_status || 'ACTIVE',
        start_date: toDisplayDate(e.start_date || ''),
        end_date: toDisplayDate(e.end_date || ''),
        position_id: e.position?.id,
        department_id: e.department?.id,
        manager_id: typeof e.manager === 'number' ? e.manager : e.manager?.id,
        manager_level_2_id: typeof e.manager_level_2 === 'number' ? e.manager_level_2 : e.manager_level_2?.id,
        rank: e.rank || '',
        section: e.section || '',
        doctor_team: e.doctor_team || '',
        work_form: e.work_form || '',
        official_start_date: toDisplayDate(e.official_start_date || ''),
        work_location: e.work_location || '',
        region: e.region || '',
        block: e.block || '',
        company_unit_id: e.company_unit?.id ?? undefined,
        is_hr: e.is_hr || false,
        education_level: e.education_level || '',
        termination_reason: e.termination_reason || '',
        employment_status_notes: e.employment_status_notes || '',

        cccd_number: e.cccd_number || '',
        cccd_issue_date: toDisplayDate(e.cccd_issue_date || ''),
        cccd_issue_place: e.cccd_issue_place || '',
        old_id_number: e.old_id_number || ei.old_id_number || '',
        birth_place: e.birth_place || '',
        social_insurance_number: e.social_insurance_number || '',
        social_insurance_participation_status: e.social_insurance_participation_status || '',
        social_insurance_contribution_level: e.social_insurance_contribution_level ?? '',
        social_insurance_start_date: toDisplayDate(e.social_insurance_start_date || ''),
        social_insurance_end_date: toDisplayDate(e.social_insurance_end_date || ''),
        tax_code: e.tax_code || '',
        household_code: e.household_code || '',
        link_cccd: e.link_cccd || '',
        permanent_residence: e.permanent_residence || '',
        current_address: e.current_address || '',

        bank_name: e.bank_name || '',
        bank_account: e.bank_account || '',
        bank_account_holder: e.bank_account_holder || '',
        bank_branch: e.bank_branch || '',

        basic_salary: e.basic_salary ?? '',
        allowance: e.allowance ?? '',
        contract_type: e.contract_type || '',
        probation_months: e.probation_months ?? '',
        probation_end_date: toDisplayDate(e.probation_end_date || ''),
        probation_rate: e.probation_rate || '',
        contract_start_date: toDisplayDate(e.contract_start_date || ''),
        contract_end_date: toDisplayDate(e.contract_end_date || ''),
        revenue_percentage: e.revenue_percentage || '',
        profit_percentage: e.profit_percentage || '',

        file_status: e.file_status || '',
        file_review_notes: e.file_review_notes || '',

        doc_resume: e.doc_resume || false,
        doc_cccd: e.doc_cccd || false,
        doc_degree: e.doc_degree || false,
        doc_health: e.doc_health || false,

        emergency_contact_name: e.emergency_contact_name || '',
        emergency_contact_relationship: e.emergency_contact_relationship || '',
        emergency_contact_phone: e.emergency_contact_phone || '',
        emergency_contact_dob: toDisplayDate(e.emergency_contact_dob || ''),
        emergency_contact_occupation: e.emergency_contact_occupation || '',
        emergency_contact_address: e.emergency_contact_address || '',
      });
      setVneidCurrentUrl(e.vneid_screenshot_url || (e.vneid_screenshot ? String(e.vneid_screenshot) : null));
      setVneidFile(null);
      setDiplomaCurrentUrl(e.diploma_file_url || null);
      setDiplomaFile(null);
      setCitizenIdCurrentUrl(e.citizen_id_file_url || null);
      setCitizenIdFile(null);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải thông tin nhân viên');
    } finally {
      setLoadingEmployee(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results);
    } catch (err) { console.error('Failed to load departments:', err); }
  };
  
  const loadSections = async () => {
    try {
      const response = await sectionsAPI.list();
      setSections(response.results);
    } catch (err) { console.error('Failed to load sections:', err); }
  };

  const loadPositions = async () => {
    try {
      const response = await positionsAPI.list();
      setPositions(response.results);
    } catch (err) { console.error('Failed to load positions:', err); }
  };

  const loadEmployees = async () => {
    try {
      const response = await employeesAPI.list({ page_size: 1000 });
      setEmployees(response.results);
    } catch (err) { console.error('Failed to load employees:', err); }
  };

  const loadCompanyUnits = async () => {
    try {
      const response = await companyUnitsAPI.list({ page_size: 100, active_only: true });
      setCompanyUnits(Array.isArray(response) ? response : (response.results || []));
    } catch (err) { console.error('Failed to load company units:', err); }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSelect = (name: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employee_id || !formData.full_name) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc');
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const payload: any = {
        employee_id: formData.employee_id.trim(),
        full_name: formData.full_name.trim(),
        gender: formData.gender,
        employment_status: formData.employment_status,
        is_hr: formData.is_hr,
      };

      // Helper cho text/string fields (blank=True): gửi '' khi rỗng, không gửi null
      const add = (key: string, val: any) => {
        if (val !== undefined) payload[key] = val;
      };
      // Helper cho date fields (null=True, blank=True): gửi null khi rỗng để BE có thể clear
      const addDate = (key: string, displayDate: string) => {
        payload[key] = toApiDate(displayDate) || null;
      };

      addDate('date_of_birth', formData.date_of_birth);
      add('phone_number', formData.phone_number?.trim());
      add('personal_email', formData.personal_email?.trim());
      add('ethnicity', formData.ethnicity?.trim());
      add('nationality', formData.nationality?.trim());
      add('marital_status', formData.marital_status);
      add('facebook_link', formData.facebook_link?.trim());

      addDate('start_date', formData.start_date);
      addDate('end_date', formData.end_date);
      add('position_id', formData.position_id);
      add('department_id', formData.department_id);
      // null = người dùng chọn "Không có" -> phải gửi lên để xoá. Backend hiểu
      // manager_id = 0 là xoá quản lý trực tiếp, manager_level_2 = null là xoá cấp 2.
      if (formData.manager_id !== undefined) payload['manager_id'] = formData.manager_id ?? 0;
      if (formData.manager_level_2_id !== undefined) payload['manager_level_2'] = formData.manager_level_2_id;
      add('rank', formData.rank?.trim());
      add('section', formData.section?.trim());
      add('doctor_team', formData.doctor_team?.trim());
      add('work_form', formData.work_form);
      add('work_location', formData.work_location);
      add('region', formData.region);
      add('block', formData.block);
      add('company_unit_id', formData.company_unit_id);

      // Merge extra_info — lưu work_type, đồng thời xóa facebook_link (đã PATCH trực tiếp)
      // để tránh lệch giữa direct field và extra_info
      {
        const nextExtra = {
          ...originalExtraInfo,
          facebook_link: undefined,
        };
        payload['extra_info'] = JSON.stringify(nextExtra);
      }
      addDate('official_start_date', formData.official_start_date);
      add('education_level', formData.education_level);

      add('termination_reason', formData.termination_reason?.trim());
      add('employment_status_notes', formData.employment_status_notes?.trim());

      add('cccd_number', formData.cccd_number?.trim());
      addDate('cccd_issue_date', formData.cccd_issue_date);
      add('cccd_issue_place', formData.cccd_issue_place);
      add('old_id_number', formData.old_id_number?.trim());
      add('birth_place', formData.birth_place?.trim());
      add('social_insurance_number', formData.social_insurance_number?.trim());
      add('social_insurance_participation_status', formData.social_insurance_participation_status || null);
      payload['social_insurance_contribution_level'] =
        formData.social_insurance_contribution_level !== ''
          ? Number(formData.social_insurance_contribution_level)
          : null;
      addDate('social_insurance_start_date', formData.social_insurance_start_date);
      addDate('social_insurance_end_date', formData.social_insurance_end_date);
      add('tax_code', formData.tax_code?.trim());
      add('household_code', formData.household_code?.trim());
      add('link_cccd', formData.link_cccd?.trim());
      add('permanent_residence', formData.permanent_residence?.trim());
      add('current_address', formData.current_address?.trim());

      add('bank_name', formData.bank_name?.trim());
      add('bank_account', formData.bank_account?.trim());
      add('bank_account_holder', formData.bank_account_holder?.trim());
      add('bank_branch', formData.bank_branch?.trim());

      payload['basic_salary'] = formData.basic_salary !== '' ? Number(formData.basic_salary) : null;
      payload['allowance'] = formData.allowance !== '' ? Number(formData.allowance) : null;
      add('contract_type', formData.contract_type);
      payload['probation_months'] = formData.probation_months !== '' ? Number(formData.probation_months) : null;
      addDate('probation_end_date', formData.probation_end_date);
      add('probation_rate', formData.probation_rate);
      addDate('contract_start_date', formData.contract_start_date);
      addDate('contract_end_date', formData.contract_end_date);
      add('revenue_percentage', formData.revenue_percentage);
      add('profit_percentage', formData.profit_percentage);

      add('file_status', formData.file_status);
      add('file_review_notes', formData.file_review_notes?.trim());
      add('doc_resume', formData.doc_resume);
      add('doc_cccd', formData.doc_cccd);
      add('doc_degree', formData.doc_degree);
      add('doc_health', formData.doc_health);

      add('emergency_contact_name', formData.emergency_contact_name?.trim());
      add('emergency_contact_relationship', formData.emergency_contact_relationship?.trim());
      add('emergency_contact_phone', formData.emergency_contact_phone?.trim());
      addDate('emergency_contact_dob', formData.emergency_contact_dob);
      add('emergency_contact_occupation', formData.emergency_contact_occupation?.trim());
      add('emergency_contact_address', formData.emergency_contact_address?.trim());

      await employeesAPI.update(parseInt(id!), payload);

      // Upload VNeID screenshot nếu admin chọn file mới (field thuộc Employee)
      if (vneidFile && formData.employee_id) {
        const fd = new FormData();
        fd.append('vneid_screenshot', vneidFile);
        await employeesAPI.uploadFilesByEmployeeId(formData.employee_id, fd);
      }

      // Upload các file thuộc OnboardingProcess qua employee_id
      const onboardingFd = new FormData();
      if (diplomaFile) onboardingFd.append('diploma_file', diplomaFile);
      if (citizenIdFile) onboardingFd.append('citizen_id_file', citizenIdFile);
      if ([...onboardingFd.keys()].length > 0 && formData.employee_id) {
        await onboardingService.superAdminUploadFilesByEmployeeId(formData.employee_id, onboardingFd);
      }

      setSuccess('Cập nhật nhân viên thành công!');
      setTimeout(() => navigate(`/dashboard/employees/${id}`), 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Lỗi khi cập nhật nhân viên');
    } finally {
      setLoading(false);
    }
  };

  if (loadingEmployee) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Đang tải thông tin nhân viên...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(`/dashboard/employees/${id}`)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Quay lại chi tiết
        </button>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Chỉnh sửa nhân viên</h1>
        <p className="text-sm text-gray-600 mt-1">Cập nhật thông tin nhân viên</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-emerald-700 text-sm">{success}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Thông tin cá nhân ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<UserIcon className="h-5 w-5" />} title="Thông tin cá nhân" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Mã nhân viên" required>
              <input type="text" name="employee_id" value={formData.employee_id}
                onChange={handleInput} placeholder="NV001" className={inputClass} required />
            </Field>

            <Field label="Họ và tên" required>
              <input type="text" name="full_name" value={formData.full_name}
                onChange={handleInput} placeholder="Nguyễn Văn A" className={inputClass} required />
            </Field>

            <SelectBox
              label="Giới tính *"
              value={formData.gender}
              placeholder="Chọn giới tính"
              options={GENDER_OPTIONS}
              onChange={(v) => handleSelect('gender', v)}
            />

            <Field label="Ngày sinh">
              <DateInput name="date_of_birth" value={formData.date_of_birth} onChange={handleInput} className={inputClass} />
            </Field>

            <Field label="Số điện thoại">
              <input type="tel" name="phone_number" value={formData.phone_number}
                onChange={handleInput} placeholder="0987654321" className={inputClass} />
            </Field>

            <Field label="Email cá nhân">
              <input type="email" name="personal_email" value={formData.personal_email}
                onChange={handleInput} placeholder="example@gmail.com" className={inputClass} />
            </Field>

            <Field label="Dân tộc">
              <input type="text" name="ethnicity" value={formData.ethnicity}
                onChange={handleInput} placeholder="Kinh, Tày, Mường..." className={inputClass} />
            </Field>

            <Field label="Quốc tịch">
              <input type="text" name="nationality" value={formData.nationality}
                onChange={handleInput} placeholder="Việt Nam..." className={inputClass} />
            </Field>

            <SelectBox
              label="Tình trạng hôn nhân"
              value={formData.marital_status}
              placeholder="Chọn tình trạng"
              options={MARITAL_STATUS_OPTIONS}
              onChange={(v) => handleSelect('marital_status', v)}
            />

            <Field label="Link Facebook">
              <input type="url" name="facebook_link" value={formData.facebook_link}
                onChange={handleInput} placeholder="https://facebook.com/..." className={inputClass} />
            </Field>

            <SelectBox
              label="Trình độ học vấn"
              value={formData.education_level}
              placeholder="Chọn trình độ"
              options={EDUCATION_LEVEL_OPTIONS}
              onChange={(v) => handleSelect('education_level', v)}
            />
          </div>
        </div>

        {/* ── Thông tin công việc ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<BriefcaseIcon className="h-5 w-5" />} title="Thông tin công việc" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SelectBox
              label="Trạng thái làm việc"
              value={formData.employment_status}
              placeholder="Chọn trạng thái"
              options={EMPLOYMENT_STATUS_OPTIONS}
              onChange={(v) => handleSelect('employment_status', v)}
            />

            <Field label="Ngày bắt đầu">
              <DateInput name="start_date" value={formData.start_date} onChange={handleInput} className={inputClass} />
            </Field>

            <Field label="Ngày nghỉ việc">
              <DateInput name="end_date" value={formData.end_date} onChange={handleInput} className={inputClass} />
            </Field>

            <Field label="Ngày lên chính thức (tự động = Ngày kết thúc thử việc + 1 ngày)">
              <input type="text" name="official_start_date" value={formData.official_start_date}
                readOnly disabled placeholder="Tự động tính từ Ngày kết thúc thử việc"
                className={`${inputClass} bg-gray-100 text-gray-500 cursor-not-allowed`} />
            </Field>

            <SelectBox
              label="Phòng ban"
              value={formData.department_id}
              placeholder="Chọn phòng ban"
              searchable={true}
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
              onChange={(v) => handleSelect('department_id', v)}
            />

            <SelectBox
              label="Chức vụ"
              value={formData.position_id}
              placeholder="Chọn chức vụ"
              searchable={true}
              options={positions.map((p) => ({ label: p.title, value: p.id }))}
              onChange={(v) => handleSelect('position_id', v)}
            />

            <SelectBox
              label="Quản lý trực tiếp"
              value={formData.manager_id}
              placeholder="Chọn quản lý"
              searchable={true}
              options={[
                { label: 'Không có quản lý', value: null },
                ...employees
                  .filter((emp) => emp.id !== parseInt(id!))
                  .map((emp) => ({
                    label: `${emp.full_name} (${emp.employee_id})`,
                    value: emp.id,
                  })),
              ]}
              onChange={(v) => handleSelect('manager_id', v ?? null)}
            />

            <SelectBox
              label="Quản lý cấp 2 (gián tiếp)"
              value={formData.manager_level_2_id}
              placeholder="Chọn quản lý cấp 2"
              searchable={true}
              options={[
                { label: 'Không có', value: null },
                ...employees
                  .filter((emp) => emp.id !== parseInt(id!))
                  .map((emp) => ({
                    label: `${emp.full_name} (${emp.employee_id})`,
                    value: emp.id,
                  })),
              ]}
              onChange={(v) => handleSelect('manager_level_2_id', v ?? null)}
            />

            <SelectBox
              label="Cấp bậc"
              value={formData.rank}
              placeholder="Chọn cấp bậc"
              options={[
                { value: '', label: 'Không có' },
                ...RANK_OPTIONS,
                ...(formData.rank && !RANK_OPTIONS.some(o => o.value === formData.rank)
                  ? [{ value: formData.rank, label: formData.rank }]
                  : []),
              ]}
              onChange={(v) => handleSelect('rank', v)}
            />

            <SelectBox
              label="Bộ phận"
              value={formData.section}
              placeholder="Chọn bộ phận"
              searchable={true}
              options={sections.map((s) => ({ label: s.name, value: s.name }))}
              onChange={(v) => handleSelect('section', v)}
            />

            <Field label="Team Bác sĩ">
              <input type="text" name="doctor_team" value={formData.doctor_team}
                onChange={handleInput} placeholder="Team Dr. Nguyễn..." className={inputClass} />
            </Field>

            <SelectBox
              label="Hình thức làm việc"
              value={formData.work_form}
              placeholder="Chọn hình thức"
              options={WORK_FORM_OPTIONS}
              onChange={(v) => handleSelect('work_form', v)}
            />


            <SelectBox
              label="Địa điểm làm việc"
              value={formData.work_location}
              placeholder="Chọn địa điểm"
              options={WORK_LOCATION_OPTIONS}
              onChange={(v) => handleSelect('work_location', v)}
            />

            <SelectBox
              label="Vùng/Miền"
              value={formData.region}
              placeholder="Chọn vùng/miền"
              options={REGION_OPTIONS}
              onChange={(v) => handleSelect('region', v)}
            />

            <SelectBox
              label="Khối"
              value={formData.block}
              placeholder="Chọn khối"
              options={BLOCK_OPTIONS}
              onChange={(v) => handleSelect('block', v)}
            />

            <SelectBox
              label="Đơn vị"
              value={formData.company_unit_id?.toString() ?? ''}
              placeholder="Chọn đơn vị"
              options={[
                { value: '', label: 'Không có' },
                ...(companyUnits || []).map((u) => ({ value: String(u.id), label: u.name })),
              ]}
              onChange={(v) => handleSelect('company_unit_id', v ? Number(v) : undefined)}
            />

            <div className="md:col-span-2">
              <label className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100 cursor-pointer hover:bg-primary-50 transition-colors">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={formData.is_hr}
                  onChange={(e) => handleSelect('is_hr', e.target.checked)}
                />
                <div>
                  <p className="text-sm font-medium text-gray-700">Nhân viên HR</p>
                  <p className="text-xs text-gray-500 mt-0.5">Có quyền duyệt đơn và truy cập các chức năng quản lý nhân sự</p>
                </div>
              </label>
            </div>

            <div className="md:col-span-2">
              <Field label="Lý do nghỉ việc">
                <textarea name="termination_reason" value={formData.termination_reason}
                  onChange={handleInput} rows={2}
                  placeholder="Lý do nghỉ việc..."
                  className={textareaClass} />
              </Field>
            </div>

            <div className="md:col-span-2">
              <Field label="Ghi chú công việc">
                <textarea name="employment_status_notes" value={formData.employment_status_notes}
                  onChange={handleInput} rows={2}
                  placeholder="Ghi chú về trạng thái công việc..."
                  className={textareaClass} />
              </Field>
            </div>
          </div>
        </div>

        {/* ── Giấy tờ tùy thân & địa chỉ ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<IdentificationIcon className="h-5 w-5" />} iconBg="bg-violet-100 text-violet-600" title="Giấy tờ tùy thân & địa chỉ" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Số CCCD">
              <input type="text" name="cccd_number" value={formData.cccd_number}
                onChange={handleInput} placeholder="012345678901" className={inputClass} />
            </Field>

            <Field label="Ngày cấp CCCD">
              <DateInput name="cccd_issue_date" value={formData.cccd_issue_date} onChange={handleInput} className={inputClass} />
            </Field>

            <SelectBox
              label="Nơi cấp CCCD"
              value={formData.cccd_issue_place}
              placeholder="Chọn nơi cấp"
              options={CCCD_ISSUE_PLACE_OPTIONS}
              onChange={(v) => handleSelect('cccd_issue_place', v)}
            />

            <Field label="Số CMND cũ">
              <input type="text" name="old_id_number" value={formData.old_id_number}
                onChange={handleInput} placeholder="123456789" className={inputClass} />
            </Field>

            <Field label="Nơi đăng ký khai sinh">
              <input type="text" name="birth_place" value={formData.birth_place}
                onChange={handleInput} placeholder="Tỉnh/thành phố..." className={inputClass} />
            </Field>

            <Field label="Mã số thuế">
              <input type="text" name="tax_code" value={formData.tax_code}
                onChange={handleInput} placeholder="0123456789" className={inputClass} />
            </Field>

            <Field label="Mã hộ gia đình">
              <input type="text" name="household_code" value={formData.household_code}
                onChange={handleInput} placeholder="Mã hộ gia đình" className={inputClass} />
            </Field>

            <Field label="Link CCCD/CMT">
              <input type="text" name="link_cccd" value={formData.link_cccd}
                onChange={handleInput} placeholder="https://drive.google.com/..." className={inputClass} />
            </Field>

            <div className="md:col-span-2">
              <Field label="Địa chỉ thường trú">
                <textarea name="permanent_residence" value={formData.permanent_residence}
                  onChange={handleInput} rows={2}
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
                  className={textareaClass} />
              </Field>
            </div>

            <div className="md:col-span-2">
              <Field label="Địa chỉ hiện tại">
                <textarea name="current_address" value={formData.current_address}
                  onChange={handleInput} rows={2}
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
                  className={textareaClass} />
              </Field>
            </div>
          </div>
        </div>

          {isAdmin && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <SectionTitle icon={<DocumentCheckIcon className="h-5 w-5" />} title="Bảo hiểm xã hội" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Mã số BHXH">
                  <input type="text" name="social_insurance_number" value={formData.social_insurance_number}
                    onChange={handleInput} placeholder="1234567890" className={inputClass} />
                </Field>

                <SelectBox
                  label="Trạng thái tham gia BHXH"
                  value={formData.social_insurance_participation_status}
                  placeholder="Chọn trạng thái"
                  options={SOCIAL_INSURANCE_STATUS_OPTIONS}
                  onChange={(v) => handleSelect('social_insurance_participation_status', v)}
                />

                <Field label="Mức đóng BHXH">
                  <input
                    type="number"
                    step="0.01"
                    name="social_insurance_contribution_level"
                    value={formData.social_insurance_contribution_level}
                    onChange={handleInput}
                    placeholder="Ví dụ: 5000000"
                    className={inputClass}
                  />
                </Field>

                <Field label="Ngày bắt đầu đóng BHXH">
                  <DateInput name="social_insurance_start_date" value={formData.social_insurance_start_date} onChange={handleInput} className={inputClass} />
                </Field>

                <Field label="Ngày kết thúc đóng BHXH">
                  <DateInput name="social_insurance_end_date" value={formData.social_insurance_end_date} onChange={handleInput} className={inputClass} />
                </Field>
              </div>
            </div>
          )}

        {/* ── Thông tin ngân hàng ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<BanknotesIcon className="h-5 w-5" />} iconBg="bg-emerald-100 text-emerald-600" title="Thông tin ngân hàng" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Tên ngân hàng">
              <input type="text" name="bank_name" value={formData.bank_name}
                onChange={handleInput} placeholder="ACB, Vietcombank..." className={inputClass} />
            </Field>

            <Field label="Số tài khoản">
              <input type="text" name="bank_account" value={formData.bank_account}
                onChange={handleInput} placeholder="123456789" className={inputClass} />
            </Field>

            <Field label="Chủ tài khoản">
              <input type="text" name="bank_account_holder" value={formData.bank_account_holder}
                onChange={handleInput} placeholder="NGUYEN VAN A" className={inputClass} />
            </Field>

            <Field label="Chi nhánh">
              <input type="text" name="bank_branch" value={formData.bank_branch}
                onChange={handleInput} placeholder="Hà Nội" className={inputClass} />
              <p className="text-xs text-gray-400 mt-1">* Trong trường hợp không phải Ngân hàng ACB</p>
            </Field>
          </div>
        </div>

        {/* ── Lương & Hợp đồng ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<DocumentTextIcon className="h-5 w-5" />} iconBg="bg-emerald-100 text-emerald-600" title="Lương & Hợp đồng" />

          {/* Cảnh báo mâu thuẫn ngày tháng / loại hợp đồng — xem buildContractWarnings() */}
          {(() => {
            const warnings = buildContractWarnings(formData);
            if (!warnings.length) return null;
            const errs = warnings.filter((x) => x.level === 'error');
            return (
              <div className={`mb-5 rounded-xl border p-4 ${errs.length ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className={`flex items-center gap-2 mb-2 font-semibold text-sm ${errs.length ? 'text-red-800' : 'text-amber-800'}`}>
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                  Cần kiểm tra lại {warnings.length} điểm trong hồ sơ hợp đồng
                </div>
                <ul className="space-y-1.5">
                  {warnings.map((x, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${x.level === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
                      <span className={x.level === 'error' ? 'text-red-800' : 'text-amber-800'}>{x.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-gray-500">
                  Cảnh báo chỉ để rà soát, không chặn lưu. Sửa xong các ô bên dưới thì cảnh báo tự mất.
                </p>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Lương cơ bản (VNĐ)">
              <input type="number" name="basic_salary" value={formData.basic_salary}
                onChange={handleInput} placeholder="10000000" className={inputClass} />
            </Field>

            <Field label="Phụ cấp (VNĐ)">
              <input type="number" name="allowance" value={formData.allowance}
                onChange={handleInput} placeholder="2000000" className={inputClass} />
            </Field>

            <SelectBox
              label="Loại hợp đồng"
              value={formData.contract_type}
              placeholder="Chọn loại hợp đồng"
              options={CONTRACT_TYPE_OPTIONS}
              onChange={(v) => handleSelect('contract_type', v)}
            />

            <Field label="Số tháng thử việc">
              <input type="number" name="probation_months" value={formData.probation_months}
                onChange={handleInput} placeholder="2" className={inputClass} />
            </Field>

            <Field label="Ngày kết thúc thử việc">
              <DateInput name="probation_end_date" value={formData.probation_end_date} onChange={handleInput} className={inputClass} />
            </Field>

            <SelectBox
              label="Tỉ lệ thử việc"
              value={formData.probation_rate}
              placeholder="Chọn tỉ lệ"
              options={PROBATION_RATE_OPTIONS}
              onChange={(v) => handleSelect('probation_rate', v)}
            />

            <Field label="Ngày bắt đầu hợp đồng">
              <DateInput name="contract_start_date" value={formData.contract_start_date} onChange={handleInput} className={inputClass} />
            </Field>

            <Field label="Ngày kết thúc hợp đồng">
              <DateInput name="contract_end_date" value={formData.contract_end_date} onChange={handleInput} className={inputClass} />
            </Field>

            <Field label="Tỷ lệ % doanh số hưởng">
              <input type="text" name="revenue_percentage" value={formData.revenue_percentage}
                onChange={handleInput} placeholder="Ví dụ: 5%" className={inputClass} />
            </Field>

            <Field label="Tỷ lệ % lợi nhuận hưởng">
              <input type="text" name="profit_percentage" value={formData.profit_percentage}
                onChange={handleInput} placeholder="Ví dụ: 10%" className={inputClass} />
            </Field>

          </div>
        </div>

        {/* ── Trạng thái hồ sơ ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<DocumentCheckIcon className="h-5 w-5" />} title="Trạng thái hồ sơ" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SelectBox
              label="Trạng thái hồ sơ"
              value={formData.file_status}
              placeholder="Chọn trạng thái"
              options={FILE_STATUS_OPTIONS}
              onChange={(v) => handleSelect('file_status', v)}
            />

            <div className="md:col-span-2">
              <Field label="Ghi chú hồ sơ">
                <textarea name="file_review_notes" value={formData.file_review_notes}
                  onChange={handleInput} rows={2}
                  placeholder="Ghi chú về tình trạng hồ sơ..."
                  className={textareaClass} />
              </Field>
            </div>

            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-primary-50 transition-colors">
                <input type="checkbox" className="w-4 h-4 text-primary-600 rounded accent-primary-600" checked={formData.doc_resume} onChange={(e) => handleSelect('doc_resume', e.target.checked)} />
                <span className="text-sm font-medium text-gray-700">Sơ yếu lý lịch</span>
              </label>
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-primary-50 transition-colors">
                <input type="checkbox" className="w-4 h-4 text-primary-600 rounded accent-primary-600" checked={formData.doc_cccd} onChange={(e) => handleSelect('doc_cccd', e.target.checked)} />
                <span className="text-sm font-medium text-gray-700">CCCD</span>
              </label>
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-primary-50 transition-colors">
                <input type="checkbox" className="w-4 h-4 text-primary-600 rounded accent-primary-600" checked={formData.doc_degree} onChange={(e) => handleSelect('doc_degree', e.target.checked)} />
                <span className="text-sm font-medium text-gray-700">Bằng cấp</span>
              </label>
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-primary-50 transition-colors">
                <input type="checkbox" className="w-4 h-4 text-primary-600 rounded accent-primary-600" checked={formData.doc_health} onChange={(e) => handleSelect('doc_health', e.target.checked)} />
                <span className="text-sm font-medium text-gray-700">Giấy khám sức khỏe</span>
              </label>
            </div>
          </div>
        </div>

        {/* ── Người liên hệ khẩn cấp ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<PhoneIcon className="h-5 w-5" />} iconBg="bg-red-100 text-red-600" title="Người liên hệ khẩn cấp" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Họ và tên">
              <input type="text" name="emergency_contact_name" value={formData.emergency_contact_name}
                onChange={handleInput} placeholder="Nguyễn Văn B" className={inputClass} />
            </Field>

            <Field label="Mối quan hệ">
              <input type="text" name="emergency_contact_relationship" value={formData.emergency_contact_relationship}
                onChange={handleInput} placeholder="Bố, mẹ, vợ, chồng..." className={inputClass} />
            </Field>

            <Field label="Số điện thoại">
              <input type="tel" name="emergency_contact_phone" value={formData.emergency_contact_phone}
                onChange={handleInput} placeholder="0987654321" className={inputClass} />
            </Field>

            <Field label="Ngày sinh">
              <DateInput name="emergency_contact_dob" value={formData.emergency_contact_dob} onChange={handleInput} className={inputClass} />
            </Field>

            <Field label="Nghề nghiệp">
              <input type="text" name="emergency_contact_occupation" value={formData.emergency_contact_occupation}
                onChange={handleInput} placeholder="Giáo viên, Bác sĩ..." className={inputClass} />
            </Field>

            <div className="md:col-span-2">
              <Field label="Địa chỉ">
                <textarea name="emergency_contact_address" value={formData.emergency_contact_address}
                  onChange={handleInput} rows={2}
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
                  className={textareaClass} />
              </Field>
            </div>
          </div>
        </div>

        {/* ── Hồ sơ đính kèm ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionTitle icon={<PaperClipIcon className="h-5 w-5" />} title="Hồ sơ đính kèm" />
          <p className="text-xs text-gray-500 mb-3">
            Chọn file mới để thay thế. Bỏ trống ô nào thì giữ nguyên.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {(() => {
              const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);
              const rows: {
                label: string;
                file: File | null;
                setFile: (f: File | null) => void;
                currentUrl: string | null;
                accept: string;
              }[] = [
                { label: 'Bằng cấp', file: diplomaFile, setFile: setDiplomaFile, currentUrl: diplomaCurrentUrl, accept: 'image/*,application/pdf' },
                { label: 'CCCD/CMT', file: citizenIdFile, setFile: setCitizenIdFile, currentUrl: citizenIdCurrentUrl, accept: 'image/*,application/pdf' },
                { label: 'Ảnh chụp VNeID', file: vneidFile, setFile: setVneidFile, currentUrl: vneidCurrentUrl, accept: 'image/*,application/pdf' },
              ];
              return rows.map(r => (
                <div key={r.label} className="border border-gray-100 rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">{r.label}</label>
                    {r.currentUrl && !r.file && (
                      <a
                        href={r.currentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-600 hover:underline"
                      >
                        Xem file hiện tại
                      </a>
                    )}
                  </div>
                  {r.currentUrl && !r.file && !isPdf(r.currentUrl) && (
                    <img src={r.currentUrl} alt={r.label} className="max-h-32 object-contain border rounded" />
                  )}
                  {r.currentUrl && !r.file && isPdf(r.currentUrl) && (
                    <div className="h-20 bg-red-50 border border-red-200 rounded flex items-center justify-center gap-2">
                      <span className="text-2xl">📄</span>
                      <span className="text-xs text-red-600 font-medium">PDF hiện tại</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept={r.accept}
                    onChange={(e) => r.setFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  />
                  {r.file && (
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span className="truncate">📎 {r.file.name} ({(r.file.size / 1024).toFixed(1)} KB)</span>
                      <button
                        type="button"
                        onClick={() => r.setFile(null)}
                        className="text-red-600 hover:underline ml-2"
                      >
                        Bỏ chọn
                      </button>
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        </div>

        {/* ── Action buttons ── */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(`/dashboard/employees/${id}`)}
            className="btn-secondary px-5 py-2"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-5 py-2 disabled:opacity-50"
          >
            {loading ? 'Đang cập nhật...' : 'Lưu thay đổi'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default EmployeeEdit;