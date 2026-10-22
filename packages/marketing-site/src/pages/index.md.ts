import type { APIRoute } from 'astro';
import { FAQS, FEATURE_GROUPS } from '../data/features';
import { markdownResponse, renderMarkdownPage } from '../data/markdownPage';
import { DOCS_ORIGIN } from '../data/siteConfig';

export const prerender = true;

const questions = FAQS.map(({ question, answer }) => `**${question}**\n\n${answer}`).join('\n\n');

const markdown = renderMarkdownPage({
  title: 'A shared knowledge base for humans and agents.',
  intro: ['The same information exposed through the browser, MCP, CLI, or API.'],
  closing: 'Start in the browser. Add the CLI or MCP when you want an agent in the loop.',
  sections: FEATURE_GROUPS,
  appendix: [{ title: 'Before You Start', body: questions }],
  footerTitle: 'Next step',
  footerLinks: [
    { kind: 'app', label: 'Open Metakip' },
    { kind: 'external', label: 'Read The CLI Guide', url: `${DOCS_ORIGIN}/agents/cli/` },
    { kind: 'internal', label: 'See Who Metakip Is For', path: '/use-cases' },
  ],
});

export const GET: APIRoute = () => markdownResponse(markdown);
