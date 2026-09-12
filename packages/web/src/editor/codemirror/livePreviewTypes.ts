import type { EditorState } from '@codemirror/state';
import type { WikiLinkNavigationTarget, WikiLinkReference } from '../wikiLinkPresentations';
import type { HeadingWikiLinkResolver } from './headings';

export type LivePreviewOptions = {
  onWikiLinkClick?: ((target: WikiLinkNavigationTarget) => void) | undefined;
  onWikiLinkResolved?: ((reference: WikiLinkReference, title: string) => void) | undefined;
  resolveHeadingWikiLink?: HeadingWikiLinkResolver;
};

export type PreviewTreeNode = {
  name: string;
  from: number;
  to: number;
  parent: PreviewTreeNode | null;
  firstChild: PreviewTreeNode | null;
  nextSibling: PreviewTreeNode | null;
  prevSibling: PreviewTreeNode | null;
};

export type PreviewNodeRef = {
  name: string;
  from: number;
  to: number;
  node: PreviewTreeNode;
};

export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) =>
    range.empty ? range.head >= from && range.head < to : range.from < to && range.to > from,
  );
}
