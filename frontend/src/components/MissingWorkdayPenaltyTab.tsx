import React, { useEffect, useState } from 'react';
import { TrashIcon, PlusIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { employeesAPI } from '../utils/api';
import { Employee } from '../utils/api/types';
import { SelectBox } from './LandingLayout/SelectBox';
import { formatVND } from '../utils/formatUtils';
import {
  MissingWorkdayPenalty,
  listMissingWorkdayPenalties,
  createMissingWorkdayPenalty,
  updateMissingWorkdayPenalty,
  deleteMissingWorkdayPenalty,
} from '../services/missingWorkdayPenalty.service';

const DEFAULT_BASE_AMOUNT = 10_000_000;

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** 'YYYY-MM-DD' (API) → 'YYYY-MM' (input type=month) */
const toMonthInput = (iso: string | null) => (iso ? iso.slice(0, 7) : '');
/** 'YYYY-MM' → 'YYYY-MM-01' */
const toApiMonth = (value: string) => (value ? `${value}-01` : null);
const formatMonth = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const parseAmount = (text: string) => Number(text.replace(/\D/g, '')) || 0;

const apiError = (err: any, fallback: string) => {
  const data = err?.response?.data;
  if (data && typeof data === 'object') {
    const first = Object.values(data)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (typeof first === 'string') return first;
  }
  return err?.message || fallback;
};

/**
 * Phạt thiếu công: nhân viên trong danh sách không đi đủ công chuẩn của tháng thì bảng
 * lương trừ mốc lương / công chuẩn × số công thiếu. Danh sách rỗng thì không ai bị phạt.
 */
const MissingWorkdayPenaltyTab: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<MissingWorkdayPenalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newEmployeeId, setNewEmployeeId] = useState<number | ''>('');
  const [newFrom, setNewFrom] = useState(currentMonth());
  const [newTo, setNewTo] = useState('');
  const [newAmount, setNewAmount] = useState(String(DEFAULT_BASE_AMOUNT));
  const [newNote, setNewNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [empRes, list] = await Promise.all([
          employeesAPI.list({ page_size: 1000, is_active: true }),
          listMissingWorkdayPenalties(),
        ]);
        setEmployees(empRes.results);
        setRows(list);
      } catch (err: any) {
        setError(apiError(err, 'Không thể tải dữ liệu'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = async () => {
    const amount = parseAmount(newAmount);
    if (!newEmployeeId || !newFrom || !amount) {
      setError('Vui lòng chọn nhân viên, Từ tháng và nhập mốc lương lớn hơn 0.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const row = await createMissingWorkdayPenalty({
        employee: newEmployeeId,
        from_month: toApiMonth(newFrom) as string,
        to_month: toApiMonth(newTo),
        base_amount: amount,
        note: newNote.trim(),
      });
      setRows(prev => [row, ...prev]);
      setNewEmployeeId('');
      setNewTo('');
      setNewNote('');
    } catch (err: any) {
      setError(apiError(err, 'Thêm thất bại'));
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (row: MissingWorkdayPenalty, data: Parameters<typeof updateMissingWorkdayPenalty>[1]) => {
    setSavingRowId(row.id);
    setError(null);
    try {
      const updated = await updateMissingWorkdayPenalty(row.id, data);
      setRows(prev => prev.map(r => (r.id === row.id ? updated : r)));
    } catch (err: any) {
      setError(apiError(err, 'Cập nhật thất bại'));
    } finally {
      setSavingRowId(null);
    }
  };

  const handleDelete = async (row: MissingWorkdayPenalty) => {
    if (
      !window.confirm(
        'Xoá dòng này? Bảng lương các tháng trước cũng sẽ không còn phạt thiếu công. Nếu chỉ thôi áp dụng, hãy đặt Đến tháng.',
      )
    )
      return;
    setError(null);
    try {
      await deleteMissingWorkdayPenalty(row.id);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err: any) {
      setError(apiError(err, 'Xoá thất bại'));
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
      </div>
    );
  }

  const exampleAmount = parseAmount(newAmount) || DEFAULT_BASE_AMOUNT;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-sm font-medium text-amber-800">Phạt thiếu công</p>
        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
          Nhân viên trong danh sách không đi đủ <strong>công chuẩn</strong> của tháng sẽ bị trừ trên bảng lương:{' '}
          <strong>mốc lương / công chuẩn × số công thiếu</strong>. VD công chuẩn 25, tổng công 23 → phạt{' '}
          {formatVND(Math.round((exampleAmount / 25) * 2))}. Tổng công lấy theo bản chốt công (gồm nghỉ phép có lương,
          lễ). Thường dùng cho quản lý không có lương cứng. Thôi áp dụng thì đặt <strong>Đến tháng</strong> thay vì xoá.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Form thêm mới */}
      <div className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-sm font-bold text-gray-900">Thêm nhân viên vào danh sách</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <SelectBox<number | ''>
              label="Nhân viên"
              value={newEmployeeId}
              searchable
              options={[
                { value: '', label: 'Chọn nhân viên...' },
                ...employees.map(e => ({ value: e.id, label: `${e.full_name} (${e.employee_id})` })),
              ]}
              onChange={setNewEmployeeId}
            />
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Từ tháng
            <input type="month" value={newFrom} onChange={e => setNewFrom(e.target.value)} className="input-field" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Đến tháng (không bắt buộc)
            <input
              type="month"
              value={newTo}
              min={newFrom || undefined}
              onChange={e => setNewTo(e.target.value)}
              className="input-field"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Mốc lương tính phạt (VNĐ)
            <input
              type="text"
              inputMode="numeric"
              value={parseAmount(newAmount) ? parseAmount(newAmount).toLocaleString('vi-VN') : ''}
              onChange={e => setNewAmount(e.target.value.replace(/\D/g, ''))}
              className="input-field"
            />
          </label>
          <input
            type="text"
            placeholder="Ghi chú"
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            className="input-field sm:col-span-3"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newEmployeeId || !newFrom}
            className="btn-primary disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <PlusIcon className="h-4 w-4" />
            {creating ? 'Đang thêm...' : 'Thêm'}
          </button>
        </div>
      </div>

      {/* Danh sách */}
      <div className="border border-gray-100 rounded-2xl overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-header">Nhân viên</th>
              <th className="table-header">Từ tháng</th>
              <th className="table-header">Đến tháng</th>
              <th className="table-header text-right">Mốc lương</th>
              <th className="table-header text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-gray-400">
                  Danh sách trống — không ai bị phạt thiếu công.
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="table-cell">
                    <p className="font-medium text-gray-800">
                      {r.employee_name} <span className="font-mono text-xs text-gray-400">({r.employee_code})</span>
                      {r.has_basic_salary && (
                        <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5">
                          Đang có lương cơ bản
                        </span>
                      )}
                    </p>
                    {(r.department_name || r.note) && (
                      <p className="text-xs text-gray-400 truncate max-w-xs">
                        {[r.department_name, r.note].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">{formatMonth(r.from_month)}</td>
                  <td className="px-6 py-3 whitespace-nowrap text-sm">
                    <input
                      type="month"
                      value={toMonthInput(r.to_month)}
                      min={toMonthInput(r.from_month)}
                      disabled={savingRowId === r.id}
                      onChange={e => handleUpdate(r, { to_month: toApiMonth(e.target.value) })}
                      className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs"
                    />
                    {!r.to_month && <span className="ml-2 text-xs text-emerald-600">đang áp dụng</span>}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                    {formatVND(Number(r.base_amount))}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right">
                    <button
                      onClick={() => handleDelete(r)}
                      disabled={savingRowId === r.id}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Xoá"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MissingWorkdayPenaltyTab;
