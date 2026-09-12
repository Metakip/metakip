import { defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const editorHighlightStyle = HighlightStyle.define([
  ...defaultHighlightStyle.specs,
  // Heading size and weight come from the live-preview line styles, not an underline.
  { tag: tags.heading, textDecoration: 'none' },
  // Only exposed destinations use link blue; editable labels keep the normal text color.
  { tag: tags.url, class: 'cm-md-link-source' },
]);
