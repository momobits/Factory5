# Phase 12 Steps

- [x] 12.1 — Open U032 in `UPGRADE/ISSUES.md` Open section. Severity high; Tier 12; Area cli + web + brain.
- [x] 12.2 — ADR 0032 — Budget UX paradigm. Five-part decision: operator-facing budgets, internal-pacing constants, default-publication contract, escalation rule, persistence contract. Update `docs/decisions/INDEX.md` and `docs/ARCHITECTURE.md` ADR count.
- [x] 12.3 — `BUDGET_DEFAULTS` constant + Zod schema in `@factory5/core/src/budget-defaults.ts`. Six entries: maxUsd, maxSteps, askUserDeadlineMs, maxTurnsScaffolder, maxTurnsBuilder, maxTurnsFixer. Each carries `value` + `explainer`. Single source of truth read by CLI / Web / project-metadata parsers.
- [x] 12.4 — Web UI Build form (`apps/factory-web/src/pages/build.astro`) gains an "Advanced budgets" `<details>` accordion (collapsed by default) with all six fields + defaults + explainers shown as hint text. Submit POSTs the full set to `/api/v1/builds`.
- [ ] 12.5 — CLI flags on `factory build` AND `factory resume`: `--max-usd`, `--max-steps`, `--ask-deadline-ms`, `--max-turns-scaffolder`, `--max-turns-builder`, `--max-turns-fixer`. `--help` post-text quotes explainers verbatim from `BUDGET_DEFAULTS`.
- [ ] 12.6 — Brain escalation in `packages/brain/src/pool.ts`. Detect `error_max_turns` subtype from worker outcome. Raise typed askUser with task title + current cap + suggested bump. On accept-bump or custom-bump: relaunch task with new budget (worker restart, same worktree). On abort: current failed-task behaviour. Tier 8 auto-answer adapter: bump-by-one-bucket on first failure, abort on second.
- [ ] 12.7 — Directive `payload.budgets` field. Tier 10's resume route extended to inherit `prior.payload.budgets` + merge with body overrides. Default body resolution: instance config → project metadata → body flags (existing three-tier per ADR 0027 §4 + Tier 12's `budgets` extension).
- [ ] 12.8 — `/phase-close` — verify done-criteria; tag `phase-12-budget-ux-closed`; append final session entry to `UPGRADE/LOG.md`; transition STATE.

## Step detail

### 12.2 — ADR 0032 shape

Six-section ADR mirroring 0030 / 0031:

- **Context** — three failure modes (silent maxTurns defaults; hard-fail on trip; vocab confusion between `maxSteps` and `maxTurns`).
- **Decision** — five-part (per the plan).
- **Consequences** — every new budget axis added in future MUST publish a default + explainer in `BUDGET_DEFAULTS` and surface via at least the CLI flag set; the brain MUST raise a typed askUser on trip; the auto-answer dispatcher MUST have a typed-prompt path.
- **Alternatives considered** — (a) keep hardcoded defaults but document them; (b) hard-fail with a better error message but no escalation; (c) operator-configurable but no auto-answer integration. All rejected.
- **Open follow-ups** — per-task USD cap (Tier 13+); mid-task warnings; budget audit dashboard.

### 12.6 — escalation prompt shape

```
Task '<title>' (<agent>) ran out of turns (cap: <current>). The worker hit
claude-cli's error_max_turns. Bump the cap and retry, or abort?

Options:
  - accept   — retry with cap = <suggested-next> (default bucket bump)
  - custom <n>  — retry with cap = <n> (10-160)
  - abort    — mark task failed, let the directive continue with whatever
              dependents handle a failed predecessor (typically the
              directive blocks or fails too)
```

The auto-answer dispatcher recognises this shape (typed via a new `budget_escalation` provenance on the askUser) and applies the first-failure-bump / second-failure-abort rule. The default suggested-next: next bucket — for scaffolder 80→120→160, for builder 80→160, for fixer 80→160.

### 12.7 — payload shape

```ts
// In @factory5/core directive schema, payload now has:
budgets?: {
  maxUsd?: number;
  maxSteps?: number;
  askUserDeadlineMs?: number;
  maxTurnsScaffolder?: number;
  maxTurnsBuilder?: number;
  maxTurnsFixer?: number;
};
```

Backward-compat: `payload.budgets` is optional, falls back to `BUDGET_DEFAULTS`. Existing directives without the field keep working.
