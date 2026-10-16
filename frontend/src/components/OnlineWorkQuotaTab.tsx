import React, { useEffect, useState } from 'react';
import {
  BuildingOfficeIcon,
  BriefcaseIcon,
  UserIcon,
  TrashIcon,
  PlusIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { departmentsAPI, employeesAPI, positionsAPI } from '../utils/api';
import { Department, Position, Employee } from '../utils/api/types';
import { SelectBox } from './LandingLayout/SelectBox';
import {
  listOnlineWorkQuotaOverrides,
  createOnlineWorkQuotaOverride,
  updateOnlineWorkQuotaOverride,
  deleteOnlineWorkQuotaOverride,
  OnlineWorkQuotaOverride,
  OnlineWorkQuotaScope,
} from '../services/onlineWorkQuota.service';

const SCOPE_TABS: { key: OnlineWorkQuotaScope; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'employee', label: 'Nhân viên', icon: UserIcon },
  { key: 'position', label: 'Vị trí', icon: BriefcaseIcon },
  { key: 'department', label: 'Phòng ban', icon: BuildingOfficeIcon },
];

/** 0 → 10 ngày, bước 0,5 (khớp CompanyConfig cho phép nửa ngày). */
const QUOTA_OPTIONS: { value: number; label: string }[] = Array.from({ length: 21 }, (_, i) => i / 2).map((n) => ({
  value: n,
  label: n === 0 ? 'Không có ngày online' : `Tối đa ${String(n).replace('.', ',')} ngày online`,
}));

function scopeIcon(o: OnlineWorkQuotaOverride) {
  if (o.employee) return UserIcon;
  if (o.position) return BriefcaseIcon;
  return BuildingOfficeIcon;
}

function scopeLabel(o: OnlineWorkQuotaOverride): string {
  if (o.employee_detail) return `${o.employee_detail.full_name} (${o.employee_detail.employee_id})`;
  if (o.position_detail) return `Vị trí: ${o.position_detail.title}`;
  if (o.department_detail) return `Phòng ban: ${o.department_detail.name}`;
  return '—';
}

const OnlineWorkQuotaTab: React.FC = () => {
  const [overrides, setOverrides] = useState<OnlineWorkQuotaOverride[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newScope, setNewScope] = useState<OnlineWorkQuotaScope>('employee');
  const [newTargetId, setNewTargetId] = useState<number | ''>('');
  const [newQuota, setNewQuota] = useState<number>(1);
  const [creating, setCreating] = useState(false);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [deptRes, posRes, empRes, overrideList] = await Promise.all([
        departmentsAPI.list({ page_size: 500 }),
        positionsAPI.list({ page_size: 500 }),
        employeesAPI.list({ page_size: 1000, is_active: true }),
        listOnlineWorkQuotaOverrides(),
      ]);
      setDepartments(deptRes.results);
      setPositions(posRes.results);
      setEmployees(empRes.results);
      setOverrides(overrideList);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Không thể tải dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const targetOptions =
    newScope === 'employee'
      ? employees.map(e => ({ value: e.id, label: `${e.full_name} (${e.employee_id})` }))
      : newScope === 'position'
      ? positions.map(p => ({ value: p.id, label: p.title }))
      : departments.map(d => ({ value: d.id, label: d.name }));

  const handleCreate = async () => {
    if (!newTargetId) {
      setError('Vui lòng chọn đối tượng áp dụng.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const payload = {
        employee: newScope === 'employee' ? (newTargetId as number) : null,
        position: newScope === 'position' ? (newTargetId as number) : null,
        department: newScope === 'department' ? (newTargetId as number) : null,
        max_online_days: newQuota,
      };
      const created = await createOnlineWorkQuotaOverride(payload);
      setOverrides(prev => [created, ...prev]);
      setNewTargetId('');
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.response?.data?.non_field_errors?.[0] || err.message || 'Thêm thất bại');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateQuota = async (id: number, quota: number) => {
    setSavingRowId(id);
    setError(null);
    try {
      const updated = await updateOnlineWorkQuotaOverride(id, { max_online_days: quota });
      setOverrides(prev => prev.map(o => (o.id === id ? updated : o)));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Cập nhật thất bại');
    } finally {
      setSavingRowId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Xoá ghi đè hạn mức này? Đối tượng sẽ quay về hạn mức mặc định.')) return;
    setError(null);
    try {
      await deleteOnlineWorkQuotaOverride(id);
      setOverrides(prev => prev.filter(o => o.id !== id));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Xoá thất bại');
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
        <p className="text-sm font-medium text-amber-800">Hạn mức số ngày làm online</p>
        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
          Mặc định: theo Cấu hình công ty (số ngày làm việc online tối đa/tháng). Thêm ghi đè bên dưới để
          áp dụng hạn mức khác cho 1 nhân viên/vị trí/phòng ban cụ thể — ưu tiên: nhân viên &gt; vị
          trí &gt; phòng ban &gt; mặc định.
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
        <p className="text-sm font-bold text-gray-900">Thêm ghi đè mới</p>
        <div className="flex border-b border-gray-200">
          {SCOPE_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setNewScope(tab.key);
                setNewTargetId('');
              }}
              className={`flex items-center gap-2 py-2.5 px-4 text-sm font-medium border-b-2 transition-colors ${
                newScope === tab.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2">
            <SelectBox<number | ''>
              label={SCOPE_TABS.find(t => t.key === newScope)?.label || ''}
              value={newTargetId}
              searchable
              options={[{ value: '', label: 'Chọn đối tượng...' }, ...targetOptions]}
              onChange={setNewTargetId}
            />
          </div>
          <div>
            <SelectBox<number>
              label="Hạn mức"
              value={newQuota}
              options={QUOTA_OPTIONS}
              onChange={setNewQuota}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newTargetId}
            className="btn-primary disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <PlusIcon className="h-4 w-4" />
            {creating ? 'Đang thêm...' : 'Thêm ghi đè'}
          </button>
        </div>
      </div>

      {/* Danh sách ghi đè hiện tại */}
      <div className="border border-gray-100 rounded-2xl overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-header">Đối tượng</th>
              <th className="table-header">Hạn mức</th>
              <th className="table-header text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {overrides.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-400">
                  Chưa có ghi đè nào — tất cả nhân viên đang dùng hạn mức mặc định.
                </td>
              </tr>
            ) : (
              overrides.map(o => {
                const Icon = scopeIcon(o);
                return (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-gray-400 shrink-0" />
                        <span className="font-medium text-gray-800">{scopeLabel(o)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <SelectBox<number>
                        label=""
                        value={Number(o.max_online_days)}
                        options={QUOTA_OPTIONS}
                        onChange={v => handleUpdateQuota(o.id, v)}
                      />
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleDelete(o.id)}
                        disabled={savingRowId === o.id}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Xoá"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OnlineWorkQuotaTab;
