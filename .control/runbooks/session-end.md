# Session end protocol

Trigger: phase boundary, context getting heavy, or user says wrap up.

1. **Check git.** Run `git status --porcelain`. If dirty, either commit now (propose a message following `<type>(<phase>.<step>): <subject>`) or record the reason in STATE.md's In-flight work section. Uncommitted-without-explanation is a protocol violation.

2. **Update `.control/progress/STATE.md`** — overwrite every section:
   - Last updated (UTC timestamp + session id)
   - Current phase / step / status
   - Next action (concrete and actionable)
   - Git state (branch, last commit, uncommitted, last phase tag)
   - Open blockers (with issue IDs)
   - In-flight work (files mid-edit with what's left)
   - Test / eval status (last run, score)
   - Recent decisions (last 3 ADRs)
   - Recently completed (last 5 steps with commit shas)
   - Attempts that didn't work (current step's dead-ends)
   - Environment snapshot (if changed)
   - Notes for next session

3. **Append to `.control/progress/journal.md`** (newest on top):
   - Date + session id
   - Phase / step range (with commit sha range)
   - Decisions made (with ADR refs)
   - Issues opened / closed
   - Minor fixes (severity-gated — inline per the Issue flow section)
   - Significant blockers hit

4. **Write `.control/progress/next.md`** — self-contained prompt for the next session. Must reference STATE.md + current phase docs so a cold-start bootstrap works.

5. **Commit the docs updates** — `docs(state): session end for step <N.M>`.

6. **Print the next prompt** — "Paste this to start your next session."

The `SessionEnd` hook is a safety net — it snapshots state on actual session shutdown but does NOT replace running `/session-end` in the active session. The hook only captures what's already on disk.
