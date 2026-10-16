import React, { useEffect, useState } from 'react';
import { TrashIcon, PlusIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { employeesAPI } from '../utils/api';
import { Employee } from '../utils/api/types';
import { SelectBox } from './LandingLayout/SelectBox';
import {
  ChildCareRegime,
  listChildCareRegimes,
  createChildCareRegime,
  updateChildCareRegime,
  deleteChildCareRegime,
} from '../services/childCareRegime.service';

/** 15 → 120 phút, bước 15 (mặc định 60). */
const MINUTE_OPTIONS: { value: number; label: string }[] = Array.from({ length: 8 }, (_, i) => (i + 1) * 15).map(n => ({
  value: n,
  label: `${n} phút`,
}));

const firstDayOfMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};

const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');

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
 * Chế độ con nhỏ: Admin/HCNS chọn người hưởng kèm khoảng ngày và số phút N; trong
 * khoảng đó mỗi ngày được đi muộn tối đa N phút và về sớm tối đa N phút (mỗi chiều)
 * mà không tính lỗi / phạt. Phần vượt N phút tính như bình thường.
 */
const ChildCareRegimeTab: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [regimes, setRegimes] = useState<ChildCareRegime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newEmployeeId, setNewEmployeeId] = useState<number | ''>('');
  const [newStart, setNewStart] = useState(firstDayOfMonth());
  const [newEnd, setNewEnd] = useState('');
  const [newMinutes, setNewMinutes] = useState(60);
  const [newNote, setNewNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [empRes, rows] = await Promise.all([
          employeesAPI.list({ page_size: 1000, is_active: true }),
          listChildCareRegimes(),
        ]);
        setEmployees(empRes.results);
        setRegimes(rows);
      } catch (err: any) {
        setError(apiError(err, 'Không thể tải dữ liệu'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = async () => {
    if (!newEmployeeId || !newStart) {
      setError('Vui lòng chọn nhân viên và Từ ngày.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const row = await createChildCareRegime({
        employee: newEmployeeId,
        start_date: newStart,
        end_date: newEnd || null,
        allowance_minutes: newMinutes,
        note: newNote.trim(),
      });
      setRegimes(prev => [row, ...prev]);
      setNewEmployeeId('');
      setNewEnd('');
      setNewNote('');
    } catch (err: any) {
      setError(apiError(err, 'Thêm thất bại'));
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (row: ChildCareRegime, data: Parameters<typeof updateChildCareRegime>[1]) => {
    setSavingRowId(row.id);
    setError(null);
    try {
      const updated = await updateChildCareRegime(row.id, data);
      setRegimes(prev => prev.map(r => (r.id === row.id ? updated : r)));
    } catch (err: any) {
      setError(apiError(err, 'Cập nhật thất bại'));
    } finally {
      setSavingRowId(null);
    }
  };

  const handleDelete = async (row: ChildCareRegime) => {
    if (
      !window.confirm(
        'Xoá dòng này? Khi tính lại công, các tháng trước cũng sẽ mất chế độ. Nếu chỉ hết chế độ, hãy đặt Đến ngày.',
      )
    )
      return;
    setError(null);
    try {
      await deleteChildCareRegime(row.id);
      setRegimes(prev => prev.filter(r => r.id !== row.id));
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

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-pink-50 border border-pink-200 rounded-xl px-4 py-3">
        <p className="text-sm font-medium text-pink-800">Chế độ con nhỏ</p>
        <p className="text-xs text-pink-700 mt-0.5 leading-relaxed">
          Trong khoảng ngày được chọn, mỗi ngày nhân viên được <strong>đi muộn tối đa N phút</strong> và{' '}
          <strong>về sớm tối đa N phút</strong> mà không tính lỗi, không bị phạt. Phần vượt N phút tính như bình
          thường. Hết chế độ thì đặt <strong>Đến ngày</strong> thay vì xoá, để tính lại công các tháng trước vẫn đúng.
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
        <p className="text-sm font-bold text-gray-900">Thêm người hưởng chế độ</p>
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
            Từ ngày
            <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} className="input-field" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Đến ngày (không bắt buộc)
            <input
              type="date"
              value={newEnd}
              min={newStart || undefined}
              onChange={e => setNewEnd(e.target.value)}
              className="input-field"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <SelectBox<number> label="Số phút mỗi chiều" value={newMinutes} options={MINUTE_OPTIONS} onChange={setNewMinutes} />
          </div>
          <input
            type="text"
            placeholder="Ghi chú (vd: con sinh 05/2026)"
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            className="input-field sm:col-span-3"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newEmployeeId || !newStart}
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
              <th className="table-header">Từ ngày</th>
              <th className="table-header">Đến ngày</th>
              <th className="table-header">Số phút</th>
              <th className="table-header text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {regimes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-gray-400">
                  Chưa có ai hưởng chế độ con nhỏ.
                </td>
              </tr>
            ) : (
              regimes.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="table-cell">
                    <p className="font-medium text-gray-800">
                      {r.employee_name} <span className="font-mono text-xs text-gray-400">({r.employee_code})</span>
                    </p>
                    {(r.department_name || r.note) && (
                      <p className="text-xs text-gray-400 truncate max-w-xs">
                        {[r.department_name, r.note].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">{formatDate(r.start_date)}</td>
                  <td className="px-6 py-3 whitespace-nowrap text-sm">
                    <input
                      type="date"
                      value={r.end_date ?? ''}
                      min={r.start_date}
                      disabled={savingRowId === r.id}
                      onChange={e => handleUpdate(r, { end_date: e.target.value || null })}
                      className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs"
                    />
                    {!r.end_date && <span className="ml-2 text-xs text-emerald-600">chưa kết thúc</span>}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <SelectBox<number>
                      label=""
                      value={r.allowance_minutes}
                      options={
                        MINUTE_OPTIONS.some(o => o.value === r.allowance_minutes)
                          ? MINUTE_OPTIONS
                          : [{ value: r.allowance_minutes, label: `${r.allowance_minutes} phút` }, ...MINUTE_OPTIONS]
                      }
                      onChange={v => handleUpdate(r, { allowance_minutes: v })}
                    />
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

export default ChildCareRegimeTab;
