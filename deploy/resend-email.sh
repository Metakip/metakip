#!/bin/bash

ensureResendEmailConfiguration() {
    local env_file="$1"
    local -a keys
    local key
    local normalized_key

    if [ ! -f "$env_file" ]; then
        echo "Resend email validation requires an existing environment file: $env_file" >&2
        return 1
    fi

    mapfile -t keys < <(awk -F= '$1 == "RESEND_API_KEY" { print substr($0, index($0, "=") + 1) }' "$env_file")
    if [ "${#keys[@]}" -ne 1 ]; then
        echo "RESEND_API_KEY must be defined exactly once in $env_file" >&2
        return 1
    fi

    key="${keys[0]}"
    normalized_key="${key#\"}"
    normalized_key="${normalized_key%\"}"
    normalized_key="${normalized_key#\'}"
    normalized_key="${normalized_key%\'}"
    if [ -z "$normalized_key" ] || [ "$normalized_key" = "your-resend-api-key" ]; then
        echo "RESEND_API_KEY must contain a real Resend API key" >&2
        return 1
    fi
}
