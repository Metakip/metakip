#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT

export PATH="$temp_dir/bin:$PATH"
mkdir -p "$temp_dir/bin"
cat > "$temp_dir/bin/pnpm" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$MIGRATION_TEST_LOG"
EOF
chmod +x "$temp_dir/bin/pnpm"
export MIGRATION_TEST_LOG="$temp_dir/pnpm.log"

# shellcheck source=migrate-editor-content.sh
. "$SCRIPT_DIR/migrate-editor-content.sh"

migrateEditorContent "$temp_dir"

test "$(wc -l < "$MIGRATION_TEST_LOG")" -eq 1
grep -q -- '--filter @metakip/api db:migrate-editor-content' "$MIGRATION_TEST_LOG"
