import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';

type CollaboratorDisplay = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  permission: string;
  isOwner: boolean;
};

function expectDisplayOnly(value: unknown): asserts value is CollaboratorDisplay[] {
  expect(Array.isArray(value)).toBe(true);
  for (const collaborator of value as unknown[]) {
    expect(collaborator).toBeTypeOf('object');
    expect(Object.keys(collaborator as Record<string, unknown>).sort()).toEqual([
      'avatarUrl',
      'isOwner',
      'name',
      'permission',
      'userId',
    ]);
  }
}

const guestCookie = () => `metakip_anon_id=${randomUUID()}`;

describe('sharing identity privacy', () => {
  it('returns display identities but not management data to direct and inherited collaborators', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Owner Visible Name' });
    const directEditor = await createTestUser({ name: 'Direct Editor Name' });
    const inheritedViewer = await createTestUser({ name: 'Inherited Viewer Name' });
    const ownerSession = await createTestSession(owner.id);
    const editorSession = await createTestSession(directEditor.id);
    const viewerSession = await createTestSession(inheritedViewer.id);
    const folder = await createTestFolder(owner.id, { name: 'Private topology name' });
    const page = await createTestPage(owner.id, {
      title: 'Privacy page',
      parentId: folder.id,
    });

    const directGrant = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ email: directEditor.email, permission: 'edit' }),
    });
    expect(directGrant.status).toBe(200);
    const inheritedGrant = await app.request(`/api/shares/entity/folder/${folder.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ email: inheritedViewer.email, permission: 'view' }),
    });
    expect(inheritedGrant.status).toBe(200);

    for (const [session, permission] of [
      [editorSession.Cookie, 'edit'],
      [viewerSession.Cookie, 'view'],
    ] as const) {
      const summaryRes = await app.request(`/api/shares/entity/page/${page.id}`, {
        headers: { Cookie: session },
      });
      expect(summaryRes.status).toBe(200);
      const summary = (await summaryRes.json()) as Record<string, unknown> & {
        collaborators: unknown;
        entity: { ownerId: string | null };
        publicAccess: { permission: string; url: string };
        userPermission: string;
      };
      expect(summary).toMatchObject({
        visibility: 'limited',
        userPermission: permission,
        entity: { ownerId: null },
        publicAccess: { permission: 'private', url: expect.any(String) },
        grants: [],
        accessors: [],
        accessSources: [],
        inheritedPublicAccess: [],
        permissionDetails: [],
        inheritedAccessors: [],
      });
      expectDisplayOnly(summary.collaborators);
      expect(summary.collaborators).toContainEqual({
        userId: owner.id,
        name: owner.name,
        avatarUrl: null,
        permission: 'admin',
        isOwner: true,
      });
      const encoded = JSON.stringify(summary);
      expect(encoded).not.toContain(owner.email);
      expect(encoded).not.toContain(directEditor.email);
      expect(encoded).not.toContain(inheritedViewer.email);
      expect(encoded).not.toContain('grantId');
      expect(encoded).not.toContain('source');
      expect(encoded).not.toContain('Private topology name');
    }

    const pageCollaboratorsRes = await app.request(
      `/api/shares/pages/collaborators?ids=${page.id}`,
      {
        headers: { Cookie: editorSession.Cookie },
      },
    );
    expect(pageCollaboratorsRes.status).toBe(200);
    const pageCollaborators = (await pageCollaboratorsRes.json()) as Record<string, unknown>;
    expectDisplayOnly(pageCollaborators[page.id]);
    expect(pageCollaborators[page.id]).toContainEqual({
      userId: owner.id,
      name: owner.name,
      avatarUrl: null,
      permission: 'admin',
      isOwner: true,
    });
    expect(JSON.stringify(pageCollaborators)).not.toContain(owner.email);
    expect(JSON.stringify(pageCollaborators)).not.toContain('grantId');

    const folderCollaboratorsRes = await app.request(
      `/api/shares/folders/collaborators?ids=${folder.id}`,
      { headers: { Cookie: viewerSession.Cookie } },
    );
    expect(folderCollaboratorsRes.status).toBe(200);
    const folderCollaborators = (await folderCollaboratorsRes.json()) as Record<string, unknown>;
    expectDisplayOnly(folderCollaborators[folder.id]);
    expect(folderCollaborators[folder.id]).toContainEqual({
      userId: owner.id,
      name: owner.name,
      avatarUrl: null,
      permission: 'admin',
      isOwner: true,
    });
  });

  it('exposes display identities but not management data to a signed-in public visitor', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Public Owner Name' });
    const collaborator = await createTestUser({ name: 'Hidden Collaborator Name' });
    const visitor = await createTestUser({ name: 'Public Visitor Name' });
    const ownerSession = await createTestSession(owner.id);
    const visitorSession = await createTestSession(visitor.id);
    const page = await createTestPage(owner.id, { title: 'Public privacy page' });

    await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ email: collaborator.email, permission: 'view' }),
    });
    const publicAccessRes = await app.request(`/api/shares/entity/page/${page.id}/public-access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ permission: 'view' }),
    });
    expect(publicAccessRes.status).toBe(200);
    const accessRes = await app.request(`/api/pages/${page.id}/access`, {
      method: 'POST',
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(accessRes.status).toBe(200);

    const summaryRes = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as Record<string, unknown> & {
      collaborators: unknown;
    };
    expect(summary).toMatchObject({
      visibility: 'limited',
      userPermission: 'view',
      publicAccess: { permission: 'view', url: expect.any(String) },
      accessors: [],
      accessSources: [],
      inheritedPublicAccess: [],
    });
    expectDisplayOnly(summary.collaborators);
    expect(summary.collaborators).toContainEqual({
      userId: collaborator.id,
      name: collaborator.name,
      avatarUrl: null,
      permission: 'view',
      isOwner: false,
    });
    const encoded = JSON.stringify(summary);
    expect(encoded).not.toContain(owner.email);
    expect(encoded).not.toContain(collaborator.email);
    expect(encoded).not.toContain('grantId');

    const inaccessibleId = crypto.randomUUID();
    const collaboratorsRes = await app.request(
      `/api/shares/pages/collaborators?ids=${page.id},${inaccessibleId}`,
      { headers: { Cookie: visitorSession.Cookie } },
    );
    expect(collaboratorsRes.status).toBe(200);
    const collaborators = (await collaboratorsRes.json()) as Record<string, unknown>;
    expectDisplayOnly(collaborators[page.id]);
    expect(collaborators[page.id]).toContainEqual({
      userId: owner.id,
      name: owner.name,
      avatarUrl: null,
      permission: 'admin',
      isOwner: true,
    });
    expect(collaborators[inaccessibleId]).toEqual([]);
    const collaboratorJson = JSON.stringify(collaborators);
    expect(collaboratorJson).not.toContain(owner.email);
    expect(collaboratorJson).not.toContain(collaborator.email);
    expect(collaboratorJson).not.toContain('grantId');
    expect(collaboratorJson).not.toContain('source');
  });

  it('exposes display identities to an anonymous public visitor', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Anonymous Public Owner' });
    const ownerSession = await createTestSession(owner.id);
    const page = await createTestPage(owner.id, { title: 'Anonymous public page' });

    const publicAccessRes = await app.request(`/api/shares/entity/page/${page.id}/public-access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ permission: 'view' }),
    });
    expect(publicAccessRes.status).toBe(200);

    const collaboratorsRes = await app.request(`/api/shares/pages/collaborators?ids=${page.id}`, {
      headers: { Cookie: guestCookie() },
    });
    expect(collaboratorsRes.status).toBe(200);
    const collaborators = (await collaboratorsRes.json()) as Record<string, unknown>;
    expectDisplayOnly(collaborators[page.id]);
    expect(collaborators[page.id]).toContainEqual({
      userId: owner.id,
      name: owner.name,
      avatarUrl: null,
      permission: 'admin',
      isOwner: true,
    });

    const folder = await createTestFolder(owner.id, { name: 'Anonymous public folder' });
    const folderPublicAccessRes = await app.request(
      `/api/shares/entity/folder/${folder.id}/public-access`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
        body: JSON.stringify({ permission: 'view' }),
      },
    );
    expect(folderPublicAccessRes.status).toBe(200);

    const folderCollaboratorsRes = await app.request(
      `/api/shares/folders/collaborators?ids=${folder.id}`,
      { headers: { Cookie: guestCookie() } },
    );
    expect(folderCollaboratorsRes.status).toBe(200);
    const folderCollaborators = (await folderCollaboratorsRes.json()) as Record<string, unknown>;
    expectDisplayOnly(folderCollaborators[folder.id]);
    expect(folderCollaborators[folder.id]).toContainEqual({
      userId: owner.id,
      name: owner.name,
      avatarUrl: null,
      permission: 'admin',
      isOwner: true,
    });
  });

  it('returns display-only collaborator identities to admins', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Admin Owner' });
    const recipient = await createTestUser({ name: 'Managed Recipient' });
    const ownerSession = await createTestSession(owner.id);
    const folder = await createTestFolder(owner.id);
    const page = await createTestPage(owner.id, { parentId: folder.id });
    await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ email: recipient.email, permission: 'view' }),
    });

    const summaryRes = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: ownerSession.Cookie },
    });
    const summary = (await summaryRes.json()) as {
      visibility: string;
      grants: Array<{ id: string; recipientEmail: string }>;
      accessSources: Array<{ userId: string; grantId: string | null; permission: string }>;
    };
    expect(summary.visibility).toBe('full');
    expect(summary.grants).toContainEqual(
      expect.objectContaining({ id: expect.any(String), recipientEmail: recipient.email }),
    );
    expect(summary.accessSources).toContainEqual(
      expect.objectContaining({
        userId: recipient.id,
        grantId: expect.any(String),
        permission: 'view',
      }),
    );

    const pageCollaboratorsRes = await app.request(
      `/api/shares/pages/collaborators?ids=${page.id}`,
      { headers: { Cookie: ownerSession.Cookie } },
    );
    const pageCollaborators = (await pageCollaboratorsRes.json()) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    expect(pageCollaborators[page.id]).toContainEqual(
      expect.objectContaining({
        userId: recipient.id,
        name: recipient.name,
        permission: 'view',
        isOwner: false,
      }),
    );
    expectDisplayOnly(pageCollaborators[page.id]);

    const folderCollaboratorsRes = await app.request(
      `/api/shares/folders/collaborators?ids=${folder.id}`,
      { headers: { Cookie: ownerSession.Cookie } },
    );
    expect(folderCollaboratorsRes.status).toBe(200);
    const folderCollaborators = (await folderCollaboratorsRes.json()) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    expect(folderCollaborators[folder.id]?.[0]).toEqual(
      expect.objectContaining({
        userId: owner.id,
        permission: 'admin',
        isOwner: true,
      }),
    );
    expectDisplayOnly(folderCollaborators[folder.id]);
  });
});
