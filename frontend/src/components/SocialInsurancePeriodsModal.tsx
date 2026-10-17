import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrashIcon, PlusIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import {
  SocialInsurancePeriod,
  listSocialInsurancePeriods,
  createSocialInsurancePeriod,
  updateSocialInsurancePeriod,
  deleteSocialInsurancePeriod,
} from '../services/socialInsurancePeriod.service';

interface Props {
  employee: { id: number; employee_id: string; full_name: string };
  onClose: (changed: boolean) => void;
}

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const toMonthInput = (iso: string | null) => (iso ? iso.slice(0, 7) : '');
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
 * Các kỳ đóng BHXH của 1 nhân viên. Đã có kỳ đóng thì bảng lương tháng nào lấy mức đóng của
 * kỳ có hiệu lực tháng đó (tháng không thuộc kỳ nào → không đóng), và mức đóng trên hồ sơ tự
 * cập nhật theo kỳ hiện hành.
 */
const SocialInsurancePeriodsModal: React.FC<Props> = ({ employee, onClose }) => {
  const [rows, setRows] = useState<SocialInsurancePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newFrom, setNewFrom] = useState(currentMonth());
  const [newTo, setNewTo] = useState('');
  const [newLevel, setNewLevel] = useState('');
  const [newNote, setNewNote] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRows(await listSocialInsurancePeriods(employee.id));
      } catch (err) {
        setError(apiError(err, 'Không tải được kỳ đóng BHXH'));
      } finally {
        setLoading(false);
      }
    })();
  }, [employee.id]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      setChanged(true);
    } catch (err) {
      setError(apiError(err, fallback));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = () =>
    run(async () => {
      const row = await createSocialInsurancePeriod({
        employee: employee.id,
        from_month: toApiMonth(newFrom) as string,
        to_month: toApiMonth(newTo),
        contribution_level: parseAmount(newLevel),
        note: newNote.trim(),
      });
      setRows((prev) => [row, ...prev].sort((a, b) => b.from_month.localeCompare(a.from_month)));
      setNewTo('');
      setNewLevel('');
      setNewNote('');
    }, 'Thêm kỳ đóng thất bại');

  const handleUpdate = (row: SocialInsurancePeriod, data: Parameters<typeof updateSocialInsurancePeriod>[1]) =>
    run(async () => {
      const updated = await updateSocialInsurancePeriod(row.id, data);
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    }, 'Cập nhật thất bại');

  const handleDelete = (row: SocialInsurancePeriod) => {
    if (!window.confirm(`Xoá kỳ đóng ${formatMonth(row.from_month)}? Bảng lương các tháng của kỳ này sẽ không còn mức đóng BHXH.`)) return;
    void run(async () => {
      await deleteSocialInsurancePeriod(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    }, 'Xoá thất bại');
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => onClose(changed)}>
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Kỳ đóng BHXH</h2>
            <p className="text-sm text-gray-500">
              {employee.employee_id} · {employee.full_name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(changed)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Đóng
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-xs text-gray-500 leading-relaxed">
            Bảng lương tháng nào lấy mức đóng của kỳ có hiệu lực tháng đó; tháng không thuộc kỳ nào thì không đóng.
            Mức đóng trên hồ sơ tự cập nhật theo kỳ hiện hành. Nhân viên chưa có kỳ nào vẫn dùng mức đóng trên hồ sơ.
          </p>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 p-4 sm:grid-cols-4 sm:items-end">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              Từ tháng
              <input type="month" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="input-field" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              Đến tháng (không bắt buộc)
              <input
                type="month"
                value={newTo}
                min={newFrom || undefined}
                onChange={(e) => setNewTo(e.target.value)}
                className="input-field"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              Mức đóng (VNĐ)
              <input
                type="text"
                inputMode="numeric"
                value={parseAmount(newLevel) ? parseAmount(newLevel).toLocaleString('vi-VN') : ''}
                onChange={(e) => setNewLevel(e.target.value.replace(/\D/g, ''))}
                className="input-field"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={saving || !newFrom || !parseAmount(newLevel)}
              className="btn-primary inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4" />
              Thêm kỳ
            </button>
            <input
              type="text"
              placeholder="Ghi chú (vd: tăng mức đóng theo HĐ mới)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="input-field sm:col-span-4"
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-100">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Từ tháng</th>
                  <th className="table-header">Đến tháng</th>
                  <th className="table-header text-right">Mức đóng</th>
                  <th className="table-header text-right">NLĐ / DN</th>
                  <th className="table-header text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400">Đang tải...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                      Chưa có kỳ đóng nào — bảng lương đang dùng mức đóng trên hồ sơ.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                        {formatMonth(r.from_month)}
                        {r.note && <p className="max-w-[12rem] truncate text-xs text-gray-400">{r.note}</p>}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <input
                          type="month"
                          value={toMonthInput(r.to_month)}
                          min={toMonthInput(r.from_month)}
                          disabled={saving}
                          onChange={(e) => void handleUpdate(r, { to_month: toApiMonth(e.target.value) })}
                          className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs"
                        />
                        {!r.to_month && <span className="ml-2 text-xs text-emerald-600">đang đóng</span>}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right text-gray-700">
                        {Number(r.contribution_level).toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right text-gray-500">
                        {Number(r.employee_rate)}% / {Number(r.employer_rate)}%
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(r)}
                          disabled={saving}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-50"
                          title="Xoá"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SocialInsurancePeriodsModal;
