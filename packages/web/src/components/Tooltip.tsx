import * as stylex from '@stylexjs/stylex';
import clsx from 'clsx';
import type React from 'react';
import { styles } from './Tooltip.stylex';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'bottom-left' | 'left' | 'right';
  className?: string;
  delay?: number;
}

export function Tooltip({
  label,
  children,
  position = 'top',
  className,
  delay = 200,
}: TooltipProps) {
  const positionStyles = {
    top: styles.top,
    bottom: styles.bottom,
    'bottom-left': styles.bottomLeft,
    left: styles.left,
    right: styles.right,
  };

  return (
    <div {...stylex.props(stylex.defaultMarker(), styles.root)}>
      {children}
      <span
        className={clsx(
          stylex.props(styles.tooltip, positionStyles[position]).className,
          className,
        )}
        style={{ transitionDelay: `${delay}ms` }}
      >
        {label}
      </span>
    </div>
  );
}
