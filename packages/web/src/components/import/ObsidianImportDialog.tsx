import { Dialog } from '@base-ui/react/dialog';
import { extractInlineTags, parseMarkdownFrontmatter } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { directoryOpen } from 'browser-fs-access';
import { AlertCircle, CheckCircle, FileText, FolderOpen, Image, Loader2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';
import { actionColors } from '../ui/ActionColors.stylex';
import { styles } from './ObsidianImportDialog.stylex';

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
        <Dialog.Backdrop className={stylex.props(styles.backdrop).className} />
        <Dialog.Viewport className={stylex.props(styles.viewport).className}>
          <Dialog.Popup {...stylex.props(styles.dialog)} data-import-dialog="">
            <div {...stylex.props(styles.header)}>
              <Dialog.Title className={stylex.props(styles.title).className}>
                {importCopy.title}
              </Dialog.Title>
              <Dialog.Description className={stylex.props(styles.visuallyHidden).className}>
                {importCopy.description}
              </Dialog.Description>
              <Dialog.Close
                disabled={step === 'uploading'}
                {...stylex.props(styles.closeButton)}
                aria-label={`Close ${importCopy.title}`}
              >
                <X size={20} />
              </Dialog.Close>
            </div>

            <div {...stylex.props(styles.body)}>
              {step === 'select' && (
                <div {...stylex.props(styles.step)}>
                  <p {...stylex.props(styles.description)}>{importCopy.description}</p>
                  <button
                    type="button"
                    onClick={scanVault}
                    {...stylex.props(actionColors.contrast, styles.primaryButton)}
                  >
                    <FolderOpen size={18} />
                    {importCopy.selectAction}
                  </button>
                </div>
              )}

              {step === 'preview' && preview && (
                <div {...stylex.props(styles.step)}>
                  <p {...stylex.props(styles.description)}>{importCopy.previewDescription}</p>

                  <div {...stylex.props(styles.previewGrid)}>
                    <div {...stylex.props(styles.previewCard)}>
                      <FileText size={20} {...stylex.props(styles.previewIcon)} />
                      <div {...stylex.props(styles.previewValue)}>{preview.notes}</div>
                      <div {...stylex.props(styles.previewLabel)}>Notes</div>
                    </div>
                    <div {...stylex.props(styles.previewCard)}>
                      <Image size={20} {...stylex.props(styles.previewIcon)} />
                      <div {...stylex.props(styles.previewValue)}>{preview.images}</div>
                      <div {...stylex.props(styles.previewLabel)}>Images</div>
                    </div>
                    <div {...stylex.props(styles.previewCard)}>
                      <FolderOpen size={20} {...stylex.props(styles.previewIcon)} />
                      <div {...stylex.props(styles.previewValue)}>{preview.folders}</div>
                      <div {...stylex.props(styles.previewLabel)}>Folders</div>
                    </div>
                  </div>

                  {preview.tags.size > 0 && (
                    <div>
                      <p {...stylex.props(styles.tagsHeading)}>Tags found:</p>
                      <div {...stylex.props(styles.tags)}>
                        {Array.from(preview.tags)
                          .slice(0, 20)
                          .map((tag) => (
                            <span key={tag} {...stylex.props(styles.tag)}>
                              #{tag}
                            </span>
                          ))}
                        {preview.tags.size > 20 && (
                          <span {...stylex.props(styles.moreTags)}>
                            +{preview.tags.size - 20} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div {...stylex.props(styles.actions)}>
                    <button
                      type="button"
                      onClick={() => setStep('select')}
                      {...stylex.props(styles.secondaryButton)}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={startImport}
                      {...stylex.props(
                        actionColors.contrast,
                        styles.primaryButton,
                        styles.actionPrimaryButton,
                      )}
                    >
                      {importCopy.importAction}
                    </button>
                  </div>
                </div>
              )}

              {step === 'uploading' && (
                <div {...stylex.props(styles.uploading)}>
                  <Loader2 size={32} {...stylex.props(styles.spinner)} />
                  <div>
                    <p {...stylex.props(styles.progressTitle)}>{importCopy.progressTitle}</p>
                    <p {...stylex.props(styles.progressDescription)}>{files.length} files</p>
                  </div>
                  <div {...stylex.props(styles.progressTrack)}>
                    <div {...stylex.props(styles.progressBar)} style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {step === 'done' && result && (
                <div {...stylex.props(styles.step)}>
                  <div {...stylex.props(styles.successHeading)}>
                    <CheckCircle size={24} />
                    <span>Import complete!</span>
                  </div>

                  <div {...stylex.props(styles.resultCard)}>
                    <div {...stylex.props(styles.resultRow)}>
                      <span {...stylex.props(styles.resultLabel)}>Folders created</span>
                      <span {...stylex.props(styles.resultValue)}>{result.foldersCreated}</span>
                    </div>
                    <div {...stylex.props(styles.resultRow)}>
                      <span {...stylex.props(styles.resultLabel)}>Pages created</span>
                      <span {...stylex.props(styles.resultValue)}>{result.pagesCreated}</span>
                    </div>
                    <div {...stylex.props(styles.resultRow)}>
                      <span {...stylex.props(styles.resultLabel)}>Images uploaded</span>
                      <span {...stylex.props(styles.resultValue)}>{result.imagesUploaded}</span>
                    </div>
                    <div {...stylex.props(styles.resultRow)}>
                      <span {...stylex.props(styles.resultLabel)}>Tags created</span>
                      <span {...stylex.props(styles.resultValue)}>{result.tagsCreated}</span>
                    </div>
                    <div {...stylex.props(styles.resultRow)}>
                      <span {...stylex.props(styles.resultLabel)}>Backlinks indexed</span>
                      <span {...stylex.props(styles.resultValue)}>{result.backlinksCreated}</span>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div {...stylex.props(styles.warnings)}>
                      <p {...stylex.props(styles.warningHeading)}>
                        {result.errors.length} warning{result.errors.length > 1 ? 's' : ''}
                      </p>
                      <ul {...stylex.props(styles.warningList)}>
                        {result.errors.slice(0, 5).map((err) => (
                          <li key={err} {...stylex.props(styles.warningItem)}>
                            {err}
                          </li>
                        ))}
                        {result.errors.length > 5 && (
                          <li {...stylex.props(styles.warningItem)}>
                            +{result.errors.length - 5} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  <Dialog.Close
                    className={stylex.props(actionColors.contrast, styles.primaryButton).className}
                  >
                    Done
                  </Dialog.Close>
                </div>
              )}

              {step === 'error' && (
                <div {...stylex.props(styles.step)}>
                  <div {...stylex.props(styles.errorHeading)}>
                    <AlertCircle size={24} />
                    <span>Import failed</span>
                  </div>
                  <p {...stylex.props(styles.description)}>{error}</p>
                  <button
                    type="button"
                    onClick={() => setStep('select')}
                    {...stylex.props(actionColors.contrast, styles.primaryButton)}
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
