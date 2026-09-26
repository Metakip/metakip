#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=upload-storage.sh
. "$SCRIPT_DIR/upload-storage.sh"

env_file=$(mktemp)
trap 'rm -f "$env_file"' EXIT

printf '%s\n' 'NODE_ENV=production' > "$env_file"
migrateUploadStorage "$env_file"
if [ "$(grep -c '^UPLOAD_STORAGE=local$' "$env_file")" -ne 1 ]; then
    echo 'expected a missing upload backend to migrate to local storage' >&2
    exit 1
fi
ensureUploadStorage "$env_file"

printf '%s\n' \
    'UPLOAD_STORAGE=r2' \
    'R2_ACCOUNT_ID=account' \
    'R2_ACCESS_KEY_ID=access' \
    'R2_SECRET_ACCESS_KEY=secret' \
    'R2_BUCKET=uploads' > "$env_file"
ensureUploadStorage "$env_file"

printf '%s\n' 'UPLOAD_STORAGE=r2' 'R2_ACCOUNT_ID=account' > "$env_file"
if ensureUploadStorage "$env_file" 2>/dev/null; then
    echo 'expected incomplete R2 configuration to fail' >&2
    exit 1
fi

printf '%s\n' \
    'UPLOAD_STORAGE=r2' \
    'R2_ACCOUNT_ID=your-cloudflare-account-id' \
    'R2_ACCESS_KEY_ID=access' \
    'R2_SECRET_ACCESS_KEY=secret' \
    'R2_BUCKET=uploads' > "$env_file"
if ensureUploadStorage "$env_file" 2>/dev/null; then
    echo 'expected placeholder R2 configuration to fail' >&2
    exit 1
fi

printf '%s\n' 'UPLOAD_STORAGE=local' > "$env_file"
ensureUploadStorage "$env_file"

printf '%s\n' '  export UPLOAD_STORAGE = "local" # keep local uploads' > "$env_file"
migrateUploadStorage "$env_file"
if [ "$(grep -c 'UPLOAD_STORAGE' "$env_file")" -ne 1 ]; then
    echo 'expected spaced and quoted upload storage to remain a single setting' >&2
    exit 1
fi
ensureUploadStorage "$env_file"

printf '%s\n' \
    "UPLOAD_STORAGE='r2'" \
    'R2_ACCOUNT_ID="account"' \
    "R2_ACCESS_KEY_ID='access'" \
    'R2_SECRET_ACCESS_KEY="secret"' \
    "R2_BUCKET='uploads'" > "$env_file"
ensureUploadStorage "$env_file"

printf '%s\n' \
    'UPLOAD_STORAGE="r2"' \
    'R2_ACCOUNT_ID="your-cloudflare-account-id"' \
    'R2_ACCESS_KEY_ID=access' \
    'R2_SECRET_ACCESS_KEY=secret' \
    'R2_BUCKET=uploads' > "$env_file"
if ensureUploadStorage "$env_file" 2>/dev/null; then
    echo 'expected a quoted placeholder R2 configuration to fail' >&2
    exit 1
fi
