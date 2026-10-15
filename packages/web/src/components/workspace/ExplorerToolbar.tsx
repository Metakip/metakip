import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { ExplorerViewMode } from '../../hooks/useExplorerViewMode';
import { buildFolderPath } from '../../utils/url';
import { AppShellToolbar } from '../AppShellToolbar';
import { KebabMenu, type KebabMenuItem } from '../ui/KebabMenu';

type BreadcrumbFolder = { id: string; name: string };
type ExplorerFilter = {
  label: string;
  options: readonly { label: string; selected: boolean; onSelect: () => void }[];
};

type ExplorerToolbarProps = {
  breadcrumbs: readonly BreadcrumbFolder[];
  homeHref?: string;
  filter?: ExplorerFilter;
  viewMode: ExplorerViewMode;
  onViewModeChange: (mode: ExplorerViewMode) => void;
  canCreate: boolean;
  onCreatePage: () => void | Promise<void>;
  onCreateFolder: () => void | Promise<void>;
};

const VIEW_OPTIONS = [
  { mode: 'card', label: 'Card view', Icon: LayoutGrid },
  { mode: 'list', label: 'List view', Icon: List },
] as const;

export function ExplorerToolbar({
  breadcrumbs,
  homeHref,
  filter,
  viewMode,
  onViewModeChange,
  canCreate,
  onCreatePage,
  onCreateFolder,
}: ExplorerToolbarProps) {
  const home = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
        <Home size={16} />
      </span>
      <span className="font-medium">Home</span>
    </>
  );

  const filterItems: KebabMenuItem[] =
    filter?.options.map((option) => ({
      label: option.label,
      onClick: option.onSelect,
      className: option.selected ? 'bg-zinc-100 dark:bg-zinc-800' : '',
    })) ?? [];
  const viewItems: KebabMenuItem[] = VIEW_OPTIONS.map(({ mode, label, Icon }) => ({
    label,
    icon: <Icon size={16} />,
    onClick: () => onViewModeChange(mode),
    className: viewMode === mode ? 'bg-zinc-100 dark:bg-zinc-800' : '',
  }));
  const newFolderItem: KebabMenuItem = {
    label: 'New Folder',
    icon: <FolderPlus size={16} />,
    onClick: () => void onCreateFolder(),
  };
  const newItems: KebabMenuItem[] = [
    { label: 'New Page', icon: <FilePlus2 size={16} />, onClick: () => void onCreatePage() },
    newFolderItem,
  ];
  const compactItems: KebabMenuItem[] = [
    ...filterItems.map((item) => ({ ...item, label: `Show: ${item.label}` })),
    ...viewItems.map((item, index) => ({
      ...item,
      ...(index === 0 && filter ? { dividerBefore: true } : {}),
    })),
    ...(canCreate ? [{ ...newFolderItem, dividerBefore: true }] : []),
  ];

  return (
    <AppShellToolbar className="bg-zinc-50 py-2 dark:bg-zinc-950 md:py-3">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm text-zinc-500 [scrollbar-width:none] dark:text-zinc-400 [&::-webkit-scrollbar]:hidden">
          {homeHref ? (
            <Link
              to={homeHref}
              className="flex h-8 items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {home}
            </Link>
          ) : (
            <span className="flex h-8 items-center gap-1">{home}</span>
          )}
          {filter && (
            <>
              <ChevronRight size={16} className="mx-1 shrink-0 min-[32rem]:hidden" />
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100 min-[32rem]:hidden">
                {filter.label}
              </span>
            </>
          )}
          {breadcrumbs.map((folder) => (
            <Fragment key={folder.id}>
              <ChevronRight size={16} className="mx-1 shrink-0" />
              <Link
                to={buildFolderPath(folder.name, folder.id)}
                className="flex h-8 items-center truncate transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {folder.name}
              </Link>
            </Fragment>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {filter && (
            <div className="hidden min-[32rem]:block">
              <KebabMenu
                ariaLabel={`Show: ${filter.label}`}
                items={filterItems}
                triggerContent={
                  <>
                    <span>{filter.label}</span>
                    <ChevronDown size={16} />
                  </>
                }
                triggerClassName="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                menuClassName="flex w-44 flex-col rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          )}
          <div className="hidden items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 min-[32rem]:flex">
            {VIEW_OPTIONS.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === mode ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                title={label}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          {canCreate && (
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => void onCreatePage()}
                aria-label="New page"
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white pl-3 pr-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 min-[32rem]:rounded-r-none min-[32rem]:border-r-0"
              >
                <FilePlus2 size={16} />
                <span className="hidden sm:inline">New Page</span>
              </button>
              <div className="hidden min-[32rem]:block">
                <KebabMenu
                  ariaLabel="Open new item menu"
                  items={newItems}
                  triggerContent={<ChevronDown size={16} />}
                  triggerClassName="flex h-8 cursor-pointer items-center rounded-r-lg border border-zinc-200 bg-white px-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  menuClassName="flex w-44 flex-col rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            </div>
          )}
          <div className="min-[32rem]:hidden">
            <KebabMenu
              ariaLabel="More explorer actions"
              items={compactItems}
              triggerClassName="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            />
          </div>
        </div>
      </div>
    </AppShellToolbar>
  );
}
