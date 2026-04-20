#!/usr/bin/env bash
# Control hook: SessionStart
# Fires at the beginning of every Claude Code session.
# Injects the session-start protocol into context so Claude bootstraps automatically.

set -euo pipefail

LATEST_SNAP=$(ls -t .control/snapshots/STATE-*.md 2>/dev/null | head -1 || echo "")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "not-a-git-repo")

if git rev-parse HEAD >/dev/null 2>&1; then
    GIT_LAST=$(git log -1 --oneline 2>/dev/null)
    if git diff-index --quiet HEAD -- 2>/dev/null && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
        GIT_DIRTY="clean"
    else
        GIT_DIRTY="DIRTY"
    fi
    LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
else
    GIT_LAST="(no commits yet)"
    GIT_DIRTY="n/a (no HEAD)"
    LAST_TAG="none"
fi

cat <<EOF
[control:SessionStart] Bootstrap

Before accepting user input, run the session-start protocol:

1. Read .control/progress/STATE.md
2. Read .control/progress/next.md (last session's handoff, if present)
3. Read the current phase README + steps (path in STATE.md)
4. List .control/issues/OPEN/ and flag current-phase blockers

Git state at session start (verify against STATE.md's Git state section):
  branch: $GIT_BRANCH
  last: $GIT_LAST
  working tree: $GIT_DIRTY
  last tag: $LAST_TAG

Latest PreCompact snapshot: ${LATEST_SNAP:-none}

After reading, report the standard status block and wait for the user's go
before editing any code. If git state differs from STATE.md's claim, flag the
drift before reporting -- do not silently proceed.
EOF
