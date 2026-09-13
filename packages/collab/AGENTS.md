# AGENTS.md — @metakip/collab

## Key Decisions

### WebSocket Only

Does not serve HTTP. Port 1234 for WebSocket only.

### Authentication Token Priority

Session tokens checked in this order:
1. URL parameter `?token=`
2. `Authorization: Bearer <token>` header
3. `better-auth.session_token` cookie
4. `__Secure-better-auth.session_token` cookie

### Document Persistence

- Binary Yjs updates stored in `pages.ydoc` (BYTEA)
- Default: 500ms debounce, 3000ms max
- Force-save on disconnect

### Database Access

- Keep parameterized `pg` access behind focused repository/service modules.
- Direct driver access is expected for `LISTEN` subscriptions and collaboration
  transactions whose lifetime spans Hocuspocus message application.
- Do not scatter SQL through protocol, permission-transition, or WebSocket
  orchestration code.
- A future shared database package may provide Drizzle schema typing; do not
  import API-internal schema files or duplicate the schema in this package.

### Hocuspocus Lifecycle Hooks

- `@hocuspocus/server` is pinned to 4.6.0 and extended by the checked-in pnpm
  patch under `patches/`.
- The package patch provides the small set of v4 compatibility hooks required
  by the collaboration adapter.
- Keep these changes in the package patch; do not mutate Hocuspocus prototypes
  or package-global hook state at runtime.
