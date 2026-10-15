import type { CollaboratorDisplay } from '@metakip/shared';

const ROLE_LABELS: Record<CollaboratorDisplay['permission'], string> = {
  admin: 'Admin',
  edit: 'Editor',
  commenter: 'Commenter',
  view: 'Viewer',
};

export function formatCollaboratorLabel(collaborator: CollaboratorDisplay): string {
  const name = collaborator.name ?? 'User';
  const role = collaborator.isOwner ? 'Owner' : ROLE_LABELS[collaborator.permission];
  return `${name} (${role})`;
}
