#!/usr/bin/env bash
# Control hook helper: prune old snapshots
# Called by PreCompact and SessionEnd hooks. Reads retention config, deletes old snapshots.

set -euo pipefail

SNAP_DIR=".control/snapshots"
[ ! -d "$SNAP_DIR" ] && exit 0

# Load config (if present) so retention values come from .control/config.sh
# shellcheck disable=SC1091
[ -f .control/config.sh ] && . .control/config.sh

# Apply defaults for any unset values
RETENTION_COUNT="${CONTROL_SNAPSHOT_RETENTION_COUNT:-50}"
RETENTION_DAYS="${CONTROL_SNAPSHOT_RETENTION_DAYS:-14}"

# Delete snapshots older than RETENTION_DAYS
find "$SNAP_DIR" -type f -name '*.md'   -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$SNAP_DIR" -type f -name '*.flag' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

# Keep only the most recent RETENTION_COUNT timestamped snapshots (exclude current.md -- no dash).
# Use a loop instead of xargs -r for portability.
# shellcheck disable=SC2012
over_retention=$(ls -t "$SNAP_DIR"/*-*.md 2>/dev/null | tail -n +$((RETENTION_COUNT + 1)) || true)
if [ -n "$over_retention" ]; then
    echo "$over_retention" | while IFS= read -r f; do
        [ -n "$f" ] && rm -f "$f"
    done
fi
