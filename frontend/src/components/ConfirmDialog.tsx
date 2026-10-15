import { Fragment, ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import {
  ExclamationTriangleIcon,
  TrashIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  variant?: ConfirmVariant;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  // Nội dung tuỳ chọn thêm vào giữa message và hàng nút (vd 1 ô nhập lý do) —
  // không truyền thì hành vi/giao diện y hệt trước đây.
  children?: ReactNode;
  // Lớp z-index của popup — mặc định z-[70]. Popup mở chồng lên modal khác có
  // z-index cao hơn (vd NotePromptDialog) thì truyền giá trị lớn hơn.
  zClassName?: string;
}

const VARIANT_STYLES: Record<ConfirmVariant, {
  icon: typeof ExclamationTriangleIcon;
  iconBg: string;
  iconColor: string;
}> = {
  danger: {
    icon: TrashIcon,
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  info: {
    icon: QuestionMarkCircleIcon,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-600',
  },
};

export default function ConfirmDialog({
  open,
  variant = 'danger',
  title,
  message,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  loading = false,
  onConfirm,
  onClose,
  children,
  zClassName = 'z-[70]',
}: ConfirmDialogProps) {
  const { icon: Icon, iconBg, iconColor } = VARIANT_STYLES[variant];

  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className={`relative ${zClassName}`} onClose={loading ? () => {} : onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" />
        </TransitionChild>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel className="relative w-full transform overflow-hidden rounded-2xl bg-white p-6 text-left shadow-2xl transition-all sm:my-8 sm:max-w-md">
                <div className="sm:flex sm:items-start">
                  <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${iconBg} sm:mx-0 sm:h-10 sm:w-10`}>
                    <Icon className={`h-6 w-6 ${iconColor}`} />
                  </div>
                  <div className="mt-3 flex-1 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <DialogTitle as="h3" className="text-base font-bold leading-6 text-gray-900">
                      {title}
                    </DialogTitle>
                    {message && (
                      <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{message}</p>
                    )}
                    {children && <div className="mt-3">{children}</div>}
                  </div>
                </div>
                <div className="mt-6 sm:flex sm:flex-row-reverse gap-2">
                  <button
                    type="button"
                    autoFocus
                    disabled={loading}
                    className="inline-flex w-full justify-center rounded-xl px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all active:scale-95 sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed bg-primary-600 hover:bg-primary-700"
                    onClick={onConfirm}
                  >
                    {loading ? 'Đang xử lý...' : confirmLabel}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    className="mt-3 inline-flex w-full justify-center rounded-xl border border-primary-300 bg-white px-6 py-2.5 text-sm font-semibold text-primary-600 shadow-sm hover:bg-primary-50 transition-all sm:mt-0 sm:w-auto disabled:opacity-60"
                    onClick={onClose}
                  >
                    {cancelLabel}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
