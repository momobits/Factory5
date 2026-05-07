# Phase 6 Steps

- [x] 6.1 — Open U026 (`skills/* — 12 ported-from-factory2 skills with no factory5 audit`) + U027 (`Fixer agent output → updateFindingStatus has no parser path`) in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md). ROADMAP rows + phase scaffold pre-authored at scaffold time
- [x] 6.2 — Skills audit pass: classify each of the 12 skills as `clean` / `hot-fix` / `rewrite`; commit body documents per-skill verdict; this plan + steps.md updated with explicit per-skill rewrite rows in 6.4..6.9
- [x] 6.3 — Wire `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` marker parser in `packages/worker/src/parse-resolutions.ts`; calls `updateFindingStatus(...)` on match (sequenced after `persistFindings` at both run-worker call-sites — read-modify-write race avoided); 9 unit tests with valid + malformed + ambiguous + adversarial fixtures; `prompts/agents/fixer.md` updated to drop "no parser today" caveat; closes U027
- [x] 6.4 — `skills/code-review.md` rewrite: drop BUILD.md output surface; replace CRITICAL/WARNING/INFO with `FINDING [LOW|MEDIUM|HIGH|CRITICAL]` grammar matching `pool.ts:111-132` + Tier 5 5.4 reviewer.md; reference ADR 0018 advisory framing
- [x] 6.5 — `skills/dependency-install.md` rewrite: drop BUILD.md decision-persistence; switch TypeScript to `pnpm`; drop `--break-system-packages` (venv handles isolation); reference ADR 0026 runtime-agnostic framing
- [x] 6.6 — `skills/error-recovery.md` rewrite: drop 3 BUILD.md persistence references; use `HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT` per Tier 5 5.6 investigator + `RESOLUTION <FID>` per Tier 5 5.5 fixer; reference ADR 0024 escalation + ADR 0028 sandbox boundary
- [x] 6.7 — `skills/progress-tracking.md` rewrite: ground-up re-frame (currently entirely BUILD.md-centric). Builders emit signals per `expectedOutputs.signals[]`; planners read findings_registry; reference ADR 0021
- [ ] 6.8 — `skills/scaffolding.md` rewrite: drop BUILD.md scaffolding step; drop `--break-system-packages`; expand TypeScript section (pnpm workspace, tsup/tsc, vitest, ESLint flat); reference ADR 0026 + ADR 0028
- [ ] 6.9 — `skills/work-verification.md` rewrite: drop `FACTORY_COMPLETE` legacy token; reframe checks as findings (advisory per ADR 0018) emitted to the brain; cross-ref Tier 5 5's verifier.md
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

### 6.4 — `skills/code-review.md` rewrite

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.4.

**Acceptance:** frontmatter preserved; FINDING grammar matches `pool.ts:111-132`; ADR 0018 referenced; no `BUILD.md` workflow references; no `CRITICAL/WARNING/INFO` severity terminology; all four `pnpm` gates clean.

**Commit:** `docs(6.4): skills/code-review.md — write factory5-native body`

### 6.5 — `skills/dependency-install.md` rewrite

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.5.

**Acceptance:** frontmatter preserved; pnpm preferred for TypeScript; no `--break-system-packages`; ADR 0026 referenced; runtime-agnostic framing; all four `pnpm` gates clean.

**Commit:** `docs(6.5): skills/dependency-install.md — write factory5-native body`

### 6.6 — `skills/error-recovery.md` rewrite

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.6.

**Acceptance:** frontmatter preserved; no BUILD.md persistence references; ADR 0024 + ADR 0028 referenced; investigator/fixer output conventions cite Tier 5 5.5 + 5.6 prompts; all four `pnpm` gates clean.

**Commit:** `docs(6.6): skills/error-recovery.md — write factory5-native body`

### 6.7 — `skills/progress-tracking.md` rewrite

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.7.

**Acceptance:** frontmatter preserved; ground-up re-frame around signals + findings_registry; ADR 0021 referenced; no BUILD.md mentions; all four `pnpm` gates clean.

**Commit:** `docs(6.7): skills/progress-tracking.md — write factory5-native body`

### 6.8 — `skills/scaffolding.md` rewrite

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.8.

**Acceptance:** frontmatter preserved; no BUILD.md scaffolding step; no `--break-system-packages`; TypeScript section equal-depth to Python; ADR 0026 + ADR 0028 referenced; all four `pnpm` gates clean.

**Commit:** `docs(6.8): skills/scaffolding.md — write factory5-native body`

### 6.9 — `skills/work-verification.md` rewrite

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.9.

**Acceptance:** frontmatter preserved; no `FACTORY_COMPLETE` token; checks reframed as advisory findings per ADR 0018; cross-ref Tier 5 5's verifier.md; all four `pnpm` gates clean.

**Commit:** `docs(6.9): skills/work-verification.md — write factory5-native body`

### 6.last — Drop factory2 provenance + apply hot-fixes

Per [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md) §6.last.

**Acceptance:** `docs/SKILLS.md` line 7 no longer references factory2 provenance; no skill body in `skills/` references `factory2`; 6.2-flagged hot-fixes applied (one commit covers all); U026 closed; all four `pnpm` gates clean.

**Commit:** `docs(6.last): drop factory2 provenance + apply skill hot-fixes`

### 6.close — Phase close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-6-skills-rewrites-closed`. If a Phase 7 plan exists, scaffolds it; otherwise the upgrade arc closes out and STATE.md transitions to "all phases complete" again.

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-6): close phase 6` (+ kickoff if Phase 7 plan exists).
