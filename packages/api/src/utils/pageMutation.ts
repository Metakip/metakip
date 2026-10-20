import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';
import type { PageDatabaseRow } from './pageRows';

type PropertiesUpdate =
  | { kind: 'preserve' }
  | { kind: 'replace'; value: Record<string, unknown> | null };

type PageMetadataMutationRow = Pick<
  PageDatabaseRow,
  | 'id'
  | 'parent_id'
  | 'title'
  | 'icon'
  | 'cover_type'
  | 'cover_value'
  | 'properties'
  | 'created_at'
  | 'updated_at'
>;

/** Replace the legacy page-editing field set after locking the page row FOR UPDATE. */
export async function replacePageRecordFields(
  executor: QueryExecutor,
  input: {
    pageId: string;
    title: string;
    icon: string | null;
    parentId: string | null;
    position: string;
    coverType: string | null;
    coverValue: string | null;
    properties: PropertiesUpdate;
  },
): Promise<PageDatabaseRow | null> {
  const propertiesAssignment =
    input.properties.kind === 'replace'
      ? sql`properties = ${input.properties.value ? JSON.stringify(input.properties.value) : null},`
      : sql``;
  const result = await executeQuery<PageDatabaseRow>(
    executor,
    sql`update pages set
        title_revision = title_revision + case when title is distinct from ${input.title} then 1 else 0 end,
        title = ${input.title},
        icon = ${input.icon}, parent_id = ${input.parentId}, position = ${input.position},
        cover_type = ${input.coverType}, cover_value = ${input.coverValue},
        ${propertiesAssignment}
        updated_at = now()
      where id = ${input.pageId} returning *`,
  );
  return result.rows[0] ?? null;
}

export async function updatePageMetadata(
  executor: QueryExecutor,
  input: {
    pageId: string;
    title?: string;
    icon?: string | null;
  },
): Promise<PageMetadataMutationRow | null> {
  if (input.title === undefined && input.icon === undefined) {
    throw new Error('A page metadata update requires at least one field');
  }
  const titleAssignment =
    input.title === undefined
      ? sql``
      : sql`title_revision = title_revision + case when title is distinct from ${input.title} then 1 else 0 end,
            title = ${input.title},`;
  const iconAssignment = input.icon === undefined ? sql`` : sql`icon = ${input.icon},`;
  const result = await executeQuery<PageMetadataMutationRow>(
    executor,
    sql`update pages set
        ${titleAssignment}
        ${iconAssignment}
        updated_at = now()
      where id = ${input.pageId}
      returning id, parent_id, title, icon, cover_type, cover_value,
        properties, created_at, updated_at`,
  );
  return result.rows[0] ?? null;
}

export async function notifyPageRename(executor: QueryExecutor, pageId: string): Promise<void> {
  await executeQuery(
    executor,
    sql`select pg_notify(${'page_renamed'}, ${JSON.stringify({ pageId })})`,
  );
}
