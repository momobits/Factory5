# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

## 2026-04-21 — Control instantiated for Phase 6
- Control framework v1.3.0 installed (commit `6494766`, tag `protocol-initialised`). Installer preserved factory5's existing `CLAUDE.md`, `docs/`, `CompleteArchitecture.md`.
- Content-vs-operational split documented in `CLAUDE.md`: long-form content (ARCHITECTURE, CONTRACTS, SKILLS, AGENTS, PROGRESS, ADRs, issues, Phase*_Progress) stays under `docs/`; Control only owns the operational cursor (`.control/progress/`) and per-phase checklists (`.control/phases/`).
- `.control/architecture/overview.md` rewritten as pointer-only into `docs/`.
- `.control/architecture/phase-plan.md` populated: Phases 0–5 closed pre-Control, Phase 6 active with sub-phases 6c → 6a → 6b in execution order.
- Scaffolded `.control/phases/phase-6c-verifier-overhaul/` (detailed steps), `phase-6a-findings-registry/` (stub), `phase-6b-github-channel/` (stub).
- STATE.md set to Phase 6, sub-phase 6c, step 6c.1. Next action: author F001 regression-reproducer test.
- No implementation work yet. Next session begins step 6c.1.
