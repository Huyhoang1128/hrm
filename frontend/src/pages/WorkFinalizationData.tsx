import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TableCellsIcon,
  TrashIcon,
  XMarkIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { departmentsAPI, Department } from '../utils/api';
import {
  workFinalizationService,
  WorkFinalizationRecord,
} from '../services/workFinalization.service';

type EditableField = {
  key: keyof WorkFinalizationRecord;
  label: string;
  step?: string;
};

const editableFields: EditableField[] = [
  { key: 'cong_thu_viec', label: 'Công thử việc', step: '0.5' },
  { key: 'cong_chinh_thuc', label: 'Công chính thức', step: '0.5' },
  { key: 'cong_thuc_te', label: 'Công thực tế', step: '0.5' },
  { key: 'tong_cong', label: 'Tổng công', step: '0.5' },
  { key: 'tong_phat', label: 'Tổng phạt', step: '1000' },
  { key: 'tang_ca', label: 'Tăng ca', step: '0.5' },
  { key: 'truc_toi', label: 'Trực tối', step: '0.5' },
  { key: 'lam_them_gio', label: 'Làm thêm giờ', step: '0.5' },
  { key: 'live', label: 'Live', step: '1' },
  { key: 'phu_cap_gui_xe', label: 'Phụ cấp gửi xe', step: '1000' },
];

const formatNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('vi-VN');
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN');
};

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);

const WorkFinalizationData: React.FC = () => {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [records, setRecords] = useState<WorkFinalizationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<WorkFinalizationRecord | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editLocked, setEditLocked] = useState(false);
  const [editLockNote, setEditLockNote] = useState('');
  const [newEmployeeCode, setNewEmployeeCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    departmentsAPI
      .list({ page_size: 1000 })
      .then((res) => setDepartments(res.results))
      .catch(() => setDepartments([]));
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await workFinalizationService.list({
        year: selectedYear,
        month: selectedMonth,
        records_only: true,
        ...(selectedDepartment ? { department_id: Number(selectedDepartment) } : {}),
        ...(debouncedSearchTerm ? { search: debouncedSearchTerm } : {}),
      });
      setRecords(res.results);
    } catch (err: any) {
      setRecords([]);
      setError(err?.response?.data?.error || 'Không thể tải data chốt công.');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, selectedDepartment, debouncedSearchTerm]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const totals = useMemo(
    () =>
      records.reduce(
        (acc, record) => {
          acc.tongCong += Number(record.tong_cong || 0);
          acc.tongPhat += Number(record.tong_phat || 0);
          return acc;
        },
        { tongCong: 0, tongPhat: 0 }
      ),
    [records]
  );

  const openEdit = (record: WorkFinalizationRecord) => {
    const values: Record<string, string> = {};
    editableFields.forEach((field) => {
      const value = record[field.key];
      values[field.key] = value === null || value === undefined ? '' : String(value);
    });
    setEditingRecord(record);
    setEditValues(values);
    setEditLocked(!!record.is_locked);
    setEditLockNote(record.lock_note || '');
    setError(null);
    setSuccess(null);
  };

  const closeEdit = () => {
    setEditingRecord(null);
    setEditValues({});
  };

  const handleSave = async () => {
    if (!editingRecord) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, number | string | boolean | null> = {};
      editableFields.forEach((field) => {
        const raw = editValues[field.key] ?? '';
        if (raw !== '') payload[field.key] = Number(raw);
      });
      // Khoá đi cùng request sửa số: "chốt công tất cả" không chen vào giữa được
      payload.is_locked = editLocked;
      if (editLocked) payload.lock_note = editLockNote.trim();

      const updated = await workFinalizationService.update(
        editingRecord.ma_nv,
        selectedYear,
        selectedMonth,
        payload as any
      );
      setRecords((prev) => prev.map((record) => (record.id === updated.id ? updated : record)));
      setSuccess(`Đã cập nhật data chốt công cho ${updated.ma_nv} - ${updated.ho_va_ten}.`);
      closeEdit();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.response?.data?.error || 'Không thể lưu data chốt công.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const employeeCode = newEmployeeCode.trim();
    if (!employeeCode) return;

    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await workFinalizationService.finalize({
        employee_code: employeeCode,
        year: selectedYear,
        month: selectedMonth,
      });
      setNewEmployeeCode('');
      setSuccess(`${res.created ? 'Đã tạo' : 'Đã cập nhật'} data chốt công cho ${res.data.ma_nv} - ${res.data.ho_va_ten}.`);
      await loadRecords();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Không thể tạo data chốt công cho mã nhân viên này.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (record: WorkFinalizationRecord) => {
    if (!window.confirm(`Xóa data chốt công của ${record.ma_nv} - ${record.ho_va_ten} tháng ${selectedMonth}/${selectedYear}?`)) {
      return;
    }
    setDeletingCode(record.ma_nv);
    setError(null);
    setSuccess(null);
    try {
      await workFinalizationService.delete(record.ma_nv, selectedYear, selectedMonth);
      setRecords((prev) => prev.filter((item) => item.id !== record.id));
      setSuccess(`Đã xóa data chốt công của ${record.ma_nv}.`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.response?.data?.error || 'Không thể xóa data chốt công.');
    } finally {
      setDeletingCode(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TableCellsIcon className="h-6 w-6 text-primary-600" />
            <h1 className="text-2xl font-semibold text-gray-900">Data chốt công</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Xem, sửa tay, khoá hoặc xoá dữ liệu chốt công theo tháng, phòng ban và nhân viên.
          </p>
        </div>
        <button
          type="button"
          onClick={loadRecords}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-600">Tháng</span>
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(Number(event.target.value))}
              className="w-full rounded-md border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500"
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  Tháng {month}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-600">Năm</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="w-full rounded-md border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 xl:col-span-2">
            <span className="text-xs font-medium text-gray-600">Phòng ban</span>
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="w-full rounded-md border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500"
            >
              <option value="">Tất cả phòng ban</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-600">Tìm nhân viên</span>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Mã hoặc tên"
                className="w-full rounded-md border-gray-300 pl-9 text-sm focus:border-primary-500 focus:ring-primary-500"
              />
            </div>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 md:flex-row md:items-end md:justify-between">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Số dòng</p>
              <p className="font-semibold text-gray-900">{formatNumber(records.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Tổng công</p>
              <p className="font-semibold text-primary-700">{formatNumber(totals.tongCong)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Tổng phạt</p>
              <p className="font-semibold text-red-600">{formatNumber(totals.tongPhat)}</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
            <input
              value={newEmployeeCode}
              onChange={(event) => setNewEmployeeCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreate();
              }}
              placeholder="Mã NV để tạo/chốt"
              className="rounded-md border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !newEmployeeCode.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
              Tạo data
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ExclamationCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-gray-500">NV</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-gray-500">Phòng ban</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-gray-500">Công TT</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-gray-500">Tổng công</th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase text-gray-500">Khoá</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-gray-500">Phạt</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-gray-500">Tăng ca</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-gray-500">Cập nhật</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-gray-500">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    <ArrowPathIcon className="mx-auto mb-2 h-6 w-6 animate-spin text-primary-500" />
                    Đang tải data chốt công...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    Không có data chốt công phù hợp bộ lọc.
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      <p className="font-medium text-gray-900">{record.ho_va_ten}</p>
                      <p className="font-mono text-xs text-gray-500">{record.ma_nv}</p>
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      <p>{record.phong_ban || '-'}</p>
                      <p className="text-xs text-gray-400">{record.vi_tri || '-'}</p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(record.cong_thuc_te)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-primary-700">{formatNumber(record.tong_cong)}</td>
                    <td className="px-3 py-3 text-center">
                      {record.is_locked ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                          title={[record.lock_note, record.locked_by && `Khoá bởi ${record.locked_by}`].filter(Boolean).join(' · ')}
                        >
                          <LockClosedIcon className="h-3.5 w-3.5" />
                          Đã khoá
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-600">{formatNumber(record.tong_phat)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(record.tang_ca)}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{formatDateTime(record.finalized_at)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(record)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-primary-50 hover:text-primary-700"
                          title="Sửa"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(record)}
                          disabled={deletingCode === record.ma_nv}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Xóa"
                        >
                          {deletingCode === record.ma_nv ? (
                            <ArrowPathIcon className="h-4 w-4 animate-spin" />
                          ) : (
                            <TrashIcon className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeEdit}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Sửa data chốt công</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {editingRecord.ma_nv} - {editingRecord.ho_va_ten} · Tháng {selectedMonth}/{selectedYear}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {editableFields.map((field) => (
                  <label key={field.key} className="space-y-1">
                    <span className="text-xs font-medium text-gray-600">{field.label}</span>
                    <input
                      type="number"
                      step={field.step || '0.01'}
                      value={editValues[field.key] ?? ''}
                      onChange={(event) =>
                        setEditValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      className="w-full rounded-md border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={editLocked}
                    onChange={(event) => setEditLocked(event.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span>
                    <span className="font-medium">Khoá số công</span>
                    <span className="block text-xs text-gray-500">
                      Đã khoá thì "Chốt công" / "Chốt công tất cả" sẽ bỏ qua bản ghi này, không ghi đè số đã sửa tay.
                    </span>
                  </span>
                </label>
                {editLocked && (
                  <input
                    type="text"
                    value={editLockNote}
                    onChange={(event) => setEditLockNote(event.target.value)}
                    placeholder="Lý do khoá (vd thoả thuận riêng về số công)"
                    className="mt-3 w-full rounded-md border-gray-300 text-sm focus:border-amber-500 focus:ring-amber-500"
                  />
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkFinalizationData;
