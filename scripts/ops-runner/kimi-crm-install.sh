#!/bin/bash
# Authorized administrator only. No application restart or credential changes.
# Usage: bash kimi-crm-install.sh --check|--install <wrapper-sha256>
set -euo pipefail
mode=${1:-}
expected=${2:-}
[[ "$mode" == --check || "$mode" == --install ]]
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
source_file="$(cd -- "$(dirname -- "$0")" && pwd)/kimi-crm.sh"
target=/usr/local/bin/kimi
vendor=/root/.local/bin/kimi
backup_root=/root/backups/temp
[[ " $(hostname -I) " == *" <PROD_IP> "* ]]
[[ -x "$vendor" && ! -L "$vendor" ]]
[[ "$(sha256sum "$source_file" | cut -d ' ' -f 1)" == "$expected" ]]
sh -n "$source_file"
if [[ ! -L "$target" ]] && cmp -s "$source_file" "$target"; then
    echo 'Already installed; no changes'
    exit 0
fi
# Refuse to overwrite any launcher other than the inspected vendor symlink.
[[ -L "$target" && "$(readlink "$target")" == "$vendor" ]]
if [[ "$mode" == --check ]]; then
    echo 'Preflight PASS; active launcher unchanged'
    exit 0
fi
[[ "$EUID" == 0 ]]
umask 077
mkdir -p "$backup_root"
backup=$(mktemp -d "$backup_root/kimi-crm-install.XXXXXXXX")
cp -a --no-dereference "$target" "$backup/kimi.link"
[[ -L "$backup/kimi.link" && "$(readlink "$backup/kimi.link")" == "$vendor" ]]
sha256sum "$vendor" "$source_file" > "$backup/SHA256SUMS"
candidate=$(mktemp /usr/local/bin/.kimi-crm.XXXXXXXX)
trap 'rm -f -- "$candidate"' EXIT
install -m 0755 "$source_file" "$candidate"
[[ "$(sha256sum "$candidate" | cut -d ' ' -f 1)" == "$expected" ]]
# Recheck immediately before the atomic switch.
[[ -L "$target" && "$(readlink "$target")" == "$vendor" ]]
mv -Tf -- "$candidate" "$target"
cmp -s "$source_file" "$target"
echo "Installed; backup: $backup/kimi.link"
