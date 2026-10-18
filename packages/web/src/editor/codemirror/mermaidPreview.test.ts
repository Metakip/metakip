import { forceParsing } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { expandPreviewRangeForLivePreview } from './livePreviewDecorations';
import { createView } from './livePreviewTestView';
import { mermaidPreviewField, mermaidRenderCachePlugin } from './mermaidPreview';

describe('Mermaid preview', () => {
  it('previews the first block in a read-only editor until its source is revealed', async () => {
    const source = '```mermaid\nflowchart LR\nA --> B\n```\n\nAfter';
    const view = createView(source, true);

    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    expect(view.dom.textContent).not.toContain('flowchart LR');

    view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget')?.click();
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    expect(view.state.selection.main.head).toBe(source.indexOf('flowchart LR'));
    expect(view.dom.textContent).toContain('flowchart LR');

    view.dispatch({ selection: { anchor: source.indexOf('After') } });
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('keeps the first block open when an editable editor starts with its caret inside', () => {
    const view = createView('```mermaid\nflowchart LR\nA --> B\n```');

    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    expect(view.dom.textContent).toContain('flowchart LR');
    view.destroy();
  });

  it('renders Mermaid fences with blank body lines before the diagram', async () => {
    for (const source of [
      'Intro\n\n```mermaid\n\nflowchart LR\nA --> B\n```',
      'Intro\n\n> ```mermaid\n> \n> flowchart LR\n> A --> B\n> ```',
    ]) {
      const view = createView(source);
      await vi.waitFor(() => {
        expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
      });
      const widget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');
      expect(widget).not.toBeNull();
      widget?.click();
      expect(view.state.selection.main.head).toBe(source.indexOf('flowchart LR'));
      expect(view.dom.textContent).toContain('flowchart LR');
      expect(view.state.doc.toString()).toBe(source);
      view.destroy();
    }
  });

  it('reuses an unchanged Mermaid preview when text above it shifts its source position', async () => {
    const source = 'Intro\n\n```mermaid\nflowchart LR\nA --> B\n```';
    const view = createView(source);
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    const originalWidget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');
    const renderKey = view.state.field(mermaidPreviewField).blocks.iter().value?.renderKey;

    view.dispatch({ changes: { from: 0, insert: 'New text above\n\n' } });

    const shiftedWidget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');
    expect(shiftedWidget).toBe(originalWidget);
    expect(view.state.field(mermaidPreviewField).blocks.iter().value?.renderKey).toBe(renderKey);
    shiftedWidget?.click();
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf('flowchart LR'));
    expect(view.dom.textContent).toContain('flowchart LR');
    view.destroy();
  });

  it('keeps a diagram indexed when unrelated prose in a long list changes', () => {
    const source = `${'- prose\n'.repeat(80)}- \`\`\`mermaid\n  flowchart LR\n  A --> B\n  \`\`\``;
    const view = createView(source);
    const before = view.state.field(mermaidPreviewField).blocks.iter().value;
    expect(before).not.toBeNull();

    const from = source.indexOf('prose');
    view.dispatch({ changes: { from, to: from + 5, insert: 'notes' } });

    expect(view.state.field(mermaidPreviewField).blocks.iter().value).toBe(before);
    view.destroy();
  });

  it('does not rebuild sibling diagrams after a list item changes structure', () => {
    const source = `${'- prose\n'.repeat(80)}- \`\`\`mermaid\n  flowchart LR\n  A --> B\n  \`\`\``;
    const view = createView(source);
    const before = view.state.field(mermaidPreviewField).blocks.iter().value;
    expect(before).not.toBeNull();

    view.dispatch({ changes: { from: source.indexOf('prose') + 2, insert: '\n  - nested' } });

    expect(view.state.field(mermaidPreviewField).blocks.iter().value).toBe(before);
    view.destroy();
  });

  it('keeps an intervening diagram indexed across distant edits in one transaction', () => {
    const source =
      '```mermaid\nflowchart LR\nA --> B\n```\n\n```mermaid\nflowchart LR\nC --> D\n```\n\n```mermaid\nflowchart LR\nE --> F\n```';
    const view = createView(source);
    const before = view.state.field(mermaidPreviewField).blocks.iter();
    before.next();
    const middle = before.value;
    expect(middle).not.toBeNull();

    const first = source.indexOf('A --> B');
    const last = source.indexOf('E --> F');
    view.dispatch({
      changes: [
        { from: first, to: first + 7, insert: 'A --> X' },
        { from: last, to: last + 7, insert: 'E --> Y' },
      ],
    });

    const after = view.state.field(mermaidPreviewField).blocks.iter();
    after.next();
    expect(after.value).toBe(middle);
    view.destroy();
  });

  it('indexes diagrams when incremental parsing reaches them', () => {
    const source = `${'An ordinary paragraph.\n\n'.repeat(500)}\`\`\`mermaid\nflowchart LR\nA --> B\n\`\`\``;
    const view = createView(source);
    expect(forceParsing(view, source.length, 1000)).toBe(true);
    expect(view.state.field(mermaidPreviewField).blocks.size).toBe(1);
    view.destroy();
  });

  it('discards distant previews when a structural edit makes the parsed tail stale', () => {
    const source = `${'An ordinary paragraph.\n\n'.repeat(500)}\`\`\`mermaid\nflowchart LR\nA --> B\n\`\`\``;
    const view = createView(source);
    expect(forceParsing(view, source.length, 1000)).toBe(true);
    expect(view.state.field(mermaidPreviewField).blocks.size).toBe(1);

    view.dispatch({ changes: { from: 0, insert: '```text\n' } });

    expect(view.state.field(mermaidPreviewField).blocks.size).toBe(0);
    expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true);
    expect(view.state.field(mermaidPreviewField).blocks.size).toBe(0);
    view.destroy();
  });

  it('reuses the rendered diagram after revealing and hiding unchanged source', async () => {
    const source = 'Intro\n\n```mermaid\nflowchart LR\nA --> B\n```';
    const view = createView(source);
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    const renderKey = view.state.field(mermaidPreviewField).blocks.iter().value?.renderKey;
    expect(renderKey).toBeDefined();

    view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget')?.click();
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.state.field(mermaidPreviewField).blocks.iter().value?.renderKey).toBe(renderKey);
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    view.destroy();
  });

  it('releases rendered SVGs when the editor is destroyed', async () => {
    const source = 'Intro\n\n```mermaid\nflowchart LR\nA --> B\n```';
    const view = createView(source);
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    const cache = view.plugin(mermaidRenderCachePlugin);
    expect(cache?.renderedDiagrams.size).toBe(1);
    const other = createView(source);
    const otherCache = other.plugin(mermaidRenderCachePlugin);
    expect(otherCache).not.toBe(cache);
    expect(otherCache?.renderedDiagrams.size).toBe(1);

    view.destroy();

    expect(cache?.renderedDiagrams.size).toBe(0);
    expect(otherCache?.renderedDiagrams.size).toBe(1);
    other.destroy();
  });

  it('updates a Mermaid preview when its fence language changes', () => {
    const source = 'Intro\n\n```text\nflowchart LR\nA --> B\n```';
    const view = createView(source);
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();

    const from = source.indexOf('text');
    view.dispatch({ changes: { from, to: from + 4, insert: 'mermaid' } });
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).not.toBeNull();

    view.dispatch({ changes: { from, to: from + 7, insert: 'text' } });
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    view.destroy();
  });

  it('reveals the source when the caret is on a nested fence prefix', () => {
    const source = 'Intro\n\n> ```mermaid\n> flowchart LR\n> A --> B\n> ```';
    const view = createView(source);
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).not.toBeNull();

    view.dispatch({ selection: { anchor: source.indexOf('>') } });

    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    expect(view.dom.textContent).toContain('flowchart LR');
    view.destroy();
  });

  it('keeps empty Mermaid fences styled as ordinary code blocks', () => {
    const view = createView('Before\n\n```mermaid\n\n\n```\nAfter');

    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    expect(
      view.dom.querySelectorAll(
        '.cm-md-code-block:not(.cm-md-code-block-first):not(.cm-md-code-block-last)',
      ),
    ).toHaveLength(2);
    view.destroy();
  });

  it('keeps Mermaid source visible while editing and does not render other code fences', () => {
    const source = 'Before\n```mermaid\nflowchart LR\nA --> B\n```\n\n```text\nnot a diagram\n```';
    const view = createView(source);
    view.dispatch({ selection: { anchor: source.indexOf('A --> B') } });

    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    expect(view.dom.textContent).toContain('flowchart LR');
    expect(view.dom.textContent).toContain('not a diagram');
    view.destroy();
  });

  it('labels Mermaid render errors as source reveal in read-only editors', async () => {
    const view = createView('Before\n```mermaid\nflowchart LR\nA -->\n```', true);
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-error')).not.toBeNull();
    });
    const widget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');

    expect(widget?.getAttribute('aria-label')).toContain('Activate to reveal its source.');
    expect(widget?.title).toBe('Click to reveal Mermaid source');
    view.destroy();
  });

  it('replaces a pending Mermaid widget when read-only mode changes', async () => {
    const mode = new Compartment();
    const view = createView('Before\n```mermaid\nflowchart LR\nA -->\n```', false, mode);
    const oldWidget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');
    expect(oldWidget).not.toBeNull();

    view.dispatch({ effects: mode.reconfigure(EditorState.readOnly.of(true)) });
    const widget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');
    expect(widget).not.toBe(oldWidget);
    await vi.waitFor(() => {
      expect(widget?.classList.contains('cm-md-mermaid-error')).toBe(true);
    });
    expect(widget?.getAttribute('aria-label')).toContain('Activate to reveal its source.');
    expect(widget?.getAttribute('aria-label')).toContain('Mermaid rendering error:');
    view.destroy();
  });

  it('does not rebuild Mermaid previews for unrelated editor reconfiguration', () => {
    const mode = new Compartment();
    const view = createView('Before\n```mermaid\nflowchart LR\nA --> B\n```', false, mode);
    const preview = view.state.field(mermaidPreviewField);
    const widget = view.dom.querySelector('.cm-md-mermaid-widget');

    view.dispatch({
      effects: mode.reconfigure([EditorState.readOnly.of(false), EditorState.tabSize.of(8)]),
    });

    expect(view.state.field(mermaidPreviewField)).toBe(preview);
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBe(widget);
    view.destroy();
  });

  it('preserves blockquote prefixes around nested Mermaid previews', async () => {
    const source = 'Intro\n\n> ```mermaid\n> flowchart LR\n> A --> B\n> ```';
    const view = createView(source);
    const widget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');

    expect(widget).not.toBeNull();
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    widget?.click();
    expect(view.state.selection.main.head).toBe(source.indexOf('flowchart LR'));
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('preserves list indentation around nested Mermaid previews', async () => {
    const source = 'Intro\n\n- ```mermaid\n  flowchart LR\n  A --> B\n  ```';
    const view = createView(source);
    const widget = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget');

    expect(widget).not.toBeNull();
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
    });
    widget?.click();
    expect(view.state.selection.main.head).toBe(source.indexOf('flowchart LR'));
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('uses subdued neutral color for Mermaid fence metadata in both themes', () => {
    const view = createView('Before\n```mermaid\nflowchart LR\nA --> B\n```');
    const language = view.dom.querySelector<HTMLElement>('.cm-md-mermaid-language');
    expect(language).not.toBeNull();
    expect(language ? getComputedStyle(language).color : '').toBe('rgb(113, 113, 122)');

    document.documentElement.classList.add('dark');
    expect(language ? getComputedStyle(language).color : '').toBe('rgb(161, 161, 170)');
    document.documentElement.classList.remove('dark');
    view.destroy();
  });

  it('shows a safe error message when Mermaid syntax cannot be rendered', async () => {
    const source = 'Before\n```mermaid\nflowchart LR\nA -->\n```';
    const view = createView(source);
    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-md-mermaid-error')).not.toBeNull();
    });

    expect(view.dom.querySelector('.cm-md-mermaid-error')?.textContent).toContain(
      'Unable to render Mermaid diagram',
    );
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('keeps Mermaid previews independent of the inline viewport refresh', () => {
    const source = 'Before\n\n```mermaid\nflowchart LR\nA --> B\n```\n\nAfter';
    const view = createView(source);
    const body = source.indexOf('flowchart LR');

    const line = view.state.doc.lineAt(body);
    expect(expandPreviewRangeForLivePreview(view, { from: body, to: body + 1 })).toEqual({
      from: line.from,
      to: line.to,
    });
    view.destroy();
  });

  it('does not expand an unclosed Mermaid fence into the rest of the document', () => {
    const source = `Before\n\n\`\`\`mermaid\nflowchart LR\n${'A --> B\n'.repeat(20)}`;
    const view = createView(source);
    expect(forceParsing(view, source.length, 1000)).toBe(true);
    const body = view.state.doc.lineAt(source.indexOf('A --> B'));

    expect(expandPreviewRangeForLivePreview(view, { from: body.from, to: body.to })).toEqual({
      from: body.from,
      to: body.to,
    });
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).toBeNull();
    view.destroy();
  });

  it('previews a long Mermaid fence with one block decoration', () => {
    const source = `Before\n\n\`\`\`mermaid\nflowchart LR\nA --> B\n${'\n'.repeat(401)}\`\`\`\n\nAfter`;
    const view = createView(source);
    expect(forceParsing(view, source.length, 1000)).toBe(true);
    view.dispatch({ selection: { anchor: source.length } });
    expect(view.dom.querySelector('.cm-md-mermaid-widget')).not.toBeNull();
    expect(view.dom.querySelector('.cm-md-mermaid-widget + .cm-line')).not.toBeNull();
    expect(
      view.dom.querySelectorAll(
        '.cm-md-code-block:not(.cm-md-code-block-first):not(.cm-md-code-block-last)',
      ),
    ).toHaveLength(0);
    expect(view.state.field(mermaidPreviewField).decorations.size).toBe(1);
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });
});
