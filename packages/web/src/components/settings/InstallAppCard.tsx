import * as stylex from '@stylexjs/stylex';
import { Download } from 'lucide-react';
import { usePwaInstall } from '../../contexts/PwaInstallContext';
import { actionColors } from '../ui/ActionColors.stylex';
import { styles } from './InstallAppCard.stylex';

export function InstallAppCard() {
  const { canInstall, isInstalled, isStandalone, install } = usePwaInstall();

  return (
    <section {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.content)}>
        <h2 {...stylex.props(styles.title)}>
          {isStandalone
            ? 'Metakip is installed'
            : isInstalled
              ? 'Install requested'
              : 'Install Metakip'}
        </h2>
        <p {...stylex.props(styles.description)}>
          Add Metakip to your home screen for quick access. An internet connection is required to
          use your workspace.
        </p>

        {isStandalone || isInstalled ? (
          <p {...stylex.props(styles.status)}>
            {isStandalone
              ? 'This device is using the installed app.'
              : 'Metakip may take a moment to appear in your apps.'}
          </p>
        ) : (
          <>
            {canInstall && (
              <button
                type="button"
                onClick={() => void install()}
                {...stylex.props(actionColors.subdued, styles.installButton)}
              >
                <Download size={16} />
                Install Metakip
              </button>
            )}

            {!canInstall && (
              <p {...stylex.props(styles.instructions)}>
                On Android, open your browser menu and choose <strong>Install app</strong> or{' '}
                <strong>Add to Home screen</strong>. On iPhone, use Safari’s Share menu and choose{' '}
                <strong>Add to Home Screen</strong>.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
