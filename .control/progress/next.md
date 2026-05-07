# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-07T13:14:12Z by
> `.claude/hooks/regenerate-next-md.sh`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Run sub-step **5.1**: open two issues in `UPGRADE/ISSUES.md` per Tier 5 plan §5.1.

- `U024 — prompts/agents/README.md status table is stale` (Severity: low, Tier: 5, Area: docs / brain). 5 of 9 prompts listed as "stub" but have substantive bodies (triage / architect / planner / scaffolder / verifier).
- `U025 — docs/ONBOARDING.md §5.4 claims web detail pages are read-once` (Severity: medium, Tier: 5, Area: docs). Tier 3 step 3.1+3.2 shipped SSE on `/api/v1/directives/:id/stream` and wired `directives/detail.astro` to consume it; doc lies.

Each issue follows the existing `### UNNN — Short title` template (severity / tier / area / description / hypothesis). Append to the Open section. Then commit `chore(5.1): open U024 + U025`.

After 5.1 lands, proceed to **5.2** (drop the stale stub-tracking column from `prompts/agents/README.md`; replace with `File | Role | Purpose`; drop "Phase 1 work" section + "from factory2" provenance — closes U024) and **5.3** (sweep `docs/ONBOARDING.md` §5.4 — closes U025).

**Two pre-write homework items lurking** for 5.4 and 5.5 (read first, don't assume):

- **5.4 reviewer findings policy** — read `packages/brain/src/findings/` (or wherever `findings_registry.advisory` is set on insert) to confirm whether reviewer findings flow advisory or blocking. `pool.ts:111-132` shows `finding.advisory` defaults to false (blocking); locate where `advisory: true` gets set per-source. If genuinely ambiguous, write ADR 0030 before 5.4's body lands.
- **5.5 fixer output contract** — grep `packages/brain/src/` for any agent-output → `markFinding` parser path. Three branches (existing parser → match grammar; clean extension point → re-scope `docs(5.5)` to `feat(5.5)` and ship parser; no path → prose-only flow + Tier 6 candidate). Pin the branch in commit body and prompt body.

**5.8 is operator-decision** — `factory logs` Path A (implement minimal `--component`/`--directive`/`--follow` tail) vs Path B (retire). Default to retire if undecided when 5.8 starts.

Full Tier 5 plan: [`../../UPGRADE/plans/tier-5-agent-prompts.md`](../../UPGRADE/plans/tier-5-agent-prompts.md). Phase scaffold: [`../phases/phase-5-agent-prompts/{README.md,steps.md}`](../phases/phase-5-agent-prompts/).

## Notes for next session

Phase 5 (`phase-5-agent-prompts`) is in flight. The plan, ROADMAP, and phase scaffold are all in place; sub-step 5.1 is the next concrete action.

**Sub-step queue:**

- **5.1** — Open U024 (`prompts/agents/README.md` status table stale) + U025 (`docs/ONBOARDING.md` §5.4 read-once claim stale post-Tier-3) in `UPGRADE/ISSUES.md`. ROADMAP rows + phase scaffold pre-authored. Commit: `chore(5.1): open U024 + U025`.
- **5.2** — Drop the stale stub-tracking column from `prompts/agents/README.md`; replace with `File | Role | Purpose`; drop "Phase 1 work" section + "from factory2" provenance. Closes U024. Commit: `docs(5.2): prompts/agents/README.md — drop stale stub-tracking column`.
- **5.3** — Sweep `docs/ONBOARDING.md` §5.4: drop "read-once" claim and "no project creation" claim; reflect post-Tier-3 reality. Closes U025. Commit: `docs(5.3): docs/ONBOARDING.md §5.4 — drop read-once claim post-Tier-3`.
- **5.4** — Write `prompts/agents/reviewer.md` from scratch (factory5-native). **Pre-write homework**: read `packages/brain/src/findings/` to pin reviewer's advisory-vs-blocking severity policy. Comparable in depth to `verifier.md` (97 lines) or `architect.md` (79). Commit: `docs(5.4): prompts/agents/reviewer.md — write factory5-native body`.
- **5.5** — Write `prompts/agents/fixer.md` from scratch. **Pre-write homework**: grep `packages/brain/src/` for any agent-output → `markFinding` parser path. Three branches; commit type may re-scope `docs(5.5)` → `feat(5.5)`.
- **5.6** — Write `prompts/agents/investigator.md` from scratch. Read-only constraint with concrete OK/NOT-OK Bash examples; HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions (not parsed).
- **5.7** — Flesh out `prompts/agents/builder.md`. **CRITICAL preservation**: the existing Python venv discipline section (~65 lines) prevents I007 host-pollution — copy verbatim into the new structure; verify with diff.
- **5.8** — **Operator-decision required before this step starts**: `factory logs` Path A (implement minimal `--component`/`--directive`/`--follow`) vs Path B (retire). Default to retire if undecided.
- **5.9** — `/phase-close` — tags `phase-5-agent-prompts-closed`; appends LOG.md entry; if a Tier 6 plan exists scaffold it, otherwise close out the upgrade arc again.

**Tier 6 candidate (out of Phase 5 scope):** Skills review + rewrites — all 12 skills in `skills/` are "ported from factory2/skills/" per `docs/SKILLS.md`. If 5.4-5.7 surface fit issues with skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`), draft `UPGRADE/plans/tier-6-skills-rewrites.md` then. Inline hot-fix only allowed for one-line factual errors with a journal note.

**Read first:** [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across all four prior tiers, [`../../UPGRADE/plans/tier-5-agent-prompts.md`](../../UPGRADE/plans/tier-5-agent-prompts.md) for the full implementation plan, [`../phases/phase-5-agent-prompts/{README.md,steps.md}`](../phases/phase-5-agent-prompts/) for the phase scaffold.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for Phase 5 (no web work) but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.
