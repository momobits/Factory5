# Phase 7 — findings-mark

**Dependencies:** None hard. Soft sequence after `phase-6-skills-rewrites-closed`. No code dependency on prior phases — Phase 7 is composition over the existing `updateFindingStatus` API (`packages/wiki/src/findings.ts:196`) plus the `findingsRegistry.findByFindingId` disambiguation already exercised by `factory findings show`.
**Estimated duration:** ~1 session

## Goal

Ship the operator-side parallel to Tier 6's agent-side `RESOLUTION` parser. `factory findings mark <id> <status>` flips a finding's status (and optionally records a resolution note) by calling the existing `updateFindingStatus` API.

## Outcome

- New `factory findings mark <id> <status>` CLI verb. Accepts the four legal `FindingStatus` values (`OPEN | FIXED | VERIFIED | WONTFIX`); bare `<id>` resolves via the registry (mirrors `factory findings show`'s disambiguation); `--note <prose>` flows through to `updateFindingStatus(..., resolution)`.
- `runFindingsMark(db, rawId, rawStatus, opts) => Promise<{ stdout, exitCode }>` handler in `packages/cli/src/commands/findings.ts`, mirroring the pure-handler shape of the other findings subcommands.
- Disambiguation message identical to `factory findings show` — operators see one consistent ambiguity error across read and write surfaces.
- Tab-completion picks up `mark` (`packages/cli/src/commands/completion.ts` `NESTED_SUBCOMMANDS` grows by one row).
- `packages/cli/README.md` findings table grows by one row.

## Where we were, end of Phase 6

Phase 6 closed `phase-6-skills-rewrites-closed` (69380e2). The agent-side flow for finding-status flips landed at 6.3: fixer's `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` markers are parsed by `packages/worker/src/parse-resolutions.ts` and dispatched via `persistResolutions` → `updateFindingStatus` after `persistFindings` at both `run-worker.ts` call-sites. 9 unit tests pin the parser robustness.

What 7.x can rely on without re-paving:

- **`updateFindingStatus` API is real and exercised.** `packages/wiki/src/findings.ts:196` accepts `(projectPath, id, status, resolution?, registry?)`; sets `resolvedAt` on first transition to a terminal state; idempotent re-flips preserve the resolvedAt. The Tier 6 parser path tests it through end-to-end.
- **`findings.ts` CLI surface already has 3 subcommands.** `runFindingsList` / `runFindingsShow` / `runFindingsBackfill` — each pure-handler-then-Commander-thin-wrapper. New `runFindingsMark` slots in as the 4th. `findings.test.ts` shows the shape: in-memory DB seeded via `findingsRegistry.upsert`, handlers driven directly.
- **Disambiguation pattern works.** `runFindingsShow` resolves bare `<id>` via `findingsRegistry.findByFindingId(db, findingId)` and emits `renderAmbiguity(...)` on multi-match. `mark` reuses the same code path verbatim.
- **All 4 `pnpm` gates green at phase entry** — phase-6 close held the workspace at 1144 passing + 3 skipped.

## Why this phase exists

The composition gap surfaced explicitly in Phase 6's "Deferred to Phase 7" section + STATE.md's carry-forward list. 6.3 wired the agent-side flow but not the operator-side mirror. When a fixer agent doesn't run (or the operator wants to mark something `WONTFIX` directly without invoking the fixer), today's only path is hand-editing `<workspace>/<project>/.factory/findings.json`. That's the gap Tier 7 closes — composition over the existing API, not invention.

User decision (this session): kick off Tier 7 with `factory findings mark` as the demand-signal favorite among the Phase-6 carry-forward candidates. ~1 substantive commit. STATE.md flagged this as the most likely next move.

Issues addressed: U028 (opened by step 7.1 of this phase).

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, runtime-contract verification branches, suggested commit messages): [`../../../UPGRADE/plans/tier-7-findings-mark.md`](../../../UPGRADE/plans/tier-7-findings-mark.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:7-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] `factory findings mark F001 FIXED` works end-to-end against a seeded registry (single-match path)
- [ ] `factory findings mark F001 FIXED` on a multi-project bare-id emits the same ambiguity message `factory findings show` does
- [ ] `factory findings mark <project>/F001 WONTFIX --note "<prose>"` persists the resolution string
- [ ] `factory findings mark --help` shows worked examples (bare id, `<project>/<id>` form, with `--note`)
- [ ] Tab-completion script picks up `mark` on at least one shell (bash/zsh/pwsh) — sanity-check the rendered output for the `findings` block
- [ ] `packages/cli/README.md` findings table grows by one row for `mark`
- [ ] Issue U028 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) with commit ref
- [ ] Tier 7 ROADMAP rows in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md) ticked
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(7.<step>): <subject>` shape
- [ ] Phase will be tagged `phase-7-findings-mark-closed` by `/phase-close`

## Rollback plan

If Phase 7 needs to be undone: `git reset --hard phase-6-skills-rewrites-closed`. No external state to roll back — Phase 7 is one new CLI handler + Commander wiring + tests + completion vocab + README row. The runtime API (`updateFindingStatus`) is unchanged. Rolling back removes the operator-side verb; the agent-side parser path Phase 6 wired stays unaffected.

## ADRs decided in this phase

- (none expected — Tier 7 is composition over existing API. If a structural surface needs to be designed, e.g. the registry-passing path needs refactoring, pin via ADR before 7.2 lands; likely number 0030.)

## Deferred to Phase 8 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- U005 chat 120 s timeout re-tier — separate problem class; carry-forward from Phase 2's Tier-2-or-4 designation.
- `factory skills list / show <name>` CLI commands — skill discovery surface; Tier 8 candidate.
- Bulk findings-mark surface — wait for a demand signal (audit-cleanup workflow flipping dozens at once).
- Findings history surface — first-class who/when/why log per finding; current `resolution` + `updatedAt` cover the common case.
- PageShell + Dashboard `<style is:global>` migration — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit pass.
- ADR 0027 §1 missing route pin (POST `/api/v1/projects`), ADR 0002 footnote stale post-Tier-5 — doc-debt amends.
