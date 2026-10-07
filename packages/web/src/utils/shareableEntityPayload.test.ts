import { describe, expect, it } from 'vitest';
import { parseShareableEntityPayload } from './shareableEntityPayload';

const capabilities = { canEdit: false, canDelete: false, canCopy: true, canComment: false };

describe('parseShareableEntityPayload', () => {
  it('accepts a complete public page response', () => {
    expect(
      parseShareableEntityPayload('page', {
        accessScope: 'public',
        id: 'page-1',
        title: 'Public page',
        icon: null,
        coverType: null,
        coverValue: null,
        properties: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
        publicPermission: 'view',
        userPermission: 'view',
        capabilities,
      }),
    ).toEqual({
      accessScope: 'public',
      id: 'page-1',
      title: 'Public page',
      icon: null,
      coverType: null,
      coverValue: null,
      properties: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      publicPermission: 'view',
      userPermission: 'view',
      capabilities,
    });
  });

  it.each([
    { id: 'page-1', userPermission: 'view', capabilities },
    {
      accessScope: 'public',
      id: 'page-1',
      publicPermission: 'view',
      userPermission: 'admin',
      capabilities,
    },
    {
      accessScope: 'account',
      id: 'page-1',
      publicPermission: null,
      userPermission: 'edit',
    },
  ])('rejects an incomplete or contradictory page response', (payload) => {
    expect(() => parseShareableEntityPayload('page', payload)).toThrow('Invalid page response');
  });

  it('rejects an impossible admin permission in a public folder payload', () => {
    expect(() =>
      parseShareableEntityPayload('folder', {
        accessScope: 'public',
        id: 'folder-1',
        name: 'Public folder',
        icon: null,
        updatedAt: null,
        publicPermission: 'view',
        userPermission: 'admin',
        capabilities,
        pages: [],
        folders: [],
      }),
    ).toThrow('Invalid folder response');
  });
});
