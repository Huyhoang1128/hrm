import React, { useState, useEffect } from 'react';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useNotificationDrawer } from '../contexts/NotificationDrawerContext';
import { hrmAPI, managementApi } from '../utils/api';
import { employeesAPI, departmentsAPI, birthdayWishesAPI, BirthdayWish } from '../utils/api';
import {
  BuildingOfficeIcon,
  UserGroupIcon,
  CalendarIcon,
  DocumentTextIcon,
  ScaleIcon,
  ArrowRightIcon,
  UserIcon,
  ClockIcon,
  CakeIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  TrophyIcon,
  MegaphoneIcon,
  ExclamationTriangleIcon,
  BellAlertIcon,
  StarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { HeartIcon } from '@heroicons/react/24/solid';
import { attendanceService, AttendanceRankingEntry } from '../services/attendance.service';
import { salaryService, type PenaltyRecord } from '../services/salary.service';
import { recruitmentService } from '../services/recruitment.service';
import { useNotePrompt } from '../components/NotePromptDialog';
import { NON_OFFICIAL_CONTRACT_TYPES, OFFICIAL_LABOR_CONTRACT_TYPES } from '../constants/contractTypes';

const formatBirthDate = (dateOfBirth: string): string => {
  const parts = dateOfBirth.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateOfBirth;
};

/** Get initials from a full name (max 2 characters) */
const getInitials = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/** Deterministic HSL hue from a string */
const stringToColor = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
};

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

const HOME_ANNOUNCEMENT_TYPE_BADGE: Record<string, string> = {
  ANNOUNCEMENT: 'bg-indigo-100 text-indigo-700',
  DECISION: 'bg-violet-100 text-violet-700',
  NOTICE: 'bg-teal-100 text-teal-700',
  CIRCULAR: 'bg-cyan-100 text-cyan-700',
  DIRECTIVE: 'bg-amber-100 text-amber-700',
  OTHER: 'bg-gray-100 text-gray-600',
};

const HOME_ANNOUNCEMENT_PRIORITY_BADGE: Record<string, string> = {
  URGENT: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-600',
};

const formatAnnouncementDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN');
};

const Home: React.FC = () => {
  const { user } = useAuth();
  const { askNote, notePromptDialog } = useNotePrompt();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState<any>(null);
  const [department, setDepartment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [birthdayEmployees, setBirthdayEmployees] = useState<Array<{
    employee_id: number;
    full_name: string;
    date_of_birth: string;
    avatar_url?: string | null;
    department: { id: number; name: string; code: string } | null;
  }>>([]);
  const [tomorrowBirthdayEmployees, setTomorrowBirthdayEmployees] = useState<Array<{
    employee_id: number;
    full_name: string;
    date_of_birth: string;
    avatar_url?: string | null;
    department: { id: number; name: string; code: string } | null;
  }>>([]);
  const [wishModal, setWishModal] = useState<{
    open: boolean;
    employee: { employee_id: number; full_name: string; avatar_url?: string | null } | null;
  }>({ open: false, employee: null });
  const [wishMessage, setWishMessage] = useState('');
  const [wishSent, setWishSent] = useState<Set<number>>(new Set());

  const [wishSending, setWishSending] = useState(false);
  const [wishError, setWishError] = useState<string | null>(null);
  const [wishListModal, setWishListModal] = useState<{
    open: boolean;
    employee: { employee_id: number; full_name: string; avatar_url?: string | null } | null;
    wishes: BirthdayWish[];
    loading: boolean;
  }>({ open: false, employee: null, wishes: [], loading: false });

  // Attendance ranking state
  const [attendanceRankings, setAttendanceRankings] = useState<AttendanceRankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingPeriod, setRankingPeriod] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    // Mặc định BXH tháng trước, vì tháng hiện tại chưa kết thúc nên dữ liệu chưa đầy đủ.
    // Người dùng có thể chọn tháng khác qua bộ chọn tháng/năm ở header của bảng.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { year: lastMonth.getFullYear(), month: lastMonth.getMonth() + 1 };
  });
  const RANKING_MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
  const RANKING_YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i);

  // Contract expiry alert (ADMIN/HR only)
  type ExpiringContract = {
    id: number;
    employee_name: string;
    end_date: string | null;
    contract_type_display: string;
    contract_number: string | null;
    days: number;
  };
  const [expiringContracts, setExpiringContracts] = useState<ExpiringContract[]>([]);
  const [showContractAlert, setShowContractAlert] = useState(false);

  // Employee's own contract — non-dismissable alert if no active contract
  type MyContract = { id: number; status: string; contract_type: string; end_date: string | null };
  // Các loại hợp đồng lao động thực sự — cam kết/thoả thuận (CONFIDENTIALITY, COMPANY_RULES, NURSING_COMMITMENT) không tính
  const LABOR_CONTRACT_TYPES = [...NON_OFFICIAL_CONTRACT_TYPES, ...OFFICIAL_LABOR_CONTRACT_TYPES, 'SERVICE'];
  const [myContracts, setMyContracts] = useState<MyContract[] | null>(null); // null = not yet fetched or admin
  const [contractCheckLoading, setContractCheckLoading] = useState(false);
  const [contractCheckFailed, setContractCheckFailed] = useState(false);

  const [pendingPenaltyApprovals, setPendingPenaltyApprovals] = useState<PenaltyRecord[]>([]);
  const [pendingPenaltyLoading, setPendingPenaltyLoading] = useState(false);
  const [pendingPenaltyActionId, setPendingPenaltyActionId] = useState<number | null>(null);
  const [showAllPendingPenalties, setShowAllPendingPenalties] = useState(false);
  const PENDING_PENALTY_COLLAPSED_COUNT = 3;
  const [myPendingPenalties, setMyPendingPenalties] = useState<PenaltyRecord[]>([]);

  // Recruitment referral widget state
  const [recruitmentNeeds, setRecruitmentNeeds] = useState<any[]>([]);
  const [referralLoading, setReferralLoading] = useState(false);

  // Current announcements for highlight section
  const { unreadIds, markRead, markAllRead, openDrawer } = useNotificationDrawer();
  const [homeAnnouncements, setHomeAnnouncements] = useState<any[]>([]);
  const [homeAnnouncementsLoading, setHomeAnnouncementsLoading] = useState(false);
  const [markingAllAnnouncementsRead, setMarkingAllAnnouncementsRead] = useState(false);

  useEffect(() => {
    fetchEmployeeData();
    fetchBirthdaysToday();
    fetchBirthdaysTomorrow();
    fetchExpiringContracts();
    fetchMyContracts();
    fetchPendingPenaltyApprovals();
    fetchRecruitmentNeeds();
  }, []);

  useEffect(() => {
    fetchAttendanceRanking();
  }, [rankingPeriod]);

  useEffect(() => {
    if (!employee?.id) return;

    let cancelled = false;

    const loadMyPendingPenalties = async () => {
      try {
        const data = await salaryService.listMyPendingPenalties(employee.id);
        if (!cancelled) setMyPendingPenalties(data);
      } catch (err) {
        console.error('Error fetching my pending disciplinary penalties:', err);
        if (!cancelled) setMyPendingPenalties([]);
      }
    };

    loadMyPendingPenalties();

    return () => {
      cancelled = true;
    };
  }, [employee?.id]);

  const fetchExpiringContracts = async () => {
    try {
      const res = await managementApi.get('/api-hrm/employee-contracts/expiring-alert/');
      const { dismissed_today, contracts } = res.data;
      if (!contracts?.length) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const expiring: ExpiringContract[] = contracts.map((c: any) => {
        const expiry = new Date(c.end_date);
        expiry.setHours(0, 0, 0, 0);
        const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return { id: c.id, employee_name: c.employee_name, end_date: c.end_date, contract_type_display: c.contract_type_display, contract_number: c.contract_number, days };
      });

      setExpiringContracts(expiring);
      if (!dismissed_today) setShowContractAlert(true);
    } catch {
      // Không có quyền (nhân viên thường) → bỏ qua
      setExpiringContracts([]);
      setShowContractAlert(false);
    }
  };

  const dismissContractAlert = async () => {
    setShowContractAlert(false);
    try {
      await managementApi.post('/api-hrm/employee-contracts/expiring-alert/');
    } catch { }
  };

  const fetchMyContracts = async (isManualCheck = false) => {
    if (isManualCheck) {
      setContractCheckLoading(true);
      setContractCheckFailed(false);
    }
    try {
      const res = await managementApi.get('/api-hrm/employee-contracts/my-contracts/');
      setMyContracts(res.data);
      if (isManualCheck) setContractCheckFailed(false);
    } catch (err: any) {
      // 403 = ADMIN without employee profile → no dialog needed
      setMyContracts(null);
      if (isManualCheck) setContractCheckFailed(true);
    } finally {
      if (isManualCheck) setContractCheckLoading(false);
    }
  };

  const hasActiveContract =
    myContracts !== null &&
    myContracts.some((c) => {
      if (c.status !== 'SIGNED') return false;
      if (!LABOR_CONTRACT_TYPES.includes(c.contract_type)) return false;
      if (!c.end_date) return true;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(c.end_date);
      end.setHours(0, 0, 0, 0);
      return end.getTime() >= today.getTime();
    });

  useEffect(() => {
    let cancelled = false;

    const loadHomeAnnouncements = async () => {
      setHomeAnnouncementsLoading(true);
      try {
        const all: any[] = [];
        let page = 1;
        let hasNext = true;

        while (hasNext && page <= 20) {
          const res = await hrmAPI.getCompanyAnnouncements({
            is_current: true,
            home_feed: true,
            page,
            page_size: 100,
          });
          all.push(...(res.results || []));
          hasNext = Boolean(res.next);
          page += 1;
        }

        if (!cancelled) setHomeAnnouncements(all);
      } catch (err) {
        console.error('Error fetching home announcements:', err);
        if (!cancelled) setHomeAnnouncements([]);
      } finally {
        if (!cancelled) setHomeAnnouncementsLoading(false);
      }
    };

    loadHomeAnnouncements();

    return () => {
      cancelled = true;
    };
  }, []);

  useLockBodyScroll(showContractAlert);
  const fetchBirthdaysToday = async () => {
    try {
      const data = await employeesAPI.birthdays_today();
      setBirthdayEmployees(data);
    } catch (err) {
      console.error('Error fetching birthdays:', err);
    }
  };

  const fetchBirthdaysTomorrow = async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const day = String(tomorrow.getDate()).padStart(2, '0');
      const tomorrowStr = `${year}-${month}-${day}`;
      const data = await employeesAPI.birthdays_today(tomorrowStr);
      setTomorrowBirthdayEmployees(data);
    } catch (err) {
      console.error('Error fetching tomorrow birthdays:', err);
    }
  };

  const fetchAttendanceRanking = async () => {
    setRankingLoading(true);
    try {
      const data = await attendanceService.getRanking({
        year: rankingPeriod.year,
        month: rankingPeriod.month,
        type: 'early',
        top: 10,
      });
      setAttendanceRankings(data);
    } catch (err) {
      console.error('Error fetching attendance ranking:', err);
    } finally {
      setRankingLoading(false);
    }
  };

  const fetchPendingPenaltyApprovals = async () => {
    setPendingPenaltyLoading(true);
    try {
      const data = await salaryService.listPendingPenaltyApprovals();
      setPendingPenaltyApprovals(data);
    } catch (err) {
      console.error('Error fetching pending disciplinary approvals:', err);
      setPendingPenaltyApprovals([]);
    } finally {
      setPendingPenaltyLoading(false);
    }
  };

  const fetchRecruitmentNeeds = async () => {
    setReferralLoading(true);
    try {
      // Fetch needs that are approved and published internally
      const res = await managementApi.get('/api/v1/recruitment/needs/', {
        params: {
          approval_status: 'APPROVED',
          is_published_internally: 'true',
          page_size: 6,
        }
      });
      const needs = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.results)
          ? res.data.results
          : [];
      setRecruitmentNeeds(needs);
    } catch (err) {
      console.error('Error fetching recruitment needs:', err);
      setRecruitmentNeeds([]);
    } finally {
      setReferralLoading(false);
    }
  };

  const handlePenaltyApproval = async (penalty: PenaltyRecord, action: 'approve' | 'reject') => {
    // Popup riêng của app thay cho window.prompt — bấm Huỷ thì KHÔNG duyệt/từ
    // chối (trước đây `prompt(...) || ''` khiến Huỷ vẫn thực hiện thao tác).
    const isApprove = action === 'approve';
    const note = await askNote({
      title: isApprove ? 'Duyệt biên bản phạt' : 'Từ chối biên bản phạt',
      message: `${penalty.employee_name} · ${penalty.employee_code}
Tháng ${penalty.month}/${penalty.year} · ${Number(penalty.amount).toLocaleString('vi-VN')} ₫`,
      label: isApprove ? 'Ghi chú duyệt (không bắt buộc)' : 'Lý do từ chối (không bắt buộc)',
      confirmLabel: isApprove ? 'Duyệt' : 'Từ chối',
      variant: isApprove ? 'info' : 'warning',
    });
    if (note === null) return;
    setPendingPenaltyActionId(penalty.id);
    try {
      if (action === 'approve') {
        await salaryService.approvePenalty(penalty.id, note);
      } else {
        await salaryService.rejectPenalty(penalty.id, note);
      }
      await fetchPendingPenaltyApprovals();
    } catch (err) {
      console.error('Error processing penalty approval:', err);
    } finally {
      setPendingPenaltyActionId(null);
    }
  };

  const fetchSentWishes = async (senderEmployeeId: number) => {
    try {
      const currentYear = new Date().getFullYear();
      const wishes = await birthdayWishesAPI.list({ sender: senderEmployeeId, year: currentYear });
      const sentIds = new Set(wishes.map((w) => w.recipient.id));
      setWishSent(sentIds);
    } catch (err) {
      console.error('Error fetching sent wishes:', err);
    }
  };

  const openWishModal = (emp: { employee_id: number; full_name: string; avatar_url?: string | null }) => {
    setWishMessage(`Chúc mừng sinh nhật ${emp.full_name}! 🎂🎉 Chúc bạn luôn vui vẻ, mạnh khỏe và thành công!`);
    setWishError(null);
    setWishModal({ open: true, employee: emp });
  };

  const closeWishModal = () => {
    setWishModal({ open: false, employee: null });
    setWishMessage('');
    setWishError(null);
  };

  const sendWish = async () => {
    if (!wishModal.employee || !wishMessage.trim()) return;
    if (!employee) {
      setWishError('Không thể xác định thông tin người gửi. Vui lòng tải lại trang.');
      return;
    }
    setWishSending(true);
    setWishError(null);
    try {
      await birthdayWishesAPI.create({
        recipient: wishModal.employee.employee_id,
        sender: employee.id,
        message: wishMessage.trim(),
        year: new Date().getFullYear(),
      });
      setWishSent(prev => new Set(prev).add(wishModal.employee!.employee_id));
      closeWishModal();
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.non_field_errors?.[0] ||
        'Gửi lời chúc thất bại. Vui lòng thử lại.';
      setWishError(detail);
    } finally {
      setWishSending(false);
    }
  };

  const openWishListModal = async (emp: { employee_id: number; full_name: string; avatar_url?: string | null }) => {
    setWishListModal({ open: true, employee: emp, wishes: [], loading: true });
    try {
      const wishes = await birthdayWishesAPI.list({ recipient: emp.employee_id, year: new Date().getFullYear() });
      setWishListModal(prev => ({ ...prev, wishes, loading: false }));
    } catch {
      setWishListModal(prev => ({ ...prev, wishes: [], loading: false }));
    }
  };

  const closeWishListModal = () => {
    setWishListModal({ open: false, employee: null, wishes: [], loading: false });
  };

  const fetchEmployeeData = async () => {
    try {
      setLoading(true);
      const emp = await employeesAPI.me();
      setEmployee(emp);
      fetchSentWishes(emp.id);

      if (emp.department?.id) {
        try {
          const dept = await departmentsAPI.getById(emp.department.id);
          setDepartment(dept);
        } catch (err) {
          console.error('Error fetching department:', err);
        }
      }

    } catch (err: any) {
      // Admin/service accounts may not have an Employee profile. The API uses
      // 404 for that valid state, so only surface unexpected failures.
      if (err?.response?.status !== 404) {
        console.error('Error fetching employee data:', err);
      }
      setEmployee(null);
      setDepartment(null);
    } finally {
      setLoading(false);
    }
  };

  // Calculate working days based on start date
  const calculateWorkingDays = () => {
    if (!employee?.start_date) return 0;

    const startDate = new Date(employee.start_date);
    const today = new Date();

    // Calculate difference in days
    const diffTime = Math.abs(today.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  };

  const userStats = [
    { label: 'Ngày làm việc', value: employee ? calculateWorkingDays().toString() : '0', icon: CalendarIcon, color: 'bg-primary-100 text-primary-600' },
    { label: 'Điểm danh', value: '0%', icon: ClockIcon, color: 'bg-emerald-100 text-emerald-600' },
  ];

  const visibleHomeAnnouncements = homeAnnouncements.filter((ann) => unreadIds.has(ann.id));

  const handleMarkAllAnnouncementsRead = async () => {
    if (markingAllAnnouncementsRead || visibleHomeAnnouncements.length === 0) return;
    setMarkingAllAnnouncementsRead(true);
    try {
      await markAllRead();
    } catch (err) {
      console.error('Error marking all announcements as read:', err);
    } finally {
      setMarkingAllAnnouncementsRead(false);
    }
  };

  const quickActions = [
    { title: 'Xin nghỉ phép', description: 'Đăng ký nghỉ phép năm, nghỉ ốm', icon: CalendarIcon, color: 'bg-primary-100 text-primary-700', path: '/dashboard/approvals' },
    { title: 'Báo cáo công việc', description: 'Gửi báo cáo tuần/tháng', icon: DocumentTextIcon, color: 'bg-emerald-100 text-emerald-700', path: '/company/internal-forms' },
    { title: 'Đề xuất', description: 'Đề xuất công tác, mua sắm', icon: ScaleIcon, color: 'bg-amber-100 text-amber-700', path: '/dashboard/approvals' },
    { title: 'Đào tạo', description: 'Đăng ký khóa đào tạo', icon: UserGroupIcon, color: 'bg-violet-100 text-violet-700', path: '/company/training' },
  ];

  return (
    <div className="space-y-5">
      {/* Welcome Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary-900 via-primary-800 to-primary-600 rounded-2xl text-white shadow-lg">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-white/[0.03]" />

        <div className="relative px-5 py-6 sm:px-10 sm:py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-5 sm:gap-6">
          <div className="flex items-center gap-4 sm:gap-5">
            {/* Avatar */}
            <div className="h-14 w-14 sm:h-20 sm:w-20 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center flex-shrink-0 self-start sm:self-auto ring-2 ring-white/20 shadow-lg">
              {employee?.avatar_url ? (
                <img src={employee.avatar_url} alt="" className="h-full w-full rounded-2xl object-cover" />
              ) : (
                <span className="text-2xl sm:text-3xl font-extrabold text-white">
                  {(employee?.full_name || user?.username || 'N')?.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-white/80 tracking-widest uppercase mb-1">Chào mừng trở lại</p>
              <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-tight sm:leading-tight">
                {employee?.full_name || user?.username || 'Nhân viên'}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-white/90">
                <span className="flex items-center gap-1.5">
                  <UserIcon className="h-4 w-4 text-white/70 flex-shrink-0" />
                  {user?.username || 'N/A'}
                </span>
                <span className="flex items-center gap-1.5">
                  <BuildingOfficeIcon className="h-4 w-4 text-white/70 flex-shrink-0" />
                  {loading ? 'Đang tải...' : (department?.name || employee?.department?.name || 'Chưa phân phòng')}
                </span>
                <span className="flex items-center gap-1.5">
                  <CalendarIcon className="h-4 w-4 text-white/70 flex-shrink-0" />
                  {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/dashboard/me')}
            className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-sm font-semibold text-white backdrop-blur transition-all duration-200 shadow-sm"
          >
            <UserIcon className="h-4 w-4" />
            Hồ sơ cá nhân
          </button>
        </div>
      </div>

      {/* Thông báo đang hiệu lực */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative h-9 w-9 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
              <MegaphoneIcon className="w-5 h-5 text-white" />
              {visibleHomeAnnouncements.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold ring-2 ring-white">
                  {Math.min(visibleHomeAnnouncements.length, 99)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900">Thông báo công ty</h2>
              <p className="text-xs text-gray-500">
                {homeAnnouncementsLoading
                  ? 'Đang tải thông báo...'
                  : visibleHomeAnnouncements.length > 0
                    ? `Đang hiển thị ${visibleHomeAnnouncements.length} thông báo chưa xem`
                    : 'Chưa có thông báo nào chưa xem'}
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {visibleHomeAnnouncements.length > 0 && (
              <button
                onClick={handleMarkAllAnnouncementsRead}
                disabled={markingAllAnnouncementsRead}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
              >
                <CheckCircleIcon className="h-3.5 w-3.5" />
                {markingAllAnnouncementsRead ? 'Đang xử lý...' : 'Đã đọc tất cả'}
              </button>
            )}
            <button
              onClick={() => openDrawer()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              Mở bảng <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {homeAnnouncementsLoading ? (
          <div className="flex items-center justify-center py-8 gap-3 text-sm text-amber-700">
            <div className="animate-spin h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full" />
            Đang tải thông báo...
          </div>
        ) : visibleHomeAnnouncements.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white/70 border border-amber-100 rounded-xl px-4 py-5 text-center">
            Chưa có thông báo nào chưa xem.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleHomeAnnouncements.map((ann) => {
              const effectiveFrom = formatAnnouncementDate(ann.effective_from);
              const effectiveTo = formatAnnouncementDate(ann.effective_to);
              const effectiveRange = [effectiveFrom, effectiveTo ? `đến ${effectiveTo}` : ''].filter(Boolean).join(' ');

              return (
                <button
                  key={ann.id}
                  onClick={() => { markRead(ann.id); openDrawer(ann); }}
                  className="group w-full text-left bg-white border border-amber-100 hover:border-amber-300 hover:bg-amber-50 rounded-xl px-4 py-3 transition-colors shadow-sm flex items-center gap-3"
                >
                  <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${HOME_ANNOUNCEMENT_TYPE_BADGE[ann.announcement_type] || 'bg-gray-100 text-gray-600'}`}>
                    {ann.announcement_type_display || ann.announcement_type || 'Thông báo'}
                  </span>
                  <p className="flex-1 min-w-0 text-sm font-semibold text-gray-900 truncate">
                    {ann.title}
                  </p>
                  <p className="hidden lg:block flex-shrink-0 text-xs text-gray-500 truncate max-w-[260px]">
                    {ann.content || effectiveRange || ' '}
                  </p>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${HOME_ANNOUNCEMENT_PRIORITY_BADGE[ann.priority] || 'bg-gray-100 text-gray-600'}`}>
                    {ann.priority_display || ann.priority || 'Bình thường'}
                  </span>
                  <ArrowRightIcon className="h-4 w-4 text-amber-500 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Biên bản phạt chờ duyệt */}
      {pendingPenaltyApprovals.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-red-500 flex items-center justify-center">
                <BellAlertIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Biên bản phạt chờ duyệt</h2>
                <p className="text-xs text-gray-500">Quản lý trực tiếp duyệt trên Home, dữ liệu sẽ được tính lương sau khi duyệt</p>
              </div>
            </div>
            {pendingPenaltyApprovals.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                {pendingPenaltyApprovals.length}
              </span>
            )}
          </div>

          {pendingPenaltyLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full" />
              Đang tải biên bản chờ duyệt...
            </div>
          ) : pendingPenaltyApprovals.length === 0 ? null : (
            <div className="space-y-3">
              {(showAllPendingPenalties
                ? pendingPenaltyApprovals
                : pendingPenaltyApprovals.slice(0, PENDING_PENALTY_COLLAPSED_COUNT)
              ).map((penalty) => (
                <div key={penalty.id} className="bg-white border border-red-100 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {penalty.employee_name} · {penalty.employee_code}
                    </p>
                    <p className="text-sm text-gray-600 mt-0.5">
                      Tháng {penalty.month}/{penalty.year} · {Number(penalty.amount).toLocaleString('vi-VN')} ₫
                    </p>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {penalty.reason || 'Không có lý do'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handlePenaltyApproval(penalty, 'reject')}
                      disabled={pendingPenaltyActionId === penalty.id}
                      className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Từ chối
                    </button>
                    <button
                      onClick={() => handlePenaltyApproval(penalty, 'approve')}
                      disabled={pendingPenaltyActionId === penalty.id}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                    >
                      Duyệt
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!pendingPenaltyLoading && pendingPenaltyApprovals.length > PENDING_PENALTY_COLLAPSED_COUNT && (
            <button
              onClick={() => setShowAllPendingPenalties((v) => !v)}
              className="mt-3 w-full flex items-center justify-center gap-1 text-sm font-semibold text-red-700 hover:text-red-800 py-2"
            >
              {showAllPendingPenalties ? (
                <>Thu gọn <ChevronUpIcon className="h-4 w-4" /></>
              ) : (
                <>Xem thêm {pendingPenaltyApprovals.length - PENDING_PENALTY_COLLAPSED_COUNT} biên bản <ChevronDownIcon className="h-4 w-4" /></>
              )}
            </button>
          )}
        </div>
      )}

      {/* Biên bản phạt của bản thân */}
      {myPendingPenalties.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-amber-500 flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Biên bản phạt của tôi</h2>
                <p className="text-xs text-gray-500">Hiển thị trạng thái phê duyệt của biên bản phạt</p>
              </div>
            </div>
            {myPendingPenalties.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                {myPendingPenalties.length}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {myPendingPenalties.map((penalty) => (
              <div key={penalty.id} className="bg-white border border-amber-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">
                      Tháng {penalty.month}/{penalty.year} · {Number(penalty.amount).toLocaleString('vi-VN')} ₫
                    </p>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {penalty.reason || 'Không có lý do'}
                    </p>
                  </div>
                  <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                    penalty.status === 'APPROVED'
                      ? 'bg-emerald-100 text-emerald-700'
                      : penalty.status === 'REJECTED'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                  }`}>
                    {penalty.status === 'APPROVED'
                      ? 'Đã duyệt'
                      : penalty.status === 'REJECTED'
                        ? 'Đã từ chối'
                        : 'Chờ duyệt'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {userStats.map((stat, index) => (
          <div key={index} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 flex flex-col items-start sm:flex-row sm:items-center gap-2.5 sm:gap-4 border-l-4 border-l-primary-500">
            <div className={`h-9 w-9 sm:h-11 sm:w-11 ${stat.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">{stat.label}</p>
              <p className="text-2xl font-extrabold text-gray-900 mt-0.5 tracking-tight">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Birthday Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-pink-100 rounded-xl flex items-center justify-center">
              <CakeIcon className="h-5 w-5 text-pink-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Chúc mừng sinh nhật hôm nay</h2>
              <p className="text-xs text-gray-600">{birthdayEmployees.length === 0 ? 'Không có sinh nhật hôm nay' : `${birthdayEmployees.length} nhân viên`}</p>
            </div>
          </div>
        </div>

        {birthdayEmployees.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {birthdayEmployees.map((emp) => (
              <div key={emp.employee_id} className="flex flex-col gap-3 p-4 bg-pink-50 border border-pink-100 rounded-2xl">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full flex-shrink-0 overflow-hidden ring-2 ring-pink-200">
                    {emp.avatar_url ? (
                      <img src={emp.avatar_url} alt={emp.full_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center" style={{ backgroundColor: stringToColor(emp.full_name) }}>
                        <span className="text-white text-sm font-bold">{getInitials(emp.full_name)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{emp.full_name}</p>
                    {emp.department && <p className="text-xs text-gray-500 truncate">{emp.department.name}</p>}
                    <p className="text-xs text-pink-500 font-medium mt-0.5">{formatBirthDate(emp.date_of_birth)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {wishSent.has(emp.employee_id) ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold">
                      <CheckCircleIcon className="h-3.5 w-3.5" /> Đã gửi lời chúc
                    </span>
                  ) : (
                    <button onClick={() => openWishModal(emp)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-pink-500 hover:bg-pink-600 text-white text-xs font-semibold rounded-lg transition-colors">
                      <PaperAirplaneIcon className="h-3.5 w-3.5" /> Gửi lời chúc
                    </button>
                  )}
                  <button onClick={() => openWishListModal(emp)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-pink-200 hover:bg-pink-50 text-pink-600 text-xs font-semibold rounded-lg transition-colors">
                    <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" /> Lời chúc
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tomorrow's Birthdays */}
        <div className={birthdayEmployees.length > 0 ? 'pt-4 border-t border-gray-100' : ''}>
          <div className="flex items-center gap-2 mb-3">
            <CakeIcon className="h-4 w-4 text-gray-300" />
            <h3 className="text-sm font-semibold text-gray-600">Sinh nhật ngày mai</h3>
          </div>
          {tomorrowBirthdayEmployees.length === 0 ? (
            <p className="text-sm text-gray-600">Không có sinh nhật ngày mai.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {tomorrowBirthdayEmployees.map((emp) => (
                <div key={emp.employee_id} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                  <div className="h-10 w-10 rounded-full flex-shrink-0 overflow-hidden">
                    {emp.avatar_url ? (
                      <img src={emp.avatar_url} alt={emp.full_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center" style={{ backgroundColor: stringToColor(emp.full_name) }}>
                        <span className="text-white text-sm font-bold">{getInitials(emp.full_name)}</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-500 text-sm truncate">{emp.full_name}</p>
                    {emp.department && <p className="text-xs text-gray-400 truncate">{emp.department.name}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{formatBirthDate(emp.date_of_birth)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Attendance Ranking Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-amber-100 rounded-xl flex items-center justify-center">
              <TrophyIcon className="h-5 w-5 text-amber-600" />
            </div>
            <h2 className="text-base font-bold text-gray-900">Bảng xếp hạng đi sớm</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={rankingPeriod.month}
              onChange={(e) => setRankingPeriod((prev) => ({ ...prev, month: Number(e.target.value) }))}
              className="text-xs font-medium border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {RANKING_MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>Tháng {m}</option>
              ))}
            </select>
            <select
              value={rankingPeriod.year}
              onChange={(e) => setRankingPeriod((prev) => ({ ...prev, year: Number(e.target.value) }))}
              className="text-xs font-medium border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {RANKING_YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {attendanceRankings.length > 0 && (
              <span className="text-xs text-gray-400 ml-1">{attendanceRankings.length} nhân viên</span>
            )}
          </div>
        </div>

        {rankingLoading ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full" />
            <span className="text-sm text-gray-400">Đang tải...</span>
          </div>
        ) : attendanceRankings.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Chưa có dữ liệu xếp hạng.</p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Hạng</th>
                  <th className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Nhân viên</th>
                  <th className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Phòng ban</th>
                  <th className="px-5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">GT còn lại</th>
                  <th className="px-5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">Tỷ lệ đi sớm</th>
                  <th className="px-5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">TB phút/ngày</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {attendanceRankings.map((entry, index) => {
                  const rankNum = entry.rank_early ?? index + 1;
                  const medal = RANK_MEDALS[rankNum - 1] ?? null;
                  return (
                    <tr
                      key={entry.employee_id}
                      className={rankNum <= 3 ? 'bg-amber-50/60' : 'hover:bg-slate-50'}
                    >
                      <td className="px-5 py-3 whitespace-nowrap">
                        {medal ? <span className="text-lg">{medal}</span> : <span className="text-xs font-bold text-gray-400">#{rankNum}</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="font-semibold text-gray-900">{entry.full_name}</p>
                        <p className="text-xs text-gray-400">{entry.employee_code}</p>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-gray-600">{entry.department ?? '—'}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-right text-primary-700 font-medium">
                        {entry.remaining_explanations ?? '—'}
                        {entry.max_explanations_per_month ? (
                          <span className="text-gray-400 font-normal">/{entry.max_explanations_per_month}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right font-bold text-amber-600">
                        {entry.early_ratio?.toFixed(1) ?? '0'}%
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right text-gray-500">{entry.avg_early_minutes?.toFixed(1) ?? '0'} phút</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">Thao tác nhanh</h2>
          <button onClick={() => navigate('/dashboard')} className="text-xs font-semibold text-primary-600 hover:text-primary-800 flex items-center gap-1">
            Dashboard <ArrowRightIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickActions.map((action, index) => (
            <button
              key={index}
              onClick={() => navigate(action.path)}
              className="flex flex-col items-center gap-3 p-3 sm:p-4 border border-gray-100 rounded-2xl hover:border-primary-200 hover:bg-primary-50 transition-all duration-200 group"
            >
              <div className={`h-11 w-11 ${action.color} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}>
                <action.icon className="h-5 w-5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">{action.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-snug">{action.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Recruitment Referral Section */}
      {(referralLoading || recruitmentNeeds.length > 0) && (
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl border border-purple-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-purple-500 rounded-xl flex items-center justify-center">
                <span className="text-lg">💡</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Cơ hội giới thiệu</h2>
                <p className="text-xs text-gray-600">Giới thiệu ứng viên tuyệt vời cho công ty</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/dashboard/recruitment/needs')}
              className="text-xs font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-1"
            >
              Xem thêm <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {referralLoading ? (
            <div className="flex items-center justify-center py-6 gap-3">
              <div className="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full" />
              <span className="text-sm text-gray-500">Đang tải...</span>
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {recruitmentNeeds.slice(0, 3).map((need: any) => (
                <div
                  key={need.id}
                  className="flex items-center justify-between p-3 bg-white rounded-xl border border-purple-200 hover:border-purple-300 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{need.position_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-600">{need.department_name || 'Đang cập nhật phòng ban'}</span>
                      <span className="text-xs text-purple-600 font-medium">• {need.headcount} vị trí</span>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/dashboard/recruitment/candidates?openReferral=1&referralNeed=${need.id}`)}
                    className="ml-3 flex-shrink-0 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Giới thiệu
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => navigate('/dashboard/recruitment/candidates?openReferral=1')}
            className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
          >
            <StarIcon className="h-4 w-4" />
            Giới thiệu ứng viên
          </button>
        </div>
      )}

      {/* Company Information Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 bg-primary-100 rounded-xl flex items-center justify-center">
            <BuildingOfficeIcon className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Thông tin công ty</h2>
            <p className="text-xs text-gray-400">Tài liệu, nội quy và quy trình nội bộ</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Tài liệu đào tạo', desc: 'Hướng dẫn nhân viên mới', path: '/company/training', color: 'bg-primary-100 text-primary-600',
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /> },
            { label: 'Nội quy lao động', desc: 'Quy định làm việc', path: '/company/labor-rules', color: 'bg-emerald-100 text-emerald-600',
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /> },
            { label: 'Mẫu giấy tờ', desc: 'Biểu mẫu nội bộ', path: '/company/internal-forms', color: 'bg-amber-100 text-amber-600',
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /> },
            { label: 'Quy trình làm việc', desc: 'Quy trình các bộ phận', path: '/company/work-procedures', color: 'bg-violet-100 text-violet-600',
              icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /> },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center gap-3 p-3 sm:p-4 border border-gray-100 rounded-2xl hover:border-primary-200 hover:bg-primary-50 transition-all duration-200 group"
            >
              <div className={`h-11 w-11 ${item.color} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{item.icon}</svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Liên kết nhanh</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Chính sách công ty', path: '/company/policies' },
              { label: 'Quyết định ban hành', path: '/company/decisions' },
              { label: 'Sơ đồ tổ chức', path: '/dashboard/organization-chart' },
            ].map((link) => (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-primary-50 hover:text-primary-700 border border-gray-100 hover:border-primary-200 rounded-lg transition-all"
              >
                {link.label}
                <ArrowRightIcon className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      </div>


      {/* Birthday Wish Modal */}
      {wishModal.open && wishModal.employee && createPortal(
        <div className="fixed inset-0 z-[9997] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-pink-100 rounded-full flex items-center justify-center">
                  <span className="text-xl">🎂</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Gửi lời chúc sinh nhật</h3>
                  <p className="text-sm text-gray-500">Tới: {wishModal.employee.full_name}</p>
                </div>
              </div>
              <button
                onClick={closeWishModal}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Lời chúc của bạn</label>
              <textarea
                value={wishMessage}
                onChange={(e) => setWishMessage(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-transparent resize-none"
                placeholder="Nhập lời chúc..."
              />
              {wishError && (
                <p className="mt-2 text-xs text-red-600">{wishError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-5 pb-5">
              <button
                onClick={closeWishModal}
                disabled={wishSending}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={sendWish}
                disabled={!wishMessage.trim() || wishSending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
                {wishSending ? 'Đang gửi...' : 'Gửi lời chúc'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Wishes List Modal */}
      {wishListModal.open && wishListModal.employee && createPortal(
        <div className="fixed inset-0 z-[9997] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-pink-100 rounded-full flex items-center justify-center">
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-pink-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Danh sách lời chúc</h3>
                  <p className="text-sm text-gray-500">{wishListModal.employee.full_name}</p>
                </div>
              </div>
              <button
                onClick={closeWishListModal}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {wishListModal.loading ? (
                <p className="text-sm text-gray-500 text-center py-4">Đang tải...</p>
              ) : wishListModal.wishes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">Chưa có lời chúc nào.</p>
              ) : (
                <ul className="space-y-3">
                  {wishListModal.wishes.map((wish) => (
                    <li key={wish.id} className="p-3 bg-pink-50 rounded-xl text-sm text-gray-700">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <div className="h-8 w-8 rounded-full flex-shrink-0 overflow-hidden bg-pink-200">
                            {wish.sender.avatar_url ? (
                              <img src={wish.sender.avatar_url} alt={wish.sender.full_name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center" style={{ backgroundColor: stringToColor(wish.sender.full_name) }}>
                                <span className="text-white text-xs font-bold">{getInitials(wish.sender.full_name)}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-pink-700 mb-1">{wish.sender.full_name}</p>
                            <p className="whitespace-pre-wrap">{wish.message}</p>
                          </div>
                        </div>
                        {wish.is_liked && (
                          <div
                            className="flex-shrink-0 group relative"
                            title={`Đã tim bởi ${wish.recipient.full_name}`}
                          >
                            <HeartIcon className="h-5 w-5 text-pink-500" />
                            <span className="pointer-events-none absolute right-0 top-6 z-10 hidden w-max rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block">
                              Đã tim bởi {wish.recipient.full_name}
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end px-5 pb-5">
              <button
                onClick={closeWishListModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Non-dismissable dialog: employee has fetched contracts but none are active */}
      {/* TEMPORARILY DISABLED
      {noActiveContractDialog && createPortal(
        <div className="fixed inset-0 z-[9997] flex items-center justify-center p-4 bg-black/70">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-5 flex items-center gap-3">
              <ExclamationTriangleIcon className="h-8 w-8 text-white flex-shrink-0" />
              <div>
                <h3 className="text-lg font-bold text-white">Hợp đồng đã hết hạn</h3>
                <p className="text-red-100 text-sm mt-0.5">Cần ký hợp đồng mới để tiếp tục sử dụng dịch vụ</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Hợp đồng lao động của bạn hiện <strong>không còn hiệu lực</strong>.
                Vui lòng liên hệ phòng HCNS để được ký hợp đồng mới hoặc gia hạn.
              </p>
              <p className="text-xs text-gray-400">
                Thông báo sẽ tự đóng sau khi hợp đồng được cập nhật.
              </p>
              {contractCheckFailed && (
                <p className="text-xs text-center text-red-500">
                  Vẫn chưa có hợp đồng hiệu lực. Hãy liên hệ HCNS và thử lại sau.
                </p>
              )}
            </div>
            <div className="px-6 pb-5">
              <button
                onClick={() => fetchMyContracts(true)}
                disabled={contractCheckLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {contractCheckLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Đang kiểm tra...
                  </>
                ) : (
                  <>
                    Tôi đã liên hệ HCNS — Kiểm tra lại
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      */}

      {/* Contract expiry alert dialog */}
      {showContractAlert && expiringContracts.length > 0 && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-t-2xl px-4 sm:px-6 py-5 flex items-start gap-3 sm:gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <BellAlertIcon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white">Cảnh báo hợp đồng sắp hết hạn</h3>
                <p className="text-sm text-white/80 mt-0.5">
                  {expiringContracts.filter(c => c.days <= 0).length > 0
                    ? `${expiringContracts.filter(c => c.days <= 0).length} hợp đồng đã hết hạn · ${expiringContracts.filter(c => c.days > 0).length} sắp hết hạn`
                    : `${expiringContracts.length} hợp đồng sắp hết hạn trong 5 ngày tới`
                  }
                </p>
              </div>
              <button
                onClick={dismissContractAlert}
                className="p-1.5 text-white/70 hover:text-white hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Contract list */}
            <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 space-y-2">
              {expiringContracts.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${c.days <= 0
                      ? 'bg-red-50 border-red-200'
                      : 'bg-orange-50 border-orange-200'
                    }`}
                >
                  <ExclamationTriangleIcon className={`w-5 h-5 flex-shrink-0 ${c.days <= 0 ? 'text-red-500' : 'text-orange-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.employee_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.contract_type_display}
                      {c.contract_number ? ` · ${c.contract_number}` : ''}
                      {c.end_date ? ` · HH: ${new Date(c.end_date).toLocaleDateString('vi-VN')}` : ''}
                    </p>
                  </div>
                  <span className={`text-xs font-bold whitespace-nowrap px-2.5 py-1 rounded-full ${c.days <= 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-orange-100 text-orange-700'
                    }`}>
                    {c.days <= 0 ? 'Đã hết hạn' : `Còn ${c.days} ngày`}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer actions */}
            <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={dismissContractAlert}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Không nhắc lại hôm nay
              </button>
              <button
                onClick={() => {
                  dismissContractAlert();
                  navigate('/dashboard/bulk-contracts');
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Xử lý ngay
                <ArrowRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {notePromptDialog}
    </div>
  );
};

export default Home;
