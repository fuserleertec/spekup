#!/bin/sh
set -eu
root="${MEDIA_DIR:-/data/media}"
mkdir -p "$root/private" "$root/ready" "$root/tmp"
chown -R node:node "$root"
if [ "$#" -eq 0 ]; then
  set -- node dist/index.js
fi
exec runuser -u node -- "$@"
