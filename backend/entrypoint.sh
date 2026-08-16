#!/bin/sh
set -e

# UID/GID the backend should run as. Default to 1000 (the image's "node" user).
#
# Why this matters: every file the backend writes into the bind-mounted /app/data
# is owned (on the host) by whatever UID the container runs as. If that UID is
# not your account's UID (e.g. on office laptops, often not 1000), you can't
# delete/modify those files without sudo.
#
# FIX (no sudo required): run the container with YOUR uid/gid so the files it
# creates are owned by YOU:
#   PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
# (bootstrap.sh does this automatically on Linux/macOS.)
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# ⚠️  CRITICAL — NEVER `chown -R` the bind-mounted /app/data tree.
#
# On office machines UID 1000 is very often the ADMIN account (e.g. `vehant`),
# not the person who installed the project. The old entrypoint ran
#   chown -R "${PUID}:${PGID}" /app/data
# on every container start (as root). Through the bind mount this FORCEFULLY
# handed ownership of the user's own `backend/data` directory to UID 1000 —
# i.e. to the admin — and the user cannot take it back without sudo.
#
# Correct, no-sudo behaviour:
#   1. Never touch /app/data itself or any host data inside it.
#   2. The container should run as the SAME uid/gid as the host user who owns
#      the project. bootstrap.sh does this automatically:
#        PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
#   3. Only create + chown the NEW leaf folders the backend needs (they are
#      empty/absent on first run, so there is no host owner to steal from).

# Warn if the configured PUID doesn't match the actual host owner of the mount,
# so a mismatch surfaces loudly instead of silently mis-owning files.
if command -v stat >/dev/null 2>&1; then
    MOUNT_UID=$(stat -c '%u' /app/data 2>/dev/null || echo '')
    if [ -n "$MOUNT_UID" ] && [ "$MOUNT_UID" != "$PUID" ]; then
        echo "WARNING: /app/data is owned on the host by UID $MOUNT_UID,"
        echo "         but the container is configured to run as PUID=$PUID PGID=$PGID."
        echo "         If these don't match, files written by the backend may be"
        echo "         owned by the wrong account and/or not writable."
        echo "         No-sudo fix (start via bootstrap.sh, or):"
        echo "           PUID=\$(id -u) PGID=\$(id -g) docker compose up -d --build"
    fi
fi

if [ "$(id -u)" = "0" ]; then
    # When PUID/PGID are at their defaults (1000) but the bind mount is owned by
    # a different UID (common on office laptops where UID 1000 is the admin
    # account), auto-correct to the actual mount owner. This ensures the backend
    # never silently assigns files to the wrong account, and it requires no
    # host-side sudo.
    if [ "${PUID}" = "1000" ] || [ "${PGID}" = "1000" ]; then
        if command -v stat >/dev/null 2>&1; then
            MOUNT_UID=$(stat -c '%u' /app/data 2>/dev/null || echo '')
            MOUNT_GID=$(stat -c '%g' /app/data 2>/dev/null || echo '')
            if [ -n "$MOUNT_UID" ] && [ "$MOUNT_UID" != "$PUID" ]; then
                PUID="$MOUNT_UID"
                PGID="$MOUNT_GID"
            fi
        fi
    fi

    # Ensure backend leaf folders exist and are owned by the active container
    # user (PUID:PGID). This is safe because /app/data itself and any host
    # data outside these documented backend-managed leaf folders are untouched.
    mkdir -p \
      /app/data/storage \
      /app/data/load_layouts \
      /app/data/exports \
      /app/data/collage_images \
      /app/data/library_images \
      /app/data/pixel_data \
      /app/data/temp

    chown -R "${PUID}:${PGID}" \
      /app/data/storage \
      /app/data/load_layouts \
      /app/data/exports \
      /app/data/collage_images \
      /app/data/library_images \
      /app/data/pixel_data \
      /app/data/temp \
      2>/dev/null || true

    # The numeric uid may not have a real home directory, so give the process a
    # writable HOME / npm cache dir.
    export HOME=/tmp
    export NPM_CONFIG_CACHE=/tmp/.npm-cache

    exec su-exec "${PUID}:${PGID}" "$@"
else
    # Someone overrode the container user; just run as-is.
    exec "$@"
fi
