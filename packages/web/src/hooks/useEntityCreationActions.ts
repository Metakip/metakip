import type { Folder, Page } from '@metakip/shared';
import { useCallback } from 'react';
import { useIdentityLifecycle, useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { buildPagePath } from '../utils/url';
import { useCreateFolder } from './use-folders';
import { useCreatePage } from './use-pages';

type CreatePageOptions = {
  parentId?: string;
  title?: string;
  silent?: boolean;
};

type CreateFolderOptions = {
  parentId?: string;
  name?: string;
};

export function useEntityCreationActions() {
  const identityLifecycle = useIdentityLifecycle();
  const navigate = useIdentityNavigate();
  const createPageMutation = useCreatePage();
  const createFolderMutation = useCreateFolder();
  const createPage = createPageMutation.mutateAsync;
  const createFolderMutationAsync = createFolderMutation.mutateAsync;

  const createPageAndNavigate = useCallback(
    async (options: CreatePageOptions = {}): Promise<Page | undefined> => {
      const page = await createPage(options);
      if (!identityLifecycle.isActive()) return undefined;
      navigate(buildPagePath(page.title, page.id));
      return page;
    },
    [createPage, identityLifecycle, navigate],
  );

  const createFolder = useCallback(
    async (options: CreateFolderOptions = {}): Promise<Folder | undefined> => {
      const folder = await createFolderMutationAsync(options);
      return identityLifecycle.isActive() ? folder : undefined;
    },
    [createFolderMutationAsync, identityLifecycle],
  );

  return {
    createPageAndNavigate,
    createFolder,
    isCreatingPage: createPageMutation.isPending,
    isCreatingFolder: createFolderMutation.isPending,
  };
}
