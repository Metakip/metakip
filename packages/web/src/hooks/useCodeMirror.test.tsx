import { syntaxTree } from '@codemirror/language';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../components/editor/editor.css';
import { deriveActiveStates } from '../components/editor/useEditorActiveStates';
import { type HeadingSyntax, parseEditorHeadingSyntax } from '../editor/codemirror/headingSyntax';
import { useCodeMirror } from './useCodeMirror';

type OutlineRequest = { generation: number; markdown: string };
type OutlineResponse = { generation: number; headings: HeadingSyntax[] };

class TestOutlineWorker {
  static instances: TestOutlineWorker[] = [];
  readonly requests: OutlineRequest[] = [];
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent<OutlineResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    TestOutlineWorker.instances.push(this);
  }

  postMessage(message: OutlineRequest): void {
    this.requests.push(message);
  }

  respond(index: number): void {
    const request = this.requests[index];
    if (!request) throw new Error('Missing outline request');
    this.onmessage?.({
      data: {
        generation: request.generation,
        headings: parseEditorHeadingSyntax(request.markdown),
      },
    } as MessageEvent<OutlineResponse>);
  }
}

afterEach(() => {
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
  TestOutlineWorker.instances = [];
});

describe('CodeMirror code-block formatting state', () => {
  it('treats highlighted Markdown inside a code fence as code, not document formatting', async () => {
    const source = '# Real heading\n\n```markdown\n# Example heading\n- Example list\n```';
    const parent = document.body.appendChild(document.createElement('div'));
    const hook = renderHook(() =>
      useCodeMirror({ initialValue: source, commentAnchors: [], readOnly: true }),
    );

    act(() => hook.result.current.setContainer(parent));
    await waitFor(() => {
      const view = hook.result.current.editor;
      expect(view).not.toBeNull();
      if (!view) return;
      expect(syntaxTree(view.state).resolveInner(source.indexOf('Example heading'), 1).name).toBe(
        'ATXHeading1',
      );
    });

    const view = hook.result.current.editor;
    if (!view) throw new Error('Editor did not initialize');
    act(() => view.dispatch({ selection: { anchor: source.indexOf('Real heading') } }));
    expect(deriveActiveStates(view.state).isH1Active).toBe(true);

    act(() => view.dispatch({ selection: { anchor: source.indexOf('Example heading') } }));
    expect(deriveActiveStates(view.state).isCodeActive).toBe(true);
    expect(deriveActiveStates(view.state).isH1Active).toBe(false);

    act(() => view.dispatch({ selection: { anchor: source.indexOf('Example list') } }));
    expect(deriveActiveStates(view.state).isCodeActive).toBe(true);
    expect(deriveActiveStates(view.state).isBulletListActive).toBe(false);

    hook.unmount();
    parent.remove();
  });
});

describe('CodeMirror outline parsing', () => {
  it('syntax-highlights language-aware fenced code blocks', async () => {
    const parent = document.body.appendChild(document.createElement('div'));
    parent.className = 'codemirror-editor';
    const hook = renderHook(() =>
      useCodeMirror({
        initialValue: '```ts\nconst answer = 42;\n```',
        commentAnchors: [],
        readOnly: true,
      }),
    );

    act(() => hook.result.current.setContainer(parent));
    await waitFor(() => {
      const tokens = Array.from(parent.querySelectorAll<HTMLElement>('.cm-line span'));
      const keyword = tokens.find((token) => token.textContent === 'const');
      const variable = tokens.find((token) => token.textContent === 'answer');

      expect(keyword).toBeDefined();
      expect(variable).toBeDefined();
      if (!keyword || !variable) return;

      expect(keyword.className).not.toBe(variable.className);
      expect(getComputedStyle(keyword).color).toBe('var(--cm-syntax-keyword)');
      expect(getComputedStyle(variable).color).toBe('var(--cm-syntax-definition)');
    });

    expect(getComputedStyle(parent).getPropertyValue('--cm-syntax-keyword').trim()).toBe('#708');
    expect(getComputedStyle(parent).getPropertyValue('--cm-syntax-definition').trim()).toBe('#00f');
    document.documentElement.classList.add('dark');
    expect(getComputedStyle(parent).getPropertyValue('--cm-syntax-keyword').trim()).toBe('#ff7b72');
    expect(getComputedStyle(parent).getPropertyValue('--cm-syntax-definition').trim()).toBe(
      '#d2a8ff',
    );

    hook.unmount();
    parent.remove();
  });

  it('ignores stale worker results and re-resolves wiki titles without reparsing', async () => {
    vi.stubGlobal('Worker', TestOutlineWorker);
    const parent = document.body.appendChild(document.createElement('div'));
    const onOutlineChange = vi.fn();
    const onDocumentChange = vi.fn();
    let title = 'Initial title';
    const resolveHeadingWikiLink = () => title;
    const hook = renderHook(() =>
      useCodeMirror({
        initialValue: '# [[Project]]',
        commentAnchors: [],
        onOutlineChange,
        onDocumentChange,
        resolveHeadingWikiLink,
      }),
    );

    act(() => hook.result.current.setContainer(parent));
    const worker = TestOutlineWorker.instances[0];
    expect(worker).toBeDefined();
    await waitFor(() => expect(worker?.requests).toHaveLength(1));
    act(() => hook.result.current.editor?.dispatch({ changes: { from: 0, insert: 'Before\n' } }));
    expect(onDocumentChange).toHaveBeenCalledWith(hook.result.current.editor);
    await waitFor(() => expect(worker?.requests).toHaveLength(2));

    act(() => worker?.respond(0));
    expect(onOutlineChange).not.toHaveBeenCalledWith(
      [{ id: 'initial-title', text: 'Initial title', level: 1, from: 0 }],
      expect.any(Number),
    );
    act(() => worker?.respond(1));
    expect(onOutlineChange).toHaveBeenLastCalledWith(
      [{ id: 'initial-title', text: 'Initial title', level: 1, from: 7 }],
      7,
    );

    title = 'Renamed';
    act(() => hook.result.current.refreshHeadingResolver());
    expect(onOutlineChange).toHaveBeenLastCalledWith(
      [{ id: 'renamed', text: 'Renamed', level: 1, from: 7 }],
      7,
    );
    expect(worker?.requests).toHaveLength(2);

    hook.unmount();
    expect(worker?.terminate).toHaveBeenCalledOnce();
    parent.remove();
  });
});
