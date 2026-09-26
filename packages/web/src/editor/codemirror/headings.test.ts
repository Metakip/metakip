import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { parseEditorHeadingSyntax } from './headingSyntax';
import { extractEditorHeadings, getActiveHeadingIdInView, resolveEditorHeadings } from './headings';

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

  it('re-resolves wiki-link titles from the same parsed syntax', () => {
    const source = '## [[Project]]';
    const syntax = parseEditorHeadingSyntax(source);
    expect(resolveEditorHeadings(source, syntax)).toEqual([
      { id: 'project', text: 'Project', level: 2, from: 0 },
    ]);
    expect(resolveEditorHeadings(source, syntax, () => 'Updated title')).toEqual([
      { id: 'updated-title', text: 'Updated title', level: 2, from: 0 },
    ]);
  });

  it('keeps full-document heading offsets even when headings are far apart', () => {
    const source = `# First\n${'A paragraph.\n'.repeat(1500)}\n## Last`;
    const syntax = parseEditorHeadingSyntax(source);
    expect(resolveEditorHeadings(source, syntax)).toEqual([
      { id: 'first', text: 'First', level: 1, from: 0 },
      { id: 'last', text: 'Last', level: 2, from: source.lastIndexOf('## Last') },
    ]);
  });

  it('measures only headings near the viewport when the outline is large', () => {
    const headings = Array.from({ length: 5000 }, (_, index) => ({
      id: `heading-${index}`,
      text: `Heading ${index}`,
      level: 2,
      from: index * 100,
    }));
    const lineBlockAt = vi.fn((position: number) => ({ top: position / 5 }));
    const view = {
      viewport: { from: 350000 },
      documentTop: -69920,
      lineBlockAt,
    } as unknown as EditorView;
    expect(getActiveHeadingIdInView(headings, view)).toBe('heading-3503');
    expect(lineBlockAt.mock.calls.length).toBeLessThan(15);
  });
});
