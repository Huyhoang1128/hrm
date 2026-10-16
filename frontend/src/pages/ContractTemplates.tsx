import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { managementApi } from '../utils/api';
import { companyUnitsAPI } from '../utils/api/hrm.api';
import type { CompanyUnit } from '../utils/api/types';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  DocumentTextIcon,
  PlusIcon,
  XMarkIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

const formatDate = (d: Date | string) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  PROBATION: 'Hợp đồng thử việc',
  INTERN: 'Hợp đồng thực tập sinh',
  COLLABORATOR: 'Hợp đồng cộng tác viên',
  ONE_YEAR: 'Hợp đồng lao động 12 tháng',
  TWO_YEAR: 'Hợp đồng lao động 24 tháng',
  INDEFINITE: 'Hợp đồng vô thời hạn',
  SERVICE: 'Hợp đồng dịch vụ',
  CONFIDENTIALITY: 'Thoả thuận bảo mật',
  COMPANY_RULES: 'Cam kết đọc hiểu nội quy công ty',
  NURSING_COMMITMENT: 'Cam kết của CBNV Điều dưỡng',
  APPENDIX: 'Phụ lục hợp đồng',
};

type ContractTemplate = {
  id: number;
  name: string;
  contract_type: string;
  contract_type_display: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  is_default: boolean;
  file: string | null;
  file_url?: string | null;
  company_unit: number | null;
  company_unit_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export default function ContractTemplates() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ContractTemplate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [companyUnits, setCompanyUnits] = useState<CompanyUnit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);

  const [detailTemplate, setDetailTemplate] = useState<ContractTemplate | null>(null);
  const [editTemplate, setEditTemplate] = useState<ContractTemplate | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    contract_type: 'PROBATION',
    description: '',
    status: 'ACTIVE',
    file: null as File | null,
    company_unit: null as number | null,
  });
  const [updating, setUpdating] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '',
    contract_type: 'PROBATION',
    description: '',
    status: 'ACTIVE',
    file: null as File | null,
    company_unit: null as number | null,
  });

  const fetchTemplates = async () => {
    try {
      const { data } = await managementApi.get('/api-hrm/contract-templates/');
      setTemplates(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      console.error('Error fetching templates:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (!showAddModal) return;
    setLoadingUnits(true);
    companyUnitsAPI.list({ active_only: true, page_size: 200 })
      .then(res => setCompanyUnits(res.results))
      .catch(() => {})
      .finally(() => setLoadingUnits(false));
  }, [showAddModal]);

  const handleSubmit = async () => {
    if (!form.name.trim()) return alert('Vui lòng nhập tên template');
    if (!form.file) return alert('Vui lòng chọn file .docx');

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('contract_type', form.contract_type);
      formData.append('description', form.description);
      formData.append('status', form.status);
      formData.append('file', form.file);
      if (form.company_unit) formData.append('company_unit', String(form.company_unit));

      await managementApi.post('/api-hrm/contract-templates/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      await fetchTemplates();
      setShowAddModal(false);
      setForm({ name: '', contract_type: 'PROBATION', description: '', status: 'ACTIVE', file: null, company_unit: null });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      alert('Lỗi upload: ' + (e.response?.data?.detail || e.message));
    } finally {
      setUploading(false);
    }
  };

  const handleToggleStatus = async (template: ContractTemplate) => {
    const newStatus = template.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await managementApi.patch(`/api-hrm/contract-templates/${template.id}/`, {
        status: newStatus,
      });
      await fetchTemplates();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Cập nhật thất bại');
    }
  };

  const handleSetDefault = async (template: ContractTemplate) => {
    try {
      await managementApi.patch(`/api-hrm/contract-templates/${template.id}/`, {
        is_default: true,
      });
      await fetchTemplates();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Đặt mặc định thất bại');
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await managementApi.delete(`/api-hrm/contract-templates/${id}/`);
      await fetchTemplates();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Xóa thất bại');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  const openEdit = (t: ContractTemplate) => {
    setEditForm({
      name: t.name,
      contract_type: t.contract_type,
      description: t.description,
      status: t.status,
      file: null,
      company_unit: t.company_unit ?? null,
    });
    setEditTemplate(t);
  };

  const handleUpdate = async () => {
    if (!editTemplate || !editForm.name.trim()) return;
    setUpdating(true);
    try {
      const fd = new FormData();
      fd.append('name', editForm.name);
      fd.append('contract_type', editForm.contract_type);
      fd.append('description', editForm.description);
      fd.append('status', editForm.status);
      if (editForm.company_unit) fd.append('company_unit', String(editForm.company_unit));
      if (editForm.file) fd.append('file', editForm.file);
      await managementApi.patch(`/api-hrm/contract-templates/${editTemplate.id}/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await fetchTemplates();
      setEditTemplate(null);
      if (editFileInputRef.current) editFileInputRef.current.value = '';
    } catch (e: any) {
      alert('Lỗi: ' + (e.response?.data?.detail || e.message));
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    if (!editTemplate) return;
    setLoadingUnits(true);
    companyUnitsAPI.list({ active_only: true, page_size: 200 })
      .then(res => setCompanyUnits(res.results))
      .catch(() => {})
      .finally(() => setLoadingUnits(false));
  }, [editTemplate]);

  const PLACEHOLDER_DOCS = [
    { key: '{{ho_ten}}', desc: 'Họ và tên nhân viên' },
    { key: '{{ngay_sinh}}', desc: 'Ngày sinh' },
    { key: '{{so_cccd}}', desc: 'Số CCCD/CMND' },
    { key: '{{ngay_cap_cccd}}', desc: 'Ngày cấp CCCD' },
    { key: '{{noi_cap_cccd}}', desc: 'Nơi cấp CCCD' },
    { key: '{{dia_chi}}', desc: 'Địa chỉ thường trú' },
    { key: '{{dia_chi_hien_tai}}', desc: 'Địa chỉ hiện tại' },
    { key: '{{so_dien_thoai}}', desc: 'Số điện thoại' },
    { key: '{{email}}', desc: 'Email cá nhân' },
    { key: '{{luong_co_ban}}', desc: 'Lương cơ bản' },
    { key: '{{luong_thu_viec}}', desc: 'Lương thử việc' },
    { key: '{{ngay_bat_dau}}', desc: 'Ngày bắt đầu làm việc' },
    { key: '{{ngay_ky}}', desc: 'Ngày ký hợp đồng' },
    { key: '{{thoi_han_hop_dong}}', desc: 'Ngày kết thúc HĐ' },
    { key: '{{phong_ban}}', desc: 'Phòng ban' },
    { key: '{{vi_tri}}', desc: 'Vị trí/Chức danh' },
    { key: '{{chuc_vu}}', desc: 'Chức vụ (rank)' },
    { key: '{{loai_hop_dong}}', desc: 'Loại hợp đồng' },
    { key: '{{ma_nhan_vien}}', desc: 'Mã nhân viên' },
    { key: '{{so_tai_khoan}}', desc: 'Số tài khoản ngân hàng' },
    { key: '{{ten_ngan_hang}}', desc: 'Tên ngân hàng' },
    { key: '{{ma_so_thue}}', desc: 'Mã số thuế TNCN' },
    { key: '{{ma_bhxh}}', desc: 'Mã BHXH' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Template hợp đồng</h1>
          <p className="text-sm text-gray-900 mt-1">Quản lý các mẫu hợp đồng dùng để tạo PDF tự động</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          Thêm template
        </button>
      </div>

      {/* Template list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Đang tải...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
          <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Chưa có template nào</p>
          <p className="text-gray-400 text-sm mt-1">Nhấn "Thêm template" để tạo mới</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header text-left px-4 py-3">Tên template</th>
                  <th className="table-header text-left px-4 py-3">Loại hợp đồng</th>
                  <th className="table-header text-left px-4 py-3 whitespace-nowrap">Đơn vị</th>
                  <th className="table-header text-center px-4 py-3 whitespace-nowrap">Trạng thái</th>
                  <th className="table-header text-center px-4 py-3 whitespace-nowrap">Mặc định</th>
                  <th className="table-header text-left px-4 py-3 whitespace-nowrap">Người tạo</th>
                  <th className="table-header text-left px-4 py-3 whitespace-nowrap">Ngày tạo</th>
                  <th className="table-header text-center px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {templates.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell px-4 py-3">
                      <div className="flex items-start gap-2">
                        <DocumentTextIcon className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{t.name}</p>
                          {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="table-cell px-4 py-3">
                      <span className="text-sm text-gray-700">{t.contract_type_display}</span>
                    </td>
                    <td className="table-cell px-4 py-3 whitespace-nowrap">{t.company_unit_name || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        t.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {t.status === 'ACTIVE' ? '● Đang dùng' : '● Không dùng'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.is_default ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-blue-100 text-blue-700">
                          ★ Mặc định
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSetDefault(t)}
                          disabled={t.status !== 'ACTIVE'}
                          title={t.status !== 'ACTIVE' ? 'Chỉ có thể đặt mặc định cho template đang dùng' : 'Đặt làm mặc định'}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          Đặt mặc định
                        </button>
                      )}
                    </td>
                    <td className="table-cell px-4 py-3 whitespace-nowrap">{t.created_by_name || '—'}</td>
                    <td className="table-cell px-4 py-3 whitespace-nowrap">
                      {formatDate(t.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-center flex-nowrap">
                        <button
                          onClick={() => setDetailTemplate(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors whitespace-nowrap"
                        >Chi tiết</button>
                        <button
                          onClick={() => openEdit(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                          Sửa
                        </button>
                        {t.file && (
                          <a
                            href={t.file_url || t.file}
                            download
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors whitespace-nowrap"
                          >
                            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                            Tải file
                          </a>
                        )}
                        <button
                          onClick={() => handleToggleStatus(t)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap border ${
                            t.status === 'ACTIVE'
                              ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
                              : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                          }`}
                        >
                          {t.status === 'ACTIVE' ? 'Vô hiệu' : 'Kích hoạt'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(t)}
                          disabled={deletingId === t.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Xóa template hợp đồng"
        message={`Bạn có chắc muốn xóa template "${confirmDelete?.name}"? Hành động này không thể hoàn tác.`}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onClose={() => setConfirmDelete(null)}
      />

      {/* Detail Modal */}
      {detailTemplate && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9997] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                  <DocumentTextIcon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Chi tiết template</h3>
              </div>
              <button onClick={() => setDetailTemplate(null)}>
                <XMarkIcon className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-3 overflow-y-auto">
              {([
                ['Tên template', detailTemplate.name],
                ['Loại hợp đồng', detailTemplate.contract_type_display],
                ['Đơn vị', detailTemplate.company_unit_name || '—'],
                ['Mô tả', detailTemplate.description || '—'],
                ['Trạng thái', detailTemplate.status === 'ACTIVE' ? 'Đang dùng' : 'Không dùng'],
                ['Mặc định', detailTemplate.is_default ? 'Có' : 'Không'],
                ['Người tạo', detailTemplate.created_by_name || '—'],
                ['Ngày tạo', formatDate(detailTemplate.created_at)],
                ['Cập nhật', formatDate(detailTemplate.updated_at)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex gap-3 text-sm">
                  <span className="w-36 flex-shrink-0 text-gray-500">{label}</span>
                  <span className="text-gray-900 font-medium">{value}</span>
                </div>
              ))}
              {detailTemplate.file && (
                <div className="flex gap-3 text-sm">
                  <span className="w-36 flex-shrink-0 text-gray-500">File</span>
                  <a
                    href={detailTemplate.file_url || detailTemplate.file}
                    download
                    className="text-primary-600 hover:underline font-medium"
                  >Tải xuống</a>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <button
                onClick={() => setDetailTemplate(null)}
                className="btn-secondary w-full"
              >Đóng</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Modal */}
      {editTemplate && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9997] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                  <PencilSquareIcon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Sửa template hợp đồng</h3>
              </div>
              <button onClick={() => setEditTemplate(null)}>
                <XMarkIcon className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên template <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Loại hợp đồng <span className="text-red-500">*</span></label>
                <select
                  value={editForm.contract_type}
                  onChange={e => setEditForm({ ...editForm, contract_type: e.target.value })}
                  className="input-field w-full"
                >
                  {Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <SelectBox<number | null>
                  label="Đơn vị áp dụng"
                  value={editForm.company_unit}
                  placeholder="— Tất cả đơn vị —"
                  searchable
                  options={companyUnits.map(u => ({ value: u.id as number | null, label: u.name }))}
                  onChange={v => setEditForm({ ...editForm, company_unit: v })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
                <input
                  type="text"
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Mô tả ngắn về template này..."
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File Word (.docx)</label>
                <input
                  ref={editFileInputRef}
                  type="file"
                  accept=".docx"
                  onChange={e => setEditForm({ ...editForm, file: e.target.files?.[0] || null })}
                  className="input-field w-full file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700"
                />
                <p className="text-xs text-gray-400 mt-1">Bỏ trống để giữ file hiện tại.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trạng thái</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="input-field w-full"
                >
                  <option value="ACTIVE">Đang dùng</option>
                  <option value="INACTIVE">Không dùng</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3 flex-shrink-0">
              <button
                onClick={() => setEditTemplate(null)}
                className="btn-secondary flex-1"
              >Hủy</button>
              <button
                onClick={handleUpdate}
                disabled={updating || !editForm.name.trim()}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add Modal */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9997] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                  <PlusIcon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Thêm template hợp đồng</h3>
              </div>
              <button onClick={() => setShowAddModal(false)}>
                <XMarkIcon className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên template <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: Hợp đồng thử việc 2026"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Loại hợp đồng <span className="text-red-500">*</span></label>
                <select
                  value={form.contract_type}
                  onChange={e => setForm({ ...form, contract_type: e.target.value })}
                  className="input-field w-full"
                >
                  {Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <SelectBox<number | null>
                  label="Đơn vị áp dụng"
                  value={form.company_unit}
                  placeholder="— Tất cả đơn vị —"
                  searchable
                  options={companyUnits.map(u => ({ value: u.id as number | null, label: u.name }))}
                  onChange={v => setForm({ ...form, company_unit: v })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Mô tả ngắn về template này..."
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File Word (.docx) <span className="text-red-500">*</span></label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx"
                  onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })}
                  className="input-field w-full file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700"
                />
                <p className="text-xs text-gray-400 mt-1">Chỉ chấp nhận file .docx. Sử dụng các placeholder như {'{{ho_ten}}'} trong file Word.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trạng thái</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="input-field w-full"
                >
                  <option value="ACTIVE">Đang dùng</option>
                  <option value="INACTIVE">Không dùng</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3 flex-shrink-0">
              <button
                onClick={() => setShowAddModal(false)}
                className="btn-secondary flex-1"
              >
                Hủy
              </button>
              <button
                onClick={handleSubmit}
                disabled={uploading || !form.name.trim() || !form.file}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? 'Đang upload...' : 'Lưu template'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
