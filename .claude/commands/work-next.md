---
description: Autonomously pick and execute the next item per Control's priority rules
---

Read `.control/progress/STATE.md`. Apply this priority order — do the first one that matches, then stop:

1. **Any open blocker in STATE.md's "Open blockers" list?**
   - If yes and a clear hypothesis exists in the issue file → investigate + fix + regression test + `/close-issue`.
   - If yes and no clear hypothesis → **HALT** (see pause conditions below).

2. **Tests or eval failing per STATE.md's "Test / eval status"?**
   - If the fix is obvious and contained → fix + commit + re-run.
   - If ambiguous or requires domain knowledge → **HALT**.

3. **Unchecked item in the current phase's `steps.md`?**
   - Implement the next unchecked step.
   - Respect pause-for-human conditions during the work.
   - Commit: `<type>(<phase>.<step>): <subject>`.

4. **All steps checked but phase not yet closed?**
   - Run `/phase-close`. If criteria fail, surface what's missing.

5. **Phase closed, next phase scaffolded?**
   - Pick step 1 of the new phase and start.

6. **All phases complete per `.control/architecture/phase-plan.md`?**
   - **HALT** with: "All phases complete. No work queued."

After executing the chosen action:
- Update STATE.md (every field, per `/session-end` protocol).
- Append `journal.md`.
- Commit the docs updates.

## Pause-for-human conditions — HALT the loop

Stop immediately, run `/session-end`, and surface to the user when any of these hit (also listed in `.control/config.sh` as `CONTROL_HALT_CONDITIONS`):

- **New ADR needed** — a non-trivial architectural choice came up. Don't silently decide; prompt `/new-adr`.
- **Blocker with no clear hypothesis** — investigation exhausted.
- **Ambiguous failing test** — multiple plausible fixes, no clear winner.
- **Manual smoke test** in a phase's done criteria.
- **User-acceptance** criterion.
- **Secret or credential needed** — API key, auth token, anything outside the repo.
- **Destructive action required** — delete, force-push, drop table, migration rollback.
- **Iteration budget hit** — see `.control/config.sh` `CONTROL_MAX_AUTO_ITERATIONS` (default 20).

Halt format:

```
[HALT] <reason>
Current step: <N.M>
What's needed from you: <concrete ask>
STATE.md updated. Resume with /work-next or /loop /work-next when ready.
```
