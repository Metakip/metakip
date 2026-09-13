import { getUnicodeCodePointLength, MAX_FOLDER_NAME_LENGTH } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { createCopyFolderName, normalizeFolderName } from './folderName';

describe('folder name boundaries', () => {
  it('counts Unicode code points when validating names', () => {
    const boundaryName = '📁'.repeat(MAX_FOLDER_NAME_LENGTH);
    expect(normalizeFolderName(boundaryName)).toBe(boundaryName);
    expect(() => normalizeFolderName(`${boundaryName}📁`)).toThrow(
      `Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer`,
    );
  });

  it('truncates copied names without splitting a surrogate pair', () => {
    const copiedName = createCopyFolderName('📁'.repeat(MAX_FOLDER_NAME_LENGTH));
    expect(getUnicodeCodePointLength(copiedName)).toBe(MAX_FOLDER_NAME_LENGTH);
    expect(copiedName).toBe(`Copy of ${'📁'.repeat(MAX_FOLDER_NAME_LENGTH - 8)}`);
    expect(copiedName).not.toContain('�');
  });
});
