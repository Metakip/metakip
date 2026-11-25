import { METAKIP_CLI_DOCS_URL, METAKIP_DOCS_URL } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight } from 'lucide-react';
import chatgptIcon from '../../../../marketing-site/public/agents/chatgpt.svg?url';
import claudeIcon from '../../../../marketing-site/public/agents/claude.svg?url';
import grokIcon from '../../../../marketing-site/public/agents/grok.svg?url';
import hermesIcon from '../../../../marketing-site/public/agents/nous-girl.png?url';
import openclawIcon from '../../../../marketing-site/public/agents/openclaw.svg?url';
import opencodeIcon from '../../../../marketing-site/public/agents/opencode.svg?url';
import piIcon from '../../../../marketing-site/public/agents/pi.svg?url';
import { agentLinkMarker, styles } from './AgentSetupStep.stylex';
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
      <div {...stylex.props(styles.content)}>
        <p {...stylex.props(styles.stepLabel)}>Step 2 of 2</p>
        <h1 {...stylex.props(styles.title)}>Connect your AI Agent</h1>
        <p {...stylex.props(styles.description)}>
          Select your agent for setup instructions specific to its connection options.
        </p>

        <div {...stylex.props(styles.agentGrid)}>
          {agentGuides.map((guide) => (
            <a
              key={guide.slug}
              href={`${AGENT_GUIDES}${guide.slug}/`}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(styles.agentLink, agentLinkMarker)}
              data-agent-link=""
            >
              <span {...stylex.props(styles.agentIconContainer)}>
                <img
                  src={guide.icon}
                  alt=""
                  aria-hidden="true"
                  {...stylex.props(
                    guide.icon === hermesIcon ? styles.agentIconLarge : styles.agentIcon,
                  )}
                  width="36"
                  height="36"
                  loading="lazy"
                />
              </span>
              <span {...stylex.props(styles.agentName)}>{guide.name}</span>
              <ArrowUpRight
                size={16}
                aria-hidden="true"
                {...stylex.props(styles.agentExternalIcon)}
                data-agent-external-icon=""
              />
            </a>
          ))}
        </div>

        <p {...stylex.props(styles.alternateGuidance)}>
          Using a different agent? See the{' '}
          <a href={MCP_GUIDE} target="_blank" rel="noreferrer" {...stylex.props(styles.guideLink)}>
            MCP Guide
          </a>{' '}
          or{' '}
          <a href={CLI_GUIDE} target="_blank" rel="noreferrer" {...stylex.props(styles.guideLink)}>
            CLI Guide
          </a>
          .
        </p>

        {completionError ? (
          <p role="alert" {...stylex.props(styles.errorMessage)}>
            {completionError}
          </p>
        ) : null}
      </div>

      <footer {...stylex.props(styles.footer)}>
        <OnboardingActionButton onClick={onFinish} disabled={isWorking} isWorking={isWorking}>
          Open App
        </OnboardingActionButton>
      </footer>
    </>
  );
}
