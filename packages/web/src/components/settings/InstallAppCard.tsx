import { Download } from 'lucide-react';
import { usePwaInstall } from '../../contexts/PwaInstallContext';

export function InstallAppCard() {
  const { canInstall, isInstalled, isStandalone, install } = usePwaInstall();

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900 lg:hidden">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {isStandalone
            ? 'Metakip is installed'
            : isInstalled
              ? 'Install requested'
              : 'Install Metakip'}
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Add Metakip to your home screen for quick access. An internet connection is required to
          use your workspace.
        </p>

        {isStandalone || isInstalled ? (
          <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
                className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              >
                <Download size={16} />
                Install Metakip
              </button>
            )}

            {!canInstall && (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
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
