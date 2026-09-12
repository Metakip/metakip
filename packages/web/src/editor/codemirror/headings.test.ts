import { describe, expect, it } from 'vitest';
import { extractEditorHeadings } from './headings';

describe('editor headings', () => {
  it('uses rendered link text for the outline and heading ID', () => {
    expect(extractEditorHeadings('## [Setup](https://example.com)')).toEqual([
      { id: 'setup', text: 'Setup', level: 2, from: 0 },
    ]);
  });

  it('removes formatting markers while preserving visible text', () => {
    expect(extractEditorHeadings('# **Bold** and `code`')).toEqual([
      { id: 'bold-and-code', text: 'Bold and code', level: 1, from: 0 },
    ]);
  });

  it('uses a wiki-link alias as the visible heading text', () => {
    expect(
      extractEditorHeadings('### [[id:11111111-1111-1111-1111-111111111111|Roadmap]]'),
    ).toEqual([{ id: 'roadmap', text: 'Roadmap', level: 3, from: 0 }]);
  });
});
