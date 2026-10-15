import type { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import type { CollaboratorDisplay } from '@metakip/shared';
import { useEffect, useState } from 'react';
import { getInitial } from '../../utils/avatar';
import { formatCollaboratorLabel } from '../../utils/formatCollaboratorLabel';
import { Tooltip } from '../Tooltip';

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

const STATUS_PRESENTATION: Record<WebSocketStatus, { label: string; colorClass: string }> = {
  connecting: { label: 'Connecting', colorClass: 'bg-amber-500' },
  connected: { label: 'Live', colorClass: 'bg-emerald-500' },
  disconnected: { label: 'Offline', colorClass: 'bg-rose-500' },
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

  const { label, colorClass } = STATUS_PRESENTATION[status];

  return (
    <div className="flex items-center gap-2.5">
      {/* User Avatars — only when provider is available */}
      {provider && users.length > 0 && (
        <div className="hidden items-center -space-x-2 sm:flex">
          {users.slice(0, 5).map((user) => (
            <Tooltip
              key={user.id}
              label={getCollaboratorLabel(user, collaborators)}
              position="bottom"
            >
              <div
                className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-[2.5px] bg-zinc-100 transition-transform hover:z-10 hover:scale-110 dark:bg-zinc-800"
                style={{
                  borderColor: user.color,
                  backgroundColor: user.avatar ? undefined : user.color,
                }}
              >
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : user.emoji ? (
                  <span className="text-base">{user.emoji}</span>
                ) : (
                  <span className="text-xs font-bold text-white">{getInitial(user.name)}</span>
                )}
              </div>
            </Tooltip>
          ))}
          {users.length > 5 && (
            <Tooltip label={`${users.length - 5} more users`} position="bottom">
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-200 bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                +{users.length - 5}
              </div>
            </Tooltip>
          )}
        </div>
      )}

      {/* Status Indicator */}
      <Tooltip label={label} position="bottom">
        <span className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <span
            className={`inline-flex h-3 w-3 rounded-full transition-colors duration-300 ${colorClass}`}
          />
        </span>
      </Tooltip>
    </div>
  );
}
