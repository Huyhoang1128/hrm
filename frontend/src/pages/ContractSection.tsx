import React, { useState, useEffect } from 'react';
import { managementApi } from '../utils/api';
import {
  DocumentTextIcon,
  PlusIcon,
  EyeIcon,
  XMarkIcon,
  TrashIcon,
  CheckBadgeIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import ContractPlaceholderModal from './ContractPlaceholderModal';
import PdfPreviewModal from '../components/Common/PdfPreviewModal';
import ConfirmDialog from '../components/ConfirmDialog';

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  PROBATION: 'Hợp đồng thử việc',
  PROBATION_1M: 'Thử việc 1 tháng',
  PROBATION_2M: 'Thử việc 2 tháng',
  INTERN: 'Hợp đồng thực tập sinh',
  COLLABORATOR: 'Hợp đồng cộng tác viên',
  SIX_MONTH: 'Hợp đồng lao động 6 tháng',
  ONE_YEAR: 'Hợp đồng lao động 12 tháng',
  TWO_YEAR: 'Hợp đồng lao động 24 tháng',
  THREE_YEAR: 'Hợp đồng lao động 36 tháng',
  INDEFINITE: 'Hợp đồng vô thời hạn',
  SERVICE: 'Hợp đồng dịch vụ',
  CONFIDENTIALITY: 'Thoả thuận bảo mật',
  COMPANY_RULES: 'Cam kết đọc hiểu nội quy công ty',
  NURSING_COMMITMENT: 'Cam kết của CBNV Điều dưỡng',
  APPENDIX: 'Phụ lục hợp đồng',
};

const CONTRACT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Bản nháp', color: 'bg-gray-100 text-gray-700' },
  PENDING_SIGN: { label: 'Chờ ký', color: 'bg-amber-100 text-amber-700' },
  SIGNED: { label: 'Đã ký', color: 'bg-emerald-100 text-emerald-700' },
  EXPIRED: { label: 'Hết hạn', color: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Đã hết hiệu lực', color: 'bg-gray-100 text-gray-500' },
};

type ContractTemplate = {
  id: number;
  name: string;
  contract_type: string;
  contract_type_display: string;
  description: string;
  company_unit: number | null;
  company_unit_name: string | null;
  company_unit_code: string | null;
  status?: string;
};

type EmployeeContract = {
  id: number;
  contract_type: string;
  contract_type_display: string;
  status: string;
  status_display: string;
  template: number | null;
  template_name: string | null;
  generated_file: string | null;
  generated_file_url?: string | null;
  signed_file: string | null;
  signed_file_url?: string | null;
  employee_signed_at: string | null;
  hr_signed_at: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string;
  is_expiring_soon: boolean;
  created_at: string;
  company_unit: number | null;
  company_unit_name: string | null;
};

type Props = {
  onboardingId: number;
  employeeId: number | null;
  employeeProfile?: Record<string, any>;
};

const ContractSection: React.FC<Props> = ({ onboardingId, employeeId, employeeProfile }) => {
  const [contracts, setContracts] = useState<EmployeeContract[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [markingSigned, setMarkingSigned] = useState<number | null>(null);
  const [placeholderModal, setPlaceholderModal] = useState<number | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ id: number; name: string } | null>(null);

  // ConfirmDialog state
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; contractId: number | null }>({ open: false, contractId: null });
  const [confirmSign, setConfirmSign] = useState<{ open: boolean; contractId: number | null }>({ open: false, contractId: null });

  const [newContract, setNewContract] = useState({
    template: null as ContractTemplate | null,
    start_date: '',
    end_date: '',
    notes: '',
  });

  const fetchContracts = async () => {
    try {
      const { data } = await managementApi.get('/api-hrm/employee-contracts/', {
        params: { onboarding_id: onboardingId }
      });
      setContracts(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      console.error('Error fetching contracts:', e);
    }
  };

  const fetchTemplates = async () => {
    try {
      const { data } = await managementApi.get('/api-hrm/contract-templates/', {
        params: { status: 'ACTIVE' }
      });
      setTemplates(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      console.error('Error fetching templates:', e);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchContracts(), fetchTemplates()]).finally(() => setLoading(false));
  }, [onboardingId]);

  const handleAddContract = async () => {
    if (!employeeId) return alert('Chưa có hồ sơ nhân viên');
    if (!newContract.template) return alert('Vui lòng chọn template hợp đồng');
    try {
      await managementApi.post('/api-hrm/employee-contracts/', {
        onboarding_process: onboardingId,
        employee: employeeId,
        contract_type: newContract.template.contract_type,
        template: newContract.template.id,
        company_unit: newContract.template.company_unit,
        start_date: newContract.start_date || null,
        end_date: newContract.end_date || null,
        notes: newContract.notes,
      });
      await fetchContracts();
      setShowAddModal(false);
      setNewContract({ template: null, start_date: '', end_date: '', notes: '' });
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Lỗi tạo hợp đồng');
    }
  };

  const handleDelete = async (contractId: number) => {
    setDeleting(contractId);
    try {
      await managementApi.delete(`/api-hrm/employee-contracts/${contractId}/`);
      await fetchContracts();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Xóa thất bại');
    } finally {
      setDeleting(null);
    }
  };

  const handleMarkSigned = async (contractId: number) => {
    setMarkingSigned(contractId);
    try {
      await managementApi.post(`/api-hrm/employee-contracts/${contractId}/mark_signed/`);
      await fetchContracts();
    } catch (e: any) {
      alert(e.response?.data?.message || e.response?.data?.detail || 'Cập nhật thất bại');
    } finally {
      setMarkingSigned(null);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-pulse flex flex-col items-center gap-3">
        <div className="h-9 w-9 bg-gray-100 rounded-xl" />
        <div className="h-3 w-32 bg-gray-100 rounded" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
            <DocumentTextIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Hợp đồng lao động</h3>
            <p className="text-xs text-gray-400">{contracts.length} hợp đồng</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2 text-sm whitespace-nowrap shrink-0"
        >
          <PlusIcon className="h-4 w-4" />
          Thêm hợp đồng
        </button>
      </div>

      {/* Contract List */}
      {contracts.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
          <div className="h-12 w-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <DocumentTextIcon className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">Chưa có hợp đồng nào</p>
          <p className="text-xs text-gray-400 mt-1">Nhấn "Thêm hợp đồng" để tạo hợp đồng mới</p>
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map(contract => (
            <div key={contract.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="text-sm font-bold text-gray-900">
                      {CONTRACT_TYPE_LABELS[contract.contract_type] || contract.contract_type_display}
                    </h4>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CONTRACT_STATUS_CONFIG[contract.status]?.color}`}>
                      {CONTRACT_STATUS_CONFIG[contract.status]?.label || contract.status}
                    </span>
                    {contract.is_expiring_soon && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        ⚠ Sắp hết hạn
                      </span>
                    )}
                  </div>
                  {contract.template_name && (
                    <p className="text-xs text-gray-400">Template: {contract.template_name}</p>
                  )}
                  <div className="flex gap-4 mt-1.5 flex-wrap">
                    {contract.start_date && (
                      <span className="text-xs text-gray-500">
                        <span className="text-gray-400">Ngày bắt đầu:</span>{' '}
                        <span className="font-medium text-gray-700">{fmtDate(contract.start_date)}</span>
                      </span>
                    )}
                    {contract.end_date && (
                      <span className="text-xs text-gray-500">
                        <span className="text-gray-400">Ngày kết thúc:</span>{' '}
                        <span className="font-medium text-gray-700">{fmtDate(contract.end_date)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap sm:justify-end shrink-0">

                  {/* Tạo PDF — mở modal placeholder thay vì generate trực tiếp */}
                  {contract.template && !contract.generated_file && (
                    <button
                      onClick={() => setPlaceholderModal(contract.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
                    >
                      <DocumentTextIcon className="h-3.5 w-3.5" />
                      Tạo PDF
                    </button>
                  )}

                  {/* Xem file đã tạo */}
                  {contract.generated_file && (
                    <button
                      onClick={() => setPdfPreview({ id: contract.id, name: contract.template_name || 'Hợp đồng' })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                      Xem
                    </button>
                  )}

                  {/* Tạo lại — cũng mở modal placeholder */}
                  {contract.template && contract.generated_file && (
                    <button
                      onClick={() => setPlaceholderModal(contract.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors"
                    >
                      <ArrowPathIcon className="h-3.5 w-3.5" />
                      Tạo lại
                    </button>
                  )}

                  {contract.status === 'PENDING_SIGN' && (
                    <button
                      onClick={() => setConfirmSign({ open: true, contractId: contract.id })}
                      disabled={markingSigned === contract.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <CheckBadgeIcon className="h-3.5 w-3.5" />
                      {markingSigned === contract.id ? 'Đang xử lý...' : 'Đánh dấu đã ký'}
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmDelete({ open: true, contractId: contract.id })}
                    disabled={deleting === contract.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {deleting === contract.id ? 'Đang xóa...' : 'Xóa'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Contract Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                  <DocumentTextIcon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Thêm hợp đồng mới</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Template card list */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2 uppercase tracking-wide">
                  Chọn template hợp đồng <span className="text-red-500">*</span>
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {templates.filter(t => !t.status || t.status === 'ACTIVE').length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">Không có template nào đang hoạt động</p>
                  )}
                  {templates
                    .filter(t => !t.status || t.status === 'ACTIVE')
                    .map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setNewContract({ ...newContract, template: t })}
                        className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                          newContract.template?.id === t.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">
                            {t.contract_type_display}
                          </span>
                          {t.company_unit_name && (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700">
                              {t.company_unit_name}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                </div>
              </div>

              {/* Auto-fill info from selected template */}
              {newContract.template && (
                <div className="bg-gray-50 rounded-2xl border border-gray-100 px-4 py-3 text-sm text-gray-600 space-y-1">
                  <p><span className="font-semibold text-gray-700">Loại hợp đồng:</span> {newContract.template.contract_type_display}</p>
                  <p><span className="font-semibold text-gray-700">Đơn vị:</span> {newContract.template.company_unit_name || '—'}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Ngày bắt đầu</label>
                  <input
                    type="date"
                    value={newContract.start_date}
                    onChange={e => setNewContract({ ...newContract, start_date: e.target.value })}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Ngày kết thúc</label>
                  <input
                    type="date"
                    value={newContract.end_date}
                    onChange={e => setNewContract({ ...newContract, end_date: e.target.value })}
                    className="input-field w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Ghi chú</label>
                <textarea
                  value={newContract.notes}
                  onChange={e => setNewContract({ ...newContract, notes: e.target.value })}
                  rows={2}
                  placeholder="Nhập ghi chú (nếu có)..."
                  className="input-field w-full resize-none"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="btn-secondary flex-1 text-sm"
              >
                Hủy
              </button>
              <button
                onClick={handleAddContract}
                disabled={!newContract.template}
                className="btn-primary flex-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tạo hợp đồng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Placeholder Modal — hiện khi bấm Tạo PDF hoặc Tạo lại */}
      {placeholderModal !== null && (
        <ContractPlaceholderModal
          contractId={placeholderModal}
          onClose={() => setPlaceholderModal(null)}
          onSuccess={() => {
            setPlaceholderModal(null);
            fetchContracts();
          }}
        />
      )}

      <PdfPreviewModal
        open={!!pdfPreview}
        title={pdfPreview?.name}
        loader={pdfPreview ? () =>
          managementApi.get(`/api-hrm/employee-contracts/${pdfPreview.id}/download_file/`, { responseType: 'blob' })
            .then(r => URL.createObjectURL(r.data))
        : null}
        downloadFilename={`${pdfPreview?.name || 'hop-dong'}.pdf`}
        onClose={() => setPdfPreview(null)}
      />

      {/* ConfirmDialog — Xóa hợp đồng */}
      <ConfirmDialog
        open={confirmDelete.open}
        title="Xóa hợp đồng"
        message="Bạn có chắc muốn xóa hợp đồng này? Thao tác này không thể hoàn tác."
        onConfirm={() => {
          if (confirmDelete.contractId !== null) handleDelete(confirmDelete.contractId);
          setConfirmDelete({ open: false, contractId: null });
        }}
        onClose={() => setConfirmDelete({ open: false, contractId: null })}
      />

      {/* ConfirmDialog — Đánh dấu đã ký */}
      <ConfirmDialog
        open={confirmSign.open}
        title="Xác nhận đã ký hợp đồng"
        message="Xác nhận đánh dấu hợp đồng này là đã ký? Thao tác này sẽ cập nhật thông tin hợp đồng vào hồ sơ nhân viên."
        onConfirm={() => {
          if (confirmSign.contractId !== null) handleMarkSigned(confirmSign.contractId);
          setConfirmSign({ open: false, contractId: null });
        }}
        onClose={() => setConfirmSign({ open: false, contractId: null })}
      />

    </div>
  );
};

export default ContractSection;
