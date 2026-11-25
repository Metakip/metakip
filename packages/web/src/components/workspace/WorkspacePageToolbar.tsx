import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Home } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getWorkspacePath } from '../../utils/url';
import { AppShellToolbar } from '../AppShellToolbar';
import { styles } from './WorkspacePageToolbar.stylex';

export function WorkspacePageToolbar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <AppShellToolbar>
      <div {...stylex.props(styles.content)}>
        <nav aria-label="Breadcrumb" {...stylex.props(styles.breadcrumb)}>
          <Link to={getWorkspacePath()} {...stylex.props(styles.homeLink)}>
            <span {...stylex.props(styles.homeIcon)}>
              <Home size={16} />
            </span>
            <span>Home</span>
          </Link>
          <ChevronRight size={16} {...stylex.props(styles.separator)} />
          <span {...stylex.props(styles.title)}>{title}</span>
        </nav>
        {actions}
      </div>
    </AppShellToolbar>
  );
}
