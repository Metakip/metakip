#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
installer="$repo_dir/scripts/install-cli.sh"
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

fail() {
  printf '%s\n' "install-cli test: $*" >&2
  exit 1
}

fake_bin="$test_dir/bin"
mock_state="$test_dir/mock"
mkdir -p "$fake_bin" "$mock_state"
(cd "$repo_dir/cli" && go build -o "$test_dir/metakip-finalizer" .)
real_install=$(command -v install)
real_mv=$(command -v mv)
real_wc=$(command -v wc)
export MOCK_HASH=0000000000000000000000000000000000000000000000000000000000000000
export MOCK_STATE="$mock_state"
export REAL_INSTALL="$real_install"
export REAL_MV="$real_mv"
export REAL_WC="$real_wc"

cat >"$fake_bin/curl" <<'EOF'
#!/bin/sh
set -eu
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output=$2
      shift 2
      ;;
    --max-filesize | --connect-timeout | --max-time)
      shift 2
      ;;
    --fail | --location | --silent | --show-error)
      shift
      ;;
    *)
      url=$1
      shift
      ;;
  esac
done
[ "${MOCK_CURL_FAIL:-0}" = 0 ] || exit 7
case "$url" in
  */checksums.txt)
    archive=$(cat "$MOCK_STATE/archive")
    if [ -n "$output" ]; then printf '%s  %s\n' "$MOCK_HASH" "$archive" >"$output"; else printf '%s  %s\n' "$MOCK_HASH" "$archive"; fi
    ;;
  *)
    basename "$url" >"$MOCK_STATE/archive"
    if [ -n "$output" ]; then : >"$output"; fi
    ;;
esac
EOF

cat >"$fake_bin/sha256sum" <<'EOF'
#!/bin/sh
printf '%s  %s\n' "$MOCK_HASH" "$1"
EOF

cat >"$fake_bin/tar" <<'EOF'
#!/bin/sh
set -eu
destination=""
list=0
verbose=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -*t*)
      list=1
      case "$1" in *v*) verbose=1 ;; esac
      shift
      ;;
    -C)
      destination=$2
      shift 2
      ;;
    *) shift ;;
  esac
done
if [ "$list" = 1 ]; then
  size=${MOCK_TAR_SIZE:-1}
  if [ -n "${MOCK_TAR_ENTRIES:-}" ]; then
    if [ "$verbose" = 1 ]; then
      printf '%s\n' "$MOCK_TAR_ENTRIES" | awk -v size="$size" '{ printf "-rwxr-xr-x root/root %s Jan 1 00:00 %s\n", size, $0 }'
    else
      printf '%s\n' "$MOCK_TAR_ENTRIES"
    fi
  else
    if [ "$verbose" = 1 ]; then
      printf '%s\n' "-rwxr-xr-x root/root $size Jan 1 00:00 ./metakip" "-rw-r--r-- root/root $size Jan 1 00:00 ./LICENSE"
    else
      printf '%s\n' './metakip' './LICENSE'
    fi
  fi
  exit 0
fi
mkdir -p "$destination"
cp "$MOCK_FINALIZER_BINARY" "$destination/metakip"
EOF

cat >"$fake_bin/install" <<'EOF'
#!/bin/sh
if [ "${MOCK_INSTALL_FAIL:-0}" = 1 ]; then
  exit 1
fi
exec "$REAL_INSTALL" "$@"
EOF

cat >"$fake_bin/mv" <<'EOF'
#!/bin/sh
set -eu
destination=""
for argument in "$@"; do destination=$argument; done
if [ -n "${MOCK_MV_FAIL_DESTINATION:-}" ] && [ "$destination" = "$MOCK_MV_FAIL_DESTINATION" ] && [ ! -e "$MOCK_STATE/mv-failed" ]; then
  : >"$MOCK_STATE/mv-failed"
  exit 1
fi
exec "$REAL_MV" "$@"
EOF

cat >"$fake_bin/wc" <<'EOF'
#!/bin/sh
if [ "${MOCK_OVERSIZED_ARCHIVE:-0}" = 1 ] && [ "${1:-}" = -c ]; then
  printf '%s\n' 268435457
  exit 0
fi
exec "$REAL_WC" "$@"
EOF

cat >"$fake_bin/npx" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$MOCK_STATE/npx-arguments"
EOF

chmod +x "$fake_bin/curl" "$fake_bin/sha256sum" "$fake_bin/tar" "$fake_bin/install" "$fake_bin/mv" "$fake_bin/wc" "$fake_bin/npx"

run_installer() {
  local install_dir=$1
  local state_dir=$2
  shift 2
  env \
    HOME="$test_dir/home" \
    PATH="$fake_bin:$PATH" \
    MOCK_FINALIZER_BINARY="$test_dir/metakip-finalizer" \
    METAKIP_INSTALL_DIR="$install_dir" \
    METAKIP_INSTALL_STATE_DIR="$state_dir" \
    SHELL=/bin/bash \
    "$@" \
    sh "$installer"
}

relative_cwd="$test_dir/relative"
mkdir -p "$relative_cwd"
(
  cd "$relative_cwd"
  run_installer bin "$test_dir/state-relative"
)
expected_relative_dir="$(cd "$relative_cwd" && pwd -P)/bin"
grep -F "\"installDir\": \"$expected_relative_dir\"" "$test_dir/state-relative/install.json" >/dev/null || fail "relative install directory was not made absolute"

shared_dir="$test_dir/shared"
mkdir -p "$shared_dir"
chmod 755 "$shared_dir"
run_installer "$shared_dir" "$test_dir/state-shared"
if [ "$(uname -s)" = Darwin ]; then
  shared_mode=$(stat -f %Lp "$shared_dir")
else
  shared_mode=$(stat -c %a "$shared_dir")
fi
[ "$shared_mode" = 755 ] || fail "existing install directory permissions changed"

oversized_archive_dir="$test_dir/oversized-archive"
if run_installer "$oversized_archive_dir" "$test_dir/state-oversized-archive" MOCK_OVERSIZED_ARCHIVE=1; then
  fail "oversized release archive was accepted"
fi
[ ! -e "$oversized_archive_dir/metakip" ] || fail "oversized release archive installed a binary"

if run_installer "$test_dir/failed-download" "$test_dir/state-failed-download" MOCK_CURL_FAIL=1; then
  fail "failed download was accepted"
fi

misleading_probe="$test_dir/misleading-probe"
cat >"$misleading_probe" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --version ]; then
  printf '%s\n' 'v999.9.9\033]52;c;fake\007'
  exit 0
fi
exec "$REAL_FINALIZER" "$@"
EOF
chmod +x "$misleading_probe"
misleading_output=$(run_installer "$test_dir/misleading-probe-install" "$test_dir/state-misleading-probe" MOCK_FINALIZER_BINARY="$misleading_probe" REAL_FINALIZER="$test_dir/metakip-finalizer")
printf '%s\n' "$misleading_output" | grep -F 'Metakip latest installed to ' >/dev/null || fail "installer did not report the latest release channel"
! printf '%s\n' "$misleading_output" | grep -F 'v999.9.9' >/dev/null || fail "installer trusted binary version output"

pinned_dir="$test_dir/pinned"
pinned_output=$(run_installer "$pinned_dir" "$test_dir/state-pinned" METAKIP_VERSION=v2.3.4 METAKIP_MODIFY_PATH=0)
printf '%s\n' "$pinned_output" | grep -F "Metakip v2.3.4 installed to $pinned_dir/metakip." >/dev/null || fail "installer did not report the pinned release version"
! printf '%s\n' "$pinned_output" | grep -F '(latest)' >/dev/null || fail "pinned install was labeled latest"

unsafe_archive_dir="$test_dir/unsafe-archive"
if run_installer "$unsafe_archive_dir" "$test_dir/state-unsafe-archive" MOCK_TAR_ENTRIES='../metakip'; then
  fail "unsafe release archive was accepted"
fi
[ ! -e "$unsafe_archive_dir/metakip" ] || fail "unsafe release archive installed a binary"

too_many_entries=$(awk 'BEGIN { for (entry = 1; entry <= 1025; entry++) print "entry-" entry }')
if run_installer "$test_dir/too-many-entries" "$test_dir/state-too-many-entries" MOCK_TAR_ENTRIES="$too_many_entries"; then
  fail "release archive with too many entries was accepted"
fi

if run_installer "$test_dir/oversized-contents" "$test_dir/state-oversized-contents" MOCK_TAR_SIZE=268435457; then
  fail "release archive with oversized decompressed contents was accepted"
fi

later_path_dir="$test_dir/later-path"
later_path_state="$test_dir/state-later-path"
run_installer "$later_path_dir" "$later_path_state"
! grep -F '"pathFile"' "$later_path_state/install.json" >/dev/null || fail "default install retained obsolete PATH ownership"
grep -F "export PATH='$later_path_dir':\$PATH" "$test_dir/home/.bashrc" >/dev/null || fail "default install did not add PATH block"

escaped_source_marker="$test_dir/source-should-not-run"
escaped_home="$test_dir/hôme ' path \$(touch $escaped_source_marker)"
escaped_default_dir="$escaped_home/.metakip/bin"
escaped_default_output=$(run_installer "$escaped_default_dir" "$test_dir/state-escaped-default" HOME="$escaped_home")
escaped_default_entry=$(printf '%s' "$escaped_default_dir" | sed "s/'/'\\\\''/g")
grep -F "export PATH='$escaped_default_entry':\$PATH" "$escaped_home/.bashrc" >/dev/null || fail "default install did not escape a spaced Unicode home path"
printf '%s\n' "$escaped_default_output" | grep -F "Metakip latest installed to $escaped_default_dir/metakip." >/dev/null || fail "installer did not report the latest release channel"
printf '%s\n' "$escaped_default_output" | grep -F 'Open a new terminal before running metakip.' >/dev/null || fail "PATH activation guidance was not printed"
[ ! -e "$escaped_source_marker" ] || fail "installer output executed a profile-path command substitution"

opt_out_dir="$test_dir/path-opt-out"
opt_out_state="$test_dir/state-path-opt-out"
opt_out_output=$(run_installer "$opt_out_dir" "$opt_out_state" METAKIP_MODIFY_PATH=0)
! grep -F '"pathFile"' "$opt_out_state/install.json" >/dev/null || fail "PATH opt-out recorded PATH ownership"
printf '%s\n' "$opt_out_output" | grep -F 'After adding Metakip to PATH, run metakip login to get started.' >/dev/null || fail "PATH opt-out did not explain when metakip login becomes available"

spaced_install_dir="$test_dir/install path"
spaced_output=$(run_installer "$spaced_install_dir" "$test_dir/state-spaced-path" METAKIP_MODIFY_PATH=0)
printf '%s\n' "$spaced_output" | grep -F 'After adding Metakip to PATH, run metakip login to get started.' >/dev/null || fail "PATH opt-out login guidance was not printed"

metacharacter_install_dir="$test_dir/install \$(touch should-not-run)"
metacharacter_output=$(run_installer "$metacharacter_install_dir" "$test_dir/state-metacharacter-path" METAKIP_MODIFY_PATH=0)
metacharacter_path_command=$(printf '%s\n' "$metacharacter_output" | sed -n "/^  export PATH=/p")
expected_metacharacter_path_command="  export PATH='$metacharacter_install_dir':\$PATH"
[ "$metacharacter_path_command" = "$expected_metacharacter_path_command" ] || fail "PATH instruction did not quote shell metacharacters"
PATH="$fake_bin:$PATH" sh -c "${metacharacter_path_command#  }; command -v touch >/dev/null"
[ ! -e "$test_dir/should-not-run" ] || fail "PATH instruction executed an install-path command substitution"

skill_dir="$test_dir/skill-install"
run_installer "$skill_dir" "$test_dir/state-skill-install" METAKIP_INSTALL_SKILL=global
expected_npx_arguments='--yes
skills
add
Metakip/metakip
--skill
metakip
--global
--yes'
[ "$(cat "$mock_state/npx-arguments")" = "$expected_npx_arguments" ] || fail "skill installation did not invoke npx skills with the global scope"

if run_installer "$test_dir/invalid-skill" "$test_dir/state-invalid-skill" METAKIP_INSTALL_SKILL=invalid; then
  fail "invalid skill scope was accepted"
fi

separator_dir="$test_dir/path:separator"
if run_installer "$separator_dir" "$test_dir/state-separator" METAKIP_MODIFY_PATH=1; then
  fail "PATH separator install directory was accepted"
fi

invalid_receipt_dir="$test_dir/invalid-receipt"
invalid_receipt_state="$test_dir/state-invalid-receipt"
mkdir -p "$invalid_receipt_dir" "$invalid_receipt_state"
printf 'previous binary\n' >"$invalid_receipt_dir/metakip"
printf '{ invalid json\n' >"$invalid_receipt_state/install.json"
if run_installer "$invalid_receipt_dir" "$invalid_receipt_state"; then
  fail "invalid install receipt was accepted"
fi
[ "$(cat "$invalid_receipt_dir/metakip")" = 'previous binary' ] || fail "invalid receipt reinstall replaced the binary"

failed_state_dir="$test_dir/state-path-file"
printf 'not a directory\n' >"$failed_state_dir"
failed_state_install="$test_dir/failed-state-install"
if run_installer "$failed_state_install" "$failed_state_dir"; then
  fail "state path file was accepted"
fi
[ ! -e "$failed_state_install/metakip" ] || fail "failed state setup installed an unmanaged binary"

mkdir -p "$test_dir/home"
existing_path_block="$test_dir/home/.bashrc"
printf '%s\n' '# >>> metakip >>>' 'export PATH="/other/metakip:$PATH"' '# <<< metakip <<<' >"$existing_path_block"
preexisting_block="$test_dir/preexisting-block"
run_installer "$preexisting_block" "$test_dir/state-preexisting" METAKIP_MODIFY_PATH=1
! grep -F '"pathFile"' "$test_dir/state-preexisting/install.json" >/dev/null || fail "receipt retained obsolete PATH ownership"
grep -F 'export PATH="/other/metakip:$PATH"' "$existing_path_block" >/dev/null || fail "pre-existing PATH block changed"
grep -F "export PATH='$preexisting_block':\$PATH" "$existing_path_block" >/dev/null || fail "installer did not add its own PATH block"

rm "$existing_path_block"
owned_path_dir="$test_dir/owned-path"
owned_path_state="$test_dir/state-owned-path"
run_installer "$owned_path_dir" "$owned_path_state" METAKIP_MODIFY_PATH=1
! grep -F '"pathFile"' "$owned_path_state/install.json" >/dev/null || fail "PATH install retained obsolete ownership"
run_installer "$owned_path_dir" "$owned_path_state"
! grep -F '"pathFile"' "$owned_path_state/install.json" >/dev/null || fail "reinstall wrote obsolete PATH ownership"
run_installer "$owned_path_dir" "$owned_path_state" METAKIP_MODIFY_PATH=1
! grep -F '"pathFile"' "$owned_path_state/install.json" >/dev/null || fail "PATH reinstall wrote obsolete ownership"
moved_path_dir="$test_dir/moved-path"
if run_installer "$moved_path_dir" "$owned_path_state"; then
  fail "managed installation directory change was accepted"
fi
[ ! -e "$moved_path_dir/metakip" ] || fail "managed installation directory change installed a binary"

unsafe_dir="$test_dir/unsafe;touch-pwned"
run_installer "$unsafe_dir" "$test_dir/state-unsafe" METAKIP_MODIFY_PATH=1
grep -F "export PATH='$unsafe_dir':\$PATH" "$test_dir/home/.bashrc" >/dev/null || fail "shell-metacharacter install path was not quoted in the profile"

unsupported_shell_dir="$test_dir/unsupported-shell"
unsupported_shell_output=$(run_installer "$unsupported_shell_dir" "$test_dir/state-unsupported-shell" SHELL=/bin/unsupported)
! grep -F '"pathFile"' "$test_dir/state-unsupported-shell/install.json" >/dev/null || fail "unsupported shell recorded PATH ownership"
printf '%s\n' "$unsupported_shell_output" | grep -F "PATH was not changed because unsupported is not a supported shell." >/dev/null || fail "unsupported shell did not receive manual PATH guidance"

control_dir="$test_dir/control$(printf '\t')path"
if run_installer "$control_dir" "$test_dir/state-control"; then
  fail "JSON control character install directory was accepted"
fi
