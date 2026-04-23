---
id: I011
severity: HIGH
area: channels/telegram
status: RESOLVED
created: 2026-04-23
resolved: 2026-04-23
---

# Telegram inbound doesn't resolve project paths — `/build` fails when project isn't on factoryd's cwd

## Description

When a Telegram `/build <name>` command creates a directive, the
plugin sets `payload.project = <name>` as a bare string and hands
the directive to the daemon
(`packages/channels/src/telegram.ts:563-573`, specifically
`parseBuildPayload` at 666-677 which emits `{ project: <name>, text,
spec? }`). The brain's serve loop extracts that via
`extractProjectPath` (`packages/brain/src/loop.ts:463-472`) and
passes it to `runArchitect`, which opens `<projectPath>/CLAUDE.md`.

`<name>` is not absolute, so Node resolves it relative to the current
process's cwd — which for factoryd is the repo root. A build named
`ask-user-smoke` therefore looks for
`G:\Projects\Large-Projects\factory\factory5\ask-user-smoke\CLAUDE.md`,
which doesn't exist on a fresh install. The architect throws
`architect: ask-user-smoke\CLAUDE.md not found or unreadable
(ENOENT: ...)` and the directive transitions to `failed` within
seconds of claim.

The CLI's `factory build` resolves project paths in
`resolveProjectPath`
(`packages/cli/src/commands/build.ts:65-95`): (1) absolute path as-is,
(2) `./` or `../` relative to cwd, (3) workspace subdirectory
(default `~/factory5-workspace`), (4) template copy from
`templates/<name>/` into the workspace, (5) empty workspace dir as
last resort. It writes the resolved absolute path into
`payload.projectPath` before inserting the directive.

The channel inbound path has no equivalent step. Discord's inbound
(`packages/channels/src/discord.ts:317-327`, `parseBuildPayload` at
407-420) has the same gap.

## Repro / evidence

Phase 8.7 live validation (2026-04-23). factoryd running, all three
channels ready. From the operator's Telegram to @Factory5_bot:

```
/build ask-user-smoke
```

Factoryd log:

```
10:30:40.786  channels.telegram  telegram: inbound directive    directiveId=01KPWY8KWE555411XSN2WG9JBS intent=build ...
10:30:40.787  brain.serve        serve: claimed directive       directiveId=01KPWY8KWE555411XSN2WG9JBS
10:30:40.792  brain.loop         brain: running inline          ...
10:30:47.917  providers.claude-cli  claude-cli call complete    (triage, haiku, $0.0156)
10:30:47.918  brain.triage       triage complete                confidence=0.98
10:30:47.921  wiki.readiness     readiness checked              ok=false failed=[overview-exists, modules-documented, ...]
10:30:47.923  brain.serve        serve: directive threw         err.message="architect: ask-user-smoke\\CLAUDE.md not found
                                                                 or unreadable (ENOENT: no such file or directory, open
                                                                 'G:\\Projects\\Large-Projects\\factory\\factory5\\
                                                                 ask-user-smoke\\CLAUDE.md')"
```

`directives` row for `01KPWY8KWE555411XSN2WG9JBS`:

```json
{
  "source": "telegram",
  "principal": "1225367797",
  "channel_ref": "1225367797#9",
  "intent": "build",
  "payload_json": "{\"project\":\"ask-user-smoke\",\"text\":\"/build ask-user-smoke\"}",
  "autonomy": "autonomous",
  "status": "failed"
}
```

Note: `payload` contains `project` but not `projectPath`. The CLI
path would have set both.

## Hypothesis

CLI's `resolveProjectPath` encapsulates the "find or create the
project directory" policy. It was added in early Phase 1 inside the
CLI command module and never extracted to a shared module. Channels
ingestion (Phase 7c) copied the "create a directive on inbound"
shape but didn't port the path-resolution step — presumably because
the author mentally modelled Telegram/Discord as chat surfaces where
the payload is free text, not as build-triggering inputs needing
filesystem resolution.

## Resolution

Direction:

1. Extract `resolveProjectPath(name, workspace)` +
   `defaultWorkspace()` into a shared module. `@factory5/wiki` is the
   natural home — it already owns project-layout helpers in
   `paths.ts` (`projectPaths`, `.factory/` awareness) and has no
   dep on brain/channels, so every package that needs resolution can
   take a wiki dep without cycles.
2. Add an optional `resolveProjectPath?: (name: string) => Promise<string>`
   to `ChannelContext` (`packages/channels/src/types.ts`). The daemon
   wires this up at channel-registry creation time, binding the
   configured workspace from `config.general.workspace` (falling back
   to `~/factory5-workspace`).
3. Telegram and Discord inbound handlers call
   `ctx.resolveProjectPath?.(project)` before creating the directive,
   and set `payload.projectPath` on the result. Fall through to
   old-style `{ project }` only when the helper isn't wired (tests,
   scripts that don't provide the ctx method).
4. Refactor CLI's `factory build` to consume the shared helper
   rather than duplicating the local copy.

Regression tests:

- Unit tests for the shared helper in wiki (existing + template
  copy paths, empty-dir creation, absolute/relative handling).
- An inbound integration test for Telegram that passes a
  template-name `/build` and asserts the resulting directive has
  `payload.projectPath` set to an absolute workspace path.

Fix lands as part of Phase 8.7 close (`feat(8.7)`). Issue expected
to transition to `RESOLVED` on that commit.

### Status 2026-04-23 — resolved

Implemented as described. New module
`packages/wiki/src/project-resolver.ts` exports
`resolveProjectPath(name, workspace, opts?)` +
`findRepoTemplatesDir(opts?)` + `defaultWorkspace()`. `ChannelContext`
(`packages/channels/src/types.ts`) gains
`resolveProjectPath?: (name: string) => Promise<string>`. The channel
registry (`packages/channels/src/registry.ts`) threads it through to
each plugin's `start(ctx, config)` call. Daemon
(`packages/daemon/src/index.ts`) binds the function with the
configured workspace
(`config.general.workspace ?? defaultWorkspace()`). Telegram +
Discord inbound handlers call it before creating the directive and
set `payload.projectPath`; they fall back to the raw-name payload
only when the ctx method is unwired (tests / scripts). CLI's
`factory build` refactored to consume the shared helper directly
from wiki.

Regression coverage:

- `packages/wiki/src/project-resolver.test.ts` — 8 tests covering
  the 5 resolution rungs (absolute / relative / workspace /
  template-copy / empty-dir) + `findRepoTemplatesDir` ancestor walk.
- `packages/channels/src/telegram.test.ts` — 2 new tests covering
  the ctx resolver wiring (happy-path sets `projectPath`, resolver
  throws → falls back to raw name). The pre-existing "parses /build
  prefix" test was updated to assert `projectPath` is undefined when
  the resolver isn't wired (pre-I011 shape still works for tests).

Verified live via Phase 8.7's second run (directive
`01KPX1Z4RE3535H8X55E169PHR`, 2026-04-23 11:35–12:24). Directive
payload landed with
`projectPath="C:\\Users\\Momo\\factory5-workspace\\ask-user-smoke"`
at claim time; architect/planner/workers all ran against the
absolute path without junction assistance; full pipeline completed
(though blocked at verify-gate on unrelated hallucinated findings —
not part of this issue).
