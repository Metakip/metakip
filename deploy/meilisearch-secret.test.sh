#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/meilisearch-secret.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

missing_key_file="$tmp_dir/missing-key.env"
printf 'DATABASE_URL=postgresql://localhost/metakip\n' > "$missing_key_file"
ensureMeilisearchUrl "$missing_key_file"
ensureMeilisearchMasterKey "$missing_key_file"
grep -qx 'MEILISEARCH_URL=http://127.0.0.1:7700' "$missing_key_file"
generated_key=$(awk -F= '$1 == "MEILI_MASTER_KEY" { print $2 }' "$missing_key_file")
test "${#generated_key}" -eq 64
test "$(stat -c '%a' "$missing_key_file")" -eq 600

placeholder_file="$tmp_dir/placeholder.env"
printf 'MEILI_MASTER_KEY=replace-with-secure-meilisearch-key\n' > "$placeholder_file"
ensureMeilisearchMasterKey "$placeholder_file"
test "$(awk -F= '$1 == "MEILI_MASTER_KEY" { print length($2) }' "$placeholder_file")" -eq 64

custom_url_file="$tmp_dir/custom-url.env"
printf 'MEILISEARCH_URL=https://search.internal\n' > "$custom_url_file"
ensureMeilisearchUrl "$custom_url_file"
grep -qx 'MEILISEARCH_URL=https://search.internal' "$custom_url_file"

duplicate_file="$tmp_dir/duplicate.env"
printf 'MEILI_MASTER_KEY=%064d\nMEILI_MASTER_KEY=%064d\n' 0 1 > "$duplicate_file"
if ensureMeilisearchMasterKey "$duplicate_file" 2>/dev/null; then
    echo "Expected duplicate MEILI_MASTER_KEY values to fail" >&2
    exit 1
fi

short_key_file="$tmp_dir/short-key.env"
printf 'MEILI_MASTER_KEY=short\n' > "$short_key_file"
if ensureMeilisearchMasterKey "$short_key_file" 2>/dev/null; then
    echo "Expected a short MEILI_MASTER_KEY to fail" >&2
    exit 1
fi
