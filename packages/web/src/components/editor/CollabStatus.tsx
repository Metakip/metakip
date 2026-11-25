import type { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import type { CollaboratorDisplay } from '@metakip/shared';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { getInitial } from '../../utils/avatar';
import { formatCollaboratorLabel } from '../../utils/formatCollaboratorLabel';
import { Tooltip } from '../Tooltip';
import { styles } from './CollabStatus.stylex';

type CollabStatusProps = {
  provider: HocuspocusProvider | null;
  status: WebSocketStatus;
  collaborators?: CollaboratorDisplay[];
};

type AwarenessUser = {
  id: number;
  userId?: string;
  name: string;
  color: string;
  avatar?: string;
  emoji?: string;
};

const STATUS_PRESENTATION: Record<WebSocketStatus, { label: string; statusStyle: StyleXStyles }> = {
  connecting: { label: 'Connecting', statusStyle: styles.connecting },
  connected: { label: 'Live', statusStyle: styles.connected },
  disconnected: { label: 'Offline', statusStyle: styles.disconnected },
};

function getCollaboratorLabel(user: AwarenessUser, collaborators: CollaboratorDisplay[]): string {
  const collaborator = user.userId
    ? collaborators.find((candidate) => candidate.userId === user.userId)
    : undefined;
  return collaborator ? formatCollaboratorLabel(collaborator) : user.name;
}

export function CollabStatus({ provider, status, collaborators = [] }: CollabStatusProps) {
  const [users, setUsers] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    if (!provider) {
      return;
    }

    const updateUsers = () => {
      const awareness = provider.awareness;
      if (!awareness) return;

      const states = awareness.getStates();
      const localClientId = awareness.clientID;
      const seen = new Map<string, AwarenessUser>();

      for (const [clientId, state] of states.entries()) {
        if (clientId === localClientId) continue;
        if (state.user && typeof state.user === 'object') {
          const user = state.user as {
            userId?: string;
            name?: string;
            color?: string;
            avatar?: string;
            emoji?: string;
          };

          const key =
            typeof user.userId === 'string'
              ? `user:${user.userId}`
              : (user.avatar ?? user.name ?? 'Anonymous');
          if (!seen.has(key)) {
            seen.set(key, {
              id: clientId,
              ...(typeof user.userId === 'string' ? { userId: user.userId } : {}),
              name: user.name ?? 'Anonymous',
              color: user.color ?? '#000000',
              ...(user.avatar ? { avatar: user.avatar } : {}),
              ...(user.emoji ? { emoji: user.emoji } : {}),
            });
          }
        }
      }

      setUsers(Array.from(seen.values()));
    };

    provider.awareness?.on('change', updateUsers);
    updateUsers();

    return () => {
      provider.awareness?.off('change', updateUsers);
    };
  }, [provider]);

  const { label, statusStyle } = STATUS_PRESENTATION[status];

  return (
    <div {...stylex.props(styles.root)}>
      {/* User Avatars — only when provider is available */}
      {provider && users.length > 0 && (
        <div {...stylex.props(styles.avatarList)}>
          {users.slice(0, 5).map((user) => (
            <Tooltip
              key={user.id}
              label={getCollaboratorLabel(user, collaborators)}
              position="bottom"
            >
              <div
                className={stylex.props(styles.avatar).className}
                style={{
                  borderColor: user.color,
                  backgroundColor: user.avatar ? undefined : user.color,
                }}
              >
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    {...stylex.props(styles.avatarImage)}
                    referrerPolicy="no-referrer"
                  />
                ) : user.emoji ? (
                  <span {...stylex.props(styles.avatarEmoji)}>{user.emoji}</span>
                ) : (
                  <span {...stylex.props(styles.avatarInitial)}>{getInitial(user.name)}</span>
                )}
              </div>
            </Tooltip>
          ))}
          {users.length > 5 && (
            <Tooltip label={`${users.length - 5} more users`} position="bottom">
              <div {...stylex.props(styles.overflowCount)}>+{users.length - 5}</div>
            </Tooltip>
          )}
        </div>
      )}

      {/* Status Indicator */}
      <Tooltip label={label} position="bottom">
        <span {...stylex.props(styles.statusButton)}>
          <span {...stylex.props(styles.statusDot, statusStyle)} data-status={status} />
        </span>
      </Tooltip>
    </div>
  );
}
