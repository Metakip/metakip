import * as stylex from '@stylexjs/stylex';
import type React from 'react';
import { styles } from './EmptyState.stylex';
import { actionColors } from './ui/ActionColors.stylex';

type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
};

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <div {...stylex.props(styles.root, compact ? styles.compact : styles.regular)}>
      <div {...stylex.props(styles.icon, compact ? styles.iconCompact : styles.iconRegular)}>
        {icon}
      </div>
      <h3 {...stylex.props(styles.title, compact ? styles.titleCompact : styles.titleRegular)}>
        {title}
      </h3>
      {description && (
        <p
          {...stylex.props(
            styles.description,
            compact ? styles.descriptionCompact : styles.descriptionRegular,
          )}
        >
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          {...stylex.props(actionColors.contrast, styles.action)}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
