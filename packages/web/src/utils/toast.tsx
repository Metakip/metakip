import * as stylex from '@stylexjs/stylex';
import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { styles } from './toast.stylex';

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
        <div {...stylex.props(styles.container)}>
          {toasts.map((toast) => (
            <div key={toast.id} {...stylex.props(styles.toast)}>
              <span {...stylex.props(styles.icon)}>{toast.icon}</span>
              <span {...stylex.props(styles.message)}>{toast.message}</span>
              {toast.action && (
                <>
                  <button
                    type="button"
                    {...stylex.props(styles.actionButton)}
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
                    {...stylex.props(styles.dismissButton)}
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
