import React, { useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  CalendarDaysIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import Pagination from '../components/Pagination';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import { useDebounce } from '../hooks/useDebounce';
import genericRequestService, {
  GenericRequest,
  GenericRequestStatus,
} from '../services/genericRequest.service';
import RequestFormDialog from '../components/MyRequests/RequestFormDialog';
import RequestDetailDialog from '../components/MyRequests/RequestDetailDialog';
import FeedbackDialog, { FeedbackVariant } from '../components/FeedbackDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import PdfPreviewModal from '../components/Common/PdfPreviewModal';

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
  PENDING_MANAGER: 'bg-amber-100 text-amber-600',
  PENDING_ADMIN: 'bg-amber-200 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-600',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-200 text-gray-600',
};

const formatDate = (s: string | null) => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('vi-VN');
  } catch {
    return s;
  }
};

const Offboarding: React.FC = () => {
  const [requests, setRequests] = useState<GenericRequest[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [filterStatus, setFilterStatus] = useState<GenericRequestStatus | ''>('PENDING_ADMIN');
  const [filterMonth, setFilterMonth] = useState<number>(0);
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [filterSearch, setFilterSearch] = useState('');
  const debouncedSearch = useDebounce(filterSearch, 400);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const [editingRequest, setEditingRequest] = useState<GenericRequest | null>(null);
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [detailRequest, setDetailRequest] = useState<GenericRequest | null>(null);
  const [previewRequest, setPreviewRequest] = useState<GenericRequest | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<GenericRequest | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [exporting, setExporting] = useState(false);

  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: FeedbackVariant;
    title: string;
    message?: string;
  }>({ open: false, variant: 'success', title: '' });

  const showFeedback = (variant: FeedbackVariant, title: string, message?: string) => {
    setFeedback({ open: true, variant, title, message });
  };
  const [approveTarget, setApproveTarget] = useState<GenericRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<GenericRequest | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [stats, setStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    resigned: 0,
    upcomingResign: 0,
  });

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = await genericRequestService.list({
        page: currentPage,
        page_size: itemsPerPage,
        request_type: 'RESIGNATION',
        status: filterStatus || undefined,
        month: filterMonth > 0 ? filterMonth : undefined,
        year: filterMonth > 0 ? filterYear : undefined,
        search: debouncedSearch.trim() || undefined,
      });
      setRequests(data.results || []);
      setTotalCount(data.count || 0);
    } catch (e) {
      console.error(e);
      alert('Không thể tải danh sách đơn. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const [pending, approved, rejected, resignedApproved] = await Promise.all([
        genericRequestService.list({ status: 'PENDING_ADMIN', request_type: 'RESIGNATION', page_size: 1 }),
        genericRequestService.list({ status: 'APPROVED', request_type: 'RESIGNATION', page_size: 1 }),
        genericRequestService.list({ status: 'REJECTED', request_type: 'RESIGNATION', page_size: 1 }),
        genericRequestService.list({
          status: 'APPROVED',
          request_type: 'RESIGNATION',
          page_size: 500,
        }),
      ]);

      const todayStr = new Date().toISOString().slice(0, 10);
      let resignedCount = 0;
      let upcomingCount = 0;
      (resignedApproved.results || []).forEach((r) => {
        if (!r.expected_date) return;
        if (r.expected_date <= todayStr) {
          resignedCount += 1;
        } else {
          upcomingCount += 1;
        }
      });

      setStats({
        pending: pending.count || 0,
        approved: approved.count || 0,
        rejected: rejected.count || 0,
        resigned: resignedCount,
        upcomingResign: upcomingCount,
      });
    } catch (e) {
      // silent fail
    }
  };

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemsPerPage, filterStatus, filterMonth, filterYear, debouncedSearch]);

  useEffect(() => {
    fetchStats();
  }, []);

  const openEdit = (req: GenericRequest) => {
    setEditingRequest(req);
    setShowFormDialog(true);
  };

  const handleDelete = (req: GenericRequest) => {
    setDeleteTarget(req);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await genericRequestService.remove(deleteTarget.id);
      const title = deleteTarget.title;
      setDeleteTarget(null);
      await fetchRequests();
      await fetchStats();
      showFeedback('success', 'Xoá đơn thành công', `Đơn "${title}" đã được xoá.`);
    } catch (e: any) {
      setDeleteTarget(null);
      showFeedback(
        'error',
        'Xoá đơn thất bại',
        e?.response?.data?.detail || e?.message || 'Có lỗi xảy ra khi xoá đơn.'
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExportResigned = async () => {
    setExporting(true);
    try {
      const data = await genericRequestService.list({
        status: 'APPROVED',
        request_type: 'RESIGNATION',
        page_size: 500,
      });

      const todayStr = new Date().toISOString().slice(0, 10);
      const rows = (data.results || []).filter(
        (r) => r.expected_date && r.expected_date <= todayStr
      );

      if (rows.length === 0) {
        showFeedback('info', 'Không có dữ liệu', 'Hiện chưa có nhân viên nào đã nghỉ việc để xuất.');
        return;
      }

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Đã nghỉ việc', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      sheet.columns = [
        { header: 'STT', key: 'stt', width: 6 },
        { header: 'Mã đơn', key: 'request_code', width: 18 },
        { header: 'Mã NV', key: 'employee_code', width: 14 },
        { header: 'Họ và tên', key: 'employee_name', width: 25 },
        { header: 'Chức vụ', key: 'position', width: 20 },
        { header: 'Phòng ban', key: 'department', width: 20 },
        { header: 'Ngày bắt đầu nghỉ', key: 'expected_date', width: 18 },
        { header: 'Ngày HCNS duyệt', key: 'approved_at', width: 18 },
        { header: 'Lý do', key: 'reason', width: 40 },
        { header: 'Người phê duyệt cuối', key: 'admin_approved_by_name', width: 22 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });

      const fmtDate = (iso: string | null) => {
        if (!iso) return '';
        const d = iso.slice(0, 10).split('-');
        return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
      };

      rows.forEach((req, idx) => {
        const row = sheet.addRow({
          stt: idx + 1,
          request_code: req.request_code || '',
          employee_code: req.employee_code || '',
          employee_name: req.employee_name || '',
          position: req.extra_data?.position_override || req.employee_position || '',
          department: req.extra_data?.department_override || req.employee_department || '',
          expected_date: fmtDate(req.expected_date),
          approved_at: fmtDate(req.approved_at),
          reason: req.reason || '',
          admin_approved_by_name: req.admin_approved_by_name || '',
        });
        row.eachCell((cell, colIdx) => {
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
          cell.alignment = { vertical: 'middle', horizontal: colIdx === 1 ? 'center' : 'left', wrapText: colIdx === 9 };
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `danh-sach-nghi-viec-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showFeedback('success', 'Xuất Excel thành công', `Đã xuất ${rows.length} nhân viên đã nghỉ việc.`);
    } catch (e: any) {
      showFeedback('error', 'Xuất Excel thất bại', e?.message || 'Có lỗi xảy ra khi tạo file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const confirmAdminApprove = async () => {
    if (!approveTarget) return;
    setActionLoading(true);
    try {
      await genericRequestService.adminApprove(approveTarget.id, approvalNote);
      setApproveTarget(null);
      setApprovalNote('');
      await fetchRequests();
      await fetchStats();
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
      await fetchStats();
    } catch (e: any) {
      alert('Từ chối thất bại: ' + (e?.response?.data?.error || e?.message || 'Lỗi'));
    } finally {
      setActionLoading(false);
    }
  };

  const hasFilter =
    filterStatus !== 'PENDING_ADMIN' || filterMonth > 0 || filterSearch !== '';

  const resetFilters = () => {
    setFilterStatus('PENDING_ADMIN');
    setFilterMonth(0);
    setFilterSearch('');
    setCurrentPage(1);
  };

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0">
      {/* Page header */}
      <div className="flex items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Offboard nhân sự</h1>
          <p className="text-sm text-gray-900 mt-0.5">
            Quản lý đơn nghỉ việc & yêu cầu offboard. Admin xử lý cuối sau khi Quản lý đã duyệt.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-amber-500 shadow-sm p-4">
          <div className="h-9 w-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center mb-2">
            <ClockIcon className="h-5 w-5" />
          </div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Chờ HCNS duyệt</p>
          <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.pending}</p>
          <p className="text-xs text-gray-400 mt-0.5">Cần xử lý</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-emerald-500 shadow-sm p-4">
          <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-2">
            <CheckCircleIcon className="h-5 w-5" />
          </div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đã duyệt</p>
          <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.approved}</p>
          <p className="text-xs text-gray-400 mt-0.5">Tổng số đã duyệt</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-red-500 shadow-sm p-4">
          <div className="h-9 w-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mb-2">
            <XCircleIcon className="h-5 w-5" />
          </div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Từ chối</p>
          <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.rejected}</p>
          <p className="text-xs text-gray-400 mt-0.5">Tổng số từ chối</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-gray-400 shadow-sm p-4 flex flex-col">
          <div className="h-9 w-9 bg-gray-100 text-gray-600 rounded-xl flex items-center justify-center mb-2">
            <UserGroupIcon className="h-5 w-5" />
          </div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Đã nghỉ việc</p>
          <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.resigned}</p>
          <p className="text-xs text-gray-400 mt-0.5">Ngày nghỉ ≤ hôm nay</p>
          {stats.resigned > 0 && (
            <button
              onClick={handleExportResigned}
              disabled={exporting}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 self-start"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              {exporting ? 'Đang xuất...' : 'Xuất Excel'}
            </button>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-primary-500 shadow-sm p-4">
          <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center mb-2">
            <CalendarDaysIcon className="h-5 w-5" />
          </div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Sắp nghỉ việc</p>
          <p className="text-2xl font-extrabold text-gray-900 tracking-tight mt-1">{stats.upcomingResign}</p>
          <p className="text-xs text-gray-400 mt-0.5">Ngày nghỉ &gt; hôm nay</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Đơn nghỉ việc & yêu cầu cần xử lý</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tổng: {totalCount} đơn</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="w-52">
            <SelectBox
              label="Trạng thái"
              value={filterStatus}
              options={[
                { value: 'PENDING_ADMIN', label: 'Chờ HCNS duyệt' },
                { value: '', label: 'Tất cả' },
                { value: 'APPROVED', label: 'Đã duyệt' },
                { value: 'REJECTED', label: 'Từ chối' },
                { value: 'CANCELLED', label: 'Đã huỷ' },
              ]}
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
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-500">Tìm kiếm</label>
            <div className="relative">
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => { setFilterSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Tên NV, mã đơn, lý do..."
                className="input-field pl-8 w-60"
              />
              <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {hasFilter && (
            <button onClick={resetFilters} className="btn-secondary">
              Đặt lại bộ lọc
            </button>
          )}

          <button
            onClick={() => { fetchRequests(); fetchStats(); }}
            disabled={loading}
            className="ml-auto btn-secondary flex items-center gap-1.5 disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>

        {/* Table */}
        <div className="border border-gray-100 rounded-2xl overflow-x-auto w-full flex-1 min-h-0">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Mã đơn', 'Nhân viên', 'Phòng ban', 'Loại đơn', 'Ngày nghỉ dự kiến', 'Manager duyệt', 'Trạng thái', 'Thao tác'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">Đang tải...</td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400 ">
                    Không có đơn nào{hasFilter ? ' khớp với bộ lọc' : ''}.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-gray-700 whitespace-nowrap">
                      {req.request_code || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      {req.employee_name}
                      <div className="text-xs text-gray-400 font-mono">{req.employee_code}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {req.employee_department || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {req.request_type_display}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(req.expected_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {req.manager_approved_by_name ? (
                        <>
                          <div>{req.manager_approved_by_name}</div>
                          <div className="text-xs text-gray-400">{formatDate(req.manager_approved_at)}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[req.status]}`}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {req.status === 'PENDING_ADMIN' && (
                          <>
                            <button
                              onClick={() => { setApproveTarget(req); setApprovalNote(''); }}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 border border-emerald-600 rounded-lg hover:bg-emerald-700"
                            >
                              Duyệt
                            </button>
                            <button
                              onClick={() => { setRejectTarget(req); setApprovalNote(''); }}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 border border-red-600 rounded-lg hover:bg-red-700"
                            >
                              Từ chối
                            </button>
                            <button
                              onClick={() => openEdit(req)}
                              className="px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50"
                            >
                              Sửa
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => handleDelete(req)}
                          className="px-2.5 py-1 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50"
                        >
                          Xoá
                        </button>

                        {req.request_type === 'RESIGNATION' && (
                          <button
                            onClick={() => setPreviewRequest(req)}
                            className="px-2.5 py-1 text-xs font-medium text-violet-700 bg-white border border-violet-200 rounded-lg hover:bg-violet-50"
                          >
                            Xem PDF
                          </button>
                        )}
                        <button
                          onClick={() => setDetailRequest(req)}
                          className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                        >
                          Chi tiết
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(totalCount / itemsPerPage) || 1}
            totalItems={totalCount}
            itemsPerPage={itemsPerPage}
            onPageChange={(page: number) => setCurrentPage(page)}
            onItemsPerPageChange={(size: number) => { setItemsPerPage(size); setCurrentPage(1); }}
          />
        </div>
      </div>

      <RequestFormDialog
        open={showFormDialog}
        editing={editingRequest}
        editMode="admin"
        onClose={() => setShowFormDialog(false)}
        onSaved={fetchRequests}
      />

      <RequestDetailDialog
        request={detailRequest}
        onClose={() => setDetailRequest(null)}
        onPreviewPdf={(r) => { setDetailRequest(null); setPreviewRequest(r); }}
      />

      <PdfPreviewModal
        open={!!previewRequest}
        title={previewRequest ? `Xem trước: ${previewRequest.title}` : 'Xem PDF'}
        loader={previewRequest ? () => genericRequestService.previewPdf(previewRequest.id) : null}
        downloadFilename={previewRequest ? `${previewRequest.request_code || 'don'}.pdf` : 'don.pdf'}
        onClose={() => setPreviewRequest(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title="Xoá đơn"
        message={
          deleteTarget
            ? `Bạn có chắc muốn xoá đơn "${deleteTarget.title}" (mã ${deleteTarget.request_code || 'N/A'})? Đơn sẽ bị đánh dấu xoá và không hiển thị nữa.`
            : undefined
        }
        confirmLabel="Xoá"
        cancelLabel="Huỷ"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <FeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback((f) => ({ ...f, open: false }))}
      />

      {/* Modal Admin duyệt cuối */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Duyệt đơn (HCNS)</h3>
            <p className="text-sm text-gray-600 mb-1">
              Bạn sẽ duyệt cuối đơn <span className="font-medium">{approveTarget.title}</span> của{' '}
              <span className="font-medium">{approveTarget.employee_name}</span>.
            </p>
            <p className="text-xs text-gray-400 mb-3">
              Đơn sau khi duyệt sẽ chuyển sang trạng thái "Đã duyệt" và có hiệu lực.
            </p>
            <textarea
              rows={3}
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="Ghi chú (tuỳ chọn)..."
              className="input-field"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setApproveTarget(null); setApprovalNote(''); }}
                disabled={actionLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                onClick={confirmAdminApprove}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50"
              >
                {actionLoading ? 'Đang duyệt...' : 'Xác nhận duyệt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal từ chối */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Từ chối đơn (Admin)</h3>
            <p className="text-sm text-gray-600 mb-3">
              Từ chối đơn <span className="font-medium">{rejectTarget.title}</span> của{' '}
              <span className="font-medium">{rejectTarget.employee_name}</span>.
            </p>
            <textarea
              rows={3}
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="Lý do từ chối (bắt buộc)..."
              className="input-field border-red-200 focus:ring-red-400"
            />
            <div className="flex justify-end gap-2 mt-4">
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

export default Offboarding;
