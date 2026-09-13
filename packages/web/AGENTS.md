# AGENTS.md — @metakip/web

## Gotchas

1. **Better Auth baseURL** — must be FRONTEND URL (e.g., `http://localhost:5173`), NOT the API server
2. **Buttons** — `cursor-pointer`
3. Users can pick emoji icons for pages via the emoji picker

## Floating UI

### z-index on Positioned Elements

When using `@floating-ui/react` with `FloatingPortal`, put `z-[9999]` on the **outer positioned wrapper** (the element with `ref={refs.setFloating}` and `style={floatingStyles}`), NOT on inner content. `z-index` only creates a stacking context on positioned elements — inner divs with `position: static` ignore it.

### Initial Position Flash Fix

Menus flash at `(0, 0)` before snapping to correct position. Use `useTransitionStyles` with a wrapper pattern:

```tsx
const { isMounted, refs, floatingStyles, transitionStyles, ... } = useKebabMenu();

// Outer: positioning only, with z-index
<div ref={refs.setFloating} style={floatingStyles} className="z-[9999]">
  // Inner: transitions + visual styling
  <div style={transitionStyles} className="w-40 bg-white ...">
    {/* menu content */}
  </div>
</div>
```

This defers visibility by one `requestAnimationFrame` so the element is positioned before it becomes visible. The original `isPositioned` + `visibility: hidden` approach doesn't work because `FloatingPortal` does two-pass rendering.

## CodeMirror Editor

### Wiki Links

Inactive wiki links are atomic Live Preview widgets. Bound links store a target
page ID but not its title. The server returns a requester-scoped presentation;
clients must not guess destinations or reveal authored labels when that
presentation is restricted or unavailable.

```typescript
{
[[id:550e8400-e29b-41d4-a716-446655440000#heading|custom alias]]
}
```

### Collaboration Persistence

- HocuspocusProvider handles real-time sync AND persistence automatically
- **No manual save needed**
- Collaborative undo/redo is owned by the Yjs `UndoManager`, not CodeMirror history

### TypeScript

Editor types may conflict with strict TS. Use `unknown` with narrowing.

## Styling

### Tailwind CSS v4

- CSS-first config (`@import "tailwindcss"` + `@theme`) — **no `tailwind.config.js`**
- **FOUC Prevention**: Inline script in `<head>` applies `dark` class before React hydrates
