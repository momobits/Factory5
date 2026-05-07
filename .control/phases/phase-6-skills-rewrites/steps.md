# Phase 6 Steps

- [ ] 6.1 — Open U026 (`skills/* — 12 ported-from-factory2 skills with no factory5 audit`) + U027 (`Fixer agent output → updateFindingStatus has no parser path`) in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md). ROADMAP rows + phase scaffold pre-authored at scaffold time
- [ ] 6.2 — Skills audit pass: classify each of the 12 skills as `clean` / `hot-fix` / `rewrite`; commit body documents per-skill verdict; this plan + steps.md updated with explicit per-skill rewrite rows in 6.4..6.N
- [ ] 6.3 — Wire `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` marker parser in `packages/brain/src/`; calls `updateFindingStatus(...)` on match; unit test with valid + malformed + ambiguous fixtures; `prompts/agents/fixer.md` updated to drop "no parser today" caveat; closes U027
- [ ] 6.4..6.N — Per-skill rewrites (count + targets determined by 6.2). Each is its own commit. Frontmatter preserved; body factory5-native; no `factory2` references
- [ ] 6.last — Drop "Initial skills ported from factory2/skills/" line from `docs/SKILLS.md`; apply 6.2-flagged hot-fixes in a single commit; closes U026
- [ ] 6.close — `/phase-close` — tag `phase-6-skills-rewrites-closed`; append session entry to [`../../../UPGRADE/LOG.md`](../../../UPGRADE/LOG.md); scaffold Phase 7 if a tier-7 plan exists, otherwise re-close the upgrade arc

## Step detail

Each step's full detail (file pointers, acceptance criteria, edge cases, runtime-contract verification branches, suggested commit messages) is in [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) under the matching `### 6.<step>` heading. Below: just the commit-message templates and step-local guardrails.

### 6.1 — Open audit-surfaced issues

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.1.

**Acceptance:** `UPGRADE/ISSUES.md` Open section grows by 2 entries (U026 + U027). ROADMAP scaffold and phase directory were pre-authored at scaffold time — verify both exist before opening the issues.

**Commit:** `chore(6.1): open U026 + U027`

### 6.2 — Skills audit pass

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.2.

**Acceptance:** commit body documents 12-line per-skill verdict (`<skill>: <clean | hot-fix [reason] | rewrite [reason]>`); plan and steps.md updated with explicit per-skill rewrite rows in 6.4..6.N range; all four `pnpm` gates clean.

**Commit:** `docs(6.2): skills audit verdicts + plan/steps refinement`

### 6.3 — Wire fixer→updateFindingStatus parser

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.3.

**Pre-write homework:** re-grep `packages/brain/src/` for any agent-output → `updateFindingStatus` parser path (Tier 5 5.5 confirmed none; verify on entry). Find where verifier's `FINDING` markers get parsed today — that's the model. Read `packages/wiki/src/findings.ts` around the `updateFindingStatus` export to confirm signature + idempotency. If no clean attach point exists, surface and split into refactor (6.3a) + parser (6.3b) — don't paper over a structural gap with a one-off hook.

**Acceptance:** new parser function with line-anchored regex matching the marker grammar in `prompts/agents/fixer.md`; unit test with valid + malformed + ambiguous fixtures; agent-output handler wired so verifier/builder output stays unaffected; `prompts/agents/fixer.md` updated to drop "no parser today" caveat; manual or integration verification of the full path (marker → DB row flip); U027 closed; all four `pnpm` gates clean.

**Commit:** `feat(6.3): wire fixer→updateFindingStatus parser`

### 6.4..6.N — Per-skill rewrites

Explicit per-skill rows added by 6.2 once the audit verdict is known. Each row pins one skill from `skills/` flagged `rewrite` in 6.2.

**Per-skill acceptance** (applies to each):

- Frontmatter (`name` + `description`) preserved verbatim.
- Body factory5-native: current ADR refs, current marker grammars, current paths.
- No `factory2` / `factory2/skills/` references in the body.
- Body length comparable to or exceeding the original.
- All four `pnpm` gates clean.

**Commit shape:** `docs(6.<N>): skills/<name>.md — write factory5-native body`

### 6.last — Drop factory2 provenance + apply hot-fixes

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.last.

**Acceptance:** `docs/SKILLS.md` line 7 no longer references factory2 provenance; no skill body in `skills/` references `factory2`; 6.2-flagged hot-fixes applied (one commit covers all); U026 closed; all four `pnpm` gates clean.

**Commit:** `docs(6.last): drop factory2 provenance + apply skill hot-fixes`

### 6.close — Phase close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-6-skills-rewrites-closed`. If a Phase 7 plan exists, scaffolds it; otherwise the upgrade arc closes out and STATE.md transitions to "all phases complete" again.

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-6): close phase 6` (+ kickoff if Phase 7 plan exists).
