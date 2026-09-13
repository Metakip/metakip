import {
  bindWikiLinkTargets,
  createEmptyYjsDoc,
  createYjsDocWithTitle,
} from '@metakip/shared/markdown-yjs';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { getDestinationOwnerId } from './destinationOwner';
import { ensureYdocSize } from './documentSize';
import {
  ensureActorCanCreateInFolder,
  persistGuestIdentity,
  type RequestActor,
} from './guestAccess';
import { replacePageConnectionIndex } from './pageConnectionIndex';
import type { PageDatabaseRow } from './pageRows';
import { getNextPosition } from './position';
import { lockEntityAccessMutation, lockWorkspaceAccessMutation } from './share-access';
import { notifyShareRecompute } from './share-notify';
import { getEntityMetaUserIds } from './shareRecipients';
import { getUniqueWorkspacePageLookup } from './wiki-link-lookup';

type InitialPageContent = {
  ydoc: Buffer;
  properties: Record<string, unknown> | null;
};

async function insertPage(
  executor: QueryExecutor,
  input: {
    parentId: string | null;
    title: string;
    icon: string | null;
    position: string;
    createdBy: string | null;
    content: InitialPageContent;
  },
): Promise<PageDatabaseRow> {
  const result = await executeQuery<PageDatabaseRow>(
    executor,
    sql`insert into pages
        (parent_id, title, title_search, icon, position, created_by, ydoc, properties)
      values (${input.parentId}, ${input.title}, to_tsvector('english', ${input.title}),
        ${input.icon}, ${input.position}, ${input.createdBy}, ${input.content.ydoc},
        ${input.content.properties ? JSON.stringify(input.content.properties) : null})
      returning *`,
  );
  const page = result.rows[0];
  if (!page) throw new HTTPException(500, { message: 'Failed to create page' });
  return page;
}

async function publishCreatedPage(executor: QueryExecutor, pageId: string): Promise<void> {
  const metaUserIds = await getEntityMetaUserIds(executor, 'page', pageId);
  await notifyShareRecompute(
    { entityType: 'page', entityId: pageId, metaUserIds, metaOnly: true },
    executor,
  );
}

export type PageCreationContent =
  | { kind: 'empty' }
  | { kind: 'markdown'; body: string; properties: Record<string, unknown> | null };

export async function createPage(
  executor: QueryExecutor,
  input: {
    actor: RequestActor;
    parentId: string | null;
    title: string;
    icon: string | null;
    content: PageCreationContent;
  },
): Promise<{ page: PageDatabaseRow; ownerId: string }> {
  const { actor } = input;
  if (input.parentId) {
    await lockEntityAccessMutation(executor, 'folder', input.parentId);
    await ensureActorCanCreateInFolder(actor, input.parentId, executor);
  } else {
    await lockWorkspaceAccessMutation(executor, actor.id);
  }
  await persistGuestIdentity(actor, executor);
  const createdBy = actor.kind === 'user' ? actor.id : null;
  const ownerId = await getDestinationOwnerId(executor, input.parentId, createdBy);
  if (!ownerId) throw new HTTPException(404, { message: 'Parent folder not found' });

  let content: InitialPageContent;
  if (input.content.kind === 'empty') {
    content = { ydoc: Buffer.from(createEmptyYjsDoc(input.title)), properties: null };
  } else {
    const pageLookup = await getUniqueWorkspacePageLookup(ownerId, actor.id, executor);
    content = {
      ydoc: Buffer.from(
        bindWikiLinkTargets(createYjsDocWithTitle(input.title, input.content.body), pageLookup),
      ),
      properties: input.content.properties,
    };
  }
  ensureYdocSize(content.ydoc);

  const position = await getNextPosition('pages', input.parentId, actor.id, executor);
  const page = await insertPage(executor, {
    parentId: input.parentId,
    title: input.title,
    icon: input.icon,
    position,
    createdBy,
    content,
  });
  if (input.content.kind === 'markdown') {
    await replacePageConnectionIndex(executor, page.id, content.ydoc, content.properties);
  }
  await publishCreatedPage(executor, page.id);
  return { page, ownerId };
}

export async function createPageForActor(input: {
  actor: RequestActor;
  parentId: string | null;
  title: string;
  icon: string | null;
}): Promise<{ page: PageDatabaseRow; ownerId: string }> {
  return db.transaction((tx) =>
    createPage(tx, {
      actor: input.actor,
      parentId: input.parentId,
      title: input.title,
      icon: input.icon,
      content: { kind: 'empty' },
    }),
  );
}
