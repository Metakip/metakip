import { METAKIP_DOCS_URL } from '@metakip/shared';
import clsx from 'clsx';
import { BookOpen, LogOut, Search, Settings, Trash2, User } from 'lucide-react';
import { useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useTrashFolders } from '../hooks/use-folders';
import { useTrashPages } from '../hooks/use-pages';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';
import { formatShortcut, SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { getWorkspacePath } from '../utils/url';
import { ThemeToggle } from './ThemeToggle';
import { Tooltip } from './Tooltip';

interface ProfilePillProps {
  className?: string;
}

export function ProfilePill({ className }: ProfilePillProps) {
  const navigate = useIdentityNavigate();

  const { data: session } = useAuth();

  const { data: trashPages } = useTrashPages();
  const { data: trashFolders } = useTrashFolders();
  const hasTrashItems = (trashPages?.length ?? 0) + (trashFolders?.length ?? 0) > 0;
  const searchShortcut = formatShortcut(SHORTCUT_PATTERNS.commandPalette);

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          navigate('/login');
        },
      },
    });
  };

  return (
    <div
      className={clsx(
        'relative z-50 flex w-full max-w-[240px] flex-shrink-0 flex-col justify-center overflow-visible rounded-[2rem] border border-white/60 bg-white/70 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.08)] backdrop-blur-2xl dark:border-zinc-700/50 dark:bg-zinc-900/70 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)]',
        className,
      )}
    >
      <div className="flex w-full flex-col">
        <div className="flex items-center justify-between mb-2">
          <ThemeToggle />
          <Tooltip label="Documentation" position="top">
            <a
              href={METAKIP_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Documentation"
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <BookOpen size={18} />
            </a>
          </Tooltip>
          <Tooltip label="Settings" position="top">
            <button
              type="button"
              onClick={() => navigate(getWorkspacePath('settings'))}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Settings size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Trash" position="top">
            <button
              type="button"
              onClick={() => navigate(getWorkspacePath('trash'))}
              className="relative p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Trash2 size={18} />
              {hasTrashItems && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-zinc-900 dark:bg-white shadow-sm" />
              )}
            </button>
          </Tooltip>
          <Tooltip label={`Search (${searchShortcut})`} position="top">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('open-search'))}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Search size={18} />
            </button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/50 dark:hover:bg-zinc-800/50 transition-colors group cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex-shrink-0 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt={session.user.name || 'User'}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-400">
                <User size={16} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {session?.user?.name || 'User'}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {session?.user?.email}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer"
            title="Sign Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
