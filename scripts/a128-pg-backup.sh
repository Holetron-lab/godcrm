#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# a128-pg-backup.sh — master A (.128, godcrm_prod) local backup leg.
#
# Found missing 2026-08-23 during Warren W0': master A had NO backup chain at
# all. kz-pg-backup.sh covers the KZ fork; refresh-office-mirror.sh dumps NL
# (master B). Nothing dumped .128 — including schema `hindsight_v2`, which
# holds the agent fleet's entire long-term memory (900+ documents, 7700+
# memory_units) and is reproducible from nothing.
#
#   Method: pg_dump -Fc (custom format, compressed, restore-selectable),
#           whole DB as postgres (peer auth) so no role-privilege filter can
#           silently drop a schema — the exact failure mode that made
#           hindsight_v2 invisible to the `godcrm` role.
#   Runs on .128 via systemd timer godcrm-pg-backup.timer.
#
# Local leg only. An OFFSITE pull leg (§6 pull-only, sink initiates) is still
# owed for master A — owner decision on which sink.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DB=godcrm_prod
DEST=/root/backups/pg
KEEP=14                                   # daily dumps retained locally
TS=$(date -u '+%Y%m%d_%H%M%S')
OUT="$DEST/${DB}_${TS}.dump"
LOG=/var/log/godcrm-pg-backup.log

# Schemas that MUST appear in the dump TOC, else the dump is not a backup.
REQUIRED_SCHEMAS=(public hindsight_v2)

mkdir -p "$DEST"
exec >>"$LOG" 2>&1
echo "==================== $(date -u '+%F %T UTC') dump $DB (.128 master A) ===================="

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
TOC=$(pg_restore -l "$OUT" 2>/dev/null)
if [ -z "$TOC" ]; then
  echo "[FAIL] pg_restore -l could not read $OUT — dump corrupt"
  exit 1
fi
echo "[ok] archive TOC readable (restore-able)"

# Coverage: a dump that lost the memory schema reads as success but isn't one.
for s in "${REQUIRED_SCHEMAS[@]}"; do
  n=$(printf '%s\n' "$TOC" | grep -c " $s "'\|'" $s\." )
  if [ "$n" -eq 0 ]; then
    echo "[FAIL] schema '$s' absent from dump TOC — incomplete backup, keeping file for inspection"
    exit 1
  fi
  echo "[ok] schema '$s' present in TOC ($n objects)"
done

# Rotation: keep newest $KEEP, delete older.
ls -1t "$DEST/${DB}_"*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[rot] rm $old"
  rm -f "$old"
done

date -u '+%F %T UTC' > "$DEST/LAST_OK"
echo "[done] $(ls -1 "$DEST/${DB}_"*.dump | wc -l) dumps on disk"
