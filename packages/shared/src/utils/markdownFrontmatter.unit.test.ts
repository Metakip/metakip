import { describe, expect, it } from 'vitest';
import {
  parseMarkdownFrontmatter,
  UnsupportedMarkdownFrontmatterError,
} from './markdownFrontmatter';

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

describe('parseMarkdownFrontmatter', () => {
  it.each([
    '',
    '# Page Title\n\nSome content',
  ])('preserves Markdown without frontmatter', (content) => {
    expect(parseMarkdownFrontmatter(content)).toEqual({
      frontmatter: {},
      body: content,
      tags: [],
    });
  });

  it('preserves JSON-compatible frontmatter without losing quoted commas', () => {
    const result = parseMarkdownFrontmatter(`---
title: "Imported note"
published: true
priority: 2
description: "Value #1"
aliases: ["Last, First", Secondary]
tags:
  - Project
  - "Needs review"
---
Body`);

    expect(result).toEqual({
      tags: ['Project', 'Needs review'],
      frontmatter: {
        title: 'Imported note',
        published: true,
        priority: 2,
        description: 'Value #1',
        aliases: ['Last, First', 'Secondary'],
        tags: ['Project', 'Needs review'],
      },
      body: 'Body',
    });
  });

  it('supports standard YAML multiline strings', () => {
    expect(
      parseMarkdownFrontmatter(`---\ndescription: |\n  Several lines\n---\nBody`).frontmatter,
    ).toEqual({ description: 'Several lines\n' });
  });

  it('treats empty tag properties as having no tags', () => {
    expect(parseMarkdownFrontmatter('---\ntags:\n---\nBody')).toEqual({
      tags: [],
      frontmatter: { tags: [] },
      body: 'Body',
    });
  });

  it('preserves nested objects and arrays used by existing vaults', () => {
    const result = parseMarkdownFrontmatter(`---
author:
  name: Alice
  links:
    - "[[Author note]]"
releases:
  - version: "1.0"
    published: true
---
Body`);

    expect(result.frontmatter).toEqual({
      author: { name: 'Alice', links: ['[[Author note]]'] },
      releases: [{ version: '1.0', published: true }],
    });
  });

  it('preserves hostile mapping keys without allowing inherited title or tags', () => {
    const result = parseMarkdownFrontmatter(`---
__proto__:
  title: Injected title
  tags: [injected]
nested:
  __proto__:
    polluted: true
---
Body`);

    expect(result.tags).toEqual([]);
    expect(Object.getPrototypeOf(result.frontmatter)).toBeNull();
    expect(Object.hasOwn(result.frontmatter, '__proto__')).toBe(true);
    const hostileValue = ownValue(result.frontmatter, '__proto__');
    if (!hostileValue || typeof hostileValue !== 'object' || Array.isArray(hostileValue)) {
      throw new Error('Expected __proto__ to remain an object-valued own property');
    }
    expect(Object.fromEntries(Object.entries(hostileValue))).toEqual({
      title: 'Injected title',
      tags: ['injected'],
    });
    expect(Object.getPrototypeOf(hostileValue)).toBeNull();
    const nested = result.frontmatter.nested;
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      throw new Error('Expected nested frontmatter to remain an object');
    }
    const nestedRecord = nested as Record<string, unknown>;
    expect(Object.getPrototypeOf(nested)).toBeNull();
    expect(Object.hasOwn(nested, '__proto__')).toBe(true);
    const nestedHostileValue = ownValue(nestedRecord, '__proto__');
    if (
      !nestedHostileValue ||
      typeof nestedHostileValue !== 'object' ||
      Array.isArray(nestedHostileValue)
    ) {
      throw new Error('Expected nested __proto__ to remain an object-valued own property');
    }
    expect(Object.fromEntries(Object.entries(nestedHostileValue))).toEqual({ polluted: true });
  });

  it.each([
    ['duplicate keys', `---\nstatus: open\nstatus: closed\n---\nBody`],
    ['non-string tags', `---\ntags: [one, 2]\n---\nBody`],
    ['numeric tags', `---\ntags: 123\n---\nBody`],
    ['boolean tag', `---\ntag: false\n---\nBody`],
    ['non-JSON number', `---\nscore: .inf\n---\nBody`],
    ['non-JSON YAML type', `---\nlabels: !!set {one: null}\n---\nBody`],
    ['unresolved custom tag', `---\nmetadata: !metakip/custom value\n---\nBody`],
    ['missing delimiter', `---\ntags: [one]\nBody`],
  ])('rejects %s instead of partially importing them', (_name, markdown) => {
    expect(() => parseMarkdownFrontmatter(markdown)).toThrow(UnsupportedMarkdownFrontmatterError);
  });
});
