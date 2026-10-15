import React, { useEffect, useRef, useState } from 'react';
import {
  XMarkIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  PrinterIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { managementApi } from '../../utils/api';
import ContractPlaceholderModal from '../../pages/ContractPlaceholderModal';

export interface ContractPreviewItem {
  id: number;
  employee_name: string;
  template_name: string;
}

interface Props {
  open: boolean;
  contracts: ContractPreviewItem[];
  onClose: () => void;
}

const MultiPdfPreviewModal: React.FC<Props> = ({ open, contracts, onClose }) => {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  // printAll state: null = idle, number = đang tải thứ N, 'done' = xong
  const [printAllProgress, setPrintAllProgress] = useState<number | null>(null);
  const urlCache = useRef<Record<number, string>>({});
  // ID HĐ đang được mở để chỉnh sửa trường — null nghĩa là không mở edit modal
  const [editingContractId, setEditingContractId] = useState<number | null>(null);

  useEffect(() => {
    if (open && contracts.length > 0) {
      setSelectedId(contracts[0].id);
    }
    if (!open) {
      Object.values(urlCache.current).forEach((u) => URL.revokeObjectURL(u));
      urlCache.current = {};
      setPdfUrl('');
      setSelectedId(null);
      setError('');
      setPrintAllProgress(null);
    }
  }, [open, contracts]);

  // Load PDF khi chọn
  useEffect(() => {
    if (!selectedId) return;
    if (urlCache.current[selectedId]) {
      setPdfUrl(urlCache.current[selectedId]);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setPdfUrl('');
    managementApi
      .get(`/api-hrm/employee-contracts/${selectedId}/download_file/`, { responseType: 'blob' })
      .then((r) => {
        if (cancelled) return;
        const url = URL.createObjectURL(r.data);
        urlCache.current[selectedId] = url;
        setPdfUrl(url);
      })
      .catch((e: any) => {
        if (cancelled) return;
        const data = e?.response?.data;
        if (data instanceof Blob) {
          data.text().then((text) => {
            try { setError(JSON.parse(text).detail || text); }
            catch { setError(text || 'Không thể tải PDF'); }
          });
        } else {
          setError(e?.response?.data?.detail || 'Không thể tải PDF');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  // Load một contract vào cache (dùng cho print all)
  const loadToCache = async (id: number): Promise<string | null> => {
    if (urlCache.current[id]) return urlCache.current[id];
    try {
      const r = await managementApi.get(
        `/api-hrm/employee-contracts/${id}/download_file/`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(r.data);
      urlCache.current[id] = url;
      return url;
    } catch {
      return null;
    }
  };

  // Sau khi HR sửa trường + generate lại PDF → invalidate cache + force reload PDF preview
  const handleEditSaved = (contractId: number) => {
    const cached = urlCache.current[contractId];
    if (cached) {
      URL.revokeObjectURL(cached);
      delete urlCache.current[contractId];
    }
    setEditingContractId(null);
    // Trigger reload: nếu đang chọn contract này thì re-fetch
    if (selectedId === contractId) {
      setSelectedId(null);
      setTimeout(() => setSelectedId(contractId), 0);
    }
  };

  const handlePrintAll = async () => {
    setPrintAllProgress(0);
    for (let i = 0; i < contracts.length; i++) {
      setPrintAllProgress(i + 1);
      await loadToCache(contracts[i].id);
    }
    setPrintAllProgress(null);
    // Mở tất cả trong tab mới — trình duyệt có thể hỏi cho phép popup
    contracts.forEach((c) => {
      const url = urlCache.current[c.id];
      if (url) window.open(url, '_blank');
    });
  };

  if (!open) return null;

  const selected = contracts.find((c) => c.id === selectedId);
  const loadedCount = Object.keys(urlCache.current).length;
  const isPrintingAll = printAllProgress !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <DocumentTextIcon className="w-5 h-5 text-blue-600" />
            <div>
              <h4 className="font-semibold text-gray-900">Xem trước hợp đồng hàng loạt</h4>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-gray-500">{contracts.length} hợp đồng</span>
                {loadedCount > 0 && (
                  <span className="text-xs text-green-600">✓ {loadedCount} file đã tải</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* In tất cả */}
            <button
              onClick={handlePrintAll}
              disabled={isPrintingAll || contracts.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPrintingAll ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  Đang tải {printAllProgress}/{contracts.length}...
                </>
              ) : (
                <>
                  <PrinterIcon className="w-4 h-4" />
                  In tất cả ({contracts.length})
                </>
              )}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Cột trái: danh sách */}
          <div className="w-72 flex-shrink-0 flex flex-col border-r">
            <div className="px-4 py-2.5 border-b bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Danh sách nhân viên
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {contracts.map((c, idx) => {
                const isSelected = c.id === selectedId;
                const isLoaded = !!urlCache.current[c.id];
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-4 py-3 border-b transition-colors flex items-start gap-3 ${
                      isSelected
                        ? 'bg-blue-50 border-l-4 border-l-blue-500'
                        : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                    }`}
                  >
                    <span className={`mt-0.5 text-xs font-medium w-5 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                        {c.employee_name}
                      </p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{c.template_name}</p>
                    </div>
                    {isLoaded ? (
                      <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    ) : isPrintingAll ? (
                      <ArrowPathIcon className="w-4 h-4 text-gray-300 animate-spin flex-shrink-0 mt-0.5" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Nút in trang này */}
            <div className="border-t px-4 py-3 flex-shrink-0">
              <button
                onClick={() => pdfUrl && window.open(pdfUrl, '_blank')}
                disabled={!pdfUrl || loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <PrinterIcon className="w-4 h-4" />
                In thủ công
              </button>
            </div>
          </div>

          {/* Cột phải: PDF viewer */}
          <div className="flex-1 flex flex-col min-w-0">
            {pdfUrl && !loading && (
              <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
                <p className="text-xs text-gray-500 truncate">
                  {selected?.employee_name} — {selected?.template_name}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => selectedId && setEditingContractId(selectedId)}
                    disabled={!selectedId}
                    title="Sửa các trường rồi tạo lại PDF"
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PencilSquareIcon className="w-3.5 h-3.5" />
                    Sửa thông tin
                  </button>
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-1 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-white"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                    Mở tab mới
                  </a>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
                <ArrowPathIcon className="w-10 h-10 animate-spin mb-3 text-blue-500" />
                <p className="text-sm">Đang tải PDF...</p>
              </div>
            )}

            {error && !loading && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl max-w-md text-sm text-center">
                  <p className="font-semibold mb-1">Không thể tải PDF</p>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {!selectedId && !loading && !error && (
              <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-center px-8">
                <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                  <DocumentTextIcon className="w-10 h-10 text-blue-400" />
                </div>
                <h3 className="text-base font-medium text-gray-700 mb-2">Chưa có bản xem trước</h3>
                <p className="text-sm text-gray-500">Chọn nhân viên bên trái để xem PDF hợp đồng.</p>
              </div>
            )}

            {pdfUrl && !loading && !error && (
              <div className="relative flex-1 min-h-0">
                <iframe
                  key={selectedId}
                  src={pdfUrl}
                  title={selected?.employee_name || 'PDF'}
                  className="w-full h-full border-0"
                />
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Modal sửa các field placeholder → tạo lại PDF với giá trị mới */}
      {editingContractId !== null && (
        <ContractPlaceholderModal
          contractId={editingContractId}
          onClose={() => setEditingContractId(null)}
          onSuccess={() => handleEditSaved(editingContractId)}
        />
      )}
    </div>
  );
};

export default MultiPdfPreviewModal;
