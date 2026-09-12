import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { mathMarkdownExtension, wikiLinkMarkdownExtension } from './markdownSyntax';
import { getEditorSuggestionTrigger } from './suggestionTriggers';

function stateAt(doc: string, position = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(position),
    extensions: [markdown({ extensions: [GFM, wikiLinkMarkdownExtension, mathMarkdownExtension] })],
  });
}

describe('editor suggestion triggers', () => {
  it('recognizes wiki-link and slash-command triggers in prose', () => {
    expect(getEditorSuggestionTrigger(stateAt('See [[Road'))).toEqual({
      kind: 'wiki-link',
      query: 'Road',
      from: 4,
      to: 10,
    });
    expect(getEditorSuggestionTrigger(stateAt('Start /hea'))).toEqual({
      kind: 'slash-command',
      query: 'hea',
      from: 6,
      to: 10,
    });
  });

  it('does not trigger suggestions inside inline code', () => {
    expect(getEditorSuggestionTrigger(stateAt('`[[Road`', 7))).toBeNull();
    expect(getEditorSuggestionTrigger(stateAt('`/heading`', 9))).toBeNull();
  });

  it('does not trigger suggestions inside fenced code', () => {
    expect(getEditorSuggestionTrigger(stateAt('```md\n[['))).toBeNull();
    expect(getEditorSuggestionTrigger(stateAt('```md\n/heading'))).toBeNull();
  });

  it('treats embeds and escaped brackets as plain Markdown', () => {
    expect(getEditorSuggestionTrigger(stateAt('See ![[Road'))).toBeNull();
    expect(getEditorSuggestionTrigger(stateAt('See \\[[Road'))).toBeNull();
  });
});
