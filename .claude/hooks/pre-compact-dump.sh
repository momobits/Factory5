#!/usr/bin/env bash
# Control hook: PreCompact
# Fires BEFORE Claude Code compacts the conversation history to free context.
# Snapshots live state to disk so nothing is lost when context is compressed.

set -euo pipefail

SNAP_DIR=".control/snapshots"
TS=$(date -u +%Y%m%d-%H%M%S)

mkdir -p "$SNAP_DIR"

# Snapshot the live progress files -- quietly skip missing ones
for f in STATE.md journal.md next.md; do
    [ -f ".control/progress/$f" ] && cp ".control/progress/$f" "$SNAP_DIR/${f%.md}-$TS.md" || true
done

# Log the snapshot marker into the journal so it's discoverable
if [ -f ".control/progress/journal.md" ]; then
    tmp=$(mktemp)
    {
        echo "## $(date -u +%Y-%m-%d) -- PreCompact snapshot"
        echo "- snapshot id: $TS"
        echo "- files: STATE.md, journal.md, next.md"
        echo ""
        cat ".control/progress/journal.md"
    } > "$tmp"
    mv "$tmp" ".control/progress/journal.md"
fi

# Trigger pruning so snapshots don't grow unbounded
bash .claude/hooks/prune-snapshots.sh || true

echo "[control:PreCompact] snapshot $TS written to $SNAP_DIR" >&2
