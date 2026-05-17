# Tier 12 — Budget UX: surface all knobs, escalate instead of hard-fail

**Status:** scaffolded, not started
**Estimated duration:** 2 sessions
**Issues addressed:** U032 (operator-invisible turn budgets; hard-fail-on-budget-trip without retry-question escalation)

## Goal

Stop the app from silently picking budget defaults the operator never sees, and stop the app from hard-failing tasks when a budget can be cheaply extended. Today the architecture has at least 15 hardcoded budgets and timeouts (audited 2026-05-16, see `## Budget audit` below). The operator controls only two of them (`maxUsd`, `maxSteps`). When the per-task `maxTurns` trips mid-stream, the worker fails the task and the brain raises a generic askUser ("scaffolder failed; what next?") that doesn't carry the context to fix it.

This tier ships a **surface-and-escalate** budget model:

1. Every operator-felt budget exposed at build mint time with a documented default and an explainer.
2. Every operator-felt budget persisted in the directive's payload and inherited on resume.
3. `maxTurns` failures escalate via a typed askUser ("scaffolder hit 80-turn cap; retry with [120] or abort?") instead of a generic one.
4. ADR 0032 documents the budget paradigm — which knobs are operator-facing vs internal-pacing, and how to add new ones safely.

## Outcome

- **Web UI Build form** gains an "Advanced budgets" accordion with `maxTurns (scaffolder)`, `maxTurns (builder)`, `askUserDeadlineMs`, plus `maxUsd` / `maxSteps` that already exist. Each field shows its default value and a one-line explainer. The collapsed-by-default state preserves the simple "pick project, hit submit" path for operators who don't care.
- **CLI** gains `--max-turns-scaffolder`, `--max-turns-builder`, `--ask-deadline-ms` flags with the same defaults + explainers in `--help`.
- **Directive payload** carries the full budget set explicitly. Resumes inherit verbatim. Per-project metadata at `<project>/.factory/project.json` can override defaults (third tier per the existing budget-resolution helper).
- **Brain escalation on `error_max_turns`** — when the worker returns the `error_max_turns` subtype, the brain raises a typed askUser with the failing task title, the current `maxTurns`, and a suggested bump (default: next bucket; for scaffolder 80→120→160, for builder 80→160). The operator (or Tier 8 auto-answer) picks: accept-bump, custom-bump, or abort. Accept-bump retries the task with the higher budget; abort flips the directive to `blocked`. The auto-answer default behaviour: bump-by-one-bucket on the first failure, abort on the second.
- **ADR 0032 — Budget UX paradigm** pins which budgets are operator-facing, which are internal, the escalation rule, and the per-failure backoff schedule for the auto-answer dispatcher.

## Where we were, end of Phase 11

Phase 11 (per-directive log persistence) closed. The activity panel can now narrate brain stages durably across reloads. The next operator-felt pain is the _budget UX_ — Tier 10's smoke surfaced that a 13-module scaffold failed at the default 40-turn budget; Tier 12 closes the loop by making that budget visible + bumpable instead of invisible + hard-fail.

The Phase 10 close commit (`fbc3c27`) and the post-close fix (`fa2f800`) bumped the provider default `maxTurns: 40 → 80` and the advertised planner range `10-80 → 10-160` as a stopgap. Tier 12's job is to make those values operator-visible AND operator-overrideable per-build, not just a higher hidden default.

## Why this phase exists

The operator-felt complaint, verbatim: _"why are we failing instead of asking the user if we should continue over the budget? why do we have a cost limit? why do we have a max cost and max steps that we ask the user and have other limits the user does not see? why don't we ask the user for input on all the limits we have in the code instead of failing like this when the user plans a new build."_

That's the design thesis for the tier. Two failure modes today:

1. **Invisible budgets, no path to set.** Per-task `maxTurns` (default 80 post-`fa2f800`), `claudeCliTimeoutMs` (10 min), `askUserDeadlineMs` (5 min, configurable via JSON only). Operator never sees them at build time.
2. **Hard-fail when ceiling hits, generic ask.** When `maxTurns` trips, the worker reports `error_max_turns`, the task is marked failed, the brain raises a generic `askUser("what next?")` with no context about the budget. The Tier 8 auto-answer LLM has the same gap — it doesn't know to suggest bumping the budget; it picks `blocked` by default.

The current `maxUsd`/`maxSteps` model is the right pattern: pre-flight check, ceiling-tripped → `BudgetExceededError` → typed blocked-reason → outbound message saying _"resume with `--max-usd $higher` to continue"_. Tier 12 generalises that pattern to `maxTurns` and every other operator-felt budget.

## Budget audit (2026-05-16)

| Constant                              | Default             | Operator-controllable today?                           | Tier 12 target                                                                                                 |
| ------------------------------------- | ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `maxTurns` (provider)                 | 80 (post-`fa2f800`) | No (planner emits per-task; operator never sees)       | **Operator-facing**: per-agent (scaffolder/builder/fixer) at build time                                        |
| `maxUsd` (directive)                  | unset               | Yes (CLI + Web Build form + project metadata + config) | Already operator-facing; add explainer text                                                                    |
| `maxSteps` (directive)                | unset               | Yes (CLI + Web Build form + project metadata + config) | Already operator-facing; add explainer text                                                                    |
| `askUserDeadlineMs`                   | 300_000 (5 min)     | Yes (config.json only)                                 | **Operator-facing**: build-time override + project-metadata per-project override (already in Phase 8 deferred) |
| `claudeCliTimeoutMs`                  | 600_000 (10 min)    | No                                                     | Stays internal; document only                                                                                  |
| `claudeCliStreamTimeoutMs`            | 1_200_000 (20 min)  | No                                                     | Stays internal; document only                                                                                  |
| `DEFAULT_TURN_TIMEOUT_MS` (chat REPL) | 120_000 (2 min)     | No                                                     | U005 — bump to 600_000 + heartbeat; separate work, already on the carry-forward list                           |
| `DEFAULT_POLL_INTERVAL_MS` (serve)    | 250                 | No                                                     | Stays internal                                                                                                 |
| `AUTO_ANSWER_SWEEP_INTERVAL_MS`       | 5_000               | No                                                     | Stays internal                                                                                                 |
| `HEARTBEAT_INTERVAL_MS` (SSE)         | 15_000              | No                                                     | Stays internal                                                                                                 |
| `HEARTBEAT_INTERVAL_MS` (pool)        | 10_000              | No                                                     | Stays internal                                                                                                 |
| `RETRY_BACKOFF_MS` (auto-answer)      | 2_000               | No                                                     | Stays internal                                                                                                 |
| `ORPHAN_STALE_AFTER_MS`               | 600_000 (10 min)    | No                                                     | Stays internal                                                                                                 |
| `START_WAIT_BUDGET_MS`                | 5_000               | No                                                     | Stays internal                                                                                                 |
| `STOP_WAIT_BUDGET_MS`                 | 10_000              | No                                                     | Stays internal                                                                                                 |

**Decision rule going forward** (ADR 0032): a budget is operator-facing if (a) the operator can plausibly judge what value they want for THIS build (project size, time pressure, $ ceiling) AND (b) the failure mode if it trips is operator-visible. Internal pacing constants (poll intervals, heartbeats, backoffs) fail both tests — they tune the daemon's responsiveness, not the build's outcome.

## What this tier ships

### 12.1 — Open U032

Severity high; Tier 12; Area cli + web + brain.

### 12.2 — ADR 0032: Budget UX paradigm

Five-part decision:

1. **Operator-facing budgets** — `maxUsd`, `maxSteps`, `askUserDeadlineMs`, `maxTurns` (per tool-using agent class). Settable via CLI / web form / project metadata / instance config (four-tier resolution per ADR 0027 §4 + Tier 12's `maxTurns` extension).
2. **Internal-pacing constants** — poll intervals, heartbeats, backoffs, timeouts. Documented in code via `// internal pacing — operator should not need to tune` comments, NOT surfaced.
3. **Default-publication contract** — every operator-facing budget MUST publish its default + a one-line explainer in `@factory5/core/src/budget-defaults.ts` (new file). The CLI `--help` text and Web Build form's accordion both read from this single source so they can't drift.
4. **Escalation rule** — when a per-task budget trips (`error_max_turns` today; future: per-task USD cap if Tier 13 adds it), the brain raises a typed askUser with the budget axis, the failing task title, the current value, and a suggested bump (next-bucket). The directive does NOT flip to failed/blocked immediately; it waits on the answer like any other askUser. Tier 8's auto-answer dispatcher gets a typed-prompt path: bump-by-one-bucket on first failure, abort on second.
5. **Persistence contract** — every operator-facing budget the directive used MUST be in the directive's `payload.budgets` (new field). Resumes inherit verbatim. The Tier 10 resume route already inherits `limits`; this extends to the full budget set.

### 12.3 — Default publication

New `@factory5/core/src/budget-defaults.ts`:

```ts
export const BUDGET_DEFAULTS = {
  maxUsd: {
    value: 0,
    explainer: 'Hard ceiling in USD across the whole build. 0 = unlimited (default).',
  },
  maxSteps: {
    value: 0,
    explainer: 'Hard ceiling on LLM call count across the build. 0 = unlimited (default).',
  },
  askUserDeadlineMs: {
    value: 300_000,
    explainer:
      'How long the brain waits on an `askUser` before falling back to an LLM-based auto-answer (Tier 8 / ADR 0030). 5 min default.',
  },
  maxTurnsScaffolder: {
    value: 120,
    explainer:
      'Per-task tool-conversation cap for the scaffolder. Higher for projects with >10 modules. The default 120 covers most cases.',
  },
  maxTurnsBuilder: {
    value: 80,
    explainer:
      'Per-task tool-conversation cap for builders. Defaults to 80; broad cross-cutting builders may want 120-160.',
  },
  maxTurnsFixer: {
    value: 80,
    explainer: 'Per-task tool-conversation cap for fixers. Defaults to 80.',
  },
} as const;
```

Plus a Zod schema mirror so the CLI/web/project-metadata parsers all converge on the same shape.

### 12.4 — Web UI Build form: Advanced budgets accordion

In `apps/factory-web/src/pages/build.astro`, extend the form with a collapsed-by-default `<details>` section:

```
+ Advanced budgets
  maxUsd               [    0 ]  Hard ceiling in USD. 0 = unlimited.
  maxSteps             [    0 ]  Hard ceiling on LLM calls. 0 = unlimited.
  askUserDeadline (ms) [300000]  Time before an askUser falls back to LLM auto-answer.
  maxTurns scaffolder  [   120]  Per-task turn cap. Higher for >10-module projects.
  maxTurns builder     [    80]  Per-task turn cap for builders.
  maxTurns fixer       [    80]  Per-task turn cap for fixers.
```

Each field labeled with its explainer (hover tooltip + small grey hint text below). Submit POSTs to `/api/v1/builds` with the full budget set in the body.

### 12.5 — CLI flags

In `packages/cli/src/commands/build.ts`:

```
--max-usd <n>                 (default 0 = unlimited)
--max-steps <n>               (default 0 = unlimited)
--ask-deadline-ms <ms>        (default 300000)
--max-turns-scaffolder <n>    (default 120)
--max-turns-builder <n>       (default 80)
--max-turns-fixer <n>         (default 80)
```

`--help` post-text shows the defaults + explainers verbatim from `BUDGET_DEFAULTS`. Same flags on `factory resume`.

### 12.6 — Brain escalation path

`packages/brain/src/pool.ts`:

When the worker returns an `error_max_turns` subtype, instead of marking the task `failed` and continuing, the brain:

1. Detects the subtype from the worker's structured outcome.
2. Raises a typed askUser with a specific prompt: _"Task '<title>' ran out of turns (cap: <current>). Bump to <suggested-next>? Options: accept / custom / abort"_.
3. Awaits the answer (Tier 8 auto-answer fallback applies).
4. On accept: relaunch the task with the bumped budget (worker subprocess restart; same worktree).
5. On custom: relaunch with the user-supplied value.
6. On abort: mark task failed (current behaviour), let the directive proceed with its normal post-task pool handling.

Tests:

- Unit: pool detects subtype, raises typed askUser, calls relauncher with bumped value.
- Integration: directive with budget-tripping scaffolder; ask is raised; auto-answer accepts; task retries; succeeds.
- Auto-answer prompt: builds the typed prompt from the budget-axis context.

### 12.7 — Persistence + resume parity

Extend `directiveSchema.payload` to include a `budgets` field (typed via the new schema). Tier 10's resume route inherits `prior.limits` today; extend to inherit `prior.payload.budgets` and merge with body overrides.

### 12.8 — Phase close

Standard gates + a live browser smoke: kick off a build via the Web UI with custom budgets, confirm they land on the directive, confirm a budget-tripping task escalates via askUser (with the typed prompt) instead of hard-failing.

## Done criteria

- [ ] All four `pnpm` gates green
- [x] ADR 0032 lands; INDEX.md + ARCHITECTURE.md ADR count updated
- [x] `BUDGET_DEFAULTS` exported from `@factory5/core`; CLI and Web read from the same source
- [x] Web Build form: Advanced budgets accordion with all six fields + defaults + explainers
- [x] CLI: six new flags on `factory build` and `factory resume`; `--help` quotes the same explainers
- [x] Directive payload carries `budgets`; resume inherits it
- [x] Brain escalation: `error_max_turns` triggers typed askUser with bump-suggestion
- [x] Tier 8 auto-answer accepts the bump on first failure, aborts on second
- [x] Tests cover the escalation path
- [ ] Browser smoke: budget-tripping task escalates via askUser, accept → retry → success
- [ ] U032 closes

## Rollback

`git reset --hard phase-11-directive-log-persistence-closed`. No DB schema changes; no migrations to unwind. ADR 0032 stays in history per CLAUDE.md "do not edit accepted ADRs"; supersede with a follow-up if the model needs revising.

## Carry-forward (Tier 13+ candidates)

- **Per-task USD cap.** Today only the directive-level `maxUsd` exists. A per-task USD ceiling would let the planner say "this scaffolder shouldn't cost more than $1; if it would, escalate." Same escalation pattern; new budget axis.
- **Mid-task escalation.** Today `error_max_turns` is caught post-stream. Mid-stream budget warnings ("approaching cap, want me to extend?") would let the operator decide proactively. Bigger surface; defer.
- **Per-project default overrides.** Project `metadata.budgetDefaults` already exists for `maxUsd`/`maxSteps` (Tier 8); extend to the full budget set. Small; bundle with 12.7 if convenient or carry forward.
- **Budget audit dashboard.** A page that shows "you've burned $X of $Y across the last N directives; here's where it went." Tier 13+; depends on having multi-build telemetry.

## Suggested commit shape

- `chore(phase-12): scaffold tier 12 budget UX`
- `chore(12.1): open U032`
- `docs(12.2): ADR 0032 — budget UX paradigm`
- `feat(12.3): BUDGET_DEFAULTS in @factory5/core`
- `feat(12.4): Web UI Build form — Advanced budgets accordion`
- `feat(12.5): CLI budget flags + --help explainers`
- `feat(12.6): brain escalation on error_max_turns`
- `feat(12.7): directive payload.budgets + resume inheritance`
- `chore(phase-12): close phase 12`
