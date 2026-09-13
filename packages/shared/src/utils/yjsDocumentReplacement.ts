import type * as Y from 'yjs';
import {
  COLLABORATIVE_CONTENT_FIELD,
  normalizeCollaborativeMarkdown,
} from './collaborativeMarkdown.js';

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  // Do not split a UTF-16 surrogate pair at the preserved boundary.
  if (index > 0 && index < limit && /[\uD800-\uDBFF]/.test(left[index - 1] ?? '')) index -= 1;
  return index;
}
function commonSuffixLength(left: string, right: string, prefix: number): number {
  const limit = Math.min(left.length, right.length) - prefix;
  let length = 0;
  while (
    length < limit &&
    left.charCodeAt(left.length - 1 - length) === right.charCodeAt(right.length - 1 - length)
  ) {
    length += 1;
  }
  const leftBoundary = left.length - length;
  if (length > 0 && /[\uDC00-\uDFFF]/.test(left[leftBoundary] ?? '')) length -= 1;
  return length;
}

/** Reconcile a Markdown body while preserving unchanged Y.Text identities. */
export function replaceMarkdownBody(
  document: Y.Doc,
  _title: string,
  markdown: string,
  origin: unknown = 'metakip-rest-edit',
): void {
  const content = document.getText(COLLABORATIVE_CONTENT_FIELD);
  const current = content.toString();
  const next = normalizeCollaborativeMarkdown(markdown);
  if (current === next) return;

  const prefix = commonPrefixLength(current, next);
  const suffix = commonSuffixLength(current, next, prefix);
  const deleteLength = current.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);

  document.transact(() => {
    if (deleteLength > 0) content.delete(prefix, deleteLength);
    if (insert) content.insert(prefix, insert);
  }, origin);
}
