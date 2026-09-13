# AGENTS.md — @metakip/shared

## Export Patterns

**Use `.js` extensions in import paths** (ESM requirement).

```typescript
export * from "./types/user.js";
export * from "./logger.js";
```

## Keep It Framework-Agnostic

No React, no database drivers, no framework-specific code.
