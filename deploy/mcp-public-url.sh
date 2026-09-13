#!/bin/bash

ensureMcpPublicUrl() {
    local env_file="$1"
    local -a configured_values
    local configured

    if ! grep -Eq '^[[:space:]]*MCP_PUBLIC_URL[[:space:]]*=' "$env_file"; then
        printf '\nMCP_PUBLIC_URL=https://mcp.metakip.com\n' >> "$env_file"
        echo -e "${YELLOW}[CHECK] Provisioned MCP_PUBLIC_URL in ${env_file}.${NC}"
    fi

    mapfile -t configured_values < <(awk -F= '
        /^[[:space:]]*MCP_PUBLIC_URL[[:space:]]*=/ {
            value = $0
            sub(/^[[:space:]]*MCP_PUBLIC_URL[[:space:]]*=[[:space:]]*/, "", value)
            print value
        }
    ' "$env_file")
    if [ "${#configured_values[@]}" -gt 1 ]; then
        echo "MCP_PUBLIC_URL must be defined at most once in $env_file" >&2
        return 1
    fi

    configured="${configured_values[0]-}"
    configured="${configured#\"}"
    configured="${configured%\"}"
    configured="${configured#\'}"
    configured="${configured%\'}"
    if [ -z "$configured" ]; then
        echo -e "${RED}[ERROR] MCP_PUBLIC_URL is empty in ${env_file}; refusing to restart services.${NC}"
        exit 1
    fi

    if ! MCP_PUBLIC_URL="$configured" pnpm exec tsx "$REPO_DIR/scripts/validate-mcp-public-url.ts"
    then
        echo -e "${RED}[ERROR] MCP_PUBLIC_URL must be a valid public HTTPS URL; refusing to restart services.${NC}"
        exit 1
    fi
}
