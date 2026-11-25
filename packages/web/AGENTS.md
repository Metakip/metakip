# AGENTS.md — @metakip/web

## Gotchas

1. **Better Auth baseURL** — must be FRONTEND URL (e.g., `http://localhost:5173`), NOT the API server
2. **Buttons** — set `cursor: 'pointer'` in the owning StyleX style
3. Users can pick emoji icons for pages via the emoji picker

## Floating UI

### z-index on Positioned Elements

When using `@floating-ui/react` with `FloatingPortal`, put `z-index` on the **outer positioned wrapper** (the element with `ref={refs.setFloating}` and `style={floatingStyles}`), NOT on inner content. `z-index` only creates a stacking context on positioned elements — inner divs with `position: static` ignore it.

### Initial Position Flash Fix

Menus flash at `(0, 0)` before snapping to correct position. Use `useTransitionStyles` with a wrapper pattern:

```tsx
const { isMounted, refs, floatingStyles, transitionStyles, ... } = useKebabMenu();

// Outer: positioning only, with z-index
<div ref={refs.setFloating} style={floatingStyles} className={styles.positioner}>
  // Inner: transitions + visual styling
  <div style={transitionStyles} className={styles.popup}>
    {/* menu content */}
  </div>
</div>
```

This defers visibility by one `requestAnimationFrame` so the element is positioned before it becomes visible. The original `isPositioned` + `visibility: hidden` approach doesn't work because `FloatingPortal` does two-pass rendering.

```css
.positioner {
  z-index: 9999;
}

.popup {
  width: 10rem;
  background: var(--color-app-card);
}
```

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

### StyleX

- Use `@stylexjs/stylex` for component-specific styles; define styles with `stylex.create()` in colocated `.stylex.ts` files.
- Keep global styles in `index.css` limited to tokens, resets, and app-wide behavior.
- Use semantic class names that describe the component part or state, not one-class-per-property utilities.
- Use the typed `colors` contract from `src/theme.stylex.ts` for shared UI roles. Map those roles to the brand palette in `index.css`; keep destructive text colors separate from button fills.
- Choose roles by their actual light/dark pair, not by a vague resemblance: `textMuted` is explanatory text, `textSubtle` is secondary copy, and `textFaint` is metadata. `border`, `borderHover`, and `borderRaised` have different contrast levels. Do not duplicate a role just because another component uses it.
- Compose filled actions with `actionColors` from `components/ui/ActionColors.stylex.ts`. It owns the foreground, background, and hover together; component styles own geometry. Use `contrast` for theme-inverting actions, `subdued` for dark filled actions, and `destructive` for destructive confirmations. Keep deliberate feature-specific exceptions local.
- Sharing and workspace membership use `components/access` for invitation controls, load errors, and access tables. The table owns the column definition; all member, collaborator, and invitation rows inherit it.
- Keep feature-specific colors in the owning `.stylex.ts` file. Use `light-dark()` for local color pairs; the root `color-scheme` follows the selected theme. Do not add component-part aliases to the global palette.
- Keep native `light-dark()` through the shared `vite/stylexOptions.ts` configuration in both Vite and Vitest. Its Lightning CSS fallback cannot work across independently processed stylesheets: `color-scheme` lives in `index.css`. The app requires native support (Chrome/Edge 123+, Firefox 120+, Safari 17.5+); do not define compiler-private fallback variables in application CSS.
- Compose conditional styles with `stylex.props()`.
- Use global selectors only for app-wide behavior that cannot be scoped to a component.
- **FOUC Prevention**: Inline script in `<head>` applies `dark` class before React hydrates.
