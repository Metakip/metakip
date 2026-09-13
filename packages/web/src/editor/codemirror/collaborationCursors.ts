import type { Extension, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { getContrastColor } from '@metakip/shared';
import * as Y from 'yjs';
import { getInitial } from '../../utils/avatar';

type Awareness = NonNullable<HocuspocusProvider['awareness']>;

type Collaborator = {
  name: string;
  color: string;
  avatar?: string;
  emoji?: string;
};

type CursorState = {
  anchor: unknown;
  head: unknown;
};

function collaboratorFromState(state: unknown): Collaborator | null {
  if (!state || typeof state !== 'object') return null;
  const user = (state as Record<string, unknown>).user;
  if (!user || typeof user !== 'object') return null;
  const record = user as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.color !== 'string') return null;
  return {
    name: record.name,
    color: record.color,
    ...(typeof record.avatar === 'string' ? { avatar: record.avatar } : {}),
    ...(typeof record.emoji === 'string' ? { emoji: record.emoji } : {}),
  };
}

function cursorFromState(state: unknown): CursorState | null {
  if (!state || typeof state !== 'object') return null;
  const cursor = (state as Record<string, unknown>).cursor;
  if (!cursor || typeof cursor !== 'object') return null;
  const record = cursor as Record<string, unknown>;
  if (!record.anchor || !record.head) return null;
  return { anchor: record.anchor, head: record.head };
}

function resolveRemotePosition(position: unknown, document: Y.Doc): Y.AbsolutePosition | null {
  if (!position || typeof position !== 'object') return null;
  try {
    return Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(position),
      document,
      false,
    );
  } catch {
    return null;
  }
}

class RemoteCursorWidget extends WidgetType {
  constructor(readonly collaborator: Collaborator) {
    super();
  }

  eq(other: RemoteCursorWidget): boolean {
    return (
      other.collaborator.name === this.collaborator.name &&
      other.collaborator.color === this.collaborator.color &&
      other.collaborator.avatar === this.collaborator.avatar &&
      other.collaborator.emoji === this.collaborator.emoji
    );
  }

  toDOM(): HTMLElement {
    const cursor = document.createElement('span');
    cursor.className = 'cm-collab-cursor';
    cursor.style.borderColor = this.collaborator.color;

    const hitArea = document.createElement('span');
    hitArea.className = 'cm-collab-cursor-hitarea';
    hitArea.setAttribute('aria-hidden', 'true');
    cursor.appendChild(hitArea);

    const pill = document.createElement('span');
    pill.className = 'cm-collab-cursor-pill';
    pill.style.backgroundColor = this.collaborator.color;
    pill.style.color = getContrastColor(this.collaborator.color);
    if (this.collaborator.avatar) {
      const image = document.createElement('img');
      image.src = this.collaborator.avatar;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      pill.appendChild(image);
    } else {
      const identity = document.createElement('span');
      identity.className = 'cm-collab-cursor-identity';
      identity.textContent = this.collaborator.emoji || getInitial(this.collaborator.name);
      pill.appendChild(identity);
    }
    const name = document.createElement('span');
    name.textContent = this.collaborator.name;
    pill.appendChild(name);
    cursor.appendChild(pill);
    return cursor;
  }
}

function remoteDecorations(view: EditorView, awareness: Awareness, text: Y.Text): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const collaborator = collaboratorFromState(state);
    const cursor = cursorFromState(state);
    if (!collaborator || !cursor || !text.doc) continue;
    const absoluteAnchor = resolveRemotePosition(cursor.anchor, text.doc);
    const absoluteHead = resolveRemotePosition(cursor.head, text.doc);
    if (
      !absoluteAnchor ||
      !absoluteHead ||
      absoluteAnchor.type !== text ||
      absoluteHead.type !== text
    ) {
      continue;
    }
    const anchor = Math.max(0, Math.min(view.state.doc.length, absoluteAnchor.index));
    const head = Math.max(0, Math.min(view.state.doc.length, absoluteHead.index));
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    if (from < to) {
      ranges.push(
        Decoration.mark({
          class: 'cm-collab-selection',
          attributes: {
            style: `background-color: color-mix(in srgb, ${collaborator.color} 24%, transparent)`,
          },
        }).range(from, to),
      );
    }
    ranges.push(
      Decoration.widget({ widget: new RemoteCursorWidget(collaborator), side: 1 }).range(head),
    );
  }
  return Decoration.set(ranges, true);
}

export function collaborationCursors(awareness: Awareness, text: Y.Text): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        this.decorations = remoteDecorations(view, awareness, text);
        awareness.on('change', this.handleAwarenessChange);
        this.publishSelection();
      }

      private readonly handleAwarenessChange = (changes: {
        added: number[];
        updated: number[];
        removed: number[];
      }): void => {
        if (
          [...changes.added, ...changes.updated, ...changes.removed].every(
            (clientId) => clientId === awareness.clientID,
          )
        ) {
          return;
        }
        this.view.dispatch({});
      };

      private publishSelection(): void {
        // Preserve the last cursor while the editor is blurred. Clearing it
        // here makes remote collaborators see a cursor flash and then
        // disappear as soon as the author switches tabs or focuses another
        // control.
        if (!this.view.hasFocus || !this.view.dom.ownerDocument.hasFocus()) return;
        const selection = this.view.state.selection.main;
        awareness.setLocalStateField('cursor', {
          anchor: Y.createRelativePositionFromTypeIndex(text, selection.anchor, -1),
          head: Y.createRelativePositionFromTypeIndex(text, selection.head, 1),
        });
      }

      update(update: ViewUpdate): void {
        this.decorations = remoteDecorations(update.view, awareness, text);
        if (update.selectionSet || update.docChanged || update.focusChanged)
          this.publishSelection();
      }

      destroy(): void {
        awareness.off('change', this.handleAwarenessChange);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
