#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_script="$SCRIPT_DIR/deploy.sh"

pull_line=$(grep -n '^git pull origin master$' "$deploy_script" | cut -d: -f1)
source_line=$(grep -n '^\. .*collaboration-secret\.sh"$' "$deploy_script" | cut -d: -f1)
editor_migration_source_line=$(
    grep -n '^\. .*migrate-editor-content\.sh"$' "$deploy_script" | cut -d: -f1
)
editor_migration_call_line=$(grep -n '^migrateEditorContent "\$REPO_DIR"$' "$deploy_script" | cut -d: -f1)
bundle_swap_line=$(grep -n '^mv "\$REPO_DIR/packages/web/dist.next" "\$REPO_DIR/packages/web/dist"$' "$deploy_script" | cut -d: -f1)

test -n "$pull_line"
test -n "$source_line"
test -n "$editor_migration_source_line"
test -n "$editor_migration_call_line"
test -n "$bundle_swap_line"
test "$source_line" -gt "$pull_line"
test "$editor_migration_source_line" -gt "$pull_line"
test "$editor_migration_call_line" -lt "$bundle_swap_line"
! grep -q '^\. .*deploy/migrations/' "$deploy_script"
! grep -q 'migratePostgresIdentifiers\|ensureUploadsVolume\|UPDATE_HOSTED_CADDY' "$deploy_script"
grep -Fqx 'HealthCmd=CMD-SHELL pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}' \
    "$SCRIPT_DIR/quadlet/metakip-postgres.container"

bash "$SCRIPT_DIR/migrate-editor-content.unit.test.sh"
bash "$SCRIPT_DIR/migrations/markdawn-to-metakip.unit.test.sh"
