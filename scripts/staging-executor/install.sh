#!/bin/bash
# Administrator installer for the independent staging executor. Run by the
# appointed SysAdmin from an administrator session, never by an agent turn.
#
#   bash install.sh <package-dir> <implementation-sha> [--verify-only]
#
# <package-dir> is the reviewed package (this directory as shipped in the
# commit, plus MANIFEST.sha256). The installer verifies every digest, copies
# the files into a root-owned versioned release, re-computes the executor
# digest, switches the `current` symlink atomically and installs the unit
# files. It does NOT start, enable or restart anything, does not generate the
# channel key and does not touch godcrm / godcrm-edit / deploy-bot.
set -euo pipefail
umask 022
PKG=${1:?package dir}; SHA=${2:?implementation sha}; MODE=${3:-}
case "$MODE" in ''|--verify-only) ;; *) echo 'usage: install.sh <package-dir> <sha> [--verify-only]' >&2; exit 2 ;; esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'sha must be 40 hex' >&2; exit 2; }
ROOT=/opt/godcrm-staging-executor
RELEASE="$ROOT/releases/$SHA"
ETC=/etc/godcrm-staging-executor
FILES=(executor.py preflight.py lease-watchdog.sh INSTALL.md)
UNITS=(godcrm-staging-executor.service godcrm-staging-lease-watchdog.service godcrm-staging-lease-watchdog.timer)

test "$(id -u)" = 0 || { echo 'run as root' >&2; exit 1; }
cd "$PKG"
sha256sum -c --strict --quiet MANIFEST.sha256
expected=$(sed -n 's/^EXECUTOR_SHA256=//p' MANIFEST.env)
actual=$(python3 executor.py --digest)
test "$expected" = "$actual" || { echo "executor digest mismatch: manifest $expected, package $actual" >&2; exit 1; }
echo "package verified: executor_sha256=$actual"
if [ "$MODE" = --verify-only ]; then exit 0; fi

test ! -e "$RELEASE" || { echo "release $RELEASE already exists — refusing to overwrite" >&2; exit 1; }
install -d -m 755 -o root -g root "$ROOT/releases" "$RELEASE" "$ETC"
for f in "${FILES[@]}"; do install -m 644 -o root -g root "$f" "$RELEASE/$f"; done
cp MANIFEST.sha256 MANIFEST.env "$RELEASE/"
test "$(python3 "$RELEASE/executor.py" --digest)" = "$expected"
ln -sfn "$RELEASE" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
for u in "${UNITS[@]}"; do install -m 644 -o root -g root "$u" "/etc/systemd/system/$u"; done
systemctl daemon-reload
if [ ! -s "$ETC/channel.key" ]; then
  echo "NOTE: $ETC/channel.key is missing. Create it out of band (openssl rand -hex 32 > channel.key; chmod 600) and reference it from both executor.env and the godcrm .env (OPS_STAGING_CHANNEL_KEY_FILE)." >&2
fi
if [ ! -s "$ETC/executor.env" ]; then
  install -m 600 -o root -g root executor.env.example "$ETC/executor.env"
  echo "installed default $ETC/executor.env — review before starting" >&2
fi
cat <<EOF
installed $RELEASE (current -> $(readlink "$ROOT/current"))
executor_sha256=$expected
next (administrator, out of band): provision channel.key; set OPS_STAGING_* in the godcrm .env (see INSTALL.md);
  systemctl enable --now godcrm-staging-executor.service godcrm-staging-lease-watchdog.timer
rollback: ln -sfn <previous release> $ROOT/current; systemctl restart godcrm-staging-executor.service (or stop it)
EOF
