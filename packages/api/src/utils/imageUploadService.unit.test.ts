import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryExecutor } from '../db/query';
import { MAX_IMAGE_SIZE_BYTES } from './image-upload';
import { prepareImageUploadForPage } from './imageUploadService';

const { executeQuery, ensurePageAccess, lockEntityAccess } = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  ensurePageAccess: vi.fn(),
  lockEntityAccess: vi.fn(),
}));

vi.mock('../db/query', () => ({ executeQuery }));
vi.mock('./share-access', () => ({ ensurePageAccess, lockEntityAccess }));

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
  vi.resetAllMocks();
  ensurePageAccess.mockResolvedValue(undefined);
  lockEntityAccess.mockResolvedValue(undefined);
});

describe('page image input', () => {
  it('uses the same bytes for storage, validation, and the reported size', async () => {
    executeQuery
      .mockResolvedValueOnce({ rows: [{ id: 'upload-id' }] })
      .mockResolvedValueOnce({ rows: [] });
    const executor: QueryExecutor = {
      execute: async () => {
        throw new Error('Queries are mocked');
      },
    };
    const prepared = await prepareImageUploadForPage('user-id', 'page-id', {
      content: png,
      originalName: 'diagram.png',
      mimeType: 'image/png',
    });

    expect(prepared.content).toBe(png);
    expect(prepared.contentType).toBe('image/png');
    await expect(prepared.persist(executor)).resolves.toMatchObject({ size: png.byteLength });
  });

  it('rejects oversized bytes without a separate file-size field', async () => {
    const content = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1);
    png.copy(content);
    await expect(
      prepareImageUploadForPage('user-id', 'page-id', {
        content,
        originalName: 'oversized.png',
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'File must be 10MB or less' });
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('checks the signature of the bytes that will actually be stored', async () => {
    await expect(
      prepareImageUploadForPage('user-id', 'page-id', {
        content: Buffer.from('not a PNG'),
        originalName: 'diagram.png',
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'File contents do not match the selected image type',
    });
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
