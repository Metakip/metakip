import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const editorTypographyStyles = [
  { tag: tags.heading, fontWeight: 'bold', textDecoration: 'none' },
  { tag: tags.link, textDecoration: 'none' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
];

const themeAwareTokenStyles = [
  { tag: tags.meta, color: 'var(--cm-syntax-meta)' },
  { tag: tags.keyword, color: 'var(--cm-syntax-keyword)' },
  {
    tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
    color: 'var(--cm-syntax-atom)',
  },
  { tag: [tags.literal, tags.inserted], color: 'var(--cm-syntax-literal)' },
  { tag: [tags.string, tags.deleted], color: 'var(--cm-syntax-string)' },
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string)],
    color: 'var(--cm-syntax-regexp)',
  },
  { tag: tags.definition(tags.variableName), color: 'var(--cm-syntax-definition)' },
  { tag: tags.local(tags.variableName), color: 'var(--cm-syntax-local)' },
  { tag: [tags.typeName, tags.namespace], color: 'var(--cm-syntax-type)' },
  { tag: tags.className, color: 'var(--cm-syntax-class)' },
  {
    tag: [tags.special(tags.variableName), tags.macroName],
    color: 'var(--cm-syntax-special)',
  },
  { tag: tags.definition(tags.propertyName), color: 'var(--cm-syntax-property)' },
  { tag: tags.comment, color: 'var(--cm-syntax-comment)' },
  { tag: tags.invalid, color: 'var(--cm-syntax-invalid)' },
];

export const editorHighlightStyle = HighlightStyle.define([
  ...editorTypographyStyles,
  ...themeAwareTokenStyles,
  // Only exposed destinations use link blue; editable labels keep the normal text color.
  { tag: tags.url, class: 'cm-md-link-source' },
]);
