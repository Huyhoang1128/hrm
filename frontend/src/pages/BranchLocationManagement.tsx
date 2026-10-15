import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  InformationCircleIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { branchLocationService, BranchLocation, BranchLocationPayload } from '../services/branchLocation.service';
import { companyUnitsAPI, CompanyUnit } from '../utils/api';

const EMPTY_FORM: BranchLocationPayload = {
  name: '', company_unit: null, address: '', latitude: '', longitude: '', radius_meters: 100, is_active: true,
};

const getApiError = (error: any) => {
  const data = error?.response?.data;
  if (!data) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  if (typeof data === 'string') return data;
  const first = Object.values(data)[0];
  return Array.isArray(first) ? String(first[0]) : String(first || data.detail || 'Dữ liệu không hợp lệ.');
};

export default function BranchLocationManagement() {
  const [locations, setLocations] = useState<BranchLocation[]>([]);
  const [companyUnits, setCompanyUnits] = useState<CompanyUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BranchLocation | null>(null);
  const [form, setForm] = useState<BranchLocationPayload>(EMPTY_FORM);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [locationData, unitData] = await Promise.all([
        branchLocationService.list(), companyUnitsAPI.list({ active_only: true, page_size: 500 }),
      ]);
      setLocations(locationData);
      setCompanyUnits(unitData.results || []);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  };

  const openEdit = (item: BranchLocation) => {
    setEditing(item);
    setForm({
      name: item.name, company_unit: item.company_unit, address: item.address || '',
      latitude: String(item.latitude), longitude: String(item.longitude),
      radius_meters: item.radius_meters, is_active: item.is_active,
    });
    setError('');
    setShowForm(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) await branchLocationService.update(editing.id, form);
      else await branchLocationService.create(form);
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: BranchLocation) => {
    if (!window.confirm(`Xóa vị trí chấm công “${item.name}”?`)) return;
    try {
      await branchLocationService.remove(item.id);
      setLocations((current) => current.filter((location) => location.id !== item.id));
    } catch (err) {
      setError(getApiError(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Vị trí chấm công</h1>
          <p className="mt-1 text-sm text-gray-500">Cấu hình tọa độ và bán kính cho phép chấm công tại từng cơ sở.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
          <PlusIcon className="h-5 w-5" /> Thêm vị trí
        </button>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="flex gap-3">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 flex-none" />
          <div>
            <p className="font-bold">Cách lấy kinh độ, vĩ độ từ Google Maps</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-blue-800">
              <li>Mở Google Maps và tìm đúng địa điểm cần cấu hình.</li>
              <li>Nhấp chuột phải vào điểm trên bản đồ; dòng đầu tiên có dạng <b>10.7769, 106.7009</b>.</li>
              <li>Nhấp vào dòng tọa độ để sao chép. Số đầu là <b>vĩ độ</b>, số sau là <b>kinh độ</b>.</li>
            </ol>
            <a href="https://maps.google.com" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">
              Mở Google Maps <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>

      {error && !showForm && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">Đang tải dữ liệu...</div>
        ) : locations.length === 0 ? (
          <div className="py-16 text-center"><MapPinIcon className="mx-auto h-10 w-10 text-gray-300" /><p className="mt-2 text-sm text-gray-500">Chưa có vị trí chấm công.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"><tr>
                <th className="px-5 py-3">Cơ sở</th><th className="px-5 py-3">Tọa độ</th><th className="px-5 py-3">Bán kính</th><th className="px-5 py-3">Trạng thái</th><th className="px-5 py-3 text-right">Thao tác</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {locations.map((item) => <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-5 py-4"><p className="font-semibold text-gray-900">{item.name}</p><p className="mt-0.5 text-xs text-gray-500">{item.company_unit_name || item.address || 'Chưa gắn đơn vị'}</p></td>
                  <td className="px-5 py-4 font-mono text-xs text-gray-700">{item.latitude}, {item.longitude}</td>
                  <td className="px-5 py-4 text-gray-700">{item.radius_meters} m</td>
                  <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{item.is_active ? 'Hoạt động' : 'Tạm tắt'}</span></td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2"><button onClick={() => openEdit(item)} title="Sửa" className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"><PencilIcon className="h-4 w-4" /></button><button onClick={() => remove(item)} title="Xóa" className="rounded-lg p-2 text-red-600 hover:bg-red-50"><TrashIcon className="h-4 w-4" /></button></div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-lg font-bold text-gray-900">{editing ? 'Sửa vị trí chấm công' : 'Thêm vị trí chấm công'}</h2><button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button></div>
          <form onSubmit={submit} className="space-y-4 p-6">
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div><label className="mb-1 block text-sm font-semibold text-gray-700">Tên cơ sở *</label><input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border-gray-300" placeholder="Ví dụ: Chi nhánh Quận 1" /></div>
            <div><label className="mb-1 block text-sm font-semibold text-gray-700">Đơn vị/Chi nhánh</label><select value={form.company_unit ?? ''} onChange={(e) => setForm({ ...form, company_unit: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-xl border-gray-300"><option value="">Không gắn đơn vị</option>{companyUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></div>
            <div><label className="mb-1 block text-sm font-semibold text-gray-700">Địa chỉ</label><input maxLength={500} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-xl border-gray-300" placeholder="Địa chỉ đầy đủ của cơ sở" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-sm font-semibold text-gray-700">Vĩ độ *</label><input required type="number" min="-90" max="90" step="0.0000001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="w-full rounded-xl border-gray-300" placeholder="10.7769000" /></div>
              <div><label className="mb-1 block text-sm font-semibold text-gray-700">Kinh độ *</label><input required type="number" min="-180" max="180" step="0.0000001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="w-full rounded-xl border-gray-300" placeholder="106.7009000" /></div>
            </div>
            <div><label className="mb-1 block text-sm font-semibold text-gray-700">Bán kính cho phép (mét) *</label><input required type="number" min="1" value={form.radius_meters} onChange={(e) => setForm({ ...form, radius_meters: Number(e.target.value) })} className="w-full rounded-xl border-gray-300" /><p className="mt-1 text-xs text-gray-500">Nhân viên phải ở trong bán kính này mới chấm công được.</p></div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="rounded border-gray-300 text-primary-600" />Đang hoạt động</label>
            <div className="flex justify-end gap-3 border-t pt-4"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Hủy</button><button disabled={saving} className="rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu cấu hình'}</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
