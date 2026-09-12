import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collaborationCursors } from './collaborationCursors';

type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

type AwarenessChangeHandler = (change: AwarenessChange) => void;
type AwarenessState = Record<string, unknown>;
type Awareness = NonNullable<HocuspocusProvider['awareness']>;

class TestAwareness {
  readonly clientID = 1;
  private readonly states = new Map<number, AwarenessState>();
  private readonly handlers = new Set<AwarenessChangeHandler>();

  getStates(): Map<number, AwarenessState> {
    return this.states;
  }

  setLocalStateField(field: string, value: unknown): void {
    const state = this.states.get(this.clientID) ?? {};
    this.states.set(this.clientID, { ...state, [field]: value });
    for (const handler of this.handlers) {
      handler({ added: [], updated: [this.clientID], removed: [] });
    }
  }

  on(event: 'change', handler: AwarenessChangeHandler): void {
    if (event === 'change') this.handlers.add(handler);
  }

  off(event: 'change', handler: AwarenessChangeHandler): void {
    if (event === 'change') this.handlers.delete(handler);
  }
}

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe('collaboration cursors', () => {
  it('preserves the local cursor while blurred and during editor teardown', () => {
    const ydoc = new Y.Doc();
    const text = ydoc.getText('content');
    text.insert(0, 'Hello');
    const cursor = {
      anchor: Y.createRelativePositionFromTypeIndex(text, 2, -1),
      head: Y.createRelativePositionFromTypeIndex(text, 2, 1),
    };
    const awareness = new TestAwareness();
    awareness.setLocalStateField('cursor', cursor);

    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: text.toString(),
        extensions: collaborationCursors(awareness as unknown as Awareness, text),
      }),
    });
    views.push(view);

    view.dispatch({ selection: { anchor: 3 } });
    expect(awareness.getStates().get(awareness.clientID)?.cursor).toBe(cursor);

    view.destroy();
    expect(awareness.getStates().get(awareness.clientID)?.cursor).toBe(cursor);
    ydoc.destroy();
  });
});
