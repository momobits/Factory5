# Phase 8 — question-auto-answer

**Dependencies:** None hard. Soft sequence after `phase-7-findings-mark-closed`. New schema column on `pending_questions`, a new `@factory5/core` config reader, a new brain-side dispatcher; no code dependency on prior phases beyond the existing `ask_user` flow (ADR 0024) which Phase 8 extends.
**Estimated duration:** ~2 sessions

## Goal

When an `ask_user` pending-question goes unanswered past its deadline and the parent directive is still active, factory makes an LLM call with the question + surrounding context, writes the answer back, marks it `answered_by = 'agent'`, and lets the directive proceed. Today an unanswered question blocks its directive indefinitely (until the orphan sweep runs after the directive itself terminates) — autonomous runs stall waiting on a human who isn't there.

## Outcome

- New `pending_questions.answered_by` column (`'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`) — structured provenance replacing the existing `[bracketed]` text-prefix convention.
- Migration 009 backfills pre-existing answered rows: orphan-sweep answers (`[orphaned by ...]` prefix) → `'orphan-sweep'`; everything else → `'user'`.
- New `<dataDir>/config.json` (alongside `factory.db`) with `askUserDeadlineMs` (default 5 min, configurable without code changes). Read via new `loadConfig()` in `@factory5/core`.
- Brain stamps `deadline_at` on every new `ask_user` from the config value.
- New brain tick-loop sweep: open questions past deadline + active parent directive → LLM auto-answer dispatcher (retry once, then write `'agent-failed'` synthetic).
- Auto-answer LLM call records spend against the parent directive's project (existing spend plumbing).
- CLI `factory questions list / show` and web `/app/questions/*` surface the `answered_by` field.
- ADR 0030 pins the auto-answer contract + config-home decision.

## Where we were, end of Phase 7

Phase 7 closed `phase-7-findings-mark-closed` (40a78a8). The CLI gained `factory findings mark <id> <status>` as the operator-side parallel to Tier 6's agent-side `RESOLUTION` parser. Workspace at 1152 + 3 skipped, all four `pnpm` gates green.

What 8.x can rely on without re-paving:

- **`pending_questions` schema is solid.** Already has `deadline_at` (TEXT, nullable), `answered_at`, `answer`, `bot_message_id`. Phase 8 adds one column + one migration; no other shape changes.
- **`markOrphanAnswered` precedent.** `pending-questions.ts:272` writes synthetic answers with a `[bracketed]` prefix and `answered_at = now`. Phase 8 generalizes that pattern via the structured `answered_by` column; the orphan sweep migrates to set `'orphan-sweep'` going forward.
- **Brain has a tick loop.** Already polls directives + runs the orphan sweep. Phase 8's deadline sweep extends that tick.
- **Spend plumbing exists.** `packages/state/src/queries/spend.ts` records LLM spend keyed by directive/project. Auto-answer reuses it; no new spend taxonomy.
- **Pending-question UI surfaces exist.** CLI `factory questions list / show <id>` (`packages/cli/src/commands/questions.ts`); web `/app/questions/index` + `/app/questions/detail` (`apps/factory-web/src/pages/questions/`). Phase 8 adds an `answered_by` field to both; no new pages.
- **All 4 `pnpm` gates green at phase entry** — phase-7 close held the workspace at 1152 + 3 skipped.

## Why this phase exists

The `ask_user` flow is load-bearing — every agent class can emit it (verifier, fixer, planner, etc.). Today there's no "the human isn't coming back" path; the directive sits open until the orphan sweep retroactively fills `[orphaned by ...]` after the directive ends. That's forensic cleanup, not progress. A deadline + LLM auto-answer gives autonomous runs a way to keep going, and the `answered_by` provenance makes it auditable that the agent (not the operator) made the call.

Operator decision (this session): kick off Tier 8 with question-auto-answer as the highest-leverage carry-forward (autonomous runs unblock without human-on-call). U005 stays parked as a Tier 9 candidate. Configuration is daemon-wide for first ship; per-project override deferred as non-breaking future work.

Issues addressed: U029 (opened by step 8.1 of this phase).

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, runtime-contract verification branches, suggested commit messages): [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:8-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] Migration 009 applies cleanly + backfills orphan-sweep + user rows correctly (per migration-test assertions)
- [ ] `<dataDir>/config.json` present-but-missing-key falls back to 5-min default; absent file falls back to 5-min default; both paths covered by tests
- [ ] Every new `ask_user` pending-question has `deadline_at` populated from config
- [ ] Brain tick sweep auto-answers an open-past-deadline question against an active directive within one tick (end-to-end test with fake clock + mocked provider)
- [ ] LLM-failure path: dispatcher retries once, then writes `answered_by = 'agent-failed'` + synthetic `[auto-answer failed: <reason>]` answer
- [ ] CLI `factory questions show <id>` renders the `Answered by:` line for all four enum values
- [ ] Web `/app/questions/index` + `/app/questions/detail` render the answerer
- [ ] ADR 0030 lands in `docs/decisions/`; `INDEX.md` updated
- [ ] Issue U029 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) with commit ref
- [ ] U005 stays in Open section, parked (Tier 9 candidate)
- [ ] Tier 8 ROADMAP rows in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md) ticked
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(8.<step>): <subject>` shape
- [ ] Phase will be tagged `phase-8-question-auto-answer-closed` by `/phase-close`

## Rollback plan

If Phase 8 needs to be undone: `git reset --hard phase-7-findings-mark-closed`. External state to consider:

- **Migration 009 in deployed databases.** The `answered_by` column is additive and nullable — rolling back the code leaves the column in place; pre-existing reads ignore it. If a clean wipe is needed, drop the column manually (SQLite's `ALTER TABLE DROP COLUMN` requires version 3.35+; older fallback is the table-rebuild dance — verify versions before committing to the rollback).
- **`<dataDir>/config.json` if created.** Harmless if left in place; future phases may add other keys. Delete if a clean wipe is needed.
- **Auto-answered questions in the wild.** Rolling back the parser leaves `answered_by = 'agent'` rows in place; subsequent `factory questions show` will render `(unknown)` until the column is queried again. Forensically intact; not a data-loss event.

Phase 8 introduces a real schema migration and a real LLM-spend path — heavier rollback than Phase 7's pure-CLI-composition shape. The migration backfill is idempotent so a re-run is safe.

## ADRs decided in this phase

- **ADR 0030 — pending-question auto-answer contract** (drafted in 8.3): pins the `answered_by` enum, the deadline-config home (daemon-wide `<dataDir>/config.json`), the LLM dispatcher's failure semantics, and the no-override-after-auto-answer rule. Cross-references ADR 0024 (worker-subprocess `ask_user`) which Phase 8 extends rather than supersedes.

## Deferred to Phase 9 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- U005 chat REPL cancel UX path (a+) — twice-deferred carry-forward; Tier 9 candidate. Path (a+): bump timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt.
- Per-project deadline override — CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata.askUserDeadlineMs`. Non-breaking to add; deferred until demand signal.
- `factory config get / set <key>` CLI — operator surface for editing `<dataDir>/config.json` without hand-editing the JSON. Add when other config keys need editing too.
- Override after auto-answer — `factory questions answer --force <id>` superseding an `answered_by != 'user'` row. Pin via ADR if it ships.
- Channel-side `answered_by` badge — Discord/Telegram historic embed rendering. Low value; defer.
- Bulk auto-answer perf — parallelizing the sweep when many deadlines fire simultaneously. Defer until profiles show the serial sweep is a bottleneck.
- Agent-class-specialized prompts — per-emitting-agent prompt templates (verifier-flavoured, fixer-flavoured, etc.). Defer until quality data shows the generic prompt underperforms.
- `factory skills list / show <name>` CLI — skill discovery surface; carry-forward; no demand signal.
- PageShell + Dashboard `<style is:global>` migration — 11-page sweep; carry-forward.
- ADR amendments — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5; doc-debt only.
