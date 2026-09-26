import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryExecutor } from '../../db/query';
import type { V1Principal } from '../../middleware/v1Auth';

const { executeQueryMock, queryMock } = vi.hoisted(() => ({
  executeQueryMock: vi.fn(),
  queryMock: vi.fn(),
}));
vi.mock('../../db/query', () => ({ executeQuery: executeQueryMock, query: queryMock }));

import {
  completeIdempotency,
  reserveIdempotency,
  runIdempotentContentCommand,
} from './idempotency';

const principal: V1Principal = {
  kind: 'session',
  userId: randomUUID(),
  credential: 'missing-reservation-test',
};

describe('reserveIdempotency', () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    queryMock.mockReset();
  });

  it('completes a reservation through the owning idempotency layer', async () => {
    executeQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    const executor: QueryExecutor = {
      execute: async () => {
        throw new Error('The mocked executeQuery should not call the executor');
      },
    };

    await expect(
      completeIdempotency(
        { recordId: 'reservation-id', key: 'key', requestHash: 'request-hash' },
        { id: 'image-id' },
        executor,
      ),
    ).resolves.toBeUndefined();
    expect(executeQueryMock).toHaveBeenCalledWith(executor, expect.anything());
  });

  it('returns a distinct code when a conflicting reservation disappears', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(
      reserveIdempotency<{ id: string }>(principal, 'missing', 'request'),
    ).rejects.toMatchObject({
      status: 409,
      cause: { code: 'idempotency_reservation_missing' },
    });
  });

  it('passes a new reservation to the command', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'reservation-id' }] });
    const command = vi.fn().mockResolvedValue({ etag: 'revision' });

    await expect(
      runIdempotentContentCommand(principal, 'key', 'request-hash', command),
    ).resolves.toEqual({ etag: 'revision' });
    expect(command).toHaveBeenCalledWith({
      recordId: 'reservation-id',
      key: 'key',
      requestHash: 'request-hash',
    });
  });

  it('replays a completed response without running another command', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ request_hash: 'request-hash', response: { etag: 'stored-revision' } }],
    });
    const command = vi.fn();

    await expect(
      runIdempotentContentCommand(principal, 'key', 'request-hash', command),
    ).resolves.toEqual({ etag: 'stored-revision' });
    expect(command).not.toHaveBeenCalled();
  });

  it('rejects reuse of a key with a different request hash', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ request_hash: 'other-request', response: { etag: 'stored-revision' } }],
    });

    await expect(
      runIdempotentContentCommand(principal, 'key', 'request-hash', vi.fn()),
    ).rejects.toMatchObject({
      status: 409,
      cause: { code: 'idempotency_key_mismatch' },
    });
  });

  it('releases a reservation after a known command failure', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'reservation-id' }] }).mockResolvedValueOnce({});
    const failure = new HTTPException(422, { message: 'Invalid edit' });

    await expect(
      runIdempotentContentCommand(principal, 'key', 'request-hash', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('retains a reservation after an uncertain command failure', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'reservation-id' }] });
    const failure = new HTTPException(503, {
      message: 'Collaboration service is unavailable',
      cause: { code: 'COLLABORATION_FAILURE' },
    });

    await expect(
      runIdempotentContentCommand(principal, 'key', 'request-hash', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
