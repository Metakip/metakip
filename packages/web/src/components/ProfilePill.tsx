import { METAKIP_DOCS_URL } from '@metakip/shared';
import clsx from 'clsx';
import {
  BookOpen,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Trash2,
  User,
} from 'lucide-react';
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
  collapsed?: boolean;
  isActuallyCollapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function ProfilePill({
  className,
  collapsed = false,
  isActuallyCollapsed,
  onToggleCollapsed,
}: ProfilePillProps) {
  const navigate = useIdentityNavigate();

  const { data: session } = useAuth();

  const { data: trashPages } = useTrashPages();
  const { data: trashFolders } = useTrashFolders();
  const hasTrashItems = (trashPages?.length ?? 0) + (trashFolders?.length ?? 0) > 0;
  const sidebarShortcut = formatShortcut(SHORTCUT_PATTERNS.toggleSidebar);
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
        'rounded-[2rem] border border-white/60 dark:border-zinc-700/50 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex-shrink-0 z-50 relative overflow-visible flex flex-col justify-center',
        collapsed ? 'w-[68px] min-h-[160px] py-4' : 'w-[240px] p-3',
        className,
      )}
    >
      {/* Collapsed State */}
      <div
        className={clsx(
          'absolute inset-0 flex flex-col items-center justify-between py-5 transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed
            ? 'opacity-100 translate-x-0 pointer-events-auto delay-100'
            : 'opacity-0 -translate-x-8 pointer-events-none',
        )}
      >
        <div className="flex flex-col items-center gap-4 w-full">
          <ThemeToggle />
          <Tooltip label={`Open Sidebar (${sidebarShortcut})`} position="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-zinc-900/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <PanelLeftOpen size={20} />
            </button>
          </Tooltip>
          <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt={session.user.name || 'User'}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800">
                <User size={18} />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Sign Out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* Expanded State */}
      <div
        className={clsx(
          'flex flex-col transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] w-full',
          collapsed
            ? 'opacity-0 translate-x-8 pointer-events-none absolute'
            : 'opacity-100 translate-x-0 pointer-events-auto delay-100 relative',
        )}
      >
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
          <Tooltip
            label={`${(isActuallyCollapsed ?? collapsed) ? 'Open' : 'Close'} Sidebar (${sidebarShortcut})`}
            position="top"
          >
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              {(isActuallyCollapsed ?? collapsed) ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
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
