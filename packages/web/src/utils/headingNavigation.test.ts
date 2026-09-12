import { describe, expect, it } from 'vitest';
import { findRenderedHeading, getHeadingId } from './headingNavigation';

describe('heading navigation', () => {
  it('matches Markdown heading IDs without stripping punctuation or Unicode', () => {
    expect(getHeadingId('  Résumé: Q&A  ')).toBe('résumé:-q&a');
    expect(getHeadingId('Release   Milestones')).toBe('release-milestones');
  });

  it('prefers an actual rendered ID', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<div class="cm-md-heading" id="custom-id">Different text</div>';

    expect(findRenderedHeading(editor, 'custom-id')?.textContent).toBe('Different text');
  });

  it('finds an explicitly identified heading by its generated text ID', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<div class="cm-md-heading" id="explicit-id">Résumé: Q&amp;A</div>';

    expect(findRenderedHeading(editor, 'résumé:-q&a')?.id).toBe('explicit-id');
  });
});
