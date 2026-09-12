import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  refreshWikiLinkPresentations,
  registerWikiLinkPresentationResolver,
} from '../wikiLinkPresentations';
import { livePreview } from './livePreview';
import type { LivePreviewOptions } from './livePreviewTypes';
import { wikiLinkMarkdownExtension } from './markdownSyntax';

const cleanups: Array<() => void> = [];
function createView(doc: string, options: LivePreviewOptions = {}, readOnly = false): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM, wikiLinkMarkdownExtension] }),
        livePreview(options),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  cleanups.push(() => {
    view.destroy();
    parent.remove();
  });
  return view;
}

function click(element: Element, options: MouseEventInit = {}) {
  const down = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...options,
  });
  element.dispatchEvent(down);
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }),
  );
  return down;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('external links', () => {
  it('opens a normally clicked formatted link without moving the caret into its source', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = createView('Before [**Label**](https://example.com) after');
    const label = view.dom.querySelector('.cm-md-strong');
    expect(label).not.toBeNull();
    if (label) expect(click(label).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(view.state.selection.main.head).toBe(0);
    expect(view.dom.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(view.dom.textContent).not.toContain('https://example.com');
  });

  it('does not give Alt-click a separate editing behavior', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const source = 'Before [Label](https://example.com) after';
    const view = createView(source);
    const link = view.dom.querySelector('a');
    if (link) click(link, { altKey: true });
    expect(open).toHaveBeenCalledOnce();
    expect(view.state.selection.main.head).toBe(0);
    expect(view.dom.textContent).not.toContain('[Label](https://example.com)');
  });

  it('uses Enter to open, including with Alt held', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = createView('Before [Label](https://example.com) after');
    const link = view.dom.querySelector('a');
    link?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(open).toHaveBeenCalledOnce();
    link?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }),
    );
    expect(open).toHaveBeenCalledTimes(2);
    expect(view.dom.textContent).not.toContain('[Label](https://example.com)');
  });

  it('does not navigate on Shift-click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = createView('Before [Label](https://example.com) after');
    view.dom
      .querySelector('a')
      ?.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true, cancelable: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it('opens in read-only mode without enabling source editing', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = createView('Before [Label](https://example.com) after', {}, true);
    const link = view.dom.querySelector('a');
    if (link) click(link, { altKey: true });
    expect(open).toHaveBeenCalledOnce();
    expect(view.state.selection.main.head).toBe(0);
  });

  it.each([
    [
      '<https://example.com/?email=user@example.com>',
      'https://example.com/?email=user@example.com',
    ],
    ['https://example.com/?email=user@example.com', 'https://example.com/?email=user@example.com'],
    ['<user@example.com>', 'mailto:user@example.com'],
  ])('opens the correct destination for %s', (source, href) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = createView(`Before ${source} after`);
    const link = view.dom.querySelector('a');
    expect(link?.getAttribute('href')).toBe(href);
    if (link) click(link);
    expect(open).toHaveBeenCalledExactlyOnceWith(href, '_blank', 'noopener,noreferrer');
  });

  it('does not make executable destinations navigable', () => {
    const view = createView('Before [bad](javascript:alert(1)) after');
    expect(view.dom.querySelector('a')).toBeNull();
  });
});

describe('wiki links', () => {
  async function wikiView(
    readOnly = false,
    source = 'Before [[Target#Details | Friendly label]] after',
  ) {
    const navigate = vi.fn();
    const view = createView(source, { onWikiLinkClick: navigate }, readOnly);
    cleanups.push(
      registerWikiLinkPresentationResolver(view, async (requests) =>
        requests.map(({ key }) => ({
          key,
          state: 'accessible' as const,
          target: { id: 'target-id', title: 'Target' },
        })),
      ),
    );
    await vi.waitFor(() =>
      expect(view.dom.querySelector('.cm-md-wiki-link')?.textContent).toBe('Friendly label'),
    );
    const link = view.dom.querySelector('.cm-md-wiki-link');
    if (!link) throw new Error('Missing wiki link');
    return { view, link, navigate };
  }

  it('navigates on an ordinary click, preserving the resolved page and heading', async () => {
    const { view, link, navigate } = await wikiView();
    expect(click(link).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      id: 'target-id',
      title: 'Target',
      heading: 'Details',
    });
    expect(view.state.selection.main.head).toBe(0);
    expect(view.dom.textContent).not.toContain('[[');
  });

  it('supports keyboard activation without an Alt-click editing gesture', async () => {
    const { view, link, navigate } = await wikiView();
    expect(link.getAttribute('tabindex')).toBe('0');
    link.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(navigate).toHaveBeenCalledOnce();
    click(link, { altKey: true });
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(view.dom.textContent).not.toContain('[[');
  });

  it('still opens in read-only mode', async () => {
    const { view, link, navigate } = await wikiView(true);
    click(link);
    expect(navigate).toHaveBeenCalledOnce();
    expect(view.state.selection.main.head).toBe(0);
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(document.querySelector('.link-hover-tooltip')).toBeNull();
  });

  it.each([
    'Before [[Target#Details | Friendly label]] after',
    'Before [[id:12345678-1234-1234-1234-123456789abc#Details|Friendly label]] after',
  ])('does not show a hover editor for %s', async (source) => {
    const { view, link, navigate } = await wikiView(false, source);
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(document.querySelector('.link-hover-tooltip, .link-editor-popup')).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
    click(link);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('clears the old destination when a previously accessible page becomes restricted', async () => {
    const { view, link, navigate } = await wikiView();
    cleanups.push(
      registerWikiLinkPresentationResolver(view, async (requests) =>
        requests.map(({ key }) => ({ key, state: 'restricted' as const })),
      ),
    );
    refreshWikiLinkPresentations(view);
    await vi.waitFor(() => expect(link.textContent).toBe('Restricted page'));
    click(link);
    expect(navigate).not.toHaveBeenCalled();
    expect(link.hasAttribute('role')).toBe(false);
    expect(link.hasAttribute('tabindex')).toBe(false);
  });
});
