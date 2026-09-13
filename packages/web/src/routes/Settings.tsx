import { METAKIP_DOCS_URL } from '@metakip/shared';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ObsidianImportDialog } from '../components/import/ObsidianImportDialog';
import { ApiTokensPanel } from '../components/settings/ApiTokensPanel';
import { WorkspaceMembersPanel } from '../components/workspace/WorkspaceMembersPanel';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { showErrorToast, showSuccessToast } from '../utils/toast';
import { getWorkspacePath } from '../utils/url';

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
    <div className="max-w-3xl space-y-8">
      <div>
        <Link
          to={getWorkspacePath()}
          className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Back to home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage your account and data.
        </p>
        <a
          href={METAKIP_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
        >
          <BookOpen size={16} />
          Read the documentation
        </a>
      </div>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Workspace members
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Invite people to collaborate on your workspace. Restricted pages and folders can opt out
            of inherited workspace access.
          </p>
        </div>

        <WorkspaceMembersPanel />
      </section>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6">
        <ApiTokensPanel />
      </section>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Import Obsidian vault
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Import your entire Obsidian vault including notes, images, tags, and backlinks.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setShowImportDialog(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-700 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-600 transition-colors cursor-pointer"
          >
            <FolderOpen size={16} />
            Import Vault
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Export all pages
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Download all pages as markdown files in a zip.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={handleExportAll}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-700 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-600 transition-colors disabled:opacity-60 cursor-pointer"
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
