# CLAUDE.md — Working brief for Claude Code on factory5

> **Read this first.** It is the standing brief for any session working on factory5 itself. The repo follows the same disciplines factory imposes on its outputs: design before code, verification-first, finding lifecycle.

## Workspaces — what's where

- **Long-form content** stays in `docs/` — `ARCHITECTURE.md`, `CONTRACTS.md`, `SKILLS.md`, `AGENTS.md`, `ONBOARDING.md`, `decisions/` (ADRs).
- **Upgrade workspace** lives in [`UPGRADE/`](UPGRADE/) — `AUDIT.md`, `ROADMAP.md`, `LOG.md`, `ISSUES.md`, `plans/`, `specs/`.
- **ADRs** go under `docs/decisions/` (factory5's `NNNN` numbering, append-only).
- **Issues** for upgrade work go in [`UPGRADE/ISSUES.md`](UPGRADE/ISSUES.md).

## Before touching code

1. **Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — the canonical system design.
2. **Skim [`docs/decisions/`](docs/decisions)** — the ADRs are the _why_. If your work contradicts an ADR, write a new ADR that supersedes it; don't silently disagree in code.

## Non-negotiable rules

- **No `console.log`.** Use `createLogger(name)` from `@factory5/logger` everywhere except in the logger package itself. Lint enforces it.
- **No `any`.** TypeScript strict mode + `@typescript-eslint/no-explicit-any: error`. Use `unknown` and narrow.
- **Every package needs:** `package.json`, `tsconfig.json` extending `tsconfig.base.json`, `README.md`, `src/index.ts`, at least one `*.test.ts` once it has logic.
- **Public exports are TSDoc'd.** A future reader (and `typedoc`) needs the doc comment.
- **Cross-platform always.** Windows + Linux must both work. Use `node:path`, `os.homedir()`, `os.EOL`. Never string-concatenate `/` for paths. Spawn subprocesses with `{ shell: false }` and explicit args arrays.
- **No orphan files.** If you create a file, something must import it (or it must be a doc/config file with an explicit purpose).
- **No new dependencies without a reason.** Add to a package's `package.json` only if you're using it. Prefer the existing toolset (Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git).
- **Edit existing files in preference to creating new ones.** Especially documentation — never make a new ADR when the existing one should be amended (and once an ADR is _accepted_, supersede rather than amend).

## Before you finish a session

A "session" ends when you stop or hand off. Run through this:

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes (for packages with tests)
- [ ] `pnpm lint` is clean
- [ ] `pnpm format:check` is clean
- [ ] If `core` types changed: regenerate or hand-update `docs/CONTRACTS.md`
- [ ] If you made a significant decision: add an ADR under `docs/decisions/`
- [ ] If a package's API changed: update its `README.md`

## Conventions

### Imports

- Use ESM imports with explicit `.js` extensions (TS source imports `.js` because Node ESM resolves the compiled output): `import { foo } from './bar.js'`
- Workspace packages imported as `@factory5/<name>`
- Use `import type { X } from '...'` for type-only imports (lint enforces)

### Error handling

- Throw at the boundary, not deep in helpers. Helpers return `Result<T, E>` only when callers commonly need to branch on failure.
- Errors that cross process boundaries (brain↔daemon IPC) are serialized with a stable `{ code, message, details }` shape.
- Never swallow an error to keep flow going. Either handle it explicitly (with rationale in a comment) or propagate.

### Logging

- `createLogger("brain.triage")` — stable component name, dotted hierarchy
- Pass `correlationId` (directiveId, taskId, sessionId) via `logger.child({ ... })` so tail/inspect can stitch lines together
- `info` for normal lifecycle, `warn` for recoverable, `error` for failures, `debug` for development detail. `trace` only when actively debugging that subsystem.

### Files in projects we build

Project state goes in `<workspace>/<project>/.factory/`. Never write to `~/.factory5/` from worker code — only the brain's state package writes there.

### Testing

- `vitest` with the shared root `vitest.config.ts`
- Unit tests live next to source: `src/foo.ts` + `src/foo.test.ts`
- Integration tests under `packages/<pkg>/test/`
- Tests for ground-truth code (assessor) must use real subprocesses where feasible — that's the point of the assessor

### Adding a new package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`
2. Add to `pnpm-workspace.yaml` (auto-included via `packages/*` glob — no edit needed)
3. Reference from consumers as `@factory5/<name>` and add to consumer's `dependencies` with `"workspace:*"`
4. Update `docs/ARCHITECTURE.md` component table
5. Add `README.md` describing purpose, public API, dependencies

### Adding an ADR

1. Find next number (current highest + 1)
2. Create `docs/decisions/NNNN-short-kebab-title.md` using the existing ADR shape (Context / Decision / Consequences / Alternatives)
3. Update `docs/decisions/INDEX.md`
4. If superseding an existing ADR, add `Supersedes: NNNN` in the header _and_ update the superseded ADR's status

## Pointers

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the system design (the _what_)
- [`docs/decisions/`](docs/decisions) — the ADRs (the _why_)
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — exact data shapes
- [`docs/SKILLS.md`](docs/SKILLS.md), [`docs/AGENTS.md`](docs/AGENTS.md) — what skills/agents exist and when each is used
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — clone-to-first-build walkthrough
- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — four canonical operator loops + surface decision matrix + CLAUDE.md authoring guide
- [`UPGRADE/`](UPGRADE) — current upgrade workspace (audit, roadmap, per-tier plans, log, issues)

When in doubt, prefer reading these documents to spelunking the code. They exist precisely so future sessions don't drift.
