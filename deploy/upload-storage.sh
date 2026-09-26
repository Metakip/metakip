#!/bin/bash

readUploadEnvironmentValues() {
    local env_file=$1
    local name=$2
    awk -v key="$name" '
        $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
            value = $0
            sub("^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=[[:space:]]*", "", value)
            sub(/[[:space:]]+$/, "", value)
            print value
        }
    ' "$env_file"
}

normalizeUploadEnvironmentValue() {
    local value=$1
    if [[ "$value" == \"* ]]; then
        value=${value#\"}
        value=${value%%\"*}
    elif [[ "$value" == \'* ]]; then
        value=${value#\'}
        value=${value%%\'*}
    else
        value=${value%%#*}
        while [[ "$value" == *[[:space:]] ]]; do
            value=${value%?}
        done
    fi
    printf '%s' "$value"
}

migrateUploadStorage() {
    local env_file=${1:-.env}
    if [ ! -f "$env_file" ]; then
        echo "Upload storage migration requires an existing environment file: $env_file" >&2
        return 1
    fi

    local storage_count
    storage_count=$(readUploadEnvironmentValues "$env_file" UPLOAD_STORAGE | awk 'END { print NR }')
    if [ "$storage_count" -eq 0 ]; then
        printf '\n# Upload storage (preserves the filesystem backend used before R2 support)\nUPLOAD_STORAGE=local\n' >> "$env_file"
        echo "Added UPLOAD_STORAGE=local to $env_file for the existing upload volume."
    fi
}

ensureUploadStorage() {
    local env_file=${1:-.env}
    if [ ! -f "$env_file" ]; then
        echo "Upload storage validation requires an existing environment file: $env_file" >&2
        return 1
    fi

    local storage_values storage_backend
    mapfile -t storage_values < <(readUploadEnvironmentValues "$env_file" UPLOAD_STORAGE)
    if [ "${#storage_values[@]}" -ne 1 ]; then
        echo "UPLOAD_STORAGE must be defined exactly once in $env_file" >&2
        return 1
    fi
    storage_backend=$(normalizeUploadEnvironmentValue "${storage_values[0]}")
    if [ "$storage_backend" = "local" ]; then
        return 0
    fi
    if [ "$storage_backend" != "r2" ]; then
        echo "UPLOAD_STORAGE must be set to local or r2 in $env_file" >&2
        return 1
    fi

    local names=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET)
    local name values value
    for name in "${names[@]}"; do
        mapfile -t values < <(readUploadEnvironmentValues "$env_file" "$name")
        if [ "${#values[@]}" -ne 1 ]; then
            echo "$name must be defined exactly once in $env_file" >&2
            return 1
        fi
        value=$(normalizeUploadEnvironmentValue "${values[0]}")
        if [ -z "$value" ] || [[ "$value" == your-* ]]; then
            echo "$name must contain a real Cloudflare R2 value in $env_file" >&2
            echo "Create a private R2 bucket and an API token with object read, write, and delete access." >&2
            return 1
        fi
    done
}
