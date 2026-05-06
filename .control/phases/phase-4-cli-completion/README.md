# Phase 4 — cli-completion

**Dependencies:** Phase 3 (`phase-3-web-ui-closed`); Phase 2 (`phase-2-channel-parity-closed`) for `factory cancel` shell
**Estimated duration:** ~1 session

## Goal

Every operator action available from the web UI or channels is also available from the CLI. Plus tab completion and rich `--help` examples on every command.

## Outcome

- `factory cancel <directive-id>` verified end-to-end (Phase 2's plumbing already shipped; Tier 4 verifies the CLI surface).
- `factory budget set <project> --max-usd <n> [--max-steps <n>]` writes to `<workspace>/<project>/.factory/project.json` `metadata.budgetDefaults`; same code path as the web UI's `PUT /api/v1/projects/:id/budget`.
- `factory project list / show <name> / delete <name>` covers introspection + safe unregister (no workspace-file deletion by default; `--purge` is the explicit destructive variant with double-confirm).
- `factory ask "<question>"` ships single-shot chat (one directive, one reply, exit). `--json` outputs the reply for scripting.
- Tab completion for `bash`, `zsh`, `pwsh` via `factory completion <shell>` (static — sub-commands + flag names; dynamic completion is future polish).
- Every `factory <cmd> --help` shows at least one worked example via `addHelpText('after', '...')`.
- `packages/cli/README.md` refreshed for the new commands.

## Where we were, end of Phase 3

Phase 3 closed `phase-3-web-ui-closed` after a ten-step arc that turned the dashboard from a static, F5-driven page set into a live, mobile-aware operating surface. ADR 0029 pinned the SSE protocol (six event types: `task.update`, `finding.created`, `spend.tick`, `directive.status`, `log.line`, `heartbeat`); ADR 0027 pinned the web-side mutation surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`); ADR 0028 pinned the per-spawn worker-sandbox contract.

What 4.x can rely on without re-paving:

- **Live build observation** via SSE on `/api/v1/directives/:id/stream` — task / finding / spend / status / log events arrive without polling. Brain-side emission is callback-optional, so non-streaming callers are unaffected.
- **Astro component library** + `lib/api.ts` cleanup — `el()` is retired, all nine pages render via shared components.
- **Web parity surfaces**: `/app/chat` (single-shot + REPL via the chat protocol), `/app/projects/new` (`factory init` analogue), cancel + answer-question buttons on directive detail, spend page with sparkline-per-project + 30-day stacked bar.
- **Mobile-responsive nav** (hamburger drawer at narrow widths; primary actions reachable in ≤2 taps).
- **Header connection-status pip + explicit logout** — 30 s heartbeat against `/api/v1/status` with a green/amber/red state machine; 401 short-circuits to "Session expired" with a tooltip naming `factory ui-token`.
- **Phase 2.4's cancel plumbing is live and verified** — brain `AbortController` registry, IPC `POST /directives/:id/cancel`, DB-direct fallback, worker SIGTERM/SIGKILL discipline. The CLI surface (`factory cancel <id>`) was wired then; Phase 4.1 is the verification commit.

## Why this phase exists

Carried forward from Phase 3:

- Pause primitive on directive detail — defer until a real workflow signal demands it (cancel solves the primary operator-pain case; pause-then-think is the kind of feature worth designing once; choose between extending `directivesQ.status` with `paused`/resume or reusing `markBlocked` with `blockedReason: 'paused-by-operator'` when the signal lands).
- PageShell adoption + Dashboard `<style is:global>` migration — 11-page structural sweep that absorbs the unstyled "Clear all defaults" + 4× filter-form Apply buttons issue, consolidates inline `style=` attributes, and moves Dashboard's currently-scoped `.btn*` / `.alert*` / `.form-*` rules to global so raw page buttons inherit them; self-contained ~1 commit when authored.
- Brain-side `log.line` forwarder — selective pino-stream tap filtered by `correlationId` so the FE log tail uses live events instead of the polling fallback (ADR 0029 future-work item; not gating any 4.x step but a natural fit alongside the CLI-completion polish).

The CLI is the third operator surface, and after Phases 2 and 3 it's the one that's drifted — the web UI and the channels both gained capabilities (cancel, budget mutation, single-shot chat, project introspection) without sibling CLI commands. Operators on a desktop, where CLI is fastest, end up reaching for the dashboard or `sqlite3` for things that should be a one-liner. Phase 4 closes the parity gap with five new commands (`cancel` verify, `budget set`, `project list/show/delete`, `ask`, `completion`), then layers polish — rich `--help` examples on every command and tab completion for bash/zsh/pwsh. Issues addressed: U018 (no `cancel` CLI verification), U019 (no `budget set` CLI), U020 (no project introspection CLI), U021 (no single-shot chat CLI), partially U004 (CLI surface for cancel; closed in Phase 2 plumbing).

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, decision rationale, suggested commit messages): [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:4-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] All new commands have unit tests in their `*.test.ts` siblings
- [ ] Tab completion produces valid bash / zsh / pwsh completion scripts (`factory completion <shell>` runs and emits the expected output for each)
- [ ] Every `factory <cmd> --help` shows at least one worked example
- [ ] Issues U018, U019, U020, U021 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md)
- [ ] `packages/cli/README.md` updated to reflect new commands
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(4.<step>): <subject>` shape (e.g. `feat(4.2): factory budget set <project>`)
- [ ] Phase will be tagged `phase-4-cli-completion-closed` by `/phase-close`

## Rollback plan

If Phase 4 needs to be undone: `git reset --hard phase-3-web-ui-closed`. No external state to roll back — the new commands are file-additions under `packages/cli/src/commands/` and reuse existing code paths (wiki helpers, IPC routes, daemon mutations) that already shipped in Phases 2 and 3.

## ADRs decided in this phase

- (filled in as decisions are made — likely candidates: tab-completion scope policy v1 (static vs. dynamic); `factory project delete` semantics (unregister vs. `--purge`); `factory ask` JSON output shape pinned to chat-protocol spec)

## Deferred to Phase 5 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- <item> — <one-line reason for deferral>
