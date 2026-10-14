import type {
  InheritancePolicy,
  PublicPermission,
  ShareEntityType,
  SharePermission,
  V1ResentShareInvitation,
  V1ShareGrantResponse,
  V1ShareInheritance,
  V1ShareMutation,
  V1SharePublicAccess,
  V1SharingSummary,
  V1WorkspaceMemberAdded,
  V1WorkspaceSharingSummary,
  WorkspaceRole,
} from '@metakip/shared';
import {
  v1ResentShareInvitationSchema,
  v1ShareGrantResponseSchema,
  v1ShareInheritanceSchema,
  v1ShareMutationSchema,
  v1SharePublicAccessSchema,
  v1SharingSummarySchema,
  v1WorkspaceMemberAddedSchema,
  v1WorkspaceSharingSummarySchema,
} from '@metakip/shared';
import type { z } from 'zod';
import type { McpActor, McpRequestOptions } from './types';
import { parseApiResponse } from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

type EntityReferenceResolver = (
  actor: McpActor,
  reference: string,
  signal?: AbortSignal,
) => Promise<{ id: string }>;

export class V1SharingClient {
  constructor(
    private readonly io: V1ClientIO,
    private readonly resolvePage: EntityReferenceResolver,
    private readonly resolveFolder: EntityReferenceResolver,
  ) {}

  private async resolveEntityId(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return entityType === 'page'
      ? (await this.resolvePage(actor, reference, signal)).id
      : (await this.resolveFolder(actor, reference, signal)).id;
  }

  async getSharingSummary(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<V1SharingSummary> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return parseApiResponse(
      v1SharingSummarySchema,
      await this.io.readJson(
        await this.io.send(actor, `/shares/entity/${entityType}/${entityId}`, {}, options?.signal),
      ),
    );
  }

  async grantEntityAccess(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    input: { email: string; permission: SharePermission },
    options?: McpRequestOptions,
  ): Promise<V1ShareGrantResponse> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.io.readMutationJson<V1ShareGrantResponse>(
      await this.io.send(
        actor,
        `/shares/entity/${entityType}/${entityId}/grants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        options?.signal,
      ),
      (value) => parseApiResponse(v1ShareGrantResponseSchema, value),
    );
  }

  async updateSharePermission(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    email: string,
    permission: SharePermission,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/grants/by-email/${encodeURIComponent(email)}`,
      'PATCH',
      { permission },
      v1ShareMutationSchema,
      options,
    );
  }

  async revokeShare(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/grants/by-email/${encodeURIComponent(email)}`,
      'DELETE',
      undefined,
      v1ShareMutationSchema,
      options,
    );
  }

  async leaveSharedEntity(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/leave`,
      'POST',
      undefined,
      v1ShareMutationSchema,
      options,
    );
  }

  async updatePublicAccess(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    permission: PublicPermission | 'private',
    options?: McpRequestOptions,
  ): Promise<V1SharePublicAccess> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/public-access`,
      'PATCH',
      { permission },
      v1SharePublicAccessSchema,
      options,
    );
  }

  async updateSharingInheritance(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    policy: InheritancePolicy,
    options?: McpRequestOptions,
  ): Promise<V1ShareInheritance> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/inheritance`,
      'PATCH',
      { policy },
      v1ShareInheritanceSchema,
      options,
    );
  }

  async resendSharingInvitation(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ResentShareInvitation> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/invitations/by-email/${encodeURIComponent(email)}/resend`,
      'POST',
      undefined,
      v1ResentShareInvitationSchema,
      options,
    );
  }

  async cancelSharingInvitation(
    actor: McpActor,
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    const entityId = await this.resolveEntityId(actor, entityType, reference, options?.signal);
    return this.mutate(
      actor,
      `/shares/entity/${entityType}/${entityId}/invitations/by-email/${encodeURIComponent(email)}`,
      'DELETE',
      undefined,
      v1ShareMutationSchema,
      options,
    );
  }

  async getWorkspaceSharingSummary(
    actor: McpActor,
    options?: McpRequestOptions,
  ): Promise<V1WorkspaceSharingSummary> {
    return parseApiResponse(
      v1WorkspaceSharingSummarySchema,
      await this.io.readJson(await this.io.send(actor, '/shares/workspace', {}, options?.signal)),
    );
  }

  async addWorkspaceMember(
    actor: McpActor,
    email: string,
    role: WorkspaceRole,
    options?: McpRequestOptions,
  ): Promise<V1WorkspaceMemberAdded> {
    return this.mutate(
      actor,
      '/shares/workspace/members',
      'POST',
      { email, role },
      v1WorkspaceMemberAddedSchema,
      options,
    );
  }

  async updateWorkspaceMember(
    actor: McpActor,
    email: string,
    role: WorkspaceRole,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.mutate(
      actor,
      `/shares/workspace/members/by-email/${encodeURIComponent(email)}`,
      'PATCH',
      { role },
      v1ShareMutationSchema,
      options,
    );
  }

  async removeWorkspaceMember(
    actor: McpActor,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.mutate(
      actor,
      `/shares/workspace/members/by-email/${encodeURIComponent(email)}`,
      'DELETE',
      undefined,
      v1ShareMutationSchema,
      options,
    );
  }

  async leaveWorkspace(
    actor: McpActor,
    ownerId: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.mutate(
      actor,
      `/shares/workspace/memberships/${encodeURIComponent(ownerId)}`,
      'DELETE',
      undefined,
      v1ShareMutationSchema,
      options,
    );
  }

  async resendWorkspaceInvitation(
    actor: McpActor,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ResentShareInvitation> {
    return this.mutate(
      actor,
      `/shares/workspace/invitations/by-email/${encodeURIComponent(email)}/resend`,
      'POST',
      undefined,
      v1ResentShareInvitationSchema,
      options,
    );
  }

  async cancelWorkspaceInvitation(
    actor: McpActor,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.mutate(
      actor,
      `/shares/workspace/invitations/by-email/${encodeURIComponent(email)}`,
      'DELETE',
      undefined,
      v1ShareMutationSchema,
      options,
    );
  }

  private async mutate<Output, Schema extends z.ZodType<Output>>(
    actor: McpActor,
    path: string,
    method: 'DELETE' | 'PATCH' | 'POST',
    body: unknown,
    schema: Schema,
    options?: McpRequestOptions,
  ): Promise<Output> {
    return this.io.readMutationJson<Output>(
      await this.io.send(
        actor,
        path,
        {
          method,
          ...(body === undefined
            ? {}
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        },
        options?.signal,
      ),
      (value) => parseApiResponse<Output>(schema, value),
    );
  }
}
