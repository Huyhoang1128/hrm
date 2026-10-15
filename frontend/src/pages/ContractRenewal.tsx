import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  PrinterIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { managementApi } from '../utils/api';
import MultiPdfPreviewModal, { ContractPreviewItem } from '../components/Common/MultiPdfPreviewModal';

type RenewalContract = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  employee_department: string | null;
  employee_position: string | null;
  contract_type_display: string;
  template_name: string | null;
  contract_number: string | null;
  end_date: string | null;
  generated_file: string | null;
};

type ContractTemplate = {
  id: number;
  name: string;
  contract_type: string;
  company_unit: number | null;
};

const RENEWAL_DAYS = 14;

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};

const getDaysLeft = (value: string | null) => {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(value);
  endDate.setHours(0, 0, 0, 0);
  return Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const nextDate = (value: string | null) => {
  if (!value) return toIsoDate(new Date());
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return toIsoDate(new Date());
  date.setDate(date.getDate() + 1);
  return toIsoDate(date);
};

const ContractRenewal: React.FC = () => {
  const [contracts, setContracts] = useState<RenewalContract[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<ContractPreviewItem[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await managementApi.get('/api-hrm/employee-contracts/renewal-candidates/', {
        params: { days: RENEWAL_DAYS },
      });
      const list: RenewalContract[] = Array.isArray(data) ? data : data.data || [];
      setContracts(list);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  useEffect(() => {
    const fetchTemplates = async () => {
      const { data } = await managementApi.get('/api-hrm/contract-templates/', {
        params: { status: 'ACTIVE' },
      });
      const list: ContractTemplate[] = Array.isArray(data) ? data : data.results || [];
      setTemplates(list);
    };
    fetchTemplates();
  }, []);

  const filteredContracts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return contracts;
    return contracts.filter((contract) =>
      contract.employee_name.toLowerCase().includes(keyword)
      || contract.employee_code.toLowerCase().includes(keyword)
    );
  }, [contracts, search]);

  const printableContracts = useMemo(
    () => filteredContracts.filter((contract) => !!contract.generated_file),
    [filteredContracts]
  );

  const selectedContracts = useMemo(
    () => contracts.filter((contract) => selectedIds.has(contract.id)),
    [contracts, selectedIds]
  );

  const selectedPrintableContracts = useMemo(
    () => selectedContracts.filter((contract) => !!contract.generated_file),
    [selectedContracts]
  );

  const selectedWithoutPdfContracts = useMemo(
    () => selectedContracts.filter((contract) => !contract.generated_file),
    [selectedContracts]
  );

  const allFilteredSelected = filteredContracts.length > 0
    && filteredContracts.every((contract) => selectedIds.has(contract.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredContracts.forEach((contract) => next.delete(contract.id));
      } else {
        filteredContracts.forEach((contract) => next.add(contract.id));
      }
      return next;
    });
  };

  const toggleSelect = (contractId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  };

  const openPreview = (targetContracts: RenewalContract[]) => {
    const items = targetContracts
      .filter((contract) => !!contract.generated_file)
      .map((contract) => ({
        id: contract.id,
        employee_name: contract.employee_name,
        template_name: [contract.template_name, contract.contract_type_display, contract.contract_number]
          .filter(Boolean)
          .join(' · '),
      }));

    if (items.length === 0) {
      alert('Không có hợp đồng PDF khả dụng để in. Vui lòng kiểm tra dữ liệu hợp đồng đã tạo PDF.');
      return;
    }

    setPreviewItems(items);
    setShowPreview(true);
  };

  const openTemplateSelector = () => {
    if (selectedWithoutPdfContracts.length === 0) {
      alert('Nhóm đã chọn đều đã có PDF, bạn có thể dùng nút in trực tiếp.');
      return;
    }
    setShowTemplateModal(true);
  };

  const handleGenerateFromTemplate = async () => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) {
      alert('Vui lòng chọn mẫu hợp đồng.');
      return;
    }

    setGeneratingPdf(true);
    try {
      const generatedItems: ContractPreviewItem[] = [];

      for (const renewalContract of selectedWithoutPdfContracts) {
        const createPayload = {
          employee: renewalContract.employee,
          contract_type: template.contract_type,
          template: template.id,
          company_unit: template.company_unit,
          start_date: nextDate(renewalContract.end_date),
          end_date: null,
        };

        const { data: createdContract } = await managementApi.post('/api-hrm/employee-contracts/', createPayload);
        const { data: generated } = await managementApi.post(
          `/api-hrm/employee-contracts/${createdContract.id}/generate_and_confirm/`,
          { overrides: {} }
        );

        const contractData = generated?.data;
        generatedItems.push({
          id: contractData?.id || createdContract.id,
          employee_name: renewalContract.employee_name,
          template_name: [
            template.name,
            contractData?.contract_type_display,
            contractData?.contract_number,
          ]
            .filter(Boolean)
            .join(' · '),
        });
      }

      const existingPrintableItems: ContractPreviewItem[] = selectedPrintableContracts.map((contract) => ({
        id: contract.id,
        employee_name: contract.employee_name,
        template_name: [contract.template_name, contract.contract_type_display, contract.contract_number]
          .filter(Boolean)
          .join(' · '),
      }));

      setPreviewItems([...existingPrintableItems, ...generatedItems]);
      setShowPreview(true);
      setShowTemplateModal(false);
      setSelectedTemplateId('');
      await fetchContracts();
    } catch (error: any) {
      alert(error?.response?.data?.message || error?.response?.data?.detail || 'Không thể tạo PDF từ mẫu đã chọn.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Tái ký hợp đồng</h1>
        <p className="text-sm text-gray-900 mt-1">
          Danh sách nhân sự có hợp đồng sẽ hết hạn trong {RENEWAL_DAYS} ngày tới.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo mã hoặc tên nhân viên..."
            className="w-full md:w-96 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => openPreview(selectedContracts)}
            disabled={selectedIds.size === 0 || selectedPrintableContracts.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PrinterIcon className="w-4 h-4" />
            In đã chọn ({selectedPrintableContracts.length})
          </button>
          <button
            onClick={openTemplateSelector}
            disabled={selectedWithoutPdfContracts.length === 0 || templates.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ExclamationTriangleIcon className="w-4 h-4" />
            Chọn mẫu & tạo PDF ({selectedWithoutPdfContracts.length})
          </button>
          <button
            onClick={() => openPreview(printableContracts)}
            disabled={printableContracts.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PrinterIcon className="w-4 h-4" />
            In tất cả ({printableContracts.length})
          </button>
          <button
            onClick={fetchContracts}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
        {selectedIds.size > 0 && selectedPrintableContracts.length === 0 && (
          <p className="mt-3 text-xs text-amber-700 flex items-center gap-1">
            <ExclamationTriangleIcon className="w-4 h-4" />
            Nhân sự đã chọn chưa có PDF hợp đồng để in. Hãy dùng nút “Chọn mẫu & tạo PDF”.
          </p>
        )}
        {!loading && (
          <p className="mt-2 text-xs text-gray-500">
            Hiển thị {filteredContracts.length}/{contracts.length} nhân sự.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-600">Đang tải danh sách tái ký hợp đồng...</div>
        ) : filteredContracts.length === 0 ? (
          <div className="p-10 text-center text-gray-500">Không có hợp đồng nào hết hạn trong {RENEWAL_DAYS} ngày tới.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Nhân sự</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Phòng ban / Vị trí</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Loại hợp đồng</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Ngày hết hạn</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Còn lại</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredContracts.map((contract) => {
                  const daysLeft = getDaysLeft(contract.end_date);
                  return (
                    <tr key={contract.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contract.id)}
                          onChange={() => toggleSelect(contract.id)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-gray-900">{contract.employee_name}</div>
                        <div className="text-xs text-gray-500">{contract.employee_code}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div>{contract.employee_department || '—'}</div>
                        <div className="text-xs text-gray-500">{contract.employee_position || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{contract.contract_type_display}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(contract.end_date)}</td>
                      <td className="px-4 py-3 text-sm">
                        {daysLeft === null ? (
                          <span className="text-gray-500">—</span>
                        ) : (
                          <span className={daysLeft <= 3 ? 'text-red-600 font-semibold' : 'text-amber-700 font-medium'}>
                            {daysLeft} ngày
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {contract.generated_file ? (
                          <span className="text-emerald-600 font-medium">Sẵn sàng</span>
                        ) : (
                          <span className="text-amber-600">Chưa có PDF</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MultiPdfPreviewModal
        open={showPreview}
        contracts={previewItems}
        onClose={() => {
          setShowPreview(false);
          setPreviewItems([]);
        }}
      />

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Chọn mẫu hợp đồng tái ký</h3>
              <p className="text-xs text-gray-500 mt-1">
                Áp dụng cho {selectedWithoutPdfContracts.length} nhân sự chưa có PDF hợp đồng.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block text-xs font-semibold text-gray-700 uppercase">Mẫu hợp đồng</label>
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value ? Number(event.target.value) : '')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">-- Chọn mẫu --</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => {
                  if (generatingPdf) return;
                  setShowTemplateModal(false);
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
              >
                Hủy
              </button>
              <button
                onClick={handleGenerateFromTemplate}
                disabled={generatingPdf || selectedTemplateId === ''}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
              >
                {generatingPdf ? 'Đang tạo PDF...' : 'Tạo PDF & in'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractRenewal;