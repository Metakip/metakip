import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollEdgeContinuity } from './scrollEdgeContinuity';

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views.length = 0;
  document.body.replaceChildren();
});

function createScrollView() {
  const pane = document.body.appendChild(document.createElement('div'));
  let height = 1000;
  Object.defineProperties(pane, {
    clientHeight: { get: () => 600 },
    scrollHeight: { get: () => height },
  });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    pane.scrollTop = Math.min(height - 600, options.top ?? 0);
  });
  Object.defineProperty(pane, 'scrollTo', { value: scrollTo });
  const view = new EditorView({
    parent: pane,
    state: EditorState.create({ doc: 'first\nlast', extensions: [scrollEdgeContinuity] }),
  });
  views.push(view);
  return {
    pane,
    view,
    scrollTo,
    grow: () => {
      height += 200;
      view.dispatch({ changes: { from: 0, insert: 'more\n'.repeat(20) } });
    },
  };
}

describe('outer scroll edge continuity', () => {
  it('follows a reached bottom as estimated editor height grows', async () => {
    const { pane, scrollTo, grow } = createScrollView();
    pane.scrollTop = 400;
    pane.dispatchEvent(new Event('scroll'));
    grow();
    await vi.waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'instant' }),
    );
    expect(pane.scrollTop).toBe(600);
  });

  it('retains endpoint intent for delayed layout changes', async () => {
    const { pane, scrollTo, grow } = createScrollView();
    pane.scrollTop = 400;
    pane.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 800));
    grow();
    await vi.waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'instant' }),
    );
    expect(pane.scrollTop).toBe(600);
  });

  it('does not drag an intentional upward scroll back to the bottom', async () => {
    const { pane, scrollTo, grow } = createScrollView();
    pane.scrollTop = 400;
    pane.dispatchEvent(new Event('scroll'));
    pane.scrollTop = 300;
    pane.dispatchEvent(new Event('scroll'));
    grow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(pane.scrollTop).toBe(300);
  });

  it('leaves scroll anchoring to CodeMirror while the editor is focused', async () => {
    const { pane, view, scrollTo, grow } = createScrollView();
    view.focus();
    pane.scrollTop = 400;
    pane.dispatchEvent(new Event('scroll'));
    grow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not follow when scrolling stops short of the endpoint', async () => {
    const { pane, scrollTo, grow } = createScrollView();
    pane.scrollTop = 350;
    pane.dispatchEvent(new Event('scroll'));
    grow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(pane.scrollTop).toBe(350);
  });

  it('keeps the top visible when a height correction shifts the outer scroller', async () => {
    const { pane, scrollTo, grow } = createScrollView();
    pane.scrollTop = 200;
    pane.dispatchEvent(new Event('scroll'));
    pane.scrollTop = 0;
    pane.dispatchEvent(new Event('scroll'));
    pane.scrollTop = 80;
    grow();
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' }));
    expect(pane.scrollTop).toBe(0);
  });
});
