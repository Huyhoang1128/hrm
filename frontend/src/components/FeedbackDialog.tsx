import React, { Fragment } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import {
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

export type FeedbackVariant = 'success' | 'error' | 'info' | 'warning';

interface FeedbackDialogProps {
  open: boolean;
  variant?: FeedbackVariant;
  title: React.ReactNode;
  message?: React.ReactNode;
  onClose: () => void;
  okLabel?: string;
}

const VARIANT_STYLES: Record<FeedbackVariant, {
  icon: typeof CheckCircleIcon;
  iconBg: string;
  iconColor: string;
  btnBg: string;
}> = {
  success: {
    icon: CheckCircleIcon,
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    btnBg: 'bg-emerald-600 hover:bg-emerald-700',
  },
  error: {
    icon: XCircleIcon,
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    btnBg: 'bg-red-600 hover:bg-red-700',
  },
  info: {
    icon: InformationCircleIcon,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-600',
    btnBg: 'bg-primary-600 hover:bg-primary-700',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    btnBg: 'bg-amber-600 hover:bg-amber-700',
  },
};

export default function FeedbackDialog({
  open,
  variant = 'info',
  title,
  message,
  onClose,
  okLabel = 'OK',
}: FeedbackDialogProps) {
  const { icon: Icon, iconBg, iconColor, btnBg } = VARIANT_STYLES[variant];

  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[70]" onClose={onClose}>
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
              <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white p-6 text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                <div className="sm:flex sm:items-start">
                  <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${iconBg} sm:mx-0 sm:h-10 sm:w-10`}>
                    <Icon className={`h-6 w-6 ${iconColor}`} />
                  </div>
                  <div className="mt-3 flex-1 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <DialogTitle as="h3" className="text-base font-bold leading-6 text-gray-900">
                      {title}
                    </DialogTitle>
                    {message && (
                      typeof message === 'string'
                        ? <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{message}</p>
                        : <div className="mt-2 text-sm text-gray-600">{message}</div>
                    )}
                  </div>
                </div>
                <div className="mt-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    autoFocus
                    className={`inline-flex w-full justify-center rounded-xl px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all active:scale-95 sm:w-auto ${btnBg}`}
                    onClick={onClose}
                  >
                    {okLabel}
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
