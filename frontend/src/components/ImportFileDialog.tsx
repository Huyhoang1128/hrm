import React, { useState } from 'react';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

export type ImportResult = {
  success: boolean;
  summary: { total: number; created: number; updated: number; failed: number };
  errors: Array<{ row: number; code?: string; warnings?: string[]; errors?: string[] }>;
};

interface ImportFileDialogProps {
  open: boolean;
  title: string;
  helperText: string;
  onDownloadTemplate: () => void | Promise<void>;
  onImport: (file: File) => Promise<ImportResult>;
  onImported?: (result: ImportResult) => void;
  onClose: () => void;
}

// Dialog "Nhập từ file" dùng chung cho các trang import theo mã (Phòng ban, Vị trí...).
// Tách ra từ dialog import nhân viên (EmployeeList.tsx) để tái sử dụng — cùng UI/UX
// (2 bước: tải file mẫu rồi upload), chỉ khác nội dung template và endpoint gọi.
const ImportFileDialog: React.FC<ImportFileDialogProps> = ({
  open, title, helperText, onDownloadTemplate, onImport, onImported, onClose,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useLockBodyScroll(open);

  if (!open) return null;

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!file) return;
    setIsImporting(true);
    setResult(null);
    try {
      const res = await onImport(file);
      setResult(res);
      if (res.summary.created > 0 || res.summary.updated > 0) {
        onImported?.(res);
      }
    } catch (err: any) {
      alert('Import thất bại: ' + (err?.response?.data?.message || err?.message || 'Lỗi không xác định'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* Tải template */}
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <p className="text-sm font-medium text-primary-900 mb-1">Bước 1: Tải file mẫu</p>
            <p className="text-xs text-primary-700 mb-3">{helperText}</p>
            <button
              onClick={onDownloadTemplate}
              className="inline-flex items-center px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Tải file mẫu (.xlsx)
            </button>
          </div>

          {/* Upload file */}
          <div>
            <p className="text-sm font-medium text-gray-900 mb-2">Bước 2: Upload file đã điền</p>
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-all duration-200 group">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <svg className="w-10 h-10 text-gray-400 mb-3 group-hover:text-primary-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="mb-2 text-sm text-gray-700 font-medium">
                    <span className="text-primary-600">Nhấn để chọn file</span> hoặc kéo thả vào đây
                  </p>
                  <p className="text-xs text-gray-500">Hỗ trợ .xlsx, .xls, .csv</p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
                />
              </label>
            ) : (
              <div className="relative flex items-center p-4 bg-emerald-50 border-2 border-emerald-200 rounded-xl">
                <div className="flex-shrink-0 bg-emerald-100 p-2 rounded-lg mr-4">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-900 truncate">{file.name}</p>
                  <p className="text-xs text-emerald-600">{(file.size / 1024).toFixed(1)} KB • Sẵn sàng để import</p>
                </div>
                <button
                  onClick={() => { setFile(null); setResult(null); }}
                  className="ml-4 p-1 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-full transition-colors"
                  title="Xóa file"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Kết quả */}
          {result && (
            <div>
              <p className="text-sm font-medium text-gray-900 mb-2">Kết quả import</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="bg-gray-100 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Tổng</p>
                  <p className="text-xl font-bold text-gray-800">{result.summary.total}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-600">Tạo mới</p>
                  <p className="text-xl font-bold text-emerald-700">{result.summary.created}</p>
                </div>
                <div className="bg-primary-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-primary-600">Cập nhật</p>
                  <p className="text-xl font-bold text-primary-700">{result.summary.updated}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">Thất bại</p>
                  <p className="text-xl font-bold text-red-700">{result.summary.failed}</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 border-b">
                    Chi tiết lỗi / cảnh báo
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {result.errors.map((err, idx) => (
                      <div key={idx} className="px-3 py-2 text-xs border-b last:border-b-0">
                        <span className="font-medium text-gray-700">Dòng {err.row}</span>
                        {err.code && <span className="text-gray-500 ml-1">({err.code})</span>}
                        <span className="text-red-600 ml-2">{(err.errors || err.warnings || []).join('; ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            Đóng
          </button>
          <button
            onClick={handleSubmit}
            disabled={!file || isImporting}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors ${
              !file || isImporting ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {isImporting ? (
              <>
                <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Đang import...
              </>
            ) : (
              'Bắt đầu import'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportFileDialog;
