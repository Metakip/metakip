import * as stylex from '@stylexjs/stylex';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import type { EditorHeading } from '../../editor/codemirror/headings';
import { styles } from './TableOfContents.stylex';

interface HeadingNode extends EditorHeading {
  children?: HeadingNode[];
}

interface TableOfContentsProps {
  headings: readonly EditorHeading[];
  activeHeadingFrom: number | null;
  onHeadingSelect: (heading: EditorHeading) => void;
  onHoverChange?: (isHovered: boolean) => void;
  className?: string;
}

export function TableOfContents({
  headings,
  activeHeadingFrom,
  onHeadingSelect,
  onHoverChange,
  className,
}: TableOfContentsProps) {
  const [isHovered, setIsHovered] = useState(false);
  const headingTree = useMemo(() => {
    const roots: HeadingNode[] = [];
    const stack: HeadingNode[] = [];
    for (const heading of headings) {
      const node: HeadingNode = { ...heading, children: [] };
      while ((stack.at(-1)?.level ?? 0) >= node.level) stack.pop();
      const parent = stack.at(-1);
      if (parent) parent.children?.push(node);
      else roots.push(node);
      stack.push(node);
    }
    return roots;
  }, [headings]);

  const renderHeading = (heading: HeadingNode, depth = 0) => {
    const isActive = activeHeadingFrom === heading.from;
    const hasChildren = heading.children && heading.children.length > 0;

    return (
      <div key={`${heading.id}:${heading.from}`}>
        <button
          type="button"
          onClick={() => onHeadingSelect(heading)}
          {...stylex.props(
            styles.heading,
            isActive ? styles.headingActive : styles.headingIdle,
            depth > 0 && styles.headingNested,
          )}
          style={{
            paddingLeft: `${8 + depth * 12}px`,
          }}
        >
          <span>{heading.text || 'Untitled'}</span>
        </button>
        {hasChildren && heading.children?.map((child) => renderHeading(child, depth + 1))}
      </div>
    );
  };

  const getAllHeadingsFlat = (nodes: HeadingNode[]): HeadingNode[] => {
    const result: HeadingNode[] = [];
    const visit = (heads: HeadingNode[]) => {
      for (const h of heads) {
        result.push(h);
        if (h.children && h.children.length > 0) {
          visit(h.children);
        }
      }
    };
    visit(nodes);
    return result;
  };

  const renderTickMarks = () => {
    const allHeadings = getAllHeadingsFlat(headingTree);
    return allHeadings.map((heading) => {
      const isActive = activeHeadingFrom === heading.from;
      const width = Math.max(12, 24 - heading.level * 3);

      return (
        <button
          type="button"
          key={`${heading.id}:${heading.from}`}
          onClick={() => onHeadingSelect(heading)}
          {...stylex.props(styles.tick, isActive ? styles.tickActive : styles.tickIdle)}
          style={{
            width: `${width}px`,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
          title={heading.text}
        />
      );
    });
  };

  if (headingTree.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Table of contents"
      className={clsx(stylex.props(styles.root).className, className)}
      data-toc-outline=""
      onMouseEnter={() => {
        setIsHovered(true);
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onHoverChange?.(false);
      }}
    >
      <div
        {...stylex.props(
          styles.tickPanel,
          isHovered ? styles.tickPanelHidden : styles.tickPanelVisible,
        )}
        data-toc-tick-panel=""
      >
        <div {...stylex.props(styles.tickList)} data-toc-tick-list="">
          {renderTickMarks()}
        </div>
      </div>

      <div
        {...stylex.props(
          styles.contentPanel,
          isHovered ? styles.contentPanelVisible : styles.contentPanelHidden,
        )}
        data-toc-content-panel=""
      >
        <div {...stylex.props(styles.contentHeading)}>On this page</div>
        <div {...stylex.props(styles.headingList)}>
          {headingTree.map((heading) => renderHeading(heading))}
        </div>
      </div>
    </section>
  );
}
