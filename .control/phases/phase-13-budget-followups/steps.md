# Phase 13 Steps

- [x] 13.1 — Open U033 in `UPGRADE/ISSUES.md` Open section (already filed during Phase 12 smoke; flip ROADMAP row + bump tier indicator from "Tier 13 (carry-forward from 12)" → "Tier 13"). Severity high; Tier 13; Area brain + docs.
- [x] 13.2 — Open U034 in `UPGRADE/ISSUES.md` Open section (already filed during Phase 12 session-end; flip ROADMAP row + bump tier indicator from "Tier 13 (carry-forward candidate)" → "Tier 13"). Severity low; Tier 13; Area cli + daemon.
- [x] 13.3 — Fix U033: `resolveTaskMaxTurns` in `packages/brain/src/budget-escalation.ts` returns `min(planner_emit, operator_ceiling)`. Docstring rewrites from "operator override" to "operator ceiling — planner emit refines downward." ADR decision at this step: ADR 0032 amendment block (default — clarifies stated intent) OR new ADR 0033 (only if paradigm shifts). 5+ new tests covering ceiling / refine-down / unset / read-only-agent / edge-case-zero. Closes U033.
- [x] 13.4 — Fix U034: post-`waitPidGone()` belt-and-suspenders in `packages/cli/src/commands/daemon.ts`. New `reapStalePidFile(expectedPid, path?)` export in `packages/daemon/src/pidfile.ts` (kept inside daemon package — pidfile module is the right home; no plumbing through state needed). Predicate: still-present pidfile AND same-PID-as-killed. 4 new unit tests in `pidfile.test.ts` covering match / absent / race-restart / malformed (cross-platform via mkdtempSync — no subprocess plumbing required; the unit tests prove the logic, CLI wiring is one line). Closes U034.
- [x] 13.5 — Per-project budget defaults extension. `@factory5/core` project metadata schema widens `metadata.budgetDefaults` from `{maxUsd?, maxSteps?}` to cover all axes from `BUDGET_DEFAULTS` — implemented by swapping `projectBudgetDefaultsSchema` to be `budgetsSchema` (single source of truth per ADR 0032 §3). New `resolveDirectivePayloadBudgets(opts)` helper in `packages/wiki/src/project-metadata.ts` merges per-axis (body wins, then project metadata, returns undefined when both empty). Daemon POST `/builds` body-resolution path (`packages/daemon/src/server.ts:912`) calls the new helper to land merged budgets on `directive.payload.budgets`. 12 new wiki tests covering all-six-axes parse, malformed rejection, 0-as-unlimited acceptance for maxUsd/maxSteps + 7 resolver tests; 2 new daemon integration tests covering project-metadata flowing through + body overrides per-axis. Updated CLI budget test for the new 0-as-unlimited semantic (`maxUsd: 0` no longer rejected by the widened schema).
- [ ] 13.6 — Per-task USD cap (`maxUsdPerTask`). New seventh axis in `BUDGET_DEFAULTS`. Pre-launch check in `packages/brain/src/pool.ts` (Option A: planner emits `estimatedUsd` per task; brain compares against cap before launching; on over → typed `[BUDGET]` askUser). Schema additions to planner output. Auto-answer recognition refactors from `maxTurns*`-coupled to axis-agnostic. CLI `--max-usd-per-task` flag on `factory build` + `factory resume`; seventh Web accordion field. 5+ new brain tests covering planner estimate + escalation + bump path.
- [ ] 13.7 — `/phase-close` — verify done-criteria; run live browser smoke (Playwright MCP, `smoke-demo` project, $1.50 spend cap, expect operator-set `maxTurnsScaffolder=10` to floor the planner-emit to 10 → `[BUDGET]` askUser → accept → retry → success); tag `phase-13-budget-followups-closed`; append final session entry to `UPGRADE/LOG.md`; transition STATE.

## Step detail

### 13.3 — implementation shape

```ts
export function resolveTaskMaxTurns(task: Task, directive: Directive): number | undefined {
  const axis = axisForAgent(task.agent);
  if (axis === undefined) return undefined;
  const fromPayload = budgetsFromDirective(directive)[axis];
  const operatorCeiling = fromPayload ?? BUDGET_DEFAULTS[axis].value;
  if (task.maxTurns !== undefined) {
    return Math.min(task.maxTurns, operatorCeiling);
  }
  return operatorCeiling;
}
```

Edge-case decision (pin at impl time): how `task.maxTurns === 0` and `operator_ceiling === 0` interact. Two readings: (a) `0 = unlimited` (operator's "no ceiling" sentinel), or (b) `0 = zero turns allowed`. Today the codebase doesn't use `0` for `maxTurns` anywhere, so the decision is free. Default: treat `0` from operator as "no ceiling" (unlimited), fall through to planner emit; treat `0` from planner as a literal zero. Document the asymmetry in the docstring.

### 13.4 — implementation shape

```ts
const gone = await waitPidGone();
if (!gone) {
  stdout.write(`factoryd: did not exit within 10s — consider \`kill -9 ${String(info.pid)}\`\n`);
  exit(2);
}
const stillPresent = readPidFile();
if (stillPresent !== undefined && stillPresent.pid === info.pid) {
  await unlinkPidFile();
}
stdout.write(`factoryd stopped (pid ${String(info.pid)})\n`);
```

The same-PID predicate handles the race where a new daemon spawns between `waitPidGone()` returning true and our cleanup attempt. On Unix the unlink is a no-op (daemon shutdown handler already released). On Windows it does the cleanup the hard-kill prevented.

### 13.5 — schema widening shape

`@factory5/core` project metadata (currently):

```ts
budgetDefaults: z.object({ maxUsd: z.number().optional(), maxSteps: z.number().optional() }).optional()
```

becomes:

```ts
budgetDefaults: budgetsSchema.optional()  // reuse the 12.3 Zod schema
```

Daemon `apiV1CreateBuildRequestSchema` body-resolution (ADR 0027 §4) merges the resolved project metadata into the resolved `payload.budgets` per-axis using the existing tiered merge helper. No new IPC schema; the body and resolution already accept all axes from Phase 12.

### 13.6 — planner schema addition (Option A)

`planTaskSchema` in `@factory5/core` (or wherever the planner output schema lives) gains:

```ts
estimatedUsd: z.number().optional()
```

Planner prompt at `packages/brain/src/planner.ts:247-249` extends to instruct the model to estimate per-task USD when `directive.payload.budgets.maxUsdPerTask > 0`. The prompt's existing "if no override, no estimate needed" branch keeps backward compat.

Pool's `executeTask` adds the pre-launch check:

```ts
if (task.estimatedUsd !== undefined && operatorCap > 0 && task.estimatedUsd > operatorCap) {
  // raise [BUDGET] askUser; on accept-bump, set task.estimatedUsd to the new cap and launch
}
```

Auto-answer recognition generalises from `maxTurns*`-coupled to axis-agnostic — the `[BUDGET]` marker's payload already carries `axis` so the dispatcher just routes on that field.

### 13.7 — smoke shape

Same shape as Phase 12's deferred smoke, retargeted:

- Start factoryd (PID/dist current); capture UI token.
- Open `/app/build`; pick `smoke-demo`.
- Expand "Advanced budgets"; set `Max turns — scaffolder` to `10`.
- Submit; watch directive-detail activity panel.
- Expect: brain narrates triage → architect → planner → pool task start → `pool: task "..." tripped error_max_turns at 10 — escalating via askUser (ADR 0032 §4)` → question surfaces in `/app/questions`.
- Operator answers `accept` (or auto-answer fires after deadline).
- Brain logs `retrying with maxTurnsScaffolder=80 (was 10)`; task re-runs.
- Spend total under $1.50.

Post-smoke: `factory daemon stop` and inspect the pidfile — confirm absent (U034 fix). Bundle that observation into the smoke writeup.
