#!/bin/sh
set -eu

repository_root=$(cd "$(dirname "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/metakip-cli-e2e.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM

install_dir="$test_root/install"
state_dir="$test_root/state"
config_dir="$test_root/config"
profile="$test_root/profile"
mkdir -p "$install_dir" "$state_dir" "$config_dir"
go -C "$repository_root/cli" build -trimpath -o "$install_dir/metakip" .
printf '%s\n' 'before' '# >>> metakip >>>' "export PATH=\"$install_dir:\$PATH\"" '# <<< metakip <<<' 'after' >"$profile"
cp "$profile" "$test_root/profile-before"
printf '%s\n' '{"baseUrl":"https://app.metakip.com","token":"secret"}' >"$config_dir/config.json"
cat >"$state_dir/install.json" <<EOF
{
  "schemaVersion": 1,
  "installMethod": "standalone",
  "installDir": "$install_dir",
  "binaryPath": "$install_dir/metakip",
  "pathFile": "$profile"
}
EOF

METAKIP_INSTALL_STATE_DIR="$state_dir" METAKIP_CONFIG_DIR="$config_dir" \
  "$install_dir/metakip" uninstall --purge --yes

[ ! -e "$install_dir/metakip" ] || { printf '%s\n' 'standalone CLI E2E: binary was not removed' >&2; exit 1; }
[ ! -e "$state_dir/install.json" ] || { printf '%s\n' 'standalone CLI E2E: receipt was not removed' >&2; exit 1; }
[ ! -e "$config_dir/config.json" ] || { printf '%s\n' 'standalone CLI E2E: config was not removed' >&2; exit 1; }
cmp -s "$profile" "$test_root/profile-before" || { printf '%s\n' 'standalone CLI E2E: shell profile was changed' >&2; exit 1; }
