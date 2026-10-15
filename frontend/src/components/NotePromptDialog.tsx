import { useCallback, useRef, useState } from 'react';
import ConfirmDialog, { type ConfirmVariant } from './ConfirmDialog';

// Popup hỏi ghi chú / lý do — thay cho window.prompt() ở các nút duyệt/từ chối.
// window.prompt gây từ chối nhầm trên điện thoại (đơn KP-202610-A1B2C3D4,
// 10/10/2026):
//  - code cũ viết `prompt(...) || 'Không hợp lệ'` nên bấm Huỷ vẫn từ chối đơn;
//  - trình duyệt nhúng trong app (Zalo, app HRM…) thường không hiện hộp prompt
//    mà trả về null ngay, nên 1 lần chạm nhầm "Từ chối" là đơn bị từ chối luôn.
// askNote() trả về chuỗi đã nhập (đã trim) hoặc null nếu người dùng bấm Huỷ /
// bấm ra ngoài — nơi gọi PHẢI dừng lại khi nhận null.

export interface NotePromptOptions {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  confirmLabel?: string;
  variant?: ConfirmVariant;
}

export function useNotePrompt() {
  const [open, setOpen] = useState(false);
  // Giữ options của lần hỏi gần nhất cả khi đã đóng, để nội dung không bị
  // trống trong lúc popup đang chạy hiệu ứng đóng.
  const [options, setOptions] = useState<NotePromptOptions>({ title: '' });
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((note: string | null) => void) | null>(null);

  const finish = (note: string | null) => {
    resolverRef.current?.(note);
    resolverRef.current = null;
    setOpen(false);
  };

  const askNote = useCallback(
    (opts: NotePromptOptions) =>
      new Promise<string | null>((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setOptions(opts);
        setValue(opts.defaultValue ?? '');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const handleConfirm = () => {
    const note = value.trim();
    if (options.required && !note) {
      setError(`Vui lòng nhập ${(options.label || 'lý do').toLowerCase()}.`);
      return;
    }
    finish(note);
  };

  const notePromptDialog = (
    <ConfirmDialog
      open={open}
      variant={options.variant ?? 'warning'}
      title={options.title}
      message={options.message}
      confirmLabel={options.confirmLabel ?? 'Xác nhận'}
      cancelLabel="Huỷ"
      onConfirm={handleConfirm}
      onClose={() => finish(null)}
      zClassName="z-[200]"
    >
      <label className="block text-left text-xs font-semibold text-gray-700 mb-1">
        {options.label ?? 'Ghi chú'}
        {options.required && <span className="text-red-500"> *</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        rows={3}
        placeholder={options.placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-left text-base sm:text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      />
      {error && <p className="mt-1 text-left text-xs text-red-600">{error}</p>}
    </ConfirmDialog>
  );

  return { askNote, notePromptDialog };
}
