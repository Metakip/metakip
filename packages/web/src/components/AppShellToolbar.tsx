import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { styles } from './AppShell.stylex';

export type AppShellOutletContext = {
  toolbarContainer: HTMLDivElement | null;
  contentContainer: HTMLDivElement | null;
  isDesktopLayout: boolean;
};

export function useAppShellOutletContext(): AppShellOutletContext {
  const context = useOutletContext<AppShellOutletContext | null>();
  if (!context) throw new Error('This route must be rendered inside AppShell');
  return context;
}

export function AppShellToolbar({ children }: { children: ReactNode }) {
  const { toolbarContainer } = useAppShellOutletContext();

  if (!toolbarContainer) throw new Error('AppShell toolbar container is unavailable');

  return createPortal(
    <div {...stylex.props(styles.toolbarContent)} data-app-shell-toolbar-content="">
      {children}
    </div>,
    toolbarContainer,
  );
}
