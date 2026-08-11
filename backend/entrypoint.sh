#!/bin/sh
set -e

# Self-heal /app/data ownership for bind-mounted host folders.
# This allows the container to start as non-root without requiring
# sudo/chown on the host.
mkdir -p /app/data/storage
chown -R node:node /app/data

# Also ensure /home is writable by the node user so custom export paths
# under /home (e.g. /home/node/exports) can be created without EACCES.
if [ -d /home ]; then
  chown node:node /home 2>/dev/null || true
fi

exec su-exec node "$@"
