# AGENTS.md — Metakip

## Gotchas

1. **Environment detection**: `process.env.NODE_ENV === "production"`
2. **Yjs storage**: binary buffers in PostgreSQL (`pages.ydoc`)
3. **CORS**: allowlist-based in production
4. **Buttons**: `cursor-pointer`
5. **Better Auth baseURL**: must be FRONTEND URL (5173), not API (3001)
6. **API does not serve static files**: Caddy serves `packages/web/dist` directly
7. **Deploy**: configs in `deploy/`, scripts: `setup.sh` (one-time) + `deploy.sh` (incremental)
8. **Migration workflow**:
   - Edit `packages/api/src/db/schema.ts` (the source of truth).
   - Run `db:generate` — Drizzle v1 diffs your schema code against the latest `drizzle/<timestamp>_<name>/snapshot.json` and creates a new migration folder.
   - **Always use `--name`** for meaningful migration names: `pnpm --filter @metakip/api exec drizzle-kit generate --name describe_your_change`. Without it, Drizzle generates random placeholder names.
   - **For custom SQL** (functions, triggers, data migrations, idempotent DDL): `pnpm --filter @metakip/api exec drizzle-kit generate --custom --name describe_your_change`. Write your SQL into the generated `migration.sql`.
   - Run `db:migrate` — applies pending migrations and tracks them in `drizzle.__drizzle_migrations`.
   - **Commit everything Drizzle touched** in the new migration folder: `migration.sql` and `snapshot.json`. There is no legacy `drizzle/meta/_journal.json` in Drizzle v1.
   - `db:push` is disabled for this repo. Never bypass migration files on a database that has `db:migrate` history.
   - Run `pnpm --filter @metakip/api db:check` before committing migration changes.
   - **Breaking reset note**: the Drizzle v1 migration reset replaced the legacy migration history. Any database created before this reset must be dropped/recreated before running `db:migrate`; do not apply the new baseline migrations over an old dirty DB.
   - For a fresh dev setup or new server: `setup.sh` runs `db:migrate`. No `db:push` or legacy stub tables are needed.
9. The default branch in this repo is `master`.
10. Never run lsp diagnostics. Instead run pnpm typecheck and pnpm format. Iterate until fixed.

## Code Style

- **No `any`** — use `unknown` with narrowing
- **No emojis** in commit messages or log output (emoji is fine in user-facing content like page icons)
- **Named imports** preferred
- **File naming**: `camelCase.ts` utils, `PascalCase.tsx` components, `use*.ts` hooks
- **Strict TypeScript**: `noImplicitReturns`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`

## Commit Messages

- Format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- **No AI signatures** (not "Co-authored-by: Sisyphus")
- **Verify before commit**: lint → typecheck → build
- **Always GPG sign** — retry if "incorrect passphrase"
