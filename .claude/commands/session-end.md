---
description: Close the session — commit dirty tree, update STATE.md, write next-session prompt, journal
---

Follow `.control/runbooks/session-end.md`:

1. **Check git state.** Run `git status --porcelain` and `git log -1 --oneline`.
   - If working tree is dirty, propose a commit message following `<type>(<phase>.<step>): <subject>` (see `.control/config.sh` `CONTROL_COMMIT_TYPES` for allowed types) and ask the user to confirm. If the user declines, record the reason in STATE.md's "In-flight work" section.

2. **Update `.control/progress/STATE.md`** — overwrite every section:
   - Last updated (UTC timestamp + session id)
   - Current phase / step / status
   - Next action (concrete and actionable)
   - Git state (branch, last commit sha + subject, uncommitted yes/no, last phase tag)
   - Open blockers (with issue IDs)
   - In-flight work (files mid-edit with what's left)
   - Test / eval status (last run, score)
   - Recent decisions (last 3 ADRs)
   - Recently completed (last 5 steps with commit shas)
   - Attempts that didn't work (current step's dead-ends; cleared when step closes)
   - Environment snapshot (if changed)
   - Notes for next session

3. **Append to `.control/progress/journal.md`** (newest on top):
   - Date + session id
   - Phase / step range (with commit sha range)
   - Decisions made (with ADR refs)
   - Issues opened / closed
   - Minor fixes (severity-gated — see Issue flow section of PROJECT_PROTOCOL.md)
   - Significant blockers hit

4. **Write `.control/progress/next.md`** — self-contained prompt for the next session that references STATE.md + current phase docs so bootstrapping works from a cold start.

5. **Commit the docs updates:** `docs(state): session end for step <N.M>`.

6. **Print the next prompt** — "Paste this to start your next session."
