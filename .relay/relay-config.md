# Relay Config

*Created: 2026-05-24 by /relay-setup. Update manually as the project evolves.*

> Project-specific settings used by the relay workflow at runtime.
> Read by: /relay-review (edge cases), /relay-verify (test commands),
> /relay-notebook (notebook setup).

---

## Edge Cases

*Used by: /relay-review step 2 — apply every scenario below to the plan*

### Optional Services / Feature Flags

- **`autoIncreaseBudgets` (Tier 15)** — per-project flag on `project.json`. When true, brain auto-bumps pool caps on exhaustion until `default × ceilingMultiplier`. When false, pool exhaustion parks the directive. Code paths: `packages/brain/src/pool.ts::parkOrAutoIncrease`.
- **Sandbox (ADR 0028)** — when present, switches `permissionMode` from `bypassPermissions` to `acceptEdits`. Code path: `packages/worker/src/run-worker.ts:~581`.
- **MCP config** — optional `mcpConfigPath` passed to claude-cli when set.
- **Discord / Telegram channels** — daemon registers both; either can be `not_configured` if env vars absent. Don't break startup.

### Config Boundaries

- **`<dataDir>/config.json`** — daemon-wide config (Tier 8 + Tier 14). Keys: `askUserDeadlineMs`, `[agents.architect/critic]` category overrides, `[categories.*]` model bindings. Schema: `factoryConfigFileSchema` in `@factory5/core`.
- **`<project>/.factory/project.json`** — per-project metadata + budget defaults. Schema: `projectMetadataSchema` in `@factory5/core` (validates via Zod on write since Tier 15.4; read path uses hand-rolled `validateMetadataOrReason` in wiki for legacy compat).
- **`directive.payload.budgets`** — per-build override snapshot. Per Tier 15 / ADR 0034: acts as a floor in `max(project.json, payload.budgets, BUDGET_DEFAULTS)` pool cap resolution.
- **`<dataDir>/factory.db`** — single SQLite DB, multi-tenant across projects. Tables: directives, tasks_inflight, plans (NONE — plan lives at `<project>/.factory/plan.json`), model_usage, findings_registry, pending_questions, sessions, directive_log_lines, projects, learnings, outbound_messages, events_audit, migrations.

### Concurrency

- **Pool concurrency = 4** by default. Tasks dispatched concurrently up to the cap. Code path: `packages/brain/src/pool.ts::runPlanPool`.
- **Pool watchdog (Tier 15)** — `onTurnComplete` callback fires per worker turn; brain re-checks pool, returns `{ interrupt: true }` if exhausted.
- **`tasks_inflight` is the per-task lifecycle row** — `register` is plain INSERT (Tier 15.7 added `deleteById` for auto-bump recursion to avoid UNIQUE conflicts).
- **`pool-resume` chokidar watcher** — debounced 250ms; flips parked directives to `running` when `project.json` cap raised.
- **Serve loop poll = 250ms** — pool cap is re-resolved live on every tick.

### LLM / External API Failures

- **`error_max_turns`** — claude-cli returns when `--max-turns` exceeded. CURRENT BUG: worker still passes per-task maxTurns despite Tier 15.7's pool-model rewrite (planner emits, materializer preserves, worker threads). Crash precedes pool watchdog. See `.relay/issues/` for the open issue.
- **`error_during_execution`** — generic claude-cli session error. Worker reports as `errorSubtype`.
- **Stream timeout / hung subprocess** — heartbeat lifecycle owned by pool dispatcher; `HEARTBEAT_INTERVAL_MS` updates `tasks_inflight.last_heartbeat`.
- **JSON parse failure** — planner/architect/critic emit JSON; if response lacks JSON, error is `planner: no JSON in response` etc. (We hit this when the cwd leak made the planner emit Control-framework narration.)
- **askUser deadline elapsed** — auto-answer LLM dispatcher claims (Tier 8 / ADR 0030); brain raced the dispatcher pre-Tier-15 #6 fix; askUser now respects in-flight sentinel with 30s grace.
- **Provider rate limit / API key missing** — caller-side exception; surfaces as task `error` field.

### Data Boundaries

- **directives + tasks_inflight + model_usage** — three core lifecycle tables. `directives.blocked_reason` is JSON-or-string union (Tier 15.9 added structured `kind: 'pool-exhausted'`).
- **findings_registry** — append-only, projectId-scoped. Backfilled via migration 006.
- **`project.json`** — file-system source of truth for project identity + budget defaults + autoIncreaseBudgets/autoIncreaseCeilingMultiplier. Live re-resolved per pool tick.
- **plan.json** — per-project, per-directive plan. Holds task definitions including `maxTurns` (CURRENT BUG: should not be persisted post-Tier-15).

---

## Test Commands

*Used by: /relay-verify step 4 — select commands based on what was changed*

### When to use each

- **All workspace tests**: `pnpm test` from repo root. ~1450 tests across 15 packages. Slow (~30s).
- **Single package**: `pnpm --filter @factory5/<name> test`. E.g., `pnpm --filter @factory5/brain test`.
- **Single test file**: `pnpm --filter @factory5/brain test pool` (matches `pool.test.ts`, `pool-usage.test.ts`, `pool-resume.test.ts`).
- **Build (type check + bundle)**: `pnpm build` from repo root.
- **Lint**: `pnpm lint` from repo root.
- **Format check**: `pnpm format:check`. Accepted pre-existing warnings in `.agents/skills/` and `docs/superpowers/`.
- **All 4 gates** (the project's standard pre-commit check): `pnpm build && pnpm test && pnpm lint && pnpm format:check`.

### Module-specific

- **Brain LLM agents**: `pnpm --filter @factory5/brain test "triage|architect|critic|planner|auto-answer"`
- **Pool model**: `pnpm --filter @factory5/brain test "pool"`
- **Daemon HTTP**: `pnpm --filter @factory5/daemon test server`
- **State migrations**: `pnpm --filter @factory5/state test migrations`
- **Web cockpit smoke**: `pnpm --filter factory-web build` (compile-only — Astro lacks unit-test infra)

### Live browser smoke (Playwright MCP)

Restart daemon first: `pnpm factory daemon restart`. Smoke gates per `docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md` §6.

---

## Notebook Setup

*Used by: /relay-notebook — use these patterns verbatim when creating notebooks*

Skipped — factory5 is a Node/TypeScript project, no Python notebook infrastructure. Verification happens via Vitest + Playwright MCP live smoke.

---

## Scoping Paths

*Used by: /relay-discover — scope patterns for this project*

- Full scan: `/relay-discover`
- **Brain**: `/relay-discover Focus on packages/brain/src/ — agent dispatchers, pool model, askUser, auto-answer`
- **Daemon HTTP/SSE**: `/relay-discover Focus on packages/daemon/src/ + packages/ipc/src/`
- **Worker subprocess**: `/relay-discover Focus on packages/worker/src/ + packages/providers/src/`
- **Wiki / project metadata**: `/relay-discover Focus on packages/wiki/src/`
- **State DB**: `/relay-discover Focus on packages/state/src/ — migrations, queries`
- **Web UI**: `/relay-discover Focus on apps/factory-web/src/`
- **Channels (Discord / Telegram)**: `/relay-discover Focus on packages/channels/src/`
- **Cross-cutting consistency**: `/relay-discover Focus on inconsistencies across tier boundaries — competing models, half-finished migrations, shadowed configs, dual sources of truth`

The last one is what we're running first today.
