import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { employeesAPI, managementApi } from '../utils/api';
import { Employee } from '../utils/api/types';

interface ManagerQuotaConfig {
  eligible_employees: number[];
  eligible_employees_detail: Array<{ id: number; employee_id: string; full_name: string; department_name: string | null }>;
}

const URL = '/api-hrm/manager-explanation-quota-config/';

/**
 * Rổ gộp hạn mức giải trình: khi Cấu hình công ty tính hạn mức giải trình THEO TỪNG LOẠI,
 * những người được chọn ở đây (thường là trưởng phòng) dùng chung 1 rổ cho mọi loại thay
 * cho hạn mức từng loại. Chế độ "Chung cho mọi loại" thì danh sách không có tác dụng.
 */
const ManagerExplanationQuotaTab: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [empRes, cfg] = await Promise.all([
          employeesAPI.list({ page_size: 1000, is_active: true }),
          managementApi.get<ManagerQuotaConfig>(URL),
        ]);
        setEmployees(empRes.results);
        setSelected(cfg.data.eligible_employees);
      } catch (err: any) {
        setError(err?.response?.data?.detail || err.message || 'Không thể tải dữ liệu');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => !q || e.full_name.toLowerCase().includes(q) || e.employee_id.toLowerCase().includes(q));
  }, [employees, search]);
  const selectedEmployees = employees.filter((e) => selected.includes(e.id));

  const toggle = (id: number) => {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await managementApi.put<ManagerQuotaConfig>(URL, { eligible_employees: selected });
      setSelected(res.data.eligible_employees);
      setSaved(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Lưu thất bại');
    } finally {
      setSaving(false);
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
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-sm font-medium text-amber-800">Rổ gộp hạn mức giải trình</p>
        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
          Chỉ có tác dụng khi Cấu hình công ty tính hạn mức giải trình <strong>theo từng loại</strong>. Người được chọn dùng
          chung 1 rổ cho mọi loại (Đi muộn / Về sớm / Quên chấm công) với số lượt "Rổ gộp" trong Cấu hình công ty, thay cho
          hạn mức của từng loại.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-sm font-bold text-gray-900">Nhân viên <span className="text-xs font-normal text-gray-400">(đã chọn {selected.length})</span></p>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm tên hoặc mã NV..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <div className="border border-gray-100 rounded-xl overflow-y-auto max-h-[360px] divide-y divide-gray-50 bg-white">
            {filtered.map((e) => (
              <label key={e.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-primary-50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                  checked={selected.includes(e.id)}
                  onChange={() => toggle(e.id)}
                />
                <span className="font-mono text-[11px] text-gray-400 w-16 shrink-0">{e.employee_id}</span>
                <span className="font-medium text-gray-800 truncate">{e.full_name}</span>
              </label>
            ))}
            {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Không có kết quả</p>}
          </div>
        </div>

        <div className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-sm font-bold text-gray-900">Đang dùng rổ gộp <span className="text-xs font-normal text-gray-400">({selectedEmployees.length})</span></p>
          <div className="border border-gray-100 rounded-xl overflow-y-auto max-h-[400px] divide-y divide-gray-50 bg-white">
            {selectedEmployees.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate">
                  <span className="font-mono text-[11px] text-gray-400 mr-2">{e.employee_id}</span>
                  <span className="font-medium text-gray-800">{e.full_name}</span>
                </span>
                <button type="button" onClick={() => toggle(e.id)} className="text-xs font-semibold text-gray-400 hover:text-red-500">
                  Bỏ
                </button>
              </div>
            ))}
            {selectedEmployees.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Chưa chọn nhân viên nào</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircleIcon className="h-4 w-4" />
            Đã lưu
          </span>
        )}
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
        </button>
      </div>
    </div>
  );
};

export default ManagerExplanationQuotaTab;
