import React, { useEffect, useMemo, useRef, useState } from 'react';
import { salaryService, type PenaltyRecord } from '../services/salary.service';
import { employeesAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const now = new Date();
const SEARCH_DEBOUNCE_MS = 250;
const PENALTY_AMOUNT_OPTIONS = [50000, 100000, 200000, 500000];
const PENALTY_REASON_OPTIONS = [
  'Báo cáo muộn',
  'Báo cáo livestream',
  'Không chăm pro5 bác sĩ',
  'Không chăm tiktok bác sĩ',
  'Không chăm group khách hàng',
  'Không điền báo cáo chăm khách fail',
  'Sử dụng hình ảnh khách hàng',
  'Sử dụng tài khoản ảo',
  'Update ảnh feedback chăm sóc khách hàng',
  'Update link thông tin lên nobi',
  'Không note link bài ads',
  'Bàn giao livestream',
  'Vi phạm tuân thủ luật quảng cáo',
  'Sử dụng tài khoản hacklike',
  'Nguyên tắc xây dựng thương hiệu',
  'Nhầm/sai thông tin thương hiệu bác sĩ',
  'Chậm/ không hoàn thành deadline',
  'Không update link final',
  'Không update hình ảnh khách hàng lên app',
  'Không mặc đồng phục',
  'Sai tên camp',
  'Không note bài test ads mess',
  'Không trả link sản phẩm',
  'Không chăm blog tick xanh',
  'Lỗi đăng ảnh/ logo',
];

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();

const normalizeAmountValue = (value: string) => value.replace(/,/g, '').trim();
const formatCurrency = (value: number) => `${value.toLocaleString('vi-VN')} ₫`;
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type GroupedPenaltySummary = {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  totalAmount: number;
  records: PenaltyRecord[];
  reasons: string[];
};

const DisciplinaryPenaltyManagement: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_super_admin || (user as any)?.is_superuser || user?.role?.toUpperCase() === 'ADMIN');
  const hasPenaltyPermission = isAdmin || user?.employee_permission?.can_manage_disciplinary_penalties === true;

  const [employees, setEmployees] = useState<any[]>([]);
  const [records, setRecords] = useState<PenaltyRecord[]>([]);

  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [selectedEmployeeLabel, setSelectedEmployeeLabel] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const employeeDropdownRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  const filteredEmployees = useMemo(() => {
    const keyword = normalizeText(employeeSearch);
    if (!keyword) return employees;

    return employees.filter((employee) => {
      const fullName = normalizeText(String(employee.full_name || ''));
      const employeeCode = normalizeText(String(employee.employee_id || ''));
      return fullName.includes(keyword) || employeeCode.includes(keyword);
    });
  }, [employees, employeeSearch]);

  const groupedPenaltySummaries = useMemo<GroupedPenaltySummary[]>(() => {
    const groups = new Map<number, GroupedPenaltySummary>();

    records.forEach((record) => {
      if (!record?.employee) return;

      const existing = groups.get(record.employee);
      const recordAmount = Number(record.amount || 0);
      const recordReason = String(record.reason || '').trim();

      if (existing) {
        existing.totalAmount += Number.isFinite(recordAmount) ? recordAmount : 0;
        existing.records.push(record);
        if (recordReason && !existing.reasons.includes(recordReason)) {
          existing.reasons.push(recordReason);
        }
        return;
      }

      groups.set(record.employee, {
        employeeId: record.employee,
        employeeName: record.employee_name,
        employeeCode: record.employee_code,
        totalAmount: Number.isFinite(recordAmount) ? recordAmount : 0,
        records: [record],
        reasons: recordReason ? [recordReason] : [],
      });
    });

    return Array.from(groups.values()).sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'vi'));
  }, [records]);

  const totalGroupedAmount = useMemo(
    () => groupedPenaltySummaries.reduce((sum, item) => sum + item.totalAmount, 0),
    [groupedPenaltySummaries],
  );

  const loadEmployees = async (searchKeyword = '') => {
    setEmployeeLoading(true);
    try {
      const keyword = searchKeyword.trim();
      const response = await employeesAPI.list({
        page_size: keyword ? 50 : 200,
        is_active: true,
        search: keyword || undefined,
      });
      setEmployees(response.results || []);
    } catch {
      setEmployees([]);
    } finally {
      setEmployeeLoading(false);
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await salaryService.listPenalties({ year, month });
      setRecords(data);
    } catch {
      setError('Không thể tải danh sách phạt biên bản.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasPenaltyPermission) return;

    const debounceTimer = window.setTimeout(() => {
      loadEmployees(employeeSearch);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(debounceTimer);
  }, [hasPenaltyPermission, employeeSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(event.target as Node)) {
        setShowEmployeeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!hasPenaltyPermission) return;
    loadRecords();
  }, [year, month, hasPenaltyPermission]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsedAmount = Number(normalizeAmountValue(amount));
    if (!employeeId) {
      setError('Vui lòng chọn nhân sự.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Số tiền phạt phải lớn hơn 0.');
      return;
    }

    setSubmitting(true);
    try {
      await salaryService.createPenalty({
        employee: Number(employeeId),
        year,
        month,
        amount: parsedAmount,
        reason,
        notes,
      });
      setAmount('');
      setReason('');
      setNotes('');
      setSuccess('Đã ghi nhận biên bản phạt thành công.');
      await loadRecords();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setError(apiMessage || 'Không thể tạo biên bản phạt.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    const confirmed = window.confirm('Bạn có chắc chắn muốn xóa biên bản phạt này?');
    if (!confirmed) return;

    try {
      await salaryService.deletePenalty(id);
      await loadRecords();
    } catch {
      setError('Không thể xóa biên bản phạt.');
    }
  };

  const handleFinalizeMonth = async () => {
    const confirmed = window.confirm(`Chốt toàn bộ biên bản phạt tháng ${month}/${year}?`);
    if (!confirmed) return;

    setFinalizing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await salaryService.finalizePenaltyMonth(year, month);
      setSuccess(result?.message || `Đã chốt ${result?.updated ?? 0} biên bản phạt.`);
      await loadRecords();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.error || err?.response?.data?.detail || err?.response?.data?.message;
      setError(apiMessage || 'Không thể chốt biên bản phạt tháng này.');
    } finally {
      setFinalizing(false);
    }
  };

  const getStatusLabel = (status?: string) => {
    if (status === 'APPROVED') return 'Đã duyệt';
    if (status === 'REJECTED') return 'Từ chối';
    return 'Chờ duyệt';
  };

  const getStatusClassName = (status?: string) => {
    if (status === 'APPROVED') return 'bg-emerald-100 text-emerald-700';
    if (status === 'REJECTED') return 'bg-red-100 text-red-700';
    return 'bg-amber-100 text-amber-700';
  };

  const startEdit = (record: PenaltyRecord) => {
    setEditingId(record.id);
    setEditAmount(String(Number(record.amount || 0)));
    setEditReason(record.reason || '');
    setEditNotes(record.notes || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
    setEditReason('');
    setEditNotes('');
  };

  const handleSaveEdit = async (record: PenaltyRecord) => {
    const parsedAmount = Number(normalizeAmountValue(editAmount));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Số tiền phạt phải lớn hơn 0.');
      return;
    }

    if (record.status === 'APPROVED') {
      setError('Biên bản đã duyệt không thể chỉnh sửa.');
      return;
    }

    setSavingId(record.id);
    setError(null);
    setSuccess(null);
    try {
      await salaryService.updatePenalty(record.id, {
        amount: parsedAmount,
        reason: editReason,
        notes: editNotes || undefined,
      });
      setSuccess('Đã cập nhật biên bản phạt.');
      cancelEdit();
      await loadRecords();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.detail || err?.response?.data?.message;
      setError(apiMessage || 'Không thể cập nhật biên bản phạt.');
    } finally {
      setSavingId(null);
    }
  };

  const handleEmployeeSearchChange = (value: string) => {
    setEmployeeSearch(value);
    setSelectedEmployeeLabel('');
    setEmployeeId('');
    setShowEmployeeDropdown(true);
  };

  const handleSelectEmployee = (employee: any) => {
    const label = `${employee.employee_id} - ${employee.full_name}`;
    setEmployeeId(String(employee.id));
    setSelectedEmployeeLabel(label);
    setEmployeeSearch(label);
    setShowEmployeeDropdown(false);
  };

  const normalizedAmount = normalizeAmountValue(amount);

  const openPrintPreview = () => {
    if (groupedPenaltySummaries.length === 0) {
      setError('Chưa có dữ liệu phạt để in biên bản.');
      return;
    }

    setError(null);
    setShowPrintPreview(true);
  };

  const handlePrintPenaltySummary = (
    groups: GroupedPenaltySummary[] = groupedPenaltySummaries,
    _documentTitle = `Biên bản tổng hợp phạt tháng ${month}/${year}`,
  ) => {
    if (groups.length === 0) {
      setError('Chưa có dữ liệu phạt để in biên bản.');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
      setError('Không thể mở cửa sổ in. Vui lòng kiểm tra chặn pop-up của trình duyệt.');
      return;
    }

    const printDate = new Date();
    const day = String(printDate.getDate()).padStart(2, '0');
    const printMonth = String(printDate.getMonth() + 1).padStart(2, '0');
    const printYear = printDate.getFullYear();
    const shortDate = `${day}/${printMonth}/${printYear}`;
    const formsHtml = groups.map((group) => {
      const firstRecord = group.records[0];
      const companyUnitName = firstRecord?.company_unit_name?.trim() || 'ĐƠN VỊ CHƯA CẬP NHẬT';
      const legalCompanyName = companyUnitName === 'ĐƠN VỊ CHƯA CẬP NHẬT'
        ? companyUnitName
        : companyUnitName.toLocaleUpperCase('vi-VN');
      const legalCompanyHeader = escapeHtml(legalCompanyName);
      const creatorNames = Array.from(new Set(
        group.records
          .map((record) => record.created_by_name?.trim())
          .filter((name): name is string => Boolean(name)),
      ));
      const creatorName = creatorNames.join(', ');
      const densityClass = group.records.length >= 7
        ? ' ultra-compact'
        : group.records.length >= 4
          ? ' compact'
          : '';
      const recordNumber = group.records.length === 1
        ? String(firstRecord.id).padStart(5, '0')
        : `${String(month).padStart(2, '0')}/${year}-${group.employeeCode || group.employeeId}`;

      const detailRows = group.records.map((record, index) => {
        const violationDate = record.created_at ? new Date(record.created_at) : printDate;
        const validDate = !Number.isNaN(violationDate.getTime()) ? violationDate : printDate;
        const recordDate = `${validDate.getDate()}/${validDate.getMonth() + 1}`;
        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td class="center">${escapeHtml(record.department_name || '')}</td>
            <td class="center nowrap">${recordDate}</td>
            <td></td>
            <td class="center">${escapeHtml(group.employeeName)}</td>
            <td>${escapeHtml(record.reason || 'Không có lý do')}</td>
            <td class="center nowrap">${Number(record.amount || 0).toLocaleString('vi-VN')}</td>
          </tr>`;
      }).join('');

      const notes = group.records.map((record) => record.notes?.trim()).filter(Boolean);
      const notesHtml = notes.length > 0
        ? `<p class="custom-notes">${notes.map((note) => escapeHtml(note!)).join('<br>')}</p>`
        : '';

      return `
        <section class="form-page${densityClass}">
          <div class="official-header">
            <div class="company">
              <strong>${legalCompanyHeader}</strong>
              <div class="divider">-------❖-------</div>
              <div>Số: ${escapeHtml(recordNumber)}/BBXP</div>
            </div>
            <div class="nation">
              <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong>
              <div class="motto">Độc lập – Tự do – Hạnh phúc</div>
            </div>
          </div>

          <h1>BIÊN BẢN XỬ LÝ VI PHẠM</h1>
          <p>Hôm nay, ngày ${day} tháng ${printMonth} năm ${printYear}, tại ${escapeHtml(legalCompanyName)}, chúng tôi gồm:</p>

          <div class="party"><strong>1. Người lập biên bản:</strong></div>
          <div class="party-detail"><span>Họ và tên: ${escapeHtml(creatorName)}</span><span>Chức vụ: ............................................</span></div>
          <div class="party"><strong>2. Người chịu trách nhiệm thi hành:</strong></div>
          <div class="party-detail"><span>Họ và tên: ${escapeHtml(group.employeeName)}</span><span>Chức vụ: ........................ – Mã NV: ${escapeHtml(group.employeeCode || '')}</span></div>

          <h2>TỔNG HỢP LỖI PHẠT CƠ SỞ:</h2>
          <table class="violations">
            <thead><tr>
              <th>STT</th><th>Phòng ban</th><th>Ngày</th><th>Team bác sĩ</th><th>Người vi phạm</th><th>Lỗi vi phạm</th><th>Mức xử lý (VNĐ)</th>
            </tr></thead>
            <tbody>
              ${detailRows}
              <tr class="total-row"><td colspan="6">Tổng</td><td class="center">${group.totalAmount.toLocaleString('vi-VN')}</td></tr>
            </tbody>
          </table>

          <div class="notes">
            <strong><em>Ghi chú:</em></strong>
            ${notesHtml}
            <p>- Nhân sự vi phạm kí và gửi biên bản cho giám sát nội bộ của công ty.</p>
            <p>- Thời gian hoàn thành biên bản: trước 17h30 ngày ${shortDate}</p>
            <p>- Biên bản phải có đủ chữ ký xác nhận của các bên.</p>
          </div>

          <div class="location-date"><em>Hà Nội, ngày ${day} tháng ${printMonth} năm ${printYear}</em></div>
          <div class="signatures first-row">
            <div><strong>Người lập biên bản</strong><em>(Ký, ghi rõ họ tên)</em></div>
            <div><strong>Người vi phạm</strong><em>(Ký, ghi rõ họ tên)</em></div>
          </div>
          <div class="signatures second-row">
            <div><strong>Trưởng bộ phận</strong><em>(Ký, ghi rõ họ tên)</em></div>
            <div><strong>Ban giám đốc</strong><em>(Ký, ghi rõ họ tên)</em></div>
          </div>
        </section>`;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Biên bản xử lý vi phạm</title>
          <style>
            @page { size: A4 portrait; margin: 9mm 11mm; }
            * { box-sizing: border-box; }
            body {
              font-family: "Times New Roman", Times, serif;
              color: #000;
              margin: 0;
              background: #fff;
              font-size: 11.5pt;
              line-height: 1.22;
            }
            .form-page { width: 100%; height: 278mm; overflow: hidden; break-inside: avoid; page-break-inside: avoid; page-break-after: always; }
            .form-page:last-child { page-break-after: auto; }
            .official-header { display: grid; grid-template-columns: 43% 57%; text-align: center; margin-bottom: 17px; }
            .official-header strong { font-size: 12pt; }
            .divider { font-weight: bold; margin: 3px 0 1px; }
            .motto { font-weight: bold; text-decoration: underline; margin-top: 3px; }
            h1 { text-align: center; font-size: 16pt; margin: 0 0 13px; }
            h2 { font-size: 11.5pt; margin: 14px 0 4px; }
            p { margin: 3px 0; }
            .party { margin-top: 3px; }
            .party-detail { display: grid; grid-template-columns: 48% 52%; padding: 4px 8px 2px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1px solid #000; padding: 4px 3px; vertical-align: middle; }
            th { text-align: center; font-weight: bold; }
            .violations th:nth-child(1) { width: 7%; }
            .violations th:nth-child(2) { width: 13%; }
            .violations th:nth-child(3) { width: 8%; }
            .violations th:nth-child(4) { width: 14%; }
            .violations th:nth-child(5) { width: 17%; }
            .violations th:nth-child(6) { width: 22%; }
            .violations th:nth-child(7) { width: 19%; }
            .center { text-align: center; }
            .nowrap { white-space: nowrap; }
            .total-row { font-weight: bold; text-align: center; }
            .notes { margin-top: 11px; font-weight: bold; font-style: italic; }
            .notes p { margin: 7px 0; }
            .custom-notes { font-weight: normal; }
            .location-date { text-align: right; margin-top: 7px; }
            .signatures { display: grid; grid-template-columns: 190px 190px; gap: 35px; text-align: center; }
            .signatures div { display: flex; flex-direction: column; }
            .first-row { margin: 5px 0 68px 8px; }
            .second-row { margin-left: 8px; }
            .signatures em { margin-top: 4px; }
            .compact { font-size: 10.5pt; line-height: 1.14; }
            .compact .official-header { margin-bottom: 11px; }
            .compact h1 { margin-bottom: 8px; }
            .compact h2 { margin-top: 9px; }
            .compact th, .compact td { padding: 2px; }
            .compact .notes { margin-top: 6px; }
            .compact .notes p { margin: 4px 0; }
            .compact .first-row { margin-bottom: 48px; }
            .ultra-compact { font-size: 9pt; line-height: 1.08; }
            .ultra-compact .official-header { margin-bottom: 7px; }
            .ultra-compact .official-header strong { font-size: 10pt; }
            .ultra-compact h1 { font-size: 13pt; margin-bottom: 6px; }
            .ultra-compact h2 { margin: 6px 0 2px; }
            .ultra-compact .party-detail { padding: 2px 5px 1px; }
            .ultra-compact th, .ultra-compact td { padding: 1px 2px; }
            .ultra-compact .notes { margin-top: 4px; }
            .ultra-compact .notes p { margin: 2px 0; }
            .ultra-compact .first-row { margin-bottom: 36px; }
            @media screen {
              body { background: #e5e7eb; padding: 20px; }
              .form-page { width: 210mm; margin: 0 auto 20px; padding: 9mm 11mm; background: white; box-shadow: 0 2px 12px #999; }
            }
            @media print {
              body { background: #fff; }
            }
          </style>
        </head>
        <body>
          ${formsHtml}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handlePrintSingleRecord = (record: PenaltyRecord) => {
    handlePrintPenaltySummary(
      [{
        employeeId: record.employee,
        employeeName: record.employee_name,
        employeeCode: record.employee_code,
        totalAmount: Number(record.amount || 0),
        records: [record],
        reasons: record.reason ? [record.reason] : [],
      }],
      `Biên bản phạt #${record.id} - ${record.employee_name}`,
    );
  };

  const handlePrintEmployee = (group: GroupedPenaltySummary) => {
    handlePrintPenaltySummary(
      [group],
      `Biên bản tổng hợp lỗi - ${group.employeeName}`,
    );
  };

  if (!hasPenaltyPermission) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h1 className="text-xl font-semibold text-gray-900">Phạt biên bản</h1>
        <p className="text-sm text-gray-600 mt-2">
          Bạn chưa được cấp quyền ghi nhận / quản lý phạt biên bản.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Phạt biên bản</h1>
        <p className="text-sm text-gray-600 mt-1">
          Bộ phận giám sát ghi nhận biên bản phạt cho từng nhân sự theo tháng.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-gray-900">Thêm biên bản phạt</h2>
          <button
            type="button"
            onClick={handleFinalizeMonth}
            disabled={finalizing}
            className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-60"
          >
            {finalizing ? 'Đang chốt...' : `Chốt phạt biên bản tháng ${month}/${year}`}
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Năm</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Tháng</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((m) => (
                <option key={m} value={m}>Tháng {m}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2" ref={employeeDropdownRef}>
            <label className="block text-sm text-gray-700 mb-1">Nhân sự (gõ tên hoặc mã để tìm)</label>
            <div className="relative">
              <input
                type="text"
                value={employeeSearch}
                onFocus={() => setShowEmployeeDropdown(true)}
                onChange={(e) => handleEmployeeSearchChange(e.target.value)}
                placeholder="Nhập họ tên hoặc mã nhân sự"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />

              {showEmployeeDropdown && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {employeeLoading ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Đang tìm nhân sự...</div>
                  ) : filteredEmployees.length > 0 ? (
                    filteredEmployees.map((employee) => {
                      const optionLabel = `${employee.employee_id} - ${employee.full_name}`;
                      const isSelected = String(employee.id) === employeeId;
                      return (
                        <button
                          key={employee.id}
                          type="button"
                          onClick={() => handleSelectEmployee(employee)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${isSelected ? 'bg-primary-50 text-primary-700' : 'text-gray-700'}`}
                        >
                          {optionLabel}
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-3 py-2 text-sm text-amber-600">Không tìm thấy nhân sự phù hợp.</div>
                  )}
                </div>
              )}
            </div>

            {!employeeId ? (
              <p className="text-xs text-gray-500 mt-1">Chọn 1 nhân sự từ danh sách dropdown để tạo biên bản phạt.</p>
            ) : (
              <p className="text-xs text-green-600 mt-1">Đã chọn: {selectedEmployeeLabel || employeeSearch}</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Số tiền phạt</label>
            <input
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ví dụ: 200000 hoặc 200,000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {PENALTY_AMOUNT_OPTIONS.map((option) => {
                const optionValue = String(option);
                const isActive = normalizedAmount === optionValue;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAmount(optionValue)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors ${isActive ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300 hover:text-primary-700'}`}
                  >
                    {option.toLocaleString('vi-VN')} ₫
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Có thể chọn nhanh mức phạt hoặc tự nhập số, không cần dấu tiền tệ.
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Lý do vi phạm</label>
            <input
              type="text"
              list="disciplinary-penalty-reasons"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Chọn lý do có sẵn hoặc tự nhập"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">
              Có thể tìm, chọn lý do có sẵn hoặc gõ lý do tuỳ chỉnh.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Ghi chú</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? 'Đang lưu...' : 'Ghi nhận biên bản phạt'}
            </button>
          </div>
        </form>

        <datalist id="disciplinary-penalty-reasons">
          {PENALTY_REASON_OPTIONS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>

      {(error || success) && (
        <div className={`rounded-lg p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {error || success}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-gray-900">Danh sách biên bản phạt</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{records.length} bản ghi</span>
            <button
              type="button"
              onClick={openPrintPreview}
              disabled={records.length === 0}
              className="inline-flex items-center rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Tùy chọn in
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Đang tải dữ liệu...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có biên bản phạt trong kỳ đã chọn.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-2 pr-4">Nhân sự</th>
                  <th className="py-2 pr-4">Mã NV</th>
                  <th className="py-2 pr-4">Số tiền</th>
                  <th className="py-2 pr-4">Lý do</th>
                  <th className="py-2 pr-4">Ghi chú</th>
                  <th className="py-2 pr-4">Trạng thái</th>
                  <th className="py-2 pr-0">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{record.employee_name}</td>
                    <td className="py-2 pr-4">{record.employee_code}</td>
                    <td className="py-2 pr-4">
                      {editingId === record.id ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-36 border border-gray-300 rounded-lg px-2 py-1"
                        />
                      ) : (
                        `${Number(record.amount).toLocaleString('vi-VN')} ₫`
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {editingId === record.id ? (
                        <input
                          type="text"
                          list="disciplinary-penalty-reasons"
                          value={editReason}
                          onChange={(e) => setEditReason(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1"
                        />
                      ) : (
                        record.reason || '—'
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {editingId === record.id ? (
                        <input
                          type="text"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1"
                        />
                      ) : (
                        record.notes || '—'
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusClassName(record.status)}`}>
                        {getStatusLabel(record.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-0">
                      <div className="flex items-center gap-3">
                        {editingId === record.id ? (
                          <>
                            <button
                              onClick={() => handleSaveEdit(record)}
                              disabled={savingId === record.id}
                              className="text-primary-600 hover:text-primary-700 disabled:opacity-60"
                            >
                              {savingId === record.id ? 'Đang lưu...' : 'Lưu'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={savingId === record.id}
                              className="text-gray-600 hover:text-gray-700"
                            >
                              Huỷ
                            </button>
                          </>
                        ) : (
                          <>
                            {record.status !== 'APPROVED' && (
                              <button
                                onClick={() => startEdit(record)}
                                className="text-primary-600 hover:text-primary-700"
                              >
                                Sửa
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handlePrintSingleRecord(record)}
                              className="text-emerald-600 hover:text-emerald-700"
                              title={`In riêng biên bản #${record.id}`}
                            >
                              In riêng
                            </button>
                            <button
                              onClick={() => handleDelete(record.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              Xóa
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPrintPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Biên bản tổng hợp phạt tháng {month}/{year}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Chọn in riêng từng người hoặc gộp toàn bộ nhân sự trong kỳ.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintPreview(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Đóng
              </button>
            </div>

            <div className="max-h-[calc(90vh-145px)] overflow-y-auto px-6 py-5">
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm text-blue-700">Nhân sự bị phạt</p>
                  <p className="mt-1 text-2xl font-bold text-blue-900">{groupedPenaltySummaries.length}</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm text-amber-700">Số biên bản</p>
                  <p className="mt-1 text-2xl font-bold text-amber-900">{records.length}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <p className="text-sm text-red-700">Tổng tiền phạt</p>
                  <p className="mt-1 text-2xl font-bold text-red-900">{formatCurrency(totalGroupedAmount)}</p>
                </div>
              </div>

              <div className="space-y-4">
                {groupedPenaltySummaries.map((group, index) => (
                  <div key={group.employeeId} className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <span className="inline-flex rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-700">
                          Nhân sự {index + 1}
                        </span>
                        <h3 className="mt-3 text-lg font-semibold text-gray-900">{group.employeeName}</h3>
                        <p className="text-sm text-gray-500">Mã nhân sự: {group.employeeCode || '—'}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Tổng tiền phạt</p>
                          <p className="mt-1 text-2xl font-bold text-red-600">{formatCurrency(group.totalAmount)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePrintEmployee(group)}
                          className="rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50"
                        >
                          In tất cả lỗi của người này
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <h4 className="text-sm font-semibold text-gray-800">Các lỗi đã gộp</h4>
                        {group.reasons.length > 0 ? (
                          <ul className="mt-3 space-y-2 text-sm text-gray-600">
                            {group.reasons.map((item) => (
                              <li key={item} className="flex gap-2">
                                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500"></span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 text-sm text-gray-500">Không có lý do vi phạm.</p>
                        )}
                      </div>

                      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                        <div className="border-b border-gray-200 px-4 py-3">
                          <h4 className="text-sm font-semibold text-gray-800">Chi tiết biên bản</h4>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 text-left text-gray-600">
                                <th className="px-4 py-3">Lý do</th>
                                <th className="px-4 py-3">Ghi chú</th>
                                <th className="px-4 py-3 text-right">Số tiền</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.records.map((record) => (
                                <tr key={record.id} className="border-t border-gray-100">
                                  <td className="px-4 py-3 text-gray-700">{record.reason || 'Không có lý do'}</td>
                                  <td className="px-4 py-3 text-gray-500">{record.notes || '—'}</td>
                                  <td className="px-4 py-3 text-right font-medium text-gray-700">
                                    {formatCurrency(Number(record.amount || 0))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowPrintPreview(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => handlePrintPenaltySummary()}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              >
                In gộp toàn bộ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DisciplinaryPenaltyManagement;
