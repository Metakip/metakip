import * as stylex from '@stylexjs/stylex';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { styles } from './AccessTable.stylex';

type AccessTableProps = {
  headers: readonly [string, string] | readonly [string, string, string];
  children: ReactNode;
};

export function AccessTable({ headers, children }: AccessTableProps) {
  return (
    <div {...stylex.props(styles.table, headers.length === 2 && styles.compact)}>
      <div {...stylex.props(styles.header)}>
        {headers.map((header) => (
          <span key={header}>{header}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

type AccessTableRowProps = Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'style'>;

// The table owns the column layout; members, collaborators, and invitations
// share its actual tracks through subgrid, including content-sized columns.
export function AccessTableRow({ children, ...props }: AccessTableRowProps) {
  return (
    <div {...props} {...stylex.props(styles.row)}>
      {children}
    </div>
  );
}

export function AccessTableMessage({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.message)}>{children}</p>;
}
