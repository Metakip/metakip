import * as stylex from '@stylexjs/stylex';
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
import { KebabMenu, type KebabMenuItem, type KebabMenuRadioOption } from '../ui/KebabMenu';
import { styles } from './ExplorerToolbar.stylex';

type BreadcrumbFolder = { id: string; name: string };
type ExplorerFilter = {
  label: string;
  value: string;
  options: readonly KebabMenuRadioOption[];
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
      <span {...stylex.props(styles.homeIcon)}>
        <Home size={16} />
      </span>
      <span {...stylex.props(styles.homeLabel)}>Home</span>
    </>
  );

  const filterMenu = filter
    ? {
        triggerLabel: filter.label,
        group: { ...filter, type: 'radio-group' as const, label: 'Show filter' },
      }
    : undefined;
  const viewMenu = {
    type: 'radio-group' as const,
    label: 'View mode',
    value: viewMode,
    options: VIEW_OPTIONS.map(({ mode, label, Icon }) => ({
      value: mode,
      label,
      icon: <Icon size={16} />,
      onSelect: () => onViewModeChange(mode),
    })),
  };
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
    ...(filterMenu
      ? [
          {
            ...filterMenu.group,
            options: filterMenu.group.options.map((option) => ({
              ...option,
              label: `Show: ${option.label}`,
            })),
          },
        ]
      : []),
    { ...viewMenu, dividerBefore: Boolean(filterMenu) },
    ...(canCreate ? [{ ...newFolderItem, dividerBefore: true }] : []),
  ];

  return (
    <AppShellToolbar>
      <div {...stylex.props(styles.toolbarRow)}>
        <div {...stylex.props(styles.breadcrumb)} data-explorer-breadcrumb="">
          {homeHref ? (
            <Link to={homeHref} {...stylex.props(styles.homeLink)}>
              {home}
            </Link>
          ) : (
            <span {...stylex.props(styles.homeStatic)}>{home}</span>
          )}
          {filterMenu && (
            <>
              <ChevronRight size={16} {...stylex.props(styles.compactSeparator)} />
              <span {...stylex.props(styles.compactFilter)}>{filterMenu.triggerLabel}</span>
            </>
          )}
          {breadcrumbs.map((folder) => (
            <Fragment key={folder.id}>
              <ChevronRight size={16} {...stylex.props(styles.separator)} />
              <Link
                to={buildFolderPath(folder.name, folder.id)}
                {...stylex.props(styles.folderLink)}
              >
                {folder.name}
              </Link>
            </Fragment>
          ))}
        </div>

        <div {...stylex.props(styles.actions)}>
          {filterMenu && (
            <div {...stylex.props(styles.wideOnly)}>
              <KebabMenu
                ariaLabel={`Show: ${filterMenu.triggerLabel}`}
                items={[filterMenu.group]}
                popupWidth="11rem"
                triggerContent={
                  <>
                    <span>{filterMenu.triggerLabel}</span>
                    <ChevronDown size={16} />
                  </>
                }
                triggerStyle={styles.filterTrigger}
                popupStyle={styles.actionsPopup}
              />
            </div>
          )}
          <div {...stylex.props(styles.viewMode)}>
            {VIEW_OPTIONS.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                {...stylex.props(
                  styles.viewButton,
                  viewMode === mode ? styles.viewButtonActive : styles.viewButtonIdle,
                )}
                aria-pressed={viewMode === mode}
                title={label}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          {canCreate && (
            <div {...stylex.props(styles.createActions)}>
              <button
                type="button"
                onClick={() => void onCreatePage()}
                aria-label="New page"
                {...stylex.props(styles.newPageButton)}
              >
                <FilePlus2 size={16} />
                <span {...stylex.props(styles.newPageLabel)}>New Page</span>
              </button>
              <div {...stylex.props(styles.wideOnly)}>
                <KebabMenu
                  ariaLabel="Open new item menu"
                  items={newItems}
                  popupWidth="11rem"
                  triggerContent={<ChevronDown size={16} />}
                  triggerStyle={styles.newMenuTrigger}
                  popupStyle={styles.actionsPopup}
                />
              </div>
            </div>
          )}
          <div {...stylex.props(styles.compactOnly)}>
            <KebabMenu
              ariaLabel="More explorer actions"
              items={compactItems}
              triggerStyle={styles.compactTrigger}
            />
          </div>
        </div>
      </div>
    </AppShellToolbar>
  );
}
