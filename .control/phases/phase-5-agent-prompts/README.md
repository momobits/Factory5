# Phase 5 — agent-prompts

**Dependencies:** None hard. Soft sequence after `phase-4-cli-completion-closed` (the natural post-arc continuation). No code dependency on prior phases — Phase 5 is doc + prompt rewriting plus an optional small CLI command.
**Estimated duration:** ~1 session

## Goal

Every active agent prompt in `prompts/agents/` is substantive and factory5-native (built for the current architecture, not ported wholesale from factory2). Stale doc claims that conflict with what shipped through Tiers 1–4 are corrected. The single CLI stub-by-design (`factory logs`) is either implemented minimally or retired.

## Outcome

- `prompts/agents/README.md` accurately reflects every prompt's role + purpose with no transient status field. The "Phase 1 work" section and "ported from factory2" provenance are gone.
- `docs/ONBOARDING.md` §5.4 reflects post-Tier-3 reality: SSE-driven live updates work, project creation via `/app/projects/new` is supported.
- `prompts/agents/reviewer.md` is a complete factory5-native prompt: adversarial reviewer, FINDING marker contract verified against `pool.ts:111-132`, advisory-vs-blocking policy pinned.
- `prompts/agents/fixer.md` is a complete factory5-native prompt with a verified runtime contract — either matches an existing brain parser, ships a new parser as part of the same step (re-scoped to `feat`), or documents a prose-only flow with a Tier 6 follow-up.
- `prompts/agents/investigator.md` is a complete factory5-native prompt: read-only constraint with concrete examples, structural conventions for output that the operator (or next planner step) can read consistently.
- `prompts/agents/builder.md` carries a complete factory5-native body. The Python venv discipline section (load-bearing for I007 host-pollution) is preserved byte-for-byte. The "Phase 1 stub" marker is gone.
- `factory logs` either works minimally (`--component`, `--directive`, `--follow`) or is removed entirely. No half-stub rows in `packages/cli/README.md`.

## Where we were, end of Phase 4

Phase 4 closed `phase-4-cli-completion-closed` (28c0188) after a nine-step arc that brought CLI parity with the four-channel operator surface vocabulary established in Phases 2 and 3. ADRs 0027 / 0028 / 0029 pinned the web-side mutation surface, the worker-sandbox contract, and the SSE protocol respectively; together they form the shipped state Tier 5 docs need to align with. The /session-end docs(state) commit (f3fd6ed) followed Phase 4's close and parked the upgrade arc as "complete" — Tier 5 reopens it for one targeted, audit-driven session.

What 5.x can rely on without re-paving:

- **Existing FINDING marker parser** — `pool.ts:111-132` reads `finding.source` and `finding.advisory` as-set on insert; verifier ships `advisory: true` (per ADR 0018). Reviewer's source/advisory tags are the verifiable open question for 5.4.
- **Existing `markFinding` API** — `packages/wiki/src/findings.ts:189` accepts a status (`OPEN` / `FIXED` / `VERIFIED` / `WONTFIX`) plus an optional resolution string + sets `resolvedAt`. Whether the brain has a parser that converts agent output → `markFinding` call is the open question for 5.5 (three branches; commit type changes per choice).
- **Hot-reload prompt loader** — `packages/brain/src/prompts.ts` reads `prompts/agents/<role>.md` at the start of every directive. No rebuild needed; edits land at the next directive.
- **Five substantive prompts already factory5-native** — triage / architect / planner / scaffolder / verifier reference current architecture (8-intent vocabulary; ADR 0018 advisory framing; Python pyproject.toml hatchling-vs-setuptools gotchas; ADR 0028 worker sandbox boundaries). They define the depth and shape Tier 5's writes should match.

## Why this phase exists

Post-arc audit (2026-05-07) surfaced three categories of staleness that all fail an honest re-read of the project against shipped reality:

1. **Three pure stubs ship to the model on every directive.** `prompts/agents/reviewer.md`, `fixer.md`, and `investigator.md` are 10-line files with `> **Phase 1 stub. Body to be ported from factory2…**` markers. The brain dispatches the agent's role on a 10-line prompt. This shipped without a noticed quality regression because the substantive prompts (triage / architect / planner / scaffolder / verifier) carry the load — but the deficient roles do real work in some directive shapes (multi-builder fix passes, novel-problem investigations) and the prompt depth is what gates that work.
2. **One hybrid lies about itself.** `builder.md` has substantive Python venv content (load-bearing for I007 host-pollution) but still flags itself as a `Phase 1 stub`. A reader hits the marker and assumes the file is empty.
3. **Two stale doc claims compound discoverability.** `prompts/agents/README.md`'s status table claims all 9 prompts are "stub" (false for 5 of them). `docs/ONBOARDING.md` §5.4 says detail pages are read-once and projects can't be created from the SPA — both shipped past in Tier 3.

Plus one carry-over: `factory logs` has shipped as a "stub that prints a hint" since Phase 1 of the original arc. It's been cumulative ambiguity ever since. Either implement minimally or remove the row + the command.

User directive: **build new for factory5, don't port from factory2.** The 3 pure stubs and the hybrid get factory5-native bodies written against current ADRs (0018 advisory finding policy; 0024 ask-user; 0026 pluggable runtimes; 0028 worker sandbox; 0029 SSE), referencing skills by name (the brain loader concatenates skill bodies). Skills themselves stay out of scope — explicitly punted to Tier 6 if 5.4–5.7 surface fit issues.

Issues addressed: U024 (prompts README is stale), U025 (ONBOARDING §5.4 read-once claim is stale post-Tier-3). Both opened by step 5.1 of this phase.

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, runtime-contract verification branches, suggested commit messages): [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:5-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] `prompts/agents/README.md` has no `stub`, `hybrid`, `factory2`, or `Phase 1 stub` terminology in body; column set is `File | Role | Purpose`
- [ ] All 4 deficient prompts (reviewer / fixer / investigator / builder) carry factory5-native bodies with no `Phase 1 stub` markers and no `factory2` references in their bodies
- [ ] `prompts/agents/builder.md` venv discipline section preserved byte-for-byte (verify with diff against pre-5.7 content)
- [ ] `docs/ONBOARDING.md` §5.4 reflects post-Tier-3 SSE + project-creation reality
- [ ] `factory logs` either works minimally (Path A: at least one unit test exercising each flag) or is gone (Path B: no row in CLI README, no command registration in `packages/cli/src/index.ts`)
- [ ] Issues U024, U025 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) with commit refs
- [ ] Tier 5 ROADMAP rows in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md) ticked
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(5.<step>): <subject>` shape (e.g. `docs(5.4): prompts/agents/reviewer.md — write factory5-native body`)
- [ ] Phase will be tagged `phase-5-agent-prompts-closed` by `/phase-close`

## Rollback plan

If Phase 5 needs to be undone: `git reset --hard phase-4-cli-completion-closed`. No external state to roll back — Phase 5 is doc + prompt rewriting plus (Path A only) one new CLI command file. The brain loader hot-reads prompts at the start of every directive, so rolling back the prompts immediately restores the prior behaviour at the next directive.

## ADRs decided in this phase

- (filled in as decisions are made — likely candidate: reviewer-finding-severity policy, if 5.4's runtime-code reading shows the contract is genuinely ambiguous and needs pinning. Probable number 0030.)

## Deferred to Phase 6 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- Skills review + rewrites — all 12 skills in `skills/` are "ported from factory2/skills/"; if 5.4–5.7 surface fit issues, draft `UPGRADE/plans/tier-6-skills-rewrites.md` then.
- `fixer→markFinding` parser path — if 5.5 lands the prose-only branch (no parser today, no clean extension point in this session), wiring it is Tier 6 work.
- U005 chat REPL 120 s timeout — separate problem class; carry-forward from Phase 2's Tier-2-or-4 designation.
