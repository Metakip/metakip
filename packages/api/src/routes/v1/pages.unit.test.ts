import {
  applyExactEdits,
  MAX_EXACT_EDIT_REPLACEMENT_BYTES,
  PageMarkdownError,
} from '@metakip/shared';
import { describe, expect, it } from 'vitest';

describe('applyExactEdits', () => {
  it('applies independent non-overlapping edits', () => {
    const result = applyExactEdits('Alpha\n\nBeta\n\nGamma', [
      { id: 'a', oldText: 'Alpha', newText: 'First' },
      { id: 'g', oldText: 'Gamma', newText: 'Last' },
    ]);
    expect(result.markdown).toBe('First\n\nBeta\n\nLast');
    expect(result.results).toEqual([
      { id: 'a', status: 'applied' },
      { id: 'g', status: 'applied' },
    ]);
  });

  it('rejects missing, repeated, and overlapping targets independently', () => {
    const result = applyExactEdits('one two one', [
      { id: 'repeated', oldText: 'one', newText: 'three' },
      { id: 'whole', oldText: 'one two', newText: 'changed' },
      { id: 'inside', oldText: 'two', newText: 'changed' },
      { id: 'missing', oldText: 'four', newText: '' },
    ]);
    expect(result.markdown).toBe('one two one');
    expect(result.results).toEqual([
      { id: 'repeated', status: 'conflict', reason: 'old_text_not_unique' },
      { id: 'whole', status: 'conflict', reason: 'overlapping_edit' },
      { id: 'inside', status: 'conflict', reason: 'overlapping_edit' },
      { id: 'missing', status: 'conflict', reason: 'old_text_not_found' },
    ]);
  });

  it('supports insertion and deletion through exact replacement', () => {
    const result = applyExactEdits('## Notes\n\nRemove me.', [
      { id: 'insert', oldText: '## Notes', newText: '## Notes\n\nAdded.' },
      { id: 'delete', oldText: 'Remove me.', newText: '' },
    ]);
    expect(result.markdown).toBe('## Notes\n\nAdded.\n\n');
  });

  it('initializes an empty document with an empty-text precondition', () => {
    const applied = applyExactEdits('', [{ id: 'initialize', oldText: '', newText: '# Notes' }]);
    expect(applied.markdown).toBe('# Notes');
    expect(applied.results).toEqual([{ id: 'initialize', status: 'applied' }]);

    const conflict = applyExactEdits('Already written', [
      { id: 'initialize', oldText: '', newText: '# Notes' },
    ]);
    expect(conflict.markdown).toBe('Already written');
    expect(conflict.results).toEqual([
      { id: 'initialize', status: 'conflict', reason: 'page_not_empty' },
    ]);

    const ambiguous = applyExactEdits('', [
      { id: 'first', oldText: '', newText: 'First' },
      { id: 'second', oldText: '', newText: 'Second' },
    ]);
    expect(ambiguous.markdown).toBe('');
    expect(ambiguous.results).toEqual([
      { id: 'first', status: 'conflict', reason: 'overlapping_edit' },
      { id: 'second', status: 'conflict', reason: 'overlapping_edit' },
    ]);
  });

  it('does not accept an invalid edit only because another edit repairs it', () => {
    const result = applyExactEdits('---\ntags: blue\n---\n\nBody', [
      { id: 'open-array', oldText: 'tags:', newText: 'tags: [' },
      { id: 'close-array', oldText: 'blue', newText: 'blue]' },
    ]);

    expect(result.markdown).toBe('---\ntags: blue]\n---\n\nBody');
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'open-array', status: 'invalid' }),
      { id: 'close-array', status: 'applied' },
    ]);
  });

  it('rejects cumulative replacement text over the shared limit', () => {
    expect(() =>
      applyExactEdits('target', [
        {
          id: 'large',
          oldText: 'target',
          newText: 'x'.repeat(MAX_EXACT_EDIT_REPLACEMENT_BYTES + 1),
        },
      ]),
    ).toThrowError(PageMarkdownError);
  });
});
