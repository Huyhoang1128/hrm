import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import {
  employeesAPI,
  departmentsAPI,
  managementApi,
  Employee,
  Department,
} from '../utils/api';
import onboardingService, { OnboardingProcess, OnboardingDocument } from '../services/onboarding.service';
import {
  UserIcon,
  BuildingOfficeIcon,
  PhoneIcon,
  EnvelopeIcon,
  CalendarIcon,
  BanknotesIcon,
  PencilIcon,
  XMarkIcon,
  UserGroupIcon,
  IdentificationIcon,
  BriefcaseIcon,
  DocumentTextIcon,
  DocumentCheckIcon,
  DocumentDuplicateIcon,
  CurrencyDollarIcon,
  ClockIcon,
  PhotoIcon,
  MapPinIcon,
  HomeIcon,
  AcademicCapIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import { nurseAccountAPI, type NurseAccountInfo } from '../utils/api/nurseAppClient';
import { CITIZEN_ID_ISSUE_PLACE_OPTIONS } from '../constants/onboarding';
import ChangePasswordModal from '../components/Layout/ChangePasswordModal';
import FeedbackDialog from '../components/FeedbackDialog';
import PdfFrame from '../components/Common/PdfFrame';

interface TeamMember {
  id: number;
  employee_id: string;
  full_name: string;
  position_title: string;
  phone_number?: string;
  personal_email?: string;
}

interface MyContract {
  id: number;
  contract_type: string;
  contract_type_display: string;
  status: string;
  status_display: string;
  start_date: string | null;
  end_date: string | null;
  contract_number: string | null;
  template_name: string | null;
  company_unit_name: string | null;
  generated_file: string | null;
  created_at: string;
}

const CONTRACT_TYPE_MAP: Record<string, string> = {
  PROBATION: 'Hợp đồng thử việc',
  INTERN: 'Hợp đồng thực tập',
  COLLABORATOR: 'Hợp đồng cộng tác viên',
  ONE_YEAR: 'Hợp đồng 1 năm',
  TWO_YEAR: 'Hợp đồng 2 năm',
  INDEFINITE: 'Hợp đồng không xác định thời hạn',
  SERVICE: 'Hợp đồng dịch vụ',
  CONFIDENTIALITY: 'Cam kết bảo mật',
  COMPANY_RULES: 'Nội quy công ty',
  NURSING_COMMITMENT: 'Cam kết nuôi dưỡng',
};

const getDaysUntilExpiry = (endDate: string | null | undefined): number | null => {
  if (!endDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - today.getTime()) / 86400000);
};

const getContractDisplayStatus = (contract: MyContract): { label: string; className: string } => {
  if (contract.status === 'SIGNED') {
    const days = getDaysUntilExpiry(contract.end_date);
    if (days !== null && days < 0) {
      return { label: 'Đã hết hạn', className: 'bg-red-100 text-red-700' };
    }
    if (days !== null && days <= 5) {
      return { label: `Sắp hết hạn (${days} ngày)`, className: 'bg-amber-100 text-amber-600' };
    }
    return { label: 'Đang hiệu lực', className: 'bg-emerald-100 text-emerald-600' };
  }
  const map: Record<string, { label: string; className: string }> = {
    DRAFT: { label: 'Nháp', className: 'bg-gray-100 text-gray-600' },
    PENDING_SIGN: { label: 'Chờ ký', className: 'bg-primary-100 text-primary-600' },
    EXPIRED: { label: 'Đã hết hạn', className: 'bg-red-100 text-red-700' },
    CANCELLED: { label: 'Đã huỷ', className: 'bg-gray-100 text-gray-500' },
  };
  return map[contract.status] || { label: contract.status_display, className: 'bg-gray-100 text-gray-600' };
};

const Profile: React.FC = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [manager, setManager] = useState<Employee | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showSalary, setShowSalary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  useLockBodyScroll(showEditModal);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editForm, setEditForm] = useState({
    phone_number: '',
    personal_email: '',
    bank_name: '',
    bank_account: '',
    date_of_birth: '',
    cccd_number: '',
    cccd_issue_date: '',
    cccd_issue_place: '',
    permanent_residence: '',
    current_address: '',
  });

  // Avatar state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordKey, setChangePasswordKey] = useState(0);
  const [showPasswordSuccess, setShowPasswordSuccess] = useState(false);

  // Onboarding documents state
  const [onboarding, setOnboarding] = useState<OnboardingProcess | null>(null);
  const [viewingDoc, setViewingDoc] = useState<OnboardingDocument | null>(null);
  const [docReadable, setDocReadable] = useState(false);
  const [markingReadId, setMarkingReadId] = useState<number | null>(null);

  // My contracts state
  const [myContracts, setMyContracts] = useState<MyContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  // null = not yet fetched, false = fetched (no 403), true = no employee profile (admin)
  const [isAdminNoProfile, setIsAdminNoProfile] = useState<boolean | null>(null);

  // Nurse account state (read-only, from cskh-app-backend)
  const [nurseAccount, setNurseAccount] = useState<NurseAccountInfo | null>(null);
  const [nurseAccountLoading, setNurseAccountLoading] = useState(false);

  useEffect(() => {
    fetchProfileData();
  }, []);

  useEffect(() => {
    if (!showTeamModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowTeamModal(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showTeamModal]);

  const loadNurseAccount = async (employeeId: string) => {
    try {
      setNurseAccountLoading(true);
      const res = await nurseAccountAPI.getByHrmEmployeeId(employeeId);
      setNurseAccount(res.data);
    } catch (err) {
      console.warn('Không thể tải tài khoản y tá:', err);
      setNurseAccount({ found: false });
    } finally {
      setNurseAccountLoading(false);
    }
  };

  const fetchProfileData = async () => {
    try {
      setLoading(true);

      // Fetch the current authenticated user's employee profile
      const emp = await employeesAPI.me();
      setEmployee(emp);

      // Fetch nurse account info (non-blocking)
      if (emp.employee_id) {
        loadNurseAccount(emp.employee_id);
      }

      // Fetch onboarding của user (nếu có) để hiển thị "Tài liệu cần đọc"
      try {
        const myOb = await onboardingService.myOnboarding();
        setOnboarding(myOb);
      } catch (err) {
        console.warn('No onboarding for current user:', err);
      }

      // Fetch danh sách hợp đồng của chính nhân viên
      setContractsLoading(true);
      try {
        const res = await managementApi.get('/api-hrm/employee-contracts/my-contracts/');
        setMyContracts(res.data);
        setIsAdminNoProfile(false);
      } catch (err: any) {
        if (err?.response?.status === 403) {
          setIsAdminNoProfile(true);
        } else {
          setIsAdminNoProfile(false);
        }
      } finally {
        setContractsLoading(false);
      }

      // Set initial form values
      setEditForm({
        phone_number: emp.phone_number || '',
        personal_email: emp.personal_email || '',
        bank_name: emp.bank_name || '',
        bank_account: emp.bank_account || '',
        date_of_birth: emp.date_of_birth || '',
        cccd_number: emp.cccd_number || '',
        cccd_issue_date: emp.cccd_issue_date || '',
        cccd_issue_place: emp.cccd_issue_place || '',
        permanent_residence: emp.permanent_residence || '',
        current_address: emp.current_address || '',
      });

      // Fetch department details
      if (emp.department?.id) {
        try {
          const dept = await departmentsAPI.getById(emp.department.id);
          setDepartment(dept);
        } catch (err) {
          console.error('Error fetching department:', err);
        }
      }

      // Fetch manager details
      try {
        let managerId: number | null = null;
        if (emp.manager && typeof emp.manager === 'object' && emp.manager.id) {
          managerId = emp.manager.id;
        } else if (
          emp.manager &&
          (typeof emp.manager === 'number' || !isNaN(Number(emp.manager)))
        ) {
          // Some APIs return manager as an ID (number) instead of object
          managerId = Number(emp.manager);
        }

        if (managerId) {
          try {
            const mgr = await employeesAPI.getById(managerId);
            console.log('Fetched manager by id:', mgr);
            setManager(mgr);
          } catch (err) {
            console.error('Error fetching manager by id:', managerId, err);
            // Fallback to manager_name from employee payload if available
            if (emp.manager_name) {
              setManager({
                id: managerId,
                full_name: emp.manager_name,
              } as unknown as Employee);
            }
          }
        } else if (emp.manager_name) {
          // No manager id available, but API returned manager name
          setManager({
            id: 0,
            full_name: emp.manager_name,
          } as unknown as Employee);
        }
      } catch (err) {
        console.error('Unexpected error while resolving manager:', err);
      }

      // Fetch team members (employees in same department)
      if (emp.department?.id) {
        try {
          const deptEmployees = await departmentsAPI.employees(
            emp.department.id,
            { page_size: 50 }
          );
          const team = deptEmployees.results
            .filter((e) => e.id !== emp.id)
            .map((e) => ({
              id: e.id,
              employee_id: e.employee_id,
              full_name: e.full_name,
              position_title: e.position?.title || 'Chưa phân chức vụ',
              phone_number: e.phone_number,
              personal_email: e.personal_email,
            }));
          setTeamMembers(team);
        } catch (err) {
          console.error('Error fetching team members:', err);
        }
      }

      setError(null);
    } catch (err: any) {
      console.error('Error fetching profile data:', err);
      setError('Không thể tải thông tin cá nhân. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  // Edit modal handlers
  const openEditModal = () => {
    if (!employee) return;
    setEditForm({
      phone_number: employee.phone_number || '',
      personal_email: employee.personal_email || '',
      bank_name: employee.bank_name || '',
      bank_account: employee.bank_account || '',
      date_of_birth: employee.date_of_birth || '',
      cccd_number: employee.cccd_number || '',
      cccd_issue_date: employee.cccd_issue_date || '',
      cccd_issue_place: employee.cccd_issue_place || '',
      permanent_residence: employee.permanent_residence || '',
      current_address: employee.current_address || '',
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    try {
      setEditSubmitting(true);
      await employeesAPI.partialUpdate(employee.id, {
        phone_number: editForm.phone_number || undefined,
        personal_email: editForm.personal_email || undefined,
        bank_name: editForm.bank_name || undefined,
        bank_account: editForm.bank_account || undefined,
        date_of_birth: editForm.date_of_birth || undefined,
        cccd_number: editForm.cccd_number || undefined,
        cccd_issue_date: editForm.cccd_issue_date || undefined,
        cccd_issue_place: editForm.cccd_issue_place || undefined,
        permanent_residence: editForm.permanent_residence || undefined,
        current_address: editForm.current_address || undefined,
      });
      setEmployee(prev => prev ? { ...prev, ...editForm } : null);
      setShowEditModal(false);
    } catch (err: any) {
      console.error('Error updating profile:', err);
      alert('Cập nhật thất bại. Vui lòng thử lại sau.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side file size validation (5 MB limit)
    const MAX_SIZE_MB = 5;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`Kích thước ảnh không được vượt quá ${MAX_SIZE_MB}MB.`);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      return;
    }

    setAvatarUploading(true);
    try {
      const result = await employeesAPI.changeAvatar(file);
      setEmployee((prev) => prev ? { ...prev, avatar_url: result.avatar_url } : prev);
      // Sync avatar URL into auth context so sidebar/header reflect it immediately
      if (user?.hrm_user) {
        updateUser({ hrm_user: { ...user.hrm_user, avatar_url: result.avatar_url } });
      }
    } catch (err) {
      console.error('Avatar upload failed:', err);
      alert('Tải ảnh đại diện thất bại. Vui lòng thử lại.');
    } finally {
      setAvatarUploading(false);
      // Reset file input so the same file can be selected again
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const formatCurrency = (n: number) =>
    n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' VNĐ';

  const getGenderText = (gender: string) => {
    switch (gender) {
      case 'M':
        return 'Nam';
      case 'F':
        return 'Nữ';
      case 'O':
        return 'Khác';
      default:
        return gender;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        <p className="text-sm text-gray-500">Đang tải dữ liệu...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-8 text-center">
        <div className="h-12 w-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ExclamationTriangleIcon className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-red-600 mb-1">Đã xảy ra lỗi</p>
        <p className="text-xs text-gray-400 mb-4">{error}</p>
        <button onClick={fetchProfileData} className="btn-primary text-xs px-4 py-2">
          Thử lại
        </button>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
        <div className="h-12 w-12 bg-primary-100 text-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <UserIcon className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-gray-500">Không tìm thấy thông tin nhân viên</p>
        <p className="text-xs text-gray-400 mt-1">Vui lòng liên hệ quản trị viên để được hỗ trợ.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
            Thông tin cá nhân
          </h1>
          <p className="mt-1 text-sm text-gray-900">
            Quản lý thông tin cá nhân và tài khoản ngân hàng
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            employee.employment_status === 'ACTIVE'
              ? 'bg-emerald-100 text-emerald-600'
              : employee.employment_status === 'PROBATION'
                ? 'bg-amber-100 text-amber-600'
                : 'bg-gray-100 text-gray-500'
          }`}>
            <UserIcon className="h-4 w-4 mr-1" />
            {employee.employment_status === 'ACTIVE'
              ? 'Đang làm việc'
              : employee.employment_status === 'PROBATION'
                ? 'Đang thử việc'
                : 'Đã nghỉ việc'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setChangePasswordKey(k => k + 1); setShowChangePassword(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
            >
              <KeyIcon className="h-3.5 w-3.5" />
              Đổi mật khẩu
            </button>
            {employee?.self_edit_locked ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg"
                title="Công ty đang khoá nhân viên tự sửa hồ sơ. Liên hệ HCNS để cập nhật thông tin."
              >
                <PencilIcon className="h-3.5 w-3.5" />
                Hồ sơ đang khoá chỉnh sửa — liên hệ HCNS
              </span>
            ) : (
              <button
                onClick={openEditModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
              >
                <PencilIcon className="h-3.5 w-3.5" />
                Chỉnh sửa thông tin
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Avatar Card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <PhotoIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Ảnh đại diện</h3>
            <p className="text-xs text-gray-400">Ảnh hiển thị trên hệ thống</p>
          </div>
        </div>
        <div className="flex items-center space-x-6">
          <div className="relative flex-shrink-0">
            {employee.avatar_url ? (
              <img
                src={employee.avatar_url}
                alt="Avatar"
                className="h-20 w-20 rounded-full object-cover border-2 border-gray-200"
              />
            ) : (
              <div className="h-20 w-20 rounded-full bg-gradient-to-r from-primary-500 to-primary-800 flex items-center justify-center border-2 border-gray-200">
                <span className="text-2xl font-bold text-white">
                  {employee.full_name?.charAt(0).toUpperCase() || '?'}
                </span>
              </div>
            )}
          </div>
          <div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
              id="avatar-upload"
            />
            <label
              htmlFor="avatar-upload"
              className={`inline-flex items-center px-4 py-2 border border-gray-300 rounded-xl shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer ${avatarUploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <PhotoIcon className="h-4 w-4 mr-2 text-gray-400" />
              {avatarUploading ? 'Đang tải...' : 'Thay đổi ảnh'}
            </label>
            <p className="mt-1 text-xs text-gray-400">PNG, JPG, GIF tối đa 5MB</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column - Personal Information */}
        <div className="lg:col-span-2 space-y-5">
          {/* Personal Info Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <IdentificationIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Thông tin cá nhân</h3>
                <p className="text-xs text-gray-400">Mã NV: {employee.employee_id}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Họ và tên
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <UserIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">{employee.full_name}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Giới tính
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {getGenderText(employee.gender)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ngày sinh</label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <CalendarIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">{employee.date_of_birth ? formatDate(employee.date_of_birth) : 'Chưa cập nhật'}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ngày vào làm
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <CalendarIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">
                    {employee.start_date
                      ? formatDate(employee.start_date)
                      : 'N/A'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Số điện thoại
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <PhoneIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">
                    {employee.phone_number || 'Chưa cập nhật'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email cá nhân
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <EnvelopeIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">
                    {employee.personal_email || 'Chưa cập nhật'}
                  </span>
                </div>
              </div>
            </div>

            {/* Tài khoản y tá — read-only */}
            <div className="border-t border-gray-100 mt-5 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 bg-indigo-50 text-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <KeyIcon className="h-3.5 w-3.5" />
                </div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tài khoản y tá</h4>
              </div>
              {nurseAccountLoading ? (
                <p className="text-xs text-gray-400">Đang tải...</p>
              ) : !nurseAccount || !nurseAccount.found ? (
                <p className="text-xs text-gray-400 italic">Chưa có tài khoản y tá</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Tên đăng nhập</label>
                    <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-800 font-mono">
                      {nurseAccount.username || '—'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Trạng thái tài khoản App</label>
                    <div className="px-3 py-2 bg-gray-50 rounded-lg">
                      {nurseAccount.is_active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                          Đang hoạt động
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400 inline-block" />
                          Vô hiệu hóa
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Bác sĩ quản lý</label>
                    <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-800">
                      {nurseAccount.assigned_doctor_name || (
                        <span className="text-gray-400 italic">Chưa phân công</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bank Information Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <BanknotesIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Thông tin ngân hàng</h3>
                <p className="text-xs text-gray-400">Tài khoản nhận lương</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tên ngân hàng
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <BanknotesIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">
                    {employee.bank_name || 'Chưa cập nhật'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Số tài khoản
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <BanknotesIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">
                    {employee.bank_account || 'Chưa cập nhật'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Department and Team Info */}
        <div className="space-y-5">
          {/* Department Info Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <BuildingOfficeIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Thông tin phòng ban</h3>
                <p className="text-xs text-gray-400">Đơn vị công tác</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phòng ban
                </label>
                <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                  <BuildingOfficeIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-gray-900">
                    {department?.name ||
                      employee.department?.name ||
                      'Chưa phân phòng'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mã phòng ban
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {department?.code || employee.department?.code || 'N/A'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chức vụ
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {employee.position?.title || 'Không có chức vụ'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Manager Info Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <UserGroupIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Quản lý trực tiếp</h3>
                <p className="text-xs text-gray-400">Người quản lý</p>
              </div>
            </div>

            {manager || employee.manager_name ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Họ tên
                  </label>
                  <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                    <UserIcon className="h-5 w-5 text-gray-400 mr-2" />
                    <span className="text-gray-900">
                      {manager?.full_name || employee.manager_name}
                    </span>
                  </div>
                </div>

                {manager?.employee_id && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Mã nhân viên
                    </label>
                    <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                      <span className="text-gray-900">{manager.employee_id}</span>
                    </div>
                  </div>
                )}

                {manager?.position?.title && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Chức vụ
                    </label>
                    <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                      <span className="text-gray-900">{manager.position.title}</span>
                    </div>
                  </div>
                )}

                {manager?.phone_number && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Số điện thoại
                    </label>
                    <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                      <PhoneIcon className="h-5 w-5 text-gray-400 mr-2" />
                      <span className="text-gray-900">
                        {manager.phone_number}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <UserIcon className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-400">
                  Không có quản lý trực tiếp
                </p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* New Onboarding and HR Information Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Contract and Salary Information */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <CurrencyDollarIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Thông tin hợp đồng &amp; Lương</h3>
              <p className="text-xs text-gray-400">Loại hợp đồng và mức lương</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Loại hợp đồng
              </label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <DocumentTextIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">
                  {employee.contract_type_display ||
                    (employee.contract_type ? CONTRACT_TYPE_MAP[employee.contract_type] : undefined) ||
                    employee.contract_type ||
                    'Chưa cập nhật'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lương cơ bản
                </label>
                <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900 flex-1">
                    {showSalary
                      ? (employee.basic_salary ? formatCurrency(employee.basic_salary) : 'Chưa cập nhật')
                      : '*******'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSalary((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                    title={showSalary ? 'Ẩn lương' : 'Hiện lương'}
                  >
                    {showSalary ? (
                      <EyeSlashIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tháng thử việc
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {employee.probation_months
                      ? `${employee.probation_months} tháng`
                      : 'Chưa cập nhật'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ngày kết thúc thử việc
              </label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <ClockIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">
                  {employee.probation_end_date
                    ? formatDate(employee.probation_end_date)
                    : 'Chưa cập nhật'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Employee File Status */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <DocumentCheckIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Trạng thái hồ sơ</h3>
              <p className="text-xs text-gray-400">Hồ sơ nhân sự</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Trạng thái hồ sơ
              </label>
              <div
                className={`flex items-center px-3 py-2.5 rounded-xl ${
                  employee.file_status === 'COMPLETE'
                    ? 'bg-emerald-50 text-emerald-700'
                    : employee.file_status === 'NEED_SUPPLEMENT'
                      ? 'bg-amber-50 text-amber-700'
                      : employee.file_status === 'NOT_SUBMITTED'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-50 text-gray-800'
                }`}
              >
                <DocumentDuplicateIcon className="h-5 w-5 mr-2" />
                <span className="font-medium">
                  {employee.file_status_display ||
                    employee.file_status ||
                    'Chưa cập nhật'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hạn nộp hồ sơ
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {employee.file_submission_deadline
                      ? formatDate(employee.file_submission_deadline)
                      : 'Chưa cập nhật'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ngày nộp hồ sơ
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {employee.file_submission_date
                      ? formatDate(employee.file_submission_date)
                      : 'Chưa nộp'}
                  </span>
                </div>
              </div>
            </div>

            {employee.file_review_notes && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ghi chú rà soát
                </label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <p className="text-gray-900 text-sm">
                    {employee.file_review_notes}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tài liệu onboarding cần đọc */}
      {(() => {
        const requiredDocs = (onboarding?.documents || []).filter(
          (d) => d.document_type === 'REGULATION' && d.is_required
        );
        if (requiredDocs.length === 0) return null;
        const unreadCount = requiredDocs.filter((d) => !d.is_read).length;
        return (
          <div className="bg-primary-50 border border-primary-200 rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <DocumentTextIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Tài liệu onboarding cần đọc</h3>
                <p className="text-xs text-gray-400">
                  {unreadCount === 0
                    ? 'Bạn đã đọc hết tài liệu bắt buộc'
                    : `${unreadCount} / ${requiredDocs.length} chưa đọc`}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {requiredDocs.map((doc) => (
                <div key={doc.id} className="bg-white rounded-2xl border border-primary-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{doc.document_name}</p>
                      {doc.description && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{doc.description}</p>
                      )}
                      {doc.is_read ? (
                        <span className="inline-flex items-center gap-1 mt-2 px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-600">
                          <CheckCircleIcon className="w-3 h-3" /> Đã đọc
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 mt-2 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-600">
                          <ClockIcon className="w-3 h-3" /> Chưa đọc
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setViewingDoc(doc);
                        setDocReadable(false);
                      }}
                      className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors flex-shrink-0 inline-flex items-center gap-1.5"
                    >
                      <EyeIcon className="w-4 h-4" />
                      Xem
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Contract Section */}
      {isAdminNoProfile === false && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <DocumentTextIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Hợp đồng lao động</h3>
              <p className="text-xs text-gray-400">Danh sách hợp đồng</p>
            </div>
            {contractsLoading && (
              <ArrowPathIcon className="h-4 w-4 animate-spin text-gray-400 ml-auto" />
            )}
          </div>

          {!contractsLoading && myContracts.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <DocumentTextIcon className="mx-auto h-10 w-10 text-gray-300 mb-2" />
              <p className="text-sm">Chưa có hợp đồng nào</p>
            </div>
          )}

          {myContracts.length > 0 && (() => {
            // Sắp xếp HĐ mới nhất lên đầu (start_date desc, fallback created_at desc)
            // → khi HR tạo HĐ mới, FE luôn hiển thị HĐ mới nhất làm "Hợp đồng hiện tại".
            const sorted = [...myContracts].sort((a, b) => {
              const sa = a.start_date || a.created_at || '';
              const sb = b.start_date || b.created_at || '';
              return sb.localeCompare(sa);
            });
            const active = sorted.find(
              (c) => c.status === 'SIGNED' && (getDaysUntilExpiry(c.end_date) === null || getDaysUntilExpiry(c.end_date)! >= 0)
            );
            const history = sorted.filter((c) => c !== active);
            const { label, className } = active
              ? getContractDisplayStatus(active)
              : { label: '', className: '' };

            return (
              <div className="space-y-5">
                {/* Active contract */}
                {active ? (
                  <div className={`rounded-2xl border p-5 ${
                    getDaysUntilExpiry(active.end_date) !== null && getDaysUntilExpiry(active.end_date)! <= 5
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-emerald-300 bg-emerald-50'
                  }`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Hợp đồng hiện tại</p>
                        <p className="font-semibold text-gray-900 text-base">
                          {active.template_name || active.contract_type_display}
                        </p>
                        {active.contract_number && (
                          <p className="text-xs text-gray-400 mt-0.5">Số HĐ: {active.contract_number}</p>
                        )}
                      </div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${className}`}>
                        {label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                      <div>
                        <span className="text-gray-400">Ngày bắt đầu</span>
                        <p className="font-medium text-gray-800">{active.start_date ? formatDate(active.start_date) : '—'}</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Ngày kết thúc</span>
                        <p className="font-medium text-gray-800">{active.end_date ? formatDate(active.end_date) : 'Không xác định'}</p>
                      </div>
                      {active.company_unit_name && (
                        <div className="col-span-2">
                          <span className="text-gray-400">Đơn vị ký kết</span>
                          <p className="font-medium text-gray-800">{active.company_unit_name}</p>
                        </div>
                      )}
                    </div>
                    {getDaysUntilExpiry(active.end_date) !== null && getDaysUntilExpiry(active.end_date)! <= 5 && getDaysUntilExpiry(active.end_date)! >= 0 && (
                      <div className="mt-3 flex items-center gap-2 text-amber-700 bg-amber-100 rounded-xl px-3 py-2 text-sm">
                        <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
                        Hợp đồng sắp hết hạn trong {getDaysUntilExpiry(active.end_date)} ngày. Vui lòng liên hệ phòng HCNS để gia hạn nhằm tiếp tục sử dụng dịch vụ.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-red-300 bg-red-50 p-5">
                    <div className="flex items-center gap-3">
                      <ExclamationTriangleIcon className="h-6 w-6 text-red-500 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-red-800">Không có hợp đồng hiệu lực</p>
                        <p className="text-sm text-red-600 mt-0.5">Vui lòng liên hệ phòng HCNS để được ký hợp đồng mới nhằm tiếp tục sử dụng dịch vụ.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* History */}
                {history.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Lịch sử hợp đồng</p>
                    <div className="divide-y divide-gray-100 border border-gray-100 rounded-2xl overflow-hidden">
                      {history.map((c) => {
                        const { label: hLabel, className: hClass } = getContractDisplayStatus(c);
                        return (
                          <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {c.template_name || c.contract_type_display}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {c.start_date ? formatDate(c.start_date) : '—'}
                                {c.end_date ? ` → ${formatDate(c.end_date)}` : ''}
                                {c.contract_number ? ` · ${c.contract_number}` : ''}
                              </p>
                            </div>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${hClass}`}>
                              {hLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Training and Personal Information Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Training Information */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <AcademicCapIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Đào tạo hội nhập</h3>
              <p className="text-xs text-gray-400">Tình trạng đào tạo</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bài thuyết trình đào tạo
              </label>
              <div
                className={`flex items-center px-3 py-2.5 rounded-xl ${
                  employee.training_presentation_viewed
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-gray-50 text-gray-800'
                }`}
              >
                <DocumentTextIcon className="h-5 w-5 mr-2" />
                <span className="font-medium">
                  {employee.training_presentation_viewed
                    ? 'Đã xem'
                    : 'Chưa xem'}
                </span>
                {employee.training_presentation_viewed_at && (
                  <span className="text-sm ml-2">
                    ({formatDate(employee.training_presentation_viewed_at)})
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ảnh chụp thông tin VNEID
              </label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <PhotoIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">
                  {employee.vneid_screenshot ? 'Đã tải lên' : 'Chưa tải lên'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* CCCD and Personal Information */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <IdentificationIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Thông tin CCCD</h3>
              <p className="text-xs text-gray-400">Căn cước công dân</p>
            </div>
          </div>

          <div className="space-y-4">

            {/* Số CCCD — read only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Số CCCD</label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <IdentificationIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">{employee.cccd_number || 'Chưa cập nhật'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Ngày cấp — read only */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ngày cấp</label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">{employee.cccd_issue_date ? formatDate(employee.cccd_issue_date) : 'Chưa cập nhật'}</span>
                </div>
              </div>

              {/* Nơi cấp — read only */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nơi cấp</label>
                <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                  <span className="text-gray-900">
                    {CITIZEN_ID_ISSUE_PLACE_OPTIONS.find(o => o.value === employee.cccd_issue_place)?.label || employee.cccd_issue_place || 'Chưa cập nhật'}
                  </span>
                </div>
              </div>
            </div>

            {/* Nơi khai sinh — read only */}
            {/* <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nơi khai sinh</label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <MapPinIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">{employee.birth_place || 'Chưa cập nhật'}</span>
              </div>
            </div> */}

            {/* Hộ khẩu thường trú — read only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hộ khẩu thường trú</label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <HomeIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">{employee.permanent_residence || 'Chưa cập nhật'}</span>
              </div>
            </div>

            {/* Địa chỉ hiện tại — read only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Địa chỉ hiện tại</label>
              <div className="flex items-center px-3 py-2.5 bg-gray-50 rounded-xl">
                <MapPinIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-gray-900">{employee.current_address || 'Chưa cập nhật'}</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* BHXH & Thuế + Người liên hệ khẩn cấp */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* BHXH & Thuế */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <DocumentCheckIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Bảo hiểm xã hội & Thuế</h3>
              <p className="text-xs text-gray-400">Mã số BHXH, mã số thuế</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mã số BHXH</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.social_insurance_number || 'Chưa cập nhật'}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mã số thuế</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.tax_code || 'Chưa cập nhật'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Người liên hệ khẩn cấp */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <PhoneIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Người liên hệ khẩn cấp</h3>
              <p className="text-xs text-gray-400">Thông tin người liên hệ phụ thuộc</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Họ và tên</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.emergency_contact_name || 'Chưa cập nhật'}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mối quan hệ</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.emergency_contact_relationship || 'Chưa cập nhật'}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Số điện thoại</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.emergency_contact_phone || 'Chưa cập nhật'}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày sinh</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.emergency_contact_dob ? formatDate(employee.emergency_contact_dob) : 'Chưa cập nhật'}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nghề nghiệp</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.emergency_contact_occupation || 'Chưa cập nhật'}</span>
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Địa chỉ</label>
              <div className="px-3 py-2.5 bg-gray-50 rounded-xl">
                <span className="text-gray-900">{employee.emergency_contact_address || 'Chưa cập nhật'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <UserGroupIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Thành viên trong team</h3>
            <p className="text-xs text-gray-400">{teamMembers.length} thành viên</p>
          </div>
        </div>

        {teamMembers.length > 0 ? (
          <div className="space-y-4">
            {teamMembers.slice(0, 5).map((member) => (
              <div
                key={member.id}
                className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-medium text-gray-900">
                      {member.full_name}
                    </h4>
                    <p className="text-sm text-gray-400">
                      {member.position_title}
                    </p>
                    <p className="text-sm text-gray-400">
                      Mã NV: {member.employee_id}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {member.phone_number && (
                    <div className="flex items-center text-gray-600">
                      <PhoneIcon className="h-4 w-4 mr-1" />
                      <span>{member.phone_number}</span>
                    </div>
                  )}
                  {member.personal_email && (
                    <div className="flex items-center text-gray-600">
                      <EnvelopeIcon className="h-4 w-4 mr-1" />
                      <span className="truncate">
                        {member.personal_email}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {teamMembers.length > 5 && (
              <div className="text-center pt-4 border-t border-gray-100">
                <button
                  onClick={() => setShowTeamModal(true)}
                  className="text-sm text-primary-600 hover:text-primary-800 font-medium"
                >
                  Xem thêm ({teamMembers.length - 5} thành viên khác)
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-400">
              Không có thành viên trong team
            </p>
          </div>
        )}
      </div>

      {/* Team Members Modal */}
      {showTeamModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-modal-title"
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2
                  id="team-modal-title"
                  className="text-sm font-bold text-gray-900"
                >
                  Thành viên trong team
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {teamMembers.length} thành viên
                </p>
              </div>
              <button
                onClick={() => setShowTeamModal(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Đóng modal"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-4">
              {teamMembers.map((member) => (
                <div
                  key={member.id}
                  className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {member.full_name}
                      </h4>
                      <p className="text-sm text-gray-400">
                        {member.position_title}
                      </p>
                      <p className="text-sm text-gray-400">
                        Mã NV: {member.employee_id}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {member.phone_number && (
                      <div className="flex items-center text-gray-600">
                        <PhoneIcon className="h-4 w-4 mr-1" />
                        <span>{member.phone_number}</span>
                      </div>
                    )}
                    {member.personal_email && (
                      <div className="flex items-center text-gray-600">
                        <EnvelopeIcon className="h-4 w-4 mr-1" />
                        <span className="truncate">{member.personal_email}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal xem tài liệu onboarding */}
      {viewingDoc && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setViewingDoc(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{viewingDoc.document_name}</h3>
                {viewingDoc.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{viewingDoc.description}</p>
                )}
              </div>
              <button
                onClick={() => setViewingDoc(null)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden bg-gray-100">
              {viewingDoc.file_url || viewingDoc.file ? (
                <PdfFrame
                  src={viewingDoc.file_url || viewingDoc.file}
                  className="w-full h-full border-0"
                  title={viewingDoc.document_name}
                  onLoad={() => {
                    // Fallback: timer 10s đảm bảo user có đủ thời gian xem
                    setTimeout(() => setDocReadable(true), 10000);
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  Không có file đính kèm
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400">
                {viewingDoc.is_read
                  ? 'Bạn đã đọc tài liệu này'
                  : docReadable
                  ? 'Có thể xác nhận đã đọc'
                  : 'Vui lòng đọc hết tài liệu (tối thiểu 10 giây)...'}
              </p>
              {!viewingDoc.is_read && (
                <button
                  disabled={!docReadable || markingReadId === viewingDoc.id}
                  onClick={async () => {
                    if (!viewingDoc) return;
                    setMarkingReadId(viewingDoc.id);
                    try {
                      await onboardingService.markDocumentAsRead(viewingDoc.id);
                      const updated = await onboardingService.myOnboarding();
                      setOnboarding(updated);
                      setViewingDoc(null);
                    } catch (err: any) {
                      console.error('Failed to mark document as read:', err);
                    } finally {
                      setMarkingReadId(null);
                    }
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-primary-700"
                >
                  <CheckCircleIcon className="w-4 h-4" />
                  {markingReadId === viewingDoc.id ? 'Đang lưu...' : 'Đánh dấu đã đọc'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showChangePassword && (
        <ChangePasswordModal
          key={changePasswordKey}
          onClose={() => setShowChangePassword(false)}
          onSuccess={() => { setShowChangePassword(false); setShowPasswordSuccess(true); }}
        />
      )}

      <FeedbackDialog
        open={showPasswordSuccess}
        variant="success"
        title="Đổi mật khẩu thành công"
        message="Mật khẩu của bạn đã được cập nhật. Vui lòng dùng mật khẩu mới cho lần đăng nhập tiếp theo."
        okLabel="Đóng"
        onClose={() => setShowPasswordSuccess(false)}
      />

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={closeEditModal} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">

              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <PencilIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Chỉnh sửa thông tin cá nhân</h3>
                    <p className="text-xs text-gray-400">Cập nhật thông tin liên hệ, CCCD và địa chỉ</p>
                  </div>
                </div>
                <button onClick={closeEditModal} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Form with scrollable body + sticky footer */}
              <form onSubmit={handleSaveAll} className="flex flex-col flex-1 min-h-0">
                <div className="p-6 space-y-6 overflow-y-auto flex-1">

                  {/* Section 1: Thông tin liên hệ */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Thông tin liên hệ</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Ngày sinh</label>
                        <input
                          type="date"
                          value={editForm.date_of_birth}
                          onChange={e => handleInputChange('date_of_birth', e.target.value)}
                          className="input-field w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Số điện thoại</label>
                        <input
                          type="tel"
                          value={editForm.phone_number}
                          onChange={e => handleInputChange('phone_number', e.target.value)}
                          className="input-field w-full"
                          placeholder="Nhập số điện thoại"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email cá nhân</label>
                        <input
                          type="email"
                          value={editForm.personal_email}
                          onChange={e => handleInputChange('personal_email', e.target.value)}
                          className="input-field w-full"
                          placeholder="Nhập email cá nhân"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-gray-100" />

                  {/* Section 2: Thông tin ngân hàng */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Thông tin ngân hàng</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Tên ngân hàng</label>
                        <input
                          type="text"
                          value={editForm.bank_name}
                          onChange={e => handleInputChange('bank_name', e.target.value)}
                          className="input-field w-full"
                          placeholder="Ví dụ: Vietcombank"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Số tài khoản</label>
                        <input
                          type="text"
                          value={editForm.bank_account}
                          onChange={e => handleInputChange('bank_account', e.target.value)}
                          className="input-field w-full"
                          placeholder="Nhập số tài khoản"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-gray-100" />

                  {/* Section 3: Thông tin CCCD */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Căn cước công dân</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Số CCCD</label>
                        <input
                          type="text"
                          value={editForm.cccd_number}
                          onChange={e => handleInputChange('cccd_number', e.target.value)}
                          className="input-field w-full"
                          placeholder="Nhập số CCCD"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Ngày cấp</label>
                        <input
                          type="date"
                          value={editForm.cccd_issue_date}
                          onChange={e => handleInputChange('cccd_issue_date', e.target.value)}
                          className="input-field w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Nơi cấp</label>
                        <SelectBox<string>
                          label=""
                          value={editForm.cccd_issue_place}
                          options={CITIZEN_ID_ISSUE_PLACE_OPTIONS}
                          onChange={v => handleInputChange('cccd_issue_place', v)}
                          placeholder="Chọn nơi cấp..."
                          portal
                        />
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-gray-100" />

                  {/* Section 4: Địa chỉ */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">Địa chỉ</p>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Hộ khẩu thường trú</label>
                        <input
                          type="text"
                          value={editForm.permanent_residence}
                          onChange={e => handleInputChange('permanent_residence', e.target.value)}
                          className="input-field w-full"
                          placeholder="Nhập địa chỉ hộ khẩu thường trú"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Địa chỉ hiện tại</label>
                        <input
                          type="text"
                          value={editForm.current_address}
                          onChange={e => handleInputChange('current_address', e.target.value)}
                          className="input-field w-full"
                          placeholder="Nhập địa chỉ hiện tại"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Modal footer inside form */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="btn-secondary text-xs px-4 py-2"
                  >
                    Huỷ
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="btn-primary text-xs px-4 py-2 disabled:opacity-50"
                  >
                    {editSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </div>
              </form>

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
