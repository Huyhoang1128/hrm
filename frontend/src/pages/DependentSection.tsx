import React, { useState, useEffect } from 'react';
import {
  UsersIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import {
  employeeDependentsAPI,
  type EmployeeDependent,
  type EmployeeDependentPayload,
} from '../utils/api';
import ConfirmDialog from '../components/ConfirmDialog';

// Đồng bộ với DEPENDENT_RELATIONSHIP bên backend (employee/models.py)
const RELATIONSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: 'CHILD', label: 'Con' },
  { value: 'SPOUSE', label: 'Vợ/Chồng' },
  { value: 'PARENT', label: 'Cha/Mẹ' },
  { value: 'SIBLING', label: 'Anh/Chị/Em' },
  { value: 'GRANDPARENT', label: 'Ông/Bà' },
  { value: 'OTHER', label: 'Khác' },
];

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

type FormState = {
  full_name: string;
  date_of_birth: string;
  relationship: string;
  personal_identification_number: string;
  tax_code: string;
  nationality: string;
  dependent_from: string;
  dependent_to: string;
  is_active: boolean;
  notes: string;
};

const EMPTY_FORM: FormState = {
  full_name: '',
  date_of_birth: '',
  relationship: '',
  personal_identification_number: '',
  tax_code: '',
  nationality: '',
  dependent_from: '',
  dependent_to: '',
  is_active: true,
  notes: '',
};

interface DependentSectionProps {
  employeeId: number;
  /** Chỉ admin/HR mới được thêm/sửa/xoá — khớp với DependentWritePermission ở backend */
  canManage: boolean;
}

const DependentSection: React.FC<DependentSectionProps> = ({ employeeId, canManage }) => {
  const [items, setItems] = useState<EmployeeDependent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeDependent | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<EmployeeDependent | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadDependents();
  }, [employeeId]);

  const loadDependents = async () => {
    setLoading(true);
    try {
      const res = await employeeDependentsAPI.list({ employee: employeeId, page_size: 100 });
      setItems(res.results || []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.response?.data?.detail || 'Không tải được danh sách người phụ thuộc');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (item: EmployeeDependent) => {
    setEditing(item);
    setForm({
      full_name: item.full_name || '',
      date_of_birth: item.date_of_birth || '',
      relationship: item.relationship || '',
      personal_identification_number: item.personal_identification_number || '',
      tax_code: item.tax_code || '',
      nationality: item.nationality || '',
      dependent_from: item.dependent_from || '',
      dependent_to: item.dependent_to || '',
      is_active: item.is_active,
      notes: item.notes || '',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setFormError('Vui lòng nhập họ tên người phụ thuộc.');
      return;
    }
    setSaving(true);
    setFormError(null);

    // Field trống gửi null để backend hiểu là "chưa có", không phải chuỗi rỗng
    const payload: EmployeeDependentPayload = {
      full_name: form.full_name.trim(),
      date_of_birth: form.date_of_birth || null,
      relationship: form.relationship || null,
      personal_identification_number: form.personal_identification_number.trim() || null,
      tax_code: form.tax_code.trim() || null,
      nationality: form.nationality.trim() || null,
      dependent_from: form.dependent_from || null,
      dependent_to: form.dependent_to || null,
      is_active: form.is_active,
      notes: form.notes.trim(),
    };

    try {
      if (editing) {
        await employeeDependentsAPI.update(editing.id, payload);
      } else {
        await employeeDependentsAPI.create({ ...payload, employee_id: employeeId });
      }
      setModalOpen(false);
      await loadDependents();
    } catch (err: any) {
      const data = err?.response?.data;
      // DRF trả lỗi theo field — gộp lại thành 1 dòng cho gọn
      const msg =
        data?.detail ||
        (data && typeof data === 'object'
          ? Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
              .join(' | ')
          : 'Không lưu được. Vui lòng thử lại.');
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await employeeDependentsAPI.delete(confirmDelete.id);
      setItems((prev) => prev.filter((d) => d.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không xoá được người phụ thuộc');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
            <UsersIcon className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-bold text-gray-900">
            Người phụ thuộc (giảm trừ gia cảnh)
            {items.length > 0 && (
              <span className="ml-2 text-xs font-medium text-gray-500">{items.length} người</span>
            )}
          </h3>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-xs font-medium transition-colors"
          >
            <PlusIcon className="h-4 w-4" /> Thêm
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <ArrowPathIcon className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Đang tải...</span>
        </div>
      ) : loadError ? (
        <div className="py-6 text-center">
          <p className="text-sm text-red-600 mb-2">{loadError}</p>
          <button
            onClick={loadDependents}
            className="px-3 py-1.5 bg-red-600 text-white rounded-xl hover:bg-red-700 text-xs font-medium"
          >
            Thử lại
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400 italic">Chưa có người phụ thuộc</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-semibold">Họ và tên</th>
                <th className="py-2 pr-3 font-semibold">Quan hệ</th>
                <th className="py-2 pr-3 font-semibold">Ngày sinh</th>
                <th className="py-2 pr-3 font-semibold">CCCD/Mã định danh</th>
                <th className="py-2 pr-3 font-semibold">MST</th>
                <th className="py-2 pr-3 font-semibold">Giảm trừ từ</th>
                <th className="py-2 pr-3 font-semibold">Đến</th>
                <th className="py-2 pr-3 font-semibold">Trạng thái</th>
                {canManage && <th className="py-2 font-semibold text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="py-2.5 pr-3 font-medium text-gray-900">{d.full_name}</td>
                  <td className="py-2.5 pr-3 text-gray-700">{d.relationship_display || '—'}</td>
                  <td className="py-2.5 pr-3 text-gray-700">{fmtDate(d.date_of_birth)}</td>
                  <td className="py-2.5 pr-3 text-gray-700">{d.personal_identification_number || '—'}</td>
                  <td className="py-2.5 pr-3 text-gray-700">{d.tax_code || '—'}</td>
                  <td className="py-2.5 pr-3 text-gray-700">{fmtDate(d.dependent_from)}</td>
                  <td className="py-2.5 pr-3 text-gray-700">{fmtDate(d.dependent_to)}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`px-2 py-0.5 rounded-lg text-xs font-medium ${
                        d.is_active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {d.is_active ? 'Đang hiệu lực' : 'Ngừng'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(d)}
                        className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        title="Sửa"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(d)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xoá"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal thêm/sửa ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h4 className="text-base font-bold text-gray-900">
                {editing ? 'Sửa người phụ thuộc' : 'Thêm người phụ thuộc'}
              </h4>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5">
              {formError && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Họ và tên <span className="text-red-500">*</span>
                  </label>
                  <input
                    name="full_name"
                    value={form.full_name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Mối quan hệ</label>
                  <select
                    name="relationship"
                    value={form.relationship}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">— Chọn —</option>
                    {RELATIONSHIP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Ngày sinh</label>
                  <input
                    type="date"
                    name="date_of_birth"
                    value={form.date_of_birth}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Số CCCD/Mã định danh
                  </label>
                  <input
                    name="personal_identification_number"
                    value={form.personal_identification_number}
                    onChange={handleChange}
                    maxLength={20}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Mã số thuế</label>
                  <input
                    name="tax_code"
                    value={form.tax_code}
                    onChange={handleChange}
                    maxLength={20}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Quốc tịch</label>
                  <input
                    name="nationality"
                    value={form.nationality}
                    onChange={handleChange}
                    maxLength={100}
                    placeholder="Việt Nam"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Ghi chú</label>
                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Giảm trừ từ ngày
                  </label>
                  <input
                    type="date"
                    name="dependent_from"
                    value={form.dependent_from}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Giảm trừ đến ngày
                  </label>
                  <input
                    type="date"
                    name="dependent_to"
                    value={form.dependent_to}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="col-span-2 flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="dependent_is_active"
                    name="is_active"
                    checked={form.is_active}
                    onChange={handleChange}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="dependent_is_active" className="text-sm text-gray-700">
                    Đang hiệu lực
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 text-sm font-medium"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-medium disabled:opacity-60"
                >
                  {saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        variant="danger"
        title="Xoá người phụ thuộc"
        message={`Bạn có chắc muốn xoá "${confirmDelete?.full_name}"? Bản ghi sẽ bị ẩn khỏi danh sách (quản trị viên vẫn khôi phục được).`}
        confirmLabel="Xoá"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};

export default DependentSection;
