import { randomBytes, randomUUID } from 'node:crypto';
import { API_TOKEN_PREFIX } from '@metakip/shared';
import { hashApiToken } from '@metakip/shared/node/api-token-credential';

export function createApiTokenSecret(): { id: string; token: string; tokenHash: string } {
  const id = randomUUID();
  const compactId = id.replaceAll('-', '');
  const secret = randomBytes(32).toString('base64url');
  const token = `${API_TOKEN_PREFIX}_${compactId}_${secret}`;
  return { id, token, tokenHash: hashApiToken(token) };
}
