import { getDbLogger } from '@metakip/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as pg from 'pg';

const { Pool } = pg;

function getDbHostname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const dbHostname = getDbHostname(process.env.DATABASE_URL);
const isLocalDb = dbHostname === 'localhost' || dbHostname === '127.0.0.1';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: isLocalDb ? false : undefined,
});

pool.on('error', (err) => {
  getDbLogger().error('Unexpected database pool error: {message}', {
    message: err instanceof Error ? err.message : String(err),
  });
});

export const db = drizzle({ client: pool });

export const closeDatabaseConnection = async (): Promise<void> => pool.end();
