// ==========================================
// FILE: pages/EmployeeOnboardingForm.tsx
// Tailwind CSS version — no MUI dependencies
// ==========================================

import React, { useState, useEffect, ChangeEvent, useCallback } from 'react';
import { API_BASE_URL } from '../utils/api';
import { useParams } from 'react-router-dom';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import {
  ETHNICITY_OPTIONS, NATIONALITY_OPTIONS, SECTION_OPTIONS, WORK_FORM_OPTIONS, WORK_LOCATION_OPTIONS,
  CITIZEN_ID_ISSUE_PLACE_OPTIONS, EDUCATION_LEVEL_OPTIONS, RANK_OPTIONS,
  REGION_OPTIONS, BLOCK_OPTIONS, SUB_DEPARTMENT_OPTIONS, POSITION_OPTIONS,
} from '../constants/onboarding';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  XMarkIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';

// ============================================
// CONSTANTS (local only — shared constants imported from ../constants/onboarding)
// ============================================

const STEP_LABELS = ['Cơ bản', 'Công việc', 'CCCD', 'Địa chỉ', 'Liên hệ', 'Lương', 'Xác nhận'];

const VNEID_ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
]);
const VNEID_MAX_BYTES = 10 * 1024 * 1024;

// ============================================
// TYPES
// ============================================

interface OnboardingData {
  id: number;
  onboarding_code: string;
  candidate_name: string;
  candidate_email: string;
  start_date: string;
  position_name: string;
  department_name: string;
  token_expires_at: string;
  /** Link cho NV đang làm tự cập nhật hồ sơ: không hiện / không gửi các trường HCNS quản lý */
  is_self_update?: boolean;
}

/** Trường HCNS quản lý — link tự cập nhật hồ sơ không hiện và không gửi lên. */
const SELF_UPDATE_HIDDEN_FIELDS = new Set([
  'company_unit', 'region', 'block', 'sub_department', 'section', 'position', 'job_rank', 'doctor_team',
  'work_form', 'work_type', 'work_location', 'salary', 'allowance', 'probation_period_months', 'probation_rate',
]);

interface FormValues {
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;
  date_of_birth: string;
  gender: string;
  education_level: string;
  facebook_link: string;
  region: string;
  block: string;
  sub_department: string;
  section: string;
  position: string;
  job_rank: string;
  ethnicity: string;
  birth_place: string;
  nationality: string;
  probation_rate: string;
  doctor_team: string;
  work_form: string;
  work_location: string;
  company_unit: string;
  citizen_id: string;
  citizen_id_issue_date: string;
  citizen_id_issue_place: string;
  old_id_number: string;
  permanent_address: string;
  current_address: string;
  social_insurance_number: string;
  tax_code: string;
  marital_status: string;
  emergency_contact_name: string;
  emergency_contact_relationship: string;
  emergency_contact_phone: string;
  emergency_contact_dob: string;
  emergency_contact_occupation: string;
  emergency_contact_address: string;
  salary: string;
  allowance: string;
  probation_period_months: string;
  bank_account: string;
  bank_name: string;
  bank_branch: string;
  bank_account_holder: string;
}

// ============================================
// FIELD COMPONENTS (Tailwind)
// ============================================

interface TFProps {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'search' | 'email' | 'url' | 'none';
  disabled?: boolean;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  error?: string;
  maxLength?: number;
}

const TF: React.FC<TFProps> = ({ label, value, onChange, placeholder, type = 'text', inputMode, disabled, multiline, rows, error, maxLength, required }) => (
  <div>
    <label className="block text-base font-semibold text-gray-800 mb-1.5">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {multiline ? (
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows || 3}
        maxLength={maxLength}
        className={`block w-full rounded-xl border-2 px-4 py-[13px] text-base text-gray-900 placeholder-gray-400 shadow-sm focus:ring-2 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 transition-all ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'}`}
      />
    ) : (
      <div className="relative">
        <input
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          className={`block w-full rounded-xl border-2 px-4 py-[13px] text-base text-gray-900 placeholder-gray-400 shadow-sm focus:ring-2 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 transition-all ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'} ${type === 'date' ? '[&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer' : ''}`}
        />
        {type === 'date' && (
          <CalendarDaysIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 pointer-events-none" />
        )}
      </div>
    )}
    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
  </div>
);

interface SFProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: ({ value: string; label: string } | string)[];
  required?: boolean;
  searchable?: boolean;
}

const SF: React.FC<SFProps> = ({ label, value, onChange, options, searchable, required }) => {
  const normalized = options.map((o) => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <div>
      <label className="block text-base font-semibold mb-1.5 text-gray-800">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <SelectBox
        label=""
        value={value}
        options={normalized}
        onChange={onChange}
        searchable={searchable || normalized.length > 10}
        placeholder={`Chọn ${label.toLowerCase()}`}
        size="lg"
      />
    </div>
  );
};

interface RFProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: ({ value: string; label: string } | string)[];
  required?: boolean;
}

const RF: React.FC<RFProps> = ({ label, value, onChange, options }) => {
  const normalized = options.map((o) => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <fieldset>
      <legend className="text-base font-semibold text-gray-800 mb-2.5">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {normalized.map((o) => (
          <label key={o.value} className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border-2 text-sm transition-all ${value === o.value ? 'border-blue-500 bg-blue-50 shadow-sm font-semibold' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
            <input
              type="radio"
              name={label}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="w-3.5 h-3.5 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="text-gray-700 whitespace-nowrap">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

export const EmployeeOnboardingForm: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 7;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(null);
  const isSelfUpdate = !!onboardingData?.is_self_update;
  const [pageError, setPageError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);
  const [citizenIdFile, setCitizenIdFile] = useState<File | null>(null);
  const [vneidScreenshotFile, setVneidScreenshotFile] = useState<File | null>(null);
  const [hasCitizenIdFile, setHasCitizenIdFile] = useState(false);
  const [hasVneidScreenshot, setHasVneidScreenshot] = useState(false);
  const [workType, setWorkType] = useState('');
  const [companyUnits, setCompanyUnits] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);

  const [values, setValues] = useState<FormValues>({
    candidate_name: '', candidate_email: '', candidate_phone: '',
    date_of_birth: '', gender: 'M', education_level: '', facebook_link: '',
    region: '', block: '', sub_department: '',
    section: '', position: '', job_rank: '', ethnicity: '', birth_place: '', nationality: '', doctor_team: '', work_form: '',
    work_location: '', company_unit: '', probation_rate: '',
    citizen_id: '', citizen_id_issue_date: '', citizen_id_issue_place: '',
    old_id_number: '', permanent_address: '', current_address: '',
    social_insurance_number: '', tax_code: '', marital_status: 'SINGLE',
    emergency_contact_name: '', emergency_contact_relationship: '',
    emergency_contact_phone: '', emergency_contact_dob: '',
    emergency_contact_occupation: '', emergency_contact_address: '',
    salary: '', allowance: '', probation_period_months: '2',
    bank_account: '', bank_name: '', bank_branch: '', bank_account_holder: '',
  });

  const showToast = (type: 'success' | 'error' | 'warning', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleChange = useCallback((field: keyof FormValues) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }))
  , []);

  // Dùng cho các field số tiền (salary/allowance): input type="number" gốc bị lỗi
  // trên Safari — nếu NV gõ/dán số có dấu chấm phân cách hàng nghìn (VD: "8.500.000",
  // thói quen viết số tiền tiếng Việt), input[type=number] coi đó là số không hợp lệ
  // (nhiều dấu chấm) nên e.target.value trả về rỗng dù ô vẫn HIỂN THỊ "8.500.000" —
  // khiến validate luôn fail, nút "Tiếp theo" mãi mãi hiện "Vui lòng điền đầy đủ
  // thông tin" dù nhìn form đã điền đủ. Đổi sang type="text" + tự strip ký tự không
  // phải số ngay khi gõ/dán để tránh lặp lại lỗi này.
  const handleNumericChange = useCallback((field: keyof FormValues) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const digitsOnly = e.target.value.replace(/[^\d]/g, '');
      setValues((v) => ({ ...v, [field]: digitsOnly }));
    }
  , []);

  const handleSelect = useCallback((field: keyof FormValues) =>
    (value: string) => setValues((v) => ({ ...v, [field]: value }))
  , []);

  // ===== FETCH =====
  useEffect(() => {
    const fetchPublic = async (url: string) => {
      const res = await fetch(`${API_BASE_URL}${url}`, { headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.results || []);
    };
    Promise.all([
      fetchPublic('/api-hrm/company-units/?active_only=true'),
      fetchPublic('/api-hrm/departments/?page_size=1000'),
      fetchPublic('/api-hrm/positions/?page_size=1000'),
      fetchPublic('/api-hrm/sections/?page_size=1000'),
    ]).then(([cuList, deptList, posList, secList]) => {
      setCompanyUnits(cuList);
      setDepartments(deptList);
      setPositions(posList);
      setSections(secList);
    }).catch(() => {
      setCompanyUnits([]);
      setDepartments([]);
      setPositions([]);
      setSections([]);
    });
  }, []);

  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api-hrm/employee-onboarding-form/by-token/${token}/`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const data = await res.json();
        if (!data.success) { setPageError(data.error); return; }
        setOnboardingData(data.data);
        setValues((v) => ({
          ...v,
          candidate_name: data.data.candidate_name || '',
          candidate_email: data.data.candidate_email || '',
          candidate_phone: data.data.candidate_phone || '',
          date_of_birth: data.data.date_of_birth || '',
          gender: data.data.gender === 'MALE' ? 'M' : data.data.gender === 'FEMALE' ? 'F' : (data.data.gender || 'M'),
          education_level: data.data.education_level || '',
          facebook_link: data.data.facebook_link || '',
          region: data.data.region || '',
          block: data.data.block || '',
          sub_department: data.data.sub_department || '',
          section: data.data.section || '',
          position: data.data.position || '',
          job_rank: data.data.job_rank || '',
          ethnicity: data.data.ethnicity || '',
          birth_place: data.data.birth_place || '',
          nationality: data.data.nationality || '',
          probation_rate: data.data.probation_rate || '',
          doctor_team: data.data.doctor_team || '',
          work_form: data.data.work_form || '',
          work_location: data.data.work_location || '',
          company_unit: data.data.company_unit || '',
          citizen_id: data.data.citizen_id || '',
          citizen_id_issue_date: data.data.citizen_id_issue_date || '',
          citizen_id_issue_place: data.data.citizen_id_issue_place || '',
          old_id_number: data.data.old_id_number || '',
          permanent_address: data.data.permanent_address || '',
          current_address: data.data.current_address || '',
          social_insurance_number: data.data.social_insurance_number || '',
          tax_code: data.data.tax_code || '',
          marital_status: data.data.marital_status || 'SINGLE',
          emergency_contact_name: data.data.emergency_contact_name || '',
          emergency_contact_relationship: data.data.emergency_contact_relationship || '',
          emergency_contact_phone: data.data.emergency_contact_phone || '',
          emergency_contact_dob: data.data.emergency_contact_dob || '',
          emergency_contact_occupation: data.data.emergency_contact_occupation || '',
          emergency_contact_address: data.data.emergency_contact_address || '',
          salary: data.data.salary ? String(Math.floor(Number(data.data.salary))) : '',
          allowance: data.data.allowance ? String(Math.floor(Number(data.data.allowance))) : '',
          probation_period_months: data.data.probation_period_months ? String(data.data.probation_period_months) : '2',
          bank_account: data.data.bank_account || '',
          bank_name: data.data.bank_name || '',
          bank_branch: data.data.bank_branch || '',
          bank_account_holder: data.data.bank_account_holder || '',
        }));
        setHasCitizenIdFile(!!data.data.has_citizen_id_file);
        setHasVneidScreenshot(!!data.data.has_vneid_screenshot);
      } catch {
        setPageError('Không thể tải thông tin. Vui lòng kiểm tra lại link.');
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [token]);

  // ===== INLINE VALIDATION =====
  const NAME_REGEX = /^[a-zA-ZÀ-ỹ\s]+$/;
  const getFieldError = (field: string, val: string): string => {
    if (!val) return '';
    switch (field) {
      case 'date_of_birth': {
        const dob = new Date(val);
        if (isNaN(dob.getTime())) return 'Ngày sinh không hợp lệ';
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
        if (age < 18) return `Chưa đủ 18 tuổi (hiện ${age} tuổi)`;
        if (age > 65) return `Tuổi không hợp lệ (${age} tuổi)`;
        return '';
      }
      case 'citizen_id_issue_date': {
        const d = new Date(val);
        if (isNaN(d.getTime())) return 'Ngày cấp không hợp lệ';
        const minDate = new Date('2019-01-01');
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (d < minDate) return 'Ngày cấp CCCD gắn chip phải từ 01/01/2019 trở đi';
        if (d > today) return 'Ngày cấp không được sau hôm nay';
        return '';
      }
      case 'emergency_contact_dob': {
        const d = new Date(val);
        if (isNaN(d.getTime())) return 'Ngày sinh không hợp lệ';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (d > today) return 'Ngày sinh không được sau hôm nay';
        let age = today.getFullYear() - d.getFullYear();
        const monthDiff = today.getMonth() - d.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) age--;
        if (age < 18) return `Người liên hệ phải đủ 18 tuổi (hiện ${age} tuổi)`;
        if (age > 100) return `Tuổi không hợp lệ (${age} tuổi)`;
        return '';
      }
      case 'candidate_name':
      case 'emergency_contact_name':
      case 'emergency_contact_relationship':
        if (!NAME_REGEX.test(val)) return 'Không được chứa số hoặc ký tự đặc biệt';
        if (val.length > 50) return 'Tối đa 50 ký tự';
        return '';
      case 'candidate_phone':
      case 'emergency_contact_phone':
        if (!/^\d*$/.test(val)) return 'Chỉ được nhập số';
        if (val.length > 10) return 'Tối đa 10 chữ số';
        if (val.length > 0 && val.length < 10) return `Còn thiếu ${10 - val.length} số`;
        return '';
      case 'citizen_id':
        if (!/^\d*$/.test(val)) return 'Chỉ được nhập số';
        if (val.length > 12) return 'Tối đa 12 chữ số';
        if (val.length > 0 && val.length < 12) return `Còn thiếu ${12 - val.length} số`;
        return '';
      case 'old_id_number':
        if (!/^\d*$/.test(val)) return 'Chỉ được nhập số';
        if (val.length > 9) return 'Tối đa 9 chữ số';
        if (val.length > 0 && val.length < 9) return `Còn thiếu ${9 - val.length} số`;
        return '';
      case 'social_insurance_number':
        if (!/^\d*$/.test(val)) return 'Chỉ được nhập số';
        if (val.length > 10) return 'Tối đa 10 chữ số';
        if (val.length > 0 && val.length < 10) return `Còn thiếu ${10 - val.length} số`;
        return '';
      case 'tax_code':
        if (!/^\d*$/.test(val)) return 'Chỉ được nhập số';
        if (val.length > 13) return 'Tối đa 13 chữ số';
        if (val.length > 0 && val.length < 10) return `Tối thiểu 10 chữ số`;
        return '';
      case 'facebook_link':
        if (val && !/^https?:\/\//i.test(val)) return 'Phải bắt đầu bằng http:// hoặc https://';
        return '';
      default: return '';
    }
  };
  const validateStep = (step: number): boolean => {
    if (step === 1) {
      if (!values.candidate_name.trim()) { showToast('error', 'Vui lòng nhập họ và tên'); return false; }
      if (!NAME_REGEX.test(values.candidate_name.trim())) { showToast('error', 'Họ và tên không được chứa số hoặc ký tự đặc biệt'); return false; }
      if (values.candidate_name.trim().length > 50) { showToast('error', 'Họ và tên không quá 50 ký tự'); return false; }
      if (!values.date_of_birth) { showToast('error', 'Vui lòng chọn ngày sinh'); return false; }
      if (!values.gender) { showToast('error', 'Vui lòng chọn giới tính'); return false; }
      if (!values.candidate_phone.trim()) { showToast('error', 'Vui lòng nhập số điện thoại'); return false; }
      if (!/^\d{10}$/.test(values.candidate_phone.trim())) { showToast('error', 'Số điện thoại phải có đúng 10 chữ số'); return false; }
      if (!values.education_level) { showToast('error', 'Vui lòng chọn trình độ học vấn'); return false; }
      if (!values.ethnicity) { showToast('error', 'Vui lòng chọn dân tộc'); return false; }
      if (!values.birth_place.trim()) { showToast('error', 'Vui lòng nhập nơi khai sinh'); return false; }
      if (values.birth_place.trim().length > 200) { showToast('error', 'Nơi khai sinh không quá 200 ký tự'); return false; }
      if (!values.nationality.trim()) { showToast('error', 'Vui lòng nhập quốc tịch'); return false; }
      if (!values.facebook_link.trim()) { showToast('error', 'Vui lòng nhập link Facebook'); return false; }
      if (!/^https?:\/\//i.test(values.facebook_link.trim())) { showToast('error', 'Link Facebook phải bắt đầu bằng http:// hoặc https://'); return false; }
    }
    if (step === 2 && !isSelfUpdate) {
      if (!values.company_unit) { showToast('error', 'Vui lòng chọn đơn vị làm việc'); return false; }
      if (!values.region) { showToast('error', 'Vui lòng chọn vùng/miền'); return false; }
      if (!values.block) { showToast('error', 'Vui lòng chọn khối'); return false; }
      if (!values.sub_department) { showToast('error', 'Vui lòng chọn phòng/ban'); return false; }
      if (!values.position) { showToast('error', 'Vui lòng chọn vị trí'); return false; }
      if (!values.job_rank) { showToast('error', 'Vui lòng chọn cấp bậc'); return false; }
      if (!values.work_form) { showToast('error', 'Vui lòng chọn hình thức làm việc'); return false; }
      if (!values.work_location) { showToast('error', 'Vui lòng chọn địa điểm làm việc'); return false; }
    }
    if (step === 3) {
      if (!values.citizen_id.trim()) { showToast('error', 'Vui lòng nhập số CCCD'); return false; }
      if (!/^\d{12}$/.test(values.citizen_id.trim())) { showToast('error', 'Số CCCD phải có đúng 12 chữ số'); return false; }
      if (!citizenIdFile && !hasCitizenIdFile) { showToast('error', 'Vui lòng upload file CCCD (PDF)'); return false; }
      if (!vneidScreenshotFile && !hasVneidScreenshot) { showToast('error', 'Vui lòng upload ảnh chụp màn hình thông tin VNeID'); return false; }
      if (!values.citizen_id_issue_date) { showToast('error', 'Vui lòng chọn ngày cấp CCCD'); return false; }
      {
        const issueDate = new Date(values.citizen_id_issue_date);
        const minDate = new Date('2019-01-01');
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (Number.isNaN(issueDate.getTime())) { showToast('error', 'Ngày cấp CCCD không hợp lệ'); return false; }
        if (issueDate < minDate) { showToast('error', 'Ngày cấp CCCD phải từ 01/01/2019 trở đi'); return false; }
        if (issueDate > today) { showToast('error', 'Ngày cấp CCCD không được sau ngày hôm nay'); return false; }
      }
      if (!values.citizen_id_issue_place.trim()) { showToast('error', 'Vui lòng chọn nơi cấp CCCD'); return false; }
      if (values.old_id_number && !/^\d{9}$/.test(values.old_id_number.trim())) { showToast('error', 'Số CMND cũ phải có đúng 9 chữ số'); return false; }
    }
    if (step === 4) {
      if (!values.permanent_address.trim()) { showToast('error', 'Vui lòng nhập địa chỉ thường trú'); return false; }
      if (values.permanent_address.trim().length > 500) { showToast('error', 'Địa chỉ thường trú không quá 500 ký tự'); return false; }
      if (!values.current_address.trim()) { showToast('error', 'Vui lòng nhập địa chỉ hiện tại'); return false; }
      if (values.current_address.trim().length > 500) { showToast('error', 'Địa chỉ hiện tại không quá 500 ký tự'); return false; }
      if (values.social_insurance_number.trim() && !/^\d{10}$/.test(values.social_insurance_number.trim())) { showToast('error', 'Mã BHXH phải có đúng 10 chữ số'); return false; }
      if (values.tax_code.trim() && !/^\d{10,13}$/.test(values.tax_code.trim())) { showToast('error', 'Mã số thuế phải có 10-13 chữ số'); return false; }
      if (!values.marital_status) { showToast('error', 'Vui lòng chọn tình trạng hôn nhân'); return false; }
    }
    if (step === 5) {
      if (!values.emergency_contact_name.trim()) { showToast('error', 'Vui lòng nhập tên người liên hệ khẩn cấp'); return false; }
      if (!NAME_REGEX.test(values.emergency_contact_name.trim())) { showToast('error', 'Tên người liên hệ không được chứa số hoặc ký tự đặc biệt'); return false; }
      if (values.emergency_contact_name.trim().length > 50) { showToast('error', 'Tên người liên hệ không quá 50 ký tự'); return false; }
      if (!values.emergency_contact_relationship.trim()) { showToast('error', 'Vui lòng nhập mối quan hệ'); return false; }
      if (!NAME_REGEX.test(values.emergency_contact_relationship.trim())) { showToast('error', 'Mối quan hệ không được chứa số hoặc ký tự đặc biệt'); return false; }
      if (!values.emergency_contact_phone.trim()) { showToast('error', 'Vui lòng nhập số điện thoại người liên hệ'); return false; }
      if (!/^\d{10}$/.test(values.emergency_contact_phone.trim())) { showToast('error', 'Số điện thoại người liên hệ phải có đúng 10 chữ số'); return false; }
      if (!values.emergency_contact_dob) { showToast('error', 'Vui lòng chọn ngày sinh người liên hệ'); return false; }
      {
        const err = getFieldError('emergency_contact_dob', values.emergency_contact_dob);
        if (err) { showToast('error', err); return false; }
      }
      if (!values.emergency_contact_occupation.trim()) { showToast('error', 'Vui lòng nhập nghề nghiệp người liên hệ'); return false; }
      if (!values.emergency_contact_address.trim()) { showToast('error', 'Vui lòng nhập địa chỉ người liên hệ'); return false; }
    }
    if (step === 6) {
      if (!isSelfUpdate) {
        if (!values.salary.trim()) { showToast('error', 'Vui lòng nhập mức lương cơ bản'); return false; }
        if (isNaN(Number(values.salary)) || Number(values.salary) <= 0) { showToast('error', 'Mức lương cơ bản phải là số dương'); return false; }
        if (values.allowance.trim() !== '' && (isNaN(Number(values.allowance)) || Number(values.allowance) < 0)) { showToast('error', 'Phụ cấp không hợp lệ'); return false; }
      }
      if (!values.bank_account.trim()) { showToast('error', 'Vui lòng nhập số tài khoản ngân hàng'); return false; }
      if (!values.bank_name.trim()) { showToast('error', 'Vui lòng nhập tên ngân hàng'); return false; }
      if (!values.bank_account_holder.trim()) { showToast('error', 'Vui lòng nhập tên chủ tài khoản'); return false; }
    }
    return true;
  };

  // Check required fields đã điền đủ chưa (không show toast, chỉ return boolean)
  const isStepComplete = (step: number): boolean => {
    if (step === 0) {
      return !!(values.candidate_name.trim() && !getFieldError('candidate_name', values.candidate_name) &&
        values.date_of_birth && !getFieldError('date_of_birth', values.date_of_birth) &&
        values.gender &&
        values.candidate_phone.trim() && /^\d{10}$/.test(values.candidate_phone.trim()) &&
        values.education_level && values.ethnicity &&
        values.birth_place.trim() && values.nationality.trim() &&
        values.facebook_link.trim() && !getFieldError('facebook_link', values.facebook_link));
    }
    if (step === 1) {
      if (isSelfUpdate) return true;
      return !!(values.company_unit && values.region && values.block && values.sub_department &&
        values.position && values.job_rank && values.work_form && values.work_location);
    }
    if (step === 2) {
      return !!(values.citizen_id.trim() && (citizenIdFile || hasCitizenIdFile) && (vneidScreenshotFile || hasVneidScreenshot) &&
        values.citizen_id_issue_date && values.citizen_id_issue_place.trim());
    }
    if (step === 3) {
      return !!(values.permanent_address.trim() && values.current_address.trim() && values.marital_status);
    }
    if (step === 4) {
      return !!(values.emergency_contact_name.trim() && values.emergency_contact_relationship.trim() &&
        values.emergency_contact_phone.trim() && /^\d{10}$/.test(values.emergency_contact_phone.trim()) &&
        values.emergency_contact_dob && !getFieldError('emergency_contact_dob', values.emergency_contact_dob) &&
        values.emergency_contact_occupation.trim() &&
        values.emergency_contact_address.trim());
    }
    if (step === 5) {
      return !!((isSelfUpdate || (values.salary.trim() && !isNaN(Number(values.salary)) && Number(values.salary) > 0)) &&
        values.bank_account.trim() && values.bank_name.trim() && values.bank_account_holder.trim());
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep + 1)) setCurrentStep((s) => Math.min(s + 1, totalSteps - 1));
  };
  const handlePrevious = () => setCurrentStep((s) => Math.max(s - 1, 0));

  // ===== FILE =====
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('error', 'File CCCD phải là định dạng PDF'); e.target.value = ''; return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('error', 'File CCCD không được vượt quá 15MB'); e.target.value = ''; return;
    }
    setCitizenIdFile(file);
  };

  const handleVneidScreenshotChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mime = (file.type || '').toLowerCase();
    const okMime = !mime || VNEID_ALLOWED_MIME.has(mime);
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const okExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext);
    if (!okMime && !okExt) {
      showToast('error', 'Ảnh VNeID: chỉ chấp nhận JPG, PNG, GIF, WEBP, HEIC/HEIF');
      e.target.value = ''; return;
    }
    if (file.size > VNEID_MAX_BYTES) {
      showToast('error', 'Ảnh VNeID không được vượt quá 10MB');
      e.target.value = ''; return;
    }
    setVneidScreenshotFile(file);
  };

  // ===== SUBMIT =====
  const handleSubmit = async () => {
    for (let step = 1; step <= 6; step++) {
      if (!validateStep(step)) return;
    }
    if (!citizenIdFile && !hasCitizenIdFile) { showToast('error', 'Vui lòng upload file CCCD (PDF)'); return; }
    if (!vneidScreenshotFile && !hasVneidScreenshot) { showToast('error', 'Vui lòng upload ảnh chụp màn hình thông tin VNeID'); return; }
    setSubmitting(true);
    try {
      const payload = new FormData();
      const ap = (key: string, val: string | File | null | undefined) => {
        if (isSelfUpdate && SELF_UPDATE_HIDDEN_FIELDS.has(key)) return;
        if (val !== undefined && val !== null && val !== '') payload.append(key, val);
      };
      ap('candidate_name', values.candidate_name);
      ap('candidate_email', values.candidate_email);
      ap('candidate_phone', values.candidate_phone);
      ap('date_of_birth', values.date_of_birth);
      ap('gender', values.gender);
      ap('education_level', values.education_level);
      ap('ethnicity', values.ethnicity);
      ap('birth_place', values.birth_place);
      ap('nationality', values.nationality);
      ap('probation_rate', values.probation_rate);
      ap('facebook_link', values.facebook_link);
      ap('company_unit', values.company_unit);
      ap('region', values.region);
      ap('block', values.block);
      ap('sub_department', values.sub_department);
      ap('section', values.section);
      ap('position', values.position);
      ap('job_rank', values.job_rank);
      ap('doctor_team', values.doctor_team);
      ap('work_form', values.work_form);
      ap('work_type', workType);
      ap('work_location', values.work_location);
      ap('citizen_id', values.citizen_id);
      if (citizenIdFile) payload.append('citizen_id_file', citizenIdFile);
      if (vneidScreenshotFile) payload.append('vneid_screenshot', vneidScreenshotFile);
      ap('citizen_id_issue_date', values.citizen_id_issue_date);
      ap('citizen_id_issue_place', values.citizen_id_issue_place);
      ap('old_id_number', values.old_id_number);
      ap('permanent_address', values.permanent_address);
      ap('current_address', values.current_address);
      ap('social_insurance_number', values.social_insurance_number);
      ap('tax_code', values.tax_code);
      ap('marital_status', values.marital_status);
      ap('emergency_contact_name', values.emergency_contact_name);
      ap('emergency_contact_relationship', values.emergency_contact_relationship);
      ap('emergency_contact_phone', values.emergency_contact_phone);
      ap('emergency_contact_dob', values.emergency_contact_dob);
      ap('emergency_contact_occupation', values.emergency_contact_occupation);
      ap('emergency_contact_address', values.emergency_contact_address);
      ap('salary', values.salary);
      ap('allowance', values.allowance);
      ap('probation_period_months', values.probation_period_months);
      ap('bank_account', values.bank_account);
      ap('bank_name', values.bank_name);
      ap('bank_branch', values.bank_branch);
      ap('bank_account_holder', values.bank_account_holder);

      const res = await fetch(
        `${API_BASE_URL}/api-hrm/employee-onboarding-form/submit/${token}/`,
        { method: 'POST', body: payload }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msgs: string[] = [];
        Object.entries(err.errors ?? err).forEach(([f, v]) => {
          msgs.push(`${f}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
        });
        showToast('error', msgs.length ? msgs.join(' | ') : 'Lưu thất bại');
        return;
      }
      setSuccess(true);
    } catch {
      showToast('error', 'Có lỗi xảy ra khi kết nối server.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================
  // LOADING / ERROR / SUCCESS
  // ============================================

  if (loading) return (
    <div className="notranslate flex items-center justify-center min-h-screen bg-gray-50" translate="no">
      <div className="text-center">
        <ArrowPathIcon className="w-12 h-12 text-blue-500 animate-spin mx-auto" />
        <p className="mt-4 text-gray-500">Đang tải...</p>
      </div>
    </div>
  );

  if (pageError) return (
    <div className="notranslate flex items-center justify-center min-h-screen bg-gray-50 p-4" translate="no">
      <div className="text-center max-w-md">
        <ExclamationCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-2">Không thể truy cập form</h2>
        <p className="text-gray-500 mb-6">{pageError}</p>
        <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
          Liên hệ HR
        </button>
      </div>
    </div>
  );

  if (success) return (
    <div className="notranslate flex items-center justify-center min-h-screen bg-gray-50 p-4" translate="no">
      <div className="text-center max-w-md">
        <CheckCircleIcon className="w-20 h-20 text-amber-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Đã gửi thông tin!</h2>
        <p className="text-gray-500 mb-2">Cảm ơn bạn đã điền thông tin.</p>
        <p className="text-gray-500 mb-6">
          Thông tin của bạn đang chờ <strong>quản lý trực tiếp xác nhận</strong>.
          Bạn sẽ được thông báo sau khi được duyệt.
        </p>
        <button
          onClick={() => { try { window.close(); } catch {} setTimeout(() => window.location.href = 'about:blank', 200); }}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Đóng trang
        </button>
      </div>
    </div>
  );

  // ============================================
  // RENDER STEPS
  // ============================================

  const renderStep = () => {
    switch (currentStep) {

      // ── BƯỚC 1: Thông tin cơ bản ──
      case 0: return (
        <div className="flex-1 flex flex-col gap-5 justify-evenly">
          <h3 className="text-4xl font-bold text-gray-900 text-center">Thông tin cơ bản</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Họ và tên" value={values.candidate_name} onChange={handleChange('candidate_name')} required placeholder="Nguyễn Văn A" error={getFieldError('candidate_name', values.candidate_name)} maxLength={50} />
            <TF label="Email" value={values.candidate_email} onChange={handleChange('candidate_email')} disabled />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Ngày sinh" value={values.date_of_birth} onChange={handleChange('date_of_birth')} required type="date" error={getFieldError('date_of_birth', values.date_of_birth)} />
            <SF label="Giới tính" value={values.gender} onChange={handleSelect('gender')}
              options={[{ value: 'M', label: 'Nam' }, { value: 'F', label: 'Nữ' }, { value: 'O', label: 'Khác' }]} required />
          </div>
          <TF label="Số điện thoại" value={values.candidate_phone} onChange={handleChange('candidate_phone')} required placeholder="0123456789" error={getFieldError('candidate_phone', values.candidate_phone)} maxLength={10} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SF label="Trình độ học vấn" value={values.education_level} onChange={handleSelect('education_level')} options={EDUCATION_LEVEL_OPTIONS} required />
            <SF label="Dân tộc" value={values.ethnicity} onChange={handleSelect('ethnicity')} options={ETHNICITY_OPTIONS} searchable />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Nơi khai sinh" value={values.birth_place} onChange={handleChange('birth_place')} placeholder="Xã/Phường, Tỉnh/TP theo đơn vị hành chính mới" />
            <SF label="Quốc tịch" value={values.nationality} onChange={handleSelect('nationality')} options={NATIONALITY_OPTIONS} searchable />
          </div>
          <TF label="Link Facebook" value={values.facebook_link} onChange={handleChange('facebook_link')} placeholder="https://facebook.com/..." required error={getFieldError('facebook_link', values.facebook_link)} />
        </div>
      );

      // ── BƯỚC 2: Thông tin công việc ──
      case 1: return isSelfUpdate ? (
        <div className="flex-1 flex flex-col gap-5 justify-center">
          <h3 className="text-3xl font-bold text-gray-900 text-center">Thông tin công việc</h3>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-base text-blue-900 space-y-2">
            <p>
              Vị trí: <strong>{onboardingData?.position_name || '—'}</strong> — Phòng ban:{' '}
              <strong>{onboardingData?.department_name || '—'}</strong>
            </p>
            <p className="text-sm text-blue-800">
              Thông tin công việc (đơn vị, phòng ban, vị trí, cấp bậc, hình thức và địa điểm làm việc) và thông tin lương
              do HCNS quản lý, không sửa được ở đây. Nếu chưa đúng, vui lòng liên hệ HCNS.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-5 justify-evenly">
          <h3 className="text-3xl font-bold text-gray-900 text-center">Thông tin công việc chi tiết</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
            <SF label="Đơn vị làm việc" value={values.company_unit} onChange={handleSelect('company_unit')}
              options={companyUnits.map(cu => ({ value: cu.code, label: cu.name }))} />
            <SF label="Vùng/Miền" value={values.region} onChange={handleSelect('region')} options={REGION_OPTIONS} />
            <SF label="Khối" value={values.block} onChange={handleSelect('block')} options={BLOCK_OPTIONS} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SF label="Phòng/Ban" value={values.sub_department} onChange={handleSelect('sub_department')} options={departments.length > 0 ? departments.map(d => ({ value: d.name, label: d.name })) : SUB_DEPARTMENT_OPTIONS} searchable />
            <SF label="Bộ phận" value={values.section} onChange={handleSelect('section')} options={sections.length > 0 ? sections.map(s => ({ value: s.name, label: s.name })) : SECTION_OPTIONS} searchable />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SF label="Vị trí" value={values.position} onChange={handleSelect('position')} options={positions.length > 0 ? positions.map(p => ({ value: p.title, label: p.title })) : POSITION_OPTIONS} searchable />
            <SF label="Cấp bậc" value={values.job_rank} onChange={handleSelect('job_rank')} options={RANK_OPTIONS} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Team Bác sĩ" value={values.doctor_team} onChange={handleChange('doctor_team')} placeholder="Team Dr. Nguyễn Văn A..." />
            <SF label="Địa điểm làm việc" value={values.work_location} onChange={handleSelect('work_location')} options={WORK_LOCATION_OPTIONS} required />
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <RF label="Hình thức làm việc" value={values.work_form}
              onChange={(val) => { handleSelect('work_form')(val); setWorkType(WORK_FORM_OPTIONS.find((o) => o.value === val)?.label ?? ''); }}
              options={WORK_FORM_OPTIONS} required />
          </div>
        </div>
      );

      // ── BƯỚC 3: CCCD ──
      case 2: return (
        <div className="flex-1 flex flex-col gap-5 justify-evenly">
          <h3 className="text-3xl font-bold text-gray-900 text-center">Thông tin CCCD</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Số CCCD" value={values.citizen_id} onChange={handleChange('citizen_id')} required placeholder="001234567890" error={getFieldError('citizen_id', values.citizen_id)} maxLength={12} />
            <TF label="Số CMND cũ (nếu có)" value={values.old_id_number} onChange={handleChange('old_id_number')} placeholder="123456789" error={getFieldError('old_id_number', values.old_id_number)} maxLength={9} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">File CCCD (2 mặt - PDF) <span className="text-red-500">*</span></p>
              <label className={`flex items-center gap-3 w-full border-2 border-dashed rounded-lg px-4 py-3 cursor-pointer transition-colors
                ${(citizenIdFile || hasCitizenIdFile) ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'}`}>
                <span className="text-2xl">{(citizenIdFile || hasCitizenIdFile) ? '✅' : '📄'}</span>
                <div className="flex-1 min-w-0">
                  {citizenIdFile
                    ? <p className="text-sm text-green-700 font-medium truncate">{citizenIdFile.name}</p>
                    : hasCitizenIdFile
                      ? <p className="text-sm text-green-700 font-medium truncate">Đã nộp CCCD trước đó (nhấn chọn tệp mới để đổi)</p>
                      : <p className="text-sm text-gray-500">Nhấn để chọn file PDF (tối đa 15MB)</p>
                  }
                </div>
                <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
              </label>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Ảnh VNeID <span className="text-red-500">*</span></p>
              <label className={`flex items-center gap-3 w-full border-2 border-dashed rounded-lg px-4 py-3 cursor-pointer transition-colors
                ${(vneidScreenshotFile || hasVneidScreenshot) ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'}`}>
                <span className="text-2xl">{(vneidScreenshotFile || hasVneidScreenshot) ? '✅' : '🖼️'}</span>
                <div className="flex-1 min-w-0">
                  {vneidScreenshotFile
                    ? <p className="text-sm text-green-700 font-medium truncate">{vneidScreenshotFile.name}</p>
                    : hasVneidScreenshot
                      ? <p className="text-sm text-green-700 font-medium truncate">Đã nộp ảnh trước đó (nhấn chọn tệp mới để đổi)</p>
                      : <p className="text-sm text-gray-500">Nhấn để chọn ảnh hoặc PDF (JPG, PNG, PDF...)</p>
                  }
                </div>
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,.heic,.heif,application/pdf" onChange={handleVneidScreenshotChange} className="hidden" />
              </label>
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Đăng nhập VNEID mức 2 - Ví giấy tờ - Căn cước điện tử - Chụp màn hình chứa thông tin nơi đăng ký khai sinh, nơi thường trú, tạm trú...
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Ngày cấp" value={values.citizen_id_issue_date} onChange={handleChange('citizen_id_issue_date')} type="date" required error={getFieldError('citizen_id_issue_date', values.citizen_id_issue_date)} />
            <SF label="Nơi cấp" value={values.citizen_id_issue_place} onChange={handleSelect('citizen_id_issue_place')} options={CITIZEN_ID_ISSUE_PLACE_OPTIONS} required />
          </div>
        </div>
      );

      // ── BƯỚC 4: Địa chỉ & BHXH ──
      case 3: return (
        <div className="flex-1 flex flex-col gap-5 justify-evenly">
          <h3 className="text-3xl font-bold text-gray-900 text-center">Địa chỉ & BHXH</h3>
          <TF label="Địa chỉ thường trú" value={values.permanent_address} onChange={handleChange('permanent_address')} multiline rows={2} required placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố" />
          <p className="text-xs text-gray-500 px-1 -mt-2">(Vui lòng tra cứu địa chỉ mới bằng cách đăng nhập ứng dụng VNeID để kiểm tra)</p>
          <TF label="Địa chỉ hiện tại" value={values.current_address} onChange={handleChange('current_address')} multiline rows={2} required placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <TF label="Mã BHXH" value={values.social_insurance_number} onChange={handleChange('social_insurance_number')} placeholder="1234567890" error={getFieldError('social_insurance_number', values.social_insurance_number)} maxLength={10} />
              <p className="text-xs text-gray-500 mt-1">
                (Tra cứu tại{' '}
                <a href="https://baohiemxahoi.gov.vn/tracuu/Pages/tra-cuu-ho-gia-dinh.aspx" target="_blank" rel="noreferrer" className="text-blue-500 underline">
                  baohiemxahoi.gov.vn
                </a>)
              </p>
            </div>
            <div>
              <TF label="Mã số thuế" value={values.tax_code} onChange={handleChange('tax_code')} placeholder="0123456789" error={getFieldError('tax_code', values.tax_code)} maxLength={13} />
              <p className="text-xs text-gray-500 mt-1">
                (Tra cứu tại{' '}
                <a href="https://masothue.com/tra-cuu-ma-so-thue-ca-nhan" target="_blank" rel="noreferrer" className="text-blue-500 underline">
                  masothue.com
                </a>)
              </p>
            </div>
          </div>

          <SF label="Tình trạng hôn nhân" value={values.marital_status} onChange={handleSelect('marital_status')} required options={[
            { value: 'SINGLE', label: 'Độc thân' },
            { value: 'MARRIED', label: 'Đã kết hôn' },
            { value: 'DIVORCED', label: 'Ly hôn' },
            { value: 'WIDOWED', label: 'Góa' },
          ]} />
        </div>
      );

      // ── BƯỚC 5: Người liên hệ khẩn cấp ──
      case 4: return (
        <div className="flex-1 flex flex-col gap-5 justify-evenly">
          <h3 className="text-3xl font-bold text-gray-900 text-center">Người liên hệ khẩn cấp</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Họ và tên" value={values.emergency_contact_name} onChange={handleChange('emergency_contact_name')} required placeholder="Nguyễn Văn B" error={getFieldError('emergency_contact_name', values.emergency_contact_name)} maxLength={50} />
            <TF label="Mối quan hệ" value={values.emergency_contact_relationship} onChange={handleChange('emergency_contact_relationship')} required placeholder="Bố, mẹ, vợ, chồng..." error={getFieldError('emergency_contact_relationship', values.emergency_contact_relationship)} maxLength={30} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Số điện thoại" value={values.emergency_contact_phone} onChange={handleChange('emergency_contact_phone')} required placeholder="0987654321" error={getFieldError('emergency_contact_phone', values.emergency_contact_phone)} maxLength={10} />
            <TF label="Ngày sinh" value={values.emergency_contact_dob} onChange={handleChange('emergency_contact_dob')} type="date" required error={getFieldError('emergency_contact_dob', values.emergency_contact_dob)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TF label="Nghề nghiệp" value={values.emergency_contact_occupation} onChange={handleChange('emergency_contact_occupation')} required placeholder="Giáo viên, Bác sĩ..." />
            <TF label="Địa chỉ" value={values.emergency_contact_address} onChange={handleChange('emergency_contact_address')} required placeholder="Số nhà, đường, phường/xã..." />
          </div>
        </div>
      );

      // ── BƯỚC 6: Thông tin lương ──
      case 5: return (
        <div className="flex-1 flex flex-col gap-5 justify-evenly">
          <h3 className="text-3xl font-bold text-gray-900 text-center">{isSelfUpdate ? 'Thông tin ngân hàng' : 'Thông tin lương'}</h3>
          {!isSelfUpdate && (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TF label="Mức lương cơ bản (VNĐ)" value={values.salary} onChange={handleNumericChange('salary')} type="text" inputMode="numeric" placeholder="10000000" required />
              <TF label="Phụ cấp (VNĐ)" value={values.allowance} onChange={handleNumericChange('allowance')} type="text" inputMode="numeric" placeholder="0" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SF label="Số tháng thử việc" value={values.probation_period_months} onChange={handleSelect('probation_period_months')} options={[
                { value: '0', label: 'Không thử việc' },
                { value: '1', label: '1 tháng' },
                { value: '2', label: '2 tháng' },
                { value: '3', label: '3 tháng' },
                { value: '6', label: '6 tháng' },
              ]} />
              <SF label="Tỉ lệ thử việc" value={values.probation_rate} onChange={handleSelect('probation_rate')} options={[
                { value: 'OPTION_1', label: 'Tháng đầu 85%, tháng sau 85%' },
                { value: 'OPTION_2', label: 'Tháng đầu 85%, tháng sau 100%' },
                { value: 'OPTION_3', label: 'Tháng đầu 100%, tháng sau 100%' },
              ]} />
            </div>
            </>
          )}

          <div className="border border-gray-200 rounded-xl p-4 space-y-4">
            <p className="text-base font-semibold text-gray-700">Thông tin ngân hàng</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TF label="Số tài khoản" value={values.bank_account} onChange={handleChange('bank_account')} placeholder="123456789012" required />
              <TF label="Tên ngân hàng" value={values.bank_name} onChange={handleChange('bank_name')} placeholder="ACB, Vietcombank, Techcombank..." required />
            </div>
            <TF label="Tên chủ tài khoản" value={values.bank_account_holder} onChange={handleChange('bank_account_holder')} placeholder="NGUYEN VAN A" required />
            <div>
              <TF label="Chi nhánh" value={values.bank_branch} onChange={handleChange('bank_branch')} placeholder="Chi nhánh Hà Nội, TP.HCM..." />
              <p className="text-xs text-gray-400 mt-1 px-1">* Trong trường hợp không phải Ngân hàng ACB</p>
            </div>
          </div>
        </div>
      );

      // ── BƯỚC 7: Xác nhận & Tóm tắt ──
      case 6: {
        const SummaryCell: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
          <div className="bg-white rounded-lg px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">{label}</p>
            <p className={`text-sm truncate ${value ? 'text-gray-900 font-semibold' : 'text-gray-300'}`} title={value || undefined}>
              {value || '—'}
            </p>
          </div>
        );

        const groups = [
          { title: 'Thông tin cơ bản', color: 'blue', fields: [
            ['Họ và tên', values.candidate_name],
            ['Email', values.candidate_email],
            ['Ngày sinh', values.date_of_birth ? new Date(values.date_of_birth).toLocaleDateString('vi-VN') : null],
            ['Giới tính', values.gender === 'M' ? 'Nam' : values.gender === 'F' ? 'Nữ' : values.gender === 'O' ? 'Khác' : null],
            ['Số điện thoại', values.candidate_phone],
            ['Trình độ học vấn', values.education_level],
            ['Dân tộc', values.ethnicity],
            ['Nơi khai sinh', values.birth_place],
            ['Quốc tịch', values.nationality],
            ['Link Facebook', values.facebook_link],
          ]},
          ...(isSelfUpdate ? [] : [{ title: 'Công việc', color: 'indigo', fields: [
            ['Đơn vị', companyUnits.find(cu => cu.code === values.company_unit)?.name || values.company_unit || null],
            ['Vùng/Miền', values.region],
            ['Khối', values.block],
            ['Phòng/Ban', values.sub_department],
            ['Bộ phận', values.section || null],
            ['Vị trí', values.position],
            ['Cấp bậc', values.job_rank],
            ['Team Bác sĩ', values.doctor_team],
            ['Hình thức', WORK_FORM_OPTIONS.find(o => o.value === values.work_form)?.label || values.work_form || null],
            ['Địa điểm', WORK_LOCATION_OPTIONS.find(o => o.value === values.work_location)?.label || values.work_location || null],
          ]}]),
          { title: 'CCCD', color: 'amber', fields: [
            ['Số CCCD', values.citizen_id],
            ['Ngày cấp', values.citizen_id_issue_date ? new Date(values.citizen_id_issue_date).toLocaleDateString('vi-VN') : null],
            ['Nơi cấp', CITIZEN_ID_ISSUE_PLACE_OPTIONS.find(o => o.value === values.citizen_id_issue_place)?.label || values.citizen_id_issue_place || null],
            ['Số CMND cũ', values.old_id_number],
            ['File CCCD', citizenIdFile ? citizenIdFile.name : null],
            ['Ảnh VNeID', vneidScreenshotFile ? vneidScreenshotFile.name : null],
          ]},
          { title: 'Địa chỉ & BHXH', color: 'emerald', fields: [
            ['Địa chỉ thường trú', values.permanent_address],
            ['Địa chỉ hiện tại', values.current_address],
            ['Mã BHXH', values.social_insurance_number],
            ['Mã số thuế', values.tax_code],
            ['Tình trạng hôn nhân', ({ SINGLE: 'Độc thân', MARRIED: 'Đã kết hôn', DIVORCED: 'Ly hôn', WIDOWED: 'Góa' } as Record<string, string>)[values.marital_status] || null],
          ]},
          { title: 'Liên hệ khẩn cấp', color: 'rose', fields: [
            ['Họ và tên', values.emergency_contact_name],
            ['Mối quan hệ', values.emergency_contact_relationship],
            ['Số điện thoại', values.emergency_contact_phone],
            ['Ngày sinh', values.emergency_contact_dob ? new Date(values.emergency_contact_dob).toLocaleDateString('vi-VN') : null],
            ['Nghề nghiệp', values.emergency_contact_occupation],
            ['Địa chỉ', values.emergency_contact_address],
          ]},
          { title: isSelfUpdate ? 'Ngân hàng' : 'Lương & Ngân hàng', color: 'purple', fields: [
            ...(isSelfUpdate ? [] : [
              ['Mức lương', values.salary ? `${parseInt(values.salary).toLocaleString()} VNĐ` : null],
              ['Phụ cấp', values.allowance ? `${parseInt(values.allowance).toLocaleString()} VNĐ` : null],
              ['Thời gian thử việc', values.probation_period_months ? `${values.probation_period_months} tháng` : null],
              ['Tỉ lệ thử việc', ({ OPTION_1: '85% → 85%', OPTION_2: '85% → 100%', OPTION_3: '100% → 100%' } as Record<string, string>)[values.probation_rate] || null],
            ]),
            ['Ngân hàng', values.bank_name],
            ['Số tài khoản', values.bank_account],
            ['Tên chủ tài khoản', values.bank_account_holder],
            ['Chi nhánh', values.bank_branch],
          ]},
        ] as { title: string; color: string; fields: [string, string | null][] }[];

        const bgMap: Record<string, string> = {
          blue: 'bg-blue-50', indigo: 'bg-indigo-50', amber: 'bg-amber-50',
          emerald: 'bg-emerald-50', rose: 'bg-rose-50', purple: 'bg-purple-50',
        };
        const borderMap: Record<string, string> = {
          blue: 'border-blue-200', indigo: 'border-indigo-200', amber: 'border-amber-200',
          emerald: 'border-emerald-200', rose: 'border-rose-200', purple: 'border-purple-200',
        };
        const titleMap: Record<string, string> = {
          blue: 'text-blue-700', indigo: 'text-indigo-700', amber: 'text-amber-700',
          emerald: 'text-emerald-700', rose: 'text-rose-700', purple: 'text-purple-700',
        };

        return (
          <div className="flex-1 flex flex-col gap-5">
            <div className="text-center mb-2">
              <h3 className="text-3xl font-bold text-gray-900">Xác nhận thông tin</h3>
              <p className="text-gray-500 mt-2">Vui lòng kiểm tra lại trước khi gửi. Bấm vào bước bên trái để chỉnh sửa.</p>
            </div>

            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.title} className={`rounded-xl border ${borderMap[group.color]} ${bgMap[group.color]} p-4`}>
                  <p className={`text-sm font-bold uppercase tracking-wider mb-3 ${titleMap[group.color]}`}>{group.title}</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {group.fields.map(([label, val]) => (
                      <SummaryCell key={label} label={label} value={val} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      default: return null;
    }
  };

  // ============================================
  // MAIN RENDER
  // ============================================

  return (
    <div className="notranslate min-h-screen bg-slate-50 flex flex-col" translate="no">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl text-white text-sm max-w-sm flex items-center gap-2 animate-in slide-in-from-top
          ${toast.type === 'success' ? 'bg-green-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-amber-500'}`}>
          <span className="flex-1">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="text-white/80 hover:text-white">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header bar — full width */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{isSelfUpdate ? 'Cập nhật hồ sơ' : 'Thông tin Onboarding'}</h1>
              <p className="mt-2 text-lg text-blue-100">
                Xin chào, <strong className="text-white text-xl">{onboardingData?.candidate_name}</strong>!
              </p>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1.5 text-base">
              <span className="text-blue-200">{onboardingData?.position_name || '—'} — {onboardingData?.department_name || '—'}</span>
              <span className="text-blue-200">
                Ngày bắt đầu: <strong className="text-white">{onboardingData?.start_date ? new Date(onboardingData.start_date).toLocaleDateString('vi-VN') : '—'}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Warning banner */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-2 text-sm text-amber-800">
          <ExclamationCircleIcon className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            Link có hiệu lực đến{' '}
            <strong>{onboardingData?.token_expires_at ? new Date(onboardingData.token_expires_at).toLocaleString('vi-VN') : '—'}</strong>
          </span>
        </div>
      </div>

      {/* Main content: sidebar + form */}
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col">
        <div className="flex flex-col lg:flex-row gap-6 flex-1">

          {/* Sidebar — steps */}
          <div className="lg:w-72 shrink-0">
            {/* Mobile: horizontal steps */}
            <div className="flex lg:hidden items-center justify-between bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-gray-100 mb-3 gap-1">
              {STEP_LABELS.map((label, i) => {
                const active = i === currentStep;
                const done = i < currentStep;
                return (
                  <button key={label} onClick={() => done && setCurrentStep(i)} className="flex flex-col items-center flex-1 gap-1">
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-all
                      ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white ring-2 sm:ring-4 ring-blue-100' : 'bg-gray-100 text-gray-400'}`}>
                      {done ? <CheckCircleIcon className="w-4 h-4 sm:w-5 sm:h-5" /> : i + 1}
                    </div>
                    <span className={`text-[9px] sm:text-xs font-semibold leading-tight text-center ${active ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-400'}`}>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Desktop: vertical steps */}
            <div className="hidden lg:block bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sticky top-6">
              {/* Header + progress */}
              {(() => {
                const pct = Math.round((currentStep / totalSteps) * 100);
                return (
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Các bước</p>
                      <span className={`text-sm font-bold ${pct >= 100 ? 'text-green-600' : 'text-blue-600'}`}>{currentStep}/{totalSteps}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className={`h-2 rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-gradient-to-r from-green-400 to-green-500' : 'bg-gradient-to-r from-blue-400 to-blue-600'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                {STEP_LABELS.map((label, i) => {
                  const active = i === currentStep;
                  const done = i < currentStep;
                  return (
                    <button
                      key={label}
                      onClick={() => done && setCurrentStep(i)}
                      className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-all text-base
                        ${active ? 'bg-blue-50 text-blue-700 font-semibold border-2 border-blue-200' : done ? 'text-green-700 hover:bg-green-50 cursor-pointer border-2 border-transparent' : 'text-gray-400 cursor-default border-2 border-transparent'}`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all
                        ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                        {done ? <CheckCircleIcon className="w-5 h-5" /> : i + 1}
                      </div>
                      <div className="flex flex-col">
                        <span className="leading-tight">{label}</span>
                        {active && <span className="text-xs text-blue-500 font-normal">Đang check thông tin</span>}
                        {done && <span className="text-xs text-green-500 font-normal">Hoàn thành</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Form card */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col flex-1">
              {/* Mobile progress bar */}
              <div className="lg:hidden h-1.5 bg-gray-100">
                <div className={`h-1.5 transition-all duration-500 ${currentStep >= totalSteps ? 'bg-green-500' : 'bg-blue-600'}`} style={{ width: `${Math.round((currentStep / totalSteps) * 100)}%` }} />
              </div>

              {/* Form body */}
              <div className="p-6 sm:p-8 flex-1 flex flex-col">
                <div className="flex-1 flex flex-col justify-evenly gap-4">
                  {renderStep()}
                </div>
              </div>

              {/* Navigation */}
              <div className="px-6 sm:px-8 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                {currentStep > 0 ? (
                  <button
                    onClick={handlePrevious}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    ← Quay lại
                  </button>
                ) : <div />}
                {currentStep < totalSteps - 1 ? (
                  isStepComplete(currentStep) ? (
                    <button
                      onClick={handleNext}
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm shadow-blue-200 disabled:opacity-50 transition-colors"
                    >
                      Tiếp theo →
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-6 py-2.5 text-sm text-gray-400 italic">
                      Vui lòng điền đầy đủ thông tin
                    </span>
                  )
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 shadow-sm shadow-green-200 disabled:opacity-50 transition-colors"
                  >
                    {submitting && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                    {submitting ? 'Đang gửi...' : 'Hoàn thành'}
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
