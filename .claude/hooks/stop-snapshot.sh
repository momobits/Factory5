#!/usr/bin/env bash
# Control hook: Stop
# Fires after each Claude response completes.
# Lightweight per-turn snapshot -- proactive anti-drift. Cheap: only writes if STATE.md changed.
#
# This is the proactive layer described in PROJECT_PROTOCOL.md's State persistence section.
# If Stop hook overhead becomes an issue, remove it and rely on PreCompact + SessionEnd only.

set -euo pipefail

SNAP_DIR=".control/snapshots"
STATE_FILE=".control/progress/STATE.md"
LATEST_LINK="$SNAP_DIR/current.md"

[ ! -f "$STATE_FILE" ] && exit 0

mkdir -p "$SNAP_DIR"

# Only write if STATE.md content differs from the last snapshot (avoid churn)
if [ -f "$LATEST_LINK" ] && cmp -s "$STATE_FILE" "$LATEST_LINK"; then
    exit 0
fi

cp "$STATE_FILE" "$LATEST_LINK"
