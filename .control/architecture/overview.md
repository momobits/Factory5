# Project Overview — factory5

> **Pointer file.** The authoritative architecture docs live in `docs/` (and at the root). This file exists so Control's session-start knows where to look. Do **not** copy content from those docs here — that creates a second source of truth that will drift. Update the canonical docs instead.

## What factory5 is

An agentic build system. The user describes a project in natural language (a "directive"), factory5 plans the module graph, scaffolds a repo, writes the code across N tool-using builder subprocesses in parallel git worktrees, runs a language-aware assessor with real test execution, and ships a working project. One-user-one-machine today; multi-channel, multi-project in Phase 6+.

## Canonical architecture references

Read these in order:

| Doc | Purpose | When to read |
|---|---|---|
| [`../../CompleteArchitecture.md`](../../CompleteArchitecture.md) | Snapshot at scaffold — canonical design (698 lines) | Once, end-to-end |
| [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) | Current architecture, component table | Anytime the component surface is in play |
| [`../../docs/CONTRACTS.md`](../../docs/CONTRACTS.md) | Typed data shapes (Directive, Event, Finding, Plan, Task, AssessResult, etc.) | Any time you touch inter-package wires |
| [`../../docs/SKILLS.md`](../../docs/SKILLS.md) | Skill catalog — what each agent skill does and when it's used | Changes to `skills/` or agent prompts |
| [`../../docs/AGENTS.md`](../../docs/AGENTS.md) | Agent catalog — roles (architect, planner, scaffolder, builder, verifier, assessor, fixer, triage, gatekeeper) | Any brain/worker changes |
| [`../../docs/decisions/INDEX.md`](../../docs/decisions/INDEX.md) | 17 ADRs, the _why_ | Before any architectural change |
| [`../../docs/issues/INDEX.md`](../../docs/issues/INDEX.md) | Open/resolved issue backlog | When not directed to a specific task |
| [`../../docs/PROGRESS.md`](../../docs/PROGRESS.md) | Session-by-session history (2500+ lines) | For deep context on a past decision |

## Phase-level history

| Doc | Scope |
|---|---|
| [`../../docs/Phase5_Progress.md`](../../docs/Phase5_Progress.md) | Phase 5 arc — autonomous loop validated end-to-end, all 7 issues resolved, Outcome α |
| [`../../docs/Phase6_Progress.md`](../../docs/Phase6_Progress.md) | Phase 6 charter — three sub-phases (6a registry, 6b github, 6c verifier); **executed as 6c → 6a → 6b** |
| [`../../docs/Phases/`](../../docs/Phases/) | Per-phase working directories with start-prompts and session notes |

## Package map (quick reference)

One-line purpose each — expand via `docs/ARCHITECTURE.md` or the package README.

```
apps/
  factory              CLI binary entry point
  factoryd             daemon binary entry point

packages/
  core                 Zod schemas, types, ULID helpers
  logger               Pino-based structured logging
  state                better-sqlite3 runtime state (directives, tasks, events, findings)
  ipc                  HTTP IPC contracts (factory ↔ factoryd)
  providers            ModelProvider interface + claude-cli impl + category routing
  channels             ChannelPlugin interface + discord (github pending in 6b)
  events               EventSource interface
  brain                Triage → architect → planner → scaffolder → N builders → verifier → assessor
  worker               Tool-using agent subprocess (scaffolder/builder/verifier/fixer)
  wiki                 Per-project findings + build log + readiness checks
  assessor             Ground-truth verification (real subprocesses, real pytest, real env)
  daemon               factoryd supervision layer; hosts the brain
  cli                  Commander subcommands for the factory binary
```

## Tech stack

- **TypeScript strict mode** on Node 20+ (ADR 0001)
- **ESM** with explicit `.js` extensions on TS imports (NodeNext resolution)
- **pnpm workspaces** (`packages/*`, `apps/*`)
- **vitest** for tests; shared `vitest.config.ts`
- **Pino** logging, **Zod** schemas, **Commander** CLI, **Fastify** IPC, **better-sqlite3** state, **discord.js** channel, **chokidar** fs-watch, **simple-git** worktrees
- **ADR 0017** — assessor provisions per-project Python venvs (`.factory/assessor-env/`), runs real pytest

## Invariants pinned at Phase 5 close (2026-04-19)

- 255 unit tests across 12 packages, all green
- All 7 factory5 self-issues (I001–I007) resolved
- Live `factory build example` completes with all gates true, `gate.verify: true`, $5.84 spend
- Live `factory build parallel-example` exhibits same-ms sibling worker start
- Verifier is read-only (no tools) — known hallucination surface that Phase 6c addresses
