import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ToastDismissReason = 'action' | 'dismiss' | 'clear' | 'timeout';

interface Toast {
  id: number;
  message: string;
  icon: React.ReactNode;
  autoClose: number;
  action?: { label: string; onClick(): void };
  onDismiss?: (reason: ToastDismissReason) => void;
  dismiss(reason?: ToastDismissReason): void;
}

type AddToastFn = (toast: Omit<Toast, 'id' | 'dismiss'>) => () => void;

let addToast: AddToastFn | null = null;
let clearToastQueue: (() => void) | null = null;

export function showSuccessToast(message: string) {
  addToast?.({ message, icon: <IconCheck size={16} />, autoClose: 4000 });
}

export function showErrorToast(
  message: string,
  action?: { label: string; onClick(): void },
  onDismiss?: (reason: ToastDismissReason) => void,
): (() => void) | undefined {
  return addToast?.({
    message,
    icon: <IconX size={16} />,
    autoClose: action ? 0 : 5000,
    ...(action ? { action } : {}),
    ...(onDismiss ? { onDismiss } : {}),
  });
}

export function showInfoToast(message: string) {
  addToast?.({ message, icon: <IconInfoCircle size={16} />, autoClose: 4000 });
}

export function clearToasts() {
  clearToastQueue?.();
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activeToasts = useRef(new Map<number, Toast>());
  const nextId = useRef(0);

  const add = useCallback((toast: Omit<Toast, 'id' | 'dismiss'>) => {
    const id = nextId.current++;
    let dismissed = false;
    const dismiss = (reason: ToastDismissReason = 'dismiss') => {
      if (dismissed) return;
      dismissed = true;
      activeToasts.current.delete(id);
      setToasts([...activeToasts.current.values()]);
      toast.onDismiss?.(reason);
    };
    activeToasts.current.set(id, { ...toast, id, dismiss });
    setToasts([...activeToasts.current.values()]);
    if (toast.autoClose > 0) setTimeout(() => dismiss('timeout'), toast.autoClose);
    return dismiss;
  }, []);
  const clear = useCallback(() => {
    for (const toast of [...activeToasts.current.values()]) toast.dismiss('clear');
  }, []);

  useEffect(() => {
    addToast = add;
    clearToastQueue = clear;
    return () => {
      if (addToast === add) addToast = null;
      if (clearToastQueue === clear) clearToastQueue = null;
    };
  }, [add, clear]);

  return (
    <>
      {children}
      {createPortal(
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={clsx(
                'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-slide-down',
                'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-50',
              )}
              style={{ minWidth: '240px', maxWidth: '420px' }}
            >
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{toast.icon}</span>
              <span className="text-sm font-medium">{toast.message}</span>
              {toast.action && (
                <>
                  <button
                    type="button"
                    className="cursor-pointer shrink-0 font-medium text-sm underline"
                    onClick={() => {
                      try {
                        toast.action?.onClick();
                      } finally {
                        toast.dismiss('action');
                      }
                    }}
                  >
                    {toast.action.label}
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss upload error"
                    className="cursor-pointer shrink-0"
                    onClick={() => toast.dismiss('dismiss')}
                  >
                    <IconX size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
