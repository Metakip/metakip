import { createHash } from 'node:crypto';
import type { PageContentMetadata } from '@metakip/shared';

export function contentMetadataHash(metadata: PageContentMetadata): string {
  return createHash('sha256')
    .update(JSON.stringify([metadata.properties, metadata.icon]))
    .digest('base64url');
}
