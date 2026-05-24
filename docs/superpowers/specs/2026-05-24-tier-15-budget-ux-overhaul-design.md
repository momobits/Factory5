# Tier 15 — Budget UX overhaul design

**Status:** Implemented and closed · structural prep complete; live browser smoke deferred to operator · `phase-15-budget-ux-overhaul-closed` tag at `a72b08a`
**Authoring session:** brainstorm 2026-05-24
**Targets:** ADR 0034 (new, supersedes 0032), ADR 0030 (amend), ADR 0020 (cross-ref amend)
**Closes:** U036 (parser too strict), U037 (free-text textarea on structured-options questions)
**Defers:** U038 (brain races auto-answer on directive-level `[escalation]`)
**Sibling artifacts:** `.control/phases/phase-15-budget-ux-overhaul/` (scaffold pending), `UPGRADE/plans/tier-15-budget-ux-overhaul.md` (writing-plans output)

## Why this tier exists

The 2026-05-23 pythonetl build (`01KSB8DEZQCENQEKBKBRCKNYZK`) failed in operator-felt ways that exposed three structural gaps in the Tier 12-13 `[BUDGET]` askUser model:

1. **Parser fragility.** Operator answered `"accept, bump to 160"` in the `[BUDGET]` question; `parseBudgetEscalationAnswer` only recognized literal `accept` / `abort` / `custom <n>` and rejected the natural-language reply. Result: `{ kind: 'abort', reason: 'parse-failed' }` → task failed → 12 dependent tasks failed with `exit 2 'upstream failure'`.
2. **UI freedom on a structured contract.** ADR 0032 §4 specified the answer space as a closed set; the question detail page rendered a free-form textarea regardless. The operator had no way to know the answer space was structured.
3. **Per-task semantic is wrong mental model.** Operators reason about budgets as "how much can this build cost" (pool), not "how much can each individual task cost" (per-task). The current `maxTurns*` axes are per-task; the operator's stated capacity ("set the cap to 500") implies pool semantics.

Tier 15 replaces the entire `[BUDGET]` askUser path with a project-level budget cockpit: live tally, live-editable caps, optional auto-increase. The parser, the askUser, and the structured-options-UI gap all disappear together. ADR 0034 supersedes ADR 0032 with the pool paradigm.

## Decisions (banked in brainstorm)

The six decisions below were each individually confirmed in the design conversation. They are the load-bearing premises of the rest of the spec.

1. **Pool model for the three `maxTurns*` axes.** One directive-wide cap per agent class (scaffolder / builder / fixer). Each task draws from its class's pool; pool exhaustion is the trigger event. `maxUsd` and `maxSteps` already pool directive-wide (no change). `maxUsdPerTask` stays per-task by design (safety net against runaway single-task spend). `askUserDeadlineMs` and `maxWikiReadinessAttempts` keep their existing per-question / single-shot semantics.
2. **Linear bump rule.** Each `accept` (or auto-bump iteration) adds the project default to the current cap. Cap 120 → 240 → 360 → 480. No `BUMP_BUCKETS`, no per-axis bucket schedule, no `MAX_TURNS_CLAMP_*` constants. Predictable in default-units ("3 accepts = 4× the default").
3. **Drop planner per-task `maxTurns` emit.** Planner stops emitting the field. `taskSchema.maxTurns` stays as optional + ignored for backward read-back of historical directives. The pool is the only cap.
4. **Live re-resolve from `project.json`, with per-build override as a floor.** The pool cap is recomputed on every check (≤250 ms via the existing serve poll tick) as `max(project.json, directive.payload.budgets, BUDGET_DEFAULTS)`. `project.json` is the live source — operator edits to project budgets take effect on in-flight directives. `payload.budgets` is a per-directive floor — the operator's per-build override (Build form / CLI flag) survives as a snapshot that cannot be lowered for the lifetime of that directive. Caps can only rise during a directive's lifetime, never fall.
5. **Pool exhaustion parks the directive — no askUser.** Brain marks the directive `blocked` with a structured `blockedReason: { kind: 'pool-exhausted', axis, usedAtPark, capAtPark }`. Project page surfaces a parked-alert banner with one-click "Raise cap to {nextBumpValue}" CTA. No `[BUDGET]` askUser is created. The parser, the auto-answer `[BUDGET]` policy, and the structured-options-UI question disappear together.
6. **Per-project auto-increase toggle with safety multiplier ceiling.** `autoIncreaseBudgets: bool` (default `false`) and `autoIncreaseCeilingMultiplier: number` (default `5`) on `project.json`. When `autoIncreaseBudgets === true`: on pool exhaustion, brain auto-bumps the cap by `+default` and retries — repeatedly until either the directive completes or the cap reaches `default × ceilingMultiplier`, at which point the directive parks with the standard alert. Operators get hands-off behavior up to a hard runaway-cost guardrail.

The visual landing for these decisions is a four-tabbed project cockpit (Live default / Defaults / History / Settings) with a parked-alert banner above the tabs when any in-flight directive on the project is blocked-pool-exhausted.

---

## Section 1 — Architecture & data model

### Project.json schema extension

```json
{
  "id": "01KSB8C3...",
  "name": "pythonetl",
  "metadata": {
    "language": "python",
    "budgetDefaults": {
      "maxUsd": 100,
      "maxSteps": 500,
      "maxTurnsScaffolder": 120,
      "maxTurnsBuilder": 240,
      "maxTurnsFixer": 80,
      "maxUsdPerTask": 100,
      "askUserDeadlineMs": 300000,
      "maxWikiReadinessAttempts": 3
    },
    "autoIncreaseBudgets": true,
    "autoIncreaseCeilingMultiplier": 5
  }
}
```

Two new keys: `autoIncreaseBudgets` (boolean, default `false`) and `autoIncreaseCeilingMultiplier` (number ≥ 1, default `5`). Both optional — old `project.json` files without these keys parse fine. The `budgetDefaults` schema is already widened to all 8 axes via Phase 13.5 (`projectBudgetDefaultsSchema = budgetsSchema`); we just start populating the other 6 axes from the UI.

### Pool calculation — derived, not stored

The pool is a derived view, not a stored aggregate. A new helper `computePoolUsage(db, directiveId, currentProjectBudgets)` returns:

```ts
type PoolUsage = {
  perAxis: Record<BudgetAxisName, {
    used: number;
    cap: number;
    pct: number;                       // 0–100, UI-friendly
    tasks: Array<{                     // empty for non-task-aggregated axes
      taskId: string;
      title: string;
      agent: string;
      contribution: number;
    }>;
    status: 'ok' | 'warn' | 'exhausted';  // green / amber / vermillion
  }>;
  parkedReason?: {
    axis: string;
    usedAtPark: number;
    capAtPark: number;
    nextBumpTo: number;                // cap + projectDefault[axis]
  };
};
```

Implementation: SQL aggregation over `tasks` (turn counts grouped by `agent`) + `model_usage` (USD/steps summed across rows scoped to `directive_id`), joined to the current `project.json` for caps. **No new DB table.** Tier 11's log persistence + per-task heartbeat already give us the underlying data; we just sum it on demand.

### Live re-resolve — the key semantic

The pool cap is recomputed on every pool-check tick (≤250 ms via the existing serve poll interval) as the max of three inputs:

```
effectiveCap[axis] = max(
  project.json.budgetDefaults[axis] ?? 0,
  directive.payload.budgets[axis] ?? 0,
  BUDGET_DEFAULTS[axis].value
)
```

`project.json` is the **live** source — operator edits flow through immediately. `payload.budgets` is the **per-directive floor** — a snapshot of the operator's per-build override (Build form / CLI flag) at directive creation, which cannot be lowered for the lifetime of that directive. `BUDGET_DEFAULTS` is the **system floor** — the built-in defaults that ship with the system.

The `max(...)` rule means caps can only rise during a directive's lifetime, never fall. Operator edits to `project.json` that go BELOW the per-build floor are honored for future builds but ignored for the running directive. (See Section 4 "Build form changes" for the operator-facing UI implication.)

A `pool-resume` mechanism (Section 2) watches `project.json` writes via chokidar on `<project>/.factory/project.json`. On change: re-checks any parked directives on that project; flips status back to `running` and re-enqueues if the recomputed `effectiveCap` has headroom over `used`.

### Axis taxonomy after this tier

| Axis | Type | Semantic | Auto-increase eligible? |
|---|---|---|---|
| `maxUsd` | currency | directive-wide pool (already) | yes |
| `maxSteps` | count | directive-wide pool (already) | yes |
| `maxTurnsScaffolder` | count | **per-agent-class pool (new)** | yes |
| `maxTurnsBuilder` | count | **per-agent-class pool (new)** | yes |
| `maxTurnsFixer` | count | **per-agent-class pool (new)** | yes |
| `maxUsdPerTask` | currency | per-task safety net (unchanged) | no |
| `askUserDeadlineMs` | duration | per-question (unchanged) | no |
| `maxWikiReadinessAttempts` | count | single-shot per directive (unchanged) | no |

Pool semantics apply to the first five. The last three keep their existing meanings.

---

## Section 2 — Brain changes

### Files deleted

| File | Lines | Reason |
|---|---|---|
| `packages/brain/src/budget-escalation.ts` | ~360 | Entire `[BUDGET]` askUser path |
| `packages/brain/src/budget-escalation.test.ts` | ~520 | Companion test |

### Files partially modified

- **`packages/brain/src/auto-answer.ts`** — delete the `[BUDGET]` marker branch (~20 lines), `pickBudgetEscalationAnswer` helper, and the `BUDGET_ESCALATION_MARKER` import. The `[CRITIC]` marker branch from Tier 14 stays. The generic LLM dispatch path stays for any other askUser.
- **`packages/brain/src/pool.ts`** — replace the per-task `error_max_turns` retry-loop (~80 lines) with the new pool-driven dispatcher (sketched below).
- **`packages/brain/src/planner.ts`** — stop emitting `task.maxTurns` (drop the prompt instruction; ~5 lines). The schema field stays optional + ignored.

### New files

- **`packages/brain/src/pool-usage.ts`** — `computePoolUsage(db, directiveId, currentProjectBudgets)` helper. Own file for testability. SQL aggregation only; no I/O beyond the DB and the project.json read.
- **`packages/brain/src/pool-resume.ts`** — chokidar watcher on `<project>/.factory/project.json` for each known project. On change: re-checks parked directives on that project; flips status back to `running` and re-enqueues if cap has headroom. Idempotent against multiple writes.

### Pool-driven dispatcher (pseudocode)

```ts
async function executeTask(task: Task, directive: Directive, ...) {
  // Pre-launch pool check
  const projectBudgets = await loadProjectMetadata(directive.payload.projectPath);
  const pool = computePoolUsage(db, directive.id, projectBudgets);
  const axis = axisForAgent(task.agent);

  if (axis !== undefined && pool.perAxis[axis].used >= pool.perAxis[axis].cap) {
    return parkOrAutoIncrease(directive, axis, pool, projectBudgets);
  }

  // Run worker with NO per-task maxTurns cap — pool is the only limit.
  // Worker watchdog interrupts on turn-completion when pool would cross.
  const result = await runWorker({
    task,
    onTurnComplete: () => checkPoolMidRun(db, directive.id, axis, projectBudgets),
    ...
  });

  return result;
}

async function parkOrAutoIncrease(directive, axis, pool, projectBudgets) {
  const defaultDelta = BUDGET_DEFAULTS[axis].value;
  const ceiling = (projectBudgets.budgetDefaults[axis] ?? defaultDelta)
                * (projectBudgets.autoIncreaseCeilingMultiplier ?? 5);

  if (projectBudgets.autoIncreaseBudgets === true && pool.perAxis[axis].cap < ceiling) {
    await bumpProjectCap(directive.payload.projectPath, axis, defaultDelta);
    emitLogLine(emit, directive.id, 'info', 'brain.pool',
      `pool: auto-bumped ${axis} to ${pool.perAxis[axis].cap + defaultDelta}`,
      { axis, oldCap: pool.perAxis[axis].cap, newCap: pool.perAxis[axis].cap + defaultDelta });
    return executeTask(task, directive, ...); // retry — pool check re-runs against new cap
  }

  directives.updateStatus(db, directive.id, 'blocked', {
    reason: 'pool-exhausted',
    axis,
    usedAtPark: pool.perAxis[axis].used,
    capAtPark: pool.perAxis[axis].cap,
  });
  emitLogLine(emit, directive.id, 'warn', 'brain.pool',
    `pool: ${axis} exhausted at ${pool.perAxis[axis].cap} — directive parked; raise cap on project page to resume`,
    { axis, capAtPark: pool.perAxis[axis].cap, nextBumpTo: pool.perAxis[axis].cap + defaultDelta });
}
```

### Cascade behavior

When pool exhausts mid-build, the watchdog sends `SIGTERM` to the running worker (already wired for cancellation per Phase 3). Worker exits; pool dispatcher returns the partial result as a failed task with `errorSubtype: 'pool-exhausted'`. Dependent tasks see the directive's `blocked` status at dispatch-check time and are NOT launched — the 12-task `'upstream failure'` cascade from the pythonetl run goes away because the dispatcher gates on directive status before each task launch.

### Worker watchdog contract

The brain pool dispatcher passes an `onTurnComplete` callback to the worker. The worker (already heartbeating per Tier 11) calls this callback after each completed turn. The callback checks the pool against `project.json`. If the pool is now exhausted: the callback returns `{ interrupt: true }`; the worker shuts down its current turn and exits cleanly. Heartbeat plumbing is unchanged.

---

## Section 3 — HTTP / IPC surface

### Modified endpoint

`PUT /api/v1/projects/:id/budget-defaults` — already exists, currently accepts `{ maxUsd?, maxSteps? }`. Extends to:

```ts
// apiV1ProjectBudgetDefaultsPutBodySchema (in @factory5/ipc)
{
  budgetDefaults?: BudgetsPartial,         // all 8 axes, Phase 13.5 schema
  autoIncreaseBudgets?: boolean,           // new
  autoIncreaseCeilingMultiplier?: number,  // new, >= 1
}
```

PUT semantics unchanged: body replaces the entire `budgetDefaults` document (and the two scalar keys). Empty/absent axes are removed. Daemon writes through `wiki.updateProjectMetadata` (same path Discord's `/budget` slash command uses today).

### New endpoint

`GET /api/v1/directives/:id/pool-usage` — returns the live tally:

```ts
// apiV1PoolUsageResponseSchema
{
  directiveId: string,
  computedAt: string,                      // ISO timestamp
  perAxis: {
    [axis]: {
      used: number,
      cap: number,
      pct: number,
      tasks: Array<{ taskId, title, agent, contribution }>,
      status: 'ok' | 'warn' | 'exhausted',
    }
  },
  parkedReason?: {
    axis: string,
    usedAtPark: number,
    capAtPark: number,
    nextBumpTo: number,
  }
}
```

Auth: bearer token. 404 on missing directive. The `tasks` array is empty for axes that aren't per-agent-class.

### New SSE event

The per-directive SSE stream (Phase 3) and per-directive `log.line` persistence (Tier 11) already exist. Add:

```ts
{ kind: 'pool.tally', directiveId, perAxis: <PoolUsage.perAxis>, parkedReason?: ... }
```

Emitted from the brain pool dispatcher after every task-completion event and after every `bumpProjectCap` write. Replaces polling — the Live tab subscribes and updates bars in real time. The initial render on tab open uses `GET /api/v1/directives/:id/pool-usage` (replay-then-SSE pattern, Tier 11 precedent).

### Extended endpoint

`GET /api/v1/directives/:id` — `status: 'blocked'` response gains a structured `blockedReason`:

```ts
{
  // existing fields ...
  status: 'blocked',
  blockedReason?: {
    kind: 'pool-exhausted',  // or other variants (free string for legacy)
    axis?: string,
    usedAtPark?: number,
    capAtPark?: number,
  }
}
```

The DB column `directives.blocked_reason TEXT` already exists. New rows store a JSON-encoded structured value for `kind: 'pool-exhausted'`; legacy free-text values (e.g., `'cancelled-from-web-ui'`) stay readable. IPC schema is a union: structured shape OR plain string.

### Action endpoint (no new route)

The "Raise cap to {N}" button on the project page is a regular `PUT /api/v1/projects/:id/budget-defaults` call. UI computes the new value (`currentCap + projectDefault`) client-side. The pool-resume watcher (Section 2) picks up the project.json change automatically.

---

## Section 4 — Web UI: project page redesign

### Route

`apps/factory-web/src/pages/projects/detail.astro` — full rewrite. Today: single budget-defaults form (2 axes). New: tabbed cockpit with parked-alert banner.

### Page structure

```
┌─ Project: pythonetl ───────────────────────────────────────┐
│ ULID 01KSB8C3... · workspace path · language · status      │
└─────────────────────────────────────────────────────────────┘

┌─ [Parked alert; conditional on in-flight directive blocked-pool-exhausted] ─┐
│ ⚠ Parked: pool maxTurnsBuilder exhausted at 240                              │
│ Directive 01KSB8DEZ... · raised 1 time (120 → 240)                            │
│ [Raise cap to 360]   [Abort directive]                                        │
└───────────────────────────────────────────────────────────────────────────────┘

[Live]  [Defaults]  [History]  [Settings]
─────
{tab content}
```

### Live tab (default landing)

Bar treatment with three subsections (directive-wide pools / per-class turn pools / other caps). Each row is click-to-expand for drill-down. Color: green < 80%, amber 80–99%, vermillion at 100% / exhausted. Renders an empty-state ("No active build. Caps will apply to your next build.") when no in-flight directive exists for this project.

```
In-flight · 01KSB8DEZ…

maxUsd                $1.43 / $100.00       [■─────────] 1.4%
maxSteps              47 / 500              [■─────────] 9.4%

Turn pools (per agent class)
maxTurnsScaffolder    38 / 120              [■■■───────] 31.7% · 1 task
maxTurnsBuilder       240 / 240             [■■■■■■■■■■] EXHAUSTED · 13 tasks ▼
  └─ Build core errors and types (builder)              60 turns ━━━━━━━━━━━━━━
  └─ Build CSV extractor (builder)                      80 turns ━━━━━━━━━━━━━━━━━━━
  └─ Build JSON extractor (builder)                     45 turns ━━━━━━━━━━━
  └─ ... 10 more
maxTurnsFixer         0 / 80                [──────────] 0% · 0 tasks

Other caps
maxUsdPerTask         $0.34 max / $100.00   (highest single-task spend)
maxWikiReadinessAttempts  1 / 3             (critic passed first try)
```

When multiple in-flight directives exist on the same project (rare; happens when `factory build` runs while another is in flight), render a small directive selector at the top of the Live tab.

Data flow: initial render → `GET /api/v1/directives/:id/pool-usage`. Then subscribe to per-directive SSE stream, filter for `pool.tally` events, mutate the rendered bars.

### Defaults tab

Existing budget-defaults form expanded from 2 to 8 axis fields. Same `Field` / `Form` / `Submit` primitives. PUT semantics preserved. Inline help under each axis matches the Advanced budgets accordion text from Phase 12.4 (`explainer` strings on `BUDGET_DEFAULTS`).

```
Budget defaults
Resolution order: per-build flag → project (here) → built-in default → unlimited.

[ Max USD           ] [ Max steps                ]
[ Max turns scaffolder ] [ Max turns builder    ] [ Max turns fixer ]
[ Max USD per task  ] [ Ask deadline ms ] [ Max wiki readiness attempts ]

[Save defaults]   [Clear all defaults]
```

### History tab

Table of past directives on this project, sorted newest first. Columns: directive ID (link), created date, status, intent, spend USD, total turns, "see pool usage" link. Default page size 50; older builds paginate. No new endpoints — uses existing `GET /api/v1/directives?projectId=X`.

### Settings tab

```
Auto-increase budgets
[ ] Automatically raise caps on exhaustion (no manual unblock needed)

  Safety ceiling: [ 5 ] × the project default per axis
  When the auto-bumped cap would exceed this multiplier, the directive
  parks instead and you get the manual alert above.
```

`autoIncreaseBudgets` checkbox + `autoIncreaseCeilingMultiplier` number input. Future Settings can land here without changing the page shape.

### Directive Detail page changes

`apps/factory-web/src/pages/directives/detail.astro` — adds a small "Pool usage" pill near the spend display:

```
spend $1.43  ·  pool: maxTurnsBuilder 240/240 EXHAUSTED  →  Manage on project page
```

Breadcrumb-style nav. The directive detail page does NOT duplicate the full tally — the project page is the single source of truth for budget UX.

### Build form changes

`apps/factory-web/src/pages/build.astro` — Advanced budgets accordion (Phase 12.4) stays. Per-build overrides via the Build form land in `directive.payload.budgets` at directive creation, as today. CLI flags (`--max-turns-builder`, etc., from Phase 12.5) on `factory build` and `factory resume` stay.

**Pool cap resolution rule (the precedence ambiguity from Section 1, resolved):**

```
effectiveCap[axis] = max(
  project.json.budgetDefaults[axis] ?? 0,
  directive.payload.budgets[axis] ?? 0,
  BUDGET_DEFAULTS[axis].value
)
```

The pool reads `max(project, per-build, default)` on every check. Practically:

- **Per-build override is a floor.** If operator sets `--max-turns-builder 200` on the Build form, the builder pool cap is at least 200 for this directive, even if `project.json.maxTurnsBuilder` is 80.
- **Live re-resolve raises monotonically.** If operator edits `project.json.maxTurnsBuilder` from 80 to 500 mid-build, the pool cap jumps to 500 immediately. If they edit it to 50, the pool cap stays at 200 (the per-build floor still wins).
- **Auto-increase writes to `project.json`** only — never to `payload.budgets`. So the auto-bump cap is on project.json; per-build floor is unaffected.

The Build form gets a small UI copy clarification: "Override budgets for this build (operator floor). Live edits during the build happen on the project page and can only raise the cap further."

This preserves both per-build override convenience AND the live-re-resolve invariant. The trade-off: `payload.budgets` is still read at runtime (per-build floor) — it is NOT purely audit-only. Section 1's "retired as a runtime read" wording is too strong; the correct phrasing is "no longer the SOLE source of cap truth; participates as a per-directive floor in the `max(...)` rule above."

### What does NOT change

- `apps/factory-web/src/pages/questions/detail.astro` — still handles non-budget askUsers (e.g., directive-level `[escalation]`). `[BUDGET]`-prefixed questions stop being created; pre-existing rows render with the existing free-text textarea (operator can still answer; no special parsing).
- `apps/factory-web/src/pages/questions/index.astro` — no structural change.

---

## Section 5 — Migration, ADRs, and cleanup

### ADR work

- **New ADR 0034 — Budget Pool Paradigm** (supersedes ADR 0032). Six decisions banked in this design land here:
  1. Pool semantic for the three `maxTurns*` axes; per-class aggregation; cap-resolution rule `max(project.json, payload.budgets, BUDGET_DEFAULTS)` per axis.
  2. Live re-resolve from `project.json` (monotonic-up only — per-directive floor preserved); project page is the single editable source.
  3. Pool exhaustion parks the directive with structured `blockedReason` — no askUser, no parser, no auto-answer policy for budget axes.
  4. Linear bump rule (+default per accept / per auto-bump iteration); no `BUMP_BUCKETS`, no `MAX_TURNS_CLAMP_*` constants.
  5. Per-project auto-increase toggle with safety multiplier ceiling; default off; default multiplier 5×.
  6. Planner stops emitting `task.maxTurns`; the field stays in `taskSchema` as optional + ignored for backward read-back.

  ADR 0032 status flips to `Superseded by ADR 0034`. ADR 0032 itself stays unchanged in `docs/decisions/` per CLAUDE.md "do not edit accepted ADRs."

- **Amend ADR 0030** (auto-answer) with a Tier 15 amendment block: `[BUDGET]` marker branch removed; auto-answer dispatcher now handles `[CRITIC]` and generic LLM dispatch only.

- **Amend ADR 0020** (limits) with a one-line cross-reference: "See ADR 0034 for the unified pool model across all five aggregated axes."

### Schema migrations

**None.** No new DB tables, no column adds, no constraint changes. The pool is derived live from existing `tasks` + `model_usage` + `project.json`. The `directives.blocked_reason` column stays `TEXT`; the structured-vs-free-text distinction is handled at the IPC layer.

### Code deletion inventory

| File | Lines | Reason |
|---|---|---|
| `packages/brain/src/budget-escalation.ts` | ~360 | Entire `[BUDGET]` askUser path |
| `packages/brain/src/budget-escalation.test.ts` | ~520 | Companion test |
| `packages/brain/src/auto-answer.ts` (partial) | ~20 + `pickBudgetEscalationAnswer` | `[BUDGET]` marker branch |
| `packages/brain/src/pool.ts` (partial) | ~80 | Per-task retry-loop |
| `packages/brain/src/planner.ts` (partial) | ~5 | `task.maxTurns` emit instruction |
| `apps/factory-web/src/pages/projects/detail.astro` | ~100 | Replaced by tabbed cockpit |

Total: ~1100 lines removed. Net change roughly neutral after adding pool consumer, pool-resume watcher, pool-usage IPC, and new tabbed UI (~1200 lines added).

### Forward-only data compat

- Existing `project.json` without `autoIncreaseBudgets` / `autoIncreaseCeilingMultiplier`: schema treats both as optional, defaults off / 5×. No migration script.
- Existing directives with `payload.budgets.maxTurnsBuilder=80` (per-build override): still read at runtime, but now only as the per-directive floor in the `max(project, per-build, default)` rule (Section 1). Operators who set per-build overrides at directive creation get the same semantic: their cap can be raised by project edits or auto-increase, but not lowered for the lifetime of the directive.
- Existing `tasks` rows with `task.maxTurns` set by the old planner: ignored. The new pool dispatcher doesn't read the field.

### Backward-compat risks (acknowledged)

- An in-flight directive at deploy time would crash because the new pool dispatcher doesn't recognize the old per-task semantic. **Mitigation:** operator deploys with `daemon stop` (standing practice per Phase 12 retro). Documented in the Tier 15 README.
- Discord `/budget` slash command (Phase 2) still writes only `maxUsd`/`maxSteps`. Not expanded in Tier 15. Stays a follow-up.

### Issues in-tier

- **U036** (parser too strict) — opened in Tier 15 §1, closed by parser deletion.
- **U037** (free-text textarea on structured-options questions) — opened, closed by `[BUDGET]` askUser no longer being created. General fix for other askUsers deferred.
- **U038** (brain races auto-answer on directive-level `[escalation]`) — opened, **deferred** to a future tier (brain-side timing fix, unrelated to budget UX).

---

## Section 6 — Testing & out-of-scope

### Test coverage map

| Layer | New tests | What they assert |
|---|---|---|
| `@factory5/core` | ~8 | `BudgetsPartial` accepts all 8 axes + project-level scalars; negative ceilingMultiplier rejected; zero-sentinel preserved per axis. |
| `@factory5/state` | ~6 | `project.json` round-trips new keys; `loadOrCreateProjectMetadata` defaults `autoIncreaseBudgets=false`, `autoIncreaseCeilingMultiplier=5` when absent; corrupt-file path still throws. |
| `@factory5/brain` `pool-usage.ts` | ~10 | Aggregation: 0 tasks → 0/cap; 3 builder tasks → sum of turnsUsed; per-class isolation; USD/steps roll up across model_usage rows; live cap re-read after project.json mutation. |
| `@factory5/brain` `pool.ts` | ~12 | Pre-launch pool check blocks dispatch when exhausted; worker watchdog interrupts mid-turn when pool crosses; auto-increase ON within ceiling: bump-then-retry succeeds; ceiling exceeded: parks; no auto-increase: parks first try; parkedReason structure correct. |
| `@factory5/brain` `pool-resume.ts` | ~8 | project.json write triggers re-check; parked directive with headroom flips to running; parked still-exhausted stays blocked; multiple parked directives on same project all resume; race against operator-issued resume CLI. |
| `@factory5/brain` `auto-answer.ts` (regression) | ~3 | `[CRITIC]` marker still handled; generic LLM dispatch still works; `[BUDGET]`-prefixed strings no longer specially treated. |
| `@factory5/daemon` | ~10 | PUT `/budget-defaults` accepts all 8 axes; rejects extra keys (strict); GET `/pool-usage` shape; 404 missing directive; bearer auth required; SSE `pool.tally` event emits on task-completion. |
| `@factory5/wiki` `project-metadata.ts` regression | ~4 | Schema round-trip includes the two new scalars; `resolveDirectivePayloadBudgets` removed (replaced by live re-resolve) — verify no remaining importers. |
| `apps/factory-web` light unit + compile | ~5 | Page TypeScript compiles; the four tabs mount; Live tab fetch-render loop doesn't infinite-fetch; auto-increase toggle PUTs correctly. |

**Total: ~66 new tests**, target workspace count **~1454** (from current 1388 + 3 skipped). Matches Tier 14 cadence.

### Live browser smoke gates (Playwright MCP)

1. **Parked-directive flow:** create a project with `maxTurnsBuilder=80`, kick off a build that the planner expands to ~5 builder tasks, watch the pool exhaust, verify the directive parks with structured `blockedReason`, click "Raise cap to 160" on the project page, verify auto-resume within ≤250 ms.
2. **Auto-increase flow:** same project but `autoIncreaseBudgets=true` and `ceilingMultiplier=3`; verify two auto-bumps happen silently (80 → 160 → 240), then directive parks at 240 (3× ceiling reached); no operator action between bumps; activity feed narrates each bump.
3. **Multi-class isolation:** scaffolder pool exhaustion doesn't affect builder or fixer pools; the parked-alert names the right axis.

### Out of scope (deferred)

- Pool tally rollup across projects (multi-project budget cockpit).
- Pre-emptive warning at 80% pool consumption.
- U038 (brain races auto-answer on non-budget `[escalation]`) — separate tier.
- Discord / Telegram `/budget` command expansion to all 8 axes.
- General question-detail-page UX for non-budget structured-options askUsers.
- Cost forecasting / "this build will probably cost ~$X" estimates.
- Mid-task pool warning emissions beyond binary at-100% park.

### Done-criteria for `/phase-close`

1. All 4 `pnpm` gates green (~1454 passing + 3 skipped).
2. ADR 0034 lands; ADR 0032 marked `Superseded by ADR 0034`; ADR 0030 amendment block appended; ADR 0020 cross-ref amended.
3. `packages/brain/src/budget-escalation.ts` deleted; companion test deleted; no remaining importers (grep clean).
4. `[BUDGET]` branch removed from `auto-answer.ts`; `[CRITIC]` regression test still passes.
5. Pool consumer lives in `pool.ts` + `pool-usage.ts` + `pool-resume.ts` with full test coverage.
6. New `GET /api/v1/directives/:id/pool-usage` route returns correct shape; SSE `pool.tally` events emit.
7. `PUT /api/v1/projects/:id/budget-defaults` accepts all 8 axes + the two new scalars.
8. Project detail page renders 4 tabs (Live default, Defaults, History, Settings); Live tab shows bar treatment + drill-down.
9. Auto-increase toggle actually bumps, respects ceiling multiplier, parks at ceiling.
10. Live re-resolve verified: edit `project.json` out-of-band, watch in-flight directive's cap update.
11. Browser smoke #1 (parked → raise → auto-resume) verified.
12. U036 + U037 moved to Resolved; U038 added to ISSUES.md Open as a Tier-16+ candidate.

---

## Open questions deferred to implementation

These minor questions did not gate the design but should be answered when the implementation plan is drafted (writing-plans phase):

- **Tab persistence:** when an operator switches tabs and reloads the page, should the last-active tab be remembered (localStorage) or always default to Live? (Recommend localStorage.)
- **`computePoolUsage` cache invalidation:** if the SSE `pool.tally` event already pushes diffs, does the client need to re-fetch the GET endpoint after every task-completion, or only on initial mount + reconnect? (Recommend mount + reconnect only.)
- **chokidar watcher scope:** watch every `<project>/.factory/project.json` on daemon start, or lazy-add on first directive creation? (Recommend lazy-add to keep daemon startup time bounded.)
- **Settings tab default on first project creation:** is the auto-increase checkbox unchecked by default? (Recommend yes — conservative default.)
- **CLI `factory resume` budget flags:** they survive the removal of `factory build` budget flags because resume needs to nudge inherited budgets without a separate project edit. Confirm during plan: does the resume path now write to `project.json` (consistent with live re-resolve) or stay as a per-directive override (the one remaining audit-only payload.budgets writer)?

These are not blocking the design approval; they will be settled in the implementation plan.

## Out-of-tier follow-ups noted

- Discord `/budget` slash command expansion to all 8 axes (Tier 16+ candidate).
- General question-detail-page UI for structured-options askUsers (the `options[]` field is contractual; the textarea should be radio-buttons-or-similar).
- U038 (auto-answer race on non-budget `[escalation]`).
- Cost forecasting telemetry foundation.
- Per-project askUserDeadlineMs override (long-standing carry-forward, unrelated but UI-adjacent).
