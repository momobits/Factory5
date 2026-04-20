# CLAUDE.md — Working brief for Claude Code on factory5

> **Read this first.** It is the standing brief for any session working on factory5 itself. The repo follows the same disciplines factory imposes on its outputs: design before code, verification-first, finding lifecycle.

## Control framework (operational layer)

This project uses the **Control framework** for session management — cursor, phase gating, commit discipline, hook-driven snapshots. Framework reference: [`.control/PROJECT_PROTOCOL.md`](.control/PROJECT_PROTOCOL.md). Tunables: [`.control/config.sh`](.control/config.sh).

**At session start:**
1. Read [`.control/progress/STATE.md`](.control/progress/STATE.md) — current phase, step, next action.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for blockers (operational); check [`docs/issues/INDEX.md`](docs/issues/INDEX.md) for the rich issue backlog.
4. Run `/session-start` for the full git/state drift check.
5. **Wait for user confirmation before editing code.**

**Content vs operational split — important:**
- **Long-form content stays in `docs/`** — `CompleteArchitecture.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`, `docs/PROGRESS.md`, `docs/decisions/` (ADRs), `docs/issues/` (rich issue files), `docs/Phase*_Progress.md`, `docs/Phases/`. These are authoritative for **what the system is**.
- **Operational cursor lives in `.control/`** — `progress/STATE.md` (current position), `progress/journal.md` (per-step log), `progress/next.md` (handoff prompt), `phases/phase-<N>/` (active step checklist), `snapshots/` (PreCompact auto-saves).
- **ADRs: write under `docs/decisions/`** (factory5's richer shape, `INNN` numbering). `.control/architecture/decisions/` is kept empty — don't fork the set.
- **Issues: write under `docs/issues/`** with factory5's frontmatter shape. `.control/issues/OPEN|RESOLVED/` is reserved for Control's `/new-issue` + `/close-issue` flow if ever used; do not duplicate.

**Control invariants:**
- Commit message shape: `<type>(<phase>.<step>): <subject>` (e.g. `feat(6c.1): add read tools to verifier allowlist`). Allowed types: `feat fix test docs refactor chore`.
- Every sub-step closes with a commit. Every phase/sub-phase closes with a tag (`phase-6c-verifier-overhaul-closed`, etc.) via `/phase-close`.
- Never advance a step with uncommitted work unless STATE.md's "In-flight work" explains why.
- Regression test required before any blocker/major issue moves to RESOLVED.
- Do not edit accepted ADRs in `docs/decisions/` — supersede with a new one.

## Before touching code

1. **Read [`CompleteArchitecture.md`](CompleteArchitecture.md)** — the canonical design.
2. **Read [`docs/PROGRESS.md`](docs/PROGRESS.md)** — what has been built and what's next. Every session updates this at the end.
3. **Skim [`docs/decisions/`](docs/decisions)** — the ADRs are the _why_. If your work contradicts an ADR, write a new ADR that supersedes it; don't silently disagree in code.
4. **Skim [`docs/issues/INDEX.md`](docs/issues/INDEX.md)** — open work items. Pick from here when not directed.

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
- [ ] If you closed an issue: update `docs/issues/INDEX.md` and the issue file's frontmatter
- [ ] **Append a new section to `docs/PROGRESS.md`** with: date, what was done, what was decided, what's next
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

- `CompleteArchitecture.md` — the snapshot at scaffold; the _what_
- `docs/ARCHITECTURE.md` — current; mirrors the snapshot but evolves
- `docs/PROGRESS.md` — _when_ and _what next_
- `docs/decisions/` — _why_
- `docs/CONTRACTS.md` — exact data shapes
- `docs/SKILLS.md`, `docs/AGENTS.md` — what skills/agents exist and when each is used

When in doubt, prefer reading these documents to spelunking the code. They exist precisely so future sessions don't drift.
