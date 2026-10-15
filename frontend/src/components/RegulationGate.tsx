import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  EyeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import onboardingService from '../services/onboarding.service';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

/**
 * Blocking gate: ép nhân viên đọc xong các tài liệu REGULATION bắt buộc
 * trước khi dùng hệ thống. Đặt trong ProtectedRoute để chặn TẤT CẢ route,
 * không chỉ Home.
 */
interface RegulationGateProps {
  userId: string;
}

const RegulationGate: React.FC<RegulationGateProps> = ({ userId }) => {
  const [onboarding, setOnboarding] = useState<any>(null);
  const [viewingDoc, setViewingDoc] = useState<any>(null);
  const [docReadable, setDocReadable] = useState(false);
  const [markingReadId, setMarkingReadId] = useState<number | null>(null);
  const [showGate, setShowGate] = useState(false);
  const dismissalKey = `regulation-gate-dismissed:${userId}`;

  const dismissGate = () => {
    sessionStorage.setItem(dismissalKey, 'true');
    setViewingDoc(null);
    setShowGate(false);
  };

  const refreshOnboarding = async () => {
    const myOb = await onboardingService.myOnboarding();
    if (!myOb?.id) {
      setOnboarding(null);
      setShowGate(false);
      return;
    }
    const fullOb = await onboardingService.get(myOb.id);
    setOnboarding(fullOb);
    const unread = (fullOb.documents || []).filter(
      (d: any) => d.document_type === 'REGULATION' && d.is_required && !d.is_read
    );
    setShowGate(unread.length > 0);
  };

  useEffect(() => {
    if (sessionStorage.getItem(dismissalKey) === 'true') return;

    refreshOnboarding().catch(() => {
      setOnboarding(null);
      setShowGate(false);
    });
  }, [dismissalKey]);

  useEffect(() => {
    if (!showGate && !viewingDoc) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissGate();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showGate, viewingDoc, dismissalKey]);

  useLockBodyScroll(!!viewingDoc || showGate);

  if (!showGate && !viewingDoc) return null;

  const regulationDocs = (onboarding?.documents || []).filter(
    (d: any) => d.document_type === 'REGULATION' && d.is_required
  );
  const readCount = regulationDocs.filter((d: any) => d.is_read).length;
  const totalRequired = regulationDocs.length;

  return (
    <>
      {showGate && createPortal(
        <div
          className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={dismissGate}
        >
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={dismissGate}
              aria-label="Đóng thông báo nội quy"
              className="absolute right-4 top-4 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
            <div className="flex items-start gap-4 pr-10">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <ExclamationTriangleIcon className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Đọc nội quy trước khi tiếp tục</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Bạn cần đọc và xác nhận các tài liệu bắt buộc dưới đây trước khi sử dụng hệ thống.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all duration-500"
                  style={{ width: totalRequired > 0 ? `${(readCount / totalRequired) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-sm text-gray-600 shrink-0">
                <span className="font-semibold text-green-600">{readCount}</span> / {totalRequired} tài liệu
              </span>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {regulationDocs.map((doc: any) => (
                <div key={doc.id} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${doc.is_read ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    {doc.is_read
                      ? <CheckCircleIcon className="w-5 h-5 text-green-500 shrink-0" />
                      : <DocumentTextIcon className="w-5 h-5 text-amber-500 shrink-0" />}
                    <span className={`text-sm truncate ${doc.is_read ? 'line-through text-gray-400' : 'text-gray-800 font-medium'}`}>
                      {doc.document_name}
                    </span>
                  </div>
                  {!doc.is_read && (
                    <button
                      onClick={() => { setViewingDoc(doc); setDocReadable(false); }}
                      className="ml-3 shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      <EyeIcon className="w-3.5 h-3.5" />
                      Xem
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {viewingDoc && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={() => setViewingDoc(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl" style={{ height: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{viewingDoc.document_name}</h3>
                {viewingDoc.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{viewingDoc.description}</p>
                )}
              </div>
              <button onClick={() => setViewingDoc(null)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-gray-100" style={{ height: 'calc(90vh - 128px)' }}>
              {viewingDoc.file_url || viewingDoc.file ? (
                <iframe
                  src={viewingDoc.file_url || viewingDoc.file}
                  className="w-full h-full border-0"
                  title={viewingDoc.document_name}
                  onLoad={() => { setTimeout(() => setDocReadable(true), 10000); }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">Không có file đính kèm</div>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between gap-3 rounded-b-2xl">
              <p className="text-xs text-gray-500">
                {viewingDoc.is_read ? '✓ Bạn đã đọc tài liệu này'
                  : docReadable ? '✓ Có thể xác nhận đã đọc'
                    : '⏳ Vui lòng đọc hết tài liệu (tối thiểu 10 giây)...'}
              </p>
              {!viewingDoc.is_read && (
                <button
                  disabled={!docReadable || markingReadId === viewingDoc.id}
                  onClick={async () => {
                    if (!viewingDoc) return;
                    setMarkingReadId(viewingDoc.id);
                    try {
                      await onboardingService.markDocumentAsRead(viewingDoc.id);
                      await refreshOnboarding();
                      setViewingDoc(null);
                    } catch (err: any) {
                      console.error('Failed to mark document as read:', err);
                    } finally {
                      setMarkingReadId(null);
                    }
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                >
                  <CheckCircleIcon className="w-4 h-4" />
                  {markingReadId === viewingDoc.id ? 'Đang lưu...' : 'Đánh dấu đã đọc'}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default RegulationGate;
