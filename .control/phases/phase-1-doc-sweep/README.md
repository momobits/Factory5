# Phase 1 — doc-sweep

**Dependencies:** none (project at rest at `protocol-initialised` tag from Control v2.2.1 install)
**Estimated duration:** ~1 session

## Goal

Bring user-facing docs into line with what's actually shipped, and create the `docs/WORKFLOWS.md` that's missing from the doc graph.

## Outcome

- All package READMEs (`packages/cli`, `packages/channels`, `apps/factory-web`) reflect what's actually shipped — no "Phase" column, no "future"/"phase-N" markers for shipped channels, no missing rows for shipped commands.
- `docs/ONBOARDING.md` covers the web dashboard + the chat surfaces (CLI / Discord / Telegram) — new operators can reach those surfaces from a cold clone.
- New `docs/WORKFLOWS.md` documents the four canonical loops + a decision matrix + a CLAUDE.md authoring guide.
- Cross-references between docs consistent: no orphan refs to deleted files; new `docs/WORKFLOWS.md` referenced from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ONBOARDING.md`.

## Where we were, end of Phase 0

Project at rest. Pre-Phase-1 housekeeping:

- Two cleanup commits (`f6fb28c`, `de17274`) removed the prior Control framework + build journal + resolved-issue tracker; `docs/ARCHITECTURE.md` rewritten from current code as the canonical system reference.
- `UPGRADE/` workspace created with audit, roadmap, plans, log, and 23 catalogued issues (uncommitted at Phase 1 kickoff).
- Control v2.2.1 reinstalled (commit `e94393e`); `CLAUDE.md` re-acknowledges Control as the operational layer (uncommitted); `.control/SPEC.md` and derived docs populated by `/bootstrap`.

State at Phase 1 kickoff: `pnpm build` ✅ · `pnpm test` ✅ (876 passed + 3 skipped — sandbox tests gated for Windows-only / Linux-only branches) · `pnpm lint` ✅ · `pnpm format:check` ✅. 15 packages, 3 apps, 28 ADRs, ~35.6k LOC of source. `docs/issues/` is gone (all issues had been RESOLVED before cleanup); upgrade-time issues live in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md).

## Why this phase exists

Doc fixes are cited from later phases — Phase 2 channel responses link to `docs/WORKFLOWS.md`; Phase 3 web UI references the workflows page from "what is this?" empty states. Lowest-risk, fastest to ship. Issues U001–U003 (stale READMEs), U014–U015 (missing onboarding sections), U016 (missing workflows doc), U017 (missing CLAUDE.md authoring guide) directly addressed.

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, decision rationale, suggested commit messages): [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:1-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] Issues U001, U002, U003, U014, U015, U016, U017 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md)
- [ ] `docs/WORKFLOWS.md` exists and is referenced from at least three other docs
- [ ] No broken references in any forward-looking surface (grep clean for refs to deleted docs)
- [ ] Smoke check: a fresh reader can clone the repo, follow `docs/ONBOARDING.md`, and reach a working dashboard + chat without consulting the CLI subcommands list
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(1.<step>): <subject>` shape (e.g. `docs(1.1): refresh packages/cli/README.md`)
- [ ] Phase will be tagged `phase-1-doc-sweep-closed` by `/phase-close`

## Rollback plan

If Phase 1 needs to be undone: `git reset --hard protocol-initialised` (the install-time tag from Control v2.2.1). No external state to clean up — Phase 1 is doc-only, no schema changes, no code, no live-LLM spend.

## ADRs decided in this phase

- (filled in as decisions are made — Phase 1 is doc-only and unlikely to need new ADRs)

## Deferred to Phase 2 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- (filled in as items surface)
