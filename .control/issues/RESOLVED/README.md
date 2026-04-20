# Resolved issues live under `docs/issues/`

factory5 does not move issue files on resolution. Instead, a `status` field in each issue's frontmatter transitions `OPEN` → `IN_PROGRESS` → `RESOLVED` → `VERIFIED`, and the `docs/issues/INDEX.md` table splits them into "Open" and "Resolved (last 20)" sections.

**Resolved issues as of Control install (2026-04-21):** 7 (I001 through I007). All have regression tests. Index: [`docs/issues/INDEX.md`](../../../docs/issues/INDEX.md).

## Why this directory is empty

See the `OPEN/` README alongside. factory5's issue lifecycle is in-place (status change + INDEX row move), not file-move. Control's file-move pattern (`OPEN/` → `RESOLVED/`) is not used.

## If you run `/close-issue`

Update the issue file's `status` frontmatter to `RESOLVED` (or `VERIFIED` once tests confirm) and move its row in `docs/issues/INDEX.md` from the Open table to the Resolved table. Do not move files between directories.

Control's `/close-issue` regression-test gate still applies in spirit — factory5's discipline has always been "every resolved issue has a regression test in the commit." Maintain this.
