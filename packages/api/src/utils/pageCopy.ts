import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { executeQuery, type QueryExecutor } from '../db/query';
import { getDestinationOwnerId } from './destinationOwner';
import { prepareCopiedYdoc } from './documentSize';
import type { RequestActor } from './guestAccess';
import type { PageDatabaseRow, PageDatabaseRowWithOwner } from './pageRows';
import { createCopyPageTitle } from './pageTitle';
import { getNextPosition } from './position';

export type PageCopySource = {
  id: string;
  title: string;
  icon: string | null;
  coverType: string | null;
  coverValue: string | null;
  ydoc: Buffer | null;
  properties: unknown;
  ownerId?: string | null;
};

type PersistPageCopyOptions = {
  parentId: string | null;
  position: string;
  connectionPolicy: 'all' | 'non-page';
};

type PageCopyRequest = {
  source: PageCopySource;
  options: PersistPageCopyOptions;
};

const PAGE_COPY_BATCH_SIZE = 250;

export async function persistPageCopies(
  executor: QueryExecutor,
  requests: readonly PageCopyRequest[],
  actor: RequestActor,
): Promise<PageDatabaseRow[]> {
  if (requests.length === 0) return [];

  const insertedRows: PageDatabaseRow[] = [];
  for (let offset = 0; offset < requests.length; offset += PAGE_COPY_BATCH_SIZE) {
    const prepared = requests
      .slice(offset, offset + PAGE_COPY_BATCH_SIZE)
      .map(({ source, options }) => {
        const id = randomUUID();
        const title = createCopyPageTitle(source.title);
        return {
          id,
          source,
          options,
          title,
          ydoc: prepareCopiedYdoc(source.ydoc, title),
        };
      });
    const inserted = await executeQuery<PageDatabaseRow>(
      executor,
      sql`insert into pages (
         id, parent_id, title, icon, cover_type, cover_value,
         position, ydoc, properties, created_by
       ) values ${sql.join(
         prepared.map(
           (page) =>
             sql`(${page.id}, ${page.options.parentId}, ${page.title},
               ${page.source.icon}, ${page.source.coverType}, ${page.source.coverValue},
               ${page.options.position}, ${page.ydoc}, ${page.source.properties},
               ${actor.kind === 'user' ? actor.id : null})`,
         ),
         sql`, `,
       )}
       returning *`,
    );
    insertedRows.push(...inserted.rows);

    const sourceIds = prepared.map((page) => page.source.id);
    const copiedIds = prepared.map((page) => page.id);
    const copyPageConnections = prepared.map((page) => page.options.connectionPolicy === 'all');
    await executeQuery(
      executor,
      sql`with copies as (
       select * from unnest(
         ${sql.param(sourceIds)}::uuid[],
         ${sql.param(copiedIds)}::uuid[],
         ${sql.param(copyPageConnections)}::boolean[]
       ) as copy(source_id, copied_id, copy_page_connections)
     )
     insert into upload_page_refs (upload_id, page_id)
     select reference.upload_id, copy.copied_id
     from copies copy
     join upload_page_refs reference on reference.page_id = copy.source_id
     on conflict (upload_id, page_id) do nothing`,
    );
    await executeQuery(
      executor,
      sql`with copies as (
       select * from unnest(
         ${sql.param(sourceIds)}::uuid[],
         ${sql.param(copiedIds)}::uuid[],
         ${sql.param(copyPageConnections)}::boolean[]
       ) as copy(source_id, copied_id, copy_page_connections)
     )
     insert into connections (
       source_type, source_id, target_type, target_id, target_slug,
       target_label, connection_type, link_text, link_context,
       occurrence_count, first_seen_at, updated_at
     )
     select original.source_type, copy.copied_id, original.target_type, original.target_id,
            original.target_slug, original.target_label, original.connection_type,
            original.link_text, original.link_context, original.occurrence_count,
            original.first_seen_at, now()
     from copies copy
     join connections original
       on original.source_type = 'page' and original.source_id = copy.source_id
     where copy.copy_page_connections or original.target_type <> 'page'`,
    );
    await executeQuery(
      executor,
      sql`with copies as (
       select * from unnest(
         ${sql.param(sourceIds)}::uuid[],
         ${sql.param(copiedIds)}::uuid[]
       ) as copy(source_id, copied_id)
     )
     insert into connection_occurrences (
       connection_id, source_block_id, position, context, created_at
     )
     select copied.id, occurrence.source_block_id, occurrence.position,
            occurrence.context, occurrence.created_at
     from copies copy
     join connections original
       on original.source_type = 'page' and original.source_id = copy.source_id
     join connections copied
       on copied.source_type = original.source_type
      and copied.source_id = copy.copied_id
      and copied.target_type = original.target_type
      and copied.target_slug = original.target_slug
      and copied.connection_type = original.connection_type
     join connection_occurrences occurrence on occurrence.connection_id = original.id`,
    );
  }

  return insertedRows;
}

export async function persistPageCopy(
  executor: QueryExecutor,
  source: PageCopySource,
  actor: RequestActor,
  options: PersistPageCopyOptions,
): Promise<PageDatabaseRow> {
  const copiedPage = (await persistPageCopies(executor, [{ source, options }], actor))[0];
  if (!copiedPage) throw new HTTPException(500, { message: 'Failed to copy page' });
  return copiedPage;
}

export async function copyPageContent(
  executor: QueryExecutor,
  source: PageCopySource,
  parentId: string | null,
  actor: RequestActor,
): Promise<PageDatabaseRowWithOwner> {
  const destinationOwnerId = await getDestinationOwnerId(
    executor,
    parentId,
    actor.kind === 'user' ? actor.id : null,
  );
  if (!destinationOwnerId) {
    throw new HTTPException(404, { message: 'Destination workspace not found' });
  }

  const copiedPage = await persistPageCopy(executor, source, actor, {
    parentId,
    position: await getNextPosition('pages', parentId, actor.id, executor),
    connectionPolicy: source.ownerId === destinationOwnerId ? 'all' : 'non-page',
  });
  return { ...copiedPage, owner_id: destinationOwnerId };
}
