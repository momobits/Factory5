# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

## 2026-04-21 — Phase 6c closed (verifier advisory-only)

- Phase tagged `phase-6c-verifier-overhaul-closed` on commit `a24f883`. Phase 6a kicked off.
- ADR 0018 decided advisory path: Finding schema gains optional `advisory`; verifier source defaults to true; `brain.loop` log splits open findings into blocking vs advisory; verifier prompt rewritten (6-line stub → 90-line brief with anti-hallucination rule).
- Live validation (directive `01KPQK61F9967TT8JZWCMCV3NW`, 2026-04-21) ended `complete` with gate all-true, 119 pytest green, two verifier findings both `advisory:true` and non-contradictory. F001-class defect (CRITICAL absence hallucination contradicting green gate) not reproducible.
- Tests: 262 green (was 255 at Phase 5 close; +2 core schema, +3 wiki addFinding, +2 worker F001 regression).
- Spend overrun: live run cost $7.71 vs $4–6 envelope. Carry-forward concern for 6a/7a.
- Commits: 6c.1 `c35681a` → 6c.8 `a24f883`; phase-close commit appends Phase 6a scaffold + STATE + next.md + this journal entry.
- No new factory5 self-issues opened; `docs/issues/INDEX.md` Open list still empty.

## 2026-04-21 — Control instantiated for Phase 6

- Control framework v1.3.0 installed (commit `6494766`, tag `protocol-initialised`). Installer preserved factory5's existing `CLAUDE.md`, `docs/`, `CompleteArchitecture.md`.
- Content-vs-operational split documented in `CLAUDE.md`: long-form content (ARCHITECTURE, CONTRACTS, SKILLS, AGENTS, PROGRESS, ADRs, issues, Phase\*\_Progress) stays under `docs/`; Control only owns the operational cursor (`.control/progress/`) and per-phase checklists (`.control/phases/`).
- `.control/architecture/overview.md` rewritten as pointer-only into `docs/`.
- `.control/architecture/phase-plan.md` populated: Phases 0–5 closed pre-Control, Phase 6 active with sub-phases 6c → 6a → 6b in execution order.
- Scaffolded `.control/phases/phase-6c-verifier-overhaul/` (detailed steps), `phase-6a-findings-registry/` (stub), `phase-6b-github-channel/` (stub).
- STATE.md set to Phase 6, sub-phase 6c, step 6c.1. Next action: author F001 regression-reproducer test.
- No implementation work yet. Next session begins step 6c.1.
