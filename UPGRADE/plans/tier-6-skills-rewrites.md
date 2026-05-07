# Tier 6 — Skills review + rewrites + fixer parser path

**Goal**: every skill in `skills/` is factory5-native — audited against current architecture (ADRs 0001–0029, current code paths, current marker grammars), and either confirmed clean or rewritten. The "ported from factory2" provenance language in `docs/SKILLS.md` and skill bodies is gone once all 12 skills are factory5-native. Plus: the fixer agent's `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): ...` marker grammar — documented prose-only in Tier 5 — gets a brain-side parser so the registry actually flips on agent declaration.

**Why this tier**: All 12 skills in `skills/` are explicitly "ported from factory2/skills/" per `docs/SKILLS.md` line 7. Tier 5's 5.4–5.7 prompt rewrites referenced 6 of those skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) by name without deep-reading their bodies. Per the Tier 5 plan's "Risks + decisions" section, drift surfaced from that referencing was deferred here: "If any skill body carries a factory2-era claim that contradicts current factory5 architecture (e.g. references `BUILD.md` workflow that ADR 0021's `findings_registry` superseded; references GitHub flow that ADR 0019 retired; pre-pluggable-runtime defaults), flag in the journal as a Tier 6 candidate." Tier 5 closed without surfacing hot-fix-worthy drift — but that was reference-only inspection at use-site, not body-level audit. The audit Tier 6 owes is per-skill: read every skill body, classify each as `clean` / `hot-fix` / `rewrite` against factory5 reality.

The fixer parser path is co-scoped because it closes the same loop. Tier 5 5.5 confirmed `packages/wiki/src/findings.ts:196` exposes `updateFindingStatus(...)` but nothing in `packages/brain/src/` parses agent output to call it. The fixer prompt ships today with prose-only `RESOLUTION` markers; no automation wires them. Adding the parser turns the prompt's documented contract into a real runtime contract — the agent declaring `FIXED` causes the registry row to flip, no manual `findings.json` editing.

**Estimated effort**: 1 session if 6.2's audit finds 0–2 rewrites needed; 2 sessions if 3+ rewrites are needed (or if 6.3's fixer parser surfaces a non-trivial extension point). Audit is the gate, not a quota.

**Issues addressed**: U026 (opened by 6.1: `skills/* — 12 ported-from-factory2 skills with no factory5 audit`) and U027 (opened by 6.1: `Fixer agent output → updateFindingStatus has no parser path`).

**Scope explicitly excluded**:

- **Adding new skills.** Tier 6 is reactive (audit + rewrite existing); skill-additions follow demand.
- **Skill loader rewrites.** `packages/brain/src/prompts.ts` `loadSkill(id)` is in-scope to read for context, not edit. Per-user/per-project override surfaces stay as-is.
- **Prompt body changes.** Tier 5 closed those. If a skill rewrite surfaces a downstream prompt edit (e.g. a marker grammar changed in the skill, agent prompt now refers to wrong grammar), flag and defer to a small follow-up — don't bundle into 6.x.
- **U005 chat 120 s timeout re-tier.** Carry-forward; separate problem class. Tier 7 candidate.
- **ADR amendments** (0027 §1 missing route pin, 0002 footnote stale per Tier 5 retro). Doc-debt; not load-bearing for Tier 6.

---

## Pre-requisites

Read before starting:

- All 12 skills in `skills/` — `architect.md`, `ask-user.md`, `brainstorming.md`, `code-review.md`, `dependency-install.md`, `documentation.md`, `error-recovery.md`, `integration-testing.md`, `progress-tracking.md`, `scaffolding.md`, `tdd.md`, `work-verification.md`.
- `docs/SKILLS.md` — catalog table mapping skill → consuming agent.
- `docs/AGENTS.md` — agent default-skill mappings (the runtime side of "what skill does this agent get").
- `packages/brain/src/prompts.ts` — `loadSkill(id)` (the runtime loader; references `skills/<id>.md` + per-user/per-project override paths).
- `packages/brain/src/agents/registry.ts` — `defaultSkills` array per agent role.
- `packages/wiki/src/findings.ts` — `updateFindingStatus` API (line ~196 per Tier 5 5.5 verification).
- `packages/brain/src/` — full grep for any agent-output parser path that resembles a marker→DB-mutation flow (Tier 5 5.5 confirmed none exists for findings; verify still true on entry).
- `prompts/agents/fixer.md` — current `RESOLUTION` marker grammar (Tier 5 5.5 wrote this body).
- `prompts/agents/{builder,investigator,reviewer,scaffolder,verifier,architect,planner,triage}.md` — the consumers (what skills each agent is wired to).
- `docs/decisions/` index — at least 0018 (verifier advisory-only), 0021 (findings_registry / project identity), 0024 (worker subprocess ask-user), 0026 (pluggable runtimes), 0028 (worker sandbox), 0029 (SSE protocol). These are the architectural touchstones a factory2-era skill body could be wrong against.
- `UPGRADE/ISSUES.md` — current issue numbering (next number is U026; this tier opens U026 + U027).

Verify all four gates pass before starting (`pnpm build && pnpm test && pnpm lint && pnpm format:check`).

---

## Sub-tasks

### 6.1 Open audit-surfaced issues

**Today**: skills audit + fixer parser gap live only in conversation + Tier 5's retro notes; the matching `UPGRADE/ISSUES.md` entries don't exist yet.

**Wire**:

- Open `U026 — skills/* — 12 ported-from-factory2 skills with no factory5 audit` (Severity: low, Tier: 6, Area: docs / skills). Hypothesis: the skills carry factory2-era assumptions (BUILD.md workflow, GitHub flow, Python-only defaults) that may contradict factory5 reality. Tier 5 5.4–5.7 referenced 6 skills without deep-reading their bodies; this is the audit they didn't do.
- Open `U027 — Fixer agent output → updateFindingStatus has no parser path` (Severity: medium, Tier: 6, Area: brain). Hypothesis: `packages/wiki/src/findings.ts:196` exports the API but it's only invoked from tests; no `packages/brain/src/` code parses agent output for `RESOLUTION <FID>` markers. Tier 5 5.5 confirmed the gap; the fixer prompt documents the prose-only contract today. Resolution wiring promotes the prompt's marker grammar into a runtime contract.

**Acceptance**:

- `UPGRADE/ISSUES.md` Open section grows by 2 entries (U026, U027); Resolved section unchanged.

**Commit**: `chore(6.1): open U026 + U027`

### 6.2 Skills audit pass

**Today**: 12 skills, no per-skill verdict.

**Goal**: classify each of the 12 skills as `clean` / `hot-fix` / `rewrite` against factory5 reality. Output drives 6.4..6.N (per-skill rewrites).

**Wire**:

- Read each of the 12 skill bodies. Per skill, capture the answers to:
  1. Does the body reference `BUILD.md` as a primary workflow surface? (ADR 0021's `findings_registry` superseded that for findings-side flow.)
  2. Does it cite GitHub flow primitives — PR review, branch protection, `gh pr ...`? (Factory5 doesn't gate on GitHub.)
  3. Does it assume pre-pluggable-runtime defaults? (ADR 0026 made runtimes pluggable; check for hardcoded `python -m pytest` etc. — the skill may need to frame discipline language-agnostically.)
  4. Does it reference factory2-specific paths (`factory2/`, `~/.factory2/`, `factory2/skills/`, etc.)?
  5. Does it reference Python-specific patterns where factory5 is TS-first? (Where the skill is genuinely language-agnostic, generalize; where it's intentionally Python-flavored, keep but verify.)
  6. Does it reference marker grammars that have changed (e.g. raw `FINDING:` without severity, where factory5 uses `FINDING [SEV] target: ...`)?
  7. Does it reference an in-tree path that no longer exists (e.g. `factory/skills/`, `skills_repo/`)?
  8. Are the cited ADRs / docs / file paths current?
  9. Is the skill currently consumed by at least one agent prompt? (Cross-check `docs/AGENTS.md` + every `prompts/agents/*.md`. Orphans are flagged separately — see Risks below.)
- Classify per skill:
  - `clean` — body holds against factory5; no edit needed (provenance-language strip handled in 6.last).
  - `hot-fix` — one or two targeted line edits fix the drift; bundle into 6.last as a single multi-skill commit.
  - `rewrite` — multiple substantive claims drifted; gets its own 6.x commit.
- Edit this plan (`UPGRADE/plans/tier-6-skills-rewrites.md`) to add explicit `### 6.4 — skills/<name>.md rewrite` rows for each skill flagged `rewrite`, in alphabetical order. Each row carries a one-line "what drifted" rationale and the runtime references the rewrite needs to pin.
- Edit `.control/phases/phase-6-skills-rewrites/steps.md` to add the rewrite checkbox rows (mirror of plan rows).

**Acceptance**:

- This commit's body documents the per-skill verdict (12 lines: `<skill>: <clean | hot-fix [reason] | rewrite [reason]>`).
- Plan + steps.md updated with explicit per-skill rewrite rows.
- All four `pnpm` gates clean.

**Commit**: `docs(6.2): skills audit verdicts + plan/steps refinement`

### 6.3 Wire fixer→updateFindingStatus parser

**Today**: `prompts/agents/fixer.md` documents `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` markers as operator-readable conventions; the fixer agent emits them; nothing in the brain reads them.

**Goal**: when an agent's output includes a `RESOLUTION` marker, the brain calls `updateFindingStatus(<FID>, <status>, <prose>)` against the findings registry.

**Pre-write homework (re-verify on entry)**:

- Re-grep `packages/brain/src/` for any existing parser path. Tier 5 5.5 confirmed none; verify on entry to catch any sibling work that landed in the meantime.
- Read `packages/wiki/src/findings.ts` around the `updateFindingStatus` export — confirm the function signature (`status` enum, `resolution` optional string, `resolvedAt` timestamp set internally), and confirm tests exercise the success path. The parser only needs to translate marker → call; the function handles persistence.
- Read `packages/brain/src/agents/registry.ts` to find where agent output streams in. The natural attach point is wherever `prompts.ts` and the agent-output handler intersect — likely a transform / observer step that already exists for verifier `FINDING` markers (which DO get parsed somewhere; 6.3's first move is finding that parser as a model).

**Wire**:

- Add a parser function (likely `parseResolutionMarker(line: string): { fid: string; status: 'FIXED' | 'VERIFIED' | 'WONTFIX'; resolution: string } | null`) — strict regex match against the marker grammar in `prompts/agents/fixer.md`. Reject malformed lines silently (return null) — the fixer's prose may include false positives, so the regex is the gate.
- Wire it into the agent-output handler so each line is checked. On match, dispatch `updateFindingStatus(...)`. On dispatch error, surface as a structured log line at `warn`. The agent's prose continues to flow through unchanged (the marker is informational; the parser is a side-effect).
- Add a unit test fixture: a sample fixer output stream with one valid marker + one malformed line + one ambiguous prose line. Assert one DB call with the expected args; assert no calls for the malformed/prose lines.
- Update `prompts/agents/fixer.md` body to drop the "no parser today" caveat — the marker grammar is now a real runtime contract. Cite this commit as the source.
- Re-grep skills bodies (heads-up for 6.4): does any skill mention "fixer emits prose-only" or similar? If yes, mark it as a hot-fix candidate when 6.last lands.

**Constraints**:

- **Don't invent grammar.** The marker grammar is what `prompts/agents/fixer.md` already documents. If the regex doesn't fit the prompt's documented shape, the prompt is the canonical artifact — match it.
- **Idempotency.** Calling `updateFindingStatus(F042, FIXED, ...)` on an already-FIXED row should no-op (the function already handles this; verify in the homework).
- **Worker sandbox boundary.** This is brain-side code; no worker-sandbox surface concerns.
- **Marker emission stays prompt-controlled.** The parser is read-only on the prompt's grammar; if the operator wants to change marker shape later, that's a prompt edit + a regex edit, separate.

**Acceptance**:

- New parser function with at least one unit test (valid + malformed + ambiguous fixtures).
- Wired into the agent-output handler; verifier or builder agent output (which doesn't emit `RESOLUTION`) stays unaffected.
- `prompts/agents/fixer.md` updated to drop the prose-only caveat.
- Manual check: run a representative fixer-style directive (or a unit/integration test that drives the full path) and verify a `findings.json` row flips status.
- U027 marked Resolved with this commit's sha.
- All four `pnpm` gates clean.

**Commit**: `feat(6.3): wire fixer→updateFindingStatus parser`

### 6.4..6.N Per-skill rewrites (count from 6.2)

**Goal**: every skill flagged `rewrite` in 6.2 ships a factory5-native body in its own commit.

**Constraints common to every rewrite**:

- **Frontmatter `name` + `description`** preserved verbatim. The loader uses `name` as the skill ID; `description` shows in skill catalogs.
- **Skill body**: factory5-native — references current ADRs, current marker grammars, current paths, current code references where load-bearing. Examples lean factory5 (TS over Python where the skill is language-agnostic; factory5 paths over factory2 paths).
- **Reference, don't duplicate**: skills are concatenated into agent prompts by `buildAgentSystemPrompt`. Don't mention agent-specific role wording — keep the skill prescriptive (this is HOW; the agent prompt says WHAT).
- **No `factory2` references** in the body.
- **Verify the skill is actually consumed** by reading `docs/AGENTS.md` + the agent prompts that wire it before rewriting. A skill not currently consumed is a delete candidate, not a rewrite candidate (raise as a sub-step deviation if the audit surfaces an orphan).

**Per-skill acceptance** (applies to each 6.x):

- Body length comparable to or exceeding the original (rewrites are not abbreviation passes).
- Frontmatter preserved.
- No `factory2` / `factory2/skills/` references.
- All four `pnpm` gates clean.
- Body reads as standalone — a future agent prompt referencing this skill should get a complete methodology.

**Commit shape**: `docs(6.<N>): skills/<name>.md — write factory5-native body`

> Note: explicit per-skill rows are added by 6.2 once the audit verdict is known. This plan version reserves the 6.4..6.N range without enumerating skills.

### 6.last Drop "ported from factory2" provenance + apply hot-fixes

**Goal**: with all factory5-native rewrites landed, scrub the provenance language.

**Wire**:

- `docs/SKILLS.md` line 7 — replace `> Initial skills ported from factory2/skills/. New skills follow the same shape.` with a forward-looking line about skill ownership (e.g. `> Skills are factory5-native. New skills follow the format below.`).
- Apply any 6.2-flagged hot-fixes (one or two targeted edits per skill, all in this commit).
- Verify no skill body in `skills/` references `factory2`.

**Acceptance**:

- `docs/SKILLS.md` line 7 no longer references factory2 provenance.
- No skill body in `skills/` references `factory2`.
- All four `pnpm` gates clean.
- Issue U026 marked Resolved with this commit's sha.

**Commit**: `docs(6.last): drop factory2 provenance + apply skill hot-fixes`

### 6.close /phase-close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-6-skills-rewrites-closed`. No Phase 7 plan exists; the upgrade arc reopens at /phase-close to "all phases complete" again unless the operator authors a Tier 7 in advance.

**Commit**: auto-generated by `/phase-close`, shape: `chore(phase-6): close phase 6` (+ kickoff if Phase 7 plan exists).

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass after every commit.
- Every skill in `skills/` has a factory5-native body — no `factory2` / `factory2/skills/` references in skill bodies.
- `docs/SKILLS.md` line 7's `Initial skills ported from factory2/skills/` line is gone.
- `prompts/agents/fixer.md`'s `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` markers are a real runtime contract — agent-emitted markers cause `updateFindingStatus` calls.
- Issues U026 + U027 marked Resolved with commit refs.
- Tier 6 ROADMAP rows ticked.
- Append session entry to `UPGRADE/LOG.md` at session end.

---

## Risks + decisions

- **Audit-only outcome.** If 6.2's verdict finds all 12 skills clean or hot-fix-only, Tier 6 is a 3-commit affair (6.1, 6.2, 6.3, 6.last, 6.close — 5 commits with the parser; 4 if no hot-fixes either). Don't manufacture rewrites — the audit is the gate.
- **Parser attach-point not obvious.** 6.3's homework starts with finding where verifier's `FINDING` markers get parsed today (assumed to exist; the registry knows about findings somehow). If the model handler doesn't have a clean attach point, surface — re-scope 6.3 from `feat` to `feat + refactor` or split into 6.3a (refactor handler to support marker observers) + 6.3b (add the resolution parser). Don't paper over a structural gap with a one-off hook.
- **Parser regex robustness.** The grammar is `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` per `prompts/agents/fixer.md`. Real fixer output may include the marker mid-prose, in code blocks, in error messages quoting the marker shape, etc. The regex must match line-anchored (caret + dollar) and reject false positives. Test fixtures must include adversarial shapes.
- **Orphan skill — delete or keep?** If the audit surfaces a skill not currently consumed by any agent prompt (cross-check `docs/AGENTS.md` + every `prompts/agents/*.md`), the choice is keep-as-reference or delete. Default: keep-as-reference if it's plausibly useful for a future agent role; delete (with an ADR if the deletion changes the loader's expected surface) only if it's clearly stale. If unsure, ask via `ask_user`.
- **Cross-skill dependencies.** Some skills reference other skills (e.g. `tdd` may cite `error-recovery`). Rewrites must keep cross-references valid. The audit (6.2) should flag these per-skill so 6.4..6.N can land in dependency-respecting order.
- **No new ADR expected.** Tier 6 is skill-body rewriting against existing architecture plus a small `feat` for the fixer parser. Exception: if 6.3 surfaces a structural ambiguity (e.g. the agent-output handler doesn't have a clean marker-observer surface and one needs to be designed), pin via a new ADR before 6.3 lands. Likely candidate ADR number 0030.
- **Single-session vs two-session scope.** If 6.2 returns ≤2 rewrites and 6.3 has a clean attach point, single-session. ≥3 rewrites or any 6.3 structural surprise → split at the natural break, with sessions per skill cluster + parser separately.
- **`prompts/agents/fixer.md` edit in 6.3.** The prompt body documents "no parser today" — when the parser ships, that caveat is stale. 6.3 must edit the prompt to drop the caveat. Don't merge the prompt edit into 6.last (which is purely skill-body provenance scrubbing) — keep 6.3 self-contained.

---

## Suggested commit shape

Determined by 6.2's verdict. Two patterns:

**All-clean / hot-fix-only path** (single session, ~5 commits):

1. `chore(6.1): open U026 + U027`
2. `docs(6.2): skills audit verdicts + plan/steps refinement`
3. `feat(6.3): wire fixer→updateFindingStatus parser`
4. `docs(6.last): drop factory2 provenance + apply skill hot-fixes`
5. `chore(phase-6): close phase 6`

**Rewrites-needed path** (single or two-session, count from 6.2):

1. `chore(6.1): open U026 + U027`
2. `docs(6.2): skills audit verdicts + plan/steps refinement`
3. `feat(6.3): wire fixer→updateFindingStatus parser`
4. `docs(6.4): skills/<name-A>.md — write factory5-native body`
5. `docs(6.5): skills/<name-B>.md — write factory5-native body`
   ... (per skill flagged rewrite)
   N+1. `docs(6.last): drop factory2 provenance + apply skill hot-fixes`
   N+2. `chore(phase-6): close phase 6`

---

## Out of scope — Tier 7+ candidate

- **U005 chat 120 s timeout re-tier.** Carry-forward from Phase 2's Tier-2-or-4 designation; both shipped without addressing it. Affects channel-chat UX directly. Tier 7 candidate if the demand signal arrives.
- **`factory init` skill** — onboarding a new project to factory5; could be encoded as a skill consumed by a future "init-helper" agent. Reactive — wait for a demand signal.
- **`assessor` skill** — the assessor agent role doesn't have a default skill mapping in `docs/AGENTS.md`; if Tier 7 surfaces a need to encode assessor's "just run the build, don't interpret" discipline as a skill, draft `UPGRADE/plans/tier-7-assessor-skill.md`.
- **Skill-loader rewrites** — `packages/brain/src/prompts.ts` `loadSkill(id)` works today; if Tier 7 needs richer override semantics (e.g. partial override / merge), that's a separate concern.
- **Skill discovery surface** — `factory skills list / show <name>` CLI commands don't exist today. Tier 8 candidate.
- **`factory findings mark <id> <status>` CLI command** — wires `updateFindingStatus` from the operator side (parallel to 6.3's agent-side parser). Tier 7 candidate; might compose nicely with skill-discovery surface in a "CLI completions for the registry" mini-tier.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit pass. Self-contained ~1 commit; Tier 7 candidate or standalone.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5. Doc-debt; not load-bearing.
