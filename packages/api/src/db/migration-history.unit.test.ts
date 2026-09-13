import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const drizzleDir = resolve(currentDir, '../../drizzle');
const deployScriptPath = resolve(currentDir, '../../../../deploy/deploy.sh');
const deploymentGuidePath = resolve(
  currentDir,
  '../../../../docs/src/content/docs/self-hosting/maintain-a-self-hosted-metakip.md',
);
const migrationDirPattern = /^\d{14}_[A-Za-z0-9_-]+$/;

function listMigrationDirs(): string[] {
  return readdirSync(drizzleDir)
    .filter((name) => {
      const path = resolve(drizzleDir, name);
      return statSync(path).isDirectory() && migrationDirPattern.test(name);
    })
    .sort();
}

function readMigrationSql(dirName: string): string {
  return readFileSync(resolve(drizzleDir, dirName, 'migration.sql'), 'utf8');
}

describe('Drizzle v1 migration history', () => {
  it('uses v1 folder migrations instead of the legacy journal format', () => {
    expect(existsSync(resolve(drizzleDir, 'meta/_journal.json'))).toBe(false);

    const legacySqlFiles = readdirSync(drizzleDir).filter((name) => /^\d{4}_.+\.sql$/.test(name));
    expect(legacySqlFiles).toEqual([]);
  });

  it('has a migration.sql and snapshot.json for every migration folder', () => {
    const migrationDirs = listMigrationDirs();
    expect(migrationDirs.length).toBeGreaterThan(0);

    for (const dirName of migrationDirs) {
      expect(
        existsSync(resolve(drizzleDir, dirName, 'migration.sql')),
        `${dirName}/migration.sql`,
      ).toBe(true);
      expect(
        existsSync(resolve(drizzleDir, dirName, 'snapshot.json')),
        `${dirName}/snapshot.json`,
      ).toBe(true);
    }
  });

  it('keeps migration folder timestamps strictly increasing', () => {
    const migrationDirs = listMigrationDirs();
    let previousTimestamp = 0;

    for (const dirName of migrationDirs) {
      const timestamp = Number(dirName.slice(0, 14));
      expect(timestamp, `${dirName} must be newer than the previous migration`).toBeGreaterThan(
        previousTimestamp,
      );
      previousTimestamp = timestamp;
    }
  });

  it('backfills page timestamps before enforcing non-null constraints', () => {
    const migration = readMigrationSql('20260726075157_api_v1_foundation');
    const backfill = migration.indexOf('UPDATE "pages"');
    const createdConstraint = migration.indexOf('"created_at" SET NOT NULL');
    const updatedConstraint = migration.indexOf('"updated_at" SET NOT NULL');

    expect(backfill).toBeGreaterThan(-1);
    expect(createdConstraint).toBeGreaterThan(backfill);
    expect(updatedConstraint).toBeGreaterThan(createdConstraint);
  });

  it('consolidates API v1 persistence and indexes scheduled retention scans', () => {
    const migrationDirs = listMigrationDirs().filter((name) => name.startsWith('20260725'));
    expect(migrationDirs).toEqual([]);
    const migration = readMigrationSql('20260726075157_api_v1_foundation');
    expect(migration).toContain('api_idempotency_records_expires_at_idx');
    expect(migration).toContain('api_token_audit_events_created_at_idx');
    expect(migration).toContain('api_token_audit_events_owner_idx');
    expect(migration).toContain('api_token_audit_events_page_idx');
    expect(migration).not.toContain('CREATE TRIGGER');
  });

  it('keeps Better Auth text defaults and assertion retention scans type-safe', () => {
    const migration = readMigrationSql('20260825123649_mcp_oauth');
    expect(migration).toContain('"id" text PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(migration).toContain('oauth_client_assertions_expires_at_id_idx');
    expect(migration).toContain('CREATE TABLE "oauth_access_token_revocations"');
    expect(migration).toContain('oauth_access_token_revocations_expires_at_idx');
  });

  it('checks migration compatibility before modifying deployment artifacts', () => {
    const deployScript = readFileSync(deployScriptPath, 'utf8');
    const compatibilityCheck = deployScript.indexOf('MIGRATION_BASELINE');
    const codePull = deployScript.indexOf('git pull origin master');
    const quadletUpdate = deployScript.indexOf('cp "$REPO_DIR/deploy/quadlet/metakip.pod"');
    const imageBuild = deployScript.indexOf('podman build -t localhost/metakip-api:latest');
    const serviceStop = deployScript.indexOf('systemctl --user stop');

    expect(compatibilityCheck).toBeGreaterThan(-1);
    expect(codePull).toBeGreaterThan(compatibilityCheck);
    expect(quadletUpdate).toBeGreaterThan(compatibilityCheck);
    expect(imageBuild).toBeGreaterThan(compatibilityCheck);
    expect(serviceStop).toBeGreaterThan(compatibilityCheck);
    expect(deployScript).toContain('20260708053035_init');
    expect(deployScript).toContain('podman volume exists postgres-data');
  });

  it('bootstraps deployment checks from the target revision', () => {
    const deploymentGuide = readFileSync(deploymentGuidePath, 'utf8');
    const fetch = deploymentGuide.indexOf('git fetch origin master');
    const extractScript = deploymentGuide.indexOf(
      'git show origin/master:deploy/deploy.sh > /tmp/metakip-deploy.sh',
    );
    const executeScript = deploymentGuide.indexOf('bash /tmp/metakip-deploy.sh');

    expect(fetch).toBeGreaterThan(-1);
    expect(extractScript).toBeGreaterThan(fetch);
    expect(executeScript).toBeGreaterThan(extractScript);
  });

  it('enforces one link share and numeric page ordering values', () => {
    const integrityMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_enforce_share_and_position_integrity'),
    );
    expect(integrityMigration, 'integrity migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(integrityMigration ?? '');
    expect(migrationSql).toContain('shares_link_unique');
    expect(migrationSql).toContain('folders_position_numeric_check');
    expect(migrationSql).toContain('pages_position_numeric_check');
    expect(migrationSql).toContain('char_length("position") <= 128');
    expect(migrationSql.indexOf('DELETE FROM shares')).toBeLessThan(
      migrationSql.indexOf('CREATE UNIQUE INDEX "shares_link_unique"'),
    );
  });

  it('prevents writes from racing into deleted folder subtrees', () => {
    const parentGuardMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_prevent_writes_under_deleted_folders'),
    );
    expect(parentGuardMigration, 'active parent migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(parentGuardMigration ?? '');
    expect(migrationSql).toContain('ensure_active_folder_parent');
    expect(migrationSql).toContain('folders_active_parent_trigger');
    expect(migrationSql).toContain('pages_active_parent_trigger');
    expect(migrationSql).toContain('UPDATE OF parent_id, is_deleted');
    expect(migrationSql).toContain('FOR SHARE');
  });

  it('repairs active descendants left below legacy deleted folders', () => {
    const remediationMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_remediate_deleted_folder_descendants'),
    );
    expect(remediationMigration, 'deleted descendant remediation is missing').toBeDefined();

    const migrationSql = readMigrationSql(remediationMigration ?? '');
    expect(migrationSql).toContain('nearest_deleted_ancestor');
    expect(migrationSql).toContain('UPDATE folders descendant');
    expect(migrationSql).toContain('UPDATE pages page');
    expect(migrationSql).toContain('ORDER BY descendant.id, path.depth ASC');
    expect(migrationSql).toContain('deletion_batch_id = nearest.deletion_batch_id');
  });

  it('evaluates canonical permission wrappers at statement time', () => {
    const statementTimeMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_use_statement_time_for_permission_wrappers'),
    );
    expect(statementTimeMigration, 'statement-time permission migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(statementTimeMigration ?? '');
    const wrappers = [
      'get_effective_page_permission',
      'get_effective_folder_permission',
      'get_page_base_permissions',
      'get_accessible_page_ids',
    ];

    for (const wrapper of wrappers) {
      expect(migrationSql).toContain(`CREATE OR REPLACE FUNCTION ${wrapper}(`);
      expect(migrationSql).toContain(`FROM ${wrapper}_at(`);
    }

    expect(migrationSql.match(/statement_timestamp\(\)/g)).toHaveLength(wrappers.length);
    expect(migrationSql).not.toMatch(/\bNOW\(\)/i);
  });

  it('removes sharing-time permission variants with the simplified access model', () => {
    const simplificationMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_simplify_public_access'),
    );
    expect(
      simplificationMigration,
      'public access simplification migration is missing',
    ).toBeDefined();

    const migrationSql = readMigrationSql(simplificationMigration ?? '');
    expect(migrationSql).toContain(
      'DROP FUNCTION IF EXISTS get_effective_page_permission_at(uuid, uuid, timestamptz)',
    );
    expect(migrationSql).toContain(
      'DROP FUNCTION IF EXISTS get_page_base_permissions_at(uuid, timestamptz)',
    );
    expect(migrationSql).not.toMatch(/CREATE FUNCTION get_[a-z_]+_at\(/);
    expect(migrationSql).not.toContain('p_as_of');
    expect(migrationSql).toContain('CREATE FUNCTION get_effective_page_permission(');
    expect(migrationSql).toContain('CREATE FUNCTION get_enumerable_folder_ids(');
  });

  it('invalidates legacy folder-link provenance before enabling folder enumeration', () => {
    const enumerationMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_enumerable_folder_ids'),
    );
    expect(enumerationMigration, 'enumerable folder migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(enumerationMigration ?? '');
    const provenanceReset = migrationSql.indexOf('DELETE FROM "folder_access_events"');
    expect(provenanceReset).toBeGreaterThan(-1);
    expect(provenanceReset).toBeLessThan(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION get_enumerable_folder_ids_at'),
    );
  });

  it('repairs legacy page titles before enforcing the collaboration limit', () => {
    const titleMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_enforce_page_title_length'),
    );
    expect(titleMigration, 'page title migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(titleMigration ?? '');
    const remediation = migrationSql.indexOf('SET "title" = left("title", 250)');
    const constraint = migrationSql.indexOf('ADD CONSTRAINT "pages_title_length_check"');
    expect(remediation).toBeGreaterThan(-1);
    expect(migrationSql).toContain('"title_search" = to_tsvector');
    expect(constraint).toBeGreaterThan(remediation);
  });

  it('repairs legacy admin links before enforcing public-link permissions', () => {
    const linkMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_enforce_public_link_permissions'),
    );
    expect(linkMigration, 'public link permission migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(linkMigration ?? '');
    const remediation = migrationSql.indexOf('WHERE "token" IS NOT NULL');
    const constraint = migrationSql.indexOf('ADD CONSTRAINT "shares_public_link_permission_check"');
    expect(remediation).toBeGreaterThan(-1);
    expect(migrationSql).toContain('UPDATE "page_access_events"');
    expect(migrationSql).toContain('UPDATE "folder_access_events"');
    expect(constraint).toBeGreaterThan(remediation);
  });

  it('repairs legacy version titles before enforcing the snapshot limit', () => {
    const versionTitleMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_enforce_page_version_title_length'),
    );
    expect(versionTitleMigration, 'page version title migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(versionTitleMigration ?? '');
    const remediation = migrationSql.indexOf('SET "title" = left("title", 250)');
    const constraint = migrationSql.indexOf('ADD CONSTRAINT "page_versions_title_length_check"');
    expect(remediation).toBeGreaterThan(-1);
    expect(constraint).toBeGreaterThan(remediation);

    const snapshot = readFileSync(
      resolve(drizzleDir, versionTitleMigration ?? '', 'snapshot.json'),
      'utf8',
    );
    expect(snapshot).toContain('page_versions_title_length_check');
  });

  it('installs durable globally ordered workspace access revisions', () => {
    const revisionMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_add_workspace_access_versions'),
    );
    expect(revisionMigration, 'workspace access revision migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(revisionMigration ?? '');
    const table = migrationSql.indexOf('CREATE TABLE "workspace_access_versions"');
    const sequence = migrationSql.indexOf('CREATE SEQUENCE "workspace_access_revision_seq"');
    const backfill = migrationSql.indexOf('INSERT INTO "workspace_access_versions"');
    const revisionFunction = migrationSql.indexOf('FUNCTION get_page_access_revision');
    expect(table).toBeGreaterThan(-1);
    expect(sequence).toBeGreaterThan(table);
    expect(backfill).toBeGreaterThan(sequence);
    expect(revisionFunction).toBeGreaterThan(backfill);
    expect(migrationSql).toContain('SELECT MAX(version) FROM workspace_access_versions');
  });

  it('adds a dedicated monotonic page title revision', () => {
    const titleRevisionMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_add_page_title_revision'),
    );
    expect(titleRevisionMigration, 'page title revision migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(titleRevisionMigration ?? '');
    expect(migrationSql).toContain('ADD COLUMN "title_revision" bigint DEFAULT 0 NOT NULL');
    const snapshot = readFileSync(
      resolve(drizzleDir, titleRevisionMigration ?? '', 'snapshot.json'),
      'utf8',
    );
    expect(snapshot).toContain('title_revision');
  });

  it('enforces title revision monotonicity inside PostgreSQL', () => {
    const triggerMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_enforce_page_title_revision'),
    );
    expect(triggerMigration, 'page title revision trigger migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(triggerMigration ?? '');
    expect(migrationSql).toContain('FUNCTION "enforce_page_title_revision"');
    expect(migrationSql).toContain('NEW."title" IS DISTINCT FROM OLD."title"');
    expect(migrationSql).toContain('NEW."title_revision" <= OLD."title_revision"');
    expect(migrationSql).toContain('BEFORE UPDATE OF "title", "title_revision" ON "pages"');
  });

  it('does not reintroduce the legacy access restriction column', () => {
    const migrationDirs = listMigrationDirs();
    const migrationText = migrationDirs.map(readMigrationSql).join('\n');

    expect(migrationText).not.toContain('is_access_restricted');
  });

  it('keeps sharing helpers tied to inheritance_policy', () => {
    const helpersMigration = listMigrationDirs().find((dirName) =>
      dirName.endsWith('_sharing_helpers'),
    );
    expect(helpersMigration, 'sharing helper migration is missing').toBeDefined();

    const migrationSql = readMigrationSql(helpersMigration ?? '');
    const requiredHelpers = [
      'is_folder_inheritance_blocked',
      'is_folder_path_restricted',
      'is_page_path_restricted',
      'is_page_folder_inheritance_blocked',
      'get_effective_page_permission',
      'get_effective_folder_permission',
      'get_page_base_permissions',
      'get_accessible_page_ids',
    ];

    for (const helper of requiredHelpers) {
      expect(migrationSql).toContain(helper);
    }

    expect(migrationSql).toContain('inheritance_policy');
    expect(migrationSql).not.toContain('is_access_restricted');
  });
});
