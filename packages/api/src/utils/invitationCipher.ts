import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { invitationTokenEncryptionKeys } from '../env';

const deriveKey = (secret: string): Buffer => createHash('sha256').update(secret).digest();
const keyId = (secret: string): string =>
  createHash('sha256').update(`invitation-token-key:${secret}`).digest('base64url').slice(0, 12);

function decryptWithSecret(
  secret: string,
  ivValue: string,
  tagValue: string,
  encryptedValue: string,
): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptInvitationSecret(value: string): string {
  const iv = randomBytes(12);
  const currentKey = invitationTokenEncryptionKeys()[0];
  const cipher = createCipheriv('aes-256-gcm', deriveKey(currentKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${keyId(currentKey)}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptInvitationSecret(value: string): string {
  const parts = value.split('.');
  const versioned = parts.length === 5 && parts[0] === 'v1';
  if (!versioned && parts.length !== 3) {
    throw new Error('Encrypted invitation data is malformed');
  }
  const storedKeyId = versioned ? parts[1] : null;
  const [ivValue, tagValue, encryptedValue] = versioned ? parts.slice(2) : parts;
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('Encrypted invitation data is malformed');
  }

  const matchingKeys = invitationTokenEncryptionKeys().filter(
    (secret) => storedKeyId === null || keyId(secret) === storedKeyId,
  );
  for (const secret of matchingKeys) {
    try {
      return decryptWithSecret(secret, ivValue, tagValue, encryptedValue);
    } catch {
      // Try the previous key during a controlled rotation.
    }
  }
  throw new Error('Encrypted invitation data could not be decrypted');
}
