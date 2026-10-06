import { describe, expect, it } from 'vitest';
import { parseFolderDetailPayload, parsePageDetailPayload } from './entityPayload';

const commenterCapabilities = {
  canEdit: false,
  canDelete: false,
  canCopy: true,
  canComment: true,
};

describe('entity payload validation', () => {
  it('accepts commenter page and folder permissions with comment capability', () => {
    const page = {
      accessScope: 'account',
      id: 'page-id',
      parentId: null,
      title: 'Shared page',
      icon: null,
      createdBy: 'owner-id',
      ownerId: 'owner-id',
      createdAt: null,
      updatedAt: null,
      publicPermission: null,
      userPermission: 'commenter',
      position: 'a0',
      coverType: null,
      coverValue: null,
      properties: null,
      inheritancePolicy: 'inherit',
      capabilities: commenterCapabilities,
    };
    const folder = {
      accessScope: 'account',
      id: 'folder-id',
      parentId: null,
      name: 'Shared folder',
      icon: null,
      createdBy: 'owner-id',
      ownerId: 'owner-id',
      createdAt: null,
      updatedAt: null,
      publicPermission: null,
      userPermission: 'commenter',
      position: 'a0',
      inheritancePolicy: 'inherit',
      capabilities: commenterCapabilities,
      pages: [],
      folders: [],
    };

    expect(parsePageDetailPayload(page)).toMatchObject({ userPermission: 'commenter' });
    expect(parseFolderDetailPayload(folder)).toMatchObject({ userPermission: 'commenter' });
  });

  it('requires canComment in capability payloads', () => {
    const page = {
      accessScope: 'account',
      id: 'page-id',
      parentId: null,
      title: 'Shared page',
      icon: null,
      createdBy: 'owner-id',
      ownerId: 'owner-id',
      createdAt: null,
      updatedAt: null,
      publicPermission: null,
      userPermission: 'commenter',
      position: 'a0',
      coverType: null,
      coverValue: null,
      properties: null,
      inheritancePolicy: 'inherit',
      capabilities: {
        canEdit: false,
        canDelete: false,
        canCopy: true,
      },
    };

    expect(() => parsePageDetailPayload(page)).toThrow('Invalid page response');
  });
});
