import {
  getUnicodeCodePointLength,
  MAX_FOLDER_NAME_LENGTH,
  truncateUnicodeCodePoints,
} from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';

const DEFAULT_FOLDER_NAME = 'New Folder';
const COPY_PREFIX = 'Copy of ';

export function normalizeFolderName(name: string | null | undefined): string {
  const normalized = name?.trim() || DEFAULT_FOLDER_NAME;
  if (getUnicodeCodePointLength(normalized) > MAX_FOLDER_NAME_LENGTH) {
    throw new HTTPException(400, {
      message: `Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer`,
    });
  }
  return normalized;
}

export function createCopyFolderName(name: string): string {
  return truncateUnicodeCodePoints(
    `${COPY_PREFIX}${name.trim() || DEFAULT_FOLDER_NAME}`,
    MAX_FOLDER_NAME_LENGTH,
  );
}
