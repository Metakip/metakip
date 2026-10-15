import clsx from 'clsx';
import { PageTree } from './sidebar/PageTree';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'relative z-40 flex h-full w-full max-w-[240px] flex-shrink-0 flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.08)] backdrop-blur-2xl dark:border-zinc-700/50 dark:bg-zinc-900/70 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)]',
        className,
      )}
      data-testid="sidebar"
    >
      <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-3">
        <PageTree />
      </div>
    </aside>
  );
}
