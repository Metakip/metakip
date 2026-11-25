import { METAKIP_DOCS_URL } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { ObsidianImportDialog } from '../components/import/ObsidianImportDialog';
import { ApiTokensPanel } from '../components/settings/ApiTokensPanel';
import { InstallAppCard } from '../components/settings/InstallAppCard';
import { actionColors } from '../components/ui/ActionColors.stylex';
import { WorkspaceMembersPanel } from '../components/workspace/WorkspaceMembersPanel';
import { WorkspacePageToolbar } from '../components/workspace/WorkspacePageToolbar';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { showErrorToast, showSuccessToast } from '../utils/toast';
import { styles } from './Settings.stylex';

export default function Settings() {
  const queryClient = useQueryClient();
  const identityLifecycle = useIdentityLifecycle();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/pages/export');
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      if (!identityLifecycle.isActive()) return;
      const disposition = res.headers.get('content-disposition');
      const match = disposition?.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? 'pages-export.zip';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showSuccessToast('Pages exported');
    } catch {
      if (!identityLifecycle.isActive()) return;
      showErrorToast('Failed to export pages');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div {...stylex.props(styles.settings)}>
      <WorkspacePageToolbar title="Settings" />
      <div>
        <h1 {...stylex.props(styles.pageTitle)}>Settings</h1>
        <p {...stylex.props(styles.pageDescription)}>Manage your account and data.</p>
        <a
          href={METAKIP_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          {...stylex.props(styles.documentationLink)}
        >
          <BookOpen size={16} />
          Read the documentation
        </a>
      </div>

      <section {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.memberHeader)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Workspace members</h2>
          <p {...stylex.props(styles.sectionDescription)}>
            Invite people to collaborate on your workspace. Restricted pages and folders can opt out
            of inherited workspace access.
          </p>
        </div>

        <WorkspaceMembersPanel />
      </section>

      <section {...stylex.props(styles.card)}>
        <ApiTokensPanel />
      </section>

      <InstallAppCard />

      <section {...stylex.props(styles.card, styles.spacedCard)}>
        <div>
          <h2 {...stylex.props(styles.sectionTitle)}>Import Obsidian vault</h2>
          <p {...stylex.props(styles.sectionDescription)}>
            Import your entire Obsidian vault including notes, images, tags, and backlinks.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setShowImportDialog(true)}
            {...stylex.props(actionColors.subdued, styles.primaryButton)}
          >
            <FolderOpen size={16} />
            Import Vault
          </button>
        </div>
      </section>

      <section {...stylex.props(styles.card, styles.spacedCard)}>
        <div>
          <h2 {...stylex.props(styles.sectionTitle)}>Export all pages</h2>
          <p {...stylex.props(styles.sectionDescription)}>
            Download all pages as markdown files in a zip.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={handleExportAll}
            disabled={isExporting}
            {...stylex.props(actionColors.subdued, styles.primaryButton)}
          >
            <Download size={16} />
            {isExporting ? 'Exporting...' : 'Export All Pages'}
          </button>
        </div>
      </section>

      {showImportDialog && (
        <ObsidianImportDialog
          onClose={(outcome) => {
            setShowImportDialog(false);
            if (outcome.kind === 'imported') {
              queryClient.invalidateQueries({ queryKey: ['pageTree'] });
              queryClient.invalidateQueries({ queryKey: ['folderTree'] });
              queryClient.invalidateQueries({ queryKey: ['tags'] });
            }
          }}
        />
      )}
    </div>
  );
}
