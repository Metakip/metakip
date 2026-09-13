import { METAKIP_CLI_DOCS_URL } from '@metakip/shared';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { OnboardingActionButton } from './OnboardingActionButton';

export const CLI_GUIDE = METAKIP_CLI_DOCS_URL;
const UNIX_CLI_INSTALL_COMMAND = 'curl -fsSL https://metakip.com/install.sh | sh';
const WINDOWS_CLI_INSTALL_COMMAND = 'irm https://metakip.com/install.ps1 | iex';
const AGENT_PROMPT = `Set up Metakip for use in this agent session by following the full CLI guide:
${CLI_GUIDE}

Read the guide from start to finish. Install the Metakip CLI and its agent skill. Then guide me through creating an API token in Metakip Settings, authenticate with metakip login, and verify the connection with metakip whoami and metakip doctor. Do not create, modify, import, or delete workspace content unless I explicitly ask.`;

type CliPlatform = 'linux' | 'macos' | 'unknown' | 'windows';
type CopiedItem = 'cli-unix' | 'cli-windows' | 'prompt';

function detectCliPlatform(): CliPlatform {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = (
    navigatorWithUserAgentData.userAgentData?.platform || navigatorWithUserAgentData.userAgent
  ).toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  if (platform.includes('linux')) return 'linux';
  return 'unknown';
}

function CopyIconButton({
  ariaLabel,
  copied,
  onClick,
}: {
  ariaLabel: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

function InstallCommand({
  command,
  copied,
  label,
  onCopy,
}: {
  command: string;
  copied: boolean;
  label?: string;
  onCopy: () => void;
}) {
  return (
    <div>
      {label ? (
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      ) : null}
      <div
        className={`${label ? 'mt-2' : 'mt-3'} flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2.5 dark:bg-zinc-900`}
      >
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-800 dark:text-zinc-200">
          {command}
        </code>
        <CopyIconButton ariaLabel="Copy CLI install command" copied={copied} onClick={onCopy} />
      </div>
    </div>
  );
}

export function AgentSetupStep({
  completionError,
  isWorking,
  onFinish,
}: {
  completionError: string | null;
  isWorking: boolean;
  onFinish: () => void;
}) {
  const [cliPlatform] = useState<CliPlatform>(detectCliPlatform);
  const [copyStatus, setCopyStatus] = useState<CopiedItem | 'failed' | null>(null);
  const copyResetTimeout = useRef<number | null>(null);
  const cliInstallCommand =
    cliPlatform === 'windows' ? WINDOWS_CLI_INSTALL_COMMAND : UNIX_CLI_INSTALL_COMMAND;

  useEffect(() => {
    return () => {
      if (copyResetTimeout.current !== null) window.clearTimeout(copyResetTimeout.current);
    };
  }, []);

  const copyText = async (text: string, copiedItem: CopiedItem) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(copiedItem);
      if (copyResetTimeout.current !== null) window.clearTimeout(copyResetTimeout.current);
      copyResetTimeout.current = window.setTimeout(() => {
        setCopyStatus((currentStatus) => (currentStatus === copiedItem ? null : currentStatus));
        copyResetTimeout.current = null;
      }, 2000);
    } catch {
      // Clipboard access can be denied by the browser; manual copy is safe here.
      setCopyStatus('failed');
    }
  };

  return (
    <>
      <div className="w-full max-w-xl">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Step 2 of 2</p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
          Set up your agent workflow
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          The CLI lets your agent interact with Metakip. It can create and organize pages and
          folders.
        </p>
        <div className="mt-8 border-y border-zinc-200 dark:border-zinc-800">
          <section className="py-4">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Install the CLI</p>
            {cliPlatform === 'unknown' ? (
              <div className="mt-3 space-y-3">
                <InstallCommand
                  label="macOS / Linux"
                  command={UNIX_CLI_INSTALL_COMMAND}
                  copied={copyStatus === 'cli-unix'}
                  onCopy={() => void copyText(UNIX_CLI_INSTALL_COMMAND, 'cli-unix')}
                />
                <InstallCommand
                  label="Windows"
                  command={WINDOWS_CLI_INSTALL_COMMAND}
                  copied={copyStatus === 'cli-windows'}
                  onCopy={() => void copyText(WINDOWS_CLI_INSTALL_COMMAND, 'cli-windows')}
                />
              </div>
            ) : (
              <InstallCommand
                command={cliInstallCommand}
                copied={copyStatus === (cliPlatform === 'windows' ? 'cli-windows' : 'cli-unix')}
                onCopy={() =>
                  void copyText(
                    cliInstallCommand,
                    cliPlatform === 'windows' ? 'cli-windows' : 'cli-unix',
                  )
                }
              />
            )}
            {copyStatus === 'failed' && (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                Copy failed. Copy the command manually instead.
              </p>
            )}
          </section>
          <section className="py-4">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              First-time setup prompt
            </p>
            <div className="mt-3 flex items-start gap-2 rounded-md bg-zinc-100 px-3 py-2.5 dark:bg-zinc-900">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
                {AGENT_PROMPT}
              </pre>
              <CopyIconButton
                ariaLabel="Copy first-time setup prompt"
                copied={copyStatus === 'prompt'}
                onClick={() => void copyText(AGENT_PROMPT, 'prompt')}
              />
            </div>
          </section>
        </div>
        {completionError ? (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {completionError}
          </p>
        ) : null}
      </div>

      <footer className="mt-8 flex min-h-9 w-full max-w-xl items-center justify-start">
        <div className="flex items-center gap-2">
          <a
            href={CLI_GUIDE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Read the Documentation
          </a>
          <OnboardingActionButton onClick={onFinish} disabled={isWorking} isWorking={isWorking}>
            Open App
          </OnboardingActionButton>
        </div>
      </footer>
    </>
  );
}
