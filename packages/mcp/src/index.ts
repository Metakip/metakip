import './env';
import { serve } from '@hono/node-server';
import { setupLogger } from '@metakip/shared';
import { getMcpRuntimeConfig } from './config';
import { createMcpApp } from './routes';

await setupLogger();

const { apiUrl, publicUrl, authIssuer, authJwksUrl, apiInternalSecret, port } =
  getMcpRuntimeConfig();

serve({
  fetch: createMcpApp({
    apiUrl,
    publicUrl,
    authIssuer,
    authJwksUrl,
    apiInternalSecret,
  }).fetch,
  port,
});
