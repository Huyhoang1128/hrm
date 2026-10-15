import { XMarkIcon, ArrowDownTrayIcon, DocumentIcon } from '@heroicons/react/24/outline';

interface Props {
  open: boolean;
  file_name: string;
  file_url: string;
  onClose: () => void;
}

function getFileType(name: string): 'pdf' | 'image' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  return 'other';
}

export default function FilePreviewModal({ open, file_name, file_url, onClose }: Props) {
  if (!open) return null;

  const type = getFileType(file_name);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = file_url;
    a.download = file_name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        className={`bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden w-full ${
          type === 'other' ? 'max-w-md' : 'max-w-5xl h-[92vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate max-w-[70%]" title={file_name}>
            {file_name}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Tải xuống
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        {type === 'pdf' && (
          <div className="flex-1 bg-gray-200 relative min-h-0">
            <iframe
              src={file_url}
              title={file_name}
              className="absolute inset-0 w-full h-full border-0"
            />
          </div>
        )}

        {type === 'image' && (
          <div className="flex-1 bg-gray-100 flex items-center justify-center p-4 overflow-auto">
            <img
              src={file_url}
              alt={file_name}
              className="max-w-full max-h-full object-contain rounded shadow"
            />
          </div>
        )}

        {type === 'other' && (
          <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <DocumentIcon className="w-7 h-7 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">{file_name}</p>
              <p className="text-xs text-gray-500 mt-1">Định dạng này không hỗ trợ xem trước. Nhấn tải xuống để mở bằng ứng dụng tương thích.</p>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Tải xuống
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
