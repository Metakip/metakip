import {
  getUnicodeCodePointLength,
  MAX_PAGE_TITLE_LENGTH,
  truncateUnicodeCodePoints,
} from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';

const UNTITLED_PAGE_TITLE = 'Untitled';
const COPY_PREFIX = 'Copy of ';

export function normalizePageTitle(title: string): string {
  if (getUnicodeCodePointLength(title) > MAX_PAGE_TITLE_LENGTH) {
    throw new HTTPException(400, {
      message: `Title must be ${MAX_PAGE_TITLE_LENGTH} characters or fewer`,
    });
  }

  return title.trim() || UNTITLED_PAGE_TITLE;
}

export function createCopyPageTitle(title: string): string {
  const sourceTitle = title.trim() || UNTITLED_PAGE_TITLE;
  return truncateUnicodeCodePoints(`${COPY_PREFIX}${sourceTitle}`, MAX_PAGE_TITLE_LENGTH);
}
