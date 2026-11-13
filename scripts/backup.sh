#!/bin/sh
# Copy the database and the media directory. Does not schedule itself.
set -eu
OUT=${1:-./spekup-backup}
mkdir -p "$OUT"
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump --format=custom --file "$OUT/db.dump" "$DATABASE_URL"
else
  docker compose exec -T db pg_dump -U common_voice -d common_voice --format=custom > "$OUT/db.dump"
fi
MEDIA=${MEDIA_DIR:-}
if [ -z "$MEDIA" ]; then
  echo "Set MEDIA_DIR to the media folder, or copy the Docker media volume beside db.dump yourself." >&2
else
  tar -C "$MEDIA" -czf "$OUT/media.tar.gz" .
fi
echo "Wrote $OUT"
