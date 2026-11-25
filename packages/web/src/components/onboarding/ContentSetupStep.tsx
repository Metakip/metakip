import * as stylex from '@stylexjs/stylex';
import {
  ArrowLeft,
  ArrowRight,
  FileInput,
  FilePenLine,
  FileText,
  FolderUp,
  type LucideIcon,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useRef, useState } from 'react';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';
import { useImportMarkdown } from '../../hooks/use-pages';
import { buildPagePath, getWorkspacePath } from '../../utils/url';
import { ObsidianImportDialog } from '../import/ObsidianImportDialog';
import { choiceCardMarker, styles } from './ContentSetupStep.stylex';
import { OnboardingActionButton } from './OnboardingActionButton';

type FolderImportVariant = 'markdown-folder' | 'obsidian';
type ContentFlow =
  | { kind: 'choose-content' }
  | { kind: 'choose-import' }
  | { kind: 'folder-import'; variant: FolderImportVariant };

function ChoiceCard({
  icon: Icon,
  title,
  description,
  disabled = false,
  separatorBefore = false,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...stylex.props(
        styles.choiceCard,
        separatorBefore && styles.choiceCardSeparated,
        choiceCardMarker,
      )}
      data-onboarding-choice-card=""
    >
      <span {...stylex.props(styles.choiceIcon)}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span {...stylex.props(styles.choiceText)}>
        <span {...stylex.props(styles.choiceTitle)}>{title}</span>
        <span {...stylex.props(styles.choiceDescription)}>{description}</span>
      </span>
      <ArrowRight
        size={16}
        aria-hidden="true"
        {...stylex.props(styles.choiceArrow)}
        data-onboarding-choice-arrow=""
      />
    </button>
  );
}

function ImportOption({
  children,
  disabled,
  icon,
  onClick,
  title,
}: {
  children: ReactNode;
  disabled: boolean;
  icon: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...stylex.props(styles.importOption)}
    >
      {icon}
      <span {...stylex.props(styles.importTitle)}>{title}</span>
      <span {...stylex.props(styles.importDescription)}>{children}</span>
    </button>
  );
}

export function ContentSetupStep({
  completionError,
  isCompleting,
  onAdvance,
  onSkip,
}: {
  completionError: string | null;
  isCompleting: boolean;
  onAdvance: (importedDestination?: string) => void;
  onSkip: () => void;
}) {
  const identityLifecycle = useIdentityLifecycle();
  const importMarkdown = useImportMarkdown();
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const [flow, setFlow] = useState<ContentFlow>({ kind: 'choose-content' });
  const [importError, setImportError] = useState<string | null>(null);
  const isWorking = isCompleting || importMarkdown.isPending;
  const error = flow.kind === 'choose-content' ? completionError : importError;

  const importMarkdownFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) {
      setImportError('Choose a Markdown file ending in .md.');
      return;
    }

    setImportError(null);
    try {
      const { page } = await importMarkdown.mutateAsync({ file });
      if (!identityLifecycle.isActive()) return;
      onAdvance(buildPagePath(page.title, page.id));
    } catch {
      // The import request is a UI boundary where transport/API failures become
      // an actionable message while the mutation retains the original error.
      if (!identityLifecycle.isActive()) return;
      setImportError('We could not import that Markdown file. Please try again.');
    }
  };

  return (
    <div {...stylex.props(styles.content)}>
      {flow.kind === 'choose-content' ? (
        <>
          <p {...stylex.props(styles.stepLabel)}>Step 1 of 2</p>
          <h1 {...stylex.props(styles.titleFirst)}>Set up your workspace</h1>
          <p {...stylex.props(styles.description)}>
            Create your first page or bring your existing notes with you.
          </p>
          <div {...stylex.props(styles.choiceList)}>
            <ChoiceCard
              icon={FilePenLine}
              title="Start Blank"
              description="Let your imagination run free!"
              disabled={isWorking}
              onClick={() => onAdvance()}
            />
            <ChoiceCard
              icon={FileInput}
              title="Import Content"
              description="Markdown files, folders, or an Obsidian vault."
              separatorBefore
              disabled={isWorking}
              onClick={() => setFlow({ kind: 'choose-import' })}
            />
          </div>
          <div {...stylex.props(styles.skipAction)}>
            <OnboardingActionButton onClick={onSkip} disabled={isWorking} isWorking={isCompleting}>
              Skip Onboarding
            </OnboardingActionButton>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setImportError(null);
              setFlow({ kind: 'choose-content' });
            }}
            {...stylex.props(styles.backButton)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          <h1 {...stylex.props(styles.titleNext)}>Bring your notes with you</h1>
          <p {...stylex.props(styles.descriptionNext)}>
            Import one Markdown file, an entire Markdown folder, or an Obsidian vault.
          </p>
          <div {...stylex.props(styles.importGrid)}>
            <ImportOption
              title="Markdown file"
              disabled={isWorking}
              onClick={() => markdownFileRef.current?.click()}
              icon={<FileText size={22} aria-hidden="true" {...stylex.props(styles.importIcon)} />}
            >
              One Markdown
              <br />
              file.
            </ImportOption>
            <ImportOption
              title="Markdown folder"
              disabled={isWorking}
              onClick={() => setFlow({ kind: 'folder-import', variant: 'markdown-folder' })}
              icon={<FolderUp size={22} aria-hidden="true" {...stylex.props(styles.importIcon)} />}
            >
              Files, images,
              <br />
              and folders.
            </ImportOption>
            <ImportOption
              title="Obsidian vault"
              disabled={isWorking}
              onClick={() => setFlow({ kind: 'folder-import', variant: 'obsidian' })}
              icon={
                <img
                  src="https://obsidian.md/images/obsidian-logo-gradient.svg"
                  alt=""
                  aria-hidden="true"
                  {...stylex.props(styles.obsidianIcon)}
                />
              }
            >
              Notes, images,
              <br />
              and backlinks.
            </ImportOption>
          </div>
          <p {...stylex.props(styles.compatibilityNote)}>
            Other apps have not been tested yet. If they store your notes in a Markdown folder,
            choose <span {...stylex.props(styles.compatibilityHighlight)}>Markdown folder</span>.
            First-class support for other apps is coming soon.
          </p>
          <input
            ref={markdownFileRef}
            type="file"
            accept=".md,text/markdown"
            {...stylex.props(styles.visuallyHidden)}
            onChange={(event) => void importMarkdownFile(event)}
          />
        </>
      )}

      {error ? (
        <p role="alert" {...stylex.props(styles.errorMessage)}>
          {error}
        </p>
      ) : null}

      {flow.kind === 'folder-import' ? (
        <ObsidianImportDialog
          variant={flow.variant}
          onClose={(outcome) => {
            if (outcome.kind === 'imported') {
              onAdvance(getWorkspacePath());
              return;
            }
            setFlow({ kind: 'choose-import' });
          }}
        />
      ) : null}
    </div>
  );
}
