import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseMarkdownFrontmatter } from '@metakip/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  extractImages as extractAuthorizedImages,
  prepareImageExtraction,
  serializeFrontmatter,
} from './export-helpers';
import { LocalUploadStorage, readStoredUploads } from './uploadStorage';

describe('export-helpers / extractImages', () => {
  let tmpDir: string;
  const authorizedUploadFilenames = new Set(['test-image.png', 'photo.jpg']);
  const extractImages = async (markdown: string, uploadsDir: string) => {
    const plan = prepareImageExtraction(markdown, authorizedUploadFilenames);
    const storedUploads = await readStoredUploads(
      plan.referencedUploadFilenames,
      new LocalUploadStorage(uploadsDir),
    );
    return extractAuthorizedImages(plan, storedUploads);
  };

  beforeAll(async () => {
    const dirPath = path.join(os.tmpdir(), 'extract-images-test');
    await mkdir(dirPath, { recursive: true });
    tmpDir = dirPath;
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(path.join(tmpDir, 'test-image.png'), pngHeader);
    await writeFile(path.join(tmpDir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns unchanged markdown when no images', async () => {
    const md = '# Hello\n\nSome text with **bold** and [link](url).';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe(md);
    expect(result.assets.size).toBe(0);
  });

  it('extracts server URL images to assets', async () => {
    const md = '![test](/api/uploads/test-image.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe('![test](./assets/test-image.png)');
    expect(result.assets.size).toBe(1);
    expect(result.assets.has('test-image.png')).toBe(true);
  });

  it('leaves server images unchanged when the page does not reference the upload', async () => {
    const md = '![test](/api/uploads/test-image.png)';
    const result = extractAuthorizedImages(
      prepareImageExtraction(md, new Set()),
      new Map([['test-image.png', Buffer.from('image')]]),
    );
    expect(result.markdown).toBe(md);
    expect(result.assets.size).toBe(0);
  });

  it('plans only managed uploads referenced by the markdown', () => {
    const plan = prepareImageExtraction(
      '![test](/api/uploads/test-image.png)',
      authorizedUploadFilenames,
    );
    expect([...plan.referencedUploadFilenames]).toEqual(['test-image.png']);
  });

  it('keeps page authorization separate when plans share a workspace-wide image map', () => {
    const markdown = '![one](/api/uploads/test-image.png) ![two](/api/uploads/photo.jpg)';
    const firstPage = prepareImageExtraction(markdown, new Set(['test-image.png']));
    const secondPage = prepareImageExtraction(markdown, new Set(['photo.jpg']));
    const images = new Map([
      ['test-image.png', Buffer.from('first image')],
      ['photo.jpg', Buffer.from('second image')],
    ]);
    expect(extractAuthorizedImages(firstPage, images).markdown).toBe(
      '![one](./assets/test-image.png) ![two](/api/uploads/photo.jpg)',
    );
    expect(extractAuthorizedImages(secondPage, images).markdown).toBe(
      '![one](/api/uploads/test-image.png) ![two](./assets/photo.jpg)',
    );
  });

  it('extracts base64 images to assets with hash filename', async () => {
    const md = '![logo](data:image/png;base64,iVBORw0KGgo=)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toMatch(/!\[logo\]\(\.\/assets\/image-[a-f0-9]{12}\.png\)/);
    expect(result.assets.size).toBe(1);
  });

  it('deduplicates same server URL', async () => {
    const md = '![a](/api/uploads/test-image.png)\n\n![b](/api/uploads/test-image.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toContain('./assets/test-image.png');
    expect(result.assets.size).toBe(1);
  });

  it('deduplicates same base64 content', async () => {
    const b64 = 'iVBORw0KGgo=';
    const md = `![a](data:image/png;base64,${b64})\n\n![b](data:image/png;base64,${b64})`;
    const result = await extractImages(md, tmpDir);
    expect(result.assets.size).toBe(1);
    const occurrences = result.markdown.match(/image-[a-f0-9]{12}\.png/g);
    expect(occurrences?.length).toBe(2);
    expect(new Set(occurrences).size).toBe(1);
  });

  it('handles filename collisions with counter suffix', async () => {
    const b64 = Buffer.from('different-content').toString('base64');
    const md = `![a](data:image/png;base64,${b64})`;
    const result = await extractImages(md, tmpDir);
    expect(result.assets.size).toBe(1);
  });

  it('skips external URLs', async () => {
    const md = '![ext](https://example.com/image.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe(md);
    expect(result.assets.size).toBe(0);
  });

  it('skips missing server files', async () => {
    const md = '![missing](/api/uploads/nonexistent.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe(md);
    expect(result.assets.size).toBe(0);
  });

  it('handles multiple different images', async () => {
    const md = '![one](/api/uploads/test-image.png)\n\n![two](/api/uploads/photo.jpg)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toContain('./assets/test-image.png');
    expect(result.markdown).toContain('./assets/photo.jpg');
    expect(result.assets.size).toBe(2);
  });

  it('handles images with empty alt text', async () => {
    const md = '![](/api/uploads/test-image.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe('![](./assets/test-image.png)');
  });

  it('handles images with special characters in alt', async () => {
    const md = '![my **bold** image](/api/uploads/test-image.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe('![my **bold** image](./assets/test-image.png)');
  });

  it('extracts managed images with escaped brackets in their alt text', async () => {
    const md = String.raw`![Graph \[v2\]](/api/uploads/test-image.png)`;
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe(String.raw`![Graph \[v2\]](./assets/test-image.png)`);
    expect(result.assets.has('test-image.png')).toBe(true);
  });

  it('rejects path traversal in server URLs', async () => {
    const md = '![hack](/api/uploads/../../../etc/passwd)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe(md);
    expect(result.assets.size).toBe(0);
  });

  it('rejects hidden filenames', async () => {
    const md = '![hack](/api/uploads/.env)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe(md);
    expect(result.assets.size).toBe(0);
  });

  it('does not replace images inside fenced code blocks', async () => {
    const md =
      '```md\n![example](/api/uploads/test-image.png)\n```\n\nReal: ![ok](/api/uploads/test-image.png)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toContain('```md\n![example](/api/uploads/test-image.png)\n```');
    expect(result.markdown).toContain('Real: ![ok](./assets/test-image.png)');
    expect(result.assets.size).toBe(1);
  });

  it('does not replace images inside inline code', async () => {
    const md =
      'Use `![example](/api/uploads/test-image.png)` in your docs.\n\nBut ![real](/api/uploads/test-image.png) works.';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toContain('`![example](/api/uploads/test-image.png)`');
    expect(result.markdown).toContain('![real](./assets/test-image.png)');
    expect(result.assets.size).toBe(1);
  });

  it('extracts images with titles', async () => {
    const md = '![test](/api/uploads/test-image.png "My Title")';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe('![test](./assets/test-image.png "My Title")');
    expect(result.assets.size).toBe(1);
  });

  it('extracts images with single-quoted titles', async () => {
    const md = "![test](/api/uploads/test-image.png 'My Title')";
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe("![test](./assets/test-image.png 'My Title')");
    expect(result.assets.size).toBe(1);
  });

  it('extracts base64 SVG images', async () => {
    const svgB64 = Buffer.from('<svg></svg>').toString('base64');
    const md = `![icon](data:image/svg+xml;base64,${svgB64})`;
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toMatch(/!\[icon\]\(\.\/assets\/image-[a-f0-9]{12}\.svg\)/);
    expect(result.assets.size).toBe(1);
  });

  it('handles images with parenthesized titles', async () => {
    const md = '![test](/api/uploads/test-image.png (My Title))';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe('![test](./assets/test-image.png (My Title))');
    expect(result.assets.size).toBe(1);
  });

  it('handles images with angle-bracket URLs', async () => {
    const md = '![test](</api/uploads/test-image.png>)';
    const result = await extractImages(md, tmpDir);
    expect(result.markdown).toBe('![test](./assets/test-image.png)');
    expect(result.assets.size).toBe(1);
  });
});

describe('export-helpers / serializeFrontmatter', () => {
  it.each([
    ['newlines', { desc: 'line1\nline2' }],
    ['tabs', { code: 'a\tb' }],
    ['carriage returns', { text: 'line1\r\nline2' }],
    ['number-like strings', { version: '1.0.0' }],
    ['boolean-like strings', { flag: 'true' }],
  ])('round-trips %s', (_name, properties) => {
    const serialized = serializeFrontmatter(properties, null);
    expect(parseMarkdownFrontmatter(`${serialized}Body`).frontmatter).toEqual(properties);
  });
});
