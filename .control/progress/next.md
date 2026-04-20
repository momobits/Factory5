# Next session — paste this to start

Continue factory5 Phase 6.

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then `.control/phases/phase-6c-verifier-overhaul/README.md` and `.control/phases/phase-6c-verifier-overhaul/steps.md`. Also read `docs/Phase6_Progress.md` for the full Phase 6 charter and `prompts/agents/verifier.md` (it's a 6-line Phase 1 stub — that stub is part of the problem 6c is solving).

Pull up the F001 reproducer finding at `C:/Users/Momo/factory5-v5f-example-2/example/.factory/findings.json` — that's the concrete forcing function this sub-phase exists to fix.

Check `.control/issues/OPEN/` for blockers and `docs/issues/INDEX.md` for any new factory5 self-issues opened since 2026-04-21.

Report back a 4-line status in this shape:

```
Phase 6 — Operator-trust, sub-phase 6c — Verifier overhaul, step 6c.1
Last action: Control instantiated (commit <sha>)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last>
Open blockers: <count> OR None
Proposed next action: step 6c.1 — author F001 regression-reproducer test (red)
Ready to proceed?
```

Then wait for `go` before editing code.

Budget for 6c: $4–6, one session. If scope expands past that, pause and reassess.
Execution order for Phase 6: **6c → 6a → 6b**.
