import type { Folder, Page } from '@metakip/shared';
import { ChevronRight, Home } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buildFolderPath, buildPagePath, getWorkspacePath } from '../../utils/url';

interface BreadcrumbsProps {
  pages: Pick<Page, 'id' | 'parentId' | 'title'>[];
  folders: Pick<Folder, 'id' | 'name' | 'parentId'>[];
  currentPageId: string;
}

interface BreadcrumbItem {
  id: string;
  title: string;
  isFolder: boolean;
}

export function Breadcrumbs({ pages, folders, currentPageId }: BreadcrumbsProps) {
  const breadcrumbPath = useMemo(() => {
    if (!currentPageId) {
      return [] as BreadcrumbItem[];
    }

    // Build maps for both pages and folders
    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const folderMap = new Map(folders.map((f) => [f.id, f]));

    const path: BreadcrumbItem[] = [];
    const visited = new Set<string>();
    let cursorId: string | null | undefined = currentPageId;

    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);

      // Check if it's a page
      const page = pageMap.get(cursorId);
      if (page) {
        path.unshift({
          id: page.id,
          title: page.title,
          isFolder: false,
        });
        cursorId = page.parentId;
        continue;
      }

      // Check if it's a folder
      const folder = folderMap.get(cursorId);
      if (folder) {
        path.unshift({
          id: folder.id,
          title: folder.name,
          isFolder: true,
        });
        cursorId = folder.parentId;
        continue;
      }

      // Not found, stop
      break;
    }

    return path;
  }, [currentPageId, pages, folders]);

  return (
    <div className="flex items-center gap-1 text-sm font-medium text-zinc-500 dark:text-zinc-400 overflow-x-auto whitespace-nowrap scrollbar-none">
      <Link
        to={getWorkspacePath()}
        className="flex items-center hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 shrink-0"
      >
        <Home size={16} aria-label="Home" />
      </Link>
      {breadcrumbPath.length > 0 &&
        breadcrumbPath.map((item, index) => {
          const isLast = index === breadcrumbPath.length - 1;
          return (
            <React.Fragment key={item.id}>
              <ChevronRight size={14} className="text-zinc-300 dark:text-zinc-600 shrink-0" />
              {isLast ? (
                <span className="text-zinc-900 dark:text-zinc-100 px-1.5 py-0.5">
                  {item.title || 'Untitled'}
                </span>
              ) : item.isFolder ? (
                <Link
                  to={buildFolderPath(item.title, item.id)}
                  className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                >
                  {item.title}
                </Link>
              ) : (
                <Link
                  to={buildPagePath(item.title, item.id)}
                  className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                >
                  {item.title || 'Untitled'}
                </Link>
              )}
            </React.Fragment>
          );
        })}
    </div>
  );
}
