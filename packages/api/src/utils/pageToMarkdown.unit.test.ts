import { createYjsDocWithTitle } from '@markdawn/shared/markdown-yjs';
import { describe, expect, it } from 'vitest';
import { pageToMarkdown } from './export-helpers';

describe('pageToMarkdown', () => {
  it('does not synthesize an H1 from the separately stored page title', () => {
    const ydoc = createYjsDocWithTitle('Project plan', 'Authored paragraph.');
    expect(pageToMarkdown(ydoc, { tags: ['api'] }, 'pin')).toBe(
      '---\nicon: pin\ntags:\n  - api\n---\nAuthored paragraph.',
    );
  });

  it('preserves an H1 that is actually authored in the body', () => {
    const ydoc = createYjsDocWithTitle('Separate title', '# Authored heading');
    expect(pageToMarkdown(ydoc, null, null)).toBe('# Authored heading');
  });
});
