import { ArrowTopRightOnSquareIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

/**
 * true nếu trình duyệt hiển thị được PDF ngay trong trang (iframe).
 * Chrome trên Android (và nhiều trình duyệt nhúng trong app) KHÔNG có trình
 * xem PDF nhúng — iframe trỏ vào PDF ra khung trắng. navigator.pdfViewerEnabled
 * là cách chuẩn để hỏi; trình duyệt cũ chưa có thuộc tính này thì coi Android là
 * không xem được.
 */
export const canShowPdfInline = (): boolean => {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
  if (typeof nav.pdfViewerEnabled === 'boolean') return nav.pdfViewerEnabled;
  return !/Android/i.test(nav.userAgent);
};

interface Props {
  src: string;
  title: string;
  /** Áp cho iframe, hoặc cho khung thay thế khi không xem PDF trong trang được. */
  className?: string;
  /** Gọi khi tài liệu đã hiển thị: iframe load xong, hoặc — với trình duyệt không
   *  xem PDF trong trang — lúc người dùng bấm "Mở tài liệu" (để các màn "đã đọc
   *  sau N giây" không tính giờ khi người dùng chưa thấy gì). */
  onLoad?: () => void;
  /** Tên file khi src là blob: (blob không mở tab mới được, phải tải về). */
  downloadName?: string;
}

/** File không phải PDF (vd .docx): iframe không hiển thị được mà trình duyệt tải luôn
 *  file về, khung để trắng và onLoad không bao giờ chạy. */
const isNonPdfFile = (src: string): boolean => {
  if (src.startsWith('blob:')) return false;
  const path = src.split(/[?#]/)[0].toLowerCase();
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
  return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf'].includes(ext);
};

/** Hiển thị PDF: iframe nếu trình duyệt hỗ trợ, ngược lại là nút mở tài liệu. */
export default function PdfFrame({ src, title, className = 'w-full h-full border-0', onLoad, downloadName }: Props) {
  const nonPdf = isNonPdfFile(src);
  if (!nonPdf && canShowPdfInline()) {
    return <iframe src={src} title={title} className={className} onLoad={onLoad} />;
  }

  const isBlob = src.startsWith('blob:');
  return (
    <div className={`${className} flex flex-col items-center justify-center gap-3 p-6 text-center bg-gray-100`}>
      <DocumentTextIcon className="h-10 w-10 text-gray-400" />
      <p className="max-w-xs text-sm text-gray-600">
        {nonPdf
          ? 'Tài liệu dạng Word/Excel không xem trực tiếp trong trang được. Bấm nút bên dưới để tải về và đọc.'
          : 'Trình duyệt trên điện thoại này không hiển thị PDF ngay trong trang. Bấm nút bên dưới để mở tài liệu.'}
      </p>
      <a
        href={src}
        {...(isBlob
          ? { download: downloadName || `${title || 'tai-lieu'}.pdf` }
          : { target: '_blank', rel: 'noopener noreferrer' })}
        onClick={() => onLoad?.()}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
      >
        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        {nonPdf ? 'Tải tài liệu về' : 'Mở tài liệu'}
      </a>
    </div>
  );
}
