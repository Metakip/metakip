import type { Page } from '@metakip/shared';
import { Share, Star } from 'lucide-react';
import { useState } from 'react';
import { useShareContext } from '../../contexts/ShareContext';
import { useFavorites, useToggleFavorite } from '../../hooks/use-favorites';
import { Tooltip } from '../Tooltip';
import { ShareDialog } from './ShareDialog';

interface PageActionsProps {
  pageId: string;
  page?: Pick<Page, 'icon' | 'id' | 'ownerId' | 'title'> | undefined;
}

export function PageActions({ pageId, page }: PageActionsProps) {
  const { isAnonymous } = useShareContext();
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const { data: favorites } = useFavorites();
  const toggleFavoriteMutation = useToggleFavorite();

  const isFavorite = favorites?.some((f) => f.pageId === pageId) ?? false;

  const handleToggleFavorite = () => {
    toggleFavoriteMutation.mutate({
      pageId,
      ...(page?.title !== undefined ? { title: page.title } : {}),
      icon: page?.icon ?? null,
      ownerId: page?.ownerId ?? null,
      isFavorite,
    });
  };

  if (isAnonymous) return null;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Tooltip label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} position="bottom">
        <button
          type="button"
          onClick={handleToggleFavorite}
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`p-2 rounded-md transition-colors cursor-pointer ${
            isFavorite
              ? 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
              : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Star size={20} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </Tooltip>
      {page && (
        <>
          <Tooltip label="Share" position="bottom">
            <button
              type="button"
              onClick={() => setIsShareDialogOpen(true)}
              aria-label="Share page"
              data-testid="page-share-btn"
              className="p-2 rounded-md transition-colors cursor-pointer text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Share size={20} />
            </button>
          </Tooltip>
          {isShareDialogOpen && (
            <ShareDialog
              entityType="page"
              entityId={page.id}
              title={page.title}
              onClose={() => setIsShareDialogOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
