# 0036 — Config-home consolidation: one `config.toml`, retire the daemon-wide `config.json`

- **Status:** Accepted
- **Date:** 2026-05-30
- **Supersedes:** [0030](0030-pending-question-auto-answer.md) §2 (the daemon-wide
  config-home decision only — the rest of ADR 0030 stands)
- **Builds on:** [0004](0004-category-based-model-routing.md) (the per-agent category
  override layer), [0023](0023-repo-local-instance-and-cwd-walk.md) (`config.toml`'s home
  via `dataDir()`), [0035](0035-budget-pool-unification.md) (the unified budget axes,
  including `askUserDeadlineMs`).

## Context

factory5 had **two** config files with **two** `loadConfig` exports of the same name:

- `<dataDir>/config.toml` — the human-edited file (`@factory5/brain`'s `loadConfig`,
  async, TOML). Holds general / providers / categories / fallbackChains / budget /
  channels / daemon.
- `<dataDir>/config.json` — a daemon-wide JSON sidecar (`@factory5/state`'s `loadConfig`,
  sync, JSON) introduced by ADR 0030 §2. Held two keys: `askUserDeadlineMs` and the
  per-agent category overrides (`agents.architect` / `agents.critic`).

Three problems converged:

1. **Name collision.** Both `@factory5/brain` and `@factory5/state` exported a function
   called `loadConfig`. Different signatures, different files, different return types — a
   genuine footgun for anyone wiring config reads.
2. **`askUserDeadlineMs` is already a budget axis.** ADR 0035 made it a first-class axis
   resolved per-project (`project.json metadata.budgetDefaults`) and per-build
   (`payload.budgets`) through `resolveAxisCap`, with the baked-in `BUDGET_DEFAULTS`
   value as the floor. The `config.json` key duplicated that default — and the code path
   that read it was already labelled the "legacy" fallback, fired only when the unified
   budget inputs weren't supplied.
3. **`writeConfig` had no production caller.** Nothing in the shipping code ever wrote
   `config.json`; only tests did. ADR 0030 itself noted the file is "hand-edited or
   written by tests."

ADR 0030 §2 deliberately chose a separate JSON home ("a config file is operator-editable
mid-session without a daemon restart"). That rationale is now better served by
`config.toml` itself — the brain re-reads `config.toml` per directive, so an edited
`[agents]` table takes effect on the next directive without a restart, and the daemon's
existing `reload-config` doorbell already nudges that re-read.

## Decision

Three parts.

### 1. The `[agents]` table moves into `config.toml`

The per-agent category override layer becomes an `[agents]` table in
`@factory5/brain`'s `configSchema`:

```toml
[agents]
architect = "reasoning"   # quick | planning | reasoning | deep | documentation
critic    = "deep"
```

`.strict()` is preserved (adding a third overridable agent stays a deliberate schema
bump). The resolution helper `resolveAgentCategory` and `DEFAULT_AGENT_CATEGORIES`
**remain in `@factory5/state`** — they are pure functions on a plain object, no I/O. The
dependency direction is brain → state → core (state never imports brain), so the brain
loads the TOML and passes the `[agents]` block into the state resolver. `architect.ts` /
`critic.ts` are unchanged.

### 2. The `askUserDeadlineMs` file override is retired

There is no per-instance file knob for the deadline. Resolution is:

```
per-build (payload.budgets)  >  per-project (project.json)  >  BUDGET_DEFAULTS (baked-in, 5 min)
```

The `ask-user.ts` fallback (when the unified budget inputs aren't passed) returns the
baked-in `DEFAULT_ASK_USER_DEADLINE_MS` directly instead of reading a file.

### 3. `config.json` is removed as a concept

`@factory5/state` no longer performs config I/O: `loadConfig` (the JSON one),
`writeConfig`, and `defaultConfigPath` are deleted, along with the now-unused
`factoryConfigFileSchema` and the resolved `FactoryConfig` interface in `@factory5/core`.
`DEFAULT_ASK_USER_DEADLINE_MS` stays in `@factory5/core` (it is the budget-axis default).

## Consequences

- **One config file, one `loadConfig`.** The name collision is gone — the only
  `loadConfig` is brain's TOML loader.
- **`@factory5/state` shrinks** to runtime-state-only plus the pure agent-category
  resolver. `@factory5/core` drops two dead exports.
- **Edits take effect without a restart.** The brain reads `config.toml` per directive, so
  an `[agents]` change applies on the next directive; the `reload-config` doorbell covers
  the daemon path incidentally.
- **Migration (manual, low-impact).** A stale on-disk `config.json` is now **silently
  ignored** — there is no auto-migration. An operator who had one re-adds the `[agents]`
  table to `config.toml`, and moves any `askUserDeadlineMs` value to
  `project.json metadata.budgetDefaults.askUserDeadlineMs` (per-project) or
  `--ask-user-deadline-ms` (per-build). The file is never deleted by factory; leaving it
  on disk is harmless. (A future `factory doctor` warning for a stray `config.json` is a
  possible follow-up, deliberately out of scope here.)
- **ADR 0030 stands except §2.** The auto-answer mechanics — deadline-driven dispatch,
  `answered_by` provenance, race mitigation, no-override-after-auto-answer, spend
  treatment — are unchanged. Only the config-home decision is superseded.

## Alternatives considered

- **Keep a global deadline override under `[budget.defaults]` in `config.toml`.** Rejected:
  it would require threading a fourth "instance-config" resolution tier into
  `resolveEffectiveCap` for a single axis that no other tier respects, contradicting ADR
  0035's closed-set model — for a knob with no demand signal. The per-project / per-build
  overrides already cover real needs.
- **Move the `[agents]` block to `project.json` (per-project).** Rejected: agent-category
  choice is an instance-wide operator preference, not a per-project property. YAGNI.
- **Leave the two files as-is and just document them.** Rejected: keeps the `loadConfig`
  name collision and the dead `writeConfig` surface, and leaves `askUserDeadlineMs`
  duplicated across the budget axis and the JSON file.
