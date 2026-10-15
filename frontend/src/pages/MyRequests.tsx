import React, { useEffect, useState } from 'react';
import {
  PlusIcon,
  ArrowPathIcon,
  CheckIcon,
  XMarkIcon,
  EyeIcon,
  PencilSquareIcon,
  TrashIcon,
  PaperAirplaneIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import Pagination from '../components/Pagination';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import { useDebounce } from '../hooks/useDebounce';
import { useAuth } from '../contexts/AuthContext';
import genericRequestService, {
  GenericRequest,
  GenericRequestStatus,
  GenericRequestType,
} from '../services/genericRequest.service';
import {
  AttendanceRequestRow,
  AttendanceRequestStatus,
  cancelAttendanceRequest,
  fetchMyAttendanceRequests,
  updateAttendanceRequestReason,
  hasEditableTimeRange,
} from '../services/myAttendanceRequests';
import { employeesAPI } from '@/utils/api';
import RequestFormDialog from '../components/MyRequests/RequestFormDialog';
import RequestDetailDialog from '../components/MyRequests/RequestDetailDialog';
import ApprovedNotificationDialog from '../components/MyRequests/ApprovedNotificationDialog';
import PdfPreviewModal from '../components/Common/PdfPreviewModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { EDIT_FIELD_LABELS, sortEditChanges, formatEditValue, countRealEditChanges } from '../utils/editHistory';

// localStorage key lưu danh sách ID đơn APPROVED mà NV đã xem thông báo
const SEEN_APPROVED_STORAGE_KEY = 'myrequests_seen_approved_ids';

const getSeenApprovedIds = (): number[] => {
  try {
    const raw = localStorage.getItem(SEEN_APPROVED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const addSeenApprovedId = (id: number): void => {
  try {
    const seen = getSeenApprovedIds();
    if (!seen.includes(id)) {
      seen.push(id);
      // Giới hạn 500 ID gần nhất để tránh bloat localStorage
      localStorage.setItem(
        SEEN_APPROVED_STORAGE_KEY,
        JSON.stringify(seen.slice(-500))
      );
    }
  } catch {
    /* ignore storage errors */
  }
};

const STATUS_LABELS: Record<GenericRequestStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_MANAGER: 'Chờ Quản lý duyệt',
  PENDING_ADMIN: 'Chờ HCNS duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

const STATUS_COLORS: Record<GenericRequestStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING_MANAGER: 'bg-amber-100 text-amber-800',
  PENDING_ADMIN: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-200 text-gray-600',
};

/** "20:30:00" | "20:30" -> "20:30" (giá trị cho <input type="time">). */
const toHHMM = (v: any): string => {
  if (!v) return '';
  const m = String(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

const formatDate = (s: string | null) => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('vi-VN');
  } catch {
    return s;
  }
};

/** Nhãn trạng thái cho đơn chấm công — chỉ 1 bước "Chờ duyệt", không tách 2 cấp. */
const ATT_STATUS_LABELS: Record<AttendanceRequestStatus, string> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

const ATT_STATUS_COLORS: Record<AttendanceRequestStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-200 text-gray-600',
};

/**
 * Giá trị bộ lọc "Loại đơn" cho nhóm đơn chấm công. Tiền tố ATT_ để phân biệt
 * hẳn với GenericRequestType — khi chọn 1 giá trị ATT_* thì KHÔNG gửi lên
 * endpoint generic-requests (param không hợp lệ) mà chỉ lọc ở FE.
 */
const ATT_TYPE_FILTERS = {
  ATT_EXPLANATION: 'explanation',
  ATT_LEAVE: 'leave',
  ATT_REGISTRATION: 'registration',
  ATT_ONLINE_WORK: 'online_work',
} as const;

type AttTypeFilter = keyof typeof ATT_TYPE_FILTERS;

type TypeFilter = GenericRequestType | AttTypeFilter | '';

const isAttTypeFilter = (v: TypeFilter): v is AttTypeFilter =>
  v !== '' && v in ATT_TYPE_FILTERS;

/** Trạng thái GenericRequest → trạng thái tương ứng của đơn chấm công. */
const GENERIC_TO_ATT_STATUS: Record<GenericRequestStatus, AttendanceRequestStatus> = {
  DRAFT: 'DRAFT',
  PENDING_MANAGER: 'PENDING',
  PENDING_ADMIN: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

/** Dòng trong bảng tab "Đơn của tôi" — trộn 2 nguồn đơn khác model. */
type UnifiedRow =
  | { kind: 'generic'; key: string; sortDate: string; generic: GenericRequest }
  | { kind: 'attendance'; key: string; sortDate: string; att: AttendanceRequestRow };

type TabKey = 'mine' | 'to-approve';

type ConfirmAction = 'submit' | 'cancel' | 'delete' | null;

const MyRequests: React.FC = () => {
  const { user } = useAuth();
  // Admin quản lý đơn qua trang Offboarding, không dùng tab "Cần tôi duyệt" ở MyRequests
  const userRole = (user?.role || '').toUpperCase();
  const isAdmin =
    userRole === 'ADMIN' ||
    !!user?.is_super_admin ||
    !!(user as any)?.is_superuser;
  // Tab "Cần tôi duyệt" hiển thị khi:
  //   - User là manager thực sự (có cấp dưới trực tiếp / trưởng phòng / vị trí quản lý), HOẶC
  //   - User là Admin/HR (cần duyệt cấp 2 cho các đơn nhóm GenericRequest, vd SALARY_ADVANCE).
  // Logic fetch + nút duyệt sẽ adapt theo role bên dưới.
  const isManagerOnly =
    !!user?.is_manager ||
    !!(user as any)?.employee_profile?.is_manager ||
    !!(user as any)?.hrm_user?.is_manager;
  const isManagerForTab = isManagerOnly || isAdmin;

  const [activeTab, setActiveTab] = useState<TabKey>('mine');
  const [requests, setRequests] = useState<GenericRequest[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  // Khởi tạo true: render ĐẦU TIÊN xảy ra trước khi effect fetch chạy, nếu để
  // false thì bảng loé lên "Chưa có đơn nào" rồi mới chuyển sang "Đang tải...".
  const [loading, setLoading] = useState(true);

  // Đơn chấm công (model EmployeeEvent) của chính mình — chỉ dùng ở tab
  // "Đơn của tôi", trộn chung bảng với đơn GenericRequest.
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRequestRow[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [myEmployeeId, setMyEmployeeId] = useState<number | null>(null);
  // employees/me đã trả lời chưa (kể cả lỗi) — để biết lúc nào được phép kết
  // luận "không có đơn" thay vì vẫn đang chờ có employee_id để gọi API.
  const [meResolved, setMeResolved] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState<TypeFilter>('');
  const [filterStatus, setFilterStatus] = useState<GenericRequestStatus | ''>('');
  const [filterMonth, setFilterMonth] = useState<number>(0);
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [filterSearch, setFilterSearch] = useState('');
  const debouncedSearch = useDebounce(filterSearch, 400);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Dialogs
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingRequest, setEditingRequest] = useState<GenericRequest | null>(null);
  const [detailRequest, setDetailRequest] = useState<GenericRequest | null>(null);
  const [previewRequest, setPreviewRequest] = useState<GenericRequest | null>(null);

  // Dialog thông báo đơn đã được duyệt (cho người tạo đơn)
  const [approvedNotifyTarget, setApprovedNotifyTarget] = useState<GenericRequest | null>(null);

  // Số đơn cần manager duyệt (badge tab "Cần tôi duyệt")
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  // Approval modals (Manager workflow)
  const [approveTarget, setApproveTarget] = useState<GenericRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<GenericRequest | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // ConfirmDialog state
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [confirmTarget, setConfirmTarget] = useState<GenericRequest | null>(null);

  // Thao tác trên đơn chấm công (Sửa lý do / Huỷ đơn / Xem chi tiết)
  const [attEditTarget, setAttEditTarget] = useState<AttendanceRequestRow | null>(null);
  const [attEditReason, setAttEditReason] = useState('');
  // Giờ bắt đầu/kết thúc — chỉ dùng cho đơn có khung giờ (tăng ca, làm thêm
  // giờ, trực tối, Live, ra trực). Trước 2026-09-23 modal này chỉ có mỗi ô
  // "Lý do" nên không sửa được giờ đơn tăng ca (HCNS báo).
  const [attEditStart, setAttEditStart] = useState('');
  const [attEditEnd, setAttEditEnd] = useState('');
  const [attCancelTarget, setAttCancelTarget] = useState<AttendanceRequestRow | null>(null);
  const [attCancelReason, setAttCancelReason] = useState('');
  const [attDetailTarget, setAttDetailTarget] = useState<AttendanceRequestRow | null>(null);
  const [attActionLoading, setAttActionLoading] = useState(false);
  const [attActionError, setAttActionError] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      // Tab "Đơn của tôi" → owner=me.
      // Tab "Cần tôi duyệt":
      //   - Admin/HR: KHÔNG filter owner (visible_q của BE auto thấy hết), status mặc định = PENDING_ADMIN
      //   - Manager thường: owner=subordinates, status mặc định = PENDING_MANAGER
      let owner: 'me' | 'subordinates' | undefined;
      let effectiveStatus: GenericRequestStatus | undefined;
      if (activeTab === 'to-approve') {
        if (isAdmin) {
          owner = undefined;
          effectiveStatus = (filterStatus as GenericRequestStatus) || 'PENDING_ADMIN';
        } else {
          owner = 'subordinates';
          effectiveStatus = (filterStatus as GenericRequestStatus) || 'PENDING_MANAGER';
        }
      } else {
        owner = 'me';
        effectiveStatus = (filterStatus as GenericRequestStatus) || undefined;
      }

      // Tab "Đơn của tôi" trộn 2 nguồn đơn nên phải phân trang ở FE — kéo 1
      // lần đủ lớn thay vì phân trang server (số đơn của 1 NV rất nhỏ).
      const isMine = activeTab === 'mine';

      const data = await genericRequestService.list({
        page: isMine ? 1 : currentPage,
        page_size: isMine ? 500 : itemsPerPage,
        owner,
        // filterType dạng ATT_* là loại đơn chấm công, không tồn tại ở
        // endpoint generic-requests → bỏ qua, chỉ lọc ở FE.
        request_type: isAttTypeFilter(filterType) ? undefined : filterType || undefined,
        status: effectiveStatus,
        month: filterMonth > 0 ? filterMonth : undefined,
        year: filterMonth > 0 ? filterYear : undefined,
        search: debouncedSearch.trim() || undefined,
      });
      setRequests(data.results || []);
      // Ở tab "Đơn của tôi", totalCount được tính lại từ danh sách đã trộn.
      if (!isMine) setTotalCount(data.count || 0);
    } catch (e) {
      console.error(e);
      alert('Không thể tải danh sách đơn. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  // employee_id để lọc đúng đơn chấm công của chính mình (các endpoint
  // EmployeeEvent nhận employee_id, không có khái niệm owner=me như generic).
  useEffect(() => {
    employeesAPI
      .me()
      .then((emp: any) => setMyEmployeeId(Number(emp?.id) || null))
      .catch(() => setMyEmployeeId(null))
      .finally(() => setMeResolved(true));
  }, []);

  const fetchAttendanceRows = async () => {
    if (activeTab !== 'mine' || !myEmployeeId) return;
    setAttendanceLoading(true);
    try {
      const rows = await fetchMyAttendanceRequests(myEmployeeId, {
        month: filterMonth > 0 ? filterMonth : undefined,
        year: filterMonth > 0 ? filterYear : undefined,
      });
      setAttendanceRows(rows);
    } finally {
      setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    // Tab "Đơn của tôi" phân trang ở FE (xem pagedRows) nên đổi trang / đổi số
    // dòng KHÔNG cần gọi lại API — ghim dep về 0 để tránh tải lại 500 đơn mỗi
    // lần bấm sang trang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    activeTab === 'to-approve' ? currentPage : 0,
    activeTab === 'to-approve' ? itemsPerPage : 0,
    filterType,
    filterStatus,
    filterMonth,
    filterYear,
    debouncedSearch,
  ]);

  useEffect(() => {
    if (activeTab !== 'mine') {
      setAttendanceRows([]);
      setAttendanceLoading(false);
      return;
    }
    // Chưa biết employee_id thì chưa gọi được API — giữ nguyên trạng thái
    // đang tải, trừ khi employees/me đã trả lời mà vẫn không có id (lỗi /
    // tài khoản không gắn nhân viên) thì dừng hẳn để bảng thoát "Đang tải...".
    if (!myEmployeeId) {
      if (meResolved) setAttendanceLoading(false);
      return;
    }
    fetchAttendanceRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, myEmployeeId, meResolved, filterMonth, filterYear]);

  // Fetch số đơn cần duyệt (badge tab "Cần tôi duyệt")
  const fetchPendingApprovalCount = async () => {
    if (!isManagerForTab) return;
    try {
      const data = await genericRequestService.list({
        owner: isAdmin ? undefined : 'subordinates',
        status: isAdmin ? 'PENDING_ADMIN' : 'PENDING_MANAGER',
        page: 1,
        page_size: 1,
      });
      setPendingApprovalCount(data.count || 0);
    } catch {
      /* silent fail - không critical */
    }
  };

  useEffect(() => {
    fetchPendingApprovalCount();
    // Re-fetch count mỗi khi requests thay đổi (sau khi duyệt xong 1 đơn thì count giảm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagerForTab, requests]);

  // Nếu user không phải manager qualified nhưng đang ở tab 'to-approve' → auto switch về 'mine'
  useEffect(() => {
    if (!isManagerForTab && activeTab === 'to-approve') {
      setActiveTab('mine');
    }
  }, [isManagerForTab, activeTab]);

  // Detect đơn APPROVED chưa từng thông báo cho NV → mở dialog.
  // Chỉ áp dụng ở tab 'mine' (đơn của chính mình) — manager không nhận.
  useEffect(() => {
    if (loading) return;
    if (activeTab !== 'mine') return;
    if (approvedNotifyTarget) return; // đã có dialog đang mở

    const seenIds = getSeenApprovedIds();
    const firstUnseen = requests.find(
      (r) => r.status === 'APPROVED' && !seenIds.includes(r.id)
    );
    if (firstUnseen) {
      setApprovedNotifyTarget(firstUnseen);
    }
  }, [requests, loading, activeTab, approvedNotifyTarget]);

  const handleCloseApprovedNotify = () => {
    if (approvedNotifyTarget) {
      addSeenApprovedId(approvedNotifyTarget.id);
    }
    setApprovedNotifyTarget(null);
    // useEffect sẽ tự re-run và check đơn APPROVED chưa seen tiếp theo
  };

  // Reset filter + page khi đổi tab
  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setFilterStatus('');
    // Bật cờ tải ngay khi đổi tab, tránh nhấp nháy bảng "thiếu đơn chấm công"
    // trong khoảng giữa lúc render lại và lúc effect fetch chạy.
    if (tab === 'mine') setAttendanceLoading(true);
  };

  const openCreate = () => {
    setEditingRequest(null);
    setShowFormDialog(true);
  };

  const openEdit = (req: GenericRequest) => {
    setEditingRequest(req);
    setShowFormDialog(true);
  };

  const handleSubmit = (req: GenericRequest) => {
    setConfirmTarget(req);
    setConfirmAction('submit');
  };

  const handleCancel = (req: GenericRequest) => {
    setConfirmTarget(req);
    setConfirmAction('cancel');
  };

  const handleDelete = (req: GenericRequest) => {
    setConfirmTarget(req);
    setConfirmAction('delete');
  };

  const handleConfirmAction = async () => {
    if (!confirmTarget || !confirmAction) return;
    const req = confirmTarget;
    setConfirmAction(null);
    setConfirmTarget(null);

    if (confirmAction === 'submit') {
      try {
        await genericRequestService.submit(req.id);
        await fetchRequests();
      } catch (e: any) {
        alert('Gửi đơn thất bại: ' + (e?.response?.data?.error || e?.message || 'Lỗi'));
      }
    } else if (confirmAction === 'cancel') {
      try {
        await genericRequestService.cancel(req.id);
        await fetchRequests();
      } catch (e: any) {
        alert('Huỷ đơn thất bại: ' + (e?.response?.data?.error || e?.message || 'Lỗi'));
      }
    } else if (confirmAction === 'delete') {
      try {
        await genericRequestService.remove(req.id);
        await fetchRequests();
      } catch (e: any) {
        alert('Xoá đơn thất bại: ' + (e?.response?.data?.detail || e?.message || 'Lỗi'));
      }
    }
  };

  const confirmManagerApprove = async () => {
    if (!approveTarget) return;
    setActionLoading(true);
    try {
      // Admin/HR duyệt cấp 2 (PENDING_ADMIN → APPROVED);
      // manager duyệt cấp 1 (PENDING_MANAGER → PENDING_ADMIN).
      // Phân loại theo status hiện tại của đơn để tránh sai chiều khi
      // 1 user vừa là manager vừa là admin.
      if (approveTarget.status === 'PENDING_ADMIN') {
        await genericRequestService.adminApprove(approveTarget.id, approvalNote);
      } else {
        await genericRequestService.managerApprove(approveTarget.id, approvalNote);
      }
      setApproveTarget(null);
      setApprovalNote('');
      await fetchRequests();
    } catch (e: any) {
      alert('Duyệt thất bại: ' + (e?.response?.data?.error || e?.message || 'Lỗi'));
    } finally {
      setActionLoading(false);
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    if (!approvalNote.trim()) {
      alert('Vui lòng nhập lý do từ chối.');
      return;
    }
    setActionLoading(true);
    try {
      await genericRequestService.reject(rejectTarget.id, approvalNote);
      setRejectTarget(null);
      setApprovalNote('');
      await fetchRequests();
    } catch (e: any) {
      alert('Từ chối thất bại: ' + (e?.response?.data?.error || e?.message || 'Lỗi'));
    } finally {
      setActionLoading(false);
    }
  };

  /** Làm mới cả 2 nguồn đơn (dùng cho nút "Làm mới" và sau mỗi thao tác). */
  const refreshAll = async () => {
    await Promise.all([fetchRequests(), fetchAttendanceRows()]);
  };

  const openAttEdit = (row: AttendanceRequestRow) => {
    setAttActionError(null);
    setAttEditReason(row.reason);
    setAttEditStart(toHHMM(row._raw?.start_time));
    setAttEditEnd(toHHMM(row._raw?.end_time));
    setAttEditTarget(row);
  };

  const openAttCancel = (row: AttendanceRequestRow) => {
    setAttActionError(null);
    setAttCancelReason('');
    setAttCancelTarget(row);
  };

  const handleAttEditSubmit = async () => {
    if (!attEditTarget) return;
    if (!attEditReason.trim()) {
      setAttActionError('Vui lòng nhập lý do.');
      return;
    }
    const editableTimes = hasEditableTimeRange(attEditTarget);
    if (editableTimes && (!attEditStart || !attEditEnd)) {
      setAttActionError('Vui lòng nhập đủ giờ bắt đầu và giờ kết thúc.');
      return;
    }
    setAttActionLoading(true);
    setAttActionError(null);
    try {
      await updateAttendanceRequestReason(
        attEditTarget,
        attEditReason.trim(),
        editableTimes ? { start_time: attEditStart, end_time: attEditEnd } : undefined,
      );
      setAttEditTarget(null);
      await refreshAll();
    } catch (e: any) {
      setAttActionError(
        e?.response?.data?.error ||
          e?.response?.data?.detail ||
          'Sửa đơn thất bại. Vui lòng thử lại.'
      );
    } finally {
      setAttActionLoading(false);
    }
  };

  const handleAttCancelSubmit = async () => {
    if (!attCancelTarget) return;
    setAttActionLoading(true);
    setAttActionError(null);
    try {
      await cancelAttendanceRequest(attCancelTarget, attCancelReason);
      setAttCancelTarget(null);
      await refreshAll();
    } catch (e: any) {
      setAttActionError(
        e?.response?.data?.error ||
          e?.response?.data?.detail ||
          'Huỷ đơn thất bại. Vui lòng thử lại.'
      );
    } finally {
      setAttActionLoading(false);
    }
  };

  // ===== Trộn đơn GenericRequest + đơn chấm công cho tab "Đơn của tôi" =====
  const unifiedRows: UnifiedRow[] = React.useMemo(() => {
    if (activeTab !== 'mine') return [];

    const rows: UnifiedRow[] = [];

    // Chọn loại đơn chấm công → ẩn hẳn đơn GenericRequest và ngược lại.
    if (!isAttTypeFilter(filterType)) {
      requests.forEach((r) =>
        rows.push({
          kind: 'generic',
          key: `g-${r.id}`,
          sortDate: r.created_at,
          generic: r,
        })
      );
    }

    if (filterType === '' || isAttTypeFilter(filterType)) {
      const wantKind = isAttTypeFilter(filterType) ? ATT_TYPE_FILTERS[filterType] : null;
      const wantStatus = filterStatus ? GENERIC_TO_ATT_STATUS[filterStatus] : null;
      const q = debouncedSearch.trim().toLowerCase();

      attendanceRows
        .filter((a) => (wantKind ? a._kind === wantKind : true))
        .filter((a) => (wantStatus ? a.status === wantStatus : true))
        // Endpoint đơn chấm công không có param search → lọc ở FE cho khớp
        // hành vi ô tìm kiếm dùng chung.
        .filter((a) =>
          q
            ? [a.request_code, a.type_label, a.reason]
                .filter(Boolean)
                .some((f) => String(f).toLowerCase().includes(q))
            : true
        )
        .forEach((a) =>
          rows.push({
            kind: 'attendance',
            key: `a-${a._kind}-${a.id}`,
            sortDate: a.created_at,
            att: a,
          })
        );
    }

    return rows.sort(
      (x, y) => new Date(y.sortDate || 0).getTime() - new Date(x.sortDate || 0).getTime()
    );
  }, [activeTab, requests, attendanceRows, filterType, filterStatus, debouncedSearch]);

  // Phân trang ở FE cho tab "Đơn của tôi" (2 nguồn không thể phân trang server).
  const pagedRows = React.useMemo(
    () => unifiedRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [unifiedRows, currentPage, itemsPerPage]
  );

  // Tab "Cần tôi duyệt" giữ nguyên phân trang server + chỉ có đơn GenericRequest.
  const rowsToRender: UnifiedRow[] =
    activeTab === 'to-approve'
      ? requests.map((r) => ({
          kind: 'generic' as const,
          key: `g-${r.id}`,
          sortDate: r.created_at,
          generic: r,
        }))
      : pagedRows;

  useEffect(() => {
    if (activeTab === 'mine') setTotalCount(unifiedRows.length);
  }, [activeTab, unifiedRows.length]);

  const hasFilter =
    filterType !== '' || filterStatus !== '' || filterMonth > 0 || filterSearch !== '';

  const resetFilters = () => {
    setFilterType('');
    setFilterStatus('');
    setFilterMonth(0);
    setFilterSearch('');
    setCurrentPage(1);
  };

  const getConfirmDialogProps = () => {
    if (!confirmAction || !confirmTarget) return null;
    if (confirmAction === 'submit') {
      return {
        title: 'Gửi đơn để duyệt',
        message: `Bạn có chắc muốn gửi đơn "${confirmTarget.title}" để duyệt?`,
      };
    }
    if (confirmAction === 'cancel') {
      return {
        title: 'Huỷ đơn',
        message: `Bạn có chắc muốn huỷ đơn "${confirmTarget.title}"?`,
      };
    }
    if (confirmAction === 'delete') {
      return {
        title: 'Xoá đơn nháp',
        message: `Bạn có chắc muốn xoá đơn nháp "${confirmTarget.title}"? Hành động này không thể hoàn tác.`,
      };
    }
    return null;
  };

  const confirmDialogProps = getConfirmDialogProps();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Yêu cầu & Đơn từ</h1>
          <p className="text-gray-600 mt-2">
            Tổng: <span className="font-semibold text-gray-900">{totalCount}</span> đơn
          </p>
        </div>
        {activeTab === 'mine' && (
          <button
            onClick={openCreate}
            className="btn-primary flex-shrink-0 flex items-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            Tạo đơn mới
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          <button
            onClick={() => handleTabChange('mine')}
            className={`py-3 px-1 border-b-2 text-sm font-semibold transition-colors ${
              activeTab === 'mine'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Đơn của tôi
          </button>
          {isManagerForTab && (
            <button
              onClick={() => handleTabChange('to-approve')}
              className={`py-3 px-1 border-b-2 text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === 'to-approve'
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Cần tôi duyệt
              {pendingApprovalCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-red-500 rounded-full">
                  {pendingApprovalCount > 99 ? '99+' : pendingApprovalCount}
                </span>
              )}
            </button>
          )}
        </nav>
      </div>

      {/* Filter bar */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-wrap items-end gap-3">
        <div className="w-52">
          <SelectBox
            label="Loại đơn"
            value={filterType}
            options={[
              { value: '', label: 'Tất cả loại đơn' },
              { value: 'RESIGNATION', label: 'Đơn xin nghỉ việc' },
              { value: 'PROPOSAL', label: 'Đơn đề xuất' },
              { value: 'CONFIRMATION', label: 'Đơn xác nhận' },
              { value: 'COMPLAINT', label: 'Đơn khiếu nại' },
              { value: 'OTHER', label: 'Đơn khác' },
              // Nhóm đơn chấm công chỉ có ở tab "Đơn của tôi" (tab duyệt vẫn
              // đi theo luồng duyệt riêng ở trang Duyệt đơn).
              ...(activeTab === 'mine'
                ? [
                    { value: 'ATT_EXPLANATION', label: '— Đơn giải trình' },
                    { value: 'ATT_LEAVE', label: '— Đơn nghỉ phép tháng' },
                    { value: 'ATT_REGISTRATION', label: '— Đơn đăng ký (tăng ca, trực tối...)' },
                    { value: 'ATT_ONLINE_WORK', label: '— Đơn làm việc online' },
                  ]
                : []),
            ]}
            onChange={(v) => { setFilterType(v as TypeFilter); setCurrentPage(1); }}
          />
        </div>
        <div className="w-52">
          <SelectBox
            label="Trạng thái"
            value={filterStatus}
            options={
              activeTab === 'to-approve'
                ? [
                    { value: 'PENDING_MANAGER', label: 'Chờ Quản lý duyệt' },
                    { value: '', label: 'Tất cả' },
                    { value: 'PENDING_ADMIN', label: 'Đã chuyển HCNS' },
                    { value: 'APPROVED', label: 'Đã duyệt' },
                    { value: 'REJECTED', label: 'Từ chối' },
                  ]
                : [
                    { value: '', label: 'Tất cả trạng thái' },
                    { value: 'DRAFT', label: 'Nháp' },
                    { value: 'PENDING_MANAGER', label: 'Chờ Quản lý duyệt' },
                    { value: 'PENDING_ADMIN', label: 'Chờ HCNS duyệt' },
                    { value: 'APPROVED', label: 'Đã duyệt' },
                    { value: 'REJECTED', label: 'Từ chối' },
                    { value: 'CANCELLED', label: 'Đã huỷ' },
                  ]
            }
            onChange={(v) => { setFilterStatus(v as GenericRequestStatus | ''); setCurrentPage(1); }}
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
            onChange={(v) => { setFilterMonth(Number(v)); setCurrentPage(1); }}
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
              onChange={(v) => { setFilterYear(Number(v)); setCurrentPage(1); }}
            />
          </div>
        )}
        <div className="relative">
          <label className="block text-sm font-medium mb-1 text-gray-700">Tìm kiếm</label>
          <div className="relative">
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => { setFilterSearch(e.target.value); setCurrentPage(1); }}
              placeholder="Tiêu đề, lý do, mã đơn..."
              className="input-field pl-9 w-60"
            />
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {hasFilter && (
          <button
            onClick={resetFilters}
            className="btn-secondary"
          >
            Xoá bộ lọc
          </button>
        )}

        <button
          onClick={refreshAll}
          disabled={loading || attendanceLoading}
          className="btn-secondary ml-auto flex items-center gap-1.5 disabled:opacity-50"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading || attendanceLoading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto w-full">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {(activeTab === 'to-approve'
                  ? ['Mã đơn', 'Người làm đơn', 'Phòng ban', 'Loại đơn', 'Ngày nghỉ dự kiến', 'Trạng thái', 'Ngày tạo', 'Thao tác']
                  : ['Mã đơn', 'Tiêu đề', 'Loại đơn', 'Ngày nghỉ dự kiến', 'Trạng thái', 'Ngày tạo', 'Thao tác']
                ).map((h) => (
                  <th key={h} className="table-header">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading || attendanceLoading ? (
                <tr>
                  <td colSpan={activeTab === 'to-approve' ? 8 : 7} className="px-6 py-12 text-center text-gray-500">
                    Đang tải...
                  </td>
                </tr>
              ) : rowsToRender.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'to-approve' ? 8 : 7} className="px-6 py-12 text-center text-gray-500">
                    {activeTab === 'to-approve'
                      ? 'Không có đơn nào cần bạn duyệt.'
                      : `Chưa có đơn nào${hasFilter ? ' khớp với bộ lọc' : ''}.`}
                  </td>
                </tr>
              ) : (
                rowsToRender.map((row) => {
                  // Đơn chấm công (EmployeeEvent) — cột/thao tác khác hẳn đơn
                  // GenericRequest nên render riêng.
                  if (row.kind === 'attendance') {
                    const a = row.att;
                    return (
                      <tr key={row.key} className="hover:bg-gray-50 transition-colors">
                        <td className="table-cell font-mono text-gray-700 whitespace-nowrap">
                          {a.request_code || '—'}
                        </td>
                        <td className="table-cell text-gray-900 max-w-xs truncate" title={a.reason}>
                          {a.reason || '—'}
                        </td>
                        <td className="table-cell text-gray-600 whitespace-nowrap">
                          {a.type_label}
                        </td>
                        <td className="table-cell text-gray-600 whitespace-nowrap">
                          {formatDate(a.applied_date)}
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${ATT_STATUS_COLORS[a.status]}`}>
                            {ATT_STATUS_LABELS[a.status]}
                          </span>
                        </td>
                        <td className="table-cell text-gray-600 whitespace-nowrap">
                          {formatDate(a.created_at)}
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Chỉ chủ đơn + đơn chưa qua bước duyệt mới Sửa/Huỷ
                                được — điều kiện do BE tính (can_self_cancel). */}
                            {a.can_self_cancel && (
                              <>
                                <button
                                  onClick={() => openAttEdit(a)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-primary-700 bg-white border border-primary-200 rounded-md shadow-sm hover:bg-primary-50 hover:border-primary-300 transition-all"
                                >
                                  <PencilSquareIcon className="w-3.5 h-3.5" />
                                  Sửa
                                </button>
                                <button
                                  onClick={() => openAttCancel(a)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-white border border-amber-200 rounded-md shadow-sm hover:bg-amber-50 hover:border-amber-300 transition-all"
                                >
                                  <XMarkIcon className="w-3.5 h-3.5" />
                                  Huỷ đơn
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setAttDetailTarget(a)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all"
                            >
                              <EyeIcon className="w-3.5 h-3.5" />
                              Chi tiết
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const req = row.generic;
                  return (
                  <tr key={row.key} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-mono text-gray-700 whitespace-nowrap">
                      {req.request_code || '—'}
                    </td>
                    {activeTab === 'to-approve' ? (
                      <>
                        <td className="table-cell whitespace-nowrap">
                          <div className="font-medium text-gray-900">{req.employee_name}</div>
                          <div className="text-xs text-gray-500 font-mono">{req.employee_code}</div>
                        </td>
                        <td className="table-cell text-gray-600 whitespace-nowrap">
                          {req.employee_department || '—'}
                        </td>
                      </>
                    ) : (
                      <td className="table-cell text-gray-900 max-w-xs truncate" title={req.title}>
                        {req.title}
                      </td>
                    )}
                    <td className="table-cell text-gray-600 whitespace-nowrap">
                      {req.request_type_display}
                    </td>
                    <td className="table-cell text-gray-600 whitespace-nowrap">
                      {formatDate(req.expected_date)}
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[req.status]}`}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="table-cell text-gray-600 whitespace-nowrap">
                      {formatDate(req.created_at)}
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Tab "Cần tôi duyệt": Duyệt + Từ chối lên đầu (ưu tiên action quan trọng).
                            Manager duyệt cấp 1 (PENDING_MANAGER); Admin/HR duyệt cấp 2 (PENDING_ADMIN). */}
                        {activeTab === 'to-approve' &&
                          ((req.status === 'PENDING_MANAGER' && !isAdmin) ||
                            (req.status === 'PENDING_ADMIN' && isAdmin)) && (
                          <>
                            <button
                              onClick={() => { setApproveTarget(req); setApprovalNote(''); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md shadow-sm hover:bg-emerald-700 hover:shadow transition-all"
                            >
                              <CheckIcon className="w-3.5 h-3.5" />
                              Duyệt
                            </button>
                            <button
                              onClick={() => { setRejectTarget(req); setApprovalNote(''); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700 hover:shadow transition-all"
                            >
                              <XMarkIcon className="w-3.5 h-3.5" />
                              Từ chối
                            </button>
                          </>
                        )}

                        {/* Tab "Đơn của tôi" - DRAFT: Sửa + Gửi duyệt + Xoá lên đầu */}
                        {activeTab === 'mine' && req.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => handleSubmit(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md shadow-sm hover:bg-emerald-700 hover:shadow transition-all"
                            >
                              <PaperAirplaneIcon className="w-3.5 h-3.5" />
                              Gửi duyệt
                            </button>
                            <button
                              onClick={() => openEdit(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-primary-700 bg-white border border-primary-200 rounded-md shadow-sm hover:bg-primary-50 hover:border-primary-300 transition-all"
                            >
                              <PencilSquareIcon className="w-3.5 h-3.5" />
                              Sửa
                            </button>
                            <button
                              onClick={() => handleDelete(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-md shadow-sm hover:bg-red-50 hover:border-red-300 transition-all"
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                              Xoá
                            </button>
                          </>
                        )}

                        {/* Tab "Đơn của tôi" - PENDING: nút Huỷ */}
                        {activeTab === 'mine' && req.status === 'PENDING_MANAGER' && (
                          <button
                            onClick={() => handleCancel(req)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-white border border-amber-200 rounded-md shadow-sm hover:bg-amber-50 hover:border-amber-300 transition-all"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                            Huỷ đơn
                          </button>
                        )}

                        {/* View buttons (Xem PDF + Chi tiết) — đẩy xuống cuối */}
                        {req.request_type === 'RESIGNATION' && (
                          <button
                            onClick={() => setPreviewRequest(req)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-violet-700 bg-white border border-violet-200 rounded-md shadow-sm hover:bg-violet-50 hover:border-violet-300 transition-all"
                          >
                            <DocumentTextIcon className="w-3.5 h-3.5" />
                            Xem PDF
                          </button>
                        )}
                        <button
                          onClick={() => setDetailRequest(req)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all"
                        >
                          <EyeIcon className="w-3.5 h-3.5" />
                          Chi tiết
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <Pagination
          currentPage={currentPage}
          totalPages={Math.ceil(totalCount / itemsPerPage) || 1}
          totalItems={totalCount}
          itemsPerPage={itemsPerPage}
          onPageChange={(page: number) => setCurrentPage(page)}
          onItemsPerPageChange={(size: number) => { setItemsPerPage(size); setCurrentPage(1); }}
        />
      </div>

      <RequestFormDialog
        open={showFormDialog}
        editing={editingRequest}
        onClose={() => setShowFormDialog(false)}
        onSaved={fetchRequests}
      />

      <RequestDetailDialog
        request={detailRequest}
        onClose={() => setDetailRequest(null)}
        onPreviewPdf={(r) => { setDetailRequest(null); setPreviewRequest(r); }}
      />

      {/* PDF preview modal cho đơn nghỉ việc */}
      <PdfPreviewModal
        open={!!previewRequest}
        title={previewRequest ? `Xem trước: ${previewRequest.title}` : 'Xem PDF'}
        loader={previewRequest ? () => genericRequestService.previewPdf(previewRequest.id) : null}
        downloadFilename={previewRequest ? `${previewRequest.request_code || 'don'}.pdf` : 'don.pdf'}
        onClose={() => setPreviewRequest(null)}
      />

      {/* Dialog thông báo đơn đã được duyệt (cho người tạo đơn) */}
      <ApprovedNotificationDialog
        request={approvedNotifyTarget}
        onClose={handleCloseApprovedNotify}
      />

      {/* ===== Modal Sửa lý do đơn chấm công ===== */}
      {attEditTarget && (
        <div className="fixed inset-0 z-[110] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-6">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75"
              onClick={() => !attActionLoading && setAttEditTarget(null)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-5">
              <h3 className="text-base font-bold text-gray-900 mb-1">Sửa đơn</h3>
              <p className="text-sm text-gray-500 mb-4">{attEditTarget.type_label}</p>
              {hasEditableTimeRange(attEditTarget) && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giờ bắt đầu</label>
                    <input
                      type="time"
                      value={attEditStart}
                      onChange={(e) => setAttEditStart(e.target.value)}
                      className="input-field w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giờ kết thúc</label>
                    <input
                      type="time"
                      value={attEditEnd}
                      onChange={(e) => setAttEditEnd(e.target.value)}
                      className="input-field w-full"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-gray-500">
                    Số giờ được tính lại tự động theo giờ bắt đầu/kết thúc mới.
                  </p>
                </div>
              )}
              <label className="block text-sm font-medium text-gray-700 mb-1">Lý do</label>
              <textarea
                rows={4}
                value={attEditReason}
                onChange={(e) => setAttEditReason(e.target.value)}
                className="input-field w-full"
                placeholder="Nhập lý do..."
              />
              {attActionError && (
                <p className="mt-2 text-sm text-red-600">{attActionError}</p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setAttEditTarget(null)}
                  disabled={attActionLoading}
                  className="btn-secondary disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  onClick={handleAttEditSubmit}
                  disabled={attActionLoading}
                  className="btn-primary disabled:opacity-50"
                >
                  {attActionLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal Huỷ đơn chấm công ===== */}
      {attCancelTarget && (
        <div className="fixed inset-0 z-[110] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-6">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75"
              onClick={() => !attActionLoading && setAttCancelTarget(null)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-5">
              <h3 className="text-base font-bold text-gray-900 mb-1">Huỷ đơn</h3>
              <p className="text-sm text-gray-600 mb-4">
                Bạn có chắc muốn huỷ {attCancelTarget.type_label.toLowerCase()}
                {attCancelTarget.request_code ? ` (${attCancelTarget.request_code})` : ''}?
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Lý do huỷ <span className="text-gray-400 font-normal">(không bắt buộc)</span>
              </label>
              <textarea
                rows={3}
                value={attCancelReason}
                onChange={(e) => setAttCancelReason(e.target.value)}
                className="input-field w-full"
                placeholder="Nhập lý do huỷ..."
              />
              {attActionError && (
                <p className="mt-2 text-sm text-red-600">{attActionError}</p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setAttCancelTarget(null)}
                  disabled={attActionLoading}
                  className="btn-secondary disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  onClick={handleAttCancelSubmit}
                  disabled={attActionLoading}
                  className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50"
                >
                  {attActionLoading ? 'Đang huỷ...' : 'Xác nhận huỷ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal Chi tiết đơn chấm công ===== */}
      {attDetailTarget && (
        <div className="fixed inset-0 z-[110] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-6">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75"
              onClick={() => setAttDetailTarget(null)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {attDetailTarget.type_label}
                  </h3>
                  {attDetailTarget.request_code && (
                    <p className="text-xs font-mono text-gray-500 mt-0.5">
                      {attDetailTarget.request_code}
                    </p>
                  )}
                </div>
                <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${ATT_STATUS_COLORS[attDetailTarget.status]}`}>
                  {ATT_STATUS_LABELS[attDetailTarget.status]}
                </span>
              </div>

              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Ngày áp dụng</dt>
                  <dd className="text-gray-900 font-medium">
                    {formatDate(attDetailTarget.applied_date)}
                  </dd>
                </div>
                {/* Đơn có khung giờ (tăng ca, trực tối, Live...) — đơn nghỉ
                    phép/nghỉ không phép/đổi ca không có nên ẩn hẳn. */}
                {(attDetailTarget._raw?.start_time || attDetailTarget._raw?.end_time) && (
                  <div>
                    <dt className="text-gray-500">Thời gian</dt>
                    <dd className="text-gray-900 font-medium">
                      {attDetailTarget._raw.start_time || '--'} — {attDetailTarget._raw.end_time || '--'}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-gray-500">Lý do</dt>
                  <dd className="text-gray-900 whitespace-pre-wrap">
                    {attDetailTarget.reason || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Ngày tạo</dt>
                  <dd className="text-gray-900">{formatDate(attDetailTarget.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Tiến trình duyệt</dt>
                  <dd className="text-gray-900">
                    {attDetailTarget._raw?.direct_manager_approved
                      ? `Quản lý trực tiếp: đã duyệt${attDetailTarget._raw?.direct_manager_approved_by_name ? ` (${attDetailTarget._raw.direct_manager_approved_by_name})` : ''}`
                      : 'Quản lý trực tiếp: chưa duyệt'}
                    <br />
                    {attDetailTarget._raw?.hr_approved
                      ? `HCNS: đã duyệt${attDetailTarget._raw?.hr_approved_by_name ? ` (${attDetailTarget._raw.hr_approved_by_name})` : ''}`
                      : 'HCNS: chưa duyệt'}
                  </dd>
                </div>

                {/* Lịch sử chỉnh sửa đơn — 2026-09-23 theo yêu cầu HCNS: audit
                    trail phải hiện ở MỌI màn có chi tiết đơn, không riêng trang
                    Phê duyệt. Dữ liệu từ data.edit_history (record_request_edit),
                    vừa được bổ sung vào API. */}
                {(attDetailTarget._raw?.edit_history?.length > 0) && (
                  <div>
                    <dt className="text-gray-500">Lịch sử chỉnh sửa</dt>
                    <dd className="text-gray-900 space-y-1.5 mt-1">
                      {[...attDetailTarget._raw.edit_history]
                        .filter((h: any) => countRealEditChanges(h.changes) > 0 || h.reset_to_pending)
                        .reverse().map((h: any, i: number) => (
                        <div key={i} className="text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2">
                          <div className="font-semibold text-gray-700">
                            {h.edited_by_name || 'Không rõ'}
                            <span className="font-normal text-gray-400"> · {new Date(h.edited_at).toLocaleString('vi-VN')}</span>
                          </div>
                          {sortEditChanges(h.changes).map(([field, val]: [string, any]) => (
                            <div key={field} className="text-gray-600">
                              {EDIT_FIELD_LABELS[field] || field}:{' '}
                              <span className="line-through text-rose-500">{formatEditValue(val?.old)}</span>
                              {' → '}
                              <span className="text-emerald-600 font-semibold">{formatEditValue(val?.new)}</span>
                            </div>
                          ))}
                          {h.reset_to_pending && (
                            <div className="text-amber-600 font-medium mt-0.5">Đã đưa về chờ HCNS duyệt lại</div>
                          )}
                        </div>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-5 flex justify-end">
                <button onClick={() => setAttDetailTarget(null)} className="btn-secondary">
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ConfirmDialog cho submit / cancel / delete */}
      {confirmDialogProps && (
        <ConfirmDialog
          open={!!confirmAction}
          title={confirmDialogProps.title}
          message={confirmDialogProps.message}
          onConfirm={handleConfirmAction}
          onClose={() => { setConfirmAction(null); setConfirmTarget(null); }}
        />
      )}

      {/* Modal Manager duyệt đơn */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Duyệt đơn</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600 mb-1">
                Bạn sẽ duyệt đơn <span className="font-medium">{approveTarget.title}</span> của{' '}
                <span className="font-medium">{approveTarget.employee_name}</span>.
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Sau khi bạn duyệt, đơn sẽ được chuyển lên Admin để xử lý cuối.
              </p>
              <textarea
                rows={3}
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder="Ghi chú (tuỳ chọn)..."
                className="input-field"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-2">
              <button
                onClick={() => { setApproveTarget(null); setApprovalNote(''); }}
                disabled={actionLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={confirmManagerApprove}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Đang duyệt...' : 'Xác nhận duyệt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal từ chối đơn */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Từ chối đơn</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600 mb-3">
                Từ chối đơn <span className="font-medium">{rejectTarget.title}</span> của{' '}
                <span className="font-medium">{rejectTarget.employee_name}</span>.
              </p>
              <textarea
                rows={3}
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder="Lý do từ chối (bắt buộc)..."
                className="input-field"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-2">
              <button
                onClick={() => { setRejectTarget(null); setApprovalNote(''); }}
                disabled={actionLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={confirmReject}
                disabled={actionLoading}
                className="btn-danger disabled:opacity-50"
              >
                {actionLoading ? 'Đang xử lý...' : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyRequests;
