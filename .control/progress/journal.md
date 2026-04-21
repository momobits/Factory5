# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

## 2026-04-21 (session `2026-04-21T21`) — Phase 7b.1 shipped (first-class project identity; I008 resolved)

- **Commit range:** `db87e97` → `1999a14` (6 commits in factory5 + 1 in Control source `cee27a1`). **Phase step range:** session-internal Control-fix → 7b.1 close.
- **Decisions:** ADR 0021 — first-class project identity via `<project>/.factory/project.json` (ULID). Stable across path moves; explicit at fork (delete file before next build). Mirrors how git, npm, uv claim per-project identity. Five-part decision: file shape, helper resolve rules, schema migration, backfill, CLI display. Supersedes both prior framing options for I008's collision (per-path PK and per-directive-only fuzzy view) — neither would have given identity that survives a path move.
- **Issues:** none opened. **I008 RESOLVED** (commit `1999a14`) with regression-test references in 4 files: migration 006 shape + backfill, project-metadata helper, state.projects two-projects-same-name test, cli/findings backfill identity-required test. Open backlog now empty.
- **Schema additions:** migration 006 — `projects.id TEXT PRIMARY KEY NOT NULL` (rebuilt from name-PK via table-rebuild + post-hook backfill), `directives.project_id TEXT` (no FK to keep migration tractable; helper owns lifecycle), `findings_registry.project_id` semantics shift basename → ULID via post-hook UPDATE, `learnings.source_project` similarly translated. Migration interface gained optional `post: (db) => void` hook (runs inside the same transaction as `up` SQL) and `runMigrations(db, { maxId })` so tests can stage data at a specific schema version before triggering a later migration's backfill.
- **Helper:** `wiki.loadOrCreateProjectMetadata(projectPath, name, opts?)` reads-or-creates `<project>/.factory/project.json`. Throws `ProjectMetadataCorruptError` on present-but-unparseable rather than silent re-tag (which would lose project history). Companion `readProjectMetadata` for inspection-only flows.
- **Integration end-to-end:** CLI `build.ts` + `resume.ts` populate `directive.projectId` (resume inherits from parent directive or falls back to `findByName`); brain `pool.ts` derives projectId from the directive (one SELECT per task) for the FindingRegistryBinding; wiki `mirrorToRegistry` skips the registry write if no projectId rather than fall back to `basename(projectPath)` (the I008 trap); cli `findings.ts` backfill uses `readProjectMetadata`, skips projects without an identity file with a clear operator hint to run `factory build` once. Brain `pool.ts` switched off `basename` import; wiki `findings.ts` same.
- **Control-framework hygiene (factory5 + Control source).** Session-start protocol gains step 5b: when `next.md` surfaces a `## Decisions awaiting your input` section or STATE.md flags an open design choice, expand each option in full at bootstrap rather than as labeled footnotes — caught from this session itself wasting a turn on (a)/(b) shorthand. Mirrored across factory5's `.claude/commands/session-start.md` + `.control/runbooks/session-start.md` + the embedded copies in `.control/PROJECT_PROTOCOL.md`. Same change in Control source repo (`cee27a1`). next.md template gains the matching `## Decisions awaiting your input` slot.
- **Tests: 375 green** (was 347 at Phase 7a close; +28 across 7b.1: 11 migration 006 shape + backfill, 11 project-metadata helper, 3 state.projects rewrite for id-keyed CRUD + two-projects-same-name regression, 1 cli backfill skip-on-missing-identity, 2 wiki dual-write `projectId` propagation).
- **Phase 7b re-scope.** Original 4-step plan grew to 5 steps. New 7b.1 is data-model prep (this session); existing query → 7b.2, CLI → 7b.3, round-trip → 7b.4, close → 7b.5. README est. sessions bumped from 1 to 1–2.
- **Format hygiene.** Prettier format-pass on 24 previously-unformatted control & docs files (commit `786698a`, separate from substantive work). Pure whitespace; `pnpm format:check` is now clean across the workspace.
- **Spend: $0** — pure local TS + SQLite + Node fs work; no LLM calls.
- **Follow-up noted, not blocking:** Brain `pool.ts` does one extra `directives.getById` SELECT per task to fetch `projectId`. Could be optimized by passing projectId through PoolOptions instead, but the current shape keeps PoolOptions stable. No measured impact; revisit if pool throughput becomes a bottleneck. **`docs/PROGRESS.md` and `docs/Phase7_Progress.md` 7b.1 row** not updated this session — non-blocking; can land alongside 7b.2 or as standalone hygiene.
- 7b.2 (spend aggregation queries) opens next session on a clean foundation. No [HALT] gates remain in 7b.

## 2026-04-21 (session `2026-04-21T17`) — Phase 7a closed (budget enforcement shipped)

- **Commit range:** `d295dd3` → close commit. **Phase step range:** 7a.1 → 7a.9.
- **Decisions:** ADR 0020 (pre-call budget enforcement; rolling average from `model_usage` per `(category, mode)` with cold-start defaults; `assertBudget` wrapper in `@factory5/brain/src/budget.ts`; `budget_exceeded_*:` prefix on `directives.blocked_reason`; per-directive scope — not per-session, not cumulative).
- **Issues:** none opened, none closed. Open backlog unchanged: {I008 MEDIUM, findings-registry project-id collision — may surface in Phase 7b if grouping by project_id}.
- **Schema additions:** migration 004 (`model_usage.mode` nullable TEXT), migration 005 (`directives.max_usd REAL` + `max_steps INTEGER` nullable). Both additive; absent = unlimited (pre-ADR-0020 behaviour).
- **Call-site integration:** triage / architect / planner call `assertBudget` before the registry provider call; pool invokes it pre-dispatch using `isToolUsingAgent(task.agent)` to pick `'stream'` vs `'call'`; `loop.runInline` catches `BudgetExceededError` at the outer boundary, flips directive to `blocked` via `formatBlockedReason`, queues outbound escalation with a `factory resume --max-usd <higher>` hint. Providers + worker untouched — they stay dumb about budgets.
- **CLI + config:** `--max-usd <n>` / `--max-steps <n>` flags on `factory build` (7a.5); `[budget.defaults]` section in `~/.factory5/config.toml` (7a.6). Explicit flag wins over config default; both absent = unlimited.
- **Regression test:** `packages/brain/src/budget-regression.test.ts` — 3 scenarios covering maxUsd trip (pre-seeded spend against $3 ceiling), maxSteps trip (3rd call against maxSteps=2), happy path (limits well above estimate). Asserts on error kind, directive blocked_reason, `tasks_inflight` emptiness, and `readPlan` persistence as `abandoned`.
- **Live validation passed.** `factory build example --max-usd 3` against fresh workspace. Tripped cleanly at builder-2 dispatch: `spentSoFar=$1.9151 + estimatedCost=$2.00 > ceiling=$3.00`. Directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M` ended `blocked` with the expected `budget_exceeded_usd:` blocked_reason. 5 `model_usage` rows recorded with correct mode values. Phase 6c's silent $7.71-over-$4-6 overshoot is not reproducible; $1.08 headroom at the halt.
- **Tests: 347 green** (was 309 at Phase 6 close; +38 across 7a: 3 migration 004 shape, 14 model-usage queries, 3 migration 005 shape, 12 budget unit, 3 budget integration regression, 2 config budget-defaults, with one existing migration-idempotency assertion updated).
- **Spend:** $1.9151 (live validation only) — right at the bottom of the $2–4 envelope the user scoped for the session.
- **Minor polish.** Pool.ts's `running.size === 0` branch now labels pending tasks with the budget reason (not "deadlock") when `budgetError` is set. Doesn't affect directive-level state; improves per-task blocked_reason readability if anyone ever surfaces it.
- **Follow-up noted, not blocking:** CLI build-summary omits partial task results when the budget catches (returns `taskResults: []` from the catch arm); `InlineResult.triage` is optional now but the CLI still falls back cleanly when missing.
- Phase tagged `phase-7a-budget-enforcement-closed` on this close commit. Phase 7b (spend dashboard) kicks off next session; next step is 7b.1 — spend-aggregation queries in `@factory5/state`.

## 2026-04-21 (session `2026-04-21T16`) — Phase 6 closed (6c + 6a shipped; 6b dropped per ADR 0019)

- **Commit range:** `c780180` → `47cf160` (4 commits). **Phase step range:** 6b.1 → phase-6-close.
- **Decisions:** ADR 0019 (drop GitHub integration; durable doctrine: factory's effects are operator-directed per-directive, not pattern-driven).
- **Issues:** none opened, none closed. Open backlog unchanged: {I008 MEDIUM, findings-registry project-id collision}.
- Phase tagged `phase-6-closed` on commit `47cf160`. Phase 7 (Operator-control + budget discipline) kicked off; next step is 7a.1 — ADR for pre-call cost estimate approach.
- **Phase 6b dropped wholesale.** Session opened Phase 6b cleanly (6b.1 commit `c780180` recorded PAT + test repo scaffolding). At 6b.2 — the event-source design ADR — the session surfaced that (a) the charter had silently pivoted GitHub from event-source (scaffold intent) to channel (Phase 6b charter) without justification, and (b) neither framing earned its keep for a solo dev-box operator: channel duplicates the CLI; observer needs factory's outputs to live on GitHub first, which no phase has built. Drop was wholesale.
- **ADR 0019 records the decision + durable doctrine.** Commit `c39ef8f`. Three decisions in one doc: no GitHub channel; no GitHub observer; future output-to-GH (if and when it ships) is operator-directed per-directive, not pattern-driven. This last principle generalises — factory's side-effects in the world happen because a directive asks for them, not because a daemon observer or channel plugin silently decides.
- **Code + doc prune.** Commit `ee85efd`. Pruned: `'github'` + `'webhook'` from `CHANNEL_IDS`; three `github.*` event kinds from `eventBodySchema`; github narrative from `CompleteArchitecture.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `README.md`; `github-poll` + `webhook-server` stub mentions from `packages/events/README.md`; "GitHub polling" phrase from `packages/daemon/README.md` + `apps/factoryd/package.json` description; "GitHub event description" from `prompts/agents/triage.md`. Migration 001's CHECK constraints intentionally left in-place (SQLite cannot ALTER a CHECK; stricter-TS-over-wider-DB is harmless; comment added pointing to ADR 0019). Tests re-pointed at `fs.changed`. 309 tests green (no delta).
- **Charter amendment.** Phase 6 exit criterion #2 ("accept at least one non-CLI trigger live — a real GitHub issue...") struck through per the charter's "scope is flexible" clause, replaced with "factory accepts at least one non-CLI trigger — Discord (shipped Phase 4)."
- **Phase 7c dependency updated.** Telegram (7c) no longer depends on "patterns locked by 6b"; Discord is the reference channel.
- **`.control/phases/phase-6b-github-channel/` deleted in full.** Scaffolded Phase 7 at `.control/phases/phase-7-budget-discipline/` with README + placeholder steps.md covering 7a (9 steps) + 7b + 7c.
- **Operator follow-up (out-of-band).** Revoke the `env:GITHUB_TOKEN` PAT, delete `momobits/factory5-6b-smoke`, clear the env var. Documented in STATE.md + next.md. Non-blocking for Phase 7.
- **Spend: $0** — a second consecutive zero-LLM-spend session. Phase 6 closed cheap.

## 2026-04-21 — Phase 6b kickoff (6b.1 — `[HALT] secret_needed` resolved)

- PAT reference + test repo recorded: `env:GITHUB_TOKEN` stored in `HKCU\Environment` (persistent user env, classic PAT, `public_repo` scope); test repo `momobits/factory5-6b-smoke` (public, issues enabled, default branch `main`). Full caveats + rollback in `.control/phases/phase-6b-github-channel/config.md`. **No secret value** committed — only the reference shape.
- Pre-commit verification confirmed the repo is reachable (HTTP 200 unauthenticated) and the env var is present in `HKCU\Environment`. The current Claude Code bash does not see `$GITHUB_TOKEN` (parent-process env frozen before `setx`) — factoryd spawned after `setx` will inherit it, so the 6b.6+ code paths are unblocked even though this session's bash cannot directly exercise the token.
- No code touched, no tests changed, $0 spend. Next step **6b.2** — ADR on the event source (webhook vs polling vs hybrid); the decision gates expansion of the placeholder 6b.3–6b.9 sub-step bodies.
- Commit: `chore(6b.1): record github test repo + PAT ref`.

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
