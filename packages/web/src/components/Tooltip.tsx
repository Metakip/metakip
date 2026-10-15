import clsx from 'clsx';
import type React from 'react';

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
  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    'bottom-left': 'top-full left-0 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div className="group relative inline-flex" style={{ transitionDelay: `${delay}ms` }}>
      {children}
      <span
        className={clsx(
          'absolute z-50 whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-700 px-2 py-1 text-xs font-medium text-white opacity-0 invisible pointer-events-none transition-all duration-200 group-hover:opacity-100 group-hover:visible',
          positionClasses[position],
          className,
        )}
      >
        {label}
      </span>
    </div>
  );
}
