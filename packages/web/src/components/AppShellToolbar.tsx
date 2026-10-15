import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';

export type AppShellOutletContext = {
  toolbarContainer: HTMLDivElement | null;
  contentContainer: HTMLDivElement | null;
};

export function useAppShellOutletContext(): AppShellOutletContext {
  const context = useOutletContext<AppShellOutletContext | null>();
  if (!context) throw new Error('This route must be rendered inside AppShell');
  return context;
}

export function AppShellToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const { toolbarContainer } = useAppShellOutletContext();

  if (!toolbarContainer) throw new Error('AppShell toolbar container is unavailable');

  return createPortal(
    <div className={`app-shell-toolbar-content w-full min-w-0 pr-4 md:pl-[52px] ${className}`}>
      {children}
    </div>,
    toolbarContainer,
  );
}
