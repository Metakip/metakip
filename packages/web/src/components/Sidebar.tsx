import * as stylex from '@stylexjs/stylex';
import { styles } from './Sidebar.stylex';
import { PageTree } from './sidebar/PageTree';

interface SidebarProps {
  fill?: boolean;
}

export function Sidebar({ fill = false }: SidebarProps) {
  return (
    <aside {...stylex.props(styles.root, fill && styles.fill)} data-testid="sidebar">
      <div {...stylex.props(styles.content)}>
        <PageTree />
      </div>
    </aside>
  );
}
