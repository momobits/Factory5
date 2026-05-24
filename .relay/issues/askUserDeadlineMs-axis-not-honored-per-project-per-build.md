*Created: 2026-05-24*

# askUserDeadlineMs operator overrides (CLI / Web / Discord / project.json) silently ignored

**Severity:** P1 high — operators can set this axis through four different surfaces; none of them affect actual askUser deadline stamping. Only the daemon-wide `<dataDir>/config.json` matters. ADR 0030 §2 said per-project override was "non-breaking to add later" — Tier 12 added the per-project + per-build surfaces but never threaded them to the consumer.

## Problem statement

`askUserDeadlineMs` is one of the eight ADR 0032 budget axes. Operators can set it via:

- `factory build --ask-user-deadline-ms 600000` (CLI; lands in `directive.payload.budgets.askUserDeadlineMs`)
- Web Build form's Advanced budgets accordion (same destination)
- Web Project page Defaults tab (lands in `<project>/.factory/project.json` `metadata.budgetDefaults.askUserDeadlineMs`)
- Discord `/budget ask-user-deadline-ms` (lands in project.json same key)
- Telegram `/budget --ask-user-deadline-ms` (same)

But the brain's `askUser` deadline stamping path at `packages/brain/src/ask-user.ts:345-346` reads ONLY from the daemon-wide `<dataDir>/config.json`:

```ts
const deadlineAt =
  opts.deadlineAt ?? new Date(now() + resolveDeadlineMs(opts.configDataDir)).toISOString();
```

`resolveDeadlineMs` reads `<dataDir>/config.json.askUserDeadlineMs` via `loadConfig()`. No consumer of `askUser` threads `payload.budgets.askUserDeadlineMs` or project.json's `metadata.budgetDefaults.askUserDeadlineMs` into the call. Grep confirms:

```
$ grep -rn "deadlineAt" packages/brain/src/ask-user.ts
ask-user.ts:103:  deadlineAt?: string;     # the option exists
ask-user.ts:345:  const deadlineAt =       # falls back to config.json only
```

```
$ grep -rn "askUserDeadlineMs" packages/brain/src/
ask-user.ts                  # nothing — config-only path
auto-answer.ts               # nothing
loop.ts                      # nothing
pool.ts                      # nothing
```

The daemon's `/api/v1/ask-user` route (which lets workers go through brain's askUser) also does not extract `directive.payload.budgets.askUserDeadlineMs`:

```
packages/daemon/src/index.ts:631  // Compute deadlineAt. Per-request override wins; falls back to daemon default.
packages/daemon/src/index.ts:633  const deadlineAt = new Date(Date.now() + deadlineSeconds * 1000).toISOString();
```

`deadlineSeconds` here is a daemon-wide CLI option, not from the directive.

## Current state

**Tests verify the surfaces accept the value:**
- `packages/daemon/src/server.test.ts:2074-2090` — POST /api/v1/builds accepts and persists `payload.budgets.askUserDeadlineMs`
- `packages/daemon/src/server.test.ts:2320,2625,3359` — multiple variants
- `packages/cli/src/commands/budget-flags.test.ts:72,103,160,170` — CLI flag parsed correctly
- `packages/channels/src/discord-commands.test.ts` — Discord option accepted
- `packages/wiki/src/project-metadata.test.ts:346` — project.json accepts the key

**Brain consumer ignores them all:**
- `packages/brain/src/ask-user.ts:345` — daemon-config-only deadline resolution

This is exactly the "deferred until a real demand signal arrives" sentence in ADR 0030 §2:

> Per-project override (CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata.askUserDeadlineMs`) is non-breaking to add later — the resolution chain extends to `project → daemon → default` without touching the schema or the dispatcher. Defer the resolution-chain work until a real demand signal arrives.

The signal arrived in Tier 12 (8231f87 — Step 12.7 `directive payload.budgets inheritance + brain consumption`). But only the maxTurns* axes got brain consumers. `askUserDeadlineMs` was added to the persistence schema, accordion form, CLI flag, channel handlers, project.json key, resume-inheritance code — all the way through to the on-disk and on-wire layers — without the brain ever reading it.

## Impact

1. **All four operator surfaces are placebo for this axis.** An operator setting `--ask-user-deadline-ms 60000` (1 minute) for an autonomous nightly batch run still gets the daemon-wide 5-minute default. Their auto-answer fires 5x slower than configured.
2. **Documentation drift.** Tier 12 plan claimed full operator-facing-ness for the six axes. Phase 12.7's "brain consumption" step only consumed the maxTurns axes.
3. **Test coverage is misleading.** Tests verify persistence through every layer — body → payload.budgets, project.json → ProjectBudgetDefaults — without ever asserting the brain reads it. The persistence-only tests give false confidence.
4. **Discord/Telegram `/budget` write to project.json `metadata.budgetDefaults` that is silently inert for this axis.** No error, no warning — operator sees "budget updated" and moves on.

## Proposed fix

Extend the brain's `askUser` deadline-resolution to consult the same three-way max chain as the pool axes (ADR 0034 §1 rule):

```ts
const askUserDeadlineMs = Math.max(
  projectBudgetsFromMeta(projectMeta)?.askUserDeadlineMs ?? 0,
  directive.payload?.budgets?.askUserDeadlineMs ?? 0,
  cachedDaemonConfig.askUserDeadlineMs ?? BUDGET_DEFAULTS.askUserDeadlineMs.value,
);
```

This requires threading either:
- `directive` (or just the resolved `Budgets` partial) into the existing `AskUserOptions`, OR
- `projectPath` into `AskUserOptions` so `ask-user.ts` can call `loadOrCreateProjectMetadata` itself (matches the pool's `loadProjectBudgets` pattern)

The first option is cleaner — caller passes the already-resolved object, no I/O in ask-user. The brain's `loop.ts:271-280` already has `directive` in scope at the askUser construction site.

Caller-supplied `opts.deadlineAt` should keep winning over the resolved value (existing precedent — explicit beats default).

The semantic to verify with the operator (relay-design pass): should `0` on this axis mean "unlimited" (like maxUsd) or "use daemon default" (like the existing absent-axis behavior)? `BUDGET_DEFAULTS.askUserDeadlineMs.value` is 300_000 and the budgetsSchema declares `askUserDeadlineMs: z.number().int().positive()` — meaning 0 is rejected at the schema layer. The intent is clearly "positive deadline, 0 disallowed" (matches the explainer's "instant auto-answer is nonsensical" comment). So the fix is straightforward: max-resolve across three tiers, no zero-sentinel handling needed.

## Affected files

- `packages/brain/src/ask-user.ts` — extend resolveDeadlineMs / threading
- `packages/brain/src/loop.ts:271-280` (and any other askUser construction sites) — thread `directive` or pre-resolved budgets
- `packages/brain/src/serve.ts` — if it constructs askUser directly
- `packages/daemon/src/index.ts:631-633` — daemon's ask-user proxy route (worker MCP path); needs to do its own three-way resolution against the parent directive

Test coverage: add cross-tier integration tests asserting the new max rule end-to-end (CLI flag → directive → askUser deadline), and add per-project tests for `metadata.budgetDefaults.askUserDeadlineMs` flowing through.
