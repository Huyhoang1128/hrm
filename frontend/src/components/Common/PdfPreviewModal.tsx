import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface Props {
  open: boolean;
  title?: string;
  /** Async function trả về object URL của PDF blob */
  loader: (() => Promise<string>) | null;
  /** Optional filename khi user tải PDF */
  downloadFilename?: string;
  onClose: () => void;
}

const PdfPreviewModal: React.FC<Props> = ({ open, title, loader, downloadFilename, onClose }) => {
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!open || !loader) {
      // Cleanup khi đóng
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl('');
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    loader()
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setPdfUrl(url);
      })
      .catch((e: any) => {
        if (cancelled) return;
        // Trường hợp BE trả lỗi JSON nhưng responseType là blob → cần parse
        let msg = e?.message || 'Không thể tạo PDF';
        const data = e?.response?.data;
        if (data instanceof Blob) {
          data.text().then((text) => {
            try {
              const parsed = JSON.parse(text);
              setError(parsed.error || parsed.detail || text);
            } catch {
              setError(text || msg);
            }
          });
        } else {
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loader]);

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = downloadFilename || 'preview.pdf';
    a.click();
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
          <h3 className="text-base font-semibold text-gray-900 truncate">
            {title || 'Xem trước PDF'}
          </h3>
          <div className="flex items-center gap-2">
            {pdfUrl && !loading && (
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Tải PDF
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-gray-200 relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600">
              <ArrowPathIcon className="w-10 h-10 animate-spin mb-3" />
              <p className="text-sm">Đang tạo PDF, vui lòng chờ...</p>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded max-w-lg text-sm">
                <p className="font-semibold mb-1">Không thể tạo bản xem trước</p>
                <p>{error}</p>
              </div>
            </div>
          )}
          {pdfUrl && !loading && !error && (
            <iframe
              src={pdfUrl}
              title="PDF Preview"
              className="absolute inset-0 w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PdfPreviewModal;
