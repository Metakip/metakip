import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCollabLogger, requireCollaborationInternalSecret, setupLogger } from '@metakip/shared';
import { config } from 'dotenv';
import { createCollabServer } from './server';
import { getDbHostname } from './utils';

const currentDir = dirname(fileURLToPath(import.meta.url));

const candidateEnvPaths = [
  resolve(process.cwd(), '.env'),
  resolve(currentDir, '../.env'),
  resolve(currentDir, '../../../.env'),
];

const selectedEnvPath = candidateEnvPaths.find((envPath) => existsSync(envPath));

if (selectedEnvPath) {
  config({ path: selectedEnvPath });
} else {
  config();
}

async function main() {
  await setupLogger();
  const logger = getCollabLogger();

  const port = Number(process.env.COLLAB_PORT ?? '1234');
  const databaseUrl = process.env.DATABASE_URL;
  const internalSecret = requireCollaborationInternalSecret(process.env.COLLAB_INTERNAL_SECRET);

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for collab server');
  }
  const { Pool } = await import('pg');

  const dbHostname = getDbHostname(databaseUrl);
  const isLocalDb = dbHostname === 'localhost' || dbHostname === '127.0.0.1';

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ssl: isLocalDb ? false : undefined,
  });

  pool.on('error', (err) => {
    logger.error(`Database pool error: ${err.message}`);
  });

  const server = createCollabServer({ port, pool, logger, databaseUrl, internalSecret });
  server.listen();
}

main();
