import { describe, expect, it } from 'vitest';
import { toggleMarkdownList } from './markdownListTransforms';

describe('toggleMarkdownList', () => {
  it('converts between every list kind without duplicating markers', () => {
    expect(toggleMarkdownList(['- Buy milk'], 'task')).toEqual(['- [ ] Buy milk']);
    expect(toggleMarkdownList(['1. Buy milk'], 'task')).toEqual(['- [ ] Buy milk']);
    expect(toggleMarkdownList(['- [x] Buy milk'], 'bullet')).toEqual(['- Buy milk']);
    expect(toggleMarkdownList(['- [ ] Buy milk'], 'ordered')).toEqual(['1. Buy milk']);
  });

  it('preserves checked tasks when converting a mixed selection to tasks', () => {
    expect(toggleMarkdownList(['- [x] Done', '- Pending', 'Later'], 'task')).toEqual([
      '- [x] Done',
      '- [ ] Pending',
      '- [ ] Later',
    ]);
  });

  it('preserves nesting while converting list kinds', () => {
    expect(toggleMarkdownList(['- Parent', '  - Child', '- Sibling'], 'ordered')).toEqual([
      '1. Parent',
      '  1. Child',
      '2. Sibling',
    ]);
  });

  it('preserves indentation when toggling a list off', () => {
    expect(toggleMarkdownList(['  - Nested'], 'bullet')).toEqual(['  Nested']);
  });

  it('only removes formatting when every selected line already has the target kind', () => {
    expect(toggleMarkdownList(['- One', 'Plain'], 'bullet')).toEqual(['- One', '- Plain']);
    expect(toggleMarkdownList(['1. One', '2. Two'], 'ordered')).toEqual(['One', 'Two']);
  });
});
