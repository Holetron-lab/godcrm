#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# kz-offsite-pull.sh — OFFSITE leg of the KZ backup chain, runs ON .128.
#
# Constitution v4.0 §10 (invariant 2) + §6 (pull-only sinks): .128 PULLS the
# newest KZ dump over the DPI-resistant `ssh kz` relay and gpg-encrypts it at
# rest (AES256). KZ never authenticates to .128 → the sink has no exposure to a
# KZ compromise. Encryption-at-rest matches the pre-existing .89/VDSina chain's
# bar so a provider snapshot / stolen disk on .128 does not leak KZ customer
# data. .128 (NL) is a separate provider from Timeweb Almaty → offsite holds.
#
#   Flow:  ssh kz 'cat newest.dump'  ──▶  gpg -c (AES256)  ──▶  .128:<dest>/*.gpg
#          (plaintext never touches .128 disk — encrypted in-flight)
#   Pass:  /root/backups/.kz-offsite.pass (600), escrowed offline w/ GERATRON.
#   Sched: systemd timer kz-offsite-pull.timer on .128, ~1h after KZ dump.
#   Restore:  gpg -d f.dump.gpg | pg_restore ...   (needs the escrowed passphrase)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

export HOME=/root                          # ssh reads /root/.ssh/config (kz alias)
DEST=/root/backups/kz-offsite
PASS=/root/backups/.kz-offsite.pass
KEEP=14
LOG=/var/log/godcrm-kz-offsite.log
MAX_AGE_H=30

mkdir -p "$DEST"
exec >>"$LOG" 2>&1
echo "==================== $(date -u '+%F %T UTC') pull KZ offsite (encrypted) ===================="

if [ ! -s "$PASS" ]; then
  echo "[FAIL] passphrase file $PASS missing/empty — cannot encrypt at rest. Aborting."
  exit 1
fi

# Which dump is newest on KZ?
NEWEST=$(ssh -o ConnectTimeout=30 kz 'ls -1t /root/backups/pg/godcrm_prod_*.dump 2>/dev/null | head -1')
if [ -z "$NEWEST" ]; then
  echo "[FAIL] no dump found on KZ (backup leg down?)"
  exit 1
fi
BASE=$(basename "$NEWEST")
OUT="$DEST/${BASE}.gpg"

if [ -f "$OUT" ]; then
  echo "[skip] $BASE.gpg already offsite — nothing new since last run"
else
  # Stream KZ→gpg: plaintext never lands on .128 disk.
  if ssh -o ConnectTimeout=30 kz "cat '$NEWEST'" \
       | gpg --batch --yes --symmetric --cipher-algo AES256 \
             --passphrase-file "$PASS" -o "$OUT.part"; then
    mv "$OUT.part" "$OUT"
    echo "[ok] encrypted offsite: $BASE.gpg ($(du -h "$OUT" | cut -f1))"
  else
    rc=$?
    rm -f "$OUT.part"
    echo "[FAIL] stream/encrypt exited $rc — KZ unreachable, relay down, or gpg error"
    exit "$rc"
  fi
fi

# Rotation on the sink (keep newest $KEEP encrypted dumps).
ls -1t "$DEST"/godcrm_prod_*.dump.gpg 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[rot] rm $old"; rm -f "$old"
done

# Staleness guard: newest offsite dump too old ⇒ KZ leg broken.
LATEST=$(ls -1t "$DEST"/godcrm_prod_*.dump.gpg 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
  AGE_H=$(( ( $(date -u +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
  echo "[info] newest offsite: $(basename "$LATEST") (${AGE_H}h old)"
  [ "$AGE_H" -gt "$MAX_AGE_H" ] && echo "[WARN] newest KZ dump ${AGE_H}h old (> ${MAX_AGE_H}h) — KZ backup leg may be broken!"
else
  echo "[WARN] no encrypted KZ dumps present after run!"
fi
echo "[done] $(ls -1 "$DEST"/godcrm_prod_*.dump.gpg 2>/dev/null | wc -l) encrypted offsite dumps on .128"
