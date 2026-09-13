import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeUploadFile } from './uploadMaterialization';

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('materializeUploadFile', () => {
  it('removes staged bytes when metadata persistence fails', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'metakip-upload-materialization-'));
    const filename = 'failed.png';

    await expect(
      materializeUploadFile(
        filename,
        Buffer.from('image'),
        async () => {
          throw new Error('metadata insert failed');
        },
        directory,
      ),
    ).rejects.toThrow('metadata insert failed');
    await expect(access(path.join(directory, filename))).rejects.toThrow();
  });

  it('keeps staged bytes after metadata persistence succeeds', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'metakip-upload-materialization-'));
    const filename = 'stored.png';

    await expect(
      materializeUploadFile(filename, Buffer.from('image'), async () => 'upload-id', directory),
    ).resolves.toBe('upload-id');
    await expect(readFile(path.join(directory, filename), 'utf8')).resolves.toBe('image');
  });
});
