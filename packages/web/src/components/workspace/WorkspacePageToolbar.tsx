import { ChevronRight, Home } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getWorkspacePath } from '../../utils/url';
import { AppShellToolbar } from '../AppShellToolbar';

export function WorkspacePageToolbar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <AppShellToolbar className="bg-zinc-50 py-2 dark:bg-zinc-950 md:py-3">
      <div className="flex min-h-9 items-center justify-between gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
          <Link
            to={getWorkspacePath()}
            className="flex h-8 shrink-0 items-center gap-1 rounded-md transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <span className="flex h-8 w-8 items-center justify-center">
              <Home size={16} />
            </span>
            <span>Home</span>
          </Link>
          <ChevronRight size={16} className="shrink-0 text-zinc-300 dark:text-zinc-600" />
          <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        </nav>
        {actions}
      </div>
    </AppShellToolbar>
  );
}
