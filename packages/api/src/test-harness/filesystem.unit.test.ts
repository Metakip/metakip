import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestTempDir, createTestTempFile } from '../test-utils';

describe('test-harness / filesystem isolation', () => {
  const uploadsPath = join(__dirname, '..', '..', 'uploads');

  afterEach(() => {
    // Ensure no test artifacts leaked into the repo uploads directory
    const files = existsSync(uploadsPath) ? readdirSync(uploadsPath) : [];
    for (const file of files) {
      expect(file).not.toMatch(/^metakip-test-/);
    }
  });

  it('createTestTempDir creates an isolated directory under os.tmpdir()', () => {
    const { path, cleanup } = createTestTempDir();

    try {
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
      expect(path).not.toContain('packages/api/uploads');
    } finally {
      cleanup();
    }
  });

  it('createTestTempDir cleanup removes the directory', () => {
    const { path, cleanup } = createTestTempDir();
    expect(existsSync(path)).toBe(true);

    cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it('createTestTempFile creates a file with content', () => {
    const { path, cleanup } = createTestTempDir();

    try {
      const filePath = createTestTempFile(path, 'test.txt', 'hello world');
      expect(existsSync(filePath)).toBe(true);
      expect(statSync(filePath).isFile()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('multiple temp files can be created and cleaned up', () => {
    const { path, cleanup } = createTestTempDir();

    try {
      createTestTempFile(path, 'a.txt', 'aaa');
      createTestTempFile(path, 'b.txt', 'bbb');
      createTestTempFile(path, 'sub/c.txt', 'ccc');

      const topFiles = readdirSync(path);
      expect(topFiles).toContain('a.txt');
      expect(topFiles).toContain('b.txt');
      expect(topFiles).toContain('sub');

      const subFiles = readdirSync(join(path, 'sub'));
      expect(subFiles).toContain('c.txt');
    } finally {
      cleanup();
    }

    expect(existsSync(path)).toBe(false);
  });

  it('idempotent cleanup does not throw', () => {
    const { path: _path, cleanup } = createTestTempDir();
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });
});
