import { stat } from 'node:fs/promises';
import '../env';
import { sql } from 'drizzle-orm';
import { closeDatabaseConnection } from '../db/connection';
import { query } from '../db/query';
import { createR2UploadStorage, LocalUploadStorage } from '../utils/uploadStorage';

type UploadMigrationRow = {
  filename: string;
  mime_type: string;
  size: number;
};

const MIGRATION_CONCURRENCY = 4;

async function migrateUploadsToR2(): Promise<void> {
  if (process.env.UPLOAD_STORAGE !== 'local') {
    throw new Error('Set UPLOAD_STORAGE=local and stop the API before running this migration');
  }
  const sourceDirectory = process.env.UPLOAD_MIGRATION_SOURCE_DIR;
  if (!sourceDirectory) {
    throw new Error('UPLOAD_MIGRATION_SOURCE_DIR must point to the mounted local upload volume');
  }
  const sourceStat = await stat(sourceDirectory).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error('UPLOAD_MIGRATION_SOURCE_DIR must reference an accessible directory');
  }

  const local = new LocalUploadStorage(sourceDirectory);
  const r2 = createR2UploadStorage();
  const uploads = await query<UploadMigrationRow>(
    sql`select filename, mime_type, size from uploads order by filename`,
  );
  const failures: string[] = [];
  let nextIndex = 0;
  let migrated = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < uploads.rows.length) {
      const upload = uploads.rows[nextIndex];
      nextIndex += 1;
      if (!upload) continue;
      try {
        const localBytes = await local.get(upload.filename);
        if (localBytes.length !== upload.size) {
          throw new Error(`local size is ${localBytes.length}, database size is ${upload.size}`);
        }
        await r2.put(upload.filename, localBytes, upload.mime_type);
        const copiedBytes = await r2.get(upload.filename);
        if (!copiedBytes.equals(localBytes)) {
          throw new Error('R2 verification did not match the local file');
        }
        migrated += 1;
        process.stdout.write(`Migrated ${migrated}/${uploads.rows.length}: ${upload.filename}\n`);
      } catch (error) {
        failures.push(
          `${upload.filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MIGRATION_CONCURRENCY, uploads.rows.length) }, () => worker()),
  );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => new Error(failure)),
      `${failures.length} upload(s) failed to migrate; UPLOAD_STORAGE must remain local`,
    );
  }

  process.stdout.write(`Verified ${migrated} upload(s) in R2.\n`);
  process.stdout.write(
    'Set UPLOAD_STORAGE=r2, restart the API, and retain local uploads for rollback.\n',
  );
}

try {
  await migrateUploadsToR2();
} finally {
  await closeDatabaseConnection();
}
