import * as stylex from '@stylexjs/stylex';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { styles } from './OnboardingActionButton.stylex';

export function OnboardingActionButton({
  children,
  disabled = false,
  isWorking = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  isWorking?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} {...stylex.props(styles.button)}>
      {isWorking ? (
        <Loader2 size={16} {...stylex.props(styles.spinner)} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
