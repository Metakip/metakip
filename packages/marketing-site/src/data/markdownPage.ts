import type { APIRoute } from 'astro';
import type { MarketingLink, MarketingPageDefinition } from './marketingContent';
import { richTextToMarkdown } from './richText';
import { APP_ORIGIN, SITE_ORIGIN } from './siteConfig';

const resolveMarketingLinkUrl = (link: MarketingLink): string => {
  switch (link.kind) {
    case 'app':
      return APP_ORIGIN;
    case 'internal':
      return new URL(link.path, SITE_ORIGIN).toString();
    case 'external':
      return link.url;
  }
};

export const renderMarkdownLink = (link: MarketingLink): string =>
  `[${link.label}](${resolveMarketingLinkUrl(link)})`;

export const renderMarkdownPage = ({
  title,
  intro,
  closing,
  sections,
  appendix,
  footerTitle,
  footerLinks,
}: MarketingPageDefinition): string => {
  const renderedSections = sections
    .map(
      ({ title: sectionTitle, body, links }) => `## ${sectionTitle}

${richTextToMarkdown(body)}

${links.map(renderMarkdownLink).join(' · ')}`,
    )
    .join('\n\n');
  const renderedAppendix = appendix
    .map(({ title: appendixTitle, body }) => `## ${appendixTitle}\n\n${body}`)
    .join('\n\n');
  const renderedFooterLinks = footerLinks.map((link) => `- ${renderMarkdownLink(link)}`).join('\n');

  return [
    `# ${title}`,
    intro.map((line) => `> ${line}`).join('\n\n'),
    renderedSections,
    renderedAppendix,
    closing,
    `## ${footerTitle}`,
    renderedFooterLinks,
  ]
    .filter((block) => block.length > 0)
    .join('\n\n')
    .concat('\n');
};

export const markdownResponse = (markdown: string): ReturnType<APIRoute> =>
  new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
