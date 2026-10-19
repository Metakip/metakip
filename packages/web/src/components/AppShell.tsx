import clsx from 'clsx';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { EntityCommandProvider, useEntityCommands } from '../contexts/EntityCommandContext';
import { useShortcut } from '../contexts/KeyboardShortcutContext';
import { useShareContext } from '../contexts/ShareContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed';
import { useTheme } from '../hooks/useTheme';
import { formatShortcut, SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { ProfilePill } from './ProfilePill';
import { Sidebar } from './Sidebar';
import { Tooltip } from './Tooltip';

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toolbarContainer] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const container = document.createElement('div');
    container.className = 'app-shell-toolbar-portal';
    return container;
  });
  const [contentContainer, setContentContainer] = useState<HTMLDivElement | null>(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 48rem)').matches,
  );
  const { setTheme, isDark } = useTheme();
  const location = useLocation();
  const { isAnonymous } = useShareContext();
  const entityCommands = useEntityCommands();
  const isLoading = contentState.status === 'loading';
  const mobileMenuVisible = isMobileMenuOpen && !isDesktopLayout;
  const sidebarTakesSpace = !isAnonymous && !collapsed;
  const sidebarOpen = isDesktopLayout ? !collapsed : mobileMenuVisible;
  const sidebarShortcut = formatShortcut(SHORTCUT_PATTERNS.toggleSidebar);
  const toggleSidebar = useCallback(() => {
    if (isDesktopLayout) {
      toggleCollapsed();
      return;
    }
    setIsMobileMenuOpen((open) => !open);
  }, [isDesktopLayout, toggleCollapsed]);

  const attachToolbarContainer = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot && toolbarContainer && toolbarContainer.parentElement !== slot) {
        slot.appendChild(toolbarContainer);
      }
    },
    [toolbarContainer],
  );

  useShortcut({
    key: SHORTCUT_PATTERNS.toggleSidebar,
    handler: toggleSidebar,
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

  useEffect(() => {
    const desktopLayout = window.matchMedia('(min-width: 48rem)');
    const updateDesktopLayout = () => {
      setIsDesktopLayout(desktopLayout.matches);
      if (desktopLayout.matches) setIsMobileMenuOpen(false);
    };
    updateDesktopLayout();
    desktopLayout.addEventListener('change', updateDesktopLayout);
    return () => desktopLayout.removeEventListener('change', updateDesktopLayout);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname triggers mobile menu close on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div
      className="app-shell-layout grid h-screen w-full grid-cols-1 overflow-hidden bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      style={
        {
          '--sidebar-column-width': sidebarTakesSpace ? 'var(--sidebar-width)' : '0px',
        } as CSSProperties
      }
    >
      <div
        className="app-shell-toolbar-slot"
        data-sidebar-toggle={!isAnonymous ? 'true' : 'false'}
        data-sidebar-open={mobileMenuVisible ? 'true' : 'false'}
      >
        {!isAnonymous && (
          <div className="app-shell-mobile-sidebar-toggle">
            <Tooltip
              label={`${sidebarOpen ? 'Close' : 'Open'} Sidebar (${sidebarShortcut})`}
              position="bottom-left"
            >
              <button
                type="button"
                onClick={toggleSidebar}
                className={clsx(
                  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md p-2 transition-colors',
                  sidebarOpen
                    ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
                )}
                aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
                aria-expanded={sidebarOpen}
                aria-controls="app-sidebar"
              >
                {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
            </Tooltip>
          </div>
        )}
        <div className="app-shell-toolbar-content-slot" ref={attachToolbarContainer} />
      </div>

      {!isAnonymous && mobileMenuVisible && (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 top-[var(--app-toolbar-height)] z-50 cursor-pointer animate-fade-in border-none bg-zinc-900/50 p-0 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsMobileMenuOpen(false);
          }}
          aria-label="Close menu"
        />
      )}

      {!isAnonymous && (
        <section
          id="app-sidebar"
          aria-label="Sidebar"
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
          className={clsx(
            'fixed bottom-0 left-0 top-[var(--app-toolbar-height)] z-[51] flex w-[80vw] max-w-[var(--sidebar-width)] flex-shrink-0 flex-col items-center gap-3 p-3 transition-[transform,opacity] duration-200 ease-in-out',
            'md:col-start-1 md:row-start-2 md:static md:z-40 md:h-full md:w-[var(--sidebar-width)] md:max-w-none md:overflow-hidden md:pl-4 md:py-3 md:pr-0',
            sidebarOpen
              ? 'pointer-events-auto translate-x-0 opacity-100'
              : 'pointer-events-none -translate-x-full opacity-0',
            'md:transition-[transform,opacity] md:duration-200 md:ease-in-out',
          )}
        >
          <Sidebar className="flex-1" />
          <ProfilePill className="flex-shrink-0" />
        </section>
      )}

      <main className="relative col-start-1 row-start-2 flex h-full min-w-0 flex-col overflow-hidden md:col-start-2 md:row-start-2">
        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto scroll-smooth pb-8">
          <div
            className={clsx(
              'app-shell-content mx-auto w-full min-w-0 max-w-4xl',
              isLoading
                ? isAnonymous
                  ? 'flex min-h-[100dvh] flex-col p-6 md:p-12'
                  : 'flex min-h-[calc(100dvh-3.5rem)] flex-col p-6 md:min-h-[100dvh] md:p-12'
                : 'min-h-full p-6 md:p-12',
            )}
            ref={setContentContainer}
          >
            {contentState.status === 'loading' ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {contentState.content}
              </div>
            ) : (
              <Outlet
                context={{
                  toolbarContainer,
                  contentContainer,
                }}
              />
            )}
          </div>
        </div>
        {!isAnonymous && <CommandPalette />}
      </main>
    </div>
  );
}
