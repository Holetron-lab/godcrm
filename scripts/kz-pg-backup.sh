#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# kz-pg-backup.sh — KZ master (godcrm_prod) local backup leg.
#
# Constitution v4.0 §10 blocking-tail (invariant 2): the KZ fork (ADR-161,
# <KZ_IP>) had NO backup chain of its own since the fork. This is the
# LOCAL leg — a daily compressed pg_dump with rotation. The OFFSITE leg is a
# PULL from .128 (see kz-offsite-pull.sh) so KZ holds no write path to the
# sink (§6 pull-only). Runs ON KZ via systemd timer godcrm-pg-backup.timer.
#
#   Method: pg_dump -Fc (custom format, compressed, restore-selectable).
#           1 GB DB, archive_mode=off → dump is simpler+safer than basebackup+WAL.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DB=godcrm_prod
DEST=/root/backups/pg
KEEP=14                                   # daily dumps retained locally
TS=$(date -u '+%Y%m%d_%H%M%S')
OUT="$DEST/${DB}_${TS}.dump"
LOG=/var/log/godcrm-pg-backup.log

mkdir -p "$DEST"
exec >>"$LOG" 2>&1
echo "==================== $(date -u '+%F %T UTC') dump $DB ===================="

# Peer-auth as postgres; -Fc = custom compressed format.
if sudo -u postgres pg_dump -Fc "$DB" > "$OUT.part"; then
  mv "$OUT.part" "$OUT"
  SIZE=$(du -h "$OUT" | cut -f1)
  echo "[ok] wrote $OUT ($SIZE)"
else
  rc=$?
  rm -f "$OUT.part"
  echo "[FAIL] pg_dump exited $rc — no dump written"
  exit "$rc"
fi

# Integrity: pg_restore -l must list the archive TOC, else the dump is junk.
# Run as root (this leg's user): pg_restore -l only reads the archive file and
# needs no DB access — running it as postgres fails to traverse root-owned /root.
if pg_restore -l "$OUT" >/dev/null 2>&1; then
  echo "[ok] archive TOC readable (restore-able)"
else
  echo "[FAIL] pg_restore -l could not read $OUT — dump corrupt"
  exit 1
fi

# Rotation: keep newest $KEEP, delete older.
ls -1t "$DEST/${DB}_"*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[rot] rm $old"
  rm -f "$old"
done

# Freshness marker for the .128 pull side to sanity-check.
date -u '+%F %T UTC' > "$DEST/LAST_OK"
echo "[done] $(ls -1 "$DEST/${DB}_"*.dump | wc -l) dumps on disk"
