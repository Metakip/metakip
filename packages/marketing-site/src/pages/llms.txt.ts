import type { APIRoute } from 'astro';
import { FEATURE_GROUPS } from '../data/features';
import { renderMarkdownLink } from '../data/markdownPage';
import type { MarketingSection } from '../data/marketingContent';
import { PRICING_PAGE } from '../data/pricing';
import { PRODUCT_SUMMARY } from '../data/product';
import { richTextToPlainText } from '../data/richText';
import { APP_ORIGIN, DOCS_ORIGIN, GITHUB_URL, SITE_ORIGIN } from '../data/siteConfig';
import { USE_CASE_PAGE } from '../data/useCases';

export const prerender = true;

const formatSectionLines = (sections: readonly MarketingSection[]): string =>
  sections
    .map(
      ({ title, body, link }) =>
        `- ${title} — ${renderMarkdownLink(link)}: ${richTextToPlainText(body)}`,
    )
    .join('\n');
const featureLines = formatSectionLines(FEATURE_GROUPS);
const useCaseLines = formatSectionLines(USE_CASE_PAGE.sections);
const pricingLines = formatSectionLines(PRICING_PAGE.sections);

const llms = `# Metakip

> Metakip is the collaborative knowledge base for humans and agents.

Metakip is currently in public beta. ${PRODUCT_SUMMARY} Metakip is open source under GNU AGPL v3 and can be used as a hosted service or self-hosted.

## Features

${featureLines}

## Use cases

${useCaseLines}

## Pricing

${PRICING_PAGE.intro.join(' ')}

${pricingLines}

- [Pricing Page](${SITE_ORIGIN}/pricing.md): Current hosted and self-hosted pricing information.

## Product links

- [Homepage](${SITE_ORIGIN}/): Product overview and entry points for the web app and CLI.
- [Web App](${APP_ORIGIN}): Open Metakip in the browser.
- [Source Code](${GITHUB_URL}): Metakip source code and project README.
- [Changelog](${SITE_ORIGIN}/changelog.md): Product updates across the browser app, CLI, API, sharing, and documentation.

## Documentation

- [Documentation Home](${DOCS_ORIGIN}/): Guides, API reference, comparisons, and self-hosting documentation.
- [MCP](${DOCS_ORIGIN}/agents/mcp/): Connect to Metakip through OAuth and MCP.
- [Metakip CLI](${DOCS_ORIGIN}/agents/metakip-cli/): Install the CLI and manage pages from a terminal.
- [API Reference](${DOCS_ORIGIN}/api-reference/endpoints/): Direct HTTP interface for Metakip resources.
- [AI Assistant Access](${DOCS_ORIGIN}/agents/use-metakip-with-ai-assistants/): Connect terminal-based assistants with scoped tokens and safe edits.
- [markdown support](${DOCS_ORIGIN}/getting-started/markdown-support/): Supported syntax, page links, frontmatter, and known limitations.
- [Self-hosting](${DOCS_ORIGIN}/self-hosting/): Deployment, maintenance, and migration guidance.

## Optional

- [Import Existing Notes](${DOCS_ORIGIN}/getting-started/bring-your-notes/): Import markdown files, folders, and Obsidian vaults.
- [Share A Page](${DOCS_ORIGIN}/getting-started/share-a-page/): View, Edit, and Admin access with real-time collaboration.
- [Metakip Comparisons](${DOCS_ORIGIN}/comparisons/): Detailed comparisons with other knowledge tools.
`;

export const GET: APIRoute = () =>
  new Response(llms, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
