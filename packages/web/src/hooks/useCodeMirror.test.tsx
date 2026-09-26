import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  vi.unstubAllGlobals();
  TestOutlineWorker.instances = [];
});

describe('CodeMirror outline parsing', () => {
  it('ignores stale worker results and re-resolves wiki titles without reparsing', async () => {
    vi.stubGlobal('Worker', TestOutlineWorker);
    const parent = document.body.appendChild(document.createElement('div'));
    const onOutlineChange = vi.fn();
    let title = 'Initial title';
    const resolveHeadingWikiLink = () => title;
    const hook = renderHook(() =>
      useCodeMirror({
        initialValue: '# [[Project]]',
        onOutlineChange,
        resolveHeadingWikiLink,
      }),
    );

    act(() => hook.result.current.setContainer(parent));
    const worker = TestOutlineWorker.instances[0];
    expect(worker).toBeDefined();
    await waitFor(() => expect(worker?.requests).toHaveLength(1));
    act(() => hook.result.current.editor?.dispatch({ changes: { from: 0, insert: 'Before\n' } }));
    await waitFor(() => expect(worker?.requests).toHaveLength(2));

    act(() => worker?.respond(0));
    expect(onOutlineChange).not.toHaveBeenCalledWith(
      [{ id: 'initial-title', text: 'Initial title', level: 1, from: 0 }],
      expect.any(String),
    );
    act(() => worker?.respond(1));
    expect(onOutlineChange).toHaveBeenLastCalledWith(
      [{ id: 'initial-title', text: 'Initial title', level: 1, from: 7 }],
      'initial-title',
    );

    title = 'Renamed';
    act(() => hook.result.current.refreshHeadingResolver());
    expect(onOutlineChange).toHaveBeenLastCalledWith(
      [{ id: 'renamed', text: 'Renamed', level: 1, from: 7 }],
      'renamed',
    );
    expect(worker?.requests).toHaveLength(2);

    hook.unmount();
    expect(worker?.terminate).toHaveBeenCalledOnce();
    parent.remove();
  });
});
