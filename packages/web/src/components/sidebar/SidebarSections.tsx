import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarEntityRow, type SidebarRowModel } from './SidebarEntityRow';
import { styles } from './SidebarSections.stylex';
import type { SidebarTreeRuntime } from './sidebarRuntime';

export type SidebarAliasRow = {
  key: string;
  row: SidebarRowModel;
};

export function SidebarSection({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.section)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        {...stylex.props(styles.toggle)}
      >
        {collapsed ? (
          <ChevronRight size={14} {...stylex.props(styles.icon)} />
        ) : (
          <ChevronDown size={14} {...stylex.props(styles.icon)} />
        )}
        <span>{title}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

export function SidebarAliasSection({
  title,
  collapsed,
  onToggle,
  rows,
  runtime,
}: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  rows: readonly SidebarAliasRow[];
  runtime: SidebarTreeRuntime;
}) {
  if (rows.length === 0) return null;
  return (
    <SidebarSection title={title} collapsed={collapsed} onToggle={onToggle}>
      <div {...stylex.props(styles.aliasRows)}>
        {rows.map(({ key, row }) => (
          <SidebarEntityRow key={key} runtime={runtime} entity={row} placement="alias" />
        ))}
      </div>
    </SidebarSection>
  );
}
