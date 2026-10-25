import { METAKIP_CLI_DOCS_URL, METAKIP_DOCS_URL } from '@metakip/shared';
import { ArrowUpRight } from 'lucide-react';
import chatgptIcon from '../../../../marketing-site/public/agents/chatgpt.svg?url';
import claudeIcon from '../../../../marketing-site/public/agents/claude.svg?url';
import grokIcon from '../../../../marketing-site/public/agents/grok.svg?url';
import hermesIcon from '../../../../marketing-site/public/agents/nous-girl.png?url';
import openclawIcon from '../../../../marketing-site/public/agents/openclaw.svg?url';
import opencodeIcon from '../../../../marketing-site/public/agents/opencode.svg?url';
import piIcon from '../../../../marketing-site/public/agents/pi.svg?url';
import { OnboardingActionButton } from './OnboardingActionButton';

const AGENT_GUIDES = `${METAKIP_DOCS_URL}/agents/`;
const MCP_GUIDE = `${AGENT_GUIDES}mcp/`;
export const CLI_GUIDE = METAKIP_CLI_DOCS_URL;

// Vite bundles the marketing site's source marks with the app, avoiding a runtime dependency on that site.
const agentGuides = [
  {
    name: 'ChatGPT (Web)',
    slug: 'chatgpt-web',
    icon: chatgptIcon,
  },
  {
    name: 'ChatGPT Desktop, Work & Codex',
    slug: 'chatgpt-app',
    icon: chatgptIcon,
  },
  {
    name: 'Claude (Web & Desktop)',
    slug: 'claude',
    icon: claudeIcon,
  },
  {
    name: 'Claude Code',
    slug: 'claude-code',
    icon: claudeIcon,
  },
  {
    name: 'Grok',
    slug: 'grok',
    icon: grokIcon,
  },
  {
    name: 'Grok Build',
    slug: 'grok-build',
    icon: grokIcon,
  },
  {
    name: 'Hermes Agent',
    slug: 'hermes',
    icon: hermesIcon,
  },
  {
    name: 'OpenCode',
    slug: 'opencode',
    icon: opencodeIcon,
  },
  {
    name: 'OpenClaw',
    slug: 'openclaw',
    icon: openclawIcon,
  },
  {
    name: 'Pi',
    slug: 'pi',
    icon: piIcon,
  },
] as const;

export function AgentSetupStep({
  completionError,
  isWorking,
  onFinish,
}: {
  completionError: string | null;
  isWorking: boolean;
  onFinish: () => void;
}) {
  return (
    <>
      <div className="w-full max-w-2xl">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Step 2 of 2</p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
          Connect your AI Agent
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Select your agent for setup instructions specific to its connection options.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {agentGuides.map((guide) => (
            <a
              key={guide.slug}
              href={`${AGENT_GUIDES}${guide.slug}/`}
              target="_blank"
              rel="noreferrer"
              className="group flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white">
                <img
                  src={guide.icon}
                  alt=""
                  aria-hidden="true"
                  className={
                    guide.icon === hermesIcon
                      ? 'size-full object-contain'
                      : 'size-3/4 object-contain'
                  }
                  width="36"
                  height="36"
                  loading="lazy"
                />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {guide.name}
              </span>
              <ArrowUpRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200"
              />
            </a>
          ))}
        </div>

        <p className="mt-5 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Using a different agent? See the{' '}
          <a
            href={MCP_GUIDE}
            target="_blank"
            rel="noreferrer"
            className="cursor-pointer underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900 dark:decoration-zinc-700 dark:hover:text-zinc-100"
          >
            MCP Guide
          </a>{' '}
          or{' '}
          <a
            href={CLI_GUIDE}
            target="_blank"
            rel="noreferrer"
            className="cursor-pointer underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900 dark:decoration-zinc-700 dark:hover:text-zinc-100"
          >
            CLI Guide
          </a>
          .
        </p>

        {completionError ? (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {completionError}
          </p>
        ) : null}
      </div>

      <footer className="mt-8 flex min-h-9 w-full max-w-2xl items-center justify-start">
        <OnboardingActionButton onClick={onFinish} disabled={isWorking} isWorking={isWorking}>
          Open App
        </OnboardingActionButton>
      </footer>
    </>
  );
}
