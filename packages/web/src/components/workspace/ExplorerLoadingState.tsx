import * as stylex from '@stylexjs/stylex';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { styles } from './ExplorerLoadingState.stylex';

export function ExplorerLoadingState() {
  return (
    <div {...stylex.props(styles.root)}>
      <LoadingIndicator label="Loading items" />
    </div>
  );
}
