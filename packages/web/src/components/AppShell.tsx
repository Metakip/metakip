import clsx from 'clsx';
import { Menu } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { EntityCommandProvider, useEntityCommands } from '../contexts/EntityCommandContext';
import { useShortcut } from '../contexts/KeyboardShortcutContext';
import { useShareContext } from '../contexts/ShareContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed';
import { useTheme } from '../hooks/useTheme';
import { SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { ProfilePill } from './ProfilePill';
import { Sidebar } from './Sidebar';

export type AppShellContentState =
  | { status: 'ready' }
  | { status: 'loading'; content: ReactElement };

export function AppShell({
  contentState = { status: 'ready' },
}: {
  contentState?: AppShellContentState | undefined;
} = {}) {
  return (
    <EntityCommandProvider>
      <AppShellContent contentState={contentState} />
    </EntityCommandProvider>
  );
}

function AppShellContent({ contentState }: { contentState: AppShellContentState }) {
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { setTheme, isDark } = useTheme();
  const location = useLocation();
  const { isAnonymous } = useShareContext();
  const entityCommands = useEntityCommands();
  const isLoading = contentState.status === 'loading';

  useShortcut({
    key: SHORTCUT_PATTERNS.toggleSidebar,
    handler: toggleCollapsed,
    whenInputFocused: 'allow',
    description: 'Toggle sidebar',
  });
  useShortcut({
    key: SHORTCUT_PATTERNS.createNote,
    handler: entityCommands.createNote,
    whenInputFocused: 'allow',
    description: 'Create new note',
  });
  useShortcut({
    key: SHORTCUT_PATTERNS.createFolder,
    handler: entityCommands.createFolder,
    whenInputFocused: 'allow',
    description: 'Create new folder',
  });
  useShortcut({
    key: SHORTCUT_PATTERNS.toggleTheme,
    handler: () => setTheme(isDark ? 'light' : 'dark'),
    whenInputFocused: 'allow',
    description: 'Toggle dark mode',
  });

  usePageMeta();

  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname triggers mobile menu close on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 overflow-hidden text-zinc-900 dark:text-zinc-50 font-sans">
      {!isAnonymous && (
        <>
          {/* Layout Spacer - ensures center content animates smoothly when sidebar is pinned/unpinned */}
          <div
            className={clsx(
              'hidden md:block transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex-shrink-0 overflow-hidden',
              collapsed ? 'w-0' : 'w-[252px]',
            )}
          />

          {collapsed && !isHovered && (
            <button
              type="button"
              className="hidden md:block fixed left-0 top-0 bottom-0 w-16 z-50 bg-transparent border-none p-0 cursor-pointer"
              onMouseEnter={() => setIsHovered(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsHovered(true);
                }
              }}
              aria-label="Show sidebar"
            />
          )}
        </>
      )}

      {!isAnonymous && isMobileMenuOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 z-50 bg-zinc-900/50 backdrop-blur-sm animate-fade-in border-none p-0 cursor-pointer"
          onClick={() => setIsMobileMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsMobileMenuOpen(false);
          }}
          aria-label="Close menu"
        />
      )}

      {!isAnonymous && (
        <section
          aria-label="Sidebar"
          className={clsx(
            'fixed left-0 top-0 bottom-0 z-[51] w-[min(80vw,252px)] flex-col flex-shrink-0 items-center p-3 gap-2',
            'md:z-40 md:flex md:w-[252px] md:pl-3 md:py-3 md:pr-0 md:transition-all md:duration-500 md:ease-[cubic-bezier(0.16,1,0.3,1)]',
            isMobileMenuOpen ? 'flex animate-slide-right' : 'hidden',
            collapsed
              ? isHovered
                ? 'md:opacity-100 md:translate-x-0 md:bg-zinc-50/80 md:dark:bg-zinc-950/80 md:backdrop-blur-xl md:pointer-events-auto'
                : 'md:opacity-0 md:-translate-x-full md:pointer-events-none'
              : 'md:opacity-100 md:translate-x-0 md:pointer-events-auto',
          )}
          onMouseLeave={() => collapsed && setIsHovered(false)}
        >
          <Sidebar
            className="flex-1 w-full"
            collapsed={!isMobileMenuOpen && collapsed && !isHovered}
            onToggleCollapsed={
              isMobileMenuOpen ? () => setIsMobileMenuOpen(false) : toggleCollapsed
            }
          />
          <ProfilePill
            collapsed={!isMobileMenuOpen && collapsed && !isHovered}
            isActuallyCollapsed={!isMobileMenuOpen && collapsed}
            onToggleCollapsed={
              isMobileMenuOpen ? () => setIsMobileMenuOpen(false) : toggleCollapsed
            }
            className="flex-shrink-0"
          />
        </section>
      )}

      <main className="flex min-w-0 flex-1 flex-col h-full overflow-hidden relative">
        {!isAnonymous && (
          <div className="md:hidden flex items-center h-14 px-4 border-b border-zinc-200/50 dark:border-zinc-800/50 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-xl flex-shrink-0 z-10 sticky top-0">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto scroll-smooth pb-8">
          <div
            className={clsx(
              'app-content-shell mx-auto w-full min-w-0 max-w-4xl',
              isLoading
                ? isAnonymous
                  ? 'flex min-h-[100dvh] flex-col p-6 md:p-12'
                  : 'flex min-h-[calc(100dvh-3.5rem)] flex-col p-6 md:min-h-[100dvh] md:p-12'
                : 'min-h-full p-6 md:p-12',
            )}
          >
            {contentState.status === 'loading' ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {contentState.content}
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </div>
        {!isAnonymous && <CommandPalette />}
      </main>
    </div>
  );
}
