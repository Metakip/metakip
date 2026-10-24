import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { type Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import '../../components/editor/editor.css';
import { resolveCodeFenceLanguage } from './codeLanguages';
import { editorHighlightStyle } from './highlightStyle';
import { livePreview } from './livePreview';
import { mathMarkdownExtension, wikiLinkMarkdownExtension } from './markdownSyntax';

export function createView(doc: string, readOnly = false, mode?: Compartment): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  parent.className = 'codemirror-editor';
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        syntaxHighlighting(editorHighlightStyle, { fallback: true }),
        markdown({
          extensions: [GFM, wikiLinkMarkdownExtension, mathMarkdownExtension],
          codeLanguages: resolveCodeFenceLanguage,
          completeHTMLTags: false,
          pasteURLAsLink: false,
        }),
        livePreview(),
        mode ? mode.of(EditorState.readOnly.of(readOnly)) : EditorState.readOnly.of(readOnly),
      ],
    }),
  });
}
