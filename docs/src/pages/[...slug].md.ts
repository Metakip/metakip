import { getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';
import { getApiReferenceMarkdownEntries } from '../lib/apiReferenceMarkdown';

interface MarkdownProps {
  body: string;
}

// Static Astro redirects emit HTML, so old .md URLs must be served by this endpoint.
const legacyMarkdownAliases = {
  'agents/markdawn-cli': 'agents/cli',
  'agents/metakip-cli': 'agents/cli',
  'agents/use-markdawn-with-ai-assistants': 'agents',
  'agents/use-metakip-with-ai-assistants': 'agents',
} as const;

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection('docs');
  const apiEntries = getApiReferenceMarkdownEntries();
  const markdownById = new Map(entries.map((entry) => [entry.id, entry.body ?? '']));

  return [
    ...entries.map((entry) => ({
      params: { slug: entry.id },
      props: { body: entry.body ?? '' } satisfies MarkdownProps,
    })),
    ...Object.entries(legacyMarkdownAliases).map(([slug, canonicalId]) => {
      const body = markdownById.get(canonicalId);
      if (body === undefined) throw new Error(`Missing Markdown page for ${canonicalId}`);
      return { params: { slug }, props: { body } satisfies MarkdownProps };
    }),
    ...apiEntries.map((entry) => ({
      params: { slug: entry.slug },
      props: { body: entry.body } satisfies MarkdownProps,
    })),
  ];
};

export const GET: APIRoute = ({ props }) => {
  const { body } = props as MarkdownProps;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Robots-Tag': 'noindex',
    },
  });
};
