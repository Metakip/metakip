#!/bin/bash

INVITATION_TOKEN_DEVELOPMENT_KEY='development-only-invitation-token-key-0123456789abcdef'

ensureInvitationTokenEncryptionKey() {
    local env_file="$1"
    local -a keys
    local key
    local normalized_key

    if [ ! -f "$env_file" ]; then
        echo "Invitation token encryption key validation requires an existing environment file: $env_file" >&2
        return 1
    fi

    mapfile -t keys < <(awk -F= '$1 == "INVITATION_TOKEN_ENCRYPTION_KEY" { print substr($0, index($0, "=") + 1) }' "$env_file")
    if [ "${#keys[@]}" -gt 1 ]; then
        echo "INVITATION_TOKEN_ENCRYPTION_KEY must be defined at most once in $env_file" >&2
        return 1
    fi

    if [ "${#keys[@]}" -eq 0 ]; then
        key="$(openssl rand -hex 32)" || {
            echo "Could not generate INVITATION_TOKEN_ENCRYPTION_KEY" >&2
            return 1
        }
        if ! printf '\nINVITATION_TOKEN_ENCRYPTION_KEY=%s\n' "$key" >> "$env_file"; then
            echo "Could not write INVITATION_TOKEN_ENCRYPTION_KEY to $env_file" >&2
            return 1
        fi
        if ! chmod 600 "$env_file"; then
            echo "Could not secure environment file permissions: $env_file" >&2
            return 1
        fi
        return 0
    fi

    key="${keys[0]}"
    if [ -z "$key" ]; then
        local generated_key
        local temporary_file

        generated_key="$(openssl rand -hex 32)" || {
            echo "Could not generate INVITATION_TOKEN_ENCRYPTION_KEY" >&2
            return 1
        }
        temporary_file="$(mktemp "${env_file}.XXXXXX")" || {
            echo "Could not create a temporary file beside $env_file" >&2
            return 1
        }
        if ! awk -F= -v replacement="$generated_key" '
            $1 == "INVITATION_TOKEN_ENCRYPTION_KEY" && !replaced {
                print "INVITATION_TOKEN_ENCRYPTION_KEY=" replacement
                replaced = 1
                next
            }
            { print }
            END { if (!replaced) exit 1 }
        ' "$env_file" > "$temporary_file"; then
            rm -f "$temporary_file"
            echo "Could not replace the empty invitation token key in $env_file" >&2
            return 1
        fi
        if ! chmod 600 "$temporary_file"; then
            rm -f "$temporary_file"
            echo "Could not secure temporary environment file permissions" >&2
            return 1
        fi
        if ! mv -f "$temporary_file" "$env_file"; then
            rm -f "$temporary_file"
            echo "Could not update $env_file with the generated invitation token key" >&2
            return 1
        fi
        return 0
    fi

    normalized_key="${key#\"}"
    normalized_key="${normalized_key%\"}"
    normalized_key="${normalized_key#\'}"
    normalized_key="${normalized_key%\'}"

    if [ "${#normalized_key}" -lt 32 ]; then
        echo "INVITATION_TOKEN_ENCRYPTION_KEY must be at least 32 characters. Replace it with: openssl rand -hex 32" >&2
        return 1
    fi

    if [ "$normalized_key" = "$INVITATION_TOKEN_DEVELOPMENT_KEY" ]; then
        echo "INVITATION_TOKEN_ENCRYPTION_KEY must not use the development value for deployment" >&2
        return 1
    fi
}
