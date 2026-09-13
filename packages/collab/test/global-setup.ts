import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const CONTAINER_NAME_PREFIX = 'metakip-postgres-test-collab';

function getMappedPort(name: string): number {
  const mapping = execSync(`podman port ${name} 5432/tcp`, { encoding: 'utf8' }).trim();
  const port = Number.parseInt(mapping.slice(mapping.lastIndexOf(':') + 1), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Unable to determine PostgreSQL port from mapping: ${mapping}`);
  }
  return port;
}

async function waitForDatabase(name: string, databaseUrl: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query('select 1');
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      if (i >= 5 && i % 10 === 0) {
        try {
          execSync(`podman logs --tail=5 ${name}`, { stdio: 'inherit' });
        } catch {
          void 0;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  try {
    execSync(`podman logs --tail=20 ${name}`, { stdio: 'inherit' });
  } catch {
    void 0;
  }
  throw new Error('PostgreSQL test container failed to become ready');
}

function removeContainer(name: string): void {
  try {
    execSync(`podman rm -f ${name}`, { stdio: 'pipe', timeout: 15_000 });
  } catch {
    void 0;
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const containerName = `${CONTAINER_NAME_PREFIX}-${process.pid}-${randomUUID().slice(0, 8)}`;

  // Let Podman reserve the host port atomically so concurrent test processes
  // cannot both discover and then race to bind the same "free" port.
  try {
    execSync(
      `podman run -d --name ${containerName} -e POSTGRES_USER=metakip -e POSTGRES_PASSWORD=password -e POSTGRES_DB=metakip_test -p 127.0.0.1::5432 postgres:17-alpine -c fsync=off -c full_page_writes=off -c synchronous_commit=off`,
      { stdio: 'inherit' },
    );
    const port = getMappedPort(containerName);
    const testDbUrl = `postgresql://metakip:password@127.0.0.1:${port}/metakip_test`;

    await waitForDatabase(containerName, testDbUrl);

    process.env.DATABASE_URL = testDbUrl;
    process.env.COLLAB_PORT ??= '0';
    process.env.BETTER_AUTH_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
    process.env.COLLAB_INTERNAL_SECRET ??= 'test-collaboration-internal-secret';
    process.env.BETTER_AUTH_URL ??= 'http://localhost:3001';
    process.env.GITHUB_CLIENT_ID ??= 'test';
    process.env.GITHUB_CLIENT_SECRET ??= 'test';

    // Apply the checked-in Drizzle v1 migration history to the fresh database.
    execSync('pnpm --filter @metakip/api exec drizzle-kit migrate', {
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: 'inherit',
    });
  } catch (error) {
    removeContainer(containerName);
    throw error;
  }

  return async () => {
    removeContainer(containerName);
  };
}
