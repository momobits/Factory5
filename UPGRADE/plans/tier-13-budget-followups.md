# Tier 13 — Budget followups: propagation fix + per-project defaults + per-task USD cap

**Status:** scaffolded, not started
**Estimated duration:** 2-3 sessions
**Issues addressed:** U033 (operator-set `maxTurns*` silently shadowed by planner-emit; live `[BUDGET]` askUser never fires from the Build form), U034 (Windows `factory daemon stop` leaves a stale pidfile)

## Goal

Close the operator-felt loop that Phase 12 structurally built but couldn't demonstrate end-to-end. Phase 12's plumbing — the BUDGET_DEFAULTS source-of-truth, the `payload.budgets` persistence, the typed `[BUDGET]` askUser escalation, the auto-answer bump-then-abort policy — all passes its 1292-test gate but the documented promise ("set a low maxTurns in the UI → see the brain ask before failing → accept → watch the retry") doesn't fire from a fresh build because the propagation step `directive.payload.budgets[axis] → effective worker maxTurns` is wrong. Phase 13 fixes that, polishes the Windows pidfile sloppy-shutdown, extends per-project defaults to cover the new axes, and ships the per-task USD cap that Phase 12 carry-forwarded.

## Outcome

- **Operator-set `maxTurnsScaffolder|Builder|Fixer` propagates as a ceiling on the planner emit.** `resolveTaskMaxTurns` returns `min(planner_emit, directive_budget)` when both are defined; falls through to `directive_budget` if the planner emitted nothing; falls through to `BUDGET_DEFAULTS[axis].value` otherwise. The docstring (currently labelled "operator override") rewrites to "operator ceiling — planner emit refines downward." This is the U033 fix; the smoke promise from Phase 12 now materialises from the UI surface.
- **`factory daemon stop` on Windows leaves a clean pidfile.** Post-`waitPidGone`, the CLI explicitly unlinks the pidfile if it still exists AND still contains the same PID it just killed. Belt-and-suspenders shape — doesn't change the daemon contract, doesn't break Unix behaviour, handles both the Windows `TerminateProcess` hard-kill case and any future scenario where a daemon dies before releasing its pidfile. This is the U034 fix.
- **Per-project budget defaults extend to all six axes.** Today `<project>/.factory/project.json` `metadata.budgetDefaults` carries `maxUsd` + `maxSteps`. Phase 13 extends to cover `askUserDeadlineMs`, `maxTurnsScaffolder`, `maxTurnsBuilder`, `maxTurnsFixer`. Resolution chain stays the same (instance config → project metadata → body flags), the schema just widens. Operators on a chronically-large project can pin `maxTurnsScaffolder: 160` per-project instead of re-typing it on every build.
- **Per-task USD cap (`maxUsdPerTask`).** New seventh axis in `BUDGET_DEFAULTS`. Today only the directive-level `maxUsd` exists; per-task ceiling lets the planner say "this scaffolder shouldn't cost more than $1 — if it would, escalate." Same shape as `maxTurns` escalation: typed `[BUDGET]` askUser; auto-answer bump-then-abort; CLI flag + Web accordion field.
- **ADR 0033 (or ADR-amend 0032) clarifies the operator-as-ceiling semantic.** Decision deferred to 13.3 when the U033 fix lands; if the fix is purely a docstring + impl correction matching ADR 0032's stated intent, an amendment block on ADR 0032 suffices. If the semantics shift meaningfully (e.g. candidate (3) "operator wins absolutely"), supersede with ADR 0033 per CLAUDE.md's "do not edit accepted ADRs."

## Where we were, end of Phase 12

Phase 12 closed `phase-12-budget-ux-closed` at `8231f87` (annotated tag) with 9 of 11 done-criteria green automatically; the deferred live browser smoke failed in a same-day follow-on session — the Build form persisted `payload.budgets.maxTurnsScaffolder=10` correctly daemon-side, but the scaffolder ran 40 turns (planner-emitted) and completed `exitCode=0` with no `[BUDGET]` askUser surfaced. Investigation traced to `resolveTaskMaxTurns` preferring `task.maxTurns` (planner-emit, always set per the planner prompt's 10-160 range) over `directive.payload.budgets[axis]` (operator). Phase 12.6's escalation plumbing is intact — 36 brain + 3 daemon tests pass — but only fires when the planner itself emits a too-low cap, which never happens because the planner has no awareness of operator overrides.

Operational discovery same-day: the running daemon at session-start (PID 45508) was started before Phase 12's first commit landed; the daemon was running pre-Phase-12 dist and silently dropped `body.budgets`. Restarted to PID 51784 (Phase 12 dist). Then operator stopped via `factory daemon stop` at session-end; Windows hard-killed via `TerminateProcess` and left the pidfile on disk. Filed as U034 (low; not load-bearing because next-start auto-reaps stale pidfiles).

## Why this phase exists

The Phase 12 close commit message said the deferred browser smoke gate was "operator-driven verification — structural pieces are complete and unit-tested end-to-end, but the live-spend acceptance gate is left for a fresh session." The fresh-session smoke surfaced U033 the next day. Phase 13 IS that smoke-close — it ships the propagation fix that makes the operator-felt loop actually work, plus the Windows pidfile polish that's natural to bundle, plus the two cheapest Phase 12 carry-forwards (per-project default overrides; per-task USD cap).

Deferred from Phase 13 to a future tier:

- **Mid-task budget escalation** — proactive warning before the worker trips. Bigger surface (worker-side detection of approaching-cap; signal back to brain; new askUser shape). Defer until post-failure escalation proves out in real use.
- **Budget audit dashboard** — multi-build telemetry view of "you've burned $X across the last N directives; here's where it went." Needs the telemetry foundation first.

## U033 root-cause walk

`packages/brain/src/budget-escalation.ts:105-112`:

```ts
export function resolveTaskMaxTurns(task: Task, directive: Directive): number | undefined {
  if (task.maxTurns !== undefined) return task.maxTurns;          // ← BUG: planner emit always wins
  const axis = axisForAgent(task.agent);
  if (axis === undefined) return undefined;
  const fromPayload = budgetsFromDirective(directive)[axis];
  if (fromPayload !== undefined) return fromPayload;
  return BUDGET_DEFAULTS[axis].value;
}
```

The planner prompt at `packages/brain/src/planner.ts:247-249` instructs the model to emit `maxTurns` between 10 and 160 on every tool-using task. The prompt has no mention of `directive.payload.budgets` so the planner can't honor an operator override even in principle — it always emits its own per-task value. Result: `task.maxTurns` is always defined for tool-using tasks; the function returns line 106 every time; lines 109-111 are unreachable in the operator-set path. The smoke evidence: a build with `maxTurnsScaffolder=10` on the Build form persisted `payload.budgets.maxTurnsScaffolder=10` daemon-side, the planner emitted `maxTurns: 40` for the scaffolder task, and the worker ran 40 turns. No `[BUDGET]` askUser surfaced because the worker never approached the operator's 10-turn ceiling — the operator's value was simply ignored.

Three resolution candidates surfaced in U033's filing:

1. **`resolveTaskMaxTurns` returns `min(planner_emit, directive_budget)`** when both are defined. Operator can FLOOR the cap (lower it from planner's number) without raising it. Simplest fix; matches the "budget is a ceiling, planner refines" mental model. Update the docstring + ADR 0032 §6's "operator override" label (which is misleading post-smoke).
2. **Planner prompt is fed `directive.payload.budgets`** and instructed to honor it. More LLM-trust, requires a regression test for prompt-honoring; doesn't help if the planner ignores the instruction. Combine with #1 as a belt-and-suspenders.
3. **Operator's directive-budget always wins** (planner emit becomes the fallback, not the override). Strictest; loses the planner's per-task tailoring when an operator sets ANY axis. Probably wrong default — operators routinely set ONE axis (e.g. `maxTurnsScaffolder`) and shouldn't lose the planner's per-task numbers on the OTHER axes.

**Recommended:** candidate (1) as the implementation; candidate (2) deferred to a future tier as belt-and-suspenders. The decision lands at 13.3 in the same commit as the fix.

## U034 root-cause walk

`packages/cli/src/commands/daemon.ts:141-164`:

```ts
async function stopDaemon(): Promise<void> {
  const info = readPidFile();
  if (info === undefined) {
    stdout.write('factoryd: no pidfile — daemon not running\n');
    return;
  }
  if (info.alive !== true) {
    stdout.write(`factoryd: stale pidfile for pid ${String(info.pid)} — cleaning up\n`);
    return;
  }
  log.info({ pid: info.pid }, 'sending SIGTERM to factoryd');
  try {
    process.kill(info.pid, 'SIGTERM');                           // ← Windows: TerminateProcess
  } catch (err) {
    stdout.write(`factoryd: kill failed: ${(err as Error).message}\n`);
    exit(1);
  }
  const gone = await waitPidGone();
  if (!gone) {
    stdout.write(`factoryd: did not exit within 10s — consider \`kill -9 ${String(info.pid)}\`\n`);
    exit(2);
  }
  stdout.write(`factoryd stopped (pid ${String(info.pid)})\n`);  // ← but pidfile remains
}
```

Node docs: `SIGTERM` is not supported on Windows. `process.kill(pid, 'SIGTERM')` falls through to `TerminateProcess`, which is a hard-kill — the factoryd shutdown handler at `apps/factoryd/src/main.ts:156-170` (which calls `stopDaemon(handle)` → `handle.stop()` → `pidFile?.release()` at `packages/daemon/src/index.ts:500`) never runs. The pidfile stays on disk with the dead PID's contents. Subsequent `factory daemon start` reaps the stale pidfile correctly via `processAlive(pid)`, so the bug is not load-bearing — cosmetic + small confusion vector for operators who inspect the pidfile post-stop.

Two fixable layers:

1. **CLI-side belt-and-suspenders.** After `waitPidGone()` returns true, the CLI explicitly unlinks the pidfile if it still exists AND still contains the same PID it just killed. Cheap; doesn't change the daemon's contract; handles the Windows hard-kill case AND any future scenario where a daemon dies before releasing its pidfile.
2. **Daemon-side `POST /shutdown` IPC route.** The CLI hits a localhost-bound `/shutdown` endpoint (bearer-gated) which schedules a graceful stop in the daemon's event loop, then waits for pidfile-gone. Gives the daemon's shutdown handler a real chance to run on Windows; works identically on Unix. More code; deeper testability; opens the door to richer shutdown lifecycle hooks (e.g., draining in-flight directives before exit). Probably the right long-term shape; ADR-amend candidate if it ships.

**Recommended:** candidate (1) for Tier 13 — keeps the scope tight, fixes the observed bug, leaves option (2) as a future-tier candidate when shutdown lifecycle hooks become needed.

## What this tier ships

### 13.1 — Open U033

Recordkeeping flip. U033 already opened in `UPGRADE/ISSUES.md` Open section during Phase 12 smoke session; flip the Tier 13 ROADMAP row from `[ ] U033` → `[~] U033 open` in the same commit per the CLAUDE.md invariant ("tick the matching item in UPGRADE/ROADMAP.md in the same commit"). Bump U033's tier indicator from "Tier 13 (carry-forward from 12)" to "Tier 13" in ISSUES.md.

### 13.2 — Open U034

Same shape as 13.1. U034 already opened during the second session-end of Phase 12 close arc. Flip ROADMAP row + bump tier indicator in ISSUES.md.

### 13.3 — Fix U033: budget-as-ceiling propagation

Implementation in `packages/brain/src/budget-escalation.ts`:

```ts
export function resolveTaskMaxTurns(task: Task, directive: Directive): number | undefined {
  const axis = axisForAgent(task.agent);
  if (axis === undefined) return undefined;
  const fromPayload = budgetsFromDirective(directive)[axis];
  const fromDefault = BUDGET_DEFAULTS[axis].value;
  const operatorCeiling = fromPayload ?? fromDefault;
  if (task.maxTurns !== undefined) {
    return Math.min(task.maxTurns, operatorCeiling);
  }
  return operatorCeiling;
}
```

Docstring rewrites from "operator override" to "operator ceiling — planner emit refines downward." Tests in `budget-escalation.test.ts`:

- Operator sets `maxTurnsScaffolder=10`, planner emits `maxTurns=40` → resolved is `10`.
- Operator sets `maxTurnsScaffolder=100`, planner emits `maxTurns=40` → resolved is `40` (planner refined down).
- Operator unset, planner emits `maxTurns=40` → resolved is `40` (legacy path, unchanged).
- Operator unset, planner unset → resolved is `BUDGET_DEFAULTS[axis].value` (legacy default path, unchanged).
- Read-only agent (`investigator`, no axis) → resolved is `undefined`.
- Operator sets `maxTurnsScaffolder=0` (edge case: 0 = unlimited?) → decision pinned at impl time; default behaviour: treat 0 as "no ceiling, fall through to planner emit."

ADR decision: if the fix is purely a docstring + impl correction matching ADR 0032 §6's stated intent (the docstring labels this resolveTaskMaxTurns layer as "operator override"; the intent reading is that operator's payload.budgets caps the planner's emit), an ADR-amend block appended to `docs/decisions/0032-budget-ux-paradigm.md` suffices. If the semantics shift meaningfully (e.g., choosing candidate (3)), supersede with ADR 0033 per CLAUDE.md's "do not edit accepted ADRs." Default: ADR-amend on 0032 with a dated `## Amendment 2026-05-XX` block clarifying the ceiling semantic. (CLAUDE.md says "Edit existing files in preference to creating new ones. Especially documentation — never make a new ADR when the existing one should be amended" — for clarification-of-intent changes the amendment is the right tool; "and once an ADR is _accepted_, supersede rather than amend" applies to substantive decision changes.)

### 13.4 — Fix U034: Windows pidfile cleanup

Implementation in `packages/cli/src/commands/daemon.ts:158`-onward (post-`waitPidGone`):

```ts
const gone = await waitPidGone();
if (!gone) {
  stdout.write(`factoryd: did not exit within 10s — consider \`kill -9 ${String(info.pid)}\`\n`);
  exit(2);
}
// Belt-and-suspenders: Windows SIGTERM is mapped to TerminateProcess, so
// the daemon's shutdown handler never gets to release the pidfile. Unlink
// it if it still exists AND still contains the killed PID. Unix daemons
// will normally have already released it; the predicate ensures we don't
// race a fast-restart.
const stillPresent = readPidFile();
if (stillPresent !== undefined && stillPresent.pid === info.pid) {
  await unlinkPidFile();
}
stdout.write(`factoryd stopped (pid ${String(info.pid)})\n`);
```

New `unlinkPidFile()` export in `packages/daemon/src/pidfile.ts` (or wire through `packages/state` if the daemon package shouldn't grow new exports). Tests:

- Stop a daemon, verify pidfile gone post-`stopDaemon()`.
- Stop a daemon where the daemon DID release the pidfile (Unix happy path): `unlinkPidFile()` is a no-op because `readPidFile()` returns undefined.
- Stop a daemon, immediately spawn a new one before the cleanup runs (race): the new pidfile's PID doesn't match the killed PID; cleanup skips. Existing `factory daemon start` test suite covers a similar race; reuse the fixture.

CLI integration test: spawn a real `factoryd` subprocess, call `stopDaemon` programmatically, assert pidfile absent after. Cross-platform — should pass on both Windows and Linux. Probably needs a small platform skip or conditional for the Windows-specific aspect.

### 13.5 — Per-project budget defaults extension

Today `<project>/.factory/project.json` `metadata.budgetDefaults` (from Tier 8) carries `maxUsd` + `maxSteps`. Extend to:

```jsonc
{
  "metadata": {
    "budgetDefaults": {
      "maxUsd": 5,
      "maxSteps": 200,
      "askUserDeadlineMs": 600000,
      "maxTurnsScaffolder": 160,
      "maxTurnsBuilder": 80,
      "maxTurnsFixer": 80
    }
  }
}
```

Schema additions in `@factory5/core` (the project metadata schema, NOT `BUDGET_DEFAULTS` itself — that's the canonical defaults source). Daemon's POST `/builds` body-resolution path (ADR 0027 §4's three-tier: instance config → project metadata → body flags) extends to merge the new keys per-axis. CLI `factory build` already reads project metadata; nothing to change there beyond schema acceptance. Web Build form's project picker preview (if any) updates to show the merged defaults.

Tests:

- Project metadata with `maxTurnsScaffolder: 160`, body unset → directive payload has `maxTurnsScaffolder: 160`.
- Project metadata with `maxTurnsScaffolder: 160`, body sets `--max-turns-scaffolder 80` → body wins; payload is `80`.
- Empty project metadata + body unset → BUDGET_DEFAULTS apply (existing behaviour, regression check).

### 13.6 — Per-task USD cap (`maxUsdPerTask`)

New seventh axis in `BUDGET_DEFAULTS`:

```ts
maxUsdPerTask: {
  value: 0,
  explainer:
    'Per-task USD ceiling. 0 = unlimited (default). When the planner estimates a single task above this cap, the brain escalates via askUser before launching.',
},
```

Decision point at 13.6 implementation: WHERE does the per-task USD check happen?

- **Option A — Pre-launch check, planner-side estimate.** Planner emits an `estimatedUsd` per task; pool's `executeTask` compares against `maxUsdPerTask` before launching; on over: typed `[BUDGET]` askUser ("Task X estimated $1.20, cap is $1; bump to $2?"). Lower fidelity (planner-estimate accuracy unclear) but cheap.
- **Option B — Mid-task tripping, runtime check.** Worker reports spend per turn; pool watches a running USD counter; on cap-trip: typed `[BUDGET]` askUser. Higher fidelity but bigger surface (runtime polling, mid-task abort handling).

**Recommended:** Option A for first ship — same shape as `maxTurns` escalation, escalation happens pre-launch, no runtime-watcher complexity. Mid-task escalation is the Phase 12 carry-forward already deferred to a future tier — this groups naturally with it.

Schema additions to `@factory5/core/budgets`. Brain `pool.ts` extends to call the per-task USD check before launching each task. Auto-answer dispatcher's `[BUDGET]` recognition path generalises across axes (today coupled to `maxTurns*`; refactor to be axis-agnostic).

CLI flag: `--max-usd-per-task <n>` on `factory build` + `factory resume`. Web accordion gets a seventh field.

Tests:

- Planner emits task with `estimatedUsd: 1.20`, `maxUsdPerTask: 1.00` → escalation askUser fires pre-launch.
- Same shape but `estimatedUsd: 0.50` → no escalation; task launches normally.
- Operator accepts bump → task launches with new cap; verify the cap is enforced.
- Auto-answer bump-then-abort policy fires on `maxUsdPerTask` same as on `maxTurns*`.

### 13.7 — Phase close

Standard gates + a live browser smoke that closes the Phase 12 deferred gate. Build on `smoke-demo` with `maxTurnsScaffolder=10` in the Web UI's Advanced budgets accordion; expect: scaffolder hits cap → `[BUDGET]` askUser fires → operator accepts → scaffolder retries with bumped cap → task completes. Spend cap $1.50 to bound live model spend. The same smoke also exercises U034's fix on the daemon-stop teardown.

## Done criteria

- [ ] All four `pnpm` gates green (build / test / lint / format:check)
- [ ] ADR 0032 amendment (or new ADR 0033) lands; INDEX.md + ARCHITECTURE.md ADR count bumped if a new ADR
- [ ] `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)`; docstring updated; 5+ new tests covering ceiling / refine-down / unset / read-only-agent / edge-case-zero
- [ ] `factory daemon stop` on Windows leaves no stale pidfile; cross-platform CLI integration test
- [ ] `<project>/.factory/project.json` `metadata.budgetDefaults` accepts all six (eventually seven) axes; three-tier resolution preserved
- [ ] `BUDGET_DEFAULTS` gains `maxUsdPerTask`; pool pre-launch check; CLI flag + Web accordion field
- [ ] Auto-answer's `[BUDGET]` recognition generalises across axes
- [ ] Browser smoke (Playwright MCP): operator sets `maxTurnsScaffolder=10` in UI → `[BUDGET]` askUser fires → accept → retry → success
- [ ] U033 closes
- [ ] U034 closes

## Rollback

`git reset --hard phase-12-budget-ux-closed`. No DB schema changes; no migrations to unwind. ADR 0032 amendment (if used) is reversible by git revert; a new ADR 0033 (if supersedes) goes via the standard "supersede-with-a-follow-up" pattern.

## Carry-forward (Tier 14+ candidates)

- **Mid-task budget escalation.** Today `error_max_turns` is caught post-stream. Mid-stream budget warnings ("approaching cap, want me to extend?") would let the operator decide proactively. Bigger surface (worker-side detection of approaching-cap; signal back to brain; new askUser shape). Defer until post-failure escalation proves out.
- **Budget audit dashboard.** Multi-build telemetry view of "you've burned $X across the last N directives; here's where it went." Needs the telemetry foundation first.
- **Daemon-side `POST /shutdown` IPC route** (U034 candidate (2)). Richer shutdown lifecycle hooks (draining in-flight directives before exit). ADR-amend candidate when shutdown lifecycle hooks become needed.
- **Planner prompt honors operator budgets** (U033 candidate (2)). Belt-and-suspenders for the `min()` fix. Defer; ship if a planner that emits maxTurns above the operator ceiling shows up in real use (the `min()` clamps it anyway, so this is purely an optimisation).
- **Per-project deadline override** (long-standing carry-forward from Phase 8). Bundled into 13.5 if the metadata extension shape is right; otherwise stays parked.

## Suggested commit shape

- `chore(phase-13): scaffold tier 13 budget followups`
- `chore(13.1): open U033`
- `chore(13.2): open U034`
- `feat(13.3): operator budget as ceiling on planner emit (closes U033)`
- `feat(13.4): Windows pidfile cleanup on daemon stop (closes U034)`
- `feat(13.5): per-project budget defaults extend to all axes`
- `feat(13.6): per-task USD cap axis + pre-launch escalation`
- `chore(phase-13): close phase 13`

## Risks and decisions

- **ADR amendment vs new ADR for U033** — recommended path is amendment if the fix matches ADR 0032's stated intent (operator-as-ceiling). If the smoke surfaces a different shape (e.g. operator needs to be allowed to RAISE the cap too, not just floor it), it becomes a paradigm change and warrants ADR 0033. Decide at 13.3 implementation time.
- **Per-task USD cap requires planner cost estimate** — Option A's pre-launch check depends on `task.estimatedUsd` from the planner, which doesn't exist today. Two sub-options: (a) extend planner schema + prompt to emit per-task estimates; (b) heuristic estimate ("scaffolder = $X based on prior project, builder = $Y") computed brain-side. Decide at 13.6; default to (a) if planner schema bump is cheap, (b) if not.
- **U034 fix breaks existing tests** — the CLI's `stopDaemon` is covered by tests that may assert pidfile state mid-call. Audit before changing; adjust assertions to match the new post-stop invariant ("pidfile absent" replaces "pidfile content is dead PID").
- **Live smoke ordering** — run smoke AFTER 13.4 + 13.5 + 13.6 land so it can exercise the full surface (Web UI ceiling propagation + Windows shutdown cleanup + per-task USD path). The smoke is the operator-felt gate for U033 closure.

## Done criteria evidence collection

When closing the phase, the close commit body summarises evidence per criterion:

- pnpm gates: paste the 4-gate output.
- Tests: paste workspace + per-package counts before and after.
- ADR: cite the commit that lands the amendment / new ADR.
- U033 / U034 fixes: cite the test names + commits.
- Smoke: cite the smoke session id + spend total.
