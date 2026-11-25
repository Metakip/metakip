import * as stylex from '@stylexjs/stylex';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { styles } from './PageLoadingState.stylex';

export function PageLoadingState() {
  return (
    <div {...stylex.props(styles.root)}>
      <LoadingIndicator label="Loading page" size="md" />
    </div>
  );
}
