# AGENTS.md — @metakip/api

## Key Decisions

### Database Access

Use Drizzle's typed query builder for straightforward CRUD and simple filters. The API exports `db` from `src/db/connection.ts`, backed by the same `pg.Pool`, so there is no package-installation reason to avoid it.

Use Drizzle's `sql` template operator when raw SQL is the clearer tool:
- recursive CTEs and closure-table maintenance
- permission functions and calls to SQL functions
- `pg_notify` / LISTEN-related statements
- transaction bodies via `db.transaction` and Drizzle SQL statements
- one-off database maintenance or test setup

Never parse `$1`-style placeholders in application code. Interpolate values
through Drizzle's `sql` tag so the driver owns parameter binding. Use
`sql.raw` only for static, trusted SQL fragments—not request data.
The application `query` and `executeQuery` helpers accept `SQL` objects only.
Integration fixtures that intentionally use node-postgres placeholders must
import `testQuery` from `src/db/testQuery.ts`.

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { pages } from '../db/schema';

const result = await db.select().from(pages).where(eq(pages.id, pageId));
```

### Yjs Binary Export

The `ydoc` column stores binary Yjs CRDT data. Use null-byte detection to distinguish from plain text:

```typescript
const hasNullByte = page.ydoc.includes(0);
if (!hasNullByte) {
  content = new TextDecoder().decode(page.ydoc);
}
```

## Testing Conventions

### Auth Guard Baseline

Every route test starts with these two cases:
```typescript
it('returns 401 without session', ...)
it('returns 401 with invalid token', ...)
```

### Use Factories from `src/test-utils.ts`

- `createTestUser()` — user + personal workspace + membership
- `createTestSession(userId)` — signed session cookie
- `createTestPage(workspaceId, createdBy)` — page within workspace
- `createTestWorkspace(ownerId)` — non-personal workspace

### Integration Harness

- PostgreSQL container: `metakip-postgres-test`
- Truncate between tests: `SET session_replication_role = replica`
- Auth: HMAC-SHA256 signed session cookies
