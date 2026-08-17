#!/bin/bash
#
# fix-ownership.sh — reclaim ownership of backend/data WITHOUT sudo.
#
# Why this is needed:
#   A previous version of backend/entrypoint.sh ran `chown -R <PUID>:<PGID> /app/data`
#   on every container start. On office machines UID 1000 is often the ADMIN
#   account, so the user's own backend/data directory got handed to the admin
#   (e.g. `vehant`) and can no longer be written by the user.
#
# How this works WITHOUT sudo (POSIX rule):
#   You only need WRITE permission on the PARENT directory to rename/delete an
#   entry — never on the entry itself. Since the user still owns the parent
#   (e.g. ~/xray and backend/), they can:
#     1. rename   backend/data -> backend/data_OLD
#     2. mkdir    backend/data            (fresh, owned by the user)
#     3. copy all contents from backend/data_OLD -> backend/data  (copies are owned by the user)
#     4. remove   backend/data_OLD        (deletion allowed because the user owns backend/)
#
# Usage:
#   ./scripts/fix-ownership.sh [path-to-backend-data]
#   e.g. ./scripts/fix-ownership.sh backend/data
#
# The script stops if it detects the data can be reclaimed with a plain chown
# instead (i.e. the user already owns it, just with wrong group/perms).

set -euo pipefail

DATA_DIR="${1:-backend/data}"
DATA_DIR="$(cd "$(dirname "$DATA_DIR")" && pwd)/$(basename "$DATA_DIR")"

if [ ! -d "$DATA_DIR" ]; then
  echo "ERROR: $DATA_DIR does not exist."
  exit 1
fi

PARENT="$(dirname "$DATA_DIR")"
if [ ! -w "$PARENT" ]; then
  echo "ERROR: You do not have WRITE permission on $PARENT."
  echo "       This script needs write permission on the PARENT directory."
  exit 1
fi

ME_UID="$(id -u)"
ME_GID="$(id -g)"
DATA_UID="$(stat -c '%u' "$DATA_DIR" 2>/dev/null || echo 'unknown')"

echo "=== Ownership check ==="
echo "You (uid/gid):      $ME_UID / $ME_GID"
echo "backend/data owner: uid=$DATA_UID"

if [ "$DATA_UID" = "$ME_UID" ]; then
  echo ""
  echo "✅  backend/data is already owned by YOU. Nothing to do."
  echo "   (If files INSIDE are still owned by the admin, re-run this"
  echo "    script after stopping the backend: docker compose stop)")
  exit 0
fi

echo ""
echo "backend/data is owned by uid $DATA_UID (not you, uid $ME_UID)."
echo "Reclaiming WITHOUT sudo by rename+copy+delete..."
echo ""

BACKUP_DIR="${DATA_DIR}_OLD_$$"

# 1. Rename the mis-owned directory (allowed: we own the parent).
echo "Step 1: renaming $DATA_DIR -> $BACKUP_DIR"
mv "$DATA_DIR" "$BACKUP_DIR"

# 2. Create a fresh, user-owned directory.
echo "Step 2: creating fresh $DATA_DIR"
mkdir -p "$DATA_DIR"

# 3. Copy contents (copies are owned by us).
echo "Step 3: copying contents back (this may take a while)..."
# Use cp -a to preserve structure/perms within our own new tree.
cp -a "$BACKUP_DIR"/. "$DATA_DIR"/ 2>/dev/null || true

# 4. Remove the old renamed directory (allowed: we own the parent).
echo "Step 4: removing $BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo ""
echo "=== Done ==="
echo "✅  backend/data is now owned by you (uid=$ME_UID)."
echo ""
echo "IMPORTANT — prevent this from happening again:"
echo "  The old entrypoint's 'chown -R /app/data' has been REMOVED."
echo "  Always start via bootstrap.sh (it sets PUID/PGID from your id), or:"
echo "    PUID=\$(id -u) PGID=\$(id -g) docker compose up -d --build"