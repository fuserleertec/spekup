#!/bin/sh
# Restore a backup made by backup.sh. This replaces the named database contents.
# It does not run on a timer. Stop the API before restoring a live preview.
set -eu
SRC=${1:?Usage: restore.sh <backup-directory>}
if [ ! -f "$SRC/db.dump" ]; then
  echo "Missing $SRC/db.dump" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "Set DATABASE_URL to the database that should receive the dump." >&2
  exit 1
fi
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$SRC/db.dump"
if [ -n "${MEDIA_DIR:-}" ] && [ -f "$SRC/media.tar.gz" ]; then
  mkdir -p "$MEDIA_DIR"
  tar -C "$MEDIA_DIR" -xzf "$SRC/media.tar.gz"
fi
echo "Restored $SRC"
