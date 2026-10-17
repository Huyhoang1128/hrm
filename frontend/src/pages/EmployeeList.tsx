import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeesAPI, departmentsAPI, Employee, sendAccountEmailsAPI } from '../utils/api';
import type { EmployeeStatusLogEntry } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import Pagination from '../components/Pagination';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { CITIZEN_ID_ISSUE_PLACE_OPTIONS } from '../constants/onboarding';
import { UsersIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const getEmploymentStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    ACTIVE: 'Đang làm việc',
    INACTIVE: 'Đã nghỉ',
    PROBATION: 'Thử việc',
    SUSPENDED: 'Tạm nghỉ',
    PAUSED: 'Tạm dừng',
    MATERNITY_LEAVE: 'Nghỉ thai sản',
  };
  return (status && labels[status]) || status || '';
};

const getGenderLabel = (gender?: string) => {
  const labels: Record<string, string> = {
    M: 'Nam',
    F: 'Nữ',
    O: 'Khác',
  };
  return (gender && labels[gender]) || gender || '';
};

const getCccdIssuePlaceLabel = (place?: string) =>
  CITIZEN_ID_ISSUE_PLACE_OPTIONS.find((option) => option.value === place)?.label || place || '';

const getEducationLevelLabel = (level?: string) => {
  const labels: Record<string, string> = {
    HIGH_SCHOOL: 'Trung học phổ thông',
    ASSOCIATE: 'Cao đẳng',
    BACHELOR: 'Đại học',
    MASTER: 'Thạc sĩ',
    DOCTORATE: 'Tiến sĩ',
    OTHER: 'Khác',
  };
  return (level && labels[level]) || level || '';
};

const getMaritalStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    SINGLE: 'Độc thân',
    MARRIED: 'Đã kết hôn',
    DIVORCED: 'Ly hôn',
    WIDOWED: 'Góa',
  };
  return (status && labels[status]) || status || '';
};

const getContractTypeLabel = (type?: string, display?: string) => {
  const labels: Record<string, string> = {
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
    CONFIDENTIALITY: 'Thoả thuận bảo mật',
    COMPANY_RULES: 'Cam kết đọc hiểu nội quy công ty',
    NURSING_COMMITMENT: 'Cam kết của CBNV Điều dưỡng',
  };
  return (type && labels[type]) || display || type || '';
};

const getRankLabel = (rank?: string | null) => {
  const labels: Record<string, string> = {
    CHAIRMAN: 'Chủ tịch',
    DIRECTOR: 'Giám đốc',
    DEPUTY_DIRECTOR: 'Phó Giám đốc',
    LEADER: 'Trưởng nhóm',
    SUPERVISOR: 'Quản lý',
    MANAGER: 'Trưởng phòng',
    MANAGER_TRAINEE: 'Trưởng phòng tập sự',
    DEPUTY_MANAGER: 'Phó phòng',
    STAFF: 'Nhân viên',
    INTERN: 'Thực tập sinh',
  };
  return (rank && labels[rank.toUpperCase()]) || rank || '';
};

const toExcelDate = (value?: string | null): Date | string => {
  if (!value) return '';

  // Chỉ lấy phần YYYY-MM-DD và tạo mốc UTC để ExcelJS ghi đúng số serial
  // của ngày, không bị lệch bởi timezone của trình duyệt.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return value;
  }
  return date;
};


// Cột xuất Excel danh sách nhân viên — dùng chung cho "Xuất toàn bộ" (mọi cột) và
// "Xuất tùy chọn" (HCNS tự chọn cột). Thêm/bớt cột chỉ cần sửa ở đây.
type ExportColumn = { header: string; key: string; width: number; group: string };

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Mã NV', key: 'employee_id', width: 12, group: 'Thông tin cơ bản' },
  { header: 'Họ tên', key: 'full_name', width: 25, group: 'Thông tin cơ bản' },
  { header: 'Giới tính', key: 'gender', width: 10, group: 'Thông tin cơ bản' },
  { header: 'Ngày sinh', key: 'date_of_birth', width: 14, group: 'Thông tin cơ bản' },
  { header: 'Số điện thoại', key: 'phone_number', width: 15, group: 'Thông tin cơ bản' },
  { header: 'Email', key: 'personal_email', width: 28, group: 'Thông tin cơ bản' },
  { header: 'Facebook', key: 'facebook_link', width: 28, group: 'Thông tin cơ bản' },
  { header: 'Số CCCD', key: 'cccd_number', width: 16, group: 'CCCD / VNEID' },
  { header: 'Số CMND cũ', key: 'old_id_number', width: 14, group: 'CCCD / VNEID' },
  { header: 'Ngày cấp CCCD', key: 'cccd_issue_date', width: 16, group: 'CCCD / VNEID' },
  { header: 'Nơi cấp CCCD', key: 'cccd_issue_place', width: 20, group: 'CCCD / VNEID' },
  { header: 'Link CCCD/CMT', key: 'link_cccd', width: 28, group: 'CCCD / VNEID' },
  { header: 'Quê quán', key: 'birth_place', width: 20, group: 'CCCD / VNEID' },
  { header: 'Hộ khẩu thường trú', key: 'permanent_residence', width: 30, group: 'CCCD / VNEID' },
  { header: 'Địa chỉ hiện tại', key: 'current_address', width: 30, group: 'CCCD / VNEID' },
  { header: 'Tình trạng hôn nhân', key: 'marital_status', width: 20, group: 'CCCD / VNEID' },
  { header: 'Dân tộc', key: 'ethnicity', width: 14, group: 'CCCD / VNEID' },
  { header: 'Quốc tịch', key: 'nationality', width: 14, group: 'CCCD / VNEID' },
  { header: 'Phòng ban', key: 'department', width: 20, group: 'Tổ chức' },
  { header: 'Chức vụ', key: 'position', width: 20, group: 'Tổ chức' },
  { header: 'Vùng/Miền', key: 'region', width: 14, group: 'Tổ chức' },
  { header: 'Khối', key: 'block', width: 14, group: 'Tổ chức' },
  { header: 'Bộ phận', key: 'section', width: 16, group: 'Tổ chức' },
  { header: 'Cấp bậc', key: 'rank', width: 14, group: 'Tổ chức' },
  { header: 'Địa điểm làm việc', key: 'work_location', width: 20, group: 'Tổ chức' },
  { header: 'Team Bác sĩ', key: 'doctor_team', width: 16, group: 'Tổ chức' },
  { header: 'Hình thức làm việc', key: 'work_form', width: 20, group: 'Tổ chức' },
  { header: 'Loại hình làm việc', key: 'work_type', width: 18, group: 'Tổ chức' },
  { header: 'Trình độ học vấn', key: 'education_level', width: 18, group: 'Tổ chức' },
  { header: 'Quản lý trực tiếp', key: 'manager', width: 22, group: 'Quản lý' },
  { header: 'Quản lý cấp 2', key: 'manager_level_2', width: 22, group: 'Quản lý' },
  { header: 'Quản lý cấp 3', key: 'manager_level_3', width: 22, group: 'Quản lý' },
  { header: 'Trạng thái', key: 'employment_status', width: 16, group: 'Hợp đồng & trạng thái' },
  { header: 'Ghi chú trạng thái', key: 'employment_status_notes', width: 24, group: 'Hợp đồng & trạng thái' },
  { header: 'Loại hợp đồng', key: 'contract_type', width: 18, group: 'Hợp đồng & trạng thái' },
  { header: 'Tỉ lệ thử việc', key: 'probation_rate', width: 16, group: 'Hợp đồng & trạng thái' },
  { header: 'Số tháng thử việc', key: 'probation_months', width: 18, group: 'Hợp đồng & trạng thái' },
  { header: 'Ngày vào làm', key: 'start_date', width: 14, group: 'Hợp đồng & trạng thái' },
  { header: 'Ngày nghỉ việc', key: 'end_date', width: 14, group: 'Hợp đồng & trạng thái' },
  { header: 'Ngày kết thúc thử việc', key: 'probation_end_date', width: 22, group: 'Hợp đồng & trạng thái' },
  { header: 'Ngày lên chính thức', key: 'official_start_date', width: 20, group: 'Hợp đồng & trạng thái' },
  { header: 'Lý do nghỉ việc', key: 'termination_reason', width: 24, group: 'Hợp đồng & trạng thái' },
  { header: 'Tổng TG làm việc (tháng)', key: 'total_work_months', width: 24, group: 'Hợp đồng & trạng thái' },
  { header: 'Trạng thái hồ sơ', key: 'file_status', width: 18, group: 'Hồ sơ' },
  { header: 'Hạn nộp hồ sơ', key: 'file_submission_deadline', width: 16, group: 'Hồ sơ' },
  { header: 'Ngày nộp hồ sơ', key: 'file_submission_date', width: 16, group: 'Hồ sơ' },
  { header: 'Sơ yếu lý lịch', key: 'doc_resume', width: 16, group: 'Hồ sơ' },
  { header: 'Căn cước công dân', key: 'doc_cccd', width: 18, group: 'Hồ sơ' },
  { header: 'Bằng cấp', key: 'doc_degree', width: 12, group: 'Hồ sơ' },
  { header: 'Giấy khám sức khỏe', key: 'doc_health', width: 20, group: 'Hồ sơ' },
  { header: 'Lương cơ bản', key: 'basic_salary', width: 16, group: 'Lương & ngân hàng' },
  { header: 'Phụ cấp', key: 'allowance', width: 14, group: 'Lương & ngân hàng' },
  { header: 'Tỉ lệ % doanh số hưởng', key: 'revenue_percentage', width: 20, group: 'Lương & ngân hàng' },
  { header: 'Tỉ lệ % lợi nhuận hưởng', key: 'profit_percentage', width: 20, group: 'Lương & ngân hàng' },
  { header: 'Ghi chú lương', key: 'salary_notes', width: 24, group: 'Lương & ngân hàng' },
  { header: 'Ghi chú phụ cấp', key: 'allowance_notes', width: 24, group: 'Lương & ngân hàng' },
  { header: 'Ngân hàng', key: 'bank_name', width: 18, group: 'Lương & ngân hàng' },
  { header: 'Chi nhánh NH', key: 'bank_branch', width: 20, group: 'Lương & ngân hàng' },
  { header: 'Số tài khoản', key: 'bank_account', width: 20, group: 'Lương & ngân hàng' },
  { header: 'Mã số BHXH', key: 'social_insurance_number', width: 16, group: 'BHXH & thuế' },
  { header: 'Mã số thuế TNCN', key: 'tax_code', width: 16, group: 'BHXH & thuế' },
  { header: 'Mã hộ gia đình', key: 'household_code', width: 16, group: 'BHXH & thuế' },
  { header: 'Đóng BHXH tại', key: 'insurance_participation', width: 24, group: 'BHXH & thuế' },
  { header: 'Thời điểm báo tăng', key: 'insurance_increase_time', width: 20, group: 'BHXH & thuế' },
  { header: 'Số ngày phép còn lại', key: 'annual_leave_balance', width: 20, group: 'Nghỉ phép' },
  { header: 'Năm số dư phép', key: 'annual_leave_balance_year', width: 16, group: 'Nghỉ phép' },
  { header: 'Người LH khẩn cấp', key: 'emergency_contact_name', width: 22, group: 'Người liên hệ khẩn cấp' },
  { header: 'Mối quan hệ', key: 'emergency_contact_relationship', width: 16, group: 'Người liên hệ khẩn cấp' },
  { header: 'SĐT người thân', key: 'emergency_contact_phone', width: 16, group: 'Người liên hệ khẩn cấp' },
  { header: 'Ngày sinh người thân', key: 'emergency_contact_dob', width: 20, group: 'Người liên hệ khẩn cấp' },
  { header: 'Nghề nghiệp người thân', key: 'emergency_contact_occupation', width: 22, group: 'Người liên hệ khẩn cấp' },
  { header: 'Địa chỉ người LH', key: 'emergency_contact_address', width: 28, group: 'Người liên hệ khẩn cấp' },
  { header: 'Ghi chú', key: 'notes', width: 28, group: 'Khác' },
  { header: 'Ngày tạo', key: 'created_at', width: 14, group: 'Khác' },
];

const EXPORT_GROUPS = Array.from(new Set(EXPORT_COLUMNS.map((c) => c.group)));

const DEFAULT_CUSTOM_EXPORT_KEYS = [
  'employee_id', 'full_name', 'gender', 'date_of_birth', 'phone_number', 'department', 'position', 'start_date',
];

const EmployeeList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    probation: 0,
    inactive: 0,
    suspended: 0,
    maternity_leave: 0,
    male: 0,
    female: 0,
    other: 0
  });
  // '' = số liệu hiện tại; 'YYYY-MM' = số liệu tại cuối tháng đó
  const [statsMonth, setStatsMonth] = useState('');
  const [statusLogOpen, setStatusLogOpen] = useState(false);
  const [statusLog, setStatusLog] = useState<EmployeeStatusLogEntry[] | null>(null);
  const [statusLogError, setStatusLogError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [endDateFromFilter, setEndDateFromFilter] = useState('');
  const [endDateToFilter, setEndDateToFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [contractTypeFilter, setContractTypeFilter] = useState<string>('all');
  const [expiringSoonFilter, setExpiringSoonFilter] = useState<string>('all');
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [emailCooldownRemaining, setEmailCooldownRemaining] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showCustomExportDialog, setShowCustomExportDialog] = useState(false);
  const [customExportSelectedKeys, setCustomExportSelectedKeys] = useState<Set<string>>(
    () => new Set(DEFAULT_CUSTOM_EXPORT_KEYS)
  );
  const [isExportingCustom, setIsExportingCustom] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    summary: { total: number; created: number; updated: number; failed: number };
    errors: Array<{ row: number; employee_id?: string; warnings?: string[]; errors?: string[] }>;
  } | null>(null);
  const [expiringContractEmployees, setExpiringContractEmployees] = useState<Employee[]>([]);
  const [isLoadingExpiringContracts, setIsLoadingExpiringContracts] = useState(false);
  const [showExpiringContracts, setShowExpiringContracts] = useState(false);

  // Đổi quản lý trực tiếp hàng loạt — dùng khi 1 quản lý offboard
  const [showChangeManagerDialog, setShowChangeManagerDialog] = useState(false);
  const [managerOptions, setManagerOptions] = useState<Employee[]>([]);
  const [loadingManagerOptions, setLoadingManagerOptions] = useState(false);
  const [oldManagerId, setOldManagerId] = useState('');
  const [newManagerId, setNewManagerId] = useState('');
  const [isChangingManager, setIsChangingManager] = useState(false);
  const [changeManagerResult, setChangeManagerResult] = useState<{ count: number; message: string } | null>(null);
  const isSuperUser =
    user?.is_supperuser === true ||
    user?.is_superuser === true ||
    user?.is_super_admin === true;
  const isAdmin = isSuperUser || user?.role?.toUpperCase() === 'ADMIN';
  const isHR =
    user?.role?.toUpperCase() === 'HR' ||
    user?.is_hr === true ||
    user?.employee_profile?.is_hr === true ||
    user?.hrm_user?.is_hr === true;
  const canViewStatusLog = isAdmin || isHR;
  const statusLogMonth = statsMonth || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const openStatusLog = async () => {
    setStatusLogOpen(true);
    setStatusLog(null);
    setStatusLogError(null);
    try {
      setStatusLog((await employeesAPI.statusLog(statusLogMonth)).results);
    } catch {
      setStatusLogError('Không tải được nhật ký trạng thái.');
    }
  };
  const SEND_EMAIL_COOLDOWN_KEY = 'send_all_emails_cooldown_until';
  const COOLDOWN_DURATION = 120; // 2 phút (giây)

  const getNearestExpiryDate = (employee: Employee) => {
    const dates: Date[] = [];
    if (employee.probation_end_date) dates.push(new Date(employee.probation_end_date));
    if (employee.contract_end_date) dates.push(new Date(employee.contract_end_date));
    if (dates.length === 0) return null;
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  };
  
  const fetchExpiringContractEmployees = async () => {
    try {
      setIsLoadingExpiringContracts(true);
      const response = await employeesAPI.list({ page_size: 1000 });
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const fourDaysLater = new Date(today);
      fourDaysLater.setDate(today.getDate() + 4);
      
      const expiring = (response.results || []).filter((emp: Employee) => {
        const nearestExpiryDate = getNearestExpiryDate(emp);
        if (!nearestExpiryDate) return false;
        nearestExpiryDate.setHours(0, 0, 0, 0);
        return nearestExpiryDate >= today && nearestExpiryDate <= fourDaysLater;
      }).sort((a: Employee, b: Employee) => {
        const dateA = getNearestExpiryDate(a) || new Date();
        const dateB = getNearestExpiryDate(b) || new Date();
        return dateA.getTime() - dateB.getTime();
      });
      
      setExpiringContractEmployees(expiring);
    } catch (err) {
      console.error('Error fetching expiring contract employees:', err);
    } finally {
      setIsLoadingExpiringContracts(false);
    }
  };
  
  const fetchEmployees = async (
    search = '',
    status = 'all',
    department = 'all',
    page = 1,
    pageSize = 20,
    contractType = 'all',
    expiringSoon = 'all',
    endDateFrom = '',
    endDateTo = '',
  ) => {
    try {
      setLoading(true);
      const params: any = { page, page_size: pageSize };
      if (search) params.search = search;
      if (status !== 'all') params.employment_status = status;
      if (status === 'INACTIVE' && endDateFrom) params.end_date_from = endDateFrom;
      if (status === 'INACTIVE' && endDateTo) params.end_date_to = endDateTo;
      if (department !== 'all') params.department = department;
      if (contractType !== 'all') params.contract_type = contractType;
      
      if (expiringSoon === 'expiring') {
        const today = new Date();
        const deadline = new Date();
        deadline.setDate(today.getDate() + 5);
        params.expiring_soon_before = deadline.toISOString().split('T')[0];
        // We also send a flag so the backend knows to filter by either probation or contract end date
        params.is_expiring_soon = true;
      }
      
      const response = await employeesAPI.list(params);
      setEmployees(response.results);
      setTotalCount(response.count);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách nhân viên');
      console.error('Error fetching employees:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      if (statsMonth) {
        const monthStats = await employeesAPI.stats({ month: statsMonth });
        setStats({
          total: monthStats.total,
          active: monthStats.active,
          probation: monthStats.probation,
          inactive: monthStats.inactive,
          suspended: monthStats.suspended ?? 0,
          maternity_leave: monthStats.maternity_leave ?? 0,
          male: monthStats.gender_stats.male,
          female: monthStats.gender_stats.female,
          other: monthStats.gender_stats.other,
        });
        return;
      }
      const statsData = await employeesAPI.stats();
      
      // Fetch active employees to calculate gender stats
      const activeEmployees = await employeesAPI.list({ 
        employment_status: 'ACTIVE',
        page_size: 10000
      });
      
      const employees = activeEmployees.results || [];
      const male = employees.filter((emp: any) => emp.is_active && emp.gender === 'M').length;
      const female = employees.filter((emp: any) => emp.is_active && emp.gender === 'F').length;
      const other = employees.filter((emp: any) => emp.is_active && emp.gender === 'O').length;
      
      setStats({
        total: statsData.total,
        active: statsData.active,
        probation: statsData.probation,
        inactive: statsData.inactive,
        suspended: statsData.suspended ?? 0,
        maternity_leave: statsData.maternity_leave ?? 0,
        male,
        female,
        other
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results || []);
    } catch (err) {
      console.error('Error fetching departments:', err);
    }
  };

  useEffect(() => {
    fetchDepartments();
    fetchExpiringContractEmployees();
  }, []);

  useEffect(() => {
    fetchStats();
  }, [statsMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chặn scroll khi mở dialog import
  useLockBodyScroll(showImportDialog);
  useLockBodyScroll(showCustomExportDialog);
  useLockBodyScroll(showChangeManagerDialog);

  // Khởi tạo cooldown từ localStorage và đếm ngược
  useEffect(() => {
    const stored = localStorage.getItem(SEND_EMAIL_COOLDOWN_KEY);
    if (stored) {
      const cooldownUntil = parseInt(stored, 10);
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (remaining > 0) {
        setEmailCooldownRemaining(remaining);
      } else {
        localStorage.removeItem(SEND_EMAIL_COOLDOWN_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (emailCooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setEmailCooldownRemaining((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [emailCooldownRemaining]);

  // Effect for real-time search with debouncing
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      fetchEmployees(searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter, expiringSoonFilter, endDateFromFilter, endDateToFilter);
    }, 300); // 300ms debounce delay

    setSearchTimeout(timeout);

    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter, expiringSoonFilter, endDateFromFilter, endDateToFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEmployees(searchTerm, statusFilter, departmentFilter, 1, itemsPerPage, contractTypeFilter, expiringSoonFilter, endDateFromFilter, endDateToFilter);
  };

  const handleReset = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setEndDateFromFilter('');
    setEndDateToFilter('');
    setDepartmentFilter('all');
    setContractTypeFilter('all');
    setExpiringSoonFilter('all');
    setCurrentPage(1);
    // Don't call fetchEmployees here, the useEffect will handle it
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa nhân viên này?')) {
      try {
        await employeesAPI.delete(id);
        fetchEmployees(searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter);
        fetchStats(); // Refresh stats
      } catch (err: any) {
        alert('Xóa thất bại: ' + (err.message || 'Lỗi không xác định'));
      }
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await employeesAPI.activate(id);
      fetchEmployees(searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter);
      fetchStats(); // Refresh stats
    } catch (err: any) {
      alert('Kích hoạt thất bại: ' + (err.message || 'Lỗi không xác định'));
    }
  };

  const handleDeactivate = async (id: number) => {
    try {
      await employeesAPI.deactivate(id);
      fetchEmployees(searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter);
      fetchStats(); // Refresh stats
    } catch (err: any) {
      alert('Vô hiệu hóa thất bại: ' + (err.message || 'Lỗi không xác định'));
    }
  };
  const handleExport = async () => {
    try {
      const exportPageSize = Math.max(totalCount, 1000);
      const params: any = { page: 1, page_size: exportPageSize };
      if (searchTerm) params.search = searchTerm;
      if (statusFilter !== 'all') params.employment_status = statusFilter;
      if (statusFilter === 'INACTIVE' && endDateFromFilter) params.end_date_from = endDateFromFilter;
      if (statusFilter === 'INACTIVE' && endDateToFilter) params.end_date_to = endDateToFilter;
      if (departmentFilter !== 'all') params.department = departmentFilter;
      if (contractTypeFilter !== 'all') params.contract_type = contractTypeFilter;

      const response = await employeesAPI.list(params);
      const allEmployees = response.results;

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Danh sách nhân viên');

      const HEADER_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FF4472C4' },
      };

      const columns = [
        { header: 'Mã NV', key: 'employee_id', width: 12 },
        { header: 'Họ tên', key: 'full_name', width: 25 },
        { header: 'Giới tính', key: 'gender', width: 10 },
        { header: 'Số điện thoại', key: 'phone_number', width: 15 },
        { header: 'Email', key: 'personal_email', width: 28 },
        { header: 'Nơi cấp CCCD', key: 'cccd_issue_place', width: 30 },
        { header: 'Trình độ học vấn', key: 'education_level', width: 22 },
        { header: 'Tình trạng hôn nhân', key: 'marital_status', width: 20 },
        { header: 'Phòng ban', key: 'department', width: 20 },
        { header: 'Chức vụ', key: 'position', width: 20 },
        { header: 'Cấp bậc', key: 'rank', width: 22 },
        { header: 'Trạng thái', key: 'employment_status', width: 16 },
        { header: 'Loại hợp đồng', key: 'contract_type', width: 30 },
        { header: 'Ngày vào làm', key: 'start_date', width: 14 },
        { header: 'Ngày nghỉ việc', key: 'end_date', width: 14 },
        { header: 'Sơ yếu lý lịch', key: 'doc_resume', width: 16 },
        { header: 'Căn cước công dân', key: 'doc_cccd', width: 18 },
        { header: 'Bằng cấp', key: 'doc_degree', width: 12 },
        { header: 'Giấy khám sức khỏe', key: 'doc_health', width: 20 },

      ];
      sheet.columns = columns;
      ['start_date', 'end_date'].forEach((key) => {
        sheet.getColumn(key).numFmt = 'dd/mm/yyyy';
      });

      // Style header row
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      // Add data rows
      allEmployees.forEach((emp) => {
        sheet.addRow({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          gender: getGenderLabel(emp.gender),
          phone_number: emp.phone_number || '',
          personal_email: emp.personal_email || '',
          cccd_issue_place: getCccdIssuePlaceLabel(emp.cccd_issue_place),
          education_level: getEducationLevelLabel(emp.education_level),
          marital_status: getMaritalStatusLabel(emp.marital_status),
          department: emp.department?.name || '',
          position: emp.position?.title || '',
          rank: getRankLabel(emp.rank),
          employment_status: getEmploymentStatusLabel(emp.employment_status),
          contract_type: getContractTypeLabel(emp.contract_type, emp.contract_type_display),
          start_date: toExcelDate(emp.start_date),
          end_date: toExcelDate(emp.end_date),
          doc_resume: emp.doc_resume ? 'x' : '',
          doc_cccd: emp.doc_cccd ? 'x' : '',
          doc_degree: emp.doc_degree ? 'x' : '',
          doc_health: emp.doc_health ? 'x' : '',
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `danh-sach-nhan-vien-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Xuất file thất bại: ' + (err.message || 'Lỗi không xác định'));
    }
  };

  const runEmployeeExport = async (selectedKeys: Set<string> | null, filePrefix: string, sheetTitle: string) => {
    try {
      const response = await employeesAPI.exportAll();
      const allEmployees = response.results;

      const getProbationRateLabel = (rate: string) => {
        switch (rate) {
          case 'OPTION_1': return 'Tháng đầu 85%, tháng sau 85%';
          case 'OPTION_2': return 'Tháng đầu 85%, tháng sau 100%';
          case 'OPTION_3': return 'Tháng đầu 100%, tháng sau 100%';
          default: return rate;
        }
      };

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(sheetTitle);

      const HEADER_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FF1E3A5F' },
      };

      sheet.columns = EXPORT_COLUMNS
        .filter((c) => !selectedKeys || selectedKeys.has(c.key))
        .map(({ header, key, width }) => ({ header, key, width }));
      [
        'date_of_birth',
        'cccd_issue_date',
        'start_date',
        'end_date',
        'probation_end_date',
        'official_start_date',
        'file_submission_deadline',
        'file_submission_date',
        'emergency_contact_dob',
        'created_at',
      ].filter((key) => !selectedKeys || selectedKeys.has(key)).forEach((key) => {
        sheet.getColumn(key).numFmt = 'dd/mm/yyyy';
      });

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      allEmployees.forEach((emp) => {
        sheet.addRow({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          gender: getGenderLabel(emp.gender),
          date_of_birth: toExcelDate(emp.date_of_birth),
          phone_number: emp.phone_number || '',
          personal_email: emp.personal_email || '',
          facebook_link: emp.facebook_link || '',
          cccd_number: emp.cccd_number || '',
          old_id_number: emp.old_id_number || '',
          cccd_issue_date: toExcelDate(emp.cccd_issue_date),
          cccd_issue_place: getCccdIssuePlaceLabel(emp.cccd_issue_place),
          birth_place: emp.birth_place || '',
          permanent_residence: emp.permanent_residence || '',
          current_address: emp.current_address || '',
          link_cccd: (emp as any).link_cccd || '',
          marital_status: getMaritalStatusLabel(emp.marital_status),
          ethnicity: emp.ethnicity || '',
          nationality: emp.nationality || '',
          department: emp.department?.name || '',
          position: emp.position?.title || '',
          region: emp.region || '',
          block: emp.block || '',
          section: emp.section || '',
          rank: getRankLabel(emp.rank),
          work_location: emp.work_location || '',
          doctor_team: emp.doctor_team || '',
          work_form: emp.work_form || '',
          work_type: (() => {
            try {
              const ei = typeof (emp as any).extra_info === 'string'
                ? JSON.parse((emp as any).extra_info || '{}')
                : ((emp as any).extra_info || {});
              return ei?.work_type || '';
            } catch { return ''; }
          })(),
          education_level: getEducationLevelLabel(emp.education_level),
          manager: emp.manager?.full_name || emp.manager_name || '',
          manager_level_2: emp.manager_level_2?.full_name || '',
          manager_level_3: emp.manager_level_3?.full_name || '',
          employment_status: getEmploymentStatusLabel(emp.employment_status),
          employment_status_notes: emp.employment_status_notes || '',
          contract_type: getContractTypeLabel(emp.contract_type, emp.contract_type_display),
          probation_rate: getProbationRateLabel(emp.probation_rate || ''),
          probation_months: emp.probation_months ?? '',
          start_date: toExcelDate(emp.start_date),
          end_date: toExcelDate(emp.end_date),
          probation_end_date: toExcelDate(emp.probation_end_date),
          official_start_date: toExcelDate(emp.official_start_date),
          termination_reason: emp.termination_reason || '',
          total_work_months: emp.total_work_months ?? '',
          file_status: emp.file_status_display || emp.file_status || '',
          file_submission_deadline: toExcelDate(emp.file_submission_deadline),
          file_submission_date: toExcelDate(emp.file_submission_date),
          doc_resume: emp.doc_resume ? 'x' : '',
          doc_cccd: emp.doc_cccd ? 'x' : '',
          doc_degree: emp.doc_degree ? 'x' : '',
          doc_health: emp.doc_health ? 'x' : '',
          basic_salary: emp.basic_salary ?? '',
          allowance: emp.allowance ?? '',
          revenue_percentage: emp.revenue_percentage ?? '',
          profit_percentage: emp.profit_percentage ?? '',
          salary_notes: emp.salary_notes || '',
          allowance_notes: emp.allowance_notes || '',
          bank_name: emp.bank_name || '',
          bank_branch: emp.bank_branch || '',
          bank_account: emp.bank_account || '',
          social_insurance_number: emp.social_insurance_number || '',
          tax_code: emp.tax_code || '',
          household_code: emp.household_code || '',
          insurance_participation: emp.insurance_participation || '',
          insurance_increase_time: emp.insurance_increase_time || '',
          annual_leave_balance: emp.annual_leave_balance ?? '',
          annual_leave_balance_year: emp.annual_leave_balance_year ?? '',
          emergency_contact_name: emp.emergency_contact_name || '',
          emergency_contact_relationship: emp.emergency_contact_relationship || '',
          emergency_contact_phone: emp.emergency_contact_phone || '',
          emergency_contact_dob: toExcelDate(emp.emergency_contact_dob),
          emergency_contact_occupation: emp.emergency_contact_occupation || '',
          emergency_contact_address: emp.emergency_contact_address || '',
          notes: emp.notes || '',
          created_at: toExcelDate(emp.created_at),
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Xuất Excel thất bại: ' + (err.message || 'Lỗi không xác định'));
    }
  };

  const handleExportAll = () => runEmployeeExport(null, 'xuat-toan-bo-nhan-vien', 'Toàn bộ nhân viên');

  const handleExportCustom = async () => {
    if (customExportSelectedKeys.size === 0) return;
    setIsExportingCustom(true);
    try {
      await runEmployeeExport(customExportSelectedKeys, 'xuat-tuy-chon-nhan-vien', 'Nhân viên');
      setShowCustomExportDialog(false);
    } finally {
      setIsExportingCustom(false);
    }
  };

  const handleSendAllEmails = async () => {
    if (isSendingEmails || emailCooldownRemaining > 0) return;

    if (!window.confirm(
      '⚠️ BẠN CÓ CHẮC CHẮN?\n\n' +
      'Hành động này sẽ:\n' +
      '✓ Reset password TẤT CẢ nhân viên đang làm việc\n' +
      '✓ Gửi email thông tin đăng nhập mới cho họ\n\n' +
      'Bạn có muốn tiếp tục?'
    )) {
      return;
    }

    setIsSendingEmails(true);
    try {
      const response = await sendAccountEmailsAPI.sendEmails({ send_all: true });
      
      if (response.success) {
        // Lưu thời điểm hết cooldown vào localStorage
        const cooldownUntil = Date.now() + COOLDOWN_DURATION * 1000;
        localStorage.setItem(SEND_EMAIL_COOLDOWN_KEY, cooldownUntil.toString());
        setEmailCooldownRemaining(COOLDOWN_DURATION);

        // Hiển thị thông báo chi tiết
        alert(
          `✅ THÀNH CÔNG!\n\n` +
          `${response.message}\n\n` +
          `📊 Thống kê:\n` +
          `- Tổng số email: ${response.total}\n` +
          `- Số password đã reset: ${response.passwords_reset}\n` +
          `- Thời gian ước tính: ${response.estimated_time}\n` +
          // `- Batch ID: ${response.batch_id}\n\n` +
          `💡 Email sẽ được gửi tự động trong background.`
        );
        
        // Optional: Poll status để hiển thị progress
        if (response.batch_id) {
          pollBatchStatus(response.batch_id);
        }
      } else {
        alert(`❌ ${response.message}`);
      }
    } catch (error: any) {
      alert(`❌ Lỗi: ${error.message || 'Không thể gửi email'}`);
    } finally {
      setIsSendingEmails(false);
    }
  };

  // ✅ THÊM function poll status (optional)
  const pollBatchStatus = async (batchId: string) => {
    let pollCount = 0;
    const maxPolls = 30; // Poll tối đa 30 lần (5 phút nếu 10s/lần)
    
    const checkStatus = async () => {
      try {
        const status = await sendAccountEmailsAPI.checkBatchStatus(batchId);
        
        console.log(
          `📧 Email Progress [${status.status}]: ` +
          `${status.sent}/${status.total} sent ` +
          `(${status.progress_percentage}%) | ` +
          `Failed: ${status.failed} | Pending: ${status.pending}`
        );
        
        pollCount++;
        
        // Nếu chưa hoàn thành và chưa poll quá nhiều lần
        if (status.status !== 'COMPLETED' && pollCount < maxPolls) {
          setTimeout(checkStatus, 10000); // Check lại sau 10 giây
        } else if (status.status === 'COMPLETED') {
          console.log('✅ All emails sent successfully!');
          // Optional: Hiển thị notification
          if (status.sent > 0) {
            alert(
              `🎉 ĐÃ GỬI XONG TẤT CẢ EMAIL!\n\n` +
              `✓ Đã gửi: ${status.sent}/${status.total}\n` +
              `✗ Thất bại: ${status.failed}\n` +
              `📅 Hoàn thành lúc: ${new Date(status.completed_at || '').toLocaleString('vi-VN')}`
            );
          }
        }
      } catch (error) {
        console.error('Error checking batch status:', error);
      }
    };
    
    // Bắt đầu check sau 10 giây
    setTimeout(checkStatus, 10000);
  };

  const handleDownloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template nhân viên');

    const HEADER_FILL = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FF1E3A5F' },
    };

    sheet.columns = [
      { header: 'Mã nhân viên', key: 'employee_id', width: 14 },
      { header: 'Ngày bắt đầu làm việc', key: 'start_date', width: 22 },
      { header: 'Họ và tên', key: 'full_name', width: 25 },
      { header: 'Trạng thái làm việc', key: 'employment_status', width: 20 },
      { header: 'Vùng/Miền', key: 'region', width: 14 },
      { header: 'Khối', key: 'block', width: 14 },
      { header: 'Phòng/Ban', key: 'department', width: 25 },
      { header: 'Bộ phận', key: 'section', width: 20 },
      { header: 'Cấp bậc', key: 'rank', width: 22 },
      { header: 'Vị trí', key: 'position', width: 25 },
      { header: 'Quản lý trực tiếp', key: 'manager', width: 16 },
      { header: 'Bác sĩ Chính', key: 'doctor_team', width: 20 },
      { header: 'Hình thức làm việc', key: 'work_form', width: 22 },
      { header: 'Trình độ học vấn', key: 'education_level', width: 20 },
      { header: 'Ngày sinh', key: 'date_of_birth', width: 14 },
      { header: 'Giới tính', key: 'gender', width: 10 },
      { header: 'Số tài khoản đăng ký nhận lương', key: 'bank_account', width: 30 },
      { header: 'Tên ngân hàng', key: 'bank_name', width: 20 },
      { header: 'Chi nhánh ngân hàng', key: 'bank_branch', width: 22 },
      { header: 'Chủ tài khoản', key: 'chu_tai_khoan', width: 24 },
      { header: 'Số điện thoại', key: 'phone_number', width: 16 },
      { header: 'Email', key: 'personal_email', width: 28 },
      { header: 'Địa điểm làm việc', key: 'work_location', width: 22 },
      { header: 'Link facebook', key: 'facebook_link', width: 28 },
      { header: 'Mã số BHXH', key: 'social_insurance_number', width: 16 },
      { header: 'Mã số TNCN', key: 'tax_code', width: 16 },
      { header: 'Mã hộ gia đình', key: 'household_code', width: 18 },
      { header: 'Số CCCD', key: 'cccd_number', width: 16 },
      { header: 'Ngày cấp CCCD', key: 'cccd_issue_date', width: 16 },
      { header: 'Nơi cấp CCCD', key: 'cccd_issue_place', width: 22 },
      { header: 'Nơi đăng ký khai sinh', key: 'birth_place', width: 24 },
      { header: 'Dân tộc', key: 'ethnicity', width: 14 },
      { header: 'Quốc tịch', key: 'nationality', width: 14 },
      { header: 'Địa chỉ thường trú', key: 'permanent_residence', width: 32 },
      { header: 'Địa chỉ hiện tại', key: 'current_address', width: 32 },
      { header: 'Link CCCD/CMT', key: 'link_cccd', width: 28 },
      { header: 'Tình trạng hôn nhân', key: 'marital_status', width: 20 },
      { header: 'Khi cần liên hệ với ai?', key: 'emergency_contact_name', width: 24 },
      { header: 'Mối quan hệ của người thân với ai?', key: 'emergency_contact_relationship', width: 30 },
      { header: 'Số điện thoại người thân', key: 'emergency_contact_phone', width: 22 },
      { header: 'Ngày sinh người thân', key: 'emergency_contact_dob', width: 20 },
      { header: 'Nghề nghiệp người thân', key: 'emergency_contact_occupation', width: 22 },
      { header: 'Địa chỉ của người khi cần liên hệ', key: 'emergency_contact_address', width: 32 },
      { header: 'Ngày nghỉ việc', key: 'end_date', width: 16 },
      { header: 'Lý do nghỉ việc', key: 'termination_reason', width: 28 },
      { header: 'Lương', key: 'basic_salary', width: 16 },
      { header: 'Phụ cấp', key: 'allowance', width: 14 },
      { header: 'Tỷ lệ % doanh số hưởng', key: 'revenue_percentage', width: 24 },
      { header: 'Tỷ lệ % lợi nhuận hưởng', key: 'profit_percentage', width: 24 },
      { header: 'Tỉ lệ hưởng thử việc', key: 'probation_rate', width: 30 },
      { header: 'Thời gian thử việc(tháng)', key: 'probation_months', width: 24 },
      { header: 'Ghi chú công việc', key: 'employment_status_notes', width: 28 },
      { header: 'Ngày kết thúc thử việc', key: 'probation_end_date', width: 22 },
      { header: 'Ngày chính thức', key: 'official_start_date', width: 18 },
      { header: 'Đơn vị', key: 'company_unit', width: 20 },
      { header: 'Loại hợp đồng', key: 'contract_type', width: 28 },
      { header: 'Ngày bắt đầu hợp đồng', key: 'contract_start_date', width: 22 },
      { header: 'Ngày kết thúc hợp đồng', key: 'contract_end_date', width: 22 },
      { header: 'CCCD (hồ sơ)', key: 'doc_cccd', width: 14 },
      { header: 'Sơ yếu lý lịch', key: 'doc_resume', width: 16 },
      { header: 'Bằng cấp', key: 'doc_degree', width: 12 },
      { header: 'Giấy khám sức khỏe', key: 'doc_health', width: 20 },
      { header: 'Trạng thái nộp hồ sơ', key: 'file_status', width: 22 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    headerRow.height = 30;

    // Ép kiểu text để giữ số 0 đầu và ký tự đặc biệt (%, dấu phẩy...)
    const TEXT_FORMAT_COLS = [
      'phone_number', 'cccd_number', 'social_insurance_number',
      'tax_code', 'bank_account', 'revenue_percentage', 'profit_percentage',
    ];
    TEXT_FORMAT_COLS.forEach(key => {
      const col = sheet.getColumn(key);
      if (col?.number) col.numFmt = '@';
    });

    // Sheet ẩn chứa các options có dấu phẩy (tránh bị Excel parse sai)
    const dropdownSheet = workbook.addWorksheet('_Dropdowns');
    dropdownSheet.state = 'veryHidden';
    const probationRateOptions = [
      'Tháng đầu 85%, tháng sau 85%',
      'Tháng đầu 85%, tháng sau 100%',
      'Tháng đầu 100%, tháng sau 100%',
    ];
    probationRateOptions.forEach((v, i) => { dropdownSheet.getCell(i + 1, 1).value = v; });

    const workLocationOptions = [
      'Văn phòng Hà Nội',
      'Văn phòng TP. Hồ Chí Minh',
    ];
    workLocationOptions.forEach((v, i) => { dropdownSheet.getCell(i + 1, 2).value = v; });

    // Helper: áp dropdown validation cho 1 cột (rows 2→1001)
    const applyDropdown = (colKey: string, values: string[]) => {
      const colNumber = sheet.getColumn(colKey).number;
      if (!colNumber) return;
      const formulae = [`"${values.join(',')}"`];
      for (let r = 2; r <= 1001; r++) {
        sheet.getCell(r, colNumber).dataValidation = {
          type: 'list',
          allowBlank: true,
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Giá trị không hợp lệ',
          error: `Vui lòng chọn: ${values.join(' / ')}`,
          formulae,
        };
      }
    };

    // Helper: dùng cell range thay vì inline list (cho options có dấu phẩy)
    const applyDropdownRange = (colKey: string, formula: string, values: string[]) => {
      const colNumber = sheet.getColumn(colKey).number;
      if (!colNumber) return;
      for (let r = 2; r <= 1001; r++) {
        sheet.getCell(r, colNumber).dataValidation = {
          type: 'list',
          allowBlank: true,
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Giá trị không hợp lệ',
          error: `Vui lòng chọn: ${values.join(' / ')}`,
          formulae: [formula],
        };
      }
    };

    applyDropdown('employment_status', ['Đang làm việc', 'Tạm dừng', 'Đã nghỉ']);
    applyDropdown('rank', ['Chủ tịch', 'Giám đốc', 'Phó Giám đốc', 'Leader', 'Trưởng phòng', 'Trưởng phòng tập sự', 'Phó phòng', 'Nhân viên', 'Thực tập sinh']);
    applyDropdown('work_form', ['Toàn thời gian', 'Bán thời gian', 'Hợp đồng', 'Thực tập', 'Cộng tác viên']);
    applyDropdown('education_level', ['Trung học phổ thông', 'Cao đẳng', 'Đại học', 'Thạc sĩ', 'Tiến sĩ', 'Khác']);
    applyDropdown('gender', ['Nam', 'Nữ', 'Khác']);
    applyDropdown('marital_status', ['Độc thân', 'Đã kết hôn', 'Ly hôn', 'Góa']);
    applyDropdownRange(
      'probation_rate',
      "'_Dropdowns'!$A$1:$A$3",
      ['Tháng đầu 85%, tháng sau 85%', 'Tháng đầu 85%, tháng sau 100%', 'Tháng đầu 100%, tháng sau 100%'],
    );
    applyDropdownRange(
      'work_location',
      "'_Dropdowns'!$B$1:$B$9",
      workLocationOptions,
    );
    applyDropdown('contract_type', [
      'Hợp đồng thử việc',
      'Hợp đồng thực tập sinh',
      'Hợp đồng cộng tác viên',
      'Hợp đồng lao động 12 tháng',
      'Hợp đồng lao động 24 tháng',
      'Hợp đồng vô thời hạn',
      'Hợp đồng dịch vụ',
      'Thoả thuận bảo mật',
      'Cam kết đọc hiểu nội quy công ty',
      'Cam kết của CBNV Điều dưỡng',
    ]);
    applyDropdown('cccd_issue_place', [
      'Cục cảnh sát Quản lý hành chính về Trật tự xã hội',
      'Bộ Công An',
    ]);
    applyDropdown('doc_cccd', ['x', '']);
    applyDropdown('doc_resume', ['x', '']);
    applyDropdown('doc_degree', ['x', '']);
    applyDropdown('doc_health', ['x', '']);
    applyDropdown('file_status', ['Nộp đủ', 'Cần bổ sung hồ sơ', 'Chưa nộp', 'Chờ rà soát']);

    // Dòng mẫu
    sheet.addRow({
      employee_id: 'NV00001',
      start_date: '01/01/2024',
      full_name: 'Nguyễn Văn A',
      employment_status: 'Đang làm việc',
      region: '',
      block: '',
      department: 'Phòng Nhân sự',
      section: '',
      rank: 'Nhân viên',
      position: 'Chuyên viên nhân sự',
      manager: 'NV00002',
      doctor_team: '',
      work_form: 'Toàn thời gian',
      education_level: 'Đại học',
      date_of_birth: '01/01/1990',
      gender: 'Nam',
      bank_account: '1234567890',
      bank_name: 'Vietcombank',
      bank_branch: 'Chi nhánh Hà Nội',
      chu_tai_khoan: 'NGUYEN VAN A',
      phone_number: '0901234567',
      personal_email: 'nguyenvana@email.com',
      work_location: '',
      facebook_link: '',
      social_insurance_number: '',
      tax_code: '',
      cccd_number: '',
      cccd_issue_date: '',
      cccd_issue_place: '',
      birth_place: '',
      ethnicity: '',
      nationality: '',
      permanent_residence: '',
      current_address: '',
      link_cccd: '',
      marital_status: 'Độc thân',
      emergency_contact_name: '',
      emergency_contact_relationship: '',
      emergency_contact_phone: '',
      emergency_contact_dob: '',
      emergency_contact_occupation: '',
      emergency_contact_address: '',
      end_date: '',
      termination_reason: '',
      basic_salary: 8000000,
      allowance: 500000,
      revenue_percentage: '',
      profit_percentage: '',
      probation_rate: '',
      probation_months: '',
      employment_status_notes: '',
      probation_end_date: '',
      official_start_date: '',
      company_unit: '',
      contract_type: 'Hợp đồng lao động 12 tháng',
      contract_start_date: '01/01/2024',
      contract_end_date: '31/12/2024',
      doc_cccd: 'x',
      doc_resume: 'x',
      doc_degree: '',
      doc_health: '',
      file_status: 'Nộp đủ',
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-import-nhan-vien.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportErrors = async () => {
    if (!importResult || importResult.errors.length === 0 || !importFile) return;

    const ExcelJS = (await import('exceljs')).default;
    const arrayBuffer = await importFile.arrayBuffer();
    const srcWorkbook = new ExcelJS.Workbook();
    const ext = importFile.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      await srcWorkbook.xlsx.load(arrayBuffer);
    } else {
      // CSV fallback
      const text = new TextDecoder().decode(arrayBuffer);
      const lines = text.split('\n').map(l => l.split(','));
      const outWb = new ExcelJS.Workbook();
      const outWs = outWb.addWorksheet('Lỗi import');
      const errorRowNums = new Set(importResult.errors.map(e => e.row));
      const errorMap = new Map(importResult.errors.map(e => [e.row, (e.errors || e.warnings || []).join('; ')]));
      if (lines.length > 0) {
        outWs.addRow([...lines[0], 'Lỗi / Cảnh báo']);
        outWs.getRow(1).font = { bold: true };
        outWs.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      }
      lines.slice(1).forEach((cells, i) => {
        const rowNum = i + 2;
        if (errorRowNums.has(rowNum)) {
          const r = outWs.addRow([...cells, errorMap.get(rowNum) || '']);
          r.getCell(cells.length + 1).font = { color: { argb: 'FFCC0000' } };
        }
      });
      const buf = await outWb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `loi-import-nhan-vien-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
      return;
    }

    const srcSheet = srcWorkbook.worksheets[0];
    const errorRowNums = new Set(importResult.errors.map(e => e.row));
    const errorMap = new Map(importResult.errors.map(e => [e.row, (e.errors || e.warnings || []).join('; ')]));

    const outWorkbook = new ExcelJS.Workbook();
    const outSheet = outWorkbook.addWorksheet('Lỗi import');

    const headerRow = srcSheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      headers.push(String(cell.value ?? ''));
    });
    headers.push('Lỗi / Cảnh báo');

    const outHeader = outSheet.addRow(headers);
    outHeader.font = { bold: true };
    outHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    outSheet.columns = headers.map((h, i) => ({
      key: String(i),
      width: i === headers.length - 1 ? 60 : Math.max(h.length + 2, 15),
    }));

    srcSheet.eachRow({ includeEmpty: false }, (srcRow, rowNumber) => {
      if (rowNumber === 1) return;
      if (!errorRowNums.has(rowNumber)) return;

      const values: (string | number | null)[] = [];
      srcRow.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        if (v === null || v === undefined) { values.push(''); return; }
        if (typeof v === 'object' && 'result' in v) { values.push(String((v as any).result ?? '')); return; }
        values.push(v as string | number);
      });
      values.push(errorMap.get(rowNumber) || '');

      const outRow = outSheet.addRow(values);
      outRow.getCell(values.length).font = { color: { argb: 'FFCC0000' } };
    });

    const buffer = await outWorkbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `loi-import-nhan-vien-${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = async () => {
    if (!importFile) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const result = await employeesAPI.importFile(importFile);
      setImportResult(result);
      if (result.summary.created > 0 || result.summary.updated > 0) {
        fetchEmployees(searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter);
        fetchStats();
      }
    } catch (err: any) {
      alert('Import thất bại: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleOpenChangeManagerDialog = async () => {
    setShowChangeManagerDialog(true);
    setOldManagerId('');
    setNewManagerId('');
    setChangeManagerResult(null);
    if (managerOptions.length === 0) {
      setLoadingManagerOptions(true);
      try {
        // include_inactive=false (mặc định) — chỉ chọn quản lý đang làm việc
        const response = await employeesAPI.list({ page_size: 2000 });
        setManagerOptions(
          (response.results || []).slice().sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi'))
        );
      } catch (err) {
        console.error('Error fetching employees for change-manager dialog:', err);
      } finally {
        setLoadingManagerOptions(false);
      }
    }
  };

  const handleCloseChangeManagerDialog = () => {
    setShowChangeManagerDialog(false);
    setOldManagerId('');
    setNewManagerId('');
    setChangeManagerResult(null);
  };

  const handleChangeManagerSubmit = async () => {
    if (!oldManagerId || !newManagerId) return;
    setIsChangingManager(true);
    setChangeManagerResult(null);
    try {
      const res = await employeesAPI.changeManager(Number(oldManagerId), Number(newManagerId));
      setChangeManagerResult({ count: res.count, message: res.message });
      fetchEmployees(searchTerm, statusFilter, departmentFilter, currentPage, itemsPerPage, contractTypeFilter);
    } catch (err: any) {
      alert('Đổi quản lý trực tiếp thất bại: ' + (err.response?.data?.error || err.message || 'Lỗi không xác định'));
    } finally {
      setIsChangingManager(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-600">Đang làm việc</span>;
      case 'SUSPENDED':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-600">Tạm dừng</span>;
      case 'MATERNITY_LEAVE':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-pink-100 text-pink-600">Nghỉ thai sản</span>;
      case 'INACTIVE':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-600">Đã nghỉ</span>;
      case 'PROBATION':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-600">Thử việc</span>;
      default:
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  const getGenderText = (gender: string) => {
    switch (gender) {
      case 'M': return 'Nam';
      case 'F': return 'Nữ';
      case 'O': return 'Khác';
      default: return gender;
    }
  };

  const isExpiringSoon = (employee: Employee) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(today);
    deadline.setDate(today.getDate() + 4);

    const probEnd = employee.probation_end_date ? new Date(employee.probation_end_date) : null;
    const contEnd = employee.contract_end_date ? new Date(employee.contract_end_date) : null;

    if (probEnd) probEnd.setHours(0, 0, 0, 0);
    if (contEnd) contEnd.setHours(0, 0, 0, 0);

    return (probEnd && probEnd >= today && probEnd <= deadline) ||
           (contEnd && contEnd >= today && contEnd <= deadline);
  };

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý nhân viên</h1>
          <p className="text-sm text-gray-900">Quản lý thông tin nhân viên, phòng ban, chức vụ và các thông tin liên quan.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
        {/* Statistics Section - At the top as requested */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-bold text-gray-900">
              Thống kê nhân viên{statsMonth ? ` — cuối tháng ${statsMonth.slice(5)}/${statsMonth.slice(0, 4)}` : ''}
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={statsMonth}
                onChange={(e) => setStatsMonth(e.target.value)}
                title="Xem số liệu tại cuối một tháng trong quá khứ; bỏ trống = hiện tại"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              {statsMonth && (
                <button type="button" onClick={() => setStatsMonth('')} className="text-xs text-primary-600 hover:underline">
                  Hiện tại
                </button>
              )}
              {canViewStatusLog && (
                <button
                  type="button"
                  onClick={openStatusLog}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Nhật ký trạng thái
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-primary-500 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Tổng số</p>
              <p className="text-2xl font-extrabold text-primary-600 mt-1">{stats.total}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-emerald-500 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đang làm việc</p>
              <p className="text-2xl font-extrabold text-emerald-600 mt-1">{stats.active}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-amber-500 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Thử việc</p>
              <p className="text-2xl font-extrabold text-amber-600 mt-1">{stats.probation}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-red-500 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đã nghỉ</p>
              <p className="text-2xl font-extrabold text-red-600 mt-1">{stats.inactive}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-orange-400 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Tạm nghỉ</p>
              <p className="text-2xl font-extrabold text-orange-500 mt-1">{stats.suspended}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-pink-500 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Nghỉ thai sản</p>
              <p className="text-2xl font-extrabold text-pink-600 mt-1">{stats.maternity_leave}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-primary-300 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Nam</p>
              <p className="text-2xl font-extrabold text-primary-500 mt-1">{stats.male}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-pink-400 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Nữ</p>
              <p className="text-2xl font-extrabold text-pink-500 mt-1">{stats.female}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-violet-400 shadow-sm p-4">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Khác</p>
              <p className="text-2xl font-extrabold text-violet-500 mt-1">{stats.other}</p>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowExpiringContracts((prev) => !prev)}
                className="text-left bg-white rounded-2xl border border-amber-200 border-l-4 border-l-amber-500 shadow-sm p-4 hover:bg-amber-50 transition-colors"
              >
                <p className="text-[11px] font-medium text-amber-700 uppercase tracking-wide">Sắp hết hạn HĐ</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-2xl font-extrabold text-amber-600">
                    {isLoadingExpiringContracts ? '...' : expiringContractEmployees.length}
                  </p>
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                </div>
              </button>
            )}
          </div>
        </div>

        {statusLogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStatusLogOpen(false)}>
            <div className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-base font-semibold text-gray-900">
                  Nhật ký trạng thái — tháng {statusLogMonth.slice(5)}/{statusLogMonth.slice(0, 4)}
                </h3>
                <button onClick={() => setStatusLogOpen(false)} className="text-sm text-gray-500 hover:text-gray-700">Đóng</button>
              </div>
              <div className="overflow-auto px-5 py-3">
                {statusLogError ? (
                  <p className="text-sm text-red-600">{statusLogError}</p>
                ) : statusLog === null ? (
                  <p className="text-sm text-gray-500">Đang tải...</p>
                ) : statusLog.length === 0 ? (
                  <p className="text-sm text-gray-500">Không có thay đổi trạng thái nào trong tháng.</p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-2 pr-3">Ngày</th>
                        <th className="py-2 pr-3">Nhân viên</th>
                        <th className="py-2 pr-3">Từ</th>
                        <th className="py-2 pr-3">Sang</th>
                        <th className="py-2">Người đổi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {statusLog.map((log) => (
                        <tr key={log.id}>
                          <td className="py-2 pr-3 whitespace-nowrap">{new Date(log.changed_at).toLocaleDateString('vi-VN')}</td>
                          <td className="py-2 pr-3">
                            <span className="font-medium text-gray-900">{log.full_name}</span>
                            <span className="ml-1 text-xs text-gray-500 font-mono">{log.employee_code}</span>
                          </td>
                          <td className="py-2 pr-3 text-gray-600">{log.from_status_label || '(hồ sơ mới)'}</td>
                          <td className="py-2 pr-3 font-medium text-gray-900">{log.to_status_label}</td>
                          <td className="py-2 text-gray-600">{log.changed_by || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {isAdmin && showExpiringContracts && (
          <div className="mb-6 bg-amber-50 rounded-2xl border border-amber-200 border-l-4 border-l-amber-500 p-5">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-900 mb-3">
                  ⚠️ Cảnh báo: {expiringContractEmployees.length} nhân sự sắp hết hạn hợp đồng
                </h3>
                {expiringContractEmployees.length === 0 ? (
                  <p className="text-sm text-amber-800">Không có nhân sự nào sắp hết hạn hợp đồng trong 4 ngày tới.</p>
                ) : (
                <div className="space-y-2">
                  {expiringContractEmployees.map((emp) => {
                    const nearestExpiryDate = getNearestExpiryDate(emp);
                    const today = new Date();
                    const daysUntilExpiry = nearestExpiryDate ? Math.ceil((nearestExpiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 0;
                    return (
                      <div key={emp.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-100 hover:bg-amber-50 transition-colors">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{emp.full_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">Mã NV: {emp.employee_id}</span>
                            {emp.department && <span className="text-xs text-gray-500">• {emp.department.name}</span>}
                            {nearestExpiryDate && (
                              <span className="text-xs text-amber-600 font-medium">
                                • Hết hạn: {nearestExpiryDate.toLocaleDateString('vi-VN')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {daysUntilExpiry <= 1 && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              Hôm nay/Hôm qua
                            </span>
                          )}
                          {daysUntilExpiry > 1 && daysUntilExpiry <= 4 && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              {daysUntilExpiry} ngày còn lại
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate(`/employees/${emp.id}`)}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                          >
                            Xem chi tiết
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Search and Filter Section */}
        <div className="mb-6 bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm nhân viên</h3>
            <div className="flex items-center gap-3">
              {loading && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary-600"></div>
                  Đang tìm kiếm...
                </div>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="btn-secondary text-xs"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tìm kiếm
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="input-field w-full"
                placeholder="Mã NV, tên, số điện thoại..."
              />
            </div>
            <SelectBox<string>
              label="Trạng thái"
              value={statusFilter}
              options={[
                { value: 'all', label: 'Tất cả trạng thái' },
                { value: 'ACTIVE', label: 'Đang làm việc' },
                { value: 'PROBATION', label: 'Thử việc' },
                { value: 'SUSPENDED', label: 'Tạm nghỉ' },
                { value: 'MATERNITY_LEAVE', label: 'Nghỉ thai sản' },
                { value: 'INACTIVE', label: 'Đã nghỉ' },
              ]}
              onChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}
            />
            {statusFilter === 'INACTIVE' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nghỉ từ ngày
                  </label>
                  <input
                    type="date"
                    value={endDateFromFilter}
                    max={endDateToFilter || undefined}
                    onChange={(e) => { setEndDateFromFilter(e.target.value); setCurrentPage(1); }}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nghỉ đến ngày
                  </label>
                  <input
                    type="date"
                    value={endDateToFilter}
                    min={endDateFromFilter || undefined}
                    onChange={(e) => { setEndDateToFilter(e.target.value); setCurrentPage(1); }}
                    className="input-field w-full"
                  />
                </div>
              </>
            )}
            <SelectBox<string>
              label="Phòng ban"
              value={departmentFilter}
              options={[
                { value: 'all', label: 'Tất cả phòng ban' },
                ...departments.map((dept) => ({ value: String(dept.id), label: dept.name })),
              ]}
              onChange={(v) => { setDepartmentFilter(v); setCurrentPage(1); }}
            />
            {/* Trưởng phòng (is_manager) chỉ thấy NV đang có mình là "quản lý
                trực tiếp" — filter phòng ban KHÔNG bị khoá vì cấp dưới trực
                tiếp có thể thuộc nhiều phòng ban khác nhau. Backend
                (EmployeeViewSet.get_queryset) tự giới hạn kết quả, filter này
                chỉ lọc thêm trong phạm vi đã được phép. */}
            <SelectBox<string>
              label="Loại hợp đồng"
              value={contractTypeFilter}
              options={[
                { value: 'all', label: 'Tất cả loại hợp đồng' },
                { value: 'PROBATION', label: 'Hợp đồng thử việc' },
                { value: 'PROBATION_1M', label: 'Thử việc 1 tháng' },
                { value: 'PROBATION_2M', label: 'Thử việc 2 tháng' },
                { value: 'INTERN', label: 'Hợp đồng thực tập sinh' },
                { value: 'COLLABORATOR', label: 'Hợp đồng cộng tác viên' },
                { value: 'SIX_MONTH', label: 'Hợp đồng lao động 6 tháng' },
                { value: 'ONE_YEAR', label: 'Hợp đồng lao động 12 tháng' },
                { value: 'TWO_YEAR', label: 'Hợp đồng lao động 24 tháng' },
                { value: 'THREE_YEAR', label: 'Hợp đồng lao động 36 tháng' },
                { value: 'INDEFINITE', label: 'Hợp đồng vô thời hạn' },
                { value: 'SERVICE', label: 'Hợp đồng dịch vụ' },
              ]}
              onChange={(v) => { setContractTypeFilter(v); setCurrentPage(1); }}
            />
            <SelectBox<string>
              label="Hạn HĐ/Thử việc"
              value={expiringSoonFilter}
              options={[
                { value: 'all', label: 'Tất cả' },
                { value: 'expiring', label: 'Sắp hết hạn (≤ 5 ngày)' },
              ]}
              onChange={(v) => { setExpiringSoonFilter(v); setCurrentPage(1); }}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách nhân viên</h2>
            <p className="text-gray-500 text-sm">Tổng số: {totalCount} nhân viên</p>
          </div>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin &&(
                <button 
                  className={`px-4 py-2 rounded-xl transition-colors flex items-center text-sm xl:text-base ${
                    isSendingEmails || emailCooldownRemaining > 0
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-primary-600 text-white hover:bg-primary-700'
                  }`}
                  onClick={handleSendAllEmails}
                  disabled={isSendingEmails || emailCooldownRemaining > 0}
                >
                  {isSendingEmails ? (
                    <>
                      <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                      </svg>
                      Đang gửi...
                    </>
                  ) : emailCooldownRemaining > 0 ? (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Gửi lại sau {emailCooldownRemaining}s
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      📧 Gửi email cho tất cả
                    </>
                  )}
                </button>
              )}
              {(isAdmin || isSuperUser) && (
                <button
                  className="bg-amber-500 text-white px-4 py-2 rounded-xl hover:bg-amber-600 transition-colors flex items-center text-sm xl:text-base"
                  onClick={() => { setShowImportDialog(true); setImportFile(null); setImportResult(null); }}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Nhập từ file
                </button>
              )}
              {(isAdmin || isSuperUser) && (
                <button
                  className="bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors flex items-center text-sm xl:text-base"
                  onClick={handleOpenChangeManagerDialog}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-4-4 4 4 0 014 4zm6 4a4 4 0 10-4-4" />
                  </svg>
                  Đổi quản lý trực tiếp
                </button>
              )}
              <button
                className="bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition-colors flex items-center text-sm xl:text-base"
                onClick={handleExport}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Xuất danh sách
              </button>
              {(isAdmin || isSuperUser || isHR) && (
                <button
                  className="bg-white text-primary-700 border border-primary-200 px-4 py-2 rounded-xl hover:bg-primary-50 transition-colors flex items-center"
                  onClick={() => setShowCustomExportDialog(true)}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M6 8h12M9 12h6M11 16h2" />
                  </svg>
                  Xuất tùy chọn
                </button>
              )}
              {(isAdmin || isSuperUser || isHR) && (
                <button
                  className="bg-primary-700 text-white px-4 py-2 rounded-xl hover:bg-primary-800 transition-colors flex items-center text-sm xl:text-base"
                  onClick={handleExportAll}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Xuất toàn bộ
                </button>
              )}

              <button 
                className="btn-primary text-sm xl:text-base"
                onClick={() => navigate('/dashboard/employees/create')}
              >
                + Thêm nhân viên
              </button>
            </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Đang tải dữ liệu...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-600 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900">Đã xảy ra lỗi</p>
            <p className="text-gray-500 mt-1">{error}</p>
            <button 
              onClick={() => fetchEmployees()}
              className="mt-4 btn-primary"
            >
              Thử lại
            </button>
          </div>
        ) : employees.length === 0 ? (
          <div className="border border-gray-100 rounded-2xl overflow-x-auto">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mã NV
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Họ tên
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phòng ban
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Chức vụ
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Trạng thái
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center">
                      <div className="h-12 w-12 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <UsersIcon className="h-7 w-7" />
                      </div>
                      <p className="text-lg font-medium text-gray-900">Chưa có nhân viên nào</p>
                      <p className="text-gray-500 mt-1">Bắt đầu bằng cách thêm nhân viên mới</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          <>
            <div className="border border-gray-100 rounded-2xl overflow-x-auto">
              <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Mã NV
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Họ tên
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Giới tính
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Phòng ban
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Chức vụ
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Trạng thái
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {employees.map((employee) => (
                    <tr key={employee.id} className={`hover:bg-gray-50 ${isExpiringSoon(employee) ? 'bg-amber-50' : ''}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{employee.employee_id}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900">{employee.full_name}</div>
                          {isExpiringSoon(employee) && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-600" title="Sắp hết hạn hợp đồng/thử việc (≤ 5 ngày)">
                              ⚠️
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500">{employee.phone_number || 'Chưa có số điện thoại'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{getGenderText(employee.gender)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{employee.department?.name || 'Chưa phân phòng'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{employee.position?.title || 'Chưa phân chức vụ'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(employee.employment_status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => navigate(`/dashboard/employees/${employee.id}`)}
                            className="px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg border border-primary-200 transition-colors"
                          >
                            Xem
                          </button>
                          <button
                            onClick={() => navigate(`/dashboard/employees/${employee.id}/edit`)}
                            className="px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg border border-primary-200 transition-colors"
                          >
                            Sửa
                          </button>
                          {employee.employment_status === 'ACTIVE' ? (
                            <button
                              onClick={() => handleDeactivate(employee.id)}
                              className="px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors"
                            >
                              Vô hiệu hóa
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivate(employee.id)}
                              className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
                            >
                              Kích hoạt
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(employee.id)}
                            className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            <div className="mt-4">
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(totalCount / itemsPerPage)}
                totalItems={totalCount}
                itemsPerPage={itemsPerPage}
                onPageChange={(page) => setCurrentPage(page)}
                onItemsPerPageChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
              />
            </div>
          </>
        )}
      </div>
    </div>

    {/* Import Dialog */}
    {showCustomExportDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Xuất danh sách theo tiêu chí tự chọn</h2>
              <p className="text-xs text-gray-500 mt-0.5">Chọn các cột thông tin muốn xuất ra file Excel</p>
            </div>
            <button
              onClick={() => setShowCustomExportDialog(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Toolbar chọn nhanh */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-gray-50">
            <span className="text-sm text-gray-600">
              Đã chọn <strong className="text-gray-900">{customExportSelectedKeys.size}</strong>/{EXPORT_COLUMNS.length} cột
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCustomExportSelectedKeys(new Set(EXPORT_COLUMNS.map((f) => f.key)))}
                className="text-sm text-primary-600 hover:text-primary-800 font-medium"
              >
                Chọn tất cả
              </button>
              <button
                onClick={() => setCustomExportSelectedKeys(new Set())}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium"
              >
                Bỏ chọn tất cả
              </button>
            </div>
          </div>

          {/* Danh sách cột theo nhóm */}
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
            {EXPORT_GROUPS.map((group) => {
              const fieldsInGroup = EXPORT_COLUMNS.filter((f) => f.group === group);
              const selectedInGroup = fieldsInGroup.filter((f) => customExportSelectedKeys.has(f.key)).length;
              const allSelected = selectedInGroup === fieldsInGroup.length;
              return (
                <div key={group}>
                  <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = selectedInGroup > 0 && !allSelected; }}
                      onChange={() => {
                        setCustomExportSelectedKeys((prev) => {
                          const next = new Set(prev);
                          fieldsInGroup.forEach((f) => {
                            if (allSelected) next.delete(f.key);
                            else next.add(f.key);
                          });
                          return next;
                        });
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-semibold text-gray-800">{group}</span>
                    <span className="text-xs text-gray-400">({selectedInGroup}/{fieldsInGroup.length})</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 pl-6">
                    {fieldsInGroup.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={customExportSelectedKeys.has(f.key)}
                          onChange={() => {
                            setCustomExportSelectedKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(f.key)) next.delete(f.key);
                              else next.add(f.key);
                              return next;
                            });
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">{f.header}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
            <button
              onClick={() => setShowCustomExportDialog(false)}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              Đóng
            </button>
            <button
              onClick={handleExportCustom}
              disabled={customExportSelectedKeys.size === 0 || isExportingCustom}
              className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors ${
                customExportSelectedKeys.size === 0 || isExportingCustom
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
            >
              {isExportingCustom ? (
                <>
                  <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Đang xuất...
                </>
              ) : (
                `Xuất file (${customExportSelectedKeys.size} cột)`
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    {showImportDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Nhập danh sách nhân viên từ file</h2>
            <button
              onClick={() => { setShowImportDialog(false); setImportResult(null); setImportFile(null); }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
            {/* Tải template */}
            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
              <p className="text-sm font-medium text-primary-900 mb-1">Bước 1: Tải file mẫu</p>
              <p className="text-xs text-primary-700 mb-3">
                Phòng ban/vị trí: nhập tên tiếng Việt. Cột hồ sơ: <strong>x</strong> = đã nộp, để trống = chưa nộp.
              </p>
              <button
                onClick={handleDownloadTemplate}
                className="inline-flex items-center px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Tải file mẫu (.xlsx)
              </button>
            </div>

            {/* Upload file */}
            <div>
              <p className="text-sm font-medium text-gray-900 mb-2">Bước 2: Upload file đã điền</p>
              {!importFile ? (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-all duration-200 group">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <svg className="w-10 h-10 text-gray-400 mb-3 group-hover:text-primary-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="mb-2 text-sm text-gray-700 font-medium">
                      <span className="text-primary-600">Nhấn để chọn file</span> hoặc kéo thả vào đây
                    </p>
                    <p className="text-xs text-gray-500">Hỗ trợ .xlsx, .xls, .csv</p>
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }}
                  />
                </label>
              ) : (
                <div className="relative flex items-center p-4 bg-emerald-50 border-2 border-emerald-200 rounded-xl">
                  <div className="flex-shrink-0 bg-emerald-100 p-2 rounded-lg mr-4">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-900 truncate">
                      {importFile.name}
                    </p>
                    <p className="text-xs text-emerald-600">
                      {(importFile.size / 1024).toFixed(1)} KB • Sẵn sàng để import
                    </p>
                  </div>
                  <button
                    onClick={() => { setImportFile(null); setImportResult(null); }}
                    className="ml-4 p-1 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-full transition-colors"
                    title="Xóa file"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Kết quả */}
            {importResult && (
              <div>
                <p className="text-sm font-medium text-gray-900 mb-2">Kết quả import</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="bg-gray-100 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">Tổng</p>
                    <p className="text-xl font-bold text-gray-800">{importResult.summary.total}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-emerald-600">Tạo mới</p>
                    <p className="text-xl font-bold text-emerald-700">{importResult.summary.created}</p>
                  </div>
                  <div className="bg-primary-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-primary-600">Cập nhật</p>
                    <p className="text-xl font-bold text-primary-700">{importResult.summary.updated}</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-red-600">Thất bại</p>
                    <p className="text-xl font-bold text-red-700">{importResult.summary.failed}</p>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 border-b flex items-center justify-between">
                      <span>Chi tiết lỗi / cảnh báo</span>
                      <button
                        onClick={handleExportErrors}
                        className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
                        title="Xuất danh sách lỗi ra file Excel"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Xuất file
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {importResult.errors.map((err, idx) => (
                        <div key={idx} className="px-3 py-2 text-xs border-b last:border-b-0">
                          <span className="font-medium text-gray-700">Dòng {err.row}</span>
                          {err.employee_id && <span className="text-gray-500 ml-1">({err.employee_id})</span>}
                          <span className="text-red-600 ml-2">
                            {(err.errors || err.warnings || []).join('; ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
            <button
              onClick={() => { setShowImportDialog(false); setImportResult(null); setImportFile(null); }}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              Đóng
            </button>
            <button
              onClick={handleImportSubmit}
              disabled={!importFile || isImporting}
              className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors ${
                !importFile || isImporting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-primary-600 hover:bg-primary-700'
              }`}
            >
              {isImporting ? (
                <>
                  <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Đang import...
                </>
              ) : (
                'Bắt đầu import'
              )}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Change Manager Dialog */}
    {showChangeManagerDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Đổi quản lý trực tiếp hàng loạt</h2>
            <button
              onClick={handleCloseChangeManagerDialog}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
            <p className="text-xs text-gray-500 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              Dùng khi 1 quản lý nghỉ việc/offboard — chọn quản lý cũ và quản lý mới, hệ thống sẽ
              tự động chuyển <strong>toàn bộ nhân viên</strong> đang có quản lý trực tiếp là quản lý cũ
              sang quản lý mới.
            </p>

            {loadingManagerOptions ? (
              <div className="text-center py-8 text-sm text-gray-500">Đang tải danh sách nhân viên...</div>
            ) : (
              <>
                <SelectBox<string>
                  label="Quản lý cũ"
                  value={oldManagerId}
                  options={managerOptions.map((e) => ({ value: String(e.id), label: `${e.full_name} (${e.employee_id})` }))}
                  onChange={(v) => { setOldManagerId(v); setChangeManagerResult(null); }}
                  searchable
                />
                <SelectBox<string>
                  label="Quản lý mới"
                  value={newManagerId}
                  options={managerOptions
                    .filter((e) => String(e.id) !== oldManagerId)
                    .map((e) => ({ value: String(e.id), label: `${e.full_name} (${e.employee_id})` }))}
                  onChange={(v) => { setNewManagerId(v); setChangeManagerResult(null); }}
                  searchable
                />
              </>
            )}

            {changeManagerResult && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <p className="text-sm text-emerald-800">{changeManagerResult.message}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
            <button
              onClick={handleCloseChangeManagerDialog}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              Đóng
            </button>
            <button
              onClick={handleChangeManagerSubmit}
              disabled={!oldManagerId || !newManagerId || isChangingManager}
              className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors ${
                !oldManagerId || !newManagerId || isChangingManager
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isChangingManager ? (
                <>
                  <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Đang đổi...
                </>
              ) : (
                'Xác nhận đổi'
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default EmployeeList;
