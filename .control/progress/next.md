# Next session — paste this to start

Continue factory5 Phase 6, sub-phase 6a.

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-6a-findings-registry/README.md` and
`.control/phases/phase-6a-findings-registry/steps.md` (the detailed
step checklist was authored at Phase 6c's close). Also read
`docs/Phase6_Progress.md` for the cross-sub-phase charter, and
`docs/decisions/0018-verifier-advisory-only.md` — the `advisory` flag
shipped in 6c is a hand-off 6a's display layer (`factory findings
list`) will branch on.

Check `.control/issues/OPEN/` for blockers and `docs/issues/INDEX.md`
for any new factory5 self-issues opened since 2026-04-21.

Report back a 4-line status in this shape:

```
Phase 6 — Operator-trust, sub-phase 6a — Cross-project findings registry, step 6a.1
Last action: Phase 6c closed (tag phase-6c-verifier-overhaul-closed; commit <sha>)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last>
Open blockers: <count> OR None
Proposed next action: step 6a.1 — design findings_registry schema + state migration
Ready to proceed?
```

Then wait for `go` before editing code.

Budget for 6a: $4–6, 1–2 sessions. Carry-over concern: live-run spend
trending above envelope ($7.71 in 6c, $5.84 in 5f). Phase 7a
(per-build `max_usd` cap) is pre-charted — 6a won't enforce it, but
keep the backfill step (6a.5) narrow.

Execution order for Phase 6: **6c (done) → 6a (next) → 6b**. After 6a,
6b requires OAuth / PAT coordination before starting.
