#!/bin/bash

ensureMeilisearchUrl() {
    local env_file="$1"
    local -a urls
    local url

    if [ ! -f "$env_file" ]; then
        echo "Meilisearch URL configuration requires an existing environment file: $env_file" >&2
        return 1
    fi

    mapfile -t urls < <(awk -F= '$1 == "MEILISEARCH_URL" { print substr($0, index($0, "=") + 1) }' "$env_file")
    if [ "${#urls[@]}" -gt 1 ]; then
        echo "MEILISEARCH_URL must be defined at most once in $env_file" >&2
        return 1
    fi
    url="${urls[0]-}"
    if [ -z "$url" ]; then
        if [ "${#urls[@]}" -eq 0 ]; then
            printf '\nMEILISEARCH_URL=http://127.0.0.1:7700\n' >> "$env_file" || return 1
        else
            local temporary_file
            temporary_file="$(mktemp "${env_file}.XXXXXX")" || return 1
            if ! awk -F= '
                $1 == "MEILISEARCH_URL" && !replaced {
                    print "MEILISEARCH_URL=http://127.0.0.1:7700"
                    replaced = 1
                    next
                }
                { print }
                END { if (!replaced) exit 1 }
            ' "$env_file" > "$temporary_file"; then
                rm -f "$temporary_file"
                echo "Could not set MEILISEARCH_URL in $env_file" >&2
                return 1
            fi
            chmod 600 "$temporary_file" || { rm -f "$temporary_file"; return 1; }
            mv -f "$temporary_file" "$env_file" || return 1
        fi
        chmod 600 "$env_file" || return 1
        return 0
    fi

    case "$url" in
        http://*|https://*) ;;
        *) echo "MEILISEARCH_URL must use HTTP or HTTPS" >&2; return 1 ;;
    esac
}

ensureMeilisearchMasterKey() {
    local env_file="$1"
    local -a keys
    local key
    local normalized_key

    if [ ! -f "$env_file" ]; then
        echo "Meilisearch master key validation requires an existing environment file: $env_file" >&2
        return 1
    fi

    mapfile -t keys < <(awk -F= '$1 == "MEILI_MASTER_KEY" { print substr($0, index($0, "=") + 1) }' "$env_file")
    if [ "${#keys[@]}" -gt 1 ]; then
        echo "MEILI_MASTER_KEY must be defined at most once in $env_file" >&2
        return 1
    fi

    key="${keys[0]-}"
    if [ -z "$key" ] || [ "$key" = "replace-with-secure-meilisearch-key" ]; then
        local generated_key
        generated_key="$(openssl rand -hex 32)" || {
            echo "Could not generate MEILI_MASTER_KEY" >&2
            return 1
        }
        if [ "${#keys[@]}" -eq 0 ]; then
            printf '\nMEILI_MASTER_KEY=%s\n' "$generated_key" >> "$env_file" || return 1
        else
            local temporary_file
            temporary_file="$(mktemp "${env_file}.XXXXXX")" || return 1
            if ! awk -F= -v replacement="$generated_key" '
                $1 == "MEILI_MASTER_KEY" && !replaced {
                    print "MEILI_MASTER_KEY=" replacement
                    replaced = 1
                    next
                }
                { print }
                END { if (!replaced) exit 1 }
            ' "$env_file" > "$temporary_file"; then
                rm -f "$temporary_file"
                echo "Could not replace MEILI_MASTER_KEY in $env_file" >&2
                return 1
            fi
            chmod 600 "$temporary_file" || { rm -f "$temporary_file"; return 1; }
            mv -f "$temporary_file" "$env_file" || return 1
        fi
        chmod 600 "$env_file" || return 1
        return 0
    fi

    normalized_key="${key#\"}"
    normalized_key="${normalized_key%\"}"
    normalized_key="${normalized_key#\'}"
    normalized_key="${normalized_key%\'}"
    if [ "${#normalized_key}" -lt 32 ]; then
        echo "MEILI_MASTER_KEY must be at least 32 characters. Replace it with: openssl rand -hex 32" >&2
        return 1
    fi
}
