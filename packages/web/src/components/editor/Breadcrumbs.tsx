import type { Folder, Page } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Home } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buildFolderPath, buildPagePath, getWorkspacePath } from '../../utils/url';
import { styles } from './Breadcrumbs.stylex';

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
    <div {...stylex.props(styles.root)}>
      <Link to={getWorkspacePath()} {...stylex.props(styles.item, styles.home, styles.link)}>
        <Home size={16} aria-label="Home" />
      </Link>
      {breadcrumbPath.length > 0 &&
        breadcrumbPath.map((item, index) => {
          const isLast = index === breadcrumbPath.length - 1;
          return (
            <React.Fragment key={item.id}>
              <ChevronRight size={16} {...stylex.props(styles.separator)} />
              {isLast ? (
                <span {...stylex.props(styles.item, styles.current)}>
                  {item.title || 'Untitled'}
                </span>
              ) : item.isFolder ? (
                <Link
                  to={buildFolderPath(item.title, item.id)}
                  {...stylex.props(styles.item, styles.link)}
                >
                  {item.title}
                </Link>
              ) : (
                <Link
                  to={buildPagePath(item.title, item.id)}
                  {...stylex.props(styles.item, styles.link)}
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
