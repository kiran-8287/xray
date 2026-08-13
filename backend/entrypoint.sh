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

# Ensure the base data folders exist (needed even on a fresh/empty bind mount).
mkdir -p /app/data/storage
mkdir -p /app/data/load_layouts

if [ "$(id -u)" = "0" ]; then
    # Running as root (image default): take ownership of the mounted data tree on
    # behalf of the requested UID/GID, then drop privileges to it. Because this
    # chowns THROUGH the bind mount, the files on the host end up owned by that
    # user too — so no sudo is needed on the host afterwards.
    chown -R "${PUID}:${PGID}" /app/data

    # Keep /home writable by the running uid so custom export paths under /home
    # (e.g. /home/<uid>/exports) can be created without EACCES.
    if [ -d /home ]; then
        chown "${PUID}:${PGID}" /home 2>/dev/null || true
    fi

    # The numeric uid may not have a real home directory, so give the process a
    # writable HOME / npm cache dir.
    export HOME=/tmp
    export NPM_CONFIG_CACHE=/tmp/.npm-cache

    exec su-exec "${PUID}:${PGID}" "$@"
else
    # Someone overrode the container user; just run as-is.
    exec "$@"
fi
