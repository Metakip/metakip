import clsx from 'clsx';
import { useMemo, useState } from 'react';
import type { EditorHeading } from '../../editor/codemirror/headings';

interface HeadingNode extends EditorHeading {
  children?: HeadingNode[];
}

interface TableOfContentsProps {
  headings: readonly EditorHeading[];
  activeHeadingId: string;
  onHeadingSelect: (heading: EditorHeading) => void;
}

export function TableOfContents({
  headings,
  activeHeadingId,
  onHeadingSelect,
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
    const isActive = activeHeadingId === heading.id;
    const hasChildren = heading.children && heading.children.length > 0;

    return (
      <div key={`${heading.id}:${heading.from}`}>
        <button
          type="button"
          onClick={() => onHeadingSelect(heading)}
          className={clsx(
            'w-full text-left py-1.5 px-2 rounded-md transition-all duration-200',
            'text-sm truncate',
            isActive
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100',
            depth > 0 && 'ml-2',
          )}
          style={{
            paddingLeft: `${8 + depth * 12}px`,
          }}
        >
          <span className="text-sm">{heading.text || 'Untitled'}</span>
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
      const isActive = activeHeadingId === heading.id;
      const width = Math.max(12, 24 - heading.level * 3);

      return (
        <button
          type="button"
          key={`${heading.id}:${heading.from}`}
          onClick={() => onHeadingSelect(heading)}
          className={clsx(
            'w-full h-[2px] rounded-full transition-all duration-300 mb-1.5',
            isActive
              ? 'bg-zinc-900 dark:bg-zinc-100'
              : 'bg-zinc-400 dark:bg-zinc-600 hover:bg-zinc-600 dark:hover:bg-zinc-400',
          )}
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
      className={clsx(
        'fixed right-2 top-1/2 -translate-y-1/2 z-30',
        'transition-all duration-300 ease-out',
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={clsx(
          'flex flex-col items-center py-4 px-2 rounded-l-xl',
          'bg-transparent backdrop-blur-xl',
          'border border-transparent',
          'shadow-lg',
          'transition-all duration-300 ease-out',
          isHovered ? 'opacity-0 translate-x-2 pointer-events-none' : 'opacity-100 translate-x-0',
        )}
      >
        <div className="flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderTickMarks()}
        </div>
      </div>

      <div
        className={clsx(
          'absolute right-0 top-1/2 min-w-[220px] max-w-[280px] -translate-y-1/2',
          'bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl',
          'border border-zinc-200/60 dark:border-zinc-700/50',
          'shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)]',
          'rounded-xl p-3',
          'transition-all duration-300 ease-out',
          'max-h-[70vh] overflow-y-auto',
          !isHovered
            ? 'opacity-0 translate-x-4 pointer-events-none scale-95'
            : 'opacity-100 translate-x-0 scale-100',
        )}
      >
        <div className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-2">
          On this page
        </div>
        <div className="space-y-0.5">{headingTree.map((heading) => renderHeading(heading))}</div>
      </div>
    </section>
  );
}
