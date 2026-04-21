# Session start protocol

1. **Read state** — `.control/progress/STATE.md`. Note every field: phase, step, next action, git state, blockers, in-flight work, test/eval status, recent decisions, attempts that didn't work, notes.
2. **Read phase context** — the README and steps files for the phase path in STATE.md.
3. **Scan open issues** — list every file in `.control/issues/OPEN/`. Identify items tagged as blockers for the current phase.
4. **Verify git** — run `git status --porcelain`, `git log -1 --oneline`, `git rev-parse --abbrev-ref HEAD`, `git describe --tags --abbrev=0`. Compare against STATE.md's Git state section. Any mismatch is a drift signal — flag it, don't silently proceed.
5. **Report to user**, in this exact shape:
   ```
   Phase <N> — <name>, step <N.M>
   Last action: <what was done last>
   Git: branch=<...>, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last phase tag>
   Git sync: ✓ matches STATE.md  OR  ⚠ drift: <details>
   Open blockers: <count, with IDs> OR None
   Test/eval status: <from STATE.md>
   Proposed next action: <from STATE.md>
   Ready to proceed?
   ```
5b. **Design decisions awaiting operator input.** If `.control/progress/next.md` surfaces a `## Decisions awaiting your input` section, or STATE.md's "Notes for next session" / "Next action" flags an open design choice for the upcoming step, expand it inline before asking for go. For each option present: **(i) what concretely changes** (schema additions, code shape, file additions), **(ii) what the operator sees** (sample CLI output, sample data shape, sample error), **(iii) cost / scope impact** (how it affects the current step's budget and surrounding work), **(iv) trade-off being accepted** (what each option costs, not just what it gains). End with a recommendation that names the trade-off, not just the lean. Do not shorthand design choices as labeled footnotes (`(a)` / `(b)` with one-line summaries) — that forces the operator to ask for the detail in a second turn, wasting context.
6. **Wait for confirmation.** Do not edit code before the user says go.

If `SessionStart` hook is installed (`.claude/hooks/session-start-load.sh`), steps 1-5 run automatically and prefix the session with bootstrap instructions.
