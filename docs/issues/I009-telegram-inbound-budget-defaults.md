---
id: I009
severity: MEDIUM
area: channels/telegram
status: OPEN
created: 2026-04-23
---

# Telegram inbound doesn't inherit `[budget.defaults]` — directives created via `/build` run uncapped

## Description

When a Telegram (or Discord) `/build` command creates a directive
through `ChannelPlugin.onInbound`, the resulting `Directive` row lands
without a `limits` field. The brain's serve loop reads
`directive.limits` directly (`packages/brain/src/loop.ts:146`) and
treats `undefined` as unlimited — no `maxUsd`, no `maxSteps`. Every
Telegram-initiated build runs with no budget cap regardless of what
the operator has configured in `config.toml`'s `[budget.defaults]`
block.

The CLI's `factory build` reads defaults at directive-creation time
(`packages/cli/src/commands/build.ts:180-199`) and attaches the
resulting `limits` before writing the directive row. The channel
inbound paths don't do the equivalent — they create the directive
object inline in the plugin
(`packages/channels/src/telegram.ts:563-573`,
`packages/channels/src/discord.ts:317-327`).

**Consequence:** a user who expects `[budget.defaults] maxUsd = 3` to
apply to every build is silently bypassed on anything they kick off
from Telegram or Discord. A runaway build can burn unbounded spend.

## Repro / evidence

Phase 8.7 live validation (2026-04-23). The operator's
`.factory/config.toml` has no `[budget.defaults]` at all — defaults
are the `undefined`-means-unlimited path. Sending
`/build ask-user-smoke` to the bot creates directive
`01KPWY8KWE555411XSN2WG9JBS` with `source='telegram'`; the
`directives.limits` column is `NULL`. factoryd's own log corroborates:
`brain: running inline` prints the limits explicitly for
non-undefined cases — it prints nothing for this directive.

## Hypothesis

Two architectural decisions compounded:

1. `Directive.limits` is optional (by design, via `directiveLimitsSchema`
   in `@factory5/core`). Absence = unlimited.
2. Budget-default resolution was added as a CLI-side step in Phase 7a
   (ADR 0020) and never ported to non-CLI inbound paths because
   Phase 7c's channels (Discord/Telegram) landed before Phase 7a's
   defaults-wiring was generalised.

The fix direction is "resolve defaults at directive-creation time,
regardless of source." The cleanest spot:

- A small helper in `@factory5/brain` (or wherever the config shape
  lives) that resolves `{ limits?: DirectiveLimits }` from
  `config.budget.defaults` + optional overrides.
- Each inbound handler (CLI `build` command, Telegram inbound,
  Discord inbound) calls it before creating the directive and spreads
  the result.

Follow-up consideration: should the `/build` command string on
Telegram/Discord accept `--max-usd N` style flags inline, so the
operator can override per-invocation without touching config.toml?
`parseBuildPayload` currently only splits `<name> -- <spec>`. Flags
would be a larger parser change; not in scope for the immediate fix
but worth flagging.

## Resolution

(filled when work begins)
