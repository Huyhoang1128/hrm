import React, { useEffect, useRef, useState } from 'react';
import { SelectBox, SelectOption } from '../components/LandingLayout/SelectBox';
import Pagination from '../components/Pagination';
import { useDebounce } from '../hooks/useDebounce';
import { employeesAPI } from '../utils/api';
import deadlineExceptionService, { DeadlineExceptionGrant, BlockingRequest } from '../services/deadlineException.service';
import {
  KeyIcon,
  TrashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  BoltIcon,
  ComputerDesktopIcon,
  CalendarDaysIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  VideoCameraIcon,
  BriefcaseIcon,
} from '@heroicons/react/24/outline';

// Lưu ý: CANCEL_EDIT là loại mở khoá RIÊNG BIỆT, không liên quan đến hạn
// tạo/duyệt đơn của 4 loại phía trên — mở khoá 1 trong 4 loại trên CHỈ cho
// phép tạo/duyệt đơn loại đó dù quá hạn, KHÔNG tự động cho phép huỷ/sửa đơn
// đã duyệt. Phải mở khoá RIÊNG "Huỷ/Sửa đơn đã duyệt" thì nhân sự mới tự
// huỷ/sửa được đơn NGÀY đó đã được quản lý trực tiếp duyệt (áp dụng chung
// cho mọi loại đơn của ngày đó, không cần chọn lại từng loại).
const REQUEST_TYPE_OPTIONS: SelectOption<string>[] = [
  { value: 'OVERTIME', label: 'Tăng ca' },
  { value: 'ONLINE_WORK', label: 'Làm việc online' },
  { value: 'LEAVE', label: 'Nghỉ phép tháng' },
  { value: 'UNAUTHORIZED_ABSENCE', label: 'Nghỉ không phép' },
  { value: 'LIVE', label: 'Livestream' },
  { value: 'BUSINESS_TRIP', label: 'Công tác' },
  { value: 'CA2', label: 'Đăng ký ca (Ca 1/Ca 2)' },
  { value: 'CANCEL_EDIT', label: 'Huỷ/Sửa đơn đã duyệt' },
];

const REQUEST_TYPE_ICON: Record<string, React.ElementType> = {
  OVERTIME: BoltIcon,
  ONLINE_WORK: ComputerDesktopIcon,
  LEAVE: CalendarDaysIcon,
  UNAUTHORIZED_ABSENCE: NoSymbolIcon,
  LIVE: VideoCameraIcon,
  BUSINESS_TRIP: BriefcaseIcon,
  CA2: ClockIcon,
  CANCEL_EDIT: PencilSquareIcon,
};

const REQUEST_TYPE_COLOR: Record<string, string> = {
  OVERTIME: 'bg-amber-50 text-amber-700 border-amber-200',
  ONLINE_WORK: 'bg-sky-50 text-sky-700 border-sky-200',
  LEAVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UNAUTHORIZED_ABSENCE: 'bg-red-50 text-red-700 border-red-200',
  LIVE: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  BUSINESS_TRIP: 'bg-teal-50 text-teal-700 border-teal-200',
  CA2: 'bg-violet-50 text-violet-700 border-violet-200',
  CANCEL_EDIT: 'bg-rose-50 text-rose-700 border-rose-200',
};

// Lý do hay gặp nhất — bấm để điền nhanh, vẫn sửa/gõ thêm tự do được.
const QUICK_NOTE_PRESETS = [
  'Ca mổ gấp phát sinh đột xuất',
  'Yêu cầu đột xuất từ Bác sĩ tại Viện',
  'Báo quản lý miệng nhưng quên tạo kịp trên HRM',
  'Sự cố hệ thống/mạng lúc tạo đơn',
];

const toYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const extractError = (err: any, fallback: string): string =>
  err?.response?.data?.error || err?.response?.data?.detail || fallback;

const requestTypeLabel = (t: string) => REQUEST_TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const Icon = REQUEST_TYPE_ICON[type] || KeyIcon;
  const color = REQUEST_TYPE_COLOR[type] || 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      <Icon className="h-3 w-3" /> {requestTypeLabel(type)}
    </span>
  );
};

const WorkRequestManagement: React.FC = () => {
  const [employees, setEmployees] = useState<SelectOption<number>[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  const [employeeId, setEmployeeId] = useState<number | 0>(0);
  const [eventDate, setEventDate] = useState<string>(toYMD(new Date()));
  const [requestType, setRequestType] = useState<string>('OVERTIME');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [grants, setGrants] = useState<DeadlineExceptionGrant[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(true);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const debouncedSearch = useDebounce(search, 400);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const fetchSeq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const data = await employeesAPI.list({ page_size: 5000, is_active: true });
        setEmployees(
          (data.results || []).map((emp: any) => ({
            value: emp.id,
            label: `${emp.full_name} (${emp.employee_id}) - ${emp.department?.name || ''}`,
          }))
        );
      } catch (err) {
        console.error('Lỗi tải danh sách nhân viên:', err);
      } finally {
        setLoadingEmployees(false);
      }
    })();
  }, []);

  const fetchGrants = async () => {
    const reqId = ++fetchSeq.current;
    setLoadingGrants(true);
    try {
      const data = await deadlineExceptionService.list({
        page: currentPage,
        page_size: itemsPerPage,
        request_type: typeFilter || undefined,
        search: debouncedSearch.trim() || undefined,
      });
      if (reqId !== fetchSeq.current) return;
      setGrants(data.results || []);
      setTotalCount(data.count || 0);
    } catch (err) {
      if (reqId !== fetchSeq.current) return;
      console.error('Lỗi tải danh sách mở khoá:', err);
    } finally {
      if (reqId === fetchSeq.current) setLoadingGrants(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, typeFilter]);

  useEffect(() => {
    fetchGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemsPerPage, debouncedSearch, typeFilter]);

  // Ngày đó đã có đơn cùng loại -> backend chặn (409). Giữ lại để hiện hộp xác
  // nhận: HCNS phải tick + nhập lý do mới mở khoá được. Chặn để tránh việc mở
  // khoá nhằm duyệt bù cho quản lý quên duyệt (HCNS 2026-10-10).
  const [blocking, setBlocking] = useState<BlockingRequest | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(false);

  // Đổi nhân viên/ngày/loại thì trạng thái chặn cũ không còn đúng nữa — phải
  // xoá, kẻo tick xác nhận của trường hợp này lại áp nhầm sang trường hợp khác.
  useEffect(() => {
    setBlocking(null);
    setOverrideChecked(false);
  }, [employeeId, eventDate, requestType]);

  const resetForm = () => {
    setEmployeeId(0);
    setEventDate(toYMD(new Date()));
    setRequestType('OVERTIME');
    setNote('');
    setBlocking(null);
    setOverrideChecked(false);
  };

  const handleSubmit = async () => {
    if (!employeeId || !eventDate || !requestType) {
      setMessage({ type: 'error', text: 'Vui lòng chọn đầy đủ nhân viên, ngày và loại đơn.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      if (blocking && overrideChecked && !note.trim()) {
        setMessage({ type: 'error', text: 'Phải nhập lý do khi vẫn mở khoá dù ngày đó đã có đơn.' });
        setSubmitting(false);
        return;
      }
      await deadlineExceptionService.create({
        employee_id: employeeId,
        event_date: eventDate,
        request_type: requestType as any,
        note,
        ...(blocking && overrideChecked ? { override_existing: true } : {}),
      });
      const empLabel = employees.find((e) => e.value === employeeId)?.label || '';
      const dateLabel = new Date(`${eventDate}T00:00:00`).toLocaleDateString('vi-VN');
      const canSelfServiceCancel = ['OVERTIME', 'ONLINE_WORK', 'LEAVE', 'UNAUTHORIZED_ABSENCE', 'LIVE', 'BUSINESS_TRIP', 'CANCEL_EDIT'].includes(requestType);
      setMessage({
        type: 'success',
        text: requestType === 'CANCEL_EDIT'
          ? `Đã mở khoá "Huỷ/Sửa đơn đã duyệt" cho ${empLabel} ngày ${dateLabel} — nhân viên có thể tự huỷ/đổi loại bất kỳ đơn nào đã duyệt của ngày này ngay bây giờ.`
          : canSelfServiceCancel
          ? `Đã mở khoá cho ${empLabel} — có thể tạo/duyệt/huỷ/đổi loại đơn "${requestTypeLabel(requestType)}" ngày ${dateLabel} ngay bây giờ.`
          : `Đã mở khoá cho ${empLabel} — có thể tạo/duyệt "${requestTypeLabel(requestType)}" ngày ${dateLabel} ngay bây giờ.`,
      });
      resetForm();
      fetchGrants();
    } catch (err: any) {
      // 409: ngày đó đã có đơn cùng loại -> hiện hộp xác nhận thay vì chỉ báo lỗi
      if (err?.response?.status === 409 && err?.response?.data?.code === 'EXISTING_REQUEST') {
        setBlocking(err.response.data.existing || null);
        setOverrideChecked(false);
        setMessage({ type: 'error', text: err.response.data.error || 'Ngày này đã có đơn cùng loại.' });
      } else {
        setMessage({ type: 'error', text: extractError(err, 'Mở khoá thất bại.') });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: number) => {
    setRevokingId(id);
    setConfirmRevokeId(null);
    try {
      await deadlineExceptionService.revoke(id);
      fetchGrants();
    } catch (err: any) {
      setMessage({ type: 'error', text: extractError(err, 'Thu hồi thất bại.') });
    } finally {
      setRevokingId(null);
    }
  };

  const today = toYMD(new Date());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý đơn</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mở khoá cho phép 1 nhân viên tạo/duyệt đơn dù đã quá hạn quy định (quy định thời hạn tạo/duyệt đơn) —
          dùng cho trường hợp phát sinh đột xuất (ca mổ gấp, quên tạo đơn kịp giờ...). Nhân viên/quản lý
          vẫn tự tạo/duyệt bình thường sau khi được mở khoá.
          {' '}Mở khoá 1 trong 6 loại Tăng ca/Làm việc online/Nghỉ phép tháng/Nghỉ không phép/Livestream/
          Công tác còn cho phép <strong>luôn</strong> chính nhân viên đó tự huỷ hoặc đổi loại đơn (Nghỉ
          phép tháng ⇄ Nghỉ không phép) đúng loại đó của đúng ngày này, kể cả khi đơn đã được quản lý trực
          tiếp duyệt — không cần mở thêm lần nữa, không cần HCNS thao tác hộ. Với các loại giải trình khác
          (đi muộn/về sớm/quên chấm công...) không có mục riêng ở trên: chọn loại
          <strong> "Huỷ/Sửa đơn đã duyệt"</strong> để cấp quyền tương tự.
        </p>
      </div>

      {/* Form mở khoá */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-4">
          <KeyIcon className="h-5 w-5 text-primary-600" />
          Mở khoá đặc biệt
        </div>

        {message && (
          <div
            className={`mb-4 flex items-center gap-2 text-sm rounded-xl px-3 py-2 border ${
              message.type === 'success'
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-red-700 bg-red-50 border-red-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
            ) : (
              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Nhân viên</label>
            <SelectBox<number>
              label=""
              value={employeeId}
              options={employees}
              onChange={setEmployeeId}
              placeholder={loadingEmployees ? 'Đang tải...' : 'Tìm theo tên hoặc mã nhân viên...'}
              searchable
              portal
              maxResults={5000}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Ngày áp dụng</label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Loại đơn</label>
            <SelectBox<string>
              label=""
              value={requestType}
              options={REQUEST_TYPE_OPTIONS}
              onChange={setRequestType}
              portal
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Lý do/ghi chú</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="VD: ca mổ gấp phát sinh tối 9/9"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {QUICK_NOTE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setNote(preset)}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/50 transition-colors"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Ngày đó đã có đơn cùng loại -> phải tick xác nhận + nhập lý do.
            Chặn để tránh mở khoá nhằm duyệt bù cho quản lý quên duyệt: mở xong
            duyệt lại thì lỗi "duyệt đơn quá hạn" của quản lý biến mất. */}
        {blocking && (
          <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">
              Ngày này đã có đơn cùng loại — {blocking.status_label.toLowerCase()}
              {blocking.request_code ? ` (${blocking.request_code})` : ''}
            </p>
            <p className="text-sm text-amber-800 mt-1">
              Mở khoá lúc này thường là để duyệt bù cho quản lý quên duyệt. Nếu thật sự
              cần (ví dụ quản lý ốm không duyệt được), tick xác nhận và nhập lý do.
            </p>
            {blocking.reason && (
              <p className="text-xs text-amber-700 mt-1">Lý do trên đơn: {blocking.reason}</p>
            )}
            <label className="flex items-start gap-2 mt-3 text-sm font-semibold text-amber-900 cursor-pointer">
              <input
                type="checkbox"
                checked={overrideChecked}
                onChange={(e) => setOverrideChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>Tôi xác nhận vẫn mở khoá dù đã có đơn</span>
            </label>
            {overrideChecked && !note.trim() && (
              <p className="text-xs font-semibold text-rose-700 mt-2">
                Bắt buộc nhập lý do ở ô "Ghi chú" phía trên trước khi mở khoá.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={handleSubmit}
            disabled={submitting || (!!blocking && (!overrideChecked || !note.trim()))}
            className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50"
          >
            {submitting ? 'Đang mở khoá...' : blocking ? 'Vẫn mở khoá' : 'Mở khoá'}
          </button>
        </div>
      </div>

      {/* Danh sách đã mở khoá */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <ClockIcon className="h-5 w-5 text-primary-600" />
            Lịch sử mở khoá {!loadingGrants && `(${totalCount})`}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên/mã NV..."
                className="text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 w-44 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              <option value="">Tất cả loại đơn</option>
              {REQUEST_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {loadingGrants ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : grants.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">
            {debouncedSearch.trim() || typeFilter ? 'Không tìm thấy kết quả phù hợp.' : 'Chưa có lượt mở khoá nào.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
                  <th className="px-4 py-3">Nhân viên</th>
                  <th className="px-4 py-3">Ngày áp dụng</th>
                  <th className="px-4 py-3">Loại đơn</th>
                  <th className="px-4 py-3">Ghi chú</th>
                  <th className="px-4 py-3">Người mở khoá</th>
                  <th className="px-4 py-3 text-center">Thu hồi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {grants.map((g) => {
                  const isToday = g.event_date === today;
                  const isPast = g.event_date < today;
                  return (
                    <tr key={g.id} className={`hover:bg-gray-50/60 ${g.revoked_at ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-gray-700">{g.employee_name}</div>
                        <div className="text-xs text-gray-400">{g.employee_code} · {g.department_name || '-'}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={isPast ? 'text-gray-400' : 'text-gray-700'}>
                          {new Date(`${g.event_date}T00:00:00`).toLocaleDateString('vi-VN')}
                        </span>
                        {isToday && (
                          <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-50 text-primary-600 align-middle">
                            Hôm nay
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><TypeBadge type={g.request_type} /></td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate" title={g.note}>{g.note || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">{g.granted_by_name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        {g.revoked_at ? (
                          <span
                            className="inline-block text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500"
                            title={`Thu hồi lúc ${new Date(g.revoked_at).toLocaleString('vi-VN')}${g.revoked_by_name ? ` bởi ${g.revoked_by_name}` : ''}`}
                          >
                            Đã thu hồi
                          </span>
                        ) : confirmRevokeId === g.id ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-xs text-gray-500">Chắc chắn?</span>
                            <button
                              onClick={() => handleRevoke(g.id)}
                              disabled={revokingId === g.id}
                              className="text-xs px-2 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {revokingId === g.id ? '...' : 'Thu hồi'}
                            </button>
                            <button
                              onClick={() => setConfirmRevokeId(null)}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                            >
                              Huỷ
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRevokeId(g.id)}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100"
                          >
                            <TrashIcon className="h-3.5 w-3.5" /> Thu hồi
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loadingGrants && totalCount > 0 && (
          <div className="px-5 py-4 border-t border-gray-100">
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(totalCount / itemsPerPage) || 1}
              totalItems={totalCount}
              itemsPerPage={itemsPerPage}
              onPageChange={(page: number) => setCurrentPage(page)}
              onItemsPerPageChange={(size: number) => { setItemsPerPage(size); setCurrentPage(1); }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkRequestManagement;
