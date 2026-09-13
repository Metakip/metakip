import { Dialog } from '@base-ui/react/dialog';
import { extractInlineTags, parseMarkdownFrontmatter } from '@metakip/shared';
import { directoryOpen } from 'browser-fs-access';
import { AlertCircle, CheckCircle, FileText, FolderOpen, Image, Loader2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';

interface VaultFile {
  path: string;
  content?: string;
  data?: string;
  mimeType?: string;
}

interface ImportPreview {
  notes: number;
  images: number;
  folders: number;
  tags: Set<string>;
}

export type FolderImportOutcome = { kind: 'cancelled' } | { kind: 'imported' };

type ImportVariant = 'markdown-folder' | 'obsidian';

type ImportCopy = {
  title: string;
  description: string;
  selectAction: string;
  previewDescription: string;
  importAction: string;
  progressTitle: string;
  readError: string;
};

const IMPORT_COPY = {
  'markdown-folder': {
    title: 'Import Markdown Folder',
    description: 'Select a folder to import its md files, images, and structure.',
    selectAction: 'Select Markdown Folder',
    previewDescription: 'Found the following in your folder:',
    importAction: 'Import Folder',
    progressTitle: 'Importing your folder...',
    readError: 'Failed to read folder',
  },
  obsidian: {
    title: 'Import Obsidian Vault',
    description: 'Select your Obsidian Vault to import all notes, images, and tags.',
    selectAction: 'Select Vault',
    previewDescription: 'Found the following in your vault:',
    importAction: 'Import Vault',
    progressTitle: 'Importing your vault...',
    readError: 'Failed to read vault',
  },
} satisfies Record<ImportVariant, ImportCopy>;

interface ObsidianImportDialogProps {
  onClose: (outcome: FolderImportOutcome) => void;
  variant?: ImportVariant;
}

export function ObsidianImportDialog({ onClose, variant = 'obsidian' }: ObsidianImportDialogProps) {
  const identityLifecycle = useIdentityLifecycle();
  const [step, setStep] = useState<'select' | 'preview' | 'uploading' | 'done' | 'error'>('select');
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    foldersCreated: number;
    pagesCreated: number;
    imagesUploaded: number;
    tagsCreated: number;
    backlinksCreated: number;
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string>('');
  const importCopy = IMPORT_COPY[variant];

  const scanVault = useCallback(async () => {
    try {
      const dirHandle = await directoryOpen({ recursive: true });
      if (!identityLifecycle.isActive()) return;
      const scannedFiles: VaultFile[] = [];
      const tags = new Set<string>();
      let noteCount = 0;
      let imageCount = 0;
      const folderPaths = new Set<string>();

      const allPaths: string[] = [];
      for (const file of dirHandle as unknown as File[]) {
        const rawPath =
          (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;
        allPaths.push(rawPath.replace(/\\/g, '/'));
      }

      const commonRoot =
        allPaths.length > 0 && allPaths.every((p) => p.startsWith(`${allPaths[0]?.split('/')[0]}/`))
          ? `${allPaths[0]?.split('/')[0]}/`
          : null;

      for (let i = 0; i < (dirHandle as unknown as File[]).length; i++) {
        if (!identityLifecycle.isActive()) return;
        const file = (dirHandle as unknown as File[])[i];
        if (!file) continue;
        let relativePath = allPaths[i] ?? '';
        if (commonRoot && relativePath.startsWith(commonRoot)) {
          relativePath = relativePath.slice(commonRoot.length);
        }

        const pathParts = relativePath.split('/');
        if (pathParts.some((p) => p === '.obsidian')) continue;

        const dir = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';

        if (file.name.endsWith('.md')) {
          if (dir) folderPaths.add(dir);
          const content = await file.text();
          if (!identityLifecycle.isActive()) return;
          scannedFiles.push({ path: relativePath, content });
          noteCount++;

          for (const tag of parseMarkdownFrontmatter(content).tags) {
            tags.add(tag.toLowerCase());
          }
          for (const tag of extractInlineTags(content)) tags.add(tag);
        } else if (
          file.type.startsWith('image/') ||
          /\.(jpe?g|png|gif|webp|svg)$/i.test(file.name)
        ) {
          if (dir) folderPaths.add(dir);
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64Data = result.split(',')[1] || '';
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          if (!identityLifecycle.isActive()) return;
          scannedFiles.push({
            path: relativePath,
            data: base64,
            mimeType: file.type || 'image/png',
          });
          imageCount++;
        }
      }

      setFiles(scannedFiles);
      setPreview({
        notes: noteCount,
        images: imageCount,
        folders: folderPaths.size,
        tags,
      });
      setStep('preview');
    } catch (error) {
      if (!identityLifecycle.isActive()) return;
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setError(error instanceof Error ? error.message : importCopy.readError);
        setStep('error');
      }
    }
  }, [identityLifecycle, importCopy]);

  const startImport = useCallback(async () => {
    if (!identityLifecycle.isActive()) return;
    setStep('uploading');
    setProgress(0);

    const _totalFiles = files.length;

    try {
      const res = await fetch('/api/import/obsidian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ files }),
      });
      if (!identityLifecycle.isActive()) return;

      setProgress(100);

      if (!res.ok) {
        const errData: unknown = await res.json();
        if (!identityLifecycle.isActive()) return;
        if (
          errData &&
          typeof errData === 'object' &&
          'message' in errData &&
          typeof errData.message === 'string'
        ) {
          throw new Error(errData.message);
        }
        throw new Error('Import failed with an invalid error response');
      }

      const data = await res.json();
      if (!identityLifecycle.isActive()) return;
      setResult(data);
      setStep('done');
    } catch (error) {
      if (!identityLifecycle.isActive()) return;
      setError(error instanceof Error ? error.message : 'Import failed');
      setStep('error');
    }
  }, [files, identityLifecycle]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && step !== 'uploading') {
          onClose(step === 'done' ? { kind: 'imported' } : { kind: 'cancelled' });
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-sm" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <Dialog.Popup className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <Dialog.Title className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {importCopy.title}
              </Dialog.Title>
              <Dialog.Description className="sr-only">{importCopy.description}</Dialog.Description>
              <Dialog.Close
                disabled={step === 'uploading'}
                className="cursor-pointer rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
                aria-label={`Close ${importCopy.title}`}
              >
                <X size={20} />
              </Dialog.Close>
            </div>

            <div className="px-6 py-6">
              {step === 'select' && (
                <div className="space-y-4">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {importCopy.description}
                  </p>
                  <button
                    type="button"
                    onClick={scanVault}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-3 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                  >
                    <FolderOpen size={18} />
                    {importCopy.selectAction}
                  </button>
                </div>
              )}

              {step === 'preview' && preview && (
                <div className="space-y-4">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {importCopy.previewDescription}
                  </p>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-center">
                      <FileText
                        size={20}
                        className="mx-auto text-zinc-500 dark:text-zinc-400 mb-1"
                      />
                      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {preview.notes}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">Notes</div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-center">
                      <Image size={20} className="mx-auto text-zinc-500 dark:text-zinc-400 mb-1" />
                      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {preview.images}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">Images</div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-center">
                      <FolderOpen
                        size={20}
                        className="mx-auto text-zinc-500 dark:text-zinc-400 mb-1"
                      />
                      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {preview.folders}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">Folders</div>
                    </div>
                  </div>

                  {preview.tags.size > 0 && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                        Tags found:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(preview.tags)
                          .slice(0, 20)
                          .map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-700 dark:text-zinc-300"
                            >
                              #{tag}
                            </span>
                          ))}
                        {preview.tags.size > 20 && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            +{preview.tags.size - 20} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep('select')}
                      className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={startImport}
                      className="flex-1 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                    >
                      {importCopy.importAction}
                    </button>
                  </div>
                </div>
              )}

              {step === 'uploading' && (
                <div className="py-8 text-center space-y-4">
                  <Loader2
                    size={32}
                    className="mx-auto animate-spin text-zinc-500 dark:text-zinc-400"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {importCopy.progressTitle}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      {files.length} files
                    </p>
                  </div>
                  <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zinc-900 dark:bg-zinc-100 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {step === 'done' && result && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-green-600 dark:text-green-400">
                    <CheckCircle size={24} />
                    <span className="font-medium">Import complete!</span>
                  </div>

                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">Folders created</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {result.foldersCreated}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">Pages created</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {result.pagesCreated}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">Images uploaded</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {result.imagesUploaded}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">Tags created</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {result.tagsCreated}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">Backlinks indexed</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {result.backlinksCreated}
                      </span>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                        {result.errors.length} warning{result.errors.length > 1 ? 's' : ''}
                      </p>
                      <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 max-h-24 overflow-y-auto">
                        {result.errors.slice(0, 5).map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                        {result.errors.length > 5 && <li>+{result.errors.length - 5} more</li>}
                      </ul>
                    </div>
                  )}

                  <Dialog.Close className="w-full rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">
                    Done
                  </Dialog.Close>
                </div>
              )}

              {step === 'error' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                    <AlertCircle size={24} />
                    <span className="font-medium">Import failed</span>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{error}</p>
                  <button
                    type="button"
                    onClick={() => setStep('select')}
                    className="w-full rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
