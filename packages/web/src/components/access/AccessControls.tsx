import * as stylex from '@stylexjs/stylex';
import { Mail } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { styles } from './AccessControls.stylex';

export function AccessSectionHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div {...stylex.props(styles.sectionHeading)}>
      <div {...stylex.props(styles.sectionIcon)}>{icon}</div>
      <p {...stylex.props(styles.sectionTitle)}>{title}</p>
    </div>
  );
}

type InviteAccessFormProps = Omit<
  ComponentPropsWithoutRef<'form'>,
  'className' | 'style' | 'title'
> & { title: string };

export function InviteAccessForm({ title, children, ...formProps }: InviteAccessFormProps) {
  return (
    <form {...formProps} {...stylex.props(styles.form)}>
      <AccessSectionHeading icon={<Mail size={16} />} title={title} />
      <div {...stylex.props(styles.fieldBox)}>
        <div {...stylex.props(styles.inviteFields)}>{children}</div>
      </div>
    </form>
  );
}

export function AccessLoadError({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" {...stylex.props(styles.loadError)}>
      <p {...stylex.props(styles.loadErrorTitle)}>{title}</p>
      <p {...stylex.props(styles.loadErrorDescription)}>{description}</p>
      <button type="button" onClick={onRetry} {...stylex.props(styles.retryButton)}>
        Retry
      </button>
    </div>
  );
}
