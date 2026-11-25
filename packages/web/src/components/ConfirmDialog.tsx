import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import * as stylex from '@stylexjs/stylex';
import { useId, useRef } from 'react';
import { styles } from './ConfirmDialog.stylex';
import { actionColors } from './ui/ActionColors.stylex';
import { styles as frame } from './ui/ModalFrame.stylex';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  loadingText?: string;
  showCancel?: boolean;
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
  loadingText = 'Deleting...',
  showCancel = true,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { refs, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open && !loading) onCancel();
    },
  });
  const dismiss = useDismiss(context, { enabled: !loading, outsidePressEvent: 'mousedown' });
  const { getFloatingProps } = useInteractions([dismiss]);

  if (!isOpen) return null;

  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        className={stylex.props(frame.overlay, frame.raisedOverlay).className}
      >
        <FloatingFocusManager
          context={context}
          {...(showCancel ? { initialFocus: cancelRef } : {})}
          returnFocus
        >
          <div
            ref={refs.setFloating}
            role="alertdialog"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            {...getFloatingProps()}
            {...stylex.props(frame.panel, styles.content)}
          >
            <h2 id={titleId} {...stylex.props(styles.title)}>
              {title}
            </h2>
            <p id={descriptionId} {...stylex.props(styles.message)}>
              {message}
            </p>

            <div {...stylex.props(styles.actions)}>
              {showCancel && (
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancel();
                  }}
                  {...stylex.props(styles.cancel)}
                  disabled={loading}
                >
                  {cancelText}
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onConfirm();
                }}
                {...stylex.props(actionColors.destructive, styles.confirm)}
                disabled={loading}
              >
                {loading ? loadingText : confirmText}
              </button>
            </div>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
