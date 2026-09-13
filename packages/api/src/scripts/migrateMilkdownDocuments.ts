import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_YDOC_BYTES } from '@metakip/shared';
import { createYjsDocWithTitle } from '@metakip/shared/markdown-yjs';
import { config } from 'dotenv';
import pg, { type PoolClient } from 'pg';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import * as Y from 'yjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidateEnvPaths = [
  resolve(process.cwd(), '.env'),
  resolve(currentDir, '../../.env'),
  resolve(currentDir, '../../../../.env'),
];
const selectedEnvPath = candidateEnvPaths.find((envPath) => existsSync(envPath));

if (selectedEnvPath) config({ path: selectedEnvPath });
else config();

const EDITOR_CONTENT_MIGRATION = 'milkdown_to_codemirror_markdown_v1';

// One-way rollout migration. All knowledge of the retired Milkdown document
// shape stays in this file so this script and its deploy hook can be deleted
// together after the migration has shipped.

export type EditorMigrationPage = {
  id: string;
  title: string;
  ydoc: Buffer | null;
};

export type ConvertedEditorPage = {
  id: string;
  state: Uint8Array;
};

type DeltaSegment = {
  insert: string;
  attributes?: Record<string, unknown>;
};

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  depth?: number;
  lang?: string | null;
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  checked?: boolean | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  align?: Array<'left' | 'center' | 'right' | null>;
};

type InlineWrapper = {
  key: string;
  node: MarkdownNode;
};

const markdownProcessor = remark().use(remarkGfm).use(remarkMath);
markdownProcessor.data('settings', {
  bullet: '-',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
});

export function legacyXmlYDocToMarkdown(update: Uint8Array): string {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, update);
    const root: MarkdownNode = {
      type: 'root',
      children: legacyBlockChildren(document.getXmlFragment('prosemirror')),
    };
    return markdownProcessor.stringify(
      root as unknown as Parameters<typeof markdownProcessor.stringify>[0],
    );
  } finally {
    document.destroy();
  }
}

function legacyBlockChildren(element: Y.XmlFragment | Y.XmlElement): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  for (let index = 0; index < element.length; index += 1) {
    const child = element.get(index);
    if (child instanceof Y.XmlText) {
      result.push({
        type: 'paragraph',
        children: deltaToMarkdown(child.toDelta() as DeltaSegment[]),
      });
    } else if (child instanceof Y.XmlElement) {
      const block = legacyBlockElement(child);
      if (block) result.push(block);
    }
  }
  return result;
}

function legacyBlockElement(element: Y.XmlElement): MarkdownNode | null {
  switch (element.nodeName) {
    case 'paragraph':
      return { type: 'paragraph', children: legacyInlineContent(element) };
    case 'heading': {
      const level = Number.parseInt(element.getAttribute('level') || '1', 10);
      return {
        type: 'heading',
        depth: Math.min(Math.max(level, 1), 6),
        children: legacyInlineContent(element),
      };
    }
    case 'code_block': {
      const language = element.getAttribute('language') || '';
      const code = element.get(0);
      const source = code instanceof Y.XmlText ? code.toString() : '';
      return language.toLowerCase() === 'latex'
        ? { type: 'math', value: source }
        : { type: 'code', lang: language || null, value: source };
    }
    case 'blockquote':
      return { type: 'blockquote', children: legacyBlockChildren(element) };
    case 'bullet_list':
      return legacyList(element, false);
    case 'ordered_list':
      return legacyList(element, true);
    case 'hr':
      return { type: 'thematicBreak' };
    case 'table':
      return legacyTable(element);
    case 'callout':
      return legacyCallout(element);
    default:
      return { type: 'paragraph', children: legacyInlineContent(element) };
  }
}

function legacyList(element: Y.XmlElement, ordered: boolean): MarkdownNode {
  const items: MarkdownNode[] = [];
  for (let index = 0; index < element.length; index += 1) {
    const child = element.get(index);
    if (!(child instanceof Y.XmlElement) || child.nodeName !== 'list_item') continue;
    items.push(legacyListItem(child));
  }
  return {
    type: 'list',
    ordered,
    start: ordered ? Number(element.getAttribute('order') || '1') : null,
    spread: items.some((item) => (item.children?.length ?? 0) > 1),
    children: items,
  };
}

function legacyListItem(element: Y.XmlElement): MarkdownNode {
  const children: MarkdownNode[] = [];
  for (let index = 0; index < element.length; index += 1) {
    const child = element.get(index);
    if (child instanceof Y.XmlText) {
      children.push({
        type: 'paragraph',
        children: deltaToMarkdown(child.toDelta() as DeltaSegment[]),
      });
    } else if (child instanceof Y.XmlElement) {
      const block = legacyBlockElement(child);
      if (block) children.push(block);
    }
  }
  const checked = element.getAttribute('checked');
  return {
    type: 'listItem',
    spread: children.length > 1,
    checked: checked == null ? null : checked === 'true',
    children,
  };
}

function legacyTable(element: Y.XmlElement): MarkdownNode | null {
  const rows: MarkdownNode[] = [];
  const alignments: Array<string | null> = [];
  for (let rowIndex = 0; rowIndex < element.length; rowIndex += 1) {
    const row = element.get(rowIndex);
    if (!(row instanceof Y.XmlElement)) continue;
    const cells: MarkdownNode[] = [];
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = row.get(cellIndex);
      if (!(cell instanceof Y.XmlElement)) continue;
      cells.push({ type: 'tableCell', children: legacyInlineContent(cell) });
      if (row.nodeName === 'table_header_row' && cellIndex >= alignments.length) {
        alignments.push(cell.getAttribute('alignment') || null);
      }
    }
    rows.push({ type: 'tableRow', children: cells });
  }
  if (rows.length === 0) return null;
  return {
    type: 'table',
    align: alignments.map((alignment) =>
      alignment === 'left' || alignment === 'center' || alignment === 'right' ? alignment : null,
    ),
    children: rows,
  };
}

function legacyCallout(element: Y.XmlElement): MarkdownNode {
  const type = (element.getAttribute('type') || 'note').toUpperCase();
  const title = element.getAttribute('title') || '';
  return {
    type: 'blockquote',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'html', value: `[!${type}${title ? ` ${title}` : ''}]` }],
      },
      ...legacyBlockChildren(element),
    ],
  };
}

function legacyInlineContent(element: Y.XmlFragment | Y.XmlElement): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  for (let index = 0; index < element.length; index += 1) {
    const child = element.get(index);
    if (child instanceof Y.XmlText) {
      result.push(...deltaToMarkdown(child.toDelta() as DeltaSegment[]));
    } else if (child instanceof Y.XmlElement) {
      result.push(...legacyInlineElement(child));
    }
  }
  return result;
}

function legacyInlineElement(element: Y.XmlElement): MarkdownNode[] {
  switch (element.nodeName) {
    case 'image': {
      return [
        {
          type: 'image',
          url: element.getAttribute('src') || '',
          alt: element.getAttribute('alt') || '',
          title: element.getAttribute('title') || null,
        },
      ];
    }
    case 'hardbreak':
    case 'hard_break':
      return [{ type: 'break' }];
    case 'wikiLink': {
      const targetId = element.getAttribute('targetId') || '';
      const path = element.getAttribute('path') || '';
      const heading = element.getAttribute('heading') || extractHeadingFromPath(path);
      const base = targetId
        ? `id:${targetId.toLowerCase()}`
        : heading && !element.getAttribute('heading')
          ? path.split('#')[0] || path
          : path;
      const target = `${base}${heading ? `#${heading}` : ''}`;
      const label = element.getAttribute('label') || '';
      return [{ type: 'html', value: `[[${target}${label ? `|${label}` : ''}]]` }];
    }
    case 'tag': {
      const name = element.getAttribute('name') || element.getAttribute('value') || '';
      return name ? [{ type: 'html', value: `#${name}` }] : [];
    }
    case 'math_inline':
      return [{ type: 'inlineMath', value: element.getAttribute('value') || '' }];
    case 'html':
      return [{ type: 'html', value: element.getAttribute('value') || '' }];
    case 'footnote_reference':
      return [{ type: 'html', value: `[^${element.getAttribute('label') || ''}]` }];
    default:
      return legacyInlineContent(element);
  }
}

function extractHeadingFromPath(path: string): string {
  const hashIndex = path.indexOf('#');
  return hashIndex === -1 || hashIndex === path.length - 1 ? '' : path.slice(hashIndex + 1);
}

function wrappersFor(attributes: Record<string, unknown> | undefined): InlineWrapper[] {
  const wrappers: InlineWrapper[] = [];
  const link = attributes?.link;
  if (link && typeof link === 'object') {
    const record = link as Record<string, unknown>;
    const url = typeof record.href === 'string' ? record.href : '';
    const title = typeof record.title === 'string' ? record.title : null;
    if (url)
      wrappers.push({ key: `link:${url}:${title ?? ''}`, node: { type: 'link', url, title } });
  }
  if (attributes?.strong) wrappers.push({ key: 'strong', node: { type: 'strong' } });
  if (attributes?.emphasis) wrappers.push({ key: 'emphasis', node: { type: 'emphasis' } });
  if (attributes?.strike_through) wrappers.push({ key: 'delete', node: { type: 'delete' } });
  return wrappers;
}

function deltaToMarkdown(delta: DeltaSegment[]): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  let active: InlineWrapper[] = [];
  let containers: MarkdownNode[] = [];

  for (const segment of delta) {
    const wrappers = wrappersFor(segment.attributes);
    let shared = 0;
    while (shared < active.length && active[shared]?.key === wrappers[shared]?.key) shared += 1;
    active = active.slice(0, shared);
    containers = containers.slice(0, shared);

    let target = shared === 0 ? result : (containers[shared - 1]?.children ?? result);
    for (const wrapper of wrappers.slice(shared)) {
      const container = { ...wrapper.node, children: [] };
      target.push(container);
      active.push(wrapper);
      containers.push(container);
      target = container.children ?? target;
    }

    target.push(
      segment.attributes?.inlineCode
        ? { type: 'inlineCode', value: segment.insert }
        : { type: 'text', value: segment.insert },
    );
  }
  return result;
}

export function convertEditorPage(page: EditorMigrationPage): ConvertedEditorPage {
  if (!page.ydoc || page.ydoc.length === 0) {
    return { id: page.id, state: createYjsDocWithTitle(page.title || 'Untitled', '') };
  }

  const currentState = new Uint8Array(page.ydoc);
  const current = new Y.Doc();
  try {
    Y.applyUpdate(current, currentState);
    const hasContent = current.share.has('content');
    const hasLegacyContent = current.share.has('prosemirror');
    if (hasContent && hasLegacyContent) {
      throw new Error(`Page ${page.id} contains both canonical and legacy editor fields`);
    }
    if (hasContent) {
      const content = current.getText('content').toString();
      if (content.includes('\r')) {
        const title = current.getText('title').toString() || page.title || 'Untitled';
        const state = createYjsDocWithTitle(title, content);
        if (state.byteLength > MAX_YDOC_BYTES) {
          throw new Error(`Page ${page.id} exceeds the collaborative document size limit`);
        }
        return { id: page.id, state };
      }
      if (currentState.byteLength > MAX_YDOC_BYTES) {
        throw new Error(`Page ${page.id} exceeds the collaborative document size limit`);
      }
      return { id: page.id, state: currentState };
    }

    const title = current.getText('title').toString() || page.title || 'Untitled';
    const markdown = hasLegacyContent ? legacyXmlYDocToMarkdown(currentState) : '';
    const state = createYjsDocWithTitle(title, markdown);
    const validation = new Y.Doc();
    try {
      Y.applyUpdate(validation, state);
      if (!validation.share.has('content') || validation.share.has('prosemirror')) {
        throw new Error(`Page ${page.id} did not produce a canonical editor document`);
      }
      if (validation.getText('content').toString() !== markdown.replace(/\r\n?/g, '\n')) {
        throw new Error(`Page ${page.id} failed Markdown conversion validation`);
      }
    } finally {
      validation.destroy();
    }
    if (state.byteLength > MAX_YDOC_BYTES) {
      throw new Error(
        `Page ${page.id} exceeds the collaborative document size limit after conversion`,
      );
    }
    return { id: page.id, state };
  } finally {
    current.destroy();
  }
}

async function hasCompletedMigration(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ completed: boolean }>(
    'select exists (select 1 from data_migrations where name = $1) as completed',
    [EDITOR_CONTENT_MIGRATION],
  );
  return result.rows[0]?.completed === true;
}

async function migrate(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "select pg_advisory_xact_lock(hashtext('metakip-editor-content-migration'))",
    );
    if (await hasCompletedMigration(client)) {
      await client.query('COMMIT');
      process.stdout.write('Editor content migration was already complete.\n');
      return;
    }
    const result = await client.query<EditorMigrationPage>(
      'select id, title, ydoc from pages order by id for update',
    );
    const converted = result.rows.map(convertEditorPage);
    const previousById = new Map(result.rows.map((page) => [page.id, page.ydoc]));
    let changed = 0;
    for (const page of converted) {
      const previous = previousById.get(page.id);
      if (previous && Buffer.from(page.state).equals(previous)) continue;
      await client.query('update pages set ydoc = $1 where id = $2', [
        Buffer.from(page.state),
        page.id,
      ]);
      changed += 1;
    }
    await client.query('insert into data_migrations (name) values ($1)', [
      EDITOR_CONTENT_MIGRATION,
    ]);
    await client.query('COMMIT');
    process.stdout.write(
      `Converted ${changed} of ${converted.length} page documents to Markdown Y.Text.\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  const args = process.argv.slice(2);
  const execution =
    args.length === 0 ? migrate() : Promise.reject(new Error('Usage: migrateMilkdownDocuments.ts'));
  void execution.catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
