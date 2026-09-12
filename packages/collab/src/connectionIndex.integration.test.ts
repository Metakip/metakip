import type { Logger } from '@logtape/logtape';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { updateConnections } from './connectionIndex';
import { createTestPage, createTestUser, getTestPool } from './test-utils';

describe('connection index repository', () => {
  const pool = getTestPool();
  const logger = { debug: vi.fn(), warn: vi.fn() } as unknown as Logger;

  afterAll(async () => {
    await pool.end();
  });

  it('replaces page connections through the canonical database function', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Source');
    const target = await createTestPage(pool, owner.id, 'Target');
    const document = new Y.Doc();
    document
      .getText('content')
      .insert(0, `[[id:${target.id}|Target]]\n\n[[id:${target.id}|Second target reference]]`);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await updateConnections(
        client,
        source.id,
        Y.encodeStateAsUpdate(document),
        [{ userId: owner.id, isAnonymous: false }],
        logger,
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
      document.destroy();
    }

    const result = await pool.query<{ target_id: string; occurrence_count: number }>(
      `select target_id, occurrence_count
       from connections where source_type = 'page' and source_id = $1`,
      [source.id],
    );
    expect(result.rows).toEqual([{ target_id: target.id, occurrence_count: 2 }]);
    const occurrences = await pool.query<{ context: string | null }>(
      `select occurrence.context
       from connection_occurrences occurrence
       join connections connection on connection.id = occurrence.connection_id
       where connection.source_type = 'page' and connection.source_id = $1
       order by occurrence.created_at, occurrence.id`,
      [source.id],
    );
    expect(occurrences.rows).toHaveLength(2);
    expect(occurrences.rows.every((row) => typeof row.context === 'string')).toBe(true);
  });

  it('passes the complete index to one canonical replacement call', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Many tags');
    const tags = Array.from({ length: 251 }, (_, index) => `tag-${index}`);
    await pool.query('update pages set properties = $1::jsonb where id = $2', [
      JSON.stringify({ tags }),
      source.id,
    ]);
    const document = new Y.Doc();
    const client = await pool.connect();
    const querySpy = vi.spyOn(client, 'query');
    try {
      await client.query('begin');
      await updateConnections(
        client,
        source.id,
        Y.encodeStateAsUpdate(document),
        [{ userId: owner.id, isAnonymous: false }],
        logger,
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
      document.destroy();
    }

    const replacementCalls = querySpy.mock.calls.filter(
      ([statement]) =>
        typeof statement === 'string' && statement.includes('replace_page_connection_index'),
    );
    expect(replacementCalls).toHaveLength(1);
    const parameters = replacementCalls[0]?.[1];
    const payload = Array.isArray(parameters) ? parameters[1] : undefined;
    expect(typeof payload === 'string' ? (JSON.parse(payload) as unknown[]).length : 0).toBe(251);
    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from connections where source_type = 'page' and source_id = $1`,
      [source.id],
    );
    expect(count.rows[0]?.count).toBe('251');
  });
});
