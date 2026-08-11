#!/bin/sh
set -e

# Self-heal /app/data ownership for bind-mounted host folders.
# This allows the container to start as non-root without requiring
# sudo/chown on the host.
mkdir -p /app/data/storage
chown -R node:node /app/data

exec su-exec node "$@"
