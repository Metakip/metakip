#!/bin/sh
set -eu

repository="Metakip/metakip"
install_dir="${METAKIP_INSTALL_DIR:-$HOME/.metakip/bin}"
requested_version="${METAKIP_VERSION:-}"
modify_path="${METAKIP_MODIFY_PATH:-1}"
install_skill="${METAKIP_INSTALL_SKILL:-}"
http_timeout="${METAKIP_HTTP_TIMEOUT_SECONDS:-}"
max_release_archive_bytes=268435456
max_release_archive_entries=1024
path_block_start='# >>> metakip >>>'
path_block_end='# <<< metakip <<<'
command_color=''
color_reset=''
phase_color=''
phase_reset=''

if [ -t 1 ] && [ -z "${NO_COLOR+x}" ]; then
  command_color='\033[1;36m'
  color_reset='\033[0m'
fi
if [ -t 2 ] && [ -z "${NO_COLOR+x}" ]; then
  phase_color='\033[1;36m'
  phase_reset='\033[0m'
fi

phase() {
  printf '%b==>%b %s\n' "$phase_color" "$phase_reset" "$*" >&2
}

fail() {
  printf '%s\n' "Error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Command $1 is required."
}

for argument in "$@"; do
  case "$argument" in
    --modify-path) modify_path=1 ;;
    --no-modify-path) modify_path=0 ;;
    --install-skill) install_skill=global ;;
    --install-skill=global) install_skill=global ;;
    --install-skill=project) install_skill=project ;;
    --help)
      cat <<'EOF'
Usage: curl -fsSL https://metakip.com/install.sh | sh

Options:
  --modify-path          Add the install directory to PATH (the default).
  --no-modify-path       Leave PATH unchanged.
  --install-skill[=SCOPE]  Install the agent skill with npx skills (global or project).

Environment:
  METAKIP_VERSION      Install a version such as v1.2.3.
  METAKIP_INSTALL_DIR  Install into this directory.
  METAKIP_MODIFY_PATH  Set to 0 to leave your shell PATH unchanged (default: 1).
  METAKIP_INSTALL_SKILL  Set to global or project to install the optional agent skill.
  METAKIP_INSTALL_STATE_DIR  Override the standalone receipt directory.
  METAKIP_HTTP_TIMEOUT_SECONDS  Set a positive download timeout in seconds.
EOF
      exit 0
      ;;
    *) fail "Unknown argument: $argument." ;;
  esac
done

case "$modify_path" in
  0 | 1) ;;
  *) fail "METAKIP_MODIFY_PATH must be 0 or 1." ;;
esac
case "$install_skill" in
  "" | 0 | global | project) ;;
  *) fail "METAKIP_INSTALL_SKILL must be global, project, or 0." ;;
esac

require_command curl
require_command tar
require_command mktemp
require_command grep
require_command awk
require_command mv
require_command cp
require_command sed
require_command wc
require_command head

validate_json_string() {
  value=$1
  label=$2
  case "$value" in
    *'
'*) fail "The $label must not contain a newline." ;;
  esac
  if printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    fail "The $label must not contain JSON control characters."
  fi
}

if [ -n "$requested_version" ]; then
  printf '%s' "$requested_version" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' || fail "METAKIP_VERSION must be a semantic version such as v1.2.3."
fi
if [ -n "$http_timeout" ]; then
  printf '%s' "$http_timeout" | grep -Eq '^[1-9][0-9]*$' || fail "METAKIP_HTTP_TIMEOUT_SECONDS must be a positive integer."
fi
path_file=""
path_style=""
unsupported_shell=""
if [ "$modify_path" = 1 ]; then
  case "$(basename "${SHELL:-sh}")" in
    fish) path_file="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"; path_style=fish ;;
    zsh) path_file="$HOME/.zshrc"; path_style=sh ;;
    bash) path_file="$HOME/.bashrc"; path_style=sh ;;
    sh | dash | ash | ksh | mksh | yash) path_file="$HOME/.profile"; path_style=sh ;;
    *) unsupported_shell=$(basename "${SHELL:-sh}"); modify_path=0 ;;
  esac
fi
if [ "$modify_path" = 1 ]; then
  validate_json_string "$path_file" "shell configuration path"
  case "$path_file" in
    /*) ;;
    *) fail "Shell configuration path must be absolute." ;;
  esac
fi
case "$install_dir" in
  /*) ;;
  *) install_dir="$(pwd -P)/$install_dir" ;;
esac
validate_json_string "$install_dir" "METAKIP_INSTALL_DIR"
if [ "$modify_path" = 1 ]; then
  case "$install_dir" in
    *:*) fail "METAKIP_INSTALL_DIR must not contain : when --modify-path is enabled." ;;
  esac
fi

state_dir="${METAKIP_INSTALL_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/metakip}"
case "$state_dir" in
  /*) ;;
  *) state_dir="$(pwd -P)/$state_dir" ;;
esac
validate_json_string "$state_dir" "METAKIP_INSTALL_STATE_DIR"
receipt_path="$state_dir/install.json"

case "$(uname -s)" in
  Linux) goos=linux ;;
  Darwin) goos=darwin ;;
  *) fail "Unsupported operating system: $(uname -s)." ;;
esac
if [ "$goos" = linux ] && [ -r /proc/sys/kernel/osrelease ] && grep -qi microsoft /proc/sys/kernel/osrelease; then
  case "$install_dir" in
    /mnt/*) printf '%s\n' "Warning: installs under /mnt use Windows filesystem semantics; a path in the WSL Linux home directory is recommended." >&2 ;;
  esac
fi

machine=$(uname -m)
if [ "$goos" = darwin ] && [ "$machine" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  machine=arm64
fi
case "$machine" in
  x86_64 | amd64) goarch=amd64 ;;
  aarch64 | arm64) goarch=arm64 ;;
  *) fail "Unsupported architecture: $machine." ;;
esac

if [ -n "$requested_version" ]; then
  version=${requested_version#v}
  archive="metakip_${version}_${goos}_${goarch}.tar.gz"
  download_base="https://github.com/$repository/releases/download/cli/v$version"
else
  archive="metakip_${goos}_${goarch}.tar.gz"
  download_base="https://github.com/$repository/releases/latest/download"
fi

temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/metakip.XXXXXX")
finalizer_binary=""
cleanup() {
	status=$?
	cleanup_failed=0
	set +e
	if [ -n "$finalizer_binary" ]; then
		rm -f "$finalizer_binary" || { printf '%s\n' "Error: Could not remove temporary finalizer." >&2; cleanup_failed=1; }
	fi
	rm -rf "$temporary_dir" || { printf '%s\n' "Error: Could not remove temporary download directory." >&2; cleanup_failed=1; }
	trap - EXIT
	if [ "$cleanup_failed" = 1 ]; then
		exit 1
	fi
	exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
archive_path="$temporary_dir/$archive"
checksums_path="$temporary_dir/checksums.txt"

download_with_limit() {
  destination=$1
  url=$2
  limit=$3
  label=$4
  status_path="$temporary_dir/download-status"
  rm -f "$status_path"
  if [ -n "$http_timeout" ]; then
    if ! {
      if curl --fail --location --silent --show-error --max-filesize "$limit" --connect-timeout "$http_timeout" --max-time "$http_timeout" "$url"; then download_status=0; else download_status=$?; fi
      printf '%s\n' "$download_status" >"$status_path"
    } | head -c "$((limit + 1))" >"$destination"; then
      fail "Could not download $label."
    fi
  else
    if ! {
      if curl --fail --location --silent --show-error --max-filesize "$limit" "$url"; then download_status=0; else download_status=$?; fi
      printf '%s\n' "$download_status" >"$status_path"
    } | head -c "$((limit + 1))" >"$destination"; then
      fail "Could not download $label."
    fi
  fi
  [ -f "$status_path" ] || fail "Could not download $label."
  download_status=$(sed -n '1p' "$status_path")
  rm -f "$status_path"
  download_size=$(wc -c <"$destination")
  if [ "$download_size" -gt "$limit" ]; then
    fail "Download $label exceeds $limit bytes."
  fi
  if [ "$download_status" -ne 0 ]; then
    fail "Could not download $label."
  fi
}

download_asset() {
  destination=$1
  url=$2
  limit=$3
  label=$4
  phase "Downloading $label..."
  download_with_limit "$destination" "$url" "$limit" "$label"
}

download_asset "$archive_path" "$download_base/$archive" "$max_release_archive_bytes" "$archive"
download_asset "$checksums_path" "$download_base/checksums.txt" 1048576 "checksums.txt"

release_version=latest
[ -n "$requested_version" ] && release_version="v$version"

phase "Verifying Metakip CLI release..."
checksum_line=$(grep -F "  $archive" "$checksums_path" || true)
[ -n "$checksum_line" ] || fail "Checksums.txt does not contain $archive."
expected_checksum=${checksum_line%% *}
printf '%s' "$expected_checksum" | grep -Eq '^[0-9a-f]{64}$' || fail "Checksums.txt contains an invalid SHA-256 value for $archive."
[ "$checksum_line" = "$expected_checksum  $archive" ] || fail "Checksums.txt contains an invalid entry for $archive."
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum=$(sha256sum "$archive_path" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum=$(shasum -a 256 "$archive_path" | awk '{print $1}')
else
  fail "The sha256sum or shasum command is required."
fi
[ "$actual_checksum" = "$expected_checksum" ] || fail "SHA-256 verification failed for $archive."

extract_dir="$temporary_dir/extract"
mkdir -p "$extract_dir"
if ! tar -tvzf "$archive_path" | awk -v max_entries="$max_release_archive_entries" -v max_bytes="$max_release_archive_bytes" '
  {
    entries++
    if (entries > max_entries) exit 1
    size_field = ($2 ~ /^[0-9][0-9]*$/) ? $5 : $3
    if (size_field !~ /^[0-9][0-9]*$/) exit 1
    total += size_field
    if (total > max_bytes) exit 1
  }
  END { if (entries == 0) exit 1 }
'; then
  fail "Release archive exceeds validation limits."
fi
binary_member=$(tar -tzf "$archive_path" | awk -v max_entries="$max_release_archive_entries" '
  {
    entries++
    if (entries > max_entries) exit 1
    if ($0 == "metakip" || $0 == "./metakip") {
      matches++
      member = $0
    }
  }
  END {
    if (entries == 0 || entries > max_entries || matches != 1) exit 1
    print member
  }
') || fail "Release archive must contain exactly one Metakip binary."
phase "Extracting Metakip CLI..."
tar -xzf "$archive_path" -C "$extract_dir" "$binary_member" || fail "Could not extract Metakip from $archive."
binary_path="$extract_dir/metakip"
[ -f "$binary_path" ] && [ ! -L "$binary_path" ] || fail "Release archive does not contain a regular Metakip binary."
[ "$(wc -c <"$binary_path")" -le 134217728 ] || fail "Release binary exceeds 134217728 bytes."

if [ -e "$install_dir" ]; then
  [ -d "$install_dir" ] || fail "Install directory $install_dir exists and is not a directory."
else
  mkdir -p "$install_dir" || fail "Could not create install directory $install_dir."
  chmod 700 "$install_dir" || fail "Could not secure install directory $install_dir."
fi
finalizer_binary=$(mktemp "$install_dir/.metakip-finalize.XXXXXX") || fail "Could not stage standalone finalizer."
cp "$binary_path" "$finalizer_binary" || fail "Could not stage standalone finalizer."
chmod 700 "$finalizer_binary" || fail "Could not prepare standalone finalizer."

phase "Installing Metakip CLI..."
if [ "$modify_path" = 1 ]; then
  METAKIP_INSTALL_STATE_DIR="$state_dir" "$finalizer_binary" standalone-finalize --install-dir "$install_dir" --path-file "$path_file" --path-style "$path_style" || fail "Could not finalize standalone installation."
else
  METAKIP_INSTALL_STATE_DIR="$state_dir" "$finalizer_binary" standalone-finalize --install-dir "$install_dir" || fail "Could not finalize standalone installation."
fi
rm -f "$finalizer_binary" || fail "Could not remove standalone finalizer."
finalizer_binary=""

printf 'Metakip %s installed to %s/metakip.\n' "$release_version" "$install_dir"
if [ "$modify_path" = 1 ]; then
  printf '\nUpdated PATH configuration in %s.\n' "$path_file"
  printf '\nOpen a new terminal before running metakip.\n'
  printf '\nRun %bmetakip login%b to get started.\n' "$command_color" "$color_reset"
else
  if [ -n "$unsupported_shell" ]; then
    printf '\nPATH was not changed because %s is not a supported shell. Add Metakip to PATH using your shell\047s native startup-file syntax:\n  ' "$unsupported_shell"
  else
    printf '\nPATH was not changed. Add Metakip to PATH:\n  export PATH='
  fi
  printf "'"
  printf '%s' "$install_dir" | sed "s/'/'\\\\''/g" || fail "Could not render PATH instruction."
  if [ -n "$unsupported_shell" ]; then
    printf "\n"
  else
    printf "':\$PATH\n"
  fi
  printf '\nAfter adding Metakip to PATH, run %bmetakip login%b to get started.\n' "$command_color" "$color_reset"
fi
if [ "$install_skill" = global ]; then
  printf '\nInstalling Metakip agent skill globally with npx skills.\n'
  "$install_dir/metakip" skill install --global --yes
elif [ "$install_skill" = project ]; then
  printf '\nInstalling Metakip agent skill for this project with npx skills.\n'
  "$install_dir/metakip" skill install --yes
else
  printf '\nOptional agent skill:\n\n  %bmetakip skill install --global%b\n' "$command_color" "$color_reset"
fi
