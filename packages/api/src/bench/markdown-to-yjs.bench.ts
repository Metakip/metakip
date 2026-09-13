import { markdownToYjsState } from '@metakip/shared/markdown-yjs';
import { bench, describe } from 'vitest';

describe('markdownToYjsState benchmarks', () => {
  const smallMd = '# Hello\n\nThis is a small markdown document.';

  const mediumMd = Array.from(
    { length: 50 },
    (_, i) =>
      `## Section ${i + 1}\n\nThis is paragraph ${i + 1} with some **bold** and *italic* text.\n\n- Item A\n- Item B\n- Item C\n`,
  ).join('\n');

  const largeMd = Array.from(
    { length: 500 },
    (_, i) =>
      `## Section ${i + 1}\n\nThis is paragraph ${i + 1} with some **bold** and *italic* text and \`inline code\`.\n\n1. First\n2. Second\n3. Third\n\n> A blockquote here\n`,
  ).join('\n');

  bench('small markdown (200 bytes)', () => {
    markdownToYjsState(smallMd);
  });

  bench('medium markdown (10KB)', () => {
    markdownToYjsState(mediumMd);
  });

  bench('large markdown (100KB)', () => {
    markdownToYjsState(largeMd);
  });
});
