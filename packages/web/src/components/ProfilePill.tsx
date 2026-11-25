import { METAKIP_DOCS_URL } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import clsx from 'clsx';
import { BookOpen, LogOut, Search, Settings, Trash2, User } from 'lucide-react';
import { useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useTrashFolders } from '../hooks/use-folders';
import { useTrashPages } from '../hooks/use-pages';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';
import { formatShortcut, SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { getWorkspacePath } from '../utils/url';
import { styles } from './ProfilePill.stylex';
import { ThemeToggle } from './ThemeToggle';
import { Tooltip } from './Tooltip';

interface ProfilePillProps {
  className?: string;
}

export function ProfilePill({ className }: ProfilePillProps) {
  const navigate = useIdentityNavigate();

  const { data: session } = useAuth();

  const { data: trashPages } = useTrashPages();
  const { data: trashFolders } = useTrashFolders();
  const hasTrashItems = (trashPages?.length ?? 0) + (trashFolders?.length ?? 0) > 0;
  const searchShortcut = formatShortcut(SHORTCUT_PATTERNS.commandPalette);

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          navigate('/login');
        },
      },
    });
  };

  return (
    <div className={clsx(stylex.props(styles.container).className, className)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.actions)}>
          <ThemeToggle />
          <Tooltip label="Documentation" position="top">
            <a
              href={METAKIP_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Documentation"
              {...stylex.props(styles.actionButton)}
            >
              <BookOpen size={18} />
            </a>
          </Tooltip>
          <Tooltip label="Settings" position="top">
            <button
              type="button"
              onClick={() => navigate(getWorkspacePath('settings'))}
              {...stylex.props(styles.actionButton)}
            >
              <Settings size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Trash" position="top">
            <button
              type="button"
              onClick={() => navigate(getWorkspacePath('trash'))}
              {...stylex.props(styles.actionButton, styles.trashButton)}
            >
              <Trash2 size={18} />
              {hasTrashItems && <span {...stylex.props(styles.trashIndicator)} />}
            </button>
          </Tooltip>
          <Tooltip label={`Search (${searchShortcut})`} position="top">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('open-search'))}
              {...stylex.props(styles.actionButton)}
            >
              <Search size={18} />
            </button>
          </Tooltip>
        </div>
        <div {...stylex.props(stylex.defaultMarker(), styles.userCard)}>
          <div {...stylex.props(styles.avatar)}>
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt={session.user.name || 'User'}
                {...stylex.props(styles.avatarImage)}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div {...stylex.props(styles.avatarFallback)}>
                <User size={16} />
              </div>
            )}
          </div>
          <div {...stylex.props(styles.userDetails)}>
            <div {...stylex.props(styles.userName)}>{session?.user?.name || 'User'}</div>
            <div {...stylex.props(styles.userEmail)}>{session?.user?.email}</div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            {...stylex.props(styles.signOutButton)}
            title="Sign Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
