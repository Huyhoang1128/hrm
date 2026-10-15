import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { managementApi } from '../utils/api';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  CheckBadgeIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import MultiPdfPreviewModal, { ContractPreviewItem } from '../components/Common/MultiPdfPreviewModal';
import PdfPreviewModal from '../components/Common/PdfPreviewModal';
import ContractPlaceholderModal from './ContractPlaceholderModal';
import { SelectBox, MultiSelectBox, SelectOption } from '../components/LandingLayout/SelectBox';
import ConfirmDialog from '../components/ConfirmDialog';

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const getDaysUntilExpiry = (endDate: string | null | undefined): number | null => {
  if (!endDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(endDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// Tính trạng thái thực tế: SIGNED đã qua end_date → hiển thị EXPIRED
const effectiveStatus = (status: string, endDate: string | null | undefined): string => {
  if (status === 'SIGNED' && endDate) {
    const days = getDaysUntilExpiry(endDate);
    if (days !== null && days < 0) return 'EXPIRED';
  }
  return status;
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT:        { label: 'Bản nháp', color: 'bg-gray-100 text-gray-700' },
  PENDING_SIGN: { label: 'Chờ ký',   color: 'bg-amber-100 text-amber-700' },
  SIGNED:       { label: 'Đang hiệu lực', color: 'bg-emerald-100 text-emerald-700' },
  EXPIRED:      { label: 'Hết hạn',  color: 'bg-red-100 text-red-700' },
  CANCELLED:    { label: 'Đã hết hiệu lực',   color: 'bg-gray-100 text-gray-500' },
};

type Employee = {
  id: number;
  employee_id: string;
  full_name: string;
  department_name: string | null;
  department: { id: number; name: string; code: string } | null;
  is_active: boolean;
  employment_status?: 'ACTIVE' | 'SUSPENDED' | 'PAUSED' | 'INACTIVE';
};

/** Nhân viên đã nghỉ việc — không cần cảnh báo hết hạn hợp đồng. */
const isResigned = (e: Employee): boolean =>
  e.is_active === false || e.employment_status === 'INACTIVE';

type ContractTemplate = {
  id: number;
  name: string;
  contract_type: string;
  contract_type_display: string;
  company_unit: number | null;
  company_unit_name: string | null;
  status?: string;
};

type EmployeeContract = {
  id: number;
  employee: number;
  employee_name: string;
  contract_type: string;
  contract_type_display: string;
  status: string;
  status_display: string;
  template: number | null;
  template_name: string | null;
  generated_file: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_number: string | null;
  company_unit_name: string | null;
  created_at: string;
};

type RowState = {
  employeeId: number;
  selected: boolean;
  template: ContractTemplate | null;
  start_date: string;
  end_date: string;
};

type RowResult = 'success' | 'error' | 'pending';

type BatchState = {
  current: number;
  total: number;
  phase: 'cancel' | 'contract' | 'pdf';
  employeeName: string;
  successCount: number;
  errorCount: number;
} | null;

const BulkContracts: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [contractsMap, setContractsMap] = useState<Record<number, EmployeeContract[]>>({});
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [rowResults, setRowResults] = useState<Record<number, RowResult>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [createdContracts, setCreatedContracts] = useState<EmployeeContract[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showMultiPreview, setShowMultiPreview] = useState(false);
  const [showSelectedPreview, setShowSelectedPreview] = useState(false);
  const [singlePreview, setSinglePreview] = useState<{ id: number; name: string } | null>(null);
  const [placeholderModal, setPlaceholderModal] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [signingId, setSigningId] = useState<number | null>(null);
  const [signingAll, setSigningAll] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [assigningTemplateId, setAssigningTemplateId] = useState<number | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<number, { templateId: number; contractNumber: string }>>({});
  const [batchState, setBatchState] = useState<BatchState>(null);
  const [bulkTemplate, setBulkTemplate] = useState<ContractTemplate | null>(null);
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEndDate, setBulkEndDate] = useState('');
  const [filterUnit, setFilterUnit] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setToolbarHeight(el.offsetHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const fetchContractsMap = useCallback(async () => {
    const { data } = await managementApi.get('/api-hrm/employee-contracts/');
    const list: EmployeeContract[] = Array.isArray(data) ? data : data.results || [];
    const map: Record<number, EmployeeContract[]> = {};
    for (const c of list) {
      if (!map[c.employee]) map[c.employee] = [];
      map[c.employee].push(c);
    }
    for (const id in map) {
      map[id].sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    setContractsMap(map);
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [empRes, tplRes] = await Promise.all([
          managementApi.get('/api-hrm/employees/'),
          managementApi.get('/api-hrm/contract-templates/', { params: { status: 'ACTIVE' } }),
        ]);
        const empList: Employee[] = Array.isArray(empRes.data) ? empRes.data : empRes.data.results || [];
        const tplList: ContractTemplate[] = Array.isArray(tplRes.data) ? tplRes.data : tplRes.data.results || [];
        setEmployees(empList);
        setTemplates(tplList);
        setRows(empList.map((e) => ({ employeeId: e.id, selected: false, template: null, start_date: '', end_date: '' })));
        await fetchContractsMap();
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [fetchContractsMap]);

  const selectedRows = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const missingTemplateCount = useMemo(
    () => selectedRows.filter((r) => r.template === null).length,
    [selectedRows]
  );
  const canCreate = useMemo(
    () => selectedRows.length > 0 && missingTemplateCount === 0,
    [selectedRows, missingTemplateCount]
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => setRows((prev) => prev.map((r) => ({ ...r, selected: checked }))),
    []
  );

  const updateRow = useCallback(
    (employeeId: number, patch: Partial<RowState>) =>
      setRows((prev) => prev.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r))),
    []
  );

  const toggleExpand = useCallback((employeeId: number) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(employeeId) ? next.delete(employeeId) : next.add(employeeId);
      return next;
    }), []);

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setRowResults({});
    setRowErrors({});
    const created: EmployeeContract[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < selectedRows.length; i++) {
      const row = selectedRows[i];
      const emp = employees.find((e) => e.id === row.employeeId);
      const employeeName = emp?.full_name ?? '';
      const total = selectedRows.length;

      setRowResults((prev) => ({ ...prev, [row.employeeId]: 'pending' }));
      try {
        // Luôn ghi đè: hủy mọi HĐ chưa CANCELLED/EXPIRED trước khi tạo HĐ mới
        // → tránh 1 NV có nhiều HĐ hiệu lực cùng lúc
        {
          setBatchState({ current: i + 1, total, phase: 'cancel', employeeName, successCount, errorCount });
          const existing = (contractsMap[row.employeeId] || []).filter(
            (c) => !['CANCELLED', 'EXPIRED'].includes(c.status)
          );
          for (const c of existing) {
            try { await managementApi.post(`/api-hrm/employee-contracts/${c.id}/cancel_contract/`); } catch {}
          }
        }

        setBatchState({ current: i + 1, total, phase: 'contract', employeeName, successCount, errorCount });
        const { data: contract } = await managementApi.post('/api-hrm/employee-contracts/', {
          employee: row.employeeId,
          contract_type: row.template!.contract_type,
          template: row.template!.id,
          company_unit: row.template!.company_unit,
          start_date: row.start_date || null,
          end_date: row.end_date || null,
        });

        setBatchState({ current: i + 1, total, phase: 'pdf', employeeName, successCount, errorCount });
        let finalContract = contract;
        try {
          const { data: gen } = await managementApi.post(
            `/api-hrm/employee-contracts/${contract.id}/generate_and_confirm/`,
            { overrides: {} }
          );
          if (gen.success) finalContract = gen.data;
        } catch {}
        created.push(finalContract);

        successCount++;
        setRowResults((prev) => ({ ...prev, [row.employeeId]: 'success' }));
      } catch (e: any) {
        errorCount++;
        setRowResults((prev) => ({ ...prev, [row.employeeId]: 'error' }));
        setRowErrors((prev) => ({
          ...prev,
          [row.employeeId]: e.response?.data?.detail || e.response?.data?.error || 'Lỗi tạo hợp đồng',
        }));
      }
    }

    setCreatedContracts(created);
    setCreating(false);
    setBatchState(null);
    await fetchContractsMap();
  };

  // Đánh dấu đã ký — dùng cho cả bảng kết quả và expanded history
  const handleMarkSigned = async (contractId: number) => {
    setSigningId(contractId);
    try {
      const { data } = await managementApi.post(
        `/api-hrm/employee-contracts/${contractId}/mark_signed/`
      );
      if (data.success) {
        // Cập nhật status → hiện "Đã sync hồ sơ" ngắn, rồi ẩn hàng đó sau 1.5s
        setCreatedContracts((prev) =>
          prev.map((c) => (c.id === contractId ? data.data : c))
        );
        setTimeout(() => {
          setCreatedContracts((prev) => prev.filter((c) => c.id !== contractId));
        }, 1500);
        await fetchContractsMap();
      } else {
        alert(data.message || 'Không thể đánh dấu đã ký');
      }
    } catch (e: any) {
      alert(e.response?.data?.message || e.response?.data?.detail || 'Lỗi đánh dấu đã ký');
    } finally {
      setSigningId(null);
    }
  };

  const handleDeleteContract = (contractId: number) => {
    setConfirmDeleteId(contractId);
  };

  const executeDeleteContract = async (contractId: number) => {
    setConfirmDeleteId(null);
    setDeletingId(contractId);
    try {
      await managementApi.delete(`/api-hrm/employee-contracts/${contractId}/`);
      setCreatedContracts((prev) => prev.filter((c) => c.id !== contractId));
      await fetchContractsMap();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Không thể xóa hợp đồng');
    } finally {
      setDeletingId(null);
    }
  };

  // Lưu template đã chọn rồi mở modal xem trước/chỉnh sửa placeholder trước khi tạo PDF thật
  const handleAssignTemplate = async (contractId: number, edit: { templateId: number; contractNumber: string }) => {
    if (!edit.templateId) return;
    setAssigningTemplateId(contractId);
    try {
      await managementApi.patch(`/api-hrm/employee-contracts/${contractId}/`, {
        template: edit.templateId,
        ...(edit.contractNumber ? { contract_number: edit.contractNumber } : {}),
      });
      setDraftEdits((prev) => { const next = { ...prev }; delete next[contractId]; return next; });
      await fetchContractsMap();
      setPlaceholderModal(contractId);
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Không thể gán template');
    } finally {
      setAssigningTemplateId(null);
    }
  };

  const handleMarkAllSigned = async () => {
    const pending = createdContracts.filter((c) => c.status === 'PENDING_SIGN');
    if (pending.length === 0) return;
    setSigningAll(true);
    for (const c of pending) {
      setSigningId(c.id);
      try {
        const { data } = await managementApi.post(`/api-hrm/employee-contracts/${c.id}/mark_signed/`);
        if (data.success) {
          setCreatedContracts((prev) => prev.map((x) => (x.id === c.id ? data.data : x)));
        }
      } catch {}
    }
    setSigningId(null);
    setSigningAll(false);
    await fetchContractsMap();
    // Hiện "Đã sync hồ sơ" xong thì dọn sạch bảng kết quả sau 1.5s
    setTimeout(() => setCreatedContracts([]), 1500);
  };

  const applyBulkToSelected = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.selected) return r;
        return {
          ...r,
          ...(bulkTemplate ? { template: bulkTemplate } : {}),
          ...(bulkStartDate ? { start_date: bulkStartDate } : {}),
          ...(bulkEndDate ? { end_date: bulkEndDate } : {}),
        };
      })
    );
  }, [bulkTemplate, bulkStartDate, bulkEndDate]);

  const multiPreviewItems = useMemo<ContractPreviewItem[]>(
    () =>
      createdContracts
        .filter((c) => c.generated_file)
        .map((c) => ({ id: c.id, employee_name: c.employee_name, template_name: c.template_name || '' })),
    [createdContracts]
  );

  const selectedPreviewItems = useMemo<ContractPreviewItem[]>(
    () =>
      selectedRows.flatMap((row) => {
        const emp = employees.find((e) => e.id === row.employeeId);
        return (contractsMap[row.employeeId] || [])
          .filter((c) => c.status === 'SIGNED' && c.generated_file)
          .map((c) => ({
            id: c.id,
            employee_name: emp?.full_name || '',
            template_name: [c.template_name, c.contract_type_display, c.contract_number]
              .filter(Boolean).join(' · '),
          }));
      }),
    [selectedRows, employees, contractsMap]
  );

  const templateOptions = useMemo<SelectOption<number>[]>(
    () => templates.map((t) => ({ value: t.id, label: t.name })),
    [templates]
  );

  const deptOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [{ value: '', label: 'Tất cả phòng ban' }];
    for (const e of employees) {
      if (e.department_name && !seen.has(e.department_name)) {
        seen.add(e.department_name);
        opts.push({ value: e.department_name, label: e.department_name });
      }
    }
    return opts;
  }, [employees]);

  const unitOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [{ value: '', label: 'Tất cả đơn vị' }];
    for (const t of templates) {
      if (t.company_unit_name && !seen.has(t.company_unit_name)) {
        seen.add(t.company_unit_name);
        opts.push({ value: t.company_unit_name, label: t.company_unit_name });
      }
    }
    return opts;
  }, [templates]);

  const summaryStats = useMemo(() => {
    let signed = 0;
    let expiringSoon = 0;
    let alreadyExpired = 0;
    let noContract = 0;
    let pendingSign = 0;
    for (const emp of employees) {
      const resigned = isResigned(emp);
      const contracts = contractsMap[emp.id] || [];
      if (contracts.length === 0) {
        if (!resigned) noContract++;
        continue;
      }
      const activeSigned = contracts.find(
        (c) => c.status === 'SIGNED' && effectiveStatus(c.status, c.end_date) === 'SIGNED'
      );
      if (activeSigned) {
        signed++;
        const days = getDaysUntilExpiry(activeSigned.end_date);
        // Bỏ qua cảnh báo sắp hết hạn nếu NV đã nghỉ việc
        if (!resigned && days !== null && days <= 5) expiringSoon++;
      }
      // Hết hạn: SIGNED đã qua end_date hoặc status EXPIRED trong DB — bỏ qua nếu đã nghỉ việc
      const hasExpired = contracts.some(
        (c) => effectiveStatus(c.status, c.end_date) === 'EXPIRED'
      );
      if (!resigned && hasExpired && !activeSigned) alreadyExpired++;
      if (contracts.some((c) => c.status === 'PENDING_SIGN')) pendingSign++;
    }
    return { signed, expiringSoon, alreadyExpired, noContract, pendingSign };
  }, [employees, contractsMap]);

  const statusFilterOptions: { value: string; label: string }[] = [
    { value: 'SIGNED',          label: 'Đang hiệu lực' },
    { value: 'SIGNED_EXPIRING', label: 'Sắp hết hạn (≤ 5 ngày)' },
    { value: 'EXPIRED',         label: 'Hết hạn' },
    { value: 'PENDING_SIGN',    label: 'Chờ ký' },
    { value: 'DRAFT',           label: 'Nháp' },
    { value: 'CANCELLED',       label: 'Đã hết hiệu lực' },
    { value: 'NONE',            label: 'Chưa có hợp đồng' },
  ];

  const filteredEmployees = useMemo(() =>
    employees.filter((e) => {
      if (search && !(
        e.full_name.toLowerCase().includes(search.toLowerCase()) ||
        e.employee_id.toLowerCase().includes(search.toLowerCase()) ||
        (e.department_name || '').toLowerCase().includes(search.toLowerCase())
      )) return false;
      if (filterDept && e.department_name !== filterDept) return false;
      if (filterUnit) {
        const latestUnitName = (contractsMap[e.id] || [])[0]?.company_unit_name;
        if (latestUnitName !== filterUnit) return false;
      }
      if (filterStatuses.length > 0) {
        const resigned = isResigned(e);
        const latest = (contractsMap[e.id] || [])[0];
        const latestEffective = latest ? effectiveStatus(latest.status, latest.end_date) : 'NONE';
        const days = latest ? getDaysUntilExpiry(latest.end_date) : null;
        const isExpiringSoon = latestEffective === 'SIGNED' && days !== null && days <= 5;
        const matched = filterStatuses.some((f) => {
          // Đã nghỉ việc → không match các filter cảnh báo HĐ
          if (resigned && (f === 'SIGNED_EXPIRING' || f === 'EXPIRED' || f === 'NONE')) return false;
          if (f === 'SIGNED_EXPIRING') return isExpiringSoon;
          if (f === 'SIGNED') return latestEffective === 'SIGNED' && !isExpiringSoon;
          return f === latestEffective;
        });
        if (!matched) return false;
      }
      return true;
    }),
    [employees, search, filterDept, filterUnit, filterStatuses, contractsMap]
  );

  const filteredRows = useMemo(
    () => rows.filter((r) => filteredEmployees.some((e) => e.id === r.employeeId)),
    [rows, filteredEmployees]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
          <p className="mt-4 text-gray-600">Đang tải danh sách hợp đồng...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Hợp đồng hàng loạt</h1>
        <p className="text-sm text-gray-900 mt-1">
          Gắn hợp đồng nhanh cho nhiều nhân viên cùng lúc và xem trước PDF trước khi in.
        </p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <CheckCircleIcon className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-emerald-700">{summaryStats.signed}</p>
            <p className="text-xs text-emerald-600">Đang hiệu lực</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-xl font-bold text-amber-600">{summaryStats.expiringSoon}</p>
            <p className="text-xs text-amber-600">Sắp hết hạn (≤ 5 ngày)</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <div className="h-9 w-9 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-red-700">{summaryStats.alreadyExpired}</p>
            <p className="text-xs text-red-600">Đã hết hạn</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-amber-700">{summaryStats.pendingSign}</p>
            <p className="text-xs text-amber-700">Chờ ký</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3">
          <div className="h-9 w-9 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-700">{summaryStats.noContract}</p>
            <p className="text-xs text-gray-600">Chưa có hợp đồng</p>
          </div>
        </div>
      </div>

      {/* ── Sticky toolbar ── */}
      <div ref={toolbarRef} className="sticky top-0 z-20 flex flex-col gap-2 bg-gray-50 -mx-1 px-1 pt-1 pb-2 shadow-sm">
      {/* Action bar */}
      <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-sm">
        <input
          type="text"
          placeholder="Tìm nhân viên..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field w-56"
        />
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-colors ${
            showFilters || filterDept || filterUnit || filterStatuses.length > 0
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Bộ lọc
          {(filterDept ? 1 : 0) + (filterUnit ? 1 : 0) + (filterStatuses.length > 0 ? 1 : 0) > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-primary-600 rounded-full">
              {(filterDept ? 1 : 0) + (filterUnit ? 1 : 0) + (filterStatuses.length > 0 ? 1 : 0)}
            </span>
          )}
        </button>
        <span className="text-sm text-gray-600 ml-auto">
          Đã chọn: <strong>{selectedRows.length}</strong> nhân viên
        </span>
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={handleCreate}
            disabled={!canCreate || creating}
            title={
              selectedRows.length === 0
                ? 'Chọn ít nhất 1 nhân viên trước'
                : missingTemplateCount > 0
                ? `Còn ${missingTemplateCount} nhân viên chưa chọn template`
                : undefined
            }
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            Tạo hợp đồng
          </button>
          {!creating && selectedRows.length === 0 && (
            <span className="text-xs text-gray-400 whitespace-nowrap">Chọn nhân viên bên dưới để bắt đầu</span>
          )}
          {!creating && selectedRows.length > 0 && missingTemplateCount > 0 && (
            <span className="text-xs text-amber-600 whitespace-nowrap">
              Còn {missingTemplateCount} người chưa chọn template
            </span>
          )}
        </div>
        {selectedPreviewItems.length > 0 && (
          <button
            onClick={() => setShowSelectedPreview(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <EyeIcon className="w-4 h-4" />
            Xem hợp đồng đã chọn ({selectedPreviewItems.length})
          </button>
        )}
        {multiPreviewItems.length > 0 && (
          <button
            onClick={() => setShowMultiPreview(true)}
            className="btn-primary flex items-center gap-2"
          >
            <EyeIcon className="w-4 h-4" />
            Xem trước PDF vừa tạo ({multiPreviewItems.length})
          </button>
        )}
      </div>

      {/* ── Filter bar (ẩn/hiện qua nút "Bộ lọc") ── */}
      {showFilters && (
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-wrap items-center gap-3">
          <div className="w-48">
            <SelectBox
              label=""
              value={filterDept}
              options={deptOptions}
              onChange={setFilterDept}
              placeholder="Tất cả phòng ban"
              searchable
            />
          </div>
          <div className="w-48">
            <SelectBox
              label=""
              value={filterUnit}
              options={unitOptions}
              onChange={setFilterUnit}
              placeholder="Tất cả đơn vị"
              searchable
            />
          </div>
          <div className="w-52">
            <MultiSelectBox
              label=""
              value={filterStatuses}
              options={statusFilterOptions}
              onChange={setFilterStatuses}
              allLabel="Tất cả trạng thái"
            />
          </div>
          {(filterDept || filterUnit || filterStatuses.length > 0) && (
            <button
              onClick={() => { setFilterDept(''); setFilterUnit(''); setFilterStatuses([]); }}
              className="text-xs text-red-500 hover:text-red-700 underline whitespace-nowrap"
            >
              Xóa bộ lọc
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">
            Hiển thị {filteredEmployees.length}/{employees.length} nhân viên
          </span>
        </div>
      )}

      {/* ── Bulk fill bar ── */}
      {selectedRows.length > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-primary-800 whitespace-nowrap">
            Điền cho {selectedRows.length} nhân viên đã chọn:
          </span>
          <div className="min-w-[200px]">
            <SelectBox<number>
              label=""
              value={bulkTemplate?.id ?? 0}
              options={templateOptions}
              onChange={(id) => setBulkTemplate(templates.find((t) => t.id === id) || null)}
              placeholder="Template hợp đồng"
              searchable
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-primary-700 whitespace-nowrap">Ngày bắt đầu</label>
            <input
              type="date"
              value={bulkStartDate}
              onChange={(e) => setBulkStartDate(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-primary-700 whitespace-nowrap">Ngày kết thúc</label>
            <input
              type="date"
              value={bulkEndDate}
              onChange={(e) => setBulkEndDate(e.target.value)}
              className="input-field"
            />
          </div>
          <button
            onClick={applyBulkToSelected}
            disabled={!bulkTemplate && !bulkStartDate && !bulkEndDate}
            title={!bulkTemplate && !bulkStartDate && !bulkEndDate ? 'Chọn ít nhất 1 trong 3 ô trên trước' : undefined}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Áp dụng
          </button>
        </div>
      )}
      </div>{/* end sticky toolbar */}

      {/* ── Batch progress banner ── */}
      {batchState && (() => {
        const pct = Math.round((batchState.current - 1) / batchState.total * 100);
        const phaseLabel =
          batchState.phase === 'cancel'   ? 'Đang ghi đè hợp đồng cũ...' :
          batchState.phase === 'contract' ? 'Đang tạo hợp đồng...' :
                                            'Đang tạo PDF và gán số hợp đồng...';
        const phaseColor =
          batchState.phase === 'cancel'   ? 'bg-amber-500' :
          batchState.phase === 'contract' ? 'bg-primary-500' :
                                            'bg-primary-600';
        return (
          <div className="rounded-2xl border border-primary-200 bg-primary-50 px-5 py-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <svg className="w-4 h-4 animate-spin text-primary-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-sm font-semibold text-primary-800">
                  Đang xử lý {batchState.current}/{batchState.total} hợp đồng
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs flex-shrink-0">
                {batchState.successCount > 0 && (
                  <span className="flex items-center gap-1 text-emerald-700 font-medium">
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    {batchState.successCount} thành công
                  </span>
                )}
                {batchState.errorCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600 font-medium">
                    <XCircleIcon className="w-3.5 h-3.5" />
                    {batchState.errorCount} lỗi
                  </span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="relative h-2 bg-primary-100 rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${phaseColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Phase + employee */}
            <div className="flex items-center justify-between text-xs text-primary-700">
              <span>{phaseLabel} <span className="font-medium">{batchState.employeeName}</span></span>
              <span className="text-primary-500">{pct}%</span>
            </div>
          </div>
        );
      })()}

      {/* ── Bảng kết quả vừa tạo ── */}
      {createdContracts.length > 0 && (
        <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm font-semibold text-emerald-800">
              ✓ Hợp đồng vừa tạo ({createdContracts.length})
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-emerald-600">
                Bấm "Đã ký" sau khi nhân viên ký vật lý để sync vào hồ sơ
              </p>
              {createdContracts.some((c) => c.status === 'PENDING_SIGN') && (
                <button
                  onClick={handleMarkAllSigned}
                  disabled={signingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {signingAll ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <CheckBadgeIcon className="w-3.5 h-3.5" />
                  )}
                  Ký tất cả ({createdContracts.filter((c) => c.status === 'PENDING_SIGN').length})
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Nhân viên</th>
                <th className="px-4 py-2 text-left">Loại hợp đồng</th>
                <th className="px-4 py-2 text-left">Ngày bắt đầu</th>
                <th className="px-4 py-2 text-left">Ngày kết thúc</th>
                <th className="px-4 py-2 text-left">Trạng thái</th>
                <th className="px-4 py-2 text-left">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {createdContracts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{c.employee_name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.contract_type_display}</td>
                  <td className="px-4 py-2.5 text-gray-600">{fmtDate(c.start_date)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{fmtDate(c.end_date)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[effectiveStatus(c.status, c.end_date)]?.color}`}>
                      {STATUS_CONFIG[effectiveStatus(c.status, c.end_date)]?.label || c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {c.generated_file && (
                        <button
                          onClick={() => setSinglePreview({ id: c.id, name: c.employee_name })}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50"
                        >
                          <EyeIcon className="w-3.5 h-3.5" />
                          Xem PDF
                        </button>
                      )}
                      {!c.generated_file && (() => {
                        const edit = draftEdits[c.id] ?? { templateId: c.template ?? 0, contractNumber: c.contract_number ?? '' };
                        const isSaving = assigningTemplateId === c.id;
                        return (
                          <div className="flex items-center gap-1.5">
                            <div className="w-40">
                              <SelectBox<number>
                                label=""
                                value={edit.templateId}
                                options={templateOptions}
                                onChange={(id) => setDraftEdits((prev) => ({ ...prev, [c.id]: { ...edit, templateId: id } }))}
                                placeholder="Chọn template"
                                searchable
                                portal
                              />
                            </div>
                            <button
                              onClick={() => handleAssignTemplate(c.id, edit)}
                              disabled={!edit.templateId || isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              {isSaving ? (
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                              ) : (
                                <EyeIcon className="w-3.5 h-3.5" />
                              )}
                              Xem trước & Tạo PDF
                            </button>
                          </div>
                        );
                      })()}
                      {c.status === 'PENDING_SIGN' && (
                        <button
                          onClick={() => handleMarkSigned(c.id)}
                          disabled={signingId === c.id}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {signingId === c.id ? (
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          ) : (
                            <CheckBadgeIcon className="w-3.5 h-3.5" />
                          )}
                          Đã ký
                        </button>
                      )}
                      {c.status === 'SIGNED' && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          Đã sync hồ sơ
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── Bảng nhân viên ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase sticky z-10 shadow-sm" style={{ top: toolbarHeight }}>
            <tr>
              <th className="px-3 py-3 w-8" />
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={filteredRows.length > 0 && filteredRows.every((r) => r.selected)}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left">Nhân viên</th>
              <th className="px-4 py-3 text-left">Phòng ban</th>
              <th className="px-4 py-3 text-left">Hợp đồng hiện tại</th>
              <th className="px-4 py-3 text-left w-64">Template</th>
              <th className="px-4 py-3 text-left">Ngày bắt đầu</th>
              <th className="px-4 py-3 text-left">Ngày kết thúc</th>
              <th className="px-4 py-3 text-center w-16">Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredEmployees.map((emp) => {
              const row = rows.find((r) => r.employeeId === emp.id);
              if (!row) return null;
              const contracts = contractsMap[emp.id] || [];
              const latestContract = contracts[0] || null;
              const nonFinalContracts = contracts.filter((c) => !['CANCELLED', 'EXPIRED'].includes(c.status));
              const deletableContracts = contracts.filter((c) => ['DRAFT', 'PENDING_SIGN'].includes(c.status));
              // Hợp đồng đang hiệu lực: SIGNED + chưa qua end_date
              const activeContracts = contracts.filter((c) => c.status === 'SIGNED' && effectiveStatus(c.status, c.end_date) === 'SIGNED');
              // Lịch sử: EXPIRED từ DB + SIGNED đã qua end_date + CANCELLED
              const historicalContracts = contracts.filter((c) =>
                c.status === 'EXPIRED' ||
                c.status === 'CANCELLED' ||
                (c.status === 'SIGNED' && effectiveStatus(c.status, c.end_date) === 'EXPIRED')
              );
              const isExpanded = expandedRows.has(emp.id);
              const result = rowResults[emp.id];
              const errMsg = rowErrors[emp.id];

              return (
                <React.Fragment key={emp.id}>
                  <tr className={`transition-colors align-top ${(() => {
                    if (latestContract?.status === 'SIGNED') {
                      const days = getDaysUntilExpiry(latestContract.end_date);
                      if (days !== null && days <= 0) return 'bg-red-50 hover:bg-red-100';
                      if (days !== null && days <= 5) return 'bg-amber-50 hover:bg-amber-100';
                    }
                    return 'hover:bg-gray-50';
                  })()}`}>
                    {/* Expand */}
                    <td className="px-3 py-3 text-center">
                      {contracts.length > 0 && (
                        <button onClick={() => toggleExpand(emp.id)} className="text-gray-400 hover:text-gray-600">
                          {isExpanded
                            ? <ChevronDownIcon className="w-4 h-4" />
                            : <ChevronRightIcon className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                    {/* Checkbox */}
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => updateRow(emp.id, { selected: e.target.checked })}
                        className="rounded"
                      />
                    </td>
                    {/* Name */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{emp.full_name}</p>
                      <p className="text-xs text-gray-400">{emp.employee_id}</p>
                    </td>
                    {/* Department */}
                    <td className="px-4 py-3 text-gray-600">{emp.department_name || '—'}</td>
                    {/* Current contract */}
                    <td className="px-4 py-3">
                      {latestContract ? (
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[effectiveStatus(latestContract.status, latestContract.end_date)]?.color || 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_CONFIG[effectiveStatus(latestContract.status, latestContract.end_date)]?.label || latestContract.status_display}
                          </span>
                          <span className="text-xs text-gray-500">{latestContract.contract_type_display}</span>
                          {latestContract.status === 'SIGNED' && (() => {
                            const days = getDaysUntilExpiry(latestContract.end_date);
                            if (days === null || days > 5) return null;
                            return (
                              <span className={`flex items-center gap-1 text-xs font-medium ${days <= 0 ? 'text-red-600' : 'text-amber-500'}`}>
                                <ExclamationTriangleIcon className="w-3 h-3 flex-shrink-0" />
                                {days <= 0 ? 'Đã hết hạn' : `Hết hạn trong ${days} ngày`}
                              </span>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Chưa có</span>
                      )}
                    </td>
                    {/* Template */}
                    <td className="px-4 py-3">
                      {row.selected ? (
                        <div className="flex flex-col gap-1">
                          <SelectBox<number>
                            label=""
                            value={row.template?.id ?? 0}
                            options={templateOptions}
                            onChange={(id) => updateRow(emp.id, { template: templates.find((t) => t.id === id) || null })}
                            placeholder="Chọn template"
                            searchable
                            portal
                          />
                          {nonFinalContracts.length > 0 && (
                            <div className="flex items-center gap-1 text-xs text-amber-600">
                              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                              Sẽ ghi đè {nonFinalContracts.length} HĐ hiện có
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300 italic">Tick chọn để điền</span>
                      )}
                    </td>
                    {/* Start date */}
                    <td className="px-4 py-3">
                      {row.selected ? (
                        <input
                          type="date"
                          value={row.start_date}
                          onChange={(e) => updateRow(emp.id, { start_date: e.target.value })}
                          className="input-field"
                        />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    {/* End date */}
                    <td className="px-4 py-3">
                      {row.selected ? (
                        <input
                          type="date"
                          value={row.end_date}
                          onChange={(e) => updateRow(emp.id, { end_date: e.target.value })}
                          className="input-field"
                        />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    {/* Result */}
                    <td className="px-4 py-3 text-center">
                      {result === 'pending' && (
                        <svg className="w-4 h-4 animate-spin text-primary-500 mx-auto" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      )}
                      {result === 'success' && <CheckCircleIcon className="w-5 h-5 text-emerald-500 mx-auto" />}
                      {result === 'error' && (
                        <div className="relative group flex justify-center">
                          <XCircleIcon className="w-5 h-5 text-red-500 cursor-help" />
                          {errMsg && (
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-red-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-20 max-w-xs">
                              {errMsg}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* Expanded history — chỉ hiện hợp đồng đã ký */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="bg-gray-50 px-6 py-4 space-y-4">

                        {/* ── Hợp đồng đang xử lý (DRAFT / PENDING_SIGN) ── */}
                        {deletableContracts.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-amber-700 mb-2">
                              Đang xử lý ({deletableContracts.length})
                            </p>
                            <table className="w-full text-xs">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="text-left pb-1 pr-4">Ngày tạo</th>
                                  <th className="text-left pb-1 pr-4">Số hợp đồng</th>
                                  <th className="text-left pb-1 pr-4">Loại hợp đồng</th>
                                  <th className="text-left pb-1 pr-4">Template</th>
                                  <th className="text-left pb-1 pr-4">Ngày bắt đầu</th>
                                  <th className="text-left pb-1 pr-4">Ngày kết thúc</th>
                                  <th className="text-left pb-1 pr-4">Trạng thái</th>
                                  <th className="text-left pb-1">Thao tác</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100">
                                {deletableContracts.map((c) => {
                                  const edit = draftEdits[c.id] ?? { templateId: c.template ?? 0, contractNumber: c.contract_number ?? '' };
                                  const isDraft = c.status === 'DRAFT';
                                  const isSaving = assigningTemplateId === c.id;
                                  return (
                                  <tr key={c.id}>
                                    <td className="py-1.5 pr-4 text-gray-600">{fmtDate(c.created_at.split('T')[0])}</td>
                                    {/* Số hợp đồng */}
                                    <td className="py-1.5 pr-4">
                                      {isDraft ? (
                                        <input
                                          type="text"
                                          value={edit.contractNumber}
                                          onChange={(e) => setDraftEdits((prev) => ({
                                            ...prev,
                                            [c.id]: { ...edit, contractNumber: e.target.value },
                                          }))}
                                          placeholder="Nhập số HĐ..."
                                          className="border border-gray-300 rounded px-2 py-0.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-primary-400"
                                        />
                                      ) : (
                                        <span className="text-gray-600">{c.contract_number || '—'}</span>
                                      )}
                                    </td>
                                    {/* Loại hợp đồng */}
                                    <td className="py-1.5 pr-4 text-gray-600">{c.contract_type_display}</td>
                                    {/* Template */}
                                    <td className="py-1.5 pr-4 min-w-[180px]">
                                      {isDraft ? (
                                        <SelectBox<number>
                                          label=""
                                          value={edit.templateId}
                                          options={templateOptions}
                                          onChange={(id) => setDraftEdits((prev) => ({
                                            ...prev,
                                            [c.id]: { ...edit, templateId: id },
                                          }))}
                                          placeholder="Chọn template..."
                                          searchable
                                          portal
                                        />
                                      ) : (
                                        <span className="text-gray-600">{c.template_name || '—'}</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-4 text-gray-600">{fmtDate(c.start_date)}</td>
                                    <td className="py-1.5 pr-4 text-gray-600">{fmtDate(c.end_date)}</td>
                                    <td className="py-1.5 pr-4">
                                      <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs ${STATUS_CONFIG[effectiveStatus(c.status, c.end_date)]?.color || ''}`}>
                                        {STATUS_CONFIG[effectiveStatus(c.status, c.end_date)]?.label || c.status}
                                      </span>
                                    </td>
                                    <td className="py-1.5">
                                      <div className="flex items-center gap-2">
                                        {c.generated_file && (
                                          <button
                                            onClick={() => setSinglePreview({ id: c.id, name: emp.full_name })}
                                            className="flex items-center gap-1 text-primary-600 hover:underline"
                                          >
                                            <EyeIcon className="w-3.5 h-3.5" />
                                            Xem PDF
                                          </button>
                                        )}
                                        {isDraft && (
                                          <button
                                            onClick={() => handleAssignTemplate(c.id, edit)}
                                            disabled={!edit.templateId || isSaving}
                                            className="flex items-center gap-1 px-2 py-0.5 text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                          >
                                            {isSaving
                                              ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                                              : <EyeIcon className="w-3 h-3" />}
                                            Lưu & Tạo PDF
                                          </button>
                                        )}
                                        {c.status === 'PENDING_SIGN' && (
                                          <button
                                            onClick={() => handleMarkSigned(c.id)}
                                            disabled={signingId === c.id}
                                            className="flex items-center gap-1 px-2 py-0.5 text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {signingId === c.id
                                              ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                                              : <CheckBadgeIcon className="w-3 h-3" />}
                                            Đã ký
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handleDeleteContract(c.id)}
                                          disabled={deletingId === c.id}
                                          className="flex items-center gap-1 px-2 py-0.5 text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {deletingId === c.id
                                            ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                                            : <TrashIcon className="w-3 h-3" />}
                                          Xóa
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* ── Hợp đồng đang hiệu lực ── */}
                        {activeContracts.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-emerald-700 mb-2">
                              Đang hiệu lực ({activeContracts.length})
                            </p>
                            <table className="w-full text-xs">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="text-left pb-1 pr-4">Ngày tạo</th>
                                  <th className="text-left pb-1 pr-4">Số hợp đồng</th>
                                  <th className="text-left pb-1 pr-4">Loại hợp đồng</th>
                                  <th className="text-left pb-1 pr-4">Template</th>
                                  <th className="text-left pb-1 pr-4">Ngày bắt đầu</th>
                                  <th className="text-left pb-1 pr-4">Ngày kết thúc</th>
                                  <th className="text-left pb-1">Thao tác</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-emerald-100">
                                {activeContracts.map((c) => {
                                  const days = getDaysUntilExpiry(c.end_date);
                                  const warn = days !== null && days <= 5;
                                  return (
                                    <tr key={c.id}>
                                      <td className="py-1.5 pr-4 text-gray-600">{fmtDate(c.created_at.split('T')[0])}</td>
                                      <td className="py-1.5 pr-4 text-gray-600">{c.contract_number || '—'}</td>
                                      <td className="py-1.5 pr-4 text-gray-600">{c.contract_type_display}</td>
                                      <td className="py-1.5 pr-4 text-gray-600">{c.template_name || '—'}</td>
                                      <td className="py-1.5 pr-4 text-gray-600">{fmtDate(c.start_date)}</td>
                                      <td className="py-1.5 pr-4">
                                        <span className={`flex items-center gap-1 ${warn ? 'text-amber-500 font-medium' : 'text-gray-600'}`}>
                                          {fmtDate(c.end_date) || '—'}
                                          {warn && <ExclamationTriangleIcon className="w-3 h-3 flex-shrink-0" title={`Hết hạn trong ${days} ngày`} />}
                                        </span>
                                      </td>
                                      <td className="py-1.5">
                                        {c.generated_file && (
                                          <button onClick={() => setSinglePreview({ id: c.id, name: emp.full_name })} className="flex items-center gap-1 text-primary-600 hover:underline">
                                            <EyeIcon className="w-3.5 h-3.5" /> Xem PDF
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

                        {/* ── Lịch sử hợp đồng cũ ── */}
                        {historicalContracts.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-2">
                              Lịch sử ({historicalContracts.length})
                            </p>
                            <table className="w-full text-xs">
                              <thead className="text-gray-400">
                                <tr>
                                  <th className="text-left pb-1 pr-4">Ngày tạo</th>
                                  <th className="text-left pb-1 pr-4">Số hợp đồng</th>
                                  <th className="text-left pb-1 pr-4">Loại hợp đồng</th>
                                  <th className="text-left pb-1 pr-4">Template</th>
                                  <th className="text-left pb-1 pr-4">Ngày bắt đầu</th>
                                  <th className="text-left pb-1 pr-4">Ngày kết thúc</th>
                                  <th className="text-left pb-1 pr-4">Trạng thái</th>
                                  <th className="text-left pb-1">Thao tác</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {historicalContracts.map((c) => {
                                  const eff = effectiveStatus(c.status, c.end_date);
                                  return (
                                    <tr key={c.id} className="opacity-75">
                                      <td className="py-1.5 pr-4 text-gray-500">{fmtDate(c.created_at.split('T')[0])}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{c.contract_number || '—'}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{c.contract_type_display}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{c.template_name || '—'}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{fmtDate(c.start_date)}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{fmtDate(c.end_date) || '—'}</td>
                                      <td className="py-1.5 pr-4">
                                        <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs ${STATUS_CONFIG[eff]?.color || ''}`}>
                                          {STATUS_CONFIG[eff]?.label || eff}
                                        </span>
                                      </td>
                                      <td className="py-1.5">
                                        <div className="flex items-center gap-2">
                                          {c.generated_file && (
                                            <button
                                              onClick={() => setSinglePreview({ id: c.id, name: emp.full_name })}
                                              className="flex items-center gap-1 text-primary-600 hover:underline"
                                            >
                                              <EyeIcon className="w-3.5 h-3.5" /> Xem PDF
                                            </button>
                                          )}
                                          <button
                                            onClick={() => handleDeleteContract(c.id)}
                                            disabled={deletingId === c.id}
                                            className="flex items-center gap-1 px-2 py-0.5 text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {deletingId === c.id
                                              ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                                              : <TrashIcon className="w-3 h-3" />}
                                            Xóa
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {activeContracts.length === 0 && historicalContracts.length === 0 && (
                          <p className="text-xs text-gray-400 italic">Chưa có lịch sử hợp đồng</p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {filteredEmployees.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search ? 'Không tìm thấy nhân viên phù hợp' : 'Không có nhân viên nào'}
          </div>
        )}
      </div>

      <MultiPdfPreviewModal
        open={showSelectedPreview}
        contracts={selectedPreviewItems}
        onClose={() => setShowSelectedPreview(false)}
      />

      <MultiPdfPreviewModal
        open={showMultiPreview}
        contracts={multiPreviewItems}
        onClose={() => setShowMultiPreview(false)}
      />

      <PdfPreviewModal
        open={!!singlePreview}
        title={singlePreview?.name}
        loader={
          singlePreview
            ? () =>
                managementApi
                  .get(`/api-hrm/employee-contracts/${singlePreview.id}/download_file/`, { responseType: 'blob' })
                  .then((r) => URL.createObjectURL(r.data))
            : null
        }
        downloadFilename={`${singlePreview?.name || 'hop-dong'}.pdf`}
        onClose={() => setSinglePreview(null)}
      />

      {placeholderModal !== null && (
        <ContractPlaceholderModal
          contractId={placeholderModal}
          onClose={() => setPlaceholderModal(null)}
          onSuccess={async () => {
            const id = placeholderModal;
            setPlaceholderModal(null);
            await fetchContractsMap();
            try {
              const { data } = await managementApi.get(`/api-hrm/employee-contracts/${id}/`);
              setCreatedContracts((prev) => prev.map((c) => (c.id === id ? data : c)));
            } catch {}
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Xóa hợp đồng"
        message="Xác nhận xóa hợp đồng này? Hành động không thể hoàn tác."
        onConfirm={() => confirmDeleteId !== null && executeDeleteContract(confirmDeleteId)}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};

export default BulkContracts;
