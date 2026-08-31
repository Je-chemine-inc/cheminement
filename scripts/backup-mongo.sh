#!/usr/bin/env bash
#
# Nightly MongoDB backup for Je chemine.
#
# The VPS is the sole source of truth for production data. cPanel's account
# backups do NOT cover the MongoDB dataset under /var/lib/mongo, so without
# this there is no database backup at all.
#
# Writes a single gzipped archive per run, validates it by parsing it back with
# `mongorestore --dryRun` (an unvalidated dump is not a backup), then prunes to
# the retention window.
#
# Archives contain client PHI — the directory is 0700 and files are 0600.
#
set -euo pipefail

ENV_FILE=/root/jechemine.env
BACKUP_ROOT=/root/backups
BACKUP_DIR="$BACKUP_ROOT/mongo"
RETENTION=30
LOG=/var/log/jechemine-backup.log

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup] $*" >>"$LOG"; }

fail() {
  log "FAILED: $*"
  exit 1
}

[ -r "$ENV_FILE" ] || fail "cannot read $ENV_FILE"

URI=$(grep -m1 '^MONGODB_URI=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
[ -n "$URI" ] || fail "MONGODB_URI is empty in $ENV_FILE"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"

TS=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE="$BACKUP_DIR/jechemine-$TS.archive.gz"

mongodump --uri="$URI" --gzip --archive="$ARCHIVE" --quiet 2>>"$LOG" \
  || { rm -f "$ARCHIVE"; fail "mongodump errored"; }

chmod 600 "$ARCHIVE"

SIZE=$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)
# A healthy archive of this database is ~1-2 MB. Anything tiny means the dump
# silently produced nothing — keep it for inspection rather than pruning it.
[ "$SIZE" -ge 10240 ] || fail "archive is only ${SIZE} bytes — kept at $ARCHIVE for inspection"

# Validate: parse the archive back without writing anything to the database.
mongorestore --uri="$URI" --gzip --archive="$ARCHIVE" --dryRun --quiet 2>>"$LOG" \
  || fail "archive failed --dryRun validation — kept at $ARCHIVE for inspection"

# Prune: keep the newest $RETENTION archives.
PRUNED=$(ls -1t "$BACKUP_DIR"/jechemine-*.archive.gz 2>/dev/null \
  | tail -n +$((RETENTION + 1)) | tee >(xargs -r rm -f) | wc -l)

KEPT=$(ls -1 "$BACKUP_DIR"/jechemine-*.archive.gz 2>/dev/null | wc -l)
log "OK $(basename "$ARCHIVE") ${SIZE}B validated; kept=${KEPT} pruned=${PRUNED}"
