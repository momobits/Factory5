# Next session — paste this to start

Continue factory5 Phase 6, sub-phase 6b — GitHub channel.

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-6b-github-channel/README.md` and
`.control/phases/phase-6b-github-channel/steps.md` (the 9-step
checklist is placeholder-level; detailed per-step bodies get
authored at session start once the 6b.2 ADR decision — webhook
vs polling vs hybrid — is made).

Also read `docs/Phase6_Progress.md` for the cross-sub-phase
charter context (6c ✅, 6a ✅, 6b is the last sub-phase) and
`docs/issues/I008-findings-registry-project-id-collision.md` — the
one open factory5 self-issue; may touch 6b if GitHub directive
ingest routes through `projects.upsert`.

**6b.1 is `[HALT] secret_needed`.** The session cannot begin
without:
- A GitHub Personal Access Token with minimum scopes (`repo`,
  `read:org`) — cite the token via a reference you keep out of
  the repo (env var, secrets manager), not the token itself
- A throwaway test repo URL for the 6b.8 live-smoke run

Have both ready before running `/session-start`.

Report back a 5-line status in this shape:

```
Phase 6 — Operator-trust, sub-phase 6b — GitHub channel, step 6b.1
Last action: Phase 6a closed (tag phase-6a-findings-registry-closed; commit <sha>)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last>
Open blockers: 1 (I008, MEDIUM, findings-registry collision — deferred)
Proposed next action: 6b.1 pause-for-human — awaiting GitHub PAT + test repo URL
Ready to proceed?
```

Then wait for the user to paste the PAT reference and repo URL
before editing code.

Budget for 6b: 2–3 sessions, estimated $6–15 across the arc (the
live-smoke in 6b.8 runs a real `factory build` triggered by the
GH channel). Carry-forward concern: live-run spend trending
above envelope across 5f ($5.84) / 6c ($7.71); Phase 7a remains
pre-charted to enforce `max_usd` caps.

Execution order for Phase 6: **6c (done) → 6a (done) → 6b
(next)**. After 6b: Phase 6 as a whole closes, Phase 7 opens
(Operator-control + budget discipline — 7a/7b/7c).
