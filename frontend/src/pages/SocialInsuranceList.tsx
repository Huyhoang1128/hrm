import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { employeesAPI } from '../utils/api/hrm.api';
import { managementApi } from '../utils/api/client';
import type { Employee } from '../utils/api/types';
import Pagination from '../components/Pagination';

const PAGE_SIZE = 20;

type ImportResult = {
  summary?: {
    total?: number;
    updated?: number;
    skipped?: number;
  };
  errors?: Array<{ row?: number; employee?: string; error?: string }>;
};

type InsuranceForm = {
  social_insurance_number: string;
  tax_code: string;
  household_code: string;
  social_insurance_participation_status: '' | 'PARTICIPATING' | 'NOT_PARTICIPATING' | 'SUSPENDED';
  social_insurance_contribution_level: string;
  social_insurance_start_date: string;
  social_insurance_end_date: string;
};

const toCurrency = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${numeric.toLocaleString('vi-VN')} đ`;
};

const toDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const statusLabel = (status?: string | null) => {
  if (!status) return '—';
  if (status === 'PARTICIPATING') return 'Đang tham gia';
  if (status === 'NOT_PARTICIPATING') return 'Không tham gia';
  if (status === 'SUSPENDED') return 'Tạm dừng';
  return status;
};

const statusBadgeClass = (status?: string | null) => {
  if (status === 'PARTICIPATING') return 'bg-emerald-100 text-emerald-700';
  if (status === 'NOT_PARTICIPATING') return 'bg-gray-100 text-gray-700';
  if (status === 'SUSPENDED') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
};

const SocialInsuranceList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperUser =
    user?.is_supperuser === true ||
    user?.is_superuser === true ||
    user?.is_super_admin === true;
  const isAdmin = isSuperUser || user?.role?.toUpperCase() === 'ADMIN';

  const [items, setItems] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<InsuranceForm>({
    social_insurance_number: '',
    tax_code: '',
    household_code: '',
    social_insurance_participation_status: '',
    social_insurance_contribution_level: '',
    social_insurance_start_date: '',
    social_insurance_end_date: '',
  });

  const totalPages = useMemo(() => Math.ceil(total / PAGE_SIZE), [total]);

  const loadData = async (opts?: { page?: number; search?: string }) => {
    try {
      setLoading(true);
      const response = await employeesAPI.list({
        page: opts?.page ?? page,
        page_size: PAGE_SIZE,
        search: opts?.search ?? search,
        ordering: 'employee_id',
      });
      setItems(response.results);
      setTotal(response.count);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Không thể tải danh sách nhân sự');
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setFormData({
      social_insurance_number: employee.social_insurance_number || '',
      tax_code: employee.tax_code || '',
      household_code: employee.household_code || '',
      social_insurance_participation_status: employee.social_insurance_participation_status || '',
      social_insurance_contribution_level:
        employee.social_insurance_contribution_level !== null && employee.social_insurance_contribution_level !== undefined
          ? String(employee.social_insurance_contribution_level)
          : '',
      social_insurance_start_date: employee.social_insurance_start_date || '',
      social_insurance_end_date: employee.social_insurance_end_date || '',
    });
    setIsModalOpen(true);
  };

  const closeEditModal = () => {
    setIsModalOpen(false);
    setSelectedEmployee(null);
  };

  const handleFormChange = (key: keyof InsuranceForm, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const updateInsuranceData = async () => {
    if (!selectedEmployee) return;
    try {
      setUpdatingId(selectedEmployee.id);
      const payload = {
        social_insurance_number: formData.social_insurance_number || null,
        tax_code: formData.tax_code || null,
        household_code: formData.household_code || null,
        social_insurance_participation_status: formData.social_insurance_participation_status || null,
        social_insurance_contribution_level:
          formData.social_insurance_contribution_level === ''
            ? null
            : Number(formData.social_insurance_contribution_level),
        social_insurance_start_date: formData.social_insurance_start_date || null,
        social_insurance_end_date: formData.social_insurance_end_date || null,
      };

      await managementApi.patch(`/api-hrm/employees/${selectedEmployee.id}/`, payload);

      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedEmployee.id
            ? {
                ...item,
                social_insurance_number: payload.social_insurance_number ?? undefined,
                tax_code: payload.tax_code ?? undefined,
                household_code: payload.household_code ?? undefined,
                social_insurance_participation_status:
                  (payload.social_insurance_participation_status as Employee['social_insurance_participation_status']) ?? undefined,
                social_insurance_contribution_level: payload.social_insurance_contribution_level ?? undefined,
                social_insurance_start_date: payload.social_insurance_start_date ?? undefined,
                social_insurance_end_date: payload.social_insurance_end_date ?? undefined,
              }
            : item
        )
      );

      closeEditModal();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'Không thể cập nhật dữ liệu BHXH');
    } finally {
      setUpdatingId(null);
    }
  };

  const onModalOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && updatingId === null) {
      closeEditModal();
    }
  };

  useEffect(() => {
    if (!isModalOpen) return;

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && updatingId === null) {
        closeEditModal();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isModalOpen, updatingId]);
  useEffect(() => {
    if (!isAdmin) return;
    loadData({ page: 1 });
    setPage(1);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      loadData({ page: 1, search });
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search, isAdmin]);

  const onPickFile = () => {
    if (!isAdmin || importing) return;
    fileInputRef.current?.click();
  };

  const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !isAdmin) return;

    try {
      setImporting(true);
      setImportResult(null);
      const formData = new FormData();
      formData.append('file', file);
      const res = await managementApi.post('/api-hrm/employees/social-insurance/import/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data ?? {});
      await loadData({ page, search });
    } catch (e: any) {
      setImportResult({
        errors: [
          {
            error: e?.response?.data?.detail || e?.message || 'Import thất bại',
          },
        ],
      });
    } finally {
      setImporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900">Quản lý BHXH</h1>
        <p className="mt-2 text-sm text-gray-500">Bạn không có quyền truy cập chức năng này.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý BHXH</h1>
          <p className="text-sm text-gray-500 mt-1">Import theo mẫu 2 cột: Mã nhân viên, Mức đóng bảo hiểm (chỉ Admin).</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href="/templates/social-insurance-import-template.csv"
            download
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-white border border-emerald-300 rounded-xl hover:bg-emerald-50"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Tải file mẫu
          </a>
          <button
            onClick={onPickFile}
            disabled={importing}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-xl hover:bg-blue-50 disabled:opacity-60"
          >
            {importing ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Đang import...
              </>
            ) : (
              <>
                <ArrowUpTrayIcon className="w-4 h-4" />
                Nhập file Excel
              </>
            )}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={onImportFile}
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Tìm kiếm nhân viên</label>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Mã NV, tên, mã BHXH, mã số thuế..."
          />
        </div>
      </div>

      {importResult && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-sm">
          <p className="font-semibold text-gray-900 mb-1">Kết quả import</p>
          <p className="text-gray-700">
            Tổng: <strong>{importResult.summary?.total ?? 0}</strong> · Cập nhật: <strong>{importResult.summary?.updated ?? 0}</strong> · Bỏ qua: <strong>{importResult.summary?.skipped ?? 0}</strong>
          </p>
          {!!importResult.errors?.length && (
            <ul className="mt-2 space-y-1 text-red-600 max-h-40 overflow-y-auto">
              {importResult.errors.map((e, index) => (
                <li key={index}>
                  Dòng {e.row ?? '-'} {e.employee ? `[${e.employee}]` : ''}: {e.error || 'Lỗi không xác định'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-10 w-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mb-3">
              <ExclamationCircleIcon className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Không tải được dữ liệu</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <ArrowPathIcon className="w-6 h-6 mx-auto animate-spin mb-2" />
            Đang tải danh sách...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mã NV</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Họ tên</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mã BHXH</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mã số thuế</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mã hộ gia đình</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Trạng thái BHXH</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mức đóng BHXH</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Từ ngày</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Đến ngày</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Cập nhật BHXH</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-10 text-center text-sm text-gray-500" colSpan={10}>
                        <div className="flex flex-col items-center gap-2">
                          <ShieldCheckIcon className="w-8 h-8 text-gray-300" />
                          Chưa có dữ liệu phù hợp
                        </div>
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-primary-700">
                          <button
                            type="button"
                            onClick={() => navigate(`/dashboard/employees/${item.id}`)}
                            className="hover:underline"
                          >
                            {item.employee_id}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">{item.full_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.social_insurance_number || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.tax_code || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.household_code || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(item.social_insurance_participation_status)}`}
                          >
                            {statusLabel(item.social_insurance_participation_status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{toCurrency(item.social_insurance_contribution_level)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{toDate(item.social_insurance_start_date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{toDate(item.social_insurance_end_date)}</td>
                        <td className="px-4 py-3 text-sm">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="inline-flex items-center rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
                          >
                            Cập nhật
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t border-gray-100">
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  totalItems={total}
                  itemsPerPage={PAGE_SIZE}
                  onPageChange={(nextPage) => {
                    setPage(nextPage);
                    loadData({ page: nextPage, search });
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {isModalOpen && selectedEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={onModalOverlayClick}
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Cập nhật BHXH nhân sự</h2>
                <p className="text-sm text-gray-500">
                  {selectedEmployee.employee_id} · {selectedEmployee.full_name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                disabled={updatingId === selectedEmployee.id}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Đóng
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mã BHXH</label>
                <input
                  value={formData.social_insurance_number}
                  onChange={(e) => handleFormChange('social_insurance_number', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Nhập mã BHXH"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mã số thuế</label>
                <input
                  value={formData.tax_code}
                  onChange={(e) => handleFormChange('tax_code', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Nhập mã số thuế"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mã hộ gia đình</label>
                <input
                  value={formData.household_code}
                  onChange={(e) => handleFormChange('household_code', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Nhập mã hộ gia đình"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Trạng thái tham gia BHXH</label>
                <select
                  value={formData.social_insurance_participation_status}
                  onChange={(e) =>
                    handleFormChange('social_insurance_participation_status', e.target.value as InsuranceForm['social_insurance_participation_status'])
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">-- Chọn trạng thái --</option>
                  <option value="PARTICIPATING">Đang tham gia</option>
                  <option value="NOT_PARTICIPATING">Không tham gia</option>
                  <option value="SUSPENDED">Tạm dừng</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mức đóng BHXH</label>
                <input
                  type="number"
                  min="0"
                  value={formData.social_insurance_contribution_level}
                  onChange={(e) => handleFormChange('social_insurance_contribution_level', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Nhập mức đóng"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Từ ngày</label>
                <input
                  type="date"
                  value={formData.social_insurance_start_date}
                  onChange={(e) => handleFormChange('social_insurance_start_date', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Đến ngày</label>
                <input
                  type="date"
                  value={formData.social_insurance_end_date}
                  onChange={(e) => handleFormChange('social_insurance_end_date', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={updatingId === selectedEmployee.id}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={updateInsuranceData}
                disabled={updatingId === selectedEmployee.id}
                className="inline-flex items-center rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {updatingId === selectedEmployee.id ? 'Đang lưu...' : 'Lưu cập nhật'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialInsuranceList;
