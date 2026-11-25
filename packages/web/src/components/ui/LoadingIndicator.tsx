import * as stylex from '@stylexjs/stylex';
import { Loader2 } from 'lucide-react';
import { styles } from './LoadingIndicator.stylex';

type LoadingIndicatorProps = {
  label: string;
  size?: 'sm' | 'md';
};

export function LoadingIndicator({ label, size = 'sm' }: LoadingIndicatorProps) {
  return (
    <div role="status" aria-label={label}>
      <Loader2 aria-hidden="true" {...stylex.props(styles.icon, styles[size])} />
    </div>
  );
}
