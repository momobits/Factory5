# Phase 5 Steps

- [x] 5.1 — Open U024 + U025 in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) (ROADMAP rows + phase scaffold pre-authored at scaffold time)
- [x] 5.2 — `prompts/agents/README.md` — drop stale stub-tracking column; replace table with `File | Role | Purpose`; drop "Phase 1 work" section + "from factory2" provenance
- [x] 5.3 — `docs/ONBOARDING.md` §5.4 — replace "read-once" + "no project creation" claims with current state (SSE-live, `/app/projects/new` exists)
- [x] 5.4 — `prompts/agents/reviewer.md` — write factory5-native body (verify FINDING parser source-stamp + advisory tagging in `packages/brain/src/findings/` first)
- [ ] 5.5 — `prompts/agents/fixer.md` — write factory5-native body (verify `markFinding` parser branch first; commit type may re-scope from `docs` to `feat`)
- [ ] 5.6 — `prompts/agents/investigator.md` — write factory5-native body (read-only constraint with concrete OK/NOT-OK Bash examples; HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator conventions, not parser contract)
- [ ] 5.7 — `prompts/agents/builder.md` — flesh out factory5-native TDD body; preserve venv discipline section byte-for-byte; remove stub marker
- [ ] 5.8 — `factory logs` — Path A implement minimal (`--component`, `--directive`, `--follow`) OR Path B retire (drop row + command); operator picks before this step starts
- [ ] 5.9 — `/phase-close` — tag `phase-5-agent-prompts-closed`; append session entry to [`../../../UPGRADE/LOG.md`](../../../UPGRADE/LOG.md); scaffold Phase 6 if a tier-6 plan exists, otherwise re-close the upgrade arc

## Step detail

Each step's full detail (file pointers, acceptance criteria, edge cases, runtime-contract verification branches, suggested commit messages) is in [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) under the matching `§5.<step>` heading. Below: just the commit-message templates and step-local guardrails.

### 5.1 — Open audit-surfaced issues

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.1.

**Acceptance:** `UPGRADE/ISSUES.md` Open section grows by 2 entries (U024 + U025). ROADMAP scaffold and phase directory were pre-authored at scaffold time — verify both exist before opening the issues.

**Commit:** `chore(5.1): open U024 + U025`

### 5.2 — `prompts/agents/README.md` sweep

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.2.

**Acceptance:** status column gone; new column set is `File | Role | Purpose`; no `stub` / `hybrid` / `factory2` / `Phase 1 stub` terminology in body; legacy folder still listed; U024 marked Resolved.

**Commit:** `docs(5.2): prompts/agents/README.md — drop stale stub-tracking column`

### 5.3 — `docs/ONBOARDING.md` §5.4 sweep

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.3.

**Acceptance:** §5.4 reflects what shipped in Tier 3 (U006 + U007 + U008); no "Tier 3 of the upgrade" / "land in Tier" / "future" language pointing at shipped work; U025 marked Resolved.

**Commit:** `docs(5.3): docs/ONBOARDING.md §5.4 — drop read-once claim post-Tier-3`

### 5.4 — `prompts/agents/reviewer.md` write

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.4.

**Pre-write homework:** read `packages/brain/src/findings/` (or wherever `findings_registry.advisory` is set on insert) and pin the answer to "reviewer findings advisory or blocking?" in the prompt body. If the runtime is genuinely ambiguous, write ADR 0030 first.

**Acceptance:** comparable in depth to `verifier.md` / `architect.md`; FINDING marker grammar verified against `pool.ts:111-132`; source-string pinned (verified, not assumed); references the `code-review` skill; no `factory2` / `Phase 1 stub` references; all four `pnpm` gates clean.

**Commit:** `docs(5.4): prompts/agents/reviewer.md — write factory5-native body`

### 5.5 — `prompts/agents/fixer.md` write

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.5.

**Pre-write homework:** grep `packages/brain/src/` for any agent-output → `markFinding` parser path. Three branches: existing parser found (match its grammar), no parser but clean extension point (re-scope to `feat`, ship parser + test), no parser no clean extension (prose-only flow + Tier 6 candidate). Pin the branch in the prompt body and the commit message.

**Acceptance:** comparable in depth to `verifier.md` / `architect.md`; finding-by-ID intake contract pinned; output contract pinned per chosen branch (no invented markers); references `tdd` / `error-recovery` / `ask-user` skills; refuses BUILD.md writes; all four `pnpm` gates clean.

**Commit:** `docs(5.5): prompts/agents/fixer.md — write factory5-native body` _or_ `feat(5.5): wire fixer→markFinding parser + write fixer.md` (per branch).

### 5.6 — `prompts/agents/investigator.md` write

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.6.

**Acceptance:** comparable in depth to `verifier.md` / `architect.md`; read-only constraint pinned with a handful each of OK / NOT-OK Bash invocation examples; HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions (not parsed); references `error-recovery` + `ask-user` skills; all four `pnpm` gates clean.

**Commit:** `docs(5.6): prompts/agents/investigator.md — write factory5-native body`

### 5.7 — `prompts/agents/builder.md` flesh-out

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.7.

**Critical preservation:** the existing Python venv discipline section (~65 lines) prevents I007 host-pollution and has been incrementally hardened — copy verbatim into the new structure. Verify with diff after the rewrite. Heading adjustments are OK; content edits are not.

**Acceptance:** stub marker removed; venv content unchanged byte-for-byte; new TDD body added on top citing the `tdd` / `progress-tracking` / `work-verification` / `ask-user` skills; total depth comparable to `scaffolder.md` (178) or `planner.md` (197); all four `pnpm` gates clean.

**Commit:** `docs(5.7): prompts/agents/builder.md — flesh out factory5-native body`

### 5.8 — `factory logs` decision

Per [`../../../UPGRADE/plans/tier-5-agent-prompts.md`](../../../UPGRADE/plans/tier-5-agent-prompts.md) §5.8.

**Operator decision required before this step starts.** Path A (implement minimal) vs Path B (retire). Default to B if undecided.

**Acceptance:** no "stub" rows in `packages/cli/README.md`; if Path A, at least one unit test exercising each flag; all four `pnpm` gates clean.

**Commit:** `feat(5.8): factory logs — minimal tail with --component/--directive/--follow` (Path A) OR `chore(5.8): retire factory logs stub` (Path B).

### 5.9 — Phase close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-5-agent-prompts-closed`. If a Phase 6 plan exists (likely candidate: skills review + rewrites — see deferred section in README.md), scaffolds it; otherwise the upgrade arc closes out and STATE.md transitions to "all phases complete" again.

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-5): close phase 5` (+ kickoff if Phase 6 plan exists).
