import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryExecutor } from '../db/query';
import { materializeUploadFile } from './uploadMaterialization';
import { LocalUploadStorage } from './uploadStorage';

let directory: string | undefined;
const scheduled: string[] = [];
const cancelled: string[] = [];
const finalized: string[] = [];
const executor: QueryExecutor = {
  execute: async () => {
    throw new Error('The test executor should not execute queries');
  },
};
const coordinator = {
  cancel: async (filename: string) => {
    cancelled.push(filename);
  },
  finalize: async <T>(
    _filename: string,
    operation: (value: QueryExecutor) => Promise<T>,
  ): Promise<T> => operation(executor),
  schedule: async (filename: string) => {
    scheduled.push(filename);
  },
};

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
  scheduled.length = 0;
  cancelled.length = 0;
  finalized.length = 0;
});

describe('materializeUploadFile', () => {
  it('leaves failed metadata writes queued for authoritative cleanup', async () => {
    directory = await mkdtemp(join(tmpdir(), 'metakip-upload-materialization-'));
    const filename = 'failed.png';

    await expect(
      materializeUploadFile(
        filename,
        Buffer.from('image'),
        async () => {
          throw new Error('metadata insert failed');
        },
        {
          storage: new LocalUploadStorage(directory),
          coordinator,
        },
      ),
    ).rejects.toThrow('metadata insert failed');
    await expect(readFile(join(directory, filename), 'utf8')).resolves.toBe('image');
    expect(scheduled).toEqual([filename]);
    expect(cancelled).toEqual([]);
  });

  it('keeps staged bytes after metadata persistence succeeds', async () => {
    directory = await mkdtemp(join(tmpdir(), 'metakip-upload-materialization-'));
    const filename = 'stored.png';

    await expect(
      materializeUploadFile(filename, Buffer.from('image'), async () => 'upload-id', {
        afterPersist: async (_executor, uploadId) => {
          finalized.push(uploadId);
        },
        storage: new LocalUploadStorage(directory),
        coordinator,
      }),
    ).resolves.toBe('upload-id');
    await expect(readFile(join(directory, filename), 'utf8')).resolves.toBe('image');
    expect(scheduled).toEqual([filename]);
    expect(cancelled).toEqual([filename]);
    expect(finalized).toEqual(['upload-id']);
  });
});
