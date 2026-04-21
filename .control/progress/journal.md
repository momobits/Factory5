# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

## 2026-04-21 — Phase 6a closed (cross-project findings registry)

- Phase tagged `phase-6a-findings-registry-closed` on the `chore(phase-6a)` close commit. Phase 6b (GitHub channel) kicked off; paused at 6b.1 pending user PAT + test repo URL.
- Shipped: `findings_registry` SQLite table (composite PK on `(project_id, finding_id)`, `advisory` column mirroring ADR 0018); `wiki.addFinding` + `updateFindingStatus` gain optional `FindingRegistryBinding` for best-effort dual-write; worker + brain pool wire the binding end-to-end; `factory findings list | show | backfill` CLI surface complete with filters, glob, NDJSON output, per-project dedup.
- Tests: 309 green (was 262 at Phase 6c close; +9 state migration shape, +8 state registry queries, +6 wiki dual-write, +24 CLI handlers — CLI gained its first test file).
- Spend: $0 — first factory5 session since Phase 3 that did no LLM calls. Validation was local SQL + filesystem only.
- Issue opened: **I008** (MEDIUM, state/findings-registry) — `project_id = basename(path)` collides across workspaces; 6a's backfill against the v5f/v6c corpora overwrote v5f's F001 on composite-PK conflict. Per-project `findings.json` files untouched; registry-only representation limit. Candidate fix: PK on `(project_path, finding_id)`. Deferred to Phase 7+.
- Mid-session Control discipline addition (commit `87ea1c0`): CLAUDE.md now mandates flipping the matching `- [ ]` in `.control/phases/<phase>/steps.md` to `- [x]` in the same commit as the sub-step closer. Proposal filed as Improvement 6 in `G:/Projects/Small-Projects/Control/improvement.md` for v1.3.1 / v1.4.0 inclusion.
- Commits: 6a.1 `5d81fe2` → 6a.8 close commit; docs-side close at `fd3837e`. Phase-6a tag lands on this phase-close commit.

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
