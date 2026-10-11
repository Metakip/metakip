import type { APIRoute, MarkdownInstance } from 'astro';
import { markdownResponse } from './markdownPage';

export interface LegalFrontmatter {
  title: string;
  description: string;
  intro: string;
  updatedAt: string;
}

export type LegalDocument = Pick<
  MarkdownInstance<Record<string, unknown>>,
  'Content' | 'frontmatter' | 'rawContent'
>;

export const getLegalFrontmatter = (document: LegalDocument): LegalFrontmatter => {
  const { title, description, intro, updatedAt } = document.frontmatter;
  if (
    typeof title !== 'string' ||
    typeof description !== 'string' ||
    typeof intro !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    throw new Error('Legal document is missing required frontmatter');
  }
  return { title, description, intro, updatedAt };
};

export const legalMarkdownResponse = (document: LegalDocument): ReturnType<APIRoute> => {
  const { title, intro, updatedAt } = getLegalFrontmatter(document);
  const markdown = [
    `# ${title}`,
    intro,
    `_Last updated: ${updatedAt}_`,
    document.rawContent().trim(),
  ].join('\n\n');
  return markdownResponse(`${markdown}\n`);
};
