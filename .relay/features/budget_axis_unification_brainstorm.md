# Feature Brainstorm: Budget Axis Unification

*Created: 2026-05-24*
*Status: DESIGN COMPLETE*

## Goal

Replace the 4 coexisting semantic models for factory5's budget axes with ONE coherent system. Expand from 8 axes to 12. Every axis follows the same resolution rule; enforcement varies by the axis's inherent nature. Add per-axis observability so operators can set defaults from historical data, not guesswork.

This brainstorm resolves 7 Relay issues filed by `/relay-discover` (the "cross-tier inconsistency audit"):
- `maxUsdPerTask-silently-dead-code` (P1) — enforcement deleted in Tier 15.8
- `budget-defaults-explainers-stale-post-tier-15` (P1) — help text describes pre-pool-model semantics
- `askUserDeadlineMs-axis-not-honored-per-project-per-build` (P1) — operator overrides are placebo
- `claude-cli-default-maxTurns-80-conflicts-with-pool-model` (P1) — provider default defeats pool headroom
- `directiveLimits-ADR-0020-not-resolved-via-three-tier-max-rule` (P1) — maxUsd/maxSteps assertBudget uses stale snapshot
- `maxWikiReadinessAttempts-ignores-project-defaults` (P2) — project-level default silently ignored
- `budget-axis-semantic-models-undocumented` (P2) — no canonical table exists

Plus the seed incident: the maxTurns dual-cap where Tier 15.7 left the per-task cap alive alongside the pool model, and workers crashed at the per-task limit before the pool watchdog could fire.

## Context

### How we got here

Tiers 8-15 each introduced budget mechanisms on their own schedule:
- **Tier 8** (ADR 0030): `askUserDeadlineMs` in daemon-wide config — no per-project override
- **Tier 12** (ADR 0032): 6 budget axes, `BUDGET_DEFAULTS` as single source of truth, `[BUDGET]` askUser escalation, per-task `maxTurns` enforcement
- **Tier 13**: 7th axis `maxUsdPerTask`, operator-as-ceiling semantic for planner emit
- **Tier 14** (ADR 0033): 8th axis `maxWikiReadinessAttempts`, `[CRITIC]` marker auto-answer
- **Tier 15** (ADR 0034): pool model for `maxTurns*`, deleted `[BUDGET]` askUser, added `autoIncreaseBudgets` toggle, parked-directive-on-exhaustion + project-page-raise-cap CTA

Each tier was structurally correct on its PRIMARY axis but didn't retire the adjacent consumers of the old model. Result: 4 resolution rules, 4 enforcement models, 5 ADRs, no canonical table.

### The 4 resolution rules today (the chaos)

| Rule | Axes using it | Where documented |
|------|---------------|------------------|
| `max(project.json, payload.budgets, BUDGET_DEFAULTS)` — live re-resolve, monotonic-up | maxTurnsScaffolder, maxTurnsBuilder, maxTurnsFixer | ADR 0034 §1 |
| `payload.limits ?? projectLimits ?? defaults` — first-wins, evaluated ONCE at directive creation | maxUsd, maxSteps | ADR 0020 |
| Reads daemon-wide `config.json` only; per-project/per-build ignored | askUserDeadlineMs | ADR 0030 §2 |
| Reads `directive.payload.budgets` only; project defaults ignored | maxWikiReadinessAttempts | Tier 14 code (no explicit ADR section) |

Plus: `maxUsdPerTask` has ZERO enforcement today (Tier 15.8 deleted the escalation path; schema/CLI/Web/Discord all still accept the field and do nothing with it).

### The operator's stated need

> "I thought we had only one max limit, but there seems to be nuances. We need a proper well thought out system."

> "We also need to be able to see the telemetry counts metrics for each axis to understand the natural behaviour and thus better inform what the acceptable defaults are for new projects."

## Approaches Considered

### Approach A: Reduce to 3 axes (maxUsd only + 2 safety nets)

Let the system manage internal allocation. Operator sets total USD budget; system decides turns/steps/retries internally.

**Verdict: REJECTED.** Operator explicitly chose options 3+4 ("keep all axes + add what's missing"). They want fine-grained control, not abstraction. The problem is inconsistency, not surface size.

### Approach B: Keep 8, unify rules only

Fix the 4 resolution rules to be ONE rule. Don't add new axes. Address each Relay issue individually.

**Verdict: REJECTED.** Operator explicitly chose to add 4 new axes (maxWallClockMinutes, maxRetriesPerTask, maxConcurrentTasks, maxTotalTurns). Piecemeal rule-fixing without expanding the surface would leave gaps they've already identified.

### Approach C: 12-axis canonical table with unified resolution + typed enforcement + observability (SELECTED)

Expand to 12 axes. Every axis follows ONE resolution rule. Enforcement varies by "axis type" (pool / per-task / per-question / per-directive). Observability surface shows historical usage with p50/p90/max aggregates to inform defaults.

**Verdict: SELECTED.** Addresses all 7 Relay issues, the seed maxTurns incident, and the operator's stated needs (fine-grained control + data-informed defaults). Biggest scope but highest coherence payoff.

## Decisions Made

1. **12 axes.** 8 existing + 4 new (`maxWallClockMinutes`, `maxRetriesPerTask`, `maxConcurrentTasks`, `maxTotalTurns`).

2. **ONE resolution rule for ALL 12 axes:**
   ```
   effectiveCap[axis] = max(
     project.json.budgetDefaults[axis] ?? 0,
     directive.payload.budgets[axis] ?? 0,
     BUDGET_DEFAULTS[axis].value
   )
   ```
   - Live re-resolve from `project.json` on every check tick (≤250ms)
   - `payload.budgets` is a per-directive floor (operator's per-build override; can be raised mid-build, never lowered)
   - `BUDGET_DEFAULTS` is the system floor (built-in defaults)
   - **Applies to ALL axes uniformly** — no more first-wins-chain for maxUsd/maxSteps, no more daemon-config-only for askUserDeadlineMs, no more payload-only for maxWikiReadinessAttempts
   - Auto-increase toggle + safety multiplier ceiling apply to all axes (operator opts in per-project)

3. **Enforcement varies by axis type (4 types):**

   | Type | Enforcement | What fires on exhaustion | Axes |
   |------|-------------|-------------------------|------|
   | **Pool** | Summed across all tasks of a class (or all tasks) | Directive parks; project page "Raise cap" CTA | maxUsd, maxSteps, maxTurnsScaffolder, maxTurnsBuilder, maxTurnsFixer, maxTotalTurns |
   | **Per-task safety** | Checked per individual task before/during launch | Task fails; other tasks unaffected; directive continues | maxUsdPerTask, maxRetriesPerTask |
   | **Per-question** | Checked per pending question | Auto-answer fires after deadline | askUserDeadlineMs |
   | **Per-directive single-shot** | Checked once per directive lifecycle event | Directive parks (wallclock) or askUser-equivalent fires (wikiAttempts) | maxWallClockMinutes, maxWikiReadinessAttempts |

   The resolution rule is the SAME for all 4 types. Only the enforcement point differs.

4. **One canonical table (ADR 0035) documents ALL 12 axes.** Supersedes ADR 0032 (Budget UX Paradigm) and ADR 0034 (Budget Pool Paradigm). The table shows: axis name, type, default value, what fires on exhaustion, explainer text, resolution rule (same for all), auto-increase eligible (yes/no). This table is the SINGLE source of truth — `BUDGET_DEFAULTS` in code mirrors it; operator surfaces read from it; help text is generated from it.

5. **Observability surface** on the project page (History tab or new Telemetry tab):
   - **Per-build summary**: for each past build, show per-axis cap vs. actual usage with % bar
   - **Aggregated stats**: across all builds on the project, show p50 / p90 / max per axis
   - **Per-task drill-down**: which tasks consumed what (already on Live tab; extend historically)
   - Cross-project comparison deferred until 3+ projects exist with data

6. **claude-cli `--max-turns` handling**: worker passes NO per-task `--max-turns` to claude-cli. The pool watchdog is the only turn-limit mechanism. If claude-cli has its own internal default (currently 80 via provider code), the provider must pass an explicit high value (e.g., the pool's remaining headroom) so claude-cli doesn't crash before the watchdog fires. This resolves Relay issue #4.

7. **`directive.limits` (ADR 0020) retired as a separate concept.** `maxUsd` and `maxSteps` join the unified resolution rule. `assertBudget` reads from `computePoolUsage` (live) instead of `directive.limits` (snapshot). ADR 0020 gets a cross-ref amendment pointing to ADR 0035.

8. **`maxUsdPerTask` enforcement resurrected.** Tier 15.8 deleted it; this brainstorm revives it under the unified model. The pool dispatcher checks per-task estimated USD against `effectiveCap['maxUsdPerTask']` before launch. On trip: task fails (NOT directive parks — per-task safety type), logged with explanation. No askUser — the operator raises the cap on the project page if they want bigger tasks.

9. **`askUserDeadlineMs` honors project + per-build overrides.** Brain's `ask-user.ts` reads via the unified resolution rule instead of daemon-wide config only. Per-project override lets operators set tighter or looser deadlines per project's needs.

10. **`maxWikiReadinessAttempts` honors project defaults.** Brain's `loop.ts` reads via the unified resolution rule instead of payload-only. Consistent with all other axes.

11. **`BUDGET_DEFAULTS` explainers rewritten.** Every axis gets an accurate one-line description reflecting the post-unification semantic. These are the single source for CLI `--help`, Web UI accordion hints, Discord/Telegram option descriptions. Resolves Relay issue #2.

12. **`maxConcurrentTasks` is a new per-directive single-shot axis.** Default: 4 (current hardcode). Resolved via the unified rule. Enforcement: pool dispatcher reads it once at plan-dispatch time and uses it as `concurrency` parameter. Operator can set it per-project or per-build.

## Feature Breakdown

| # | Feature File | Description | Suggested Order | Dependencies | Design Status |
|---|-------------|-------------|-----------------|--------------|---------------|
| 1 | [`budget_canonical_table.md`](budget_canonical_table.md) | ADR 0035 + canonical 12-axis table in `BUDGET_DEFAULTS` + explainer rewrites + axis-type classification | Build first | None | DESIGNED |
| 2 | [`budget_unified_resolution.md`](budget_unified_resolution.md) | Unified resolution rule applied to ALL 12 axes — retire ADR 0020 first-wins chain, wire askUserDeadlineMs + maxWikiReadinessAttempts + maxUsdPerTask through the rule | Build second | Depends on 1 | DESIGNED |
| 3 | [`budget_new_axes.md`](budget_new_axes.md) | Add 4 new axes: maxWallClockMinutes, maxRetriesPerTask, maxConcurrentTasks, maxTotalTurns — schema, defaults, enforcement, CLI/Web/Discord surfaces | Build third | Depends on 1, 2 | DESIGNED |
| 4 | [`budget_provider_maxturns_fix.md`](budget_provider_maxturns_fix.md) | Worker stops passing per-task --max-turns to claude-cli; provider passes pool remaining headroom instead; planner materializer strips maxTurns | Build fourth | Depends on 2 | DESIGNED |
| 5 | [`budget_observability.md`](budget_observability.md) | Per-axis telemetry on project page — per-build summary table, p50/p90/max aggregates, per-task drill-down historical | Build fifth | Depends on 1, 2, 3 | DESIGNED |

## Development Order

1. **Canonical table first** (feature 1) — this is the foundation. Every other feature references the table. ADR 0035 lands here. Without this, the other features are building on shifting sand.
2. **Unified resolution second** (feature 2) — the core contract change. All consumers switch to one rule. Relay issues #1, #3, #5, #6 close here.
3. **New axes third** (feature 3) — extends the table with 4 new rows. Relay issue #8 closes fully (all axes documented in one place).
4. **Provider maxTurns fix fourth** (feature 4) — finishes the maxTurns dual-cap fix that Tier 15.7 started. Relay issue #4 closes.
5. **Observability last** (feature 5) — consumes the data model the other features established. No other feature depends on it.

Rationale: each feature is shippable independently (the table works without observability; the resolution works without new axes). The order minimizes re-work — a future change to the table doesn't invalidate the resolution rule.

## Open Questions

1. **Wall-clock enforcement mechanism**: does `maxWallClockMinutes` check via `setTimeout` in the serve loop, or via a periodic poll against `directive.createdAt + cap`? The poll approach is simpler and survives daemon restarts; the setTimeout approach is more precise but lost on restart.

2. **`maxTotalTurns` vs per-class pools**: if an operator sets BOTH `maxTotalTurns=300` AND `maxTurnsBuilder=200`, the builder can use at most 200 (its class pool) AND the total across all classes is at most 300. Both caps are checked; whichever fires first parks. Is this the right interaction, or should maxTotalTurns subsume per-class pools?

3. **`maxRetriesPerTask` interaction with auto-increase**: auto-increase bumps the pool cap and retries the task. Does each auto-bump count as a "retry" against maxRetriesPerTask? If yes, auto-increase is bounded by both the ceiling multiplier AND the retry count. If no, auto-bumps are invisible to the retry counter.

4. **Observability data retention**: how many historical builds to keep in the aggregation? All-time? Last 30 days? Last N builds? This determines whether p50/p90/max drift over time.

5. **ADR 0035 supersedure chain**: supersedes both 0032 and 0034. ADR 0030 (auto-answer) gets another amendment. ADR 0020 (limits) gets a cross-ref. ADR 0004 (categories) unaffected. Is there a simpler ADR graph?

These are `/relay-design` concerns, not brainstorm-level decisions.
