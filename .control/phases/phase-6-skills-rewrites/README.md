# Phase 6 — skills-rewrites

**Dependencies:** None hard. Soft sequence after `phase-5-agent-prompts-closed`. No code dependency on prior phases — Phase 6 is skill-body rewriting + a small brain-side `feat` for the fixer parser path.
**Estimated duration:** ~1–2 sessions

## Goal

Every skill in `skills/` is factory5-native — audited against current architecture (current ADRs, current code paths, current marker grammars), and either confirmed clean or rewritten. The "ported from factory2" provenance language is gone once all 12 skills are factory5-native. Plus: the fixer agent's `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): ...` marker grammar — documented prose-only in Tier 5 — gets a brain-side parser so the registry actually flips on agent declaration.

## Outcome

- Every skill in `skills/` has a factory5-native body — no `factory2` / `factory2/skills/` references; current ADR refs and current marker grammars where load-bearing; current code paths where cited.
- `docs/SKILLS.md` line 7's `Initial skills ported from factory2/skills/` line is replaced with forward-looking ownership language.
- Per-skill audit verdict (6.2's commit body) is on the record — each of the 12 skills classified `clean` / `hot-fix` / `rewrite` with a one-line rationale.
- `prompts/agents/fixer.md` documents a real runtime contract — emitting `RESOLUTION F042 FIXED: <prose>` causes `updateFindingStatus(F042, FIXED, "<prose>")` to fire. The "no parser today" caveat is gone.
- New parser function in `packages/brain/src/` with at least one unit test (valid marker + malformed line + ambiguous prose fixtures).

## Where we were, end of Phase 5

Phase 5 closed `phase-5-agent-prompts-closed` (eeb03ed) after an 8-step arc that brought every active agent prompt in `prompts/agents/` to a substantive, factory5-native state. Tier 5 5.4–5.7 wrote four prompts (reviewer / fixer / investigator / builder) that reference 6 skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without deep-reading those skill bodies. Per Tier 5's "Risks + decisions" section, drift surfaced from that referencing was deferred to this phase — explicitly: "If any skill body carries a factory2-era claim that contradicts current factory5 architecture (e.g. references `BUILD.md` workflow that ADR 0021's `findings_registry` superseded; references GitHub flow that ADR 0019 retired; pre-pluggable-runtime defaults), flag in the journal as a Tier 6 candidate." Tier 5 closed without surfacing hot-fix-worthy drift, but that was reference-only inspection at use-site.

Tier 5 5.5 also confirmed `packages/wiki/src/findings.ts:196` exposes `updateFindingStatus(...)` but no `packages/brain/src/` code parses agent output for `RESOLUTION` markers. The fixer prompt ships today with prose-only markers; Phase 6 closes that loop.

What 6.x can rely on without re-paving:

- **Skill loader works.** `packages/brain/src/prompts.ts` `loadSkill(id)` reads `skills/<id>.md` plus per-user/per-project overrides at `~/.factory5/skills/` and `<project>/.factory/skills/`. Hot-reload at start of every directive — no rebuild needed.
- **`updateFindingStatus` API is real.** `packages/wiki/src/findings.ts` accepts a status (`OPEN` / `FIXED` / `VERIFIED` / `WONTFIX`) plus an optional resolution string + sets `resolvedAt` internally. Tested in isolation; just unwired.
- **Verifier `FINDING` marker parser exists somewhere.** The registry knows about findings emitted by the verifier — there's an existing parser path in the brain that 6.3 can model from.
- **All 4 `pnpm` gates green at phase entry** — phase-5 close held the workspace at 1135 passing + 3 skipped.

## Why this phase exists

Two compounding gaps surfaced in the post-Tier-5 retro (2026-05-07):

1. **All 12 skills in `skills/` are explicitly "ported from factory2/skills/"** per `docs/SKILLS.md` line 7, with no audit pass against factory5 architecture. Tier 5 referenced 6 of them without flagging hot-fix-worthy drift, but reference-only inspection misses body-level claims that don't surface at use-site (e.g. a skill might mention `BUILD.md` flow that's irrelevant to the consuming agent in this directive but wrong as a methodology generally).

2. **Fixer prompt's marker grammar is documented but unwired.** Tier 5 5.5 wrote `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` as the fixer's output contract; the prompt itself acknowledges "no parser today, prose-only". That means today, when the fixer agent declares a finding fixed, the operator must hand-edit `findings.json` (or run a CLI command that doesn't exist) to flip the row. Wiring the parser turns the prompt's documented contract into a real runtime contract.

User decision (this session): bundle the skill audit + rewrites with the fixer parser path, since both close the agent-prompts arc that Tier 5 opened.

Issues addressed: U026 (skills audit), U027 (fixer parser path). Both opened by step 6.1 of this phase.

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, runtime-contract verification branches, suggested commit messages): [`../../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../../UPGRADE/plans/tier-6-skills-rewrites.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:6-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] No skill body in `skills/` references `factory2` (grep gate)
- [ ] `docs/SKILLS.md` line 7 no longer references `Initial skills ported from factory2/skills/`
- [ ] Every skill flagged `rewrite` in 6.2 has its own commit with a factory5-native body
- [ ] `prompts/agents/fixer.md` no longer carries the "no parser today" caveat
- [ ] `packages/brain/src/` carries a parser function for `RESOLUTION` markers with at least one unit test (valid + malformed + ambiguous fixtures)
- [ ] Manual or integration-test verification: a fixer-style directive with a `RESOLUTION` marker causes a `findings.json` row to flip status
- [ ] Issues U026, U027 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) with commit refs
- [ ] Tier 6 ROADMAP rows in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md) ticked
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(6.<step>): <subject>` shape
- [ ] Phase will be tagged `phase-6-skills-rewrites-closed` by `/phase-close`

## Rollback plan

If Phase 6 needs to be undone: `git reset --hard phase-5-agent-prompts-closed`. No external state to roll back — Phase 6 is skill-body rewriting + one new brain-side parser function. The brain loader hot-reads skills + prompts at the start of every directive, so rolling back the rewrites immediately restores prior behaviour at the next directive. The parser is additive — rolling back removes the side-effect; agent output continues to flow unchanged.

## ADRs decided in this phase

- (filled in as decisions are made — likely candidate: agent-output marker-observer contract, if 6.3's structural homework shows the brain handler doesn't have a clean attach point and one needs to be designed. Probable number 0030.)

## Deferred to Phase 7 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- U005 chat 120 s timeout re-tier — separate problem class; carry-forward from Phase 2's Tier-2-or-4 designation.
- `factory findings mark <id> <status>` CLI command — operator-side parallel to 6.3's agent-side parser; Tier 7 candidate.
- `factory skills list / show <name>` CLI commands — skill discovery surface; Tier 8 candidate.
- PageShell + Dashboard `<style is:global>` migration — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit pass.
- ADR 0027 §1 missing route pin (POST `/api/v1/projects`), ADR 0002 footnote stale post-Tier-5 — doc-debt amends.
