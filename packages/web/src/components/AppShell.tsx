import * as stylex from '@stylexjs/stylex';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { EntityCommandProvider, useEntityCommands } from '../contexts/EntityCommandContext';
import { useShortcut } from '../contexts/KeyboardShortcutContext';
import { useShareContext } from '../contexts/ShareContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { usePwaLaunchAction } from '../hooks/usePwaLaunchAction';
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed';
import { useTheme } from '../hooks/useTheme';
import { formatShortcut, SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { styles } from './AppShell.stylex';
import { CommandPalette } from './CommandPalette';
import { ProfilePill } from './ProfilePill';
import { Sidebar } from './Sidebar';
import { Tooltip } from './Tooltip';

export type AppShellContentState =
  | { status: 'ready' }
  | { status: 'loading'; content: ReactElement };

export function AppShell({
  contentState = { status: 'ready' },
  fullWidth = false,
  hasToolbar = false,
}: {
  contentState?: AppShellContentState | undefined;
  fullWidth?: boolean;
  hasToolbar?: boolean;
} = {}) {
  return (
    <EntityCommandProvider>
      <AppShellContent contentState={contentState} fullWidth={fullWidth} hasToolbar={hasToolbar} />
    </EntityCommandProvider>
  );
}

function AppShellContent({
  contentState,
  fullWidth,
  hasToolbar,
}: {
  contentState: AppShellContentState;
  fullWidth: boolean;
  hasToolbar: boolean;
}) {
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toolbarContainer] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const container = document.createElement('div');
    container.setAttribute('data-app-shell-toolbar-portal', '');
    container.className = stylex.props(styles.toolbarPortal).className ?? '';
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
  const openSearch = usePwaLaunchAction();
  const isLoading = contentState.status === 'loading';
  const showToolbar = !isAnonymous || hasToolbar;
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
      {...stylex.props(styles.root)}
      data-app-shell-root=""
      style={
        {
          '--sidebar-column-width': sidebarTakesSpace ? 'var(--sidebar-width)' : '0px',
        } as CSSProperties
      }
    >
      <div
        {...stylex.props(
          styles.toolbarSlot,
          showToolbar && styles.toolbarSlotVisible,
          showToolbar && isAnonymous && styles.toolbarSlotWithoutSidebar,
        )}
        data-app-shell-toolbar-slot=""
      >
        {!isAnonymous && (
          <div {...stylex.props(styles.toolbarToggle)}>
            <Tooltip
              label={`${sidebarOpen ? 'Close' : 'Open'} Sidebar (${sidebarShortcut})`}
              position="bottom-left"
            >
              <button
                type="button"
                onClick={toggleSidebar}
                {...stylex.props(styles.sidebarToggle, sidebarOpen && styles.sidebarToggleOpen)}
                aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
                aria-expanded={sidebarOpen}
                aria-controls="app-sidebar"
              >
                {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
            </Tooltip>
          </div>
        )}
        <div
          {...stylex.props(
            styles.toolbarContentSlot,
            showToolbar && styles.toolbarContentSlotVisible,
            showToolbar && isAnonymous && styles.toolbarContentSlotWithoutSidebar,
          )}
          data-app-shell-toolbar-content-slot=""
          ref={attachToolbarContainer}
        />
      </div>

      {!isAnonymous && mobileMenuVisible && (
        <button
          type="button"
          {...stylex.props(styles.mobileOverlay)}
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
          {...stylex.props(styles.sidebar, sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed)}
        >
          <Sidebar fill />
          <ProfilePill className={stylex.props(styles.profile).className ?? ''} />
        </section>
      )}

      <main {...stylex.props(styles.main)} data-app-shell-main="">
        <div {...stylex.props(styles.scrollContent)} data-app-shell-scroll="">
          <div
            {...stylex.props(
              styles.content,
              fullWidth ? styles.contentFullWidth : styles.contentConstrained,
              isLoading ? styles.contentLoading : styles.contentReady,
              isLoading && isAnonymous && styles.contentLoadingAnonymous,
            )}
            data-app-shell-content=""
            ref={setContentContainer}
          >
            {contentState.status === 'loading' ? (
              <div {...stylex.props(styles.loadingContent)}>{contentState.content}</div>
            ) : (
              <Outlet
                context={{
                  toolbarContainer,
                  contentContainer,
                  isDesktopLayout,
                }}
              />
            )}
          </div>
        </div>
        {!isAnonymous && <CommandPalette openSearch={openSearch} />}
      </main>
    </div>
  );
}
