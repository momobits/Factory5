# Next session — paste this to start

Open Phase 7, sub-phase 7a — budget enforcement (`max_usd` / `max_steps`).

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-7-budget-discipline/README.md` and
`.control/phases/phase-7-budget-discipline/steps.md` for the 9-step
7a checklist + 7b / 7c previews.

Also read:

- `docs/decisions/0019-drop-github-integration.md` — the Phase 6
  close ADR. Not strictly required for 7a, but the durable doctrine
  it records ("factory's effects in the world are operator-directed
  per-directive, not pattern-driven") is relevant if 7a's escalation
  shape touches any external-effect surface.
- `docs/Phase6_Progress.md` closed narrative — context for how
  Phase 6 ended (6c + 6a shipped, 6b dropped).
- `CompleteArchitecture.md` §12 line 454 — the original `max_usd` /
  `max_steps` note from the scaffold.

**No pause-for-human.** 7a needs no secrets; it's an internal
budget-tracking phase. The first concrete work is **7a.1** — draft
ADR for the pre-call cost-estimate approach. Three candidates are
already enumerated in STATE.md's Next-action section; the ADR picks
one and documents the escalation shape.

Report back a 5-line status in this shape:

```
Phase 7 — Operator-control + budget discipline, sub-phase 7a — budget enforcement, step 7a.1
Last action: Phase 6 closed (tag phase-6-closed; commit <sha>)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last>
Open blockers: 1 (I008, MEDIUM, findings-registry collision — deferred to Phase 7+)
Proposed next action: 7a.1 — draft ADR for pre-call cost estimate approach
Ready to proceed?
```

Budget for 7a: ~1 session, $2–4 LLM spend for the regression
validation (synthetic build hits the ceiling → clean escalation).
Live validation `factory build example --max-usd 3` is intentionally
cheap — the point is halting early, not finishing.

Execution order for Phase 7: **7a → 7b → 7c** (strict). After 7c
closes, Phase 7 as a whole closes with tag `phase-7-closed`, and
Phase 8 opens (not yet charted).

**Operator follow-up from Phase 6 close, out-of-band whenever
convenient:** revoke the `env:GITHUB_TOKEN` PAT at
https://github.com/settings/tokens, delete the throwaway repo
(`gh repo delete momobits/factory5-6b-smoke --yes`), clear the env
var (`reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`). None of
these block Phase 7.
