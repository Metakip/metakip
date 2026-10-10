import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptInvitationSecret, encryptInvitationSecret } from './invitationCipher';

const OLD_KEY = 'old-invitation-token-encryption-key-0123456789';
const NEW_KEY = 'new-invitation-token-encryption-key-0123456789';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('invitation secret encryption', () => {
  it('identifies ciphertext keys and supports a controlled key rotation', () => {
    vi.stubEnv('INVITATION_TOKEN_ENCRYPTION_KEY', OLD_KEY);
    const encrypted = encryptInvitationSecret('invitation-token');

    vi.stubEnv('INVITATION_TOKEN_ENCRYPTION_KEY', NEW_KEY);
    vi.stubEnv('INVITATION_TOKEN_ENCRYPTION_KEY_PREVIOUS', OLD_KEY);

    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(decryptInvitationSecret(encrypted)).toBe('invitation-token');
  });

  it('fails clearly when the key that owns the ciphertext is unavailable', () => {
    vi.stubEnv('INVITATION_TOKEN_ENCRYPTION_KEY', OLD_KEY);
    const encrypted = encryptInvitationSecret('invitation-token');
    vi.stubEnv('INVITATION_TOKEN_ENCRYPTION_KEY', NEW_KEY);

    expect(() => decryptInvitationSecret(encrypted)).toThrow(
      'Encrypted invitation data could not be decrypted',
    );
  });
});
