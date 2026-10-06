import type {
  AccountFolderChildDto,
  AccountFolderPageDto,
  AccountPagePayload,
  CapabilitySet,
  FolderDetailPayload,
  InheritancePolicy,
  PageDetailPayload,
  PublicFolderChildDto,
  PublicFolderPageDto,
  PublicPagePayload,
  SharePermission,
} from '../types/page';

export type ShareableEntityType = 'page' | 'folder';
export type ShareableEntityPayload = PageDetailPayload | FolderDetailPayload;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isPermission(value: unknown): value is SharePermission {
  return value === 'view' || value === 'commenter' || value === 'edit' || value === 'admin';
}

function isPublicPermission(value: unknown): value is 'view' | 'edit' {
  return value === 'view' || value === 'edit';
}

function isInheritancePolicy(value: unknown): value is InheritancePolicy {
  return value === 'inherit' || value === 'restricted';
}

function isCapabilitySet(value: unknown): value is CapabilitySet {
  return (
    isRecord(value) &&
    typeof value.canEdit === 'boolean' &&
    typeof value.canDelete === 'boolean' &&
    typeof value.canCopy === 'boolean' &&
    typeof value.canComment === 'boolean'
  );
}

function hasPublicPageFields(value: unknown): value is PublicFolderPageDto {
  return (
    isRecord(value) &&
    value.accessScope === 'public' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isNullableString(value.icon) &&
    isNullableString(value.updatedAt) &&
    isPublicPermission(value.publicPermission) &&
    isPublicPermission(value.userPermission)
  );
}

function hasAccountPageFields(value: unknown): value is AccountFolderPageDto {
  return (
    isRecord(value) &&
    value.accessScope === 'account' &&
    typeof value.id === 'string' &&
    isNullableString(value.parentId) &&
    typeof value.title === 'string' &&
    isNullableString(value.icon) &&
    isNullableString(value.createdBy) &&
    isNullableString(value.ownerId) &&
    isNullableString(value.createdAt) &&
    isNullableString(value.updatedAt) &&
    (isPublicPermission(value.publicPermission) || value.publicPermission === null) &&
    isPermission(value.userPermission)
  );
}

function hasPublicFolderFields(value: unknown): value is PublicFolderChildDto {
  return (
    isRecord(value) &&
    value.accessScope === 'public' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.icon) &&
    isNullableString(value.updatedAt) &&
    isPublicPermission(value.publicPermission) &&
    isPublicPermission(value.userPermission)
  );
}

function hasAccountFolderFields(value: unknown): value is AccountFolderChildDto {
  return (
    isRecord(value) &&
    value.accessScope === 'account' &&
    typeof value.id === 'string' &&
    isNullableString(value.parentId) &&
    typeof value.name === 'string' &&
    isNullableString(value.icon) &&
    isNullableString(value.createdBy) &&
    isNullableString(value.ownerId) &&
    isNullableString(value.createdAt) &&
    isNullableString(value.updatedAt) &&
    (isPublicPermission(value.publicPermission) || value.publicPermission === null) &&
    isPermission(value.userPermission)
  );
}

function isPublicPagePayload(value: unknown): value is PublicPagePayload {
  if (!hasPublicPageFields(value)) return false;
  const candidate = value as PublicFolderPageDto & Record<string, unknown>;
  return (
    isNullableString(candidate.coverType) &&
    isNullableString(candidate.coverValue) &&
    (isRecord(candidate.properties) || candidate.properties === null) &&
    isCapabilitySet(candidate.capabilities)
  );
}

function isAccountPagePayload(value: unknown): value is AccountPagePayload {
  if (!hasAccountPageFields(value)) return false;
  const candidate = value as AccountFolderPageDto & Record<string, unknown>;
  return (
    typeof candidate.position === 'string' &&
    isNullableString(candidate.coverType) &&
    isNullableString(candidate.coverValue) &&
    (isRecord(candidate.properties) || candidate.properties === null) &&
    isInheritancePolicy(candidate.inheritancePolicy) &&
    isCapabilitySet(candidate.capabilities)
  );
}

export function isFolderDetailPayload(value: unknown): value is FolderDetailPayload {
  if (!isRecord(value) || !Array.isArray(value.pages) || !Array.isArray(value.folders)) {
    return false;
  }
  if (hasPublicFolderFields(value)) {
    return (
      isCapabilitySet(value.capabilities) &&
      value.pages.every(hasPublicPageFields) &&
      value.folders.every(hasPublicFolderFields)
    );
  }
  return (
    hasAccountFolderFields(value) &&
    typeof value.position === 'string' &&
    isInheritancePolicy(value.inheritancePolicy) &&
    isCapabilitySet(value.capabilities) &&
    value.pages.every(hasAccountPageFields) &&
    value.folders.every(hasAccountFolderFields)
  );
}

export function parsePageDetailPayload(value: unknown): PageDetailPayload {
  if (isPublicPagePayload(value) || isAccountPagePayload(value)) return value;
  throw new Error('Invalid page response');
}

export function parseFolderDetailPayload(value: unknown): FolderDetailPayload {
  if (isFolderDetailPayload(value)) return value;
  throw new Error('Invalid folder response');
}

export function parseShareableEntityPayload(
  entityType: ShareableEntityType,
  value: unknown,
): ShareableEntityPayload {
  return entityType === 'page' ? parsePageDetailPayload(value) : parseFolderDetailPayload(value);
}
