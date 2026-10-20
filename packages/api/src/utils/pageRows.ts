import type { pages } from '../db';

export type PageRow = typeof pages.$inferSelect;
export type NormalizedPageRow = PageRow & { ownerId: string | null };

export type PageDatabaseRow = {
  id: string;
  parent_id: string | null;
  title: string;
  title_revision: bigint;
  icon: string | null;
  cover_type: string | null;
  cover_value: string | null;
  position: string;
  ydoc: Buffer | null;
  properties: Record<string, unknown> | null;
  created_by: string | null;
  public_permission: 'view' | 'edit' | null;
  inheritance_policy: 'inherit' | 'restricted';
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean | null;
  deleted_at: Date | null;
  deletion_batch_id: string | null;
};

export type PageDatabaseRowWithOwner = PageDatabaseRow & { owner_id: string | null };

export function normalizePageRow(row: PageDatabaseRow, ownerId: string | null): NormalizedPageRow {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    titleRevision: row.title_revision,
    icon: row.icon,
    coverType: row.cover_type,
    coverValue: row.cover_value,
    position: row.position,
    ydoc: row.ydoc,
    properties: row.properties,
    createdBy: row.created_by,
    publicPermission: row.public_permission,
    inheritancePolicy: row.inheritance_policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    deletionBatchId: row.deletion_batch_id,
    ownerId,
  };
}

export function toPageResponse(page: NormalizedPageRow): Omit<NormalizedPageRow, 'ydoc'> {
  return {
    id: page.id,
    parentId: page.parentId,
    title: page.title,
    titleRevision: page.titleRevision,
    icon: page.icon,
    coverType: page.coverType,
    coverValue: page.coverValue,
    position: page.position,
    properties: page.properties,
    createdBy: page.createdBy,
    publicPermission: page.publicPermission,
    inheritancePolicy: page.inheritancePolicy,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    isDeleted: page.isDeleted,
    deletedAt: page.deletedAt,
    deletionBatchId: page.deletionBatchId,
    ownerId: page.ownerId,
  };
}
